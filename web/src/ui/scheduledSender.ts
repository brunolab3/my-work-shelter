// Who sent a scheduled message, for every list that shows it (the intercom's and hologram's ⏰, Planning's list):
// another room's dweller, the Overseer, the game, or, with no sender recorded, the room that scheduled it
import { t } from '@shared/language';
import type { ScheduledMessage } from '@shared/scheduled';

export type Direction = 'in' | 'out' | 'self';

export function scheduledSender(x: Pick<ScheduledMessage, 'from' | 'overseer' | 'origin'>, roomName: (id: string) => string | undefined): string {
  if (x.from?.kind === 'room') return t('windows.scheduledFrom', { room: x.from.dweller ? `${x.from.room} (${x.from.dweller})` : x.from.room });
  if (x.from?.kind === 'overseer' || x.overseer) return t('windows.scheduledFromOverseer');
  if (x.from?.kind === 'game') return t('windows.scheduledFromGame');
  return t('windows.scheduledFrom', { room: roomName(x.origin.roomId) ?? x.origin.roomId });
}

/** The mark of a row in the ⏰ lists (direction from scheduledDirection): ↗ sent from here, ↙ arriving here, ↻ a reminder
 *  to itself; its tooltip says which, and the class gives each its colour */
export const directionMark = (d: Direction) => ({ text: t(`windows.scheduledDir.${d}`), hint: t(`windows.scheduledDir.${d}Hint`), className: `scheduled-dir dir-${d}` });

/** Where it goes, for lists with no «here» (Planning's): a room (and its task or thread), or a room's conversation */
export function scheduledTarget(x: Pick<ScheduledMessage, 'target'>, roomName: (id: string) => string | undefined): string {
  const d = x.target;
  if (d.type === 'room') return `${d.room}${d.key ?? d.thread ? ' ' + (d.key ?? d.thread) : ''}`;
  return t('windows.scheduledToRoomConversation', { room: roomName(d.roomId) ?? d.roomId, title: d.title || t('windows.conversation') });
}
