import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RequestCookieJar } from '../server/cookies.ts';
import { executeRequest, validateRequest } from '../server/execute.ts';
import { runRequest } from '../server/pipeline.ts';
import { initialWorkspace, newDraft, parseWorkspace, prepareWorkspaceRequest, toCurl } from '../shared/workspace.ts';
import { publicRunReport } from '../shared/automation.ts';
import { runCollection } from '../shared/runner.ts';
import { newNetworkSettings } from '../shared/network.ts';
import type { CookieRecord, NetworkSettings } from '../shared/network.ts';
import type { HttpRequest } from '../shared/types.ts';

let base = '', secureBase = '', secondSecureBase = '', proxyBase = '', proxyCalls = 0, tunnels = 0, proxyAuth = '';
const certs = await Promise.all(['ca.pem', 'server.pem', 'server-key.pem', 'client.pem', 'client-key.pem', 'client-key-encrypted.pem'].map(name => readFile(new URL(`./fixtures/tls/${name}`, import.meta.url), 'utf8')));
const [caPem, serverPem, serverKeyPem, clientPem, clientKeyPem, encryptedKeyPem] = certs;
const resource = createServer((req, res) => {
  const url = new URL(req.url!, 'http://localhost');
  if (url.pathname === '/login') res.setHeader('Set-Cookie', ['sid=one; Path=/; HttpOnly', 'sub=two; Path=/sub; SameSite=Lax', 'gone=old; Max-Age=0; Path=/']);
  if (url.pathname === '/delete') res.setHeader('Set-Cookie', 'sid=; Max-Age=0; Path=/');
  if (url.pathname === '/redirect') { res.setHeader('Set-Cookie', 'redirect=yes; Path=/'); res.writeHead(302, { Location: '/see' }); res.end(); return; }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ cookie: req.headers.cookie || '', path: url.pathname }));
});
const secondary = createHttpsServer({ key: serverKeyPem, cert: serverPem, ca: caPem, requestCert: true, rejectUnauthorized: false }, (req, res) => {
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ authorized: (req.socket as TLSSocket).authorized, cookie: req.headers.cookie || '' }));
});
const secure = createHttpsServer({ key: serverKeyPem, cert: serverPem, ca: caPem, requestCert: true, rejectUnauthorized: false }, (req, res) => {
  if (req.url === '/cross') { res.writeHead(302, { Location: secondSecureBase + '/see' }); res.end(); return; }
  if (req.url === '/set') res.setHeader('Set-Cookie', 'secure=yes; Secure; Path=/');
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ authorized: (req.socket as TLSSocket).authorized, cookie: req.headers.cookie || '' }));
});
const proxy = createServer((req, res) => {
  proxyCalls++; proxyAuth = req.headers['proxy-authorization'] || '';
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ proxied: true, target: req.url }));
});
proxy.on('connect', (req, client, head) => {
  tunnels++; proxyAuth = req.headers['proxy-authorization'] || '';
  const [host, port] = req.url!.split(':');
  const upstream = connect(Number(port), host, () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); client.pipe(upstream); upstream.pipe(client); });
  upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy());
});
before(async () => {
  for (const server of [resource, secure, secondary, proxy]) await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = (server: typeof resource) => { const addr = server.address(); assert(addr && typeof addr !== 'string'); return `127.0.0.1:${addr.port}`; };
  base = `http://${url(resource)}`; secureBase = `https://${url(secure)}`; secondSecureBase = `https://${url(secondary)}`; proxyBase = `http://${url(proxy)}`;
});
after(async () => { for (const server of [resource, secure, secondary, proxy]) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
const request = (url: string, network = newNetworkSettings(), cookies?: CookieRecord[]): HttpRequest => ({ method: 'GET', url, headers: [], timeoutMs: 5000, followRedirects: true, network, ...(cookies ? { cookies } : {}) });
const cookie = (name: string, value: string, domain = '127.0.0.1', more: Partial<CookieRecord> = {}): CookieRecord => ({ id: crypto.randomUUID(), name, value, domain, path: '/', hostOnly: true, secure: false, httpOnly: false, sameSite: '', expiresAt: null, createdAt: Date.now(), ...more });
const config = (updates: Partial<NetworkSettings> = {}): NetworkSettings => ({ ...newNetworkSettings(), ...updates });

test('cookie jar stores Set-Cookie across sends, redirects, and workspace export/import', async () => {
  const initial = await executeRequest(request(base + '/login', newNetworkSettings(), []));
  assert.equal(initial.status, 200); assert.deepEqual(initial.cookies?.map(item => item.name).sort(), ['sid', 'sub']);
  assert.equal(initial.cookies?.find(item => item.name === 'sid')?.httpOnly, true);
  assert.equal(initial.cookies?.find(item => item.name === 'sid')?.expiresAt, null);
  const root = await executeRequest(request(base + '/see', newNetworkSettings(), initial.cookies));
  assert.equal(JSON.parse(root.body).cookie, 'sid=one');
  const sub = await executeRequest(request(base + '/sub/see', newNetworkSettings(), initial.cookies));
  assert.equal(JSON.parse(sub.body).cookie, 'sub=two; sid=one');
  const redirected = await executeRequest(request(base + '/redirect', newNetworkSettings(), initial.cookies));
  assert.match(JSON.parse(redirected.body).cookie, /redirect=yes/);
  assert(redirected.cookies?.some(item => item.name === 'redirect'));
  const gone = await executeRequest(request(base + '/delete', newNetworkSettings(), redirected.cookies));
  assert(!gone.cookies?.some(item => item.name === 'sid'));
  const value = initialWorkspace(); value.cookies = gone.cookies!;
  assert.deepEqual(parseWorkspace(JSON.stringify(value)).cookies, value.cookies);
});

test('cookie editor values obey domain, path, Secure, expiry, prefixes and explicit Cookie headers', async () => {
  const records = [cookie('host', 'one'), cookie('domain', 'two', 'example.com', { hostOnly: false }), cookie('secure', 'three', '127.0.0.1', { secure: true }), cookie('expired', 'old', '127.0.0.1', { expiresAt: Date.now() - 1000 })];
  const jar = new RequestCookieJar(records);
  assert.equal(jar.header(new URL(base + '/see')), 'host=one');
  assert.equal(jar.header(new URL('https://api.example.com/see')), 'domain=two');
  assert.match(jar.header(new URL(secureBase + '/see')), /secure=three/);
  assert(!jar.snapshot().some(item => item.name === 'expired'));
  assert.throws(() => new RequestCookieJar([cookie('all', 'bad', 'com', { hostOnly: false })]), /rejected/);
  assert.throws(() => new RequestCookieJar([cookie('__Host-invalid', 'bad', 'example.com', { hostOnly: false, secure: true })]), /rejected/);
  const explicit = await executeRequest({ ...request(base + '/see', newNetworkSettings(), [records[0]]), headers: [{ name: 'Cookie', value: 'manual=only' }] });
  assert.equal(JSON.parse(explicit.body).cookie, 'manual=only');
  assert.equal(JSON.parse((await executeRequest(request(base + '/see', config({ useCookies: false }), [records[0]]))).body).cookie, '');
});

test('request and collection runs carry cookie changes; reports omit the jar; CLI persists it on request', async () => {
  const workspace = initialWorkspace(), collection = workspace.collections[0];
  const login = { ...newDraft(collection.id), url: base + '/login' }, next = { ...newDraft(collection.id), url: base + '/see', assertions: [] };
  workspace.saved = [{ collectionId: collection.id, request: login }, { collectionId: collection.id, request: next }];
  const single = await runRequest({ request: login, globals: [], collection, cookies: [] });
  assert(single.cookies?.some(item => item.name === 'sid'));
  const received: CookieRecord[][] = [];
  const report = await runCollection(workspace, collection.id, { iterations: 1, delayMs: 0, data: [], stopOnFailure: true }, { execute: runRequest, onCookieUpdate: cookies => received.push(cookies) });
  assert.equal(report.passed, 2); assert.equal(received.length, 1);
  assert(report.cookies?.some(item => item.name === 'sid'));
  assert(!JSON.stringify(publicRunReport(report)).includes('sid'));
  const directory = await mkdtemp(join(tmpdir(), 'reqora-cookie-cli-'));
  try {
    const input = join(directory, 'input.json'), output = join(directory, 'output.json'), reportFile = join(directory, 'report.json');
    await writeFile(input, JSON.stringify(workspace));
    const result = await promisify(execFile)(process.execPath, ['cli/reqora.mjs', 'run', input, '--report', reportFile, '--save-variables', output, '--quiet'], { cwd: process.cwd() });
    assert.match(result.stdout, /2 passed/);
    assert((JSON.parse(await readFile(output, 'utf8')).cookies as CookieRecord[]).some(item => item.name === 'sid'));
    assert(!JSON.stringify(JSON.parse(await readFile(reportFile, 'utf8'))).includes('"cookies"'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('custom and environment proxies route HTTP; bypass and direct mode avoid them', async () => {
  const proxySettings = config({ proxy: { mode: 'custom', url: proxyBase.replace('http://', 'http://user:pass@'), bypass: '' } });
  const before = proxyCalls;
  const through = await executeRequest(request(base + '/see', proxySettings));
  assert.equal(JSON.parse(through.body).proxied, true, `body=${through.body} calls=${proxyCalls} before=${before}`); assert.equal(proxyCalls, before + 1);
  assert.equal(proxyAuth, `Basic ${Buffer.from('user:pass').toString('base64')}`);
  const bypass = config({ proxy: { ...proxySettings.proxy, bypass: '127.0.0.1' } });
  assert.equal(JSON.parse((await executeRequest(request(base + '/see', bypass))).body).cookie, '');
  assert.equal(proxyCalls, before + 1);
  const old = process.env.http_proxy;
  try {
    process.env.http_proxy = proxyBase;
    const response = await executeRequest(request(base + '/see', config({ proxy: { mode: 'environment', url: '', bypass: '' } })));
    assert.equal(JSON.parse(response.body).proxied, true);
  }
  finally { if (old === undefined) delete process.env.http_proxy; else process.env.http_proxy = old; }
  assert.equal(JSON.parse((await executeRequest(request(base + '/see'))).body).cookie, '');
  await assert.rejects(executeRequest(request(base, config({ proxy: { mode: 'custom', url: 'socks5://localhost:1080', bypass: '' } }))), /HTTP or HTTPS/);
  assert.match(toCurl(request(base, proxySettings)), /--proxy/);
});

test('custom CA and client certificate authenticate directly and through an HTTPS proxy tunnel', async () => {
  await assert.rejects(executeRequest(request(secureBase + '/see')), /Unable to connect/);
  const trusted = config({ tls: { caPem, clientCertPem: '', clientKeyPem: '', clientKeyPassphrase: '' } });
  assert.equal(JSON.parse((await executeRequest(request(secureBase + '/see', trusted))).body).authorized, false);
  const mutual = config({ tls: { ...trusted.tls, clientCertPem: clientPem, clientKeyPem } });
  assert.equal(JSON.parse((await executeRequest(request(secureBase + '/see', mutual))).body).authorized, true);
  const encrypted = config({ tls: { ...mutual.tls, clientKeyPem: encryptedKeyPem, clientKeyPassphrase: 'reqora-test' } });
  assert.equal(JSON.parse((await executeRequest(request(secureBase + '/see', encrypted))).body).authorized, true);
  const throughProxy = config({ ...mutual, proxy: { mode: 'custom', url: proxyBase, bypass: '' } });
  const old = tunnels;
  assert.equal(JSON.parse((await executeRequest(request(secureBase + '/see', throughProxy))).body).authorized, true); assert.equal(tunnels, old + 1);
  assert.equal(JSON.parse((await executeRequest(request(secureBase + '/cross', mutual))).body).authorized, false);
  await assert.rejects(executeRequest(request(secureBase + '/see', config({ tls: { ...mutual.tls, caPem: 'broken' } }))), /Custom CA/);
  await assert.rejects(executeRequest(request(secureBase + '/see', config({ tls: { ...mutual.tls, clientKeyPem: serverKeyPem } }))), /do not match/);
  assert.throws(() => toCurl(request(secureBase + '/see', mutual)), /certificate files/);
});

test('workspace and direct API validation reject malformed network and cookie configuration', () => {
  const workspace = initialWorkspace();
  workspace.saved[0].request.network.proxy.mode = 'custom'; workspace.saved[0].request.network.proxy.url = '{{proxy}}';
  workspace.variables.push({ id: 'proxy', enabled: true, name: 'proxy', value: proxyBase });
  const prepared = prepareWorkspaceRequest(workspace, workspace.saved[0].request);
  assert.equal(prepared.network?.proxy.url, proxyBase);
  assert.throws(() => parseWorkspace(JSON.stringify({ ...workspace, cookies: [cookie('bad name', 'x')] })), /valid Reqora/);
  assert.throws(() => validateRequest({ ...request(base), network: { proxy: { mode: 'bad' } } }), /Invalid proxy/);
  assert.throws(() => validateRequest({ ...request(base), cookies: [cookie('x', 'value; injection')] }), /Invalid cookie/);
});
