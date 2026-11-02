'use strict';
// Optional real-browser integration checks; runtime and core tests need no dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const server = spawn(process.execPath, [path.join(__dirname, 'serve.cjs')], { env: { ...process.env, PORT: '8127' }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverError = '';
server.stderr.on('data', chunk => { serverError += chunk.toString(); });
const errors = [];
const check = message => console.log(`PASS: ${message}`);
let browser;
(async () => {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview startup timed out')), 5000);
    server.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited: ${code} ${serverError}`)); });
  });
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('favicon')) errors.push(message.text()); });
  await page.goto('http://127.0.0.1:8127');
  await page.locator('#toggle-run').click();
  assert.equal(await page.locator('#population').innerText(), '30');
  const canvasPixels = await page.locator('#dish').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set(); for (let i = 0; i < pixels.length; i += 64) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    return colors.size;
  });
  assert.ok(canvasPixels > 30, 'dish should contain rendered life and food');
  check('HTTP loading, 30 initial organisms, and Canvas rendering');
  const pausedTime = await page.locator('#sim-time').innerText();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#sim-time').innerText(), pausedTime);
  check('pause freezes simulated time');
  for (const rate of [1, 2, 5]) {
    await page.locator(`[data-speed="${rate}"]`).click();
    assert.equal(await page.locator(`[data-speed="${rate}"]`).getAttribute('aria-pressed'), 'true');
  }
  await page.locator('#toggle-run').click();
  await page.waitForFunction(() => document.getElementById('sim-time').textContent >= '00:05');
  await page.locator('#toggle-run').click();
  check('resume and 1×/2×/5× controls');
  await page.locator('#initial-population').evaluate(input => { input.value = '45'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#seed').fill('browser-test-seed');
  assert.ok(await page.locator('#pending-notice').isVisible());
  assert.equal(await page.locator('#population').innerText(), '30');
  await page.locator('#food-rate').evaluate(input => { input.value = '12'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#mutation-rate').evaluate(input => { input.value = '60'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.match(await page.locator('#food-rate-value').innerText(), /12/);
  assert.match(await page.locator('#mutation-rate-value').innerText(), /60/);
  await page.locator('#apply-reset').click();
  await page.locator('#toggle-run').click();
  assert.equal(await page.locator('#population').innerText(), '45');
  assert.equal(await page.locator('#seed-label').innerText(), 'browser-test-seed');
  assert.equal(await page.locator('#total-births').innerText(), '0');
  assert.equal(await page.locator('#total-deaths').innerText(), '0');
  assert.equal(await page.locator('[data-speed="1"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#pending-notice').isVisible(), false);
  check('parameter labels, pending changes, seed application and full reset');
  await page.locator('#dish').focus(); await page.keyboard.press('ArrowRight');
  assert.match(await page.locator('#inspector').innerText(), /个体 #/);
  await page.locator('label[for="show-sense"]').click();
  assert.equal(await page.locator('#show-sense').isChecked(), true);
  check('keyboard specimen inspection and sensing overlay');
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'artifacts/desktop.png'), fullPage: true });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto('http://127.0.0.1:8127');
  await mobile.locator('#toggle-run').click();
  assert.equal(await mobile.locator('#population').innerText(), '30');
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile page should not overflow horizontally');
  await mobile.screenshot({ path: path.join(root, 'artifacts/mobile.png'), fullPage: true });
  check('390px mobile layout without horizontal overflow');
  const offline = await browser.newPage();
  try {
    await offline.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await offline.locator('#toggle-run').click();
    assert.equal(await offline.locator('#population').innerText(), '30');
    check('file:// offline loading');
  } catch (error) {
    if (!error.message.includes('ERR_BLOCKED_BY_ADMINISTRATOR')) throw error;
    console.log('SKIP: file:// verification blocked by managed browser policy; HTTP checks completed.');
  }
  assert.deepEqual(errors, [], 'browser errors');
  check('no JavaScript or asset errors');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  server.kill();
});
