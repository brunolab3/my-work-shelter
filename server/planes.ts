// Planes compartidos: el plan que se acuerda en la sala de planificación viaja con cada parte que se reparte. Se guarda
// aquí (con su versión y lo que ha cambiado en cada una) para que cada sala lo lea cuando quiera y, si se actualiza,
// todas se enteren: las partes leen el plan y proponen cambios; solo la sala de planificación lo cambia.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { TaskOrder } from '../shared/despliegue.ts';
import { t } from '../shared/idioma.ts';

// esperaA: las salas (id) cuya parte tiene que fusionarse antes que esta (el tablero de despliegue lo hace bloqueos)
export interface PartOfPlan { salaId: string; sala: string; titulo: string; sesionId?: string; waitA?: string[] }
export interface ChangeOfPlan { version: number; fecha: number; cambios: string }
export interface Plan {
  id: string; clave?: string;
  coordinacion: string; coordinationSession?: string;   // la sala de planificación y su conversación (a quien van las propuestas)
  texto: string; version: number; creado: number; actualizado: number;
  partes: PartOfPlan[]; historial: ChangeOfPlan[];
}

const MAX_PLANS = 60, MAX_TEXT = 60_000;

export class Plans {
  private planes: Plan[] = [];
  private archivo: string;
  constructor(dir: string) {
    this.archivo = path.join(dir, 'planes.json');
    try { if (existsSync(this.archivo)) this.planes = (JSON.parse(readFileSync(this.archivo, 'utf8')) as Plan[]).filter(p => p && typeof p.id === 'string' && typeof p.texto === 'string'); } catch { this.planes = []; }
  }
  guardar() { const tmp = this.archivo + '.tmp'; writeFileSync(tmp, JSON.stringify(this.planes, null, 1), { mode: 0o600 }); renameSync(tmp, this.archivo); }

  todos() { return this.planes; }
  get(id: string) { return this.planes.find(p => p.id === id || (!!p.clave && p.clave === id)); }
  /** Los planes en los que trabaja una sala (como parte o como planificación), del más reciente al más antiguo */
  ofRoom(salaId: string) { return this.planes.filter(p => p.coordinacion === salaId || p.partes.some(x => x.salaId === salaId)).sort((a, b) => b.actualizado - a.actualizado); }

  /** Al repartir: un plan nuevo o, si la tarea ya tenía uno, la versión siguiente con las partes nuevas sumadas */
  repartir(o: { clave?: string; coordinacion: string; coordinationSession?: string; texto: string; partes: PartOfPlan[] }): Plan {
    const ahora = Date.now(), texto = o.texto.trim().slice(0, MAX_TEXT);
    const ya = o.clave ? this.planes.find(p => p.clave === o.clave) : undefined;
    let plan: Plan;
    if (ya) {
      const cambio = ya.texto !== texto;
      ya.texto = texto; ya.coordinacion = o.coordinacion; ya.coordinationSession = o.coordinationSession ?? ya.coordinationSession; ya.actualizado = ahora;
      for (const p of o.partes) { const i = ya.partes.findIndex(x => x.salaId === p.salaId); if (i >= 0) ya.partes[i] = p; else ya.partes.push(p); }
      if (cambio) { ya.version++; ya.historial.push({ version: ya.version, fecha: ahora, cambios: t('tool.plan.reassigned') }); }
      plan = ya;
    } else {
      plan = { id: o.clave ?? 'plan-' + ahora.toString(36), clave: o.clave, coordinacion: o.coordinacion, coordinationSession: o.coordinationSession, texto, version: 1, creado: ahora, actualizado: ahora, partes: o.partes, historial: [{ version: 1, fecha: ahora, cambios: t('tool.plan.assigned') }] };
      this.planes.push(plan);
      if (this.planes.length > MAX_PLANS) this.planes.sort((a, b) => b.actualizado - a.actualizado).splice(MAX_PLANS);
    }
    this.guardar();
    return plan;
  }

  /** Una versión nueva del plan; devuelve null si no existe */
  actualizar(id: string, texto: string, cambios: string): Plan | null {
    const p = this.get(id); if (!p) return null;
    p.texto = texto.trim().slice(0, MAX_TEXT); p.version++; p.actualizado = Date.now();
    p.historial.push({ version: p.version, fecha: p.actualizado, cambios: cambios.trim().slice(0, 2000) || t('tool.plan.noSummary') });
    this.guardar();
    return p;
  }
}

const waitOf = (p: Plan, x: PartOfPlan) => {
  const n = (x.waitA ?? []).map(id => p.partes.find(y => y.salaId === id)?.sala ?? id);
  return n.length ? t('tool.plan.mergesAfter', { salas: n.join(', ') }) : '';
};

/** Cómo lo lee una sala: la versión, el plan entero, quién hace cada parte y lo que ha cambiado */
export function textPlan(p: Plan, salaId?: string): string {
  return [
    t('tool.plan.heading', { id: p.id, tarea: p.clave ? t('tool.plan.task', { clave: p.clave }) : '', version: p.version }),
    '',
    t('tool.plan.parts'),
    ...p.partes.map(x => `- ${x.sala}: ${x.titulo}${waitOf(p, x)}${x.salaId === salaId ? t('tool.plan.yours') : ''}`),
    '',
    t('tool.plan.changes'),
    ...p.historial.slice(-8).map(h => `- v${h.version}: ${h.cambios}`),
    '',
    '---',
    p.texto,
  ].join('\n');
}

/** El orden de fusión de cada tarea repartida, por repo de GitHub («org/repo»), para el tablero de despliegue: las partes
 *  que esperan a otras (las salas sin repo de GitHub no cuentan) */
export async function tasksOrder(planes: Plan[], repoOf: (salaId: string) => Promise<string | undefined>): Promise<TaskOrder[]> {
  const out: TaskOrder[] = [];
  for (const p of planes) {
    if (!p.clave) continue;
    for (const x of p.partes) {
      if (!x.waitA?.length) continue;
      const repo = await repoOf(x.salaId);
      const waitA = (await Promise.all(x.waitA.map(repoOf))).filter((r): r is string => !!r && r !== repo);
      if (repo && waitA.length) out.push({ clave: p.clave.toUpperCase(), repo, waitA });
    }
  }
  return out;
}
