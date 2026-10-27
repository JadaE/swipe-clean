#!/usr/bin/env bash
# Publish the Swipe Clean web demo to its here.now Site:   bash web/publish.sh      (DRY_RUN=1: run every check, change/publish nothing)
# Values come from the repo-root config.local.json, section "web" (SWIPECLEAN_CONFIG=<file> overrides the path).
# The app is staged INTO web.publishSiteDir (the EXISTING site folder: blank root + <pathToken>/ app), then the whole folder is uploaded.
# Only <pathToken>/ is refreshed; the rest of the folder, and the here.now state (.herenow) next to it, are kept. Root is a blank page.
# Refuses: config.example.json or placeholders, a slug in neverPublishTo, a missing/fresh/unpopulated publishSiteDir,
# CLIENT_ID set while DEMO_ONLY=1 (default), credential-looking text in the files. Prints the secret URL only with SHOW_URL=1.
set -euo pipefail
die() { echo "REFUSING: $*" >&2; exit 1; }
DIR=$(cd "$(dirname "$0")" && pwd); CFG=${SWIPECLEAN_CONFIG:-$(cd "$DIR/.." && pwd)/config.local.json}; APP="$DIR/app"
[ -f "$CFG" ] || die "no $CFG (only config.example.json, which has placeholders). Publishing needs the real config.local.json."
SLUG="$(jq -r '.web.slug//empty' "$CFG")"; TOK="$(jq -r '.web.pathToken//empty' "$CFG")"; SITE="$(jq -r '.web.publishSiteDir//empty' "$CFG")"
case "$SLUG$TOK" in *YOUR*|"") die "config has placeholder or missing web values";; esac
if jq -e --arg s "$SLUG" '(.neverPublishTo//[]) | index($s)' "$CFG" >/dev/null || [ "$SLUG" = "$(jq -r '.android.slug//empty' "$CFG")" ]; then die "this slug is listed in neverPublishTo (or equals the android slug)"; fi
[ ${#TOK} -eq 32 ] || die "pathToken must be 32 chars"
case "$SITE" in "") die "web.publishSiteDir is missing in the config";; *YOUR*) die "web.publishSiteDir is still a placeholder";; /*) ;; *) die "web.publishSiteDir must be an absolute path";; esac
[ -d "$SITE" ] || die "publishSiteDir does not exist: it must be the EXISTING site folder, never a fresh one"
[ -f "$SITE/index.html" ] && [ -f "$SITE/robots.txt" ] && [ -f "$SITE/$TOK/index.html" ] || die "publishSiteDir lacks the existing root index.html, robots.txt and <pathToken>/index.html, so it is not the existing site folder"
STATE=$(dirname "$SITE")   # here.now keeps its local state in <cwd>/.herenow; the existing one is beside the site folder
[ -d "$STATE/.herenow" ] || echo "note: no $STATE/.herenow state found (publishing with --slug still works)" >&2
for f in index.html app.js config.js; do [ -f "$APP/$f" ] || die "missing app file $f"; done
if [ "${DEMO_ONLY:-1}" = 1 ] && ! grep -q "CLIENT_ID: ''" "$APP/config.js"; then die "CLIENT_ID is set but DEMO_ONLY=1"; fi
grep -q 'noindex' "$APP/index.html" || die "app missing noindex"
KEYVAL="${HERENOW_API_KEY:-$(cat "$HOME/.herenow/credentials" 2>/dev/null || true)}"
if [ "${DRY_RUN:-}" = 1 ]; then
  if [ -n "$KEYVAL" ] && grep -rqF -- "$KEYVAL" "$SITE" "$APP"; then die "API key found in site files"; fi
  echo "DRY RUN OK: would refresh <pathToken>/ inside the existing site folder and upload $(find "$SITE" -type f | wc -l) files. Nothing changed or published."; exit 0
fi
# here.now publish script: $HERENOW_PUBLISH_SH, else config key herenowPublishScript (a path; a * glob is allowed)
PUBPAT=${HERENOW_PUBLISH_SH:-$(jq -r '.herenowPublishScript//empty' "$CFG")}
PUB=$( [ -n "$PUBPAT" ] && ls -d $PUBPAT 2>/dev/null | head -1 || true)
[ -n "$PUB" ] || { echo "here.now publish.sh not found (set HERENOW_PUBLISH_SH or herenowPublishScript in config.local.json)" >&2; exit 1; }
[ -n "$KEYVAL" ] || { echo "No here.now API key (HERENOW_API_KEY or ~/.herenow/credentials)" >&2; exit 1; }
# stage: refresh only the app folder (no screens/, no tests); everything else in the site folder stays as it is
rm -rf "${SITE:?}/$TOK"; mkdir -p "$SITE/$TOK"
cp "$APP/index.html" "$APP/app.js" "$APP/config.js" "$SITE/$TOK/"; cp -r "$APP/demo" "$SITE/$TOK/demo"
grep -q 'noindex' "$SITE/$TOK/index.html" || die "staged app missing noindex"
if grep -rqF -- "$KEYVAL" "$SITE"; then die "API key found in site files"; fi
if grep -rqiE 'HERENOW_API_KEY|api[_-]?key|claim_?token|hnk_' "$SITE"; then die "credential-looking text in site files"; fi
cd "$STATE"
OUT=$(bash "$PUB" "$SITE" --client cursor --slug "$SLUG" 2>&1) || { echo "$OUT" | grep -viE 'bearer|api_key|claim' >&2; echo "PUBLISH FAILED" >&2; exit 1; }
echo "$OUT" | grep -iE 'publish_result\.(persistence|auth_mode)|warn|error' || true
NEW=$(echo "$OUT" | sed -n 's/^publish_result\.site_url=//p' | tail -1 | sed -E 's#^https://([^.]+)\.here\.now/?$#\1#')
[ -n "$NEW" ] || { echo "could not read slug from publish output" >&2; exit 1; }
[ "$NEW" = "$SLUG" ] || { echo "published to a different site than configured" >&2; exit 1; }
echo "Published. OAuth origin: https://$SLUG.here.now"
[ "${SHOW_URL:-}" = 1 ] && echo "App: https://$SLUG.here.now/$TOK/" || true
