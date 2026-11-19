// The top bar's next event and how loudly it asks for attention (web/src/ui/Hud.tsx): an amber glow 10 min before a
// meeting, a red pulse 3 min before, and the "starts in 1 min" alert over everything 1 min before. All-day events
// never sound the alarm, nor do the ones already started.

export interface MeetingEvent { id: string; fuente: string; titulo: string; inicio: number; fin: number; allElDay: boolean; videollamada?: string; enlace?: string; demo?: boolean }

export const AMBER_MS = 10 * 60_000, RED_MS = 3 * 60_000, ALERT_MS = 60_000;

/** The event the top bar shows: a meeting about to start (≤10 min) comes first, even with another one under way;
 *  otherwise the earliest not yet ended, a timed one before an all-day one. */
export function nextEvent<E extends MeetingEvent>(eventos: E[], ahora: number): E | null {
  const vivos = eventos.filter(e => e.fin > ahora).sort((a, b) => a.inicio - b.inicio);
  const pronto = vivos.find(e => !e.allElDay && e.inicio > ahora && e.inicio - ahora <= AMBER_MS);
  return pronto ?? vivos.find(e => !e.allElDay) ?? vivos[0] ?? null;
}

export type Urgency = '' | 'pronto' | 'inminente';
/** amber (≤10 min) or red (≤3 min) for a timed event not started yet */
export function urgency(e: MeetingEvent | null, ahora: number): Urgency {
  if (!e || e.allElDay || e.inicio <= ahora) return '';
  const falta = e.inicio - ahora;
  return falta <= RED_MS ? 'inminente' : falta <= AMBER_MS ? 'pronto' : '';
}

/** whether the 1-minute alert is due for it (once: the caller remembers the dismissed ones) */
export const alertDue = (e: MeetingEvent | null, ahora: number, vistos: ReadonlySet<string>) =>
  !!e && !e.allElDay && e.inicio > ahora && e.inicio - ahora <= ALERT_MS && !vistos.has(e.id);
