import { contextBridge, ipcRenderer } from 'electron';

const on = (ch: string) => (cb: (v: any) => void) => {
  const h = (_e: unknown, v: any) => cb(v);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('pf3', {
  printer: {
    state: () => ipcRenderer.invoke('printer:state'),
    refresh: () => ipcRenderer.invoke('printer:refresh'),
    rawDeviceId: () => ipcRenderer.invoke('printer:rawDeviceId'),
    devices: () => ipcRenderer.invoke('printer:devices'),
    softReset: () => ipcRenderer.invoke('printer:softReset'),
    onState: on('printer:state'),
  },
  jobs: {
    list: () => ipcRenderer.invoke('jobs:list'),
    print: (req: unknown) => ipcRenderer.invoke('jobs:print', req),
    maintenance: (action: unknown, name: string) => ipcRenderer.invoke('jobs:maintenance', action, name),
    cancel: (id: string) => ipcRenderer.invoke('jobs:cancel', id),
    resume: () => ipcRenderer.invoke('jobs:resume'),
    clearAll: () => ipcRenderer.invoke('jobs:clearAll'),
    removeFinished: () => ipcRenderer.invoke('jobs:removeFinished'),
    onUpdate: on('jobs:update'),
    onAttention: on('jobs:attention'),
  },
  fw: {
    query: (cmd: string, allowWrite = false) => ipcRenderer.invoke('fw:query', { cmd, allowWrite }),
    scan: (from: number, to: number) => ipcRenderer.invoke('fw:scan', { from, to }),
    scanStop: () => ipcRenderer.invoke('fw:scanStop'),
    onScanProgress: on('fw:scanProgress'),
  },
  pen: { labelToValue: (l: number[]) => ipcRenderer.invoke('pen:labelToValue', l) },
  stats: {
    get: () => ipcRenderer.invoke('stats:get'),
    setPricing: (p: unknown) => ipcRenderer.invoke('stats:setPricing', p),
    reset: () => ipcRenderer.invoke('stats:reset'),
  },
  settings: { get: () => ipcRenderer.invoke('settings:get'), set: (s: unknown) => ipcRenderer.invoke('settings:set', s) },
  vendor: { status: () => ipcRenderer.invoke('vendor:status'), import: () => ipcRenderer.invoke('vendor:import') },
  file: {
    save: (name: string, data: string | ArrayBuffer, filters: unknown) => ipcRenderer.invoke('file:save', { name, data, filters }),
    open: (filters: unknown, binary = false) => ipcRenderer.invoke('file:open', { filters, binary }),
  },
  openExternal: (url: string) => ipcRenderer.invoke('shell:open', url),
  onNotice: on('notice'),
  api: {
    onRender: on('api:render'),
    rendered: (r: unknown) => ipcRenderer.send('api:rendered', r),
  },
});
