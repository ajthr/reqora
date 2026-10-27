import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateJsonSchema } from '../shared/schema.ts';
import { initialWorkspace, newDraft, parseWorkspace } from '../shared/workspace.ts';
import { runRequest } from '../server/pipeline.ts';
import { runCollection } from '../shared/runner.ts';
import { importWorkspace } from '../src/lib/importers.ts';

test('schema validator reports paths, references, composition, and unsupported keywords', () => {
  const schema = { type: 'object', required: ['id'], properties: { id: { $ref: '#/components/schemas/Id' }, tags: { type: 'array', items: { type: 'string' } } }, additionalProperties: false };
  const definitions = { Id: { type: 'integer', minimum: 1 } };
  assert.deepEqual(validateJsonSchema({ id: 2, tags: ['a'] }, schema, definitions), []);
  assert.match(validateJsonSchema({ id: 'bad' }, schema, definitions)[0].message, /integer/);
  assert.equal(validateJsonSchema({}, schema, definitions)[0].path, '$/id');
  assert.match(validateJsonSchema('x', { pattern: 'x' })[0].message, /Unsupported/);
  assert.deepEqual(validateJsonSchema('x', { anyOf: [{ type: 'number' }, { type: 'string' }] }), []);
});
test('mock response runs checks and collection runner without network access', async () => {
  const workspace = initialWorkspace(), collection = workspace.collections[0];
  const request = { ...newDraft(collection.id), url: 'https://unreachable.invalid/mock', mock: { enabled: true, status: 200, statusText: 'OK', headers: [{ name: 'Content-Type', value: 'application/json' }], body: '{"id":42}' }, schema: { enabled: true, manualResponse: '{"type":"object","required":["id"],"properties":{"id":{"type":"integer"}}}' } };
  workspace.saved = [{ collectionId: collection.id, request }];
  const result = await runRequest({ request, globals: [], collection });
  assert.equal(result.response?.body, '{"id":42}'); assert.equal(result.passed, true); assert.equal(result.tests[0].kind, 'schema');
  request.schema.manualResponse = '';
  const missing = await runRequest({ request, globals: [], collection });
  assert.equal(missing.passed, false); assert.match(missing.tests[0].error || '', /Add a custom/);
  request.schema.manualResponse = '{"type":"object","required":["id"],"properties":{"id":{"type":"integer"}}}';
  request.mock.body = '{"id":"wrong"}';
  const failed = await runRequest({ request, globals: [], collection });
  assert.equal(failed.passed, false); assert.match(failed.tests[0].error || '', /integer/);
  const report = await runCollection(workspace, collection.id, { iterations: 1, delayMs: 0, stopOnFailure: false, data: [] }, { execute: runRequest });
  assert.equal(report.failed, 1);
  assert.deepEqual(parseWorkspace(JSON.stringify(workspace)), workspace);
});
test('OpenAPI importer attaches request and response schemas to operations', async () => {
  const api = { openapi: '3.0.3', info: { title: 'Widgets' }, servers: [{ url: 'https://unreachable.invalid' }], components: { schemas: { Widget: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } } }, paths: { '/widgets': { post: { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } } }, responses: { '201': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Widget' } } } } } } } } };
  const workspace = importWorkspace(JSON.stringify(api)).workspace, collection = workspace.collections[0], request = workspace.saved[0].request;
  assert.equal(request.schema?.responses?.[0].status, '201');
  request.bodyType = 'json'; request.body = '{}';
  const failed = await runRequest({ request, globals: [], collection });
  assert.equal(failed.response, undefined); assert.match(failed.error || '', /OpenAPI schema/);
  assert.match(failed.tests[0].error || '', /name/);
  request.mock = { enabled: true, status: 201, statusText: 'Created', headers: [{ name: 'Content-Type', value: 'application/json' }], body: '{"id":1}' };
  const mocked = await runRequest({ request, globals: [], collection });
  assert.equal(mocked.passed, true); assert.equal(mocked.tests[0].kind, 'schema');
});
