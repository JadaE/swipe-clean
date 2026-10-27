/* Swipe Clean v0.01: a private, client-only swipe sorter for Google Photos.
   No backend. Read-only Picker API scope only. The app can never delete anything. */
(() => {
'use strict';
const CFG = window.SWIPECLEAN_CONFIG || {};
const $ = id => document.getElementById(id);
const PICKER = 'https://photospicker.googleapis.com/v1';
const LS = 'swipeclean.v1.';
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(LS + k)); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { toast('Could not save progress on this device'); } },
  clear() { Object.keys(localStorage).filter(k => k.startsWith(LS)).forEach(k => localStorage.removeItem(k)); }
};

/* ---------- pluggable handback link builder ---------- */
// Picker mediaItems have no productUrl, so default to a quoted filename search in Google Photos.
// Swap in a better builder with window.SwipeClean.setLinkBuilder(fn) where fn(item) -> url|null.
let linkBuilder = item => item.productUrl || (item.filename ? 'https://photos.google.com/search/' + encodeURIComponent('"' + item.filename + '"') : null);

/* ---------- state ---------- */
// Persisted per source ('demo' | 'google'): item metadata (no image data, no baseUrls), decisions keyed by id,
// unlimited undo history, and "done" ticks for the handback list.
const S = {
  source: null, items: [], byId: new Map(), decisions: {}, history: [], done: {}, front: [],
  deck: 'all', combo: 0, bestCombo: 0, sess: { n: 0, start: 0, last: 0 }, busy: false
};
const stats = store.get('stats', { days: [], allTime: 0, bestCombo: 0 });

function persist() {
  if (!S.source) return;
  const items = S.items.map(({ baseUrl, ...m }) => m);
  store.set('data:' + S.source, { items, decisions: S.decisions, history: S.history, done: S.done, front: S.front });
  store.set('last', S.source);
  store.set('stats', stats);
}
function loadSource(source, freshItems) {
  const saved = store.get('data:' + source, null) || { items: [], decisions: {}, history: [], done: {}, front: [] };
  S.source = source;
  // merge: fresh items (with live baseUrls) win, older saved metadata kept so earlier Delete piles survive
  const map = new Map(saved.items.map(i => [i.id, i]));
  (freshItems || []).forEach(i => map.set(i.id, { ...map.get(i.id), ...i }));
  S.items = [...map.values()].sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
  S.byId = new Map(S.items.map(i => [i.id, i]));
  S.decisions = saved.decisions || {}; S.history = saved.history || []; S.done = saved.done || {}; S.front = (saved.front || []).filter(id => S.byId.has(id));
  S.combo = 0; S.sess = { n: 0, start: 0, last: 0 }; S.bestCombo = 0;
  // in Google mode, only items picked in THIS session are swipeable (older ones have no image URL)
  S.live = new Set((freshItems || S.items).map(i => i.id));
}

/* ---------- helpers ---------- */
const fmtBytes = b => { if (!b) return '0 MB'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return (b >= 100 || i < 2 ? Math.round(b) : b.toFixed(1)) + ' ' + u[i]; };
const fmtDate = iso => { if (!iso) return 'Unknown date'; const d = new Date(iso); return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
const dayKey = iso => { if (!iso) return 'Unknown date'; const d = new Date(iso); return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' }); };
const localDay = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Size: real bytes if known (demo), else an estimate from megapixels (~0.3 MB per MP for JPEG). Videos: unknown.
function sizeOf(it) {
  if (typeof it.sizeBytes === 'number') return { bytes: it.sizeBytes, est: false };
  if (it.type !== 'VIDEO' && it.width && it.height) return { bytes: Math.round(it.width * it.height / 1e6 * 0.3 * 1048576), est: true };
  return null;
}
const isShot = it => /screen ?shot|screen_?record/i.test(it.filename || '') || /^Screenshot/i.test(it.filename || '');
const DECKS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'shots', label: '📱 Screenshots', test: isShot },
  { id: 'videos', label: '🎬 Videos', test: it => it.type === 'VIDEO' },
  { id: 'old', label: '🕰 Oldest first', test: () => true, oldest: true }
];
function queue() {
  const deck = DECKS.find(d => d.id === S.deck) || DECKS[0];
  const undecided = it => !S.decisions[it.id] && S.live.has(it.id);
  const front = S.front.map(id => S.byId.get(id)).filter(it => it && undecided(it));
  const frontIds = new Set(front.map(i => i.id));
  let rest = S.items.filter(it => undecided(it) && deck.test(it) && !frontIds.has(it.id));
  if (deck.oldest) rest = rest.slice().reverse();
  return front.concat(rest);
}
const liveItems = () => S.items.filter(i => S.live.has(i.id));
const pile = () => S.items.filter(i => S.decisions[i.id] && S.decisions[i.id].d === 'del');
function tally() {
  let bytes = 0, est = false, unknown = 0;
  for (const it of pile()) { const s = sizeOf(it); if (s) { bytes += s.bytes; est = est || s.est; } else unknown++; }
  return { bytes, est, unknown };
}

/* ---------- UI plumbing ---------- */
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id)); window.scrollTo(0, 0); }
let toastT; function toast(msg, ms = 2200) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }
function comboPop(txt) { const p = $('comboPop'); p.textContent = txt; p.classList.remove('go'); void p.offsetWidth; p.classList.add('go'); }

/* ---------- confetti ---------- */
const cv = $('confetti'), cx = cv.getContext('2d'); let parts = [], raf = 0;
function confetti(n = 140) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio;
  const cols = ['#ffc94d', '#ff8a4d', '#2ed47a', '#ff4d6d', '#7aa2ff', '#f4f2ff'];
  for (let i = 0; i < n; i++) parts.push({ x: cv.width / 2 + (Math.random() - .5) * cv.width * .3, y: cv.height * .35, vx: (Math.random() - .5) * 18 * devicePixelRatio, vy: (-Math.random() * 16 - 6) * devicePixelRatio, r: (4 + Math.random() * 5) * devicePixelRatio, c: cols[i % cols.length], a: Math.random() * 6, life: 120 + Math.random() * 60 });
  if (!raf) tick();
}
function tick() {
  cx.clearRect(0, 0, cv.width, cv.height);
  parts = parts.filter(p => p.life-- > 0 && p.y < cv.height + 40);
  for (const p of parts) { p.vy += .45 * devicePixelRatio; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += .2; cx.save(); cx.translate(p.x, p.y); cx.rotate(p.a); cx.fillStyle = p.c; cx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); cx.restore(); }
  raf = parts.length ? requestAnimationFrame(tick) : (cx.clearRect(0, 0, cv.width, cv.height), 0);
}

/* ---------- image providers ---------- */
const blobs = new Map(); // id -> blob URL (Google mode)
const inflight = new Map();
async function imageUrl(it, params) {
  if (it.src) return it.src;                    // demo: local file
  if (!it.baseUrl) return null;                 // older Google item: link expired with its session
  const key = it.id + (params || CFG.THUMB_PARAMS);
  if (blobs.has(key)) return blobs.get(key);
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    let r;
    try { r = await gFetch(it.baseUrl + (params || CFG.THUMB_PARAMS), {}, true); }
    catch (e) { throw new Error(e.code === 'auth' ? 'auth' : 'cors'); }
    if (r.status === 403 || r.status === 404) { await refreshBaseUrls(); r = await gFetch(S.byId.get(it.id).baseUrl + (params || CFG.THUMB_PARAMS), {}, true); }
    if (!r.ok) throw new Error('http ' + r.status);
    const u = URL.createObjectURL(await r.blob()); blobs.set(key, u); return u;
  })();
  inflight.set(key, p); try { return await p; } finally { inflight.delete(key); }
}
function releaseImage(it) { // free memory for kept items; Delete-pile thumbnails stay for review
  for (const [k, u] of blobs) if (k.startsWith(it.id + '=')) { URL.revokeObjectURL(u); blobs.delete(k); }
}

/* ---------- deck rendering + swipe ---------- */
function renderDecks() {
  const live = liveItems();
  $('decks').innerHTML = DECKS.filter(d => d.id === 'all' || d.id === 'old' || live.some(d.test)).map(d => {
    const n = live.filter(it => d.test(it) && !S.decisions[it.id]).length;
    return `<button class="pill dk${d.id === S.deck ? ' sel' : ''}" data-deck="${d.id}" role="tab" aria-selected="${d.id === S.deck}">${d.label} ${d.id === 'old' ? '' : n}</button>`;
  }).join('');
}
function renderHud() {
  const live = liveItems(), total = live.length, sorted = live.filter(i => S.decisions[i.id]).length;
  $('counter').textContent = `${sorted} / ${total}`;
  $('progress').style.width = (total ? sorted / total * 100 : 0) + '%';
  $('combo').textContent = '🔥 ' + S.combo;
  const p = pile(), t = tally();
  $('tDel').textContent = p.length; $('tKeep').textContent = S.items.filter(i => S.decisions[i.id] && S.decisions[i.id].d === 'keep').length;
  $('tSpace').textContent = (t.est ? '≈' : '') + fmtBytes(t.bytes);
  $('tUnknown').textContent = t.unknown ? ` +${t.unknown}?` : '';
  $('tUnknown').title = t.unknown ? `${t.unknown} item(s) with unknown size (e.g. videos)` : '';
  renderDecks();
}
function cardHtml(it, cls) {
  const s = sizeOf(it);
  const bits = [fmtDate(it.createTime), s ? (s.est ? '≈' : '') + fmtBytes(s.bytes) : 'size unknown', it.camera].filter(Boolean).join(' · ');
  return `<div class="card ${cls}" data-id="${esc(it.id)}"><div class="loading">Loading…</div><img alt="" hidden>
    ${it.type === 'VIDEO' ? '<span class="tag">🎬 video</span>' : isShot(it) ? '<span class="tag">📱 screenshot</span>' : ''}
    <div class="stamp keep">Keep</div><div class="stamp del">Delete pile</div>
    <div class="meta"><b>${esc(it.filename || 'Untitled')}</b>${esc(bits)}</div></div>`;
}
async function fillCard(el, it) {
  try {
    const u = await imageUrl(it);
    const img = el.querySelector('img');
    if (!u) { el.querySelector('.loading').textContent = 'Preview expired. Pick again to see it.'; return; }
    img.onload = () => { img.hidden = false; const l = el.querySelector('.loading'); l && l.remove(); };
    img.src = u;
  } catch (e) {
    const l = el.querySelector('.loading');
    if (l) l.textContent = e.message === 'auth' ? 'Google connection expired. Go Home and tap Reconnect.' : e.message === 'cors' ? 'Your browser blocked loading this photo from Google (network/CORS). Try Chrome, or reload.' : 'Couldn’t load this photo (' + e.message + ').';
  }
}
function render() {
  renderHud();
  const q = queue(), deck = $('deck');
  if (!q.length) {
    deck.innerHTML = '';
    if (liveItems().length && S.sess.n && liveItems().every(i => S.decisions[i.id])) { finish(true); }
    else deck.innerHTML = `<div class="loading">Nothing left in this deck. 🎉</div>`;
    return;
  }
  deck.innerHTML = (q[1] ? cardHtml(q[1], 'under') : '') + cardHtml(q[0], 'top');
  deck.querySelectorAll('.card').forEach(el => fillCard(el, S.byId.get(el.dataset.id)));
  q.slice(2, 5).forEach(it => imageUrl(it).catch(() => {})); // prefetch next 3
  attachDrag(deck.querySelector('.card.top'));
}
function attachDrag(el) {
  let sx = 0, sy = 0, dx = 0, dy = 0, t0 = 0, down = false;
  const stK = el.querySelector('.stamp.keep'), stD = el.querySelector('.stamp.del');
  el.addEventListener('pointerdown', e => { if (S.busy) return; down = true; sx = e.clientX; sy = e.clientY; dx = dy = 0; t0 = performance.now(); try { el.setPointerCapture(e.pointerId); } catch {} el.style.transition = 'none'; });
  el.addEventListener('pointermove', e => {
    if (!down) return; dx = e.clientX - sx; dy = e.clientY - sy;
    el.style.transform = `translate(${dx}px,${dy * .3}px) rotate(${dx / 18}deg)`;
    stK.style.opacity = Math.max(0, Math.min(1, dx / 90)); stD.style.opacity = Math.max(0, Math.min(1, -dx / 90));
  });
  const up = () => {
    if (!down) return; down = false;
    const v = Math.abs(dx) / Math.max(1, performance.now() - t0);
    if (Math.abs(dx) > Math.min(110, el.offsetWidth * .28) || (v > .6 && Math.abs(dx) > 40)) decide(dx < 0 ? 'del' : 'keep');
    else { el.style.transition = 'transform .25s'; el.style.transform = ''; stK.style.opacity = stD.style.opacity = 0; }
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
function decide(d) {
  if (S.busy) return;
  const el = $('deck').querySelector('.card.top'); if (!el) return;
  const it = S.byId.get(el.dataset.id); S.busy = true;
  el.style.transition = 'transform .28s ease-in, opacity .28s';
  el.querySelector(d === 'keep' ? '.stamp.keep' : '.stamp.del').style.opacity = 1;
  el.style.transform = `translate(${d === 'keep' ? '' : '-'}150vw, 40px) rotate(${d === 'keep' ? 24 : -24}deg)`;
  el.style.opacity = '0';
  if (navigator.vibrate) try { navigator.vibrate(d === 'del' ? 12 : 6); } catch {}
  setTimeout(() => {
    S.busy = false;
    S.history.push({ id: it.id, prev: null });
    S.decisions[it.id] = { d, t: Date.now() };
    S.front = S.front.filter(x => x !== it.id);
    if (d === 'keep') releaseImage(it);
    const now = Date.now(); if (!S.sess.start) S.sess.start = now; S.sess.n++; S.sess.last = now;
    S.combo++; S.bestCombo = Math.max(S.bestCombo, S.combo); stats.bestCombo = Math.max(stats.bestCombo, S.combo); stats.allTime++;
    const today = localDay(); if (!stats.days.includes(today)) stats.days.push(today);
    if (S.combo % 10 === 0) { comboPop(`🔥 Combo ×${S.combo}!`); confetti(50); $('combo').classList.add('bump'); setTimeout(() => $('combo').classList.remove('bump'), 200); }
    persist(); render(); renderHome();
  }, 260);
}
function undo() {
  const h = S.history.pop();
  if (!h) { toast('Nothing to undo'); return; }
  if (h.prev) S.decisions[h.id] = h.prev; else { delete S.decisions[h.id]; S.front.unshift(h.id); stats.allTime = Math.max(0, stats.allTime - 1); S.sess.n = Math.max(0, S.sess.n - 1); }
  S.combo = 0;
  const it = S.byId.get(h.id);
  persist();
  if (!h.prev && !S.live.has(h.id)) { toast(`Undid ${it ? it.filename : 'item'} (pick it again to re-sort)`); renderHud(); return; }
  toast('↶ Undone: ' + (it ? it.filename : ''));
  if ($('sSwipe').classList.contains('on')) render(); else if ($('sReview').classList.contains('on')) renderReview(); else { show('sSwipe'); render(); }
}

/* ---------- summary ---------- */
function finish(auto) {
  const live = liveItems(), sorted = live.filter(i => S.decisions[i.id]).length, t = tally();
  const p = pile().length, k = S.items.filter(i => S.decisions[i.id] && S.decisions[i.id].d === 'keep').length;
  $('sSorted').textContent = sorted; $('sDel').textContent = p; $('sKeep').textContent = k;
  $('sSpace').textContent = (t.est ? '≈' : '') + fmtBytes(t.bytes);
  $('sSpaceLbl').textContent = (t.est ? 'you could free (estimate)' : 'you could free') + (t.unknown ? ` + ${t.unknown} of unknown size` : '');
  $('sCombo').textContent = S.bestCombo;
  $('sPace').textContent = S.sess.n > 1 ? ((S.sess.last - S.sess.start) / 1000 / (S.sess.n - 1)).toFixed(1) : '–';
  const n = S.sess.n || sorted;
  const [emoji, title, badge] = sorted === live.length && live.length ? ['🏆', 'All sorted!', ''] : ['🎉', 'Nice work!', ''];
  $('sumEmoji').textContent = emoji; $('sumTitle').textContent = title;
  $('sumBadge').textContent = n >= 100 ? '👑 Cleanup Legend' : n >= 40 ? '⚡ Declutter Dynamo' : n >= 15 ? '🐯 Tidy Tiger' : '🌱 Warming up';
  $('backSwipeBtn').hidden = !queue().length;
  show('sSummary'); confetti(auto ? 180 : 90);
}

/* ---------- review + handback ---------- */
async function thumbInto(img, it) {
  try { const u = await imageUrl(it, it.src ? null : CFG.REVIEW_THUMB_PARAMS); if (u) { img.src = u; return; } } catch {}
  img.replaceWith(Object.assign(document.createElement('div'), { className: img.className === 'ph' ? 'ph' : 'noimg', textContent: it.filename || '?' }));
}
function renderReview() {
  const p = pile(); $('rCount').textContent = p.length;
  const g = $('rGrid');
  g.innerHTML = p.length ? p.map(it => `<button class="tile" data-id="${esc(it.id)}" aria-label="Move ${esc(it.filename)} back to Keep"><img alt=""><span class="x">↩ keep</span></button>`).join('')
    : '<p class="mut" style="grid-column:1/-1">Your Delete pile is empty. 🎈</p>';
  g.querySelectorAll('.tile').forEach(b => thumbInto(b.querySelector('img'), S.byId.get(b.dataset.id)));
  $('toHandBtn').disabled = !p.length;
}
function rescue(id) {
  const it = S.byId.get(id);
  S.history.push({ id, prev: S.decisions[id] }); S.decisions[id] = { d: 'keep', t: Date.now() };
  persist(); renderReview(); toast(`Moved ${it.filename} back to Keep (Z to undo)`);
}
function renderHand() {
  const p = pile(), groups = new Map();
  for (const it of p) { const k = dayKey(it.createTime); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  let i = 0, html = '';
  for (const [day, list] of groups) {
    html += `<div class="day">${esc(day)} · ${list.length}</div>`;
    for (const it of list) {
      i++; const url = linkBuilder(it), s = sizeOf(it), done = !!S.done[it.id];
      html += `<div class="row${done ? ' done' : ''}" data-id="${esc(it.id)}"><img class="ph" alt="">
        <div class="info"><b>${i}. ${esc(it.filename || 'Untitled')}</b>${esc(fmtDate(it.createTime))}${it.camera ? ' · ' + esc(it.camera) : ''}${s ? ' · ' + (s.est ? '≈' : '') + fmtBytes(s.bytes) : ''}<br>
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open in Google Photos ↗</a>` : '<span class="mut">No link: search for the name in Google Photos</span>'}</div>
        <label><input type="checkbox" ${done ? 'checked' : ''} aria-label="Done with ${esc(it.filename)}">done</label></div>`;
    }
  }
  $('handList').innerHTML = html || '<p class="mut">Nothing in your Delete pile.</p>';
  $('handList').querySelectorAll('.row').forEach(r => thumbInto(r.querySelector('img'), S.byId.get(r.dataset.id)));
}
function handRows() { return pile().map((it, n) => { const s = sizeOf(it); return { n: n + 1, id: it.id, filename: it.filename || '', date: it.createTime || '', type: it.type || '', camera: it.camera || '', width: it.width || '', height: it.height || '', size_bytes: s ? s.bytes : '', size_is_estimate: s ? (s.est ? 'yes' : 'no') : '', link: linkBuilder(it) || '', done: S.done[it.id] ? 'yes' : 'no' }; }); }
function listText() { return 'My Delete pile (check each one, delete it in Google Photos, then empty Trash):\n' + handRows().map(r => `${r.n}. ${r.filename} | ${r.date ? fmtDate(r.date) : 'unknown date'} | ${r.link}`).join('\n'); }
function csvText() {
  const cols = ['n', 'filename', 'date', 'type', 'camera', 'width', 'height', 'size_bytes', 'size_is_estimate', 'link', 'done', 'id'];
  const q = v => { v = String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return cols.join(',') + '\n' + handRows().map(r => cols.map(c => q(r[c])).join(',')).join('\n') + '\n';
}
async function copyList() {
  const t = listText();
  try { await navigator.clipboard.writeText(t); toast('📋 Copied ' + pile().length + ' items'); }
  catch { const ta = Object.assign(document.createElement('textarea'), { value: t }); document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('📋 Copied'); } catch { toast('Copy failed. Use Download CSV instead.'); } ta.remove(); }
}
function downloadCsv() {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csvText()], { type: 'text/csv' })), download: `delete-pile-${localDay()}.csv` });
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- home ---------- */
function dayStreak() {
  const set = new Set(stats.days); let d = new Date(), n = 0;
  if (!set.has(localDay(d))) d.setDate(d.getDate() - 1);
  while (set.has(localDay(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function renderHome() {
  $('dayStreak').textContent = dayStreak(); $('allTime').textContent = stats.allTime;
  const box = $('resumeBox'); box.innerHTML = '';
  for (const src of ['demo', 'google']) {
    const d = store.get('data:' + src, null); if (!d || !d.items || !d.items.length) continue;
    const decided = Object.keys(d.decisions || {}).length, del = Object.values(d.decisions || {}).filter(x => x.d === 'del').length;
    const panel = document.createElement('div'); panel.className = 'panel';
    panel.innerHTML = src === 'demo'
      ? `<h3>Demo in progress</h3><p class="mut tiny" style="margin:0">${decided} of ${d.items.length} sorted · ${del} in Delete pile</p><button class="btn small" data-act="resume-demo">Resume demo</button><button class="btn small" data-act="review-demo">Delete pile</button>`
      : `<h3>Your Google Photos sort</h3><p class="mut tiny" style="margin:0">${decided} sorted · ${del} in Delete pile (saved on this device). To sort more, pick again; photos you've already sorted are skipped.</p><button class="btn small" data-act="review-google">Delete pile</button>`;
    box.appendChild(panel);
  }
}

/* ---------- Google Photos Picker mode (read-only) ---------- */
const G = { token: null, exp: 0, tc: null, session: null, listedAt: 0 };
const gReady = () => !!CFG.CLIENT_ID;
function setStatus(html) { $('googleStatus').innerHTML = html; }
function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = res; s.onerror = () => rej(new Error('Could not load Google sign-in')); document.head.appendChild(s); });
}
function getToken() {
  return new Promise((res, rej) => {
    G.tc = google.accounts.oauth2.initTokenClient({
      client_id: CFG.CLIENT_ID, scope: CFG.SCOPE, login_hint: CFG.LOGIN_HINT || undefined,
      callback: r => {
        if (r.error) return rej(new Error(r.error_description || r.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, CFG.SCOPE)) return rej(new Error('Permission to view picked photos wasn’t granted.'));
        G.token = r.access_token; G.exp = Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60000; res();
      },
      error_callback: e => rej(new Error(e && e.type === 'popup_closed' ? 'Sign-in window was closed.' : (e && e.message) || 'Sign-in failed'))
    });
    G.tc.requestAccessToken({ prompt: '' });
  });
}
async function gFetch(url, opts = {}, raw) {
  if (!G.token || Date.now() > G.exp) { const e = new Error('auth'); e.code = 'auth'; throw e; }
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + G.token } });
  if (r.status === 401) { G.token = null; const e = new Error('auth'); e.code = 'auth'; showReconnect(); throw e; }
  if (raw) return r;
  if (!r.ok) throw new Error('Google said ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.status === 204 ? {} : r.json();
}
const dur = s => (parseFloat(String(s || '').replace('s', '')) || 0) * 1000;
function normalize(m) {
  const f = m.mediaFile || {}, md = f.mediaFileMetadata || {};
  return { id: m.id, filename: f.filename || '', createTime: m.createTime || '', type: m.type === 'VIDEO' ? 'VIDEO' : 'PHOTO', mimeType: f.mimeType || '',
    width: Number(md.width) || null, height: Number(md.height) || null, camera: [md.cameraMake, md.cameraModel].filter(Boolean).join(' ') || '', sizeBytes: null, baseUrl: f.baseUrl };
}
async function listAll(sessionId) {
  const out = []; let pageToken = '';
  do { const j = await gFetch(`${PICKER}/mediaItems?sessionId=${encodeURIComponent(sessionId)}&pageSize=100${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`); (j.mediaItems || []).forEach(m => out.push(normalize(m))); pageToken = j.nextPageToken || ''; } while (pageToken);
  return out;
}
async function refreshBaseUrls() { // baseUrls last ~60 min; re-list the same session to get fresh ones
  if (!G.session) return;
  const fresh = await listAll(G.session.id); fresh.forEach(f => { const it = S.byId.get(f.id); if (it) it.baseUrl = f.baseUrl; }); G.listedAt = Date.now();
}
function showReconnect() { setStatus('Google connection expired (it lasts about an hour). <b>Tap the button above to reconnect.</b>'); $('googleBtn').textContent = 'Reconnect to Google Photos'; toast('Google connection expired. Reconnect from Home.', 3500); }
async function deleteSession(keepalive) {
  if (!G.session || !G.token) return; const id = G.session.id; G.session = null;
  try { await fetch(`${PICKER}/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', keepalive: !!keepalive, headers: { Authorization: 'Bearer ' + G.token } }); } catch {}
}
async function googleFlow() {
  const btn = $('googleBtn');
  try {
    btn.disabled = true; setStatus('Opening Google sign-in…');
    await loadGis();
    if (!G.token || Date.now() > G.exp) await getToken();
    if (G.session) { // reconnect case: refresh existing session's items
      setStatus('Reconnected. Refreshing your picked photos…'); await refreshBaseUrls(); blobs.clear(); setStatus(''); btn.textContent = 'Pick photos from Google Photos'; btn.disabled = false; if (S.source === 'google') { show('sSwipe'); render(); } return;
    }
    setStatus('Starting a picker session…');
    const sess = await gFetch(`${PICKER}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pickingConfig: { maxItemCount: String(CFG.MAX_ITEMS || 2000) } }) });
    G.session = sess;
    const uri = sess.pickerUri + '/autoclose';
    setStatus(`<a class="btn pri" id="openPicker" href="${esc(uri)}" target="_blank" rel="noopener">Open Google’s photo picker ↗</a>Pick up to ${CFG.MAX_ITEMS || 2000} photos there (tip: select a whole day or month), tap <b>Done</b>, then come back here. Waiting…`);
    const w = window.open(uri, '_blank'); // may be blocked (not a direct tap); the link above is the fallback
    if (w) setStatus(waitingHtml(uri));
    const interval = Math.max(2000, dur(sess.pollingConfig && sess.pollingConfig.pollInterval) || 5000);
    const deadline = Date.now() + (dur(sess.pollingConfig && sess.pollingConfig.timeoutIn) || 30 * 60000);
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, interval));
      const s = await gFetch(`${PICKER}/sessions/${encodeURIComponent(sess.id)}`);
      if (s.mediaItemsSet) {
        setStatus('Loading your picked photos…');
        const items = await listAll(sess.id); G.listedAt = Date.now();
        if (!items.length) { setStatus('No photos were picked. Tap the button to try again.'); G.session = null; btn.disabled = false; return; }
        loadSource('google', items); persist(); S.deck = 'all';
        const already = items.filter(i => S.decisions[i.id]).length;
        setStatus(''); btn.disabled = false; show('sSwipe'); render();
        toast(`Loaded ${items.length} photos${already ? ` (${already} already sorted, skipped)` : ''}`, 3000);
        return;
      }
    }
    throw new Error('The picker timed out. Tap the button to try again.');
  } catch (e) {
    btn.disabled = false;
    if (e.code === 'auth') { showReconnect(); return; }
    setStatus('⚠️ ' + esc(e.message || e));
  }
  function waitingHtml(uri) { return `Google’s picker opened in a new tab (on Android it may open the Photos app). Pick your photos, tap <b>Done</b>, then come back here. Waiting… <a href="${esc(uri)}" target="_blank" rel="noopener" style="color:var(--acc)">Reopen picker</a>`; }
}

/* ---------- demo mode ---------- */
async function startDemo() {
  const r = await fetch('demo/demo.json'); const items = await r.json();
  items.forEach(i => { i.camera = i.camera || (i.filename.startsWith('PXL') ? 'Google Pixel' : ''); });
  loadSource('demo', items); persist(); S.deck = 'all'; show('sSwipe'); render();
}

/* ---------- wiring ---------- */
function wire() {
  const gb = $('googleBtn');
  if (!gReady()) { gb.disabled = true; setStatus('Google Photos isn’t connected yet (needs a one-time setup). Try the demo for now.'); }
  gb.onclick = googleFlow;
  $('acctHint').textContent = CFG.LOGIN_HINT || 'your account';
  $('demoBtn').onclick = startDemo;
  $('delBtn').onclick = () => decide('del'); $('keepBtn').onclick = () => decide('keep'); $('undoBtn').onclick = undo;
  $('finishBtn').onclick = () => finish(false);
  $('decks').onclick = e => { const b = e.target.closest('[data-deck]'); if (b) { S.deck = b.dataset.deck; render(); } };
  $('toReviewBtn').onclick = () => { renderReview(); show('sReview'); };
  $('backSwipeBtn').onclick = () => { show('sSwipe'); render(); };
  $('toHandBtn').onclick = () => { renderHand(); show('sHand'); };
  $('backReviewBtn').onclick = () => { renderReview(); show('sReview'); };
  ['homeBtn1', 'homeBtn2', 'homeBtn3'].forEach(id => $(id).onclick = () => { renderHome(); show('sHome'); });
  $('rGrid').onclick = e => { const t = e.target.closest('.tile'); if (t) rescue(t.dataset.id); };
  $('handList').onchange = e => { const r = e.target.closest('.row'); if (!r) return; if (e.target.checked) S.done[r.dataset.id] = true; else delete S.done[r.dataset.id]; r.classList.toggle('done', e.target.checked); persist(); if (pile().length && pile().every(i => S.done[i.id])) { confetti(); toast('All done! Now empty Trash in Google Photos to free the space. 🎉', 4000); } };
  $('copyBtn').onclick = copyList; $('csvBtn').onclick = downloadCsv;
  $('resumeBox').onclick = async e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    const [act, src] = a.dataset.act.split('-');
    if (src === 'demo') await startDemo(); else { loadSource('google', null); S.live = new Set(G.session ? S.items.filter(i => i.baseUrl).map(i => i.id) : []); }
    if (act === 'review') { renderReview(); show('sReview'); }
  };
  const dlg = $('about');
  $('aboutBtn').onclick = () => dlg.showModal(); $('aboutClose').onclick = () => dlg.close();
  $('clearBtn').onclick = () => {
    if (!confirm('Clear all your keep/delete choices and stats saved on this device? Your photos in Google Photos are not affected.')) return;
    store.clear(); deleteSession(); Object.assign(stats, { days: [], allTime: 0, bestCombo: 0 });
    S.source = null; S.items = []; S.byId = new Map(); S.decisions = {}; S.history = []; S.done = {}; S.front = [];
    for (const u of blobs.values()) URL.revokeObjectURL(u); blobs.clear();
    dlg.close(); renderHome(); show('sHome'); toast('Cleared. Nothing is saved on this device now.');
  };
  document.addEventListener('keydown', e => {
    if (dlg.open || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const onSwipe = $('sSwipe').classList.contains('on');
    if (e.key === 'ArrowLeft' && onSwipe) { e.preventDefault(); decide('del'); }
    else if (e.key === 'ArrowRight' && onSwipe) { e.preventDefault(); decide('keep'); }
    else if ((e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') && !e.metaKey && !e.ctrlKey && (onSwipe || $('sReview').classList.contains('on') || $('sSummary').classList.contains('on'))) { e.preventDefault(); undo(); }
  });
  addEventListener('pagehide', () => deleteSession(true));
  renderHome();
}
wire();

window.SwipeClean = { setLinkBuilder(fn) { if (typeof fn === 'function') linkBuilder = fn; }, linkFor: it => linkBuilder(it) };
window.__sc = { S, stats, queue, pile, tally, csvText, listText, sizeOf };
})();
