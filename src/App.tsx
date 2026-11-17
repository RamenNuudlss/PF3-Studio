import React, { useEffect, useState } from 'react';
import { useStore } from './store';
import { pf3 } from './api';
import { Icon } from './icons';
import Queue from './components/Queue';
import Designer from './pages/Designer';
import PrintPage from './pages/PrintPage';
import PrinterPage from './pages/PrinterPage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';
import { renderPage, canvasToPngBase64, DPI_FOR, loadImage } from './design/render';
import { Design, DEFAULT_PRINT, uid } from './design/types';

const PAGES = [
  { id: 'design', label: 'Design', icon: Icon.design },
  { id: 'print', label: 'Print', icon: Icon.print },
  { id: 'printer', label: 'Printer', icon: Icon.printer },
  { id: 'stats', label: 'Stats', icon: Icon.stats },
];

export default function App() {
  const { page, setPage, conn, jobs, toasts, dismiss, print } = useStore();
  const [queueOpen, setQueueOpen] = useState(false);
  const activeJobs = jobs.filter((j) => ['printing', 'paused', 'queued'].includes(j.state)).length;
  useEffect(() => { if (activeJobs) setQueueOpen(true); }, [activeJobs > 0]);

  // Boxset / CLI render requests from the main process
  useEffect(() => pf3.api.onRender(async (req) => {
    try {
      let design: Design | undefined = req.template;
      if (!design && req.image) {
        // cover-fit the picture over the whole disc, keeping its aspect ratio
        const img = await loadImage(req.image);
        const r = img.width / img.height;
        const w = r >= 1 ? 120 * r : 120, h = r >= 1 ? 120 : 120 / r;
        design = { version: 1, name: 'Image', background: { type: 'solid', color: '#ffffff' }, layers: [{ id: uid(), name: 'Image', kind: 'image', src: req.image, w, h, x: 0, y: 0, rotation: 0, opacity: 1 }] };
      }
      if (!design) throw new Error('No template or image supplied');
      const ps = { ...DEFAULT_PRINT, ...print };
      const pngs: string[] = [];
      for (let i = 0; i < req.rows.length; i++) pngs.push(await canvasToPngBase64(await renderPage(design, ps, DPI_FOR[req.quality] ?? 600, req.rows[i], i)));
      pf3.api.rendered({ id: req.id, ok: true, pngs });
    } catch (e: any) { pf3.api.rendered({ id: req.id, ok: false, error: e.message }); }
  }), [print]);

  const st = conn?.status;
  const dot = !conn?.connected ? 'bad' : st && ['idle', 'power-save'].includes(st.state) ? 'ok' : 'warn';
  const ink = st?.cartridges.map((c) => `${c.type === 'black' ? 'K' : c.type === 'tri-color' ? 'CMY' : c.type} ${c.level ?? '?'}%`).join(' · ');

  return (
    <div className="shell">
      <div className="titlebar">
        <div className="brand"><Icon.disc width={20} height={20} color="var(--accent)" />PF3 Studio <small>for Microboards PF-3</small></div>
        <div className="spacer" />
        <button className="pill" style={{ cursor: 'pointer' }} onClick={() => setPage('printer')} title={conn?.error ?? ''}>
          <span className={`dot ${dot}`} />{conn?.connected ? (st?.text ?? 'Connected') : 'Printer offline'}{ink ? <span className="faint">· {ink}</span> : null}
        </button>
      </div>
      <nav className="nav">
        {PAGES.map((p) => <button key={p.id} className={page === p.id ? 'active' : ''} onClick={() => setPage(p.id)}><p.icon />{p.label}</button>)}
        <div className="grow" />
        <button className={queueOpen ? 'active' : ''} onClick={() => setQueueOpen((o) => !o)} title="Print queue"><Icon.queue />Queue{activeJobs ? ` (${activeJobs})` : ''}</button>
        <button className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')}><Icon.settings />Settings</button>
      </nav>
      <main className="main">
        {page === 'design' && <Designer />}
        {page === 'print' && <PrintPage />}
        {page === 'printer' && <PrinterPage />}
        {page === 'stats' && <StatsPage />}
        {page === 'settings' && <SettingsPage />}
        {queueOpen && <Queue onClose={() => setQueueOpen(false)} />}
      </main>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.level}`}>
            <div style={{ flex: 1 }}>{t.message}
              {t.action === 'resume' && <div style={{ marginTop: 8 }}><button className="btn sm primary" onClick={() => { pf3.jobs.resume(); dismiss(t.id); }}>Resume printing</button></div>}
              {t.action === 'exercise-belt' && <div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => { pf3.jobs.maintenance({ kind: 'exercise-belt' }, 'Exercise belt'); dismiss(t.id); }}>Exercise belt now</button></div>}
            </div>
            <button className="mini" onClick={() => dismiss(t.id)}><Icon.x /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
