import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialWorkspace, newDraft, parseWorkspace, prepareWorkspaceRequest, newEntry } from '../shared/workspace.ts';
import { deleteFolder, duplicateFolder, exportFolder, folderPath, folderSubtree, folderTree, isFolderTree, moveFolderBefore, moveSaved, orderedSaved, reparentFolder, saveSavedRequest, shiftFolder } from '../shared/organization.ts';
import { runCollection } from '../shared/runner.ts';
import { importWorkspace } from '../src/lib/importers.ts';

function fixture() {
  const workspace = initialWorkspace(), collection = workspace.collections[0];
  collection.folders = [{ id: 'users', name: 'Users' }, { id: 'detail', name: 'Detail', parentId: 'users' }, { id: 'other', name: 'Other' }, { id: 'nested', name: 'Nested', parentId: 'detail' }];
  workspace.saved[0].folderId = 'nested'; workspace.saved[1].folderId = 'users';
  workspace.saved.push({ collectionId: collection.id, folderId: 'detail', request: { ...newDraft(collection.id), name: 'Detail request' } });
  return workspace;
}

test('nested folders have stable depth-first request order shared by the runner', async () => {
  const workspace = fixture(), collection = workspace.collections[0];
  assert.deepEqual(folderTree(collection).map(item => item.path), ['Users', 'Users / Detail', 'Users / Detail / Nested', 'Other']);
  assert.equal(folderPath(collection, 'nested'), 'Users / Detail / Nested');
  assert.equal(folderSubtree(collection, 'users').size, 3);
  assert.deepEqual(orderedSaved(workspace, collection.id).map(item => item.request.name), ['Create a post', 'Detail request', 'Get a post']);
  const seen: string[] = [];
  await runCollection(workspace, collection.id, { iterations: 1, delayMs: 0, stopOnFailure: false, data: [] }, { execute: async input => { seen.push(input.request.name); return { passed: true, tests: [], logs: [], changes: [] }; } });
  assert.deepEqual(seen, ['Create a post', 'Detail request', 'Get a post']);
  assert.deepEqual(parseWorkspace(JSON.stringify(workspace)), workspace);
});

test('folder parents reject cycles, orphaned IDs, duplicates and excessive nesting', () => {
  const workspace = fixture(), collection = workspace.collections[0];
  assert.throws(() => reparentFolder(collection, 'users', 'nested'), /outside/);
  assert.throws(() => reparentFolder(collection, 'detail', 'missing'), /parent/);
  const moved = reparentFolder(collection, 'detail', 'other');
  assert.equal(folderPath(moved, 'nested'), 'Other / Detail / Nested');
  assert.equal(folderPath(collection, 'nested'), 'Users / Detail / Nested');
  assert.equal(isFolderTree([{ id: 'x', name: 'X' }, { id: 'x', name: 'Again' }]), false);
  const deep = Array.from({ length: 21 }, (_, index) => ({ id: `folder${index}`, name: 'Folder', ...(index ? { parentId: `folder${index - 1}` } : {}) }));
  assert.equal(isFolderTree(deep), false); assert.equal(isFolderTree(deep.slice(0, 20)), true);
  assert.throws(() => parseWorkspace(JSON.stringify({ ...workspace, collections: [{ ...collection, folders: [{ id: 'x', name: 'X', parentId: 'x' }] }] })));
});

test('deleting a folder promotes requests and child folders without deleting descendants', () => {
  const workspace = fixture(), result = deleteFolder(workspace, 'getting-started', 'detail');
  assert.equal(result.saved.length, workspace.saved.length);
  assert.equal(result.saved.find(item => item.request.name === 'Detail request')?.folderId, 'users');
  assert.equal(folderPath(result.collections[0], 'nested'), 'Users / Nested');
  assert.equal(result.saved[0].folderId, 'nested');
  const rootRemoved = deleteFolder(result, 'getting-started', 'users');
  assert.equal(rootRemoved.saved[1].folderId, undefined);
  assert.equal(folderPath(rootRemoved.collections[0], 'nested'), 'Nested');
  assert.doesNotThrow(() => parseWorkspace(JSON.stringify(rootRemoved)));
});

test('folder duplication remaps descendants, examples and requests without sharing mutable mock settings', () => {
  const workspace = fixture();
  workspace.saved[0].examples = [{ id: 'example', name: 'OK', status: 200, statusText: 'OK', headers: [], body: '{}', encoding: 'utf8' }];
  workspace.saved[0].request.mock = { enabled: true, status: 200, statusText: 'OK', headers: [], body: '{}' };
  workspace.saved[0].request.binaryFile = { id: 'shared-device-file', name: 'file.bin', size: 1, type: 'application/octet-stream' };
  const copied = duplicateFolder(workspace, 'getting-started', 'users');
  assert.equal(copied.saved.length, 6);
  const folder = copied.collections[0].folders!.find(item => item.name === 'Users copy')!;
  assert.equal(folderSubtree(copied.collections[0], folder.id).size, 3);
  const clone = copied.saved.find(item => item.request.id !== workspace.saved[0].request.id && item.request.name === 'Get a post')!;
  assert.notEqual(clone.examples?.[0].id, 'example');
  assert.equal(clone.request.binaryFile?.id, 'shared-device-file');
  clone.request.mock!.body = 'changed'; assert.equal(workspace.saved[0].request.mock.body, '{}');
  assert.doesNotThrow(() => parseWorkspace(JSON.stringify(copied)));
});

test('folder exports detach the subtree root and keep scoped variables, examples and nested mocks portable', () => {
  const workspace = fixture(), exported = exportFolder(workspace, 'getting-started', 'detail');
  assert.equal(exported.collections[0].folders?.length, 2); assert.equal(exported.saved.length, 2);
  assert.equal(exported.collections[0].folders?.find(item => item.id === 'detail')?.parentId, undefined);
  assert.deepEqual(exported.variables, workspace.variables); assert.equal(exported.history.length, 0);
  assert.doesNotThrow(() => parseWorkspace(JSON.stringify(exported)));
  assert.equal(workspace.collections[0].folders?.find(item => item.id === 'detail')?.parentId, 'users');
});

test('cross-collection moves update scope while saves preserve folder placement, examples and request order', () => {
  const workspace = fixture();
  workspace.collections.push({ id: 'target', name: 'Target', description: '', variables: [newEntry('base_url', 'https://target.example')], folders: [{ id: 'destination', name: 'Destination' }] });
  workspace.saved[0].examples = [{ id: 'example', name: 'OK', status: 200, statusText: 'OK', headers: [], body: '{}', encoding: 'utf8' }];
  const saved = saveSavedRequest(workspace, { ...workspace.saved[0].request, name: 'Changed' }, 'getting-started');
  assert.equal(saved.saved[0].folderId, 'nested'); assert.equal(saved.saved[0].examples?.length, 1);
  assert.equal(saved.saved[1].request.id, workspace.saved[1].request.id);
  const moved = moveSaved(saved, saved.saved[0].request.id, 'destination', undefined, 'target');
  const target = moved.saved.find(item => item.request.id === saved.saved[0].request.id)!;
  assert.equal(target.collectionId, 'target'); assert.equal(target.request.collectionId, 'target');
  assert.equal(target.examples?.length, 1); assert.equal(prepareWorkspaceRequest(moved, target.request).url, 'https://target.example/posts/1');
  assert.doesNotThrow(() => parseWorkspace(JSON.stringify(moved)));
  assert.equal(moveSaved(workspace, workspace.saved[0].request.id, 'destination', undefined, 'missing'), workspace);
});

test('folder ordering operates on siblings and external imports preserve nested and empty folders', () => {
  const collection = fixture().collections[0];
  assert.equal(shiftFolder(collection, 'other', -1).folders?.[0].id, 'other');
  assert.equal(moveFolderBefore(collection, 'nested', 'other'), collection);
  const postman = importWorkspace(JSON.stringify({ info: { name: 'API', schema: 'v2.1' }, item: [{ name: 'Users', item: [{ name: 'Detail', item: [{ name: 'Get', request: { url: 'https://example.test' } }] }, { name: 'Empty', item: [] }] }] })).workspace;
  assert.equal(folderPath(postman.collections[0], postman.saved[0].folderId!), 'Users / Detail');
  assert(postman.collections[0].folders?.some(item => item.name === 'Empty'));
  const insomnia = importWorkspace(JSON.stringify({ __export_format: 4, resources: [{ _type: 'workspace', _id: 'w', name: 'API' }, { _type: 'request_group', _id: 'a', parentId: 'w', name: 'Users' }, { _type: 'request_group', _id: 'b', parentId: 'a', name: 'Detail' }, { _type: 'request', parentId: 'b', name: 'Get', url: 'https://example.test' }] })).workspace;
  assert.equal(folderPath(insomnia.collections[0], insomnia.saved[0].folderId!), 'Users / Detail');
});
