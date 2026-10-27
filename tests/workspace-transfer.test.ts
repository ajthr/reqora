import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialWorkspace, newEntry, parseWorkspace, prepareWorkspaceRequest, workspaceGlobals } from '../shared/workspace.ts';
import { emptyWorkspace, loadWorkspaceStore, parseWorkspaceStore } from '../src/lib/workspace-store.ts';
import type { WorkspaceStore } from '../src/lib/workspace-store.ts';
import { addEnvironments, appendWorkspaces, applyTransfer, exportEnvironments, exportWorkspace, exportWorkspaceBundle, MAX_TRANSFER_BYTES, previewTransfer } from '../src/lib/workspace-transfer.ts';

const options = { destination: 'new' as const, activateEnvironments: true };
function fixture(): WorkspaceStore {
  const first = initialWorkspace();
  first.environments = [
    { id: 'dev', name: 'Development', variables: [newEntry('base_url', 'https://dev.example'), { ...newEntry('off', 'disabled'), enabled: false }] },
    { id: 'prod', name: 'Production', variables: [newEntry('base_url', 'https://prod.example')] },
  ];
  first.activeEnvironmentId = 'dev';
  first.saved[0].request.token = 'saved-secret';
  first.saved[0].request.binaryFile = { id: 'device-file', name: 'payload.bin', size: 1, type: 'application/octet-stream' };
  first.history = [{ id: 'history', date: new Date().toISOString(), request: structuredClone(first.saved[0].request), status: 200 }];
  first.cookies = [{ id: 'session', name: 'session', value: 'cookie-secret', domain: 'example.test', path: '/', hostOnly: true, secure: true, httpOnly: true, sameSite: 'lax', expiresAt: null, createdAt: Date.now() }];
  return { version: 1, activeId: 'one', workspaces: [{ id: 'one', name: 'Project One', data: first }, { id: 'two', name: 'Project Two', data: emptyWorkspace() }] };
}

test('single workspace export keeps its name and remains readable as a CLI workspace', () => {
  const store = fixture(), text = exportWorkspace(store.workspaces[0]);
  assert.equal(parseWorkspace(text).saved[0].request.token, 'saved-secret');
  const preview = previewTransfer(text);
  assert.equal(preview.kind, 'workspace');
  if (preview.kind !== 'workspace') return;
  assert.equal(preview.name, 'Project One');
  assert.deepEqual(preview.workspace, store.workspaces[0].data);
  const imported = applyTransfer(store, preview, options);
  assert.equal(imported.workspaces.length, 3);
  const added = imported.workspaces[2];
  assert.notEqual(added.id, store.workspaces[0].id);
  assert.equal(added.name, 'Project One (2)');
  assert.equal(imported.activeId, added.id);
  assert.deepEqual(imported.workspaces.slice(0, 2), store.workspaces);
  assert.equal(added.data.saved[0].request.binaryFile?.id, 'device-file');
  assert.equal(prepareWorkspaceRequest(added.data, added.data.saved[0].request).url, 'https://dev.example/posts/1');
});

test('all-workspace backup imports additive copies and remaps the active workspace', () => {
  const original = fixture(); original.activeId = 'two';
  const preview = previewTransfer(exportWorkspaceBundle(original));
  assert.equal(preview.kind, 'workspaces');
  const result = applyTransfer(original, preview, options);
  assert.equal(result.workspaces.length, 4);
  assert.equal(result.activeId, result.workspaces[3].id);
  assert.deepEqual(result.workspaces.slice(0, 2), original.workspaces);
  assert.equal(result.workspaces[2].name, 'Project One (2)');
  assert.equal(result.workspaces[3].name, 'Project Two (2)');
  assert.deepEqual(result.workspaces[2].data, original.workspaces[0].data);
  assert.deepEqual(parseWorkspaceStore(JSON.stringify(result)), result);
  result.workspaces[2].data.environments![0].variables[0].value = 'changed';
  assert.equal(original.workspaces[0].data.environments![0].variables[0].value, 'https://dev.example');
});

test('replace changes only the active workspace and preserves its local name and ID', () => {
  const store = fixture(), replacement = emptyWorkspace(); replacement.variables.push(newEntry('new', 'value'));
  const preview = previewTransfer(JSON.stringify(replacement));
  const result = applyTransfer(store, preview, { ...options, destination: 'replace' });
  assert.equal(result.activeId, 'one'); assert.equal(result.workspaces.length, 2);
  assert.equal(result.workspaces[0].name, 'Project One');
  assert.deepEqual(result.workspaces[0].data.variables, replacement.variables);
  assert.deepEqual(result.workspaces[1], store.workspaces[1]);
  assert.equal(store.workspaces[0].data.saved.length, 2);
});

test('single environment imports have fresh IDs, preserve disabled/empty values and keep existing data', () => {
  const store = fixture(), workspace = store.workspaces[0].data;
  workspace.environments![0].variables.push(newEntry('empty', ''));
  const preview = previewTransfer(exportEnvironments(workspace, 'dev'));
  assert.equal(preview.kind, 'environments'); if (preview.kind !== 'environments') return;
  const imported = addEnvironments(workspace, preview);
  const copy = imported.environments![2];
  assert.equal(copy.name, 'Development (2)'); assert.notEqual(copy.id, 'dev');
  assert.equal(imported.activeEnvironmentId, copy.id);
  assert.notEqual(copy.variables[0].id, workspace.environments![0].variables[0].id);
  assert.equal(copy.variables[1].enabled, false); assert.equal(copy.variables[2].value, '');
  assert.deepEqual(imported.variables, workspace.variables);
  assert.deepEqual(imported.saved, workspace.saved); assert.deepEqual(imported.cookies, workspace.cookies);
  assert.equal(addEnvironments(workspace, preview, false).activeEnvironmentId, 'dev');
});

test('environment bundle keeps existing base values, adds missing names and restores the selected environment', () => {
  const source = fixture().workspaces[0].data;
  source.variables.push(newEntry('new', '{{base_url}}/extra'));
  const preview = previewTransfer(exportEnvironments(source));
  assert.equal(preview.kind, 'environments'); if (preview.kind !== 'environments') return;
  const target = emptyWorkspace(); target.variables = [newEntry('base_url', 'https://keep.example')];
  const imported = addEnvironments(target, preview);
  assert.equal(imported.variables[0].value, 'https://keep.example');
  assert.equal(imported.variables[1].name, 'new');
  assert.equal(imported.environments?.length, 2);
  assert.equal(imported.activeEnvironmentId, imported.environments![0].id);
  assert.equal(workspaceGlobals(imported).at(-2)?.value, 'https://dev.example');
  const baseOnly = previewTransfer(exportEnvironments(target));
  assert.equal(baseOnly.kind, 'environments');
  const added = applyTransfer(fixture(), baseOnly, options);
  assert.equal(added.workspaces.length, 2);
});

test('Postman environment import is additive and preserves disabled values', () => {
  const preview = previewTransfer(JSON.stringify({ name: 'Imported staging', values: [{ key: 'host', value: 'staging.example', enabled: false }, { key: 'empty', value: '' }] }));
  assert.equal(preview.kind, 'environments');
  const result = applyTransfer(fixture(), preview, options);
  assert.equal(result.workspaces[0].data.saved.length, 2);
  assert.equal(result.workspaces[0].data.environments?.length, 3);
  assert.equal(result.workspaces[0].data.environments?.[2].variables[0].enabled, false);
});

test('legacy Reqora and external collections can be imported as new workspaces', () => {
  const store = fixture();
  for (const text of [JSON.stringify(initialWorkspace()), 'curl https://example.test', JSON.stringify({ info: { name: 'Postman', schema: 'v2.1' }, item: [{ name: 'List', request: { method: 'GET', url: 'https://example.test' } }] })]) {
    const preview = previewTransfer(text);
    assert.equal(preview.kind, 'workspace');
    const result = applyTransfer(store, preview, options);
    assert.equal(result.workspaces.length, 3);
    assert.deepEqual(result.workspaces.slice(0, 2), store.workspaces);
  }
});

test('workspace import enforces capacity atomically and repeated imports receive distinct names and IDs', () => {
  const store = fixture(), preview = previewTransfer(exportWorkspaceBundle(store));
  const once = applyTransfer(store, preview, options), twice = applyTransfer(once, preview, options);
  assert.equal(twice.workspaces[4].name, 'Project One (3)');
  assert.equal(new Set(twice.workspaces.map(item => item.id)).size, 6);
  const full = { ...store, workspaces: Array.from({ length: 99 }, (_, i) => ({ id: `item-${i}`, name: `Item ${i}`, data: emptyWorkspace() })), activeId: 'item-0' };
  assert.throws(() => applyTransfer(full, preview, options), /100 local workspaces/);
  assert.equal(full.workspaces.length, 99);
  assert.throws(() => appendWorkspaces({ ...full, workspaces: [...full.workspaces, store.workspaces[0]] }, [store.workspaces[1]], 'two'), /100/);
});

test('invalid transfers are rejected before changing a workspace', () => {
  const env = { id: 'env', name: 'Environment', variables: [] };
  for (const value of [
    { format: 'reqora-environments', version: 2, environments: [env] },
    { format: 'reqora-environments', version: 1, environments: [env, env] },
    { format: 'reqora-environments', version: 1, environments: [{ ...env, name: '' }] },
    { format: 'reqora-environments', version: 1, environments: [env], activeEnvironmentId: 'missing' },
    { format: 'reqora-environments', version: 1, environments: [env], variables: 'bad' },
    { format: 'reqora-environments', version: 1, environments: [env], variables: null },
    { format: 'reqora-workspaces', version: 1, workspaces: [] },
    { ...emptyWorkspace(), format: 'unknown' },
  ]) assert.throws(() => previewTransfer(JSON.stringify(value)));
  assert.throws(() => previewTransfer(' ')); assert.throws(() => previewTransfer('{invalid'));
  assert.throws(() => previewTransfer('x'.repeat(MAX_TRANSFER_BYTES + 1)), /25 MB/);
  assert.throws(() => exportEnvironments(emptyWorkspace(), 'missing'), /not found/);
});

test('unreadable catalog or legacy storage is surfaced without a fallback that could overwrite it', () => {
  assert.throws(() => loadWorkspaceStore({ getItem: () => '{invalid' }));
  assert.throws(() => loadWorkspaceStore({ getItem: key => key === 'reqora.workspace.v1' ? '{invalid' : null }));
  assert.throws(() => loadWorkspaceStore({ getItem: () => { throw Error('Storage blocked'); } }), /blocked/);
});

test('named workspace exports run through the CLI with selected environment values', async () => {
  const store = fixture(), record = store.workspaces[0];
  record.data.saved = [record.data.saved[0]];
  record.data.saved[0].request.mock = { enabled: true, status: 200, statusText: 'OK', headers: [], body: '{{base_url}}' };
  record.data.saved[0].request.postResponseScript = 'rq.test("selected environment", () => rq.expect(rq.response.text()).toBe("https://prod.example"));';
  const directory = await mkdtemp(join(tmpdir(), 'reqora-transfer-cli-'));
  try {
    const file = join(directory, 'workspace.json'), report = join(directory, 'report.json');
    await writeFile(file, exportWorkspace(record));
    const output = await promisify(execFile)(process.execPath, ['cli/reqora.mjs', 'run', file, '--environment', 'Production', '--report', report]);
    assert.match(output.stdout, /1 passed, 0 failed/);
    const results = JSON.parse(await readFile(report, 'utf8'));
    assert.equal(results.failed, 0); assert.equal(results.completed, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
