// Trash check: keeps Stats in line with what MediaStore really says about items Swipe Clean moved to the trash.
// Pure functions, no React and no native calls, so they can be unit-tested. The native side (mediaStatus) is READ-ONLY:
// it only looks rows up by id (trashed rows included) and never changes, restores or deletes anything.
import { DAY } from './logic';
import { TRASH_DAYS, type RemovalRec } from './stats';

export type MediaState = 'present' | 'trashed' | 'gone' | 'unknown';
/** What MediaStore says about one recorded item right now. expiresAt = when Android plans to empty it from the trash (ms). */
export type Status = { uri: string; state: MediaState; expiresAt?: number; bytes?: number; name?: string | null };

/** Records the trash check still has to look at: moved to trash, not yet seen emptied, not put back. */
export const needsCheck = (r: RemovalRec) => r.mode === 'trash' && !r.restored && !r.freedAt;

/** MediaStore content URI for an app item id ('i123' = photo, 'v45' = video), or null for anything else. */
export function uriForId(id: string): string | null {
  const m = /^([iv])(\d+)$/.exec(id); if (!m) return null;
  return `content://media/external/${m[1] === 'v' ? 'video' : 'images'}/media/${m[2]}`;
}

/** Items in the Pile that have no removal record (or only one that was put back). Before v0.0.7 a move to the trash
 * through the Pile was never recorded (see recover), so these are the ones worth looking up. Only ids we can map. */
export function pileWithoutRecord(decisions: Record<string, string>, removed: Record<string, RemovalRec>): string[] {
  return Object.keys(decisions).filter(id => decisions[id] === 'remove' && (!removed[id] || removed[id].restored) && !!uriForId(id));
}

export type Reconciled<R extends RemovalRec> = { removed: Record<string, R>; freed: string[]; restored: string[]; stillInTrash: string[]; changed: boolean };
/**
 * Applies a trash check to the saved records. Rules (per record that needsCheck):
 * - row is gone            -> emptied from the trash: freedAt = when we saw it (never backdated). Only trusted with full
 *                             photo/video access, because with partial access a row we can't see may still exist.
 * - row is in the trash    -> still in trash; keep Android's planned empty date (expiresAt); checkedAt = now.
 * - row is back, not trash -> put back outside Swipe Clean: restored + restoredAt, no longer counted.
 * - couldn't check         -> unchanged (Stats falls back to the 30-day estimate).
 * Returns a new object; never drops a record.
 */
export function reconcile<R extends RemovalRec>(removed: Record<string, R>, statuses: Status[], now: number, fullAccess: boolean): Reconciled<R> {
  const by = new Map(statuses.map(s => [s.uri, s])); const out: Record<string, R> = { ...removed };
  const freed: string[] = [], restored: string[] = [], stillInTrash: string[] = [];
  for (const [id, r] of Object.entries(removed)) {
    if (!needsCheck(r)) continue; const s = by.get(r.uri); if (!s) continue;
    if (s.state === 'gone' && fullAccess) { out[id] = { ...r, freedAt: now, checkedAt: now }; freed.push(id); }
    else if (s.state === 'trashed') { out[id] = { ...r, checkedAt: now, ...(s.expiresAt ? { expiresAt: s.expiresAt } : {}) }; stillInTrash.push(id); }
    else if (s.state === 'present') { out[id] = { ...r, restored: true, restoredAt: now, restoredOutside: true, checkedAt: now }; restored.push(id); }
  }
  return { removed: out, freed, restored, stillInTrash, changed: freed.length + restored.length + stillInTrash.length > 0 };
}

/**
 * Rebuilds records the v0.0.6 bug lost: Pile items that are sitting in Android's trash now but were never recorded.
 * Size, name and the planned empty date come from MediaStore. The trash time is estimated from Android's empty date
 * (30 days before it), never later than now. Marked recovered so the CSV and Stats can say so.
 */
export function recover(ids: string[], statuses: Status[], now: number): RemovalRec[] {
  const by = new Map(statuses.map(s => [s.uri, s])); const out: RemovalRec[] = [];
  for (const id of ids) {
    const uri = uriForId(id); const s = uri ? by.get(uri) : undefined;
    if (!uri || !s || s.state !== 'trashed' || !(Number(s.bytes) >= 0)) continue;
    const at = s.expiresAt ? Math.min(now, s.expiresAt - TRASH_DAYS * DAY) : now;
    out.push({ id, uri, filename: s.name ?? null, bytes: Number(s.bytes), at, mode: 'trash', kind: id[0] === 'v' ? 'video' : 'photo', recovered: true, checkedAt: now, ...(s.expiresAt ? { expiresAt: s.expiresAt } : {}) } as RemovalRec);
  }
  return out;
}

/** Ids from pileWithoutRecord that are no longer on the phone at all (size unknown, so not counted). Full access only. */
export const goneWithoutRecord = (ids: string[], statuses: Status[], fullAccess: boolean) => {
  if (!fullAccess) return [] as string[]; const by = new Map(statuses.map(s => [s.uri, s]));
  return ids.filter(id => by.get(uriForId(id)!)?.state === 'gone');
};

/** After Android's own dialog said OK: which items really changed. Trash: anything not still on the phone outside the
 * trash. Delete: anything not found any more. 'unknown' (couldn't check) trusts Android's OK, as before. */
export function confirmed(uris: string[], statuses: Status[], mode: 'trash' | 'delete'): Set<string> {
  const by = new Map(statuses.map(s => [s.uri, s.state]));
  return new Set(uris.filter(u => { const st = by.get(u) || 'unknown'; return mode === 'trash' ? st !== 'present' : st === 'gone' || st === 'unknown'; }));
}
/** After a put-back: only items that are on the phone again (not in the trash) count as put back. */
export const putBack = (uris: string[], statuses: Status[]) => new Set(statuses.filter(s => s.state === 'present' && uris.includes(s.uri)).map(s => s.uri));
