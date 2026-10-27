import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compareAssertion, checkValue } from '../shared/assertions.ts';
import { inspectJsonSchema, matchingResponseSchema, validateJsonSchema } from '../shared/schema.ts';
import { initialWorkspace, newDraft, newEntry, parseWorkspace } from '../shared/workspace.ts';
import { newAssertion } from '../shared/automation.ts';
import { runRequest } from '../server/pipeline.ts';
import { runCollection } from '../shared/runner.ts';

let calls = 0, base = '';
const server = createServer(async (request, reply) => {
  calls++;
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  reply.setHeader('Content-Type', 'application/json');
  reply.end(Buffer.concat(chunks).toString() || '{"ok":true}');
});
before(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

test('schema definitions fail explicitly for malformed and unused unsupported rules', () => {
  for (const schema of [{ type: 'typo' }, { required: 'id' }, { minLength: -1 }, { multipleOf: 0 }, { properties: [] }, { items: [] }, { allOf: [] }, { $ref: 'https://remote.invalid/schema' }, { properties: { unused: { pattern: '(a+)+$' } } }]) {
    assert(inspectJsonSchema(schema).length > 0);
    assert(validateJsonSchema({}, schema).length > 0);
  }
  assert.deepEqual(inspectJsonSchema(false), []);
  assert.deepEqual(validateJsonSchema({}, true), []);
  assert(validateJsonSchema({}, false).length);
  const nested = { $defs: { Id: { type: 'integer' } }, properties: { id: { $ref: '#/$defs/Id', minimum: 5 } } };
  assert.deepEqual(validateJsonSchema({ id: 7 }, nested), []);
  assert.match(validateJsonSchema({ id: 2 }, nested)[0].message, />= 5/);
  assert.equal(validateJsonSchema({}, { required: ['a/b~c'] })[0].path, '$/a~1b~0c');
  const many = validateJsonSchema(Array.from({ length: 50_000 }, () => 'bad'), { items: { type: 'number' } });
  assert.equal(many.length, 30);
  assert(validateJsonSchema('2025-02-30', { format: 'date' }).length);
  assert.deepEqual(validateJsonSchema('2024-02-29', { format: 'date' }), []);
  assert(validateJsonSchema('2024-02-29T12:00:00', { format: 'date-time' }).length);
  assert(validateJsonSchema('2024-02-29T24:00:00Z', { format: 'date-time' }).length);
  assert.deepEqual(validateJsonSchema('2024-02-29T12:30:00+05:30', { format: 'date-time' }), []);
});

test('custom request schemas validate resolved bodies and stop invalid requests before any HTTP', async () => {
  const request = { ...newDraft(), url: '{{host}}/echo', method: 'POST', bodyType: 'json' as const, body: '{"id":"{{id}}","name":3}', schema: { enabled: true, manualResponse: '', manualRequest: '{"type":"object","properties":{"id":{"type":"integer"},"name":{"type":"string"}}}' } };
  const beforeCalls = calls;
  const failed = await runRequest({ request, globals: [newEntry('host', base), newEntry('id', '4')] });
  assert.equal(calls, beforeCalls); assert.equal(failed.response, undefined);
  assert.equal(failed.tests[0].phase, 'Request'); assert.equal(failed.tests[0].issues?.length, 2);
  assert.equal(failed.request?.url, `${base}/echo`);
  request.body = '{"id":{{id}},"name":"valid"}';
  const passed = await runRequest({ request, globals: [newEntry('host', base), newEntry('id', '4')] });
  assert(passed.passed); assert.equal(calls, beforeCalls + 1);
  assert.equal(passed.tests[0].name, 'Request JSON schema');
  assert.deepEqual(passed.request, { method: 'POST', url: `${base}/echo` });
  assert.deepEqual(parseWorkspace(JSON.stringify({ ...initialWorkspace(), saved: [] })).saved, []);
});

test('invalid custom schemas are rejected before HTTP and optional imported request bodies stay optional', async () => {
  const request = { ...newDraft(), url: base, schema: { enabled: true, manualResponse: '{"required":"id"}' } };
  const beforeCalls = calls;
  const invalid = await runRequest({ request, globals: [] });
  assert.equal(calls, beforeCalls); assert.equal(invalid.tests[0].phase, 'Configuration');
  request.schema.manualResponse = '';
  Object.assign(request.schema, { requestSchema: { type: 'object' }, requestRequired: false });
  const optional = await runRequest({ request, globals: [] });
  assert(optional.passed); assert.equal(calls, beforeCalls + 1);
});

test('OpenAPI response selection prioritizes exact status, status class and exact media types', () => {
  const definitions = [
    { status: 'default', mediaType: 'application/json', schema: true },
    { status: '2XX', mediaType: 'application/json', schema: true },
    { status: '201', mediaType: 'text/plain', schema: true },
  ];
  assert.equal(matchingResponseSchema(definitions, 200, 'Application/JSON; charset=utf-8')?.status, '2XX');
  assert.equal(matchingResponseSchema(definitions, 201, 'application/json'), undefined);
  assert.equal(matchingResponseSchema(definitions, 500, 'application/json')?.status, 'default');
  assert.equal(matchingResponseSchema(definitions, 200, 'application/json-bogus'), undefined);
  assert(matchingResponseSchema([{ status: '200', mediaType: 'application/*' }], 200, 'application/json'));
});

test('response schemas report every field issue and distinguish unspecified schemas from empty bodies', async () => {
  const request = { ...newDraft(), url: 'https://unreachable.invalid', mock: { enabled: true, status: 200, statusText: 'OK', headers: [], body: '{"id":"wrong","name":4}' }, schema: { enabled: true, manualResponse: '{"properties":{"id":{"type":"integer"},"name":{"type":"string"}}}' } };
  const failed = await runRequest({ request, globals: [] });
  assert.equal(failed.tests[0].issues?.length, 2); assert.equal(failed.tests[0].phase, 'Response');
  request.schema.manualResponse = '';
  Object.assign(request.schema, { responses: [{ status: '200', mediaType: 'application/json' }] });
  assert((await runRequest({ request, globals: [] })).passed);
  Object.assign(request.schema, { responses: [{ status: '200', mediaType: '' }] });
  assert.equal((await runRequest({ request, globals: [] })).passed, false);
});

test('type, length, existence and inclusive-bound assertions are precise and serializable', async () => {
  assert(compareAssertion(null, 'null', 'isType'));
  assert(!compareAssertion([], 'object', 'isType')); assert(compareAssertion([], 'array', 'isType'));
  assert(compareAssertion('😀a', 2, 'lengthEquals')); assert(compareAssertion({ a: 1 }, 1, 'lengthEquals'));
  assert(compareAssertion(undefined, '', 'notExists')); assert(!compareAssertion(null, '', 'notExists'));
  assert(compareAssertion(200, 200, 'lessThanOrEqual')); assert(compareAssertion(200, 200, 'greaterThanOrEqual'));
  assert.throws(() => compareAssertion('x', -1, 'lengthEquals'));
  assert.throws(() => compareAssertion('x', 'typo', 'isType'));
  assert.equal(checkValue(undefined), 'undefined'); assert(checkValue('x'.repeat(5000)).length < 2100);
  const workspace = initialWorkspace(), request = workspace.saved[0].request;
  request.mock = { enabled: true, status: 200, statusText: 'OK', headers: [], body: '{"id":"wrong","nothing":null}' };
  request.assertions = [
    { ...newAssertion(), source: 'json', path: '$.id', expected: '4', operator: 'equals' },
    { ...newAssertion(), source: 'json', path: '$.nothing', expected: 'null', operator: 'isType' },
    { ...newAssertion(), source: 'json', path: '$.missing', expected: '', operator: 'notExists' },
  ];
  const result = await runRequest({ request, globals: [], collection: workspace.collections[0] });
  assert.equal(result.tests[0].actual, '"wrong"'); assert.equal(result.tests[0].expected, '4');
  assert.equal(result.tests[1].passed, true); assert.equal(result.tests[2].passed, true);
  assert.deepEqual(parseWorkspace(JSON.stringify(workspace)), workspace);
  const report = await runCollection(workspace, workspace.collections[0].id, { iterations: 1, delayMs: 0, stopOnFailure: false, data: [], requestIds: [request.id] }, { execute: runRequest });
  assert.equal(report.results[0].tests[0].actual, '"wrong"');
});

test('CLI JSON and JUnit reports retain schema paths and expected/actual assertion details', async () => {
  const workspace = initialWorkspace(), request = workspace.saved[0].request;
  workspace.saved = [workspace.saved[0]];
  request.mock = { enabled: true, status: 200, statusText: 'OK', headers: [], body: '{"id":"wrong","name":4}' };
  request.schema = { enabled: true, manualRequest: '', manualResponse: '{"properties":{"id":{"type":"integer"},"name":{"type":"string"}}}' };
  request.assertions = [{ ...newAssertion(), source: 'json', path: '$.id', expected: '4' }];
  const directory = await mkdtemp(join(tmpdir(), 'reqora-validation-'));
  try {
    const file = join(directory, 'workspace.json'), json = join(directory, 'report.json'), junit = join(directory, 'junit.xml');
    await writeFile(file, JSON.stringify(workspace));
    await assert.rejects(promisify(execFile)(process.execPath, ['cli/reqora.mjs', 'run', file, '--report', json, '--junit', junit, '--quiet']), error => (error as { code: number }).code === 1);
    const report = JSON.parse(await readFile(json, 'utf8'));
    assert.equal(report.results[0].tests[0].issues.length, 2);
    assert.equal(report.results[0].tests[1].actual, '"wrong"');
    const xml = await readFile(junit, 'utf8');
    assert(xml.includes('$/id')); assert(xml.includes('$/name'));
    assert(xml.includes('Expected: 4')); assert(xml.includes('Actual: &quot;wrong&quot;'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
