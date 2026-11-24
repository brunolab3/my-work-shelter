import { beforeAll, describe, expect, it } from 'vitest';
import { setLanguage } from '@shared/language';
import { directionMark, scheduledSender, scheduledTarget } from './scheduledSender';

const names: Record<string, string> = { bridge: 'Command Bridge' };
const name = (id: string) => names[id];
const origin = { roomId: 'bridge' };

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

describe('direction marks and targets', () => {
  beforeAll(() => setLanguage('en'));
  it('marks each direction with its own text, tooltip and colour class', () => {
    expect(directionMark('out')).toMatchObject({ text: '↗ out', className: 'programado-dir dir-out' });
    expect(directionMark('in')).toMatchObject({ text: '↙ in', className: 'programado-dir dir-in' });
    expect(directionMark('self').text).toBe('↻ reminder');
    expect(directionMark('self').hint).toMatch(/itself/);
  });
  it('names where it goes: a room with its key or thread, or a room\'s conversation', () => {
    expect(scheduledTarget({ target: { type: 'sala', room: 'git', key: 'ABC-1' } }, name)).toBe('git ABC-1');
    expect(scheduledTarget({ target: { type: 'sala', room: 'git', thread: 'cleanup' } }, name)).toBe('git cleanup');
    expect(scheduledTarget({ target: { type: 'conversacion', roomId: 'puente', cwd: '/x', title: 'Fix' } }, name)).toBe('Command Bridge “Fix”');
    expect(scheduledTarget({ target: { type: 'conversacion', roomId: 'gone', cwd: '/x' } }, name)).toBe('gone “Conversation”');
  });
});
