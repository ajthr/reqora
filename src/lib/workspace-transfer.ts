import { parseWorkspace } from '../../shared/workspace.ts';
import type { Entry, Environment, Workspace } from '../../shared/workspace.ts';
import { importWorkspace } from './importers.ts';
import { emptyWorkspace, parseWorkspaceStore } from './workspace-store.ts';
import type { WorkspaceRecord, WorkspaceStore } from './workspace-store.ts';

export const MAX_TRANSFER_BYTES = 25 * 1024 * 1024;
export type TransferPreview =
  | { kind: 'workspace'; format: string; name: string; workspace: Workspace }
  | { kind: 'workspaces'; format: string; store: WorkspaceStore }
  | { kind: 'environments'; format: string; environments: Environment[]; variables?: Entry[]; activeEnvironmentId?: string };
export interface ImportOptions { destination: 'new' | 'replace'; activateEnvironments: boolean }

export function uniqueName(name: string, existing: string[]): string {
  const base = name.trim() || 'Imported workspace';
  const names = new Set(existing);
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base} (${index})`)) index++;
  return `${base} (${index})`;
}

function validEnvironments(workspace: Workspace): void {
  const environments = workspace.environments || [];
  if (environments.some(item => !item.id.trim() || !item.name.trim()) || new Set(environments.map(item => item.id)).size !== environments.length) throw new Error('Environments must have non-empty names and unique IDs.');
}

export function exportWorkspace(record: WorkspaceRecord): string {
  // Remains a regular Workspace export so existing CLI and older Reqora versions can read it.
  return JSON.stringify({ ...record.data, workspaceName: record.name }, null, 2);
}

export function exportWorkspaceBundle(store: WorkspaceStore): string {
  return JSON.stringify({ format: 'reqora-workspaces', version: 1, activeId: store.activeId, workspaces: store.workspaces }, null, 2);
}

export function exportEnvironments(workspace: Workspace, environmentId?: string): string {
  const environments = environmentId ? workspace.environments?.filter(item => item.id === environmentId) || [] : workspace.environments || [];
  if (environmentId && !environments.length) throw new Error('Environment not found.');
  return JSON.stringify({ format: 'reqora-environments', version: 1, environments,
    ...(environmentId ? { activeEnvironmentId: environmentId } : { variables: workspace.variables, activeEnvironmentId: workspace.activeEnvironmentId }) }, null, 2);
}

export function previewTransfer(text: string): TransferPreview {
  if (new TextEncoder().encode(text).length > MAX_TRANSFER_BYTES) throw new Error('Imports must be smaller than 25 MB.');
  if (!text.trim()) throw new Error('Drop an export file or paste JSON or a cURL command.');
  if (!/^curl(?:\.exe)?(?:\s|$)/i.test(text.trim())) {
    const value = JSON.parse(text);
    if (value?.format === 'reqora-workspaces' || Array.isArray(value?.workspaces)) {
      const store = parseWorkspaceStore(text);
      store.workspaces.forEach(item => validEnvironments(item.data));
      return { kind: 'workspaces', format: 'Reqora workspaces', store };
    }
    if (value?.format === 'reqora-environments') {
      if (value.version !== 1 || !Array.isArray(value.environments) || (value.variables !== undefined && !Array.isArray(value.variables)) || (value.variables === undefined && !value.environments.length)) throw new Error('Invalid environment export.');
      const workspace = parseWorkspace(JSON.stringify({ ...emptyWorkspace(), environments: value.environments, variables: value.variables ?? [], activeEnvironmentId: value.activeEnvironmentId }));
      validEnvironments(workspace);
      return { kind: 'environments', format: 'Reqora environments', environments: workspace.environments!,
        ...(value.variables !== undefined ? { variables: workspace.variables } : {}), activeEnvironmentId: workspace.activeEnvironmentId };
    }
    if (value?.format !== undefined && !['reqora-workspace'].includes(value.format)) throw new Error('Unsupported export format.');
  }
  const imported = importWorkspace(text);
  validEnvironments(imported.workspace);
  if (imported.format === 'Postman environment') return { kind: 'environments', format: imported.format,
    environments: imported.workspace.environments || [], activeEnvironmentId: imported.workspace.activeEnvironmentId };
  const { workspaceName, ...workspace } = imported.workspace as Workspace & { workspaceName?: unknown };
  return { kind: 'workspace', format: imported.format,
    name: typeof workspaceName === 'string' && workspaceName.trim() ? workspaceName.trim() : workspace.collections[0]?.name || 'Imported workspace', workspace };
}

export function appendWorkspaces(store: WorkspaceStore, records: WorkspaceRecord[], selectedId: string): WorkspaceStore {
  if (store.workspaces.length + records.length > 100) throw new Error('You can keep up to 100 local workspaces. Delete a workspace before importing more.');
  const names = store.workspaces.map(item => item.name);
  let activeId = store.activeId;
  const copies = records.map(record => {
    const id = crypto.randomUUID(), name = uniqueName(record.name, names);
    names.push(name);
    if (record.id === selectedId) activeId = id;
    return { id, name, data: structuredClone(record.data) };
  });
  return { ...store, activeId, workspaces: [...store.workspaces, ...copies] };
}

export function addEnvironments(workspace: Workspace, preview: Extract<TransferPreview, { kind: 'environments' }>, activate = true): Workspace {
  const names = (workspace.environments || []).map(item => item.name);
  let activeEnvironmentId = workspace.activeEnvironmentId;
  const environments = preview.environments.map(environment => {
    const id = crypto.randomUUID(), name = uniqueName(environment.name, names);
    names.push(name);
    if (activate && environment.id === preview.activeEnvironmentId) activeEnvironmentId = id;
    return { id, name, variables: environment.variables.map(row => ({ ...row, id: crypto.randomUUID() })) };
  });
  const existing = new Set(workspace.variables.map(row => row.name.trim()));
  const variables = [...workspace.variables, ...(preview.variables || []).filter(row => !existing.has(row.name.trim())).map(row => ({ ...row, id: crypto.randomUUID() }))];
  return { ...workspace, variables, environments: [...(workspace.environments || []), ...environments], activeEnvironmentId };
}

export function applyTransfer(store: WorkspaceStore, preview: TransferPreview, options: ImportOptions): WorkspaceStore {
  if (preview.kind === 'workspaces') return appendWorkspaces(store, preview.store.workspaces, preview.store.activeId);
  if (preview.kind === 'workspace' && options.destination === 'new') {
    return appendWorkspaces(store, [{ id: 'import', name: preview.name, data: preview.workspace }], 'import');
  }
  return { ...store, workspaces: store.workspaces.map(item => item.id !== store.activeId ? item : { ...item, data: preview.kind === 'workspace'
    ? structuredClone(preview.workspace) : addEnvironments(item.data, preview, options.activateEnvironments) }) };
}
