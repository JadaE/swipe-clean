// Live smoke test of the deployed demo (no account involved): node test/live-smoke.js
const { chromium } = require('playwright-core'); const cfg = require('../secret-config.json');
(async () => { const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true })).newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e))); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto(`https://${cfg.slug}.here.now/${cfg.path_token}/`); await p.click('#demoBtn'); await p.waitForSelector('.card.top img:not([hidden])');
  await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(400); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(400); await p.keyboard.press('z'); await p.waitForTimeout(200);
  console.log('counter', await p.textContent('#counter'), 'pile', await p.textContent('#tDel'), 'googleBtnDisabled', await p.$eval('#googleBtn', e => e.disabled), 'errors', errs.length ? errs : 'none');
  await b.close(); })();
