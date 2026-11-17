import React, { useCallback, useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import { useStore } from '../store';
import { Icon } from '../icons';
import { Design, Layer, uid, Fill, fieldsOf, ImageLayer } from '../design/types';
import { populate, maskShape, DISC_MM, loadImage } from '../design/render';
import { TEMPLATES, newLayer, diagnosticDisc } from '../design/templates';
import { pf3 } from '../api';
import { Field, Num, Slider, Seg, Check, Color } from '../components/ui';

const FONTS = ['Segoe UI', 'Segoe UI Black', 'Arial', 'Arial Black', 'Bahnschrift', 'Impact', 'Georgia', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Consolas', 'Courier New', 'Franklin Gothic Medium', 'Palatino Linotype', 'Comic Sans MS', 'Gabriola', 'Segoe Script'];

const KIND_ICON: Record<Layer['kind'], string> = { image: 'IMG', text: 'T', arctext: '⌒', shape: '◼' };

/* ---------------------------------------------------------------- canvas */
function Stage({ size }: { size: number }) {
  const { design, selected, select, updateLayer, print, rows } = useStore();
  const holder = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const contentRef = useRef<Konva.Group | null>(null);
  const trRef = useRef<Konva.Transformer | null>(null);
  const overlayRef = useRef<Konva.Group | null>(null);
  const [showMask, setShowMask] = useState(true);
  const scale = size / DISC_MM;

  // build stage once
  useEffect(() => {
    const stage = new Konva.Stage({ container: holder.current!, width: size, height: size });
    const layer = new Konva.Layer();
    stage.add(layer);
    // disc clip so the editing view looks like a disc
    const clip = new Konva.Group({ clipFunc: (ctx) => { ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); } });
    const content = new Konva.Group({ x: size / 2, y: size / 2, scaleX: scale, scaleY: scale });
    clip.add(content);
    layer.add(clip);
    const overlay = new Konva.Group({ x: size / 2, y: size / 2, scaleX: scale, scaleY: scale, listening: false });
    layer.add(overlay);
    const tr = new Konva.Transformer({ rotateEnabled: true, keepRatio: false, borderStroke: '#f5a524', anchorStroke: '#f5a524', anchorFill: '#0d0f14', anchorSize: 9, rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315], ignoreStroke: true });
    layer.add(tr);
    stage.on('mousedown', (e) => { if (e.target === stage || e.target.name() === 'background') select(null); });
    stageRef.current = stage; contentRef.current = content; trRef.current = tr; overlayRef.current = overlay;
    return () => { stage.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  // rebuild content when design changes
  useEffect(() => {
    const content = contentRef.current; if (!content) return;
    let cancelled = false;
    (async () => {
      const g = new Konva.Group();
      await populate(g, design, rows[0] ?? {}, 0, true);
      if (cancelled) return;
      content.destroyChildren();
      for (const n of [...g.getChildren()] as Konva.Node[]) {
        n.moveTo(content);
        if (n.name() !== 'layer') continue;
        const l = design.layers.find((x) => x.id === n.id());
        if (!l) continue;
        n.on('mousedown', () => !l.locked && select(l.id));
        n.on('dragmove', () => {
          // snap to centre / axes
          const snap = 1.2;
          if (Math.abs(n.x()) < snap) n.x(0);
          if (Math.abs(n.y()) < snap) n.y(0);
        });
        n.on('dragend', () => updateLayer(l.id, { x: n.x(), y: n.y() }));
        n.on('transformend', () => {
          const sx = n.scaleX(), sy = n.scaleY();
          const patch: Partial<Layer> = { x: n.x(), y: n.y(), rotation: l.kind === 'arctext' ? l.rotation : n.rotation() };
          if (l.kind === 'image' || l.kind === 'shape') Object.assign(patch, { w: l.w * sx, h: l.kind === 'shape' && l.shape === 'ring' ? l.w * sx : l.h * sy });
          if (l.kind === 'text') Object.assign(patch, { size: l.size * sy, width: l.width * sx });
          if (l.kind === 'arctext') Object.assign(patch, { size: l.size * sy, rotation: l.rotation + (n.rotation() - (l.rotation + l.angle - (l.inside ? 180 : 0))) });
          n.scaleX(1); n.scaleY(1);
          updateLayer(l.id, patch);
        });
      }
      content.getLayer()?.batchDraw();
      attach();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, rows, size]);

  const attach = useCallback(() => {
    const tr = trRef.current, content = contentRef.current; if (!tr || !content) return;
    const node = selected ? content.findOne('#' + selected) : null;
    const l = design.layers.find((x) => x.id === selected);
    tr.nodes(node && l && !l.locked && !l.hidden ? [node] : []);
    tr.enabledAnchors(l?.kind === 'text' || l?.kind === 'arctext' || (l?.kind === 'shape' && l.shape === 'ring') ? ['top-left', 'top-right', 'bottom-left', 'bottom-right'] : undefined as any);
    tr.keepRatio(l?.kind === 'text' || l?.kind === 'arctext' || (l?.kind === 'shape' && l.shape === 'ring'));
    tr.getLayer()?.batchDraw();
  }, [selected, design]);
  useEffect(attach, [attach]);

  // overlays: printable mask + guides
  useEffect(() => {
    const o = overlayRef.current; if (!o) return;
    o.destroyChildren();
    if (showMask) {
      const m = maskShape(print); m.fill('rgba(13,15,20,0.72)'); o.add(m);
    }
    o.add(new Konva.Circle({ radius: DISC_MM / 2 - 0.15, stroke: '#3a4357', strokeWidth: 0.3 }));
    o.add(new Konva.Circle({ radius: 7.5, stroke: '#3a4357', strokeWidth: 0.3, dash: [1, 1] }));
    o.add(new Konva.Line({ points: [-2, 0, 2, 0], stroke: '#f5a52488', strokeWidth: 0.2 }));
    o.add(new Konva.Line({ points: [0, -2, 0, 2], stroke: '#f5a52488', strokeWidth: 0.2 }));
    o.getLayer()?.batchDraw();
  }, [print, showMask, size]);

  return (
    <div style={{ position: 'relative' }}>
      <div ref={holder} style={{ width: size, height: size, borderRadius: '50%', boxShadow: '0 30px 80px rgba(0,0,0,.5), 0 0 0 1px #2a3140' }} />
      <div style={{ position: 'absolute', left: '50%', bottom: -34, transform: 'translateX(-50%)' }}>
        <Check checked={showMask} onChange={setShowMask}><span className="muted">Show unprintable area</span></Check>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- property editors */
function FillEditor({ fill, onChange }: { fill: Fill; onChange: (f: Fill) => void }) {
  return (
    <div className="col">
      <Seg value={fill.type} onChange={(t) => onChange(t === 'solid' ? { type: 'solid', color: (fill as any).color ?? (fill as any).from ?? '#ffffff' } : t === 'linear' ? { type: 'linear', from: (fill as any).from ?? (fill as any).color ?? '#ffffff', to: (fill as any).to ?? '#000000', angle: 90 } : { type: 'radial', from: (fill as any).from ?? (fill as any).color ?? '#ffffff', to: (fill as any).to ?? '#000000' })}
        options={[{ value: 'solid', label: 'Solid' }, { value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }]} />
      {fill.type === 'solid' ? <Color value={fill.color} onChange={(c) => onChange({ ...fill, color: c })} /> : (
        <>
          <Color value={fill.from} onChange={(c) => onChange({ ...fill, from: c } as Fill)} />
          <Color value={fill.to} onChange={(c) => onChange({ ...fill, to: c } as Fill)} />
          {fill.type === 'linear' && <Slider min={0} max={360} value={fill.angle} onChange={(a) => onChange({ ...fill, angle: a })} format={(v) => `${v}°`} />}
        </>
      )}
    </div>
  );
}

function Props() {
  const { design, selected, updateLayer, setDesign, commit } = useStore();
  const l = design.layers.find((x) => x.id === selected);
  if (!l) {
    return (
      <section>
        <div className="label" style={{ marginBottom: 10 }}>Disc background</div>
        <FillEditor fill={design.background} onChange={(f) => setDesign((d) => ({ ...d, background: f }))} />
        <div className="divider" />
        <div className="label" style={{ marginBottom: 8 }}>Variables in this design</div>
        {fieldsOf(design).length ? <div className="row wrap">{fieldsOf(design).map((f) => <span key={f} className="tag">{`{{${f}}}`}</span>)}</div>
          : <p className="faint" style={{ margin: 0, lineHeight: 1.5 }}>Type <span className="kbd">{'{{title}}'}</span> in any text to create a field you can fill per disc in a batch, or from Boxset. Built-ins: <span className="kbd">{'{{n}}'}</span> <span className="kbd">{'{{date}}'}</span> <span className="kbd">{'{{year}}'}</span></p>}
      </section>
    );
  }
  const up = (p: Partial<Layer>, transient = false) => updateLayer(l.id, p, { transient });
  const T = (k: string) => (v: number) => up({ [k]: v } as any, true);
  return (
    <section className="props" onMouseUp={commit} onKeyUp={commit}>
      <Field label="Name" className="full"><input type="text" value={l.name} onChange={(e) => up({ name: e.target.value })} /></Field>
      {(l.kind === 'text' || l.kind === 'arctext') && <>
        <Field label="Text" className="full"><textarea rows={l.kind === 'text' ? 3 : 1} value={l.text} onChange={(e) => up({ text: e.target.value }, true)} onBlur={commit} /></Field>
        <Field label="Font" className="full"><select value={l.font} onChange={(e) => up({ font: e.target.value })}>{FONTS.map((f) => <option key={f} style={{ fontFamily: f }}>{f}</option>)}</select></Field>
        <Field label="Size (mm)"><Num value={l.size} step={0.25} min={0.5} onChange={T('size')} /></Field>
        <Field label="Color"><Color value={l.color} onChange={(c) => up({ color: c })} /></Field>
        <Field label="Style" className="full"><div className="row"><Check checked={l.bold} onChange={(v) => up({ bold: v })}>Bold</Check><Check checked={l.italic} onChange={(v) => up({ italic: v })}>Italic</Check></div></Field>
        <Field label="Letter spacing"><Num value={l.letterSpacing} step={0.1} onChange={T('letterSpacing')} /></Field>
        <Field label="Outline (mm)"><Num value={l.stroke?.width ?? 0} step={0.05} min={0} onChange={(v) => up({ stroke: v ? { color: l.stroke?.color ?? '#000000', width: v } : undefined } as any, true)} /></Field>
        {l.stroke && <Field label="Outline color" className="full"><Color value={l.stroke.color} onChange={(c) => up({ stroke: { ...l.stroke!, color: c } } as any)} /></Field>}
      </>}
      {l.kind === 'text' && <>
        <Field label="Align" className="full"><Seg value={l.align} onChange={(v) => up({ align: v })} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} /></Field>
        <Field label="Box width"><Num value={l.width} min={5} onChange={T('width')} /></Field>
        <Field label="Line height"><Num value={l.lineHeight} step={0.05} min={0.5} onChange={T('lineHeight')} /></Field>
        <Field label="Shadow" className="full"><Check checked={!!l.shadow} onChange={(v) => up({ shadow: v ? { color: '#000000aa', blur: 1, dx: 0.3, dy: 0.3 } : undefined } as any)}>Drop shadow</Check></Field>
      </>}
      {l.kind === 'arctext' && <>
        <Field label="Radius (mm)"><Num value={l.radius} min={8} max={60} step={0.25} onChange={T('radius')} /></Field>
        <Field label="Position (°)"><Num value={l.angle} step={1} onChange={T('angle')} /></Field>
        <Field label="Direction" className="full"><Seg value={l.inside ? 'in' : 'out'} onChange={(v) => up({ inside: v === 'in', angle: v === 'in' ? 180 : 0 })} options={[{ value: 'out', label: 'Top arc' }, { value: 'in', label: 'Bottom arc' }]} /></Field>
      </>}
      {l.kind === 'shape' && <>
        <Field label="Fill" className="full"><FillEditor fill={l.fill} onChange={(f) => up({ fill: f } as any)} /></Field>
        <Field label={l.shape === 'ring' ? 'Diameter' : 'Width'}><Num value={l.w} min={0.5} step={0.5} onChange={T('w')} /></Field>
        {l.shape === 'ring' ? <Field label="Ring width"><Num value={l.ringWidth} min={0.1} step={0.25} onChange={T('ringWidth')} /></Field>
          : <Field label="Height"><Num value={l.h} min={0.5} step={0.5} onChange={T('h')} /></Field>}
        {l.shape === 'rect' && <Field label="Corner radius"><Num value={l.corner} min={0} step={0.5} onChange={T('corner')} /></Field>}
        <Field label="Border (mm)"><Num value={l.stroke?.width ?? 0} min={0} step={0.1} onChange={(v) => up({ stroke: v ? { color: l.stroke?.color ?? '#000000', width: v } : undefined } as any, true)} /></Field>
      </>}
      {l.kind === 'image' && <>
        <Field label="Width (mm)"><Num value={l.w} min={1} step={0.5} onChange={T('w')} /></Field>
        <Field label="Height (mm)"><Num value={l.h} min={1} step={0.5} onChange={T('h')} /></Field>
        <div className="full row"><button className="btn sm" onClick={() => fitImage(l, 'cover', up)}><Icon.fill />Fill disc</button><button className="btn sm" onClick={() => fitImage(l, 'contain', up)}>Fit inside</button></div>
      </>}
      <div className="full divider" style={{ margin: '4px 0' }} />
      <Field label="X (mm)"><Num value={l.x} step={0.5} onChange={T('x')} /></Field>
      <Field label="Y (mm)"><Num value={l.y} step={0.5} onChange={T('y')} /></Field>
      <Field label="Rotation"><Num value={l.rotation} step={1} onChange={T('rotation')} /></Field>
      <Field label="Opacity"><Num value={Math.round(l.opacity * 100)} min={0} max={100} onChange={(v) => up({ opacity: v / 100 }, true)} suffix="%" /></Field>
    </section>
  );
}

async function fitImage(l: ImageLayer, mode: 'cover' | 'contain', up: (p: Partial<Layer>) => void) {
  const img = await loadImage(l.src);
  const r = img.width / img.height;
  const box = mode === 'cover' ? DISC_MM : DISC_MM * 0.7;
  const w = mode === 'cover' ? (r >= 1 ? box * r : box) : (r >= 1 ? box : box * r);
  const h = mode === 'cover' ? (r >= 1 ? box : box / r) : (r >= 1 ? box / r : box);
  up({ w, h, x: 0, y: 0, rotation: 0 } as any);
}

/* ---------------------------------------------------------------- page */
export default function Designer() {
  const { design, setDesign, selected, select, undo, redo, canUndo, canRedo, toast, setPage } = useStore();
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(560);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize(Math.max(320, Math.floor(Math.min(e.contentRect.width - 60, e.contentRect.height - 90)))));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const add = (l: Layer) => { setDesign((d) => ({ ...d, layers: [...d.layers, l] })); select(l.id); };
  const addImage = async () => {
    const f = await pf3.file.open([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }], true);
    if (!f) return;
    const ext = f.name.split('.').pop()!.toLowerCase().replace('jpg', 'jpeg');
    const src = `data:image/${ext};base64,${f.data}`;
    const img = await loadImage(src);
    const r = img.width / img.height;
    const w = r >= 1 ? DISC_MM : DISC_MM * r, h = r >= 1 ? DISC_MM / r : DISC_MM;
    const isFirst = !design.layers.some((x) => x.kind === 'image');
    const l: ImageLayer = { id: uid(), name: f.name, kind: 'image', src, w: isFirst ? (r >= 1 ? DISC_MM * r : DISC_MM) : w * 0.5, h: isFirst ? (r >= 1 ? DISC_MM : DISC_MM / r) : h * 0.5, x: 0, y: 0, rotation: 0, opacity: 1 };
    // images go under text by default
    setDesign((d) => { const idx = d.layers.findIndex((x) => x.kind !== 'image' && x.kind !== 'shape'); const layers = [...d.layers]; layers.splice(idx < 0 ? layers.length : idx, 0, l); return { ...d, layers }; });
    select(l.id);
    const dpiAt120 = img.width / (l.w / 25.4);
    if (dpiAt120 < 300) toast('warning', `This image is about ${Math.round(dpiAt120)} dpi at this size. 600+ dpi looks best on the PF-3.`);
  };
  const move = (id: string, dir: -1 | 1) => setDesign((d) => { const i = d.layers.findIndex((l) => l.id === id); const j = i + dir; if (j < 0 || j >= d.layers.length) return d; const layers = [...d.layers]; [layers[i], layers[j]] = [layers[j], layers[i]]; return { ...d, layers }; });
  const remove = (id: string) => { setDesign((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) })); if (selected === id) select(null); };
  const dup = (id: string) => { const l = design.layers.find((x) => x.id === id); if (!l) return; const c = { ...structuredClone(l), id: uid(), name: l.name + ' copy', x: l.x + 3, y: l.y + 3 }; add(c); };
  const toggle = (id: string, k: 'hidden' | 'locked') => setDesign((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, [k]: !l[k] } : l)) }));

  const save = async () => {
    const p = await pf3.file.save(`${design.name || 'label'}.pf3label`, JSON.stringify(design), [{ name: 'PF3 label', extensions: ['pf3label'] }]);
    if (p) toast('ok', `Saved ${p}`);
  };
  const open = async () => {
    const f = await pf3.file.open([{ name: 'PF3 label', extensions: ['pf3label', 'json'] }]);
    if (!f) return;
    try { const d = JSON.parse(f.data) as Design; if (!Array.isArray(d.layers)) throw new Error('Not a PF3 label file'); setDesign(d); select(null); }
    catch (e: any) { toast('error', e.message); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'd' && selected) { e.preventDefault(); dup(selected); }
      else if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) remove(selected);
      else if (selected && e.key.startsWith('Arrow')) {
        const step = e.shiftKey ? 2 : 0.2; const l = design.layers.find((x) => x.id === selected); if (!l) return;
        e.preventDefault();
        setDesign((d) => ({ ...d, layers: d.layers.map((x) => x.id === selected ? { ...x, x: x.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0), y: x.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0) } : x) }));
      } else if (e.key === 'Escape') select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="designer">
      <div className="side">
        <section>
          <div className="label" style={{ marginBottom: 8 }}>Add</div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button className="btn sm" onClick={addImage}><Icon.image />Image</button>
            <button className="btn sm" onClick={() => add(newLayer.text({ text: 'Your text', color: '#ffffff', size: 7 }))}><Icon.text />Text</button>
            <button className="btn sm" onClick={() => add(newLayer.arc({}))}><Icon.arc />Curved</button>
            <button className="btn sm" onClick={() => add(newLayer.shape({ shape: 'rect', w: 40, h: 14, corner: 2, fill: { type: 'solid', color: '#f5a524' } }))}><Icon.shape />Shape</button>
            <button className="btn sm" onClick={() => add(newLayer.shape({ name: 'Ring', shape: 'ring', w: 116, ringWidth: 2, fill: { type: 'solid', color: '#ffffff' } }))}><Icon.ring />Ring</button>
            <button className="btn sm" onClick={() => add(newLayer.shape({ name: 'Circle', shape: 'ellipse', w: 30, h: 30, fill: { type: 'radial', from: '#ffffff', to: '#f5a524' } }))}><Icon.disc />Circle</button>
          </div>
        </section>
        <section style={{ paddingBottom: 6 }}><div className="label">Layers</div></section>
        <div className="scroll" style={{ padding: '0 8px 8px' }}>
          <div className="layers">
            {[...design.layers].reverse().map((l) => (
              <div key={l.id} className={`layer-item ${selected === l.id ? 'sel' : ''}`} onClick={() => select(l.id)} style={{ opacity: l.hidden ? 0.45 : 1 }}>
                <span className="ic">{KIND_ICON[l.kind]}</span>
                <span className="nm">{l.name}</span>
                <span className="act">
                  <button className="mini" title="Bring forward" onClick={(e) => { e.stopPropagation(); move(l.id, 1); }}><Icon.up /></button>
                  <button className="mini" title="Send backward" onClick={(e) => { e.stopPropagation(); move(l.id, -1); }}><Icon.down /></button>
                  <button className="mini" title={l.hidden ? 'Show' : 'Hide'} onClick={(e) => { e.stopPropagation(); toggle(l.id, 'hidden'); }}>{l.hidden ? <Icon.eyeOff /> : <Icon.eye />}</button>
                  <button className="mini" title={l.locked ? 'Unlock' : 'Lock'} onClick={(e) => { e.stopPropagation(); toggle(l.id, 'locked'); }}>{l.locked ? <Icon.lock /> : <Icon.unlock />}</button>
                </span>
              </div>
            ))}
            {!design.layers.length && <div className="empty">No layers yet.<br />Add an image or text.</div>}
            <div className="layer-item" onClick={() => select(null)} style={{ opacity: 0.8 }}><span className="ic">BG</span><span className="nm">Background</span></div>
          </div>
        </div>
        <section style={{ borderTop: '1px solid var(--line)', borderBottom: 0 }}>
          <div className="label" style={{ marginBottom: 8 }}>Templates</div>
          <div className="tpl">
            {TEMPLATES.map((t) => <button key={t.id} title={t.description} onClick={() => { setDesign(t.make()); select(null); }}><b>{t.name}</b><span className="faint">{t.description.slice(0, 38)}</span></button>)}
            <button title="Rings, crosshair and colour patches for checking alignment and colour" onClick={() => { setDesign(diagnosticDisc()); select(null); }}><b>Diagnostic disc</b><span className="faint">Alignment & colour check</span></button>
          </div>
        </section>
      </div>

      <div className="stagewrap">
        <div className="toolbar">
          <input type="text" value={design.name} onChange={(e) => setDesign((d) => ({ ...d, name: e.target.value }), { transient: true })} style={{ width: 220, fontWeight: 600 }} />
          <div style={{ flex: 1 }} />
          <button className="btn icon ghost" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)"><Icon.undo /></button>
          <button className="btn icon ghost" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Y)"><Icon.redo /></button>
          {selected && <>
            <button className="btn icon ghost" onClick={() => dup(selected)} title="Duplicate (Ctrl+D)"><Icon.copy /></button>
            <button className="btn icon ghost" onClick={() => setDesign((d) => ({ ...d, layers: d.layers.map((l) => l.id === selected ? { ...l, x: 0, y: 0 } : l) }))} title="Centre on disc"><Icon.center /></button>
            <button className="btn icon ghost danger" onClick={() => remove(selected)} title="Delete"><Icon.trash /></button>
          </>}
          <span style={{ width: 1, height: 22, background: 'var(--line)', margin: '0 4px' }} />
          <button className="btn sm ghost" onClick={open}><Icon.open />Open</button>
          <button className="btn sm ghost" onClick={save}><Icon.save />Save</button>
          <button className="btn sm primary" onClick={() => setPage('print')}><Icon.print />Print…</button>
        </div>
        <div className="canvas" ref={wrap}><Stage size={size} /></div>
      </div>

      <div className="side right">
        <section style={{ paddingBottom: 8 }}><div className="label">{selected ? 'Layer properties' : 'Design'}</div></section>
        <div className="scroll"><Props /></div>
      </div>
    </div>
  );
}
