import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { executeRequest, RequestError } from './execute.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

export function createReqoraServer(options: { staticDirectory?: string } = {}) {
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(value));
    };
    try {
      const url = new URL(request.url || '/', 'http://localhost');
      if (url.pathname === '/api/health' && request.method === 'GET') {
        json(200, { status: 'ok', name: 'Reqora' });
        return;
      }
      if (url.pathname === '/api/execute') {
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'POST');
          json(405, { error: 'Use POST to execute a request.' });
          return;
        }
        const origin = request.headers.origin;
        if (origin) {
          let sameOrigin = false;
          try { sameOrigin = new URL(origin).host === request.headers.host; } catch { /* Reject opaque and invalid origins. */ }
          if (!sameOrigin) throw new RequestError('Requests must come from the Reqora application.', 403);
        }
        if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw new RequestError('Use application/json for this endpoint.', 415);
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request.iterator({ destroyOnReturn: false })) {
          size += chunk.length;
          if (size > 1024 * 1024) { request.resume(); throw new RequestError('Request exceeds the 1 MB limit.', 413); }
          chunks.push(Buffer.from(chunk));
        }
        let input: unknown;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new RequestError('Invalid JSON request.'); }
        const controller = new AbortController();
        const cancel = () => { if (!response.writableEnded) controller.abort(); };
        response.once('close', cancel);
        try { json(200, await executeRequest(input, controller.signal)); }
        finally { response.off('close', cancel); }
        return;
      }
      if (url.pathname.startsWith('/api/')) { json(404, { error: 'Endpoint not found.' }); return; }
      if (options.staticDirectory && ['GET', 'HEAD'].includes(request.method || '')) {
        const root = resolve(options.staticDirectory);
        const path = resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
        if (!path.startsWith(root + sep)) throw new RequestError('Invalid path.', 403);
        try {
          const data = await readFile(path);
          response.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
          response.end(request.method === 'HEAD' ? undefined : data);
        } catch { json(404, { error: 'File not found.' }); }
        return;
      }
      json(404, { error: 'Endpoint not found.' });
    } catch (error) {
      if (!response.destroyed && !response.headersSent) {
        json(error instanceof RequestError ? error.status : 500, { error: error instanceof RequestError ? error.message : 'An unexpected server error occurred.' });
      }
    }
  });
}
