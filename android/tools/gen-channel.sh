#!/usr/bin/env bash
# Writes app/src/channel.generated.json (gitignored): where the app looks for updates.
#   SC_FLAVOR=store (default): {} -> the public GitHub latest-release check. Nothing private is compiled in.
#   SC_FLAVOR=personal: the private update file from the repo-root config.local.json (android.slug + android.updateChannelPath).
# Run by `npm test` / `npm run typecheck` (store) and by build-apk.sh (either flavor). Never commit the generated file.
set -euo pipefail
D=$(cd "$(dirname "$0")/.." && pwd); REPO=$(cd "$D/.." && pwd); OUT=$D/app/src/channel.generated.json
case "${SC_FLAVOR:-store}" in
  store) echo '{}' > "$OUT";;
  personal)
    CFG=$REPO/config.local.json; [ -f "$CFG" ] || { echo "personal flavor needs config.local.json" >&2; exit 1; }
    jq -e '.android.slug and .android.updateChannelPath' "$CFG" >/dev/null || { echo "personal flavor needs android.slug and android.updateChannelPath" >&2; exit 1; }
    case "$(jq -r '.android.slug + .android.updateChannelPath' "$CFG")" in *YOUR*) echo "personal flavor: placeholder values in config" >&2; exit 1;; esac
    jq '{privateSlug: .android.slug, privateUpdatePath: .android.updateChannelPath}' "$CFG" > "$OUT";;
  *) echo "SC_FLAVOR must be store or personal" >&2; exit 1;;
esac
chmod 600 "$OUT"
echo "update channel: ${SC_FLAVOR:-store}" >&2
