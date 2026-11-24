// Bloqueos entre PR que marca a mano el Supervisor en el tablero de despliegue de la sala de planificación («este espera
// a aquel»), para lo que GitHub no sabe (un front que espera a una migración de otro repo). Los demás bloqueos (PR
// apilados, «depends on #12» en la descripción) salen solos: shared/deploy.ts.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { BlockerManual } from '../shared/deploy.ts';
import { t } from '../shared/language.ts';

const MAX = 400;
// la URL de un PR en GitHub (los de DEMO son github.com/pulls#demo-N)
const isPR = (u: unknown): u is string => typeof u === 'string' && u.length < 300 && /^https:\/\/github\.com\/\S+$/.test(u);

export class BlockersPR {
  private list: BlockerManual[] = [];
  private file: string;
  constructor(dir: string) {
    this.file = path.join(dir, 'pr-blocks.json');
    try { if (existsSync(this.file)) this.list = (JSON.parse(readFileSync(this.file, 'utf8')) as BlockerManual[]).filter(b => isPR(b?.from) && isPR(b?.by)); } catch { this.list = []; }
  }
  private save() { const tmp = this.file + '.tmp'; writeFileSync(tmp, JSON.stringify(this.list), { mode: 0o600 }); renameSync(tmp, this.file); }
  all() { return this.list; }
  /** `de` espera a `por` (o deja de esperarlo, con quitar) */
  mark(from: unknown, by: unknown, remove = false) {
    if (!isPR(from) || !isPR(by) || from === by) throw new Error(t('server.thoseAreNotTwoDifferent'));
    this.list = this.list.filter(b => !(b.from === from && b.by === by));
    if (!remove) { this.list.push({ from, by }); if (this.list.length > MAX) this.list.splice(0, this.list.length - MAX); }
    this.save();
    return this.list;
  }
}
