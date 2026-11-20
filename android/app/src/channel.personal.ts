// Personal build only. tools/gen-channel.sh copies this file to the gitignored channel.ts when
// SC_FLAVOR=personal. The store build never imports it. The update-file address comes only from
// the gitignored channel.generated.json (written from config.local.json), never from code in git.
import generated from './channel.generated.json';
import { LATEST_URL, parseRelease, parseVersion, fetchUpdateJson, UpdateInfo } from './release';
export type { UpdateInfo };

const g = generated as { privateSlug?: string; privateUpdatePath?: string };
const PRIVATE_SITE: string | null = g.privateSlug ? `https://${g.privateSlug}.here.now/` : null;
const PRIVATE_UPDATE_URL: string | null = PRIVATE_SITE && g.privateUpdatePath ? `${PRIVATE_SITE}${g.privateUpdatePath}/version.json` : null;

export const UPDATE_SOURCE_LABEL = PRIVATE_UPDATE_URL ? 'Updates come from your private install page.' : 'Updates come from the app’s public GitHub releases.';
export const UPDATE_CHECK_SHORT = PRIVATE_UPDATE_URL ? 'to check your private install page for app updates' : 'to check GitHub for app updates';
export const UPDATE_CHECK_LONG = PRIVATE_UPDATE_URL ? 'a once-a-day check of your private install page' : 'a once-a-day check of the app’s public release page on GitHub';

/** version.json ({versionCode, versionName, apkUrl, notes}); the APK link must be on the same site. */
export function parseChannelFile(j: any, site: string): UpdateInfo | null {
  if (!j || !Number.isInteger(j.versionCode) || typeof j.apkUrl !== 'string' || !j.apkUrl.startsWith(site)) return null;
  const v = parseVersion(j.versionName); if (!v) return null;
  return { versionName: v.join('.'), apkUrl: j.apkUrl, notes: String(j.notes || '').slice(0, 400) };
}

/** loud=false (the daily check): never throws. loud=true (the Settings button): throws when offline, so it can say so. */
export async function fetchLatest(loud = false): Promise<UpdateInfo | null> {
  if (PRIVATE_UPDATE_URL && PRIVATE_SITE) {
    const j = await fetchUpdateJson(PRIVATE_UPDATE_URL + '?t=' + Date.now(), 'application/json', loud);
    return j ? parseChannelFile(j, PRIVATE_SITE) : null;
  }
  const j = await fetchUpdateJson(LATEST_URL, 'application/vnd.github+json', loud);
  return j ? parseRelease(j) : null;
}
