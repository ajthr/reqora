import { initialWorkspace, newDraft, newEntry, parseWorkspace } from '../../shared/workspace.ts';
import type { Collection, Draft, Entry, Workspace } from '../../shared/workspace.ts';

type Obj = Record<string, any>;
const object = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
const string = (value: unknown): string => typeof value === 'string' ? value : '';
const rows = (value: unknown): Obj[] => Array.isArray(value) ? value.map(object) : [];
const entries = (value: unknown, key = 'key'): Entry[] => rows(value).filter(row => string(row[key])).map(row => ({ ...newEntry(string(row[key]), String(row.value ?? '')), enabled: row.disabled !== true }));
const collection = (name: string, description = ''): Collection => ({ id: crypto.randomUUID(), name: name || 'Imported collection', description, variables: [] });
const blank = (): Workspace => ({ ...initialWorkspace(), collections: [], saved: [], variables: [], history: [], cookies: [] });
const validate = (workspace: Workspace): Workspace => parseWorkspace(JSON.stringify(workspace));
function auth(target: Draft, source: Obj) {
  const kind = string(source.type);
  const values = Object.fromEntries(rows(source[kind]).map(row => [row.key, row.value]));
  if (kind === 'basic') { target.authType = 'basic'; target.username = string(values.username); target.password = string(values.password); }
  if (kind === 'bearer') { target.authType = 'bearer'; target.token = string(values.token); }
  if (kind === 'apikey') { target.authType = 'apikey'; target.apiKey = { name: string(values.key), value: string(values.value), location: values.in === 'query' ? 'query' : 'header' }; }
  if (kind === 'noauth') target.authType = 'none';
}
function body(target: Draft, source: Obj) {
  if (source.mode === 'raw') { target.body = string(source.raw); target.bodyType = source.options?.raw?.language === 'json' ? 'json' : source.options?.raw?.language === 'xml' ? 'xml' : 'text'; }
  if (source.mode === 'urlencoded') { target.bodyType = 'form'; target.formFields = entries(source.urlencoded); }
  if (source.mode === 'formdata') { target.bodyType = 'multipart'; target.multipartFields = rows(source.formdata).filter(row => string(row.key)).map(row => ({ ...newEntry(string(row.key), string(row.value)), enabled: row.disabled !== true, kind: 'text' as const })); }
}
function postman(data: Obj): Workspace {
  const workspace = blank();
  const root = collection(string(data.info?.name) || 'Postman collection', string(data.info?.description?.content || data.info?.description));
  root.variables = entries(data.variable);
  workspace.collections.push(root);
  const visit = (items: unknown, path: string[]) => { for (const item of rows(items)) {
    if (Array.isArray(item.item)) { visit(item.item, [...path, string(item.name)]); continue; }
    if (!item.request) continue;
    const request = object(item.request), url = request.url;
    const draft = { ...newDraft(root.id), name: [...path, string(item.name)].filter(Boolean).join(' / ') || 'Imported request', method: string(request.method).toUpperCase() || 'GET', url: typeof url === 'string' ? url : string(url?.raw), headers: entries(request.header), params: entries(url?.query) };
    body(draft, object(request.body)); auth(draft, object(request.auth));
    workspace.saved.push({ collectionId: root.id, request: draft });
  } };
  visit(data.item, []);
  if (!workspace.saved.length) throw new Error('The Postman collection contains no requests.');
  return validate(workspace);
}
function insomnia(data: Obj): Workspace {
  const workspace = blank(), resources = rows(data.resources);
  const groups = new Map<string, Obj>(resources.filter(row => row._type === 'request_group').map(row => [string(row._id), row]));
  const groupName = (id: string): string => { const names: string[] = []; const seen = new Set<string>(); while (groups.has(id) && !seen.has(id)) { seen.add(id); const group = groups.get(id)!; names.unshift(string(group.name)); id = string(group.parentId); } return names.join(' / '); };
  const root = collection(string(resources.find(row => row._type === 'workspace')?.name) || 'Insomnia collection'); workspace.collections.push(root);
  for (const item of resources.filter(row => row._type === 'request')) {
    const draft = { ...newDraft(root.id), name: [groupName(string(item.parentId)), string(item.name)].filter(Boolean).join(' / ') || 'Imported request', method: string(item.method).toUpperCase() || 'GET', url: string(item.url), headers: entries(item.headers, 'name'), params: entries(item.parameters, 'name') };
    const b = object(item.body); if (typeof b.text === 'string') { draft.body = b.text; draft.bodyType = string(b.mimeType).includes('json') ? 'json' : string(b.mimeType).includes('xml') ? 'xml' : 'text'; }
    if (Array.isArray(b.params)) { draft.bodyType = 'form'; draft.formFields = entries(b.params, 'name'); }
    const a = object(item.authentication); if (a.type === 'basic') { draft.authType = 'basic'; draft.username = string(a.username); draft.password = string(a.password); } else if (a.type === 'bearer') { draft.authType = 'bearer'; draft.token = string(a.token); }
    workspace.saved.push({ collectionId: root.id, request: draft });
  }
  for (const env of resources.filter(row => row._type === 'environment' && !row.isPrivate)) {
    const variables = Object.entries(object(env.data)).map(([key, value]) => newEntry(key, String(value)));
    if (env.parentId === resources.find(row => row._type === 'workspace')?._id) workspace.variables.push(...variables);
    else workspace.environments = [...(workspace.environments || []), { id: crypto.randomUUID(), name: string(env.name) || 'Imported environment', variables }];
  }
  if (!workspace.saved.length) throw new Error('The Insomnia export contains no requests.');
  return validate(workspace);
}
function openapi(data: Obj): Workspace {
  const workspace = blank(), root = collection(string(data.info?.title) || 'OpenAPI', string(data.info?.description)); workspace.collections.push(root);
  const server = string(rows(data.servers)[0]?.url);
  for (const [path, pathValue] of Object.entries(object(data.paths))) for (const [method, operationValue] of Object.entries(object(pathValue))) {
    if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue;
    const operation = object(operationValue), parameters = [...rows(object(pathValue).parameters), ...rows(operation.parameters)];
    const draft = { ...newDraft(root.id), name: string(operation.summary || operation.operationId) || `${method.toUpperCase()} ${path}`, method: method.toUpperCase(), url: `${server}${path.replace(/\{([^}]+)\}/g, '{{$1}}')}`, params: parameters.filter(row => row.in === 'query').map(row => newEntry(string(row.name), '')),
      headers: parameters.filter(row => row.in === 'header').map(row => newEntry(string(row.name), '')) };
    const content = object(operation.requestBody?.content), media = Object.keys(content)[0];
    if (media) { draft.bodyType = media.includes('json') ? 'json' : media.includes('xml') ? 'xml' : 'text'; draft.body = content[media]?.example === undefined ? '' : typeof content[media].example === 'string' ? content[media].example : JSON.stringify(content[media].example, null, 2); }
    workspace.saved.push({ collectionId: root.id, request: draft });
  }
  if (!workspace.saved.length) throw new Error('The OpenAPI document contains no supported HTTP operations.');
  return validate(workspace);
}
function shellWords(input: string): string[] {
  const words: string[] = []; let word = '', quote = '', started = false;
  for (let i = 0; i < input.length; i++) { const c = input[i];
    if (!quote && /\s/.test(c)) { if (started) { words.push(word); word = ''; started = false; } continue; }
    if (c === "'" && quote !== '"' || c === '"' && quote !== "'") { quote = quote === c ? '' : c; started = true; continue; }
    if (c === '\\' && quote !== "'" && i + 1 < input.length) { word += input[++i]; started = true; continue; }
    word += c; started = true;
  }
  if (quote) throw new Error('The cURL command has an unfinished quote.');
  if (started) words.push(word);
  return words;
}
function curl(input: string): Workspace {
  const words = shellWords(input); if (!['curl', 'curl.exe'].includes(words.shift() || '')) throw new Error('Paste a cURL command beginning with curl.');
  const workspace = blank(), root = collection('Imported cURL'); workspace.collections.push(root);
  const draft = { ...newDraft(root.id), name: 'Imported request' };
  for (let i = 0; i < words.length; i++) { const option = words[i]; const next = () => { if (!words[i + 1]) throw new Error(`Missing value after ${option}.`); return words[++i]; };
    if (option === '-X' || option === '--request') draft.method = next().toUpperCase();
    else if (option === '-H' || option === '--header') { const value = next(), colon = value.indexOf(':'); if (colon < 1) throw new Error('Invalid cURL header.'); draft.headers.push(newEntry(value.slice(0, colon).trim(), value.slice(colon + 1).trim())); }
    else if (['-d', '--data', '--data-raw', '--data-binary'].includes(option)) { draft.body = next(); draft.bodyType = draft.headers.some(row => row.name.toLowerCase() === 'content-type' && row.value.includes('json')) ? 'json' : 'text'; if (draft.method === 'GET') draft.method = 'POST'; }
    else if (option === '-u' || option === '--user') { const value = next(), colon = value.indexOf(':'); draft.authType = 'basic'; draft.username = colon < 0 ? value : value.slice(0, colon); draft.password = colon < 0 ? '' : value.slice(colon + 1); }
    else if (option === '--url') draft.url = next();
    else if (option === '-L' || option === '--location') draft.followRedirects = true;
    else if (option === '--max-time') draft.timeoutMs = Math.min(60000, Math.max(100, Math.round(Number(next()) * 1000)));
    else if (/^https?:\/\//i.test(option)) draft.url = option;
    else if (option.startsWith('-')) throw new Error(`Unsupported cURL option: ${option}.`);
  }
  if (!draft.url) throw new Error('The cURL command has no HTTP URL.');
  workspace.saved.push({ collectionId: root.id, request: draft }); return validate(workspace);
}
export function importWorkspace(text: string, existing?: Workspace): { workspace: Workspace; format: string } {
  const trimmed = text.trim(); if (/^curl(?:\.exe)?(?:\s|$)/i.test(trimmed)) return { workspace: curl(trimmed), format: 'cURL' };
  const data = JSON.parse(trimmed) as Obj;
  if (data?.version === 1 && Array.isArray(data.collections)) return { workspace: parseWorkspace(trimmed), format: 'Reqora' };
  if (data?.values && Array.isArray(data.values) && typeof data.name === 'string') {
    const workspace = structuredClone(existing || blank());
    const id = crypto.randomUUID();
    workspace.environments = [...(workspace.environments || []), { id, name: string(data.name), variables: entries(data.values) }];
    workspace.activeEnvironmentId = id;
    return { workspace: validate(workspace), format: 'Postman environment' };
  }
  if (data?.info?.schema && Array.isArray(data.item)) return { workspace: postman(data), format: 'Postman' };
  if (data?.__export_format && Array.isArray(data.resources)) return { workspace: insomnia(data), format: 'Insomnia' };
  if (data?.openapi && data.paths) return { workspace: openapi(data), format: 'OpenAPI' };
  throw new Error('Unsupported import format. Use Reqora, Postman, Insomnia, OpenAPI JSON, or a cURL command.');
}
