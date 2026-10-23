import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReqoraServer } from '../server/index.ts';
import { executeRequest, MAX_RESPONSE_BYTES, RequestError, validateRequest } from '../server/execute.ts';
import { MAX_API_BYTES, MAX_BODY_BYTES } from '../shared/body.ts';
import { initialWorkspace, newDraft, newEntry, prepareWorkspaceRequest, workspaceToCurl } from '../src/lib/workspace.ts';

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
  if (req.url === '/inspect-body') {
    const bytes = Buffer.concat(chunks);
    const contentType = req.headers['content-type'] || '';
    const parts = contentType.startsWith('multipart/form-data')
      ? await Promise.all([...(await new Request('http://fixture/', { method: 'POST', headers: { 'Content-Type': contentType }, body: bytes }).formData())].map(async ([name, value]) => typeof value === 'string' ? { name, value } : { name, filename: value.name, type: value.type, data: Buffer.from(await value.arrayBuffer()).toString('base64') }))
      : undefined;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ contentType, data: parts ? undefined : bytes.toString('base64'), parts }));
    return;
  }
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
test('supports HEAD without a response body and ignores empty GET bodies', async () => {
  const response = await executeRequest({ ...request(), method: 'HEAD' }); assert.equal(response.body, ''); assert.equal(response.size, 0);
  assert.equal((await executeRequest({ ...request(), body: '' })).status, 200);
});
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
  const response = await fetch(apiUrl + '/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: 'x'.repeat(MAX_API_BYTES) }) });
  assert.equal(response.status, 413);
  assert.match((await response.json() as { error: string }).error, /16 MB/);
});

test('binary bodies preserve arbitrary bytes, empty files, and explicit media types through the API', async () => {
  for (const data of [Buffer.from([0, 255, 128, 13, 10, 0, 123, 125]), Buffer.alloc(0), Buffer.alloc(2 * 1024 * 1024, 255)]) {
    const input = { ...request('/inspect-body'), method: 'PUT', timeoutMs: 10_000, headers: [{ name: 'Content-Type', value: 'application/x-reqora-test' }], body: { kind: 'binary', file: { name: 'payload.bin', type: 'application/octet-stream', data: data.toString('base64') } } };
    const response = await fetch(apiUrl + '/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal(response.status, 200);
    const payload = await response.json() as { body: string };
    const echo = JSON.parse(payload.body);
    assert.equal(echo.data, data.toString('base64'));
    assert.equal(echo.contentType, 'application/x-reqora-test');
  }
});

test('multipart sends repeated text/file fields, Unicode filenames, empty values, and a generated boundary', async () => {
  const bytes = Buffer.from([0, 255, 13, 10, 1]);
  const response = await executeRequest({ ...request('/inspect-body'), method: 'POST', headers: [{ name: 'Content-Type', value: 'multipart/form-data; boundary=wrong' }], body: { kind: 'multipart', parts: [
    { name: 'tags', value: '@literal;type=text/html' }, { name: 'tags', value: 'héllo\nworld' }, { name: 'blank', value: '' },
    { name: 'files', file: { name: 'résumé "one".bin', type: 'application/octet-stream', data: bytes.toString('base64') } },
    { name: 'files', file: { name: 'empty.txt', type: 'text/plain', data: '' } },
  ] } });
  const echo = JSON.parse(response.body);
  assert.match(echo.contentType, /^multipart\/form-data; boundary=/);
  assert(!echo.contentType.endsWith('wrong'));
  assert.deepEqual(echo.parts, [
    { name: 'tags', value: '@literal;type=text/html' }, { name: 'tags', value: 'héllo\r\nworld' }, { name: 'blank', value: '' },
    { name: 'files', filename: 'résumé "one".bin', type: 'application/octet-stream', data: bytes.toString('base64') },
    { name: 'files', filename: 'empty.txt', type: 'text/plain', data: '' },
  ]);
});

test('body validation rejects malformed encodings, multipart injection, and combined/encoded body overflows', async () => {
  const file = { name: 'test.bin', type: 'application/octet-stream', data: 'AA==' };
  for (const body of [null, [], 42, { kind: 'unknown' }, { kind: 'binary', file: { ...file, data: 'A===' } },
    { kind: 'binary', file: { ...file, data: 'AB==' } }, { kind: 'binary', file: { ...file, data: 'éé==' } },
    { kind: 'binary', file: { ...file, name: '../secret' } }, { kind: 'binary', file: { ...file, type: 'text/plain\r\nX-Injected: yes' } },
    { kind: 'multipart', parts: [{ name: 'x\r\nheader', value: 'x' }] }, { kind: 'multipart', parts: [{ name: '', value: 'x' }] },
    { kind: 'multipart', parts: [{ name: 'field', value: 'x', file }] },
    { kind: 'multipart', parts: Array.from({ length: 101 }, () => ({ name: 'x', value: '' })) },
  ]) assert.throws(() => validateRequest({ ...request(), method: 'POST', body }), RequestError);
  assert.throws(() => validateRequest({ ...request(), body: { kind: 'binary', file } }), /GET requests cannot contain a body/);
  assert.throws(() => validateRequest({ ...request(), method: 'POST', body: 'x'.repeat(MAX_BODY_BYTES + 1) }), (error: unknown) => error instanceof RequestError && error.status === 413);
  assert.throws(() => validateRequest({ ...request(), method: 'POST', body: { kind: 'multipart', parts: [{ name: 'a', value: 'x'.repeat(MAX_BODY_BYTES / 2) }, { name: 'b', value: 'x'.repeat(MAX_BODY_BYTES / 2) }] } }), /10 MB/);
  await assert.rejects(executeRequest({ ...request(), method: 'POST', body: { kind: 'multipart', parts: [{ name: 'f', file: { ...file, data: Buffer.alloc(MAX_BODY_BYTES).toString('base64') } }] } }), /10 MB/);
  const response = await fetch(apiUrl + '/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request(), method: 'POST', body: 'x'.repeat(MAX_BODY_BYTES + 1) }) });
  assert.equal(response.status, 413);
  assert.match((await response.json() as { error: string }).error, /10 MB/);
});

test('generated cURL uploads real multipart and binary files with shell-safe filenames', { skip: process.platform === 'win32' }, async context => {
  const exec = promisify(execFile);
  try { await exec('curl', ['--version']); } catch { context.skip('curl is unavailable'); return; }
  const directory = await mkdtemp(join(tmpdir(), 'reqora-curl-'));
  try {
    const name = 'résumé ";$payload,1.bin';
    const bytes = Buffer.from([0, 255, 1, 128]);
    await writeFile(join(directory, name), bytes);
    const file = { id: 'attachment', name, size: bytes.length, type: 'application/octet-stream; profile="reqora;headers=@./missing"' };
    const draft = { ...newDraft(), method: 'POST', url: fixtureUrl + '/inspect-body', bodyType: 'multipart' as const, multipartFields: [
      { ...newEntry('text', '@literal;type=text/html'), kind: 'text' as const },
      { ...newEntry('files'), kind: 'file' as const, file },
    ] };
    const workspace = initialWorkspace();
    const echo = JSON.parse((await exec('/bin/sh', ['-c', workspaceToCurl(workspace, draft)], { cwd: directory })).stdout);
    assert.deepEqual(echo.parts, [{ name: 'text', value: '@literal;type=text/html' }, { name: 'files', filename: name, type: file.type, data: bytes.toString('base64') }]);
    const binary = JSON.parse((await exec('/bin/sh', ['-c', workspaceToCurl(workspace, { ...draft, bodyType: 'binary', binaryFile: file })], { cwd: directory })).stdout);
    assert.equal(binary.data, bytes.toString('base64'));
  } finally { await rm(directory, { recursive: true, force: true }); }
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
