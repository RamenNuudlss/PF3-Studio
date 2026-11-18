import React, { useEffect, useState } from 'react';
import { pf3 } from '../api';
import { Check, Num } from './ui';

const QUICK: { label: string; cmd: string }[] = [
  { label: 'Page count', cmd: 'ds2.get 65565;' },
  { label: 'Ink drop counters', cmd: 'ds2.get 65811;ds2.get 65814;ds2.get 65817;' },
  { label: 'Low-ink triggers', cmd: 'ds2.get 65771;ds2.get 65772;ds2.get 65773;' },
  { label: 'Try help', cmd: 'udw.help;' },
];

export default function FirmwareConsole() {
  const api = (pf3 as any).fw;
  const [cmd, setCmd] = useState('ds2.get 65565;');
  const [allowWrite, setAllowWrite] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(65536);
  const [to, setTo] = useState(69000);
  const [prog, setProg] = useState<{ done: number; total: number; found: number } | null>(null);
  const [scan, setScan] = useState<{ id: number; value: string }[] | null>(null);
  useEffect(() => api?.onScanProgress?.(setProg), []);

  const run = async (c: string) => {
    setBusy(true);
    const r = await api.query(c, allowWrite);
    setLog((l) => [`> ${c}`, r.ok ? (r.reply ? `${r.reply}   [${r.reply.length} bytes]` : '(no reply after 12 s)') : `! ${r.error}`, ...l].slice(0, 200));
    setBusy(false);
  };
  const doScan = async () => {
    setScan(null); setProg({ done: 0, total: to - from + 1, found: 0 });
    const res = await api.scan(from, to);
    setScan(res);
  };
  const save = () => {
    const txt = scan!.map((e) => `${e.id}\t${e.value}`).join('\n');
    pf3.file.save(`pf3-ds2-${from}-${to}.txt`, txt, [{ name: 'Text', extensions: ['txt'] }]);
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="label">Firmware console</div>
      <p className="faint" style={{ margin: 0, lineHeight: 1.5 }}>Sends HP service ("underware") commands and shows the printer's reply. Only read-only queries are allowed unless you enable writes.</p>
      <div className="row wrap">{QUICK.map((q) => <button key={q.label} className="btn sm" disabled={busy} onClick={() => run(q.cmd)}>{q.label}</button>)}</div>
      <div className="row">
        <input type="text" value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && run(cmd)} style={{ flex: 1, fontFamily: 'Consolas, monospace' }} />
        <button className="btn sm primary" disabled={busy} onClick={() => run(cmd)}>Send</button>
      </div>
      <Check checked={allowWrite} onChange={setAllowWrite}><span style={{ color: allowWrite ? 'var(--bad)' : undefined }}>Allow write commands (can change printer settings permanently)</span></Check>
      {log.length > 0 && <pre className="code" style={{ maxHeight: 200, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{log.join('\n')}</pre>}
      <div className="divider" style={{ margin: '4px 0' }} />
      <div className="label">Scan settings store (read-only)</div>
      <div className="row">
        <span className="faint">IDs</span><Num value={from} onChange={setFrom} width={100} /><span className="faint">to</span><Num value={to} onChange={setTo} width={100} />
        {prog && !scan ? <button className="btn sm danger" onClick={() => api.scanStop()}>Stop</button> : <button className="btn sm" onClick={doScan}>Start scan</button>}
        {scan && <button className="btn sm primary" onClick={save}>Save results…</button>}
      </div>
      {prog && <div><div className="progress"><div style={{ width: `${(prog.done / prog.total) * 100}%` }} /></div>
        <div className="faint" style={{ marginTop: 6 }}>{prog.done} / {prog.total} checked · {prog.found} answered{scan ? ' · done' : ''}</div></div>}
    </div>
  );
}
