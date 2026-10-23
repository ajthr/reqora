import { AuthenticationError } from './auth-error.ts';
import { createHash, createHmac, randomBytes, sign } from 'node:crypto';
import { SignatureV4 } from '@smithy/signature-v4';
import { Hash } from '@smithy/hash-node';
import type { AwsAuth, OAuth1Auth } from '../shared/auth.ts';

export const percentEncode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());

export function oauth1Authorization(method: string, url: URL, headers: Headers, body: string | Buffer | undefined, config: OAuth1Auth, options: {
  nonce?: string; timestamp?: string; parameters?: Record<string, string>; includeVersion?: boolean;
} = {}): { authorization: string; baseString: string } {
  if (!config.consumerKey) throw new AuthenticationError('OAuth 1 requires a consumer key.');
  const oauth: Record<string, string> = { oauth_consumer_key: config.consumerKey, oauth_nonce: options.nonce || randomBytes(16).toString('hex'), oauth_signature_method: config.signatureMethod,
    oauth_timestamp: options.timestamp || String(Math.floor(Date.now() / 1000)), ...(options.includeVersion === false ? {} : { oauth_version: '1.0' }), ...(config.token ? { oauth_token: config.token } : {}), ...options.parameters };
  const pairs = [...url.searchParams];
  if (headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/x-www-form-urlencoded' && body !== undefined) pairs.push(...new URLSearchParams(body.toString()));
  pairs.push(...Object.entries(oauth));
  const parameters = pairs.filter(([name]) => name !== 'oauth_signature').map(([name, value]) => [percentEncode(name), percentEncode(value)])
    .sort(([an, av], [bn, bv]) => an < bn ? -1 : an > bn ? 1 : av < bv ? -1 : av > bv ? 1 : 0).map(([name, value]) => `${name}=${value}`).join('&');
  const baseUri = `${url.protocol}//${url.host}${url.pathname || '/'}`;
  const baseString = [method.toUpperCase(), percentEncode(baseUri), percentEncode(parameters)].join('&');
  const key = `${percentEncode(config.consumerSecret)}&${percentEncode(config.tokenSecret)}`;
  let signature: string;
  if (config.signatureMethod === 'PLAINTEXT') signature = key;
  else if (config.signatureMethod === 'RSA-SHA1') {
    if (!config.privateKey) throw new AuthenticationError('OAuth 1 RSA-SHA1 requires a PEM private key.');
    try { signature = sign('RSA-SHA1', Buffer.from(baseString), config.privateKey).toString('base64'); }
    catch { throw new AuthenticationError('OAuth 1 private key could not be read. Use a valid, unencrypted PEM RSA private key.'); }
  } else signature = createHmac(config.signatureMethod === 'HMAC-SHA256' ? 'sha256' : 'sha1', key).update(baseString).digest('base64');
  const values = { ...(config.realm ? { realm: config.realm } : {}), ...oauth, oauth_signature: signature };
  return { authorization: 'OAuth ' + Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${percentEncode(name)}="${percentEncode(value)}"`).join(', '), baseString };
}

export async function signAws(method: string, url: URL, headers: Headers, body: string | Buffer | undefined, config: AwsAuth, date = new Date()): Promise<void> {
  if (!config.accessKeyId || !config.secretAccessKey || !/^[a-z\d-]{1,64}$/.test(config.region) || !/^[a-z\d-]{1,64}$/.test(config.service)) throw new AuthenticationError('AWS Signature V4 requires access key, secret key, region, and service.');
  const query: Record<string, string[]> = Object.create(null);
  for (const [name, value] of url.searchParams) (query[name] ??= []).push(value);
  headers.delete('authorization'); headers.delete('x-amz-date'); headers.delete('x-amz-content-sha256'); headers.delete('x-amz-security-token');
  const signer = new SignatureV4({ credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}) }, region: config.region, service: config.service,
    sha256: Hash.bind(null, 'sha256'), uriEscapePath: config.service !== 's3', applyChecksum: true });
  const signed = await signer.sign({ protocol: url.protocol, hostname: url.hostname, port: url.port ? Number(url.port) : undefined, method, path: url.pathname, query, headers: { ...Object.fromEntries(headers), host: url.host }, body: body ?? '' }, { signingDate: date });
  for (const [name, value] of Object.entries(signed.headers)) if (name.toLowerCase() !== 'host') headers.set(name, value);
}

export interface DigestChallenge { realm: string; nonce: string; algorithm: string; qop?: string; opaque?: string; stale?: string; charset?: string; userhash?: string }
export function digestChallenge(value: string): DigestChallenge | undefined {
  // Split only commas outside quoted strings, then group authentication schemes.
  const pieces: string[] = []; let part = '', quoted = false, escaped = false;
  for (const char of value) {
    if (escaped) { part += char; escaped = false; continue; }
    if (quoted && char === '\\') { part += char; escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    if (char === ',' && !quoted) { pieces.push(part.trim()); part = ''; } else part += char;
  }
  pieces.push(part.trim());
  const candidates: Record<string, string>[] = []; let current: Record<string, string> | undefined;
  for (let piece of pieces) {
    const scheme = /^([\w-]+)\s+(?!\s*=)/.exec(piece);
    if (scheme) { current = scheme[1].toLowerCase() === 'digest' ? {} : undefined; if (current) candidates.push(current); piece = piece.slice(scheme[0].length); }
    if (!current) continue;
    const match = /^([\w-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))\s*$/.exec(piece);
    if (match) current[match[1].toLowerCase()] = match[2]?.replace(/\\(.)/g, '$1') ?? match[3];
  }
  const supported = ['SHA-512-256-SESS', 'SHA-512-256', 'SHA-256-SESS', 'SHA-256', 'MD5-SESS', 'MD5'];
  return candidates.filter(item => item.realm !== undefined && item.nonce && supported.includes((item.algorithm || 'MD5').toUpperCase()))
    .sort((a, b) => supported.indexOf((a.algorithm || 'MD5').toUpperCase()) - supported.indexOf((b.algorithm || 'MD5').toUpperCase()))
    .map(item => {
      const decoded = item.charset?.toUpperCase() === 'UTF-8' ? Buffer.from(item.realm, 'latin1').toString('utf8') : item.realm;
      return { ...item, realm: decoded.includes('\ufffd') ? item.realm : decoded, nonce: item.nonce, algorithm: item.algorithm || 'MD5' };
    })[0];
}

export function digestAuthorization(method: string, url: URL, body: string | Buffer | undefined, username: string, password: string, challenge: DigestChallenge, options: { cnonce?: string; nc?: number } = {}): string {
  const algorithm = challenge.algorithm.toUpperCase();
  const hashName = algorithm.startsWith('SHA-512-256') ? 'sha512-256' : algorithm.startsWith('SHA-256') ? 'sha256' : 'md5';
  const utf8 = challenge.charset?.toUpperCase() === 'UTF-8';
  if (!utf8 && /[^\u0000-\u00ff]/.test(username + password)) throw new AuthenticationError('The Digest server must advertise UTF-8 to use these credentials.');
  const h = (value: string | Buffer) => createHash(hashName).update(typeof value === 'string' ? Buffer.from(value, utf8 ? 'utf8' : 'latin1') : value).digest('hex');
  const cnonce = options.cnonce || randomBytes(16).toString('hex'), nc = (options.nc || 1).toString(16).padStart(8, '0');
  const uri = url.pathname + url.search;
  const qops = challenge.qop?.split(',').map(value => value.trim().toLowerCase());
  const qop = qops ? qops.includes('auth') ? 'auth' : qops.includes('auth-int') ? 'auth-int' : undefined : undefined;
  if (qops && !qop) throw new AuthenticationError('Digest server offered an unsupported qop.');
  let a1 = h(`${username}:${challenge.realm}:${password}`);
  if (algorithm.endsWith('-SESS')) a1 = h(`${a1}:${challenge.nonce}:${cnonce}`);
  const a2 = h(`${method}:${uri}${qop === 'auth-int' ? ':' + h(Buffer.isBuffer(body) ? body : Buffer.from(body || '')) : ''}`);
  const response = h(`${a1}:${challenge.nonce}:${qop ? `${nc}:${cnonce}:${qop}:` : ''}${a2}`);
  const quote = (value: string) => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const hashedUser = challenge.userhash?.toLowerCase() === 'true';
  const name = hashedUser ? h(`${username}:${challenge.realm}`) : username;
  const parts = [utf8 && /[^\x20-\x7e]/.test(name) && !hashedUser ? `username*=UTF-8''${percentEncode(name)}` : `username=${quote(name)}`,
    `realm=${quote(utf8 ? Buffer.from(challenge.realm, 'utf8').toString('latin1') : challenge.realm)}`, `nonce=${quote(challenge.nonce)}`, `uri=${quote(uri)}`, `response=${quote(response)}`, `algorithm=${challenge.algorithm}`];
  if (challenge.opaque !== undefined) parts.push(`opaque=${quote(challenge.opaque)}`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce=${quote(cnonce)}`);
  else if (algorithm.endsWith('-SESS')) parts.push(`cnonce=${quote(cnonce)}`);
  if (hashedUser) parts.push('userhash=true');
  return 'Digest ' + parts.join(', ');
}
