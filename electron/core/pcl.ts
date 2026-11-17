/**
 * PCL3GUI job generation for the Microboards PF-3 (HP SPS "SI500" engine).
 *
 * The job layout mirrors the "PF3 Test Print" job shipped inside the original
 * Microboards Toolbox (decoded byte-for-byte), generalised for quality / media / dpi.
 */
import { Mode10Encoder } from './mode10';

const ESC = 0x1b;

export type Quality = 'normal' | 'best' | 'maxdpi';
export type MediaMode = 'photo' | 'graphics';

export interface JobOptions {
  name?: string;
  quality: Quality;
  media: MediaMode;
  /** Firmware ink-density byte. Original driver sends 4 for "Automatic/Medium". */
  inkDensity?: number;
  /** Dry time: 0 = automatic, 1..10 = longer waits between discs. */
  dryTime?: number;
  /** Optional firmware per-channel adjustments (-50..50). Off unless set. */
  inkAdjust?: { k?: number; c?: number; m?: number; y?: number };
}

export const DPI: Record<Quality, number> = { normal: 600, best: 600, maxdpi: 1200 };
const QUALITY_CODE: Record<Quality, number> = { normal: 0, best: 1, maxdpi: 2 };
/** Media index / sub-index from the SI500 capability database (spsi500_Oem.vdf, table FDT4116). */
const MEDIA: Record<MediaMode, { index: number; sub: number }> = {
  photo: { index: 3, sub: 1012 },     // "HP Premium Plus Photo Paper, matte" == driver "Photo"
  graphics: { index: 2, sub: 1034 },  // "HP Brochure & Flyer Paper, Matte" == driver "Text and Graphics"
};

/** Pixel size of the 120 mm square disc page at a given dpi (matches driver: 2834 @600). */
export const pagePixels = (dpi: number) => Math.floor((120 / 25.4) * dpi);

class Buf {
  private parts: Uint8Array[] = [];
  private size = 0;
  raw(b: Uint8Array | number[]) { const u = b instanceof Uint8Array ? b : Uint8Array.from(b); this.parts.push(u.slice()); this.size += u.length; return this; }
  str(s: string) { return this.raw(Buffer.from(s, 'latin1')); }
  esc(s: string) { return this.raw([ESC]).str(s); }
  /** ESC*o#W config command (5/7 data bytes). */
  ow(bytes: number[]) { return this.esc(`*o${bytes.length}W`).raw(bytes); }
  /** Embedded PML command: ESC&b#WPML <payload> */
  pml(payload: number[]) { return this.esc(`&b${payload.length + 4}W`).str('PML ').raw(payload); }
  get length() { return this.size; }
  toBuffer(): Buffer { return Buffer.concat(this.parts, this.size); }
}

const sb = (v: number) => (v < 0 ? 256 + v : v) & 255;

export function jobHeader(b: Buf, opt: JobOptions, dpi: number, width: number) {
  const media = MEDIA[opt.media];
  const name = (opt.name ?? 'PF3 Studio').replace(/["\r\n]/g, '').slice(0, 60);
  b.esc('E').esc('%-12345X')
    .str(`@PJL JOB NAME="${name}"\n`)
    .str('@PJL COMMENT DRIVER VERSION = "PF3Studio 0.1"\n')
    .str('@PJL ENTER LANGUAGE=PCL3GUI\n');
  b.esc('&l1H');                                                   // media source: input hopper
  b.pml([0x04, 0x00, 0x06, 0x01, 0x04, 0x01, 0x03, 0x01, 0x02, 0x04, 0x01, 0x01]); // auto-pick off
  b.esc(`&l${media.index}M`);                                      // media type
  b.ow([0x0d, 0x03, 0x00, (media.sub >> 8) & 255, media.sub & 255]); // media sub-type
  b.ow([0x0b, 0x09, 0x00, 0x00, opt.inkDensity ?? 4]);             // ink density
  b.ow([0x0e, 0x03, 0x00, 0x00, 0x00]);                            // colour space mode
  b.esc('&l101A');                                                 // media size: CD/DVD 120mm
  b.ow([0x0d, 0x07, 0x00, 0x00, 0x01]);                            // media sensor on
  b.esc(`*o${QUALITY_CODE[opt.quality]}M`);                        // print quality
  b.esc('&l-2H');
  b.ow([0x0d, 0x08, 0x00, 0x00, 0x01]);
  b.pml([0x04, 0x00, 0x06, 0x01, 0x04, 0x01, 0x04, 0x01, 0x06, 0x08, 0x01, Math.max(0, Math.min(10, opt.dryTime ?? 0))]); // dry time
  const ia = opt.inkAdjust;
  if (ia) {
    if (ia.k) b.ow([0x46, 0x10, 0x00, 0x00, sb(ia.k)]);
    if (ia.c) b.ow([0x46, 0x11, 0x00, 0x00, sb(ia.c)]);
    if (ia.m) b.ow([0x46, 0x12, 0x00, 0x00, sb(ia.m)]);
    if (ia.y) b.ow([0x46, 0x13, 0x00, 0x00, sb(ia.y)]);
  }
  b.esc(`&u${dpi}D`);
  b.esc(`*r${width}S`);
  b.esc('&l0E').esc('&l0L');
  b.ow([0x08, 0x09, 0x00, 0x00, 0x07, 0x00, 0x01]);                // colour on page
  b.ow([0x0b, 0x01, 0x00, 0x00, 0x00]);                            // colour mode
  b.ow([0x0b, 0x04, 0x00, 0x00, 0x00]);                            // no flip
  // Configure Raster Data: 1 component, RGB, mode 10, 24-bit pixels
  b.esc('*g12W').raw([0x06, 0x07, 0x00, 0x01, dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0x0a, 0x01, 0x20, 0x01]);
}

export function jobFooter(b: Buf) {
  b.ow([0x0d, 0x02, 0x00, 0x00, 0x01]);
  b.ow([0x0d, 0x05, 0x00, 0x00, 0x01]);
  b.raw([0x0c]);
  b.esc('E').esc('%-12345X');
}

export interface RasterImage {
  /** packed RGB, row-major, width*height*3 */
  rgb: Uint8Array;
  width: number;
  height: number;
}

/**
 * Build a complete single-disc print job. The image must already be the full
 * disc page (square, `pagePixels(dpi)` wide) with masking/offsets applied.
 */
export function buildDiscJob(img: RasterImage, opt: JobOptions, onProgress?: (f: number) => void): Buffer {
  const dpi = DPI[opt.quality];
  const b = new Buf();
  jobHeader(b, opt, dpi, img.width);
  const enc = new Mode10Encoder(img.width);
  const rowBytes = img.width * 3;
  const isWhite = (y: number) => {
    const o = y * rowBytes;
    for (let i = 0; i < rowBytes; i++) if (img.rgb[o + i] !== 255) return false;
    return true;
  };
  let top = 0;
  while (top < img.height && isWhite(top)) top++;
  let bottom = img.height;
  while (bottom > top && isWhite(bottom - 1)) bottom--;

  b.esc('*r1A');
  if (top > 0) b.esc(`*b${top}Y`);
  for (let y = top; y < bottom; y++) {
    const off = y * rowBytes;
    if (enc.sameAsSeed(img.rgb, off)) {
      b.esc('*b0W');
    } else {
      const row = enc.encodeRow(img.rgb, off);
      b.esc(`*b${row.length}W`).raw(row);
    }
    if (onProgress && (y & 127) === 0) onProgress((y - top) / Math.max(1, bottom - top));
  }
  b.esc('*rC');
  jobFooter(b);
  onProgress?.(1);
  return b.toBuffer();
}

/* ---------------------------------------------------------------- maintenance */

/** Wrap a firmware "underware" command exactly like the Microboards Toolbox does. */
export function udw(cmd: string): Buffer {
  return Buffer.concat([
    Buffer.from([ESC]), Buffer.from('%P', 'latin1'),
    Buffer.from(cmd, 'latin1'),
    Buffer.from('udw.quit;', 'latin1'),
    Buffer.from([ESC]), Buffer.from('E', 'latin1'),
    Buffer.from([ESC]), Buffer.from('%-12345X', 'latin1'),
  ]);
}

export const Firmware = {
  /** Light / Regular / Heavy clean (Toolbox: "Wipe & Spit", "Clean", "Super Clean"). */
  clean: (level: 1 | 2 | 3) => udw(`fm.push_value ${level};fm.flow 235;fm.pop;`),
  /** Disc-edge detection: locates top/bottom/sides of a disc then ejects it. */
  autoMarginCalibration: () => udw('fm.flow 220;fm.pop;'),
  /** Pen (cartridge) calibration values in the order horiz, vert, black bidi, colour bidi. */
  penCalibration: (v: [number, number, number, number]) =>
    udw(`fm.push_value ${v[0]};fm.push_value ${v[1]};fm.push_value ${v[2]};fm.push_value ${v[3]}; fm.flow 238; fm.pop;`),
  resetPenCalibration: () => udw('fm.push_value 0; fm.push_value 0; fm.push_value 0; fm.push_value 0; fm.flow 238; fm.pop;'),
  /** Runs the belts at speed to recondition them (no media needed). */
  exerciseBelt: () => udw('fm.push_value 10;fm.push_value 200000;fm.flow 236;fm.pop;'),
  /** Front-panel button emulation (as used by the HP toolbox component). */
  button: (n: number) => udw(`uifp.multi_button_push ${n};`),
  /** Cancel the job in progress (PCL cancel + UEL). */
  cancel: () => Buffer.concat([Buffer.from([ESC]), Buffer.from('*o5W', 'latin1'), Buffer.from([0x45, 0xed, 0, 0, 0]), Buffer.from([ESC]), Buffer.from('E', 'latin1'), Buffer.from([ESC]), Buffer.from('%-12345X', 'latin1')]),
};

/**
 * Pen calibration slider: the Toolbox shows labels 48..-48 (left to right) and sends
 * table[pos] where table = [-48,-40,...,48]. So the value sent is -(label the user picks).
 */
export const penLabelToValue = (label: number) => -label;
