#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIST="$(mktemp)"
REGULAR_LIST="$(mktemp)"
trap 'rm -f "$LIST" "$REGULAR_LIST"' EXIT

cd "$ROOT"
node scripts/check-release-version.mjs
{
  find packages -type f -name '*.test.ts' -print0
  find apps/venice-proxy-worker/src -type f -name '*.test.ts' -print0
  find apps/app-web/src -type f -name '*.test.ts' -print0
  find apps/wallet-mobile -maxdepth 1 -type f -name '*.test.ts' -print0
} > "$LIST"

COUNT="$(tr -cd '\0' < "$LIST" | wc -c | tr -d ' ')"
if [[ "$COUNT" == "0" ]]; then
  echo "No test files found. Refusing to report a successful empty run." >&2
  exit 1
fi

echo "Running $COUNT test files in batches of 10."

# The Worker suites each start an isolated Miniflare/D1 runtime. Running them
# concurrently makes the Node 24 test runner stall, so keep those files
# sequential and batch the pure client tests separately.
while IFS= read -r test_file; do
  node --test "$test_file"
done < <(find apps/venice-proxy-worker/src -type f -name '*.test.ts' | sort)

{
  find packages -type f -name '*.test.ts' -print0
  find apps/app-web/src -type f -name '*.test.ts' -print0
  find apps/wallet-mobile -maxdepth 1 -type f -name '*.test.ts' -print0
} > "$REGULAR_LIST"
xargs -0 -n 10 node --test --test-concurrency=4 < "$REGULAR_LIST"
echo "Completed $COUNT/$COUNT test files."
