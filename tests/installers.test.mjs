import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'reqora-install-'));
  const web = join(directory, 'web');
  await mkdir(join(web, 'app/server'), { recursive: true });
  await mkdir(join(web, 'app/dist'), { recursive: true });
  await writeFile(join(web, 'app/server/index.js'), `export { createReqoraServer } from ${JSON.stringify(new URL('../server/index.ts', import.meta.url).href)};\n`);
  await writeFile(join(web, 'app/package.json'), '{"type":"module"}');
  await writeFile(join(web, 'app/dist/index.html'), '<!doctype html><title>Reqora fixture</title>');
  for (const file of ['cli.mjs', 'serve.mjs']) await cp(join(root, 'packaging/web', file), join(web, file));
  return { directory, web, cli: (command, env = {}) => exec(process.execPath, [join(web, 'cli.mjs'), command], { env: { ...process.env, ...env }, timeout: 15_000 }) };
}
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('installed web launcher starts once, serves UI/API, authenticates stop, and restarts', async () => {
  const app = await fixture();
  const port = await freePort();
  const env = { REQORA_WEB_PORT: String(port) };
  try {
    const started = await Promise.all([app.cli('start', env), app.cli('start', env)]);
    for (const result of started) assert.match(result.stdout, new RegExp(`127.0.0.1:${port}`));
    assert.match((await fetch(`http://127.0.0.1:${port}`)).headers.get('content-type'), /text\/html/);
    assert.match(await (await fetch(`http://127.0.0.1:${port}`)).text(), /Reqora fixture/);
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).name, 'Reqora');
    assert.equal((await fetch(`http://127.0.0.1:${port}/__reqora/control`, { method: 'POST' })).status, 403);
    assert.match((await app.cli('status')).stdout, new RegExp(`:${port}`));
    await app.cli('stop');
    await assert.rejects(app.cli('status'), error => error.code === 1 && /not running/.test(error.stdout));
    await app.cli('start', env);
    await app.cli('stop');
    await app.cli('stop');
    const foreground = app.cli('run', env);
    // A user service can run in foreground and still be controlled by another launcher.
    let online = false;
    for (let i = 0; i < 50; i++) {
      try { await app.cli('status'); online = true; break; } catch { await delay(100); }
    }
    assert.equal(online, true);
    await app.cli('stop');
    assert.match((await foreground).stdout, /Reqora Web:/);
  } finally { await app.cli('stop').catch(() => {}); await rm(app.directory, { recursive: true, force: true }); }
});

test('installed web launcher rejects invalid ports and never stops an unrelated server', async () => {
  const app = await fixture();
  const unrelated = createHttpServer((_request, response) => response.writeHead(403).end());
  await new Promise(resolve => unrelated.listen(0, '127.0.0.1', resolve));
  try {
    await writeFile(join(app.web, 'state.json'), JSON.stringify({ port: unrelated.address().port, token: 'a'.repeat(64) }));
    await app.cli('stop');
    assert.equal(unrelated.listening, true);
    await assert.rejects(app.cli('start', { REQORA_WEB_PORT: 'invalid' }), /Command failed/);
    assert.match(await readFile(join(app.web, 'web.log'), 'utf8'), /REQORA_WEB_PORT must be/);
  } finally { unrelated.closeAllConnections(); await new Promise(resolve => unrelated.close(resolve)); await rm(app.directory, { recursive: true, force: true }); }
});

test('Unix installer supports all modes, upgrades, quoted paths, and safe uninstall', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const app = await fixture();
  const home = join(app.directory, 'home');
  const prefix = join(home, "Apps/Reqora's client");
  const bin = join(home, 'launchers');
  const env = { ...process.env, HOME: home, XDG_DATA_HOME: join(home, '.local/share') };
  const install = mode => exec('/bin/sh', [join(app.directory, 'install.sh'), '--mode', mode, '--prefix', prefix, '--bin-dir', bin], { env });
  try {
    await mkdir(join(app.directory, 'desktop'));
    await writeFile(join(app.directory, 'desktop/reqora'), '#!/bin/sh\nprintf desktop-launched\n', { mode: 0o755 });
    // macOS fixture supplies an app directory so the terminal installer follows its native layout.
    await mkdir(join(app.directory, 'desktop/Reqora.app'));
    await mkdir(join(app.web, 'runtime'));
    await cp(process.execPath, join(app.web, 'runtime/node'));
    for (const file of ['install.sh', 'uninstall.sh']) await cp(join(root, 'packaging/unix', file), join(app.directory, file));
    for (const file of ['LICENSE', 'NOTICE.txt']) await writeFile(join(app.directory, file), 'fixture');
    await writeFile(join(app.directory, 'platform'), `${process.platform}-${process.arch}\n`);
    await writeFile(join(app.directory, 'mode'), 'both\n');
    await install('desktop');
    await access(join(bin, 'reqora'));
    await assert.rejects(access(join(prefix, 'web')));
    if (process.platform === 'linux') assert.equal((await exec(join(bin, 'reqora'))).stdout, 'desktop-launched');
    await install('both');
    await access(join(prefix, 'desktop'));
    await access(join(prefix, 'web'));
    const port = await freePort();
    await exec(join(bin, 'reqora-web'), ['start'], { env: { ...env, REQORA_WEB_PORT: String(port) } });
    await install('web'); // Upgrade stops the old web server and removes the desktop component.
    await assert.rejects(access(join(prefix, 'desktop')));
    await assert.rejects(access(join(bin, 'reqora')));
    await writeFile(join(home, 'workspace-data'), 'preserve');
    await exec(join(bin, 'reqora-uninstall'), [], { env });
    await assert.rejects(access(prefix));
    await assert.rejects(access(join(bin, 'reqora-web')));
    assert.equal(await readFile(join(home, 'workspace-data'), 'utf8'), 'preserve');
    await mkdir(prefix, { recursive: true });
    await writeFile(join(prefix, 'unrelated'), 'keep');
    await assert.rejects(install('web'), /unrelated files/);
    assert.equal(await readFile(join(prefix, 'unrelated'), 'utf8'), 'keep');
    await assert.rejects(install('unknown'), /Usage/);
  } finally {
    await exec(process.execPath, [join(prefix, 'web/cli.mjs'), 'stop'], { env }).catch(() => {});
    await rm(app.directory, { recursive: true, force: true });
  }
});
