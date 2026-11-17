import { Design, Layer, uid, TextLayer, ArcTextLayer, ShapeLayer } from './types';

const text = (p: Partial<TextLayer>): TextLayer => ({
  id: uid(), name: 'Text', kind: 'text', text: 'Text', font: 'Segoe UI', size: 6, color: '#ffffff', bold: false, italic: false,
  align: 'center', width: 80, letterSpacing: 0, lineHeight: 1.1, opacity: 1, x: 0, y: 0, rotation: 0, ...p,
});
const arc = (p: Partial<ArcTextLayer>): ArcTextLayer => ({
  id: uid(), name: 'Curved text', kind: 'arctext', text: 'CURVED TEXT', font: 'Segoe UI', size: 5, color: '#ffffff', bold: true, italic: false,
  radius: 52, angle: 0, inside: false, letterSpacing: 0.6, opacity: 1, x: 0, y: 0, rotation: 0, ...p,
});
const shape = (p: Partial<ShapeLayer>): ShapeLayer => ({
  id: uid(), name: 'Shape', kind: 'shape', shape: 'rect', w: 40, h: 20, corner: 0, ringWidth: 4, fill: { type: 'solid', color: '#ffffff' }, opacity: 1, x: 0, y: 0, rotation: 0, ...p,
});

export const newLayer = { text, arc, shape };

export interface Template { id: string; name: string; description: string; make: () => Design }

export const TEMPLATES: Template[] = [
  {
    id: 'blank', name: 'Blank', description: 'White disc',
    make: () => ({ version: 1, name: 'Untitled', background: { type: 'solid', color: '#ffffff' }, layers: [] }),
  },
  {
    id: 'boxset-movie', name: 'Boxset movie disc', description: 'Poster background with {{title}}, {{subtitle}} and {{year}} fields - used by the Boxset hook',
    make: () => ({
      version: 1, name: 'Boxset movie disc',
      background: { type: 'radial', from: '#2a2f45', to: '#07080c' },
      layers: [
        shape({ name: 'Edge ring', shape: 'ring', w: 118, ringWidth: 1.2, fill: { type: 'solid', color: '#e8b04a' } }),
        arc({ name: 'Title', text: '{{title}}', size: 7, radius: 47, bold: true, letterSpacing: 0.8, color: '#ffffff' }),
        arc({ name: 'Subtitle', text: '{{subtitle}}', size: 4, radius: 50, inside: true, angle: 180, bold: false, letterSpacing: 0.6, color: '#e8b04a' }),
        text({ name: 'Year', text: '{{year}}', y: 30, size: 5, color: '#c8ccd6', bold: true, letterSpacing: 1.2 }),
        text({ name: 'Disc', text: 'DISC {{disc}}', y: -28, size: 3.2, color: '#9aa0b0', letterSpacing: 1.5 }),
      ] as Layer[],
    }),
  },
  {
    id: 'music', name: 'Music / mixtape', description: 'Bold gradient with track title',
    make: () => ({
      version: 1, name: 'Mixtape', background: { type: 'linear', from: '#ff3d77', to: '#5b2cff', angle: 35 },
      layers: [
        text({ name: 'Title', text: 'MIXTAPE', y: -30, size: 11, bold: true, letterSpacing: 2 }),
        text({ name: 'Artist', text: '{{artist}}', y: 30, size: 5, color: '#ffffffcc' }),
        arc({ name: 'Edge text', text: '{{date}}  •  SIDE A', radius: 54, inside: true, angle: 180, size: 3, bold: false }),
      ] as Layer[],
    }),
  },
  {
    id: 'data', name: 'Data / archive', description: 'Clean label with numbering and date',
    make: () => ({
      version: 1, name: 'Archive', background: { type: 'solid', color: '#ffffff' },
      layers: [
        shape({ name: 'Band', shape: 'ring', w: 116, ringWidth: 14, fill: { type: 'solid', color: '#14161c' } }),
        arc({ name: 'Label', text: '{{label}}', radius: 49, size: 5.5, color: '#ffffff' }),
        text({ name: 'Number', text: '#{{n}}', y: 28, size: 8, color: '#14161c', bold: true }),
        text({ name: 'Date', text: '{{date}}', y: -28, size: 4, color: '#5a6070' }),
      ] as Layer[],
    }),
  },
];

/** A calibration disc: concentric rings every 5 mm with labels, crosshair and colour patches. */
export function diagnosticDisc(): Design {
  const layers: Layer[] = [];
  for (let d = 20; d <= 120; d += 10) {
    layers.push(shape({ name: `Ring ${d}`, shape: 'ring', w: d, ringWidth: 0.25, fill: { type: 'solid', color: d % 20 === 0 ? '#000000' : '#888888' } }));
    if (d >= 40 && d < 120) layers.push(text({ name: `${d}mm`, text: `${d}`, x: d / 2 - 1.2, y: 0, size: 1.8, color: '#000000', width: 6, align: 'center', rotation: 90 }));
  }
  layers.push(shape({ name: 'H axis', w: 120, h: 0.2, fill: { type: 'solid', color: '#000000' } }));
  layers.push(shape({ name: 'V axis', w: 0.2, h: 120, fill: { type: 'solid', color: '#000000' } }));
  const patches = ['#00ffff', '#ff00ff', '#ffff00', '#000000', '#ff0000', '#00ff00', '#0000ff', '#808080'];
  patches.forEach((c, i) => {
    const a = (i / patches.length) * Math.PI * 2 + Math.PI / 8;
    layers.push(shape({ name: `Patch ${c}`, shape: 'rect', w: 9, h: 9, corner: 1, x: Math.cos(a) * 34, y: Math.sin(a) * 34, fill: { type: 'solid', color: c } }));
  });
  layers.push(shape({ name: 'Gray ramp', shape: 'rect', w: 44, h: 4, y: 45, fill: { type: 'linear', from: '#ffffff', to: '#000000', angle: 0 } }));
  layers.push(shape({ name: 'Hue ramp', shape: 'rect', w: 44, h: 4, y: -45, fill: { type: 'linear', from: '#00e5ff', to: '#ff2bd6', angle: 0 } }));
  layers.push(arc({ name: 'Title', text: 'PF3 STUDIO DIAGNOSTIC DISC', radius: 55.5, size: 2.6, color: '#000000', letterSpacing: 0.5 }));
  layers.push(arc({ name: 'Info', text: 'RINGS EVERY 10 MM  •  CENTRE CROSSHAIR  •  {{date}}', radius: 56.5, inside: true, angle: 180, size: 2.2, color: '#000000', bold: false }));
  return { version: 1, name: 'Diagnostic disc', background: { type: 'solid', color: '#ffffff' }, layers };
}
