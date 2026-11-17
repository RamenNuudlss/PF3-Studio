import fs from 'fs';
import path from 'path';
import type { Cartridge } from './core/status';
import type { Coverage } from './jobs';

export interface DiscRecord {
  t: number; jobName: string; label: string; quality: string; media: string;
  coverage: Coverage; seconds: number; cost: number;
  inkBefore?: { type: string; level: number | null }[]; inkAfter?: { type: string; level: number | null }[];
}
export interface InkSample { t: number; black: number | null; color: number | null }
export interface Pricing {
  colorPrice: number; colorYieldFullDiscs: number;   // V102C: ~225 discs at 100% coverage
  blackPrice: number; blackYieldFullDiscs: number;   // V101B: ~1000 prints at 10% coverage = 100 full
  discPrice: number;
}
interface Data { discs: DiscRecord[]; ink: InkSample[]; maintenance: { t: number; action: string }[]; pricing: Pricing; lastActivity: number }

const DEFAULT_PRICING: Pricing = { colorPrice: 63.95, colorYieldFullDiscs: 225, blackPrice: 53.95, blackYieldFullDiscs: 100, discPrice: 0.25 };

export class Stats {
  private file: string;
  data: Data;
  constructor(dir: string) {
    this.file = path.join(dir, 'stats.json');
    let d: Partial<Data> = {};
    try { d = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* first run */ }
    this.data = { discs: d.discs ?? [], ink: d.ink ?? [], maintenance: d.maintenance ?? [], pricing: { ...DEFAULT_PRICING, ...(d.pricing ?? {}) }, lastActivity: d.lastActivity ?? Date.now() };
  }
  private save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data)); }

  costOf(cov: Coverage): number {
    const p = this.data.pricing;
    const colorFrac = (cov.c + cov.m + cov.y) / 3;
    return colorFrac * p.colorPrice / p.colorYieldFullDiscs + cov.k * p.blackPrice / p.blackYieldFullDiscs + p.discPrice;
  }

  recordDisc(r: Omit<DiscRecord, 't' | 'cost' | 'inkBefore' | 'inkAfter'> & { inkBefore?: Cartridge[]; inkAfter?: Cartridge[] }) {
    const slim = (c?: Cartridge[]) => c?.map((x) => ({ type: x.type, level: x.level }));
    this.data.discs.push({ ...r, t: Date.now(), cost: this.costOf(r.coverage), inkBefore: slim(r.inkBefore), inkAfter: slim(r.inkAfter) });
    this.data.lastActivity = Date.now();
    this.save();
  }
  recordMaintenance(action: string) { this.data.maintenance.push({ t: Date.now(), action }); this.data.lastActivity = Date.now(); this.save(); }
  recordInk(cartridges: Cartridge[]) {
    const black = cartridges.find((c) => c.type === 'black')?.level ?? null;
    const color = cartridges.find((c) => c.type === 'tri-color')?.level ?? null;
    const last = this.data.ink[this.data.ink.length - 1];
    if (last && last.black === black && last.color === color) return;
    this.data.ink.push({ t: Date.now(), black, color });
    if (this.data.ink.length > 5000) this.data.ink.splice(0, this.data.ink.length - 5000);
    this.save();
  }
  setPricing(p: Partial<Pricing>) { this.data.pricing = { ...this.data.pricing, ...p }; this.save(); }
  reset() { this.data.discs = []; this.data.ink = []; this.data.maintenance = []; this.save(); }
}
