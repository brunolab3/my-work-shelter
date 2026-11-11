import { describe, it, expect } from 'vitest';
import type { SessionSummary, PendingRequest } from '@shared/protocolo';
import { noticeChanges } from './avisosPendientes';

const pet = (id: string): PendingRequest => ({ id, tipo: 'pregunta', herramienta: 'AskUserQuestion', titulo: 'Tengo una pregunta para ti', canAlways: false });
const ses = (id: string, pending?: PendingRequest, estado: SessionSummary['estado'] = pending ? 'esperando' : 'trabajando') =>
  ({ id, dwellerId: 'h', salaId: 'sala', cwd: '/x', estado, sinLeer: false, titulo: 't', pending, pendientes: 0, ayudantes: [], herramientas: 0, turns: 0, created: 0, actualizada: 0 }) as SessionSummary;
const ids = (r: { dar: SessionSummary[] }) => r.dar.map(s => s.id);

describe('avisos de macOS por peticiones pendientes', () => {
  it('avisa una sola vez de una petición que llega con el juego en segundo plano', () => {
    const visto = new Map<string, string>();
    expect(ids(noticeChanges({ a: ses('a', pet('p1')), b: ses('b') }, visto, false))).toEqual(['a']);
    expect(ids(noticeChanges({ a: ses('a', pet('p1')) }, visto, false))).toEqual([]);
  });
  it('no avisa de lo que llegó con el juego delante, aunque luego pase a segundo plano', () => {
    const visto = new Map<string, string>();
    expect(ids(noticeChanges({ a: ses('a', pet('p1')) }, visto, true))).toEqual([]);
    expect(ids(noticeChanges({ a: ses('a', pet('p1')) }, visto, false))).toEqual([]);
  });
  it('quita el aviso al contestar o cerrar, y una petición nueva sustituye a la anterior', () => {
    const visto = new Map<string, string>();
    noticeChanges({ a: ses('a', pet('p1')), b: ses('b', pet('q1')) }, visto, false);
    const r = noticeChanges({ a: ses('a', pet('p2')), b: ses('b', pet('q1'), 'cerrada') }, visto, false);
    expect(ids(r)).toEqual(['a']);
    expect(r.quitar.sort()).toEqual(['a', 'b']);
    expect(noticeChanges({ a: ses('a') }, visto, false).quitar).toEqual(['a']);
    expect(visto.size).toBe(0);
  });
});
