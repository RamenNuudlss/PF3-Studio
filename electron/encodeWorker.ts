import { parentPort } from 'worker_threads';
import { buildDiscJob, JobOptions } from './core/pcl';

/** BGRA (premultiplied or straight) -> RGB on white, plus an ink coverage estimate. */
parentPort!.on('message', (m: { bgra: Uint8Array; width: number; height: number; options: JobOptions }) => {
  try {
    const { bgra, width, height, options } = m;
    const n = width * height;
    const rgb = new Uint8Array(n * 3);
    let c = 0, mm = 0, y = 0, k = 0;
    for (let i = 0, o = 0; i < n; i++, o += 3) {
      const b = bgra[i * 4], g = bgra[i * 4 + 1], r = bgra[i * 4 + 2], a = bgra[i * 4 + 3];
      // composite on paper white (nativeImage bitmaps are premultiplied)
      const R = r + (255 - a), G = g + (255 - a), B = b + (255 - a);
      rgb[o] = R > 255 ? 255 : R; rgb[o + 1] = G > 255 ? 255 : G; rgb[o + 2] = B > 255 ? 255 : B;
      const C = 255 - rgb[o], M = 255 - rgb[o + 1], Y = 255 - rgb[o + 2];
      const K = Math.min(C, M, Y);
      c += C - K; mm += M - K; y += Y - K; k += K;
    }
    // normalise to "fraction of a fully covered 120mm disc"
    const discArea = Math.PI * ((width / 2) ** 2 - (width * 0.1575) ** 2);
    const f = 255 * discArea;
    const coverage = { c: c / f, m: mm / f, y: y / f, k: k / f };
    if (process.env.PF3_DUMP_RGB) require('fs').writeFileSync(process.env.PF3_DUMP_RGB + '_' + Date.now() + '.rgb', rgb);
    const job = buildDiscJob({ rgb, width, height }, options, (p) => parentPort!.postMessage({ type: 'progress', value: p }));
    const ab = job.buffer.slice(job.byteOffset, job.byteOffset + job.byteLength);
    parentPort!.postMessage({ type: 'done', job: ab, coverage }, [ab as ArrayBuffer]);
  } catch (e: any) {
    parentPort!.postMessage({ type: 'error', message: e?.message ?? String(e) });
  }
});
