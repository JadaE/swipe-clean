#!/usr/bin/env bash
# Writes app/src/config.generated.json (gitignored) from the repo-root config.local.json, or config.example.json if
# the local one is missing (so a clean clone still type-checks, tests and builds; it just can't publish).
# Only the values the APP needs go in (never the keystore password). Metro can only import files inside the app root,
# which is why this copy exists. Run automatically by build-apk.sh and `npm test`.
set -euo pipefail
D=$(cd "$(dirname "$0")/.." && pwd); REPO=$(cd "$D/.." && pwd)
CFG=$REPO/config.local.json; [ -f "$CFG" ] || CFG=$REPO/config.example.json
jq '{slug: .android.slug, updateChannelPath: .android.updateChannelPath}' "$CFG" > "$D/app/src/config.generated.json"
chmod 600 "$D/app/src/config.generated.json"
echo "config: $(basename "$CFG")" >&2
