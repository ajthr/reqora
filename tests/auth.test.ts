import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { createHash, createHmac, generateKeyPairSync, verify } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authConfigurationKey, applyAuthenticationUpdates, effectiveAuth, newAuthConfig } from '../shared/auth.ts';
import type { AuthConfig, OAuth2Auth } from '../shared/auth.ts';
import { initialWorkspace, newDraft, newEntry, parseWorkspace, prepareWorkspaceRequest, toCurl } from '../shared/workspace.ts';
import { publicRunReport } from '../shared/automation.ts';
import { runCollection } from '../shared/runner.ts';
import { digestAuthorization, digestChallenge, oauth1Authorization, percentEncode, signAws } from '../server/auth-signing.ts';
import { authEndpoint, oauth2Binding, oauth2Token, usableOAuth2 } from '../server/oauth.ts';
import { executeRequest, validateRequest } from '../server/execute.ts';
import { runRequest } from '../server/pipeline.ts';
import { createReqoraServer } from '../server/index.ts';
import type { HttpRequest, RequestBody } from '../shared/types.ts';

const hash = (value: string | Buffer, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex');
const hmac = (key: string | Buffer, value: string, encoding?: 'hex') => encoding ? createHmac('sha256', key).update(value).digest(encoding) : createHmac('sha256', key).update(value).digest();
const authParams = (value: string) => Object.fromEntries([...value.matchAll(/([\w*-]+)=(?:"((?:[^"\\]|\\.)*)"|([^,\s]+))/g)].map(match => [match[1], (match[2] ?? match[3]).replace(/\\(.)/g, '$1')]));
const oauthParams = (value: string) => Object.fromEntries(Object.entries(authParams(value)).map(([name, value]) => [name, decodeURIComponent(value)]));
const codes = new Map<string, { client: string; redirect: string; challenge: string }>();
const tokens = new Map<string, string>(), refreshes = new Map<string, string>(), temporary = new Map<string, string>();
let base = '', apiBase = '', secondBase = '', serial = 0, tokenCalls = 0, digestCalls = 0;
const issue = (client: string) => {
  const access = `access-${client}-${++serial}`, refresh = `refresh-${client}-${serial}`;
  tokens.set(access, client); refreshes.set(refresh, client);
  return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600 };
};
function oauth1Valid(req: IncomingMessage, body: string, secret: string): boolean {
  const values = oauthParams(req.headers.authorization || ''), signature = values.oauth_signature;
  delete values.oauth_signature; delete values.realm;
  const url = new URL(req.url!, base), pairs = [...url.searchParams, ...Object.entries(values)];
  if (req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) pairs.push(...new URLSearchParams(body));
  const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const normalized = pairs.map(([k, v]) => [encode(k), encode(v)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0).map(pair => pair.join('=')).join('&');
  const text = [req.method, encode(`${url.origin}${url.pathname}`), encode(normalized)].join('&');
  return signature === createHmac('sha1', `consumer-secret&${encode(secret)}`).update(text).digest('base64');
}
function awsValid(req: IncomingMessage, body: Buffer): boolean {
  const authorization = req.headers.authorization || '';
  const match = /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, SignedHeaders=([^,]+), Signature=([a-f\d]+)$/.exec(authorization);
  if (!match || hash(body) !== req.headers['x-amz-content-sha256']) return false;
  const [, date, region, service, names, signature] = match, url = new URL(req.url!, base);
  const query = [...url.searchParams].map(([k, v]) => [percentEncode(k), percentEncode(v)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0).map(pair => pair.join('=')).join('&');
  const canonicalHeaders = names.split(';').map(name => `${name}:${String(req.headers[name]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const path = service === 's3' ? url.pathname : percentEncode(url.pathname).replace(/%2F/g, '/');
  const canonical = [req.method, path, query, canonicalHeaders, names, hash(body)].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const signingKey = hmac(hmac(hmac(hmac('AWS4secret-example', date), region), service), 'aws4_request');
  return hmac(signingKey, `AWS4-HMAC-SHA256\n${req.headers['x-amz-date']}\n${scope}\n${hash(canonical)}`, 'hex') === signature;
}
const fixture = createServer(async (req, res) => {
  try {
    const url = new URL(req.url!, base || 'http://fixture');
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks), form = new URLSearchParams(body.toString());
    const json = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/authorize') {
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      const code = `code-${++serial}`;
      codes.set(code, { client: url.searchParams.get('client_id')!, redirect: url.searchParams.get('redirect_uri')!, challenge: url.searchParams.get('code_challenge')! });
      const callback = new URL(url.searchParams.get('redirect_uri')!); callback.searchParams.set('code', code); callback.searchParams.set('state', url.searchParams.get('state')!);
      res.writeHead(302, { Location: callback.href }); res.end(); return;
    }
    if (url.pathname === '/token-redirect') { res.writeHead(307, { Location: `${base}/token` }); res.end(); return; }
    if (url.pathname === '/token') {
      tokenCalls++;
      let client = form.get('client_id') || '';
      if (req.headers.authorization?.startsWith('Basic ')) {
        const [id, secret] = Buffer.from(req.headers.authorization.slice(6), 'base64').toString().split(':');
        client = new URLSearchParams(`x=${id}`).get('x')!;
        if (new URLSearchParams(`x=${secret}`).get('x') !== 'sëcret:+') { json(401, { error: 'invalid_client' }); return; }
      } else if (form.has('client_secret') && form.get('client_secret') !== 'sëcret:+') { json(401, { error: 'invalid_client' }); return; }
      if (!client) { json(400, { error: 'invalid_client' }); return; }
      if (form.get('grant_type') === 'authorization_code') {
        const code = form.get('code')!, record = codes.get(code); codes.delete(code);
        if (!record || record.client !== client || record.redirect !== form.get('redirect_uri') || record.challenge !== createHash('sha256').update(form.get('code_verifier') || '').digest('base64url')) { json(400, { error: 'invalid_grant' }); return; }
      } else if (form.get('grant_type') === 'refresh_token') {
        const token = form.get('refresh_token')!;
        if (refreshes.get(token) !== client) { json(400, { error: 'invalid_grant' }); return; }
        refreshes.delete(token);
      } else if (form.get('grant_type') !== 'client_credentials') { json(400, { error: 'unsupported_grant_type' }); return; }
      json(200, issue(client)); return;
    }
    if (url.pathname === '/oauth1/request') {
      if (!oauth1Valid(req, body.toString(), '')) { json(401, {}); return; }
      const values = oauthParams(req.headers.authorization!), token = `temporary-${++serial}`;
      temporary.set(token, values.oauth_callback);
      res.end(new URLSearchParams({ oauth_token: token, oauth_token_secret: 'temporary-secret', oauth_callback_confirmed: 'true' }).toString()); return;
    }
    if (url.pathname === '/oauth1/authorize') {
      const token = url.searchParams.get('oauth_token')!, callback = temporary.get(token)!;
      if (callback === 'oob') { res.end('verifier-123'); return; }
      const redirect = new URL(callback); redirect.searchParams.set('oauth_token', token); redirect.searchParams.set('oauth_verifier', 'verifier-123');
      res.writeHead(302, { Location: redirect.href }); res.end(); return;
    }
    if (url.pathname === '/oauth1/access') {
      const values = oauthParams(req.headers.authorization || '');
      if (!oauth1Valid(req, body.toString(), 'temporary-secret') || !temporary.has(values.oauth_token) || values.oauth_verifier !== 'verifier-123') { json(401, {}); return; }
      temporary.delete(values.oauth_token); res.end('oauth_token=access-one&oauth_token_secret=access-secret'); return;
    }
    if (url.pathname === '/oauth1/resource' && !oauth1Valid(req, body.toString(), 'access-secret')) { json(401, {}); return; }
    if (url.pathname === '/resource' && tokens.get((req.headers.authorization || '').replace(/^Bearer /, '')) !== url.searchParams.get('client')) { json(401, {}); return; }
    if (url.pathname.startsWith('/aws') && !awsValid(req, body)) { json(401, { error: 'invalid_signature' }); return; }
    if (url.pathname === '/digest') {
      digestCalls++;
      const algorithm = url.searchParams.get('algorithm') || 'MD5', qop = url.searchParams.get('qop') || 'auth', values = authParams(req.headers.authorization || '');
      const nonce = values.nonce || 'first-nonce';
      const h = (v: string | Buffer) => hash(v, algorithm.startsWith('SHA-512-256') ? 'sha512-256' : algorithm.startsWith('SHA-256') ? 'sha256' : 'md5');
      let a1 = h('user:fixture:password'); if (algorithm.endsWith('-sess')) a1 = h(`${a1}:${nonce}:${values.cnonce}`);
      const a2 = h(`${req.method}:${req.url}${qop === 'auth-int' ? ':' + h(body) : ''}`);
      const expected = h(`${a1}:${nonce}:${values.nc}:${values.cnonce}:${qop}:${a2}`);
      const stale = url.searchParams.has('stale') && values.nonce === 'first-nonce';
      if (values.response !== expected || stale) { res.writeHead(401, { 'WWW-Authenticate': `Basic realm="other", Digest realm="fixture", nonce="${stale ? 'next-nonce' : 'first-nonce'}", algorithm=${algorithm}, qop="${qop}"${stale ? ', stale=true' : ''}` }); res.end(); return; }
    }
    if (url.pathname === '/redirect') { res.writeHead(307, { Location: `${url.searchParams.get('cross') ? secondBase : base}${url.searchParams.get('target') || '/echo'}?api_key=reflected-secret` }); res.end(); return; }
    json(200, { headers: req.headers, url: req.url, body: body.toString('base64') });
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});
const secondary = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ headers: req.headers, url: req.url })); });
const api = createReqoraServer();
before(async () => {
  for (const server of [fixture, secondary, api]) await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = (server: typeof fixture) => { const addr = server.address(); assert(addr && typeof addr !== 'string'); return `http://127.0.0.1:${addr.port}`; };
  base = address(fixture); secondBase = address(secondary); apiBase = address(api);
});
after(async () => { for (const server of [fixture, secondary, api]) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
const http = (path: string, auth: AuthConfig, body?: RequestBody): HttpRequest => ({ url: base + path, method: body === undefined ? 'GET' : 'POST', headers: [], body, auth, timeoutMs: 5000, followRedirects: true });
const post = async (input: unknown, origin = apiBase) => {
  const response = await fetch(`${apiBase}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(input) });
  return { status: response.status, value: await response.json() as Record<string, any> };
};
const oauth2 = (client = 'client'): OAuth2Auth => ({ ...newAuthConfig().oauth2, clientId: client, grantType: 'client_credentials', tokenUrl: `${base}/token` });
const oauth1 = (): AuthConfig => ({ ...newAuthConfig('oauth1'), oauth1: { ...newAuthConfig().oauth1, consumerKey: 'consumer', consumerSecret: 'consumer-secret', token: 'access-one', tokenSecret: 'access-secret', requestTokenUrl: `${base}/oauth1/request`, authorizationUrl: `${base}/oauth1/authorize`, accessTokenUrl: `${base}/oauth1/access` } });
const aws = (): AuthConfig => ({ ...newAuthConfig('aws'), aws: { ...newAuthConfig().aws, accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret-example', sessionToken: 'temporary-session' } });

test('OAuth 1 normalizes repeated query and form fields and matches the corrected RFC 5849 POST vector', () => {
  const config = { ...newAuthConfig().oauth1, consumerKey: '9djdj82h48djs9d2', consumerSecret: 'j49sk3j29djd', token: 'kkk9d7dh3k39sjv7', tokenSecret: 'dh893hdasih9' };
  const signed = oauth1Authorization('POST', new URL('http://example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b'), new Headers({ 'content-type': 'application/x-www-form-urlencoded' }), 'c2&a3=2+q', config, { nonce: '7d8f3e4a', timestamp: '137131201', includeVersion: false });
  assert.equal(oauthParams(signed.authorization).oauth_signature, 'r6/TJjbCOr97/+UU0NsvSne7s5g=');
  const sha256 = oauth1Authorization('GET', new URL('https://example.com/a'), new Headers(), undefined, { ...config, signatureMethod: 'HMAC-SHA256' });
  assert.equal(oauthParams(sha256.authorization).oauth_signature, createHmac('sha256', `${config.consumerSecret}&${config.tokenSecret}`).update(sha256.baseString).digest('base64'));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rsa = oauth1Authorization('GET', new URL('https://example.com/a'), new Headers(), undefined, { ...config, signatureMethod: 'RSA-SHA1', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  assert(verify('RSA-SHA1', Buffer.from(rsa.baseString), publicKey, Buffer.from(oauthParams(rsa.authorization).oauth_signature, 'base64')));
  const plain = oauth1Authorization('GET', new URL('https://example.com/a'), new Headers(), undefined, { ...config, signatureMethod: 'PLAINTEXT', consumerSecret: 'a&b', tokenSecret: 'c d' });
  assert.equal(oauthParams(plain.authorization).oauth_signature, 'a%26b&c%20d');
});

test('Digest matches RFC MD5, chooses strongest challenge and supports UTF-8 usernames', () => {
  const signed = digestAuthorization('GET', new URL('http://www.example.com/dir/index.html'), undefined, 'Mufasa', 'Circle Of Life', { realm: 'testrealm@host.com', nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093', algorithm: 'MD5', qop: 'auth' }, { cnonce: '0a4f113b', nc: 1 });
  assert.equal(authParams(signed).response, '6629fae49393a05397450978507c4ef1');
  const challenge = digestChallenge('Basic realm="x", Digest realm="a,b", nonce="n", algorithm=MD5, Digest realm = "strong", nonce = "s", algorithm=SHA-256, qop="auth,auth-int"');
  assert.equal(challenge?.realm, 'strong'); assert.equal(challenge?.algorithm, 'SHA-256');
  const unicode = digestAuthorization('GET', new URL(base), undefined, 'Jäsøn', 'päss', { realm: 'realm', nonce: 'n', algorithm: 'SHA-256', qop: 'auth', charset: 'UTF-8' });
  assert.match(unicode, /username\*=UTF-8''J%C3%A4s%C3%B8n/);
  assert.throws(() => digestAuthorization('GET', new URL(base), undefined, '漢字', '', { realm: 'realm', nonce: 'n', algorithm: 'MD5' }), /UTF-8/);
});

test('Digest negotiates algorithms, auth-int bodies, stale nonce and bounded wrong-password retries', async () => {
  for (const algorithm of ['MD5', 'MD5-sess', 'SHA-256', 'SHA-256-sess', 'SHA-512-256', 'SHA-512-256-sess']) for (const qop of ['auth', 'auth-int']) {
    const response = await executeRequest(http(`/digest?algorithm=${algorithm}&qop=${qop}`, { authType: 'digest', username: 'user', password: 'password' }, 'exact body✓'));
    assert.equal(response.status, 200, `${algorithm}/${qop}`);
  }
  let before = digestCalls;
  assert.equal((await executeRequest(http('/digest?stale', { authType: 'digest', username: 'user', password: 'password' }))).status, 200);
  assert.equal(digestCalls - before, 3);
  before = digestCalls;
  assert.equal((await executeRequest(http('/digest', { authType: 'digest', username: 'user', password: 'wrong' }))).status, 401);
  assert.equal(digestCalls - before, 2);
});

test('AWS signatures independently verify raw, binary and multipart bytes, repeated query keys and temporary credentials', async () => {
  for (const body of ['{"message":"signed✓"}', { kind: 'binary', file: { name: 'data.bin', type: 'application/octet-stream', data: Buffer.from([0, 1, 255, 128]).toString('base64') } }, { kind: 'multipart', parts: [{ name: 'text', value: 'test✓' }, { name: 'file', file: { name: 'a.bin', type: 'application/octet-stream', data: 'AP8=' } }] }] satisfies RequestBody[]) {
    const response = await executeRequest(http('/aws?x=z&x=a&space=a+b&empty=', aws(), body));
    assert.equal(response.status, 200, response.body);
    assert.equal(JSON.parse(response.body).headers['x-amz-security-token'], 'temporary-session');
  }
  const headers = new Headers();
  for (const service of ['s3', 'execute-api']) {
    const auth = aws(); auth.aws!.service = service;
    assert.equal((await executeRequest(http(`/aws/a%20b?repeat=b&repeat=a`, auth))).status, 200);
    if (service === 's3') assert.equal((await executeRequest(http('/aws//a%2Fb', auth))).status, 200);
  }
  await signAws('GET', new URL('https://s3.amazonaws.com/bucket//a%20b?x=a&x=b'), headers, undefined, { ...aws().aws!, service: 's3' }, new Date('2013-05-24T00:00:00Z'));
  assert.equal(headers.get('x-amz-date'), '20130524T000000Z'); assert.match(headers.get('authorization')!, /20130524\/us-east-1\/s3\/aws4_request/);
});

test('collection inheritance resolves variable hierarchy, explicit overrides and legacy imports', async () => {
  const value = initialWorkspace(), collection = value.collections[0];
  value.variables = [newEntry('key', 'global')]; collection.variables = [newEntry('key', 'collection')];
  collection.auth = { authType: 'apikey', apiKey: { name: 'X-Key', value: '{{key}}', location: 'header' } };
  const request = { ...newDraft(collection.id), url: `${base}/echo` }; value.saved = [{ collectionId: collection.id, request }];
  const result = await runRequest({ request, globals: value.variables, collection, data: { key: 'data' } });
  assert.equal(JSON.parse(result.response!.body).headers['x-key'], 'data');
  assert.equal(prepareWorkspaceRequest(value, request).auth?.apiKey?.value, 'collection');
  assert.equal(effectiveAuth({ ...request, authType: 'none' }, collection.auth).authType, 'none');
  assert.equal(effectiveAuth({ ...request, authType: 'bearer', token: 'own' }, collection.auth).token, 'own');
  value.saved[0].request.authType = 'none';
  const imported = parseWorkspace(JSON.stringify(value));
  assert.equal(imported.saved[0].request.authType, 'none'); assert.deepEqual(imported.collections[0].auth, collection.auth);
  const queryAuth = { authType: 'apikey' as const, apiKey: { name: 'api_key', value: 'a+b&c', location: 'query' as const } };
  const query = await executeRequest(http('/echo?api_key=old&api_key=older', queryAuth));
  assert.deepEqual([...new URL(JSON.parse(query.body).url, base).searchParams], [['api_key', 'a+b&c']]);
  assert.throws(() => validateRequest({ ...http('/echo', queryAuth), auth: { authType: 'inherit' } }), /Invalid authentication/);
  await assert.rejects(executeRequest(http('/echo', { authType: 'apikey', apiKey: { name: 'Host', value: 'other', location: 'header' } })), /unmanaged/);
});

test('helper credentials are stripped across origins and OAuth 1 / AWS re-sign same-origin redirects', async () => {
  for (const auth of [{ authType: 'bearer', token: 'secret' }, { authType: 'apikey', apiKey: { name: 'X-Key', value: 'secret', location: 'header' } }, { authType: 'apikey', apiKey: { name: 'api_key', value: 'secret', location: 'query' } }, aws(), oauth1()] as AuthConfig[]) {
    const response = await executeRequest(http('/redirect?cross=1', auth)), data = JSON.parse(response.body);
    assert.equal(data.headers.authorization, undefined); assert.equal(data.headers['x-key'], undefined); assert.equal(data.headers['x-amz-security-token'], undefined);
    if (auth.authType === 'apikey' && auth.apiKey!.location === 'query') assert(!new URL(data.url, base).searchParams.has('api_key'));
  }
  assert.equal((await executeRequest(http('/redirect?target=/aws', aws(), 'redirect-body'))).status, 200);
  assert.equal((await executeRequest(http('/redirect?target=/oauth1/resource', oauth1()))).status, 200);
});

test('OAuth 2 browser authorization uses PKCE, validates state, consumes callbacks and tokens once', async () => {
  const auth = { authType: 'oauth2' as const, oauth2: { ...oauth2('pkce-client'), grantType: 'authorization_code' as const, authorizationUrl: `${base}/authorize` } };
  const start = await post({ action: 'start', auth }); assert.equal(start.status, 200);
  const authorize = await fetch(start.value.authorizationUrl, { redirect: 'manual' }), callback = new URL(authorize.headers.get('location')!);
  const bad = new URL(callback); bad.searchParams.set('state', 'invalid');
  assert.equal((await fetch(bad)).status, 400);
  const accepted = await fetch(callback); assert.equal(accepted.status, 200); assert(!/access-pkce|refresh-pkce/.test(await accepted.text()));
  assert.equal((await fetch(callback)).status, 400);
  const poll = await post({ action: 'poll', sessionId: start.value.sessionId }); assert.equal(poll.value.status, 'complete'); assert.match(poll.value.tokens.accessToken, /^access-pkce-client/);
  assert.equal((await post({ action: 'poll', sessionId: start.value.sessionId })).status, 400);
  const resource = await executeRequest(http('/resource?client=pkce-client', { authType: 'oauth2', oauth2: { ...auth.oauth2, ...poll.value.tokens } }));
  assert.equal(resource.status, 200);
  const wrongOrigin = await post({ action: 'start', auth }, 'https://evil.example'); assert.equal(wrongOrigin.status, 403);
});

test('OAuth 2 manual redirect completion, cancellation, client authentication and endpoint restrictions', async () => {
  const auth = { authType: 'oauth2' as const, oauth2: { ...oauth2('manual-client'), grantType: 'authorization_code' as const, authorizationUrl: `${base}/authorize`, redirectUri: 'https://callback.example/return' } };
  const start = await post({ action: 'start', auth }), authorize = await fetch(start.value.authorizationUrl, { redirect: 'manual' });
  const callbackUrl = authorize.headers.get('location')!;
  assert.equal((await post({ action: 'complete', sessionId: start.value.sessionId, callbackUrl: callbackUrl.replace('callback.example', 'evil.example') })).status, 400);
  const result = await post({ action: 'complete', sessionId: start.value.sessionId, callbackUrl }); assert.equal(result.value.status, 'complete');
  const cancelled = await post({ action: 'start', auth }); await post({ action: 'cancel', sessionId: cancelled.value.sessionId });
  assert.equal((await post({ action: 'complete', sessionId: cancelled.value.sessionId, callbackUrl })).status, 400);
  for (const clientAuthentication of ['basic', 'body', 'none'] as const) {
    const tokens = await oauth2Token({ ...oauth2('clïent:+'), clientAuthentication, clientSecret: 'sëcret:+' }, 'client_credentials');
    assert.match(tokens.accessToken, /^access-clïent:\+/);
  }
  assert.throws(() => authEndpoint('http://example.com/token'), /HTTPS/);
  assert.throws(() => authEndpoint('https://user:secret@example.com/token'), /HTTPS/);
  await assert.rejects(oauth2Token({ ...oauth2('redirect-client'), tokenUrl: `${base}/token-redirect` }, 'client_credentials'), /307/);
  const staticToken = { ...newAuthConfig().oauth2, accessToken: 'manual-token' };
  assert.equal((await usableOAuth2(staticToken)).tokens.accessToken, 'manual-token');
  const client = oauth2('client-without-refresh'), received = await oauth2Token(client, 'client_credentials');
  tokens.delete(received.accessToken);
  const renewed = await executeRequest(http('/resource?client=client-without-refresh', { authType: 'oauth2', oauth2: { ...client, ...received, refreshToken: '' } }));
  assert.equal(renewed.status, 200);
});

test('OAuth 1.0a obtains signed temporary/access tokens and supports manual OOB verifiers', async () => {
  for (const oob of [false, true]) {
    const auth = oauth1(); if (oob) auth.oauth1!.callbackUri = 'oob';
    const start = await post({ action: 'start', auth }); assert.equal(start.status, 200, JSON.stringify(start.value));
    const authorization = await fetch(start.value.authorizationUrl, { redirect: 'manual' });
    let result;
    if (oob) result = await post({ action: 'complete', sessionId: start.value.sessionId, verifier: await authorization.text() });
    else { assert.equal((await fetch(authorization.headers.get('location')!)).status, 200); result = await post({ action: 'poll', sessionId: start.value.sessionId }); }
    assert.equal(result.value.status, 'complete'); assert.equal(result.value.tokens.tokenSecret, 'access-secret');
    assert.equal((await executeRequest(http('/oauth1/resource?repeat=a&repeat=b', auth, 'unencoded-body'))).status, 200);
  }
});

test('automatic acquisition and refresh persist at the inherited owner, carry rotated tokens and redact reports', async () => {
  const workspace = initialWorkspace(), collection = workspace.collections[0];
  collection.auth = { authType: 'oauth2', oauth2: oauth2('runner-client') };
  const request = { ...newDraft(collection.id), url: `${base}/resource?client=runner-client` }; workspace.saved = [{ collectionId: collection.id, request }];
  const before = tokenCalls, notifications: unknown[] = [];
  const report = await runCollection(workspace, collection.id, { iterations: 3, delayMs: 0, data: [], stopOnFailure: true }, { execute: runRequest, onAuthenticationUpdate: update => notifications.push(update) });
  assert.equal(report.passed, 3); assert.equal(tokenCalls - before, 1); assert.equal(notifications.length, 1);
  assert.equal(report.authUpdates?.[0].scope, 'collection');
  let updated = applyAuthenticationUpdates(workspace, report.authUpdates);
  assert.match(updated.collections[0].auth!.oauth2!.accessToken, /^access-runner-client/);
  assert(!JSON.stringify(publicRunReport(report)).includes('refresh-runner-client'));
  const old = updated.collections[0].auth!.oauth2!.accessToken;
  tokens.delete(old); // A server-side revocation triggers a single refresh on 401.
  const refreshed = await runRequest({ request, globals: [], collection: updated.collections[0] });
  assert.equal(refreshed.response?.status, 200); assert.notEqual(refreshed.authUpdates?.[0].oauth2.accessToken, old);
  updated = applyAuthenticationUpdates(updated, refreshed.authUpdates);
  const access = updated.collections[0].auth!.oauth2!.accessToken;
  const stale = structuredClone(updated); stale.collections[0].auth!.oauth2!.clientId = 'edited';
  assert.equal(applyAuthenticationUpdates(stale, report.authUpdates).collections[0].auth!.oauth2!.accessToken, access);
  const config = updated.collections[0].auth!.oauth2!; config.expiresAt = Date.now() - 1000;
  const results = await Promise.all([usableOAuth2(config), usableOAuth2(config)]);
  assert.equal(results[0].tokens.accessToken, results[1].tokens.accessToken);
  assert.equal(results[0].tokens.tokenBinding, oauth2Binding(config));
});

test('data-driven OAuth clients never reuse a token bound to a different client', async () => {
  const workspace = initialWorkspace(), collection = workspace.collections[0]; collection.auth = { authType: 'oauth2', oauth2: oauth2('{{client}}') };
  const request = { ...newDraft(collection.id), url: `${base}/resource?client={{client}}` }; workspace.saved = [{ collectionId: collection.id, request }];
  const report = await runCollection(workspace, collection.id, { iterations: 1, data: [{ client: 'row-A' }, { client: 'row-B' }, { client: 'row-A' }], delayMs: 0, stopOnFailure: true }, { execute: runRequest });
  assert.equal(report.passed, 3, JSON.stringify(report.results));
  assert.equal(report.authUpdates?.[0].configurationKey, authConfigurationKey(collection.auth));
});

test('cancelled runs retain completed refreshes and inactive helper fields do not resolve variables', async () => {
  const workspace = initialWorkspace(), collection = workspace.collections[0]; collection.auth = { authType: 'oauth2', oauth2: oauth2('cancel-client') };
  const request = { ...newDraft(collection.id), url: `${base}/resource?client=cancel-client` }; workspace.saved = [{ collectionId: collection.id, request }];
  const controller = new AbortController(), updates: unknown[] = [];
  const report = await runCollection(workspace, collection.id, { iterations: 1, data: [], delayMs: 0, stopOnFailure: false }, {
    signal: controller.signal, execute: async input => { const result = await runRequest(input); controller.abort(); return result; }, onAuthenticationUpdate: value => updates.push(value),
  });
  assert.equal(report.cancelled, true); assert.equal(report.completed, 0); assert.equal(updates.length, 1);
  assert.match(applyAuthenticationUpdates(workspace, report.authUpdates).collections[0].auth!.oauth2!.accessToken, /^access-cancel-client/);
  request.authType = 'none'; request.oauth2!.clientSecret = '{{missing}}';
  assert.equal(prepareWorkspaceRequest(workspace, request).auth, undefined);
});

test('cURL exports inherited API keys and Digest/AWS options, and OAuth 1 preview signs without sending', async () => {
  assert.match(toCurl(http('/digest', { authType: 'digest', username: 'u', password: 'p' })), /--digest/);
  const awsCurl = toCurl(http('/aws', aws())); assert.match(awsCurl, /--aws-sigv4/); assert.match(awsCurl, /x-amz-security-token/i);
  assert.throws(() => toCurl(http('/oauth1/resource', oauth1())), /Generate/);
  const prepared = http('/oauth1/resource?a=1', oauth1());
  const preview = await fetch(`${apiBase}/api/auth/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prepared) });
  assert.equal(preview.status, 200); assert.match((await preview.json() as { authorization: string }).authorization, /^OAuth /);
});

test('CLI uses inherited OAuth, saves rotated tokens only with --save-variables and omits tokens in reports', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reqora-auth-'));
  try {
    const workspace = initialWorkspace(), collection = workspace.collections[0]; collection.name = 'Auth'; collection.auth = { authType: 'oauth2', oauth2: oauth2('cli-client') };
    workspace.saved = [{ collectionId: collection.id, request: { ...newDraft(collection.id), url: `${base}/resource?client=cli-client` } }];
    const input = join(directory, 'workspace.json'), report = join(directory, 'report.json'), output = join(directory, 'updated.json');
    const original = JSON.stringify(workspace); await writeFile(input, original);
    const result = await promisify(execFile)(process.execPath, ['cli/reqora.mjs', 'run', input, '--collection', 'Auth', '--report', report, '--save-variables', output], { cwd: process.cwd() });
    assert.match(result.stdout, /1 passed/);
    assert.equal(await readFile(input, 'utf8'), original);
    assert(!JSON.stringify(JSON.parse(await readFile(report, 'utf8'))).includes('refresh-cli-client'));
    assert.match(JSON.parse(await readFile(output, 'utf8')).collections[0].auth.oauth2.refreshToken, /^refresh-cli-client/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
