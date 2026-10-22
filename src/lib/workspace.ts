import type { HttpRequest, HttpResponse } from '../../shared/types.ts';

export interface Entry { id: string; enabled: boolean; name: string; value: string }
export interface Draft {
  id: string;
  collectionId?: string;
  name: string;
  method: string;
  url: string;
  params: Entry[];
  headers: Entry[];
  body: string;
  bodyType: 'none' | 'json' | 'text' | 'form';
  authType: 'none' | 'bearer' | 'basic';
  token: string;
  username: string;
  password: string;
  timeoutMs: number;
  followRedirects: boolean;
}
export interface SavedRequest { collectionId: string; request: Draft }
export interface Collection { id: string; name: string; description: string; variables: Entry[] }
export interface HistoryItem { id: string; date: string; request: Draft; status?: number; durationMs?: number; error?: string }
export interface Workspace { version: 1; collections: Collection[]; saved: SavedRequest[]; history: HistoryItem[]; variables: Entry[] }

export const newEntry = (name = '', value = ''): Entry => ({ id: crypto.randomUUID(), enabled: true, name, value });

export function newDraft(collectionId?: string): Draft {
  return { id: crypto.randomUUID(), ...(collectionId ? { collectionId } : {}), name: 'Untitled request', method: 'GET', url: '', params: [], headers: [], body: '', bodyType: 'none', authType: 'none', token: '', username: '', password: '', timeoutMs: 30000, followRedirects: true };
}

export function closeRequestTab(tabs: Draft[], activeId: string, closingId: string): { tabs: Draft[]; activeId: string } {
  const index = tabs.findIndex(tab => tab.id === closingId);
  if (index < 0) return { tabs, activeId };
  const remaining = tabs.filter(tab => tab.id !== closingId);
  return { tabs: remaining, activeId: activeId === closingId ? remaining[Math.min(index, remaining.length - 1)]?.id || '' : activeId };
}

export function initialWorkspace(): Workspace {
  const collectionId = 'getting-started';
  const get = { ...newDraft(), name: 'Get a post', url: '{{base_url}}/posts/1', headers: [newEntry('Accept', 'application/json')] };
  const create: Draft = { ...newDraft(), name: 'Create a post', method: 'POST', url: '{{base_url}}/posts', bodyType: 'json', body: '{\n  "title": "Hello from Reqora",\n  "body": "Your next great API starts here.",\n  "userId": 1\n}' };
  return { version: 1, collections: [{ id: collectionId, name: 'Getting started', description: 'A couple of sample requests to help you explore Reqora. Add collection variables to customize these requests without changing your global environment.', variables: [] }], saved: [{ collectionId, request: get }, { collectionId, request: create }], history: [], variables: [newEntry('base_url', 'https://jsonplaceholder.typicode.com')] };
}

export interface ScopedVariable extends Entry { scope: 'global' | 'collection' }

export function getVariableScope(globals: Entry[], collection: Entry[] = []): ScopedVariable[] {
  const effective = new Map<string, ScopedVariable>();
  for (const [scope, entries] of [['global', globals], ['collection', collection]] as const) {
    for (const entry of entries) {
      const name = entry.name.trim();
      if (entry.enabled && name) effective.set(name, { ...entry, name, scope });
    }
  }
  return [...effective.values()];
}

export function getRequestCollection(workspace: Workspace, request: Draft): Collection | undefined {
  const id = workspace.saved.find(item => item.request.id === request.id)?.collectionId ?? request.collectionId;
  return workspace.collections.find(collection => collection.id === id);
}

export function prepareWorkspaceRequest(workspace: Workspace, request: Draft): HttpRequest {
  return prepareRequest(request, workspace.variables, getRequestCollection(workspace, request)?.variables);
}

export function interpolate(value: string, variables: Entry[]): string {
  const effective = new Map(getVariableScope(variables).map(entry => [entry.name, entry.value]));
  const cache = new Map<string, string>();
  function expand(text: string, chain: string[]): string {
    let length = text.length;
    if (length > 1024 * 1024) throw new Error('Expanded variables exceed the 1 MB limit.');
    return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match: string, key: string) => {
      const name = key.trim();
      if (!effective.has(name)) throw new Error(`Variable “${name}” is not defined in the collection or global environment.`);
      if (chain.includes(name)) throw new Error(`Circular variable reference: ${[...chain, name].join(' → ')}.`);
      if (chain.length >= 20) throw new Error('Variable references are nested too deeply (maximum 20 levels).');
      let resolved = cache.get(name);
      if (resolved === undefined) {
        resolved = expand(effective.get(name)!, [...chain, name]);
        cache.set(name, resolved);
      }
      length += resolved.length - match.length;
      if (length > 1024 * 1024) throw new Error('Expanded variables exceed the 1 MB limit.');
      return resolved;
    });
  }
  return expand(value, []);
}

export function prepareRequest(draft: Draft, variables: Entry[], collectionVariables: Entry[] = []): HttpRequest {
  const scope = getVariableScope(variables, collectionVariables);
  const resolve = (value: string) => interpolate(value, scope);
  let url: URL;
  try { url = new URL(resolve(draft.url.trim())); }
  catch (error) {
    if (error instanceof Error && !(error instanceof TypeError)) throw error;
    throw new Error('Enter a valid URL, including http:// or https://.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
  for (const param of draft.params.filter(row => row.enabled && row.name.trim())) url.searchParams.append(resolve(param.name), resolve(param.value));
  let headers = draft.headers.filter(row => row.enabled && row.name.trim()).map(row => ({ name: resolve(row.name.trim()), value: resolve(row.value) }));
  const setHeader = (name: string, value: string) => {
    headers = headers.filter(header => header.name.toLowerCase() !== name.toLowerCase());
    headers.push({ name, value });
  };
  if (draft.authType === 'bearer') setHeader('Authorization', `Bearer ${resolve(draft.token)}`);
  if (draft.authType === 'basic') {
    const bytes = new TextEncoder().encode(`${resolve(draft.username)}:${resolve(draft.password)}`);
    setHeader('Authorization', `Basic ${btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))}`);
  }
  let body: string | undefined;
  if (!['GET', 'HEAD'].includes(draft.method) && draft.bodyType !== 'none') {
    body = resolve(draft.body);
    if (draft.bodyType === 'json') {
      try { JSON.parse(body); } catch { throw new Error('The request body is not valid JSON.'); }
    }
    if (!headers.some(header => header.name.toLowerCase() === 'content-type')) {
      setHeader('Content-Type', { json: 'application/json', text: 'text/plain', form: 'application/x-www-form-urlencoded' }[draft.bodyType]);
    }
  }
  return { url: url.href, method: draft.method, headers, body, timeoutMs: draft.timeoutMs, followRedirects: draft.followRedirects };
}

export function formatBody(response: HttpResponse, pretty: boolean): string {
  if (!pretty || response.encoding === 'base64') return response.body;
  try { return JSON.stringify(JSON.parse(response.body), null, 2); } catch { return response.body; }
}

export function formatSize(size: number): string {
  return size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
}

function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== 'object') return false;
  const row = value as Entry;
  return typeof row.id === 'string' && typeof row.name === 'string' && typeof row.value === 'string' && typeof row.enabled === 'boolean';
}

export function isDraft(value: unknown): value is Draft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Draft;
  return ['id', 'name', 'method', 'url', 'body', 'token', 'username', 'password'].every(key => typeof draft[key as keyof Draft] === 'string')
    && Array.isArray(draft.params) && draft.params.every(isEntry) && Array.isArray(draft.headers) && draft.headers.every(isEntry)
    && ['none', 'json', 'text', 'form'].includes(draft.bodyType) && ['none', 'bearer', 'basic'].includes(draft.authType)
    && (draft.collectionId === undefined || typeof draft.collectionId === 'string')
    && typeof draft.timeoutMs === 'number' && typeof draft.followRedirects === 'boolean';
}

export function parseWorkspace(text: string): Workspace {
  const data = JSON.parse(text) as Workspace;
  if (data?.version !== 1 || !Array.isArray(data.collections) || !data.collections.every(item => typeof item?.id === 'string' && typeof item?.name === 'string'
      && (item.description === undefined || typeof item.description === 'string') && (item.variables === undefined || Array.isArray(item.variables) && item.variables.every(isEntry)))
    || !Array.isArray(data.saved) || !data.saved.every(item => typeof item?.collectionId === 'string' && data.collections.some(collection => collection.id === item.collectionId) && isDraft(item?.request))
    || !Array.isArray(data.variables) || !data.variables.every(isEntry)
    || !Array.isArray(data.history) || !data.history.every(item => typeof item?.id === 'string' && typeof item?.date === 'string' && isDraft(item?.request)
      && (item.status === undefined || typeof item.status === 'number') && (item.durationMs === undefined || typeof item.durationMs === 'number') && (item.error === undefined || typeof item.error === 'string'))) {
    throw new Error('This file is not a valid Reqora workspace export.');
  }
  return { ...data, collections: data.collections.map(item => ({ ...item, description: item.description ?? '', variables: item.variables ?? [] })), history: data.history.slice(0, 100) };
}

export function toCurl(request: HttpRequest): string {
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  return [`curl --request ${quote(request.method)} ${quote(request.url)}`, ...request.headers.map(header => `  --header ${quote(`${header.name}: ${header.value}`)}`), ...(request.body === undefined ? [] : [`  --data-raw ${quote(request.body)}`]), ...(request.followRedirects ? ['  --location'] : []), `  --max-time ${request.timeoutMs / 1000}`].join(' \\\n');
}
