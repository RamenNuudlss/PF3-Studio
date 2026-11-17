import React, { useEffect, useMemo, useState } from 'react';
import { pf3, StatsData } from '../api';
import { useStore } from '../store';
import { Field, Num } from '../components/ui';

const money = (v: number) => `$${v.toFixed(2)}`;

function InkChart({ ink }: { ink: StatsData['ink'] }) {
  if (ink.length < 2) return <div className="empty">Ink history builds up as the printer reports levels.</div>;
  const W = 800, H = 220, P = 28;
  const t0 = ink[0].t, t1 = ink[ink.length - 1].t || t0 + 1;
  const x = (t: number) => P + ((t - t0) / Math.max(1, t1 - t0)) * (W - P * 2);
  const y = (v: number) => H - P - (v / 100) * (H - P * 2);
  const line = (k: 'black' | 'color') => ink.filter((s) => s[k] !== null).map((s, i) => `${i ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(s[k]!).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart">
      {[0, 25, 50, 75, 100].map((v) => <g key={v}><line x1={P} x2={W - P} y1={y(v)} y2={y(v)} stroke="#262c39" /><text x={4} y={y(v) + 4} fill="#6f7686" fontSize="11">{v}%</text></g>)}
      <path d={line('black')} fill="none" stroke="#c8ccd6" strokeWidth="2" />
      <path d={line('color')} fill="none" stroke="url(#g)" strokeWidth="2.5" />
      <defs><linearGradient id="g"><stop offset="0" stopColor="#18c8e8" /><stop offset=".5" stopColor="#e83e9c" /><stop offset="1" stopColor="#f3d33b" /></linearGradient></defs>
      <text x={W - P} y={14} textAnchor="end" fill="#a3a9b8" fontSize="11">— black   — tri-color</text>
    </svg>
  );
}

export default function StatsPage() {
  const { jobs } = useStore();
  const [d, setD] = useState<StatsData | null>(null);
  useEffect(() => { pf3.stats.get().then(setD); }, [jobs]);
  const s = useMemo(() => {
    if (!d) return null;
    const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
    const discs = d.discs;
    const total = discs.reduce((a, x) => a + x.cost, 0);
    const avgCov = discs.length ? discs.reduce((a, x) => a + (x.coverage.c + x.coverage.m + x.coverage.y) / 3 + x.coverage.k, 0) / discs.length : 0;
    // discs left estimate from the latest ink levels and average consumption
    const last = d.ink[d.ink.length - 1];
    const avgColor = discs.length ? discs.reduce((a, x) => a + (x.coverage.c + x.coverage.m + x.coverage.y) / 3, 0) / discs.length : 0.35;
    const avgBlack = discs.length ? discs.reduce((a, x) => a + x.coverage.k, 0) / discs.length : 0.05;
    const leftColor = last?.color != null ? Math.floor((last.color / 100) * d.pricing.colorYieldFullDiscs / Math.max(0.01, avgColor)) : null;
    const leftBlack = last?.black != null ? Math.floor((last.black / 100) * d.pricing.blackYieldFullDiscs / Math.max(0.005, avgBlack)) : null;
    return { count: discs.length, thisMonth: discs.filter((x) => x.t >= month.getTime()).length, total, avg: discs.length ? total / discs.length : 0, avgCov, leftColor, leftBlack };
  }, [d]);
  if (!d || !s) return <div className="page" />;
  const P = d.pricing;
  const setP = (p: Partial<typeof P>) => pf3.stats.setPricing(p).then(setD);
  return (
    <div className="page">
      <h1>Stats <span className="tag new">new</span></h1>
      <p className="sub">Ink usage, cost per disc and maintenance history. The original software had none of this.</p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))', marginBottom: 16 }}>
        <div className="stat"><div className="label">Discs printed</div><div className="v">{s.count}</div></div>
        <div className="stat"><div className="label">This month</div><div className="v">{s.thisMonth}</div></div>
        <div className="stat"><div className="label">Avg cost / disc</div><div className="v">{money(s.avg)}</div></div>
        <div className="stat"><div className="label">Total spend</div><div className="v">{money(s.total)}</div></div>
        <div className="stat"><div className="label">Discs left (est.)</div><div className="v">{s.leftColor ?? '—'}<span className="faint" style={{ fontSize: 14 }}> col / {s.leftBlack ?? '—'} blk</span></div></div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' }}>
        <div className="card"><h3>Ink level history</h3><InkChart ink={d.ink} /></div>
        <div className="card">
          <h3>Pricing</h3><p className="desc">Used for cost estimates. Yields are full-coverage discs per cartridge.</p>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="V102C price"><Num value={P.colorPrice} step={0.5} onChange={(v) => setP({ colorPrice: v })} /></Field>
            <Field label="V102C yield"><Num value={P.colorYieldFullDiscs} onChange={(v) => setP({ colorYieldFullDiscs: v })} /></Field>
            <Field label="V101B price"><Num value={P.blackPrice} step={0.5} onChange={(v) => setP({ blackPrice: v })} /></Field>
            <Field label="V101B yield"><Num value={P.blackYieldFullDiscs} onChange={(v) => setP({ blackYieldFullDiscs: v })} /></Field>
            <Field label="Blank disc price"><Num value={P.discPrice} step={0.05} onChange={(v) => setP({ discPrice: v })} /></Field>
          </div>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', marginTop: 16 }}>
        <div className="card"><h3>Recent discs</h3>
          <table className="tbl"><thead><tr><th>When</th><th>Job</th><th>Label</th><th>Quality</th><th>Coverage</th><th>Cost</th></tr></thead>
            <tbody>{d.discs.slice(-40).reverse().map((x, i) => <tr key={i}><td>{new Date(x.t).toLocaleString()}</td><td>{x.jobName}</td><td>{x.label}</td><td>{x.quality}</td><td>{Math.round(((x.coverage.c + x.coverage.m + x.coverage.y) / 3 + x.coverage.k) * 100)}%</td><td>{money(x.cost)}</td></tr>)}
              {!d.discs.length && <tr><td colSpan={6} className="faint" style={{ padding: 14 }}>No discs printed yet.</td></tr>}</tbody></table>
        </div>
        <div className="card"><h3>Maintenance log</h3>
          {d.maintenance.slice(-20).reverse().map((x, i) => <div key={i} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}><span style={{ flex: 1 }}>{x.action}</span><span className="faint">{new Date(x.t).toLocaleDateString()}</span></div>)}
          {!d.maintenance.length && <div className="faint">Nothing yet.</div>}
          <div className="divider" />
          <button className="btn sm ghost danger" onClick={() => confirm('Reset all statistics?') && pf3.stats.reset().then(setD)}>Reset statistics</button>
        </div>
      </div>
    </div>
  );
}
