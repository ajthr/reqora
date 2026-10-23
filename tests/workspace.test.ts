import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeRequestTab, getRequestCollection, getVariableScope, initialWorkspace, interpolate, newDraft, newEntry, parseWorkspace, prepareRequest, prepareWorkspaceRequest, requestFiles, toCurl, workspaceToCurl } from '../src/lib/workspace.ts';

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

test('structured URL encoded forms resolve values before encoding and preserve repeats and empty fields', () => {
  const draft = { ...newDraft(), method: 'POST', url: 'https://example.com', bodyType: 'form' as const,
    formFields: [newEntry('tag', '{{value}}'), newEntry('tag', 'second'), newEntry('empty', ''), { ...newEntry('skip', '{{missing}}'), enabled: false }, newEntry('', 'ignored')] };
  const prepared = prepareRequest(draft, [newEntry('value', 'global')], [newEntry('value', 'a&b=c + héllo')]);
  assert.equal(prepared.body, 'tag=a%26b%3Dc+%2B+h%C3%A9llo&tag=second&empty=');
  assert.equal(prepared.headers[0].value, 'application/x-www-form-urlencoded');
});

test('legacy raw forms migrate to editable rows and new file metadata survives workspace import/export', () => {
  const workspace = initialWorkspace();
  const legacy = { ...newDraft(), bodyType: 'form', body: 'tag=one&tag=two+words&empty=&key={{value}}' } as Record<string, unknown>;
  delete legacy.formFields; delete legacy.multipartFields;
  const migrated = parseWorkspace(JSON.stringify({ ...workspace, saved: [{ collectionId: workspace.collections[0].id, request: legacy }], history: [{ id: 'history', date: 'now', request: legacy }] }));
  assert.deepEqual(migrated.saved[0].request.formFields.map(row => [row.name, row.value]), [['tag', 'one'], ['tag', 'two words'], ['empty', ''], ['key', '{{value}}']]);
  assert.equal(migrated.history[0].request.formFields.length, 4);
  const file = { id: 'file', name: 'file.bin', type: 'application/octet-stream', size: 3 };
  migrated.saved[0].request = { ...newDraft(), bodyType: 'binary', binaryFile: file };
  assert.deepEqual(parseWorkspace(JSON.stringify(migrated)), migrated);
  for (const invalid of [{ ...file, size: -1 }, { ...file, size: 11 * 1024 * 1024 }, { ...file, name: '../secret' }, { ...file, type: 'text/plain\r\nInjected' }]) {
    assert.throws(() => parseWorkspace(JSON.stringify({ ...migrated, saved: [{ ...migrated.saved[0], request: { ...migrated.saved[0].request, binaryFile: invalid } }] })));
  }
});

test('multipart resolves text variables, omits disabled rows, and leaves file bytes untouched', () => {
  const file = { id: 'file', name: 'payload.txt', type: 'text/plain', size: 11 };
  const bytes = Buffer.from('{{literal}}').toString('base64');
  const draft = { ...newDraft(), method: 'POST', url: 'https://example.com', bodyType: 'multipart' as const, headers: [newEntry('Content-Type', 'application/json')], multipartFields: [
    { ...newEntry('{{key}}', '{{value}}'), kind: 'text' as const }, { ...newEntry('files'), kind: 'file' as const, file },
    { ...newEntry('ignored', '{{missing}}'), kind: 'text' as const, enabled: false },
  ] };
  const prepared = prepareRequest(draft, [newEntry('key', 'field'), newEntry('value', 'global')], [newEntry('value', 'collection')], new Map([[file.id, bytes]]));
  assert.deepEqual(prepared.body, { kind: 'multipart', parts: [{ name: 'field', value: 'collection' }, { name: 'files', file: { name: file.name, type: file.type, data: bytes } }] });
  assert.equal(prepared.headers.length, 0);
  assert.deepEqual(requestFiles(draft), [file]);
  assert.throws(() => prepareRequest(draft, [newEntry('key', 'field'), newEntry('value', 'v')]), /Reattach/);
  assert.equal(prepareRequest({ ...draft, method: 'GET' }, []).body, undefined);
});

test('binary and XML bodies use defaults, preserve overrides, and report missing attachments', () => {
  const file = { id: 'binary', name: 'payload.bin', type: '', size: 0 };
  const draft = { ...newDraft(), method: 'PATCH', url: 'https://example.com', bodyType: 'binary' as const, binaryFile: file };
  assert.deepEqual(prepareRequest(draft, [], [], new Map([[file.id, '']])).body, { kind: 'binary', file: { name: 'payload.bin', type: 'application/octet-stream', data: '' } });
  assert.throws(() => prepareRequest({ ...draft, binaryFile: undefined }, []), /Attach a file/);
  assert.equal(prepareRequest({ ...draft, bodyType: 'xml', body: '<value>{{value}}</value>' }, [newEntry('value', 'text')]).body, '<value>text</value>');
  assert.equal(prepareRequest({ ...draft, bodyType: 'xml', body: '<root/>' }, []).headers[0].value, 'application/xml');
  assert.equal(prepareRequest({ ...draft, headers: [newEntry('Content-Type', 'image/png')] }, [], [], new Map([[file.id, '']])).headers[0].value, 'image/png');
});

test('file cURL commands reference quoted local filenames and never embed stored bytes', () => {
  const workspace = initialWorkspace();
  const file = { id: 'file', name: "it's \"data\".bin", type: 'application/octet-stream', size: 10 };
  const draft = { ...newDraft(), method: 'POST', url: 'https://example.com', bodyType: 'multipart' as const,
    multipartFields: [{ ...newEntry('text', '@literal'), kind: 'text' as const }, { ...newEntry('files'), kind: 'file' as const, file }] };
  const curl = workspaceToCurl(workspace, draft);
  assert.match(curl, /--form-string/);
  assert.match(curl, /--form /);
  assert(curl.includes('\\"data\\"'));
  assert(!curl.includes('boundary='));
  assert(workspaceToCurl(workspace, { ...draft, bodyType: 'binary', binaryFile: file }).includes('--data-binary'));
});
