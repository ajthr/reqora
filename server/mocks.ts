import { interpolate } from '../shared/workspace.ts';
import type { Draft, Entry } from '../shared/workspace.ts';
import type { HttpResponse } from '../shared/types.ts';
import { mockResponseError, selectedMock } from '../shared/mocks.ts';

export async function executeMock(request: Draft, variables: Entry[], signal?: AbortSignal): Promise<HttpResponse> {
  const mock = selectedMock(request.mock!);
  const error = mockResponseError(mock);
  if (error) throw new Error(error);
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 100 || request.timeoutMs > 60_000) throw new Error('Request timeout must be from 100 to 60,000 ms.');
  signal?.throwIfAborted();
  const started = performance.now();
  const timeout = AbortSignal.timeout(request.timeoutMs), active = signal ? AbortSignal.any([timeout, signal]) : timeout;
  try {
    await new Promise<void>((resolve, reject) => {
      if (active.aborted) { reject(active.reason); return; }
      const abort = () => { clearTimeout(timer); reject(active.reason); };
      const timer = setTimeout(() => { active.removeEventListener('abort', abort); resolve(); }, mock.delayMs || 0);
      active.addEventListener('abort', abort, { once: true });
    });
    active.throwIfAborted();
    if (mock.failure === 'network') throw new Error('Simulated mock network failure.');
    if (mock.failure === 'timeout') throw new Error('Simulated mock request timeout.');
    const encoding = mock.encoding || 'utf8';
    const headers = mock.headers.map(header => ({ name: header.name, value: interpolate(header.value, variables, 8192) }));
    if (headers.some(header => /[\r\n\0]/.test(header.value))) throw new Error('Resolved mock header values must not contain line breaks.');
    if (!headers.some(header => header.name.toLowerCase() === 'content-type')) headers.push({ name: 'Content-Type', value: encoding === 'base64' ? 'application/octet-stream' : 'application/json' });
    const noBody = request.method.toUpperCase() === 'HEAD' || mock.status < 200 || [204, 205, 304].includes(mock.status);
    const body = noBody ? '' : encoding === 'base64' ? mock.body : interpolate(mock.body, variables, 100_000);
    return { url: request.url, status: mock.status, statusText: mock.statusText, headers, body, encoding, durationMs: Math.round(performance.now() - started), size: Buffer.byteLength(body, encoding === 'base64' ? 'base64' : 'utf8') };
  } catch (error) {
    if (signal?.aborted) throw new Error('Request cancelled.');
    if (timeout.aborted) throw new Error(`Mock request timed out after ${request.timeoutMs} ms.`);
    throw error;
  }
}
