// Export / import of Swipe Clean's saved data as ONE local JSON file (Settings > Move your data).
// Pure functions, no React Native, so they're unit-tested in tests/transfer.test.ts.
// Only app data moves: decisions, pile order, removal records, daily stats, storage readings and settings.
// Nothing here touches, trashes or deletes any photo or video, and nothing is sent anywhere.
import type { Decision, DayLog, HistEntry } from './logic';
import type { RemovalRec, StorageSnap } from './stats';
import { migrateSettings, type Settings } from './settings';

export const SCHEMA = 'swipeclean-export';
export const SCHEMA_VERSION = 1;
/** Files bigger than this are refused before parsing. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_ITEMS = 500000;

export type Removed = RemovalRec & { filename: string | null };
/** Same shape as store.Saved (kept here so this file has no React Native imports). */
export type SavedData = {
  decisions: Record<string, Decision>; decidedAt?: Record<string, number>; history: HistEntry[]; front: string[];
  days: Record<string, DayLog>; removed: Record<string, Removed>; settings: Settings; storageLog: StorageSnap[]; statsSince?: number;
};
export type ExportFile = { schema: typeof SCHEMA; schemaVersion: number; appVersion: string; exportedAt: number; data: SavedData };

export const exportName = (dayKey: string) => `SwipeClean-export-${dayKey}.json`;
export function buildExport(s: SavedData, appVersion: string, now = Date.now()): ExportFile {
  const data: SavedData = { decisions: s.decisions, decidedAt: s.decidedAt || {}, history: s.history.slice(-5000), front: s.front, days: s.days,
    removed: s.removed, settings: s.settings, storageLog: s.storageLog };
  if (s.statsSince !== undefined) data.statsSince = s.statsSince;
  return { schema: SCHEMA, schemaVersion: SCHEMA_VERSION, appVersion, exportedAt: now, data };
}
export const exportText = (s: SavedData, appVersion: string, now = Date.now()) => JSON.stringify(buildExport(s, appVersion, now));

// ---- strict validation ----
class Bad extends Error {}
const fail = (m: string): never => { throw new Bad(m); };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, w: string) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fail(w));
const optNum = (v: unknown, w: string) => (v === undefined ? undefined : num(v, w));
const optBool = (v: unknown, w: string) => (v === undefined || typeof v === 'boolean' ? v : fail(w));
const onlyKeys = (o: Record<string, unknown>, allowed: string[], w: string) => { for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${w}: unknown field`); };
const ID = /^[iv]\d{1,19}$/;
const DAYKEY = /^\d{4}-\d{2}-\d{2}$/;
const DECISIONS: Decision[] = ['keep', 'remove', 'later'];
const URI = /^content:\/\/media\/[\w/.-]{1,200}$/;
const cap = (n: number, w: string) => { if (n > MAX_ITEMS) fail(`${w}: too many entries`); };
const dec = (v: unknown, w: string) => (DECISIONS.includes(v as Decision) ? (v as Decision) : fail(w));

function vDecisions(v: unknown) {
  if (!isObj(v)) return fail('decisions'); const e = Object.entries(v); cap(e.length, 'decisions');
  const o: Record<string, Decision> = {}; for (const [k, d] of e) { if (!ID.test(k)) fail('decisions: bad item id'); o[k] = dec(d, 'decisions: bad value'); } return o;
}
function vStamps(v: unknown) {
  if (v === undefined) return {}; if (!isObj(v)) return fail('decidedAt'); const e = Object.entries(v); cap(e.length, 'decidedAt');
  const o: Record<string, number> = {}; for (const [k, t] of e) { if (!ID.test(k)) fail('decidedAt: bad item id'); o[k] = num(t, 'decidedAt: bad time'); } return o;
}
function vHistory(v: unknown): HistEntry[] {
  if (!Array.isArray(v)) return fail('history'); cap(v.length, 'history');
  return v.map(h => { if (!isObj(h)) return fail('history entry'); onlyKeys(h, ['id', 'prev', 'next'], 'history entry');
    if (typeof h.id !== 'string' || !ID.test(h.id)) fail('history: bad item id');
    return { id: h.id as string, prev: h.prev === null ? null : dec(h.prev, 'history: bad value'), next: h.next === null ? null : dec(h.next, 'history: bad value') }; });
}
function vFront(v: unknown): string[] {
  if (!Array.isArray(v)) return fail('front'); cap(v.length, 'front');
  return v.map(x => (typeof x === 'string' && ID.test(x) ? x : fail('front: bad item id')));
}
function vDays(v: unknown) {
  if (!isObj(v)) return fail('days'); const e = Object.entries(v); cap(e.length, 'days'); const o: Record<string, DayLog> = {};
  for (const [k, d] of e) {
    if (!DAYKEY.test(k) || !isObj(d) || d.date !== k) fail('days: bad day');
    const x = d as Record<string, unknown>; onlyKeys(x, ['date', 'activeMs', 'decided', 'trashedBytes', 'deletedBytes', 'lastActionAt'], 'days');
    const day: DayLog = { date: k, activeMs: num(x.activeMs, 'days: activeMs'), decided: num(x.decided, 'days: decided'), trashedBytes: num(x.trashedBytes, 'days: trashedBytes'), deletedBytes: num(x.deletedBytes, 'days: deletedBytes') };
    const la = optNum(x.lastActionAt, 'days: lastActionAt'); if (la !== undefined) day.lastActionAt = la;
    o[k] = day;
  }
  return o;
}
const REC_KEYS = ['id', 'uri', 'bytes', 'at', 'mode', 'restored', 'kind', 'restoredAt', 'filename', 'freedAt', 'expiresAt', 'checkedAt', 'restoredOutside', 'recovered'];
function vRemoved(v: unknown) {
  if (!isObj(v)) return fail('removed'); const e = Object.entries(v); cap(e.length, 'removed'); const o: Record<string, Removed> = {};
  for (const [k, r] of e) {
    if (!ID.test(k) || !isObj(r) || r.id !== k) fail('removed: bad record id');
    const x = r as Record<string, unknown>; onlyKeys(x, REC_KEYS, 'removed');
    if (typeof x.uri !== 'string' || !URI.test(x.uri)) fail('removed: bad uri');
    if (x.mode !== 'trash' && x.mode !== 'delete') fail('removed: bad mode');
    if (x.kind !== undefined && x.kind !== 'photo' && x.kind !== 'video') fail('removed: bad kind');
    if (x.filename !== undefined && x.filename !== null && (typeof x.filename !== 'string' || x.filename.length > 300)) fail('removed: bad filename');
    const rec: Removed = { id: k, uri: x.uri as string, bytes: num(x.bytes, 'removed: bytes'), at: num(x.at, 'removed: at'), mode: x.mode as 'trash' | 'delete', filename: (x.filename as string | null | undefined) ?? null };
    if (x.kind !== undefined) rec.kind = x.kind as 'photo' | 'video';
    for (const f of ['restoredAt', 'freedAt', 'expiresAt', 'checkedAt'] as const) { const t = optNum(x[f], 'removed: ' + f); if (t !== undefined) rec[f] = t; }
    for (const f of ['restored', 'restoredOutside', 'recovered'] as const) { const b = optBool(x[f], 'removed: ' + f); if (b !== undefined) rec[f] = b; }
    o[k] = rec;
  }
  return o;
}
function vStorage(v: unknown): StorageSnap[] {
  if (!Array.isArray(v)) return fail('storageLog'); cap(v.length, 'storageLog');
  return v.map(s => { if (!isObj(s)) return fail('storageLog entry'); onlyKeys(s, ['at', 'used', 'total', 'tag'], 'storageLog');
    if (s.tag !== 'baseline' && s.tag !== 'before' && s.tag !== 'after') fail('storageLog: bad tag');
    return { at: num(s.at, 'storageLog: at'), used: num(s.used, 'storageLog: used'), total: num(s.total, 'storageLog: total'), tag: s.tag as StorageSnap['tag'] }; });
}
const SETTING_TYPES: Record<string, string> = { goalMin: 'number', reminder: 'boolean', remHour: 'number', remMin: 'number', cautionDays: 'number', seenWelcome: 'boolean',
  lastUpdateCheck: 'number', soundOn: 'boolean', showStreak: 'boolean', monthSort: 'string', lilOn: 'boolean', lilCalm: 'boolean', theme: 'string' };
function vSettings(v: unknown): Settings {
  if (!isObj(v)) return fail('settings'); onlyKeys(v, Object.keys(SETTING_TYPES), 'settings');
  for (const [k, x] of Object.entries(v)) if (typeof x !== SETTING_TYPES[k]) fail('settings: bad ' + k);
  if (v.monthSort !== undefined && v.monthSort !== 'date' && v.monthSort !== 'size') fail('settings: bad monthSort');
  if (v.theme !== undefined && !['dark', 'light', 'system'].includes(v.theme as string)) fail('settings: bad theme');
  return migrateSettings(v);
}

export type ImportResult = { ok: true; file: ExportFile } | { ok: false; error: string };
/** Strict: anything unknown, malformed or too big is refused with a short reason (never echoes file content). */
export function parseImport(text: string, byteLength = text.length): ImportResult {
  try {
    if (byteLength > MAX_IMPORT_BYTES || text.length > MAX_IMPORT_BYTES) fail('file is too big');
    let j: unknown; try { j = JSON.parse(text); } catch { fail('not a Swipe Clean export (not JSON)'); }
    if (!isObj(j)) return fail('not a Swipe Clean export');
    onlyKeys(j, ['schema', 'schemaVersion', 'appVersion', 'exportedAt', 'data'], 'file');
    if (j.schema !== SCHEMA) fail('not a Swipe Clean export');
    if (j.schemaVersion !== SCHEMA_VERSION) fail('made by a newer or unknown version of Swipe Clean');
    if (typeof j.appVersion !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(j.appVersion)) fail('bad appVersion');
    const exportedAt = num(j.exportedAt, 'bad exportedAt');
    const d = j.data; if (!isObj(d)) return fail('missing data');
    onlyKeys(d, ['decisions', 'decidedAt', 'history', 'front', 'days', 'removed', 'settings', 'storageLog', 'statsSince'], 'data');
    const data: SavedData = { decisions: vDecisions(d.decisions), decidedAt: vStamps(d.decidedAt), history: vHistory(d.history), front: vFront(d.front),
      days: vDays(d.days), removed: vRemoved(d.removed), settings: vSettings(d.settings), storageLog: vStorage(d.storageLog) };
    const since = optNum(d.statsSince, 'bad statsSince'); if (since !== undefined) data.statsSince = since;
    return { ok: true, file: { schema: SCHEMA, schemaVersion: SCHEMA_VERSION, appVersion: j.appVersion as string, exportedAt, data } };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, error: e.message };
    return { ok: false, error: 'could not read the file' };
  }
}

// ---- merge (idempotent: importing the same file twice changes nothing the second time) ----
export type ImportSummary = {
  decisions: number; keep: number; remove: number; later: number; newDecisions: number; changedDecisions: number;
  days: number; removed: number; newRemoved: number; appVersion: string; exportedAt: number;
};
const recTime = (r: RemovalRec) => Math.max(r.at, r.freedAt || 0, r.restoredAt || 0, r.checkedAt || 0);
const maxDay = (a: DayLog, b: DayLog): DayLog => {
  const d: DayLog = { date: a.date, activeMs: Math.max(a.activeMs, b.activeMs), decided: Math.max(a.decided, b.decided),
    trashedBytes: Math.max(a.trashedBytes, b.trashedBytes), deletedBytes: Math.max(a.deletedBytes, b.deletedBytes) };
  const la = Math.max(a.lastActionAt || 0, b.lastActionAt || 0); if (la) d.lastActionAt = la;
  return d;
};
/** Which decision wins for one item: the newer timestamp; a timestamped one beats an untimed one; with no times, this phone's stays. */
function pick(mine: Decision | undefined, mineAt: number | undefined, theirs: Decision, theirsAt: number | undefined): 'mine' | 'theirs' {
  if (mine === undefined) return 'theirs';
  if (mine === theirs) return (theirsAt || 0) > (mineAt || 0) ? 'theirs' : 'mine';
  if (theirsAt !== undefined && (mineAt === undefined || theirsAt > mineAt)) return 'theirs';
  return 'mine';
}
/**
 * Merges an import into this phone's data.
 * - Decisions: union by item id; newest decision wins (see pick).
 * - Daily stats: per day, the larger of each number (never summed), so a second import of the same file, or of an
 *   overlapping one, can't double-count. If both apps were used on the same day, that day shows the bigger app's numbers.
 * - Removal records: union by item id; for the same item, the record with the newest activity is kept.
 * - Pile order and storage readings: union without duplicates. Settings: the file's, except this phone's reminder and update-check time.
 * - Undo history stays this phone's own (undo shouldn't reach into another app's swipes).
 */
export function mergeImport(cur: SavedData, file: ExportFile): { data: SavedData; summary: ImportSummary } {
  const inc = file.data;
  const decisions = { ...cur.decisions }; const decidedAt = { ...(cur.decidedAt || {}) };
  let newDecisions = 0, changedDecisions = 0;
  for (const [id, d] of Object.entries(inc.decisions)) {
    const theirsAt = inc.decidedAt?.[id];
    if (pick(decisions[id], decidedAt[id], d, theirsAt) === 'theirs') {
      if (decisions[id] === undefined) newDecisions++; else if (decisions[id] !== d) changedDecisions++;
      decisions[id] = d; if (theirsAt !== undefined) decidedAt[id] = theirsAt;
    }
  }
  const days = { ...cur.days };
  for (const [k, d] of Object.entries(inc.days)) days[k] = days[k] ? maxDay(days[k], d) : d;
  const removed = { ...cur.removed }; let newRemoved = 0;
  for (const [id, r] of Object.entries(inc.removed)) {
    if (!removed[id]) { removed[id] = r; newRemoved++; } else if (recTime(r) > recTime(removed[id])) removed[id] = r;
  }
  const seen = new Set(cur.front); const front = cur.front.concat(inc.front.filter(id => !seen.has(id) && (seen.add(id), true)));
  const snapKey = (s: StorageSnap) => `${s.at}|${s.tag}`; const have = new Set(cur.storageLog.map(snapKey));
  const storageLog = cur.storageLog.concat(inc.storageLog.filter(s => !have.has(snapKey(s)) && (have.add(snapKey(s)), true))).sort((a, b) => a.at - b.at);
  const settings: Settings = { ...inc.settings, lastUpdateCheck: cur.settings.lastUpdateCheck, seenWelcome: cur.settings.seenWelcome || inc.settings.seenWelcome,
    reminder: cur.settings.reminder, remHour: cur.settings.remHour, remMin: cur.settings.remMin }; // the reminder is scheduled per phone
  const since = [cur.statsSince, inc.statsSince].filter((x): x is number => typeof x === 'number');
  const data: SavedData = { ...cur, decisions, decidedAt, days, removed, front, storageLog, settings };
  if (since.length) data.statsSince = Math.min(...since);
  const vals = Object.values(inc.decisions);
  return { data, summary: { decisions: vals.length, keep: vals.filter(v => v === 'keep').length, remove: vals.filter(v => v === 'remove').length,
    later: vals.filter(v => v === 'later').length, newDecisions, changedDecisions, days: Object.keys(inc.days).length,
    removed: Object.keys(inc.removed).length, newRemoved, appVersion: file.appVersion, exportedAt: file.exportedAt } };
}
