import { EventEmitter } from 'events';
import { Worker } from 'worker_threads';
import path from 'path';
import { nativeImage } from 'electron';
import { PrinterService, isError } from './printerService';
import { Firmware, JobOptions, pagePixels, DPI } from './core/pcl';
import { STATE_TEXT, PrinterStatus } from './core/status';
import { Stats } from './stats';
import { loadVendorJob, VendorJob } from './vendor';

export type MaintenanceAction =
  | { kind: 'clean'; level: 1 | 2 | 3; verify: boolean }
  | { kind: 'margin-calibration' }
  | { kind: 'exercise-belt' }
  | { kind: 'pen-calibration-print' }
  | { kind: 'pen-calibration-set'; values: [number, number, number, number]; verify: boolean }
  | { kind: 'vendor-test-disc' }
  | { kind: 'raw'; data: number[]; label: string };

export interface DiscItem { png: Buffer; label: string; coverage?: Coverage }
export interface Coverage { c: number; m: number; y: number; k: number }

export interface Job {
  id: string;
  name: string;
  createdAt: number;
  kind: 'discs' | 'maintenance';
  items: DiscItem[];          // for discs: one entry per disc (copies already expanded)
  options: JobOptions;
  maintenance?: MaintenanceAction;
  state: 'queued' | 'printing' | 'paused' | 'done' | 'failed' | 'cancelled';
  progress: number;           // 0..1 over whole job
  current: number;            // disc index
  message: string;
  error?: string;
}

export interface QueueSettings {
  lowInkThresholds: number[]; // e.g. [10,5,3]
  pauseOnLowInk: boolean;
}

let nextId = 1;

export class JobQueue extends EventEmitter {
  jobs: Job[] = [];
  private running = false;
  private signal = { cancelled: false };
  private resumeWaiter: (() => void) | null = null;
  private warnedLevels = new Map<string, number>();
  settings: QueueSettings = { lowInkThresholds: [10, 5, 3], pauseOnLowInk: true };

  constructor(private printer: PrinterService, private stats: Stats, private workerPath: string) { super(); }

  list() { return this.jobs; }

  addDiscJob(name: string, items: DiscItem[], options: JobOptions): Job {
    const job: Job = { id: String(nextId++), name, createdAt: Date.now(), kind: 'discs', items, options, state: 'queued', progress: 0, current: 0, message: 'Queued' };
    this.jobs.push(job);
    this.changed();
    this.pump();
    return job;
  }

  addMaintenance(action: MaintenanceAction, name: string): Job {
    const job: Job = { id: String(nextId++), name, createdAt: Date.now(), kind: 'maintenance', items: [], options: { quality: 'best', media: 'photo' }, maintenance: action, state: 'queued', progress: 0, current: 0, message: 'Queued' };
    this.jobs.push(job);
    this.changed();
    this.pump();
    return job;
  }

  cancel(id: string) {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) return;
    if (j.state === 'printing' || j.state === 'paused') {
      this.signal.cancelled = true;
      this.resume();
    } else if (j.state === 'queued') {
      j.state = 'cancelled'; j.message = 'Cancelled';
    }
    this.changed();
  }

  /** Clears every queued job and aborts the active one (Print Queue Utility replacement). */
  async clearAll() {
    for (const j of this.jobs) if (j.state === 'queued') { j.state = 'cancelled'; j.message = 'Cancelled'; }
    const active = this.jobs.find((j) => j.state === 'printing' || j.state === 'paused');
    if (active) this.cancel(active.id);
    try { await this.printer.send(Firmware.cancel()); } catch { /* printer may be offline */ }
    try { await this.printer.softReset(); } catch { /* ignore */ }
    this.changed();
  }

  removeFinished() { this.jobs = this.jobs.filter((j) => j.state === 'queued' || j.state === 'printing' || j.state === 'paused'); this.changed(); }

  resume() { const r = this.resumeWaiter; this.resumeWaiter = null; r?.(); }

  private changed() { this.emit('jobs', this.jobs); }

  private async pause(job: Job, message: string, reason: 'error' | 'low-ink') {
    job.state = 'paused'; job.message = message; this.changed();
    this.emit('attention', { jobId: job.id, message, reason });
    await new Promise<void>((r) => (this.resumeWaiter = r));
    if (this.signal.cancelled) throw new Error('Cancelled');
    job.state = 'printing'; job.message = 'Resuming'; this.changed();
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const job = this.jobs.find((j) => j.state === 'queued');
        if (!job) break;
        this.signal = { cancelled: false };
        job.state = 'printing'; job.message = 'Starting'; this.changed();
        try {
          if (job.kind === 'maintenance') await this.runMaintenance(job);
          else await this.runDiscs(job);
          job.state = 'done'; job.progress = 1; job.message = 'Finished';
        } catch (e: any) {
          if (this.signal.cancelled) {
            job.state = 'cancelled'; job.message = 'Cancelled';
            try { await this.printer.send(Firmware.cancel()); } catch { /* ignore */ }
          } else { job.state = 'failed'; job.error = e.message; job.message = e.message; }
        }
        this.changed();
      }
    } finally { this.running = false; }
  }

  /** Before each disc: refuse to continue into an error and warn on low ink (10/5/3 % like the original). */
  private async preflight(job: Job) {
    for (;;) {
      const st = (await this.printer.refresh()).status;
      if (!st) {
        await this.pause(job, 'Printer disconnected. Reconnect it and press Resume.', 'error');
        continue;
      }
      if (isError(st)) {
        await this.pause(job, STATE_TEXT[st.state], 'error');
        continue;
      }
      this.checkInk(job, st);
      if (this.lowInkPending) {
        const msg = this.lowInkPending; this.lowInkPending = null;
        if (this.settings.pauseOnLowInk) await this.pause(job, msg, 'low-ink');
      }
      return st;
    }
  }

  private lowInkPending: string | null = null;
  private checkInk(job: Job, st: PrinterStatus) {
    for (const c of st.cartridges) {
      if (c.level == null) continue;
      const key = `${c.type}`;
      const crossed = this.settings.lowInkThresholds.filter((t) => c.level! <= t).sort((a, b) => a - b)[0];
      if (crossed === undefined) { this.warnedLevels.delete(key); continue; }
      if (this.warnedLevels.get(key) === crossed) continue;
      this.warnedLevels.set(key, crossed);
      const name = c.type === 'black' ? 'Black (V101B)' : c.type === 'tri-color' ? 'Color (V102C)' : c.type;
      const msg = `${name} cartridge is at ${c.level}% (below ${crossed}%).`;
      this.emit('notice', { level: 'warning', message: msg });
      this.lowInkPending = msg + ' Continue printing?';
    }
  }

  private encode(png: Buffer, options: JobOptions, onProgress: (f: number) => void): Promise<{ job: Buffer; coverage: Coverage }> {
    const dpi = DPI[options.quality];
    const size = pagePixels(dpi);
    let img = nativeImage.createFromBuffer(png);
    const s = img.getSize();
    if (s.width !== size || s.height !== size) img = img.resize({ width: size, height: size, quality: 'best' });
    const bgra = img.toBitmap(); // BGRA on Windows
    return new Promise((resolve, reject) => {
      const w = new Worker(this.workerPath);
      w.on('message', (m: any) => {
        if (m.type === 'progress') onProgress(m.value);
        else if (m.type === 'done') { resolve({ job: Buffer.from(m.job), coverage: m.coverage }); w.terminate(); }
        else if (m.type === 'error') { reject(new Error(m.message)); w.terminate(); }
      });
      w.on('error', reject);
      w.postMessage({ bgra, width: size, height: size, options }, [bgra.buffer as ArrayBuffer]);
    });
  }

  private async runDiscs(job: Job) {
    const n = job.items.length;
    for (let i = 0; i < n; i++) {
      job.current = i;
      const item = job.items[i];
      const before = await this.preflight(job);
      job.message = `Preparing disc ${i + 1} of ${n}`; this.changed();
      const { job: data, coverage } = await this.encode(item.png, job.options, (f) => { job.progress = (i + f * 0.2) / n; this.changed(); });
      if (this.signal.cancelled) throw new Error('Cancelled');
      job.message = `Printing disc ${i + 1} of ${n}${item.label ? ` - ${item.label}` : ''}`; this.changed();
      const t0 = Date.now();
      await this.printer.send(data, (sent, total) => { job.progress = (i + 0.2 + 0.7 * sent / total) / n; this.changed(); }, this.signal);
      // wait for the disc to finish before feeding the next (lets us catch empty hopper / errors per disc)
      const after = await this.printer.waitIdle(15 * 60_000, this.signal);
      if (after && after.state === 'out-of-media') {
        // the disc wasn't printed: ask for discs, then retry this one
        await this.pause(job, STATE_TEXT['out-of-media'], 'error');
        i--; continue;
      }
      job.progress = (i + 1) / n; this.changed();
      this.stats.recordDisc({ jobName: job.name, label: item.label, quality: job.options.quality, media: job.options.media, coverage, seconds: (Date.now() - t0) / 1000, inkBefore: before?.cartridges, inkAfter: after?.cartridges });
    }
  }

  private async sendVendor(job: Job, which: VendorJob, label: string) {
    const data = loadVendorJob(which);
    if (!data) throw new Error(`${label} needs the original Microboards job files (vendor folder). See Settings > Original software files.`);
    job.message = `Printing ${label}`; this.changed();
    await this.printer.send(data, (s, t) => { job.progress = 0.3 + 0.6 * s / t; this.changed(); }, this.signal);
    await this.printer.waitIdle(10 * 60_000, this.signal);
  }

  private async runMaintenance(job: Job) {
    const a = job.maintenance!;
    const fw = async (buf: Buffer, msg: string) => {
      job.message = msg; this.changed();
      await this.printer.send(buf);
      job.progress = 0.3; this.changed();
      await new Promise((r) => setTimeout(r, 2500));
      await this.printer.waitIdle(10 * 60_000, this.signal);
    };
    switch (a.kind) {
      case 'clean':
        await this.preflight(job);
        await fw(Firmware.clean(a.level), `${['', 'Light', 'Regular', 'Heavy'][a.level]} clean in progress`);
        this.stats.recordMaintenance(`clean-${a.level}`);
        if (a.verify) { await this.preflight(job); await this.sendVendor(job, 'clean-verify', 'cleaning verification disc'); }
        break;
      case 'margin-calibration':
        await this.preflight(job);
        await fw(Firmware.autoMarginCalibration(), 'Automatic margin calibration (a disc will be measured and ejected)');
        this.stats.recordMaintenance('margin-calibration');
        break;
      case 'exercise-belt':
        await fw(Firmware.exerciseBelt(), 'Exercising belts');
        this.stats.recordMaintenance('exercise-belt');
        break;
      case 'pen-calibration-print':
        await this.preflight(job);
        await fw(Firmware.resetPenCalibration(), 'Resetting pen calibration');
        await this.preflight(job);
        await this.sendVendor(job, 'align-vertical', 'alignment disc 1 of 2');
        await this.preflight(job);
        await this.sendVendor(job, 'align-pattern2', 'alignment disc 2 of 2');
        break;
      case 'pen-calibration-set':
        await fw(Firmware.penCalibration(a.values), 'Saving pen calibration');
        this.stats.recordMaintenance('pen-calibration');
        if (a.verify) {
          await this.preflight(job);
          await this.sendVendor(job, 'align-vertical', 'verification disc 1 of 2');
          await this.preflight(job);
          await this.sendVendor(job, 'align-pattern2', 'verification disc 2 of 2');
        }
        break;
      case 'vendor-test-disc':
        await this.preflight(job);
        await this.sendVendor(job, 'test-disc', 'Microboards test disc');
        break;
      case 'raw':
        await fw(Buffer.from(a.data), a.label);
        break;
    }
  }
}

export const workerFile = () => path.join(__dirname, 'encodeWorker.js');
