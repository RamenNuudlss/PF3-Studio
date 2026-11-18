/**
 * Driverless access to the PF-3 through Windows' inbox USB printing class driver (usbprint.sys).
 * Same path the original Microboards Toolbox used: enumerate GUID_DEVINTERFACE_USBPRINT,
 * open the interface, WriteFile() raw PCL, IOCTL_PAR_QUERY_DEVICE_ID for status.
 */
import koffi from 'koffi';

const GUID_DEVINTERFACE_USBPRINT = { Data1: 0x28d78fad, Data2: 0x5a12, Data3: 0x11d1, Data4: [0xae, 0x5b, 0x00, 0x00, 0xf8, 0x03, 0xa8, 0xc2] };
const DIGCF_PRESENT = 0x02;
const DIGCF_DEVICEINTERFACE = 0x10;
const GENERIC_READ = 0x80000000;
const GENERIC_WRITE = 0x40000000;
const FILE_SHARE_READ = 1;
const FILE_SHARE_WRITE = 2;
const OPEN_EXISTING = 3;
const IOCTL_PAR_QUERY_DEVICE_ID = 0x0016000c;
const IOCTL_USBPRINT_GET_LPT_STATUS = 0x00220030;
const IOCTL_USBPRINT_GET_1284_ID = 0x00220034;
const IOCTL_USBPRINT_SOFT_RESET = 0x00220040;

export const PF3_MATCH = /vid_03f0&pid_6104/i;

let api: ReturnType<typeof bind> | null = null;

function bind() {
  const GUID = koffi.struct('GUID', { Data1: 'uint32', Data2: 'uint16', Data3: 'uint16', Data4: koffi.array('uint8', 8) });
  const SP_DEVICE_INTERFACE_DATA = koffi.struct('SP_DEVICE_INTERFACE_DATA', {
    cbSize: 'uint32', InterfaceClassGuid: GUID, Flags: 'uint32', Reserved: 'uintptr_t',
  });
  const setupapi = koffi.load('setupapi.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const HANDLE = koffi.pointer('HANDLE', koffi.opaque());
  return {
    SP_DEVICE_INTERFACE_DATA,
    SetupDiGetClassDevsW: setupapi.func('void* __stdcall SetupDiGetClassDevsW(GUID *ClassGuid, const char16_t *Enumerator, void *hwnd, uint32_t Flags)'),
    SetupDiEnumDeviceInterfaces: setupapi.func('bool __stdcall SetupDiEnumDeviceInterfaces(void *DeviceInfoSet, void *DeviceInfoData, GUID *InterfaceClassGuid, uint32_t MemberIndex, _Inout_ SP_DEVICE_INTERFACE_DATA *DeviceInterfaceData)'),
    SetupDiGetDeviceInterfaceDetailW: setupapi.func('bool __stdcall SetupDiGetDeviceInterfaceDetailW(void *DeviceInfoSet, SP_DEVICE_INTERFACE_DATA *DeviceInterfaceData, _Out_ uint8_t *Detail, uint32_t DetailSize, _Out_ uint32_t *RequiredSize, void *DeviceInfoData)'),
    SetupDiDestroyDeviceInfoList: setupapi.func('bool __stdcall SetupDiDestroyDeviceInfoList(void *DeviceInfoSet)'),
    CreateFileW: kernel32.func('HANDLE __stdcall CreateFileW(const char16_t *name, uint32_t access, uint32_t share, void *sa, uint32_t disp, uint32_t flags, void *tmpl)'),
    WriteFile: kernel32.func('bool __stdcall WriteFile(HANDLE h, const uint8_t *buf, uint32_t len, _Out_ uint32_t *written, void *ov)'),
    ReadFile: kernel32.func('bool __stdcall ReadFile(HANDLE h, _Out_ uint8_t *buf, uint32_t len, _Out_ uint32_t *read, void *ov)'),
    DeviceIoControl: kernel32.func('bool __stdcall DeviceIoControl(HANDLE h, uint32_t code, void *inBuf, uint32_t inLen, _Out_ uint8_t *outBuf, uint32_t outLen, _Out_ uint32_t *returned, void *ov)'),
    CloseHandle: kernel32.func('bool __stdcall CloseHandle(HANDLE h)'),
    CancelIoEx: kernel32.func('bool __stdcall CancelIoEx(HANDLE h, void *ov)'),
    GetLastError: kernel32.func('uint32_t __stdcall GetLastError()'),
    HANDLE,
  };
}

function win() {
  if (process.platform !== 'win32') throw new Error('USB printing is only available on Windows');
  if (!api) api = bind();
  return api;
}

const isInvalid = (h: unknown) => h === null || koffi.address(h as any) === BigInt('0xFFFFFFFFFFFFFFFF') || koffi.address(h as any) === 0n;

export interface UsbPrintDevice { path: string; serial: string | null }

/** List usbprint interfaces that belong to a PF-3 (or all, if `all`). */
export function listDevices(all = false): UsbPrintDevice[] {
  const w = win();
  const guid = { ...GUID_DEVINTERFACE_USBPRINT };
  const hdev = w.SetupDiGetClassDevsW(guid, null, null, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
  if (isInvalid(hdev)) return [];
  const out: UsbPrintDevice[] = [];
  try {
    for (let i = 0; i < 64; i++) {
      const ifd = { cbSize: koffi.sizeof(w.SP_DEVICE_INTERFACE_DATA), InterfaceClassGuid: { Data1: 0, Data2: 0, Data3: 0, Data4: [0, 0, 0, 0, 0, 0, 0, 0] }, Flags: 0, Reserved: 0 };
      if (!w.SetupDiEnumDeviceInterfaces(hdev, null, guid, i, ifd)) break;
      const detail = Buffer.alloc(2048);
      detail.writeUInt32LE(8, 0); // sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W) on x64
      const req = [0];
      if (!w.SetupDiGetDeviceInterfaceDetailW(hdev, ifd, detail, detail.length, req, null)) continue;
      const path = detail.subarray(4).toString('utf16le').split('\0')[0];
      if (!all && !PF3_MATCH.test(path)) continue;
      const m = path.match(/#vid_[0-9a-f]{4}&pid_[0-9a-f]{4}#([^#]+)#/i);
      out.push({ path, serial: m ? m[1] : null });
    }
  } finally {
    w.SetupDiDestroyDeviceInfoList(hdev);
  }
  return out;
}

export class UsbPrintHandle {
  private h: any;
  constructor(public readonly path: string) {
    const w = win();
    this.h = w.CreateFileW(path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, null, OPEN_EXISTING, 0, null);
    if (isInvalid(this.h)) {
      const err = w.GetLastError();
      throw Object.assign(new Error(err === 5 ? 'The printer is in use by another program (access denied)' : err === 2 ? 'Printer disconnected' : `Could not open printer (Windows error ${err})`), { code: err });
    }
  }

  close() {
    if (this.h) { win().CloseHandle(this.h); this.h = null; }
  }

  /** IEEE-1284 device ID string (contains the live S: status field). */
  deviceId(): string {
    const w = win();
    for (const code of [IOCTL_PAR_QUERY_DEVICE_ID, IOCTL_USBPRINT_GET_1284_ID]) {
      const buf = Buffer.alloc(4096);
      const ret = [0];
      if (!w.DeviceIoControl(this.h, code, null, 0, buf, buf.length, ret, null)) continue;
      let b = buf.subarray(0, ret[0]);
      // GET_1284_ID returns a 2-byte big-endian length prefix
      if (b.length >= 2 && b.readUInt16BE(0) === b.length) b = b.subarray(2);
      const s = b.toString('latin1').replace(/\0+$/, '');
      if (s.includes(':')) return s;
    }
    throw new Error(`Device ID query failed (Windows error ${w.GetLastError()})`);
  }

  /** Legacy LPT status byte: bit3 !error, bit4 select, bit5 paper empty. */
  lptStatus(): number | null {
    const w = win();
    const buf = Buffer.alloc(1); const ret = [0];
    return w.DeviceIoControl(this.h, IOCTL_USBPRINT_GET_LPT_STATUS, null, 0, buf, 1, ret, null) ? buf[0] : null;
  }

  softReset(): boolean {
    const w = win();
    const ret = [0];
    return w.DeviceIoControl(this.h, IOCTL_USBPRINT_SOFT_RESET, null, 0, Buffer.alloc(0), 0, ret, null);
  }

  /** Blocking write on a koffi worker thread so the UI never freezes. */
  write(data: Buffer): Promise<number> {
    const w = win();
    return new Promise((resolve, reject) => {
      const written = [0];
      w.WriteFile.async(this.h, data, data.length, written, null, (err: any, ok: boolean) => {
        if (err) return reject(err);
        if (!ok) return reject(new Error(`Write to printer failed (Windows error ${w.GetLastError()})`));
        resolve(written[0]);
      });
    });
  }

  /**
   * Read with a timeout. usbprint reads are synchronous, so on timeout the pending
   * ReadFile is cancelled with CancelIoEx and an empty buffer is returned.
   */
  readTimeout(ms: number, max = 8192): Promise<Buffer> {
    const w = win();
    return new Promise((resolve) => {
      let done = false;
      const buf = Buffer.alloc(max); const got = [0];
      const t = setTimeout(() => { if (!done) { w.CancelIoEx(this.h, null); } }, ms);
      w.ReadFile.async(this.h, buf, max, got, null, (err: any, ok: boolean) => {
        done = true; clearTimeout(t);
        resolve(!err && ok ? buf.subarray(0, got[0]) : Buffer.alloc(0));
      });
    });
  }

  /** Collect back-channel bytes until the printer stays quiet for `quietMs` (or `totalMs` passes). */
  async readUntilQuiet(totalMs = 4000, quietMs = 700): Promise<Buffer> {
    const parts: Buffer[] = [];
    const t0 = Date.now();
    let lastData = Date.now();
    while (Date.now() - t0 < totalMs) {
      const b = await this.readTimeout(Math.min(quietMs, totalMs - (Date.now() - t0)));
      if (b.length) { parts.push(b); lastData = Date.now(); }
      else if (Date.now() - lastData >= quietMs) break;
    }
    return Buffer.concat(parts);
  }

  read(max = 4096): Promise<Buffer> {
    const w = win();
    return new Promise((resolve, reject) => {
      const buf = Buffer.alloc(max); const got = [0];
      w.ReadFile.async(this.h, buf, max, got, null, (err: any, ok: boolean) => {
        if (err) return reject(err);
        resolve(ok ? buf.subarray(0, got[0]) : Buffer.alloc(0));
      });
    });
  }
}

/* ------------------------------------------------------------------------------------------
 * Overlapped (asynchronous) port, used for two-way firmware conversations.
 * A synchronous handle serialises all I/O on the file object, so a ReadFile that waits for
 * data the printer never sends blocks every later WriteFile, and CancelIoEx can't reliably
 * break it. With FILE_FLAG_OVERLAPPED each read has a real timeout and can be cancelled.
 * ---------------------------------------------------------------------------------------- */
const FILE_FLAG_OVERLAPPED = 0x40000000;
const ERROR_IO_PENDING = 997;
const WAIT_OBJECT_0 = 0;

let ovApi: ReturnType<typeof bindOv> | null = null;
function bindOv() {
  const w = win();
  const kernel32 = koffi.load('kernel32.dll');
  const OVERLAPPED = koffi.struct('PF3_OVERLAPPED', {
    Internal: 'uintptr_t', InternalHigh: 'uintptr_t', Offset: 'uint32', OffsetHigh: 'uint32', hEvent: 'void *',
  });
  return {
    OVERLAPPED,
    CreateEventW: kernel32.func('void* __stdcall CreateEventW(void *sa, bool manual, bool initial, const char16_t *name)'),
    ResetEvent: kernel32.func('bool __stdcall ResetEvent(void *h)'),
    WaitForSingleObject: kernel32.func('uint32_t __stdcall WaitForSingleObject(void *h, uint32_t ms)'),
    ReadFileOv: kernel32.func('bool __stdcall ReadFile(HANDLE h, void *buf, uint32_t len, void *read, void *ov)'),
    WriteFileOv: kernel32.func('bool __stdcall WriteFile(HANDLE h, void *buf, uint32_t len, void *written, void *ov)'),
    GetOverlappedResult: kernel32.func('bool __stdcall GetOverlappedResult(HANDLE h, void *ov, _Out_ uint32_t *n, bool wait)'),
    CancelIoExOv: kernel32.func('bool __stdcall CancelIoEx(HANDLE h, void *ov)'),
    w,
  };
}
const pinned: Buffer[] = []; // buffers a stuck transfer may still be using
function ov() { if (!ovApi) ovApi = bindOv(); return ovApi; }

export class UsbPrintPort {
  private h: any;
  private ev: any;
  private stuck = false;
  constructor(public readonly path: string) {
    const w = win(); const o = ov();
    this.h = w.CreateFileW(path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, null, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, null);
    if (isInvalid(this.h)) {
      const err = w.GetLastError();
      throw Object.assign(new Error(err === 5 ? 'The printer is in use by another program (access denied)' : err === 2 ? 'Printer disconnected' : `Could not open printer (Windows error ${err})`), { code: err });
    }
    this.ev = o.CreateEventW(null, true, false, null);
  }

  close() {
    const w = win();
    if (this.h) { w.CloseHandle(this.h); this.h = null; }
    if (this.ev) { w.CloseHandle(this.ev); this.ev = null; }
  }

  /**
   * Run one overlapped transfer; resolves with bytes transferred (0 on timeout/failure).
   * Uses plain Node Buffers (their memory never moves) rather than koffi.alloc/view:
   * Electron's V8 memory cage aborts the process on external ArrayBuffers.
   */
  private async transfer(kind: 'read' | 'write', mem: Buffer, timeoutMs: number): Promise<number> {
    if (this.stuck) throw new Error('Printer channel is stuck - reconnect the printer');
    const o = ov(); const w = o.w;
    const ovl = Buffer.alloc(32); // OVERLAPPED on x64; hEvent at offset 24
    ovl.writeBigUInt64LE(BigInt(koffi.address(this.ev)), 24);
    o.ResetEvent(this.ev);
    const ok = kind === 'read' ? o.ReadFileOv(this.h, mem, mem.length, null, ovl) : o.WriteFileOv(this.h, mem, mem.length, null, ovl);
    if (!ok) {
      const err = w.GetLastError();
      if (err !== ERROR_IO_PENDING) return 0;
      const r: number = await new Promise((res) => o.WaitForSingleObject.async(this.ev, timeoutMs, (_e: any, v: number) => res(v)));
      if (r !== WAIT_OBJECT_0) {
        o.CancelIoExOv(this.h, ovl);
        const r2: number = await new Promise((res) => o.WaitForSingleObject.async(this.ev, 3000, (_e: any, v: number) => res(v)));
        if (r2 !== WAIT_OBJECT_0) { this.stuck = true; pinned.push(ovl, mem); return 0; } // kernel may still own them
      }
    }
    const n = [0];
    return o.GetOverlappedResult(this.h, ovl, n, false) ? n[0] : 0;
  }

  async write(data: Buffer, timeoutMs = 30000): Promise<number> {
    const mem = Buffer.from(data); // private copy that stays alive for the whole transfer
    const n = await this.transfer('write', mem, timeoutMs);
    if (n !== data.length) throw new Error(`Write to printer timed out (${n}/${data.length} bytes)`);
    return n;
  }

  /** Read whatever the printer sends within `ms`; empty buffer on timeout. */
  async read(ms: number, max = 4096): Promise<Buffer> {
    const mem = Buffer.alloc(max);
    const n = await this.transfer('read', mem, ms);
    return Buffer.from(mem.subarray(0, n));
  }

  get isStuck() { return this.stuck; }
}
