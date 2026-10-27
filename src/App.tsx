import { useEffect, useRef, useState } from 'react';
import logo from '../assets/logo-full.png';
import Icon from './components/Icon';
import KeyValueEditor from './components/KeyValueEditor';
import ResponseInspector from './components/ResponseInspector';
import type { ResponseView } from './components/ResponseInspector';
import { responseCookies } from './components/ResponseInspector';
import { importWorkspace } from './lib/importers';
import BodyEditor from './components/BodyEditor';
import { readRequestFiles } from './lib/attachments';
import { applyVariableChanges } from '../shared/automation';
import type { ExecutionResult } from '../shared/automation';
import { executeAutomation } from './lib/execution';
import ScriptEditor from './components/ScriptEditor';
import ChecksEditor from './components/ChecksEditor';
import AutomationResults from './components/AutomationResults';
import CollectionRunner from './components/CollectionRunner';
import AuthEditor from './components/AuthEditor';
import CookieEditor from './components/CookieEditor';
import RequestSettings from './components/RequestSettings';
import { applyAuthenticationUpdates, authConfigurationKey, effectiveAuth, normalizedAuth } from '../shared/auth';
import type { AuthenticationUpdate } from '../shared/auth';
import { authenticationCurl } from './lib/auth-client';
import Modal, { ConfirmDialog } from './components/Dialog';
import type { Confirmation } from './components/Dialog';
import ActionMenu from './components/ActionMenu';
import type { MenuAction } from './components/ActionMenu';
import Startup from './components/Startup';
import CollectionOverview from './components/CollectionOverview';
import type { CollectionSection } from './components/CollectionOverview';
import { closeRequestTab, formatSize, getRequestCollection, getVariableScope, newDraft } from './lib/workspace';
import type { Collection, Draft, Workspace } from './lib/workspace';
import { emptyWorkspace, loadWorkspaceStore, STORE_KEY } from './lib/workspace-store';
import type { WorkspaceRecord } from './lib/workspace-store';
import { activeEnvironment, workspaceGlobals } from './lib/workspace';
import { brandingInteractionProps } from './lib/branding';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
type Result = Partial<ExecutionResult>;
type EditorTab = 'Params' | 'Headers' | 'Body' | 'Auth' | 'Scripts' | 'Tests' | 'Settings';

function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [workspaceStore, setWorkspaceStore] = useState(() => loadWorkspaceStore(localStorage));
  const workspace = workspaceStore.workspaces.find(item => item.id === workspaceStore.activeId)!.data;
  const workspaceName = workspaceStore.workspaces.find(item => item.id === workspaceStore.activeId)!.name;
  function setWorkspace(update: Workspace | ((current: Workspace) => Workspace)) {
    setWorkspaceStore(current => ({ ...current, workspaces: current.workspaces.map(item => item.id === current.activeId ? { ...item, data: typeof update === 'function' ? update(item.data) : update } : item) }));
  }
  const [tabs, setTabs] = useState<Draft[]>([]);
  const [activeId, setActiveId] = useState('');
  const [collectionTabs, setCollectionTabs] = useState<string[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [collectionSection, setCollectionSection] = useState<CollectionSection>('overview');
  const [emptyDraft] = useState(newDraft);
  const [editorTab, setEditorTab] = useState<EditorTab>('Params');
  const [curl, setCurl] = useState('');
  const [responseTab, setResponseTab] = useState<ResponseView>('Body');
  const [pretty, setPretty] = useState(true);
  const [responseSearch, setResponseSearch] = useState('');
  const [importFormat, setImportFormat] = useState('Reqora');
  const [results, setResults] = useState<Record<string, Result>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'collections' | 'history'>('collections');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [modal, setModal] = useState<'workspaces' | 'save' | 'collection' | 'environment' | 'cookies' | 'curl' | 'import' | 'rename' | 'move' | 'shortcuts' | 'about' | 'engine' | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [importText, setImportText] = useState('');
  const [runnerCollectionId, setRunnerCollectionId] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<Workspace | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [draggingImport, setDraggingImport] = useState(false);
  const [actionTarget, setActionTarget] = useState<{ kind: 'request' | 'collection'; id: string } | null>(null);
  const [actionName, setActionName] = useState('');
  const [moveCollectionId, setMoveCollectionId] = useState('');
  const [saveName, setSaveName] = useState('');
  const [collectionId, setCollectionId] = useState(workspace.collections[0]?.id || '');
  const [collectionName, setCollectionName] = useState('');
  const [workspaceDraftName, setWorkspaceDraftName] = useState('');
  const [environmentDraftName, setEnvironmentDraftName] = useState('');
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
  const effectiveVariables = getVariableScope(workspaceGlobals(workspace), scopeCollection?.variables);
  const count = (rows: Draft['params']) => rows.filter(row => row.enabled && row.name.trim()).length;

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(workspaceStore)); setStorageError(false); }
    catch { setStorageError(true); }
  }, [workspaceStore]);
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
      if (modal || confirmation || runnerCollectionId) return;
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

  function updateTabAuthentication(updates: AuthenticationUpdate[]) {
    setTabs(current => current.map(tab => {
      const update = updates.find(item => item.scope === 'request' && item.id === tab.id);
      return update && tab.authType === 'oauth2' && authConfigurationKey(tab) === update.configurationKey
        ? { ...tab, oauth2: { ...normalizedAuth(tab).oauth2, ...update.oauth2 } } : tab;
    }));
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
    const snapshot = { ...structuredClone(draft), ...(collection ? { collectionId: collection.id } : {}) };
    const abort = new AbortController();
    controller.current = abort;
    setBusyId(id);
    setResults(current => ({ ...current, [id]: {} }));
    const history = { id: crypto.randomUUID(), date: new Date().toISOString(), request: snapshot };
    try {
      const files = Object.fromEntries(await readRequestFiles(snapshot, abort.signal));
      const outcome = await executeAutomation({ request: snapshot, globals: workspaceGlobals(workspace), collection, files, cookies: workspace.cookies }, abort.signal);
      setResults(current => ({ ...current, [id]: outcome }));
      setWorkspace(current => ({ ...applyAuthenticationUpdates(applyVariableChanges(current, outcome.changes, collection?.id), outcome.authUpdates), ...(outcome.cookies ? { cookies: outcome.cookies } : {}), history: [{ ...history, status: outcome.response?.status, durationMs: outcome.response?.durationMs, error: outcome.error }, ...current.history].slice(0, 100) }));
      updateTabAuthentication(outcome.authUpdates || []);
      if (outcome.error || outcome.tests.some(test => !test.passed)) setResponseTab('Tests');
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
      if (new TextEncoder().encode(text).length > 5 * 1024 * 1024) throw new Error('Imports must be smaller than 5 MB.');
      if (!text.trim()) throw new Error('Drop a workspace file or paste its JSON to continue.');
      const imported = importWorkspace(text, workspace);
      setPendingImport(imported.workspace);
      setImportFormat(imported.format);
      setDialogError('');
    } catch (error) { setDialogError(error instanceof SyntaxError ? 'This JSON is invalid. Paste a supported JSON export or cURL command.' : error instanceof Error ? error.message : 'Unable to import this workspace.'); }
  }

  async function readImportFile(file: File) {
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Imports must be smaller than 5 MB.');
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
    return { ...clone, collectionId: getRequestCollection(workspace, request)?.id, id: crypto.randomUUID(), params: clone.params.map(row => ({ ...row, id: crypto.randomUUID() })), headers: clone.headers.map(row => ({ ...row, id: crypto.randomUUID() })), formFields: clone.formFields.map(row => ({ ...row, id: crypto.randomUUID() })), multipartFields: clone.multipartFields.map(row => ({ ...row, id: crypto.randomUUID() })) };
  }

  function exportSelection(collection: Collection, requestId?: string) {
    const selected = workspace.saved.filter(item => item.collectionId === collection.id && (!requestId || item.request.id === requestId));
    const name = requestId ? selected[0]?.request.name || 'request' : collection.name;
    const filename = name.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 80) || 'export';
    download(`reqora-${filename}.json`, JSON.stringify({ version: 1, collections: [collection], saved: selected, history: [], variables: workspace.variables, environments: workspace.environments, activeEnvironmentId: workspace.activeEnvironmentId, cookies: workspace.cookies }, null, 2), 'application/json');
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
        void authenticationCurl(workspace, request).then(command => copy(command, 'cURL command copied.')).catch(error => setToast((error as Error).message));
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
      { label: 'Collection authentication', icon: 'lock', onSelect: () => openCollection(collection.id, 'auth') },
      { label: 'Collection scripts', icon: 'code', onSelect: () => openCollection(collection.id, 'scripts') },
      { label: 'Run collection', icon: 'send', disabled: !requests.length || !!busyId, onSelect: () => setRunnerCollectionId(collection.id) },
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

  function changeWorkspace(id: string) {
    if (id === workspaceStore.activeId) { setModal(null); return; }
    if (busyId || runnerCollectionId) { setToast('Finish or cancel the current run before switching workspaces.'); return; }
    const switchNow = () => {
      setWorkspaceStore(current => ({ ...current, activeId: id }));
      setTabs([]); setActiveId(''); setCollectionTabs([]); setActiveCollectionId(null); setResults({});
      setModal(null); setMobileSidebar(false);
    };
    const unsaved = tabs.some(tab => {
      const original = workspace.saved.find(item => item.request.id === tab.id)?.request;
      return (!original || JSON.stringify(original) !== JSON.stringify(tab)) && (tab.url || tab.body || tab.name !== 'Untitled request' || tab.headers.length || tab.params.length);
    });
    if (unsaved) setConfirmation({ title: 'Switch workspace?', description: 'Unsaved request tab changes will be discarded. Saved requests stay in this workspace.', confirmLabel: 'Discard and switch', onConfirm: switchNow });
    else switchNow();
  }

  function createWorkspace() {
    const name = workspaceDraftName.trim();
    if (workspaceStore.workspaces.length >= 100) { setDialogError('You can keep up to 100 local workspaces.'); return; }
    if (!name) { setDialogError('Enter a workspace name.'); return; }
    const item: WorkspaceRecord = { id: crypto.randomUUID(), name, data: emptyWorkspace() };
    const createNow = () => {
      setWorkspaceStore(current => ({ ...current, workspaces: [...current.workspaces, item], activeId: item.id }));
      setTabs([]); setActiveId(''); setCollectionTabs([]); setActiveCollectionId(null); setResults({});
      setWorkspaceDraftName(''); setModal(null);
    };
    const unsaved = tabs.some(tab => {
      const original = workspace.saved.find(saved => saved.request.id === tab.id)?.request;
      return (!original || JSON.stringify(original) !== JSON.stringify(tab)) && (tab.url || tab.body || tab.name !== 'Untitled request' || tab.headers.length || tab.params.length);
    });
    if (unsaved) setConfirmation({ title: 'Create workspace?', description: 'Unsaved request tab changes will be discarded.', confirmLabel: 'Discard and create', onConfirm: createNow });
    else createNow();
  }

  function deleteWorkspace(id: string) {
    if (workspaceStore.workspaces.length < 2) return;
    const item = workspaceStore.workspaces.find(item => item.id === id);
    if (!item) return;
    setConfirmation({ title: 'Delete workspace?', description: `“${item.name}” and all its saved collections, variables, history, cookies, and unsaved open tabs will be removed. Export it first if you need a backup.`, confirmLabel: 'Delete workspace', onConfirm: () => {
      if (id === workspaceStore.activeId) { setTabs([]); setActiveId(''); setCollectionTabs([]); setActiveCollectionId(null); setResults({}); }
      setWorkspaceStore(current => { const workspaces = current.workspaces.filter(record => record.id !== id); return { ...current, workspaces, activeId: current.activeId === id ? workspaces[0].id : current.activeId }; });
      setModal(null);
    } });
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
      { label: 'Manage workspaces', icon: 'layers', onSelect: () => setModal('workspaces') },
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
      { label: 'Environments', icon: 'globe', onSelect: () => setModal('environment'), separator: true },
      { label: 'Cookie jar', icon: 'layers', onSelect: () => setModal('cookies') },
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

  useEffect(() => {
    if (modal !== 'curl') return;
    const abort = new AbortController();
    setCurl('Generating command…');
    void authenticationCurl(workspace, draft, abort.signal).then(command => { if (!abort.signal.aborted) setCurl(command); }).catch(error => { if (!abort.signal.aborted) setCurl((error as Error).message); });
    return () => abort.abort();
  }, [modal, draft, workspace]);

  return <div className={`app-shell ${sidebarHidden ? 'sidebar-hidden' : ''}`}>
    <aside className="activity-rail" aria-label="Workspace navigation">
      <div className="brand-mark" {...brandingInteractionProps}><img src={logo} alt="Reqora" draggable={false} /></div>
      <button title="Collections" aria-label="Collections" className={`rail-button ${sidebarTab === 'collections' ? 'active' : ''}`} onClick={() => { setSidebarTab('collections'); setSidebarHidden(false); setMobileSidebar(true); }}><Icon name="collection" size={21} /></button>
      <button title="History" aria-label="History" className={`rail-button ${sidebarTab === 'history' ? 'active' : ''}`} onClick={() => { setSidebarTab('history'); setSidebarHidden(false); setMobileSidebar(true); }}><Icon name="history" size={22} /></button>
      <button title="Global environment variables" aria-label="Global environment variables" className="rail-button" onClick={() => setModal('environment')}><Icon name="globe" size={21} /></button>
      <button title="Cookie jar" aria-label="Cookie jar" className="rail-button" onClick={() => setModal('cookies')}><Icon name="layers" size={20} /></button>
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
        <div className="topbar-actions"><span className="local-badge"><span className="status-dot" /> {workspaceName}</span><button className="environment-button" onClick={() => setModal('workspaces')} title="Switch workspace"><Icon name="layers" size={16} /><span>Workspaces</span></button><button className="environment-button" onClick={() => setModal('cookies')} title="Edit cookie jar"><Icon name="layers" size={16} /><span>Cookies</span><span className="environment-count">{workspace.cookies.length}</span></button><button className="environment-button" onClick={() => setModal('environment')} title="Manage environments"><Icon name="globe" size={17} /><span>{activeEnvironment(workspace)?.name || 'Base variables'}</span><span className="environment-count">{getVariableScope(workspaceGlobals(workspace)).length}</span></button></div>
      </header>
      {hasOpenTabs && <div className="request-tabs" role="tablist" aria-label="Open workspace tabs">
        {openCollections.map(item => <div className={`request-tab collection-workspace-tab ${activeOverview?.id === item.id ? 'active' : ''}`} key={`collection:${item.id}`}><button role="tab" aria-selected={activeOverview?.id === item.id} onClick={() => openCollection(item.id)}><Icon name="folder" size={14} /><span>{item.name}</span></button><button className="tab-close" aria-label={`Close collection ${item.name}`} onClick={() => closeCollectionTab(item.id)}><Icon name="close" size={12} /></button></div>)}
        {tabs.map(tab => <div className={`request-tab ${!activeOverview && activeId === tab.id ? 'active' : ''}`} key={tab.id}><button role="tab" aria-selected={!activeOverview && activeId === tab.id} onClick={() => { setActiveId(tab.id); setActiveCollectionId(null); }}><span className={`method-label method-${tab.method.toLowerCase()}`}>{tab.method}</span><span>{tab.name}</span>{(!workspace.saved.some(item => item.request.id === tab.id && JSON.stringify(item.request) === JSON.stringify(tab))) && <span className="unsaved-dot" title="Unsaved changes" />}</button><button className="tab-close" aria-label={`Close ${tab.name}`} onClick={() => closeTab(tab.id)}><Icon name="close" size={12} /></button></div>)}
        <button className="icon-button new-tab" aria-label="New request" title="New request" onClick={addRequest}><Icon name="plus" size={18} /></button>
      </div>}

      {activeOverview ? <CollectionOverview key={activeOverview.id} collection={activeOverview} requests={workspace.saved.filter(item => item.collectionId === activeOverview.id).map(item => item.request)} globals={workspaceGlobals(workspace)} section={collectionSection} onSectionChange={setCollectionSection} onChange={changes => setWorkspace(current => ({ ...current, collections: current.collections.map(item => item.id === activeOverview.id ? { ...item, ...changes } : item) }))} onOpenRequest={openRequest} onNewRequest={() => createCollectionRequest(activeOverview.id)} onGlobals={() => setModal('environment')} onRun={() => { if (busyId) setToast('Cancel the current request before running a collection.'); else setRunnerCollectionId(activeOverview.id); }} actions={collectionActions(activeOverview)} requestActions={request => requestActions(request, activeOverview)} /> : hasRequest ? <div className="request-workspace">
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
        <div className={`request-editor ${['Body', 'Auth', 'Scripts', 'Tests'].includes(editorTab) ? 'body-active' : ''}`}><nav className="editor-tabs" aria-label="Request configuration">{(['Params', 'Headers', 'Body', 'Auth', 'Scripts', 'Tests', 'Settings'] as EditorTab[]).map(tab => <button key={tab} className={editorTab === tab ? 'active' : ''} onClick={() => setEditorTab(tab)}>{tab}{tab === 'Params' && count(draft.params) > 0 && <span className="tab-count">{count(draft.params)}</span>}{tab === 'Headers' && count(draft.headers) > 0 && <span className="tab-count">{count(draft.headers)}</span>}{tab === 'Auth' && effectiveAuth(draft, collection?.auth).authType !== 'none' && <Icon name="lock" size={11} />}{tab === 'Body' && draft.bodyType !== 'none' && !['GET', 'HEAD'].includes(draft.method) && <span className="configured-dot" />}</button>)}<span className="editor-hint">Use <code>{'{{variables}}'}</code> anywhere</span></nav>
          <div className="editor-content">
            {editorTab === 'Params' && <><div className="panel-label">Query parameters <span>Added to the URL when you send</span></div><KeyValueEditor rows={draft.params} onChange={params => updateDraft({ params })} /></>}
            {editorTab === 'Headers' && <><div className="panel-label">Request headers <span>Only checked rows are sent</span></div><KeyValueEditor rows={draft.headers} kind="header" onChange={headers => updateDraft({ headers })} /></>}
            {editorTab === 'Body' && <BodyEditor key={draft.id} draft={draft} onChange={updateDraft} />}
            {editorTab === 'Scripts' && <ScriptEditor value={draft} onChange={updateDraft} />}
            {editorTab === 'Tests' && <ChecksEditor value={draft} onChange={updateDraft} />}
            {editorTab === 'Auth' && <AuthEditor key={draft.id} value={draft} collectionAuth={collection?.auth} collectionName={collection?.name} variables={effectiveVariables} onChange={updateDraft} />}
            {editorTab === 'Settings' && <RequestSettings draft={draft} onChange={updateDraft} cookieCount={workspace.cookies.length} onOpenCookies={() => setModal('cookies')} />}
          </div>
        </div>

        <section className="response-panel" aria-label="Response"><div className="response-heading"><div className="response-title"><Icon name="terminal" size={17} /><strong>Response</strong>{response && <span className={`response-status ${response.status < 400 ? 'status-success' : 'status-error'}`}>{response.status} {response.statusText}</span>}</div>{response ? <div className="response-metrics"><span><Icon name="history" size={13} />{response.durationMs} <small>ms</small></span><span><Icon name="file" size={13} />{formatSize(response.size)}</span><button className="icon-button" title="Download response" aria-label="Download response" onClick={downloadResponse}><Icon name="download" size={16} /></button></div> : <span className="response-placeholder-label">{busyId === draft.id ? 'REQUEST IN PROGRESS' : 'READY WHEN YOU ARE'}</span>}</div>
          {busyId === draft.id ? <div className="response-empty" role="status"><div className="sending-orbit"><Icon name="send" size={28} /></div><h2>On its way.</h2><p>Waiting for your server to respond…</p><button className="text-button" onClick={() => controller.current?.abort()}>Cancel request</button></div> : result?.error && !response ? <div className="response-empty error-state" role="alert"><div className="empty-illustration"><Icon name="alert" size={28} /></div><h2>{result.error === 'Request cancelled.' ? 'Request cancelled' : 'Something needs a second look'}</h2><p>{result.error}</p><button className="button button-secondary" onClick={() => void sendRequest()}><Icon name="send" size={14} /> Try again</button></div> : response ? <>
            <div className="response-toolbar"><nav aria-label="Response view">{(['Body', 'Preview', 'Headers', 'Cookies', 'Details', 'Tests'] as ResponseView[]).map(view => <button key={view} className={responseTab === view ? 'active' : ''} onClick={() => setResponseTab(view)}>{view}{view === 'Headers' ? ` ${response.headers.length}` : view === 'Cookies' ? ` ${responseCookies(response).length}` : view === 'Tests' ? ` ${result?.tests?.length || 0}` : ''}</button>)}</nav><div className="response-view-actions">{responseTab === 'Body' && response.encoding === 'utf8' && <><input className="response-search" aria-label="Search response body" placeholder="Find in body" value={responseSearch} onChange={event => setResponseSearch(event.target.value)} /><div className="segmented-control"><button className={pretty ? 'active' : ''} onClick={() => setPretty(true)}>Pretty</button><button className={!pretty ? 'active' : ''} onClick={() => setPretty(false)}>Raw</button></div></>}<button className="icon-button" title="Copy response view" aria-label="Copy response view" onClick={() => void copy(responseTab === 'Tests' ? JSON.stringify({ tests: result?.tests, logs: result?.logs, error: result?.error }, null, 2) : responseTab === 'Headers' ? response.headers.map(header => `${header.name}: ${header.value}`).join('\n') : responseTab === 'Cookies' ? responseCookies(response).join('\n') : responseTab === 'Details' ? `${draft.method} ${draft.url}\n${response.status} ${response.statusText}\n${response.url}\n${response.durationMs} ms` : response.body)}><Icon name="copy" size={15} /></button></div></div>
            <div className="response-content">{responseTab === 'Tests' ? <AutomationResults tests={result?.tests} logs={result?.logs} error={result?.error} /> : <ResponseInspector response={response} view={responseTab} pretty={pretty} search={responseSearch} requestMethod={draft.method} requestUrl={draft.url} onDownload={downloadResponse} />}</div>
            <div className="response-url" title={response.url}><Icon name="globe" size={11} />{response.url}</div>
          </> : <div className="response-empty"><div className="empty-art"><div className="empty-art-orbit orbit-one" /><div className="empty-art-orbit orbit-two" /><div className="empty-illustration"><Icon name="send" size={28} /></div><span className="art-spark spark-one" /><span className="art-spark spark-two" /></div><h2>A little curiosity. A new request.</h2><p>Enter an endpoint, make it yours, and hit Send.<br />Your response will land right here.</p><div className="shortcut-hint"><kbd>Ctrl</kbd><span>+</span><kbd>Enter</kbd><span>to send a request</span></div></div>}
        </section>
      </div> : <Startup requests={workspace.saved.map(item => item.request)} onNew={addRequest} onOpen={openRequest} onImport={openImport} onCollection={() => { setCollectionName(''); setModal('collection'); }} onShortcuts={() => setModal('shortcuts')} />}
      <footer className="statusbar app-statusbar" aria-label="Application status">
        <div className="statusbar-left"><button className="engine-status" onClick={() => { void checkBackend(); setModal('engine'); }} title="Request engine details"><span className={`status-dot ${backend === 'online' ? '' : 'offline'}`} />{backend === 'online' ? 'Engine online' : backend === 'checking' ? 'Connecting…' : 'Engine offline'}</button><span className="storage-status"><Icon name="lock" size={13} />{storageError ? 'Storage unavailable' : 'Local workspace'}</span></div>
        <div className="statusbar-right"><span className="request-status">{busyId ? 'Request in progress…' : activeOverview ? 'Collection saved locally' : hasRequest ? dirty ? 'Unsaved changes' : 'All changes saved' : 'Ready to create'}</span><button className="statusbar-environment" title="View effective variable scope" onClick={() => scopeCollection ? openCollection(scopeCollection.id, 'variables') : setModal('environment')}><Icon name="globe" size={14} />{effectiveVariables.length} variable{effectiveVariables.length === 1 ? '' : 's'}</button><button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label="Toggle theme"><Icon name={theme === 'light' ? 'moon' : 'sun'} size={14} /></button><button onClick={() => setModal('shortcuts')} title="Keyboard shortcuts"><Icon name="terminal" size={14} /></button></div>
      </footer>
    </main>

    {runnerCollectionId && <CollectionRunner workspace={workspace} collectionId={runnerCollectionId} onClose={() => setRunnerCollectionId(null)} onWorkspaceChange={setWorkspace} onAuthenticationUpdate={updates => { setWorkspace(current => applyAuthenticationUpdates(current, updates)); updateTabAuthentication(updates); }} onCookieUpdate={cookies => setWorkspace(current => ({ ...current, cookies }))} />}
    {toast && <div className="toast" role="status"><Icon name="check" size={17} /><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><Icon name="close" size={14} /></button></div>}
    {modal === 'workspaces' && <Modal title="Workspaces" wide onClose={() => setModal(null)}>
      <p className="modal-description">Each workspace has its own collections, environments, history, and cookies. Request tabs close when you switch.</p>
      <div className="workspace-list">{workspaceStore.workspaces.map(item => <div className="workspace-list-row" key={item.id}><button className={item.id === workspaceStore.activeId ? 'button button-primary' : 'button button-secondary'} onClick={() => changeWorkspace(item.id)}>{item.name}{item.id === workspaceStore.activeId ? ' · Active' : ''}</button><span>{item.data.collections.length} collections</span><button className="text-button" disabled={workspaceStore.workspaces.length < 2 || !!busyId || !!runnerCollectionId} onClick={() => deleteWorkspace(item.id)}>Delete</button></div>)}</div>
      <label className="field-label">Rename active workspace<input className="field-input" value={workspaceDraftName} placeholder={workspaceName} onChange={event => setWorkspaceDraftName(event.target.value)} /></label>
      <div className="modal-footer"><button className="button button-secondary" disabled={!workspaceDraftName.trim()} onClick={() => { setWorkspaceStore(current => ({ ...current, workspaces: current.workspaces.map(item => item.id === current.activeId ? { ...item, name: workspaceDraftName.trim() } : item) })); setWorkspaceDraftName(''); }}>Rename active</button><button className="button button-primary" disabled={!workspaceDraftName.trim() || workspaceStore.workspaces.length >= 100 || !!busyId || !!runnerCollectionId} onClick={createWorkspace}>Create new workspace</button></div>
      {dialogError && <p className="dialog-error" role="alert">{dialogError}</p>}
    </Modal>}
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
    {modal === 'environment' && <Modal title="Environments" wide onClose={() => setModal(null)}>
      <p className="modal-description">Base variables apply when no environment overrides them. Collection variables take priority over both. Switch environments to use different values for the same requests.</p>
      <label className="field-label">Active environment<select className="field-input" value={workspace.activeEnvironmentId || ''} onChange={event => setWorkspace(current => ({ ...current, activeEnvironmentId: event.target.value || undefined }))}><option value="">Base variables only</option>{(workspace.environments || []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="environment-manage"><input className="field-input" aria-label="Environment name" placeholder="New environment name" value={environmentDraftName} onChange={event => setEnvironmentDraftName(event.target.value)} /><button className="button button-secondary" disabled={!environmentDraftName.trim()} onClick={() => { const id = crypto.randomUUID(); setWorkspace(current => ({ ...current, environments: [...(current.environments || []), { id, name: environmentDraftName.trim(), variables: [] }], activeEnvironmentId: id })); setEnvironmentDraftName(''); }}>Add environment</button></div>
      {activeEnvironment(workspace) && <div className="environment-manage"><button className="text-button" disabled={!environmentDraftName.trim()} onClick={() => { setWorkspace(current => ({ ...current, environments: current.environments?.map(item => item.id === current.activeEnvironmentId ? { ...item, name: environmentDraftName.trim() } : item) })); setEnvironmentDraftName(''); }}>Rename selected</button><button className="text-button" onClick={() => { const target = activeEnvironment(workspace)!; setConfirmation({ title: 'Delete environment?', description: `“${target.name}” and its variable overrides will be deleted.`, confirmLabel: 'Delete environment', onConfirm: () => setWorkspace(current => ({ ...current, environments: current.environments?.filter(item => item.id !== target.id), activeEnvironmentId: undefined })) }); }}>Delete selected</button></div>}
      <h3>{activeEnvironment(workspace)?.name || 'Base variables'}</h3>
      <KeyValueEditor rows={activeEnvironment(workspace)?.variables || workspace.variables} kind="variable" onChange={variables => setWorkspace(current => current.activeEnvironmentId ? { ...current, environments: current.environments?.map(item => item.id === current.activeEnvironmentId ? { ...item, variables } : item) } : { ...current, variables })} />
      <div className="environment-note"><Icon name="lock" size={14} />Values are stored locally and included in workspace exports.</div>
      <div className="modal-footer"><button className="button button-primary" onClick={() => setModal(null)}>Done</button></div>
    </Modal>}
    {modal === 'cookies' && <Modal title="Cookie jar" wide onClose={() => setModal(null)}><CookieEditor cookies={workspace.cookies} defaultDomain={(() => { try { return new URL(draft.url).hostname; } catch { return ''; } })()} onChange={cookies => setWorkspace(current => ({ ...current, cookies }))} onClear={() => setConfirmation({ title: 'Clear cookie jar?', description: `Delete all ${workspace.cookies.length} stored cookies from this workspace?`, confirmLabel: 'Clear cookies', onConfirm: () => setWorkspace(current => ({ ...current, cookies: [] })) })} /></Modal>}
    {modal === 'curl' && <Modal title="Generate code" wide onClose={() => setModal(null)}>
      <p className="modal-description">Run this cURL command in a POSIX shell. Environment variables are resolved. For file bodies, place the named files in your current directory; file bytes are not embedded.</p>
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
    {modal === 'import' && <Modal title={pendingImport ? importFormat === 'Postman environment' ? 'Add environment?' : 'Replace active workspace?' : 'Import workspace'} wide onClose={() => setModal(null)}>
      {pendingImport ? <>
        <p className="modal-description">{importFormat} import. {importFormat === 'Postman environment' ? 'This adds a named environment and keeps your existing collections and variables.' : 'This replaces the active workspace’s saved collections, request history, environments, and cookie jar.'} Open request tabs will stay available. Export your current workspace first if you want to keep a backup.</p>
        <div className="import-summary"><div><strong>{pendingImport.collections.length}</strong><span>Collections</span></div><div><strong>{pendingImport.saved.length}</strong><span>Requests</span></div><div><strong>{pendingImport.variables.length + (pendingImport.environments || []).reduce((total, item) => total + item.variables.length, 0)}</strong><span>Variables</span></div></div>
        <div className="modal-footer"><button className="button button-secondary" onClick={() => setPendingImport(null)} data-dialog-initial-focus>Back</button><button className="button button-danger" onClick={() => { setWorkspace(pendingImport); setModal(null); setToast(importFormat === 'Postman environment' ? 'Environment imported.' : 'Workspace imported.'); }}>{importFormat === 'Postman environment' ? 'Add environment' : 'Replace active workspace'}</button></div>
      </> : <>
        <p className="modal-description">Drop a Reqora, Postman, Insomnia, or OpenAPI JSON export here, or paste JSON or a cURL command below. You can review the result before applying it.</p>
        <div className={`import-drop-zone ${draggingImport ? 'dragging' : ''}`} role="region" aria-label="Drop a workspace file" onDragOver={event => { event.preventDefault(); setDraggingImport(true); }} onDragLeave={() => setDraggingImport(false)} onDrop={event => {
          event.preventDefault(); setDraggingImport(false);
          if (event.dataTransfer.files.length !== 1) { setDialogError('Drop one workspace JSON file at a time.'); return; }
          void readImportFile(event.dataTransfer.files[0]);
        }}><Icon name="upload" size={26} /><strong>Drop your workspace file</strong><span>JSON or cURL · Up to 5 MB · Processed locally</span></div>
        <label className="field-label">Or paste JSON or cURL<textarea className="import-json" value={importText} placeholder={'{ "version": 1, "collections": [...] }'} onChange={event => { setImportText(event.target.value); setDialogError(''); }} spellCheck={false} /></label>
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
      <dl className="engine-details"><div><dt>Protocols</dt><dd>HTTP and HTTPS</dd></div><div><dt>Request body limit</dt><dd>10 MB (16 MB transport)</dd></div><div><dt>Response limit</dt><dd>5 MB</dd></div><div><dt>Timeout range</dt><dd>0.1–60 seconds</dd></div><div><dt>TLS certificates</dt><dd>Verified</dd></div></dl>
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
