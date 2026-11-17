/**
 * IEEE-1284 device ID parsing + HP "S:" status field decoding (status revisions 0-4),
 * as used by HP VIP inkjets (DeskJet 5650 class, which the PF-3 engine reports as).
 */

export type PrinterState =
  | 'idle' | 'busy' | 'printing' | 'turning-off' | 'report-printing' | 'canceling' | 'io-stall'
  | 'dry-wait' | 'pen-change' | 'out-of-media' | 'media-jam' | 'carriage-stall' | 'media-stall'
  | 'pen-failure' | 'hard-error' | 'power-down' | 'self-test' | 'door-open' | 'out-of-ink'
  | 'cartridge-missing' | 'cartridge-wrong' | 'pen-cleaning' | 'pen-checking' | 'power-save'
  | 'offline' | 'unknown';

const STATE_BY_CODE: Record<number, PrinterState> = {
  0: 'idle', 1: 'busy', 2: 'printing', 3: 'turning-off', 4: 'report-printing', 5: 'canceling', 6: 'io-stall',
  7: 'dry-wait', 8: 'pen-change', 9: 'out-of-media', 14: 'media-jam', 15: 'carriage-stall', 16: 'media-stall',
  17: 'pen-failure', 18: 'hard-error', 19: 'power-down', 20: 'self-test', 26: 'out-of-ink',
  32: 'pen-failure', 44: 'pen-cleaning', 45: 'pen-checking', 46: 'power-save', 47: 'cartridge-wrong',
  48: 'cartridge-missing', 802: 'door-open', 803: 'offline',
};

export const STATE_TEXT: Record<PrinterState, string> = {
  'idle': 'Ready',
  'busy': 'Busy',
  'printing': 'Printing',
  'turning-off': 'Turning off',
  'report-printing': 'Printing internal page',
  'canceling': 'Cancelling job',
  'io-stall': 'Waiting for data',
  'dry-wait': 'Waiting for ink to dry',
  'pen-change': 'Cartridge change in progress',
  'out-of-media': 'No disc detected - load discs in the input hopper and press the Out of Media button',
  'media-jam': 'Disc jam - clear the disc path',
  'carriage-stall': 'Carriage stalled - check for obstructions',
  'media-stall': 'Problem advancing the disc',
  'pen-failure': 'Cartridge failure - reseat or replace the cartridge',
  'hard-error': 'Printer error - power cycle the printer',
  'power-down': 'Powering down',
  'self-test': 'Running self-test',
  'door-open': 'Printer door is open',
  'out-of-ink': 'Out of ink',
  'cartridge-missing': 'Cartridge missing or invalid',
  'cartridge-wrong': 'Wrong cartridge installed',
  'pen-cleaning': 'Cleaning cartridges',
  'pen-checking': 'Checking cartridges',
  'power-save': 'Power save',
  'offline': 'Offline',
  'unknown': 'Unknown state',
};

export type AgentType = 'black' | 'tri-color' | 'photo' | 'cyan' | 'magenta' | 'yellow' | 'none' | 'unknown';
export type AgentHealth = 'ok' | 'misinstalled' | 'incorrect' | 'failed' | 'unknown';

export interface Cartridge {
  index: number;
  type: AgentType;
  kind: 'head' | 'supply' | 'cartridge' | 'unknown';
  /** 0..100 (percent) when the printer reports it, else null */
  level: number | null;
  levelTrigger: number;
  health: AgentHealth;
  /** Microboards part number for this slot */
  part?: string;
}

export interface PrinterStatus {
  state: PrinterState;
  stateCode: number;
  text: string;
  revision: number | null;
  doorOpen: boolean;
  cartridges: Cartridge[];
  raw: string;
  fields: Record<string, string>;
}

/** Parse "KEY:value;KEY:value;" into a record (keys upper-cased, long names normalised). */
export function parseDeviceId(id: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of id.split(';')) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    let k = part.slice(0, i).trim().toUpperCase();
    const v = part.slice(i + 1).trim();
    if (k === 'MANUFACTURER') k = 'MFG';
    if (k === 'MODEL') k = 'MDL';
    if (k === 'COMMAND SET') k = 'CMD';
    out[k] = v;
  }
  return out;
}

const TYPE_8: Record<number, AgentType> = { 0: 'none', 1: 'black', 2: 'tri-color', 3: 'photo', 4: 'cyan', 5: 'magenta', 6: 'yellow' };
const TYPE_REV2: Record<number, AgentType> = { 0: 'none', 1: 'black', 2: 'cyan', 3: 'magenta', 4: 'yellow', 5: 'black', 6: 'cyan', 7: 'magenta', 8: 'yellow' };
const HEALTH: AgentHealth[] = ['ok', 'misinstalled', 'incorrect', 'failed'];
const NUM_PEN_POS: Record<number, number> = { 0: 16, 1: 16, 2: 16, 3: 18, 4: 22 };
const PEN_DATA_SIZE: Record<number, number> = { 0: 8, 1: 8, 2: 4, 3: 8, 4: 8 };
const STATUS_POS: Record<number, number> = { 0: 14, 1: 14, 2: 14, 3: 16, 4: 20 };

export function parseStatus(deviceId: string): PrinterStatus {
  const fields = parseDeviceId(deviceId);
  const s = fields['S'] ?? '';
  const res: PrinterStatus = { state: 'unknown', stateCode: -1, text: STATE_TEXT.unknown, revision: null, doorOpen: false, cartridges: [], raw: deviceId, fields };
  if (!/^[0-9a-fA-F]{16,}$/.test(s)) return res;
  const n = [...s].map((c) => parseInt(c, 16));
  const rev = n[1];
  if (!(rev in NUM_PEN_POS)) return res;
  res.revision = rev;
  res.doorOpen = !!(n[2] & 0x8) && !!(n[2] & 0x1);
  const sp = STATUS_POS[rev];
  let code = n[sp] << 4;
  if (code !== 48) code = (n[sp] << 4) + n[sp + 1];
  res.stateCode = code;
  res.state = STATE_BY_CODE[code] ?? 'unknown';
  if (res.doorOpen && res.state === 'idle') res.state = 'door-open';
  res.text = STATE_TEXT[res.state];

  const numPens = n[NUM_PEN_POS[rev]];
  const size = PEN_DATA_SIZE[rev];
  let c = NUM_PEN_POS[rev] + 1;
  for (let p = 0; p < numPens && c + size <= s.length; p++, c += size) {
    const info = parseInt(s.slice(c, c + size), 16);
    let cart: Cartridge;
    if (size === 4) {
      cart = {
        index: p,
        type: TYPE_REV2[(info & 0xf000) >> 12] ?? 'unknown',
        kind: p < numPens / 2 ? 'head' : 'supply',
        levelTrigger: (info & 0x0e00) >> 9,
        health: HEALTH[(info & 0x0180) >> 7] ?? 'unknown',
        level: info & 0x7f,
      };
    } else {
      const k = (info & 0x80000000 ? 1 : 0) + ((info & 0x40000000 ? 1 : 0) << 1);
      cart = {
        index: p,
        type: TYPE_8[(info & 0x3f000000) >>> 24] ?? 'unknown',
        kind: (['unknown', 'head', 'supply', 'cartridge'] as const)[k],
        levelTrigger: (info & 0x70000) >> 16,
        health: HEALTH[(info & 0xc000) >> 14] ?? 'unknown',
        level: info & 0xff,
      };
    }
    if (cart.level !== null && cart.level > 100) cart.level = null;
    if (cart.type === 'black') cart.part = 'V101B';
    if (cart.type === 'tri-color') cart.part = 'V102C';
    res.cartridges.push(cart);
  }
  return res;
}
