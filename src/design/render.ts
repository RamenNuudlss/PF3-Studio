import Konva from 'konva';
import { Design, Layer, Fill, PrintSettings, substitute } from './types';

export const DISC_MM = 120;

/** Konva gradient/solid props for a fill over a box (w,h) centred at origin. */
export function fillProps(fill: Fill, w: number, h: number): Record<string, unknown> {
  if (fill.type === 'solid') return { fill: fill.color };
  if (fill.type === 'radial') return { fillRadialGradientStartPoint: { x: 0, y: 0 }, fillRadialGradientEndPoint: { x: 0, y: 0 }, fillRadialGradientStartRadius: 0, fillRadialGradientEndRadius: Math.max(w, h) / 2, fillRadialGradientColorStops: [0, fill.from, 1, fill.to] };
  const a = (fill.angle * Math.PI) / 180, r = Math.max(w, h) / 2;
  return { fillLinearGradientStartPoint: { x: -Math.cos(a) * r, y: -Math.sin(a) * r }, fillLinearGradientEndPoint: { x: Math.cos(a) * r, y: Math.sin(a) * r }, fillLinearGradientColorStops: [0, fill.from, 1, fill.to] };
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();
export function loadImage(src: string): Promise<HTMLImageElement> {
  let p = imageCache.get(src);
  if (!p) {
    p = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    imageCache.set(src, p);
  }
  return p;
}

const fontStyle = (bold: boolean, italic: boolean) => `${italic ? 'italic ' : ''}${bold ? 'bold' : 'normal'}`.trim();

/** Build one Konva node for a layer. Units: mm (the parent group is scaled to px). */
export async function buildNode(l: Layer, fields: Record<string, string>, index: number, keepMissing = false): Promise<Konva.Node | null> {
  const common = { id: l.id, name: 'layer', x: l.x, y: l.y, rotation: l.rotation, opacity: l.opacity, visible: !l.hidden, draggable: !l.locked };
  switch (l.kind) {
    case 'image': {
      const img = await loadImage(l.src).catch(() => null);
      if (!img) return null;
      return new Konva.Image({ ...common, image: img, width: l.w, height: l.h, offsetX: l.w / 2, offsetY: l.h / 2 });
    }
    case 'text': {
      const t = new Konva.Text({
        ...common, text: substitute(l.text, fields, index, keepMissing), fontFamily: l.font, fontSize: l.size, fill: l.color,
        fontStyle: fontStyle(l.bold, l.italic), align: l.align, width: l.width, letterSpacing: l.letterSpacing, lineHeight: l.lineHeight,
        stroke: l.stroke?.color, strokeWidth: l.stroke?.width ?? 0, fillAfterStrokeEnabled: true,
        shadowColor: l.shadow?.color, shadowBlur: l.shadow?.blur ?? 0, shadowOffsetX: l.shadow?.dx ?? 0, shadowOffsetY: l.shadow?.dy ?? 0, shadowEnabled: !!l.shadow,
      });
      t.offsetX(l.width / 2); t.offsetY(t.height() / 2);
      return t;
    }
    case 'arctext': {
      // circle path centred on the layer origin; text is centred at `angle` (0 = top)
      const r = l.radius;
      const text = substitute(l.text, fields, index, keepMissing);
      // Outside: clockwise circle whose midpoint is the top. Inside: counter-clockwise circle whose
      // midpoint is the bottom, so bottom text reads left-to-right and stays upright.
      // `angle` is where the text is centred (0 = top, 180 = bottom).
      const d = l.inside
        ? `M 0 ${-r} A ${r} ${r} 0 1 0 0 ${r} A ${r} ${r} 0 1 0 0 ${-r}`
        : `M 0 ${r} A ${r} ${r} 0 1 1 0 ${-r} A ${r} ${r} 0 1 1 0 ${r}`;
      const g = new Konva.Group({ ...common, rotation: l.rotation + l.angle - (l.inside ? 180 : 0) });
      const tp = new Konva.TextPath({ data: d, text, fontFamily: l.font, fontSize: l.size, fill: l.color, fontStyle: fontStyle(l.bold, l.italic), letterSpacing: l.letterSpacing, align: 'center', stroke: l.stroke?.color, strokeWidth: l.stroke?.width ?? 0, fillAfterStrokeEnabled: true, textBaseline: l.inside ? 'top' : 'bottom' } as any);
      g.add(tp);
      return g;
    }
    case 'shape': {
      const fp = fillProps(l.fill, l.w, l.h);
      const st = { stroke: l.stroke?.color, strokeWidth: l.stroke?.width ?? 0 };
      if (l.shape === 'rect') return new Konva.Rect({ ...common, ...fp, ...st, width: l.w, height: l.h, offsetX: l.w / 2, offsetY: l.h / 2, cornerRadius: l.corner });
      if (l.shape === 'ellipse') return new Konva.Ellipse({ ...common, ...fp, ...st, radiusX: l.w / 2, radiusY: l.h / 2 });
      return new Konva.Ring({ ...common, ...fp, ...st, outerRadius: l.w / 2, innerRadius: Math.max(0, l.w / 2 - l.ringWidth) });
    }
  }
}

/** Fill the content group (mm space) with background + layers. */
export async function populate(group: Konva.Group, design: Design, fields: Record<string, string> = {}, index = 0, keepMissing = false) {
  group.destroyChildren();
  const bg = new Konva.Circle({ name: 'background', x: 0, y: 0, radius: DISC_MM / 2, listening: false, ...fillProps(design.background, DISC_MM, DISC_MM) });
  group.add(bg);
  for (const l of design.layers) {
    const n = await buildNode(l, fields, index, keepMissing);
    if (n) group.add(n as any);
  }
}

/** Mask outside the printable area (white = no ink). Coordinates in mm. */
export function maskShape(ps: PrintSettings): Konva.Shape {
  return new Konva.Shape({
    name: 'print-mask', listening: false, fill: '#ffffff',
    sceneFunc(ctx, shape) {
      const big = DISC_MM;
      ctx.beginPath();
      ctx.rect(-big, -big, big * 2, big * 2);
      if (ps.mask === 'card') {
        const w = ps.cardW / 20, h = ps.cardH / 20, r = Math.min(ps.cardCorner / 10, w, h);
        // card outline (counter-clockwise to punch a hole)
        ctx.moveTo(-w + r, -h); ctx.arcTo(-w, -h, -w, h, r); ctx.arcTo(-w, h, w, h, r); ctx.arcTo(w, h, w, -h, r); ctx.arcTo(w, -h, -w, -h, r); ctx.closePath();
      } else if (ps.mask !== 'none') {
        ctx.moveTo(ps.maskOuter / 20, 0);
        ctx.arc(0, 0, ps.maskOuter / 20, 0, Math.PI * 2, true);
      }
      ctx.fillShape(shape);
      if (ps.mask !== 'none' && ps.maskInner > 0) {
        ctx.beginPath(); ctx.arc(0, 0, ps.maskInner / 20, 0, Math.PI * 2); ctx.fillShape(shape);
      }
    },
  });
}

/** Software colour pipeline: brightness / saturation / tone / grayscale (-50..50). */
export function adjustPixels(data: Uint8ClampedArray, ps: Pick<PrintSettings, 'brightness' | 'saturation' | 'tone' | 'grayscale'>) {
  const b = ps.brightness * 1.6, s = 1 + ps.saturation / 50, t = ps.tone * 0.6;
  if (!b && s === 1 && !t && !ps.grayscale) return;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], bl = data[i + 2];
    if (r === 255 && g === 255 && bl === 255) continue; // keep paper white unprinted
    const l = 0.299 * r + 0.587 * g + 0.114 * bl;
    if (ps.grayscale) { r = g = bl = l; }
    else { r = l + (r - l) * s; g = l + (g - l) * s; bl = l + (bl - l) * s; r += t; bl -= t; }
    data[i] = r + b; data[i + 1] = g + b; data[i + 2] = bl + b;
  }
}

/**
 * Render a design to the printer page: square, 120 mm wide at `dpi`, disc centred,
 * mask + alignment offsets + colour adjustments applied. Returns a canvas.
 */
export async function renderPage(design: Design, ps: PrintSettings, dpi: number, fields: Record<string, string> = {}, index = 0): Promise<HTMLCanvasElement> {
  const px = Math.floor((DISC_MM / 25.4) * dpi);
  const scale = px / DISC_MM;
  const container = document.createElement('div');
  const stage = new Konva.Stage({ container, width: px, height: px, pixelRatio: 1 } as any);
  const layer = new Konva.Layer({ listening: false });
  stage.add(layer);
  layer.add(new Konva.Rect({ x: 0, y: 0, width: px, height: px, fill: '#ffffff' }));
  const content = new Konva.Group({ x: px / 2 + (ps.offsetX / 10) * scale, y: px / 2 + (ps.offsetY / 10) * scale, scaleX: scale, scaleY: scale });
  layer.add(content);
  await populate(content, design, fields, index);
  const mask = new Konva.Group({ x: px / 2, y: px / 2, scaleX: scale, scaleY: scale });
  mask.add(maskShape(ps));
  layer.add(mask);
  layer.draw();
  const canvas = layer.toCanvas({ pixelRatio: 1 }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.getImageData(0, 0, px, px);
  adjustPixels(img.data, ps);
  ctx.putImageData(img, 0, 0);
  stage.destroy();
  return canvas;
}

export const canvasToPngBase64 = (c: HTMLCanvasElement): Promise<string> =>
  new Promise((res, rej) => c.toBlob(async (b) => {
    if (!b) return rej(new Error('PNG encode failed'));
    const buf = new Uint8Array(await b.arrayBuffer());
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode(...buf.subarray(i, i + CH));
    res(btoa(s));
  }, 'image/png'));

export const DPI_FOR = { normal: 600, best: 600, maxdpi: 1200 } as const;
