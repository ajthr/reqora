import type { HttpRequest, HttpResponse, MultipartPart, RequestBody, UploadFile } from '../shared/types.ts';
import { validateHeaderValue } from 'node:http';
import { base64ByteLength, isFileName, isMediaType, MAX_BODY_BYTES, MAX_BODY_FIELDS } from '../shared/body.ts';

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
  return { url: url.href, method, headers, body, timeoutMs: value.timeoutMs, followRedirects: value.followRedirects };
}

export async function executeRequest(input: unknown, signal?: AbortSignal): Promise<HttpResponse> {
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
    const response = await fetch(request.url, {
      method: request.method,
      headers,
      body,
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
