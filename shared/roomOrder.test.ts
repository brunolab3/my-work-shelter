import { describe, expect, it } from 'vitest';
import { byRoomOrder, moveRoom, roomOrderOf } from './roomOrder';

describe('roomOrder', () => {
  it('reads only string ids, once', () => {
    expect(roomOrderOf({ comRoomOrder: ['a', 3, 'b', 'a', ''] })).toEqual(['a', 'b']);
    expect(roomOrderOf(undefined)).toEqual([]);
  });
  it('puts saved rooms first, new ones after in the order they came, keeping order within a room', () => {
    const l = [{ id: 1, r: 'x' }, { id: 2, r: 'y' }, { id: 3, r: 'x' }, { id: 4, r: 'z' }, { id: 5, r: 'w' }];
    expect(byRoomOrder(l, x => x.r, ['z', 'x']).map(x => x.id)).toEqual([4, 1, 3, 2, 5]);
  });
  it('drops a room at another one\'s place', () => {
    expect(moveRoom([], ['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
    expect(moveRoom([], ['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(moveRoom(['b'], ['b', 'a', 'c'], 'c', 'a')).toEqual(['b', 'c', 'a']);
  });
  it('keeps the saved place of rooms not shown now', () => {
    expect(moveRoom(['q', 'a', 'b'], ['a', 'b'], 'b', 'a')).toEqual(['q', 'b', 'a']);
  });
});
