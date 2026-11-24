// A failed tool's full output, kept on disk (DATA/salidas/<session>/<entry>.txt) instead of in the log: the entry carries
// only its size and first line (`LogInput.output`), and the intercom reads the whole text when the Overseer opens it or
// copies it (action `salida.leer`). A session's outputs go when it leaves; all of them on start (sessions don't survive
// a restart, and a resumed transcript has no outputs).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ToolOutput } from '../shared/protocol.ts';

const ID = /^[\w-]{1,80}$/;
export const FIRST_LINE_MAX = 160;

/** What the log keeps of an output: its size in bytes and its first non-empty line, shortened */
export function outputSummary(text: string): ToolOutput {
  const first = text.split('\n').map(l => l.trim()).find(Boolean) ?? '';
  return { size: Buffer.byteLength(text), first: first.length > FIRST_LINE_MAX ? first.slice(0, FIRST_LINE_MAX - 1) + '…' : first };
}

export class ToolOutputs {
  constructor(private dir: string) {}
  private file(sessionId: string, entryId: string) {
    if (!ID.test(sessionId) || !ID.test(entryId)) throw new Error('bad output id');
    return path.join(this.dir, sessionId, entryId + '.txt');
  }
  save(sessionId: string, entryId: string, text: string): ToolOutput {
    const f = this.file(sessionId, entryId);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, text);
    return outputSummary(text);
  }
  read(sessionId: string, entryId: string): string | null {
    try { return readFileSync(this.file(sessionId, entryId), 'utf8'); } catch { return null; }
  }
  drop(sessionId: string) { if (ID.test(sessionId)) rmSync(path.join(this.dir, sessionId), { recursive: true, force: true }); }
  clear() { rmSync(this.dir, { recursive: true, force: true }); }
}
