import { validateHeaderValue } from 'node:http';
import { AuthenticationError } from './auth-error.ts';
import { digestAuthorization, oauth1Authorization, signAws } from './auth-signing.ts';
import type { DigestChallenge } from './auth-signing.ts';
import { usableOAuth2 } from './oauth.ts';
import type { AuthConfig, OAuth2Tokens } from '../shared/auth.ts';

export async function authenticate(method: string, url: URL, headers: Headers, body: string | Buffer | undefined, auth: AuthConfig | undefined,
  signal: AbortSignal, update?: (tokens: OAuth2Tokens) => void, challenge?: DigestChallenge): Promise<void> {
  if (!auth || auth.authType === 'none') return;
  try {
    if (auth.authType === 'basic') headers.set('Authorization', 'Basic ' + Buffer.from(`${auth.username || ''}:${auth.password || ''}`).toString('base64'));
    else if (auth.authType === 'bearer') headers.set('Authorization', `Bearer ${auth.token || ''}`);
    else if (auth.authType === 'apikey') {
      if (!auth.apiKey?.name.trim()) throw new AuthenticationError('Enter an API key name.');
      if (auth.apiKey.location === 'query') url.searchParams.set(auth.apiKey.name, auth.apiKey.value);
      else {
        if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(auth.apiKey.name) || ['host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'trailer'].includes(auth.apiKey.name.toLowerCase())) throw new AuthenticationError('Use a valid, unmanaged HTTP header for the API key.');
        headers.set(auth.apiKey.name, auth.apiKey.value);
      }
    } else if (auth.authType === 'digest') {
      if (challenge) headers.set('Authorization', digestAuthorization(method, url, body, auth.username || '', auth.password || '', challenge));
      else headers.delete('Authorization');
    } else if (auth.authType === 'oauth1') {
      if (auth.oauth1?.signatureMethod === 'PLAINTEXT' && url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new AuthenticationError('OAuth 1 PLAINTEXT requires HTTPS.');
      headers.set('Authorization', oauth1Authorization(method, url, headers, body, auth.oauth1!).authorization);
    } else if (auth.authType === 'aws') await signAws(method, url, headers, body, auth.aws!);
    else if (auth.authType === 'oauth2') {
      if (auth.oauth2!.tokenType && auth.oauth2!.tokenType.toLowerCase() !== 'bearer') throw new AuthenticationError('This client supports OAuth 2 Bearer tokens.');
      const result = await usableOAuth2(auth.oauth2!, signal);
      if (result.updated) { Object.assign(auth.oauth2!, result.tokens); update?.(result.tokens); }
      headers.set('Authorization', `Bearer ${result.tokens.accessToken}`);
    }
    for (const [name, value] of headers) validateHeaderValue(name, value);
  } catch (error) {
    if (error instanceof AuthenticationError || signal.aborted) throw error;
    throw new AuthenticationError('Unable to apply authentication. Check credential fields and remove invalid header characters.');
  }
}
