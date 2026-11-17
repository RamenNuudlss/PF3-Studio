import React, { useEffect, useState } from 'react';
import { pf3, Settings } from '../api';
import { useStore } from '../store';
import { Field, Num, Check } from '../components/ui';

const VENDOR_NAMES: Record<string, string> = { 'test-disc': 'Microboards test disc', 'clean-verify': 'Cleaning verification disc', 'align-vertical': 'Pen alignment disc 1', 'align-pattern2': 'Pen alignment disc 2' };

export default function SettingsPage() {
  const { toast } = useStore();
  const [s, setS] = useState<Settings | null>(null);
  const [vendor, setVendor] = useState<{ available: Record<string, boolean>; dir: string } | null>(null);
  useEffect(() => { pf3.settings.get().then(setS); pf3.vendor.status().then(setVendor); }, []);
  if (!s) return <div className="page" />;
  const set = (p: Partial<Settings>) => pf3.settings.set(p).then(setS);
  const snippet = `import requests  # Boxset -> PF3 Studio
requests.post("http://127.0.0.1:${s.apiPort}/print", json={
    "templatePath": r"D:\\microboard\\boxset-movie.pf3label",
    "fields": {"title": "Fast & Furious", "subtitle": "The Complete Collection", "year": "2001-2023", "disc": "1"},
    "copies": 1, "quality": "best",
})`;
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <h1>Settings</h1>
      <p className="sub">PF3 Studio talks to the PF-3 directly over USB. No Microboards or HP driver is needed.</p>
      <div className="grid">
        <div className="card">
          <h3>Ink warnings</h3><p className="desc">Before each disc, ink is checked against these levels (the original used 10%, 5% and 3%).</p>
          <div className="row wrap" style={{ gap: 18 }}>
            <Field label="Warn at (%)"><input type="text" value={s.lowInkThresholds.join(', ')} onChange={(e) => set({ lowInkThresholds: e.target.value.split(/[ ,]+/).map(Number).filter((n) => n > 0 && n < 100) })} style={{ width: 160 }} /></Field>
            <Check checked={s.pauseOnLowInk} onChange={(v) => set({ pauseOnLowInk: v })}>Pause the queue and ask before continuing</Check>
          </div>
        </div>
        <div className="card">
          <h3>Belt reminder</h3><p className="desc">Suggest "Exercise belt" when the printer has been idle this many days (0 = off).</p>
          <Num value={s.beltReminderDays} min={0} max={365} onChange={(v) => set({ beltReminderDays: v })} width={90} suffix="days" />
        </div>
        <div className="card">
          <h3>Boxset integration <span className="tag new">new</span></h3>
          <p className="desc">A local API lets Boxset (or any script) print a label automatically after it burns a disc. It only listens on this PC (127.0.0.1).</p>
          <div className="row wrap" style={{ gap: 18, marginBottom: 12 }}>
            <Check checked={s.apiEnabled} onChange={(v) => set({ apiEnabled: v })}>Enable local API</Check>
            <Field label="Port"><Num value={s.apiPort} min={1024} max={65535} onChange={(v) => set({ apiPort: v })} width={100} /></Field>
          </div>
          <pre className="code">{snippet}</pre>
          <p className="faint" style={{ marginTop: 10, lineHeight: 1.5 }}>Also: <span className="kbd">GET /status</span> (printer + queue), <span className="kbd">POST /cancel/:id</span>, and from a shell: <span className="kbd">"PF3 Studio.exe" --print poster.png --copies 2</span> or <span className="kbd">--template file.pf3label --fields {'{"title":"..."}'}</span>. <span className="kbd">image</span> may be a file path, base64 or data URL.</p>
        </div>
        <div className="card">
          <h3>Original software files</h3>
          <p className="desc">The test disc, cleaning-verification disc and pen-alignment patterns are pre-rendered HP/Microboards jobs. PF3 Studio uses them if present ({vendor?.dir}).</p>
          <div className="row wrap" style={{ marginBottom: 12 }}>{vendor && Object.entries(VENDOR_NAMES).map(([k, n]) => <span key={k} className="pill"><span className={`dot ${vendor.available[k] ? 'ok' : 'bad'}`} />{n}</span>)}</div>
          <button className="btn sm" onClick={() => pf3.vendor.import().then((a) => { setVendor((v) => v && { ...v, available: a }); toast('ok', 'Imported'); })}>Import .pcl files…</button>
        </div>
        <div className="card">
          <h3>App</h3>
          <div className="col">
            <Check checked={s.minimizeToTray} onChange={(v) => set({ minimizeToTray: v })}>Keep running in the system tray when closed (needed for low-ink alerts and the Boxset API)</Check>
            <Check checked={s.startWithWindows} onChange={(v) => set({ startWithWindows: v })}>Start with Windows (minimised to tray)</Check>
          </div>
        </div>
      </div>
    </div>
  );
}
