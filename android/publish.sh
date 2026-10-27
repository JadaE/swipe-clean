#!/usr/bin/env bash
# Publish Swipe Clean (Android) to its here.now Site:  bash android/publish.sh      (DRY_RUN=1: run every check, publish nothing)
# Values come from the repo-root config.local.json, section "android" (SWIPECLEAN_CONFIG=<file> overrides the path).
# Flow: build-apk.sh -> tools/make_site.sh stages the new APK + version.json INTO android.publishSiteDir (the existing site folder),
# then this script uploads that WHOLE folder, so earlier APKs stay online. The here.now state (.herenow) sits next to the folder.
#   index.html / robots.txt    blank root ("Nothing here", noindex)
#   <installPath>/             install page + every SwipeClean-v*.apk
#   <updateChannelPath>/version.json    update channel compiled into the app
# Refuses: config.example.json or placeholders, a slug in neverPublishTo, a missing/fresh/unpopulated publishSiteDir,
# a version.json whose APK is not in the folder, a leaked API key or keystore password. Never prints the API key.
set -euo pipefail
D=$(cd "$(dirname "$0")" && pwd); CFG=${SWIPECLEAN_CONFIG:-$(cd "$D/.." && pwd)/config.local.json}
[ -f "$CFG" ] || { echo "REFUSING: no $CFG (only config.example.json, which has placeholders). Publishing needs the real config.local.json." >&2; exit 1; }
SLUG=$(jq -r '.android.slug//empty' "$CFG"); INST=$(jq -r '.android.installPath//empty' "$CFG"); UPD=$(jq -r '.android.updateChannelPath//empty' "$CFG")
case "$SLUG$INST$UPD" in *YOUR*|"") echo "REFUSING: config has placeholder or missing values" >&2; exit 1;; esac
if jq -e --arg s "$SLUG" '(.neverPublishTo//[]) | index($s)' "$CFG" >/dev/null || [ "$SLUG" = "$(jq -r '.web.slug//empty' "$CFG")" ]; then echo "REFUSING: this slug is listed in neverPublishTo (or equals the web slug)" >&2; exit 1; fi
. "$D/tools/site-check.sh"
APKF=$(jq -r '.apkUrl//empty' "$SITE/$UPD/version.json" 2>/dev/null | sed 's#.*/##')
[ -n "$APKF" ] && [ -f "$SITE/$INST/$APKF" ] || die "version.json is missing or points at an APK that is not in the install folder (run tools/make_site.sh first)"
[ -f "$SITE/index.html" ] && grep -q noindex "$SITE/index.html" || die "root index.html lacks noindex"
KEYVAL="${HERENOW_API_KEY:-$(cat "$HOME/.herenow/credentials" 2>/dev/null || true)}"
if [ -n "$KEYVAL" ] && grep -rqF -- "$KEYVAL" "$SITE"; then die "API key found in site files"; fi
KSP=$(jq -r '.android.keystorePassword//empty' "$CFG"); if [ -n "$KSP" ] && grep -rqF -- "$KSP" "$SITE"; then die "keystore password found in site files"; fi
find "$SITE" -name '*.keystore' | grep -q . && die "keystore found in site folder"
STATE=$(dirname "$SITE")   # here.now keeps its local state in <cwd>/.herenow; the existing one is beside the site folder
[ -d "$STATE/.herenow" ] || echo "note: no $STATE/.herenow state found (publishing with --slug still works)" >&2
NAPK=$(ls "$SITE/$INST"/SwipeClean-v*.apk | wc -l); NFILES=$(find "$SITE" -type f | wc -l)
if [ "${DRY_RUN:-}" = 1 ]; then echo "DRY RUN OK: would upload $NFILES files from the existing site folder ($NAPK APKs, latest staged: $APKF). Nothing published."; exit 0; fi
# here.now publish script: $HERENOW_PUBLISH_SH, else config key herenowPublishScript (a path; a * glob is allowed)
PUBPAT=${HERENOW_PUBLISH_SH:-$(jq -r '.herenowPublishScript//empty' "$CFG")}
PUB=$( [ -n "$PUBPAT" ] && ls -d $PUBPAT 2>/dev/null | head -1 || true)
[ -n "$PUB" ] || { echo "here.now publish.sh not found (set HERENOW_PUBLISH_SH or herenowPublishScript in config.local.json)" >&2; exit 1; }
[ -n "${HERENOW_API_KEY:-}" ] || [ -f "$HOME/.herenow/credentials" ] || { echo "No here.now API key" >&2; exit 1; }
cd "$STATE"
OUT=$(bash "$PUB" "$SITE" --client cursor --slug "$SLUG" 2>&1) || { echo "$OUT" | grep -viE 'bearer|api_key|claim' >&2; echo "PUBLISH FAILED" >&2; exit 1; }
echo "$OUT" | grep -iE 'publish_result\.(persistence|auth_mode)|warn|error' || true
NEW=$(echo "$OUT" | sed -n 's/^publish_result\.site_url=//p' | tail -1 | sed -E 's#^https://([^.]+)\.here\.now/?$#\1#')
[ -n "$NEW" ] || { echo "could not read slug" >&2; exit 1; }
[ "$NEW" = "$SLUG" ] || { echo "published to a different site than configured" >&2; exit 1; }
echo "Published ($NFILES files, $NAPK APKs kept)"
[ "${SHOW_URL:-}" = 1 ] && { echo "Install: https://$SLUG.here.now/$INST/"; echo "Update channel: https://$SLUG.here.now/$UPD/version.json"; } || true
