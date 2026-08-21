#!/bin/sh
# Resolve monorepo root from this script's own location, regardless of CWD.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Desktop release builds use Alice's stable proxy unless a test build
# deliberately supplies another endpoint.
: "${EXPO_PUBLIC_VENICE_PROXY_URL:=https://proxy.alicebtc.com}"
: "${EXPO_PUBLIC_PRIVATE_CLOUD_ENABLED:=true}"
export EXPO_PUBLIC_VENICE_PROXY_URL EXPO_PUBLIC_PRIVATE_CLOUD_ENABLED

# Learn packs: English and French ship inside the app, the 27 other languages
# and all the cover art are served from the packs repository (Plan B Network
# corpus, CC BY-SA 4.0). The pinned tag lives in one place only, so both halves
# always come from the same generation of the corpus; app-web's `prebuild`
# downloads the embedded pair from that same tag when it is missing.
: "${NEXT_PUBLIC_LEARN_PACKS_BASE:=$(node "$SCRIPT_DIR/../../scripts/prepare-learn-packs.mjs" --print-base)}"
export NEXT_PUBLIC_LEARN_PACKS_BASE

cd "$SCRIPT_DIR/../.." && npm run build -w @alice-wallet/app-web

# The maintainer's dev public/learn holds every language; the desktop build
# only ever reads the embedded ones locally (the rest, and the cover art, come
# from the pinned remote base above). Prune the export down to what the app
# can actually reach, or the bundle silently carries 400 MB of dead packs.
node -e '
  const fs = require("fs");
  const learn = process.argv[1];
  const catalog = fs.readFileSync("packages/alice-content/src/generated/planb-learn-catalog.ts", "utf8");
  const embed = JSON.parse(catalog.match(/LEARN_EMBED_LANGS = (\[[^\]]*\])/)[1]);
  for (const entry of fs.readdirSync(learn, { withFileTypes: true })) {
    if (entry.isDirectory() && !embed.includes(entry.name)) {
      fs.rmSync(`${learn}/${entry.name}`, { recursive: true });
    }
  }
  console.log(`Learn embarqué: ${embed.join(", ")} (le reste vient de la base distante)`);
' "$SCRIPT_DIR/../app-web/out/learn"

# The desktop app carries the semantic search stack (embedding model + ONNX
# runtime, ~164 MB) inside the bundle, so an installed build reaches neither
# Hugging Face nor jsDelivr for it: the webview finds /semantic-model/ on its
# own origin. Web deploys skip this on purpose and keep fetching from the hub.
node "$SCRIPT_DIR/../../scripts/prepare-semantic-model.mjs" "$SCRIPT_DIR/../app-web/out/semantic-model"
