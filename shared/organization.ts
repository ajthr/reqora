import type { Collection, Draft, Folder, SavedRequest, Workspace } from './workspace.ts';

export function isFolderTree(folders: Folder[]): boolean {
  if (folders.length > 1000) return false;
  const map = new Map(folders.map(folder => [folder.id, folder]));
  if (map.size !== folders.length) return false;
  return folders.every(folder => {
    if (!folder.id.trim() || !folder.name.trim() || folder.parentId !== undefined && (typeof folder.parentId !== 'string' || !map.has(folder.parentId))) return false;
    const seen = new Set<string>();
    let current: Folder | undefined = folder;
    while (current) {
      if (seen.has(current.id) || seen.size >= 20) return false;
      seen.add(current.id); current = current.parentId ? map.get(current.parentId) : undefined;
    }
    return true;
  });
}
export function folderSubtree(collection: Collection, id: string): Set<string> {
  const result = new Set<string>(), pending = [id];
  if (!collection.folders?.some(folder => folder.id === id)) return result;
  while (pending.length) {
    const next = pending.pop()!;
    if (result.has(next)) continue;
    result.add(next);
    pending.push(...(collection.folders || []).filter(folder => folder.parentId === next).map(folder => folder.id));
  }
  return result;
}
export function folderPath(collection: Collection, id: string): string {
  const names: string[] = [], seen = new Set<string>();
  let folder = collection.folders?.find(folder => folder.id === id);
  while (folder && !seen.has(folder.id)) {
    names.unshift(folder.name); seen.add(folder.id);
    folder = collection.folders?.find(item => item.id === folder!.parentId);
  }
  return names.join(' / ');
}
export function folderTree(collection: Collection): { folder: Folder; depth: number; path: string }[] {
  const result: { folder: Folder; depth: number; path: string }[] = [], seen = new Set<string>();
  const visit = (parentId?: string, depth = 0) => {
    if (depth >= 20) return;
    for (const folder of collection.folders || []) if (folder.parentId === parentId && !seen.has(folder.id)) {
      seen.add(folder.id); result.push({ folder, depth, path: folderPath(collection, folder.id) }); visit(folder.id, depth + 1);
    }
  };
  visit(); return result;
}

export function orderedSaved(workspace: Workspace, collectionId: string): SavedRequest[] {
  const collection = workspace.collections.find(item => item.id === collectionId);
  const items = workspace.saved.filter(item => item.collectionId === collectionId);
  if (!collection) return items;
  const folders = collection.folders || [];
  const valid = new Set(folders.map(folder => folder.id));
  return [...items.filter(item => !item.folderId || !valid.has(item.folderId)), ...folderTree(collection).flatMap(({ folder }) => items.filter(item => item.folderId === folder.id))];
}
export function saveSavedRequest(workspace: Workspace, request: Draft, collectionId: string): Workspace {
  if (!workspace.collections.some(item => item.id === collectionId)) throw new Error('Choose an existing collection.');
  const original = workspace.saved.find(item => item.request.id === request.id);
  const updated: SavedRequest = { ...original, collectionId, folderId: original?.collectionId === collectionId ? original.folderId : undefined, request: structuredClone({ ...request, collectionId }) };
  return { ...workspace, saved: original ? workspace.saved.map(item => item.request.id === request.id ? updated : item) : [...workspace.saved, updated] };
}
export function moveSaved(workspace: Workspace, requestId: string, folderId: string | undefined, beforeId?: string, targetCollectionId?: string): Workspace {
  const moving = workspace.saved.find(item => item.request.id === requestId);
  if (!moving || requestId === beforeId && moving.folderId === folderId) return workspace;
  const collectionId = targetCollectionId || moving.collectionId;
  const collection = workspace.collections.find(item => item.id === collectionId);
  if (!collection) return workspace;
  if (folderId && !collection?.folders?.some(item => item.id === folderId)) return workspace;
  const updated = { ...moving, collectionId, folderId, request: collectionId === moving.collectionId ? moving.request : { ...moving.request, collectionId } };
  const saved = workspace.saved.filter(item => item.request.id !== requestId);
  if (beforeId) {
    const before = saved.find(item => item.request.id === beforeId);
    if (before?.collectionId === collectionId && before.folderId === folderId) {
      saved.splice(saved.indexOf(before), 0, updated);
      return { ...workspace, saved };
    }
  }
  const peers = saved.filter(item => item.collectionId === collectionId && item.folderId === folderId);
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
  const folders = [...(collection.folders || [])], moving = folders.find(item => item.id === folderId);
  if (!moving) return collection;
  const peers = folders.filter(item => item.parentId === moving.parentId), index = peers.indexOf(moving), neighbor = peers[index + direction];
  if (!neighbor) return collection;
  const from = folders.indexOf(moving), to = folders.indexOf(neighbor);
  [folders[from], folders[to]] = [folders[to], folders[from]];
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
  if (folders[index].parentId !== folders[before].parentId) return collection;
  const [moved] = folders.splice(index, 1);
  folders.splice(folders.findIndex(item => item.id === beforeId), 0, moved);
  return { ...collection, folders };
}

export function reparentFolder(collection: Collection, folderId: string, parentId?: string): Collection {
  const folders = (collection.folders || []).map(folder => folder.id === folderId ? { ...folder, parentId } : folder);
  if (!isFolderTree(folders)) throw new Error('Choose a parent outside this folder’s subtree. Folder nesting is limited to 20 levels.');
  return { ...collection, folders };
}
export function deleteFolder(workspace: Workspace, collectionId: string, folderId: string): Workspace {
  const collection = workspace.collections.find(item => item.id === collectionId), target = collection?.folders?.find(item => item.id === folderId);
  if (!target) return workspace;
  return { ...workspace, collections: workspace.collections.map(item => item.id !== collectionId ? item : { ...item, folders: item.folders?.filter(folder => folder.id !== folderId).map(folder => folder.parentId === folderId ? { ...folder, parentId: target.parentId } : folder) }),
    saved: workspace.saved.map(item => item.collectionId === collectionId && item.folderId === folderId ? { ...item, folderId: target.parentId } : item) };
}
export function duplicateFolder(workspace: Workspace, collectionId: string, folderId: string): Workspace {
  const collection = workspace.collections.find(item => item.id === collectionId), source = collection?.folders?.find(item => item.id === folderId);
  if (!collection || !source) return workspace;
  const ids = folderSubtree(collection, folderId), mapping = new Map([...ids].map(id => [id, crypto.randomUUID()]));
  const names = new Set(collection.folders?.filter(folder => folder.parentId === source.parentId).map(folder => folder.name));
  let name = `${source.name} copy`, index = 2;
  while (names.has(name)) name = `${source.name} copy (${index++})`;
  const copies = structuredClone((collection.folders || []).filter(folder => ids.has(folder.id))).map(folder => ({ ...folder, id: mapping.get(folder.id)!, parentId: folder.id === folderId ? folder.parentId : mapping.get(folder.parentId!), name: folder.id === folderId ? name : folder.name }));
  if (!isFolderTree([...(collection.folders || []), ...copies])) throw new Error('A collection can contain up to 1000 folders and 20 levels.');
  const saved = structuredClone(workspace.saved.filter(item => item.collectionId === collectionId && !!item.folderId && ids.has(item.folderId))).map(item => ({ ...item, folderId: mapping.get(item.folderId!), request: { ...item.request, id: crypto.randomUUID(), collectionId }, examples: item.examples?.map(example => ({ ...example, id: crypto.randomUUID() })) }));
  return { ...workspace, collections: workspace.collections.map(item => item.id === collectionId ? { ...item, folders: [...(item.folders || []), ...copies] } : item), saved: [...workspace.saved, ...saved] };
}
export function exportFolder(workspace: Workspace, collectionId: string, folderId: string): Workspace {
  const collection = workspace.collections.find(item => item.id === collectionId);
  if (!collection) throw new Error('Collection not found.');
  const ids = folderSubtree(collection, folderId);
  if (!ids.size) throw new Error('Folder not found.');
  return structuredClone({ ...workspace, history: [], collections: [{ ...collection, folders: collection.folders?.filter(folder => ids.has(folder.id)).map(folder => folder.id === folderId ? { ...folder, parentId: undefined } : folder) }], saved: orderedSaved(workspace, collectionId).filter(item => !!item.folderId && ids.has(item.folderId)) });
}
