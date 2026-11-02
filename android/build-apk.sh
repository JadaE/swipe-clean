#!/usr/bin/env bash
# Local signed release build of Swipe Clean (no EAS), with its own keystore.
# Usage: bash android/build-apk.sh
# Config: repo-root config.local.json (falls back to config.example.json for checks). The signed release needs the real one, with
# android.releaseKeystore (repo-relative path, gitignored, e.g. android/keys/<name>.keystore), android.releaseKeyAlias and
# android.releaseKeystorePassword. From v0.0.7 the app is signed with the JC AiPPs key; the pre-0.0.7 key is no longer used.
set -euo pipefail
export JAVA_HOME=$HOME/jdk17 ANDROID_HOME=$HOME/android-sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
ROOT=$(cd "$(dirname "$0")" && pwd); APP=$ROOT/app; REPO=$(cd "$ROOT/.." && pwd)
CFG=$REPO/config.local.json; [ -f "$CFG" ] || CFG=$REPO/config.example.json
cd $APP
AJ=$(node -e "const a=require('./app.json').expo;console.log(a.version+':'+a.android.versionCode)")
VT=$(node -e "const s=require('fs').readFileSync('src/version.ts','utf8');console.log(s.match(/VERSION_NAME = '([^']+)'/)[1]+':'+s.match(/VERSION_CODE = (\\d+)/)[1])")
[ "$AJ" = "$VT" ] || { echo "Version mismatch: app.json $AJ vs src/version.ts $VT" >&2; exit 1; }
V=${AJ%%:*}
npx tsc --noEmit -p . && npx tsx tests/logic.test.ts | tail -1 && npx tsx tests/stats.test.ts | tail -1 && TZ=Pacific/Auckland npx tsx tests/stats.test.ts | tail -1 && npx tsx tests/trash.test.ts | tail -1 && TZ=Pacific/Auckland npx tsx tests/trash.test.ts | tail -1 && npx tsx tests/mascot.test.ts | tail -1 && npx tsx tests/theme.test.ts | tail -1 && npx tsx tests/update.test.ts | tail -1
KSREL=$(jq -r '.android.releaseKeystore//empty' "$CFG"); case "$KSREL" in /*) KS=$KSREL;; "") KS=;; *) KS=$REPO/$KSREL;; esac
[ "$CFG" = "$REPO/config.local.json" ] && [ -n "$KS" ] && [ -f "$KS" ] || { echo "Checks passed. A signed APK needs the real config.local.json and the keystore named by android.releaseKeystore (not in git); stopping before the release build." >&2; exit 2; }
# Always (re)apply app.json to the native project, so version, launcher icons and manifest follow it. Non-clean: keeps the folder.
CI=1 npx expo prebuild -p android --no-install
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
G=android/app/build.gradle
python3 - "$G" <<'PY'
import re,sys
p=sys.argv[1]; s=open(p).read()
block="""        release { // SC_RELEASE_SIGNING
            storeFile file(System.getenv('SC_KEYSTORE'))
            storePassword System.getenv('SC_KEYPASS')
            keyAlias System.getenv('SC_KEYALIAS')
            keyPassword System.getenv('SC_KEYPASS')
        }
"""
if "SC_RELEASE_SIGNING" in s:  # replace an older patch (e.g. one with a hard-coded alias)
    s=re.sub(r"        release \{ // SC_RELEASE_SIGNING\n.*?\n        \}\n", lambda m: block, s, count=1, flags=re.S)
else:
    s=s.replace("    signingConfigs {\n        debug {", "    signingConfigs {\n"+block+"        debug {",1)
    i=s.index("        release {\n            // Caution!")
    j=s.index("signingConfig signingConfigs.debug",i)
    s=s[:j]+"signingConfig signingConfigs.release"+s[j+len("signingConfig signingConfigs.debug"):]
assert "keyAlias System.getenv('SC_KEYALIAS')" in s
open(p,'w').write(s)
PY
export SC_KEYSTORE=$KS
export SC_KEYALIAS=$(jq -r '.android.releaseKeyAlias//empty' "$CFG")
export SC_KEYPASS=$(jq -r '.android.releaseKeystorePassword//empty' "$CFG")
case "$SC_KEYPASS" in YOUR*|"") echo "android.releaseKeystorePassword missing in config.local.json" >&2; exit 1;; esac
case "$SC_KEYALIAS" in YOUR*|"") echo "android.releaseKeyAlias missing in config.local.json" >&2; exit 1;; esac
cd android
sed -i -E "s/versionCode [0-9]+$/versionCode ${AJ##*:}/; s/versionName \"[^\"]+\"/versionName \"$V\"/" app/build.gradle
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,x86_64 -Dorg.gradle.jvmargs="-Xmx3g -XX:MaxMetaspaceSize=768m" --max-workers=3 -Pkotlin.compiler.execution.strategy=in-process --no-daemon
OUT=app/build/outputs/apk/release/app-release.apk
mkdir -p $ROOT/dist && cp $OUT $ROOT/dist/SwipeClean-v$V.apk
$ANDROID_HOME/build-tools/37.0.0/apksigner verify --print-certs $ROOT/dist/SwipeClean-v$V.apk | grep -E "certificate (DN|SHA-256)"
ls -la $ROOT/dist
echo BUILD_OK
