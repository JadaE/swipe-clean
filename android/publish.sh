#!/usr/bin/env bash
# Publish Swipe Clean (Android) to its OWN here.now Site:  bash android/publish.sh
# Site layout (publish-site/ is uploaded whole, so never delete a version folder):
#   index.html   blank root ("Nothing here", noindex)      robots.txt  Disallow: /
#   <installPath>/          install page + APK + shots   (secret)
#   <updateChannelPath>/version.json                    (stable update channel compiled into the app)
# Values come from the repo-root config.local.json (section "android"). Refuses config.example.json and any slug in neverPublishTo.
# Never prints the API key.
set -euo pipefail
D=$(cd "$(dirname "$0")" && pwd); CFG=$(cd "$D/.." && pwd)/config.local.json; SITE=$D/publish-site
[ -f "$CFG" ] || { echo "No $CFG (only config.example.json, which has placeholders). Publishing needs the real config.local.json." >&2; exit 1; }
SLUG=$(jq -r '.android.slug//empty' $CFG); INST=$(jq -r '.android.installPath//empty' $CFG); UPD=$(jq -r '.android.updateChannelPath//empty' $CFG)
case "$SLUG$INST$UPD" in *YOUR*|"") echo "config.local.json has placeholder or missing values; NOT publishing" >&2; exit 1;; esac
if jq -e --arg s "$SLUG" '(.neverPublishTo//[]) | index($s)' $CFG >/dev/null || [ "$SLUG" = "$(jq -r '.web.slug//empty' $CFG)" ]; then echo "Refusing: $SLUG belongs to another project" >&2; exit 1; fi
PUB=$(ls -d /home/box/agent-data/plugins/cache/cursor-public/here_now/*/skills/here-now/scripts/publish.sh | head -1)
[ -n "${HERENOW_API_KEY:-}" ] || [ -f "$HOME/.herenow/credentials" ] || { echo "No here.now API key" >&2; exit 1; }
mkdir -p $SITE/$INST $SITE/$UPD
cat > $SITE/index.html <<'H'
<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow, noarchive"><meta name="referrer" content="no-referrer"><meta property="og:title" content="Nothing here"><meta property="og:description" content="Private page"><title>Nothing here</title><link rel="icon" href="data:,"></head><body style="background:#fff"><p style="font:14px system-ui;color:#999;text-align:center;margin-top:40vh">Nothing here.</p></body></html>
H
printf 'User-agent: *\nDisallow: /\n' > $SITE/robots.txt
[ -f $SITE/$INST/index.html ] || echo '<!doctype html><meta charset=utf-8><meta name=robots content="noindex,nofollow"><title>Swipe Clean</title><p>Coming soon.</p>' > $SITE/$INST/index.html
[ -f $SITE/$UPD/version.json ] || echo '{"versionCode":0,"versionName":"0.0.0","apkUrl":"","notes":""}' > $SITE/$UPD/version.json
KEYVAL="${HERENOW_API_KEY:-$(cat "$HOME/.herenow/credentials" 2>/dev/null || true)}"
if [ -n "$KEYVAL" ] && grep -rqF -- "$KEYVAL" "$SITE"; then echo "API key in site files; NOT publishing" >&2; exit 1; fi
if grep -rqF -- "$(jq -r .android.keystorePassword $CFG)" "$SITE"; then echo "keystore password in site files; NOT publishing" >&2; exit 1; fi
find $SITE -name '*.keystore' | grep -q . && { echo "keystore in site; NOT publishing" >&2; exit 1; }
cd $D
ARGS=("$SITE" --client cursor); [ -n "$SLUG" ] && ARGS+=(--slug "$SLUG")
OUT=$(bash "$PUB" "${ARGS[@]}" 2>&1) || { echo "$OUT" | grep -viE 'bearer|api_key|claim' >&2; echo "PUBLISH FAILED" >&2; exit 1; }
echo "$OUT" | grep -iE 'publish_result\.(persistence|auth_mode)|warn|error' || true
NEW=$(echo "$OUT" | sed -n 's/^publish_result\.site_url=//p' | tail -1 | sed -E 's#^https://([^.]+)\.here\.now/?$#\1#')
[ -n "$NEW" ] || { echo "could not read slug" >&2; exit 1; }
if [ -z "$SLUG" ]; then jq --arg s "$NEW" '.android.slug=$s' $CFG > $CFG.tmp && chmod 600 $CFG.tmp && mv $CFG.tmp $CFG; SLUG=$NEW; echo "Created Site $SLUG"; fi
[ "$NEW" = "$SLUG" ] || { echo "published to $NEW, expected $SLUG" >&2; exit 1; }
echo "Published $SLUG"
[ "${SHOW_URL:-}" = 1 ] && { echo "Install: https://$SLUG.here.now/$INST/"; echo "Update channel: https://$SLUG.here.now/$UPD/version.json"; } || true
