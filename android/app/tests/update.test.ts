import assert from 'node:assert/strict';
import * as R from '../src/release';
import { VERSION_NAME } from '../src/version';
let n = 0; const t = (name: string, f: () => void) => { f(); n++; console.log('PASS', name); };
const rel = (o: any = {}) => ({ tag_name: 'v0.0.8', draft: false, prerelease: false, html_url: `${R.RELEASES_PAGE}/tag/v0.0.8`, body: 'notes',
  assets: [{ name: 'SwipeClean-v0.0.8.apk', browser_download_url: `https://github.com/${R.REPO}/releases/download/v0.0.8/SwipeClean-v0.0.8.apk` }], ...o });

t('checks the public GitHub latest-release API, with no here.now link', () => {
  assert.equal(R.LATEST_URL, 'https://api.github.com/repos/JadaE/swipe-clean/releases/latest');
  assert.ok(!/here\.now/.test(R.LATEST_URL + R.RELEASES_PAGE));
});
t('parses tags with or without a leading v, rejects junk', () => {
  assert.deepEqual(R.parseVersion('v0.0.7'), [0, 0, 7]); assert.deepEqual(R.parseVersion('1.2.3'), [1, 2, 3]);
  for (const j of ['', 'v1.2', 'latest', 'v1.2.3-beta', null, 7]) assert.equal(R.parseVersion(j as any), null);
});
t('compares versions numerically', () => {
  assert.ok(R.newerThan([0, 0, 10], [0, 0, 9])); assert.ok(R.newerThan([0, 1, 0], [0, 0, 99]));
  assert.ok(!R.newerThan([0, 0, 7], [0, 0, 7])); assert.ok(!R.newerThan([0, 0, 6], [0, 0, 7]));
});
t('a release links straight to its .apk asset', () => {
  const u = R.parseRelease(rel())!; assert.equal(u.versionName, '0.0.8'); assert.ok(u.apkUrl.endsWith('/releases/download/v0.0.8/SwipeClean-v0.0.8.apk'));
});
t('no apk asset: falls back to the release page', () => {
  assert.equal(R.parseRelease(rel({ assets: [] }))!.apkUrl, `${R.RELEASES_PAGE}/tag/v0.0.8`);
});
t('links outside this repo are never used', () => {
  const u = R.parseRelease(rel({ html_url: 'https://evil.example/x', assets: [{ name: 'x.apk', browser_download_url: 'https://evil.example/x.apk' }] }))!;
  assert.equal(u.apkUrl, R.RELEASES_PAGE);
});
t('drafts, prereleases, bad tags and junk give no update', () => {
  for (const j of [null, undefined, {}, 'x', rel({ draft: true }), rel({ prerelease: true }), rel({ tag_name: 'nightly' })]) assert.equal(R.parseRelease(j), null);
});
t('the current version is a valid x.y.z', () => { assert.ok(R.parseVersion(VERSION_NAME)); });
console.log(`update: ${n} passed`);
