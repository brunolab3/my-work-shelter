// Mensajes programados (server/scheduled.ts): un habitante deja un mensaje para más adelante («lo revisamos el lunes»)
// a su propia conversación o a una sala, y el juego lo entrega a esa hora, también tras reinicios. Aquí lo puro: leer
// la fecha que pide, aplazar los fines de semana a la mañana del siguiente día laborable y describirla en palabras
// (para que una fecha mal puesta salte a la vista). Todo en la hora local del Mac.
import { language, t } from './language.ts';
import { worktreeHasTask } from './tasks.ts';
import type { MessageOrigin } from './protocol.ts';

/** A dónde va: a la propia conversación que lo programó (se retoma por su `claudeId`) o, como send_to_room, a una sala */
export type ScheduledTarget =
  | { type: 'conversation'; roomId: string; sessionId?: string; claudeId?: string; cwd: string; title?: string }
  | { type: 'room'; room: string; key?: string; thread?: string };

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
  // that send_to_room was `important`: to a busy receiver it still waits for its turn to end
  important?: true;
  // not urgent: waits for the day's final 5-hour usage window (below); `when` is when it starts
  nextWindow?: true;
  overseer?: true;       // written by the Overseer (the intercom's ⌥Enter), not by a dweller
  // waits for its target conversation's turn to end, and starts a turn of its own then (never taken mid-turn): `when` is
  // when it was held. Every message that isn't the Overseer typing (another room, the game, a dated one falling due)
  // waits like this while that conversation is busy, and the Overseer can pick it in ⏰ Schedule
  afterTurn?: true;
  // who sent it, delivered verbatim with them as its sender (another room's dweller, the game, the Overseer)
  from?: MessageOrigin;
  // the game's CI failures and reviews of one PR (server/scheduled.ts: pack): one pending message per PR and conversation,
  // its parts merged into `message`, held while that PR's checks still run (`turnDue`)
  pr?: { url: string; label: string; parts: PackPart[] };
  // a room's messages from one conversation to one place (server/scheduled.ts: joinMessage): while pending, the same
  // sender's next ones to the same place join it, under one heading, so a correction goes with what it corrects
  messages?: { room: string; dweller?: string; parts: PackPart[] };
}
/** One notice about a PR (its CI failing on a commit, or new reviews), or one of a sender's messages */
export interface PackPart { kind: 'ci' | 'review' | 'message'; text: string }

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

/** Los que se entregan ya, en orden (the after-turn ones go when their conversation is free: `turnDue`) */
export const due = (list: ScheduledMessage[], now: number) => list.filter(x => !x.nextWindow && !x.afterTurn && x.when <= now).sort((a, b) => a.when - b.when);
export const AFTER_TURN = 'after-turn';               // the intercom's «When it finishes» as `when`
/** The after-turn ones whose conversation is free now (`busy` by game id or Claude Code id), oldest first; a PR's pack
 *  also waits for its checks to finish (`settled`), at most PACK_MAX_MS since it was first held */
export const turnDue = (list: ScheduledMessage[], busy: (t: { sessionId?: string; claudeId?: string }) => boolean, settled: (url: string) => boolean = () => true, now = Date.now()) =>
  list.filter(x => x.afterTurn && x.target.type === 'conversation' && !busy(x.target) && (!x.pr || settled(x.pr.url) || now - x.created >= PACK_MAX_MS)).sort((a, b) => a.created - b.created);
export const PACK_MAX_MS = 30 * 60_000;   // a check stuck running doesn't hold a PR's notices longer than this

/** A notice added to a PR's pack: the same text is not repeated, a CI failure replaces the earlier one (that of an older
 *  commit) in its place, reviews add up */
export function mergePart(parts: PackPart[], p: PackPart): PackPart[] {
  if (parts.some(x => x.text === p.text)) return parts;
  const ci = p.kind === 'ci' ? parts.findIndex(x => x.kind === 'ci') : -1;
  return ci >= 0 ? parts.map((x, i) => (i === ci ? p : x)) : [...parts, p];
}
/** The pack's text: a single notice as it was; several, under a heading, in the order they came */
const joined = (title: string, parts: PackPart[]) => (parts.length === 1 ? parts[0].text : [title, ...parts.map(x => x.text)].join('\n\n---\n\n'));
export const packText = (label: string, parts: PackPart[]) => joined(t('prompt.packed.title', { pr: label, n: parts.length }), parts);
/** A sender's packed messages: one as it was; several, under a heading that says later ones may correct earlier ones */
export const messagesText = (m: NonNullable<ScheduledMessage['messages']>) =>
  joined(t('prompt.packed.messages', { n: m.parts.length, room: m.room, dweller: m.dweller ? ` (${m.dweller})` : '' }), m.parts);
/** Same sender: the same room and the same conversation (by game id or Claude Code id); none without a conversation */
export const sameSender = (a: ScheduledMessage['origin'], b: ScheduledMessage['origin']) =>
  a.roomId === b.roomId && (!!(a.claudeId && a.claudeId === b.claudeId) || !!(a.sessionId && a.sessionId === b.sessionId));
/** Whether one is for that conversation (its target), by game id or Claude Code id */
export const forTarget = (x: ScheduledMessage, s: { id?: string; claudeId?: string }) =>
  x.target.type === 'conversation' && (!!(s.claudeId && x.target.claudeId === s.claudeId) || !!(s.id && x.target.sessionId === s.id));
/** Which way one goes for the conversation whose list it is (`here`; with none, the place it is listed at, whose list
 *  holds what goes to it: ofPlace): `in` arrives there, `out` leaves it for another room or conversation, `self` is a
 *  reminder that conversation wrote to itself (it arrives, but nobody else sent it). The Overseer's, another room's
 *  and the game's messages arrive, even when scheduled from this conversation's intercom */
export function scheduledDirection(x: ScheduledMessage, here?: { id?: string; claudeId?: string }): 'in' | 'out' | 'self' {
  const d = x.target, to = here ?? (d.type === 'conversation' ? { id: d.sessionId, claudeId: d.claudeId } : undefined);
  if (here && !forTarget(x, here)) return 'out';
  const own = !x.from && !x.overseer && !!to && d.type === 'conversation' && ofConversation([x], to).length > 0;
  return own ? 'self' : 'in';
}
export const isLate = (x: ScheduledMessage, now: number) => now - x.when > LATE_AFTER_MS;

/** Los de una conversación (los que programó ella): por su id del juego o por el de Claude Code */
export const ofConversation = (list: ScheduledMessage[], s: { id?: string; claudeId?: string }) =>
  list.filter(x => (s.claudeId && x.origin.claudeId === s.claudeId) || (s.id && x.origin.sessionId === s.id)).sort((a, b) => a.when - b.when);
/** What a conversation's intercom lists: what it scheduled, and what waits for its turn to end (from anyone) */
export const ofConversationView = (list: ScheduledMessage[], s: { id?: string; claudeId?: string }) =>
  list.filter(x => ofConversation([x], s).length || (x.afterTurn && forTarget(x, s))).sort((a, b) => a.when - b.when);

/** Where a pending message is shown when its conversation isn't open: its room and, inside one of the room's
 *  `worktrees`, that worktree's path. A conversation target goes where its cwd is (the worktree containing it, or the
 *  room's main copy); a room target with a key, to the worktree of that task if the room has one, else to that task's
 *  hologram still to come (`task`: its worktree is created on delivery); else the main copy */
export function placeOf(x: ScheduledMessage, worktrees: { path: string; branch?: string; main?: boolean }[]): { roomId: string; worktree?: string; task?: string } {
  const ws = worktrees.filter(w => !w.main), d = x.target;
  if (d.type === 'room') {
    const worktree = d.key ? ws.find(w => worktreeHasTask(w, d.key!))?.path : undefined;
    return { roomId: d.room, ...(worktree ? { worktree } : d.key ? { task: d.key } : {}) };
  }
  const cwd = d.cwd.replace(/\/+$/, '');
  return { roomId: d.roomId, worktree: ws.find(w => { const r = w.path.replace(/\/+$/, ''); return cwd === r || cwd.startsWith(r + '/'); })?.path };
}
/** The ones shown on a room's dweller (`worktree` undefined) or on one of its worktrees' holograms, soonest first; with
 *  `task`, those for that task's hologram still to come */
export const ofPlace = (list: ScheduledMessage[], roomId: string, worktree: string | undefined, worktrees: { path: string; branch?: string; main?: boolean }[], task?: string) =>
  list.filter(x => { const p = placeOf(x, worktrees); return p.roomId === roomId && p.worktree === worktree && p.task === task; }).sort((a, b) => a.when - b.when);

/** A room's general list split by place: its main copy first (with those whose worktree is gone), then each of its
 *  `worktrees` that has some, in that order, then each task whose hologram is still to come (`task`), soonest first;
 *  soonest first within each. Empty places are left out */
export function byPlace(list: ScheduledMessage[], roomId: string, worktrees: { path: string; branch?: string; main?: boolean }[]): { worktree?: string; task?: string; items: ScheduledMessage[] }[] {
  const places: (string | undefined)[] = [undefined, ...worktrees.filter(w => !w.main).map(w => w.path)];
  const tasks = [...new Set([...list].sort((a, b) => a.when - b.when).map(x => placeOf(x, worktrees)).filter(p => p.roomId === roomId && p.task).map(p => p.task!))];
  return [...places.map(worktree => ({ worktree, items: ofPlace(list, roomId, worktree, worktrees) })),
    ...tasks.map(task => ({ task, items: ofPlace(list, roomId, undefined, worktrees, task) }))].filter(g => g.items.length);
}

/** The soonest pending message of each room and worktree, keyed `salaId|worktree` (`salaId|` for the room's main copy):
 *  the ⏰ on its dweller or hologram in the shelter */
export function soonestByPlace(list: ScheduledMessage[], worktreesOf: (roomId: string) => { path: string; branch?: string; main?: boolean }[]): Map<string, ScheduledMessage> {
  const out = new Map<string, ScheduledMessage>();
  for (const x of list) {
    const p = placeOf(x, worktreesOf(x.target.type === 'room' ? x.target.room : x.target.roomId)), k = `${p.roomId}|${p.worktree ?? ''}`;
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
