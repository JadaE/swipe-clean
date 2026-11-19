# Swipe Clean

> 🤖 This project was created by [Grok Bot](https://cursor.com) from Cursor.

Swipe through your photos to decide what to keep and what to delete.

- `android/` Expo / React Native Android app. It sorts photos from the device library with swipes, undo and streaks, and uses the system trash/delete dialogs. A small Kotlin module (`app/modules/swipeclean-media`) talks to MediaStore.
- `web/` browser demo for Google Photos using the Picker API (read-only scope). It runs in demo mode until `app/config.js` has a Google OAuth `CLIENT_ID`.

## Run
```bash
# Android app
cd android/app && npm install && npm test
bash ../build-apk.sh        # signed release needs config.local.json + the release keystore it names (not in this repo)

# Web demo
cd web && npm install && npm test  # Playwright test (demo mode + mocked Picker API); needs Google Chrome (CHROME_PATH to override)
```
## Config (one file)
`config.local.json` (repo root, gitignored) holds the deploy values; `config.example.json` is the committed template with placeholders. Without `config.local.json`, tests and checks use the example (a clean clone type-checks and tests fine) and the publish scripts refuse to run.

| Section | Keys |
|---|---|
| top level | `neverPublishTo` (site slugs the publish scripts must refuse; `[]` in the example), `herenowPublishScript` (absolute path to the here.now `publish.sh`; a `*` glob is allowed; the `HERENOW_PUBLISH_SH` env var overrides it; must resolve to an existing absolute `publish.sh`, checked even on dry runs), `releaseGateScript` (absolute path to the release gate script that must pass before any upload; the `RELEASE_GATE_SH` env var overrides it) |
| `web` | `slug`, `pathToken`, `publishSiteDir` |
| `android` | `slug`, `installPath`, `updateChannelPath`, `publishSiteDir` (the older here.now install site); `releaseKeystore` (repo-relative path to the gitignored signing keystore, under `android/keys/`), `releaseKeyAlias`, `releaseKeystorePassword` (the JC AiPPs release key used from v0.0.8); `keystorePassword` (the pre-0.0.8 key, kept only so its password stays with the old keystore and out of published files) |

- The Android app reads no deploy config at all (since v0.0.8). Its only network call is an anonymous, once-a-day `GET https://api.github.com/repos/JadaE/swipe-clean/releases/latest` (`android/app/src/update.ts` / `src/release.ts`): it compares `tag_name` (`vX.Y.Z`) with the app version and links to that release's `.apk` asset (or its release page). No token, no account; offline or any error just means "no update". Keystore passwords are never copied into the app.
- `publishSiteDir` (absolute path) is the EXISTING site folder. Releases are staged into it (Android: `tools/make_site.sh` adds the new APK and `version.json`; web: `publish.sh` refreshes `<pathToken>/`) and the whole folder is then uploaded, so earlier APKs stay online and the here.now state (`.herenow`, next to the folder) is reused. The publish scripts refuse a missing, non-existent or unpopulated folder (Android needs the earlier `SwipeClean-v0.0.*.apk` files and the install and update-channel folders). `DRY_RUN=1 bash android/publish.sh` / `web/publish.sh` runs every check without changing or publishing anything.
- Build flavors (same code, config-driven): `bash android/build-apk.sh` = store build (above). `SC_FLAVOR=personal bash android/build-apk.sh` = a personal build with the older package id and key (`android.personalPackage`, `android.personalKeystore`, `android.personalKeyAlias`, `android.keystorePassword`) whose update check reads the private update file named in `config.local.json` (`tools/gen-channel.sh` writes the gitignored `app/src/channel.generated.json`). Build each flavor in its own working folder. Personal APKs are never attached to public releases.
- Shell scripts read the file with `jq`. Signing keystores stay in gitignored `android/keys/`. From v0.0.8 the APK is signed by JC AiPPs (a new key) under its own package id `com.jcaipps.swipeclean`, so it installs as a separate app next to an older copy (no uninstall). Saved data does not carry over between the two by itself: use Settings > Move your data (Export / Import, one local JSON file through Android's file picker) to bring it across.

## Not included (set up locally)
- `config.local.json` and the keystores in `android/keys/` (see Config above). None are in git.
- `web/app/config.js` ships with an empty `CLIENT_ID` (Google OAuth Web client id, add your own) and an empty `LOGIN_HINT` (optional email to pre-select in Google's sign-in). Demo mode works without either.
- The shell scripts find their own folder (`DIR=$(cd "$(dirname "$0")" && pwd)`), so the repo can live anywhere.
- The demo photos in `web/app/demo/` are generated placeholders (`python3 web/tools/make_demo.py`), not real photos.
