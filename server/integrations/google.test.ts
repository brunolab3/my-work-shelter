// Google borrowing the `gws` CLI session: execFile and fetch mocked (no gws, no network), keychain in memory.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Store } from '../state.ts';
import { keychainMemory, useKeychain, keychainMac } from './keychain.ts';

const gws = vi.hoisted(() => ({ outputs: new Map<string, string>(), calls: [] as { args: string[]; env: NodeJS.ProcessEnv }[] }));
vi.mock('node:child_process', () => ({
  execFile: (cmd: string, args: string[], op: { env: NodeJS.ProcessEnv }, cb: (e: Error | null, out: string) => void) => {
    if (cmd !== 'gws') return cb(new Error('unexpected ' + cmd), '');
    gws.calls.push({ args, env: op.env });
    const output = gws.outputs.get(op.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR ?? 'default');
    output === undefined ? cb(new Error('spawn gws ENOENT'), '') : cb(null, output);
  },
}));
const { create: createGoogle, gwsCredentials, missingScopes } = await import('./google.ts');

// Client IDs put together here so secret scanners don't take them for real ones
const fakeClientId = (n: string) => [n, 'apps', 'googleusercontent', 'com'].join('.');
const CRED = { type: 'authorized_user', client_id: fakeClientId('999-gws'), client_secret: 'GOCSPX-GWS', refresh_token: '1//GWS-REFRESH' };
const NO_SESSION = JSON.stringify({ error: { code: 401, message: "No encrypted credentials found. Run 'gws auth login' first.", reason: 'authError' } });
const SCOPES = 'openid https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive';
const answer = (body: unknown, state = 200) => new Response(JSON.stringify(body), { status: state });
function fakeStore(): Store {
  const state: any = { integrations: { google: { mode: 'real' } }, viewsNotifications: [] };
  return { state, change(f: (e: any) => void) { f(state); }, save() {}, saveAlready() {} } as unknown as Store;
}

let keychain: ReturnType<typeof keychainMemory>;
let scope = SCOPES, tokenError: unknown = null, refreshes = 0;
const home = process.env.HOME;
beforeEach(() => {
  keychain = keychainMemory(); useKeychain(keychain);
  gws.outputs.clear(); gws.calls = []; scope = SCOPES; tokenError = null; refreshes = 0;
  process.env.HOME = mkdtempSync(path.join(tmpdir(), 'gws-home-'));
  delete process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR; delete process.env.GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const p = new URLSearchParams(String(init.body));
      expect(Object.fromEntries(p)).toEqual({ client_id: CRED.client_id, client_secret: CRED.client_secret, grant_type: 'refresh_token', refresh_token: CRED.refresh_token });
      refreshes++;
      return tokenError ? answer(tokenError, 400) : answer({ access_token: 'ya29.GWS', expires_in: 3599, scope, token_type: 'Bearer' });
    }
    expect((init.headers as any).Authorization).toBe('Bearer ya29.GWS');
    if (url.endsWith('/users/me/profile')) return answer({ emailAddress: 'irene.valdes@taller.example' });
    if (url.includes('/users/me/messages?')) return answer({ messages: [] });
    if (url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events?')) return answer({ items: [] });
    return answer({ error: { message: 'no' } }, 404);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); useKeychain(keychainMac); process.env.HOME = home; delete process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR; });

describe('Google with the gws session', () => {
  it('empty fields: borrows gws, nothing stored, gws runs only when the access token is renewed', async () => {
    gws.outputs.set('default', JSON.stringify(CRED, null, 2) + '\n');
    const a = fakeStore();
    const g = createGoogle(a);
    expect(await g.configure({})).toMatchObject({ ok: true, detail: expect.stringMatching(/irene\.valdes@taller\.example \(sesión de gws\)/) });
    expect(gws.calls[0].args).toEqual(['auth', 'export', '--unmasked']);
    await g.poll(); await g.poll();
    expect(g.state()).toMatchObject({ state: 'conectada', detail: expect.stringMatching(/sesión de gws/) });
    expect(gws.calls).toHaveLength(1);
    expect(refreshes).toBe(1);
    expect(keychain.data.size).toBe(0);
    expect(JSON.stringify(a.state)).not.toMatch(/GOCSPX|GWS-REFRESH|ya29/);
    await expect(g.action!('conectar', { open: false })).rejects.toThrow(/gws auth login/);
  });

  it('gws not signed in: clear error, and no new gws run every minute', async () => {
    gws.outputs.set('default', NO_SESSION);
    const g = createGoogle(fakeStore());
    expect(await g.attempt({})).toMatchObject({ ok: false, detail: expect.stringMatching(/gws auth login/) });
    await expect(g.poll()).rejects.toThrow(/gws auth login/);
    const n = gws.calls.length;
    expect(await g.poll()).toEqual({});
    expect(gws.calls).toHaveLength(n);
  });

  it('missing Gmail or Calendar scopes and a revoked gws session are explained', async () => {
    gws.outputs.set('default', JSON.stringify(CRED));
    scope = 'openid https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar.readonly';
    const g = createGoogle(fakeStore());
    expect(await g.attempt({})).toMatchObject({ ok: false, detail: expect.stringMatching(/no permite leer Gmail.*gws auth login/) });
    scope = SCOPES; tokenError = { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' };
    expect(await g.attempt({})).toMatchObject({ ok: false, detail: expect.stringMatching(/sesión de gws \(caducada o revocada\)/) });
  });

  it('half a client is an error, not gws', async () => {
    const g = createGoogle(fakeStore());
    expect(await g.attempt({ clientId: fakeClientId('123-abc') })).toMatchObject({ ok: false, detail: expect.stringMatching(/secreto/) });
    expect(gws.calls).toHaveLength(0);
  });
});

describe('gwsCredentials', () => {
  it('without a gws session by default, tries command-center-starter\'s directory with the file backend', async () => {
    const center = path.join(process.env.HOME!, '.config/gws-command-center'); mkdirSync(center, { recursive: true });
    gws.outputs.set('default', NO_SESSION); gws.outputs.set(center, JSON.stringify(CRED));
    expect(await gwsCredentials()).toEqual({ client_id: CRED.client_id, client_secret: CRED.client_secret, refresh_token: CRED.refresh_token });
    expect(gws.calls.map(l => [l.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR, l.env.GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND])).toEqual([[undefined, undefined], [center, 'file']]);
  });
  it('respects GOOGLE_WORKSPACE_CLI_CONFIG_DIR and stops there; no gws installed is no session', async () => {
    mkdirSync(path.join(process.env.HOME!, '.config/gws-command-center'), { recursive: true });
    process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR = '/tmp/otro-gws';
    gws.outputs.set('/tmp/otro-gws', NO_SESSION);
    expect(await gwsCredentials()).toBeNull();
    expect(gws.calls).toHaveLength(1);
    delete process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR; gws.calls = []; gws.outputs.clear();
    expect(await gwsCredentials()).toBeNull();
  });
  it('missingScopes accepts broader scopes', () => {
    expect(missingScopes(SCOPES)).toEqual([]);
    expect(missingScopes('https://mail.google.com/ https://www.googleapis.com/auth/calendar.events.readonly')).toEqual([]);
    expect(missingScopes('openid https://www.googleapis.com/auth/gmail.metadata')).toEqual(['Gmail', 'Google Calendar']);
  });
});
