import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuthenticationError } from './auth-error.ts';
import { oauth1Authorization } from './auth-signing.ts';
import { isAuthConfig, normalizedAuth } from '../shared/auth.ts';
import type { AuthConfig, OAuth1Auth, OAuth2Auth, OAuth2Tokens } from '../shared/auth.ts';

export function authEndpoint(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new AuthenticationError('Enter a valid OAuth endpoint URL.'); }
  const loopback = ['localhost', '[::1]'].includes(url.hostname) || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) throw new AuthenticationError('OAuth endpoints require HTTPS, or HTTP on a loopback address.');
  return url;
}

async function tokenRequest(url: string, body: URLSearchParams, headers: Headers, signal?: AbortSignal): Promise<{ text: string; json: Record<string, unknown> }> {
  const endpoint = authEndpoint(url);
  headers.set('Content-Type', 'application/x-www-form-urlencoded');
  headers.set('Accept', 'application/json, application/x-www-form-urlencoded');
  const timeout = AbortSignal.timeout(15_000);
  let response: Response;
  try { response = await fetch(endpoint, { method: 'POST', headers, body: body.toString(), redirect: 'manual', signal: signal ? AbortSignal.any([signal, timeout]) : timeout }); }
  catch (error) { if (signal?.aborted) throw error; throw new AuthenticationError(timeout.aborted ? 'OAuth token request timed out.' : 'Unable to reach the OAuth token endpoint. Check its URL and TLS certificate.'); }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  if (reader) try {
    while (true) { const result = await reader.read(); if (result.done) break; size += result.value.byteLength; if (size > 256 * 1024) { await reader.cancel(); throw new AuthenticationError('OAuth token response exceeds 256 KB.'); } chunks.push(result.value); }
  } finally { reader.releaseLock(); }
  const text = Buffer.concat(chunks).toString('utf8');
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; if (!json || typeof json !== 'object' || Array.isArray(json)) json = {}; } catch { /* OAuth 1 endpoints commonly return form data. */ }
  if (!response.ok) throw new AuthenticationError(`OAuth endpoint returned HTTP ${response.status}${typeof json.error === 'string' ? `: ${json.error.slice(0, 150)}` : ''}.`);
  return { text, json };
}

export async function oauth2Token(config: OAuth2Auth, grant: 'client_credentials' | 'refresh_token' | 'authorization_code', extra: Record<string, string> = {}, signal?: AbortSignal): Promise<OAuth2Tokens> {
  if (!config.clientId) throw new AuthenticationError('OAuth 2 requires a client ID.');
  if (grant !== 'refresh_token' && config.grantType !== grant) throw new AuthenticationError('Select the matching OAuth 2 grant type first.');
  if (grant === 'refresh_token' && config.tokenBinding && config.tokenBinding !== oauth2Binding(config)) throw new AuthenticationError('OAuth configuration changed. Authorize this client again before refreshing.');
  const body = new URLSearchParams({ grant_type: grant, ...extra });
  if (config.scope && grant !== 'authorization_code') body.set('scope', config.scope);
  if (grant === 'refresh_token') { if (!config.refreshToken) throw new AuthenticationError('Enter a refresh token first.'); body.set('refresh_token', config.refreshToken); }
  const headers = new Headers();
  if (config.clientAuthentication === 'basic') {
    const encode = (value: string) => new URLSearchParams({ x: value }).toString().slice(2);
    headers.set('Authorization', 'Basic ' + Buffer.from(`${encode(config.clientId)}:${encode(config.clientSecret)}`).toString('base64'));
  } else { body.set('client_id', config.clientId); if (config.clientAuthentication === 'body') body.set('client_secret', config.clientSecret); }
  const { json } = await tokenRequest(config.tokenUrl, body, headers, signal);
  if (typeof json.access_token !== 'string' || !json.access_token || json.access_token.length > 65536 || /[\r\n\0]/.test(json.access_token)) throw new AuthenticationError('The OAuth endpoint did not return a valid access_token.');
  if (json.token_type !== undefined && (typeof json.token_type !== 'string' || json.token_type.toLowerCase() !== 'bearer')) throw new AuthenticationError('This client supports OAuth 2 Bearer tokens.');
  if (json.refresh_token !== undefined && (typeof json.refresh_token !== 'string' || json.refresh_token.length > 65536)) throw new AuthenticationError('Invalid OAuth refresh_token.');
  const expires = json.expires_in === undefined ? 0 : Number(json.expires_in);
  if (!Number.isFinite(expires) || expires < 0 || expires > 315360000) throw new AuthenticationError('Invalid OAuth expires_in.');
  return { accessToken: json.access_token, refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : config.refreshToken, tokenType: 'Bearer', expiresAt: expires ? Date.now() + expires * 1000 : 0, tokenBinding: oauth2Binding(config) };
}

export const oauth2Binding = (config: OAuth2Auth): string => createHash('sha256').update(JSON.stringify([authEndpoint(config.tokenUrl).href, config.clientId, config.scope, config.grantType])).digest('hex');

const cache = new Map<string, { tokens?: OAuth2Tokens; pending?: Promise<OAuth2Tokens>; expires: number }>();
export async function usableOAuth2(config: OAuth2Auth, signal?: AbortSignal, force = false): Promise<{ tokens: OAuth2Tokens; updated: boolean }> {
  const changed = !!config.tokenBinding && config.tokenBinding !== oauth2Binding(config);
  if (changed) config = { ...config, accessToken: '', refreshToken: '', expiresAt: 0, tokenBinding: '' };
  const current = { accessToken: config.accessToken, refreshToken: config.refreshToken, tokenType: config.tokenType, expiresAt: config.expiresAt, tokenBinding: config.tokenBinding };
  const expired = config.expiresAt > 0 && config.expiresAt <= Date.now() + 30_000;
  if (!force && config.accessToken && (!expired || !config.autoRefresh)) return { tokens: current, updated: false };
  if (!config.autoRefresh) { if (!config.accessToken) throw new AuthenticationError('Get or enter an OAuth 2 access token first.'); return { tokens: current, updated: false }; }
  const grant = config.refreshToken ? 'refresh_token' : config.grantType === 'client_credentials' ? 'client_credentials' : undefined;
  if (!grant) throw new AuthenticationError('Authorize this OAuth 2 client to get a new access token.');
  const key = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  for (const [id, value] of cache) if (value.expires < Date.now()) cache.delete(id);
  const found = cache.get(key);
  if (!force && found?.tokens && (!found.tokens.expiresAt || found.tokens.expiresAt > Date.now() + 30_000)) return { tokens: found.tokens, updated: true };
  if (found?.pending) return { tokens: await found.pending, updated: true };
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  const pending = oauth2Token(config, grant, {}, signal);
  cache.set(key, { pending, expires: Date.now() + 60_000 });
  try { const tokens = await pending; cache.set(key, { tokens, expires: Math.min(tokens.expiresAt || Date.now() + 300_000, Date.now() + 3600_000) }); return { tokens, updated: true }; }
  catch (error) { cache.delete(key); throw error; }
}

interface Session {
  id: string; state: string; origin: string; auth: ReturnType<typeof normalizedAuth>; created: number;
  status: 'pending' | 'exchanging' | 'complete' | 'error'; redirectUri: string; verifier: string;
  temporaryToken?: string; temporarySecret?: string; tokens?: OAuth2Tokens | { token: string; tokenSecret: string }; error?: string;
}
const sameSecret = (a: string, b: string) => { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); };

async function oauth1Tokens(config: OAuth1Auth, url: string, parameters: Record<string, string>, signal?: AbortSignal) {
  const endpoint = authEndpoint(url), body = new URLSearchParams(), headers = new Headers({ 'Content-Type': 'application/x-www-form-urlencoded' });
  headers.set('Authorization', oauth1Authorization('POST', endpoint, headers, '', config, { parameters }).authorization);
  const response = await tokenRequest(endpoint.href, body, headers, signal);
  const form = new URLSearchParams(response.text);
  const token = form.get('oauth_token'), tokenSecret = form.get('oauth_token_secret');
  if (!token || tokenSecret === null || token.length > 65536 || tokenSecret.length > 65536) throw new AuthenticationError('OAuth 1 endpoint did not return oauth_token and oauth_token_secret.');
  return { token, tokenSecret, confirmed: form.get('oauth_callback_confirmed') === 'true' };
}

export class OAuthSessions {
  private sessions = new Map<string, Session>();
  private cleanup() { for (const [id, session] of this.sessions) if (Date.now() - session.created > 10 * 60_000) this.sessions.delete(id); }

  async action(value: unknown, origin: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    this.cleanup();
    if (!value || typeof value !== 'object') throw new AuthenticationError('Provide an OAuth action.');
    const input = value as { action: string; auth?: AuthConfig; sessionId?: string; callbackUrl?: string; verifier?: string };
    if (['poll', 'cancel', 'complete'].includes(input.action)) {
      const session = typeof input.sessionId === 'string' ? this.sessions.get(input.sessionId) : undefined;
      if (!session || session.origin !== origin) throw new AuthenticationError('OAuth session expired or was not found. Start authorization again.');
      if (input.action === 'cancel') { this.sessions.delete(session.id); return { status: 'cancelled' }; }
      if (input.action === 'complete') {
        if (session.auth.authType === 'oauth1' && session.redirectUri === 'oob') {
          if (!input.verifier || input.verifier.length > 4096) throw new AuthenticationError('Paste the OAuth 1 verifier.');
          await this.exchange(session, undefined, input.verifier, signal);
        } else {
          let callback: URL;
          try { callback = new URL(input.callbackUrl || ''); } catch { throw new AuthenticationError('Paste the complete redirect URL.'); }
          const expected = new URL(session.redirectUri);
          if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || !sameSecret(callback.searchParams.get('state') || '', session.state)) throw new AuthenticationError('Redirect URL or OAuth state does not match this session.');
          await this.complete(callback, signal);
        }
      }
      const output = { status: session.status, ...(session.error ? { error: session.error } : {}), ...(session.tokens ? { tokens: session.tokens } : {}) };
      if (session.status === 'complete' || session.status === 'error') this.sessions.delete(session.id);
      return output;
    }
    if (!isAuthConfig(input.auth, false) || !['oauth2', 'oauth1'].includes(input.auth.authType)) throw new AuthenticationError('Configure OAuth 1 or OAuth 2 authentication first.');
    const auth = normalizedAuth(input.auth);
    if (input.action === 'client_credentials' || input.action === 'refresh') {
      if (auth.authType !== 'oauth2') throw new AuthenticationError('This action requires OAuth 2.');
      return { status: 'complete', tokens: await oauth2Token(auth.oauth2, input.action === 'refresh' ? 'refresh_token' : 'client_credentials', {}, signal) };
    }
    if (input.action !== 'start') throw new AuthenticationError('Unknown OAuth action.');
    if (this.sessions.size >= 64) throw new AuthenticationError('Too many pending OAuth sessions. Cancel an existing session or try later.');
    const session: Session = { id: randomBytes(32).toString('hex'), state: randomBytes(32).toString('hex'), origin, auth, created: Date.now(), status: 'pending',
      redirectUri: '', verifier: randomBytes(32).toString('base64url') };
    let authorizationUrl: URL;
    if (auth.authType === 'oauth2') {
      if (auth.oauth2.grantType !== 'authorization_code') throw new AuthenticationError('Select the authorization code grant to start browser authorization.');
      if (!auth.oauth2.clientId) throw new AuthenticationError('Enter an OAuth 2 client ID.');
      authEndpoint(auth.oauth2.tokenUrl);
      session.redirectUri = auth.oauth2.redirectUri || `${origin}/api/auth/callback`;
      authEndpoint(session.redirectUri);
      authorizationUrl = authEndpoint(auth.oauth2.authorizationUrl);
      authorizationUrl.searchParams.set('response_type', 'code'); authorizationUrl.searchParams.set('client_id', auth.oauth2.clientId);
      authorizationUrl.searchParams.set('redirect_uri', session.redirectUri); authorizationUrl.searchParams.set('state', session.state);
      authorizationUrl.searchParams.set('code_challenge', createHash('sha256').update(session.verifier).digest('base64url')); authorizationUrl.searchParams.set('code_challenge_method', 'S256');
      if (auth.oauth2.scope) authorizationUrl.searchParams.set('scope', auth.oauth2.scope);
    } else {
      session.redirectUri = auth.oauth1.callbackUri || `${origin}/api/auth/callback`;
      if (session.redirectUri !== 'oob') { const callback = authEndpoint(session.redirectUri); callback.searchParams.set('state', session.state); session.redirectUri = callback.href; }
      const temporary = await oauth1Tokens({ ...auth.oauth1, token: '', tokenSecret: '' }, auth.oauth1.requestTokenUrl, { oauth_callback: session.redirectUri }, signal);
      if (!temporary.confirmed) throw new AuthenticationError('The provider did not confirm the OAuth 1.0a callback.');
      session.temporaryToken = temporary.token; session.temporarySecret = temporary.tokenSecret;
      authEndpoint(auth.oauth1.accessTokenUrl);
      authorizationUrl = authEndpoint(auth.oauth1.authorizationUrl); authorizationUrl.searchParams.set('oauth_token', temporary.token);
    }
    this.sessions.set(session.id, session);
    return { status: 'pending', sessionId: session.id, authorizationUrl: authorizationUrl.href, redirectUri: session.redirectUri };
  }

  async complete(callback: URL, signal?: AbortSignal): Promise<void> {
    this.cleanup();
    const state = callback.searchParams.get('state') || '';
    const session = [...this.sessions.values()].find(session => sameSecret(session.state, state));
    if (!session) throw new AuthenticationError('OAuth state is invalid or expired.');
    if (session.redirectUri === 'oob') throw new AuthenticationError('Complete this session with its manual verifier.');
    const expected = new URL(session.redirectUri);
    if (callback.host !== expected.host || callback.pathname !== expected.pathname) throw new AuthenticationError('Unexpected OAuth callback address.');
    if (session.status !== 'pending') throw new AuthenticationError('This OAuth callback has already been used.');
    if (callback.searchParams.has('error')) { session.status = 'error'; session.error = `Authorization was declined: ${(callback.searchParams.get('error') || 'provider_error').slice(0, 150)}`; return; }
    if (session.auth.authType === 'oauth1' && callback.searchParams.get('oauth_token') !== session.temporaryToken) throw new AuthenticationError('OAuth 1 temporary token does not match.');
    const code = callback.searchParams.get('code') || undefined, verifier = callback.searchParams.get('oauth_verifier') || undefined;
    if (session.auth.authType === 'oauth2' && !code || session.auth.authType === 'oauth1' && !verifier) throw new AuthenticationError('OAuth callback is missing its authorization code or verifier.');
    await this.exchange(session, code, verifier, signal);
  }

  private async exchange(session: Session, code?: string, verifier?: string, signal?: AbortSignal) {
    if (session.status !== 'pending') throw new AuthenticationError('This OAuth session has already been used.');
    session.status = 'exchanging';
    try {
      session.tokens = session.auth.authType === 'oauth2'
        ? await oauth2Token(session.auth.oauth2, 'authorization_code', { code: code!, redirect_uri: session.redirectUri, code_verifier: session.verifier }, signal)
        : await oauth1Tokens({ ...session.auth.oauth1, token: session.temporaryToken!, tokenSecret: session.temporarySecret! }, session.auth.oauth1.accessTokenUrl, { oauth_verifier: verifier! }, signal);
      session.status = 'complete';
    } catch (error) { session.status = 'error'; session.error = error instanceof AuthenticationError ? error.message : 'Unable to exchange the authorization response. Check the provider endpoints and client credentials.'; }
  }
}
