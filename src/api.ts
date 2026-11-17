import type { Design, PrintSettings } from './design/types';

export interface Cartridge { index: number; type: string; kind: string; level: number | null; levelTrigger: number; health: string; part?: string }
export interface PrinterStatus { state: string; stateCode: number; text: string; revision: number | null; doorOpen: boolean; cartridges: Cartridge[]; raw: string; fields: Record<string, string> }
export interface ConnState { connected: boolean; path: string | null; serial: string | null; model: string | null; status: PrinterStatus | null; error: string | null; updatedAt: number }
export interface JobView { id: string; name: string; createdAt: number; kind: 'discs' | 'maintenance'; state: string; progress: number; current: number; message: string; error?: string; discs: number; labels: string[] }
export interface Settings {
  apiEnabled: boolean; apiPort: number; minimizeToTray: boolean; startWithWindows: boolean;
  lowInkThresholds: number[]; pauseOnLowInk: boolean; beltReminderDays: number;
  defaults: Record<string, unknown>;
}
export interface StatsData {
  discs: { t: number; jobName: string; label: string; quality: string; media: string; coverage: { c: number; m: number; y: number; k: number }; seconds: number; cost: number }[];
  ink: { t: number; black: number | null; color: number | null }[];
  maintenance: { t: number; action: string }[];
  pricing: { colorPrice: number; colorYieldFullDiscs: number; blackPrice: number; blackYieldFullDiscs: number; discPrice: number };
  lastActivity: number;
}
export type MaintenanceAction =
  | { kind: 'clean'; level: 1 | 2 | 3; verify: boolean }
  | { kind: 'margin-calibration' } | { kind: 'exercise-belt' } | { kind: 'pen-calibration-print' }
  | { kind: 'pen-calibration-set'; values: [number, number, number, number]; verify: boolean }
  | { kind: 'vendor-test-disc' };

type Unsub = () => void;
export interface Pf3Api {
  printer: { state(): Promise<ConnState>; refresh(): Promise<ConnState>; rawDeviceId(): Promise<string>; devices(): Promise<any>; softReset(): Promise<boolean>; onState(cb: (s: ConnState) => void): Unsub };
  jobs: {
    list(): Promise<JobView[]>; print(req: { name: string; pngs: { data: string; label: string }[]; options: unknown }): Promise<string>;
    maintenance(a: MaintenanceAction, name: string): Promise<string>; cancel(id: string): Promise<void>; resume(): Promise<void>;
    clearAll(): Promise<void>; removeFinished(): Promise<void>; onUpdate(cb: (j: JobView[]) => void): Unsub; onAttention(cb: (a: { jobId: string; message: string; reason: string }) => void): Unsub;
  };
  pen: { labelToValue(l: number[]): Promise<number[]> };
  stats: { get(): Promise<StatsData>; setPricing(p: Partial<StatsData['pricing']>): Promise<StatsData>; reset(): Promise<StatsData> };
  settings: { get(): Promise<Settings>; set(s: Partial<Settings>): Promise<Settings> };
  vendor: { status(): Promise<{ available: Record<string, boolean>; dir: string }>; import(): Promise<Record<string, boolean>> };
  file: { save(name: string, data: string | ArrayBuffer, filters: unknown): Promise<string | null>; open(filters: unknown, binary?: boolean): Promise<{ path: string; name: string; data: string } | null> };
  openExternal(url: string): Promise<void>;
  onNotice(cb: (n: { level: string; message: string; action?: string }) => void): Unsub;
  api: { onRender(cb: (r: { id: string; template?: Design; image?: string; rows: Record<string, string>[]; quality: keyof typeof import('./design/render').DPI_FOR }) => void): Unsub; rendered(r: unknown): void };
}

/** Browser-preview fallback so the UI can be developed without Electron. */
const mock: Pf3Api = {
  printer: { state: async () => ({ connected: false, path: null, serial: null, model: null, status: null, error: 'Preview mode (no Electron)', updatedAt: Date.now() }), refresh: async () => mock.printer.state(), rawDeviceId: async () => '', devices: async () => [], softReset: async () => false, onState: () => () => {} },
  jobs: { list: async () => [], print: async () => '0', maintenance: async () => '0', cancel: async () => {}, resume: async () => {}, clearAll: async () => {}, removeFinished: async () => {}, onUpdate: () => () => {}, onAttention: () => () => {} },
  pen: { labelToValue: async (l) => l.map((x) => -x) },
  stats: { get: async () => ({ discs: [], ink: [], maintenance: [], pricing: { colorPrice: 63.95, colorYieldFullDiscs: 225, blackPrice: 53.95, blackYieldFullDiscs: 100, discPrice: 0.25 }, lastActivity: Date.now() }), setPricing: async () => mock.stats.get(), reset: async () => mock.stats.get() },
  settings: { get: async () => ({ apiEnabled: true, apiPort: 47823, minimizeToTray: true, startWithWindows: false, lowInkThresholds: [10, 5, 3], pauseOnLowInk: true, beltReminderDays: 14, defaults: {} }), set: async (s) => ({ ...(await mock.settings.get()), ...s }) },
  vendor: { status: async () => ({ available: {}, dir: '' }), import: async () => ({}) },
  file: { save: async () => null, open: async () => null },
  openExternal: async () => {}, onNotice: () => () => {},
  api: { onRender: () => () => {}, rendered: () => {} },
};

export const pf3: Pf3Api = (window as any).pf3 ?? mock;
export type { Design, PrintSettings };
