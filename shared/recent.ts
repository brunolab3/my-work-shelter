/** What a "most recent first" list compares: when it last changed, the name it shows and an id for full determinism */
export interface Recency { cuando: number; nombre?: string; id: string }

/** Most recent first, by the minute: within the same minute, by the name shown (then the id), so a list of working
 *  sessions only reshuffles when a minute changes, not on every update */
export const recentFirst = (a: Recency, b: Recency) =>
  Math.floor(b.cuando / 60_000) - Math.floor(a.cuando / 60_000)
  || (a.nombre ?? '').localeCompare(b.nombre ?? '', undefined, { sensitivity: 'base', numeric: true })
  || a.id.localeCompare(b.id);

/** A conversation's recency, named by its title unless the list shows something else */
export const sessionRecency = (s: { id: string; actualizada: number; titulo?: string }, nombre = s.titulo): Recency => ({ cuando: s.actualizada, nombre, id: s.id });
