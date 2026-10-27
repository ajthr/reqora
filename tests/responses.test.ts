import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareResponses, responseMatches, responsePreview, sandboxedHtml } from '../src/lib/responses.ts';
import { pathKeys, readPath } from '../shared/automation.ts';
import type { HttpResponse } from '../shared/types.ts';
import type { ResponseExample } from '../shared/workspace.ts';

const response = (body: string): HttpResponse => ({ url: 'https://example.test', status: 200, statusText: 'OK', body, encoding: 'utf8', headers: [{ name: 'Content-Type', value: 'application/json' }], durationMs: 10, size: body.length });
const example = (body: string): ResponseExample => ({ ...response(body), id: 'example', name: 'Baseline' });

test('response searches count only the visible preview and escape literal search characters', () => {
  const preview = responsePreview('x'.repeat(100_000) + 'hidden-match');
  assert.equal(preview.truncated, true);
  assert.equal(responseMatches(preview.text, 'hidden-match').matches.length, 0);
  const lines = responsePreview('line\n'.repeat(2000) + 'hidden-match');
  assert.equal(lines.lines.length, 2000); assert(lines.truncated);
  assert.equal(responseMatches(lines.text, 'hidden-match').matches.length, 0);
  assert.deepEqual(responseMatches('a.b A.B [x] a*b', 'a.b').matches, [{ start: 0, end: 3 }, { start: 4, end: 7 }]);
  assert.equal(responseMatches('[x] [x]', '[x]').matches.length, 2);
  assert.equal(responseMatches('é É', 'é').matches.length, 2);
  assert.equal(responseMatches('anything', '').matches.length, 0);
  assert.equal(responseMatches('a'.repeat(5001), 'a').limited, true);
  assert.equal(responseMatches('a'.repeat(5001), 'a').matches.length, 5000);
  assert.equal(responsePreview('small\nresponse').truncated, false);
});

test('JSON tree paths round-trip special characters, array indices, nulls and scalars', () => {
  const value = JSON.parse('{"a/b":{"~key":[null,{"id":4}]},"__proto__":"literal"}');
  const path = '/a~1b/~0key/1/id';
  assert.equal(readPath(value, path), 4);
  assert.deepEqual(pathKeys(path), ['a/b', '~key', '1', 'id']);
  assert.deepEqual(pathKeys('$.users[0].id'), ['users', '0', 'id']);
  assert.equal(readPath(value, '/a~1b/~0key/0'), null);
  assert.equal(readPath(value, '/__proto__'), 'literal');
  assert.equal(readPath({}, '/constructor'), undefined);
  assert.equal(readPath(false, '$'), false);
  assert.throws(() => pathKeys('$..id'));
  assert.throws(() => pathKeys('/bad~2escape'));
});

test('response comparison ignores JSON formatting and header-name casing while preserving repeated values', () => {
  const before = example('{"a":1,"b":[2,3]}'), after = response('{ "b": [2, 3], "a": 1 }');
  after.headers = [{ name: 'content-type', value: 'application/json' }];
  assert.deepEqual(compareResponses(after, before).differences, []);
  before.headers.push({ name: 'Set-Cookie', value: 'one=1' }, { name: 'Set-Cookie', value: 'two=2' });
  after.headers.push({ name: 'set-cookie', value: 'one=1' }, { name: 'set-cookie', value: 'two=3' });
  assert.deepEqual(compareResponses(after, before).differences, [{ path: 'Headers/set-cookie/1', before: '"two=2"', after: '"two=3"' }]);
});

test('comparison reports added, removed, changed, status and binary values with bounded output', () => {
  const before = example('{"a/b":1,"gone":null}'), after = response('{"a/b":"1","new":false}');
  after.status = 201; after.statusText = 'Created';
  const result = compareResponses(after, before);
  assert(result.differences.some(item => item.path === 'Status'));
  assert(result.differences.some(item => item.path === 'Body/a~1b' && item.before === '1' && item.after === '"1"'));
  assert(result.differences.some(item => item.path === 'Body/gone' && item.after === 'undefined'));
  assert(result.differences.some(item => item.path === 'Body/new' && item.before === 'undefined'));
  const binary = compareResponses({ ...response('AP8='), encoding: 'base64' }, { ...example('AAA='), encoding: 'base64' });
  assert.equal(binary.differences[0].path, 'Body');
  const large = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`key${i}`, i]));
  const capped = compareResponses(response(JSON.stringify(large)), example('{}'));
  assert.equal(capped.differences.length, 100); assert(capped.limited);
  const text = compareResponses(response('y'.repeat(5000)), example('x'.repeat(5000)));
  assert(text.differences[0].after.length < 2100);
  const deep = '{"a":'.repeat(15000) + '0' + '}'.repeat(15000);
  assert(compareResponses(response(deep), example('null')).differences[0].after.includes('deeply nested'));
});

test('truncated examples never claim a full body comparison and deep data is bounded', () => {
  const comparison = compareResponses(response('different'), { ...example('partial'), truncated: true });
  assert(comparison.bodySkipped); assert.deepEqual(comparison.differences, []);
  let left: unknown = 'before', right: unknown = 'after';
  for (let i = 0; i < 45; i++) { left = { item: left }; right = { item: right }; }
  assert(compareResponses(response(JSON.stringify(right)), example(JSON.stringify(left))).limited);
});

test('HTML preview starts with a restrictive policy that prevents external requests and active content', () => {
  const html = sandboxedHtml('<script>alert(1)</script><img src="https://example.test/track">');
  assert(html.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"'));
  assert(html.includes("default-src 'none'")); assert(html.includes("form-action 'none'"));
  assert(html.includes('img-src data:')); assert(html.includes("base-uri 'none'"));
});
