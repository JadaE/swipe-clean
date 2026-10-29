# Swipe Clean

> 🤖 This project was created by [Grok Bot](https://cursor.com) from Cursor.

Swipe through your photos to decide what to keep and what to delete.

- `android/` Expo / React Native Android app. It sorts photos from the device library with swipes, undo and streaks, and uses the system trash/delete dialogs. A small Kotlin module (`app/modules/swipeclean-media`) talks to MediaStore.
- `web/` browser demo for Google Photos using the Picker API (read-only scope). It runs in demo mode until `app/config.js` has a Google OAuth `CLIENT_ID`.

## Run
```bash
# Android app
cd android/app && npm install && npm test
bash ../build-apk.sh        # signed release needs config.local.json + android/keys/swipeclean.keystore (not in this repo)

# Web demo
cd web && npm install && npm test  # Playwright test (demo mode + mocked Picker API); needs Google Chrome (CHROME_PATH to override)
```
## Config (one file)
`config.local.json` (repo root, gitignored) holds the deploy values; `config.example.json` is the committed template with placeholders. Without `config.local.json`, tests and checks use the example (a clean clone type-checks and tests fine) and the publish scripts refuse to run.

| Section | Keys |
|---|---|
| top level | `neverPublishTo` (site slugs the publish scripts must refuse; `[]` in the example), `herenowPublishScript` (absolute path to the here.now `publish.sh`; a `*` glob is allowed; the `HERENOW_PUBLISH_SH` env var overrides it) |
| `web` | `slug`, `pathToken`, `publishSiteDir` |
| `android` | `slug`, `installPath`, `updateChannelPath`, `keystorePassword`, `publishSiteDir` |

- Android app code reads config only through `android/app/src/config.ts`; `android/tools/sync-config.sh` (run by `npm test` and `build-apk.sh`) writes the app's two values into the gitignored `src/config.generated.json`. The keystore password is never copied into the app.
- `publishSiteDir` (absolute path) is the EXISTING site folder. Releases are staged into it (Android: `tools/make_site.sh` adds the new APK and `version.json`; web: `publish.sh` refreshes `<pathToken>/`) and the whole folder is then uploaded, so earlier APKs stay online and the here.now state (`.herenow`, next to the folder) is reused. The publish scripts refuse a missing, non-existent or unpopulated folder (Android needs the earlier `SwipeClean-v0.0.*.apk` files and the install and update-channel folders). `DRY_RUN=1 bash android/publish.sh` / `web/publish.sh` runs every check without changing or publishing anything.
- Shell scripts read the file with `jq`. The signing keystore stays in gitignored `android/keys/swipeclean.keystore`.

## Not included (set up locally)
- `config.local.json` and `android/keys/swipeclean.keystore` (see Config above). Neither is in git.
- `web/app/config.js` ships with an empty `CLIENT_ID` (Google OAuth Web client id, add your own) and an empty `LOGIN_HINT` (optional email to pre-select in Google's sign-in). Demo mode works without either.
- The shell scripts find their own folder (`DIR=$(cd "$(dirname "$0")" && pwd)`), so the repo can live anywhere.
- The demo photos in `web/app/demo/` are generated placeholders (`python3 web/tools/make_demo.py`), not real photos.
