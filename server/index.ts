import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { executeRequest, RequestError, validateRequest } from './execute.ts';
import { MAX_API_BYTES } from '../shared/body.ts';
import { runRequest } from './pipeline.ts';
import { OAuthSessions } from './oauth.ts';
import { AuthenticationError } from './auth-error.ts';
import { oauth1Authorization } from './auth-signing.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

export function createReqoraServer(options: { staticDirectory?: string } = {}) {
  const oauth = new OAuthSessions();
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(value));
    };
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (url.pathname === '/api/auth/callback' && request.method === 'GET') {
        let ok = false;
        try { await oauth.complete(url); ok = true; } catch { /* Do not reflect codes, state, or provider text into HTML. */ }
        response.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Reqora authorization</title><h1>${ok ? 'Authorization received' : 'Authorization could not be completed'}</h1><p>Return to Reqora to view the result. You can close this page.</p></html>`);
        return;
      }
      if (url.pathname === '/api/health' && request.method === 'GET') {
        json(200, { status: 'ok', name: 'Reqora' });
        return;
      }
      if (['/api/execute', '/api/run-request', '/api/auth', '/api/auth/preview'].includes(url.pathname)) {
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
          if (size > MAX_API_BYTES) { request.resume(); throw new RequestError('Request payload exceeds the 16 MB transport limit (10 MB body plus file encoding).', 413); }
          chunks.push(Buffer.from(chunk));
        }
        let input: unknown;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new RequestError('Invalid JSON request.'); }
        const controller = new AbortController();
        const cancel = () => { if (!response.writableEnded) controller.abort(); };
        response.once('close', cancel);
        try {
          if (url.pathname === '/api/auth') json(200, await oauth.action(input, origin || url.origin, controller.signal));
          else if (url.pathname === '/api/auth/preview') {
            const prepared = validateRequest(input);
            if (prepared.auth?.authType !== 'oauth1') throw new AuthenticationError('OAuth 1 signing preview requires OAuth 1 authentication.');
            const headers = new Headers(prepared.headers.map(header => [header.name, header.value]));
            json(200, { authorization: oauth1Authorization(prepared.method, new URL(prepared.url), headers, typeof prepared.body === 'string' ? prepared.body : undefined, prepared.auth.oauth1!).authorization });
          } else json(200, await (url.pathname === '/api/run-request' ? runRequest(input, controller.signal) : executeRequest(input, controller.signal)));
        }
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
        json(error instanceof RequestError ? error.status : error instanceof AuthenticationError ? 400 : 500, { error: error instanceof RequestError || error instanceof AuthenticationError ? error.message : 'An unexpected server error occurred.' });
      }
    }
  });
}
