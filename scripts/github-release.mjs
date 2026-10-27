import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export function githubClient({ token, repository, fetcher = fetch }) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw Error('GitHub token and owner/repository are required.');
  const prefix = `https://api.github.com/repos/${repository}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const request = async (path, { method = 'GET', body, optional = false } = {}) => {
    const response = await fetcher(prefix + path, { method, headers: { ...headers, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) });
    if (optional && response.status === 404) return undefined;
    if (!response.ok) throw Error(`GitHub ${method} ${path} failed (${response.status}). Check repository Actions permissions, tag rules, and service availability.`);
    return response.status === 204 ? undefined : response.json();
  };
  return {
    request,
    release: tag => request(`/releases/tags/${encodeURIComponent(tag)}`, { optional: true }),
    tagCommit: async tag => {
      const ref = await request(`/git/ref/tags/${encodeURIComponent(tag)}`, { optional: true });
      if (!ref) return undefined;
      let object = ref.object;
      for (let depth = 0; object.type === 'tag' && depth < 5; depth++) object = (await request(`/git/tags/${object.sha}`)).object;
      if (object.type !== 'commit') throw Error('Version tag must resolve to a commit.');
      return object.sha;
    },
    upload: async (release, name, bytes) => {
      const url = new URL(release.upload_url.split('{')[0]);
      if (url.protocol !== 'https:' || url.hostname !== 'uploads.github.com') throw Error('Unexpected release upload host.');
      url.searchParams.set('name', name);
      const response = await fetcher(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: bytes, signal: AbortSignal.timeout(300_000) });
      if (!response.ok) throw Error(`Uploading ${name} failed (${response.status}); rerun the workflow to resume its draft.`);
      const uploaded = await response.json();
      if (uploaded.name !== name || uploaded.size !== bytes.length || uploaded.digest && uploaded.digest !== `sha256:${createHash('sha256').update(bytes).digest('hex')}`) throw Error(`Uploaded asset verification failed: ${name}. The release remains a draft.`);
      return uploaded;
    },
  };
}

export async function publishRelease({ client, metadata, sha, directory, names }) {
  const currentTag = await client.tagCommit(metadata.tag);
  if (currentTag && currentTag !== sha) throw Error('Refusing to move an existing tag to another commit.');
  let release = await client.release(metadata.tag);
  if (release && !release.draft) return { skipped: true, url: release.html_url };
  if (!currentTag) await client.request('/git/refs', { method: 'POST', body: { ref: `refs/tags/${metadata.tag}`, sha } });
  const body = `${metadata.notes.trim()}\n\n---\nBuilt from commit \`${sha}\`. Verify downloads with \`SHA256SUMS.txt\`; platform-specific checksums and a build manifest are attached.\n`;
  const properties = { tag_name: metadata.tag, target_commitish: sha, name: `Reqora ${metadata.tag}`, body, draft: true, prerelease: metadata.prerelease };
  release = release
    ? await client.request(`/releases/${release.id}`, { method: 'PATCH', body: properties })
    : await client.request('/releases', { method: 'POST', body: properties });
  // Only drafts are replaceable. A published version is immutable to this workflow.
  const previousAssets = [];
  for (let page = 1; ; page++) {
    const assets = await client.request(`/releases/${release.id}/assets?per_page=100&page=${page}`);
    previousAssets.push(...assets);
    if (assets.length < 100) break;
  }
  for (const asset of previousAssets) await client.request(`/releases/assets/${asset.id}`, { method: 'DELETE' });
  for (const name of names) await client.upload(release, name, await readFile(join(directory, name)));
  const assets = await client.request(`/releases/${release.id}/assets?per_page=100`);
  if (assets.length !== names.length || names.some(name => !assets.some(asset => asset.name === name && asset.state === 'uploaded'))) throw Error('Release assets are incomplete. The release remains a draft.');
  const develop = await client.request('/git/ref/heads/develop', { optional: true });
  if (!develop) await client.request('/git/refs', { method: 'POST', body: { ref: 'refs/heads/develop', sha } });
  const published = await client.request(`/releases/${release.id}`, { method: 'PATCH', body: { draft: false, prerelease: metadata.prerelease, make_latest: metadata.prerelease ? 'false' : 'true' } });
  return { skipped: false, url: published.html_url };
}
