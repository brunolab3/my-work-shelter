// Every source that works in this shelter loads its real connector (a renamed file once left the Mac Calendar empty)
import { describe, expect, it } from 'vitest';
import { ACTIVE_SOURCES } from '../../shared/sources.ts';
import { CONNECTORS } from './adapters.ts';

describe('connectors', () => {
  it.each(ACTIVE_SOURCES)('%s resolves to a module with crear', async id => {
    const m = await CONNECTORS[id]();
    expect(typeof m.create).toBe('function');
  });
});
