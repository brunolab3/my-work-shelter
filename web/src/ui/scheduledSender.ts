// Who sent a scheduled message, for every list that shows it (the intercom's and hologram's ⏰, Planning's list):
// another room's dweller, the Overseer, the game, or, with no sender recorded, the room that scheduled it
import { t } from '@shared/language';
import type { ScheduledMessage } from '@shared/scheduled';

export function scheduledSender(x: Pick<ScheduledMessage, 'from' | 'overseer' | 'origin'>, roomName: (id: string) => string | undefined): string {
  if (x.from?.kind === 'room') return t('windows.scheduledFrom', { sala: x.from.dweller ? `${x.from.room} (${x.from.dweller})` : x.from.room });
  if (x.from?.kind === 'overseer' || x.overseer) return t('windows.scheduledFromOverseer');
  if (x.from?.kind === 'game') return t('windows.scheduledFromGame');
  return t('windows.scheduledFrom', { sala: roomName(x.origin.roomId) ?? x.origin.roomId });
}
