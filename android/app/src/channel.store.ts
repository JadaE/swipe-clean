// Store build: the only update check is an anonymous GET of this app's public GitHub "latest release".
// tools/gen-channel.sh copies this file to the gitignored channel.ts unless SC_FLAVOR=personal.
import { LATEST_URL, parseRelease, fetchUpdateJson, UpdateInfo } from './release';
export type { UpdateInfo };
export const UPDATE_SOURCE_LABEL = 'Updates come from the app’s public GitHub releases.';
export const UPDATE_CHECK_SHORT = 'to check GitHub for app updates';
export const UPDATE_CHECK_LONG = 'a once-a-day check of the app’s public release page on GitHub';
/** loud=false (the daily check): never throws. loud=true (the Settings button): throws when offline, so it can say so. */
export async function fetchLatest(loud = false): Promise<UpdateInfo | null> {
  const j = await fetchUpdateJson(LATEST_URL, 'application/vnd.github+json', loud);
  return j ? parseRelease(j) : null;
}
