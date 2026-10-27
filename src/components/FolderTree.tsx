import type { DragEvent, ReactNode } from 'react';
import type { Collection, SavedRequest } from '../../shared/workspace';
import { folderPath, folderSubtree } from '../../shared/organization';
import ActionMenu from './ActionMenu';
import type { MenuAction } from './ActionMenu';
import Icon from './Icon';

export default function FolderTree({ collection, requests, search, collapsed, onToggle, row, actions, onDropRequest, onReorder }: {
  collection: Collection; requests: SavedRequest[]; search: string; collapsed: string[];
  onToggle: (id: string) => void; row: (item: SavedRequest) => ReactNode;
  actions: (folderId: string) => MenuAction[]; onDropRequest: (event: DragEvent, folderId: string) => void;
  onReorder: (sourceId: string, beforeId: string) => void;
}) {
  const folders = collection.folders || [], query = search.toLowerCase();
  const render = (parentId?: string, depth = 0): ReactNode => {
    if (depth >= 20) return null;
    return folders.filter(folder => folder.parentId === parentId).map(folder => {
      const ids = folderSubtree(collection, folder.id);
      const count = requests.filter(item => !!item.folderId && ids.has(item.folderId)).length;
      if (query && !count && !folders.some(item => ids.has(item.id) && folderPath(collection, item.id).toLowerCase().includes(query))) return null;
      const expanded = !!search || !collapsed.includes(folder.id);
      return <div className="sidebar-folder" key={folder.id}>
        <div className="sidebar-folder-heading" draggable onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData('text/reqora-folder', folder.id); event.dataTransfer.setData('text/reqora-folder-collection', collection.id); }} onDragOver={event => event.preventDefault()} onDrop={event => {
          const source = event.dataTransfer.getData('text/reqora-folder');
          if (source) { event.preventDefault(); event.stopPropagation(); if (event.dataTransfer.getData('text/reqora-folder-collection') === collection.id) onReorder(source, folder.id); }
          else onDropRequest(event, folder.id);
        }}>
          <button className="folder-name" title={folderPath(collection, folder.id)} aria-expanded={expanded} onClick={() => onToggle(folder.id)}><Icon name="chevron" size={11} className={expanded ? 'expanded' : ''} /><Icon name="folder" size={13} /><span>{folder.name}</span><small>{count}</small></button>
          <ActionMenu label={`Options for folder ${folder.name}`} actions={actions(folder.id)} />
        </div>
        {expanded && <div className="folder-requests">{requests.filter(item => item.folderId === folder.id).map(row)}{render(folder.id, depth + 1)}{!count && !(folders.some(item => item.parentId === folder.id)) && <span className="collection-empty">Empty folder</span>}</div>}
      </div>;
    });
  };
  return <>{render()}</>;
}
