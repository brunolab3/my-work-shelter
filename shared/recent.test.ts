import { describe, it, expect } from 'vitest';
import { recentFirst } from './recent.ts';

const at = (min: number, s = 0) => min * 60_000 + s * 1000;

describe('recentFirst', () => {
  it('orders different minutes newest first', () => {
    const l = [{ when: at(1), name: 'a', id: '1' }, { when: at(3), name: 'z', id: '2' }, { when: at(2), name: 'm', id: '3' }];
    expect(l.sort(recentFirst).map(x => x.id)).toEqual(['2', '3', '1']);
  });
  it('orders the same minute by name, whatever the seconds', () => {
    const l = [{ when: at(5, 50), name: 'Zeta', id: '1' }, { when: at(5, 1), name: 'alfa', id: '2' }, { when: at(5, 30), name: 'Beta', id: '3' }];
    expect(l.sort(recentFirst).map(x => x.name)).toEqual(['alfa', 'Beta', 'Zeta']);
  });
  it('falls back to the id on equal names', () => {
    const l = [{ when: at(5), name: 'x', id: 'b' }, { when: at(5, 9), id: 'a', name: 'x' }];
    expect(l.sort(recentFirst).map(x => x.id)).toEqual(['a', 'b']);
  });
});
