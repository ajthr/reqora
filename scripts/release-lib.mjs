import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';

export const releaseTargets = [
  { os: 'ubuntu-24.04', platform: 'linux', arch: 'x64' },
  { os: 'ubuntu-24.04-arm', platform: 'linux', arch: 'arm64' },
  { os: 'windows-2022', platform: 'win32', arch: 'x64' },
  { os: 'windows-11-arm', platform: 'win32', arch: 'arm64' },
  { os: 'macos-15-intel', platform: 'darwin', arch: 'x64' },
  { os: 'macos-15', platform: 'darwin', arch: 'arm64' },
];
export const releaseModes = ['desktop', 'web', 'both'];

export function parseVersion(version) {
  const number = '(0|[1-9][0-9]*)';
  const match = new RegExp(`^${number}\\.${number}\\.${number}(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$`).exec(version);
  if (!match || match[4]?.split('.').some(part => /^0\d+$/.test(part))) throw Error('Use a semantic version such as 0.1.0-beta.1 (without build metadata).');
  return { version, tag: `v${version}`, core: `${match[1]}.${match[2]}.${match[3]}`, prerelease: !!match[4] };
}

export async function releaseMetadata(root = process.cwd()) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const metadata = parseVersion(pkg.version);
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) throw Error('package.json and package-lock.json versions must match.');
  const notesPath = `docs/releases/${metadata.tag}.md`;
  const notes = await readFile(join(root, notesPath), 'utf8');
  if (!notes.includes(metadata.tag) || notes.trim().length < 100) throw Error(`Complete release notes in ${notesPath}.`);
  return { ...metadata, notesPath, notes };
}

export function planRelease({ ref, event, publish = false, mode = 'all', sha, release, tagSha }) {
  if (ref !== 'refs/heads/main') throw Error('Release builds must run from main. Develop and pull requests never publish.');
  if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('A full tested commit SHA is required.');
  if (!['push', 'workflow_dispatch'].includes(event)) throw Error('Unsupported release event.');
  if (!['all', ...releaseModes].includes(mode)) throw Error('Invalid package mode.');
  const publishing = event === 'push' || publish;
  if (publishing && mode !== 'all') throw Error('Publishing requires all installation modes and all six targets.');
  if (release && !release.draft) return { build: !publishing, publish: false, reason: 'This version is already published. Bump the version and add its release notes for a new release.' };
  if (publishing && tagSha && tagSha !== sha) throw Error('The version tag belongs to another commit. Do not move it; bump the version instead.');
  if (publishing && release?.draft && !tagSha) throw Error('A draft release without its version tag requires manual inspection.');
  return { build: true, publish: publishing, reason: publishing ? 'Build and publish the tested main commit.' : 'Manual build only; no tags or releases will be created.' };
}

export function expectedAssets(version, targets = releaseTargets, modes = releaseModes) {
  parseVersion(version);
  return targets.flatMap(({ platform, arch }) => [
    ...modes.map(mode => `reqora-${version}-${platform}-${arch}-${mode}${platform === 'win32' ? '-setup.exe' : '.tar.gz'}`),
    `SHA256SUMS-${platform}-${arch}.txt`,
  ]);
}

export async function verifyReleaseAssets(directory, version, { targets = releaseTargets, modes = releaseModes } = {}) {
  const expected = expectedAssets(version, targets, modes), files = (await readdir(directory)).sort();
  const unexpected = files.filter(name => !expected.includes(name) && !['SHA256SUMS.txt', 'release-manifest.json'].includes(name));
  const missing = expected.filter(name => !files.includes(name));
  if (missing.length || unexpected.length) throw Error(`Release assets do not match the matrix. Missing: ${missing.join(', ') || 'none'}. Unexpected: ${unexpected.join(', ') || 'none'}.`);
  const result = [];
  for (const target of targets) {
    const sumName = `SHA256SUMS-${target.platform}-${target.arch}.txt`;
    const allowed = modes.map(mode => `reqora-${version}-${target.platform}-${target.arch}-${mode}${target.platform === 'win32' ? '-setup.exe' : '.tar.gz'}`);
    const entries = (await readFile(join(directory, sumName), 'utf8')).trim().split(/\r?\n/);
    const checked = new Set();
    for (const entry of entries) {
      const match = /^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(entry);
      if (!match || !allowed.includes(match[2]) || checked.has(match[2])) throw Error(`Invalid checksum entry in ${sumName}.`);
      const stat = await lstat(join(directory, match[2]));
      if (!stat.isFile() || !stat.size) throw Error(`Release asset must be a non-empty regular file: ${match[2]}`);
      const digest = createHash('sha256').update(await readFile(join(directory, match[2]))).digest('hex');
      if (digest !== match[1]) throw Error(`Checksum mismatch: ${match[2]}`);
      checked.add(match[2]); result.push({ name: match[2], sha256: digest, bytes: stat.size, platform: target.platform, arch: target.arch, mode: modes[allowed.indexOf(match[2])] });
    }
    if (checked.size !== allowed.length) throw Error(`Incomplete checksums in ${sumName}.`);
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export async function writeReleaseManifest(directory, metadata, sha, repository, runId) {
  const assets = await verifyReleaseAssets(directory, metadata.version);
  await writeFile(join(directory, 'SHA256SUMS.txt'), assets.map(asset => `${asset.sha256}  ${asset.name}\n`).join(''));
  await writeFile(join(directory, 'release-manifest.json'), JSON.stringify({ version: metadata.version, tag: metadata.tag, commit: sha, repository, run: `https://github.com/${repository}/actions/runs/${runId}`, signing: 'Unsigned beta; macOS ad-hoc signed unless a Developer ID identity was supplied.', assets }, null, 2) + '\n');
  return [...expectedAssets(metadata.version), 'SHA256SUMS.txt', 'release-manifest.json'];
}
