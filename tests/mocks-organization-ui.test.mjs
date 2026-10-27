import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { initialWorkspace } from '../shared/workspace.ts';
import { defaultMock } from '../shared/mocks.ts';

let vite, MockEditor, FolderTree;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  [MockEditor, FolderTree] = await Promise.all([vite.ssrLoadModule('/src/components/MockEditor.tsx'), vite.ssrLoadModule('/src/components/FolderTree.tsx')]).then(modules => modules.map(module => module.default));
});
after(async () => { await vite?.close(); });

test('mock editor exposes selected scenarios, delay/failure controls, examples and binary body settings', () => {
  const mock = { ...defaultMock(), enabled: true, activeScenarioId: 'offline', scenarios: [{ id: 'offline', name: 'Offline scenario', status: 503, statusText: 'Unavailable', headers: [], body: '{}', delayMs: 250, failure: 'network' }] };
  const html = renderToStaticMarkup(createElement(MockEditor, { draft: { mock }, examples: [{ id: 'example', name: 'Saved success', status: 200 }], onChange() {} }));
  assert(html.includes('Active mock scenario')); assert(html.includes('Offline scenario'));
  assert(html.includes('Delay (ms)')); assert(html.includes('Network failure'));
  assert(html.includes('Saved success')); assert(html.includes('Binary (base64)'));
  assert(html.includes('fieldset class="mock-response-fields" disabled'));
  assert(html.includes('value="250"')); assert(html.includes('value="503"'));
  assert(html.includes('not hosted mock endpoints'));
});

test('folder sidebar renders nested accessible branches and request actions without interpreting labels as HTML', () => {
  const workspace = initialWorkspace(), collection = workspace.collections[0];
  collection.folders = [{ id: 'root', name: 'Users' }, { id: 'child', name: '<script>Details</script>', parentId: 'root' }];
  workspace.saved[0].folderId = 'child';
  const props = { collection, requests: workspace.saved, search: '', collapsed: [], onToggle() {}, row: item => createElement('span', { key: item.request.id }, item.request.name), actions: () => [], onDropRequest() {}, onReorder() {} };
  const html = renderToStaticMarkup(createElement(FolderTree, props));
  assert(html.includes('Users / &lt;script&gt;Details&lt;/script&gt;'));
  assert(html.includes('aria-expanded="true"')); assert(html.includes('Get a post'));
  assert(!html.includes('<script>'));
  const collapsed = renderToStaticMarkup(createElement(FolderTree, { ...props, collapsed: ['root'] }));
  assert(!collapsed.includes('Get a post')); assert(collapsed.includes('aria-expanded="false"'));
  const searched = renderToStaticMarkup(createElement(FolderTree, { ...props, collapsed: ['root'], search: 'Details' }));
  assert(searched.includes('Get a post'));
});
