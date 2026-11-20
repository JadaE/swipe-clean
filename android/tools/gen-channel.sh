#!/usr/bin/env bash
# Selects the flavor's update-channel module and writes it to app/src/channel.ts (gitignored).
#   SC_FLAVOR=store (default): copies channel.store.ts (public GitHub latest-release check only).
#     channel.generated.json is {}. The personal module is not referenced.
#   SC_FLAVOR=personal: copies channel.personal.ts and writes channel.generated.json from the
#     repo-root config.local.json (android.slug + android.updateChannelPath).
# Run by `npm test` / `npm run typecheck` (store) and by build-apk.sh (either flavor).
# Never commit channel.ts or channel.generated.json.
set -euo pipefail
D=$(cd "$(dirname "$0")/.." && pwd); REPO=$(cd "$D/.." && pwd)
SRC=$D/app/src
OUT=$SRC/channel.generated.json
CHANNEL=$SRC/channel.ts
case "${SC_FLAVOR:-store}" in
  store)
    echo '{}' > "$OUT"
    cp "$SRC/channel.store.ts" "$CHANNEL"
    ;;
  personal)
    CFG=$REPO/config.local.json; [ -f "$CFG" ] || { echo "personal flavor needs config.local.json" >&2; exit 1; }
    jq -e '.android.slug and .android.updateChannelPath' "$CFG" >/dev/null || { echo "personal flavor needs android.slug and android.updateChannelPath" >&2; exit 1; }
    case "$(jq -r '.android.slug + .android.updateChannelPath' "$CFG")" in *YOUR*) echo "personal flavor: placeholder values in config" >&2; exit 1;; esac
    jq '{privateSlug: .android.slug, privateUpdatePath: .android.updateChannelPath}' "$CFG" > "$OUT"
    cp "$SRC/channel.personal.ts" "$CHANNEL"
    ;;
  *) echo "SC_FLAVOR must be store or personal" >&2; exit 1;;
esac
chmod 600 "$OUT" "$CHANNEL"
echo "update channel: ${SC_FLAVOR:-store}" >&2
