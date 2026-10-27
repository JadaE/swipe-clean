# Swipe Clean

Swipe through your photos to decide what to keep and what to delete.

- `android/` Expo / React Native Android app. It sorts photos from the device library with swipes, undo and streaks, and uses the system trash/delete dialogs. A small Kotlin module (`app/modules/swipeclean-media`) talks to MediaStore.
- `web/` browser demo for Google Photos using the Picker API (read-only scope). It runs in demo mode until `app/config.js` has a Google OAuth `CLIENT_ID`.

## Run
```bash
# Android app
cd android/app && npm install && npm test
bash ../build-apk.sh        # needs a local signing keystore in android/keys/ (not in this repo)

# Web demo
cd web && npm install && npm test  # Playwright test (demo mode + mocked Picker API); needs Google Chrome (CHROME_PATH to override)
```
Publish scripts expect a local `secret-config.json`; source values are placeholders (`YOUR-SITE-SLUG`, `YOUR_SECRET_PATH`, `YOUR_UPDATE_CHANNEL_PATH`).

## Not included (set up locally)
- `android/keys/`: Android signing keystore, its password, and `site-config.json` (site slug, install path, update-channel path) used by `android/build-apk.sh` and the publish scripts.
- `web/secret-config.json` (`slug`, `path_token`): used by `web/publish.sh` and `web/test/live-smoke.js`.
- `web/app/config.js` ships with an empty `CLIENT_ID` (Google OAuth Web client id, add your own) and an empty `LOGIN_HINT` (optional email to pre-select in Google's sign-in). Demo mode works without either.
- The shell scripts (`*/publish.sh`, `android/build-apk.sh`, `android/tools/make_site.sh`) still point at the original author's working folder (`/workspace/photo-cleanup`); change those paths before running them elsewhere.
- The demo photos in `web/app/demo/` are generated placeholders (`python3 web/tools/make_demo.py`), not real photos.
