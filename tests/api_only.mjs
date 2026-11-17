import { spawn } from 'child_process'; import fs from 'fs';
const el = spawn('./node_modules/electron/dist/electron', ['--no-sandbox', '--disable-gpu', '.'], { stdio: 'ignore', env: { ...process.env, PF3_PRINT_TO_DIR: '/tmp/vjobs', PF3_DUMP_RGB: '/tmp/dump' } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i=0;i<30;i++){ await sleep(1000); try { await fetch('http://127.0.0.1:47823/status'); break; } catch {} }
await sleep(2000);
console.log((await (await fetch('http://127.0.0.1:47823/print', { method: 'POST', body: JSON.stringify({ image: process.argv[2], name: 'API test' }) })).text()));
for (let i=0;i<60 && !(fs.existsSync('/tmp/vjobs') && fs.readdirSync('/tmp/vjobs').length);i++) await sleep(500);
el.kill(); process.exit(0);
