#!/bin/sh
# Resolve monorepo root from this script's own location, regardless of CWD.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../.." && npm run build -w @alice-wallet/app-web
