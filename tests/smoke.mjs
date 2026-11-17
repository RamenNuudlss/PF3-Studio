import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
import fs from 'fs';
const out = '/tmp/shots'; fs.mkdirSync(out, { recursive: true });
const el = spawn('./node_modules/electron/dist/electron', ['--remote-debugging-port=9333', '--no-sandbox', '--disable-gpu', '.'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' } });
let log = ''; el.stdout.on('data', (d) => (log += d)); el.stderr.on('data', (d) => (log += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser;
for (let i = 0; i < 40 && !browser; i++) { await sleep(1000); try { browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null }); } catch {} }
if (!browser) { console.log('no connect', log.slice(0,2000)); process.exit(1); }
const pages = await browser.pages();
const page = pages.find((p) => p.url().includes('index.html')) ?? pages[0];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.setViewport({ width: 1440, height: 900 });
await sleep(1500);
const nav = async (label) => { await page.evaluate((l) => [...document.querySelectorAll('.nav button')].find((b) => b.textContent.includes(l))?.click(), label); await sleep(1200); };
for (const p of ['Design', 'Print', 'Printer', 'Stats', 'Settings']) { await nav(p); await page.screenshot({ path: `${out}/${p}.png` }); }
// full-res render pipeline check (same function used for printing)
await nav('Design');
const res = await page.evaluate(async () => {
  const t0 = performance.now();
  const mod = await import('./assets/' + [...document.scripts].map(s=>s.src).find(s=>s.includes('index-')).split('/assets/')[1]).catch(()=>null);
  return { t: performance.now() - t0, ok: !!mod };
});
console.log('errors:', JSON.stringify(errors, null, 1));
console.log(log.split('\n').filter((l) => /error|Error|ERR/.test(l)).slice(0, 20).join('\n'));
browser.disconnect(); el.kill();
