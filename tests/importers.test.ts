import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importWorkspace } from '../src/lib/importers.ts';

test('imports Postman collections with nested requests, variables, auth, and body', () => {
  const { workspace, format } = importWorkspace(JSON.stringify({ info: { name: 'API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, variable: [{ key: 'base', value: 'https://example.test' }], item: [{ name: 'Users', item: [{ name: 'Create', request: { method: 'POST', url: { raw: '{{base}}/users', query: [{ key: 'a', value: 'b' }] }, header: [{ key: 'Content-Type', value: 'application/json' }], auth: { type: 'bearer', bearer: [{ key: 'token', value: 'secret' }] }, body: { mode: 'raw', raw: '{"ok":true}', options: { raw: { language: 'json' } } } } }] }] }));
  assert.equal(format, 'Postman'); assert.equal(workspace.saved[0].request.name, 'Users / Create'); assert.equal(workspace.saved[0].request.bodyType, 'json'); assert.equal(workspace.saved[0].request.token, 'secret'); assert.equal(workspace.collections[0].variables[0].name, 'base');
});
test('imports Insomnia requests and environments', () => {
  const { workspace } = importWorkspace(JSON.stringify({ __export_format: 4, resources: [{ _type: 'workspace', _id: 'w', name: 'Service' }, { _type: 'request_group', _id: 'g', parentId: 'w', name: 'Users' }, { _type: 'request', parentId: 'g', name: 'List', method: 'GET', url: 'https://example.test/users', headers: [] }, { _type: 'environment', parentId: 'w', data: { base: 'https://example.test' } }] }));
  assert.equal(workspace.saved[0].request.name, 'Users / List'); assert.equal(workspace.variables[0].name, 'base');
});
test('imports OpenAPI operations and cURL commands', () => {
  const api = importWorkspace(JSON.stringify({ openapi: '3.0.3', info: { title: 'Pet API' }, servers: [{ url: 'https://example.test' }], paths: { '/pets': { get: { summary: 'List pets' } } } }));
  assert.equal(api.workspace.saved[0].request.url, 'https://example.test/pets');
  const command = importWorkspace("curl -X POST -H 'Content-Type: application/json' --data-raw '{\"a\":1}' https://example.test/items");
  assert.equal(command.workspace.saved[0].request.bodyType, 'json'); assert.equal(command.workspace.saved[0].request.method, 'POST');
  assert.throws(() => importWorkspace('curl --form a=b https://example.test'), /Unsupported cURL option/);
});
test('imports a Postman environment while retaining existing collections', () => {
  const initial = importWorkspace('curl https://example.test').workspace;
  const imported = importWorkspace(JSON.stringify({ name: 'Development', values: [{ key: 'host', value: 'https://dev.example.test', enabled: true }] }), initial);
  assert.equal(imported.format, 'Postman environment'); assert.equal(imported.workspace.saved.length, 1); assert.equal(imported.workspace.environments?.[0].variables[0].name, 'host');
});
