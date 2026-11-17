// Mensajes programados (server/programados.ts): un habitante deja un mensaje para más adelante («lo revisamos el lunes»)
// a su propia conversación o a una sala, y el juego lo entrega a esa hora, también tras reinicios. Aquí lo puro: leer
// la fecha que pide, aplazar los fines de semana a la mañana del siguiente día laborable y describirla en palabras
// (para que una fecha mal puesta salte a la vista). Todo en la hora local del Mac.
import { idioma } from './idioma.ts';
import { worktreeHasTask } from './tareas.ts';

/** A dónde va: a la propia conversación que lo programó (se retoma por su `claudeId`) o, como send_to_room, a una sala */
export type ScheduledTarget =
  | { tipo: 'conversacion'; salaId: string; sesionId?: string; claudeId?: string; cwd: string; titulo?: string }
  | { tipo: 'sala'; sala: string; clave?: string };

export interface ScheduledMessage {
  id: string;
  creado: number;
  cuando: number;          // cuándo se entrega (ya aplazado si caía en fin de semana)
  pedido: string;          // lo que pidió el habitante (ISO 8601)
  mensaje: string;
  // quién lo programó: su sala y su conversación (la del juego y la de Claude Code, que sobrevive a los reinicios)
  origen: { salaId: string; sesionId?: string; claudeId?: string };
  destino: ScheduledTarget;
}

export const SCHEDULE_HOUR = 9;                 // un día sin hora («el lunes») es a las 9:00
export const MAX_PER_CONVERSATION = 10;
export const MAX_DAYS = 60;
export const LATE_AFTER_MS = 5 * 60_000;       // entregado más tarde que esto (el juego estaba cerrado): «con retraso»

/** La fecha que pide el habitante: `YYYY-MM-DD` (a las 9:00) o `YYYY-MM-DDTHH:MM[:SS]` en hora local, o con zona
 *  (`Z`, `+01:00`). Nada de «el lunes»: eso lo traduce el habitante, que sabe qué día es hoy */
export function parseWhen(s: string): { ms: number; sinHora: boolean } | undefined {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?\s*$/i.exec(s);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, se, zona] = m;
  const n = (x?: string) => Number(x ?? 0);
  if (n(mo) < 1 || n(mo) > 12 || n(d) < 1 || n(d) > 31 || n(h) > 23 || n(mi) > 59 || n(se) > 59) return undefined;
  if (zona) { const ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${se ?? '00'}${/^[+-]\d{4}$/.test(zona) ? zona.slice(0, 3) + ':' + zona.slice(3) : zona.toUpperCase()}`); return Number.isFinite(ms) ? { ms, sinHora: false } : undefined; }
  const f = new Date(n(y), n(mo) - 1, n(d), h === undefined ? SCHEDULE_HOUR : n(h), n(mi), n(se));
  // el 31 de febrero no existe: Date lo pasaría a marzo
  if (f.getMonth() !== n(mo) - 1 || f.getDate() !== n(d)) return undefined;
  return { ms: f.getTime(), sinHora: h === undefined };
}

/** Sábado o domingo → el lunes siguiente a las 9:00; lo demás, tal cual */
export function holdWeekend(ms: number): number {
  const f = new Date(ms), dia = f.getDay();
  if (dia !== 0 && dia !== 6) return ms;
  return new Date(f.getFullYear(), f.getMonth(), f.getDate() + (dia === 6 ? 2 : 1), SCHEDULE_HOUR, 0, 0).getTime();
}

const locale = () => (idioma() === 'en' ? 'en-GB' : 'es-ES');
/** «lunes, 17 nov, 09:00» / «Monday 17 Nov, 09:00» */
export function describeWhen(ms: number): string {
  const f = new Date(ms);
  const dia = f.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'short' });
  return `${dia}, ${f.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}`;
}
/** Corto, para el intercomunicador y el buscador: «lun 09:00» (esta semana) o «lun 24 nov 09:00» */
export function describeWhenShort(ms: number, ahora = Date.now()): string {
  const f = new Date(ms), hora = f.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const cerca = ms - ahora < 6 * 86_400_000;
  return `${f.toLocaleDateString(locale(), cerca ? { weekday: 'short' } : { weekday: 'short', day: 'numeric', month: 'short' })} ${hora}`;
}

/** Los que se entregan ya, en orden */
export const due = (lista: ScheduledMessage[], ahora: number) => lista.filter(x => x.cuando <= ahora).sort((a, b) => a.cuando - b.cuando);
export const isLate = (x: ScheduledMessage, ahora: number) => ahora - x.cuando > LATE_AFTER_MS;

/** Los de una conversación (los que programó ella): por su id del juego o por el de Claude Code */
export const ofConversation = (lista: ScheduledMessage[], s: { id?: string; claudeId?: string }) =>
  lista.filter(x => (s.claudeId && x.origen.claudeId === s.claudeId) || (s.id && x.origen.sesionId === s.id)).sort((a, b) => a.cuando - b.cuando);

/** Where a pending message is shown when its conversation isn't open: its room and, inside one of the room's
 *  `worktrees`, that worktree's path. A conversation target goes where its cwd is (the worktree containing it, or the
 *  room's main copy); a room target with a key, to the worktree of that task if the room has one; else the main copy */
export function placeOf(x: ScheduledMessage, worktrees: { ruta: string; rama?: string; principal?: boolean }[]): { salaId: string; worktree?: string } {
  const ws = worktrees.filter(w => !w.principal), d = x.destino;
  if (d.tipo === 'sala') return { salaId: d.sala, worktree: d.clave ? ws.find(w => worktreeHasTask(w, d.clave!))?.ruta : undefined };
  const cwd = d.cwd.replace(/\/+$/, '');
  return { salaId: d.salaId, worktree: ws.find(w => { const r = w.ruta.replace(/\/+$/, ''); return cwd === r || cwd.startsWith(r + '/'); })?.ruta };
}
/** The ones shown on a room's dweller (`worktree` undefined) or on one of its worktrees' holograms, soonest first */
export const ofPlace = (lista: ScheduledMessage[], salaId: string, worktree: string | undefined, worktrees: { ruta: string; rama?: string; principal?: boolean }[]) =>
  lista.filter(x => { const p = placeOf(x, worktrees); return p.salaId === salaId && p.worktree === worktree; }).sort((a, b) => a.cuando - b.cuando);

/** The soonest pending message of each room and worktree, keyed `salaId|worktree` (`salaId|` for the room's main copy):
 *  the ⏰ on its dweller or hologram in the shelter */
export function soonestByPlace(lista: ScheduledMessage[], worktreesOf: (salaId: string) => { ruta: string; rama?: string; principal?: boolean }[]): Map<string, ScheduledMessage> {
  const out = new Map<string, ScheduledMessage>();
  for (const x of lista) {
    const p = placeOf(x, worktreesOf(x.destino.tipo === 'sala' ? x.destino.sala : x.destino.salaId)), k = `${p.salaId}|${p.worktree ?? ''}`;
    const ya = out.get(k); if (!ya || x.cuando < ya.cuando) out.set(k, x);
  }
  return out;
}

/** Comprueba una fecha pedida: la de entrega (con el fin de semana aplazado) o la clave del error (textos `tool.schedule.*`) */
export function checkWhen(pedido: string, ahora: number): { ok: true; cuando: number; aplazado: boolean } | { ok: false; error: 'badDate' | 'past' | 'tooFar' } {
  const p = parseWhen(pedido);
  if (!p) return { ok: false, error: 'badDate' };
  if (p.ms <= ahora - 60_000) return { ok: false, error: 'past' };
  const cuando = holdWeekend(Math.max(p.ms, ahora));
  if (cuando - ahora > MAX_DAYS * 86_400_000) return { ok: false, error: 'tooFar' };
  return { ok: true, cuando, aplazado: cuando !== Math.max(p.ms, ahora) };
}
