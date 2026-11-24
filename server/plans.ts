// Planes compartidos: el plan que se acuerda en la sala de planificación viaja con cada parte que se reparte. Se guarda
// aquí (con su versión y lo que ha cambiado en cada una) para que cada sala lo lea cuando quiera y, si se actualiza,
// todas se enteren: las partes leen el plan y proponen cambios; solo la sala de planificación lo cambia.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { TaskOrder } from '../shared/deploy.ts';
import { t } from '../shared/language.ts';

// waitsOn: las salas (id) cuya parte tiene que fusionarse antes que esta (el tablero de despliegue lo hace bloqueos)
export interface PartOfPlan { roomId: string; room: string; title: string; sessionId?: string; waitA?: string[] }
export interface ChangeOfPlan { version: number; date: number; changes: string }
export interface Plan {
  id: string; key?: string;
  coordination: string; coordinationSession?: string;   // la sala de planificación y su conversación (a quien van las propuestas)
  text: string; version: number; created: number; updated: number;
  parts: PartOfPlan[]; history: ChangeOfPlan[];
}

const MAX_PLANS = 60, MAX_TEXT = 60_000;

export class Plans {
  private plans: Plan[] = [];
  private file: string;
  constructor(dir: string) {
    this.file = path.join(dir, 'planes.json');
    try { if (existsSync(this.file)) this.plans = (JSON.parse(readFileSync(this.file, 'utf8')) as Plan[]).filter(p => p && typeof p.id === 'string' && typeof p.text === 'string'); } catch { this.plans = []; }
  }
  save() { const tmp = this.file + '.tmp'; writeFileSync(tmp, JSON.stringify(this.plans, null, 1), { mode: 0o600 }); renameSync(tmp, this.file); }

  all() { return this.plans; }
  get(id: string) { return this.plans.find(p => p.id === id || (!!p.key && p.key === id)); }
  /** Los planes en los que trabaja una sala (como parte o como planificación), del más reciente al más antiguo */
  ofRoom(roomId: string) { return this.plans.filter(p => p.coordination === roomId || p.parts.some(x => x.roomId === roomId)).sort((a, b) => b.updated - a.updated); }

  /** Al repartir: un plan nuevo o, si la tarea ya tenía uno, la versión siguiente con las partes nuevas sumadas */
  dispatch(o: { key?: string; coordination: string; coordinationSession?: string; text: string; parts: PartOfPlan[] }): Plan {
    const now = Date.now(), text = o.text.trim().slice(0, MAX_TEXT);
    const already = o.key ? this.plans.find(p => p.key === o.key) : undefined;
    let plan: Plan;
    if (already) {
      const changed = already.text !== text;
      already.text = text; already.coordination = o.coordination; already.coordinationSession = o.coordinationSession ?? already.coordinationSession; already.updated = now;
      for (const p of o.parts) { const i = already.parts.findIndex(x => x.roomId === p.roomId); if (i >= 0) already.parts[i] = p; else already.parts.push(p); }
      if (changed) { already.version++; already.history.push({ version: already.version, date: now, changes: t('tool.plan.reassigned') }); }
      plan = already;
    } else {
      plan = { id: o.key ?? 'plan-' + now.toString(36), key: o.key, coordination: o.coordination, coordinationSession: o.coordinationSession, text, version: 1, created: now, updated: now, parts: o.parts, history: [{ version: 1, date: now, changes: t('tool.plan.assigned') }] };
      this.plans.push(plan);
      if (this.plans.length > MAX_PLANS) this.plans.sort((a, b) => b.updated - a.updated).splice(MAX_PLANS);
    }
    this.save();
    return plan;
  }

  /** Una versión nueva del plan; devuelve null si no existe */
  update(id: string, text: string, changes: string): Plan | null {
    const p = this.get(id); if (!p) return null;
    p.text = text.trim().slice(0, MAX_TEXT); p.version++; p.updated = Date.now();
    p.history.push({ version: p.version, date: p.updated, changes: changes.trim().slice(0, 2000) || t('tool.plan.noSummary') });
    this.save();
    return p;
  }
}

const waitOf = (p: Plan, x: PartOfPlan) => {
  const n = (x.waitA ?? []).map(id => p.parts.find(y => y.roomId === id)?.room ?? id);
  return n.length ? t('tool.plan.mergesAfter', { rooms: n.join(', ') }) : '';
};

/** Cómo lo lee una sala: la versión, el plan entero, quién hace cada parte y lo que ha cambiado */
export function textPlan(p: Plan, roomId?: string): string {
  return [
    t('tool.plan.heading', { id: p.id, task: p.key ? t('tool.plan.task', { key: p.key }) : '', version: p.version }),
    '',
    t('tool.plan.parts'),
    ...p.parts.map(x => `- ${x.room}: ${x.title}${waitOf(p, x)}${x.roomId === roomId ? t('tool.plan.yours') : ''}`),
    '',
    t('tool.plan.changes'),
    ...p.history.slice(-8).map(h => `- v${h.version}: ${h.changes}`),
    '',
    '---',
    p.text,
  ].join('\n');
}

/** El orden de fusión de cada tarea repartida, por repo de GitHub («org/repo»), para el tablero de despliegue: las partes
 *  que esperan a otras (las salas sin repo de GitHub no cuentan) */
export async function tasksOrder(plans: Plan[], repoOf: (roomId: string) => Promise<string | undefined>): Promise<TaskOrder[]> {
  const out: TaskOrder[] = [];
  for (const p of plans) {
    if (!p.key) continue;
    for (const x of p.parts) {
      if (!x.waitA?.length) continue;
      const repo = await repoOf(x.roomId);
      const waitA = (await Promise.all(x.waitA.map(repoOf))).filter((r): r is string => !!r && r !== repo);
      if (repo && waitA.length) out.push({ key: p.key.toUpperCase(), repo, waitA });
    }
  }
  return out;
}
