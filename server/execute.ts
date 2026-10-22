import type { HttpRequest, HttpResponse } from '../shared/types.ts';
import { validateHeaderValue } from 'node:http';

export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export class RequestError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
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
  if (value.body !== undefined && typeof value.body !== 'string') throw new RequestError('The request body must be text.');
  if (['GET', 'HEAD'].includes(method) && value.body) throw new RequestError(`${method} requests cannot contain a body.`);
  if (typeof value.timeoutMs !== 'number' || !Number.isInteger(value.timeoutMs) || value.timeoutMs < 100 || value.timeoutMs > 60_000) {
    throw new RequestError('Timeout must be between 100 and 60000 milliseconds.');
  }
  if (typeof value.followRedirects !== 'boolean') throw new RequestError('Redirect handling must be true or false.');
  return { url: url.href, method, headers, body: value.body as string | undefined, timeoutMs: value.timeoutMs, followRedirects: value.followRedirects };
}

export async function executeRequest(input: unknown, signal?: AbortSignal): Promise<HttpResponse> {
  const request = validateRequest(input);
  const started = performance.now();
  const timeout = AbortSignal.timeout(request.timeoutMs);
  const headers = new Headers();
  for (const header of request.headers) headers.append(header.name, header.value);

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers,
      body: request.body || undefined,
      redirect: request.followRedirects ? 'follow' : 'manual',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
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
    throw new RequestError('Unable to connect to the server. Check the URL, network connection, and TLS certificate.', 502);
  }
}
