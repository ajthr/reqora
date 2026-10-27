import type { Collection, SavedRequest, Workspace } from './workspace.ts';

export function orderedSaved(workspace: Workspace, collectionId: string): SavedRequest[] {
  const collection = workspace.collections.find(item => item.id === collectionId);
  const items = workspace.saved.filter(item => item.collectionId === collectionId);
  if (!collection) return items;
  const folders = collection.folders || [];
  const valid = new Set(folders.map(folder => folder.id));
  return [...items.filter(item => !item.folderId || !valid.has(item.folderId)), ...folders.flatMap(folder => items.filter(item => item.folderId === folder.id))];
}
export function moveSaved(workspace: Workspace, requestId: string, folderId: string | undefined, beforeId?: string): Workspace {
  const moving = workspace.saved.find(item => item.request.id === requestId);
  if (!moving || requestId === beforeId && moving.folderId === folderId) return workspace;
  const collection = workspace.collections.find(item => item.id === moving.collectionId);
  if (folderId && !collection?.folders?.some(item => item.id === folderId)) return workspace;
  const updated = { ...moving, folderId };
  const saved = workspace.saved.filter(item => item.request.id !== requestId);
  if (beforeId) {
    const before = saved.find(item => item.request.id === beforeId);
    if (before?.collectionId === moving.collectionId && before.folderId === folderId) {
      saved.splice(saved.indexOf(before), 0, updated);
      return { ...workspace, saved };
    }
  }
  const peers = saved.filter(item => item.collectionId === moving.collectionId && item.folderId === folderId);
  const after = peers.at(-1);
  if (after) saved.splice(saved.indexOf(after) + 1, 0, updated);
  else saved.push(updated);
  return { ...workspace, saved };
}
export function shiftSaved(workspace: Workspace, requestId: string, direction: -1 | 1): Workspace {
  const moving = workspace.saved.find(item => item.request.id === requestId);
  if (!moving) return workspace;
  const peers = workspace.saved.filter(item => item.collectionId === moving.collectionId && item.folderId === moving.folderId);
  const index = peers.indexOf(moving), neighbor = peers[index + direction];
  if (!neighbor) return workspace;
  const saved = [...workspace.saved], from = saved.indexOf(moving), to = saved.indexOf(neighbor);
  [saved[from], saved[to]] = [saved[to], saved[from]];
  return { ...workspace, saved };
}
export function shiftFolder(collection: Collection, folderId: string, direction: -1 | 1): Collection {
  const folders = [...(collection.folders || [])], index = folders.findIndex(item => item.id === folderId);
  if (index < 0 || index + direction < 0 || index + direction >= folders.length) return collection;
  [folders[index], folders[index + direction]] = [folders[index + direction], folders[index]];
  return { ...collection, folders };
}
export function shiftCollection(workspace: Workspace, collectionId: string, direction: -1 | 1): Workspace {
  const collections = [...workspace.collections], index = collections.findIndex(item => item.id === collectionId);
  if (index < 0 || index + direction < 0 || index + direction >= collections.length) return workspace;
  [collections[index], collections[index + direction]] = [collections[index + direction], collections[index]];
  return { ...workspace, collections };
}
export function moveCollectionBefore(workspace: Workspace, collectionId: string, beforeId: string): Workspace {
  if (collectionId === beforeId) return workspace;
  const collections = [...workspace.collections], index = collections.findIndex(item => item.id === collectionId), before = collections.findIndex(item => item.id === beforeId);
  if (index < 0 || before < 0) return workspace;
  const [moved] = collections.splice(index, 1);
  collections.splice(collections.findIndex(item => item.id === beforeId), 0, moved);
  return { ...workspace, collections };
}
export function moveFolderBefore(collection: Collection, folderId: string, beforeId: string): Collection {
  if (folderId === beforeId) return collection;
  const folders = [...(collection.folders || [])], index = folders.findIndex(item => item.id === folderId), before = folders.findIndex(item => item.id === beforeId);
  if (index < 0 || before < 0) return collection;
  const [moved] = folders.splice(index, 1);
  folders.splice(folders.findIndex(item => item.id === beforeId), 0, moved);
  return { ...collection, folders };
}
