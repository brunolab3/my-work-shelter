// The top bar's next event and how loudly it asks for attention (web/src/ui/Hud.tsx): an amber glow 10 min before a
// meeting, a red pulse 3 min before, and the "starts in 1 min" alert over everything 1 min before. All-day events
// never sound the alarm, nor do the ones already started.

export interface MeetingEvent { id: string; source: string; title: string; start: number; end: number; allDay: boolean; videollamada?: string; link?: string; demo?: boolean }

export const AMBER_MS = 10 * 60_000, RED_MS = 3 * 60_000, ALERT_MS = 60_000;

/** The event the top bar shows: a meeting about to start (≤10 min) comes first, even with another one under way;
 *  otherwise the earliest not yet ended, a timed one before an all-day one. */
export function nextEvent<E extends MeetingEvent>(events: E[], now: number): E | null {
  const live = events.filter(e => e.end > now).sort((a, b) => a.start - b.start);
  const upcoming = live.find(e => !e.allDay && e.start > now && e.start - now <= AMBER_MS);
  return upcoming ?? live.find(e => !e.allDay) ?? live[0] ?? null;
}

export type Urgency = '' | 'pronto' | 'inminente';
/** amber (≤10 min) or red (≤3 min) for a timed event not started yet */
export function urgency(e: MeetingEvent | null, now: number): Urgency {
  if (!e || e.allDay || e.start <= now) return '';
  const missing = e.start - now;
  return missing <= RED_MS ? 'inminente' : missing <= AMBER_MS ? 'pronto' : '';
}

/** whether the 1-minute alert is due for it (once: the caller remembers the dismissed ones) */
export const alertDue = (e: MeetingEvent | null, now: number, seen: ReadonlySet<string>) =>
  !!e && !e.allDay && e.start > now && e.start - now <= ALERT_MS && !seen.has(e.id);
