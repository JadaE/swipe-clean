// Headless test of Swipe Clean (demo mode + mocked Picker mode). Serves the app from a SUBPATH (/x/app/).
// Run: cd web && npm install && npm test   (needs Google Chrome at /usr/bin/google-chrome; set CHROME_PATH to override)
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const os = require('os');
const ROOT = path.join(__dirname, '..', 'app'), SHOTS = path.join(os.tmpdir(), 'swipeclean-shots') + '/'; fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); if (!u.startsWith('/x/app/')) { r.writeHead(404); return r.end(); }
  let f = path.join(ROOT, u.slice(7) || 'index.html'); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(8937);
const URL_ = 'http://localhost:8937/x/app/';
const res = []; const ok = (n, p, x = '') => { res.push({ n, p }); console.log((p ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const phone = { viewport: { width: 393, height: 851 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', acceptDownloads: true };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs = [];
  const ctx = await b.newContext({ ...phone, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('pageerror ' + e)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  p.on('dialog', d => d.accept());
  await p.goto(URL_);
  ok('google button disabled without CLIENT_ID', await p.$eval('#googleBtn', e => e.disabled));
  await p.screenshot({ path: SHOTS + '01-home.png' });
  await p.click('#demoBtn'); await p.waitForSelector('.card.top img:not([hidden])');
  const st = () => p.evaluate(() => ({ n: Object.keys(__sc.S.decisions).length, del: __sc.pile().length, h: __sc.S.history.length, combo: __sc.S.combo, top: document.querySelector('.card.top')?.dataset.id, counter: document.getElementById('counter').textContent }));
  const s0 = await st(); ok('demo loaded 60', s0.counter === '0 / 60', s0.counter);
  // real touch-ish drag with mouse: left
  const box = await p.locator('.card.top').boundingBox();
  const drag = async dx => { await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(box.x + box.width / 2 + dx * i / 8, box.y + box.height / 2 + 5); await p.mouse.up(); await p.waitForTimeout(400); };
  await drag(-200); let s = await st(); ok('drag left → delete pile', s.del === 1 && s.n === 1);
  await drag(200); s = await st(); ok('drag right → keep', s.del === 1 && s.n === 2);
  // small drag snaps back
  await drag(30); s = await st(); ok('small drag snaps back', s.n === 2);
  // mid-drag screenshot
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.mouse.move(box.x + box.width / 2 - 70, box.y + box.height / 2 + 6, { steps: 5 });
  await p.screenshot({ path: SHOTS + '02-swipe-dragging.png' }); await p.mouse.up(); await p.waitForTimeout(400);
  // touch swipe via synthetic pointer events w/ pointerType touch
  const touchSwipe = dx => p.evaluate(dx => { const el = document.querySelector('.card.top'); const r = el.getBoundingClientRect(); const o = { pointerId: 7, pointerType: 'touch', bubbles: true, isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: r.x + r.width / 2, clientY: r.y + 200 }));
    for (let i = 1; i <= 6; i++) el.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: r.x + r.width / 2 + dx * i / 6, clientY: r.y + 200 }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: r.x + r.width / 2 + dx, clientY: r.y + 200 })); }, dx);
  await touchSwipe(-180); await p.waitForTimeout(400); s = await st(); ok('touch swipe left', s.del === 2 && s.n === 3, JSON.stringify(s));
  // keyboard + buttons
  await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(350); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(350);
  await p.click('#delBtn'); await p.waitForTimeout(350); await p.click('#keepBtn'); await p.waitForTimeout(350);
  s = await st(); ok('keys + buttons', s.n === 7 && s.del === 4, JSON.stringify(s));
  // undo x3 (Z, Backspace, button) — top card returns
  const before = await p.evaluate(() => __sc.S.history.slice(-3).map(h => h.id).reverse());
  await p.keyboard.press('z'); await p.waitForTimeout(100); s = await st(); ok('undo (Z) restores last card on top', s.n === 6 && s.top === before[0]);
  await p.keyboard.press('Backspace'); await p.waitForTimeout(100); await p.click('#undoBtn'); await p.waitForTimeout(100);
  s = await st(); ok('unlimited undo (3 deep)', s.n === 4 && s.top === before[2] && s.combo === 0, JSON.stringify(s));
  // combo: 10 in a row
  for (let i = 0; i < 12; i++) { await p.keyboard.press(i % 3 ? 'ArrowRight' : 'ArrowLeft'); await p.waitForTimeout(290); }
  s = await st(); ok('combo counts', s.combo === 12, 'combo ' + s.combo);
  const hud = await p.evaluate(() => ({ space: document.getElementById('tSpace').textContent, prog: document.getElementById('progress').style.width }));
  ok('space tally + progress', /\d/.test(hud.space) && parseFloat(hud.prog) > 0, JSON.stringify(hud));
  await p.screenshot({ path: SHOTS + '03-swipe-hud.png' });
  // persistence across reload
  await p.reload(); await p.waitForSelector('[data-act="resume-demo"]'); ok('resume panel after reload', true);
  await p.click('[data-act="resume-demo"]'); await p.waitForSelector('.card.top'); s = await st(); ok('progress kept after reload', s.n === 16, JSON.stringify(s));
  // screenshots deck
  await p.click('[data-deck="shots"]'); await p.waitForTimeout(100);
  const shotTop = await p.evaluate(() => __sc.S.byId.get(document.querySelector('.card.top').dataset.id).filename);
  ok('screenshots deck', /^Screenshot/.test(shotTop), shotTop);
  await p.click('[data-deck="all"]');
  // finish the rest quickly
  for (let i = 0; ; i++) { const left = await p.evaluate(() => __sc.queue().length); if (!left) break; await p.keyboard.press(i % 4 ? 'ArrowRight' : 'ArrowLeft'); await p.waitForTimeout(285); }
  await p.waitForSelector('#sSummary.on'); await p.waitForTimeout(500);
  const sum = await p.evaluate(() => ({ sorted: sSorted.textContent, del: sDel.textContent, keep: sKeep.textContent, space: sSpace.textContent, lbl: sSpaceLbl.textContent, badge: sumBadge.textContent }));
  ok('summary shown at end', sum.sorted === '60' && +sum.del + +sum.keep === 60, JSON.stringify(sum));
  await p.screenshot({ path: SHOTS + '04-summary.png' });
  // review: rescue one
  await p.click('#toReviewBtn'); await p.waitForSelector('.tile img');
  const nDel = await p.evaluate(() => __sc.pile().length);
  await p.locator('.tile').first().click(); await p.waitForTimeout(100);
  ok('tap tile moves back to Keep', await p.evaluate(() => __sc.pile().length) === nDel - 1);
  await p.keyboard.press('z'); await p.waitForTimeout(100); ok('undo rescue', await p.evaluate(() => __sc.pile().length) === nDel);
  await p.waitForTimeout(400); await p.screenshot({ path: SHOTS + '05-review.png' });
  // handback
  await p.click('#toHandBtn'); await p.waitForSelector('.row');
  const href = await p.locator('.row a').first().getAttribute('href');
  ok('handback link = quoted filename search', /^https:\/\/photos\.google\.com\/search\/%22.+%22$/.test(href), href);
  ok('grouped by day', await p.locator('.day').count() >= 1);
  await p.locator('.row input').first().check(); ok('done tick persists', await p.evaluate(() => Object.keys(__sc.S.done).length === 1));
  await p.click('#copyBtn'); await p.waitForTimeout(200);
  const clip = await p.evaluate(() => navigator.clipboard.readText()); ok('copy list', clip.split('\n').length === nDel + 1, clip.split('\n')[1]);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#csvBtn')]);
  const csvPath = path.join(os.tmpdir(), 'swipeclean-out-delete-pile.csv'); await dl.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
  ok('CSV download', csv[0].startsWith('n,filename,date') && csv.length === nDel + 1, dl.suggestedFilename() + ' rows ' + (csv.length - 1));
  await p.screenshot({ path: SHOTS + '06-handback.png', fullPage: false });
  // pluggable link builder
  await p.evaluate(() => SwipeClean.setLinkBuilder(it => 'https://example.test/' + it.id)); ok('pluggable link builder', await p.evaluate(() => SwipeClean.linkFor({ id: 'q' })) === 'https://example.test/q');
  // about + clear
  await p.click('#aboutBtn'); await p.screenshot({ path: SHOTS + '07-about.png' }); await p.click('#clearBtn'); await p.waitForTimeout(100);
  ok('clear my data', await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('swipeclean')).length === 0));
  const stored = await ctx.storageState(); ok('no image data in storage', !JSON.stringify(stored).includes('data:image'));
  await ctx.close();

  // ---------- mocked Google Picker mode ----------
  const c2 = await b.newContext(phone); const g = await c2.newPage(); const calls = [];
  g.on('pageerror', e => errs.push('G pageerror ' + e)); g.on('console', m => m.type() === 'error' && errs.push('G ' + m.text()));
  await c2.route('**/x/app/config.js', async r => { const t = fs.readFileSync(ROOT + '/config.js', 'utf8').replace("CLIENT_ID: ''", "CLIENT_ID: 'test-client.apps.googleusercontent.com'").replace("LOGIN_HINT: ''", "LOGIN_HINT: 'test.user@example.com'"); r.fulfill({ contentType: 'text/javascript', body: t }); });
  await c2.addInitScript(() => { window.__scopes = []; window.google = { accounts: { oauth2: { initTokenClient(o) { window.__scopes.push(o.scope, o.login_hint); return { requestAccessToken() { setTimeout(() => o.callback({ access_token: 'tok123', expires_in: 3599, scope: o.scope }), 10); } }; }, hasGrantedAllScopes: () => true } } }; });
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,POST,DELETE' };
  const jpg = fs.readFileSync(ROOT + '/demo/01.jpg'); let polls = 0;
  const fake = n => ({ id: 'm' + n, createTime: '2024-0' + (1 + n % 9) + '-1' + (n % 9) + 'T12:00:00Z', type: n === 3 ? 'VIDEO' : 'PHOTO', mediaFile: { baseUrl: 'https://lh3.googleusercontent.com/fake' + n, mimeType: 'image/jpeg', filename: n === 2 ? 'Screenshot_20240101-101010.png' : 'PXL_2024_' + n + '.jpg', mediaFileMetadata: { width: 4000, height: 3000, cameraMake: 'Google', cameraModel: 'Pixel 8' } } });
  await c2.route(/photospicker\.googleapis\.com|googleusercontent\.com/, async r => {
    const q = r.request(), u = new URL(q.url()); if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    calls.push(q.method() + ' ' + u.host + u.pathname + u.search + ' auth=' + (q.headers().authorization || '-'));
    if (u.host.includes('googleusercontent')) return r.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'image/jpeg' }, body: jpg });
    if (u.host.includes('photospicker.googleapis.com') && u.pathname.startsWith('/v1/picker')) return r.fulfill({ status: 200, contentType: 'text/html', body: '<p>fake picker</p>' });
    if (q.method() === 'POST' && u.pathname === '/v1/sessions') return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ id: 'sess1', pickerUri: 'https://photospicker.googleapis.com/v1/picker/sess1', pollingConfig: { pollInterval: '1s', timeoutIn: '60s' }, mediaItemsSet: false }) });
    if (q.method() === 'GET' && u.pathname === '/v1/sessions/sess1') return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ id: 'sess1', mediaItemsSet: ++polls >= 2 }) });
    if (u.pathname === '/v1/mediaItems') { const pg = u.searchParams.get('pageToken'); const items = pg ? [5, 6, 7].map(fake) : [1, 2, 3, 4].map(fake); return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ mediaItems: items, nextPageToken: pg ? undefined : 'p2' }) }); }
    if (q.method() === 'DELETE') return r.fulfill({ status: 200, headers: CORS, body: '{}' });
    r.fulfill({ status: 404, headers: CORS, body: '{}' });
  });
  await g.goto(URL_);
  ok('google button enabled with CLIENT_ID', !(await g.$eval('#googleBtn', e => e.disabled)));
  await g.click('#googleBtn'); await g.waitForSelector('#sSwipe.on', { timeout: 15000 }); await g.waitForSelector('.card.top img:not([hidden])');
  const sc = await g.evaluate(() => window.__scopes);
  ok('only the read-only picker scope + login hint', sc[0] === 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly' && sc[1] === 'test.user@example.com', sc.join(' '));
  ok('paginated list (7 items)', (await g.textContent('#counter')) === '0 / 7');
  ok('every Google API/image call carries Bearer token (picker page itself excluded)', calls.filter(c => !c.includes('/v1/picker/')).every(c => c.endsWith('auth=Bearer tok123')), calls.length + ' calls');
  ok('thumb uses =w1024-h1024', calls.some(c => /fake\d=w1024-h1024/.test(c)));
  ok('session created + polled + listed', calls.some(c => c.startsWith('POST photospicker.googleapis.com/v1/sessions')) && calls.some(c => c.includes('/v1/mediaItems?sessionId=sess1')));
  ok('no write/delete-media endpoints used', !calls.some(c => /batchDelete|mediaItems:|albums|upload/i.test(c)));
  const tl = await g.textContent('#tSpace'); await g.keyboard.press('ArrowLeft'); await g.waitForTimeout(350);
  ok('space estimate shown for Picker items (≈)', (await g.textContent('#tSpace')).startsWith('≈'), await g.textContent('#tSpace'));
  await g.screenshot({ path: SHOTS + '08-google-mock-swipe.png' });
  console.log('Google calls:\n  ' + calls.join('\n  '));
  await c2.close();

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close(); srv.close();
  const f = res.filter(r => !r.p); console.log(`\n${res.length - f.length}/${res.length} passed`); process.exit(f.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
