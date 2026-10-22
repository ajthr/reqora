import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReqoraServer } from '../server/index.ts';
import { executeRequest, MAX_RESPONSE_BYTES, RequestError, validateRequest } from '../server/execute.ts';
import { initialWorkspace, newDraft, newEntry, prepareWorkspaceRequest } from '../src/lib/workspace.ts';

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
let observeStarted = () => {};
let observeClosed = () => {};
const fixture = createServer(async (req, res) => {
  if (req.url === '/observe') {
    res.on('close', () => observeClosed());
    observeStarted();
    return;
  }
  if (req.url === '/slow') {
    const timer = setTimeout(() => res.end('late'), 1000);
    req.on('close', () => clearTimeout(timer));
    return;
  }
  if (req.url === '/large') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('x'.repeat(MAX_RESPONSE_BYTES + 1)); return; }
  if (req.url === '/redirect') { res.writeHead(302, { location: '/echo' }); res.end(); return; }
  if (req.url === '/binary') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(Buffer.from([0, 1, 255])); return; }
  if (req.url === '/gzip') { res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }); res.end(gzipSync('{"compressed":true}')); return; }
  if (req.url === '/missing') { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'] });
  res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() }));
});
const api = createReqoraServer();
let fixtureUrl: string;
let apiUrl: string;
let desktopServer: Server;
let desktopUrl: string;
let staticDirectory: string;
before(async () => {
  fixtureUrl = await listen(fixture);
  apiUrl = await listen(api);
  staticDirectory = await mkdtemp(join(tmpdir(), 'reqora-test-'));
  await mkdir(join(staticDirectory, 'assets'));
  await writeFile(join(staticDirectory, 'index.html'), '<title>Reqora</title>');
  await writeFile(join(staticDirectory, 'assets', 'app.js'), 'export {};');
  desktopServer = createReqoraServer({ staticDirectory });
  desktopUrl = await listen(desktopServer);
});
after(async () => {
  for (const server of [api, fixture, desktopServer]) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  await rm(staticDirectory, { recursive: true, force: true });
});
const request = (path = '/echo') => ({ url: fixtureUrl + path, method: 'GET', headers: [], timeoutMs: 2000, followRedirects: true });

test('forwards methods, query, headers, body and separate response cookies', async () => {
  const response = await executeRequest({ ...request('/echo?q=hello'), method: 'POST', body: '{"hello":"world"}', headers: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Authorization', value: 'Bearer example' }] });
  const echo = JSON.parse(response.body);
  assert.equal(echo.method, 'POST');
  assert.equal(echo.url, '/echo?q=hello');
  assert.equal(echo.body, '{"hello":"world"}');
  assert.equal(echo.headers.authorization, 'Bearer example');
  assert.equal(response.headers.filter(header => header.name === 'set-cookie').length, 2);
  assert.equal(response.size, Buffer.byteLength(response.body));
  assert(response.durationMs >= 0);
});
test('returns HTTP errors as inspectable responses', async () => { const response = await executeRequest(request('/missing')); assert.equal(response.status, 404); assert.equal(response.body, 'Not found'); });
test('supports HEAD without a response body', async () => { const response = await executeRequest({ ...request(), method: 'HEAD' }); assert.equal(response.body, ''); assert.equal(response.size, 0); });
test('redirect setting controls whether redirects are followed', async () => {
  assert.equal((await executeRequest(request('/redirect'))).status, 200);
  assert.equal((await executeRequest({ ...request('/redirect'), followRedirects: false })).status, 302);
});
test('decodes compressed JSON and preserves binary content', async () => {
  assert.deepEqual(JSON.parse((await executeRequest(request('/gzip'))).body), { compressed: true });
  const response = await executeRequest(request('/binary'));
  assert.equal(response.encoding, 'base64');
  assert.deepEqual(Buffer.from(response.body, 'base64'), Buffer.from([0, 1, 255]));
});
test('enforces timeout, cancellation, and streamed response limits', async () => {
  await assert.rejects(executeRequest({ ...request('/slow'), timeoutMs: 100 }), (error: unknown) => error instanceof RequestError && error.status === 504);
  const controller = new AbortController();
  const pending = executeRequest(request('/slow'), controller.signal);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, (error: unknown) => error instanceof RequestError && error.status === 499);
  await assert.rejects(executeRequest(request('/large')), (error: unknown) => error instanceof RequestError && error.status === 413);
});
test('rejects unsupported schemes, invalid headers, GET bodies, and out-of-range timeouts', () => {
  for (const changes of [{ url: 'file:///etc/passwd' }, { url: 'http://user:pass@example.com' }, { headers: [{ name: 'Host', value: 'other.com' }] }, { headers: [{ name: 'x-test', value: 'bad\r\nvalue' }] }, { method: 'CONNECT' }, { body: 'invalid' }, { timeoutMs: 0 }, { followRedirects: 'yes' }]) assert.throws(() => validateRequest({ ...request(), ...changes }), RequestError);
  assert.throws(() => validateRequest({ ...request(), headers: [{ name: 'x-test', value: '☃' }] }), RequestError);
});
test('API accepts a request, reports health, and validates method/content/origin', async () => {
  assert.equal((await fetch(apiUrl + '/api/health')).status, 200);
  const response = await fetch(apiUrl + '/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: apiUrl }, body: JSON.stringify(request()) });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { status: number }).status, 200);
  assert.equal((await fetch(apiUrl + '/api/execute')).status, 405);
  assert.equal((await fetch(apiUrl + '/api/execute', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(apiUrl + '/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://elsewhere.example' }, body: '{}' })).status, 403);
  assert.equal((await fetch(apiUrl + '/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'null' }, body: '{}' })).status, 403);
  assert.equal((await fetch(apiUrl + '/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status, 400);
});
test('API rejects oversized requests with a JSON error', async () => {
  const response = await fetch(apiUrl + '/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: 'x'.repeat(1024 * 1024) }) });
  assert.equal(response.status, 413);
  assert.match((await response.json() as { error: string }).error, /1 MB/);
});

test('collection variables resolve before a request is forwarded through the API', async () => {
  const workspace = initialWorkspace();
  workspace.variables = [newEntry('base_url', 'https://unreachable.invalid'), newEntry('scope', 'global')];
  const collection = workspace.collections[0];
  collection.variables = [newEntry('base_url', fixtureUrl), newEntry('scope', 'collection')];
  const request = { ...newDraft(collection.id), method: 'POST', url: '{{base_url}}/echo', params: [newEntry('source', '{{scope}}')], headers: [newEntry('X-Scope', '{{scope}}')], bodyType: 'json' as const, body: '{"scope":"{{scope}}"}' };
  const response = await fetch(apiUrl + '/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prepareWorkspaceRequest(workspace, request)) });
  assert.equal(response.status, 200);
  const result = await response.json() as { status: number; body: string };
  assert.equal(result.status, 200);
  const echo = JSON.parse(result.body);
  assert.equal(echo.url, '/echo?source=collection');
  assert.equal(echo.headers['x-scope'], 'collection');
  assert.equal(echo.body, '{"scope":"collection"}');
});

test('disconnecting from the API cancels the upstream request', async () => {
  const started = new Promise<void>(resolve => { observeStarted = resolve; });
  const closed = new Promise<void>(resolve => { observeClosed = resolve; });
  const controller = new AbortController();
  const pending = fetch(apiUrl + '/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request('/observe')), signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Upstream request was not cancelled.')), 1000); })]);
  } finally { clearTimeout(timer); }
});

test('desktop server serves UI, assets, and API from one origin and blocks path traversal', async () => {
  assert.equal(await (await fetch(desktopUrl)).text(), '<title>Reqora</title>');
  const asset = await fetch(desktopUrl + '/assets/app.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type')!, /javascript/);
  assert.equal(await (await fetch(desktopUrl + '/assets/app.js', { method: 'HEAD' })).text(), '');
  assert.equal((await fetch(desktopUrl + '/api/health')).status, 200);
  assert.equal((await fetch(desktopUrl + '/assets/missing.js')).status, 404);
  assert.equal((await fetch(desktopUrl + '/%2e%2e%2fsecret.txt')).status, 403);
});
