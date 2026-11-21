import { describe, it, expect } from 'vitest';
import { raisedSessionLimit, SESSION_LIMIT_MAX } from './sessionLimit.ts';

describe('raisedSessionLimit', () => {
  it('sube el límite un paso', () => {
    expect(raisedSessionLimit(6)).toBe(8);
    expect(raisedSessionLimit(1)).toBe(3);
  });
  it('no pasa del máximo', () => {
    expect(raisedSessionLimit(19)).toBe(SESSION_LIMIT_MAX);
    expect(raisedSessionLimit(SESSION_LIMIT_MAX - 1)).toBe(SESSION_LIMIT_MAX);
  });
  it('en el máximo no ofrece nada', () => {
    expect(raisedSessionLimit(SESSION_LIMIT_MAX)).toBeUndefined();
  });
});
