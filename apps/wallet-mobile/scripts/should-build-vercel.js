const { spawnSync } = require('child_process');

const previous = process.env.VERCEL_GIT_PREVIOUS_SHA;
const current = process.env.VERCEL_GIT_COMMIT_SHA;

// A missing baseline is intentionally built. This covers first deployments,
// manually triggered builds, and any Git provider that omits Vercel's metadata.
if (!previous || !current) process.exit(1);

const repository = spawnSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
});

if (repository.status !== 0) process.exit(1);

const relevantPaths = [
  'apps/wallet-mobile/',
  'packages/',
  'package.json',
  'package-lock.json',
];

const changed = spawnSync(
  'git',
  ['diff', '--quiet', previous, current, '--', ...relevantPaths],
  { cwd: repository.stdout.trim() },
);

// git diff --quiet returns 1 when relevant files changed. Any other failure
// should build rather than risk silently keeping an outdated wallet online.
process.exit(changed.status === 0 ? 0 : 1);
