import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { releaseMetadata, releaseTargets, planRelease, writeReleaseManifest } from './release-lib.mjs';
import { githubClient, publishRelease } from './github-release.mjs';

const command = process.argv[2];
if (!['check', 'plan', 'publish', 'verify'].includes(command)) throw Error('Usage: node scripts/release.mjs check|plan|publish|verify [asset-directory]');
const metadata = await releaseMetadata();
if (command === 'check') {
  console.log(`${metadata.tag}: package/lock versions and release notes match.`);
} else {
  const directory = resolve(process.argv[3] || 'release-assets');
  if (command === 'verify') {
    const names = await writeReleaseManifest(directory, metadata, process.env.GITHUB_SHA || 'local-build', process.env.GITHUB_REPOSITORY || 'ajthr/reqora', process.env.GITHUB_RUN_ID || 'local');
    console.log(`Verified ${names.length} assets for ${metadata.tag}.`);
  } else {
    const client = githubClient({ token: process.env.GH_TOKEN, repository: process.env.GITHUB_REPOSITORY });
    const release = await client.release(metadata.tag), tagSha = await client.tagCommit(metadata.tag);
    const plan = planRelease({ ref: process.env.GITHUB_REF, event: process.env.GITHUB_EVENT_NAME, publish: process.env.RELEASE_PUBLISH === 'true', mode: process.env.RELEASE_MODE || 'all', sha: process.env.GITHUB_SHA, release, tagSha });
    if (command === 'plan') {
      const outputs = { version: metadata.version, tag: metadata.tag, prerelease: String(metadata.prerelease), build: String(plan.build), publish: String(plan.publish), mode: process.env.RELEASE_MODE || 'all', matrix: JSON.stringify({ include: releaseTargets }) };
      if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
      console.log(`${metadata.tag}: ${plan.reason}`);
    } else {
      if (!plan.publish) { console.log(plan.reason); process.exit(0); }
      const names = await writeReleaseManifest(directory, metadata, process.env.GITHUB_SHA, process.env.GITHUB_REPOSITORY, process.env.GITHUB_RUN_ID);
      const result = await publishRelease({ client, metadata, sha: process.env.GITHUB_SHA, directory, names });
      console.log(`${result.skipped ? 'Already published' : 'Published'}: ${result.url}`);
      if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Reqora ${metadata.tag}\n\n${result.url}\n\n${names.length} verified release assets from \`${process.env.GITHUB_SHA}\`.\n`);
    }
  }
}
