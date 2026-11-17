import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { pf3, ConnState, JobView } from './api';
import { Design, PrintSettings, DEFAULT_PRINT, Layer } from './design/types';
import { TEMPLATES } from './design/templates';

export interface Toast { id: number; level: string; message: string; action?: string }

interface Store {
  design: Design;
  setDesign: (d: Design | ((d: Design) => Design), opts?: { transient?: boolean }) => void;
  updateLayer: (id: string, patch: Partial<Layer>, opts?: { transient?: boolean }) => void;
  commit: () => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
  selected: string | null; select: (id: string | null) => void;
  print: PrintSettings; setPrint: (p: Partial<PrintSettings>) => void;
  rows: Record<string, string>[]; setRows: (r: Record<string, string>[]) => void;
  conn: ConnState | null;
  jobs: JobView[];
  toasts: Toast[]; toast: (level: string, message: string, action?: string) => void; dismiss: (id: number) => void;
  page: string; setPage: (p: string) => void;
}

const Ctx = createContext<Store>(null as any);
export const useStore = () => useContext(Ctx);

const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } };

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [design, setDesignState] = useState<Design>(() => {
    try { const v = localStorage.getItem('pf3.design'); if (v) return JSON.parse(v); } catch { /* */ }
    return TEMPLATES.find((t) => t.id === 'boxset-movie')!.make();
  });
  const past = useRef<Design[]>([]);
  const future = useRef<Design[]>([]);
  const committed = useRef<Design>(design);
  const [, force] = useState(0);
  const [selected, select] = useState<string | null>(null);
  const [print, setPrintState] = useState<PrintSettings>(() => load('pf3.print', DEFAULT_PRINT));
  const [rows, setRowsState] = useState<Record<string, string>[]>(() => { try { return JSON.parse(localStorage.getItem('pf3.rows') ?? '[]'); } catch { return []; } });
  const [conn, setConn] = useState<ConnState | null>(null);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [page, setPage] = useState('design');

  const commit = useCallback(() => {
    setDesignState((cur) => {
      if (cur !== committed.current) {
        past.current.push(committed.current);
        if (past.current.length > 200) past.current.shift();
        future.current = [];
        committed.current = cur;
        force((x) => x + 1);
      }
      return cur;
    });
  }, []);

  const setDesign = useCallback((d: Design | ((d: Design) => Design), opts?: { transient?: boolean }) => {
    setDesignState((cur) => (typeof d === 'function' ? (d as (d: Design) => Design)(cur) : d));
    if (!opts?.transient) setTimeout(commit, 0);
  }, [commit]);

  const updateLayer = useCallback((id: string, patch: Partial<Layer>, opts?: { transient?: boolean }) => {
    setDesign((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)) }), opts);
  }, [setDesign]);

  const undo = useCallback(() => {
    const prev = past.current.pop(); if (!prev) return;
    future.current.push(committed.current); committed.current = prev; setDesignState(prev); force((x) => x + 1);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop(); if (!next) return;
    past.current.push(committed.current); committed.current = next; setDesignState(next); force((x) => x + 1);
  }, []);

  const setPrint = useCallback((p: Partial<PrintSettings>) => setPrintState((cur) => ({ ...cur, ...p })), []);
  const setRows = useCallback((r: Record<string, string>[]) => setRowsState(r), []);

  const toast = useCallback((level: string, message: string, action?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-4), { id, level, message, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), level === 'error' ? 12000 : 7000);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  // persistence
  useEffect(() => { const h = setTimeout(() => { try { localStorage.setItem('pf3.design', JSON.stringify(design)); } catch { /* quota (large images) */ } }, 600); return () => clearTimeout(h); }, [design]);
  useEffect(() => { localStorage.setItem('pf3.print', JSON.stringify(print)); }, [print]);
  useEffect(() => { localStorage.setItem('pf3.rows', JSON.stringify(rows)); }, [rows]);

  // backend wiring
  useEffect(() => {
    pf3.printer.state().then(setConn);
    pf3.jobs.list().then(setJobs);
    const u1 = pf3.printer.onState(setConn);
    const u2 = pf3.jobs.onUpdate(setJobs);
    const u3 = pf3.onNotice((n) => toast(n.level, n.message, n.action));
    const u4 = pf3.jobs.onAttention((a) => toast('warning', a.message, 'resume'));
    return () => { u1(); u2(); u3(); u4(); };
  }, [toast]);

  const value = useMemo<Store>(() => ({
    design, setDesign, updateLayer, commit, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0,
    selected, select, print, setPrint, rows, setRows, conn, jobs, toasts, toast, dismiss, page, setPage,
  }), [design, setDesign, updateLayer, commit, undo, redo, selected, print, setPrint, rows, setRows, conn, jobs, toasts, toast, dismiss, page]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
