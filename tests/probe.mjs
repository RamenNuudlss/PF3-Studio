import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
const el = spawn('./node_modules/electron/dist/electron', ['--remote-debugging-port=9333', '--no-sandbox', '--disable-gpu', '.'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser; for (let i = 0; i < 40 && !browser; i++) { await sleep(1000); try { browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null }); } catch {} }
const page = (await browser.pages()).find((p) => p.url().includes('index.html'));
const msgs=[]; page.on('console', m => msgs.push(m.type()+': '+m.text())); page.on('pageerror', e => msgs.push('pageerror: '+e.message));
await page.setViewport({ width: 1440, height: 900 });
await sleep(2000);
const script = process.argv[2];
const r = await page.evaluate(script);
console.log(JSON.stringify(r, null, 1)); console.log(msgs.join('\n'));
if (process.argv[3]) await page.screenshot({ path: process.argv[3] });
browser.disconnect(); el.kill(); process.exit(0);
