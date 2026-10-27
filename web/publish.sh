#!/usr/bin/env bash
# (Re)publish Swipe Clean to its own here.now Site:   bash /workspace/photo-cleanup/publish.sh
# App lives at https://<slug>.here.now/<path_token>/ (values in secret-config.json, mode 0600). Root is a blank page.
# Reuses the fixed slug so the OAuth origin https://<slug>.here.now stays stable. First run with "slug": null creates the Site.
# Refuses to publish if credential-looking text is in the files, or if CLIENT_ID is set while DEMO_ONLY=1 (default).
# Never touches YOUR-SITE-SLUG (Kanban) or YOUR-SITE-SLUG (cats). Prints the secret URL only with SHOW_URL=1.
set -euo pipefail
DIR=/workspace/photo-cleanup; CFG="$DIR/secret-config.json"; APP="$DIR/app"; OUTD="$DIR/site"
SLUG="$(jq -r '.slug//empty' "$CFG")"; TOK="$(jq -r .path_token "$CFG")"
case "$SLUG" in YOUR-SITE-SLUG|YOUR-SITE-SLUG|YOUR-SITE-SLUG|YOUR-SITE-SLUG|YOUR-SITE-SLUG) echo "Refusing: $SLUG is another project's Site" >&2; exit 1;; esac
[ ${#TOK} -eq 32 ] || { echo "path_token must be 32 chars" >&2; exit 1; }
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
cd "$DIR"   # here.now keeps its local state in ./.herenow (outside site/)
ARGS=("$OUTD" --client cursor); [ -n "$SLUG" ] && ARGS+=(--slug "$SLUG")
OUT=$(bash "$PUB" "${ARGS[@]}" 2>&1) || { echo "$OUT" | grep -viE 'bearer|api_key|claim' >&2; echo "PUBLISH FAILED" >&2; exit 1; }
echo "$OUT" | grep -iE 'publish_result\.(persistence|auth_mode)|warn|error' || true
URL=$(echo "$OUT" | sed -n 's/^publish_result\.site_url=//p' | tail -1)
NEW=$(echo "$URL" | sed -E 's#^https://([^.]+)\.here\.now/?$#\1#')
[ -n "$NEW" ] || { echo "could not read slug from publish output" >&2; exit 1; }
if [ -z "$SLUG" ]; then jq --arg s "$NEW" '.slug=$s' "$CFG" > "$CFG.tmp" && chmod 600 "$CFG.tmp" && mv "$CFG.tmp" "$CFG"; SLUG=$NEW; echo "Created new Site $SLUG (saved in secret-config.json)"; fi
[ "$NEW" = "$SLUG" ] || { echo "WARNING: published to $NEW, expected $SLUG" >&2; exit 1; }
echo "Published $SLUG. OAuth origin: https://$SLUG.here.now"
[ "${SHOW_URL:-}" = 1 ] && echo "App: https://$SLUG.here.now/$TOK/" || true
