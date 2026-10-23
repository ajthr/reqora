import type { HttpRequest, HttpResponse, MultipartPart, RequestBody, UploadFile } from '../shared/types.ts';
import { validateHeaderValue } from 'node:http';
import { base64ByteLength, isFileName, isMediaType, MAX_BODY_BYTES, MAX_BODY_FIELDS } from '../shared/body.ts';
import { isAuthConfig, effectiveAuth } from '../shared/auth.ts';
import type { OAuth2Tokens } from '../shared/auth.ts';
import { AuthenticationError } from './auth-error.ts';
import { authenticate } from './request-auth.ts';
import { digestChallenge } from './auth-signing.ts';
import { usableOAuth2 } from './oauth.ts';

export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export class RequestError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function validateBody(value: unknown): RequestBody | undefined {
  let size = 0;
  const addSize = (bytes: number) => {
    size += bytes;
    if (size > MAX_BODY_BYTES) throw new RequestError('Request body exceeds the 10 MB limit.', 413);
  };
  const file = (value: unknown): UploadFile => {
    if (!value || typeof value !== 'object') throw new RequestError('Attach a valid file.');
    const upload = value as UploadFile;
    if (!isFileName(upload.name) || !isMediaType(upload.type)) throw new RequestError('Invalid file name or content type.');
    const length = base64ByteLength(upload.data);
    if (length === null) throw new RequestError('File data must be valid base64 within the 10 MB limit.');
    addSize(length);
    return { name: upload.name, type: upload.type, data: upload.data };
  };
  if (value === undefined) return undefined;
  if (typeof value === 'string') { addSize(Buffer.byteLength(value)); return value; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError('Invalid request body.');
  const body = value as Record<string, unknown>;
  if (body.kind === 'binary') return { kind: 'binary', file: file(body.file) };
  if (body.kind !== 'multipart' || !Array.isArray(body.parts) || body.parts.length > MAX_BODY_FIELDS) throw new RequestError('Provide up to 100 multipart fields.');
  const parts: MultipartPart[] = body.parts.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestError('Invalid multipart field.');
    const part = value as Record<string, unknown>;
    if (typeof part.name !== 'string' || !part.name.trim() || Buffer.byteLength(part.name) > 1024 || /[\r\n\0]/.test(part.name)) throw new RequestError('Multipart field names must be non-empty and contain no line breaks.');
    addSize(Buffer.byteLength(part.name));
    if ('file' in part && !('value' in part)) return { name: part.name, file: file(part.file) };
    if (typeof part.value !== 'string' || 'file' in part) throw new RequestError('Multipart fields must contain either a text value or a file.');
    addSize(Buffer.byteLength(part.value));
    return { name: part.name, value: part.value };
  });
  return { kind: 'multipart', parts };
}

export function validateRequest(input: unknown): HttpRequest {
  if (!input || typeof input !== 'object') throw new RequestError('A request object is required.');
  const value = input as Record<string, unknown>;
  if (typeof value.url !== 'string') throw new RequestError('Enter an HTTP or HTTPS URL.');
  let url: URL;
  try { url = new URL(value.url); } catch { throw new RequestError('Enter a valid URL, including http:// or https://.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new RequestError('Only HTTP and HTTPS requests are supported.');
  if (url.username || url.password) throw new RequestError('Use the Auth tab instead of credentials in the URL.');
  if (typeof value.method !== 'string' || !/^[!#$%&'*+.^_`|~\w-]+$/.test(value.method)) {
    throw new RequestError('Enter a valid HTTP method.');
  }
  const method = value.method.toUpperCase();
  if (['CONNECT', 'TRACE', 'TRACK'].includes(method)) throw new RequestError(`${method} is not supported by this request engine.`);
  if (!Array.isArray(value.headers) || value.headers.length > 100) throw new RequestError('Provide up to 100 request headers.');
  const headers = value.headers.map((header: unknown) => {
    if (!header || typeof header !== 'object') throw new RequestError('Invalid request header.');
    const { name, value } = header as Record<string, unknown>;
    if (typeof name !== 'string' || !/^[!#$%&'*+.^_`|~\w-]+$/.test(name) || typeof value !== 'string' || /[\r\n\0]/.test(value)) {
      throw new RequestError('Header names and values must be valid HTTP headers.');
    }
    try { validateHeaderValue(name, value); }
    catch { throw new RequestError(`The ${name} header contains an invalid value.`); }
    if (['host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'trailer', 'keep-alive', 'proxy-connection'].includes(name.toLowerCase())) {
      throw new RequestError(`The ${name} header is managed by the request engine.`);
    }
    return { name, value };
  });
  const body = validateBody(value.body);
  if (['GET', 'HEAD'].includes(method) && body !== undefined && body !== '') throw new RequestError(`${method} requests cannot contain a body.`);
  if (typeof value.timeoutMs !== 'number' || !Number.isInteger(value.timeoutMs) || value.timeoutMs < 100 || value.timeoutMs > 60_000) {
    throw new RequestError('Timeout must be between 100 and 60000 milliseconds.');
  }
  if (typeof value.followRedirects !== 'boolean') throw new RequestError('Redirect handling must be true or false.');
  if (value.auth !== undefined && !isAuthConfig(value.auth, false)) throw new RequestError('Invalid authentication configuration.');
  return { url: url.href, method, headers, body, timeoutMs: value.timeoutMs, followRedirects: value.followRedirects,
    ...(value.auth !== undefined ? { auth: effectiveAuth(value.auth as HttpRequest['auth'] & {}, undefined) } : {}) };
}

export async function executeRequest(input: unknown, signal?: AbortSignal, options: { onAuthUpdate?: (tokens: OAuth2Tokens) => void } = {}): Promise<HttpResponse> {
  const request = validateRequest(input);
  const started = performance.now();
  const timeout = AbortSignal.timeout(request.timeoutMs);
  const headers = new Headers();
  for (const header of request.headers) headers.append(header.name, header.value);

  try {
    let body: string | Buffer | undefined;
    if (typeof request.body === 'string') body = ['GET', 'HEAD'].includes(request.method) ? undefined : request.body;
    else if (request.body?.kind === 'binary') {
      body = Buffer.from(request.body.file.data, 'base64');
      if (!headers.has('content-type')) headers.set('Content-Type', request.body.file.type || 'application/octet-stream');
    } else if (request.body?.kind === 'multipart') {
      const form = new FormData();
      for (const part of request.body.parts) {
        if ('file' in part) form.append(part.name, new Blob([Buffer.from(part.file.data, 'base64')], { type: part.file.type || 'application/octet-stream' }), part.file.name);
        else form.append(part.name, part.value);
      }
      // Use the runtime's multipart encoder and preserve its matching boundary.
      const encoded = new Request(request.url, { method: 'POST', body: form });
      body = Buffer.from(await encoded.arrayBuffer());
      if (body.byteLength > MAX_BODY_BYTES) throw new RequestError('Request body exceeds the 10 MB limit, including multipart fields and boundaries.', 413);
      headers.set('Content-Type', encoded.headers.get('content-type')!);
    }
    const activeSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let url = new URL(request.url), method = request.method, auth = request.auth;
    let response: Response;
    let redirects = 0;
    while (true) {
      let outgoing = new Headers(headers);
      await authenticate(method, url, outgoing, body, auth, activeSignal, options.onAuthUpdate);
      const send = () => fetch(url, { method, headers: outgoing, body, redirect: 'manual', signal: activeSignal });
      response = await send();
      if (auth?.authType === 'digest') for (let attempt = 0; response.status === 401 && attempt < 2; attempt++) {
        const challenge = digestChallenge(response.headers.get('www-authenticate') || '');
        if (!challenge || attempt > 0 && challenge.stale?.toLowerCase() !== 'true') break;
        await response.body?.cancel(); outgoing = new Headers(headers);
        await authenticate(method, url, outgoing, body, auth, activeSignal, undefined, challenge);
        response = await send();
      }
      if (auth?.authType === 'oauth2' && response.status === 401 && auth.oauth2!.autoRefresh && (auth.oauth2!.refreshToken || auth.oauth2!.grantType === 'client_credentials')) {
        await response.body?.cancel();
        const refreshed = await usableOAuth2(auth.oauth2!, activeSignal, true);
        Object.assign(auth.oauth2!, refreshed.tokens); options.onAuthUpdate?.(refreshed.tokens);
        outgoing = new Headers(headers); await authenticate(method, url, outgoing, body, auth, activeSignal, options.onAuthUpdate);
        response = await send();
      }
      const location = response.headers.get('location');
      if (!request.followRedirects || ![301, 302, 303, 307, 308].includes(response.status) || !location) break;
      await response.body?.cancel();
      if (++redirects > 10) throw new RequestError('Request exceeded the 10 redirect limit.', 502);
      const next = new URL(location, url);
      if (!['http:', 'https:'].includes(next.protocol) || next.username || next.password) throw new RequestError('Redirects must use HTTP or HTTPS without URL credentials.', 502);
      if (next.origin !== url.origin) {
        for (const name of ['authorization', 'proxy-authorization', 'cookie', 'cookie2', 'x-amz-security-token', 'x-amz-date', 'x-amz-content-sha256']) headers.delete(name);
        if (auth?.authType === 'apikey') {
          if (auth.apiKey!.location === 'header') headers.delete(auth.apiKey!.name);
          else next.searchParams.delete(auth.apiKey!.name);
        }
        auth = undefined;
      }
      if (response.status === 303 && method !== 'HEAD' || [301, 302].includes(response.status) && method === 'POST') {
        method = 'GET'; body = undefined;
        for (const name of ['content-type', 'content-encoding', 'content-language', 'content-location']) headers.delete(name);
      }
      url = next;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new RequestError('Response exceeds the 5 MB limit.', 413);
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    const buffer = Buffer.concat(chunks);
    const contentType = response.headers.get('content-type') || '';
    const isText = !contentType || /text\/|json|xml|javascript|x-www-form-urlencoded|svg/i.test(contentType);
    const responseHeaders = [...response.headers.entries()]
      .filter(([name]) => name !== 'set-cookie')
      .map(([name, value]) => ({ name, value }));
    for (const value of response.headers.getSetCookie()) responseHeaders.push({ name: 'set-cookie', value });
    return {
      url: response.url,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: buffer.toString(isText ? 'utf8' : 'base64'),
      encoding: isText ? 'utf8' : 'base64',
      durationMs: Math.round(performance.now() - started),
      size,
    };
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (timeout.aborted) throw new RequestError(`Request timed out after ${request.timeoutMs / 1000} seconds.`, 504);
    if (signal?.aborted) throw new RequestError('Request cancelled.', 499);
    if (error instanceof AuthenticationError) throw new RequestError(error.message, 400);
    throw new RequestError('Unable to connect to the server. Check the URL, network connection, and TLS certificate.', 502);
  }
}
