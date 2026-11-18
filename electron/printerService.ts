import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

/** Debug/test: PF3_PRINT_TO_DIR=<folder> simulates an idle PF-3 and writes every job to that folder. */
const VIRTUAL_DIR = process.env.PF3_PRINT_TO_DIR || null;
const VIRTUAL_ID = 'MFG:Microboards;MDL:PF-3 (virtual);CMD:PCL3GUI,PJL,DW-PCL;CLS:PRINTER;S:0300000000000000002C100004BC200003C;';
let virtualSeq = 0;
import { listDevices, UsbPrintHandle } from './device/usbprint';
import { parseStatus, PrinterStatus, STATE_TEXT } from './core/status';

export interface ConnState {
  connected: boolean;
  path: string | null;
  serial: string | null;
  model: string | null;
  status: PrinterStatus | null;
  error: string | null;
  updatedAt: number;
}

const BUSY_STATES = new Set(['busy', 'printing', 'report-printing', 'canceling', 'dry-wait', 'pen-cleaning', 'pen-checking', 'io-stall']);
const ERROR_STATES = new Set(['out-of-media', 'media-jam', 'carriage-stall', 'media-stall', 'pen-failure', 'hard-error', 'door-open', 'out-of-ink', 'cartridge-missing', 'cartridge-wrong']);

export const isBusy = (s: PrinterStatus | null) => !!s && BUSY_STATES.has(s.state);
export const isError = (s: PrinterStatus | null) => !!s && ERROR_STATES.has(s.state);

/**
 * Owns the connection to the printer. Handles are opened per operation (the original
 * Toolbox did the same) so other tools can still talk to the printer between jobs.
 */
export class PrinterService extends EventEmitter {
  state: ConnState = { connected: false, path: null, serial: null, model: null, status: null, error: null, updatedAt: 0 };
  private timer: NodeJS.Timeout | null = null;
  private ioLock: Promise<unknown> = Promise.resolve();
  private writing = false;
  pollMs = 2000;

  start() {
    const tick = async () => {
      if (!this.writing) await this.refresh().catch(() => {});
      this.timer = setTimeout(tick, this.pollMs);
    };
    tick();
  }
  stop() { if (this.timer) clearTimeout(this.timer); }

  /** Serialise all device IO. */
  private withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.ioLock.then(fn, fn);
    this.ioLock = run.catch(() => {});
    return run;
  }

  async refresh(): Promise<ConnState> {
    return this.withLock(() => {
      let next: ConnState;
      try {
        if (VIRTUAL_DIR) {
          const st = parseStatus(VIRTUAL_ID);
          next = { connected: true, path: VIRTUAL_DIR, serial: 'VIRTUAL', model: 'PF-3 (virtual)', status: st, error: null, updatedAt: Date.now() };
          const changed = this.state.updatedAt === 0; this.state = next; if (changed) this.emit('state', next); return next;
        }
        const devs = listDevices();
        if (!devs.length) {
          next = { connected: false, path: null, serial: null, model: null, status: null, error: 'PF-3 not found. Check that it is powered on and connected by USB.', updatedAt: Date.now() };
        } else {
          const d = devs[0];
          const h = new UsbPrintHandle(d.path);
          try {
            const id = h.deviceId();
            const st = parseStatus(id);
            next = { connected: true, path: d.path, serial: d.serial, model: st.fields['MDL'] ?? 'PF-3', status: st, error: null, updatedAt: Date.now() };
          } finally { h.close(); }
        }
      } catch (e: any) {
        next = { ...this.state, connected: false, status: null, error: e.message ?? String(e), updatedAt: Date.now() };
      }
      const changed = JSON.stringify({ ...next, updatedAt: 0, status: next.status && { ...next.status, raw: '' } }) !==
        JSON.stringify({ ...this.state, updatedAt: 0, status: this.state.status && { ...this.state.status, raw: '' } });
      this.state = next;
      if (changed) this.emit('state', next);
      return next;
    });
  }

  /** Send raw bytes in chunks, reporting progress. */
  async send(data: Buffer, onProgress?: (sent: number, total: number) => void, signal?: { cancelled: boolean }): Promise<void> {
    return this.withLock(async () => {
      if (VIRTUAL_DIR) {
        fs.mkdirSync(VIRTUAL_DIR, { recursive: true });
        fs.writeFileSync(path.join(VIRTUAL_DIR, `job_${String(++virtualSeq).padStart(3, '0')}.pcl`), data);
        onProgress?.(data.length, data.length);
        return;
      }
      const devs = listDevices();
      if (!devs.length) throw new Error('PF-3 not connected');
      const h = new UsbPrintHandle(devs[0].path);
      this.writing = true;
      try {
        const CHUNK = 64 * 1024;
        for (let off = 0; off < data.length; off += CHUNK) {
          if (signal?.cancelled) throw new Error('Cancelled');
          const n = await h.write(data.subarray(off, Math.min(data.length, off + CHUNK)));
          if (n <= 0) throw new Error('Printer stopped accepting data');
          onProgress?.(Math.min(data.length, off + CHUNK), data.length);
        }
      } finally {
        this.writing = false;
        h.close();
      }
    });
  }

  async rawDeviceId(): Promise<string> {
    if (VIRTUAL_DIR) return VIRTUAL_ID;
    return this.withLock(() => {
      const devs = listDevices();
      if (!devs.length) throw new Error('PF-3 not connected');
      const h = new UsbPrintHandle(devs[0].path);
      try { return h.deviceId(); } finally { h.close(); }
    });
  }

  /**
   * Send one firmware ("underware") command line and return the printer's text reply.
   * Same wrapper and back-channel the Microboards status monitor used for ds2.get.
   */
  async udwQuery(cmd: string, totalMs = 4000): Promise<string> {
    if (VIRTUAL_DIR) return `(virtual printer) ${cmd}`;
    return this.withLock(async () => {
      const devs = listDevices();
      if (!devs.length) throw new Error('PF-3 not connected');
      const h = new UsbPrintHandle(devs[0].path);
      this.writing = true;
      try {
        await h.readUntilQuiet(300, 150); // drain anything stale
        const line = cmd.trim().endsWith(';') ? cmd.trim() : cmd.trim() + ';';
        await h.write(Buffer.concat([Buffer.from([0x1b]), Buffer.from('%P' + line + 'udw.quit;', 'latin1')]));
        const reply = await h.readUntilQuiet(totalMs, 600);
        return reply.toString('latin1').replace(/\0/g, '').trim();
      } finally {
        this.writing = false;
        h.close();
      }
    });
  }

  async softReset(): Promise<boolean> {
    return this.withLock(() => {
      const devs = listDevices();
      if (!devs.length) return false;
      const h = new UsbPrintHandle(devs[0].path);
      try { return h.softReset(); } finally { h.close(); }
    });
  }

  /** Wait until the printer leaves busy states (or errors / timeout). */
  async waitIdle(timeoutMs = 10 * 60_000, signal?: { cancelled: boolean }): Promise<PrinterStatus | null> {
    const t0 = Date.now();
    for (;;) {
      if (signal?.cancelled) throw new Error('Cancelled');
      const st = (await this.refresh()).status;
      if (!st) return null;
      if (!isBusy(st)) return st;
      if (Date.now() - t0 > timeoutMs) throw new Error(`Printer still busy: ${STATE_TEXT[st.state]}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
