import { useEffect, useRef, useState } from 'react';
import logo from '../assets/logo-full.png';
import type { HttpResponse } from '../shared/types';
import Icon from './components/Icon';
import KeyValueEditor from './components/KeyValueEditor';
import CodeView from './components/CodeView';
import Modal, { ConfirmDialog } from './components/Dialog';
import type { Confirmation } from './components/Dialog';
import ActionMenu from './components/ActionMenu';
import type { MenuAction } from './components/ActionMenu';
import Startup from './components/Startup';
import CollectionOverview from './components/CollectionOverview';
import type { CollectionSection } from './components/CollectionOverview';
import { closeRequestTab, formatBody, formatSize, getRequestCollection, getVariableScope, initialWorkspace, newDraft, parseWorkspace, prepareWorkspaceRequest, toCurl } from './lib/workspace';
import type { Collection, Draft, Workspace } from './lib/workspace';
import { brandingInteractionProps } from './lib/branding';

const STORAGE_KEY = 'reqora.workspace.v1';
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
type Result = { response?: HttpResponse; error?: string };
type EditorTab = 'Params' | 'Headers' | 'Body' | 'Auth' | 'Settings';

function loadWorkspace(): Workspace {
  try { const value = localStorage.getItem(STORAGE_KEY); if (value) return parseWorkspace(value); }
  catch { /* An unavailable local store must not prevent startup. */ }
  return initialWorkspace();
}

function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [workspace, setWorkspace] = useState(loadWorkspace);
  const [tabs, setTabs] = useState<Draft[]>([]);
  const [activeId, setActiveId] = useState('');
  const [collectionTabs, setCollectionTabs] = useState<string[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [collectionSection, setCollectionSection] = useState<CollectionSection>('overview');
  const [emptyDraft] = useState(newDraft);
  const [editorTab, setEditorTab] = useState<EditorTab>('Params');
  const [responseTab, setResponseTab] = useState<'Body' | 'Headers'>('Body');
  const [pretty, setPretty] = useState(true);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'collections' | 'history'>('collections');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [modal, setModal] = useState<'save' | 'collection' | 'environment' | 'curl' | 'import' | 'rename' | 'move' | 'shortcuts' | 'about' | 'engine' | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [importText, setImportText] = useState('');
  const [pendingImport, setPendingImport] = useState<Workspace | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [draggingImport, setDraggingImport] = useState(false);
  const [actionTarget, setActionTarget] = useState<{ kind: 'request' | 'collection'; id: string } | null>(null);
  const [actionName, setActionName] = useState('');
  const [moveCollectionId, setMoveCollectionId] = useState('');
  const [saveName, setSaveName] = useState('');
  const [collectionId, setCollectionId] = useState(workspace.collections[0]?.id || '');
  const [collectionName, setCollectionName] = useState('');
  const [toast, setToast] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [backend, setBackend] = useState<'checking' | 'online' | 'offline'>('checking');
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('reqora.theme') || 'light'; } catch { return 'light'; } });
  const controller = useRef<AbortController | null>(null);
  const draft = tabs.find(tab => tab.id === activeId) || tabs[0] || emptyDraft;
  const openCollections = collectionTabs.flatMap(id => workspace.collections.find(item => item.id === id) || []);
  const activeOverview = openCollections.find(item => item.id === activeCollectionId);
  const hasRequest = tabs.length > 0 && !activeOverview;
  const hasOpenTabs = tabs.length > 0 || openCollections.length > 0;
  const result = results[draft.id];
  const response = result?.response;
  const saved = workspace.saved.find(item => item.request.id === draft.id);
  const dirty = !saved || JSON.stringify(saved.request) !== JSON.stringify(draft);
  const collection = getRequestCollection(workspace, draft);
  const scopeCollection = activeOverview || collection;
  const effectiveVariables = getVariableScope(workspace.variables, scopeCollection?.variables);
  const count = (rows: Draft['params']) => rows.filter(row => row.enabled && row.name.trim()).length;

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace)); setStorageError(false); }
    catch { setStorageError(true); }
  }, [workspace]);
  useEffect(() => {
    const valid = new Set(workspace.collections.map(item => item.id));
    setCollectionTabs(current => current.every(id => valid.has(id)) ? current : current.filter(id => valid.has(id)));
    setActiveCollectionId(current => current && !valid.has(current) ? openCollections[openCollections.length - 1]?.id || null : current);
  }, [workspace.collections]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('reqora.theme', theme); } catch { /* Keep theme in memory. */ }
  }, [theme]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { setDialogError(''); }, [modal]);
  useEffect(() => { void checkBackend(); return () => controller.current?.abort(); }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (modal || confirmation) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (hasRequest) saveRequest(); }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !busyId && hasRequest) { event.preventDefault(); void sendRequest(); }
      const target = event.target as HTMLElement;
      if (event.key === '?' && !target.closest('input, textarea, select, [contenteditable="true"]')) { event.preventDefault(); setModal('shortcuts'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  async function checkBackend() {
    setBackend('checking');
    try { const result = await fetch('/api/health', { signal: AbortSignal.timeout(5000) }); setBackend(result.ok ? 'online' : 'offline'); }
    catch { setBackend('offline'); }
  }

  function updateDraft(changes: Partial<Draft>) {
    setTabs(current => current.map(tab => tab.id === draft.id ? { ...tab, ...changes } : tab));
  }

  function openRequest(request: Draft) {
    if (!tabs.some(tab => tab.id === request.id)) setTabs(current => [...current, structuredClone(request)]);
    setActiveId(request.id);
    setActiveCollectionId(null);
    setMobileSidebar(false);
  }

  function addRequest() {
    openRequest(newDraft(activeOverview?.id));
  }

  function openCollection(id: string, section: CollectionSection = 'overview') {
    setCollectionTabs(current => current.includes(id) ? current : [...current, id]);
    setActiveCollectionId(id);
    setCollectionSection(section);
    setMobileSidebar(false);
  }

  function closeCollectionTab(id: string) {
    const remaining = collectionTabs.filter(item => item !== id);
    setCollectionTabs(remaining);
    if (activeCollectionId === id) setActiveCollectionId(remaining[remaining.length - 1] || null);
  }

  function createCollectionRequest(id: string) {
    const request = newDraft(id);
    openRequest(request);
    setSaveName(request.name);
    setCollectionId(id);
    setModal('save');
  }

  function closeTab(id: string, discard = false) {
    if (busyId === id) { setToast('Cancel the running request before closing its tab.'); return; }
    const closing = tabs.find(tab => tab.id === id);
    if (!closing) return;
    const original = workspace.saved.find(item => item.request.id === id)?.request;
    if (!discard && (!original || JSON.stringify(closing) !== JSON.stringify(original)) && (closing.url || closing.body || closing.name !== 'Untitled request')) {
      setConfirmation({ title: 'Discard unsaved changes?', description: `“${closing.name}” has changes that have not been saved. Closing this tab will discard them.`, confirmLabel: 'Discard changes', onConfirm: () => closeTab(id, true) });
      return;
    }
    const next = closeRequestTab(tabs, activeId, id);
    setTabs(next.tabs);
    setActiveId(next.activeId);
    if (!next.tabs.length && !activeOverview && openCollections.length) setActiveCollectionId(openCollections[openCollections.length - 1].id);
    setResults(current => { const next = { ...current }; delete next[id]; return next; });
  }

  function persistRequest(name: string, targetCollection: string) {
    if (!hasRequest) return;
    const request = { ...draft, name: name.trim() || 'Untitled request', collectionId: targetCollection };
    updateDraft({ name: request.name, collectionId: targetCollection });
    setWorkspace(current => ({ ...current, saved: [...current.saved.filter(item => item.request.id !== request.id), { collectionId: targetCollection, request: structuredClone(request) }] }));
    setModal(null);
    setToast('Request saved to your collection.');
  }

  function saveRequest() {
    if (!hasRequest) return;
    if (saved) { persistRequest(draft.name, saved.collectionId); return; }
    setSaveName(draft.name);
    setCollectionId(collection?.id || workspace.collections[0]?.id || '');
    setModal('save');
  }

  async function sendRequest() {
    if (!hasRequest || busyId || controller.current) return;
    const id = draft.id;
    let request;
    try { request = prepareWorkspaceRequest(workspace, draft); }
    catch (error) { setResults(current => ({ ...current, [id]: { error: (error as Error).message } })); return; }
    const snapshot = { ...structuredClone(draft), ...(collection ? { collectionId: collection.id } : {}) };
    const abort = new AbortController();
    controller.current = abort;
    setBusyId(id);
    setResults(current => ({ ...current, [id]: {} }));
    const history = { id: crypto.randomUUID(), date: new Date().toISOString(), request: snapshot };
    try {
      const result = await fetch('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: abort.signal });
      if (!result.headers.get('content-type')?.includes('application/json')) {
        throw new Error(result.status === 413 ? 'Request exceeds the 1 MB limit.' : 'The request engine is unavailable. Start the backend and try again.');
      }
      const payload = await result.json();
      if (!result.ok) throw new Error(payload.error || 'Unable to execute request.');
      const response = payload as HttpResponse;
      setResults(current => ({ ...current, [id]: { response } }));
      setWorkspace(current => ({ ...current, history: [{ ...history, status: response.status, durationMs: response.durationMs }, ...current.history].slice(0, 100) }));
      setBackend('online');
    } catch (error) {
      const message = abort.signal.aborted ? 'Request cancelled.' : error instanceof TypeError ? 'Could not reach the request engine. Check that the backend is running.' : error instanceof Error ? error.message : 'Unable to send the request.';
      setResults(current => ({ ...current, [id]: { error: message } }));
      setWorkspace(current => ({ ...current, history: [{ ...history, error: message }, ...current.history].slice(0, 100) }));
    } finally { setBusyId(null); controller.current = null; }
  }

  async function copy(value: string, message = 'Copied to clipboard.') {
    try { await navigator.clipboard.writeText(value); setToast(message); }
    catch { setToast('Clipboard access is unavailable. Select the text and copy it manually.'); }
  }

  function reviewImport(text: string) {
    try {
      if (new TextEncoder().encode(text).length > 5 * 1024 * 1024) throw new Error('Workspace imports must be smaller than 5 MB.');
      if (!text.trim()) throw new Error('Drop a workspace file or paste its JSON to continue.');
      setPendingImport(parseWorkspace(text));
      setDialogError('');
    } catch (error) { setDialogError(error instanceof SyntaxError ? 'This JSON is invalid. Paste a complete Reqora workspace export.' : error instanceof Error ? error.message : 'Unable to import this workspace.'); }
  }

  async function readImportFile(file: File) {
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Workspace imports must be smaller than 5 MB.');
      const text = await file.text();
      setImportText(text);
      reviewImport(text);
    } catch (error) { setDialogError(error instanceof Error ? error.message : 'Unable to read this file.'); }
  }

  function renameItem(kind: 'request' | 'collection', id: string, name: string) {
    setActionTarget({ kind, id });
    setActionName(name);
    setModal('rename');
  }

  function commitRename() {
    const name = actionName.trim();
    if (!name || !actionTarget) { setDialogError('Enter a name to continue.'); return; }
    if (actionTarget.kind === 'collection') {
      setWorkspace(current => ({ ...current, collections: current.collections.map(item => item.id === actionTarget.id ? { ...item, name } : item) }));
    } else {
      setWorkspace(current => ({ ...current, saved: current.saved.map(item => item.request.id === actionTarget.id ? { ...item, request: { ...item.request, name } } : item) }));
      setTabs(current => current.map(tab => tab.id === actionTarget.id ? { ...tab, name } : tab));
    }
    setModal(null);
    setToast('Name updated.');
  }

  function duplicateRequest(request: Draft): Draft {
    const clone = structuredClone(request);
    return { ...clone, collectionId: getRequestCollection(workspace, request)?.id, id: crypto.randomUUID(), params: clone.params.map(row => ({ ...row, id: crypto.randomUUID() })), headers: clone.headers.map(row => ({ ...row, id: crypto.randomUUID() })) };
  }

  function exportSelection(collection: Collection, requestId?: string) {
    const selected = workspace.saved.filter(item => item.collectionId === collection.id && (!requestId || item.request.id === requestId));
    const name = requestId ? selected[0]?.request.name || 'request' : collection.name;
    const filename = name.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 80) || 'export';
    download(`reqora-${filename}.json`, JSON.stringify({ version: 1, collections: [collection], saved: selected, history: [], variables: workspace.variables }, null, 2), 'application/json');
    setToast(`${requestId ? 'Request' : 'Collection'} exported in Reqora format.`);
  }

  function requestActions(request: Draft, collection: Collection): MenuAction[] {
    return [
      { label: 'Open request', icon: 'file', onSelect: () => openRequest(request) },
      { label: 'Rename', icon: 'edit', onSelect: () => renameItem('request', request.id, request.name) },
      { label: 'Duplicate request', icon: 'copy', onSelect: () => {
        const clone = { ...duplicateRequest(request), name: `${request.name} copy` };
        setWorkspace(current => ({ ...current, saved: [...current.saved, { collectionId: collection.id, request: clone }] }));
        openRequest(clone);
        setToast('Request duplicated.');
      } },
      { label: 'Move to collection', icon: 'move', disabled: workspace.collections.length < 2, onSelect: () => {
        setActionTarget({ kind: 'request', id: request.id });
        setMoveCollectionId(collection.id);
        setModal('move');
      } },
      { label: 'Export request', icon: 'download', separator: true, onSelect: () => exportSelection(collection, request.id) },
      { label: 'Copy as cURL', icon: 'code', onSelect: () => {
        try { void copy(toCurl(prepareWorkspaceRequest(workspace, request)), 'cURL command copied.'); }
        catch (error) { setToast((error as Error).message); }
      } },
      { label: 'Delete request', icon: 'trash', danger: true, separator: true, onSelect: () => setConfirmation({
        title: 'Delete request?', description: `“${request.name}” will be removed from “${collection.name}”. An open tab will remain available as an unsaved request.`, confirmLabel: 'Delete request',
        onConfirm: () => { setWorkspace(current => ({ ...current, saved: current.saved.filter(item => item.request.id !== request.id) })); setToast('Request deleted.'); },
      }) },
    ];
  }

  function collectionActions(collection: Collection): MenuAction[] {
    const requests = workspace.saved.filter(item => item.collectionId === collection.id);
    return [
      { label: 'Open overview', icon: 'layers', onSelect: () => openCollection(collection.id) },
      { label: 'Collection variables', icon: 'globe', onSelect: () => openCollection(collection.id, 'variables') },
      { label: 'New request', icon: 'plus', onSelect: () => createCollectionRequest(collection.id), separator: true },
      { label: 'Rename collection', icon: 'edit', onSelect: () => renameItem('collection', collection.id, collection.name) },
      { label: 'Duplicate collection', icon: 'copy', onSelect: () => {
        const id = crypto.randomUUID();
        const copiedCollection = { ...collection, id, name: `${collection.name} copy`, variables: collection.variables.map(row => ({ ...row, id: crypto.randomUUID() })) };
        const copiedRequests = requests.map(item => ({ collectionId: id, request: { ...duplicateRequest(item.request), collectionId: id } }));
        setWorkspace(current => ({ ...current, collections: [...current.collections, copiedCollection], saved: [...current.saved, ...copiedRequests] }));
        setToast('Collection duplicated.');
      } },
      { label: 'Export collection', icon: 'download', separator: true, onSelect: () => exportSelection(collection) },
      { label: 'Delete collection', icon: 'trash', danger: true, separator: true, onSelect: () => setConfirmation({
        title: 'Delete collection?', description: `“${collection.name}” and ${requests.length} saved request${requests.length === 1 ? '' : 's'} will be deleted. Open request tabs will remain available as unsaved requests.`, confirmLabel: 'Delete collection',
        onConfirm: () => { setWorkspace(current => ({ ...current, collections: current.collections.filter(item => item.id !== collection.id), saved: current.saved.filter(item => item.collectionId !== collection.id) })); setToast('Collection deleted.'); },
      }) },
    ];
  }

  function openImport() {
    setImportText(''); setPendingImport(null); setModal('import'); setMobileSidebar(false);
  }

  function exportWorkspace() {
    download('reqora-workspace.json', JSON.stringify(workspace, null, 2), 'application/json');
    setToast('Workspace exported. Keep it private if it contains credentials.');
  }

  function closeAllTabs(discard = false) {
    if (busyId) { setToast('Cancel the running request before closing all tabs.'); return; }
    const unsaved = tabs.some(tab => {
      const original = workspace.saved.find(item => item.request.id === tab.id)?.request;
      return (!original || JSON.stringify(original) !== JSON.stringify(tab)) && (tab.url || tab.body || tab.name !== 'Untitled request' || tab.headers.length || tab.params.length);
    });
    if (unsaved && !discard) {
      setConfirmation({ title: 'Close all tabs?', description: 'Unsaved changes in your open requests will be discarded. Collection overviews are saved automatically. Saved collections and history will stay available.', confirmLabel: 'Discard and close all', onConfirm: () => closeAllTabs(true) });
      return;
    }
    setTabs([]); setActiveId(''); setResults({}); setCollectionTabs([]); setActiveCollectionId(null);
  }

  const applicationMenus: { label: string; actions: MenuAction[] }[] = [
    { label: 'File', actions: [
      { label: 'New request', icon: 'plus', onSelect: addRequest },
      { label: 'New collection', icon: 'folder', onSelect: () => { setCollectionName(''); setModal('collection'); } },
      { label: 'Import workspace', icon: 'upload', onSelect: openImport, separator: true },
      { label: 'Export workspace', icon: 'download', onSelect: exportWorkspace },
      { label: 'Save request', icon: 'save', onSelect: saveRequest, disabled: !hasRequest, separator: true, shortcut: 'Ctrl/⌘ S' },
      { label: 'Close tab', icon: 'close', onSelect: () => activeOverview ? closeCollectionTab(activeOverview.id) : closeTab(draft.id), disabled: !hasOpenTabs || !!busyId },
      { label: 'Close all tabs', icon: 'close', onSelect: () => closeAllTabs(), disabled: !hasOpenTabs || !!busyId },
    ] },
    { label: 'View', actions: [
      { label: sidebarHidden ? 'Show sidebar' : 'Hide sidebar', icon: 'menu', onSelect: () => { setSidebarHidden(!sidebarHidden); setMobileSidebar(false); } },
      { label: 'Light theme', icon: theme === 'light' ? 'check' : 'sun', onSelect: () => setTheme('light'), separator: true },
      { label: 'Dark theme', icon: theme === 'dark' ? 'check' : 'moon', onSelect: () => setTheme('dark') },
      { label: 'Global environment variables', icon: 'globe', onSelect: () => setModal('environment'), separator: true },
      { label: 'Collection variables', icon: 'folder', disabled: !activeOverview && !collection, onSelect: () => openCollection((activeOverview || collection)!.id, 'variables') },
    ] },
    { label: 'Request', actions: [
      { label: 'Send request', icon: 'send', onSelect: () => void sendRequest(), disabled: !hasRequest || !!busyId, shortcut: 'Ctrl/⌘ ↵' },
      { label: 'Cancel request', icon: 'close', onSelect: () => controller.current?.abort(), disabled: !busyId },
      { label: 'Rename request', icon: 'edit', onSelect: () => renameItem('request', draft.id, draft.name), disabled: !hasRequest, separator: true },
      { label: 'Duplicate request', icon: 'copy', onSelect: () => openRequest({ ...duplicateRequest(draft), name: `${draft.name} copy` }), disabled: !hasRequest },
      { label: 'Generate cURL', icon: 'code', onSelect: () => setModal('curl'), disabled: !hasRequest, separator: true },
    ] },
    { label: 'Help', actions: [
      { label: 'Keyboard shortcuts', icon: 'terminal', onSelect: () => setModal('shortcuts'), shortcut: '?' },
      { label: 'Request engine status', icon: 'globe', onSelect: () => { void checkBackend(); setModal('engine'); } },
      { label: 'About Reqora', icon: 'layers', onSelect: () => setModal('about'), separator: true },
    ] },
  ];

  function downloadResponse() {
    if (!response) return;
    const type = response.headers.find(header => header.name.toLowerCase() === 'content-type')?.value || 'application/octet-stream';
    const content = response.encoding === 'base64' ? Uint8Array.from(atob(response.body), character => character.charCodeAt(0)) : response.body;
    download(`response.${type.includes('json') ? 'json' : type.startsWith('text/') ? 'txt' : 'bin'}`, content, type);
  }

  let curl = '';
  if (modal === 'curl') { try { curl = toCurl(prepareWorkspaceRequest(workspace, draft)); } catch (error) { curl = (error as Error).message; } }

  return <div className={`app-shell ${sidebarHidden ? 'sidebar-hidden' : ''}`}>
    <aside className="activity-rail" aria-label="Workspace navigation">
      <div className="brand-mark" {...brandingInteractionProps}><img src={logo} alt="Reqora" draggable={false} /></div>
      <button title="Collections" aria-label="Collections" className={`rail-button ${sidebarTab === 'collections' ? 'active' : ''}`} onClick={() => { setSidebarTab('collections'); setSidebarHidden(false); setMobileSidebar(true); }}><Icon name="collection" size={21} /></button>
      <button title="History" aria-label="History" className={`rail-button ${sidebarTab === 'history' ? 'active' : ''}`} onClick={() => { setSidebarTab('history'); setSidebarHidden(false); setMobileSidebar(true); }}><Icon name="history" size={22} /></button>
      <button title="Global environment variables" aria-label="Global environment variables" className="rail-button" onClick={() => setModal('environment')}><Icon name="globe" size={21} /></button>
      <div className="rail-spacer" />
      <button title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} aria-label="Toggle theme" className="rail-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={20} /></button>
      <div className="avatar" title="Your local workspace">L</div>
    </aside>
    {mobileSidebar && <button className="sidebar-backdrop" aria-label="Close sidebar" onClick={() => setMobileSidebar(false)} />}
    <aside className={`sidebar ${mobileSidebar ? 'mobile-open' : ''}`}>
      <div className="workspace-brand" {...brandingInteractionProps}><span>reqora<span className="brand-period">.</span></span><span className="version-badge">BETA</span></div>
      <div className="workspace-switch"><div className="workspace-icon"><Icon name="layers" size={18} /></div><div><strong>My workspace</strong><span>Local · Personal</span></div><Icon name="lock" size={13} /></div>
      <label className="sidebar-search"><Icon name="search" size={15} /><input aria-label="Search requests" placeholder="Search requests..." value={search} onChange={event => setSearch(event.target.value)} /><kbd>⌕</kbd></label>
      <div className="sidebar-section-heading"><span>{sidebarTab === 'collections' ? 'YOUR COLLECTIONS' : 'RECENT REQUESTS'}</span><button className="icon-button" title={sidebarTab === 'collections' ? 'New collection' : 'Clear history'} onClick={() => {
        if (sidebarTab === 'collections') { setCollectionName(''); setModal('collection'); }
        else if (workspace.history.length) setConfirmation({ title: 'Clear request history?', description: 'All recent request attempts will be removed. Your saved requests and collections will stay available.', confirmLabel: 'Clear history', onConfirm: () => { setWorkspace(current => ({ ...current, history: [] })); setToast('History cleared.'); } });
      }}><Icon name={sidebarTab === 'collections' ? 'plus' : 'trash'} size={15} /></button></div>
      <div className="sidebar-content">
        {sidebarTab === 'collections' ? <>
          {workspace.collections.map(item => {
            const requests = workspace.saved.filter(saved => saved.collectionId === item.id && `${saved.request.name} ${saved.request.url} ${saved.request.method}`.toLowerCase().includes(search.toLowerCase()));
            return <section className="collection-group" key={item.id}>
              <div className={`collection-row ${activeOverview?.id === item.id ? 'overview-selected' : ''}`}><button className="icon-button collection-toggle" aria-label={`${collapsed.includes(item.id) ? 'Expand' : 'Collapse'} ${item.name}`} onClick={() => setCollapsed(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])} aria-expanded={!collapsed.includes(item.id)}><Icon name="chevron" size={12} className={!collapsed.includes(item.id) ? 'expanded' : ''} /></button><button className="collection-heading" onClick={() => openCollection(item.id)} title={`Open ${item.name} overview`}><Icon name="folder" size={17} /><span>{item.name}</span><small>{requests.length}</small></button><ActionMenu label={`Options for collection ${item.name}`} actions={collectionActions(item)} /></div>
              {!collapsed.includes(item.id) && <div className="collection-requests">{requests.map(({ request }) => <div className={`saved-request ${!activeOverview && activeId === request.id ? 'active' : ''}`} key={request.id}>
                <button onClick={() => openRequest(request)} title={request.url}><span className={`method-label method-${request.method.toLowerCase()}`}>{request.method}</span><span>{request.name}</span></button>
                <ActionMenu label={`Options for request ${request.name}`} actions={requestActions(request, item)} />
              </div>)}{!requests.length && <span className="collection-empty">{search ? 'No matching requests' : 'No saved requests yet'}</span>}</div>}
            </section>;
          })}
          <button className="sidebar-new-request" onClick={addRequest}><Icon name="plus" size={15} /> New request</button>
        </> : <>{workspace.history.filter(item => `${item.request.name} ${item.request.url}`.toLowerCase().includes(search.toLowerCase())).map(item => <button className="history-item" key={item.id} onClick={() => openRequest({ ...item.request, collectionId: item.request.collectionId ?? getRequestCollection(workspace, item.request)?.id, id: crypto.randomUUID() })} title={item.request.url}>
          <div><span className={`method-label method-${item.request.method.toLowerCase()}`}>{item.request.method}</span><span>{item.request.name}</span><small className={item.status && item.status < 400 ? 'success-text' : 'error-text'}>{item.status || 'ERR'}</small></div><span className="history-time">{new Date(item.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{item.durationMs !== undefined && ` · ${item.durationMs} ms`}</span>
        </button>)}{!workspace.history.length && <div className="sidebar-empty"><Icon name="history" size={28} /><p>A fresh start.</p><span>Sent requests will appear here.</span></div>}</>}
      </div>
      <div className="sidebar-bottom"><div className="workspace-transfer"><button onClick={openImport}><Icon name="upload" size={16} /> Import</button><button title="Export workspace, including saved credentials and variables" onClick={exportWorkspace}><Icon name="download" size={16} /> Export</button></div><p><Icon name="lock" size={13} /> Your workspace stays on this device</p></div>
    </aside>

    <main className="main-workspace">
      <header className="topbar app-topbar">
        <button className="icon-button mobile-menu" aria-label="Open sidebar" onClick={() => { setSidebarHidden(false); setMobileSidebar(true); }}><Icon name="menu" /></button>
        <nav className="app-menu-bar" aria-label="Application menu" data-app-menu-bar>{applicationMenus.map(menu => <ActionMenu key={menu.label} label={`${menu.label} menu`} triggerLabel={menu.label} actions={menu.actions} />)}</nav>
        <div className="topbar-actions"><span className="local-badge"><span className="status-dot" /> Local workspace</span><button className="environment-button" onClick={() => setModal('environment')} title="Edit global environment variables"><Icon name="globe" size={17} /><span>Global variables</span><span className="environment-count">{getVariableScope(workspace.variables).length}</span></button></div>
      </header>
      {hasOpenTabs && <div className="request-tabs" role="tablist" aria-label="Open workspace tabs">
        {openCollections.map(item => <div className={`request-tab collection-workspace-tab ${activeOverview?.id === item.id ? 'active' : ''}`} key={`collection:${item.id}`}><button role="tab" aria-selected={activeOverview?.id === item.id} onClick={() => openCollection(item.id)}><Icon name="folder" size={14} /><span>{item.name}</span></button><button className="tab-close" aria-label={`Close collection ${item.name}`} onClick={() => closeCollectionTab(item.id)}><Icon name="close" size={12} /></button></div>)}
        {tabs.map(tab => <div className={`request-tab ${!activeOverview && activeId === tab.id ? 'active' : ''}`} key={tab.id}><button role="tab" aria-selected={!activeOverview && activeId === tab.id} onClick={() => { setActiveId(tab.id); setActiveCollectionId(null); }}><span className={`method-label method-${tab.method.toLowerCase()}`}>{tab.method}</span><span>{tab.name}</span>{(!workspace.saved.some(item => item.request.id === tab.id && JSON.stringify(item.request) === JSON.stringify(tab))) && <span className="unsaved-dot" title="Unsaved changes" />}</button><button className="tab-close" aria-label={`Close ${tab.name}`} onClick={() => closeTab(tab.id)}><Icon name="close" size={12} /></button></div>)}
        <button className="icon-button new-tab" aria-label="New request" title="New request" onClick={addRequest}><Icon name="plus" size={18} /></button>
      </div>}

      {activeOverview ? <CollectionOverview key={activeOverview.id} collection={activeOverview} requests={workspace.saved.filter(item => item.collectionId === activeOverview.id).map(item => item.request)} globals={workspace.variables} section={collectionSection} onSectionChange={setCollectionSection} onChange={changes => setWorkspace(current => ({ ...current, collections: current.collections.map(item => item.id === activeOverview.id ? { ...item, ...changes } : item) }))} onOpenRequest={openRequest} onNewRequest={() => createCollectionRequest(activeOverview.id)} onGlobals={() => setModal('environment')} actions={collectionActions(activeOverview)} requestActions={request => requestActions(request, activeOverview)} /> : hasRequest ? <div className="request-workspace">
        <div className="request-heading"><div className="request-location"><Icon name="folder" size={16} /><button className="request-collection-link" disabled={!collection} onClick={() => collection && openCollection(collection.id)}>{collection?.name || 'Scratchpad'}</button><Icon name="chevron" size={12} /><input aria-label="Request name" value={draft.name} onChange={event => updateDraft({ name: event.target.value })} /></div><div className="request-actions"><button className="text-button code-button" title="Generate cURL command" onClick={() => setModal('curl')}><Icon name="code" size={16} /> Code</button><button className="button button-secondary save-button" onClick={saveRequest}><Icon name="save" size={15} /> Save{dirty && <span className="unsaved-dot" />}</button></div></div>
        <form className="url-bar" onSubmit={event => { event.preventDefault(); void sendRequest(); }}>
          <div className="url-input-group"><select className={`method-select method-${draft.method.toLowerCase()}`} aria-label="HTTP method" value={draft.method} onChange={event => updateDraft({ method: event.target.value })}>{METHODS.map(method => <option key={method}>{method}</option>)}</select><div className="url-divider" /><input className="url-input" aria-label="Request URL" placeholder="Enter a URL or paste an endpoint" value={draft.url} onChange={event => updateDraft({ url: event.target.value })} spellCheck={false} autoComplete="off" /><span className="url-protocol"><Icon name="lock" size={14} /></span></div>
          {busyId === draft.id ? <button className="button send-button cancelling" type="button" onClick={() => controller.current?.abort()}><span className="spinner small" /> Cancel</button> : <button className="button send-button" type="submit" disabled={!!busyId}><span>Send</span><Icon name="arrow" size={17} /></button>}
        </form>
        <div className="request-variable-scope" aria-label="Variable hierarchy">
          <Icon name={collection ? 'folder' : 'globe'} size={14} />
          {collection && <><button onClick={() => openCollection(collection.id, 'variables')} title="Edit collection variables">{collection.name}</button><Icon name="chevron" size={12} /></>}
          <button onClick={() => setModal('environment')}>Global environment</button><span>{effectiveVariables.length} effective variable{effectiveVariables.length === 1 ? '' : 's'}</span>
        </div>
        <div className="request-editor"><nav className="editor-tabs" aria-label="Request configuration">{(['Params', 'Headers', 'Body', 'Auth', 'Settings'] as EditorTab[]).map(tab => <button key={tab} className={editorTab === tab ? 'active' : ''} onClick={() => setEditorTab(tab)}>{tab}{tab === 'Params' && count(draft.params) > 0 && <span className="tab-count">{count(draft.params)}</span>}{tab === 'Headers' && count(draft.headers) > 0 && <span className="tab-count">{count(draft.headers)}</span>}{tab === 'Auth' && draft.authType !== 'none' && <Icon name="lock" size={11} />}{tab === 'Body' && draft.bodyType !== 'none' && !['GET', 'HEAD'].includes(draft.method) && <span className="configured-dot" />}</button>)}<span className="editor-hint">Use <code>{'{{variables}}'}</code> anywhere</span></nav>
          <div className="editor-content">
            {editorTab === 'Params' && <><div className="panel-label">Query parameters <span>Added to the URL when you send</span></div><KeyValueEditor rows={draft.params} onChange={params => updateDraft({ params })} /></>}
            {editorTab === 'Headers' && <><div className="panel-label">Request headers <span>Only checked rows are sent</span></div><KeyValueEditor rows={draft.headers} kind="header" onChange={headers => updateDraft({ headers })} /></>}
            {editorTab === 'Body' && (['GET', 'HEAD'].includes(draft.method) ? <div className="inline-empty"><Icon name="file" size={24} /><div><strong>This request has no body</strong><p>{draft.method} requests send parameters in the URL. Choose POST, PUT, PATCH, or DELETE to send a body.</p></div></div> : <><div className="body-options">{(['none', 'json', 'text', 'form'] as const).map(type => <label key={type}><input type="radio" name="bodyType" checked={draft.bodyType === type} onChange={() => updateDraft({ bodyType: type })} />{{ none: 'None', json: 'JSON', text: 'Text', form: 'URL encoded' }[type]}</label>)}{draft.bodyType === 'json' && <button className="text-button format-button" onClick={() => { try { updateDraft({ body: JSON.stringify(JSON.parse(draft.body), null, 2) }); } catch { setToast('Enter valid JSON before formatting.'); } }}>Format JSON</button>}</div>{draft.bodyType === 'none' ? <div className="body-none">Choose a body type to include content with this request.</div> : <textarea className="body-editor" aria-label="Request body" spellCheck={false} placeholder={draft.bodyType === 'json' ? '{\n  "message": "Hello, world"\n}' : draft.bodyType === 'form' ? 'name=Reqora&hello=world' : 'Write your request body here...'} value={draft.body} onChange={event => updateDraft({ body: event.target.value })} />}</>)}
            {editorTab === 'Auth' && <div className="auth-panel"><div className="auth-type"><label className="field-label" htmlFor="auth-type">Authorization type</label><select id="auth-type" className="field-input" value={draft.authType} onChange={event => updateDraft({ authType: event.target.value as Draft['authType'] })}><option value="none">No authentication</option><option value="bearer">Bearer token</option><option value="basic">Basic authentication</option></select><p>Authorization is added to the request headers automatically.</p></div><div className="auth-fields">{draft.authType === 'none' ? <div className="auth-empty"><Icon name="lock" size={25} /><p>This request does not use authentication.</p></div> : draft.authType === 'bearer' ? <label className="field-label">Token<input className="field-input" type="password" autoComplete="off" placeholder="Enter token or {{token}}" value={draft.token} onChange={event => updateDraft({ token: event.target.value })} /></label> : <><label className="field-label">Username<input className="field-input" autoComplete="off" value={draft.username} onChange={event => updateDraft({ username: event.target.value })} /></label><label className="field-label">Password<input className="field-input" type="password" autoComplete="off" value={draft.password} onChange={event => updateDraft({ password: event.target.value })} /></label></>}</div></div>}
            {editorTab === 'Settings' && <div className="settings-panel"><div><label className="field-label" htmlFor="timeout">Request timeout</label><p>Time to wait before cancelling the request.</p></div><label className="timeout-input"><input id="timeout" type="number" min="0.1" max="60" step="0.1" value={draft.timeoutMs / 1000} onChange={event => updateDraft({ timeoutMs: Number(event.target.value) * 1000 })} /><span>seconds</span></label><div><strong>Follow redirects</strong><p>Automatically follow HTTP redirect responses.</p></div><input className="toggle-check" aria-label="Follow redirects" type="checkbox" checked={draft.followRedirects} onChange={event => updateDraft({ followRedirects: event.target.checked })} /></div>}
          </div>
        </div>

        <section className="response-panel" aria-label="Response"><div className="response-heading"><div className="response-title"><Icon name="terminal" size={17} /><strong>Response</strong>{response && <span className={`response-status ${response.status < 400 ? 'status-success' : 'status-error'}`}>{response.status} {response.statusText}</span>}</div>{response ? <div className="response-metrics"><span><Icon name="history" size={13} />{response.durationMs} <small>ms</small></span><span><Icon name="file" size={13} />{formatSize(response.size)}</span><button className="icon-button" title="Download response" aria-label="Download response" onClick={downloadResponse}><Icon name="download" size={16} /></button></div> : <span className="response-placeholder-label">{busyId === draft.id ? 'REQUEST IN PROGRESS' : 'READY WHEN YOU ARE'}</span>}</div>
          {busyId === draft.id ? <div className="response-empty" role="status"><div className="sending-orbit"><Icon name="send" size={28} /></div><h2>On its way.</h2><p>Waiting for your server to respond…</p><button className="text-button" onClick={() => controller.current?.abort()}>Cancel request</button></div> : result?.error ? <div className="response-empty error-state" role="alert"><div className="empty-illustration"><Icon name="alert" size={28} /></div><h2>{result.error === 'Request cancelled.' ? 'Request cancelled' : 'Something needs a second look'}</h2><p>{result.error}</p><button className="button button-secondary" onClick={() => void sendRequest()}><Icon name="send" size={14} /> Try again</button></div> : response ? <>
            <div className="response-toolbar"><nav aria-label="Response view"><button className={responseTab === 'Body' ? 'active' : ''} onClick={() => setResponseTab('Body')}>Body</button><button className={responseTab === 'Headers' ? 'active' : ''} onClick={() => setResponseTab('Headers')}>Headers <span>{response.headers.length}</span></button></nav><div className="response-view-actions">{responseTab === 'Body' && response.encoding === 'utf8' && <div className="segmented-control"><button className={pretty ? 'active' : ''} onClick={() => setPretty(true)}>Pretty</button><button className={!pretty ? 'active' : ''} onClick={() => setPretty(false)}>Raw</button></div>}<button className="icon-button" title="Copy response" aria-label="Copy response" onClick={() => void copy(responseTab === 'Headers' ? response.headers.map(header => `${header.name}: ${header.value}`).join('\n') : formatBody(response, pretty))}><Icon name="copy" size={15} /></button></div></div>
            <div className="response-content">{responseTab === 'Headers' ? <div className="response-headers">{response.headers.map((header, index) => <div key={index}><span>{header.name}</span><span>{header.value}</span></div>)}</div> : response.encoding === 'base64' ? <div className="response-empty"><Icon name="file" size={32} /><h2>Binary response</h2><p>{formatSize(response.size)} received. Download the response to open it.</p><button className="button button-secondary" onClick={downloadResponse}><Icon name="download" size={15} /> Download</button></div> : !response.body ? <div className="response-empty"><Icon name="check" size={28} /><h2>Request complete</h2><p>The server returned an empty response body.</p></div> : <CodeView text={formatBody(response, pretty)} highlight={pretty && response.headers.some(header => header.name.toLowerCase() === 'content-type' && header.value.includes('json'))} />}</div>
            <div className="response-url" title={response.url}><Icon name="globe" size={11} />{response.url}</div>
          </> : <div className="response-empty"><div className="empty-art"><div className="empty-art-orbit orbit-one" /><div className="empty-art-orbit orbit-two" /><div className="empty-illustration"><Icon name="send" size={28} /></div><span className="art-spark spark-one" /><span className="art-spark spark-two" /></div><h2>A little curiosity. A new request.</h2><p>Enter an endpoint, make it yours, and hit Send.<br />Your response will land right here.</p><div className="shortcut-hint"><kbd>Ctrl</kbd><span>+</span><kbd>Enter</kbd><span>to send a request</span></div></div>}
        </section>
      </div> : <Startup requests={workspace.saved.map(item => item.request)} onNew={addRequest} onOpen={openRequest} onImport={openImport} onCollection={() => { setCollectionName(''); setModal('collection'); }} onShortcuts={() => setModal('shortcuts')} />}
      <footer className="statusbar app-statusbar" aria-label="Application status">
        <div className="statusbar-left"><button className="engine-status" onClick={() => { void checkBackend(); setModal('engine'); }} title="Request engine details"><span className={`status-dot ${backend === 'online' ? '' : 'offline'}`} />{backend === 'online' ? 'Engine online' : backend === 'checking' ? 'Connecting…' : 'Engine offline'}</button><span className="storage-status"><Icon name="lock" size={13} />{storageError ? 'Storage unavailable' : 'Local workspace'}</span></div>
        <div className="statusbar-right"><span className="request-status">{busyId ? 'Request in progress…' : activeOverview ? 'Collection saved locally' : hasRequest ? dirty ? 'Unsaved changes' : 'All changes saved' : 'Ready to create'}</span><button className="statusbar-environment" title="View effective variable scope" onClick={() => scopeCollection ? openCollection(scopeCollection.id, 'variables') : setModal('environment')}><Icon name="globe" size={14} />{effectiveVariables.length} variable{effectiveVariables.length === 1 ? '' : 's'}</button><button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label="Toggle theme"><Icon name={theme === 'light' ? 'moon' : 'sun'} size={14} /></button><button onClick={() => setModal('shortcuts')} title="Keyboard shortcuts"><Icon name="terminal" size={14} /></button></div>
      </footer>
    </main>

    {toast && <div className="toast" role="status"><Icon name="check" size={17} /><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><Icon name="close" size={14} /></button></div>}
    {modal === 'save' && <Modal title="Save request" onClose={() => setModal(null)}>
      <form noValidate onSubmit={event => { event.preventDefault(); if (!saveName.trim()) { setDialogError('Enter a request name.'); return; } if (collectionId) persistRequest(saveName, collectionId); }}>
        <label className="field-label">Request name<input className="field-input" aria-required="true" value={saveName} onChange={event => setSaveName(event.target.value)} /></label>
        <label className="field-label">Collection<select className="field-input" aria-required="true" value={collectionId} onChange={event => setCollectionId(event.target.value)}>{workspace.collections.map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select></label>
        {!workspace.collections.length && <p className="dialog-error" role="alert">Create a collection from the sidebar before saving this request.</p>}
        {dialogError && <p className="dialog-error" role="alert">{dialogError}</p>}
        <div className="modal-footer"><button type="button" className="button button-secondary" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" type="submit" disabled={!collectionId || !saveName.trim()}>Save request</button></div>
      </form>
    </Modal>}
    {modal === 'collection' && <Modal title="New collection" onClose={() => setModal(null)}>
      <form noValidate onSubmit={event => { event.preventDefault(); if (!collectionName.trim()) { setDialogError('Enter a collection name.'); return; } const created = { id: crypto.randomUUID(), name: collectionName.trim(), description: '', variables: [] }; setWorkspace(current => ({ ...current, collections: [...current.collections, created] })); setModal(null); openCollection(created.id); }}>
        <p className="modal-description">Give related requests a place to call home.</p>
        <label className="field-label">Collection name<input className="field-input" placeholder="e.g. Payments API" value={collectionName} onChange={event => setCollectionName(event.target.value)} aria-required="true" /></label>
        {dialogError && <p className="dialog-error" role="alert">{dialogError}</p>}
        <div className="modal-footer"><button className="button button-secondary" type="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" type="submit" disabled={!collectionName.trim()}>Create collection</button></div>
      </form>
    </Modal>}
    {modal === 'environment' && <Modal title="Global environment variables" wide onClose={() => setModal(null)}>
      <p className="modal-description">Shared fallback values for every request. An enabled collection variable with the same name takes priority. Reference values with <code>{'{{base_url}}'}</code>; nested variable references are supported.</p>
      <KeyValueEditor rows={workspace.variables} kind="variable" onChange={variables => setWorkspace(current => ({ ...current, variables }))} />
      <div className="environment-note"><Icon name="lock" size={14} />Values are stored in this browser and included in workspace exports.</div>
      <div className="modal-footer"><button className="button button-primary" onClick={() => setModal(null)}>Done</button></div>
    </Modal>}
    {modal === 'curl' && <Modal title="Generate code" wide onClose={() => setModal(null)}>
      <p className="modal-description">Run this cURL command in a POSIX shell. Environment variables are resolved to their current values.</p>
      <div className="code-language"><Icon name="terminal" size={15} /> cURL · Shell</div><pre className="curl-preview">{curl}</pre>
      <div className="modal-footer"><button className="button button-secondary" onClick={() => setModal(null)}>Close</button><button className="button button-primary" onClick={() => void copy(curl, 'cURL command copied.')}><Icon name="copy" size={15} />{toast === 'cURL command copied.' ? 'Copied!' : 'Copy command'}</button></div>
    </Modal>}
    {modal === 'rename' && <Modal title={actionTarget?.kind === 'collection' ? 'Rename collection' : 'Rename request'} onClose={() => setModal(null)}>
      <form noValidate onSubmit={event => { event.preventDefault(); commitRename(); }}>
        <label className="field-label">Name<input className="field-input" value={actionName} onChange={event => setActionName(event.target.value)} aria-required="true" /></label>
        {dialogError && <p className="dialog-error" role="alert">{dialogError}</p>}
        <div className="modal-footer"><button type="button" className="button button-secondary" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" type="submit" disabled={!actionName.trim()}>Save name</button></div>
      </form>
    </Modal>}
    {modal === 'move' && <Modal title="Move request" onClose={() => setModal(null)}>
      <p className="modal-description">Choose a collection for this saved request. Open tabs and unsaved edits will stay available.</p>
      <label className="field-label">Destination collection<select className="field-input" value={moveCollectionId} onChange={event => setMoveCollectionId(event.target.value)}>{workspace.collections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="modal-footer"><button className="button button-secondary" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" disabled={!moveCollectionId} onClick={() => {
        if (!actionTarget) return;
        setWorkspace(current => ({ ...current, saved: current.saved.map(item => item.request.id === actionTarget.id ? { ...item, collectionId: moveCollectionId, request: { ...item.request, collectionId: moveCollectionId } } : item) }));
        setTabs(current => current.map(tab => tab.id === actionTarget.id ? { ...tab, collectionId: moveCollectionId } : tab));
        setModal(null); setToast('Request moved.');
      }}>Move request</button></div>
    </Modal>}
    {modal === 'import' && <Modal title={pendingImport ? 'Replace your workspace?' : 'Import workspace'} wide onClose={() => setModal(null)}>
      {pendingImport ? <>
        <p className="modal-description">This import will replace your saved collections, request history, and environment variables. Open request tabs will stay available. Export your current workspace first if you want to keep a backup.</p>
        <div className="import-summary"><div><strong>{pendingImport.collections.length}</strong><span>Collections</span></div><div><strong>{pendingImport.saved.length}</strong><span>Requests</span></div><div><strong>{pendingImport.variables.length}</strong><span>Variables</span></div></div>
        <div className="modal-footer"><button className="button button-secondary" onClick={() => setPendingImport(null)} data-dialog-initial-focus>Back</button><button className="button button-danger" onClick={() => { setWorkspace(pendingImport); setModal(null); setToast('Workspace imported.'); }}>Replace workspace</button></div>
      </> : <>
        <p className="modal-description">Drop a Reqora JSON export here or paste its contents below. You can review it before replacing your workspace.</p>
        <div className={`import-drop-zone ${draggingImport ? 'dragging' : ''}`} role="region" aria-label="Drop a workspace file" onDragOver={event => { event.preventDefault(); setDraggingImport(true); }} onDragLeave={() => setDraggingImport(false)} onDrop={event => {
          event.preventDefault(); setDraggingImport(false);
          if (event.dataTransfer.files.length !== 1) { setDialogError('Drop one workspace JSON file at a time.'); return; }
          void readImportFile(event.dataTransfer.files[0]);
        }}><Icon name="upload" size={26} /><strong>Drop your workspace file</strong><span>Reqora JSON · Up to 5 MB · Processed locally</span></div>
        <label className="field-label">Or paste workspace JSON<textarea className="import-json" value={importText} placeholder={'{ "version": 1, "collections": [...] }'} onChange={event => { setImportText(event.target.value); setDialogError(''); }} spellCheck={false} /></label>
        {dialogError && <p className="dialog-error" role="alert">{dialogError}</p>}
        <div className="modal-footer"><button className="button button-secondary" onClick={() => setModal(null)}>Cancel</button><button className="button button-primary" onClick={() => reviewImport(importText)}>Review import</button></div>
      </>}
    </Modal>}
    {modal === 'shortcuts' && <Modal title="Keyboard shortcuts" onClose={() => setModal(null)}>
      <p className="modal-description">A few useful ways to move through your workspace.</p>
      <div className="shortcut-list"><div><span>Send the active request</span><kbd>Ctrl / ⌘ + Enter</kbd></div><div><span>Save the active request</span><kbd>Ctrl / ⌘ + S</kbd></div><div><span>Show keyboard shortcuts</span><kbd>?</kbd></div><div><span>Navigate a menu</span><kbd>↑ ↓ ← →</kbd></div><div><span>Move between controls</span><kbd>Tab / Shift + Tab</kbd></div><div><span>Close a menu or dialog</span><kbd>Esc</kbd></div></div>
      <div className="modal-footer"><button className="button button-primary" onClick={() => setModal(null)}>Done</button></div>
    </Modal>}
    {modal === 'engine' && <Modal title="Request engine" onClose={() => setModal(null)}>
      <div className="engine-health"><span className={`status-dot ${backend === 'online' ? '' : 'offline'}`} /><strong>{backend === 'online' ? 'Connected and ready' : backend === 'checking' ? 'Checking connection…' : 'Engine is unavailable'}</strong></div>
      <p className="modal-description">Your requests are sent by the local Node.js engine, shared by the web and desktop apps.</p>
      <dl className="engine-details"><div><dt>Protocols</dt><dd>HTTP and HTTPS</dd></div><div><dt>Request limit</dt><dd>1 MB</dd></div><div><dt>Response limit</dt><dd>5 MB</dd></div><div><dt>Timeout range</dt><dd>0.1–60 seconds</dd></div><div><dt>TLS certificates</dt><dd>Verified</dd></div></dl>
      <div className="modal-footer"><button className="button button-secondary" disabled={backend === 'checking'} onClick={() => void checkBackend()}>Check connection</button><button className="button button-primary" onClick={() => setModal(null)}>Done</button></div>
    </Modal>}
    {modal === 'about' && <Modal title="About Reqora" onClose={() => setModal(null)}>
      <div className="about-brand" {...brandingInteractionProps}><img src={logo} alt="Reqora" draggable={false} /><div><strong>Reqora</strong><span>Version 0.1.0 · MIT License</span></div></div>
      <p className="modal-description">A free, open-source REST client for exploring and testing APIs. One shared TypeScript workspace, in your browser and on your desktop.</p>
      <p className="modal-description">This early release includes request execution, collections, local history, environment variables, and workspace import/export.</p>
      <div className="modal-footer"><button className="button button-primary" onClick={() => setModal(null)}>Back to workspace</button></div>
    </Modal>}
    {confirmation && <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />}
  </div>;
}
