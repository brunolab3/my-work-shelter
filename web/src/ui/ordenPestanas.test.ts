import { describe, expect, it } from 'vitest';
import { orderTabs, nthTab, nextTab, type TabState } from './ordenPestanas';

const tab = (id: string, estado?: TabState, grupo?: string) => ({ id, estado, grupo });
const ids = (l: { id: string }[]) => l.map(x => x.id).join(' ');

describe('orderTabs', () => {
  it('puts the most urgent first and keeps arrival order within a state', () => {
    const l = [tab('a', 'ociosa'), tab('b', 'trabajando'), tab('c', 'esperando'), tab('d'), tab('e', 'sinLeer'), tab('f', 'error'), tab('g', 'esperando')];
    expect(ids(orderTabs(l))).toBe('c g e f b a d');
  });
  it('keeps the pinned tab where it was', () => {
    const l = [tab('a', 'ociosa'), tab('b', 'esperando'), tab('c', 'trabajando')];
    expect(ids(orderTabs(l, { id: 'a', i: 0 }))).toBe('a b c');
    expect(ids(orderTabs(l, { id: 'a', i: 9 }))).toBe('b c a');
    expect(ids(orderTabs(l, { id: 'a', i: -1 }))).toBe('b c a');
  });
  it('groups by room, each group where its most urgent tab would go', () => {
    const l = [tab('a', 'ociosa', 'x'), tab('b', 'trabajando', 'y'), tab('c', 'esperando', 'x'), tab('d', 'ociosa', 'y'), tab('e', 'trabajando', 'z')];
    expect(ids(orderTabs(l, undefined, true))).toBe('c a b d e');
  });
  it('keeps a pinned tab inside its group', () => {
    const l = [tab('a', 'ociosa', 'x'), tab('b', 'esperando', 'y'), tab('c', 'trabajando', 'x')];
    // a was first, but group y is now more urgent: a stays at the edge of its group
    expect(ids(orderTabs(l, { id: 'a', i: 0 }, true))).toBe('b a c');
  });
});

describe('nthTab and nextTab follow the visible order', () => {
  const l = [tab('c'), tab('a'), tab('b')];
  it('⌘n and ⌘9', () => { expect(nthTab(l, 1)).toBe('c'); expect(nthTab(l, 9)).toBe('b'); expect(nthTab(l, 5)).toBeUndefined(); });
  it('⌃Tab wraps', () => { expect(nextTab(l, 'b', 1)).toBe('c'); expect(nextTab(l, 'c', -1)).toBe('b'); expect(nextTab([tab('a')], 'a', 1)).toBeUndefined(); });
});
