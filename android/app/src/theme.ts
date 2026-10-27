// Two palettes. Dark (default): deep blue-violet night. Light: the icon's cream with navy text.
// Keep = sage green, Remove pile = soft coral, Later = lavender, accent = blue-violet, in both.
// Pure module (no React Native) so the palettes and the theme choice can be unit-tested.
export type ThemeName = 'dark' | 'light';
export type ThemeSetting = 'dark' | 'light' | 'system';

export const DARK = {
  bg: '#0e1020', card: '#181b30', card2: '#22263f', line: '#2e3352', ink: '#eef0fa', mut: '#a3a8c3', dim: '#6f7594',
  remove: '#f08a8a', keep: '#7fd1a8', later: '#c3b0f0', acc: '#8fb2ff', acc2: '#b69cff', warn: '#f2c879', teal: '#6fd3d0',
  // surfaces / text that used to be hard-coded on screens
  onAcc: '#0e1020', heroInk: '#c9cff5', gradLine: '#343a66', warnBg: '#1f1d16', warnLine: '#4a4226',
  pileBg: '#3a2430', removeBg: '#2a1d2c', laterBg: '#231f3a', shareBg: '#18302f', keepBg: '#1b2c2a', selBg: '#2b3366',
  footerBg: 'rgba(15,17,21,0.95)', softBg: 'rgba(255,255,255,0.08)', rowBg: 'rgba(14,16,32,0.45)', scrim: 'rgba(0,0,0,0.6)',
  dangerBg: '#3a1f25', dangerInk: '#ffb8c2', thumbBg: '#0a0b0e',
};
export type Palette = typeof DARK;
export const LIGHT: Palette = {
  bg: '#fff6ea', card: '#ffffff', card2: '#f3e7d6', line: '#e3d5c1', ink: '#1e1b3a', mut: '#4a4766', dim: '#5f5c78',
  remove: '#b93a35', keep: '#2c7350', later: '#6248b8', acc: '#4b55c9', acc2: '#6d4fcf', warn: '#875400', teal: '#1d6f6b',
  onAcc: '#ffffff', heroInk: '#3e3a78', gradLine: '#ddd3ee', warnBg: '#fff0d4', warnLine: '#e5c27a',
  pileBg: '#fbe2de', removeBg: '#fde9e6', laterBg: '#ede7fa', shareBg: '#ddf0ee', keepBg: '#e1f0e7', selBg: '#dcdef8',
  footerBg: 'rgba(255,246,234,0.96)', softBg: 'rgba(30,27,58,0.07)', rowBg: 'rgba(255,255,255,0.75)', scrim: 'rgba(30,27,58,0.45)',
  dangerBg: '#fbe1e3', dangerInk: '#9b2a35', thumbBg: '#e8ddcd',
};
type Grads = { hero: readonly [string, string, string]; ring: readonly [string, string]; keep: readonly [string, string]; remove: readonly [string, string]; btn: readonly [string, string]; bg: readonly [string, string] };
export const DARK_G: Grads = {
  hero: ['#2b2f63', '#3a2d5c', '#1d2a4a'],   // on-this-day hero
  ring: ['#1f2445', '#26214a'],
  keep: ['rgba(127,209,168,0)', 'rgba(127,209,168,0.45)'],
  remove: ['rgba(240,138,138,0.45)', 'rgba(240,138,138,0)'],
  btn: ['#8fb2ff', '#b69cff'],
  bg: ['#141735', '#0e1020'],
};
export const LIGHT_G: Grads = {
  hero: ['#e9e6ff', '#f4e6f3', '#e4edf8'],
  ring: ['#ffffff', '#fbf1e3'],
  keep: DARK_G.keep, remove: DARK_G.remove,      // these sit on photos, which stay on a dark viewer in both themes
  btn: ['#4b55c9', '#6d4fcf'],
  bg: ['#fff6ea', '#fbecd8'],
};

/** Live palette. Screens read C / G at render time; applyTheme swaps the values in place. */
export const C: Palette = { ...DARK };
export const G: Grads = { ...DARK_G };
let current: ThemeName = 'dark';
const listeners: (() => void)[] = [];
/** Modules with StyleSheets built from C register a rebuild here. */
export function onTheme(f: () => void) { listeners.push(f); }
export function themeName(): ThemeName { return current; }
export function applyTheme(t: ThemeName) {
  if (t === current) return false;
  current = t; Object.assign(C, t === 'light' ? LIGHT : DARK); Object.assign(G, t === 'light' ? LIGHT_G : DARK_G);
  listeners.forEach(f => f()); return true;
}
/** Settings choice + the phone's scheme -> theme. Anything unknown (older saves) is Dark. */
export function resolveTheme(setting: unknown, phone: string | null | undefined): ThemeName {
  if (setting === 'light') return 'light';
  if (setting === 'system') return phone === 'light' ? 'light' : 'dark';
  return 'dark';
}

// WCAG 2 contrast, for tests
const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); const ch = [n >> 16, (n >> 8) & 255, n & 255].map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]; };
export function contrast(a: string, b: string) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
