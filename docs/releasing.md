# Releasing Reqora

## Branches

`main` is the release branch. A push to `main` validates the source and, for an unpublished package version, builds every native installer and publishes the matching GitHub Release. No manual tag push is needed. Tags identify the exact tested commit, not whichever commit happens to be at the tip of `main` when packaging finishes.

Use `develop` for ongoing changes after the first release. Pushes to `develop` and pull requests targeting `develop` or `main` run CI without publishing. During first publication, the workflow creates `develop` at the tested release commit if the branch does not already exist. It never resets an existing `develop` branch. After release, fetch and switch to it, then merge reviewed changes back into `main` when preparing another release.

## First release

The prepared version is `0.1.0-beta.1`. Commit these release files and push that commit to `main`. The **Release from main** workflow will:

1. Check package/lock versions and version-specific release notes, and inspect existing GitHub tags/releases.
2. Check runtime dependencies for high/critical audit findings, then type-check, test, and build the source.
3. Build desktop, web, and combined installers on native Linux, Windows, and macOS x64/ARM64 runners.
4. Test on each target, install every package, exercise bundled desktop CLI/web engine behavior, and uninstall.
5. Collect and verify all 18 installers and six checksum files. Missing artifacts or hash mismatches prevent publication.
6. Create `v0.1.0-beta.1` on the tested commit, create a draft prerelease, upload the verified files plus combined checksums/manifest, seed `develop` if missing, and publish only after every upload is complete.

The tag and public release are intentionally created by the workflow **after the next commit is pushed**, rather than in advance against the current checkout.

After a successful publication, the **Publish Reqora download page** workflow deploys `website/index.html` to [Reqora's GitHub Pages site](https://ajthr.github.io/reqora/). The page links directly to the release's platform, architecture, and installation-mode assets. GitHub Pages must be enabled with the Actions source for its first deployment.

The workflow uses the repository's built-in `GITHUB_TOKEN`. Only its final publish job has `contents: write`. No personal access token or signing secret is required for the unsigned beta. Repository/organization policies and tag rules must allow that token to create tags and releases. The repository must allow the official checkout/setup-node/artifact actions and GitHub-hosted runners.

## Future releases

1. Update the version with `npm version 0.1.0-beta.2 --no-git-tag-version` (choose the next appropriate version).
2. Add `docs/releases/vVERSION.md` and update `CHANGELOG.md`.
3. Run `npm run release:check`, `npm run typecheck`, `npm test`, and `npm run build`.
4. Merge the release commit into `main`. The workflow handles tagging and publication.

Published versions are not overwritten. Pushing more commits with an already-published version runs source checks and skips the native release. Bump the version to publish changed binaries. For a non-prerelease semantic version, the workflow publishes a normal release instead of a GitHub prerelease. Review signing and compatibility requirements before changing from beta to a general release.

## Manual builds and retries

Run **Release from main → Run workflow**, select `main`, and leave **publish** off to build diagnostic artifacts without tagging or publishing. Pick one mode or all modes. Manual publishing requires `main`, all modes, and an unpublished version.

If a platform build or checksum check fails, no new tag/release is created. Fix the cause and rerun. If publication fails after tagging/upload begins, the release remains a draft. Rerunning the same commit replaces its draft assets and resumes publication. An existing tag belonging to a different commit is never moved: inspect the draft/tag and use a new version for changed source. Rerunning the original successful commit after publication does nothing to its published release.

CI artifacts expire after 30 days; public release assets remain attached to the GitHub Release. Download diagnostics from the run, and public installers from [Releases](https://github.com/ajthr/reqora/releases).

## Signing and native testing

This beta does not include Windows Authenticode signing or macOS notarization. Its release notes state the resulting limitations. `REQORA_MAC_SIGN_IDENTITY` remains supported for local builds with an installed identity, but the hosted workflow does not import signing certificates. Add a separate signing/notarization setup before advertising signed production releases, and generate checksums after signing.

Package smoke tests run without opening desktop windows. They verify the installed desktop Electron runtime in Node mode and its CLI, plus installed web assets, engine, authentication, cookies, scripting, CLI, and uninstallation. They do not prove interactive window behavior, Gatekeeper/SmartScreen behavior, or every Linux distribution. Keep manual acceptance testing as a release responsibility.
