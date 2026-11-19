// Pure helpers for the update check (no React Native imports, so tests can run them in Node).
export const REPO = 'JadaE/swipe-clean';
export const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
export type UpdateInfo = { versionName: string; apkUrl: string; notes: string };

/** "v0.0.7" / "0.0.7" -> [0,0,7]; anything else -> null. */
export function parseVersion(v: unknown): number[] | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
/** a > b ? */
export function newerThan(a: number[], b: number[]) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
/** Turns a GitHub "latest release" JSON object into UpdateInfo, or null if it is not a usable, safe release. */
export function parseRelease(j: any): UpdateInfo | null {
  if (!j || j.draft || j.prerelease) return null;
  const v = parseVersion(j.tag_name); if (!v) return null;
  const okLink = (u: unknown, prefix: string): u is string => typeof u === 'string' && u.startsWith(prefix);
  const apk = Array.isArray(j.assets) ? j.assets.find((a: any) => a && typeof a.name === 'string' && /\.apk$/i.test(a.name)
    && okLink(a.browser_download_url, `https://github.com/${REPO}/releases/download/`)) : null;
  const page = okLink(j.html_url, `${RELEASES_PAGE}/`) ? j.html_url : RELEASES_PAGE;
  return { versionName: v.join('.'), apkUrl: apk ? apk.browser_download_url : page, notes: String(j.body || '').slice(0, 400) };
}
