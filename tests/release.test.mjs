import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { expectedAssets, parseVersion, planRelease, releaseMetadata, releaseTargets, verifyReleaseAssets, writeReleaseManifest } from '../scripts/release-lib.mjs';
import { githubClient, publishRelease } from '../scripts/github-release.mjs';

const sha = 'a'.repeat(40), other = 'b'.repeat(40), version = '0.1.0-beta.1';
const request = { ref: 'refs/heads/main', event: 'push', mode: 'all', sha };

test('release version, lockfile, notes and native matrix are consistent', async () => {
  assert.deepEqual(parseVersion(version), { version, tag: `v${version}`, core: '0.1.0', prerelease: true });
  assert.equal(parseVersion('1.0.0').prerelease, false);
  for (const invalid of ['01.0.0', '1.0', 'v1.0.0', '1.0.0-beta.01', '1.0.0-', '1.0.0+build']) assert.throws(() => parseVersion(invalid));
  const metadata = await releaseMetadata(); assert.equal(metadata.tag, `v${metadata.version}`);
  assert.equal(releaseTargets.length, 6); assert.equal(expectedAssets(version).length, 24);
  assert.equal(new Set(expectedAssets(version)).size, 24);
});

test('only main can release, published versions are skipped and tags are never moved', () => {
  assert.equal(planRelease(request).publish, true);
  assert.throws(() => planRelease({ ...request, ref: 'refs/heads/develop' }), /main/);
  assert.throws(() => planRelease({ ...request, ref: 'refs/pull/1/merge', event: 'pull_request' }), /main/);
  assert.throws(() => planRelease({ ...request, mode: 'desktop' }), /all installation modes/);
  assert.throws(() => planRelease({ ...request, tagSha: other }), /another commit/);
  assert.throws(() => planRelease({ ...request, release: { draft: true } }), /without its version tag/);
  assert.equal(planRelease({ ...request, tagSha: sha, release: { draft: true } }).publish, true);
  const published = planRelease({ ...request, tagSha: other, release: { draft: false } });
  assert.equal(published.publish, false); assert.equal(published.build, false);
  const diagnostic = planRelease({ ...request, event: 'workflow_dispatch', mode: 'web', publish: false, tagSha: other, release: { draft: false } });
  assert.equal(diagnostic.build, true); assert.equal(diagnostic.publish, false);
});

async function assetsFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'reqora-release-'));
  for (const target of releaseTargets) {
    const sums = [];
    for (const name of expectedAssets(version, [target]).filter(name => !name.startsWith('SHA256SUMS'))) {
      const bytes = Buffer.from(`test fixture for ${name}`);
      await writeFile(join(directory, name), bytes);
      sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`);
    }
    await writeFile(join(directory, `SHA256SUMS-${target.platform}-${target.arch}.txt`), sums.join(''));
  }
  return directory;
}

test('all 18 installers must exist and match checksums before manifest generation', async () => {
  const directory = await assetsFixture();
  try {
    const verified = await verifyReleaseAssets(directory, version); assert.equal(verified.length, 18);
    const names = await writeReleaseManifest(directory, parseVersion(version), sha, 'ajthr/reqora', '123');
    assert.equal(names.length, 26);
    assert.equal(JSON.parse(await readFile(join(directory, 'release-manifest.json'), 'utf8')).commit, sha);
    assert.equal((await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n').length, 18);
    await writeFile(join(directory, verified[0].name), 'tampered');
    await assert.rejects(verifyReleaseAssets(directory, version), /Checksum mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('missing, unexpected, unsafe and duplicate checksum entries prevent publication', async () => {
  const directory = await assetsFixture();
  try {
    const name = expectedAssets(version)[0];
    await rm(join(directory, name));
    await assert.rejects(verifyReleaseAssets(directory, version), /Missing/);
    await writeFile(join(directory, name), 'restored');
    await writeFile(join(directory, 'unexpected.exe'), 'extra');
    await assert.rejects(verifyReleaseAssets(directory, version), /Unexpected/);
    await rm(join(directory, 'unexpected.exe'));
    await writeFile(join(directory, 'SHA256SUMS-linux-x64.txt'), `${'a'.repeat(64)}  ../secret\n`);
    await assert.rejects(verifyReleaseAssets(directory, version), /Invalid checksum/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function fakePublisher({ published = false, tagSha, failUpload = false, develop = false } = {}) {
  const calls = [], assets = [];
  return { calls, client: {
    tagCommit: async () => tagSha,
    release: async () => published ? { id: 1, draft: false, html_url: 'https://example.test/release' } : undefined,
    request: async (path, options = {}) => {
      calls.push({ path, ...options });
      if (path === '/git/ref/heads/develop') return develop ? { object: { sha: other } } : undefined;
      if (path.startsWith('/releases/1/assets')) return assets;
      if (path === '/releases' || path === '/releases/1') return { id: 1, draft: options.body.draft, html_url: 'https://example.test/release', upload_url: 'https://uploads.github.com/test' };
      return {};
    },
    upload: async (_release, name) => {
      calls.push({ upload: name });
      if (failUpload) throw Error('Upload failed');
      assets.push({ name, state: 'uploaded' });
    },
  } };
}

test('release is drafted before uploads and only published after every asset is present', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reqora-publish-'));
  try {
    await writeFile(join(directory, 'asset.exe'), 'fixture');
    const metadata = { ...parseVersion(version), notes: '# Release notes' }, fake = fakePublisher();
    await publishRelease({ client: fake.client, metadata, sha, directory, names: ['asset.exe'] });
    assert.equal(fake.calls[0].path, '/git/refs');
    assert.equal(fake.calls[0].body.sha, sha);
    assert(fake.calls.some(call => call.body?.draft === true));
    assert.equal(fake.calls.at(-1).body.draft, false);
    assert.equal(fake.calls.at(-1).body.prerelease, true);
    assert.equal(fake.calls.at(-1).body.make_latest, 'false');
    assert(fake.calls.some(call => call.body?.ref === 'refs/heads/develop' && call.body.sha === sha));
    const existingDevelop = fakePublisher({ develop: true });
    await publishRelease({ client: existingDevelop.client, metadata, sha, directory, names: ['asset.exe'] });
    assert(!existingDevelop.calls.some(call => call.body?.ref === 'refs/heads/develop'));
    const failed = fakePublisher({ failUpload: true });
    await assert.rejects(publishRelease({ client: failed.client, metadata, sha, directory, names: ['asset.exe'] }), /Upload failed/);
    assert(!failed.calls.some(call => call.body?.draft === false));
    const released = fakePublisher({ published: true, tagSha: sha });
    assert((await publishRelease({ client: released.client, metadata, sha, directory, names: [] })).skipped);
    assert.equal(released.calls.length, 0);
    await assert.rejects(publishRelease({ client: fakePublisher({ tagSha: other }).client, metadata, sha, directory, names: [] }), /Refusing to move/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('GitHub API distinguishes missing releases from permission failures and rejects unsafe upload hosts', async () => {
  const missing = githubClient({ token: 'test', repository: 'owner/repo', fetcher: async () => new Response('', { status: 404 }) });
  assert.equal(await missing.release('v1.0.0'), undefined);
  const denied = githubClient({ token: 'test', repository: 'owner/repo', fetcher: async () => new Response('', { status: 403 }) });
  await assert.rejects(denied.release('v1.0.0'), /permissions/);
  await assert.rejects(missing.upload({ upload_url: 'https://untrusted.test/upload' }, 'file', Buffer.from('test')), /upload host/);
  const badDigest = githubClient({ token: 'test', repository: 'owner/repo', fetcher: async () => Response.json({ name: 'asset', size: 4, digest: 'sha256:wrong' }) });
  await assert.rejects(badDigest.upload({ upload_url: 'https://uploads.github.com/asset' }, 'asset', Buffer.from('test')), /verification/);
});

test('workflow release permissions and branch triggers stay scoped to main', async () => {
  const workflow = await readFile('.github/workflows/installers.yml', 'utf8');
  assert.match(workflow, /branches: \[main\]/); assert(!workflow.includes("tags: ['v*']"));
  assert.equal((workflow.match(/contents: write/g) || []).length, 1);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /needs: \[plan, checks, package\]/);
  assert.match(workflow, /node scripts\/release.mjs publish release-assets/);
  const ci = await readFile('.github/workflows/ci.yml', 'utf8');
  assert.match(ci, /branches: \[develop\]/); assert(!ci.includes('contents: write'));
});
