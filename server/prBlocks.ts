// Bloqueos entre PR que marca a mano el Supervisor en el tablero de despliegue de la sala de planificación («este espera
// a aquel»), para lo que GitHub no sabe (un front que espera a una migración de otro repo). Los demás bloqueos (PR
// apilados, «depends on #12» en la descripción) salen solos: shared/despliegue.ts.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { BlockerManual } from '../shared/despliegue.ts';
import { t } from '../shared/idioma.ts';

const MAX = 400;
// la URL de un PR en GitHub (los de DEMO son github.com/pulls#demo-N)
const isPR = (u: unknown): u is string => typeof u === 'string' && u.length < 300 && /^https:\/\/github\.com\/\S+$/.test(u);

export class BlockersPR {
  private lista: BlockerManual[] = [];
  private archivo: string;
  constructor(dir: string) {
    this.archivo = path.join(dir, 'bloqueos-pr.json');
    try { if (existsSync(this.archivo)) this.lista = (JSON.parse(readFileSync(this.archivo, 'utf8')) as BlockerManual[]).filter(b => isPR(b?.de) && isPR(b?.por)); } catch { this.lista = []; }
  }
  private guardar() { const tmp = this.archivo + '.tmp'; writeFileSync(tmp, JSON.stringify(this.lista), { mode: 0o600 }); renameSync(tmp, this.archivo); }
  todos() { return this.lista; }
  /** `de` espera a `por` (o deja de esperarlo, con quitar) */
  marcar(de: unknown, por: unknown, quitar = false) {
    if (!isPR(de) || !isPR(por) || de === por) throw new Error(t('server.thoseAreNotTwoDifferent'));
    this.lista = this.lista.filter(b => !(b.de === de && b.por === por));
    if (!quitar) { this.lista.push({ de, por }); if (this.lista.length > MAX) this.lista.splice(0, this.lista.length - MAX); }
    this.guardar();
    return this.lista;
  }
}
