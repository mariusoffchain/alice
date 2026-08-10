#!/bin/sh
# Resolve monorepo root from this script's own location, regardless of CWD.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Desktop release builds use Alice's stable proxy unless a test build
# deliberately supplies another endpoint.
: "${EXPO_PUBLIC_VENICE_PROXY_URL:=https://proxy.alicebtc.com}"
: "${EXPO_PUBLIC_PRIVATE_CLOUD_ENABLED:=true}"
export EXPO_PUBLIC_VENICE_PROXY_URL EXPO_PUBLIC_PRIVATE_CLOUD_ENABLED

cd "$SCRIPT_DIR/../.." && npm run build -w @alice-wallet/app-web
