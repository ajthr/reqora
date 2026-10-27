import { newAuthConfig, isAuthConfig, effectiveAuth, resolveAuthValues } from './auth.ts';
import type { AuthConfig, AuthType } from './auth.ts';
import { isCookieJar, isNetworkSettings, newNetworkSettings, normalizedNetworkSettings } from './network.ts';
import type { CookieRecord, NetworkSettings } from './network.ts';
import type { HttpRequest, HttpResponse, MultipartPart, UploadFile } from './types.ts';
import { emptyAutomation, isAutomation, isScriptSettings } from './automation.ts';
import type { RequestAutomation, ScriptSettings } from './automation.ts';
import { isFileName, isMediaType, MAX_BODY_BYTES, MAX_BODY_FIELDS } from './body.ts';

export interface Entry { id: string; enabled: boolean; name: string; value: string }
export interface FileReference { id: string; name: string; type: string; size: number }
export interface MultipartField extends Entry { kind: 'text' | 'file'; file?: FileReference }
export interface Draft extends RequestAutomation, AuthConfig {
  id: string;
  collectionId?: string;
  name: string;
  method: string;
  url: string;
  params: Entry[];
  headers: Entry[];
  body: string;
  bodyType: 'none' | 'json' | 'text' | 'xml' | 'form' | 'multipart' | 'binary';
  formFields: Entry[];
  multipartFields: MultipartField[];
  binaryFile?: FileReference;
  authType: AuthType;
  token: string;
  username: string;
  password: string;
  timeoutMs: number;
  followRedirects: boolean;
  network: NetworkSettings;
}
export interface ResponseExample { id: string; name: string; status: number; statusText: string; headers: { name: string; value: string }[]; body: string; encoding: 'utf8' | 'base64'; truncated?: boolean }
export interface Folder { id: string; name: string }
export interface SavedRequest { collectionId: string; folderId?: string; examples?: ResponseExample[]; request: Draft }
export interface Collection extends Partial<ScriptSettings> { id: string; name: string; description: string; variables: Entry[]; folders?: Folder[]; auth?: AuthConfig }
export interface HistoryItem { id: string; date: string; request: Draft; status?: number; durationMs?: number; error?: string }
export interface Environment { id: string; name: string; variables: Entry[] }
export interface Workspace { version: 1; environments?: Environment[]; activeEnvironmentId?: string; collections: Collection[]; saved: SavedRequest[]; history: HistoryItem[]; variables: Entry[]; cookies: CookieRecord[] }

export const newEntry = (name = '', value = ''): Entry => ({ id: crypto.randomUUID(), enabled: true, name, value });

export function newDraft(collectionId?: string): Draft {
  return { ...newAuthConfig('inherit'), ...emptyAutomation(), id: crypto.randomUUID(), ...(collectionId ? { collectionId } : {}), name: 'Untitled request', method: 'GET', url: '', params: [], headers: [], body: '', bodyType: 'none', formFields: [], multipartFields: [], timeoutMs: 30000, followRedirects: true, network: newNetworkSettings() };
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
  return { version: 1, collections: [{ id: collectionId, name: 'Getting started', description: 'A couple of sample requests to help you explore Reqora. Add collection variables to customize these requests without changing your global environment.', variables: [] }], saved: [{ collectionId, request: get }, { collectionId, request: create }], history: [], variables: [newEntry('base_url', 'https://jsonplaceholder.typicode.com')], cookies: [] };
}

export interface ScopedVariable extends Entry { scope: 'global' | 'collection' }

export function activeEnvironment(workspace: Workspace): Environment | undefined {
  return workspace.environments?.find(item => item.id === workspace.activeEnvironmentId);
}
export function workspaceGlobals(workspace: Workspace): Entry[] {
  const environment = activeEnvironment(workspace);
  return environment ? [...workspace.variables, ...environment.variables] : workspace.variables;
}

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

export function prepareWorkspaceRequest(workspace: Workspace, request: Draft, files?: ReadonlyMap<string, string>): HttpRequest {
  return { ...prepareRequest(request, workspaceGlobals(workspace), getRequestCollection(workspace, request)?.variables, files, getRequestCollection(workspace, request)?.auth), ...(normalizedNetworkSettings(request.network).useCookies ? { cookies: workspace.cookies } : {}) };
}

export function requestFiles(request: Draft): FileReference[] {
  if (['GET', 'HEAD'].includes(request.method)) return [];
  if (request.bodyType === 'binary') return request.binaryFile ? [request.binaryFile] : [];
  if (request.bodyType !== 'multipart') return [];
  return request.multipartFields.filter(row => row.enabled && row.name.trim() && row.kind === 'file' && row.file).map(row => row.file!);
}

export function workspaceToCurl(workspace: Workspace, request: Draft): string {
  // cURL reads local filenames. Its formatter does not need the browser's stored file bytes.
  const files = new Map(requestFiles(request).map(file => [file.id, '']));
  return toCurl(prepareWorkspaceRequest(workspace, request, files));
}

export function interpolate(value: string, variables: Entry[], maxLength = 1024 * 1024): string {
  const effective = new Map(getVariableScope(variables).map(entry => [entry.name, entry.value]));
  const cache = new Map<string, string>();
  function expand(text: string, chain: string[]): string {
    let length = text.length;
    if (length > maxLength) throw new Error(`Expanded variables exceed the ${maxLength / 1024 / 1024} MB limit.`);
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
      if (length > maxLength) throw new Error(`Expanded variables exceed the ${maxLength / 1024 / 1024} MB limit.`);
      return resolved;
    });
  }
  return expand(value, []);
}

export function prepareRequest(draft: Draft, variables: Entry[], collectionVariables: Entry[] = [], files: ReadonlyMap<string, string> = new Map(), collectionAuth?: AuthConfig): HttpRequest {
  const scope = getVariableScope(variables, collectionVariables);
  const resolve = (value: string) => interpolate(value, scope);
  const resolveBody = (value: string) => interpolate(value, scope, MAX_BODY_BYTES);
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
  const auth = resolveAuthValues(effectiveAuth(draft, collectionAuth), resolve);
  if (auth.authType === 'bearer') setHeader('Authorization', `Bearer ${auth.token}`);
  if (auth.authType === 'basic') {
    const bytes = new TextEncoder().encode(`${auth.username}:${auth.password}`);
    setHeader('Authorization', `Basic ${btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))}`);
  }
  if (auth.authType === 'apikey') {
    const key = auth.apiKey!;
    if (!key.name.trim()) throw new Error('Enter an API key name.');
    if (key.location === 'query') url.searchParams.set(key.name, key.value);
    else setHeader(key.name, key.value);
  }
  if (auth.authType === 'oauth2' && auth.oauth2?.accessToken) setHeader('Authorization', `Bearer ${auth.oauth2.accessToken}`);
  const fileBody = (reference: FileReference | undefined): UploadFile => {
    if (!reference) throw new Error('Attach a file before sending this request.');
    const data = files.get(reference.id);
    if (data === undefined) throw new Error(`Reattach “${reference.name}” before sending. Its file is unavailable on this device.`);
    return { name: reference.name, type: reference.type || 'application/octet-stream', data };
  };
  let body: HttpRequest['body'];
  if (!['GET', 'HEAD'].includes(draft.method) && draft.bodyType !== 'none') {
    if (draft.bodyType === 'multipart') {
      const active = draft.multipartFields.filter(row => row.enabled && row.name.trim());
      if (active.length > MAX_BODY_FIELDS) throw new Error('Use up to 100 multipart fields.');
      const parts: MultipartPart[] = active.map(row => row.kind === 'file'
        ? { name: resolve(row.name), file: fileBody(row.file) }
        : { name: resolve(row.name), value: resolveBody(row.value) });
      headers = headers.filter(header => header.name.toLowerCase() !== 'content-type');
      body = { kind: 'multipart', parts };
    } else if (draft.bodyType === 'binary') {
      body = { kind: 'binary', file: fileBody(draft.binaryFile) };
      if (!headers.some(header => header.name.toLowerCase() === 'content-type')) setHeader('Content-Type', body.file.type);
    } else {
      if (draft.bodyType === 'form') {
        const form = new URLSearchParams();
        const rows = draft.formFields ?? [...new URLSearchParams(draft.body)].map(([name, value]) => newEntry(name, value));
        for (const row of rows.filter(row => row.enabled && row.name.trim())) form.append(resolve(row.name), resolveBody(row.value));
        body = form.toString();
      } else body = resolveBody(draft.body);
      if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new Error('Request body exceeds the 10 MB limit.');
      if (draft.bodyType === 'json') {
        try { JSON.parse(body); } catch { throw new Error('The request body is not valid JSON.'); }
      }
      if (!headers.some(header => header.name.toLowerCase() === 'content-type')) {
        setHeader('Content-Type', { json: 'application/json', text: 'text/plain', xml: 'application/xml', form: 'application/x-www-form-urlencoded' }[draft.bodyType]);
      }
    }
  }
  const network = normalizedNetworkSettings(draft.network);
  return { url: url.href, method: draft.method, headers, body, timeoutMs: draft.timeoutMs, followRedirects: draft.followRedirects, network: {
    ...network, proxy: { ...network.proxy, ...(network.proxy.mode === 'custom' ? { url: resolve(network.proxy.url), bypass: resolve(network.proxy.bypass) } : {}) },
    tls: { caPem: resolve(network.tls.caPem), clientCertPem: resolve(network.tls.clientCertPem), clientKeyPem: resolve(network.tls.clientKeyPem), clientKeyPassphrase: resolve(network.tls.clientKeyPassphrase) },
  }, ...(auth.authType !== 'none' ? { auth } : {}) };
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

export function isFileReference(value: unknown): value is FileReference {
  if (!value || typeof value !== 'object') return false;
  const file = value as FileReference;
  return typeof file.id === 'string' && file.id.length > 0 && file.id.length <= 255 && isFileName(file.name) && isMediaType(file.type)
    && Number.isInteger(file.size) && file.size >= 0 && file.size <= MAX_BODY_BYTES;
}

function isMultipartField(value: unknown): value is MultipartField {
  return isEntry(value) && ['text', 'file'].includes((value as MultipartField).kind)
    && ((value as MultipartField).file === undefined || isFileReference((value as MultipartField).file));
}

function normalizeDraft(draft: Draft): Draft {
  return { ...newAuthConfig(), ...emptyAutomation(), ...draft, network: normalizedNetworkSettings(draft.network),
    formFields: draft.formFields ?? (draft.bodyType === 'form' ? [...new URLSearchParams(draft.body)].map(([name, value]) => newEntry(name, value)) : []),
    multipartFields: draft.multipartFields ?? [],
  };
}

export function isDraft(value: unknown): value is Draft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Draft;
  return ['id', 'name', 'method', 'url', 'body', 'token', 'username', 'password'].every(key => typeof draft[key as keyof Draft] === 'string')
    && Array.isArray(draft.params) && draft.params.every(isEntry) && Array.isArray(draft.headers) && draft.headers.every(isEntry)
    && ['none', 'json', 'text', 'xml', 'form', 'multipart', 'binary'].includes(draft.bodyType) && isAuthConfig(draft) && (draft.network === undefined || isNetworkSettings(draft.network))
    && (draft.formFields === undefined || Array.isArray(draft.formFields) && draft.formFields.every(isEntry))
    && (draft.multipartFields === undefined || Array.isArray(draft.multipartFields) && draft.multipartFields.every(isMultipartField))
    && (draft.binaryFile === undefined || isFileReference(draft.binaryFile))
    && isAutomation(draft)
    && (draft.collectionId === undefined || typeof draft.collectionId === 'string')
    && typeof draft.timeoutMs === 'number' && typeof draft.followRedirects === 'boolean';
}

export function parseWorkspace(text: string): Workspace {
  const data = JSON.parse(text) as Workspace;
  if (data?.version !== 1 || !Array.isArray(data.collections) || !data.collections.every(item => typeof item?.id === 'string' && typeof item?.name === 'string' && isScriptSettings(item) && (item.auth === undefined || isAuthConfig(item.auth, false))
      && (item.description === undefined || typeof item.description === 'string') && (item.folders === undefined || Array.isArray(item.folders) && item.folders.every(folder => typeof folder?.id === 'string' && typeof folder?.name === 'string')) && (item.variables === undefined || Array.isArray(item.variables) && item.variables.every(isEntry)))
    || !Array.isArray(data.saved) || !data.saved.every(item => typeof item?.collectionId === 'string' && data.collections.some(collection => collection.id === item.collectionId) && isDraft(item?.request) && (item.folderId === undefined || typeof item.folderId === 'string' && data.collections.find(collection => collection.id === item.collectionId)?.folders?.some(folder => folder.id === item.folderId)) && (item.examples === undefined || Array.isArray(item.examples) && item.examples.length <= 30 && item.examples.every(example => typeof example?.id === 'string' && typeof example?.name === 'string' && typeof example?.status === 'number' && typeof example?.statusText === 'string' && Array.isArray(example?.headers) && example.headers.every(header => typeof header?.name === 'string' && typeof header?.value === 'string') && typeof example?.body === 'string' && example.body.length <= 150_000 && (example.truncated === undefined || typeof example.truncated === 'boolean') && ['utf8', 'base64'].includes(example?.encoding))))
    || !Array.isArray(data.variables) || !data.variables.every(isEntry) || (data.environments !== undefined && (!Array.isArray(data.environments) || !data.environments.every(item => typeof item?.id === 'string' && typeof item?.name === 'string' && Array.isArray(item?.variables) && item.variables.every(isEntry)))) || (data.activeEnvironmentId !== undefined && typeof data.activeEnvironmentId !== 'string') || (data.cookies !== undefined && !isCookieJar(data.cookies))
    || !Array.isArray(data.history) || !data.history.every(item => typeof item?.id === 'string' && typeof item?.date === 'string' && isDraft(item?.request)
      && (item.status === undefined || typeof item.status === 'number') && (item.durationMs === undefined || typeof item.durationMs === 'number') && (item.error === undefined || typeof item.error === 'string'))) {
    throw new Error('This file is not a valid Reqora workspace export.');
  }
  if (data.activeEnvironmentId && !data.environments?.some(item => item.id === data.activeEnvironmentId)) throw new Error('This file has an invalid active environment.');
  return { ...data, cookies: data.cookies ?? [], collections: data.collections.map(item => ({ ...item, description: item.description ?? '', variables: item.variables ?? [] })),
    saved: data.saved.map(item => ({ ...item, request: normalizeDraft(item.request) })),
    history: data.history.slice(0, 100).map(item => ({ ...item, request: normalizeDraft(item.request) })),
  };
}

export function toCurl(request: HttpRequest): string {
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  const formQuote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const body = request.body;
  const auth = request.auth;
  const network = normalizedNetworkSettings(request.network);
  if (network.tls.caPem || network.tls.clientCertPem || network.tls.clientKeyPem) throw new Error('cURL needs certificate files on disk. Send this request in Reqora, or save PEM fields to files and configure cURL manually.');
  if (auth?.authType === 'oauth1' && !request.headers.some(header => header.name.toLowerCase() === 'authorization' && header.value.startsWith('OAuth '))) throw new Error('OAuth 1 cURL signing requires the running request engine. Use the Generate code action.');
  if (auth?.authType === 'oauth2' && !auth.oauth2?.accessToken) throw new Error('Get an OAuth 2 access token before exporting a cURL command.');
  if (auth?.authType === 'oauth2' && auth.oauth2!.expiresAt > 0 && auth.oauth2!.expiresAt <= Date.now()) throw new Error('Refresh the OAuth 2 access token before exporting cURL.');
  if (auth?.authType === 'aws' && typeof body === 'object' && body.kind === 'multipart') throw new Error('Multipart AWS requests are signed by Reqora. Use the request engine instead of a cURL export for this body type.');
  if (auth?.authType === 'digest' && auth.username?.includes(':')) throw new Error('cURL Digest export does not support a colon in the username. Send this request from Reqora instead.');
  const authentication = auth?.authType === 'digest' ? [`  --digest --user ${quote(`${auth.username || ''}:${auth.password || ''}`)}`]
    : auth?.authType === 'aws' ? [`  --aws-sigv4 ${quote(`aws:amz:${auth.aws!.region}:${auth.aws!.service}`)}`, `  --user ${quote(`${auth.aws!.accessKeyId}:${auth.aws!.secretAccessKey}`)}`, ...(auth.aws!.sessionToken ? [`  --header ${quote(`X-Amz-Security-Token: ${auth.aws!.sessionToken}`)}`] : [])] : [];
  const proxy = network.proxy.mode === 'custom' ? [`  --proxy ${quote(network.proxy.url)}`, ...(network.proxy.bypass ? [`  --noproxy ${quote(network.proxy.bypass)}`] : [])]
    : network.proxy.mode === 'direct' ? ["  --noproxy '*'"] : [];
  if (typeof body === 'object' && body.kind === 'multipart' && body.parts.some(part => /[=\r\n\0]/.test(part.name))) {
    throw new Error('cURL form export does not support keys containing equals signs or line breaks. Send this request from Reqora instead.');
  }
  const flags = body === undefined ? [] : typeof body === 'string' ? [`  --data-raw ${quote(body)}`]
    : body.kind === 'binary' ? [`  --data-binary ${quote(`@./${body.file.name}`)}`]
    : body.parts.map(part => 'file' in part
      // Quoting a per-part header prevents MIME parameters from becoming cURL form directives.
      ? `  --form ${quote(`${part.name}=@${formQuote(`./${part.file.name}`)};headers=${formQuote(`Content-Type: ${part.file.type || 'application/octet-stream'}`)}`)}`
      : `  --form-string ${quote(`${part.name}=${part.value}`)}`);
  return [`curl --request ${quote(request.method)} ${quote(request.url)}`, ...authentication, ...proxy, ...request.headers.filter(header => auth?.authType === 'aws' ? !['authorization', 'x-amz-date', 'x-amz-content-sha256', 'x-amz-security-token'].includes(header.name.toLowerCase()) : auth?.authType !== 'digest' || header.name.toLowerCase() !== 'authorization').filter(header => typeof body === 'string' || body?.kind !== 'multipart' || header.name.toLowerCase() !== 'content-type').map(header => `  --header ${quote(`${header.name}: ${header.value}`)}`), ...flags, ...(request.followRedirects ? ['  --location'] : []), `  --max-time ${request.timeoutMs / 1000}`].join(' \\\n');
}
