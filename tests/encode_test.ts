import { buildDiscJob, pagePixels, DPI } from '../electron/core/pcl';
import { writeFileSync } from 'fs';
const q = (process.argv[2] as any) || 'best';
const W = pagePixels(DPI[q as 'best']);
const rgb = new Uint8Array(W * W * 3).fill(255);
const c = W / 2, R = W / 2 - 4, r = W * 0.15;
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
  const d = Math.hypot(x - c, y - c); if (d > R || d < r) continue;
  const i = (y * W + x) * 3;
  // mixture: smooth gradient, hard-edged bands, noise region, flat region
  if (y < W * 0.3) { rgb[i] = (x * 255 / W) | 0; rgb[i + 1] = (y * 255 / W) | 0; rgb[i + 2] = 128; }
  else if (y < W * 0.5) { const band = ((x / 37) | 0) % 4; rgb[i] = [255, 0, 30, 0][band]; rgb[i + 1] = [0, 200, 30, 255][band]; rgb[i + 2] = [0, 0, 30, 255][band]; }
  else if (y < W * 0.7) { rgb[i] = (rnd() * 256) | 0; rgb[i + 1] = (rnd() * 256) | 0; rgb[i + 2] = (rnd() * 256) | 0; }
  else { rgb[i] = 20; rgb[i + 1] = 60; rgb[i + 2] = 200; }
}
const t = Date.now();
const job = buildDiscJob({ rgb, width: W, height: W }, { quality: q as any, media: 'photo', name: 'test' });
console.log('quality', q, 'page', W, 'job bytes', job.length, 'ms', Date.now() - t);
writeFileSync(`/tmp/job_${q}.pcl`, job); writeFileSync(`/tmp/src_${q}.rgb`, rgb);
