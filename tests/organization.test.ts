import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialWorkspace, parseWorkspace } from '../shared/workspace.ts';
import { moveCollectionBefore, moveFolderBefore, moveSaved, orderedSaved, shiftCollection, shiftFolder, shiftSaved } from '../shared/organization.ts';
import { runCollection } from '../shared/runner.ts';

test('folders and examples survive workspace export and legacy files stay valid', () => {
  const workspace = initialWorkspace(), collection = workspace.collections[0];
  collection.folders = [{ id: 'folder', name: 'Users' }];
  workspace.saved[0].folderId = 'folder';
  workspace.saved[0].examples = [{ id: 'example', name: 'Success', status: 200, statusText: 'OK', headers: [{ name: 'Content-Type', value: 'application/json' }], body: '{"ok":true}', encoding: 'utf8' }];
  assert.deepEqual(parseWorkspace(JSON.stringify(workspace)), workspace);
  assert.throws(() => parseWorkspace(JSON.stringify({ ...workspace, saved: [{ ...workspace.saved[0], folderId: 'missing' }] })));
  const legacy = initialWorkspace(); assert.deepEqual(parseWorkspace(JSON.stringify(legacy)), legacy);
});
test('moving and reordering requests produces the same order used by collection runs', async () => {
  let workspace = initialWorkspace(), collection = workspace.collections[0];
  collection.folders = [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }];
  const [first, second] = workspace.saved.map(item => item.request.id);
  workspace = moveSaved(workspace, first, 'one');
  workspace = moveSaved(workspace, second, 'one', first);
  assert.equal(moveSaved(workspace, second, 'one', second), workspace);
  assert.deepEqual(orderedSaved(workspace, collection.id).map(item => item.request.id), [second, first]);
  workspace = shiftSaved(workspace, first, -1);
  assert.deepEqual(orderedSaved(workspace, collection.id).map(item => item.request.id), [first, second]);
  const seen: string[] = [];
  await runCollection(workspace, collection.id, { iterations: 1, delayMs: 0, stopOnFailure: false, data: [] }, { execute: async input => { seen.push(input.request.id); return { passed: true, tests: [], logs: [], changes: [] }; } });
  assert.deepEqual(seen, [first, second]);
  workspace = moveSaved(workspace, second, undefined);
  assert.deepEqual(orderedSaved(workspace, collection.id).map(item => item.request.id), [second, first]);
});
test('collections and folders reorder without changing their contents', () => {
  let workspace = initialWorkspace();
  workspace.collections.push({ id: 'next', name: 'Next', description: '', variables: [] });
  workspace = shiftCollection(workspace, 'next', -1);
  assert.equal(workspace.collections[0].id, 'next');
  workspace = moveCollectionBefore(workspace, 'getting-started', 'next');
  assert.equal(workspace.collections[0].id, 'getting-started');
  const collection = { ...workspace.collections[0], folders: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] };
  assert.equal(shiftFolder(collection, 'b', -1).folders?.[0].id, 'b');
  assert.equal(moveFolderBefore(collection, 'b', 'a').folders?.[0].id, 'b');
});
