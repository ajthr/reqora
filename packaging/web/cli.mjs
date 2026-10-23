import { spawn } from 'node:child_process';
import { open, readFile, unlink, mkdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const stateFile = new URL('./state.json', import.meta.url);
async function running() {
  try {
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    if (!Number.isInteger(state.port) || state.port < 1024 || state.port > 65535 || !/^[a-f0-9]{64}$/.test(state.token)) return null;
    const response = await fetch(`http://127.0.0.1:${state.port}/__reqora/control`, {
      headers: { Authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(1000),
    });
    if (response.ok && (await response.json()).name === 'Reqora Web') return state;
  } catch { /* Not running, or a stale state file. */ }
  return null;
}
async function start(foreground) {
  const lock = new URL('./start.lock', import.meta.url);
  let acquired = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await mkdir(lock); acquired = true; break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try { if (Date.now() - (await stat(lock)).mtimeMs > 30_000) await rm(lock, { recursive: true, force: true }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await delay(100);
    }
  }
  if (!acquired) throw new Error('Another web launcher is starting. Try again shortly.');
  try { return await startLocked(foreground); }
  finally { await rm(lock, { recursive: true, force: true }); }
}
async function startLocked(foreground) {
  const active = await running();
  if (active) return active;
  await unlink(stateFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (foreground) { const { ready } = await import('./serve.mjs'); await ready; return null; }
  const log = await open(new URL('./web.log', import.meta.url), 'a', 0o600);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url))], {
    detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd],
  });
  let failure;
  child.on('error', error => { failure = error; });
  child.unref();
  await log.close();
  for (let attempt = 0; attempt < 60; attempt++) {
    if (failure) throw failure;
    const state = await running();
    if (state) return state;
    if (child.exitCode !== null) break;
    await delay(100);
  }
  throw new Error('Web UI did not start. Check web.log in the installation web folder (the port may already be in use).');
}
try {
  const command = process.argv[2] || 'open';
  if (!['start', 'open', 'run', 'stop', 'status'].includes(command) || process.argv.length > 3) {
    throw new Error('Usage: reqora-web [open|start|run|stop|status]');
  }
  if (command === 'stop') {
    const state = await running();
    if (state) {
      await fetch(`http://127.0.0.1:${state.port}/__reqora/control`, {
        method: 'POST', headers: { Authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(2000),
      });
      let stopped = false;
      for (let attempt = 0; attempt < 70; attempt++) {
        try {
          const current = JSON.parse(await readFile(stateFile, 'utf8'));
          if (current.token !== state.token) { stopped = true; break; }
        } catch (error) { if (error.code === 'ENOENT') { stopped = true; break; } throw error; }
        await delay(100);
      }
      if (!stopped) throw new Error('Web UI has not stopped yet. Try again shortly.');
    }
    console.log('Reqora Web stopped.');
  } else if (command === 'status') {
    const state = await running();
    console.log(state ? `Reqora Web: http://127.0.0.1:${state.port}` : 'Reqora Web is not running.');
    if (!state) process.exitCode = 1;
  } else {
    const state = await start(command === 'run');
    if (state) {
      const url = `http://127.0.0.1:${state.port}`;
      console.log(`Reqora Web: ${url}`);
      if (command === 'open') {
        const [program, args] = process.platform === 'win32'
          ? ['cmd.exe', ['/d', '/c', 'start', '', url]]
          : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
        const browser = spawn(program, args, { detached: true, stdio: 'ignore', windowsHide: true });
        browser.on('error', () => console.log(`Open ${url} in your browser.`));
        browser.unref();
      }
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
