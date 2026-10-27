import { initialWorkspace, parseWorkspace } from '../../shared/workspace.ts';
import type { Workspace } from '../../shared/workspace.ts';

export interface WorkspaceRecord { id: string; name: string; data: Workspace }
export interface WorkspaceStore { version: 1; activeId: string; workspaces: WorkspaceRecord[] }
export const STORE_KEY = 'reqora.workspaces.v1';
export const LEGACY_KEY = 'reqora.workspace.v1';
export function emptyWorkspace(): Workspace { return { version: 1, collections: [], saved: [], history: [], variables: [], cookies: [] }; }
export function parseWorkspaceStore(text: string): WorkspaceStore {
  const value = JSON.parse(text) as WorkspaceStore;
  if (value?.version !== 1 || !Array.isArray(value.workspaces) || !value.workspaces.length || value.workspaces.length > 100 || !value.workspaces.every(item => typeof item?.id === 'string' && typeof item?.name === 'string' && item.name.trim().length > 0) || new Set(value.workspaces.map(item => item.id)).size !== value.workspaces.length || !value.workspaces.some(item => item.id === value.activeId)) throw new Error('Invalid workspace catalog.');
  return { ...value, workspaces: value.workspaces.map(item => ({ ...item, data: parseWorkspace(JSON.stringify(item.data)) })) };
}
export function loadWorkspaceStore(storage: Pick<Storage, 'getItem'>): WorkspaceStore {
  try { const saved = storage.getItem(STORE_KEY); if (saved) return parseWorkspaceStore(saved); } catch { /* Fall back to the legacy data. */ }
  let data = initialWorkspace();
  try { const legacy = storage.getItem(LEGACY_KEY); if (legacy) data = parseWorkspace(legacy); } catch { /* Keep the sample workspace. */ }
  const id = crypto.randomUUID();
  return { version: 1, activeId: id, workspaces: [{ id, name: 'My workspace', data }] };
}
