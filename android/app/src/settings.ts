// Settings shape, defaults and migration of older saves. Pure (no React Native) so it can be tested.
import type { ThemeSetting } from './theme';
export type Settings = { goalMin: number; reminder: boolean; remHour: number; remMin: number; cautionDays: number; seenWelcome: boolean; lastUpdateCheck: number; soundOn: boolean; showStreak: boolean; monthSort: 'date' | 'size'; lilOn: boolean; lilCalm: boolean; theme: ThemeSetting };
export const DEFAULT_SETTINGS: Settings = { goalMin: 15, reminder: false, remHour: 20, remMin: 0, cautionDays: 30, seenWelcome: false, lastUpdateCheck: 0, soundOn: false, showStreak: true, monthSort: 'date', lilOn: true, lilCalm: false, theme: 'dark' };
/** Older saves lack newer keys and get the defaults (theme: Dark). An unknown theme value also falls back to Dark. */
export function migrateSettings(raw: any): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (s.theme !== 'dark' && s.theme !== 'light' && s.theme !== 'system') s.theme = 'dark';
  return s;
}
