// Google borrowing the `gws` CLI session: execFile and fetch mocked (no gws, no network), keychain in memory.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Store } from '../state.ts';
import { keychainMemoria, useKeychain, keychainMac } from './keychain.ts';

const gws = vi.hoisted(() => ({ salidas: new Map<string, string>(), llamadas: [] as { args: string[]; env: NodeJS.ProcessEnv }[] }));
vi.mock('node:child_process', () => ({
  execFile: (cmd: string, args: string[], op: { env: NodeJS.ProcessEnv }, cb: (e: Error | null, out: string) => void) => {
    if (cmd !== 'gws') return cb(new Error('unexpected ' + cmd), '');
    gws.llamadas.push({ args, env: op.env });
    const salida = gws.salidas.get(op.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR ?? 'default');
    salida === undefined ? cb(new Error('spawn gws ENOENT'), '') : cb(null, salida);
  },
}));
const { crear: createGoogle, gwsCredentials, missingScopes } = await import('./google.ts');

// Client IDs put together here so secret scanners don't take them for real ones
const fakeClientId = (n: string) => [n, 'apps', 'googleusercontent', 'com'].join('.');
const CRED = { type: 'authorized_user', client_id: fakeClientId('999-gws'), client_secret: 'GOCSPX-GWS', refresh_token: '1//GWS-REFRESH' };
const NO_SESSION = JSON.stringify({ error: { code: 401, message: "No encrypted credentials found. Run 'gws auth login' first.", reason: 'authError' } });
const SCOPES = 'openid https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive';
const answer = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado });
function fakeStore(): Store {
  const estado: any = { integraciones: { google: { modo: 'real' } }, viewsNotifications: [] };
  return { estado, cambiar(f: (e: any) => void) { f(estado); }, guardar() {}, saveAlready() {} } as unknown as Store;
}

let llavero: ReturnType<typeof keychainMemoria>;
let scope = SCOPES, tokenError: unknown = null, refrescos = 0;
const home = process.env.HOME;
beforeEach(() => {
  llavero = keychainMemoria(); useKeychain(llavero);
  gws.salidas.clear(); gws.llamadas = []; scope = SCOPES; tokenError = null; refrescos = 0;
  process.env.HOME = mkdtempSync(path.join(tmpdir(), 'gws-home-'));
  delete process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR; delete process.env.GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const p = new URLSearchParams(String(init.body));
      expect(Object.fromEntries(p)).toEqual({ client_id: CRED.client_id, client_secret: CRED.client_secret, grant_type: 'refresh_token', refresh_token: CRED.refresh_token });
      refrescos++;
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
    gws.salidas.set('default', JSON.stringify(CRED, null, 2) + '\n');
    const a = fakeStore();
    const g = createGoogle(a);
    expect(await g.configurar({})).toMatchObject({ ok: true, detalle: expect.stringMatching(/irene\.valdes@taller\.example \(sesión de gws\)/) });
    expect(gws.llamadas[0].args).toEqual(['auth', 'export', '--unmasked']);
    await g.sondear(); await g.sondear();
    expect(g.estado()).toMatchObject({ estado: 'conectada', detalle: expect.stringMatching(/sesión de gws/) });
    expect(gws.llamadas).toHaveLength(1);
    expect(refrescos).toBe(1);
    expect(llavero.datos.size).toBe(0);
    expect(JSON.stringify(a.estado)).not.toMatch(/GOCSPX|GWS-REFRESH|ya29/);
    await expect(g.accion!('conectar', { abrir: false })).rejects.toThrow(/gws auth login/);
  });

  it('gws not signed in: clear error, and no new gws run every minute', async () => {
    gws.salidas.set('default', NO_SESSION);
    const g = createGoogle(fakeStore());
    expect(await g.probar({})).toMatchObject({ ok: false, detalle: expect.stringMatching(/gws auth login/) });
    await expect(g.sondear()).rejects.toThrow(/gws auth login/);
    const n = gws.llamadas.length;
    expect(await g.sondear()).toEqual({});
    expect(gws.llamadas).toHaveLength(n);
  });

  it('missing Gmail or Calendar scopes and a revoked gws session are explained', async () => {
    gws.salidas.set('default', JSON.stringify(CRED));
    scope = 'openid https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar.readonly';
    const g = createGoogle(fakeStore());
    expect(await g.probar({})).toMatchObject({ ok: false, detalle: expect.stringMatching(/no permite leer Gmail.*gws auth login/) });
    scope = SCOPES; tokenError = { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' };
    expect(await g.probar({})).toMatchObject({ ok: false, detalle: expect.stringMatching(/sesión de gws \(caducada o revocada\)/) });
  });

  it('half a client is an error, not gws', async () => {
    const g = createGoogle(fakeStore());
    expect(await g.probar({ clientId: fakeClientId('123-abc') })).toMatchObject({ ok: false, detalle: expect.stringMatching(/secreto/) });
    expect(gws.llamadas).toHaveLength(0);
  });
});

describe('gwsCredentials', () => {
  it('without a gws session by default, tries command-center-starter\'s directory with the file backend', async () => {
    const centro = path.join(process.env.HOME!, '.config/gws-command-center'); mkdirSync(centro, { recursive: true });
    gws.salidas.set('default', NO_SESSION); gws.salidas.set(centro, JSON.stringify(CRED));
    expect(await gwsCredentials()).toEqual({ client_id: CRED.client_id, client_secret: CRED.client_secret, refresh_token: CRED.refresh_token });
    expect(gws.llamadas.map(l => [l.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR, l.env.GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND])).toEqual([[undefined, undefined], [centro, 'file']]);
  });
  it('respects GOOGLE_WORKSPACE_CLI_CONFIG_DIR and stops there; no gws installed is no session', async () => {
    mkdirSync(path.join(process.env.HOME!, '.config/gws-command-center'), { recursive: true });
    process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR = '/tmp/otro-gws';
    gws.salidas.set('/tmp/otro-gws', NO_SESSION);
    expect(await gwsCredentials()).toBeNull();
    expect(gws.llamadas).toHaveLength(1);
    delete process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR; gws.llamadas = []; gws.salidas.clear();
    expect(await gwsCredentials()).toBeNull();
  });
  it('missingScopes accepts broader scopes', () => {
    expect(missingScopes(SCOPES)).toEqual([]);
    expect(missingScopes('https://mail.google.com/ https://www.googleapis.com/auth/calendar.events.readonly')).toEqual([]);
    expect(missingScopes('openid https://www.googleapis.com/auth/gmail.metadata')).toEqual(['Gmail', 'Google Calendar']);
  });
});
