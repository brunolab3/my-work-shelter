// Mensajes programados (server/scheduled.ts): un habitante deja un mensaje para más adelante («lo revisamos el lunes»)
// a su propia conversación o a una sala, y el juego lo entrega a esa hora, también tras reinicios. Aquí lo puro: leer
// la fecha que pide, aplazar los fines de semana a la mañana del siguiente día laborable y describirla en palabras
// (para que una fecha mal puesta salte a la vista). Todo en la hora local del Mac.
import { language } from './language.ts';
import { worktreeHasTask } from './tasks.ts';

/** A dónde va: a la propia conversación que lo programó (se retoma por su `claudeId`) o, como send_to_room, a una sala */
export type ScheduledTarget =
  | { type: 'conversacion'; roomId: string; sessionId?: string; claudeId?: string; cwd: string; title?: string }
  | { type: 'sala'; room: string; key?: string; thread?: string };

export interface ScheduledMessage {
  id: string;
  created: number;
  when: number;          // cuándo se entrega (ya aplazado si caía en fin de semana)
  requested: string;          // lo que pidió el habitante (ISO 8601)
  message: string;
  // quién lo programó: su sala y su conversación (la del juego y la de Claude Code, que sobrevive a los reinicios)
  origin: { roomId: string; sessionId?: string; claudeId?: string };
  target: ScheduledTarget;
  // a send_to_room over its per-minute limit (server/roomNotices.ts): delivered verbatim, as if sent then
  overLimit?: true;
  // not urgent: waits for the day's final 5-hour usage window (below); `when` is when it starts
  nextWindow?: true;
  overseer?: true;       // written by the Overseer (the intercom's ⌥Enter), not by a dweller
}

export const SCHEDULE_HOUR = 9;                 // un día sin hora («el lunes») es a las 9:00
export const MAX_PER_CONVERSATION = 10;
export const MAX_DAYS = 60;
export const LATE_AFTER_MS = 5 * 60_000;       // entregado más tarde que esto (el juego estaba cerrado): «con retraso»

/** La fecha que pide el habitante: `YYYY-MM-DD` (a las 9:00) o `YYYY-MM-DDTHH:MM[:SS]` en hora local, o con zona
 *  (`Z`, `+01:00`). Nada de «el lunes»: eso lo traduce el habitante, que sabe qué día es hoy */
export function parseWhen(s: string): { ms: number; noTime: boolean } | undefined {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?\s*$/i.exec(s);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, sec, zone] = m;
  const n = (x?: string) => Number(x ?? 0);
  if (n(mo) < 1 || n(mo) > 12 || n(d) < 1 || n(d) > 31 || n(h) > 23 || n(mi) > 59 || n(sec) > 59) return undefined;
  if (zone) { const ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${sec ?? '00'}${/^[+-]\d{4}$/.test(zone) ? zone.slice(0, 3) + ':' + zone.slice(3) : zone.toUpperCase()}`); return Number.isFinite(ms) ? { ms, noTime: false } : undefined; }
  const f = new Date(n(y), n(mo) - 1, n(d), h === undefined ? SCHEDULE_HOUR : n(h), n(mi), n(sec));
  // el 31 de febrero no existe: Date lo pasaría a marzo
  if (f.getMonth() !== n(mo) - 1 || f.getDate() !== n(d)) return undefined;
  return { ms: f.getTime(), noTime: h === undefined };
}

/** Sábado o domingo → el lunes siguiente a las 9:00; lo demás, tal cual */
export function holdWeekend(ms: number): number {
  const f = new Date(ms), day = f.getDay();
  if (day !== 0 && day !== 6) return ms;
  return new Date(f.getFullYear(), f.getMonth(), f.getDate() + (day === 6 ? 2 : 1), SCHEDULE_HOUR, 0, 0).getTime();
}

const locale = () => (language() === 'en' ? 'en-GB' : 'es-ES');
/** «lunes, 17 nov, 09:00» / «Monday 17 Nov, 09:00» */
export function describeWhen(ms: number): string {
  const f = new Date(ms);
  const day = f.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'short' });
  return `${day}, ${f.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}`;
}
/** Corto, para el intercomunicador y el buscador: «lun 09:00» (esta semana) o «lun 24 nov 09:00» */
export function describeWhenShort(ms: number, now = Date.now()): string {
  const f = new Date(ms), time = f.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const near = ms - now < 6 * 86_400_000;
  return `${f.toLocaleDateString(locale(), near ? { weekday: 'short' } : { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

/** Los que se entregan ya, en orden */
export const due = (list: ScheduledMessage[], now: number) => list.filter(x => !x.nextWindow && x.when <= now).sort((a, b) => a.when - b.when);
export const isLate = (x: ScheduledMessage, now: number) => now - x.when > LATE_AFTER_MS;

/** Los de una conversación (los que programó ella): por su id del juego o por el de Claude Code */
export const ofConversation = (list: ScheduledMessage[], s: { id?: string; claudeId?: string }) =>
  list.filter(x => (s.claudeId && x.origin.claudeId === s.claudeId) || (s.id && x.origin.sessionId === s.id)).sort((a, b) => a.when - b.when);

/** Where a pending message is shown when its conversation isn't open: its room and, inside one of the room's
 *  `worktrees`, that worktree's path. A conversation target goes where its cwd is (the worktree containing it, or the
 *  room's main copy); a room target with a key, to the worktree of that task if the room has one; else the main copy */
export function placeOf(x: ScheduledMessage, worktrees: { path: string; branch?: string; main?: boolean }[]): { roomId: string; worktree?: string } {
  const ws = worktrees.filter(w => !w.main), d = x.target;
  if (d.type === 'sala') return { roomId: d.room, worktree: d.key ? ws.find(w => worktreeHasTask(w, d.key!))?.path : undefined };
  const cwd = d.cwd.replace(/\/+$/, '');
  return { roomId: d.roomId, worktree: ws.find(w => { const r = w.path.replace(/\/+$/, ''); return cwd === r || cwd.startsWith(r + '/'); })?.path };
}
/** The ones shown on a room's dweller (`worktree` undefined) or on one of its worktrees' holograms, soonest first */
export const ofPlace = (list: ScheduledMessage[], roomId: string, worktree: string | undefined, worktrees: { path: string; branch?: string; main?: boolean }[]) =>
  list.filter(x => { const p = placeOf(x, worktrees); return p.roomId === roomId && p.worktree === worktree; }).sort((a, b) => a.when - b.when);

/** The soonest pending message of each room and worktree, keyed `salaId|worktree` (`salaId|` for the room's main copy):
 *  the ⏰ on its dweller or hologram in the shelter */
export function soonestByPlace(list: ScheduledMessage[], worktreesOf: (roomId: string) => { path: string; branch?: string; main?: boolean }[]): Map<string, ScheduledMessage> {
  const out = new Map<string, ScheduledMessage>();
  for (const x of list) {
    const p = placeOf(x, worktreesOf(x.target.type === 'sala' ? x.target.room : x.target.roomId)), k = `${p.roomId}|${p.worktree ?? ''}`;
    const already = out.get(k); if (!already || x.when < already.when) out.set(k, x);
  }
  return out;
}

/** Comprueba una fecha pedida: la de entrega (con el fin de semana aplazado) o la clave del error (textos `tool.schedule.*`) */
export function checkWhen(requested: string, now: number): { ok: true; when: number; postponed: boolean } | { ok: false; error: 'badDate' | 'past' | 'tooFar' } {
  const p = parseWhen(requested);
  if (!p) return { ok: false, error: 'badDate' };
  if (p.ms <= now - 60_000) return { ok: false, error: 'past' };
  const when = holdWeekend(Math.max(p.ms, now));
  if (when - now > MAX_DAYS * 86_400_000) return { ok: false, error: 'tooFar' };
  return { ok: true, when, postponed: when !== Math.max(p.ms, now) };
}

/** «2026-11-17T09:00» in local time (what checkWhen reads, and <input type="datetime-local">) */
export const localInput = (ms: number) => { const f = new Date(ms), d = (n: number) => String(n).padStart(2, '0'); return `${f.getFullYear()}-${d(f.getMonth() + 1)}-${d(f.getDate())}T${d(f.getHours())}:${d(f.getMinutes())}`; };

/** The one-click times of the intercom's ⏰ Schedule: in 1 h and in 3 h (to the minute), the next working day at 09:00
 *  and next Monday at 09:00 (left out when it is that same day, as on a Friday), soonest first */
export function schedulePresets(now: number): { key: 'in1h' | 'in3h' | 'tomorrow' | 'monday'; when: number }[] {
  const minute = Math.ceil(now / 60_000) * 60_000, d = new Date(now);
  const at9 = (days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, SCHEDULE_HOUR, 0, 0).getTime();
  const tomorrow = holdWeekend(at9(1)), monday = at9(((8 - d.getDay()) % 7) || 7);
  return [{ key: 'in1h' as const, when: minute + 3_600_000 }, { key: 'in3h' as const, when: minute + 3 * 3_600_000 },
    { key: 'tomorrow' as const, when: tomorrow }, ...(monday !== tomorrow ? [{ key: 'monday' as const, when: monday }] : [])];
}

// ---------------------------------------------------------------- the next 5-hour window
// "Not urgent" messages wait for the plan's final 5-hour usage window of the day instead of spending the working day's:
// they go out when it starts (or when a limit that stops everything lifts), one at a time and a few minutes apart. What the
// game knows of the window comes from the sessions' rate-limit reports (server/main.ts); with none known, now is free.

export const NEXT_WINDOW = 'next-window';               // schedule_message's `when` for it
export const WINDOW_GAP_MS = 5 * 60_000;                // never two closer than this
/** The plan's usage as last reported: when the running 5-hour window ends and, at a limit, until when nothing goes */
export interface UsageWindow { endsAt?: number; blockedUntil?: number }

/** When the window that frees up next starts: the end of the window running now, after any limit; now if none */
export const nextWindowStart = (now: number, u: UsageWindow) => Math.max(now, u.endsAt ?? 0, u.blockedUntil ?? 0);
export const WINDOW_MS = 5 * 3_600_000;
/** When a next-window message becomes due: the start of the day's final 5-hour window, so background work doesn't
 *  spend the windows of the working day. Windows chain from the end of the running one (every 5 h while in use): the
 *  latest of those starts still today. With no window known, the one that ends at midnight (19:00); past that, or when
 *  the next window to free up already starts tomorrow, that one */
export function finalWindowStart(now: number, u: UsageWindow): number {
  const next = nextWindowStart(now, u), d = new Date(now), midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  if (next >= midnight) return next;
  const anchor = u.endsAt !== undefined && u.endsAt > now ? u.endsAt : midnight - WINDOW_MS;
  // the anchor's grid (anchor ± 5 h·k): its last start before midnight, never before the next free window
  const last = anchor + Math.floor((midnight - 1 - anchor) / WINDOW_MS) * WINDOW_MS;
  return Math.max(next, last);
}

/** The next-window message to deliver now, if any: the oldest due one (those that failed, last), at most one every
 *  WINDOW_GAP_MS since `last`, and none while a limit stops everything */
export function windowNext(list: ScheduledMessage[], now: number, u: UsageWindow, last: number | undefined, failed: Set<string> = new Set()): ScheduledMessage | undefined {
  if ((u.blockedUntil ?? 0) > now || (last !== undefined && now - last < WINDOW_GAP_MS)) return undefined;
  return list.filter(x => x.nextWindow && x.when <= now)
    .sort((a, b) => (failed.has(a.id) ? 1 : 0) - (failed.has(b.id) ? 1 : 0) || a.created - b.created)[0];
}
