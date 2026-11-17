import { describe, it, expect } from 'vitest';
import { recentFirst } from './recent.ts';

const at = (min: number, s = 0) => min * 60_000 + s * 1000;

describe('recentFirst', () => {
  it('orders different minutes newest first', () => {
    const l = [{ cuando: at(1), nombre: 'a', id: '1' }, { cuando: at(3), nombre: 'z', id: '2' }, { cuando: at(2), nombre: 'm', id: '3' }];
    expect(l.sort(recentFirst).map(x => x.id)).toEqual(['2', '3', '1']);
  });
  it('orders the same minute by name, whatever the seconds', () => {
    const l = [{ cuando: at(5, 50), nombre: 'Zeta', id: '1' }, { cuando: at(5, 1), nombre: 'alfa', id: '2' }, { cuando: at(5, 30), nombre: 'Beta', id: '3' }];
    expect(l.sort(recentFirst).map(x => x.nombre)).toEqual(['alfa', 'Beta', 'Zeta']);
  });
  it('falls back to the id on equal names', () => {
    const l = [{ cuando: at(5), nombre: 'x', id: 'b' }, { cuando: at(5, 9), id: 'a', nombre: 'x' }];
    expect(l.sort(recentFirst).map(x => x.id)).toEqual(['a', 'b']);
  });
});
