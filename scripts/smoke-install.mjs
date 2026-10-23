// Exercise generated artifacts, including the bundled runtime, without launching a GUI.
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const requested = process.argv[2] || 'all';
if (!['all', 'desktop', 'web', 'both'].includes(requested)) throw new Error('Usage: npm run test:packages -- [all|desktop|web|both]');
const modes = requested === 'all' ? ['desktop', 'web', 'both'] : [requested];
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const release = resolve('release');
const windows = process.platform === 'win32';
for (const mode of modes) {
  const temporary = await mkdtemp(join(tmpdir(), 'reqora-package-'));
  const prefix = join(temporary, 'installed');
  const bin = join(temporary, 'bin');
  const env = { ...process.env, HOME: temporary, XDG_DATA_HOME: join(temporary, 'data') };
  const name = `reqora-${pkg.version}-${process.platform}-${process.arch}-${mode}`;
  let fixture;
  try {
    if (windows) await exec(join(release, `${name}-setup.exe`), ['/S', `/D=${prefix}`]);
    else {
      await exec('tar', ['-xzf', join(release, `${name}.tar.gz`), '-C', temporary]);
      await exec('/bin/sh', [join(temporary, name, 'install.sh'), '--mode', mode, '--prefix', prefix, '--bin-dir', bin], { env });
    }
    if (mode !== 'web') {
      await access(join(prefix, 'desktop', process.platform === 'darwin' ? 'Reqora.app/Contents/MacOS/reqora' : windows ? 'reqora.exe' : 'reqora'));
    } else await assert.rejects(access(join(prefix, 'desktop')));
    if (mode !== 'desktop') {
      const runtime = join(prefix, 'web/runtime', windows ? 'node.exe' : 'node');
      const cli = join(prefix, 'web/cli.mjs');
      fixture = createServer((_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end('{"packagedRequest":true}'); });
      await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
      // Reserve an available web port separately from the request target.
      const reserve = createServer();
      await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
      const port = reserve.address().port;
      await new Promise(resolve => reserve.close(resolve));
      env.REQORA_WEB_PORT = String(port);
      try {
        await exec(runtime, [cli, 'start'], { env });
        const base = `http://127.0.0.1:${port}`;
        assert.match(await (await fetch(base)).text(), /<div id="root">/);
        assert.equal((await (await fetch(`${base}/api/health`)).json()).name, 'Reqora');
        const result = await fetch(`${base}/api/execute`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
          body: JSON.stringify({ method: 'GET', url: `http://127.0.0.1:${fixture.address().port}/`, headers: [], timeoutMs: 5000, followRedirects: true }),
        });
        assert.equal(result.status, 200);
        assert.match((await result.json()).body, /packagedRequest/);
      } finally { await exec(runtime, [cli, 'stop'], { env }); }
    } else await assert.rejects(access(join(prefix, 'web')));
    if (windows) {
      await exec(join(prefix, 'Uninstall.exe'), ['/S']);
      // NSIS may hand off uninstall to a temporary executable before returning.
      for (let i = 0; i < 100; i++) {
        try { await access(prefix); } catch { break; }
        await delay(100);
      }
    } else await exec(join(bin, 'reqora-uninstall'), [], { env });
    await assert.rejects(access(prefix));
    console.log(`Installed, verified, and uninstalled ${name}`);
  } finally {
    if (fixture) { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); }
    // Never delete a live installation on failed smoke tests; leave a path for diagnosis.
    try { await access(prefix); console.error(`Inspect failed installation: ${prefix}`); }
    catch { await rm(temporary, { recursive: true, force: true }); }
  }
}
assert((await readdir(release)).some(name => name.startsWith('SHA256SUMS-')));
