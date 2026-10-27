import assert from 'node:assert/strict';
import * as L from '../src/logic';
let n = 0; const t = (name: string, f: () => void) => { f(); n++; console.log('PASS', name); };
const base = new Date(2026, 9, 21, 10, 0, 0).getTime();
let k = 0;
const m = (o: Partial<L.Media>): L.Media => ({ id: 'i' + (++k), uri: 'content://media/external/images/media/' + k, type: 'PHOTO', filename: 'PXL_' + k + '.jpg', size: 3e6, takenAt: base, addedAt: base, width: 4000, height: 3000, bucket: 'Camera', relPath: 'DCIM/Camera/', mime: 'image/jpeg', durationMs: 0, ...o });
const items = [
  m({ takenAt: base - 1000, size: 2e6 }), m({ takenAt: base, size: 2e6 }), m({ takenAt: base + 2000, size: 2e6 }),           // burst of 3
  m({ takenAt: base + 20000, width: 3000, height: 4000 }),                                                                  // rotated look-alike ≤30 s
  m({ type: 'VIDEO', size: 900e6, takenAt: base + 3 * 3600000, filename: 'PXL_v.mp4', durationMs: 60000 }),               // later moment, same day
  m({ type: 'VIDEO', size: 400e6, bucket: 'Screen recordings', relPath: 'Movies/Screen recordings/', filename: 'Screen_Recording_20260101.mp4', takenAt: base - 30 * L.DAY }),
  m({ bucket: 'Screenshots', relPath: 'Pictures/Screenshots/', filename: 'Screenshot_20250101.png', size: 5e5, takenAt: base - 365 * L.DAY, addedAt: base - 365 * L.DAY }),
  m({ bucket: 'WhatsApp Images', relPath: 'Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images/', size: 1e5, takenAt: base - 2 * 365 * L.DAY }),
  ...[0, 1, 2, 3].flatMap(d => [0, 1, 2, 3, 4, 5].map(i => m({ takenAt: base - 100 * L.DAY + d * L.DAY + i * 600000, size: 1e6 }))), // 4-day busy stretch
];
const byId = new Map(items.map(i => [i.id, i]));
const decks = L.buildDecks(items, base);
const D = (id: string) => decks.find(d => d.id === id)!;
t('sort by size: largest first, photos+videos mixed', () => { const s = D('size').ids.map(id => byId.get(id)!); assert.equal(s[0].type, 'VIDEO'); assert.ok(s.some(x => x.type === 'PHOTO')); for (let i = 1; i < s.length; i++) assert.ok(s[i - 1].size >= s[i].size); });
t('every item appears in size + oldest decks', () => { assert.equal(D('size').ids.length, items.length); assert.equal(D('oldest').ids.length, items.length); });
t('by day groups and labels', () => { const d = D('days'); assert.equal(d.ids.length, items.length); assert.match(d.labels![d.ids[0]], /Wed Oct 21, 2026 · 1 of 5/); });
t('moments split by 2h gap', () => { const mo = L.moments(items.filter(i => L.dayKey(i.takenAt) === L.dayKey(base))); assert.equal(mo.length, 2); assert.equal(mo[0].length, 1); assert.equal(mo[1].length, 4); });
t('look-alikes: burst + rotated similar, no best marker', () => { const g = L.lookAlikes(items); const today = g.find(x => x.some(i => i.takenAt === base))!; assert.equal(today.length, 4); assert.ok(!JSON.stringify(D('lookalikes')).match(/best|recommend/i)); });
t('busy stretch detected', () => { const s = L.stretches(items); assert.equal(s.length, 1); assert.equal(s[0].items.length, 24); });
t('on this day: earlier years only', () => { const o = L.onThisDay(items, base); assert.equal(o.items.length, 2); assert.equal(o.win, 0); });
t('kinds: screenshots, screen recordings, messaging', () => { assert.equal(D('screenshots').ids.length, 1); assert.equal(D('screenrec').ids.length, 1); assert.equal(D('messaging').ids.length, 1); assert.equal(D('messaging').labels![D('messaging').ids[0]], 'WhatsApp'); assert.equal(D('videos').ids.length, 2); });
t('nothing starts decided; queue = deck order', () => { const q = L.queueFor(D('size'), {}); assert.deepEqual(q, D('size').ids); });
t('deck wording is neutral', () => { const s = JSON.stringify(decks.map(d => [d.title, d.subtitle])); assert.ok(!/recommend|junk|suggest|should|biggest win|clean ?up|waste|bad|blurry/i.test(s), s); });
t('unlimited undo', () => {
  let st = { decisions: {} as Record<string, L.Decision>, history: [] as L.HistEntry[] };
  for (const id of ['i1', 'i2', 'i3']) st = L.applyDecision(st.decisions, st.history, id, 'remove');
  st = L.applyDecision(st.decisions, st.history, 'i2', 'keep'); // moved back to keep in review
  let u = L.undoLast(st.decisions, st.history)!; assert.equal(u.decisions.i2, 'remove');
  u = L.undoLast(u.decisions, u.history)!; u = L.undoLast(u.decisions, u.history)!; u = L.undoLast(u.decisions, u.history)!;
  assert.deepEqual(u.decisions, {}); assert.equal(L.undoLast(u.decisions, u.history), null);
});
t('queue puts undone item in front', () => { assert.equal(L.queueFor(D('size'), {}, ['i8'])[0], 'i8'); });
t('batches ≤250', () => { const c = L.chunk(Array.from({ length: 601 }, (_, i) => i), 250); assert.deepEqual(c.map(x => x.length), [250, 250, 101]); });
t('active time caps idle gaps at 60s', () => { let d = {}; d = L.logDecision(d, base); d = L.logDecision(d, base + 5000); d = L.logDecision(d, base + 5000 + 10 * 60000); const x = (d as any)[L.dayKey(base)]; assert.equal(x.decided, 3); assert.equal(x.activeMs, 4000 + 5000 + 60000); });
t('streak counts consecutive days, today or yesterday', () => { let d: any = {}; d = L.logDecision(d, base - 2 * L.DAY); d = L.logDecision(d, base - L.DAY); assert.equal(L.streak(d, base), 2); d = L.logDecision(d, base); assert.equal(L.streak(d, base), 3); assert.equal(L.streak(d, base + 3 * L.DAY), 0); });
t('removal bytes split trash vs delete', () => { let d: any = {}; d = L.logRemoval(d, 5e8, 'trash', base); d = L.logRemoval(d, 1e8, 'delete', base); const x = d[L.dayKey(base)]; assert.equal(x.trashedBytes, 5e8); assert.equal(x.deletedBytes, 1e8); });
t('recent caution is informational & date based', () => { assert.ok(L.isRecent(items[0], 30, base + L.DAY)); assert.ok(!L.isRecent(items[6], 30, base)); assert.ok(!L.isRecent(items[0], 0, base)); });
t('fmtBytes decimal', () => { assert.equal(L.fmtBytes(1.5e9), '1.5 GB'); assert.equal(L.fmtBytes(512e9), '512 GB'); assert.equal(L.fmtBytes(0), '0 MB'); });
console.log(`\n${n} tests passed`);
t('decide later: skipped in normal decks, shown in later deck, not counted as reviewed', () => {
  const d: L.Deck = { id: 'x', title: 'x', subtitle: '', ids: ['i1', 'i2', 'i3'] }; const dec: Record<string, L.Decision> = { i1: 'later', i2: 'keep' };
  assert.deepEqual(L.queueFor(d, dec), ['i3']); assert.deepEqual(L.queueFor({ ...d, laterDeck: true }, dec), ['i1']);
  assert.equal(L.isFinal('later'), false); assert.equal(L.isFinal('keep'), true);
});
t('on this day groups by year, ±3 days for this week, wraps year end', () => {
  const g = L.onThisDayGroups(items, new Date(base)); assert.deepEqual(g.map(x => x.year), [2025, 2024]);
  const nye = [m({ takenAt: new Date(2024, 11, 30).getTime() })]; assert.equal(L.onThisDayGroups(nye, new Date(2026, 0, 1), 3).length, 1); assert.equal(L.onThisDayGroups(nye, new Date(2026, 0, 1), 0).length, 0);
});
t('months: reviewed only when every item is keep/remove', () => {
  const ms = L.months(items, {}); assert.ok(ms.length >= 4); assert.ok(ms.every(x => !x.reviewed)); const oct = ms[0];
  const dec: Record<string, L.Decision> = Object.fromEntries(oct.items.map(i => [i.id, 'keep' as L.Decision])); assert.ok(L.months(items, dec)[0].reviewed);
  dec[oct.items[0].id] = 'later'; assert.ok(!L.months(items, dec)[0].reviewed); assert.equal(L.fmtMonth('2019-03'), 'March 2019');
});
t('resolution label', () => { assert.equal(L.fmtRes(m({ type: 'VIDEO', width: 1920, height: 1080 })), '1080p'); assert.equal(L.fmtRes(m({})), '12.0 MP'); });
console.log(`\n${n} tests passed (v0.02)`);
