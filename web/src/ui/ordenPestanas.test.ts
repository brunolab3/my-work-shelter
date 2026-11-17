import { describe, expect, it } from 'vitest';
import { groupTabs, nthTab, nextTab, overflowChips, talkerFirst, type TabState } from './ordenPestanas';

const tab = (id: string, estado?: TabState, grupo?: string) => ({ id, estado, grupo });
const ids = (l: { id: string }[]) => l.map(x => x.id).join(' ');

describe('groupTabs', () => {
  it('keeps each group where its first tab is and the order inside it, whatever the state', () => {
    const l = [tab('a', 'ociosa', 'x'), tab('b', 'esperando', 'y'), tab('c', 'trabajando', 'x'), tab('d', 'sinLeer', 'z'), tab('e', 'error', 'y')];
    expect(ids(groupTabs(l))).toBe('a c b e d');
  });
  it('nests: by talker, then by room, each room where its first tab is and its talkers in order inside it', () => {
    const q = (id: string, quien: string, sala: string) => ({ id, grupo: quien, sala });
    const l = [q('a', 'ana', 'x'), q('b', 'holo', 'y'), q('c', 'eva', 'x'), q('d', 'luz', 'y'), q('e', 'ana', 'x'), q('f', 'holo', 'y')];
    expect(ids(groupTabs(groupTabs(l), x => x.sala))).toBe('a e c b f d');
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

describe('overflowChips', () => {
  it('leaves nothing out when every chip fits', () => {
    expect(overflowChips([10, 20, 30], [3, 3, 3], 60, 8)).toEqual([]);
  });
  it('with nothing before, keeps the most urgent ones beside the «+N» chip and fills what is left by rank', () => {
    // room 3 waits (rank 0), room 0 is in front: they stay; the rest leave from the last one until it fits, 4 comes back
    expect(overflowChips([10, 20, 30, 15, 5], [3, 3, 3, 0, 3], 60, 8, [], 0)).toEqual([2]);
    expect(overflowChips([10, 20, 30, 15, 5], [3, 3, 3, 0, 3], 40, 8)).toEqual([1, 2]);
  });
  it('is sticky: switching to a room in view, or between rooms whose state changes, moves nothing', () => {
    const anchos = [10, 10, 10, 10, 10], antes = [3, 4];
    expect(overflowChips(anchos, [3, 3, 3, 3, 3], 40, 8, antes, 0)).toEqual([3, 4]);
    expect(overflowChips(anchos, [3, 3, 3, 3, 3], 40, 8, antes, 2)).toEqual([3, 4]);
    // a hidden room starts waiting: it stays behind «+N» (which turns urgent), first in its list
    expect(overflowChips(anchos, [3, 3, 3, 3, 0], 40, 8, antes, 1)).toEqual([4, 3]);
  });
  it('opening a hidden room swaps out only the least relevant one in view; the rest keep their place', () => {
    // 1 waits (rank 0): opening 3 sends out the last of the ones with nothing for you (2), not 1 or 0
    expect(overflowChips([10, 10, 10, 10, 10], [3, 0, 3, 3, 3], 40, 8, [3, 4], 3)).toEqual([2, 4]);
    // and once 3 is in view, going back to 0 keeps it there
    expect(overflowChips([10, 10, 10, 10, 10], [3, 0, 3, 3, 3], 40, 8, [2, 4], 0)).toEqual([2, 4]);
  });
  it('a room closing makes room for the hidden ones, by rank', () => {
    expect(overflowChips([10, 10, 10, 12], [3, 3, 1, 3], 40, 8, [2, 3], 0)).toEqual([3]);
  });
});
