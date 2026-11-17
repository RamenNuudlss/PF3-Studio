import React from 'react';

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={`field ${className ?? ''}`}><label>{label}</label>{children}</div>;
}

export function Num({ value, onChange, min, max, step = 1, suffix, width }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string; width?: number }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <input type="number" value={Number.isFinite(value) ? +value.toFixed(3) : 0} min={min} max={max} step={step} style={{ width: width ?? '100%' }}
        onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onChange(min !== undefined && v < min ? min : max !== undefined && v > max ? max : v); }} />
      {suffix && <span className="faint" style={{ fontSize: 12 }}>{suffix}</span>}
    </div>
  );
}

export function Slider({ value, onChange, min, max, step = 1, format }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; format?: (v: number) => string }) {
  return (
    <div className="row" style={{ gap: 10 }}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} onDoubleClick={() => onChange(0 >= min && 0 <= max ? 0 : min)} />
      <span style={{ width: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} className="muted">{format ? format(value) : value}</span>
    </div>
  );
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">{options.map((o) => <button key={String(o.value)} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return <label className="check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{children}</label>;
}

export function Modal({ title, children, footer, onClose }: { title: string; children: React.ReactNode; footer?: React.ReactNode; onClose: () => void }) {
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <header><h2>{title}</h2></header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const hex = value.length > 7 ? value.slice(0, 7) : value;
  return (
    <div className="row" style={{ gap: 6 }}>
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#ffffff'} onChange={(e) => onChange(e.target.value)} />
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%' }} />
    </div>
  );
}
