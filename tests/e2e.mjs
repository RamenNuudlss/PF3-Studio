import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
import fs from 'fs';
const el = spawn('./node_modules/electron/dist/electron', ['--remote-debugging-port=9333', '--no-sandbox', '--disable-gpu', '.'], { stdio: ['ignore','pipe','pipe'], env: { ...process.env, PF3_PRINT_TO_DIR: '/tmp/vjobs' } });
let log=''; el.stdout.on('data',d=>log+=d); el.stderr.on('data',d=>log+=d);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser; for (let i = 0; i < 40 && !browser; i++) { await sleep(1000); try { browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null }); } catch {} }
const page = (await browser.pages()).find((p) => p.url().includes('index.html'));
const errs=[]; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
await page.setViewport({ width: 1440, height: 900 });
await sleep(1500);
const click = (sel, txt) => page.evaluate((s, t) => { const b=[...document.querySelectorAll(s)].find(b => b.textContent.includes(t)); b?.click(); return !!b; }, sel, txt);
// 1) UI print with batch rows
await click('.nav button', 'Print'); await sleep(800);
await click('.btn', 'Add row'); await sleep(300);
await page.evaluate(() => { const inp=[...document.querySelectorAll('table.tbl input[type=text]')]; const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true}));}; set(inp[0],'Fast & Furious'); set(inp[1],'The Complete Saga'); set(inp[2],'2001'); set(inp[3],'1'); });
await sleep(500);
await click('.btn.primary', 'Print 1 disc');
for (let i=0;i<60 && !(fs.existsSync('/tmp/vjobs') && fs.readdirSync('/tmp/vjobs').length);i++) await sleep(500);
await sleep(1500);
await page.screenshot({ path: '/tmp/shots/after_print.png' });
// 2) API print (Boxset hook) with image path
const r = await fetch('http://127.0.0.1:47823/print', { method: 'POST', body: JSON.stringify({ image: '/tmp/testdisc.png', copies: 1, quality: 'best', name: 'API test' }) });
console.log('api', r.status, await r.text());
for (let i=0;i<60 && fs.readdirSync('/tmp/vjobs').length<2;i++) await sleep(500);
console.log('status', await (await fetch('http://127.0.0.1:47823/status')).text().then(t=>t.slice(0,300)));
await click('.nav button', 'Printer'); await sleep(1000); await page.screenshot({ path: '/tmp/shots/printer_virtual.png' });
await click('.nav button', 'Stats'); await sleep(1000); await page.screenshot({ path: '/tmp/shots/stats_after.png' });
console.log('files', fs.readdirSync('/tmp/vjobs'));
console.log('errors', errs);
console.log(log.split('\n').filter(l=>/Error|error/.test(l) && !/bus\.cc|dbus|NODE_OPTION/.test(l)).slice(0,10).join('\n'));
browser.disconnect(); el.kill(); process.exit(0);
