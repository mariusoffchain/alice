const { execSync, spawnSync } = require('child_process');
const path = require('path');

const appDir = path.join(__dirname, '..');

function resolveCommitSha() {
  const explicitCommit =
    process.env.EXPO_PUBLIC_APP_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA;

  if (explicitCommit) return explicitCommit.trim().slice(0, 7);

  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: appDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

const env = {
  ...process.env,
  EXPO_PUBLIC_APP_COMMIT_SHA: resolveCommitSha(),
};

const exportResult = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['expo', 'export', '--platform', 'web', '--clear'],
  {
    cwd: appDir,
    stdio: 'inherit',
    env,
  }
);

if (exportResult.status !== 0) {
  process.exit(exportResult.status ?? 1);
}

const injectResult = spawnSync(
  process.execPath,
  [path.join(__dirname, 'inject-pwa.js')],
  {
    cwd: appDir,
    stdio: 'inherit',
    env,
  }
);

process.exit(injectResult.status ?? 0);
