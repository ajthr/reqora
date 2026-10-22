import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialWorkspace, interpolate, newDraft, newEntry, parseWorkspace, prepareRequest, toCurl } from '../src/lib/workspace.ts';

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
