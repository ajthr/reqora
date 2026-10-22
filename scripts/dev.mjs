import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const processes = [
  spawn(process.execPath, ['--watch', 'server/start.ts'], { cwd: root, stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0'], { cwd: root, stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of processes) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 5000).unref();
}
for (const child of processes) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => stop(code || 0));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
