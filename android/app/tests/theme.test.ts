import assert from 'node:assert/strict';
import * as Th from '../src/theme';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/settings';
let n = 0; const t = (name: string, f: () => void) => { f(); n++; console.log('PASS', name); };

t('new installs default to Dark', () => { assert.equal(DEFAULT_SETTINGS.theme, 'dark'); assert.equal(migrateSettings(undefined).theme, 'dark'); });
t('older saves without a theme migrate to Dark and keep their other settings', () => {
  const old = { goalMin: 10, reminder: true, remHour: 7, remMin: 30, cautionDays: 14, seenWelcome: true, lastUpdateCheck: 5, soundOn: false, showStreak: false, monthSort: 'size', lilOn: false, lilCalm: true };
  const m = migrateSettings(old);
  assert.equal(m.theme, 'dark'); assert.equal(m.goalMin, 10); assert.equal(m.lilOn, false); assert.equal(m.lilCalm, true); assert.equal(m.monthSort, 'size');
  const v4 = migrateSettings({ goalMin: 20, seenWelcome: true }); // before Lil existed
  assert.equal(v4.theme, 'dark'); assert.equal(v4.lilOn, true); assert.equal(v4.lilCalm, false);
});
t('a saved choice is kept; junk falls back to Dark', () => {
  for (const v of ['dark', 'light', 'system'] as const) assert.equal(migrateSettings({ theme: v }).theme, v);
  for (const v of ['', 'auto', null, 3]) assert.equal(migrateSettings({ theme: v }).theme, 'dark');
});
t('resolveTheme: Dark / Light fixed, Match my phone follows the phone', () => {
  assert.equal(Th.resolveTheme('dark', 'light'), 'dark'); assert.equal(Th.resolveTheme('light', 'dark'), 'light');
  assert.equal(Th.resolveTheme('system', 'light'), 'light'); assert.equal(Th.resolveTheme('system', 'dark'), 'dark');
  assert.equal(Th.resolveTheme('system', null), 'dark'); assert.equal(Th.resolveTheme(undefined, 'light'), 'dark');
});
t('applyTheme swaps the live palette and tells listeners', () => {
  let calls = 0; Th.onTheme(() => calls++);
  assert.equal(Th.C.bg, Th.DARK.bg);
  assert.equal(Th.applyTheme('light'), true); assert.equal(Th.C.bg, '#fff6ea'); assert.equal(Th.G.bg[0], Th.LIGHT_G.bg[0]); assert.equal(Th.themeName(), 'light');
  assert.equal(Th.applyTheme('light'), false); assert.equal(calls, 1);
  Th.applyTheme('dark'); assert.deepEqual({ ...Th.C }, Th.DARK); assert.equal(calls, 2);
});
t('both palettes define the same colours', () => assert.deepEqual(Object.keys(Th.LIGHT).sort(), Object.keys(Th.DARK).sort()));
t('light theme text meets WCAG AA (4.5:1)', () => {
  const L = Th.LIGHT; const pairs: [string, string][] = [];
  for (const fg of ['ink', 'mut', 'dim', 'remove', 'keep', 'later', 'acc', 'warn', 'teal'] as const) for (const bg of ['bg', 'card', 'card2'] as const) pairs.push([L[fg], L[bg]]);
  for (const bg of ['acc', 'keep', 'remove', 'later'] as const) pairs.push([L.onAcc, L[bg]]);
  pairs.push([L.remove, L.pileBg], [L.remove, L.removeBg], [L.keep, L.keepBg], [L.later, L.laterBg], [L.teal, L.shareBg], [L.dangerInk, L.dangerBg], [L.warn, L.warnBg], [L.ink, L.selBg]);
  for (const h of Th.LIGHT_G.hero) pairs.push([L.heroInk, h], [L.ink, h], [L.dim, h]);
  for (const [a, b] of pairs) assert.ok(Th.contrast(a, b) >= 4.5, `${a} on ${b}: ${Th.contrast(a, b).toFixed(2)}`);
});
console.log(`theme: ${n} passed`);
