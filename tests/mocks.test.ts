import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultMock, isMockSettings, mockFromExample, mockResponseError } from '../shared/mocks.ts';
import { initialWorkspace, newDraft, newEntry, parseWorkspace } from '../shared/workspace.ts';
import { newExtraction } from '../shared/automation.ts';
import { runRequest } from '../server/pipeline.ts';
import { runCollection } from '../shared/runner.ts';

function request() { return { ...newDraft(), url: 'https://unreachable.invalid', mock: { ...defaultMock(), enabled: true } }; }

test('named mock scenarios select a response, resolve scoped values, and keep the default independently', async () => {
  const draft = request();
  draft.mock.scenarios = [{ id: 'success', name: 'Created', status: 201, statusText: 'Created', headers: [{ name: 'X-ID', value: '{{id}}' }], body: '{"id":{{id}}}', delayMs: 20 }];
  draft.mock.activeScenarioId = 'success';
  draft.postResponseScript = 'rq.test("scenario", () => rq.expect(rq.response.status).toBe(201));';
  const result = await runRequest({ request: draft, globals: [newEntry('id', '42')] });
  assert(result.passed); assert(result.mocked); assert.equal(result.mockScenario, 'Created');
  assert.equal(result.response?.body, '{"id":42}');
  assert.equal(result.response?.headers.find(header => header.name === 'X-ID')?.value, '42');
  assert(result.response!.durationMs >= 10);
  assert.equal(draft.mock.body, '{}');
  draft.mock.activeScenarioId = undefined; draft.postResponseScript = '';
  assert.equal((await runRequest({ request: draft, globals: [] })).response?.status, 200);
});

test('mock delays can be cancelled or timed out and simulated failures skip response scripts', async () => {
  const draft = request(); draft.mock.delayMs = 500;
  draft.postResponseScript = 'rq.globals.set("should_not_run", "yes");';
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10);
  try {
    const cancelled = await runRequest({ request: draft, globals: [] }, abort.signal);
    assert.equal(cancelled.error, 'Request cancelled.'); assert.equal(cancelled.response, undefined);
    assert.equal(cancelled.changes.length, 0);
  } finally { clearTimeout(timer); }
  draft.timeoutMs = 100; draft.mock.delayMs = 250;
  const timeout = await runRequest({ request: draft, globals: [] });
  assert.match(timeout.error || '', /timed out/); assert.equal(timeout.response, undefined);
  draft.mock.delayMs = 0;
  for (const failure of ['network', 'timeout'] as const) {
    draft.mock.failure = failure;
    const failed = await runRequest({ request: draft, globals: [] });
    assert.match(failed.error || '', /Simulated mock/); assert(failed.mocked);
    assert.equal(failed.response, undefined); assert.equal(failed.changes.length, 0);
  }
});

test('binary mocks preserve exact bytes and HTTP no-body responses suppress configured content', async () => {
  const draft = request();
  const bytes = Buffer.from([0, 255, 128, 13, 10]);
  draft.mock.encoding = 'base64'; draft.mock.body = bytes.toString('base64'); draft.mock.headers = [];
  const binary = await runRequest({ request: draft, globals: [] });
  assert.equal(binary.response?.encoding, 'base64'); assert.equal(binary.response?.size, bytes.length);
  assert.deepEqual(Buffer.from(binary.response!.body, 'base64'), bytes);
  assert.equal(binary.response?.headers[0].value, 'application/octet-stream');
  for (const status of [100, 204, 205, 304]) {
    draft.mock.status = status;
    const result = await runRequest({ request: draft, globals: [] });
    assert.equal(result.response?.body, ''); assert.equal(result.response?.size, 0);
  }
  draft.mock.status = 200; draft.method = 'HEAD';
  assert.equal((await runRequest({ request: draft, globals: [] })).response?.body, '');
});

test('saved examples become independent mocks without stale transport headers or truncated bytes', () => {
  const example = { id: 'example', name: 'Binary', status: 200, statusText: 'OK', body: 'AP8=', encoding: 'base64' as const, headers: [{ name: 'Content-Type', value: 'application/octet-stream' }, { name: 'Content-Encoding', value: 'gzip' }, { name: 'Content-Length', value: '500' }] };
  const mock = mockFromExample(example);
  assert.equal(mock.headers.length, 1); assert.equal(mock.encoding, 'base64');
  mock.headers[0].value = 'changed'; assert.equal(example.headers[0].value, 'application/octet-stream');
  assert.throws(() => mockFromExample({ ...example, truncated: true }), /truncated/);
  assert.throws(() => mockFromExample({ ...example, body: 'x'.repeat(100001) }), /100,000/);
});

test('mock configurations round-trip and invalid active selections or header interpolation are rejected', async () => {
  const workspace = initialWorkspace(), draft = workspace.saved[0].request;
  draft.mock = { ...defaultMock(), enabled: true, headers: [{ name: '', value: '' }] };
  assert.deepEqual(parseWorkspace(JSON.stringify(workspace)), workspace); // Keep incomplete legacy rows editable.
  assert.match((await runRequest({ request: draft, globals: [] })).error || '', /HTTP headers/);
  draft.mock.headers = [{ name: 'X-Test', value: '{{bad}}' }];
  assert.match((await runRequest({ request: draft, globals: [newEntry('bad', 'a\nb')] })).error || '', /line breaks/);
  assert.equal(isMockSettings({ ...defaultMock(), activeScenarioId: 'missing' }), false);
  assert.equal(isMockSettings({ ...defaultMock(), scenarios: [{ id: 'x', name: 'One', ...defaultMock() }, { id: 'x', name: 'Two', ...defaultMock() }] }), false);
  assert.match(mockResponseError({ ...defaultMock(), encoding: 'base64', body: 'not-base64' }), /base64/);
  assert.equal(isMockSettings(defaultMock()), true);
});

test('data-driven mock scenarios chain extracted values and retain mock metadata in runs', async () => {
  const workspace = initialWorkspace(), collection = workspace.collections[0];
  const first = request(), second = request();
  first.mock.scenarios = [{ id: 'login', name: 'Login', status: 200, statusText: 'OK', headers: [], body: '{"token":"token-{{id}}"}' }];
  first.mock.activeScenarioId = 'login';
  first.extractions = [{ ...newExtraction(), variable: 'token', path: '$.token' }];
  second.mock.body = '{"used":"{{token}}"}';
  second.postResponseScript = 'rq.test("chained", () => rq.expect(rq.response.json().used).toBe("token-" + rq.data.get("id")));';
  workspace.saved = [{ collectionId: collection.id, request: first }, { collectionId: collection.id, request: second }];
  const report = await runCollection(workspace, collection.id, { iterations: 1, delayMs: 0, stopOnFailure: false, data: [{ id: 1 }, { id: 2 }] }, { execute: runRequest });
  assert.equal(report.failed, 0); assert.equal(report.completed, 4);
  assert.equal(report.results[0].mocked, true); assert.equal(report.results[0].mockScenario, 'Login');
  assert.deepEqual(parseWorkspace(JSON.stringify(workspace)), workspace);
});

test('CLI uses exported active mock scenarios and reports simulation metadata', async () => {
  const workspace = initialWorkspace(), draft = workspace.saved[0].request;
  draft.mock = { ...defaultMock(), enabled: true, activeScenarioId: 'error', scenarios: [{ id: 'error', name: 'Not found', status: 404, statusText: 'Not Found', headers: [], body: '{}' }] };
  workspace.saved = [workspace.saved[0]];
  const directory = await mkdtemp(join(tmpdir(), 'reqora-mock-'));
  try {
    const file = join(directory, 'workspace.json'), report = join(directory, 'report.json');
    await writeFile(file, JSON.stringify(workspace));
    const output = await promisify(execFile)(process.execPath, ['cli/reqora.mjs', 'run', file, '--report', report]);
    assert.match(output.stdout, /mock: Not found/);
    const result = JSON.parse(await readFile(report, 'utf8'));
    assert.equal(result.results[0].status, 404); assert.equal(result.results[0].mockScenario, 'Not found');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
