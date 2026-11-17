import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { pf3 } from '../api';
import { Icon } from '../icons';
import { Field, Num, Slider, Seg, Check } from '../components/ui';
import { fieldsOf, MASK_PRESETS, MaskType, PrintSettings, DEFAULT_PRINT } from '../design/types';
import { renderPage, canvasToPngBase64, DPI_FOR } from '../design/render';

const INK_VOLUME = ['Lighter', 'Light', 'Medium', 'Heavy', 'Heavier'];

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (l: string) => { const out: string[] = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if ((ch === ',' || ch === ';' || ch === '\t') && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((s) => s.trim()); };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => { const v = split(l); const r: Record<string, string> = {}; head.forEach((h, i) => (r[h] = v[i] ?? '')); return r; });
}

export default function PrintPage() {
  const { design, print, setPrint, rows, setRows, conn, toast, setPage } = useStore();
  const [tab, setTab] = useState<'quality' | 'color' | 'advanced' | 'area' | 'alignment'>('quality');
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fields = fieldsOf(design);
  const batch = fields.length > 0;
  const effectiveRows = batch ? (rows.length ? rows : [{}]) : [{}];

  // live preview (low-res, same renderer as print)
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const c = await renderPage(design, print, 200, effectiveRows[0] ?? {}, 0);
      if (alive) setPreview(c.toDataURL());
    }, 150);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, print, rows]);

  const totalDiscs = effectiveRows.reduce((s, r) => s + Math.max(1, parseInt(r.__copies ?? '') || print.copies), 0);

  const go = async () => {
    try {
      const dpi = DPI_FOR[print.quality];
      const pngs: { data: string; label: string }[] = [];
      for (let i = 0; i < effectiveRows.length; i++) {
        setBusy(`Rendering disc ${i + 1} of ${effectiveRows.length} at ${dpi} dpi…`);
        const r = effectiveRows[i];
        const data = await canvasToPngBase64(await renderPage(design, print, dpi, r, i));
        const copies = Math.max(1, parseInt(r.__copies ?? '') || print.copies);
        const label = r.title ?? r[fields[0]] ?? (effectiveRows.length > 1 ? `#${i + 1}` : '');
        for (let c = 0; c < copies; c++) pngs.push({ data, label });
      }
      setBusy('Sending to queue…');
      await pf3.jobs.print({
        name: design.name || 'Disc',
        pngs,
        options: {
          name: design.name, quality: print.quality, media: print.media, dryTime: print.dryTime,
          inkDensity: 4 + print.inkVolume,
          inkAdjust: Object.values(print.inkAdjust).some(Boolean) ? print.inkAdjust : undefined,
        },
      });
      toast('ok', `Queued ${pngs.length} disc${pngs.length === 1 ? '' : 's'}.`);
    } catch (e: any) { toast('error', e.message); }
    finally { setBusy(null); }
  };

  const setMask = (m: MaskType) => { const { label, ...p } = MASK_PRESETS[m]; setPrint({ mask: m, ...p }); };
  const ready = conn?.connected;

  const settings = useMemo(() => {
    switch (tab) {
      case 'quality': return (
        <div className="col" style={{ gap: 16 }}>
          <Field label="Print quality"><Seg value={print.quality} onChange={(v) => setPrint({ quality: v })} options={[{ value: 'normal', label: 'Normal' }, { value: 'best', label: 'Best' }, { value: 'maxdpi', label: 'Max DPI' }]} /></Field>
          <p className="faint" style={{ margin: '-8px 0 0' }}>{print.quality === 'maxdpi' ? '1200 dpi raster. Slowest, sharpest; best for photos and small text.' : print.quality === 'best' ? '600 dpi, high-quality print mode. Recommended.' : '600 dpi, faster print mode with less ink.'}</p>
          <Field label="Print mode"><Seg value={print.media} onChange={(v) => setPrint({ media: v })} options={[{ value: 'photo', label: 'Photo' }, { value: 'graphics', label: 'Text & Graphics' }]} /></Field>
          <Field label="Copies of each disc"><Num value={print.copies} min={1} max={100} onChange={(v) => setPrint({ copies: Math.round(v) })} width={90} /></Field>
        </div>);
      case 'color': return (
        <div className="col" style={{ gap: 14 }}>
          <Field label="Colour"><Seg value={print.grayscale ? 'g' : 'c'} onChange={(v) => setPrint({ grayscale: v === 'g' })} options={[{ value: 'c', label: 'Full colour' }, { value: 'g', label: 'Grayscale' }]} /></Field>
          <Field label="Saturation"><Slider min={-50} max={50} value={print.saturation} onChange={(v) => setPrint({ saturation: v })} /></Field>
          <Field label="Brightness"><Slider min={-50} max={50} value={print.brightness} onChange={(v) => setPrint({ brightness: v })} /></Field>
          <Field label="Colour tone (cool ↔ warm)"><Slider min={-50} max={50} value={print.tone} onChange={(v) => setPrint({ tone: v })} /></Field>
          <div className="divider" style={{ margin: '2px 0' }} />
          <div className="label">Per-ink volume (printer firmware)</div>
          {(['c', 'm', 'y', 'k'] as const).map((k) => (
            <div key={k} className="row"><span style={{ width: 70 }} className="muted">{{ c: 'Cyan', m: 'Magenta', y: 'Yellow', k: 'Black' }[k]}</span>
              <Slider min={-50} max={50} value={print.inkAdjust[k]} onChange={(v) => setPrint({ inkAdjust: { ...print.inkAdjust, [k]: v } })} /></div>
          ))}
          <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPrint({ saturation: 0, brightness: 0, tone: 0, grayscale: false, inkAdjust: { c: 0, m: 0, y: 0, k: 0 } })}>Reset colour</button>
        </div>);
      case 'advanced': return (
        <div className="col" style={{ gap: 16 }}>
          <Field label={`Ink volume - ${INK_VOLUME[print.inkVolume + 2]}`}><Slider min={-2} max={2} value={print.inkVolume} onChange={(v) => setPrint({ inkVolume: v })} format={(v) => INK_VOLUME[v + 2]} /></Field>
          <Field label="Dry time"><Slider min={0} max={10} value={print.dryTime} onChange={(v) => setPrint({ dryTime: v })} format={(v) => (v ? String(v) : 'Auto')} /></Field>
          <p className="faint" style={{ margin: 0, lineHeight: 1.5 }}>If you raise ink volume, raise dry time too so discs don't smudge in the output stack (same advice as the original driver).</p>
        </div>);
      case 'area': return (
        <div className="col" style={{ gap: 14 }}>
          <Field label="Disc type / mask"><select value={print.mask} onChange={(e) => setMask(e.target.value as MaskType)}>{(Object.keys(MASK_PRESETS) as MaskType[]).map((m) => <option key={m} value={m}>{MASK_PRESETS[m].label}</option>)}</select></Field>
          {print.mask !== 'card' && print.mask !== 'none' && <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Outer diameter"><Num value={print.maskOuter} min={150} max={1200} onChange={(v) => setPrint({ maskOuter: v })} suffix="×0.1mm" /></Field>
            <Field label="Inner diameter"><Num value={print.maskInner} min={0} max={1200} onChange={(v) => setPrint({ maskInner: v })} suffix="×0.1mm" /></Field>
          </div>}
          {print.mask === 'card' && <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <Field label="Width"><Num value={print.cardW} min={100} max={1200} onChange={(v) => setPrint({ cardW: v })} /></Field>
            <Field label="Height"><Num value={print.cardH} min={100} max={1200} onChange={(v) => setPrint({ cardH: v })} /></Field>
            <Field label="Corner"><Num value={print.cardCorner} min={0} max={200} onChange={(v) => setPrint({ cardCorner: v })} /></Field>
          </div>}
          <p className="faint" style={{ margin: 0 }}>Units are 0.1 mm, like the original driver. Defaults: 1182 outer / 378 inner.</p>
          <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setMask('standard')}>Restore defaults</button>
        </div>);
      case 'alignment': return (
        <div className="col" style={{ gap: 14 }}>
          <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>Shift the whole image on the disc if prints come out off-centre. Print the <b>Diagnostic disc</b> template to measure the error against its rings.</p>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Horizontal (→)"><Num value={print.offsetX} min={-100} max={100} onChange={(v) => setPrint({ offsetX: v })} suffix="×0.1mm" /></Field>
            <Field label="Vertical (↓)"><Num value={print.offsetY} min={-100} max={100} onChange={(v) => setPrint({ offsetY: v })} suffix="×0.1mm" /></Field>
          </div>
          <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPrint({ offsetX: 0, offsetY: 0 })}>Reset offsets</button>
        </div>);
    }
  }, [tab, print, setPrint]);

  return (
    <div className="page">
      <h1>Print</h1>
      <p className="sub">{design.name || 'Untitled'} · {batch ? `${effectiveRows.length} unique disc${effectiveRows.length === 1 ? '' : 's'}` : 'single design'} · {totalDiscs} disc{totalDiscs === 1 ? '' : 's'} total</p>
      <div className="print-layout">
        <div className="col" style={{ gap: 16 }}>
          {batch && (
            <div className="card">
              <div className="row" style={{ marginBottom: 10 }}>
                <h3 style={{ flex: 1 }}>Batch / variable data <span className="tag new">new</span></h3>
                <button className="btn sm" onClick={async () => { const f = await pf3.file.open([{ name: 'CSV', extensions: ['csv', 'txt', 'tsv'] }]); if (f) { const r = parseCsv(f.data); setRows(r); toast('ok', `Imported ${r.length} rows`); } }}>Import CSV</button>
                <button className="btn sm" onClick={() => setRows([...rows, Object.fromEntries(fields.map((f) => [f, '']))])}>Add row</button>
                <button className="btn sm ghost" onClick={() => setRows(Array.from({ length: 10 }, (_, i) => ({ ...Object.fromEntries(fields.map((f) => [f, rows[0]?.[f] ?? ''])), ...(fields.includes('disc') ? { disc: String(i + 1) } : {}) })))}>Fill 10</button>
              </div>
              <p className="desc">Each row prints one disc (times its copies). Use <span className="kbd">{'{{n}}'}</span> for automatic numbering.</p>
              <div style={{ maxHeight: 300, overflow: 'auto' }}>
                <table className="tbl">
                  <thead><tr><th>#</th>{fields.map((f) => <th key={f}>{f}</th>)}<th style={{ width: 70 }}>Copies</th><th /></tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}><td className="faint">{i + 1}</td>
                        {fields.map((f) => <td key={f}><input type="text" value={r[f] ?? ''} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, [f]: e.target.value } : x)))} /></td>)}
                        <td><input type="number" min={1} placeholder={String(print.copies)} value={r.__copies ?? ''} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, __copies: e.target.value } : x)))} /></td>
                        <td><button className="mini" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon.x /></button></td></tr>
                    ))}
                    {!rows.length && <tr><td colSpan={fields.length + 3} className="faint" style={{ padding: 14 }}>No rows. The design prints once with empty fields. Add rows or import a CSV with columns: {fields.join(', ')}</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="card">
            <div className="tabs">
              {([['quality', 'Quality'], ['color', 'Color'], ['advanced', 'Ink & dry time'], ['area', 'Printable area'], ['alignment', 'Alignment']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
            </div>
            {settings}
          </div>
        </div>

        <div className="col" style={{ gap: 14, position: 'sticky', top: 0 }}>
          <div className="card" style={{ padding: 14 }}>
            <div className="preview-disc" style={{ borderRadius: '50%' }}>{preview && <img src={preview} style={{ width: '100%', height: '100%' }} />}</div>
            <p className="faint" style={{ textAlign: 'center', margin: '10px 0 0' }}>Exactly what is sent to the printer (white = no ink)</p>
          </div>
          <button className="btn primary" style={{ height: 46, fontSize: 15 }} disabled={!!busy} onClick={go}>
            <Icon.print />{busy ?? `Print ${totalDiscs} disc${totalDiscs === 1 ? '' : 's'}`}
          </button>
          {!ready && <div className="pill" style={{ height: 'auto', padding: '8px 12px', borderRadius: 8 }}><span className="dot bad" />Printer not connected - jobs will wait in the queue.</div>}
          <div className="row"><button className="btn sm ghost" onClick={() => setPage('design')}><Icon.design />Back to design</button><div style={{ flex: 1 }} />
            <button className="btn sm ghost" onClick={() => setPrint({ ...DEFAULT_PRINT, copies: print.copies } as PrintSettings)}>Reset all settings</button></div>
        </div>
      </div>
    </div>
  );
}
