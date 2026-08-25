#!/usr/bin/env node
/**
 * EAS build hook (eas-build-post-install).
 *
 * llama.rn downloads its native libraries from GitHub at install time
 * (about 100 MB). On a poor connection that download never completes and
 * the build dies before compiling anything. When the host already holds a
 * verified copy, this hook installs it instead.
 *
 * Inactive unless RNLLAMA_ARTIFACTS_DIR is set on the build command, to a
 * llama.rn package dir holding the artifacts (typically the host's
 * node_modules/llama.rn). Pair it with RNLLAMA_SKIP_POSTINSTALL=1 so that
 * llama.rn skips its own download during npm ci.
 *
 * The host copy is accepted only if its marker file carries the archive
 * SHA-256 that llama.rn's own manifest expects, the same rule llama.rn
 * applies before reusing an installed copy.
 */
const fs = require('fs');
const path = require('path');

const sourceRoot = process.env.RNLLAMA_ARTIFACTS_DIR;
if (!sourceRoot) process.exit(0);

const targetRoot = path.dirname(require.resolve('llama.rn/package.json'));
if (path.resolve(sourceRoot) === path.resolve(targetRoot)) {
  console.log('eas-post-install: llama.rn artifacts already in place, nothing to copy');
  process.exit(0);
}
const manifest = require(path.join(targetRoot, 'install', 'native-artifacts.json'));
const platform = process.env.EAS_BUILD_PLATFORM || '';
const wanted = manifest.artifacts.filter(artifact =>
  (platform === 'android' && artifact.name.startsWith('android'))
  || (platform === 'ios' && artifact.name.startsWith('ios'))
  || platform === '');

for (const artifact of wanted) {
  const source = path.join(sourceRoot, artifact.relativePath);
  const marker = path.join(sourceRoot, artifact.markerPath);
  if (!fs.existsSync(source) || !fs.existsSync(marker)) {
    console.error(`eas-post-install: ${artifact.name} is not present in ${sourceRoot}`);
    process.exit(1);
  }
  const recorded = fs.readFileSync(marker, 'utf8').trim();
  if (recorded !== artifact.sha256) {
    console.error(`eas-post-install: ${artifact.name} in ${sourceRoot} is ${recorded}, manifest expects ${artifact.sha256}`);
    process.exit(1);
  }
  const target = path.resolve(targetRoot, artifact.relativePath);
  const markerTarget = path.resolve(targetRoot, artifact.markerPath);
  for (const inside of [target, markerTarget]) {
    if (!inside.startsWith(targetRoot + path.sep)) {
      console.error(`eas-post-install: refusing to write outside llama.rn: ${inside}`);
      process.exit(1);
    }
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
  // The marker is the SHA-256 of the archive, recorded by llama.rn when it
  // verified the download; the files under it are what that archive held.
  fs.writeFileSync(markerTarget, `${artifact.sha256}\n`);
  console.log(`eas-post-install: installed ${artifact.name} from host copy ${artifact.sha256.slice(0, 12)}`);
}
