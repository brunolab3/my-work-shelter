import { describe, expect, it } from 'vitest';
import { confirmsFirst, modeChangeable, modeRows } from './modeMenu';

describe('permission mode picker', () => {
  it('lists every mode with the current one marked', () => {
    const rows = modeRows('auto');
    expect(rows.map(r => r.value)).toEqual(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']);
    expect(rows.filter(r => r.current).map(r => r.value)).toEqual(['auto']);
  });
  it('switching to plan says it is read-only until a plan is approved', () => {
    expect(modeRows('auto').find(r => r.value === 'plan')?.hint).toBe('windows.mode.planNow');
    expect(modeRows('plan').find(r => r.value === 'plan')?.hint).toBe('windows.permPlanFirstHint');
  });
  it('only switching to bypassPermissions asks first', () => {
    expect(confirmsFirst('bypassPermissions', 'auto')).toBe(true);
    expect(confirmsFirst('bypassPermissions', 'bypassPermissions')).toBe(false);
    for (const m of ['default', 'acceptEdits', 'plan', 'auto']) expect(confirmsFirst(m, 'bypassPermissions')).toBe(false);
  });
  it('a closed conversation only shows its mode', () => {
    expect(modeChangeable({ state: 'closed' })).toBe(false);
    expect(modeChangeable({ state: 'idle' })).toBe(true);
    expect(modeChangeable({ state: 'working' })).toBe(true);
  });
});
