#!/usr/bin/env bash
# Publish Swipe Clean (Android) to its OWN here.now Site:  bash /workspace/photo-cleanup/android/publish.sh
# Site layout (publish-site/ is uploaded whole, so never delete a version folder):
#   index.html   blank root ("Nothing here", noindex)      robots.txt  Disallow: /
#   <install_path>/          install page + APK + shots   (secret)
#   <update_channel_path>/version.json                    (stable update channel compiled into the app)
# Reuses the slug in keys/site-config.json. Refuses other projects' slugs. Never prints the API key.
set -euo pipefail
D=/workspace/photo-cleanup/android; CFG=$D/keys/site-config.json; SITE=$D/publish-site
SLUG=$(jq -r '.slug//empty' $CFG); INST=$(jq -r .install_path $CFG); UPD=$(jq -r .update_channel_path $CFG)
case "$SLUG" in YOUR-SITE-SLUG|YOUR-SITE-SLUG|YOUR-SITE-SLUG|YOUR-SITE-SLUG|YOUR-SITE-SLUG|YOUR-SITE-SLUG|YOUR-SITE-SLUG) echo "Refusing: $SLUG belongs to another project" >&2; exit 1;; esac
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
if grep -rqF -- "$(cat $D/keys/keystore-password.txt)" "$SITE"; then echo "keystore password in site files; NOT publishing" >&2; exit 1; fi
find $SITE -name '*.keystore' | grep -q . && { echo "keystore in site; NOT publishing" >&2; exit 1; }
cd $D
ARGS=("$SITE" --client cursor); [ -n "$SLUG" ] && ARGS+=(--slug "$SLUG")
OUT=$(bash "$PUB" "${ARGS[@]}" 2>&1) || { echo "$OUT" | grep -viE 'bearer|api_key|claim' >&2; echo "PUBLISH FAILED" >&2; exit 1; }
echo "$OUT" | grep -iE 'publish_result\.(persistence|auth_mode)|warn|error' || true
NEW=$(echo "$OUT" | sed -n 's/^publish_result\.site_url=//p' | tail -1 | sed -E 's#^https://([^.]+)\.here\.now/?$#\1#')
[ -n "$NEW" ] || { echo "could not read slug" >&2; exit 1; }
if [ -z "$SLUG" ]; then jq --arg s "$NEW" '.slug=$s' $CFG > $CFG.tmp && chmod 600 $CFG.tmp && mv $CFG.tmp $CFG; SLUG=$NEW; echo "Created Site $SLUG"; fi
[ "$NEW" = "$SLUG" ] || { echo "published to $NEW, expected $SLUG" >&2; exit 1; }
echo "Published $SLUG"
[ "${SHOW_URL:-}" = 1 ] && { echo "Install: https://$SLUG.here.now/$INST/"; echo "Update channel: https://$SLUG.here.now/$UPD/version.json"; } || true
