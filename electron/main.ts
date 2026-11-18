import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, dialog, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { PrinterService } from './printerService';
import { JobQueue, workerFile, DiscItem } from './jobs';
import { Stats } from './stats';
import { vendorAvailability, vendorDirs } from './vendor';
import { penLabelToValue, JobOptions } from './core/pcl';
import { listDevices } from './device/usbprint';
import { isReadOnly, scanDs2 } from './firmware';

/* ------------------------------------------------------------ settings */
interface Settings {
  apiEnabled: boolean; apiPort: number;
  minimizeToTray: boolean; startWithWindows: boolean;
  lowInkThresholds: number[]; pauseOnLowInk: boolean;
  beltReminderDays: number;
  defaults: JobOptions & { maskOuter: number; maskInner: number; offsetX: number; offsetY: number };
}
const DEFAULTS: Settings = {
  apiEnabled: true, apiPort: 47823, minimizeToTray: true, startWithWindows: false,
  lowInkThresholds: [10, 5, 3], pauseOnLowInk: true, beltReminderDays: 14,
  defaults: { quality: 'best', media: 'photo', inkDensity: 4, dryTime: 0, maskOuter: 1182, maskInner: 378, offsetX: 0, offsetY: 0 },
};
const userDir = () => app.getPath('userData');
const settingsFile = () => path.join(userDir(), 'settings.json');
let settings: Settings = DEFAULTS;
function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; settings.defaults = { ...DEFAULTS.defaults, ...settings.defaults }; } catch { settings = DEFAULTS; }
}
function saveSettings() { fs.mkdirSync(userDir(), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); }

/* ------------------------------------------------------------ app */
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
const printer = new PrinterService();
let stats: Stats;
let queue: JobQueue;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function send(channel: string, payload: unknown) { win?.webContents.send(channel, payload); }

function iconPath() { return path.join(__dirname, '..', 'assets', 'icon.png'); }

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    backgroundColor: '#0d0f14', title: 'PF3 Studio', icon: iconPath(),
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#0d0f14', symbolColor: '#c8ccd6', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  });
  win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
  win.on('close', (e) => {
    if (!quitting && settings.minimizeToTray) { e.preventDefault(); win?.hide(); }
  });
}

function createTray() {
  const img = nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open PF3 Studio', click: () => { win?.show(); win?.focus(); } },
    { label: statusLine(), enabled: false },
    { type: 'separator' },
    { label: 'Print test disc', click: () => queue.addMaintenance({ kind: 'vendor-test-disc' }, 'Test disc') },
    { label: 'Clear print queue', click: () => queue.clearAll() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setToolTip('PF3 Studio');
  tray.setContextMenu(menu());
  tray.on('double-click', () => { win?.show(); win?.focus(); });
  printer.on('state', () => tray?.setContextMenu(menu()));
}

function statusLine() {
  const s = printer.state;
  if (!s.connected) return 'PF-3: not connected';
  const ink = s.status?.cartridges.map((c) => `${c.type === 'black' ? 'K' : c.type === 'tri-color' ? 'CMY' : c.type} ${c.level ?? '?'}%`).join('  ') ?? '';
  return `PF-3: ${s.status?.text ?? 'unknown'}  ${ink}`;
}

function notify(title: string, body: string) {
  if (Notification.isSupported()) new Notification({ title, body, icon: iconPath() }).show();
}

/* ------------------------------------------------------------ external API (Boxset hook) */
let server: http.Server | null = null;
let pendingRenders = new Map<string, (r: { ok: boolean; pngs?: string[]; error?: string }) => void>();

/** Ask the UI to render a template with field values (used by the API and CLI). */
function renderInUi(req: { template?: unknown; templatePath?: string; image?: string; rows: Record<string, string>[]; quality: string }): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (!win) return reject(new Error('UI not ready'));
    const id = Math.random().toString(36).slice(2);
    pendingRenders.set(id, (r) => (r.ok ? resolve(r.pngs!) : reject(new Error(r.error))));
    send('api:render', { id, ...req });
    setTimeout(() => { if (pendingRenders.delete(id)) reject(new Error('Render timed out')); }, 120_000);
  });
}

async function apiPrint(body: any) {
  const opts: JobOptions = { ...settings.defaults, ...(body.options ?? {}), name: body.name ?? 'Boxset' };
  if (body.quality) opts.quality = body.quality;
  if (body.media) opts.media = body.media;
  const copies = Math.max(1, Math.min(100, Number(body.copies ?? 1)));
  let template = body.template;
  if (!template && body.templatePath) template = JSON.parse(fs.readFileSync(body.templatePath, 'utf8'));
  let image = body.image as string | undefined; // data URL, base64 or file path
  if (image && !image.startsWith('data:') && fs.existsSync(image)) {
    const ext = path.extname(image).slice(1).toLowerCase().replace('jpg', 'jpeg');
    image = `data:image/${ext};base64,${fs.readFileSync(image).toString('base64')}`;
  } else if (image && !image.startsWith('data:')) image = `data:image/png;base64,${image}`;
  const rows: Record<string, string>[] = Array.isArray(body.rows) && body.rows.length ? body.rows : [body.fields ?? {}];
  const pngs = await renderInUi({ template, image, rows, quality: opts.quality });
  const items: DiscItem[] = [];
  pngs.forEach((p, i) => { for (let c = 0; c < copies; c++) items.push({ png: Buffer.from(p, 'base64'), label: rows[i]?.title ?? rows[i]?.name ?? `Disc ${i + 1}` }); });
  return queue.addDiscJob(opts.name ?? 'Boxset', items, opts);
}

function startApi() {
  server?.close(); server = null;
  if (!settings.apiEnabled) return;
  server = http.createServer(async (req, res) => {
    const json = (code: number, obj: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    try {
      if (req.method === 'GET' && req.url === '/status') return json(200, { printer: { ...printer.state, status: printer.state.status && { ...printer.state.status, raw: undefined } }, jobs: queue.list().map(({ items, ...j }) => ({ ...j, discs: items.length })) });
      if (req.method === 'POST' && req.url === '/print') {
        let body = ''; for await (const chunk of req) body += chunk;
        const job = await apiPrint(JSON.parse(body || '{}'));
        return json(200, { ok: true, jobId: job.id, discs: job.items.length });
      }
      if (req.method === 'POST' && req.url?.startsWith('/cancel/')) { queue.cancel(req.url.split('/')[2]); return json(200, { ok: true }); }
      json(404, { error: 'Endpoints: GET /status, POST /print, POST /cancel/:id' });
    } catch (e: any) { json(500, { ok: false, error: e.message }); }
  });
  server.on('error', (e) => send('notice', { level: 'error', message: `Boxset API could not start: ${e.message}` }));
  server.listen(settings.apiPort, '127.0.0.1');
}

/* ------------------------------------------------------------ CLI:  "PF3 Studio.exe" --print file.png [--copies 2] [--quality maxdpi] [--template x.pf3label --fields '{"title":"..."}'] */
function parseCli(argv: string[]) {
  const i = argv.indexOf('--print');
  if (i < 0 && !argv.includes('--template')) return null;
  const get = (k: string) => { const j = argv.indexOf(k); return j >= 0 ? argv[j + 1] : undefined; };
  return { image: i >= 0 ? argv[i + 1] : undefined, templatePath: get('--template'), copies: get('--copies'), quality: get('--quality'), media: get('--media'), fields: get('--fields') ? JSON.parse(get('--fields')!) : undefined, name: get('--name') };
}
async function handleCli(argv: string[]) {
  const req = parseCli(argv);
  if (!req) return;
  try { const job = await apiPrint(req); notify('PF3 Studio', `Queued ${job.items.length} disc(s): ${job.name}`); }
  catch (e: any) { notify('PF3 Studio', `Could not print: ${e.message}`); }
}

/* ------------------------------------------------------------ IPC */
function registerIpc() {
  ipcMain.handle('printer:state', () => printer.state);
  ipcMain.handle('printer:refresh', () => printer.refresh());
  ipcMain.handle('printer:rawDeviceId', () => printer.rawDeviceId());
  ipcMain.handle('printer:devices', () => { try { return listDevices(true); } catch (e: any) { return { error: e.message }; } });
  ipcMain.handle('printer:softReset', () => printer.softReset());
  ipcMain.handle('fw:query', async (_e, { cmd, allowWrite }: { cmd: string; allowWrite: boolean }) => {
    if (!allowWrite && !isReadOnly(cmd)) return { ok: false, error: 'Blocked: this is not a read-only command. Tick "Allow write commands" to send it.' };
    try { return { ok: true, reply: await printer.udwQuery(cmd) }; } catch (e: any) { return { ok: false, error: e.message }; }
  });
  let scanSignal = { cancelled: false };
  ipcMain.handle('fw:scan', async (_e, { from, to }: { from: number; to: number }) => {
    scanSignal = { cancelled: false };
    const res = await scanDs2(printer, from, to, (done, total, found) => send('fw:scanProgress', { done, total, found }), scanSignal);
    return res;
  });
  ipcMain.handle('fw:scanStop', () => { scanSignal.cancelled = true; });

  ipcMain.handle('jobs:list', () => queue.list().map(({ items, ...j }) => ({ ...j, discs: items.length, labels: items.map((x) => x.label) })));
  ipcMain.handle('jobs:print', (_e, req: { name: string; pngs: { data: string; label: string }[]; options: JobOptions }) => {
    const items = req.pngs.map((p) => ({ png: Buffer.from(p.data, 'base64'), label: p.label }));
    const j = queue.addDiscJob(req.name, items, req.options);
    return j.id;
  });
  ipcMain.handle('jobs:maintenance', (_e, action, name) => queue.addMaintenance(action, name).id);
  ipcMain.handle('jobs:cancel', (_e, id: string) => queue.cancel(id));
  ipcMain.handle('jobs:resume', () => queue.resume());
  ipcMain.handle('jobs:clearAll', () => queue.clearAll());
  ipcMain.handle('jobs:removeFinished', () => queue.removeFinished());
  ipcMain.handle('pen:labelToValue', (_e, labels: number[]) => labels.map(penLabelToValue));

  ipcMain.handle('stats:get', () => stats.data);
  ipcMain.handle('stats:setPricing', (_e, p) => { stats.setPricing(p); return stats.data; });
  ipcMain.handle('stats:reset', () => { stats.reset(); return stats.data; });

  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (_e, s: Partial<Settings>) => {
    settings = { ...settings, ...s, defaults: { ...settings.defaults, ...(s.defaults ?? {}) } };
    saveSettings();
    queue.settings = { lowInkThresholds: settings.lowInkThresholds, pauseOnLowInk: settings.pauseOnLowInk };
    app.setLoginItemSettings({ openAtLogin: settings.startWithWindows, args: ['--hidden'] });
    startApi();
    return settings;
  });

  ipcMain.handle('vendor:status', () => ({ available: vendorAvailability(), dir: vendorDirs()[0] }));
  ipcMain.handle('vendor:import', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Select the extracted vendor .pcl files', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PCL', extensions: ['pcl'] }] });
    if (r.canceled) return vendorAvailability();
    const dir = vendorDirs()[0]; fs.mkdirSync(dir, { recursive: true });
    for (const f of r.filePaths) fs.copyFileSync(f, path.join(dir, path.basename(f)));
    return vendorAvailability();
  });

  ipcMain.handle('file:save', async (_e, { name, data, filters }) => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: name, filters });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, typeof data === 'string' ? data : Buffer.from(data));
    return r.filePath;
  });
  ipcMain.handle('file:open', async (_e, { filters, binary }) => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters });
    if (r.canceled) return null;
    const p = r.filePaths[0];
    return { path: p, name: path.basename(p), data: binary ? fs.readFileSync(p).toString('base64') : fs.readFileSync(p, 'utf8') };
  });
  ipcMain.handle('shell:open', (_e, url: string) => shell.openExternal(url));
  ipcMain.on('api:rendered', (_e, r: { id: string; ok: boolean; pngs?: string[]; error?: string }) => { pendingRenders.get(r.id)?.(r); pendingRenders.delete(r.id); });
}

/* ------------------------------------------------------------ boot */
app.on('second-instance', (_e, argv) => {
  if (parseCli(argv)) handleCli(argv);
  else { win?.show(); win?.focus(); }
});

app.whenReady().then(() => {
  loadSettings();
  stats = new Stats(userDir());
  let wf = workerFile();
  if (wf.includes('app.asar')) wf = wf.replace('app.asar', 'app.asar.unpacked');
  queue = new JobQueue(printer, stats, wf);
  queue.settings = { lowInkThresholds: settings.lowInkThresholds, pauseOnLowInk: settings.pauseOnLowInk };
  registerIpc();
  createWindow();
  createTray();
  if (process.argv.includes('--hidden')) win?.hide();

  printer.on('state', (s) => { send('printer:state', s); if (s.status) stats.recordInk(s.status.cartridges); });
  queue.on('jobs', (jobs) => send('jobs:update', jobs.map(({ items, ...j }: any) => ({ ...j, discs: items.length, labels: items.map((x: any) => x.label) }))));
  queue.on('attention', (a) => { send('jobs:attention', a); notify('PF-3 needs attention', a.message); });
  queue.on('notice', (n) => { send('notice', n); notify('PF3 Studio', n.message); });
  printer.start();
  startApi();

  // belt-exercise reminder after idle periods (manual: recondition belts after sitting idle)
  setTimeout(() => {
    const idleDays = (Date.now() - stats.data.lastActivity) / 86_400_000;
    if (settings.beltReminderDays > 0 && idleDays >= settings.beltReminderDays) {
      send('notice', { level: 'info', message: `The PF-3 has been idle for ${Math.floor(idleDays)} days. Running "Exercise Belt" before printing helps the disc feed.`, action: 'exercise-belt' });
    }
  }, 4000);

  win!.webContents.once('did-finish-load', () => handleCli(process.argv));
});

app.on('before-quit', () => { quitting = true; printer.stop(); server?.close(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && quitting) app.quit(); });
