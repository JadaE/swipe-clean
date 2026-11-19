// Export / import of saved data: round-trip, strict validation, idempotent merge. Photos are never involved.
import assert from 'node:assert/strict';
import * as X from '../src/transfer';
import { DEFAULT_SETTINGS } from '../src/settings';
let n = 0; const t = (name: string, f: () => void) => { f(); n++; console.log('PASS', name); };
const img = (k: number) => 'content://media/external/images/media/' + k;
const base = (): X.SavedData => ({ decisions: {}, decidedAt: {}, history: [], front: [], days: {}, removed: {}, settings: { ...DEFAULT_SETTINGS, seenWelcome: true }, storageLog: [] });
const personal = (): X.SavedData => ({
  decisions: { i1: 'keep', i2: 'remove', i3: 'later', v4: 'remove' }, decidedAt: { i2: 2000 },
  history: [{ id: 'i1', prev: null, next: 'keep' }, { id: 'i2', prev: null, next: 'remove' }], front: ['i5', 'i6'],
  days: { '2026-11-17': { date: '2026-11-17', activeMs: 600000, decided: 40, trashedBytes: 5000, deletedBytes: 0, lastActionAt: 1700 } },
  removed: { i9: { id: 'i9', uri: img(9), bytes: 1234, at: 1000, mode: 'trash', filename: 'IMG_9.jpg', kind: 'photo', expiresAt: 9000 } },
  settings: { ...DEFAULT_SETTINGS, theme: 'light', goalMin: 20, seenWelcome: true, lastUpdateCheck: 55, reminder: true },
  storageLog: [{ at: 100, used: 5, total: 10, tag: 'baseline' }], statsSince: 50,
});
const roundTrip = (s: X.SavedData) => { const r = X.parseImport(X.exportText(s, '0.0.9', 12345)); assert.ok(r.ok, !r.ok ? r.error : ''); return (r as any).file as X.ExportFile; };
const bad = (o: unknown) => { const r = X.parseImport(typeof o === 'string' ? o : JSON.stringify(o)); assert.equal(r.ok, false); return (r as any).error as string; };
const good = () => JSON.parse(X.exportText(personal(), '0.0.9', 12345));

t('export file has schema, versions, time and the full saved state', () => {
  const f = X.buildExport(personal(), '0.0.9', 12345);
  assert.equal(f.schema, 'swipeclean-export'); assert.equal(f.schemaVersion, 1); assert.equal(f.appVersion, '0.0.9'); assert.equal(f.exportedAt, 12345);
  assert.deepEqual(f.data.decisions, personal().decisions); assert.deepEqual(f.data.removed, personal().removed); assert.equal(f.data.statsSince, 50);
  assert.equal(X.exportName('2026-11-19'), 'SwipeClean-export-2026-11-19.json');
});
t('round trip: export -> parse gives back exactly the same data', () => { assert.deepEqual(roundTrip(personal()).data, personal()); });
t('round trip of an empty app', () => { assert.deepEqual(roundTrip(base()).data, base()); });
t('older saves without decidedAt still export and import', () => { const s = personal(); delete s.decidedAt; const f = roundTrip(s); assert.deepEqual(f.data.decidedAt, {}); });
t('rejects non-JSON, other files, wrong schema or newer schema version', () => {
  bad('hello'); bad('[]'); bad({ schema: 'something-else', schemaVersion: 1 });
  assert.match(bad({ ...good(), schemaVersion: 2 }), /newer or unknown/);
  bad({ ...good(), appVersion: 'x' }); bad({ ...good(), exportedAt: -1 }); bad({ ...good(), data: null });
});
t('rejects unknown fields anywhere', () => {
  bad({ ...good(), extra: 1 });
  const g = good(); g.data.extra = 1; bad(g);
  const h = good(); h.data.days['2026-11-17'].bonus = 1; bad(h);
  const r = good(); r.data.removed.i9.evil = 'x'; bad(r);
  const s = good(); s.data.settings.newThing = true; bad(s);
});
t('rejects malformed values', () => {
  const cases: ((g: any) => void)[] = [
    g => { g.data.decisions.i1 = 'delete-now'; }, g => { g.data.decisions['../x'] = 'keep'; }, g => { g.data.decidedAt.i2 = 'soon'; },
    g => { g.data.days['2026-11-17'].decided = -3; }, g => { g.data.days['2026-11-18'] = g.data.days['2026-11-17']; },
    g => { g.data.removed.i9.uri = 'https://example.com/x'; }, g => { g.data.removed.i9.mode = 'wipe'; }, g => { g.data.removed.i9.id = 'i10'; },
    g => { g.data.removed.i9.bytes = 'big'; }, g => { g.data.history = [{ id: 'i1', prev: null, next: 'nope' }]; }, g => { g.data.front = [5]; },
    g => { g.data.storageLog[0].tag = 'x'; }, g => { g.data.settings.theme = 'neon'; }, g => { g.data.settings.goalMin = '15'; },
  ];
  for (const c of cases) { const g = good(); c(g); bad(g); }
});
t('size cap: files over the limit are refused before parsing', () => {
  const r = X.parseImport('{}', X.MAX_IMPORT_BYTES + 1); assert.equal(r.ok, false); assert.match((r as any).error, /too big/);
});
t('error messages never echo file content', () => { const e = bad({ ...good(), 'SECRET-VALUE-123': 1 }); assert.ok(!e.includes('SECRET-VALUE-123')); });
t('merge into an empty store app brings everything over, summary counts it', () => {
  const { data, summary } = X.mergeImport(base(), roundTrip(personal()));
  assert.deepEqual(data.decisions, personal().decisions); assert.deepEqual(data.removed, personal().removed); assert.deepEqual(data.days, personal().days);
  assert.deepEqual(data.front, ['i5', 'i6']); assert.equal(data.statsSince, 50); assert.equal(data.settings.theme, 'light'); assert.equal(data.settings.goalMin, 20);
  assert.equal(summary.decisions, 4); assert.equal(summary.keep, 1); assert.equal(summary.remove, 2); assert.equal(summary.later, 1);
  assert.equal(summary.newDecisions, 4); assert.equal(summary.days, 1); assert.equal(summary.newRemoved, 1); assert.equal(summary.appVersion, '0.0.9');
});
t('merge keeps this phone\'s reminder, update-check time and undo history', () => {
  const cur = base(); cur.history = [{ id: 'i7', prev: null, next: 'keep' }]; cur.settings.lastUpdateCheck = 999;
  const { data } = X.mergeImport(cur, roundTrip(personal()));
  assert.equal(data.settings.reminder, false); assert.equal(data.settings.lastUpdateCheck, 999); assert.deepEqual(data.history, cur.history);
});
t('idempotent: importing the same file twice changes nothing the second time', () => {
  const f = roundTrip(personal()); const once = X.mergeImport(base(), f).data; const twice = X.mergeImport(once, f);
  assert.deepEqual(twice.data, once); assert.equal(twice.summary.newDecisions, 0); assert.equal(twice.summary.changedDecisions, 0); assert.equal(twice.summary.newRemoved, 0);
});
t('stats are never double-counted: same day takes the larger numbers, other days add up', () => {
  const cur = base();
  cur.days = { '2026-11-17': { date: '2026-11-17', activeMs: 100000, decided: 70, trashedBytes: 0, deletedBytes: 800 }, '2026-11-19': { date: '2026-11-19', activeMs: 5, decided: 1, trashedBytes: 0, deletedBytes: 0 } };
  const { data } = X.mergeImport(cur, roundTrip(personal()));
  assert.deepEqual(data.days['2026-11-17'], { date: '2026-11-17', activeMs: 600000, decided: 70, trashedBytes: 5000, deletedBytes: 800, lastActionAt: 1700 });
  assert.equal(data.days['2026-11-19'].decided, 1);
  assert.deepEqual(X.mergeImport(data, roundTrip(personal())).data.days, data.days);
});
t('decisions: newest wins; a timed decision beats an untimed one; with no times this phone keeps its own', () => {
  const cur = base(); cur.decisions = { i1: 'remove', i2: 'keep', i3: 'keep' }; cur.decidedAt = { i2: 1000, i3: 9000 };
  const inc = personal(); inc.decisions.i3 = 'remove'; inc.decidedAt = { i2: 2000, i3: 3000 };
  const { data, summary } = X.mergeImport(cur, roundTrip(inc));
  assert.equal(data.decisions.i1, 'remove');   // neither timed: this phone's stays
  assert.equal(data.decisions.i2, 'remove');   // file's is newer
  assert.equal(data.decisions.i3, 'keep');     // this phone's is newer
  assert.equal(data.decisions.v4, 'remove'); assert.equal(summary.changedDecisions, 1);
  const cur2 = base(); cur2.decisions = { i2: 'later' }; // untimed here, timed in the file -> file wins
  assert.equal(X.mergeImport(cur2, roundTrip(personal())).data.decisions.i2, 'remove');
});
t('removal records: union; for the same item the one with newer activity wins', () => {
  const cur = base(); cur.removed = { i9: { id: 'i9', uri: img(9), bytes: 1234, at: 1000, mode: 'trash', filename: null, freedAt: 5000 } };
  const { data } = X.mergeImport(cur, roundTrip(personal()));
  assert.equal(data.removed.i9.freedAt, 5000); // this phone saw it emptied later than the file's last check
});
t('merge only touches app data and the order of the pile has no duplicates', () => {
  const cur = base(); cur.front = ['i6', 'i8']; const { data } = X.mergeImport(cur, roundTrip(personal()));
  assert.deepEqual(data.front, ['i6', 'i8', 'i5']);
});
console.log(`transfer: ${n} passed`);
