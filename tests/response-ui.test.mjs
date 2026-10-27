import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite, Inspector, CodeView, SchemaEditor, Results;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  [Inspector, CodeView, SchemaEditor, Results] = await Promise.all([
    vite.ssrLoadModule('/src/components/ResponseInspector.tsx'),
    vite.ssrLoadModule('/src/components/CodeView.tsx'),
    vite.ssrLoadModule('/src/components/SchemaEditor.tsx'),
    vite.ssrLoadModule('/src/components/AutomationResults.tsx'),
  ]).then(modules => modules.map(module => module.default));
});
after(async () => { await vite?.close(); });
const response = body => ({ status: 200, statusText: 'OK', url: 'https://example.test', headers: [{ name: 'Content-Type', value: 'application/json' }], body, encoding: 'utf8', durationMs: 1, size: body.length });
const inspector = (body, extra) => renderToStaticMarkup(createElement(Inspector, { response: response(body), view: 'Tree', pretty: true, search: '', requestMethod: 'GET', requestUrl: 'https://example.test', onCopy() {}, onDownload() {}, ...extra }));

test('JSON tree renders scalar fields as escaped text with accessible path/value controls', () => {
  const html = inspector('{"unsafe":"<script>alert(1)</script>","empty":null,"items":[1]}');
  assert(html.includes('JSON path or pointer'));
  assert(html.includes('&lt;script&gt;'));
  assert(!html.includes('<script>'));
  assert(html.includes('Copy path /unsafe'));
  assert(html.includes('Copy value /empty'));
  assert(html.includes('Expand /items'));
  assert(inspector('false').includes('false'));
});

test('search navigation renders bounded match counts and the active occurrence', () => {
  const html = renderToStaticMarkup(createElement(CodeView, { text: 'needle Needle\n' + 'x'.repeat(100000) + 'needle', highlight: false, search: 'needle' }));
  assert(html.includes('1 of 2'));
  assert(html.includes('Previous response match'));
  assert(html.includes('Next response match'));
  assert.equal((html.match(/<mark/g) || []).length, 2);
  assert(html.includes('active-match'));
  assert(html.includes('Search covers this preview'));
});

test('comparison exposes incomplete baselines and never claims the entire body was compared', () => {
  const html = inspector('{"id":2}', { view: 'Compare', examples: [{ ...response('{"id":1}'), id: 'baseline', name: 'Saved example', truncated: true }] });
  assert(html.includes('Only status and headers are compared'));
  assert(html.includes('No differences in the compared fields'));
  assert(html.includes('Copy comparison'));
});

test('request schema editing and field-level failures render without hiding expected/actual values', () => {
  const html = renderToStaticMarkup(createElement(SchemaEditor, { draft: { schema: { enabled: true, manualResponse: '', manualRequest: '{"required":"id"}', requestSchema: false } }, onChange() {} }));
  assert(html.includes('Custom request JSON schema'));
  assert(html.includes('required must be an array'));
  assert(html.includes('An imported OpenAPI request schema'));
  const results = renderToStaticMarkup(createElement(Results, { tests: [{ name: 'Body', kind: 'schema', phase: 'Response', passed: false, actual: '"wrong"', expected: '4', issues: [{ path: '$/id', message: 'Expected integer.' }, { path: '$/name', message: 'Expected string.' }] }] }));
  assert(results.includes('Expected')); assert(results.includes('Actual'));
  assert(results.includes('$/id')); assert(results.includes('$/name'));
});
