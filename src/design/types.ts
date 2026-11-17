/** Design document. All geometry is in millimetres, origin = disc centre, +x right, +y down. */
export type Fill =
  | { type: 'solid'; color: string }
  | { type: 'linear'; from: string; to: string; angle: number }
  | { type: 'radial'; from: string; to: string };

interface Base { id: string; name: string; hidden?: boolean; locked?: boolean; opacity: number; x: number; y: number; rotation: number }
export interface ImageLayer extends Base { kind: 'image'; src: string; w: number; h: number }
export interface TextLayer extends Base {
  kind: 'text'; text: string; font: string; size: number; color: string; bold: boolean; italic: boolean;
  align: 'left' | 'center' | 'right'; width: number; letterSpacing: number; lineHeight: number;
  stroke?: { color: string; width: number }; shadow?: { color: string; blur: number; dx: number; dy: number };
}
export interface ArcTextLayer extends Base {
  kind: 'arctext'; text: string; font: string; size: number; color: string; bold: boolean; italic: boolean;
  radius: number; angle: number; inside: boolean; letterSpacing: number;
  stroke?: { color: string; width: number };
}
export interface ShapeLayer extends Base { kind: 'shape'; shape: 'rect' | 'ellipse' | 'ring'; w: number; h: number; corner: number; fill: Fill; stroke?: { color: string; width: number }; ringWidth: number }
export type Layer = ImageLayer | TextLayer | ArcTextLayer | ShapeLayer;

export interface Design {
  version: 1;
  name: string;
  background: Fill;
  layers: Layer[];
}

export type MaskType = 'standard' | 'hub' | 'mini80' | 'card' | 'none';
export interface PrintSettings {
  quality: 'normal' | 'best' | 'maxdpi';
  media: 'photo' | 'graphics';
  grayscale: boolean;
  brightness: number; saturation: number; tone: number;       // -50..50 (applied in software, previewable)
  inkAdjust: { k: number; c: number; m: number; y: number };  // -50..50 (firmware per-ink volume)
  inkVolume: number;     // -2..2  (Lighter..Heavier)
  dryTime: number;       // 0 auto, 1..10
  mask: MaskType;
  maskOuter: number;     // 0.1 mm diameter
  maskInner: number;     // 0.1 mm diameter
  cardW: number; cardH: number; cardCorner: number; // 0.1 mm
  offsetX: number; offsetY: number;                 // 0.1 mm
  copies: number;
}

export const DEFAULT_PRINT: PrintSettings = {
  quality: 'best', media: 'photo', grayscale: false, brightness: 0, saturation: 0, tone: 0,
  inkAdjust: { k: 0, c: 0, m: 0, y: 0 }, inkVolume: 0, dryTime: 0,
  mask: 'standard', maskOuter: 1182, maskInner: 378, cardW: 850, cardH: 600, cardCorner: 30,
  offsetX: 0, offsetY: 0, copies: 1,
};

export const MASK_PRESETS: Record<MaskType, Partial<PrintSettings> & { label: string }> = {
  standard: { label: 'Standard CD/DVD/BD (120 mm)', maskOuter: 1182, maskInner: 378 },
  hub: { label: 'Hub-printable (120 mm)', maskOuter: 1182, maskInner: 230 },
  mini80: { label: 'Mini disc (80 mm)', maskOuter: 785, maskInner: 378 },
  card: { label: 'Business-card disc', maskInner: 378 },
  none: { label: 'No mask (full page)', maskOuter: 1200, maskInner: 0 },
};

export const uid = () => Math.random().toString(36).slice(2, 10);

/** {{field}} placeholders found in text layers */
export function fieldsOf(d: Design): string[] {
  const s = new Set<string>();
  for (const l of d.layers) if (l.kind === 'text' || l.kind === 'arctext') for (const m of l.text.matchAll(/\{\{\s*([\w .-]+?)\s*\}\}/g)) s.add(m[1]);
  return [...s];
}
export function substitute(text: string, fields: Record<string, string>, index = 0, keepMissing = false): string {
  return text.replace(/\{\{\s*([\w .-]+?)\s*\}\}/g, (_, k: string) => {
    if (k in fields) return fields[k];
    const lk = k.toLowerCase();
    if (lk === 'n' || lk === 'number') return String(index + 1);
    if (lk === 'date') return new Date().toLocaleDateString();
    if (lk === 'year' && !keepMissing) return String(new Date().getFullYear());
    return keepMissing ? `{{${k}}}` : '';
  });
}
