/**
 * Firmware ("underware") console helpers. Read-only by default: a command line is only
 * sent without the write switch if every statement is a known read/query form.
 */
import { PrinterService } from './printerService';

const READ_ONLY = [
  /^ds2\.get\s+\d+$/i,
  /^fm\.query_stack$/i,
  /^[a-z0-9_]+\.(help|list\w*|dump\w*|query\w*|status|info|version|show\w*|get\w*)(\s+[\w.-]+)*$/i,
  /^(help|\?)$/i,
];
const DANGEROUS = /(set|flow|push|pop|button|write|erase|reset|power|print|clear|store|program|flash|format|delete|init|exec|keyword|sweep|cal)/i;

export function isReadOnly(line: string): boolean {
  const stmts = line.split(';').map((s) => s.trim()).filter(Boolean);
  if (!stmts.length) return false;
  return stmts.every((s) => READ_ONLY.some((r) => r.test(s)) && !(DANGEROUS.test(s.split(/\s+/)[0].split('.')[1] ?? '') && !/^get|^query|^help|^list|^dump/i.test(s.split(/\s+/)[0].split('.')[1] ?? '')));
}

export interface Ds2Entry { id: number; value: string }

/** Split a multi-query reply into lines (the printer answers one line per query). */
function replyLines(reply: string): string[] {
  return reply.split(/\r?\n|\r/).map((l) => l.trim()).filter(Boolean);
}

export async function scanDs2(printer: PrinterService, from: number, to: number, onProgress: (done: number, total: number, found: number) => void, signal: { cancelled: boolean }): Promise<Ds2Entry[]> {
  const out: Ds2Entry[] = [];
  const total = to - from + 1;
  const BATCH = 16;
  for (let id = from; id <= to; id += BATCH) {
    if (signal.cancelled) break;
    const ids = Array.from({ length: Math.min(BATCH, to - id + 1) }, (_, i) => id + i);
    const reply = await printer.udwQuery(ids.map((i) => `ds2.get ${i};`).join(''), 3000);
    const lines = replyLines(reply);
    if (lines.length === ids.length) {
      ids.forEach((i, k) => out.push({ id: i, value: lines[k] }));
    } else {
      // replies didn't line up one-per-query: fall back to single queries for this batch
      for (const i of ids) {
        if (signal.cancelled) break;
        const r = await printer.udwQuery(`ds2.get ${i};`, 1500);
        if (r) out.push({ id: i, value: replyLines(r).join(' | ') });
      }
    }
    onProgress(Math.min(total, id - from + BATCH), total, out.length);
  }
  return out;
}
