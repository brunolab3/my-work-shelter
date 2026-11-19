import { describe, it, expect } from 'vitest';
import type { SessionSummary, PendingRequest } from '@shared/protocol';
import { noticeChanges, dockBadge } from './pendingNotices';

const pet = (id: string): PendingRequest => ({ id, type: 'pregunta', tool: 'AskUserQuestion', title: 'Tengo una pregunta para ti', canAlways: false });
const sess = (id: string, pending?: PendingRequest, state: SessionSummary['state'] = pending ? 'esperando' : 'trabajando') =>
  ({ id, dwellerId: 'h', roomId: 'sala', cwd: '/x', state, unread: false, title: 't', pending, pendingCount: 0, helpers: [], tools: 0, turns: 0, created: 0, updated: 0 }) as SessionSummary;
const ids = (r: { add: SessionSummary[] }) => r.add.map(s => s.id);

describe('avisos de macOS por peticiones pendientes', () => {
  it('avisa una sola vez de una petición que llega con el juego en segundo plano', () => {
    const seen = new Map<string, string>();
    expect(ids(noticeChanges({ a: sess('a', pet('p1')), b: sess('b') }, seen, false))).toEqual(['a']);
    expect(ids(noticeChanges({ a: sess('a', pet('p1')) }, seen, false))).toEqual([]);
  });
  it('no avisa de lo que llegó con el juego delante, aunque luego pase a segundo plano', () => {
    const seen = new Map<string, string>();
    expect(ids(noticeChanges({ a: sess('a', pet('p1')) }, seen, true))).toEqual([]);
    expect(ids(noticeChanges({ a: sess('a', pet('p1')) }, seen, false))).toEqual([]);
  });
  it('quita el aviso al contestar o cerrar, y una petición nueva sustituye a la anterior', () => {
    const seen = new Map<string, string>();
    noticeChanges({ a: sess('a', pet('p1')), b: sess('b', pet('q1')) }, seen, false);
    const r = noticeChanges({ a: sess('a', pet('p2')), b: sess('b', pet('q1'), 'cerrada') }, seen, false);
    expect(ids(r)).toEqual(['a']);
    expect(r.remove.sort()).toEqual(['a', 'b']);
    expect(noticeChanges({ a: sess('a') }, seen, false).remove).toEqual(['a']);
    expect(seen.size).toBe(0);
  });
});

describe('Dock badge', () => {
  it('counts the requests waiting for an answer, queued ones included', () => {
    expect(dockBadge({ a: { ...sess('a', pet('p1')), pendingCount: 2 }, b: sess('b', pet('p2')), c: sess('c', pet('p3'), 'cerrada') })).toBe('3');
  });
  it('shows a dot for a finished unread turn, and nothing once read or with nothing waiting', () => {
    expect(dockBadge({ a: { ...sess('a', undefined, 'terminada'), unread: true }, b: sess('b') })).toBe('•');
    expect(dockBadge({ a: sess('a', undefined, 'ociosa'), b: sess('b') })).toBe('');
  });
});
