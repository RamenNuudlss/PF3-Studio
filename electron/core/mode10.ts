/**
 * HP PCL3GUI "Mode 10" RGB raster compression (a.k.a. Bert / delta-RLE pixel compression).
 * Port of the algorithm used by HP's VIP-class inkjets (reference: HPLIP hpcups Mode10.cpp).
 *
 * One call to `encodeRow` compresses one row of 24-bit RGB pixels against the seed row
 * (the previous row). The encoder keeps its own seed row; call `reset()` at every
 * raster start (ESC*r1A) and after any vertical skip (ESC*b#Y).
 */

const WHITE = 0xffffff;

/**
 * Mode 10 stores blue with 7 significant bits (deltas are halved, literals drop the LSB).
 * Quantising blue to even values (keeping 255 for paper-white) makes decoding exact and
 * prevents the 0<->255 wrap-around a decoder could otherwise produce.
 */
const qb = (b: number) => (b === 255 ? 255 : b & 0xfe);

const eLiteral = 0x00;
const eRLE = 0x80;
const eeNewPixel = 0x00;
const eeWPixel = 0x20;
const eeNEPixel = 0x40;
const eeCachedColor = 0x60;

export class Mode10Encoder {
  private seed: Uint32Array;
  private cur: Uint32Array;
  private out: Uint8Array;
  readonly width: number;

  constructor(width: number) {
    if (width < 2) throw new Error('Mode10 row must be at least 2 pixels');
    this.width = width;
    this.seed = new Uint32Array(width).fill(WHITE);
    this.cur = new Uint32Array(width);
    // worst case: every pixel a 3-byte literal plus command/VLI overhead
    this.out = new Uint8Array(width * 4 + 1024);
  }

  reset(): void {
    this.seed.fill(WHITE);
  }

  /** True when the row is pixel-identical to the seed row (send ESC*b0W). */
  sameAsSeed(rgb: Uint8Array | Uint8ClampedArray, offset = 0): boolean {
    const s = this.seed;
    for (let x = 0, p = offset; x < this.width; x++, p += 3) {
      if (((rgb[p] << 16) | (rgb[p + 1] << 8) | qb(rgb[p + 2])) !== s[x]) return false;
    }
    return true;
  }

  /**
   * Compress one row. `rgb` holds `width` packed RGB triplets starting at `offset`.
   * Returns a view into an internal buffer (copy it if you keep it past the next call).
   */
  encodeRow(rgb: Uint8Array | Uint8ClampedArray, offset = 0): Uint8Array {
    const w = this.width;
    const cur = this.cur;
    const seed = this.seed;
    for (let x = 0, p = offset; x < w; x++, p += 3) cur[x] = (rgb[p] << 16) | (rgb[p + 1] << 8) | qb(rgb[p + 2]);

    const out = this.out;
    let o = 0;
    const lastPixel = w - 1;
    const realLastPixel = cur[lastPixel];

    // Make the last pixel unique so runs/seed copies terminate before it.
    let newLast = realLastPixel;
    while (cur[lastPixel - 1] === newLast || seed[lastPixel] === newLast) {
      newLast = (newLast + 0x100) & WHITE; // nudge green
      cur[lastPixel] = newLast;
    }

    const vli = (n: number) => {
      while (n >= 255) { out[o++] = 255; n -= 255; }
      out[o++] = n;
    };
    const putPixel = (pix: number, up: number) => {
      const dr = ((pix >> 16) & 255) - ((up >> 16) & 255);
      const dg = ((pix >> 8) & 255) - ((up >> 8) & 255);
      const db = (pix & 255) - (up & 255);
      const decodedBlue = (up & 255) + 2 * (db >> 1);
      if (dr <= 15 && dr >= -16 && dg <= 15 && dg >= -16 && db <= 30 && db >= -32 && decodedBlue >= 0 && decodedBlue <= 255) {
        const v = ((dr << 10) & 0x7c00) | ((dg << 5) & 0x03e0) | ((db >> 1) & 0x1f) | 0x8000;
        out[o++] = v >> 8;
        out[o++] = v & 255;
      } else {
        const u = pix >>> 1; // drop blue LSB; top bit 0 marks a full pixel
        out[o++] = (u >> 16) & 255;
        out[o++] = (u >> 8) & 255;
        out[o++] = u & 255;
      }
    };

    let curPixel = 0;
    let cachedColor = WHITE;

    do {
      let cmd = 0;
      let replacementCount = 0;
      let seedCopy = curPixel;
      while (seed[curPixel] === cur[curPixel]) curPixel++;
      seedCopy = curPixel - seedCopy;

      let pixelSource = 0;

      if (curPixel === lastPixel) {
        cur[lastPixel] = realLastPixel;
        if (seed[curPixel] === realLastPixel) break; // done: rest copies from seed
        cmd = eLiteral;
        pixelSource = eeNewPixel;
        replacementCount = 1;
        curPixel++;
      } else {
        replacementCount = curPixel;
        const run = cur[curPixel];
        curPixel++;
        while (run === cur[curPixel]) curPixel++;
        curPixel--;
        replacementCount = curPixel - replacementCount;

        if (replacementCount > 0) {
          curPixel++;
          replacementCount++;
          if (cachedColor === run) pixelSource = eeCachedColor;
          else if (seed[curPixel - replacementCount + 1] === run) pixelSource = eeNEPixel;
          else if (curPixel - replacementCount > 0 && cur[curPixel - replacementCount - 1] === run) pixelSource = eeWPixel;
          else { pixelSource = eeNewPixel; cachedColor = run; }
          cmd = eRLE;
        }

        if (curPixel === lastPixel) {
          if (realLastPixel === run) {
            cur[lastPixel] = realLastPixel;
            replacementCount++;
            curPixel++;
          }
        }

        if (replacementCount === 0) {
          const tmp = cur[curPixel];
          cmd = eLiteral;
          if (cachedColor === tmp) pixelSource = eeCachedColor;
          else if (seed[curPixel + 1] === tmp) pixelSource = eeNEPixel;
          else if (curPixel > 0 && cur[curPixel - 1] === tmp) pixelSource = eeWPixel;
          else { pixelSource = eeNewPixel; cachedColor = tmp; }

          replacementCount = curPixel;
          let next = cur[curPixel + 1];
          let cache: number;
          do {
            if (++curPixel === lastPixel) {
              cur[lastPixel] = realLastPixel;
              curPixel++;
              break;
            }
            cache = next;
            next = cur[curPixel + 1];
          } while (cache !== next && cache !== seed[curPixel]);
          replacementCount = curPixel - replacementCount;
        }
      }

      if (cmd === eLiteral) {
        replacementCount -= 1;
        cmd |= pixelSource | (Math.min(3, seedCopy) << 3) | Math.min(7, replacementCount);
        out[o++] = cmd;
        if (seedCopy >= 3) vli(seedCopy - 3);
        replacementCount += 1;
        const total = replacementCount;
        let up = 1;
        if (pixelSource !== eeNewPixel) { replacementCount -= 1; up = 2; }
        for (; up <= total; up++) {
          const idx = curPixel - replacementCount;
          putPixel(cur[idx], seed[idx]);
          if ((up - 8) % 255 === 0) out[o++] = Math.min(255, total - up);
          replacementCount--;
        }
      } else {
        replacementCount -= 2;
        cmd |= pixelSource | (Math.min(3, seedCopy) << 3) | Math.min(7, replacementCount);
        out[o++] = cmd;
        if (seedCopy >= 3) vli(seedCopy - 3);
        replacementCount += 2;
        if (pixelSource === eeNewPixel) {
          const idx = curPixel - replacementCount;
          putPixel(cur[idx], seed[idx]);
        }
        if (replacementCount - 2 >= 7) vli(replacementCount - 9);
      }
    } while (curPixel <= lastPixel);

    // Closed loop: the next row is predicted from what the printer will actually reconstruct,
    // so rounding in the 7-bit blue channel can never accumulate from row to row.
    cur[lastPixel] = realLastPixel;
    const result = out.subarray(0, o);
    decodeRow(result, seed, w);
    return result;
  }
}

/* ------------------------------------------------------------------ decoder */

function readVli(d: Uint8Array, i: { p: number }): number {
  let tot = 0;
  for (;;) { const b = d[i.p++]; tot += b; if (b !== 255) return tot; }
}

function readPixel(d: Uint8Array, i: { p: number }, up: number): number {
  const b0 = d[i.p];
  if (b0 & 0x80) {
    const v = (b0 << 8) | d[i.p + 1]; i.p += 2;
    let dr = (v >> 10) & 0x1f, dg = (v >> 5) & 0x1f, db = v & 0x1f;
    if (dr & 0x10) dr -= 32; if (dg & 0x10) dg -= 32; if (db & 0x10) db -= 32;
    const r = ((up >> 16) & 255) + dr, g = ((up >> 8) & 255) + dg, b = (up & 255) + db * 2;
    return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
  }
  const v = ((b0 << 16) | (d[i.p + 1] << 8) | d[i.p + 2]) << 1; i.p += 3;
  return v & WHITE;
}

/** Decode one Mode 10 row in place: `row` holds the seed on entry and the result on exit. */
export function decodeRow(d: Uint8Array, row: Uint32Array, width: number): void {
  const seed = row.slice();
  const i = { p: 0 };
  let x = 0, cache = WHITE;
  while (i.p < d.length && x < width) {
    const cmd = d[i.p++];
    const src = cmd & 0x60;
    let seedCnt = (cmd >> 3) & 3;
    if (seedCnt === 3) seedCnt += readVli(d, i);
    x += seedCnt;
    if (x >= width) break;
    const first = (): number => {
      if (src === eeNewPixel) { const p = readPixel(d, i, seed[x]); cache = p; return p; }
      if (src === eeWPixel) return row[x - 1];
      if (src === eeNEPixel) return x + 1 < width ? seed[x + 1] : WHITE;
      return cache;
    };
    if (cmd & 0x80) {
      let cnt = (cmd & 7) + 2;
      const p = first();
      if ((cmd & 7) === 7) cnt += readVli(d, i);
      for (let k = 0; k < cnt && x < width; k++) row[x++] = p;
    } else {
      let total = (cmd & 7) + 1;
      let extra = (cmd & 7) === 7;
      const p0 = first(); // evaluate before x++ (index expression is evaluated first)
      row[x++] = p0;
      let k = 1;
      if (extra && k === 8) { const b = d[i.p++]; total += b; extra = b === 255; }
      while (k < total) {
        const p = readPixel(d, i, x < width ? seed[x] : WHITE);
        if (x < width) row[x] = p;
        x++; k++;
        if (extra && k >= 8 && (k - 8) % 255 === 0) { const b = d[i.p++]; total += b; extra = b === 255; }
      }
    }
  }
}
