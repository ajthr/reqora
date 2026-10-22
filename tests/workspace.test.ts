import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeRequestTab, getRequestCollection, getVariableScope, initialWorkspace, interpolate, newDraft, newEntry, parseWorkspace, prepareRequest, prepareWorkspaceRequest, toCurl } from '../src/lib/workspace.ts';

test('collection values override globals while disabled values fall back and empty strings still override', () => {
  const globals = [newEntry('base_url', 'https://global.example'), newEntry('token', 'global-token'), newEntry('empty', 'global')];
  const local = [newEntry(' base_url ', 'https://collection.example'), { ...newEntry('token', 'disabled'), enabled: false }, newEntry('empty', '')];
  const scope = getVariableScope(globals, local);
  assert.equal(interpolate('{{base_url}}', scope), 'https://collection.example');
  assert.equal(interpolate('{{token}}', scope), 'global-token');
  assert.equal(interpolate('{{empty}}', scope), '');
  assert.equal(scope.find(entry => entry.name === 'base_url')?.scope, 'collection');
  assert.equal(scope.find(entry => entry.name === 'token')?.scope, 'global');
  assert.throws(() => interpolate('{{BASE_URL}}', scope), /not defined/);
  assert.equal(interpolate('{{key}}', getVariableScope([newEntry('key', 'first'), newEntry('key', 'last')])), 'last');
});

test('nested variables use effective collection values and reject cycles and unresolved references', () => {
  const scope = getVariableScope([newEntry('host', 'global.example'), newEntry('base_url', 'https://{{host}}/v1')], [newEntry('host', 'collection.example')]);
  assert.equal(interpolate('{{base_url}}/users', scope), 'https://collection.example/v1/users');
  assert.throws(() => interpolate('{{a}}', [newEntry('a', '{{b}}'), newEntry('b', '{{a}}')]), /Circular variable reference/);
  assert.throws(() => interpolate('{{a}}', [newEntry('a', '{{missing}}')]), /missing.*not defined/);
  assert.throws(() => interpolate('{{a}}', [newEntry('a', 'x'.repeat(1024 * 1024 + 1))]), /1 MB limit/);
});

test('the same collection hierarchy applies to URLs, parameters, headers, auth, bodies, and cURL', () => {
  const request = { ...newDraft(), method: 'POST', url: '{{base_url}}/items', params: [newEntry('scope', '{{scope}}')], headers: [newEntry('X-Scope', '{{scope}}')], authType: 'bearer' as const, token: '{{token}}', bodyType: 'json' as const, body: '{"scope":"{{scope}}"}' };
  const globals = [newEntry('base_url', 'https://global.example'), newEntry('scope', 'global'), newEntry('token', 'global-token')];
  const local = [newEntry('base_url', 'https://collection.example'), newEntry('scope', 'collection'), newEntry('token', 'collection-token')];
  const prepared = prepareRequest(request, globals, local);
  assert.equal(prepared.url, 'https://collection.example/items?scope=collection');
  assert.equal(prepared.body, '{"scope":"collection"}');
  assert(prepared.headers.some(header => header.name === 'X-Scope' && header.value === 'collection'));
  assert(prepared.headers.some(header => header.name === 'Authorization' && header.value === 'Bearer collection-token'));
  assert(toCurl(prepared).includes('Bearer collection-token'));
  assert(!toCurl(prepared).includes('global-token'));
});

test('unsaved requests and history snapshots retain scope; moving a saved request uses its destination scope', () => {
  const workspace = initialWorkspace();
  const first = workspace.collections[0];
  first.variables = [newEntry('base_url', 'https://first.example')];
  workspace.collections.push({ id: 'second', name: 'Second', description: '', variables: [newEntry('base_url', 'https://second.example')] });
  const unsaved = { ...newDraft(first.id), url: '{{base_url}}/items' };
  assert.equal(prepareWorkspaceRequest(workspace, unsaved).url, 'https://first.example/items');
  const snapshot = { ...unsaved, id: crypto.randomUUID() };
  assert.equal(getRequestCollection(workspace, snapshot)?.id, first.id);
  const saved = workspace.saved[0];
  saved.request.collectionId = first.id;
  saved.collectionId = 'second';
  assert.equal(prepareWorkspaceRequest(workspace, saved.request).url, 'https://second.example/posts/1');
  assert.equal(prepareWorkspaceRequest(workspace, { ...unsaved, id: 'scratch', collectionId: undefined }).url, 'https://jsonplaceholder.typicode.com/items');
});

test('legacy workspace imports migrate collections and scoped data survives export/import', () => {
  const workspace = initialWorkspace();
  const legacy = { ...workspace, collections: workspace.collections.map(({ id, name }) => ({ id, name })) };
  const migrated = parseWorkspace(JSON.stringify(legacy));
  assert.equal(migrated.collections[0].description, '');
  assert.equal(migrated.collections[0].variables.length, 0);
  assert.deepEqual(migrated.variables, workspace.variables);
  migrated.collections[0].variables.push(newEntry('base_url', 'https://scoped.example'));
  migrated.collections[0].description = 'API documentation';
  assert.deepEqual(parseWorkspace(JSON.stringify(migrated)), migrated);
  assert.throws(() => parseWorkspace(JSON.stringify({ ...workspace, collections: [{ ...workspace.collections[0], variables: null }] })));
  assert.throws(() => parseWorkspace(JSON.stringify({ ...workspace, collections: [{ ...workspace.collections[0], description: 42 }] })));
  assert.throws(() => parseWorkspace(JSON.stringify({ ...workspace, collections: [{ ...workspace.collections[0], variables: [{ name: 'invalid' }] }] })));
});

test('closing the final request leaves an empty workspace for the startup page', () => {
  const draft = newDraft();
  assert.deepEqual(closeRequestTab([draft], draft.id, draft.id), { tabs: [], activeId: '' });
});

test('closing a tab preserves inactive selection and selects a neighbor for the active tab', () => {
  const tabs = [newDraft(), newDraft(), newDraft()];
  assert.equal(closeRequestTab(tabs, tabs[0].id, tabs[1].id).activeId, tabs[0].id);
  assert.equal(closeRequestTab(tabs, tabs[1].id, tabs[1].id).activeId, tabs[2].id);
  assert.equal(closeRequestTab(tabs, tabs[2].id, tabs[2].id).activeId, tabs[1].id);
});

test('resolves variables and preserves existing and repeated query parameters', () => {
  const draft = { ...newDraft(), url: '{{base_url}}/posts?tag=one', params: [newEntry('tag', 'two words'), { ...newEntry('skip', 'value'), enabled: false }] };
  const result = prepareRequest(draft, [newEntry('base_url', 'https://example.com')]);
  assert.equal(result.url, 'https://example.com/posts?tag=one&tag=two+words');
  assert.equal(result.body, undefined);
  assert.throws(() => interpolate('{{missing}}', []), /not defined/);
});
test('JSON bodies are validated after interpolation and explicit content types are retained', () => {
  const draft = { ...newDraft(), method: 'POST', url: 'https://example.com', bodyType: 'json' as const, body: '{"name":"{{name}}"}' };
  const result = prepareRequest(draft, [newEntry('name', 'Reqora')]);
  assert.equal(result.body, '{"name":"Reqora"}');
  assert.deepEqual(result.headers, [{ name: 'Content-Type', value: 'application/json' }]);
  assert.equal(prepareRequest({ ...draft, headers: [newEntry('content-type', 'application/problem+json')] }, [newEntry('name', 'Reqora')]).headers[0].value, 'application/problem+json');
  assert.throws(() => prepareRequest({ ...draft, body: '{bad}' }, []), /not valid JSON/);
});
test('auth uses Unicode-safe Basic encoding and overrides an explicit auth header', () => {
  const result = prepareRequest({ ...newDraft(), url: 'https://example.com', authType: 'basic', username: 'josé', password: 'secret', headers: [newEntry('authorization', 'old'), newEntry('Authorization', 'duplicate')] }, []);
  assert.equal(result.headers.length, 1);
  assert.equal(result.headers[0].value, 'Basic ' + Buffer.from('josé:secret').toString('base64'));
});
test('ignores disabled headers and bodies for GET/HEAD', () => {
  const result = prepareRequest({ ...newDraft(), url: 'https://example.com', bodyType: 'json', body: 'bad JSON', headers: [{ ...newEntry('x-hidden', 'value'), enabled: false }] }, []);
  assert.deepEqual(result.headers, []);
  assert.equal(result.body, undefined);
});
test('workspace export round-trips and malformed data is rejected', () => {
  const workspace = initialWorkspace();
  assert.deepEqual(parseWorkspace(JSON.stringify(workspace)), workspace);
  assert.throws(() => parseWorkspace('{"version":1}'));
  assert.throws(() => parseWorkspace(JSON.stringify({ ...workspace, saved: [{ collectionId: 'unknown', request: newDraft() }] })));
  assert.throws(() => parseWorkspace(JSON.stringify({ ...workspace, variables: [{ name: 'bad' }] })));
});
test('cURL export quotes shell content without interpolating it', () => {
  const result = toCurl({ url: 'https://example.com', method: 'POST', headers: [], body: "it's $(private)", timeoutMs: 1500, followRedirects: false });
  assert(result.includes("--data-raw 'it'\\''s $(private)'"));
  assert(result.includes('--max-time 1.5'));
  assert(!result.includes('--location'));
});
