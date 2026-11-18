import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { pf3, Cartridge } from '../api';
import { Icon } from '../icons';
import { Check, Modal } from '../components/ui';
import { diagnosticDisc } from '../design/templates';
import { renderPage, canvasToPngBase64 } from '../design/render';
import { DEFAULT_PRINT } from '../design/types';
import FirmwareConsole from '../components/FirmwareConsole';

const LABELS = [48, 40, 32, 24, 16, 8, 0, -8, -16, -24, -32, -40, -48];
const PATTERNS = ['Black to Color Horizontal', 'Black to Color Vertical', 'Black Bidi Alignment', 'Color Bidi Alignment'];

function Gauge({ c }: { c: Cartridge }) {
  const lvl = c.level ?? 0;
  const color = c.type === 'black' ? 'linear-gradient(90deg,#3b3f4a,#8a90a0)' : 'linear-gradient(90deg,var(--cyan),var(--magenta),var(--yellow))';
  const low = c.level !== null && c.level <= 10;
  return (
    <div className="gauge">
      <div className="row"><b style={{ flex: 1 }}>{c.type === 'black' ? 'Black' : c.type === 'tri-color' ? 'Tri-color' : c.type}</b><span className="tag">{c.part ?? '—'}</span></div>
      <div className="bar"><div style={{ width: `${lvl}%`, background: color }} /></div>
      <div className="row"><span className="lvl" style={{ color: low ? 'var(--bad)' : undefined }}>{c.level === null ? '—' : `${c.level}%`}</span><div style={{ flex: 1 }} />
        <span className={c.health === 'ok' ? 'faint' : ''} style={{ color: c.health !== 'ok' ? 'var(--bad)' : undefined }}>{c.health === 'ok' ? 'Healthy' : c.health}</span></div>
    </div>
  );
}

function PenWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<0 | 1>(0);
  const [vals, setVals] = useState<number[]>([0, 0, 0, 0]);
  const [verify, setVerify] = useState(true);
  return (
    <Modal title="Pen calibration" onClose={onClose} footer={step === 0 ? <>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn" onClick={() => setStep(1)}>I already printed the discs</button>
      <button className="btn primary" onClick={() => { pf3.jobs.maintenance({ kind: 'pen-calibration-print' }, 'Pen calibration discs'); setStep(1); }}>Print alignment discs</button>
    </> : <>
      <Check checked={verify} onChange={setVerify}>Print a verification disc afterwards</Check><div style={{ flex: 1 }} />
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={async () => { const v = await pf3.pen.labelToValue(vals) as [number, number, number, number]; pf3.jobs.maintenance({ kind: 'pen-calibration-set', values: v, verify }, 'Save pen calibration'); onClose(); }}>Save calibration</button>
    </>}>
      {step === 0 ? (
        <p className="muted" style={{ lineHeight: 1.6, margin: 0 }}>The current calibration is reset and two alignment discs are printed. Each has 4 numbered line patterns. Load at least 2 discs in the input hopper, then continue.</p>
      ) : (
        <div className="col" style={{ gap: 16 }}>
          <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>For each pattern, pick the number where the lines line up best (same scale as the original Toolbox).</p>
          {PATTERNS.map((p, i) => (
            <div key={p}><div className="row" style={{ marginBottom: 6 }}><b style={{ flex: 1 }}>{p}</b><span className="faint">{vals[i]}</span></div>
              <div className="pen-scale">{LABELS.map((l) => <button key={l} className={vals[i] === l ? 'on' : ''} onClick={() => setVals(vals.map((v, j) => (j === i ? l : v)))}>{l}</button>)}</div></div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default function PrinterPage() {
  const { conn, toast, print } = useStore();
  const [verify, setVerify] = useState(true);
  const [pen, setPen] = useState(false);
  const [diag, setDiag] = useState<string | null>(null);
  const [vendor, setVendor] = useState<Record<string, boolean>>({});
  useEffect(() => { pf3.vendor.status().then((v) => setVendor(v.available)); }, []);

  const st = conn?.status;
  const busy = st && !['idle', 'power-save'].includes(st.state);
  const m = (a: Parameters<typeof pf3.jobs.maintenance>[0], name: string) => pf3.jobs.maintenance(a, name).then(() => toast('ok', `${name} queued`));

  const diagnostic = async () => {
    const png = await canvasToPngBase64(await renderPage(diagnosticDisc(), { ...DEFAULT_PRINT, offsetX: print.offsetX, offsetY: print.offsetY, mask: 'none', maskOuter: 1200, maskInner: 0 }, 600));
    await pf3.jobs.print({ name: 'Diagnostic disc', pngs: [{ data: png, label: 'diagnostic' }], options: { name: 'Diagnostic disc', quality: 'best', media: 'photo' } });
    toast('ok', 'Diagnostic disc queued');
  };

  const Card = ({ title, desc, children, tag }: { title: string; desc: string; children: React.ReactNode; tag?: string }) => (
    <div className="card"><h3>{title} {tag && <span className="tag new">{tag}</span>}</h3><p className="desc">{desc}</p><div className="row wrap">{children}</div></div>
  );

  return (
    <div className="page">
      <h1>Printer</h1>
      <p className="sub">Status and maintenance. Replaces the Microboards Toolbox and Print Queue Utility.</p>

      <div className="card hero" style={{ marginBottom: 18 }}>
        <div style={{ display: 'grid', placeItems: 'center' }}><div className={`disc-art ${st?.state === 'printing' ? 'spin' : ''}`} /></div>
        <div>
          <div className="row"><span className={`dot ${!conn?.connected ? 'bad' : busy ? 'warn' : 'ok'}`} /><span className="muted">{conn?.connected ? `Microboards PF-3 · ${conn.model ?? ''}${conn.serial ? ` · S/N ${conn.serial}` : ''}` : 'Not connected'}</span></div>
          <div className="big-state">{conn?.connected ? st?.text ?? 'Connected' : 'Printer offline'}</div>
          <div className="muted">{conn?.connected ? `Updated ${new Date(conn.updatedAt).toLocaleTimeString()}` : conn?.error}</div>
          <div className="ink">{st?.cartridges.length ? st.cartridges.map((c) => <Gauge key={c.index} c={c} />) : <div className="faint">Ink levels appear when the printer is connected.</div>}</div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn sm" onClick={() => pf3.printer.refresh()}><Icon.refresh />Refresh</button>
            <button className="btn sm ghost" onClick={async () => { try { setDiag(await pf3.printer.rawDeviceId()); } catch (e: any) { toast('error', e.message); } }}>Diagnostics</button>
            <button className="btn sm ghost" onClick={() => pf3.openExternal('https://www.google.com/search?q=Microboards+V101B+V102C')}>Order ink</button>
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
        <Card title="Cleaning" desc="Light uses the least ink and time; Heavy the most. Start light and step up only if the verification disc still shows streaks.">
          <button className="btn" onClick={() => m({ kind: 'clean', level: 1, verify }, 'Light clean')}>Light</button>
          <button className="btn" onClick={() => m({ kind: 'clean', level: 2, verify }, 'Regular clean')}>Regular</button>
          <button className="btn" onClick={() => m({ kind: 'clean', level: 3, verify }, 'Heavy clean')}>Heavy</button>
          <div style={{ width: '100%' }} />
          <Check checked={verify} onChange={setVerify}><span className="muted">Print verification disc after{!vendor['clean-verify'] ? ' (needs original files)' : ''}</span></Check>
        </Card>
        <Card title="Pen calibration" desc="Aligns the black and colour cartridges. Run it after installing a new cartridge or if colours look misregistered.">
          <button className="btn" onClick={() => setPen(true)} disabled={!vendor['align-vertical']}>Start calibration…</button>
          {!vendor['align-vertical'] && <span className="faint">Needs the original software files (Settings)</span>}
        </Card>
        <Card title="Automatic margin calibration" desc="The printer measures a disc's top, bottom and sides, then ejects it. Load one disc first. Your manual alignment offsets are kept.">
          <button className="btn" onClick={() => m({ kind: 'margin-calibration' }, 'Margin calibration')}>Run calibration</button>
        </Card>
        <Card title="Exercise belt" desc="Runs the belts at high speed to recondition them after the printer has been idle. No discs needed.">
          <button className="btn" onClick={() => m({ kind: 'exercise-belt' }, 'Exercise belt')}>Exercise belt</button>
        </Card>
        <Card title="Test prints" desc="The original Microboards test disc, or the new diagnostic disc with measurement rings, a crosshair and colour patches." tag="improved">
          <button className="btn" onClick={() => m({ kind: 'vendor-test-disc' }, 'Test disc')} disabled={!vendor['test-disc']}>Microboards test disc</button>
          <button className="btn" onClick={diagnostic}>Diagnostic disc</button>
        </Card>
        <Card title="Queue & connection" desc="Cancel every pending job and reset the printer's input (replaces the Print Queue Utility). Soft reset clears a stuck USB transfer.">
          <button className="btn danger" onClick={() => pf3.jobs.clearAll().then(() => toast('ok', 'Queue cleared'))}>Clear print queue</button>
          <button className="btn ghost" onClick={() => pf3.printer.softReset().then((ok) => toast(ok ? 'ok' : 'error', ok ? 'USB link reset' : 'Reset failed'))}>Soft reset</button>
        </Card>
      </div>

      {pen && <PenWizard onClose={() => setPen(false)} />}
      {diag !== null && (
        <Modal title="Printer diagnostics" onClose={() => setDiag(null)} footer={<button className="btn" onClick={() => setDiag(null)}>Close</button>}>
          <div className="kv" style={{ marginBottom: 14 }}>
            <span className="faint">State</span><span>{st?.text} (code {st?.stateCode}, status rev {st?.revision ?? '?'})</span>
            <span className="faint">Device path</span><span style={{ wordBreak: 'break-all', fontSize: 12 }}>{conn?.path}</span>
          </div>
          <div className="label" style={{ marginBottom: 6 }}>IEEE-1284 device ID</div>
          <pre className="code" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{diag.split(';').filter(Boolean).join(';\n')}</pre>
          <div className="divider" />
          <FirmwareConsole />
        </Modal>
      )}
    </div>
  );
}
