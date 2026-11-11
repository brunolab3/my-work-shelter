// El color de cada tarea (shared/tareas.ts), guardado para que sea siempre el mismo: cada tarea nueva recibe el color de
// la paleta que menos se usa entre las vistas en las dos últimas semanas (las antiguas lo sueltan).
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { TASKS_PALETTE, assignColors } from '../shared/tareas.ts';

const VALIDITY = 14 * 86_400_000, MAX = 200;
const CLAVE = /^[A-Z][A-Z0-9]{0,15}-\d{1,9}$/;

export class TasksColors {
  private t: Record<string, { i: number; visto: number }> = {};
  private archivo: string;
  constructor(dir: string) {
    this.archivo = path.join(dir, 'colores-tareas.json');
    try { if (existsSync(this.archivo)) for (const [k, v] of Object.entries(JSON.parse(readFileSync(this.archivo, 'utf8')) as Record<string, any>)) if (CLAVE.test(k) && Number.isInteger(v?.i) && v.i >= 0 && v.i < TASKS_PALETTE.length) this.t[k] = { i: v.i, visto: Number(v.visto) || 0 }; } catch {}
  }
  private guardar() { const tmp = this.archivo + '.tmp'; writeFileSync(tmp, JSON.stringify(this.t), { mode: 0o600 }); renameSync(tmp, this.archivo); }
  /** El color de cada clave (asignando las nuevas); `ahora` para las pruebas */
  colores(claves: unknown, ahora = Date.now()): Record<string, string> {
    const ks = [...new Set((Array.isArray(claves) ? claves : []).map(c => String(c).toUpperCase()).filter(c => CLAVE.test(c)))].slice(0, 100);
    // las que no se ven hace dos semanas sueltan su color (si vuelven, se les da otro)
    for (const [k, v] of Object.entries(this.t)) if (ahora - v.visto > VALIDITY && !ks.includes(k)) delete this.t[k];
    const nuevas = ks.filter(k => !(k in this.t));
    const asig = assignColors(Object.fromEntries(Object.entries(this.t).map(([k, v]) => [k, v.i])), nuevas);
    for (const k of nuevas) this.t[k] = { i: asig[k], visto: ahora };
    for (const k of ks) this.t[k].visto = ahora;
    const sobran = Object.keys(this.t).length - MAX;
    if (sobran > 0) for (const [k] of Object.entries(this.t).sort((a, b) => a[1].visto - b[1].visto).slice(0, sobran)) delete this.t[k];
    if (ks.length) this.guardar();
    return Object.fromEntries(ks.map(k => [k, TASKS_PALETTE[this.t[k].i]]));
  }
}
