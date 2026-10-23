import { useEffect, useRef, useState } from 'react';
import { effectiveAuth, normalizedAuth, resolveAuthValues } from '../../shared/auth';
import type { AuthConfig, AuthType } from '../../shared/auth';
import type { Entry } from '../lib/workspace';
import { interpolate } from '../lib/workspace';
import { oauthAction } from '../lib/auth-client';
import type { OAuthActionResponse } from '../lib/auth-client';
import Icon from './Icon';

export default function AuthEditor({ value, onChange, collectionAuth, collectionName, variables = [], isCollection = false }: {
  value: AuthConfig; onChange: (changes: Partial<AuthConfig>) => void; collectionAuth?: AuthConfig; collectionName?: string; variables?: Entry[]; isCollection?: boolean;
}) {
  const auth = normalizedAuth(value);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [session, setSession] = useState<OAuthActionResponse | null>(null), [callback, setCallback] = useState('');
  const current = useRef({ auth, onChange, variables }); current.current = { auth, onChange, variables };
  const pending = useRef<string | undefined>(undefined), controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const pendingSignature = useRef('');
  const signature = JSON.stringify(auth);
  const signatureRef = useRef(signature); signatureRef.current = signature;
  useEffect(() => () => { generation.current++; controller.current?.abort(); if (pending.current) void oauthAction({ action: 'cancel', sessionId: pending.current }).catch(() => {}); }, []);

  function accept(result: OAuthActionResponse, fingerprint: string) {
    if (signatureRef.current !== fingerprint) { setError('Authentication settings changed. Start the token flow again.'); setSession(null); pending.current = undefined; return; }
    if (result.status === 'error') { setError(result.error || 'Authorization failed.'); setSession(null); pending.current = undefined; return; }
    if (result.tokens) {
      setError('');
      const config = current.current.auth;
      if (config.authType === 'oauth2') current.current.onChange({ oauth2: { ...config.oauth2, ...result.tokens } });
      else current.current.onChange({ oauth1: { ...config.oauth1, token: String(result.tokens.token || ''), tokenSecret: String(result.tokens.tokenSecret || '') } });
      setMessage('Token received and applied.'); setSession(null); pending.current = undefined;
    }
  }
  useEffect(() => {
    if (!session?.sessionId) return;
    let active = true, timeout: ReturnType<typeof setTimeout>;
    const fingerprint = signatureRef.current;
    const poll = async () => {
      try {
        const result = await oauthAction({ action: 'poll', sessionId: session.sessionId });
        if (!active || pending.current !== session.sessionId) return;
        if (result.status === 'pending' || result.status === 'exchanging') timeout = setTimeout(poll, 1000);
        else accept(result, fingerprint);
      } catch (reason) { if (active && pending.current === session.sessionId) { setError((reason as Error).message); setSession(null); pending.current = undefined; } }
    };
    timeout = setTimeout(poll, 1000);
    return () => { active = false; clearTimeout(timeout); };
  }, [session?.sessionId]);

  async function action(action: 'start' | 'client_credentials' | 'refresh' | 'complete') {
    if (busy || controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    const index = ++generation.current, fingerprint = signatureRef.current;
    setBusy(true); setError(''); setMessage('');
    try {
      const resolved = resolveAuthValues(effectiveAuth(auth), text => interpolate(text, current.current.variables));
      const result = await oauthAction(action === 'complete'
        ? { action, sessionId: pending.current, ...(session?.redirectUri === 'oob' ? { verifier: callback.trim() } : { callbackUrl: callback.trim() }) }
        : { action, auth: resolved }, abort.signal);
      if (generation.current !== index) return;
      if (result.sessionId) {
        if (signatureRef.current !== fingerprint) { void oauthAction({ action: 'cancel', sessionId: result.sessionId }).catch(() => {}); setError('Authentication settings changed. Start again.'); return; }
        pending.current = result.sessionId; pendingSignature.current = fingerprint; setSession(result); setCallback('');
      }
      else accept(result, fingerprint);
    } catch (reason) { if (generation.current === index && !abort.signal.aborted) setError((reason as Error).message); }
    finally { if (generation.current === index) { setBusy(false); controller.current = null; } }
  }
  function cancel() {
    generation.current++; controller.current?.abort(); controller.current = null;
    if (pending.current) void oauthAction({ action: 'cancel', sessionId: pending.current }).catch(() => {});
    pending.current = undefined; setSession(null); setBusy(false); setMessage('Authorization cancelled.');
  }
  useEffect(() => { if (pending.current && pendingSignature.current !== signature) { cancel(); setError('Authentication settings changed. Start authorization again.'); } }, [signature]);
  function type(authType: AuthType) { cancel(); setError(''); setMessage(''); onChange({ authType }); }
  const field = (label: string, text: string, update: (value: string) => void, secret = false, placeholder = '') => <label className="field-label">{label}<input className="field-input" type={secret ? 'password' : 'text'} autoComplete="off" value={text} placeholder={placeholder} onChange={event => update(event.target.value)} /></label>;
  const expiry = auth.oauth2.expiresAt ? new Date(auth.oauth2.expiresAt).toLocaleString() : 'Not supplied';
  return <div className="authentication-editor">
    <div className="auth-selection"><label className="field-label">Authorization type<select aria-label={isCollection ? 'Collection authorization type' : 'Authorization type'} className="field-input" value={auth.authType} onChange={event => type(event.target.value as AuthType)}>
      {!isCollection && <option value="inherit">Inherit from collection</option>}<option value="none">No authentication</option><option value="basic">Basic authentication</option><option value="bearer">Bearer token</option><option value="apikey">API key</option><option value="oauth2">OAuth 2.0</option><option value="oauth1">OAuth 1.0a</option><option value="digest">Digest</option><option value="aws">AWS Signature V4</option>
    </select></label><p className="automation-help">{isCollection ? 'Requests using Inherit from collection share these settings.' : 'Choose explicit authentication to override the collection. No authentication disables inherited credentials.'}</p></div>
    {auth.authType === 'inherit' && <div className="inherited-auth"><Icon name="folder" size={20} /><p>{collectionName ? <>Using <strong>{effectiveAuth(auth, collectionAuth).authType}</strong> from {collectionName}. Edit its Auth section to change shared credentials.</> : 'No collection is selected. Inherited authentication currently resolves to No authentication.'}</p></div>}
    {auth.authType === 'none' && <p className="automation-help">This request does not add authentication. Manually configured headers remain available.</p>}
    {['basic', 'digest'].includes(auth.authType) && <div className="auth-field-grid">{field('Username', auth.username, username => onChange({ username }))}{field('Password', auth.password, password => onChange({ password }), true)}{auth.authType === 'digest' && <p className="automation-help">The engine negotiates the server's Digest challenge. MD5, SHA-256, SHA-512-256, session variants, auth, and auth-int are supported.</p>}</div>}
    {auth.authType === 'bearer' && field('Token', auth.token, token => onChange({ token }), true, '{{token}}')}
    {auth.authType === 'apikey' && <div className="auth-field-grid">{field('Key name', auth.apiKey.name, name => onChange({ apiKey: { ...auth.apiKey, name } }))}{field('Key value', auth.apiKey.value, value => onChange({ apiKey: { ...auth.apiKey, value } }), true, '{{api_key}}')}<label className="field-label">Add to<select className="field-input" value={auth.apiKey.location} onChange={event => onChange({ apiKey: { ...auth.apiKey, location: event.target.value as 'header' | 'query' } })}><option value="header">Header</option><option value="query">Query parameter</option></select></label></div>}
    {auth.authType === 'aws' && <div className="auth-field-grid">{field('Access key ID', auth.aws.accessKeyId, accessKeyId => onChange({ aws: { ...auth.aws, accessKeyId } }), false, '{{aws_access_key}}')}{field('Secret access key', auth.aws.secretAccessKey, secretAccessKey => onChange({ aws: { ...auth.aws, secretAccessKey } }), true)}{field('Session token (optional)', auth.aws.sessionToken, sessionToken => onChange({ aws: { ...auth.aws, sessionToken } }), true)}{field('Region', auth.aws.region, region => onChange({ aws: { ...auth.aws, region } }))}{field('Service', auth.aws.service, service => onChange({ aws: { ...auth.aws, service } }), false, 'execute-api, s3, sts…')}<p className="automation-help">Signs the exact outgoing body and headers. Use temporary credentials with a session token when required. Credentials are used only for the configured request origin.</p></div>}
    {auth.authType === 'oauth2' && <>
      <div className="auth-field-grid"><label className="field-label">Grant type<select className="field-input" value={auth.oauth2.grantType} onChange={event => onChange({ oauth2: { ...auth.oauth2, grantType: event.target.value as 'authorization_code' | 'client_credentials' } })}><option value="authorization_code">Authorization code + PKCE (S256)</option><option value="client_credentials">Client credentials</option></select></label>
        {auth.oauth2.grantType === 'authorization_code' && field('Authorization URL', auth.oauth2.authorizationUrl, authorizationUrl => onChange({ oauth2: { ...auth.oauth2, authorizationUrl } }))}
        {field('Token URL', auth.oauth2.tokenUrl, tokenUrl => onChange({ oauth2: { ...auth.oauth2, tokenUrl } }))}{field('Client ID', auth.oauth2.clientId, clientId => onChange({ oauth2: { ...auth.oauth2, clientId } }))}{field('Client secret (optional for public PKCE clients)', auth.oauth2.clientSecret, clientSecret => onChange({ oauth2: { ...auth.oauth2, clientSecret } }), true)}
        <label className="field-label">Client authentication<select className="field-input" value={auth.oauth2.clientAuthentication} onChange={event => onChange({ oauth2: { ...auth.oauth2, clientAuthentication: event.target.value as 'basic' | 'body' | 'none' } })}><option value="none">Public client (client ID only)</option><option value="basic">HTTP Basic</option><option value="body">Client secret in request body</option></select></label>
        {field('Requested scope', auth.oauth2.scope, scope => onChange({ oauth2: { ...auth.oauth2, scope } }))}
        {auth.oauth2.grantType === 'authorization_code' && field('Redirect URI', auth.oauth2.redirectUri, redirectUri => onChange({ oauth2: { ...auth.oauth2, redirectUri } }), false, typeof window === 'undefined' ? '/api/auth/callback' : `${window.location.origin}/api/auth/callback`)}
        {field('Access token', auth.oauth2.accessToken, accessToken => onChange({ oauth2: { ...auth.oauth2, accessToken, expiresAt: 0, tokenBinding: '' } }), true)}{field('Refresh token', auth.oauth2.refreshToken, refreshToken => onChange({ oauth2: { ...auth.oauth2, refreshToken, tokenBinding: '' } }), true)}
      </div><label className="automation-required"><input type="checkbox" checked={auth.oauth2.autoRefresh} onChange={event => onChange({ oauth2: { ...auth.oauth2, autoRefresh: event.target.checked } })} />Automatically acquire client-credentials tokens or refresh expired access tokens</label><p className="automation-help">Expires: {expiry}. Register the redirect URI shown above with your provider. OAuth endpoints require HTTPS, except loopback testing.</p>
    </>}
    {auth.authType === 'oauth1' && <><div className="auth-field-grid">{field('Consumer key', auth.oauth1.consumerKey, consumerKey => onChange({ oauth1: { ...auth.oauth1, consumerKey } }))}{field('Consumer secret', auth.oauth1.consumerSecret, consumerSecret => onChange({ oauth1: { ...auth.oauth1, consumerSecret } }), true)}{field('Access token', auth.oauth1.token, token => onChange({ oauth1: { ...auth.oauth1, token } }), true)}{field('Token secret', auth.oauth1.tokenSecret, tokenSecret => onChange({ oauth1: { ...auth.oauth1, tokenSecret } }), true)}
      <label className="field-label">Signature method<select className="field-input" value={auth.oauth1.signatureMethod} onChange={event => onChange({ oauth1: { ...auth.oauth1, signatureMethod: event.target.value as typeof auth.oauth1.signatureMethod } })}><option>HMAC-SHA1</option><option>HMAC-SHA256</option><option>RSA-SHA1</option><option>PLAINTEXT</option></select></label>{field('Realm (optional)', auth.oauth1.realm, realm => onChange({ oauth1: { ...auth.oauth1, realm } }))}</div>
      {auth.oauth1.signatureMethod === 'RSA-SHA1' && <label className="field-label">RSA private key (PEM)<textarea className="script-code" spellCheck={false} value={auth.oauth1.privateKey} onChange={event => onChange({ oauth1: { ...auth.oauth1, privateKey: event.target.value } })} /></label>}
      <details className="oauth-token-settings"><summary>Get an OAuth 1.0a access token</summary><div className="auth-field-grid">{field('Request token URL', auth.oauth1.requestTokenUrl, requestTokenUrl => onChange({ oauth1: { ...auth.oauth1, requestTokenUrl } }))}{field('Authorization URL', auth.oauth1.authorizationUrl, authorizationUrl => onChange({ oauth1: { ...auth.oauth1, authorizationUrl } }))}{field('Access token URL', auth.oauth1.accessTokenUrl, accessTokenUrl => onChange({ oauth1: { ...auth.oauth1, accessTokenUrl } }))}{field('Callback URI (or oob for a manual verifier)', auth.oauth1.callbackUri, callbackUri => onChange({ oauth1: { ...auth.oauth1, callbackUri } }), false, typeof window === 'undefined' ? '/api/auth/callback' : `${window.location.origin}/api/auth/callback`)}</div><button className="button button-secondary" disabled={busy || !!session} onClick={() => void action('start')}>Start OAuth 1 authorization</button></details>
    </>}
    {auth.authType === 'oauth2' && <div className="oauth-actions"><button className="button button-primary" disabled={busy || !!session} onClick={() => void action(auth.oauth2.grantType === 'client_credentials' ? 'client_credentials' : 'start')}>{busy ? 'Working…' : 'Get access token'}</button><button className="button button-secondary" disabled={busy || !!session || !auth.oauth2.refreshToken} onClick={() => void action('refresh')}>Refresh token</button><button className="text-button" disabled={busy || !!session} onClick={() => onChange({ oauth2: { ...auth.oauth2, accessToken: '', refreshToken: '', expiresAt: 0, tokenBinding: '' } })}>Clear tokens</button></div>}
    {session?.authorizationUrl && <div className="oauth-session"><p>Open the authorization page in your browser, then return here. The callback is validated using this flow's state.</p><a className="button button-primary" href={session.authorizationUrl} target="_blank" rel="noopener noreferrer">Open authorization page</a><p>Callback: <code>{session.redirectUri}</code></p><p>If automatic return is unavailable, paste {session.redirectUri === 'oob' ? 'the verifier' : 'the complete redirect URL'} below.</p><textarea className="field-input oauth-callback" aria-label="OAuth redirect URL or verifier" value={callback} onChange={event => setCallback(event.target.value)} /><div className="oauth-actions"><button className="button button-secondary" disabled={busy || !callback.trim()} onClick={() => void action('complete')}>Complete authorization</button><button className="text-button" onClick={cancel}>Cancel authorization</button></div></div>}
    {error && <p className="error-text" role="alert">{error}</p>}{message && <p className="automation-help" role="status">{message}</p>}
    {!['inherit', 'none'].includes(auth.authType) && <p className="auth-storage-note"><Icon name="lock" size={14} />Credentials stay in this workspace and are included in exports. Use variables for shared values. Storage is not encrypted.</p>}
  </div>;
}
