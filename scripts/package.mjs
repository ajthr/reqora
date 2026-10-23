import { cp, mkdir, readFile, readdir, rm, stat, writeFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const args = process.argv.slice(2);
let mode = 'all';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--mode' && args[i + 1]) mode = args[++i];
  else throw new Error('Usage: npm run package -- [--mode desktop|web|both|all]');
}
if (!['desktop', 'web', 'both', 'all'].includes(mode)) throw new Error('Unknown installation mode.');
const platform = process.platform;
const arch = process.arch;
if (!['linux', 'darwin', 'win32'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
  throw new Error('Build on Windows, macOS or Linux, using x64 or arm64 Node.js.');
}
if (process.versions.node.split('.')[0] !== '24') throw new Error('Release builds require Node.js 24.');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version)) throw new Error('Invalid release version.');
const release = resolve('release');
const work = join(release, '.work', `${platform}-${arch}`);
await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
const run = async (program, params, options = {}) => {
  const { stdout, stderr } = await exec(program, params, { cwd: root, maxBuffer: 16 * 1024 * 1024, ...options });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
};
// Avoid a shell, including on Windows: execute the active npm CLI through Node.
if (!process.env.npm_execpath) throw new Error('Run this script with npm run package.');
await run(process.execPath, [process.env.npm_execpath, 'run', 'build']);
const notices = `Reqora ${pkg.version}\nCopyright (c) Ajith. Reqora is distributed under the MIT license (LICENSE).\n\nDesktop payloads include Electron's LICENSE and LICENSES.chromium.html.\nWeb payloads include the Node.js license in web/runtime/LICENSE.\nReact and React DOM licenses are in each app's licenses directory.\nNo signing certificates are included. See docs/installation.md in the source repository.\n`;
async function copyApp(destination) {
  await mkdir(destination, { recursive: true });
  await cp('dist', join(destination, 'dist'), { recursive: true });
  await cp('dist-electron/server', join(destination, 'server'), { recursive: true });
  await cp('dist-electron/shared', join(destination, 'shared'), { recursive: true });
  await writeFile(join(destination, 'package.json'), '{"type":"module"}\n');
  await mkdir(join(destination, 'licenses'), { recursive: true });
  for (const dependency of ['react', 'react-dom', 'scheduler']) {
    await cp(`node_modules/${dependency}/LICENSE`, join(destination, 'licenses', `${dependency}.txt`));
  }
}
let desktop;
if (mode !== 'web') {
  const source = join(work, 'electron-source');
  await copyApp(source);
  // Electron's entry point retains its original relative paths to the UI and engine.
  await rm(join(source, 'server'), { recursive: true });
  await rm(join(source, 'shared'), { recursive: true });
  await cp('dist-electron', join(source, 'dist-electron'), { recursive: true });
  await mkdir(join(source, 'assets'), { recursive: true });
  await cp('assets/logo-full.png', join(source, 'assets/logo-full.png'));
  await cp('LICENSE', join(source, 'LICENSE'));
  await writeFile(join(source, 'package.json'), JSON.stringify({
    name: pkg.name, productName: 'Reqora', version: pkg.version, description: pkg.description,
    author: pkg.author, license: pkg.license, type: 'module', main: pkg.main,
  }, null, 2));
  const { packager } = await import('@electron/packager');
  const paths = await packager({
    dir: source, out: join(work, 'electron'), name: 'Reqora', executableName: 'reqora',
    platform, arch, electronVersion: pkg.devDependencies.electron,
    download: { cacheRoot: resolve('.cache/electron') },
    appBundleId: 'org.reqora.client', appCategoryType: 'public.app-category.developer-tools',
    appCopyright: 'Copyright (c) Ajith', overwrite: true, prune: false, asar: false,
    icon: platform === 'darwin' ? 'packaging/icons/reqora.icns' : platform === 'win32' ? 'packaging/icons/reqora.ico' : 'assets/logo-full.png',
    ...(platform === 'darwin' ? { osxSign: process.env.REQORA_MAC_SIGN_IDENTITY
      ? { identity: process.env.REQORA_MAC_SIGN_IDENTITY }
      : { identity: '-', identityValidation: false, optionsForFile: () => ({ timestamp: 'none' }) } } : {}),
  });
  desktop = platform === 'darwin' ? join(paths[0], 'Reqora.app') : paths[0];
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
let web;
if (mode !== 'desktop') {
  web = join(work, 'web');
  await mkdir(join(web, 'runtime'), { recursive: true });
  await copyApp(join(web, 'app'));
  for (const file of ['serve.mjs', 'cli.mjs']) await cp(`packaging/web/${file}`, join(web, file));
  const version = process.versions.node;
  const nodePlatform = platform === 'win32' ? 'win' : platform;
  const name = `node-v${version}-${nodePlatform}-${arch}`;
  const archiveName = `${name}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
  const base = `https://nodejs.org/dist/v${version}`;
  const sums = (await download(`${base}/SHASUMS256.txt`)).toString();
  const expected = sums.split('\n').find(line => line.trim().endsWith(` ${archiveName}`))?.split(/\s+/)[0];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Node distribution checksum not found.');
  const cache = resolve('.cache/packaging');
  await mkdir(cache, { recursive: true });
  const archive = join(cache, archiveName);
  let bytes;
  try { bytes = await readFile(archive); } catch { /* Download below. */ }
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== expected) {
    bytes = await download(`${base}/${archiveName}`);
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Node distribution checksum mismatch.');
    await writeFile(archive, bytes);
  }
  const unpacked = join(work, 'node');
  await mkdir(unpacked, { recursive: true });
  await run('tar', ['-xf', archive, '-C', unpacked]);
  await cp(join(unpacked, name, platform === 'win32' ? 'node.exe' : 'bin/node'), join(web, 'runtime', platform === 'win32' ? 'node.exe' : 'node'));
  await cp(join(unpacked, name, 'LICENSE'), join(web, 'runtime/LICENSE'));
  if (platform !== 'win32') await chmod(join(web, 'runtime/node'), 0o755);
}
const modes = mode === 'all' ? ['desktop', 'web', 'both'] : [mode];
for (const selected of modes) {
  const name = `reqora-${pkg.version}-${platform}-${arch}-${selected}`;
  const bundle = join(work, name);
  await mkdir(bundle);
  await cp('LICENSE', join(bundle, 'LICENSE'));
  await writeFile(join(bundle, 'NOTICE.txt'), notices);
  if (selected !== 'web') await cp(desktop, join(bundle, 'desktop', ...(platform === 'darwin' ? ['Reqora.app'] : [])), { recursive: true, dereference: false, verbatimSymlinks: true });
  if (selected !== 'desktop') await cp(web, join(bundle, 'web'), { recursive: true });
  if (platform === 'win32') {
    const executable = join(release, `${name}-setup.exe`);
    const defaultCompiler = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'NSIS', 'makensis.exe');
    let compiler = process.env.MAKENSIS;
    if (!compiler) { try { await stat(defaultCompiler); compiler = defaultCompiler; } catch { compiler = 'makensis'; } }
    await run(compiler, [`/DVERSION=${pkg.version}`, `/DMODE=${selected}`, `/DPAYLOAD=${bundle}`, `/DOUTPUT=${executable}`, `/DICON=${resolve('packaging/icons/reqora.ico')}`, resolve('packaging/windows/installer.nsi')]);
  } else {
    for (const file of ['install.sh', 'uninstall.sh']) {
      await cp(`packaging/unix/${file}`, join(bundle, file));
      await chmod(join(bundle, file), 0o755);
    }
    await cp('packaging/INSTALL.txt', join(bundle, 'INSTALL.txt'));
    await writeFile(join(bundle, 'platform'), `${platform}-${arch}\n`);
    await writeFile(join(bundle, 'mode'), `${selected}\n`);
    await run('tar', ['-czf', join(release, `${name}.tar.gz`), '-C', dirname(bundle), name]);
  }
  console.log(`Packaged ${name}`);
}
const artifacts = (await readdir(release)).filter(name => name.startsWith(`reqora-${pkg.version}-${platform}-${arch}-`) && /(?:\.exe|\.tar\.gz)$/.test(name)).sort();
await writeFile(join(release, `SHA256SUMS-${platform}-${arch}.txt`), (await Promise.all(artifacts.map(async name => `${createHash('sha256').update(await readFile(join(release, name))).digest('hex')}  ${name}\n`))).join(''));
console.log(`Installers and checksums: ${release}`);
