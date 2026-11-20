// Shared helpers around the flavor's fetchLatest (channel.store.ts or channel.personal.ts,
// copied to the gitignored channel.ts by tools/gen-channel.sh from SC_FLAVOR).
// The only network call in the app is that update check, at most once a day (or when you tap
// "Check for updates"). No account, no token, and it never sends anything about your photos.
// Offline or any error: it quietly reports "no update".
// Downloading an update opens the browser on the release's .apk (or the release page).
import { Linking } from 'react-native';
import { VERSION_NAME } from './version';
import { parseVersion, newerThan, UpdateInfo } from './release';
import { fetchLatest } from './channel';
export type { UpdateInfo };
export { fetchLatest };
export const isNewer = (u: UpdateInfo | null, current = VERSION_NAME) => {
  const a = u && parseVersion(u.versionName), b = parseVersion(current);
  return !!a && !!b && newerThan(a, b);
};
export const openDownload = (u: UpdateInfo) => Linking.openURL(u.apkUrl);
