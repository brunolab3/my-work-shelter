// The queue of a busy conversation: what was sent to it (by the Overseer, another room, a scheduled message or the game)
// and Claude Code has not taken yet. Claude Code keeps such messages in its own command queue and folds them into the
// running turn at its next tool boundary (or starts a turn with them once the current one ends); it reports each one by
// uuid with `command_lifecycle` frames: 'queued', 'started' when taken, 'cancelled', 'completed'. A queued message can
// be withdrawn (`cancel_async_message`) until it is taken.
import type { MessageOrigin, QueuedMessage, SessionSummary } from './protocol.ts';
import { t } from './language.ts';

export type Lifecycle = 'queued' | 'started' | 'cancelled' | 'completed';

/** A lifecycle frame applied to the queue: 'started' (or a 'completed' that came first) takes the message, 'cancelled'
 *  drops it; anything else, or a uuid not in the queue, changes nothing */
export function applyLifecycle(queue: QueuedMessage[], uuid: string, state: string): { queue: QueuedMessage[]; taken?: QueuedMessage; dropped?: QueuedMessage } {
  const i = queue.findIndex(m => m.id === uuid);
  if (i < 0 || (state !== 'started' && state !== 'completed' && state !== 'cancelled')) return { queue };
  const rest = [...queue.slice(0, i), ...queue.slice(i + 1)];
  return state === 'cancelled' ? { queue: rest, dropped: queue[i] } : { queue: rest, taken: queue[i] };
}

/** The messages a turn consumed (a result's `user_message_uuids`, for CLIs that send no lifecycle frames), in queue order */
export function takeConsumed(queue: QueuedMessage[], uuids: readonly string[] | undefined): { queue: QueuedMessage[]; taken: QueuedMessage[] } {
  const ids = new Set(uuids ?? []);
  return { queue: queue.filter(m => !ids.has(m.id)), taken: queue.filter(m => ids.has(m.id)) };
}

/** Only what the Overseer typed can be withdrawn or edited: another room's message is not theirs to change */
export const withdrawable = (m: QueuedMessage) => m.origin.kind === 'overseer';

/** Who sent it, as the intercom shows it before the message */
export function originLabel(o: MessageOrigin | undefined): string {
  if (!o || o.kind === 'overseer') return t('windows.you');
  if (o.kind === 'room') return o.dweller ? t('windows.queue.fromRoomDweller', { room: o.room, dweller: o.dweller }) : o.room;
  return t(o.kind === 'scheduled' ? 'windows.queue.scheduled' : 'windows.queue.game');
}

/** How many messages wait in these conversations (a tab's, a dweller's or a hologram's) */
export const queuedIn = (sessions: Iterable<SessionSummary | undefined>) => {
  let n = 0;
  for (const s of sessions) if (s && s.state !== 'closed') n += s.queue?.length ?? 0;
  return n;
};
