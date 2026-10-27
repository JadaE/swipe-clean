// Stats: proof of what Swipe Clean actually removed. Pure functions, no React, so they can be unit-tested.
// Source of truth = the per-item removal records saved only AFTER Android's own dialog confirmed the item is gone
// (PileScreen re-checks with stillPresent). Swiping alone never creates a record, so it never counts.
import { dayKey, DAY, type DayLog } from './logic';

export type Kind = 'photo' | 'video';
export type RemovalRec = { id: string; uri: string; bytes: number; at: number; mode: 'trash' | 'delete'; restored?: boolean; kind?: Kind; restoredAt?: number };
export type StorageSnap = { at: number; used: number; total: number; tag: 'baseline' | 'before' | 'after' };
export type DayStat = { date: string; bytes: number; photos: number; videos: number; photoBytes: number; videoBytes: number; reviewed: number; minutes: number; freedBytes: number };
export const TRASH_DAYS = 30;

/** Older records (v0.0.2/v0.0.3) have no kind; the MediaStore URI tells us: .../images/... vs .../video/... */
export const kindOf = (r: RemovalRec): Kind => r.kind || (/\/video\//.test(r.uri) ? 'video' : 'photo');
/** "Fully freed": permanently deleted, or in Android's trash for 30+ days (Android empties it after ~30 days). */
export const isFreed = (r: RemovalRec, now: number) => !r.restored && (r.mode === 'delete' || now - r.at >= TRASH_DAYS * DAY);

const empty = (date: string): DayStat => ({ date, bytes: 0, photos: 0, videos: 0, photoBytes: 0, videoBytes: 0, reviewed: 0, minutes: 0, freedBytes: 0 });

/** Daily log keyed by LOCAL calendar day of the confirmation time. Items later put back from the trash are excluded. */
export function daily(removed: Record<string, RemovalRec> | RemovalRec[], days: Record<string, DayLog> = {}, now = Date.now()): Record<string, DayStat> {
  const out: Record<string, DayStat> = {};
  for (const r of Array.isArray(removed) ? removed : Object.values(removed)) {
    if (r.restored || !(r.bytes >= 0) || !r.at) continue;
    const k = dayKey(r.at); const d = out[k] || (out[k] = empty(k)); const kind = kindOf(r);
    d.bytes += r.bytes; if (kind === 'video') { d.videos++; d.videoBytes += r.bytes; } else { d.photos++; d.photoBytes += r.bytes; }
    if (isFreed(r, now)) d.freedBytes += r.bytes;
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

/** CSV, one row per day, oldest first. bytes = moved to trash or deleted that day (confirmed by Android). */
export function csv(log: Record<string, DayStat>): string {
  const rows = Object.values(log).sort((a, b) => a.date.localeCompare(b.date));
  return ['date,bytes,photos,videos,reviewed,minutes,bytes_fully_freed', ...rows.map(d => [d.date, d.bytes, d.photos, d.videos, d.reviewed, d.minutes, d.freedBytes].join(','))].join('\n') + '\n';
}
