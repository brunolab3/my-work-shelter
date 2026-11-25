// The order of the rooms in the intercom lists (the bar's COM row and its ⋯ N list), arranged by the Overseer: kept in
// the game's settings by room id, so it survives restarts and is the same in every intercom. Rooms with no saved place
// go after those with one, in the order they had (their first appearance).

export const ROOM_ORDER_MAX = 200;

/** The saved room ids, in order, from the game's settings */
export function roomOrderOf(settings: unknown): string[] {
  const l = (settings as { comRoomOrder?: unknown } | null | undefined)?.comRoomOrder;
  return Array.isArray(l) ? [...new Set(l.filter((x): x is string => typeof x === 'string' && !!x))].slice(0, ROOM_ORDER_MAX) : [];
}

/** `items` with their rooms in the saved order, keeping the order they come in within each room and among new rooms */
export function byRoomOrder<T>(items: T[], room: (x: T) => string, saved: string[]): T[] {
  const at = (x: T) => { const i = saved.indexOf(room(x)); return i < 0 ? saved.length : i; };
  return [...items].sort((a, b) => at(a) - at(b));
}

/** The saved order once `room` is dropped at `target`'s place (after it going down, before it going up), with `shown`
 *  the rooms as the list shows them now: those not saved yet take their place too */
export function moveRoom(saved: string[], shown: string[], room: string, target: string): string[] {
  const all = [...saved, ...shown.filter(r => !saved.includes(r))];
  const i = all.indexOf(room), j = all.indexOf(target);
  if (i < 0 || j < 0 || i === j) return all.slice(0, ROOM_ORDER_MAX);
  all.splice(i, 1);
  all.splice(all.indexOf(target) + (i < j ? 1 : 0), 0, room);
  return all.slice(0, ROOM_ORDER_MAX);
}
