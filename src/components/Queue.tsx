import React from 'react';
import { pf3 } from '../api';
import { useStore } from '../store';
import { Icon } from '../icons';

const STATE_DOT: Record<string, string> = { printing: 'ok', paused: 'warn', failed: 'bad', queued: '', done: 'ok', cancelled: '' };

export default function Queue({ onClose }: { onClose: () => void }) {
  const { jobs } = useStore();
  const active = jobs.filter((j) => ['printing', 'paused', 'queued'].includes(j.state));
  const finished = jobs.filter((j) => !['printing', 'paused', 'queued'].includes(j.state)).slice().reverse();
  const render = (j: typeof jobs[number]) => (
    <div key={j.id} className={`job ${j.state}`}>
      <div className="t"><span className={`dot ${STATE_DOT[j.state] ?? ''}`} /><span style={{ flex: 1 }}>{j.name}</span>
        {j.kind === 'discs' && <span className="tag">{j.discs} disc{j.discs === 1 ? '' : 's'}</span>}
      </div>
      <div className="m">{j.message}</div>
      {(j.state === 'printing' || j.state === 'paused') && <div className="progress"><div style={{ width: `${Math.round(j.progress * 100)}%` }} /></div>}
      {['printing', 'paused', 'queued'].includes(j.state) && (
        <div className="row" style={{ marginTop: 9 }}>
          {j.state === 'paused' && <button className="btn sm primary" onClick={() => pf3.jobs.resume()}><Icon.play />Resume</button>}
          <button className="btn sm ghost danger" onClick={() => pf3.jobs.cancel(j.id)}>Cancel</button>
        </div>
      )}
    </div>
  );
  return (
    <aside className="queue">
      <header><Icon.queue width={17} height={17} /><span style={{ flex: 1 }}>Print queue</span>
        <button className="btn sm ghost" title="Cancel everything and reset the printer (Print Queue Utility)" onClick={() => pf3.jobs.clearAll()}>Clear all</button>
        <button className="btn icon ghost sm" onClick={onClose}><Icon.x /></button>
      </header>
      <div className="list">
        {active.length === 0 && finished.length === 0 && <div className="empty">Nothing printing.<br />Jobs you send appear here.</div>}
        {active.map(render)}
        {finished.length > 0 && <div className="row" style={{ marginTop: 6 }}><span className="label" style={{ flex: 1 }}>Finished</span><button className="btn sm ghost" onClick={() => pf3.jobs.removeFinished()}>Clear</button></div>}
        {finished.slice(0, 30).map(render)}
      </div>
    </aside>
  );
}
