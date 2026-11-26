// The `permissionMode` message (the intercom's mode picker, ModePicker in web/src/ui/Dialog.tsx): sessions.mode asks the
// live Claude Code process and records the mode only once it took it
import { describe, expect, it } from 'vitest';
import { Sessions } from './sessions.ts';

function session(setPermissionMode: (m: string) => Promise<void>) {
  const sess = new Sessions({ pathRoom: () => undefined }) as any;
  const r: any = { id: 'w1', dwellerId: 'h1', roomId: 'room', cwd: '/tmp', state: 'idle', unread: false, title: 'Trabajo', pendingCount: 0, helpers: [], tools: 0, turns: 0, permissionMode: 'auto' };
  const x: any = { r, alive: true, closing: false, sent: new Map(), pending: [], queue: [], entries: [], tools: new Map(), helpers: new Map(), background: new Set(), commands: [], options: {} };
  const asked: string[] = [];
  x.q = { setPermissionMode: async (m: string) => { asked.push(m); await setPermissionMode(m); } };
  sess.s.set('w1', x);
  return { sess, r, asked };
}

describe('changing the permission mode of a live conversation', () => {
  it('tells Claude Code and records the new mode', async () => {
    const s = session(async () => {});
    await s.sess.mode('w1', 'plan');
    expect(s.asked).toEqual(['plan']);
    expect(s.r.permissionMode).toBe('plan');
  });
  it('a mode Claude Code refuses leaves the old one', async () => {
    const s = session(async () => { throw new Error('bypassPermissions needs allowDangerouslySkipPermissions'); });
    await s.sess.mode('w1', 'bypassPermissions');
    expect(s.r.permissionMode).toBe('auto');
  });
});
