// Local-only persistence (AsyncStorage on this phone). Stores decisions keyed by MediaStore id, never image data.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Decision, HistEntry, DayLog } from './logic';
import type { StorageSnap } from './stats';
import { Settings, DEFAULT_SETTINGS, migrateSettings } from './settings';
export { DEFAULT_SETTINGS, migrateSettings }; export type { Settings };

export type Removed = { id: string; uri: string; filename: string | null; bytes: number; at: number; mode: 'trash' | 'delete'; restored?: boolean; kind?: 'photo' | 'video'; restoredAt?: number };
export type Saved = { decisions: Record<string, Decision>; history: HistEntry[]; front: string[]; days: Record<string, DayLog>; removed: Record<string, Removed>; settings: Settings; storageLog: StorageSnap[]; statsSince?: number };
const KEY = 'swipeclean:v1';
export async function load(): Promise<Saved> {
  let s: any = null; try { s = JSON.parse((await AsyncStorage.getItem(KEY)) || 'null'); } catch {}
  return { decisions: s?.decisions || {}, history: s?.history || [], front: s?.front || [], days: s?.days || {}, removed: s?.removed || {}, storageLog: s?.storageLog || [], statsSince: s?.statsSince, settings: migrateSettings(s?.settings) };
}
// Saved after EVERY swipe. Writes are serialised: if one is in flight, the newest state is written right after it.
// History is capped at 5,000 steps on disk (unlimited while the app is open).
let writing: Promise<void> | null = null; let next: Saved | null = null;
async function writeLoop() {
  while (next) { const s = next; next = null;
    try { await AsyncStorage.setItem(KEY, JSON.stringify({ ...s, history: s.history.slice(-5000) })); } catch (e) { if (!next) next = s; await new Promise(r => setTimeout(r, 500)); } }
  writing = null;
}
export function save(s: Saved) { next = s; if (!writing) writing = writeLoop(); }
export async function flush() { if (writing) await writing; }
export async function clearAll() { next = null; if (writing) await writing; await AsyncStorage.removeItem(KEY); }
