import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createReqoraServer } from './app/server/index.js';

const port = Number(process.env.REQORA_WEB_PORT || 5174);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('REQORA_WEB_PORT must be an integer between 1024 and 65535.');
}
const stateFile = new URL('./state.json', import.meta.url);
const token = randomBytes(32).toString('hex');
const server = createReqoraServer({ staticDirectory: fileURLToPath(new URL('./app/dist', import.meta.url)) });
const [handleRequest] = server.listeners('request');
server.removeAllListeners('request');
server.on('request', (request, response) => {
  if (request.url !== '/__reqora/control') return void handleRequest(request, response);
  const authorization = Buffer.from(request.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${token}`);
  if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
    response.writeHead(403).end();
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method === 'GET') response.end(JSON.stringify({ name: 'Reqora Web', pid: process.pid }));
  else if (request.method === 'POST') { response.end('{}'); shutdown(); }
  else response.writeHead(405).end();
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(async () => {
    try {
      const state = JSON.parse(await readFile(stateFile, 'utf8'));
      if (state.token === token) await unlink(stateFile);
    } catch { /* No state file after an interrupted installation. */ }
    process.exit(0);
  });
  server.closeIdleConnections();
  // Stopping the app also cancels active REST requests and closes control keep-alives.
  server.closeAllConnections();
  setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 5000).unref();
}
export const ready = new Promise((resolve, reject) => {
  server.on('error', reject);
  server.listen(port, '127.0.0.1', async () => {
    try {
      await writeFile(stateFile, JSON.stringify({ port, token }), { flag: 'wx', mode: 0o600 });
      console.log(`Reqora Web: http://127.0.0.1:${port}`);
      resolve();
    } catch (error) { reject(error); server.close(); }
  });
});
ready.catch(error => { console.error(error.message); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
