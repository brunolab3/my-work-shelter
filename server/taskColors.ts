// El color de cada tarea (shared/tasks.ts), guardado para que sea siempre el mismo: cada tarea nueva recibe el color de
// la paleta que menos se usa entre las vistas en las dos últimas semanas (las antiguas lo sueltan).
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { TASKS_PALETTE, assignColors, hasTaskColor } from '../shared/tasks.ts';

const VALIDITY = 14 * 86_400_000, MAX = 200;
// keys are stored uppercased; slugs take no color (hasTaskColor), so they don't use up the palette
const isKey = (k: string) => k === k.toUpperCase() && hasTaskColor(k);

export class TasksColors {
  private t: Record<string, { i: number; seen: number }> = {};
  private file: string;
  constructor(dir: string) {
    this.file = path.join(dir, 'task-colors.json');
    try { if (existsSync(this.file)) for (const [k, v] of Object.entries(JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, any>)) if (isKey(k) && Number.isInteger(v?.i) && v.i >= 0 && v.i < TASKS_PALETTE.length) this.t[k] = { i: v.i, seen: Number(v.seen) || 0 }; } catch {}
  }
  private save() { const tmp = this.file + '.tmp'; writeFileSync(tmp, JSON.stringify(this.t), { mode: 0o600 }); renameSync(tmp, this.file); }
  /** El color de cada clave (asignando las nuevas); `ahora` para las pruebas */
  colors(keys: unknown, now = Date.now()): Record<string, string> {
    const ks = [...new Set((Array.isArray(keys) ? keys : []).map(c => String(c).toUpperCase()).filter(isKey))].slice(0, 100);
    // las que no se ven hace dos semanas sueltan su color (si vuelven, se les da otro)
    for (const [k, v] of Object.entries(this.t)) if (now - v.seen > VALIDITY && !ks.includes(k)) delete this.t[k];
    const fresh = ks.filter(k => !(k in this.t));
    const assigned = assignColors(Object.fromEntries(Object.entries(this.t).map(([k, v]) => [k, v.i])), fresh);
    for (const k of fresh) this.t[k] = { i: assigned[k], seen: now };
    for (const k of ks) this.t[k].seen = now;
    const excess = Object.keys(this.t).length - MAX;
    if (excess > 0) for (const [k] of Object.entries(this.t).sort((a, b) => a[1].seen - b[1].seen).slice(0, excess)) delete this.t[k];
    if (ks.length) this.save();
    return Object.fromEntries(ks.map(k => [k, TASKS_PALETTE[this.t[k].i]]));
  }
  /** Jira tasks with their color, and their epic's: epics take their own from the same palette (first: they are few, and
   *  the list is capped at 100), so it stays the same and saved like a task's */
  paint<T extends { key: string; epic?: { key: string } }>(tareas: T[], now = Date.now()): (T & { color?: string })[] {
    const colors = this.colors([...tareas.flatMap(t => t.epic ? [t.epic.key] : []), ...tareas.map(t => t.key)], now);
    const color = (k: string) => colors[k.toUpperCase()];
    return tareas.map(t => ({ ...t, color: color(t.key), ...(t.epic ? { epic: { ...t.epic, color: color(t.epic.key) } } : {}) }));
  }
}
