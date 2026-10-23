import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { newAssertion, newExtraction, readPath, applyVariableChanges } from '../shared/automation.ts';
import { parseRunData } from '../shared/data.ts';
import { planRun, runCollection } from '../shared/runner.ts';
import { initialWorkspace, newDraft, newEntry, parseWorkspace } from '../shared/workspace.ts';
import { runRequest } from '../server/pipeline.ts';
import { runScript } from '../server/scripts.ts';
import { createReqoraServer } from '../server/index.ts';

let calls = 0, base = '', apiUrl = '', slowStarted = () => {};
const fixture = createServer(async (req, res) => {
  calls++;
  const url = new URL(req.url || '/', 'http://fixture');
  if (url.pathname === '/slow') { slowStarted(); const timer = setTimeout(() => res.end('{}'), 1500); res.on('close', () => clearTimeout(timer)); return; }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  res.setHeader('Content-Type', 'application/json');
  const id = url.searchParams.get('id') || '1';
  if (url.pathname === '/protected' && req.headers.authorization !== `Bearer token-${id}`) res.statusCode = 401;
  res.end(JSON.stringify({ token: `token-${id}`, id: Number(id), headers: req.headers, body: Buffer.concat(chunks).toString(), items: [{ id: Number(id) }] }));
});
const api = createReqoraServer();
before(async () => {
  for (const server of [fixture, api]) await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = fixture.address(), apiAddress = api.address();
  assert(address && typeof address !== 'string' && apiAddress && typeof apiAddress !== 'string');
  base = `http://127.0.0.1:${address.port}`; apiUrl = `http://127.0.0.1:${apiAddress.port}`;
});
after(async () => {
  for (const server of [fixture, api]) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

function workspace() {
  const value = initialWorkspace();
  const collection = value.collections[0];
  collection.name = 'Automation <tests>';
  collection.variables = [newEntry('base_url', base), newEntry('id', '99')];
  const login = { ...newDraft(collection.id), name: 'Login', url: '{{base_url}}/login?id={{id}}', assertions: [newAssertion()], extractions: [{ ...newExtraction(), variable: 'token', path: '$.token' }] };
  const protectedRequest = { ...newDraft(collection.id), name: 'Protected', url: '{{base_url}}/protected?id={{id}}', authType: 'bearer' as const, token: '{{token}}', assertions: [newAssertion()] };
  value.saved = [{ collectionId: collection.id, request: login }, { collectionId: collection.id, request: protectedRequest }];
  return value;
}

test('scripts execute in scope order; assertions and extractions use the final response', async () => {
  const value = workspace(), collection = value.collections[0], request = value.saved[0].request;
  collection.preRequestScript = 'rq.variables.set("order", "C"); console.log("collection pre");';
  request.preRequestScript = 'rq.variables.set("order", rq.variables.get("order") + "R"); rq.request.setHeader("X-Order", rq.variables.get("order"));';
  collection.postResponseScript = 'rq.variables.set("order", rq.variables.get("order") + "P");';
  request.postResponseScript = 'rq.variables.set("order", rq.variables.get("order") + "S"); rq.test("JSON body", () => rq.expect(rq.response.json().id).toBe(42)); rq.globals.set("from_script", true);';
  request.assertions.push({ ...newAssertion(), name: 'Run data resolves in assertions', source: 'json', path: '$.items[0].id', expected: '{{id}}' });
  const result = await runRequest({ request, globals: value.variables, collection, data: { id: 42 } });
  assert.equal(result.passed, true);
  assert.equal(JSON.parse(result.response!.body).headers['x-order'], 'CR');
  assert.equal(result.changes.find(change => change.name === 'order')?.value, 'CRPS');
  assert.equal(result.changes.find(change => change.name === 'token')?.value, 'token-42');
  assert(result.tests.some(test => test.name === 'JSON body' && test.passed));
  assert(result.logs.some(log => log.phase === 'Collection pre-request'));
  const updated = applyVariableChanges(value, result.changes, collection.id);
  assert.equal(updated.variables.find(row => row.name === 'from_script')?.value, 'true');
  assert(!value.variables.some(row => row.name === 'from_script'));
});

test('pre-request errors prevent HTTP, failed script phases roll back their changes, and post errors retain responses', async () => {
  const value = workspace(), request = value.saved[0].request;
  const beforeCalls = calls;
  request.preRequestScript = 'rq.variables.set("bad", "value"); throw Error("pre stopped");';
  const failed = await runRequest({ request, globals: [], collection: value.collections[0] });
  assert.match(failed.error!, /pre stopped/); assert.equal(calls, beforeCalls); assert.equal(failed.changes.length, 0);
  request.preRequestScript = ''; request.postResponseScript = 'throw Error("post stopped");';
  const post = await runRequest({ request, globals: [], collection: value.collections[0] });
  assert.equal(post.response?.status, 200); assert.match(post.error!, /post stopped/); assert.equal(post.passed, false);
});

test('sandbox has no host globals or modules and terminates infinite loops and memory exhaustion', async () => {
  const input = { script: 'rq.test("isolated", () => { rq.assert(typeof process === "undefined"); rq.assert(typeof require === "undefined"); rq.assert(typeof fetch === "undefined"); rq.assert(typeof Buffer === "undefined"); });', phase: 'sandbox', request: newDraft(), globals: {}, collection: {}, data: {}, hasCollection: false, iteration: 0 };
  assert.equal((await runScript(input)).tests[0].passed, true);
  await assert.rejects(runScript({ ...input, script: 'Promise.resolve().then(() => rq.variables.set("late", "value"));' }), /Asynchronous/);
  await assert.rejects(runScript({ ...input, script: 'while (true) {}' }), /interrupted|limit|memory/i);
  const memory = await runScript({ ...input, script: 'const values = new Array(100000000).fill("x");' }).catch(error => ({ error: (error as Error).message }));
  assert.match(memory.error!, /memory|alloc|limit/i);
  const controller = new AbortController();
  const pending = runScript({ ...input, script: 'while (true) {}' }, controller.signal);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, /cancelled/);
});

test('assertion failures, extraction requirements, headers, and JSON pointers produce individual results', async () => {
  const value = workspace(), request = value.saved[0].request;
  request.assertions = [
    { ...newAssertion(), expected: '201' },
    { ...newAssertion(), source: 'header', path: 'content-type', operator: 'contains', expected: 'application/json' },
    { ...newAssertion(), source: 'duration', operator: 'lessThan', expected: '60000' },
    { ...newAssertion(), source: 'json', path: '/items/0/id', expected: '99' },
    { ...newAssertion(), source: 'json', path: '$.token', operator: 'exists', expected: '{{unused_missing_variable}}' },
  ];
  request.extractions.push({ ...newExtraction(), name: 'Optional missing', path: '$.missing', required: false }, { ...newExtraction(), name: 'Required missing', path: '$.missing' });
  const result = await runRequest({ request, globals: [], collection: value.collections[0] });
  assert.equal(result.passed, false); assert.equal(result.tests.filter(test => !test.passed).length, 2);
  assert.equal(result.tests.find(test => test.name === 'Optional missing')?.passed, true);
  assert.equal(readPath({ 'a/b': { '~': null } }, '/a~1b/~0'), null);
  assert.equal(readPath({}, '$.constructor'), undefined);
  assert.throws(() => readPath({}, '$.a[*]'));
});

test('collection runs chain extracted variables across JSON/CSV rows, repeat datasets, and leave saved state unchanged', async () => {
  const value = workspace(), snapshot = JSON.stringify(value);
  const report = await runCollection(value, value.collections[0].id, { iterations: 2, delayMs: 0, stopOnFailure: false, data: parseRunData('id,expected\r\n1,200\r\n2,200\r\n', 'csv') }, { execute: runRequest });
  assert.equal(report.planned, 8); assert.equal(report.completed, 8); assert.equal(report.failed, 0);
  assert.equal(report.changes.at(-1)?.value, 'token-2');
  assert.equal(JSON.stringify(value), snapshot);
  assert(!JSON.stringify(report).includes('"response"'));
});

test('runner bails on failures, validates order/limits, and cancels between requests', async () => {
  const value = workspace(), id = value.collections[0].id;
  value.saved[0].request.assertions[0].expected = '201';
  const options = { iterations: 1, delayMs: 0, stopOnFailure: true, data: [] };
  const report = await runCollection(value, id, options, { execute: runRequest });
  assert.equal(report.completed, 1); assert.equal(report.failed, 1);
  assert.throws(() => planRun(value, id, { ...options, iterations: 1000 }), /1000 request/);
  assert.throws(() => planRun(value, id, { ...options, requestIds: ['missing'] }), /not in this collection/);
  const controller = new AbortController();
  const cancelled = await runCollection(value, id, { ...options, stopOnFailure: false }, { execute: runRequest, signal: controller.signal, onResult: () => controller.abort() });
  assert.equal(cancelled.cancelled, true); assert.equal(cancelled.completed, 1);
});

test('run reports bound console/check details and retain final variable changes rather than mutation history', async () => {
  const value = workspace(), id = value.collections[0].id;
  let count = 0;
  const logs = Array.from({ length: 100 }, () => ({ level: 'log' as const, phase: 'test', message: 'x'.repeat(2000) }));
  const report = await runCollection(value, id, { iterations: 30, delayMs: 0, stopOnFailure: false, data: [] }, { execute: async () => ({ passed: true, tests: [], logs, changes: [{ scope: 'collection', name: 'counter', value: String(++count) }] }) });
  assert.equal(report.completed, 60);
  assert.equal(report.changes.length, 1);
  assert.equal(report.changes[0].value, '60');
  assert(report.results.some(item => item.detailsTruncated));
  assert(JSON.stringify(report).length < 9 * 1024 * 1024);
});

test('data parsing supports quoted/multiline CSV and typed JSON; malformed datasets are rejected', () => {
  assert.deepEqual(parseRunData('name,value\n"a,b","line1\nline2"\n"quote""here",\n', 'csv'), [{ name: 'a,b', value: 'line1\nline2' }, { name: 'quote"here', value: '' }]);
  assert.deepEqual(parseRunData('[{"id":1,"enabled":true,"value":null}]', 'json'), [{ id: 1, enabled: true, value: null }]);
  for (const text of ['a,a\n1,2', ',b\n1,2', 'a,b\n1', 'a\n"unclosed']) assert.throws(() => parseRunData(text, 'csv'));
  assert.throws(() => parseRunData('[1,2]', 'json'));
});

test('automation API enforces same-origin validation and preserves legacy execution endpoint', async () => {
  const value = workspace();
  const body = JSON.stringify({ request: value.saved[0].request, globals: value.variables, collection: value.collections[0] });
  const response = await fetch(apiUrl + '/api/run-request', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: apiUrl }, body });
  assert.equal(response.status, 200); assert.equal((await response.json() as { passed: boolean }).passed, true);
  assert.equal((await fetch(apiUrl + '/api/run-request', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://foreign.test' }, body })).status, 403);
  assert.equal((await fetch(apiUrl + '/api/run-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
});

test('legacy imports receive automation defaults and reject invalid scripts/rules', () => {
  const value = workspace();
  const legacy = JSON.parse(JSON.stringify(value));
  for (const item of legacy.saved) { delete item.request.preRequestScript; delete item.request.postResponseScript; delete item.request.assertions; delete item.request.extractions; }
  assert.equal(parseWorkspace(JSON.stringify(legacy)).saved[0].request.preRequestScript, '');
  value.saved[0].request.preRequestScript = 'x'.repeat(32769);
  assert.throws(() => parseWorkspace(JSON.stringify(value)));
});

test('CLI produces JSON/JUnit reports and persisted variables, with CI-friendly failure codes', async () => {
  const exec = promisify(execFile), directory = await mkdtemp(join(tmpdir(), 'reqora-cli-'));
  const command = fileURLToPath(new URL('../cli/reqora.mjs', import.meta.url));
  try {
    const value = workspace();
    value.saved[0].request.postResponseScript = 'rq.test("CLI script", () => rq.expect(rq.response.status).toBe(200));';
    const file = join(directory, 'workspace.json'), report = join(directory, 'report.json'), junit = join(directory, 'junit.xml'), saved = join(directory, 'saved.json');
    await writeFile(file, JSON.stringify(value));
    await writeFile(join(directory, 'data.csv'), 'id\n1\n2\n');
    const args = [command, 'run', file, '--data', join(directory, 'data.csv'), '--report', report, '--junit', junit, '--save-variables', saved, '--quiet'];
    const result = await exec(process.execPath, args);
    assert.match(result.stdout, /4 passed, 0 failed/);
    assert.equal(JSON.parse(await readFile(report, 'utf8')).completed, 4);
    assert.match(await readFile(junit, 'utf8'), /Automation &lt;tests&gt;/);
    assert.equal(parseWorkspace(await readFile(saved, 'utf8')).collections[0].variables.find(row => row.name === 'token')?.value, 'token-2');
    value.saved[0].request.assertions[0].expected = '201'; await writeFile(file, JSON.stringify(value));
    await assert.rejects(exec(process.execPath, [command, 'run', file, '--bail', '--quiet']), error => (error as { code?: number }).code === 1);
    await assert.rejects(exec(process.execPath, [command, 'run', file, '--iterations', '0']), error => (error as { code?: number }).code === 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI only reads uploads from the explicitly allowed directory', { skip: process.platform === 'win32' }, async () => {
  const exec = promisify(execFile), directory = await mkdtemp(join(tmpdir(), 'reqora-cli-files-'));
  try {
    const root = join(directory, 'uploads'); await mkdir(root);
    const value = workspace(), request = value.saved[0].request;
    request.method = 'POST'; request.bodyType = 'binary'; request.binaryFile = { id: 'upload', name: 'payload.bin', size: 4, type: 'application/octet-stream' };
    value.saved = [value.saved[0]];
    await writeFile(join(directory, 'outside.bin'), 'data');
    await symlink(join(directory, 'outside.bin'), join(root, 'payload.bin'));
    const file = join(directory, 'workspace.json'), report = join(directory, 'report.json'); await writeFile(file, JSON.stringify(value));
    const command = fileURLToPath(new URL('../cli/reqora.mjs', import.meta.url));
    await assert.rejects(exec(process.execPath, [command, 'run', file, '--files', root, '--report', report, '--quiet']), error => (error as { code?: number }).code === 1);
    assert.match(JSON.parse(await readFile(report, 'utf8')).results[0].error, /outside the allowed/);
    await rm(join(root, 'payload.bin')); await writeFile(join(root, 'payload.bin'), 'data');
    assert.match((await exec(process.execPath, [command, 'run', file, '--files', root, '--quiet'])).stdout, /1 passed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('CLI cancellation writes a report and exits 130 while aborting active HTTP', { skip: process.platform === 'win32' }, async () => {
  const exec = promisify(execFile), directory = await mkdtemp(join(tmpdir(), 'reqora-cli-cancel-'));
  try {
    const value = workspace(); value.saved = [value.saved[0]]; value.saved[0].request.url = base + '/slow';
    const file = join(directory, 'workspace.json'), report = join(directory, 'report.json'); await writeFile(file, JSON.stringify(value));
    const started = new Promise<void>(resolve => { slowStarted = resolve; });
    const command = fileURLToPath(new URL('../cli/reqora.mjs', import.meta.url));
    const running = exec(process.execPath, [command, 'run', file, '--report', report, '--quiet']);
    const rejected = assert.rejects(running, error => (error as { code?: number }).code === 130);
    await started; running.child.kill('SIGINT'); await rejected;
    assert.equal(JSON.parse(await readFile(report, 'utf8')).cancelled, true);
  } finally { slowStarted = () => {}; await rm(directory, { recursive: true, force: true }); }
});
