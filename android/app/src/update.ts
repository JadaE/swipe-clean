// The ONLY network call in the app: an anonymous GET of the public "latest release" record for this app's
// GitHub repository (personal build: its private update file instead, see channel.ts), at most once a day (or when
// you tap "Check for updates"). No account, no token, and it never sends anything about your photos.
// Offline or any error: it quietly reports "no update".
// Downloading an update opens the browser on the release's .apk (or the release page).
import { Linking } from 'react-native';
import { VERSION_NAME } from './version';
import { LATEST_URL, parseRelease, parseChannelFile, parseVersion, newerThan, UpdateInfo } from './release';
import { PRIVATE_SITE, PRIVATE_UPDATE_URL } from './channel';
export type { UpdateInfo };
/** loud=false (the daily check): never throws. loud=true (the Settings button): throws when offline, so it can say so. */
export async function fetchLatest(loud = false): Promise<UpdateInfo | null> {
  try {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), 10000) : null;
    try {
      if (PRIVATE_UPDATE_URL && PRIVATE_SITE) {
        const r = await fetch(PRIVATE_UPDATE_URL + '?t=' + Date.now(), { method: 'GET', headers: { Accept: 'application/json' }, signal: ctl?.signal });
        if (!r.ok) return null;
        return parseChannelFile(await r.json(), PRIVATE_SITE);
      }
      const r = await fetch(LATEST_URL, { method: 'GET', headers: { Accept: 'application/vnd.github+json' }, signal: ctl?.signal });
      if (!r.ok) return null; // 404 = no release yet, 403 = rate limited: both just mean "nothing new"
      return parseRelease(await r.json());
    } finally { if (t) clearTimeout(t); }
  } catch (e) { if (loud) throw e; return null; } // offline / timeout / bad JSON
}
export const isNewer = (u: UpdateInfo | null, current = VERSION_NAME) => {
  const a = u && parseVersion(u.versionName), b = parseVersion(current);
  return !!a && !!b && newerThan(a, b);
};
export const openDownload = (u: UpdateInfo) => Linking.openURL(u.apkUrl);
