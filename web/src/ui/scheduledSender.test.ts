import { beforeAll, describe, expect, it } from 'vitest';
import { setLanguage } from '@shared/language';
import { scheduledSender } from './scheduledSender';

const names: Record<string, string> = { puente: 'Command Bridge' };
const name = (id: string) => names[id];
const origin = { roomId: 'puente' };

describe('scheduledSender', () => {
  beforeAll(() => setLanguage('en'));
  it('names another room and its dweller', () => {
    expect(scheduledSender({ origin, from: { kind: 'room', roomId: 'git', room: 'Version Control', dweller: 'Ana' } }, name)).toBe('from Version Control (Ana)');
    expect(scheduledSender({ origin, from: { kind: 'room', roomId: 'git', room: 'Version Control' } }, name)).toBe('from Version Control');
  });
  it('names the Overseer, by sender or by the overseer flag', () => {
    expect(scheduledSender({ origin, from: { kind: 'overseer' } }, name)).toBe('from the Overseer');
    expect(scheduledSender({ origin, overseer: true }, name)).toBe('from the Overseer');
  });
  it('names the game', () => {
    expect(scheduledSender({ origin, from: { kind: 'game' } }, name)).toBe('from the game');
  });
  it('without a sender, the room that scheduled it (its id if the room is gone)', () => {
    expect(scheduledSender({ origin }, name)).toBe('from Command Bridge');
    expect(scheduledSender({ origin: { roomId: 'gone' } }, name)).toBe('from gone');
  });
  it('in Spanish', () => {
    setLanguage('es');
    expect(scheduledSender({ origin, from: { kind: 'overseer' } }, name)).toBe('del Supervisor');
    expect(scheduledSender({ origin, from: { kind: 'game' } }, name)).toBe('del juego');
    setLanguage('en');
  });
});
