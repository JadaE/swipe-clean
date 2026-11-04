// v0.0.7 trash check: Stats follow what MediaStore says, not a 30-day clock.
import assert from 'node:assert/strict';
import * as S from '../src/stats';
import * as T from '../src/trash';
import { DAY } from '../src/logic';
let n = 0; const t = (name: string, f: () => void) => { f(); n++; console.log('PASS', name); };
const at = (y: number, mo: number, d: number, h = 12) => new Date(y, mo - 1, d, h).getTime();
const now = at(2026, 11, 5, 18);
const img = (k: number) => 'content://media/external/images/media/' + k;
const rec = (k: number, o: Partial<S.RemovalRec> = {}): S.RemovalRec => ({ id: 'i' + k, uri: img(k), bytes: 1000, at: at(2026, 11, 1), mode: 'trash', ...o });
const recs = (...l: S.RemovalRec[]) => Object.fromEntries(l.map(r => [r.id, r]));

t('emptied early (row gone) -> freed at the time we saw it, not backdated to day 30', () => {
  const r = T.reconcile(recs(rec(1)), [{ uri: img(1), state: 'gone' }], now, true);
  assert.deepEqual(r.freed, ['i1']); assert.equal(r.removed.i1.freedAt, now);
  assert.equal(S.trashState(r.removed.i1, now), 'freed'); assert.equal(S.isFreed(r.removed.i1, now), true);
});
t('gone is NOT trusted with partial access (row may just be hidden from us)', () => {
  const r = T.reconcile(recs(rec(1)), [{ uri: img(1), state: 'gone' }], now, false);
  assert.equal(r.changed, false); assert.equal(r.removed.i1.freedAt, undefined);
});
t('still in trash -> keeps Android empty date; stays in trash even past day 30 while checks are fresh', () => {
  const exp = at(2026, 12, 1);
  const r = T.reconcile(recs(rec(1, { at: at(2026, 9, 1) })), [{ uri: img(1), state: 'trashed', expiresAt: exp }], now, true);
  const x = r.removed.i1; assert.equal(x.expiresAt, exp); assert.equal(x.checkedAt, now);
  assert.equal(S.trashState(x, now), 'in-trash'); // old rule would have said freed (moved 65 days ago)
  const sum = S.trashSummary(r.removed, now); assert.equal(sum.count, 1); assert.equal(sum.bytes, 1000); assert.equal(S.emptiesLabel(sum), 'empties ~Dec 1');
});
t('put back outside the app -> restored + restoredAt, excluded from totals', () => {
  const r = T.reconcile(recs(rec(1), rec(2)), [{ uri: img(1), state: 'present' }, { uri: img(2), state: 'trashed' }], now, false);
  assert.deepEqual(r.restored, ['i1']); assert.equal(r.removed.i1.restored, true); assert.equal(r.removed.i1.restoredAt, now); assert.equal(r.removed.i1.restoredOutside, true);
  const log = S.daily(r.removed, {}, now); assert.equal(S.summary(log, now).all.bytes, 1000);
  assert.equal(S.trashSummary(r.removed, now).restoredOutside, 1);
});
t('unknown (query could not run) changes nothing; fallback = 30-day estimate', () => {
  const old = rec(1, { at: at(2026, 9, 1) });
  const r = T.reconcile(recs(old), [{ uri: img(1), state: 'unknown' }], now, true); assert.equal(r.changed, false);
  assert.equal(S.trashState(old, now), 'freed-estimate'); assert.equal(S.trashSummary(recs(old), now).estimatedFreed, 1);
  assert.equal(S.trashState(rec(2, { at: at(2026, 11, 1) }), now), 'in-trash');
});
t('stale check (> 2 days) falls back to the empty date', () => {
  const x = rec(1, { checkedAt: now - 3 * DAY, expiresAt: now - DAY });
  assert.equal(S.trashState(x, now), 'freed-estimate');
  assert.equal(S.trashState({ ...x, expiresAt: now + DAY }, now), 'in-trash');
});
t('only open trash records are checked; deleted, freed and restored are left alone', () => {
  const all = recs(rec(1, { mode: 'delete' }), rec(2, { freedAt: now - DAY }), rec(3, { restored: true }), rec(4));
  assert.deepEqual(Object.values(all).filter(T.needsCheck).map(r => r.id), ['i4']);
  const r = T.reconcile(all, [1, 2, 3, 4].map(k => ({ uri: img(k), state: 'present' as const })), now, true);
  assert.deepEqual(r.restored, ['i4']); assert.equal(r.removed.i1.restored, undefined); assert.equal(r.removed.i2.restored, undefined);
});
t('records saved by v0.0.6 (no new fields) load and count as before, nothing dropped', () => {
  const v6 = { r1: { id: 'i9', uri: img(9), filename: 'a.jpg', bytes: 500, at: at(2026, 10, 30), mode: 'trash' as const, kind: 'photo' as const } };
  const log = S.daily(v6, {}, now); assert.equal(S.summary(log, now).all.bytes, 500); assert.equal(S.summary(log, now).all.freedBytes, 0);
  const r = T.reconcile(v6, [], now, true); assert.deepEqual(Object.keys(r.removed), ['r1']); assert.equal(r.changed, false);
});
t('recover: Pile items v0.0.6 trashed without a record are rebuilt from MediaStore (size, name, empty date)', () => {
  const decisions = { i1: 'remove', i2: 'remove', i3: 'remove', i4: 'keep', v5: 'remove', m6: 'remove', i7: 'remove' };
  const removed = recs(rec(7));
  const ids = T.pileWithoutRecord(decisions, removed); assert.deepEqual(ids, ['i1', 'i2', 'i3', 'v5']);
  const exp = at(2026, 11, 30);
  const st: T.Status[] = [{ uri: img(1), state: 'trashed', expiresAt: exp, bytes: 4e6, name: 'x.jpg' }, { uri: img(2), state: 'present', bytes: 1 }, { uri: img(3), state: 'gone' },
    { uri: 'content://media/external/video/media/5', state: 'trashed', bytes: 9e6 }];
  const got = T.recover(ids, st, now);
  assert.equal(got.length, 2);
  assert.deepEqual({ ...got[0] }, { id: 'i1', uri: img(1), filename: 'x.jpg', bytes: 4e6, at: exp - 30 * DAY, mode: 'trash', kind: 'photo', recovered: true, checkedAt: now, expiresAt: exp });
  assert.equal(got[1].kind, 'video'); assert.equal(got[1].at, now);
  assert.deepEqual(T.goneWithoutRecord(ids, st, true), ['i3']); assert.deepEqual(T.goneWithoutRecord(ids, st, false), []);
});
t('after Android says OK: trash counts trashed/gone, not items still on the phone; delete counts gone only', () => {
  const u = [img(1), img(2), img(3), img(4)];
  const st: T.Status[] = [{ uri: img(1), state: 'trashed' }, { uri: img(2), state: 'present' }, { uri: img(3), state: 'gone' }, { uri: img(4), state: 'unknown' }];
  assert.deepEqual([...T.confirmed(u, st, 'trash')], [img(1), img(3), img(4)]);
  assert.deepEqual([...T.confirmed(u, st, 'delete')], [img(3), img(4)]);
  assert.deepEqual([...T.putBack(u, st)], [img(2)]);
});
t('the v0.0.6 bug: a trashed item looked "still present", so nothing was recorded; now it counts', () => {
  // v0.0.6 logic: gone = !stillPresent(uri); single-item queries include trashed rows, so a trashed item was "present"
  const v6StillPresent = [img(1)]; assert.equal([img(1)].filter(u => !v6StillPresent.includes(u)).length, 0);
  assert.equal(T.confirmed([img(1)], [{ uri: img(1), state: 'trashed' }], 'trash').size, 1);
});
t('uriForId', () => {
  assert.equal(T.uriForId('i12'), img(12)); assert.equal(T.uriForId('v3'), 'content://media/external/video/media/3');
  assert.equal(T.uriForId('m3'), null); assert.equal(T.uriForId('i'), null);
});
t('emptiesLabel range and daily freed/trash split', () => {
  const a = rec(1, { expiresAt: at(2026, 11, 30), checkedAt: now }), b = rec(2, { expiresAt: at(2026, 12, 4), checkedAt: now }), c = rec(3, { freedAt: now });
  const sum = S.trashSummary(recs(a, b, c), now); assert.equal(S.emptiesLabel(sum), 'empties ~Nov 30 – Dec 4'); assert.equal(sum.count, 2);
  const d = S.daily(recs(a, b, c), {}, now)['2026-11-01']; assert.equal(d.freedBytes, 1000); assert.equal(d.trashBytes, 2000);
  assert.equal(S.emptiesLabel(S.trashSummary({}, now)), '');
});
console.log(`\n${n} trash tests passed`);
