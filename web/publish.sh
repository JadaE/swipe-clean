#!/usr/bin/env bash
# (Re)publish the Swipe Clean web demo to its own here.now Site:   bash web/publish.sh
# App lives at https://<slug>.here.now/<pathToken>/ (values in the repo-root config.local.json, section "web"). Root is a blank page.
# Refuses to run on config.example.json (placeholders) and refuses any slug listed in neverPublishTo.
# Reuses the fixed slug so the OAuth origin https://<slug>.here.now stays stable.
# Refuses to publish if credential-looking text is in the files, or if CLIENT_ID is set while DEMO_ONLY=1 (default).
# Prints the secret URL only with SHOW_URL=1.
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$DIR/.." && pwd); CFG="$REPO/config.local.json"; APP="$DIR/app"; OUTD="$DIR/site"
[ -f "$CFG" ] || { echo "No $CFG (only config.example.json, which has placeholders). Publishing needs the real config.local.json." >&2; exit 1; }
SLUG="$(jq -r '.web.slug//empty' "$CFG")"; TOK="$(jq -r '.web.pathToken//empty' "$CFG")"
case "$SLUG$TOK" in *YOUR*) echo "config.local.json still has placeholder values; NOT publishing" >&2; exit 1;; esac
if jq -e --arg s "$SLUG" '(.neverPublishTo//[]) | index($s)' "$CFG" >/dev/null || [ "$SLUG" = "$(jq -r '.android.slug//empty' "$CFG")" ]; then echo "Refusing: $SLUG is listed in neverPublishTo" >&2; exit 1; fi
[ ${#TOK} -eq 32 ] || { echo "pathToken must be 32 chars" >&2; exit 1; }
PUB=$(ls -d /home/box/agent-data/plugins/cache/cursor-public/here_now/*/skills/here-now/scripts/publish.sh 2>/dev/null | head -1)
[ -n "$PUB" ] || { echo "here.now publish.sh not found" >&2; exit 1; }
[ -n "${HERENOW_API_KEY:-}" ] || [ -f "$HOME/.herenow/credentials" ] || { echo "No here.now API key (HERENOW_API_KEY or ~/.herenow/credentials)" >&2; exit 1; }
if [ "${DEMO_ONLY:-1}" = 1 ] && ! grep -q "CLIENT_ID: ''" "$APP/config.js"; then echo "CLIENT_ID is set but DEMO_ONLY=1; NOT publishing" >&2; exit 1; fi
# build: blank root + robots + app under the secret path (no screens/, no tests)
rm -rf "$OUTD"; mkdir -p "$OUTD/$TOK"
cp "$APP/index.html" "$APP/app.js" "$APP/config.js" "$OUTD/$TOK/"; cp -r "$APP/demo" "$OUTD/$TOK/demo"
cat > "$OUTD/index.html" <<'HTML'
<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow, noarchive"><meta name="referrer" content="no-referrer"><meta property="og:title" content="Nothing here"><meta property="og:description" content="Private page"><title>Nothing here</title><link rel="icon" href="data:,"></head><body style="background:#fff"><p style="font:14px system-ui;color:#999;text-align:center;margin-top:40vh">Nothing here.</p></body></html>
HTML
printf 'User-agent: *\nDisallow: /\n' > "$OUTD/robots.txt"
grep -q 'noindex' "$OUTD/$TOK/index.html" || { echo "app missing noindex" >&2; exit 1; }
KEYVAL="${HERENOW_API_KEY:-$(cat "$HOME/.herenow/credentials" 2>/dev/null || true)}"
if [ -n "$KEYVAL" ] && grep -rqF -- "$KEYVAL" "$OUTD"; then echo "API key found in site files; NOT publishing" >&2; exit 1; fi
if grep -rqiE 'HERENOW_API_KEY|api[_-]?key|claim_?token|hnk_' "$OUTD"; then echo "credential-looking text in site files; NOT publishing" >&2; exit 1; fi
cd "$DIR"   # here.now keeps its local state in ./.herenow (outside site/, gitignored)
ARGS=("$OUTD" --client cursor); [ -n "$SLUG" ] && ARGS+=(--slug "$SLUG")
OUT=$(bash "$PUB" "${ARGS[@]}" 2>&1) || { echo "$OUT" | grep -viE 'bearer|api_key|claim' >&2; echo "PUBLISH FAILED" >&2; exit 1; }
echo "$OUT" | grep -iE 'publish_result\.(persistence|auth_mode)|warn|error' || true
URL=$(echo "$OUT" | sed -n 's/^publish_result\.site_url=//p' | tail -1)
NEW=$(echo "$URL" | sed -E 's#^https://([^.]+)\.here\.now/?$#\1#')
[ -n "$NEW" ] || { echo "could not read slug from publish output" >&2; exit 1; }
if [ -z "$SLUG" ]; then jq --arg s "$NEW" '.web.slug=$s' "$CFG" > "$CFG.tmp" && chmod 600 "$CFG.tmp" && mv "$CFG.tmp" "$CFG"; SLUG=$NEW; echo "Created new Site $SLUG (saved in config.local.json)"; fi
[ "$NEW" = "$SLUG" ] || { echo "WARNING: published to $NEW, expected $SLUG" >&2; exit 1; }
echo "Published $SLUG. OAuth origin: https://$SLUG.here.now"
[ "${SHOW_URL:-}" = 1 ] && echo "App: https://$SLUG.here.now/$TOK/" || true
