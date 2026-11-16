import { describe, expect, it } from 'vitest';
import { groupTabs, nthTab, nextTab, talkerFirst, type TabState } from './ordenPestanas';

const tab = (id: string, estado?: TabState, grupo?: string) => ({ id, estado, grupo });
const ids = (l: { id: string }[]) => l.map(x => x.id).join(' ');

describe('groupTabs', () => {
  it('keeps each group where its first tab is and the order inside it, whatever the state', () => {
    const l = [tab('a', 'ociosa', 'x'), tab('b', 'esperando', 'y'), tab('c', 'trabajando', 'x'), tab('d', 'sinLeer', 'z'), tab('e', 'error', 'y')];
    expect(ids(groupTabs(l))).toBe('a c b e d');
  });
});

describe('nthTab and nextTab follow the visible order', () => {
  const l = [tab('c'), tab('a'), tab('b')];
  it('⌘n and ⌘9', () => { expect(nthTab(l, 1)).toBe('c'); expect(nthTab(l, 9)).toBe('b'); expect(nthTab(l, 5)).toBeUndefined(); });
  it('⌃Tab wraps', () => { expect(nextTab(l, 'b', 1)).toBe('c'); expect(nextTab(l, 'c', -1)).toBe('b'); expect(nextTab([tab('a')], 'a', 1)).toBeUndefined(); });
});

describe('talkerFirst', () => {
  const MIN = 60_000;
  const q = (id: string, estado?: TabState, minuto = 0, nombre = id) => ({ id, estado, cuando: estado ? 1_000 * MIN + minuto * MIN : 0, nombre });
  it('orders by state (waiting, unread, failed, working, ready), then by the minute, then by name; those without a conversation last, as given', () => {
    const l = [q('zeta'), q('lista', 'ociosa', 9), q('obrera', 'trabajando', 1), q('alfa'), q('espera', 'esperando', 0), q('rota', 'error', 5),
      q('nueva', 'sinLeer', 2), q('b-vieja', 'ociosa', 3), q('a-vieja', 'ociosa', 3), q('urge', 'esperando', 4)];
    expect(ids([...l].sort(talkerFirst))).toBe('urge espera nueva rota obrera lista a-vieja b-vieja zeta alfa');
  });
});
