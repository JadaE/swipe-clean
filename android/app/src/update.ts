// The ONLY network call in the app: GET a small version file from the app's own here.now site, at most once a day.
// It never sends anything about your photos. Downloading an update opens the browser.
import { Linking } from 'react-native';
import { UPDATE_URL, SITE, VERSION_CODE } from './version';
export type UpdateInfo = { versionCode: number; versionName: string; apkUrl: string; notes: string };
export async function fetchLatest(): Promise<UpdateInfo | null> {
  const r = await fetch(UPDATE_URL + '?t=' + Date.now(), { method: 'GET', headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (!j || !Number.isInteger(j.versionCode) || typeof j.apkUrl !== 'string' || !j.apkUrl.startsWith(SITE)) return null;
  return { versionCode: j.versionCode, versionName: String(j.versionName).slice(0, 20), apkUrl: j.apkUrl, notes: String(j.notes || '').slice(0, 400) };
}
export const isNewer = (u: UpdateInfo | null) => !!u && u.versionCode > VERSION_CODE;
export const openDownload = (u: UpdateInfo) => Linking.openURL(u.apkUrl);
