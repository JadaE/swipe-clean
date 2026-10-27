# Sourced by publish.sh and make_site.sh. Needs CFG (path to the config file), INST (installPath), UPD (updateChannelPath).
# Sets SITE = android.publishSiteDir and refuses (exit 1) unless it is an existing, populated site folder.
# Staging into it and publishing it whole keeps every earlier APK and the here.now state next to it; a fresh folder would drop them.
die() { echo "REFUSING: $*" >&2; exit 1; }
SITE=$(jq -r '.android.publishSiteDir//empty' "$CFG")
case "$SITE" in "") die "android.publishSiteDir is missing in the config";; *YOUR*) die "android.publishSiteDir is still a placeholder";; /*) ;; *) die "android.publishSiteDir must be an absolute path";; esac
[ -d "$SITE" ] || die "publishSiteDir does not exist: it must be the EXISTING site folder, never a fresh one"
[ -f "$SITE/index.html" ] && [ -f "$SITE/robots.txt" ] || die "publishSiteDir has no root index.html/robots.txt, so it is not the existing site folder"
[ -d "$SITE/$INST" ] || die "publishSiteDir has no installPath folder"
ls "$SITE/$INST"/SwipeClean-v0.0.*.apk >/dev/null 2>&1 || die "no earlier SwipeClean-v0.0.*.apk in the installPath folder, so this is not the existing site folder"
[ -d "$SITE/$UPD" ] || die "publishSiteDir has no updateChannelPath folder"
