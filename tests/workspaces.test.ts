import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeEnvironment, getVariableScope, initialWorkspace, newEntry, parseWorkspace, prepareWorkspaceRequest, workspaceGlobals } from '../shared/workspace.ts';
import { applyVariableChanges } from '../shared/automation.ts';
import { emptyWorkspace, loadWorkspaceStore, parseWorkspaceStore } from '../src/lib/workspace-store.ts';

test('legacy local workspace migrates into a named catalog', () => {
  const legacy = initialWorkspace();
  const store = loadWorkspaceStore({ getItem: key => key === 'reqora.workspace.v1' ? JSON.stringify(legacy) : null });
  assert.equal(store.workspaces.length, 1); assert.deepEqual(store.workspaces[0].data, legacy);
  assert.deepEqual(parseWorkspaceStore(JSON.stringify(store)), store);
  assert.equal(emptyWorkspace().saved.length, 0);
});
test('active environments override base variables and collection values override both', () => {
  const workspace = initialWorkspace();
  const id = 'staging';
  workspace.variables = [newEntry('host', 'base.test')];
  workspace.environments = [{ id, name: 'Staging', variables: [newEntry('host', 'staging.test')] }];
  workspace.activeEnvironmentId = id;
  workspace.collections[0].variables = [newEntry('host', 'collection.test')];
  assert.equal(activeEnvironment(workspace)?.name, 'Staging');
  assert.equal(getVariableScope(workspaceGlobals(workspace)).find(row => row.name === 'host')?.value, 'staging.test');
  assert.equal(getVariableScope(workspaceGlobals(workspace), workspace.collections[0].variables).find(row => row.name === 'host')?.value, 'collection.test');
  const changed = applyVariableChanges(workspace, [{ scope: 'global', name: 'token', value: 'abc' }], workspace.collections[0].id);
  assert.equal(changed.environments?.[0].variables.find(row => row.name === 'token')?.value, 'abc');
  assert.equal(changed.variables.length, 1);
  const request = { ...workspace.saved[0].request, url: 'https://{{host}}/users', collectionId: undefined };
  assert.equal(prepareWorkspaceRequest({ ...workspace, collections: [], saved: [] }, request).url, 'https://staging.test/users');
  assert.deepEqual(parseWorkspace(JSON.stringify(workspace)), workspace);
});

test('catalog keeps workspaces isolated and rejects invalid active IDs', () => {
  const first = initialWorkspace(), second = emptyWorkspace();
  second.variables = [newEntry('token', 'second')];
  const catalog = { version: 1 as const, activeId: 'one', workspaces: [{ id: 'one', name: 'One', data: first }, { id: 'two', name: 'Two', data: second }] };
  const restored = parseWorkspaceStore(JSON.stringify(catalog));
  assert.equal(restored.workspaces[0].data.saved.length, 2);
  assert.equal(restored.workspaces[1].data.saved.length, 0);
  assert.equal(restored.workspaces[1].data.variables[0].value, 'second');
  assert.throws(() => parseWorkspaceStore(JSON.stringify({ ...catalog, activeId: 'missing' })));
});
test('collection runs pass the active environment to execution', async () => {
  const { runCollection } = await import('../shared/runner.ts');
  const workspace = initialWorkspace();
  workspace.variables = [newEntry('base_url', 'https://base.test')];
  workspace.environments = [{ id: 'dev', name: 'Development', variables: [newEntry('base_url', 'https://dev.test')] }];
  workspace.activeEnvironmentId = 'dev';
  let value = '';
  await runCollection(workspace, workspace.collections[0].id, { iterations: 1, delayMs: 0, stopOnFailure: false, data: [], requestIds: [workspace.saved[0].request.id] }, { execute: async input => {
    value = getVariableScope(input.globals).find(row => row.name === 'base_url')?.value || '';
    return { passed: true, tests: [], logs: [], changes: [] };
  } });
  assert.equal(value, 'https://dev.test');
});
