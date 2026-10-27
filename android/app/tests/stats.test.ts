import assert from 'node:assert/strict';
import * as S from '../src/stats';
import * as L from '../src/logic';
let n = 0; const t = (name: string, f: () => void) => { f(); n++; console.log('PASS', name); };
const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime(); // LOCAL time
let k = 0;
const rec = (o: Partial<S.RemovalRec>): S.RemovalRec => ({ id: 'r' + (++k), uri: 'content://media/external/images/media/' + k, bytes: 1000, at: at(2026, 10, 21), mode: 'trash', ...o });
const now = at(2026, 10, 26, 18);

t('local-day boundaries: 23:59 and 00:01 land on different days', () => {
  const log = S.daily([rec({ at: at(2026, 10, 21, 23, 59) }), rec({ at: at(2026, 10, 22, 0, 1) })], {}, now);
  assert.equal(log['2026-10-21'].bytes, 1000); assert.equal(log['2026-10-22'].bytes, 1000);
});
t('daily totals and photo/video split (old records typed from URI)', () => {
  const log = S.daily([rec({ bytes: 3e6 }), rec({ bytes: 5e6, uri: 'content://media/external/video/media/9' }), rec({ bytes: 2e6, kind: 'video' })], {}, now);
  const d = log['2026-10-21']; assert.equal(d.bytes, 10e6); assert.equal(d.photos, 1); assert.equal(d.videos, 2); assert.equal(d.videoBytes, 7e6); assert.equal(d.photoBytes, 3e6);
});
t('only confirmed removals count: swipes alone (decisions/day log) add no bytes; restored items are excluded', () => {
  const days: Record<string, L.DayLog> = { '2026-10-23': { date: '2026-10-23', activeMs: 5 * 60000, decided: 40, trashedBytes: 0, deletedBytes: 0 } };
  const log = S.daily([rec({ restored: true, bytes: 9e9 })], days, now);
  assert.equal(log['2026-10-21'], undefined); assert.equal(log['2026-10-23'].bytes, 0); assert.equal(log['2026-10-23'].reviewed, 40); assert.equal(log['2026-10-23'].minutes, 5);
  assert.equal(S.summary(log, now).all.bytes, 0);
});
t('fully freed: deleted now, trash only after 30 days', () => {
  const log = S.daily([rec({ mode: 'delete', bytes: 100 }), rec({ at: at(2026, 9, 20), bytes: 200 }), rec({ at: at(2026, 10, 20), bytes: 400 })], {}, now);
  const s = S.summary(log, now); assert.equal(s.all.bytes, 700); assert.equal(s.all.freedBytes, 300);
});
t('summary: today / week (Mon start) / month / best / average', () => {
  const log = S.daily([rec({ at: at(2026, 10, 26, 9), bytes: 10 }), rec({ at: at(2026, 10, 25, 9), bytes: 20 }), rec({ at: at(2026, 10, 2), bytes: 40 }), rec({ at: at(2026, 9, 30), bytes: 80 })], {}, now);
  const s = S.summary(log, now);
  assert.equal(s.today.bytes, 10); assert.equal(s.week.bytes, 10); // Mon 26 Oct; Sun 25 is last week
  assert.equal(s.month.bytes, 70); assert.equal(s.all.bytes, 150); assert.equal(s.best?.date, '2026-09-30'); assert.equal(s.avgPerActiveDay, 37.5);
});
t('series: 30 daily bars ending today; 12 weekly; 12 monthly', () => {
  const log = S.daily([rec({ at: at(2026, 10, 26, 1), bytes: 5 }), rec({ at: at(2026, 9, 27), bytes: 7 }), rec({ at: at(2026, 9, 26), bytes: 9 })], {}, now);
  const d = S.series(log, 'day', now); assert.equal(d.length, 30); assert.equal(d[29].key, '2026-10-26'); assert.equal(d[29].bytes, 5); assert.equal(d[0].key, '2026-09-27'); assert.equal(d[0].bytes, 7);
  const w = S.series(log, 'week', now); assert.equal(w.length, 12); assert.equal(w[11].key, '2026-10-26'); assert.equal(w.reduce((a, x) => a + x.bytes, 0), 21);
  const m = S.series(log, 'month', now); assert.equal(m.length, 12); assert.equal(m[11].bytes, 5); assert.equal(m[10].bytes, 16);
});
t('csv rows', () => {
  const log = S.daily([rec({ bytes: 1234, at: at(2026, 10, 21, 8) })], { '2026-10-21': { date: '2026-10-21', activeMs: 120000, decided: 7, trashedBytes: 0, deletedBytes: 0 } }, now);
  assert.equal(S.csv(log), 'date,bytes,photos,videos,reviewed,minutes,bytes_fully_freed\n2026-10-21,1234,1,0,7,2,0\n');
});
console.log(`\n${n} stats tests passed`);
