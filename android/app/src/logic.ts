// Pure logic for Swipe Clean (no React Native imports, unit-tested in tests/logic.test.ts).
// RULE: decks are only sort orders and groupings. Nothing here ever decides, suggests or pre-selects removal.

export type Media = {
  id: string; uri: string; type: 'PHOTO' | 'VIDEO'; filename: string | null; size: number; takenAt: number; addedAt: number;
  width: number; height: number; bucket: string | null; relPath: string | null; mime: string | null; durationMs: number; favorite?: boolean;
};
export type Decision = 'remove' | 'keep' | 'later';
/** 'later' is neutral: the item is skipped for now and waits in the Decide later deck. It doesn't count as reviewed. */
export const isFinal = (d?: Decision | null) => d === 'keep' || d === 'remove';
export type Deck = { id: string; title: string; subtitle: string; ids: string[]; labels?: Record<string, string>; group?: 'main' | 'moments' | 'kinds' | 'folders'; laterDeck?: boolean; compare?: boolean };

export const DAY = 86400000;
const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const fmtDay = (t: number) => { const d = new Date(t); return `${WD[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
export const fmtTime = (t: number) => { const d = new Date(t); let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${pad(d.getMinutes())} ${ap}`; };
export const fmtShortDay = (t: number) => { const d = new Date(t); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
export function fmtBytes(b: number): string {
  if (!b || b < 0) return '0 MB';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = b;
  while (v >= 1000 && i < 4) { v /= 1000; i++; } // decimal units, like Android's Settings > Storage
  return (i >= 3 ? v.toFixed(v >= 100 ? 0 : 1) : Math.round(v).toString()) + ' ' + u[i];
}
export const fmtDur = (ms: number) => { const s = Math.round(ms / 1000); return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`; };

const path = (m: Media) => ((m.relPath || '') + '/' + (m.bucket || '')).toLowerCase();
export const isScreenshot = (m: Media) => m.type === 'PHOTO' && (/screenshot/.test(path(m)) || /^screenshot/i.test(m.filename || ''));
export const isScreenRecording = (m: Media) => m.type === 'VIDEO' && (/screen ?record|screenrecord/.test(path(m)) || /^(screen[_ -]?record|screenrecord|record_)/i.test(m.filename || ''));
export const MESSAGING = [
  ['WhatsApp', /whatsapp/], ['Telegram', /telegram/], ['Signal', /signal/], ['Messenger', /messenger/], ['Instagram', /instagram/],
  ['Snapchat', /snapchat/], ['Discord', /discord/], ['Viber', /viber/], ['WeChat', /wechat|weixin/], ['LINE', /\bline\b/], ['Messages', /messages|mms/]
] as const;
export const messagingApp = (m: Media): string | null => { const p = path(m); for (const [n, re] of MESSAGING) if (re.test(p)) return n; return null; };
export const isCamera = (m: Media) => /dcim\/camera|(^|\/)camera$/.test(path(m));
export function isRecent(m: Media, cautionDays: number, now = Date.now()) { return cautionDays > 0 && Math.max(m.takenAt, m.addedAt) > now - cautionDays * DAY; }

/** Moments: chronological clusters split by a gap (default 2 h) or a day change. */
export function moments(items: Media[], gapMs = 2 * 3600000) {
  const s = items.slice().sort((a, b) => a.takenAt - b.takenAt); const out: Media[][] = [];
  for (const m of s) { const cur = out[out.length - 1]; const last = cur && cur[cur.length - 1];
    if (cur && m.takenAt - last.takenAt <= gapMs && dayKey(m.takenAt) === dayKey(last.takenAt)) cur.push(m); else out.push([m]); }
  return out.reverse(); // newest moment first, items inside chronological
}
/** Busy stretches ("possible trips"), time-only: runs of active days (≤1 empty day between) spanning ≥3 days with ≥5 items/day average. */
export function stretches(items: Media[]) {
  const byDay = new Map<string, Media[]>(); for (const m of items) { const k = dayKey(m.takenAt); (byDay.get(k) || byDay.set(k, []).get(k)!).push(m); }
  const days = [...byDay.keys()].sort(); const out: { start: string; end: string; items: Media[] }[] = [];
  let run: string[] = [];
  const flush = () => { if (run.length) { const its = run.flatMap(d => byDay.get(d)!); const span = (Date.parse(run[run.length - 1]) - Date.parse(run[0])) / DAY + 1;
    if (span >= 3 && its.length / span >= 5) out.push({ start: run[0], end: run[run.length - 1], items: its.sort((a, b) => a.takenAt - b.takenAt) }); } run = []; };
  for (const d of days) { if (run.length && (Date.parse(d) - Date.parse(run[run.length - 1])) / DAY > 2) flush(); run.push(d); }
  flush(); return out.reverse();
}
/** Bursts & look-alikes: consecutive shots ≤3 s apart, or ≤30 s apart with the same dimensions and type. Groups of 2+. No "best" pick. */
export function lookAlikes(items: Media[], burstMs = 3000, similarMs = 30000) {
  const s = items.slice().sort((a, b) => a.takenAt - b.takenAt); const groups: Media[][] = []; let cur: Media[] = [];
  const near = (a: Media, b: Media) => { const dt = b.takenAt - a.takenAt; if (dt < 0) return false; if (dt <= burstMs && a.type === b.type) return true;
    return dt <= similarMs && a.type === b.type && ((a.width === b.width && a.height === b.height) || (a.width === b.height && a.height === b.width)) && a.width > 0; };
  for (const m of s) { if (cur.length && near(cur[cur.length - 1], m)) cur.push(m); else { if (cur.length >= 2) groups.push(cur); cur = [m]; } }
  if (cur.length >= 2) groups.push(cur);
  return groups.reverse();
}
export function onThisDay(items: Media[], now = Date.now()) {
  const t = new Date(now); const thisYear = t.getFullYear();
  const match = (win: number) => items.filter(m => { const d = new Date(m.takenAt); if (d.getFullYear() >= thisYear) return false;
    const same = new Date(thisYear, d.getMonth(), d.getDate()).getTime(); return Math.abs(same - new Date(thisYear, t.getMonth(), t.getDate()).getTime()) <= win * DAY; });
  let r = match(0); let win = 0; if (!r.length) { r = match(3); win = 3; }
  return { win, items: r.sort((a, b) => b.takenAt - a.takenAt) };
}

const bySizeDesc = (a: Media, b: Media) => b.size - a.size;
const newest = (a: Media, b: Media) => b.takenAt - a.takenAt;
function flatGroups(groups: Media[][], label: (g: Media[], gi: number) => string): { ids: string[]; labels: Record<string, string> } {
  const ids: string[] = []; const labels: Record<string, string> = {};
  groups.forEach((g, gi) => g.forEach((m, i) => { ids.push(m.id); labels[m.id] = `${label(g, gi)} · ${i + 1} of ${g.length}`; }));
  return { ids, labels };
}

/** Builds all decks. Photos and videos are mixed everywhere except the Videos/Screen-recordings kinds. */
export function buildDecks(items: Media[], now = Date.now()): Deck[] {
  const decks: Deck[] = [];
  const add = (d: Deck) => { if (d.ids.length) decks.push(d); };
  add({ id: 'size', title: 'Sort by size', subtitle: 'Everything, largest files first', ids: items.slice().sort(bySizeDesc).map(m => m.id), group: 'main' });
  const days = moments(items, 24 * 3600000); // day change only
  add({ id: 'days', title: 'By day', subtitle: 'Newest day first', ...flatGroups(days, g => fmtDay(g[0].takenAt)), group: 'main' });
  const otd = onThisDay(items, now);
  add({ id: 'otd', title: 'On this day', subtitle: otd.win ? 'Within 3 days of today, earlier years' : 'Today’s date in earlier years', ids: otd.items.map(m => m.id),
    labels: Object.fromEntries(otd.items.map(m => [m.id, `${new Date(now).getFullYear() - new Date(m.takenAt).getFullYear()} yr ago · ${fmtDay(m.takenAt)}`])), group: 'moments' });
  const mo = moments(items);
  add({ id: 'moments', title: 'Moments', subtitle: 'Grouped by time of day (2-hour gaps)', ...flatGroups(mo, g => `${fmtShortDay(g[0].takenAt)}, ${fmtTime(g[0].takenAt)}–${fmtTime(g[g.length - 1].takenAt)}`), group: 'moments' });
  const st = stretches(items);
  add({ id: 'stretches', title: 'Busy stretches', subtitle: 'Several busy days in a row (often trips). Time-based only', ...flatGroups(st.map(s => s.items), g => `${fmtShortDay(g[0].takenAt)}–${fmtShortDay(g[g.length - 1].takenAt)}`), group: 'moments' });
  const la = lookAlikes(items);
  add({ id: 'lookalikes', title: 'Bursts & look-alikes', subtitle: 'Shots taken seconds apart. Compare them side by side', ...flatGroups(la, (_, gi) => `Group ${gi + 1}`), group: 'moments', compare: true });
  add({ id: 'videos', title: 'Videos', subtitle: 'Largest first', ids: items.filter(m => m.type === 'VIDEO').sort(bySizeDesc).map(m => m.id), group: 'kinds' });
  add({ id: 'screenrec', title: 'Screen recordings', subtitle: 'Largest first', ids: items.filter(isScreenRecording).sort(bySizeDesc).map(m => m.id), group: 'kinds' });
  add({ id: 'screenshots', title: 'Screenshots', subtitle: 'Newest first', ids: items.filter(isScreenshot).sort(newest).map(m => m.id), group: 'kinds' });
  const msg = items.filter(m => messagingApp(m));
  add({ id: 'messaging', title: 'Messaging apps', subtitle: 'WhatsApp, Telegram, Signal and others. Largest first', ids: msg.sort(bySizeDesc).map(m => m.id),
    labels: Object.fromEntries(msg.map(m => [m.id, messagingApp(m)!])), group: 'kinds' });
  add({ id: 'camera', title: 'Camera', subtitle: 'Newest first', ids: items.filter(isCamera).sort(newest).map(m => m.id), group: 'kinds' });
  add({ id: 'oldest', title: 'Oldest first', subtitle: 'Everything, from the very beginning', ids: items.slice().sort((a, b) => a.takenAt - b.takenAt).map(m => m.id), group: 'main' });
  // folders (Android "buckets")
  const byBucket = new Map<string, Media[]>(); for (const m of items) { const b = m.bucket || 'Other'; (byBucket.get(b) || byBucket.set(b, []).get(b)!).push(m); }
  [...byBucket.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([b, its]) =>
    add({ id: 'folder:' + b, title: b, subtitle: 'Folder · newest first', ids: its.sort(newest).map(m => m.id), group: 'folders' }));
  return decks;
}

export function deckStats(d: Deck, byId: Map<string, Media>, decisions: Record<string, Decision>) {
  let left = 0, leftBytes = 0, bytes = 0, later = 0, total = 0;
  const open = (id: string) => d.laterDeck ? decisions[id] === 'later' : !decisions[id];
  for (const id of d.ids) { const m = byId.get(id); if (!m) continue; total++; bytes += m.size; if (decisions[id] === 'later') later++; if (open(id)) { left++; leftBytes += m.size; } }
  return { total, left, leftBytes, bytes, later };
}
/** Items still to look at in a deck. In the Decide-later deck that's the 'later' ones; elsewhere, undecided ones. */
export const queueFor = (d: Deck, decisions: Record<string, Decision>, front: string[] = []) => {
  const open = (id: string) => d.laterDeck ? decisions[id] === 'later' : !decisions[id];
  const inDeck = new Set(d.ids);
  const f = front.filter(id => inDeck.has(id) && open(id)); const fs = new Set(f);
  return f.concat(d.ids.filter(id => open(id) && !fs.has(id)));
};
/** On this day (any date), grouped by year, newest year first. windowDays=0: that date; 3: ±3 days ("this week"). */
export function onThisDayGroups(items: Media[], date: Date, windowDays = 0) {
  const y0 = date.getFullYear(); const byYear = new Map<number, Media[]>();
  for (const m of items) { const d = new Date(m.takenAt); const yr = d.getFullYear(); if (yr >= y0) continue;
    const a = new Date(y0, d.getMonth(), d.getDate()).getTime(), b = new Date(y0, date.getMonth(), date.getDate()).getTime();
    let diff = Math.abs(a - b) / DAY; diff = Math.min(diff, 365 - diff); // wrap around new year
    if (Math.round(diff) <= windowDays) (byYear.get(yr) || byYear.set(yr, []).get(yr)!).push(m); }
  return [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([year, its]) => ({ year, ago: y0 - year, items: its.sort((a, b) => a.takenAt - b.takenAt) }));
}
export const monthKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
export const fmtMonth = (k: string) => { const [y, m] = k.split('-').map(Number); return `${['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1]} ${y}`; };
/** Month-by-month chunks. reviewed = every item has a final keep/remove choice ('later' doesn't count). */
export function months(items: Media[], decisions: Record<string, Decision>) {
  const map = new Map<string, Media[]>(); for (const m of items) { const k = monthKey(m.takenAt); (map.get(k) || map.set(k, []).get(k)!).push(m); }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([key, its]) => {
    const sorted = its.sort((a, b) => a.takenAt - b.takenAt); const done = sorted.filter(m => isFinal(decisions[m.id])).length;
    return { key, title: fmtMonth(key), items: sorted, count: sorted.length, bytes: sorted.reduce((a, m) => a + m.size, 0), done, later: sorted.filter(m => decisions[m.id] === 'later').length, reviewed: done === sorted.length };
  });
}
export const fmtRes = (m: Media) => { const p = Math.min(m.width, m.height); if (!p) return ''; return m.type === 'VIDEO' ? (p >= 2160 ? '4K' : p >= 1440 ? '1440p' : p >= 1080 ? '1080p' : p >= 720 ? '720p' : p + 'p') : `${(m.width * m.height / 1e6).toFixed(1)} MP`; };
export function chunk<T>(a: T[], n: number): T[][] { const out: T[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }

/* ---------- undo history (unlimited) ---------- */
export type HistEntry = { id: string; prev: Decision | null; next: Decision | null };
export function applyDecision(decisions: Record<string, Decision>, history: HistEntry[], id: string, next: Decision | null) {
  const prev = decisions[id] || null; const d = { ...decisions }; if (next) d[id] = next; else delete d[id];
  return { decisions: d, history: history.concat({ id, prev, next }) };
}
export function undoLast(decisions: Record<string, Decision>, history: HistEntry[]) {
  if (!history.length) return null; const h = history[history.length - 1]; const d = { ...decisions };
  if (h.prev) d[h.id] = h.prev; else delete d[h.id];
  return { decisions: d, history: history.slice(0, -1), entry: h };
}

/* ---------- daily habit ---------- */
export type DayLog = { date: string; activeMs: number; decided: number; trashedBytes: number; deletedBytes: number; lastActionAt?: number };
export const IDLE_CAP = 60000;
/** Active sorting time: each decision adds the time since the previous one, capped at 60 s (so a break doesn't count). */
export function logDecision(days: Record<string, DayLog>, now = Date.now()) {
  const k = dayKey(now); const d = { ...(days[k] || { date: k, activeMs: 0, decided: 0, trashedBytes: 0, deletedBytes: 0 }) };
  const gap = d.lastActionAt ? now - d.lastActionAt : 4000; d.activeMs += Math.max(0, Math.min(gap, IDLE_CAP)); d.decided++; d.lastActionAt = now;
  return { ...days, [k]: d };
}
export function logRemoval(days: Record<string, DayLog>, bytes: number, mode: 'trash' | 'delete', now = Date.now()) {
  const k = dayKey(now); const d = { ...(days[k] || { date: k, activeMs: 0, decided: 0, trashedBytes: 0, deletedBytes: 0 }) };
  if (mode === 'trash') d.trashedBytes += bytes; else d.deletedBytes += bytes; return { ...days, [k]: d };
}
/** Quiet streak: consecutive days with at least one decision, ending today (or yesterday if today has none yet). */
export function streak(days: Record<string, DayLog>, now = Date.now()) {
  let t = now; if (!(days[dayKey(t)]?.decided)) t -= DAY; let n = 0;
  while (days[dayKey(t)]?.decided) { n++; t -= DAY; } return n;
}

/** Gentle alternative to a streak: number of days this month with any sorting. Never goes down within a month. */
export function daysThisMonth(days: Record<string, DayLog>, now = Date.now()) { const k = monthKey(now); return Object.values(days).filter(d => d.decided && d.date.startsWith(k)).length; }
export const lookAlikeGroups = lookAlikes;
