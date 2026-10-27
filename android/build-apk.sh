#!/usr/bin/env bash
# Local signed release build of Swipe Clean (no EAS). Pattern copied from fantasy-football/build-apk.sh, own keystore.
# Usage: bash /workspace/photo-cleanup/android/build-apk.sh
set -euo pipefail
export JAVA_HOME=$HOME/jdk17 ANDROID_HOME=$HOME/android-sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH
ROOT=/workspace/photo-cleanup/android; APP=$ROOT/app
cd $APP
AJ=$(node -e "const a=require('./app.json').expo;console.log(a.version+':'+a.android.versionCode)")
VT=$(node -e "const s=require('fs').readFileSync('src/version.ts','utf8');console.log(s.match(/VERSION_NAME = '([^']+)'/)[1]+':'+s.match(/VERSION_CODE = (\\d+)/)[1])")
[ "$AJ" = "$VT" ] || { echo "Version mismatch: app.json $AJ vs src/version.ts $VT" >&2; exit 1; }
V=${AJ%%:*}
npx tsc --noEmit -p . && npx tsx tests/logic.test.ts | tail -1 && npx tsx tests/stats.test.ts | tail -1 && TZ=Pacific/Auckland npx tsx tests/stats.test.ts | tail -1
[ -d android ] || npx expo prebuild -p android --no-install
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
G=android/app/build.gradle
if ! grep -q "SC_RELEASE_SIGNING" $G; then
python3 - "$G" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("""    signingConfigs {
        debug {""","""    signingConfigs {
        release { // SC_RELEASE_SIGNING
            storeFile file(System.getenv('SC_KEYSTORE'))
            storePassword System.getenv('SC_KEYPASS')
            keyAlias 'swipeclean'
            keyPassword System.getenv('SC_KEYPASS')
        }
        debug {""",1)
i=s.index("        release {\n            // Caution!")
j=s.index("signingConfig signingConfigs.debug",i)
s=s[:j]+"signingConfig signingConfigs.release"+s[j+len("signingConfig signingConfigs.debug"):]
open(p,'w').write(s)
PY
fi
export SC_KEYSTORE=$ROOT/keys/swipeclean.keystore
export SC_KEYPASS=$(cat $ROOT/keys/keystore-password.txt)
cd android
sed -i -E "s/versionCode [0-9]+$/versionCode ${AJ##*:}/; s/versionName \"[^\"]+\"/versionName \"$V\"/" app/build.gradle
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,x86_64 -Dorg.gradle.jvmargs="-Xmx3g -XX:MaxMetaspaceSize=768m" --max-workers=3 -Pkotlin.compiler.execution.strategy=in-process --no-daemon
OUT=app/build/outputs/apk/release/app-release.apk
mkdir -p $ROOT/dist && cp $OUT $ROOT/dist/SwipeClean-v$V.apk
$ANDROID_HOME/build-tools/35.0.0/apksigner verify --print-certs $ROOT/dist/SwipeClean-v$V.apk | grep -E "Signer #1 certificate (DN|SHA-256)"
ls -la $ROOT/dist
echo BUILD_OK
