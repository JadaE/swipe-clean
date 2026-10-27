#!/usr/bin/env bash
# Stage the install page + APK for one version INTO the existing publishSiteDir (keeps older APKs), and point the update channel at it.
# Usage: bash tools/make_site.sh   (reads version from app/app.json)
set -euo pipefail
D=$(cd "$(dirname "$0")/.." && pwd); CFG=${SWIPECLEAN_CONFIG:-$D/../config.local.json}
[ -f "$CFG" ] || { echo "REFUSING: make_site needs the real config.local.json (not the example)" >&2; exit 1; }
SLUG=$(jq -r .android.slug "$CFG"); INST=$(jq -r .android.installPath "$CFG"); UPD=$(jq -r .android.updateChannelPath "$CFG")
case "$SLUG$INST$UPD" in *YOUR*|"") echo "REFUSING: config has placeholder or missing values" >&2; exit 1;; esac
. "$D/tools/site-check.sh"   # sets SITE = android.publishSiteDir; refuses unless it is the existing, populated site folder
V=$(node -e "console.log(require('$D/app/app.json').expo.version)"); VC=$(node -e "console.log(require('$D/app/app.json').expo.android.versionCode)")
APK=SwipeClean-v$V.apk; cp $D/dist/$APK $SITE/$INST/
SHA=$(sha256sum $D/dist/$APK | cut -c1-16); SIZE=$(du -m $D/dist/$APK | cut -f1)
cp $D/tools/site-icon.png $SITE/$INST/icon.png   # app icon (192 px) for the favicon and page header
SHOTS=""; if ls $D/screens/site/*.png >/dev/null 2>&1; then mkdir -p $SITE/$INST/shots; cp $D/screens/site/*.png $SITE/$INST/shots/; for f in $SITE/$INST/shots/*.png; do n=$(basename $f); SHOTS+="<a href=\"shots/$n\"><img loading=lazy src=\"shots/$n\" alt=\"\"></a>"; done; fi
cat > $SITE/$INST/index.html <<H
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive"><meta name="referrer" content="no-referrer"><meta property="og:title" content="Private page"><meta property="og:description" content="Nothing here">
<title>Swipe Clean v$V</title><link rel="icon" type="image/png" href="icon.png"><link rel="apple-touch-icon" href="icon.png">
<style>body{margin:0;background:#0f1115;color:#eef0f4;font:16px/1.5 system-ui,Roboto,sans-serif}main{max-width:640px;margin:auto;padding:24px 18px}
h1{font-size:28px;margin:4px 0}.btn{display:block;text-align:center;background:#9ab8ff;color:#0f1730;font-weight:800;font-size:18px;padding:16px;border-radius:14px;text-decoration:none;margin:18px 0}
.card{background:#1a1d24;border-radius:16px;padding:14px 16px;margin:12px 0}.warn{background:#1f1d16;border:1px solid #4a4226}.warn b{color:#e9c46a}
li{margin:4px 0}.small{font-size:12px;color:#6b7280}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}.grid img{width:100%;border-radius:12px}</style></head><body><main>
<h1><img src="icon.png" alt="" width="56" height="56" style="vertical-align:middle;margin-right:10px">Swipe Clean <span style="color:#9ab8ff">v$V</span></h1>
<p>Sort the photos and videos on your phone yourself, one swipe at a time. Swipe right to keep and left to add to your Remove pile. Nothing is removed until you review the pile and approve Android's own confirmation. The app never picks anything for you.</p>
<a class="btn" href="$APK" download>⬇ Download for Android ($SIZE MB)</a>
<div class="card"><b>Already have an older version?</b> Download this one and tap <b>Update</b>. It installs over it (same signing key) and keeps your choices. Don't uninstall first.</div>
<div class="card"><b>New install (about 1 minute)</b><ol>
<li>Open this page in <b>Chrome</b> on your phone and tap <b>Download</b>. Your phone is almost full, and the download needs about ${SIZE} MB free. If it fails, clear a few big videos first, or delete an old download.</li>
<li>Tap the downloaded file (from the notification, or Files → Downloads).</li>
<li>If Android says Chrome <b>isn't allowed to install unknown apps</b>, tap <b>Settings</b> and turn on <b>Allow from this source</b>, then go back.</li>
<li>Tap <b>Install</b>. If <b>Play Protect</b> warns about an unknown app, tap <b>More details → Install anyway</b>. That warning appears because the app isn't from the Play Store.</li>
<li>Open <b>Swipe Clean</b>. When Android asks about photos and videos, choose <b>Allow all</b> to sort everything, or <b>Select photos and videos</b> to try it on a few first.</li>
<li>You can delete the downloaded APK afterwards to get the space back.</li></ol></div>
<div class="card warn"><b>Before you remove anything:</b> removing from the phone does <b>not</b> delete the copy in Google Photos, but the app <b>can't tell</b> whether something has been backed up, because Android doesn't share that with other apps. Check first in Google Photos → your profile picture → Backup that it says <b>Backup complete</b>.</div>
<div class="card"><b>Privacy:</b> your photos are read on the phone and never uploaded. The only internet use is a once-a-day check of a small version file on this site for updates. Removing always goes through Android's own dialog. "Move to trash" can be restored for about 30 days.</div>
${SHOTS:+<div class="card"><b>Screens</b><div class="grid" style="margin-top:8px">$SHOTS</div></div>}
<p class="small">Android 11+ to remove (sorting works on Android 7+) · package com.jada.swipeclean · v$V · SHA-256 starts $SHA · built $(TZ=America/Chicago date '+%a %b %-d, %-I:%M %p CT')</p>
</main></body></html>
H
printf '{"versionCode":%s,"versionName":"%s","apkUrl":"https://%s.here.now/%s/%s","notes":"%s"}\n' "$VC" "$V" "$SLUG" "$INST" "$APK" "${NOTES:-}" > $SITE/$UPD/version.json
echo staged $V
