import assert from 'node:assert/strict';
import * as M from '../src/mascot';
let n = 0; const t = (name: string, f: () => void) => { f(); n++; console.log('PASS', name); };
const ACTIONS: M.MascotAction[] = ['keep', 'remove', 'later', 'undo', 'compare', 'tap'];
// deterministic rng
const seq = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]; };
const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

t('same reaction pool for every action', () => { for (const a of ACTIONS) assert.deepEqual(M.reactionPool(a), M.REACTIONS); });
t('same rng gives the same reaction whatever the action', () => {
  for (let k = 0; k < 200; k++) { const r = k / 200; const got = ACTIONS.map(a => M.pickReaction(a, () => r)); assert.ok(got.every(g => g === got[0]), String(got)); }
  for (let k = 0; k < 50; k++) { const r = k / 50; for (const last of M.REACTIONS) { const got = ACTIONS.map(a => M.pickReaction(a, () => r, last)); assert.ok(got.every(g => g === got[0])); assert.notEqual(got[0], last); } }
});
t('every action can get every reaction, with the same odds', () => {
  const counts = ACTIONS.map(a => { const rng = lcg(7); const c: Record<string, number> = {}; for (let i = 0; i < 6000; i++) { const r = M.pickReaction(a, rng); c[r] = (c[r] || 0) + 1; } return c; });
  for (const c of counts) { assert.equal(Object.keys(c).length, M.REACTIONS.length); assert.deepEqual(c, counts[0]); for (const r of M.REACTIONS) assert.ok(c[r] > 800 && c[r] < 1200, r + ' ' + c[r]); }
});
t('pool is all happy: nothing sad and nothing reserved for one choice', () => {
  assert.ok(!/sad|cry|frown|celebrat|confetti|trash|delete|keep/i.test(M.REACTIONS.join(' ')));
  assert.ok(M.pickReaction.length >= 1);
});
t('idle delay is 8 to 12 seconds', () => {
  assert.equal(M.idleDelay(() => 0), 8000); assert.equal(M.idleDelay(() => 0.999999), 12000);
  const rng = lcg(3); for (let i = 0; i < 1000; i++) { const d = M.idleDelay(rng); assert.ok(d >= 8000 && d <= 12000, String(d)); }
});
t('idle poses include the photo poses and the simple ones, never the same twice in a row', () => {
  for (const p of ['camera', 'filmroll', 'polaroid', 'strap', 'frame', 'yawn', 'blink', 'look']) assert.ok((M.IDLE_POSES as readonly string[]).includes(p), p);
  const rng = lcg(11); let last: M.IdlePose | undefined; const seen = new Set<string>();
  for (let i = 0; i < 500; i++) { const p = M.pickIdlePose(rng, last); assert.notEqual(p, last); seen.add(p); last = p; }
  assert.equal(seen.size, M.IDLE_POSES.length);
});

// fake clock
function fakeClock() {
  let now = 0, id = 0; const q = new Map<number, { at: number; f: () => void }>();
  const clock: M.Clock = { set: (f, ms) => { q.set(++id, { at: now + ms, f }); return id; }, clear: h => { q.delete(h as number); } };
  const advance = (ms: number) => { const end = now + ms; for (;;) { let nx: [number, { at: number; f: () => void }] | null = null;
    for (const e of q) if (e[1].at <= end && (!nx || e[1].at < nx[1].at)) nx = e; if (!nx) break; q.delete(nx[0]); now = nx[1].at; nx[1].f(); } now = end; };
  return { clock, advance, pending: () => q.size, get now() { return now; } };
}
t('idle timer: pose after 8-12 s untouched, back to normal, then re-arms', () => {
  const c = fakeClock(); const ev: string[] = [];
  const it = new M.IdleTimer(p => ev.push('pose:' + p), () => ev.push('done'), seq([0.5]), c.clock);
  it.start(); c.advance(9999); assert.deepEqual(ev, []);
  c.advance(1); assert.equal(ev.length, 1); assert.match(ev[0], /^pose:/); assert.equal(it.posing, true);
  c.advance(M.POSE_HOLD_MS); assert.deepEqual(ev.slice(1), ['done']); assert.equal(it.posing, false);
  c.advance(10000); assert.equal(ev.length, 3); assert.notEqual(ev[2], ev[0]);
});
t('idle timer: touches keep resetting the wait', () => {
  const c = fakeClock(); const ev: string[] = [];
  const it = new M.IdleTimer(p => ev.push('pose'), () => ev.push('done'), seq([0]), c.clock); // 8 s
  it.start(); for (let i = 0; i < 10; i++) { c.advance(7000); it.poke(); } assert.deepEqual(ev, []);
  c.advance(8000); assert.deepEqual(ev, ['pose']);
});
t('idle timer: a touch mid-pose returns Lil to normal right away', () => {
  const c = fakeClock(); const ev: string[] = [];
  const it = new M.IdleTimer(() => ev.push('pose'), () => ev.push('done'), seq([0]), c.clock);
  it.start(); c.advance(8000); it.poke(); assert.deepEqual(ev, ['pose', 'done']); c.advance(M.POSE_HOLD_MS); assert.deepEqual(ev, ['pose', 'done']);
  c.advance(8000 - M.POSE_HOLD_MS); assert.deepEqual(ev, ['pose', 'done', 'pose']);
});
t('idle timer: stopped (calm mode, reduce motion, app in background) never fires', () => {
  const c = fakeClock(); let fired = 0;
  const it = new M.IdleTimer(() => fired++, () => {}, seq([0]), c.clock);
  it.poke(); c.advance(60000); assert.equal(fired, 0);           // never started
  it.start(); it.stop(); c.advance(60000); assert.equal(fired, 0); assert.equal(c.pending(), 0);
});
t('bus delivers reactions and pokes to every listener', () => {
  const got: string[] = []; const off = M.mascotBus.on(e => got.push(e.kind === 'react' ? e.action : 'poke'));
  M.mascotBus.react('keep'); M.mascotBus.react('remove'); M.mascotBus.poke(); off(); M.mascotBus.react('later');
  assert.deepEqual(got, ['keep', 'remove', 'poke']);
});
t('lil text uses lil/guy pronouns', () => { assert.match(M.LIL_A11Y, /Lil is/); assert.match(M.LIL_A11Y, /guy/); assert.ok(!/\b(he|him|she|her|they|them)\b/i.test(M.LIL_A11Y)); });
console.log(`mascot: ${n} passed`);
