// Stats: proof of what Swipe Clean actually removed. Pure functions, no React, so they can be unit-tested.
// Source of truth = the per-item removal records saved only AFTER Android's own dialog confirmed the change
// (PileScreen re-checks with mediaStatus). Swiping alone never creates a record, so it never counts.
// Trash: since v0.0.7 the app looks the items up in MediaStore (read-only, see trash.ts), so "fully freed" means the
// trash was really emptied. The old 30-day clock is only a fallback when the phone can't be checked.
import { dayKey, DAY, type DayLog } from './logic';

export type Kind = 'photo' | 'video';
export type RemovalRec = {
  id: string; uri: string; bytes: number; at: number; mode: 'trash' | 'delete'; restored?: boolean; kind?: Kind; restoredAt?: number; filename?: string | null;
  // v0.0.7 trash check (all optional, so records saved by older versions load unchanged):
  freedAt?: number;          // when the app saw the item was no longer in the trash (emptied). Not backdated.
  expiresAt?: number;        // when Android plans to empty it from the trash (MediaStore DATE_EXPIRES)
  checkedAt?: number;        // last time the trash check saw it still in the trash
  restoredOutside?: boolean; // put back from the trash in another app
  recovered?: boolean;       // rebuilt from MediaStore: moved to trash with v0.0.6, which didn't record it
};
export type StorageSnap = { at: number; used: number; total: number; tag: 'baseline' | 'before' | 'after' };
export type DayStat = { date: string; bytes: number; photos: number; videos: number; photoBytes: number; videoBytes: number; reviewed: number; minutes: number; freedBytes: number; trashBytes: number };
export const TRASH_DAYS = 30;
/** A trash check younger than this beats the 30-day estimate. */
export const CHECK_FRESH = 2 * DAY;

/** Older records (v0.0.2/v0.0.3) have no kind; the MediaStore URI tells us: .../images/... vs .../video/... */
export const kindOf = (r: RemovalRec): Kind => r.kind || (/\/video\//.test(r.uri) ? 'video' : 'photo');
/** When Android plans to empty this item from the trash: its own date if we read one, else 30 days after the move. */
export const emptiesAt = (r: RemovalRec) => r.expiresAt || r.at + TRASH_DAYS * DAY;
export type TrashState = 'restored' | 'freed' | 'freed-estimate' | 'in-trash';
/**
 * restored: put back (in the app or elsewhere), not counted. freed: deleted permanently, or seen emptied from the trash.
 * in-trash: still in the trash (seen there recently, or its empty date hasn't come yet).
 * freed-estimate: couldn't check the phone lately and the empty date has passed (old 30-day rule, fallback only).
 */
export function trashState(r: RemovalRec, now: number): TrashState {
  if (r.restored) return 'restored';
  if (r.mode === 'delete' || r.freedAt) return 'freed';
  if (r.checkedAt && now - r.checkedAt < CHECK_FRESH) return 'in-trash';
  return now >= emptiesAt(r) ? 'freed-estimate' : 'in-trash';
}
/** "Fully freed": deleted, or emptied from the trash (seen by the trash check, or estimated when it can't run). */
export const isFreed = (r: RemovalRec, now: number) => { const t = trashState(r, now); return t === 'freed' || t === 'freed-estimate'; };

export type TrashSummary = { bytes: number; count: number; firstEmpty: number | null; lastEmpty: number | null; estimatedFreed: number; restoredOutside: number; recovered: number; lastChecked: number | null };
/** What's still in Android's trash from Swipe Clean, and when Android plans to empty it. */
export function trashSummary(removed: Record<string, RemovalRec> | RemovalRec[], now = Date.now()): TrashSummary {
  const o: TrashSummary = { bytes: 0, count: 0, firstEmpty: null, lastEmpty: null, estimatedFreed: 0, restoredOutside: 0, recovered: 0, lastChecked: null };
  for (const r of Array.isArray(removed) ? removed : Object.values(removed)) {
    if (r.checkedAt) o.lastChecked = Math.max(o.lastChecked || 0, r.checkedAt);
    if (r.restoredOutside) o.restoredOutside++;
    const st = trashState(r, now); if (st === 'restored') continue;
    if (r.recovered) o.recovered++;
    if (st === 'freed-estimate') o.estimatedFreed++;
    if (st !== 'in-trash') continue;
    o.bytes += r.bytes; o.count++; const e = Math.max(now, emptiesAt(r));
    o.firstEmpty = o.firstEmpty === null ? e : Math.min(o.firstEmpty, e); o.lastEmpty = o.lastEmpty === null ? e : Math.max(o.lastEmpty, e);
  }
  return o;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const md = (t: number) => { const d = new Date(t); return `${MON[d.getMonth()]} ${d.getDate()}`; };
/** "empties ~Nov 30" or "empties ~Nov 30 – Dec 4" (local dates). */
export function emptiesLabel(t: TrashSummary): string {
  if (t.firstEmpty === null || t.lastEmpty === null) return '';
  const a = md(t.firstEmpty), b = md(t.lastEmpty); return a === b ? `empties ~${a}` : `empties ~${a} – ${b}`;
}

const empty = (date: string): DayStat => ({ date, bytes: 0, photos: 0, videos: 0, photoBytes: 0, videoBytes: 0, reviewed: 0, minutes: 0, freedBytes: 0, trashBytes: 0 });

/** Daily log keyed by LOCAL calendar day of the confirmation time. Items later put back from the trash are excluded. */
export function daily(removed: Record<string, RemovalRec> | RemovalRec[], days: Record<string, DayLog> = {}, now = Date.now()): Record<string, DayStat> {
  const out: Record<string, DayStat> = {};
  for (const r of Array.isArray(removed) ? removed : Object.values(removed)) {
    if (r.restored || !(r.bytes >= 0) || !r.at) continue;
    const k = dayKey(r.at); const d = out[k] || (out[k] = empty(k)); const kind = kindOf(r);
    d.bytes += r.bytes; if (kind === 'video') { d.videos++; d.videoBytes += r.bytes; } else { d.photos++; d.photoBytes += r.bytes; }
    if (isFreed(r, now)) d.freedBytes += r.bytes; else d.trashBytes += r.bytes;
  }
  for (const [k, l] of Object.entries(days)) { if (!l.decided && !l.activeMs) continue; const d = out[k] || (out[k] = empty(k)); d.reviewed = l.decided || 0; d.minutes = Math.round((l.activeMs || 0) / 60000); }
  return out;
}

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** Monday-start local week. */
export const startOfWeek = (t: number) => { const d = new Date(startOfDay(t)); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d.getTime(); };
export const startOfMonth = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); };
const keyTime = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

export type Totals = { bytes: number; photos: number; videos: number; photoBytes: number; videoBytes: number; freedBytes: number; reviewed: number; minutes: number };
export function sum(list: DayStat[]): Totals {
  return list.reduce((a, d) => ({ bytes: a.bytes + d.bytes, photos: a.photos + d.photos, videos: a.videos + d.videos, photoBytes: a.photoBytes + d.photoBytes, videoBytes: a.videoBytes + d.videoBytes, freedBytes: a.freedBytes + d.freedBytes, reviewed: a.reviewed + d.reviewed, minutes: a.minutes + d.minutes }),
    { bytes: 0, photos: 0, videos: 0, photoBytes: 0, videoBytes: 0, freedBytes: 0, reviewed: 0, minutes: 0 });
}
export function summary(log: Record<string, DayStat>, now = Date.now()) {
  const all = Object.values(log); const since = (t: number) => all.filter(d => keyTime(d.date) >= t);
  const active = all.filter(d => d.bytes > 0);
  const best = active.reduce<DayStat | null>((b, d) => (!b || d.bytes > b.bytes ? d : b), null);
  const total = sum(all);
  return {
    all: total, today: sum(all.filter(d => d.date === dayKey(now))), week: sum(since(startOfWeek(now))), month: sum(since(startOfMonth(now))),
    best, activeDays: active.length, avgPerActiveDay: active.length ? total.bytes / active.length : 0,
    firstDay: all.map(d => d.date).sort()[0] || null,
  };
}

export type Period = 'day' | 'week' | 'month';
/** Bars: last 30 days, last 12 weeks (Mon-start) or last 12 months, oldest first. Empty periods are 0. */
export function series(log: Record<string, DayStat>, period: Period, now = Date.now()): { key: string; label: string; bytes: number }[] {
  const out: { key: string; label: string; bytes: number }[] = [];
  if (period === 'day') {
    const t0 = new Date(startOfDay(now));
    for (let i = 29; i >= 0; i--) { const d = new Date(t0); d.setDate(d.getDate() - i); const k = dayKey(d.getTime()); out.push({ key: k, label: `${d.getMonth() + 1}/${d.getDate()}`, bytes: log[k]?.bytes || 0 }); }
    return out;
  }
  const n = 12; const starts: number[] = [];
  if (period === 'week') { const w = new Date(startOfWeek(now)); for (let i = n - 1; i >= 0; i--) { const d = new Date(w); d.setDate(d.getDate() - 7 * i); starts.push(d.getTime()); } }
  else { const m = new Date(startOfMonth(now)); for (let i = n - 1; i >= 0; i--) starts.push(new Date(m.getFullYear(), m.getMonth() - i, 1).getTime()); }
  for (let i = 0; i < starts.length; i++) {
    const a = starts[i], b = i + 1 < starts.length ? starts[i + 1] : Infinity; const d = new Date(a);
    const bytes = Object.values(log).filter(x => { const t = keyTime(x.date); return t >= a && t < b; }).reduce((s, x) => s + x.bytes, 0);
    out.push({ key: dayKey(a), label: period === 'week' ? `${d.getMonth() + 1}/${d.getDate()}` : d.toLocaleString('en-US', { month: 'short' }), bytes });
  }
  return out;
}

/** CSV, one row per day, oldest first. bytes = moved to trash or deleted that day (confirmed by Android).
 * bytes_fully_freed = of those, deleted or since emptied from the trash; bytes_still_in_trash = the rest (new last column,
 * so older spreadsheets that read columns by position keep working). */
export function csv(log: Record<string, DayStat>): string {
  const rows = Object.values(log).sort((a, b) => a.date.localeCompare(b.date));
  return ['date,bytes,photos,videos,reviewed,minutes,bytes_fully_freed,bytes_still_in_trash', ...rows.map(d => [d.date, d.bytes, d.photos, d.videos, d.reviewed, d.minutes, d.freedBytes, d.trashBytes].join(','))].join('\n') + '\n';
}
