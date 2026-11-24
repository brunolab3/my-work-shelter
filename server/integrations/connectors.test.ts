// Conectores completos con `fetch` simulado (sin red) y llavero en memoria: Linear (GraphQL), Microsoft 365 y Google
// (OAuth + PKCE), GitHub, Slack y Discord. Comprueba también que los secretos no acaban en el estado.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { Store } from '../state.ts';
import { keychainMemory, useKeychain, keychainMac } from './keychain.ts';
import { create as createLinear, mcpLinear, environmentMcpLinear } from './linear.ts';
import { create as createOutlook } from './outlook.ts';
import { TIME_ZONE } from './normalize.ts';
import { create as createGoogle } from './google.ts';
import { create as createGitHub } from './github.ts';
import { create as createSlack } from './slack.ts';
import { create as createDiscord } from './discord.ts';
import { create as createJira, JQL_MY_TASKS, epicOf, jiraTasks } from './jira.ts';
import { create as createMail } from './mail.ts';
import { create as createCalendar } from './calendar.ts';

const fx = (n: string) => JSON.parse(readFileSync(path.join(import.meta.dirname, '../../test/fixtures', n), 'utf8'));
function fakeStore(): Store {
  const state: any = { integrations: { outlook: { mode: 'real' }, google: { mode: 'real' }, discord: { mode: 'real' }, slack: { mode: 'real' }, github: { mode: 'real' }, linear: { mode: 'real' }, jira: { mode: 'real' }, mail: { mode: 'real' }, calendario: { mode: 'real' } }, viewsNotifications: [], settings: {} };
  return { state, change(f: (e: any) => void) { f(state); }, save() {}, saveAlready() {} } as unknown as Store;
}
// Con forma de token de bot de Discord (id de la app en base64 . marca . firma), armado aquí para que los escáneres de
// secretos no lo confundan con uno real
const tokenFake = (signature: string) => [Buffer.from('1558182258278531074').toString('base64').replace(/=+$/, ''), 'GaBcDe', signature].join('.');
const answer = (body: unknown, state = 200, headers: Record<string, string> = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: state, headers: headers });
let keychain: ReturnType<typeof keychainMemory>;
beforeEach(() => { keychain = keychainMemory(); useKeychain(keychain); });
afterEach(() => { vi.unstubAllGlobals(); useKeychain(keychainMac); });

describe('Linear', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>;
      if (h.Authorization !== 'lin_api_buena') return answer({ errors: [{ message: 'Authentication required, not authenticated', extensions: { code: 'AUTHENTICATION_ERROR' } }] }, 401);
      const q = JSON.parse(String(init.body)).query as string;
      if (q.startsWith('query Viewer')) return answer(fx('viewer.json'));
      if (q.startsWith('query Notificaciones')) return answer(fx('linear_notifications.json'));
      if (q.startsWith('query MisIssues')) return answer(fx('my_issues.json'));
      if (q.startsWith('query EquiposYCiclos')) return answer(fx('teams_cycles.json'));
      if (q.startsWith('query Tablero')) return answer(fx('team_board.json'));
      return answer({ errors: [{ message: 'consulta desconocida' }] }, 400);
    }));
  });
  it('clave sin Bearer en GraphQL; errores claros; panel y tablero', async () => {
    const l = createLinear(fakeStore());
    expect((await l.attempt({ apiKey: 'lin_api_mala' })).detail).toMatch(/no acepta la clave de API/);
    const r = await l.configure({ apiKey: 'lin_api_buena' });
    expect(r).toMatchObject({ ok: true });
    expect(r.detail).toMatch(/Irene Valdés en Taller Ejemplo. Equipos: PLAT, WEB/);
    const s = await l.poll();
    expect(s).toMatchObject({ complete: true });
    expect(s.notifications).toHaveLength(3);   // la leída en Linear no
    expect(l.state().detail).toMatch(/5 issues abiertas/);
    const panel: any = await l.action!('panel', {});
    expect(panel.cycles[0].cycle.number).toBe(34);
    const board: any = await l.action!('board', { team: 'PLAT', priority: 'alta' });
    expect(board.team).toBe('PLAT');
    const body = JSON.parse(String((fetch as any).mock.calls.at(-1)[1].body));
    expect(body.variables).toMatchObject({ teamId: 'a3f9c1d2-5e6b-4c7d-8e9f-0a1b2c3d4e5f', filter: { priority: { lte: 2, neq: 0 } } });
  });
  it('MCP oficial: http, Bearer por variable de entorno (sin la clave en la config)', async () => {
    expect(await mcpLinear()).toEqual({ linear: { type: 'http', url: 'https://mcp.linear.app/mcp' } });
    await keychain.save('linear.apiKey', 'lin_api_buena');
    const m = await mcpLinear();
    expect(m.linear).toEqual({ type: 'http', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer ${SHELTER_LINEAR_CLAVE}' } });
    expect(JSON.stringify(m)).not.toContain('lin_api_buena');
    expect(await environmentMcpLinear()).toEqual({ SHELTER_LINEAR_CLAVE: 'lin_api_buena' });
    expect((await mcpLinear({ onlyReading: true })).linear.url).toBe('https://mcp.linear.app/mcp/readonly');
  });
});

// El navegador volviendo de Microsoft a la escucha de localhost (fetch está simulado: va por node:http)
const navigate = (url: string) => new Promise<string>((resolve, reject) => http.get(url, r => { let t = ''; r.on('data', c => t += c); r.on('end', () => resolve(t)); }).on('error', reject));

const CLIENT_MS = '11111111-2222-4333-8444-555555555555';   // inventado: cada usuario registra su app en Entra
function storeWithMicrosoft() { const a = fakeStore(); a.state.integrations.outlook.fields = { clientId: CLIENT_MS }; return a; }

describe('Microsoft 365 (Outlook)', () => {
  let verifier = '', redirect = '';
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('/oauth2/v2.0/token')) {
        const p = new URLSearchParams(String(init.body));
        expect(p.get('client_id')).toBe(CLIENT_MS);
        if (p.get('grant_type') === 'authorization_code') { verifier = p.get('code_verifier')!; redirect = p.get('redirect_uri')!; expect(p.get('client_secret')).toBeNull(); }
        if (p.get('grant_type') === 'refresh_token' && p.get('refresh_token') === 'revocado') return answer({ error: 'invalid_grant', error_description: 'AADSTS700082: The refresh token has expired due to inactivity.' }, 400);
        return answer(fx('token_response.json'));
      }
      expect((init.headers as any).Authorization).toMatch(/^Bearer /);
      if (url.includes('/me?')) return answer(fx('me.json'));
      if (url.includes('/mailFolders/inbox/messages')) { expect(new URL(url).searchParams.get('$filter')).toMatch(/^receivedDateTime ge \S+Z and isRead eq false$/); return answer({ value: fx('messages_unread.json').value }); }
      if (url.includes('/calendarView')) { expect((init.headers as any).Prefer).toBe(`outlook.timezone="${TIME_ZONE}"`); return answer(fx('calendarview.json')); }
      return answer({ error: { code: 'x' } }, 404);
    }));
  });
  it('sin ID de cliente lo pide; con él pero sin sesión pide conectar; nunca trae un ID de cliente de serie', async () => {
    const o = createOutlook(fakeStore());
    expect(((await o.action!('fields', {})) as any).fields.map((c: any) => c.name)).toEqual(['clientId', 'tenant']);
    await o.poll();
    expect(o.state()).toMatchObject({ state: 'sin-configurar', detail: expect.stringMatching(/ID de aplicación/) });
    await expect(o.action!('connect', { open: false })).rejects.toThrow(/ID de aplicación/);
    expect((await o.attempt({ clientId: 'no-es-un-guid' })).ok).toBe(false);
    const c = createOutlook(storeWithMicrosoft());
    await c.poll();
    expect(c.state()).toMatchObject({ state: 'sin-configurar', detail: expect.stringMatching(/Conectar con Microsoft/) });
    expect(await c.attempt({})).toMatchObject({ ok: true, detail: expect.stringMatching(/Conectar con Microsoft/) });
  });
  it('solo login: conectar → retorno a localhost → refresh token al llavero → sondeo de correo y calendario', async () => {
    const a = storeWithMicrosoft();
    const o = createOutlook(a);
    const notices: string[] = []; o.notify = x => notices.push(x);
    const { url } = await o.action!('connect', { open: false }) as { url: string };
    const q = new URL(url).searchParams;
    expect(url.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?')).toBe(true);
    expect(q.get('client_id')).toBe(CLIENT_MS);
    expect(q.get('redirect_uri')).toMatch(/^http:\/\/localhost:\d+$/);
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('scope')).toBe('openid profile offline_access User.Read Mail.Read Calendars.Read');   // solo lectura
    expect(await o.action!('connect', { open: false })).toEqual({ url });   // una sola escucha a la vez
    expect(await navigate(`${q.get('redirect_uri')}/?code=x&state=inventado`)).toMatch(/caducado/);
    const html = await navigate(`${q.get('redirect_uri')}/?code=CODIGO&state=${q.get('state')}`);
    expect(html).toMatch(/Puedes volver a work-shelter/);
    expect(redirect).toBe(q.get('redirect_uri'));
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(q.get('code_challenge'));
    expect(keychain.data.get('outlook.refreshToken')).toBe(fx('token_response.json').refresh_token);
    expect(JSON.stringify(a.state)).not.toContain('REFRESH');
    expect(notices).toContain('activar');
    const r = await o.poll();
    expect(r.notifications).toHaveLength(4);
    expect(r.events).toHaveLength(3);
    expect(o.state()).toMatchObject({ state: 'conectada' });
    expect(o.state().detail).toMatch(/Irene Valdés/);
    await expect(navigate(q.get('redirect_uri')!)).rejects.toThrow();   // la escucha se cierra tras el retorno
  });
  it('con la sesión ya en el llavero sondea sin volver a pedir login', async () => {
    await keychain.save('outlook.refreshToken', 'guardado');
    const o = createOutlook(storeWithMicrosoft());
    const r = await o.poll();
    expect(r.notifications).toHaveLength(4);
    expect(o.state()).toMatchObject({ state: 'conectada' });
  });
  it('error de consentimiento en el retorno', async () => {
    const o = createOutlook(storeWithMicrosoft());
    const { url } = await o.action!('connect', { open: false }) as { url: string };
    const q = new URL(url).searchParams;
    expect(await navigate(`${q.get('redirect_uri')}/?error=access_denied&error_subcode=cancel&error_description=AADSTS65004%3A+User+declined&state=${q.get('state')}`)).toMatch(/no concedió/);
    expect(o.state().state).toBe('error');
  });
  it('refresh token caducado → error con instrucción de reconectar', async () => {
    const o = createOutlook(storeWithMicrosoft());
    await keychain.save('outlook.refreshToken', 'revocado');
    await expect(o.poll()).rejects.toThrow(/caducó o se revocó/);
    expect(o.state()).toMatchObject({ state: 'error' });
  });
});

describe('Google', () => {
  let verifier = '', secret = '';
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        const p = new URLSearchParams(String(init.body));
        expect(p.get('client_id')).toBe('123-abc.apps.googleusercontent.com'); secret = p.get('client_secret')!;
        if (p.get('grant_type') === 'authorization_code') verifier = p.get('code_verifier')!;
        return answer({ access_token: 'ya29.FAKE', expires_in: 3599, refresh_token: '1//REFRESH-FAKE', token_type: 'Bearer' });
      }
      expect((init.headers as any).Authorization).toBe('Bearer ya29.FAKE');
      if (url.endsWith('/users/me/profile')) return answer({ emailAddress: 'irene.valdes@taller.example' });
      if (url.includes('/users/me/messages?')) { expect(new URL(url).searchParams.get('q')).toBe('is:unread in:inbox newer_than:7d'); return answer({ messages: fx('gmail_messages.json').mensajes.map((m: any) => ({ id: m.id, threadId: m.threadId })) }); }
      if (url.includes('/users/me/messages/')) { const id = decodeURIComponent(new URL(url).pathname.split('/').pop()!); return answer(fx('gmail_messages.json').mensajes.find((m: any) => m.id === id)); }
      if (url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events?')) return answer(fx('google_calendar_events.json'));
      return answer({ error: { message: 'no' } }, 404);
    }));
  });
  it('cliente OAuth propio → conectar → retorno a localhost → secreto y sesión solo en el llavero → correo y calendario', async () => {
    const a = fakeStore();
    const g = createGoogle(a);
    expect((await g.attempt({ clientId: 'no-vale', clientSecret: 'x' })).ok).toBe(false);
    expect(await g.configure({ clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-FAKE' })).toMatchObject({ ok: true, detail: expect.stringMatching(/Conectar con Google/) });
    const { url } = await g.action!('connect', { open: false }) as { url: string };
    const q = new URL(url).searchParams;
    expect(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true);
    expect(q.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly');
    expect(q.get('access_type')).toBe('offline');
    expect(await navigate(`${q.get('redirect_uri')}/?code=CODIGO&state=${q.get('state')}`)).toMatch(/Puedes volver a work-shelter/);
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(q.get('code_challenge'));
    expect(secret).toBe('GOCSPX-FAKE');
    expect(keychain.data.get('google.refreshToken')).toBe('1//REFRESH-FAKE');
    expect(JSON.stringify(a.state)).not.toMatch(/GOCSPX|REFRESH/);
    const r = await g.poll();
    expect(r.notifications).toHaveLength(2);
    expect(r.events).toHaveLength(3);
    expect(g.state()).toMatchObject({ state: 'conectada', detail: expect.stringMatching(/irene.valdes@taller.example/) });
  });
});

describe('GitHub', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if ((init.headers as any).Authorization !== 'Bearer ghp_bueno') return answer({ message: 'Bad credentials' }, 401);
      if (url.endsWith('/user')) return answer({ login: 'irene-valdes' });
      if (url.includes('/notifications')) return (init.headers as any)['If-Modified-Since'] ? new Response(null, { status: 304 }) : answer(fx('github_notifications.json'), 200, { 'last-modified': 'Sat, 10 Oct 2026 08:00:00 GMT' });
      return answer({}, 404);
    }));
  });
  it('token malo con mensaje claro; bueno: notificaciones completas y un 304 conserva lo que había', async () => {
    const a = fakeStore();
    const g = createGitHub(a);
    expect((await g.attempt({ token: 'ghp_malo' })).detail).toMatch(/no acepta el token/);
    expect(await g.configure({ token: 'ghp_bueno' })).toMatchObject({ ok: true, detail: expect.stringMatching(/irene-valdes/) });
    expect(JSON.stringify(a.state)).not.toContain('ghp_bueno');
    const r1 = await g.poll();
    expect(r1).toMatchObject({ complete: true });
    expect(r1.notifications).toHaveLength(4);
    const r2 = await g.poll();
    expect(r2.notifications).toHaveLength(4);
  });
});

describe('Slack', () => {
  beforeEach(() => {
    const data = fx('slack_history.json');
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if ((init.headers as any).Authorization !== 'Bearer xoxp-bueno') return answer({ ok: false, error: 'invalid_auth' });
      const u = new URL(url), m = u.pathname.slice(5);
      if (m === 'auth.test') return answer({ ok: true, team: 'Taller Ejemplo', team_id: 'T0000EQUIPO', user: 'yo', user_id: 'U0000YO' });
      if (m === 'users.conversations') return answer({ ok: true, channels: data.canales });
      if (m === 'users.info') return answer({ ok: true, user: { id: u.searchParams.get('user'), real_name: 'Persona ' + u.searchParams.get('user')!.slice(5) } });
      if (m === 'conversations.history') return answer({ ok: true, messages: u.searchParams.get('channel') === 'C0000GENERAL' && !u.searchParams.get('oldest')!.startsWith('1791622800') ? data.messages ?? data.mensajes : [] });
      return answer({ ok: false, error: 'unknown_method' });
    }));
  });
  it('token de usuario: quién soy, canales, mensajes nuevos una sola vez y selector de canales', async () => {
    const a = fakeStore();
    const s = createSlack(a);
    expect((await s.attempt({ token: 'nada' })).ok).toBe(false);
    expect((await s.attempt({ token: 'xoxp-malo' })).detail).toMatch(/no acepta el token/);
    expect(await s.configure({ token: 'xoxp-bueno' })).toMatchObject({ ok: true, detail: expect.stringMatching(/Taller Ejemplo/) });
    expect(JSON.stringify(a.state)).not.toContain('xoxp-bueno');
    const r1 = await s.poll();
    expect(r1.notifications!.map(n => n.priority)).toEqual(['alta', 'media', 'baja']);   // mención a mí, @here, adjunto
    expect((await s.poll()).notifications).toHaveLength(0);   // desde el último visto
    const channels: any = await s.action!('channels', {});
    expect(channels.map((c: any) => c.name)).toEqual(['equipo-web', 'general']);
  });
});

describe('Discord (prueba de conexión)', () => {
  it('token de bot válido, intents y servidores; token inválido con mensaje claro', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>;
      if (!h.Authorization.startsWith('Bot ') || !h.Authorization.endsWith('.buena-firma-del-token-xyz')) return answer({ message: '401: Unauthorized', code: 0 }, 401);
      if (url.endsWith('/applications/@me')) return answer(fx('application_me.json'));
      if (url.endsWith('/users/@me/guilds')) return answer([{ id: '1186246479052931073', name: 'Taller Ejemplo' }]);
      return answer({}, 404);
    }));
    const d = createDiscord(fakeStore());
    expect((await d.attempt({ token: 'hola' })).detail).toMatch(/no parece un token de bot/);
    expect((await d.attempt({ token: tokenFake('otra-firma-cualquiera-0123456789') })).detail).toMatch(/token del bot no es válido/);
    const ok = await d.attempt({ token: tokenFake('buena-firma-del-token-xyz') });
    expect(ok).toMatchObject({ ok: true });
    expect(ok.detail).toMatch(/Taller Ejemplo.*Message Content Intent» activado/);
  });
});

describe('Discord (Gateway simulado en 127.0.0.1)', () => {
  it('Hello → Identify con intents mínimos → READY/GUILD_CREATE → MESSAGE_CREATE en tiempo real; 4004 → error claro', async () => {
    const { WebSocketServer } = await import('ws');
    const { useGatewayOfTest } = await import('./discord.ts');
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise(r => wss.once('listening', r));
    useGatewayOfTest(`ws://127.0.0.1:${(wss.address() as any).port}/?v=10&encoding=json`);
    const TOKEN = tokenFake('buena-firma-del-token-xyz');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/applications/@me')) return answer(fx('application_me.json'));
      if (url.includes('/members/')) return answer(fx('guild_member.json'));
      if (url.includes('/channels/')) return answer([]);
      return answer({}, 404);
    }));
    const received: any[] = [];
    let socket: any;
    wss.on('connection', ws => {
      socket = ws;
      ws.on('message', d => received.push(JSON.parse(String(d))));
      ws.send(JSON.stringify(fx('gateway_hello.json')));
    });
    const a = fakeStore();
    const d = createDiscord(a);
    const notices: string[] = []; d.notify = x => notices.push(x);
    await d.configure({ token: TOKEN }).catch(() => {});   // la prueba REST de servidores no está simulada: da igual aquí
    await keychain.save('discord.token', TOKEN); a.state.integrations.discord.secrets = ['token'];
    expect(await d.poll()).toEqual({ notifications: [] });
    await vi.waitFor(() => expect(received.find(m => m.op === 2)).toBeTruthy(), { timeout: 3000 });
    const ident = received.find(m => m.op === 2);
    expect(ident.d.intents).toBe(33281);
    expect(ident.d.token).toBe(TOKEN);
    const g = fx('guild_channels.json');
    socket.send(JSON.stringify(fx('gateway_ready.json')));
    socket.send(JSON.stringify({ op: 0, s: 2, t: 'GUILD_CREATE', d: { id: '1186246479052931073', name: 'Taller Ejemplo', roles: [{ id: '1186247737344131078', name: 'plataforma' }], channels: g, threads: [] } }));
    await vi.waitFor(() => expect(d.state().state).toBe('conectada'));
    socket.send(JSON.stringify(fx('message_create.json')));
    await vi.waitFor(() => expect(notices).toContain('sondear'));
    const r = await d.poll();
    expect(r.notifications!.map(n => [n.priority, n.channel])).toEqual([['alta', '#despliegues']]);
    expect(r.notifications![0].snippet).toMatch(/^@Irene Valdés @plataforma staging/);
    socket.close(4004, 'Authentication failed.');
    await vi.waitFor(() => expect(d.state().state).toBe('error'));
    expect(d.state().detail).toMatch(/token del bot no es válido/);
    d.stop!();
    await new Promise(r => wss.close(r));
  });
});

describe('Jira epics', () => {
  const parent = (key: string, issuetype: Record<string, unknown>) => ({ key, fields: { summary: 'Sum ' + key, issuetype } });
  it('the parent is the epic only when it is one (type Epic in any language via hierarchy level 1)', () => {
    expect(epicOf(parent('tal-1', { name: 'Epic', hierarchyLevel: 1 }))).toEqual({ key: 'TAL-1', title: 'Sum tal-1' });
    expect(epicOf(parent('TAL-2', { name: 'Épica', hierarchyLevel: 1 }))).toEqual({ key: 'TAL-2', title: 'Sum TAL-2' });
    expect(epicOf(parent('TAL-3', { name: 'epic' }))).toEqual({ key: 'TAL-3', title: 'Sum TAL-3' });
    expect(epicOf(parent('TAL-4', { name: 'Story', hierarchyLevel: 0 }))).toBeUndefined();   // a subtask's parent
    expect(epicOf(parent('TAL-5', { name: 'Initiative', hierarchyLevel: 2 }))).toBeUndefined();
    expect(epicOf(undefined)).toBeUndefined();
  });
  it('tasks carry their epic, and nothing without one', () => {
    const issue = (key: string, p?: unknown) => ({ key, fields: { summary: key, status: { name: 'To Do', statusCategory: { key: 'new' } }, updated: '2026-11-08T10:00:00.000+0100', ...(p ? { parent: p } : {}) } });
    const [a, b, c] = jiraTasks({ issues: [issue('TAL-7', parent('TAL-1', { name: 'Epic', hierarchyLevel: 1 })), issue('TAL-8'), issue('TAL-9', parent('TAL-7', { name: 'Task', hierarchyLevel: 0 }))] }, 'taller.atlassian.net');
    expect(a.epic).toEqual({ key: 'TAL-1', title: 'Sum TAL-1' });
    expect('epic' in b).toBe(false);
    expect('epic' in c).toBe(false);
  });
  it('an epic on the board is its own epic', () => {
    const [e] = jiraTasks({ issues: [{ key: 'tal-1', fields: { summary: 'The epic', issuetype: { name: 'Epic', hierarchyLevel: 1 }, status: { name: 'To Do', statusCategory: { key: 'new' } } } }] }, 'taller.atlassian.net');
    expect(e.epic).toEqual({ key: 'TAL-1', title: 'The epic' });
  });
});

describe('Jira', () => {
  const basic = 'Basic ' + Buffer.from('ana@taller.example:tok-bueno').toString('base64');
  const issue = (key: string, state: string, cat: string) => ({ id: key, key, fields: { summary: 'Tarea ' + key, status: { name: state, statusCategory: { key: cat } }, priority: { name: 'High' }, issuetype: { name: 'Historia' }, project: { name: 'Taller' }, updated: '2026-11-08T10:00:00.000+0100' } });
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if ((init.headers as Record<string, string>).Authorization !== basic) return answer({ errorMessages: ['Unauthorized'] }, 401);
      if (url === 'https://taller.atlassian.net/rest/api/3/myself') return answer({ accountId: 'a1', displayName: 'Ana Ruiz' });
      if (url === 'https://taller.atlassian.net/rest/api/3/search/jql') {
        const b = JSON.parse(String(init.body));
        if (!b.nextPageToken) return answer({ issues: [issue('TAL-7', 'En revisión', 'indeterminate')], nextPageToken: 'p2', isLast: false });
        return answer({ issues: [issue('TAL-3', 'Hecho', 'done')], isLast: true });
      }
      const tr = (id: string, name: string, to: string, key: string) => ({ id, name, to: { name: to, statusCategory: { key } } });
      if (url === 'https://taller.atlassian.net/rest/api/3/issue/TAL-7/transitions' && init.method === 'GET')
        return answer({ transitions: [tr('31', 'Done', 'Hecho', 'done'), tr('32', 'Descartar', 'Descartada', 'done'), tr('11', 'Volver', 'En curso', 'indeterminate')] });
      if (url === 'https://taller.atlassian.net/rest/api/3/issue/TAL-7/transitions') return answer(undefined, 204);
      if (url === 'https://taller.atlassian.net/rest/api/3/issue/TAL-9/transitions' && init.method === 'GET') return answer({ transitions: [tr('31', 'Done', 'Hecho', 'done')] });
      if (url === 'https://taller.atlassian.net/rest/api/3/issue/TAL-9/transitions') return answer({ errorMessages: ['Forbidden'] }, 403);
      if (url === 'https://taller.atlassian.net/rest/api/3/project/TAL/statuses') {
        const st = (name: string, key: string) => ({ id: name, name, statusCategory: { key } });
        return answer([{ name: 'Tarea', statuses: [st('Por hacer', 'new'), st('Prueba en producción', 'indeterminate'), st('Hecho', 'done')] }, { name: 'Error', statuses: [st('Hecho', 'done'), st('Descartada', 'done')] }]);
      }
      return answer({}, 404);
    }));
  });
  it('autenticación básica, sitio normalizado, tareas paginadas con su estado y el secreto fuera del estado', async () => {
    const a = fakeStore();
    const j = createJira(a);
    expect((await j.attempt({ sitio: 'taller.atlassian.net', correo: 'ana@taller.example', token: 'tok-malo' })).detail).toMatch(/no acepta el correo y el token/);
    const r = await j.configure({ sitio: 'https://Taller.atlassian.net/jira/your-work', correo: 'ana@taller.example', token: 'tok-bueno' });
    expect(r).toEqual({ ok: true, detail: 'Conectado como Ana Ruiz en taller.atlassian.net.' });
    expect(await j.poll()).toEqual({});
    expect(j.state().detail).toBe('Conectado como Ana Ruiz. 1 tareas abiertas asignadas.');
    const p: any = await j.action!('panel', { force: true });
    expect(p.tareas.map((t: any) => [t.key, t.state, t.category, t.url])).toEqual([
      ['TAL-7', 'En revisión', 'indeterminate', 'https://taller.atlassian.net/browse/TAL-7'],
      ['TAL-3', 'Hecho', 'done', 'https://taller.atlassian.net/browse/TAL-3'],
    ]);
    expect(JSON.parse(String((fetch as any).mock.calls.at(-2)[1].body)).jql).toBe(JQL_MY_TASKS);
    expect(JSON.stringify(a.state)).not.toContain('tok-bueno');
    expect(await keychain.read('jira.token')).toBe('tok-bueno');
  });
  it('moving a card: only the transitions Jira offers towards that column, and the one write is the confirmed one', async () => {
    const j = createJira(fakeStore());
    await j.configure({ sitio: 'taller.atlassian.net', correo: 'ana@taller.example', token: 'tok-bueno' });
    await j.action!('panel', { force: true });
    const r: any = await j.action!('transitions', { key: 'tal-7', column: 'hecho', current: 'En revisión' });
    expect(r.transitions.map((x: any) => [x.id, x.a])).toEqual([['31', 'Hecho'], ['32', 'Descartada']]);
    expect(((await j.action!('transitions', { key: 'TAL-7', column: 'porHacer' })) as any).transitions).toEqual([]);
    await expect(j.action!('transitions', { key: 'TAL-7', column: 'Done' })).rejects.toThrow(/columna no es del tablero/);
    await expect(j.action!('move', { key: '../myself', column: 'hecho', id: '31' })).rejects.toThrow(/Clave de Jira no válida/);
    // an id Jira doesn't offer towards that column is never posted
    const before = (fetch as any).mock.calls.length;
    await expect(j.action!('move', { key: 'TAL-7', column: 'enCurso', id: '31' })).rejects.toThrow(/ya no ofrece ese cambio/);
    expect((fetch as any).mock.calls.slice(before).every((c: any) => c[1].method === 'GET')).toBe(true);
    expect(await j.action!('move', { key: 'TAL-7', column: 'hecho', id: '32' })).toEqual({ key: 'TAL-7', state: 'Descartada', category: 'done' });
    const [url, init] = (fetch as any).mock.calls.at(-1);
    expect([url, init.method, JSON.parse(init.body)]).toEqual(['https://taller.atlassian.net/rest/api/3/issue/TAL-7/transitions', 'POST', { transition: { id: '32' } }]);
    // the cached board already has the new status (Jira's search lags behind)
    expect(((await j.action!('panel', {})) as any).tareas.find((x: any) => x.key === 'TAL-7')).toMatchObject({ state: 'Descartada', category: 'done' });
    await expect(j.action!('move', { key: 'TAL-9', column: 'hecho', id: '31' })).rejects.toThrow(/Transicionar incidencias/);
  });
  it("the prod-check column: only transitions to Jira's prod-check status", async () => {
    const a = fakeStore();
    const j = createJira(a);
    await j.configure({ sitio: 'taller.atlassian.net', correo: 'ana@taller.example', token: 'tok-bueno' });
    const ids = async (column: string) => ((await j.action!('transitions', { key: 'TAL-7', column })) as any).transitions.map((x: any) => x.id);
    expect(await ids('prodCheck')).toEqual([]);
    // a project's statuses, with those in the done category (the game links Jira's pair from them)
    expect(await j.action!('boardStates', { board: 'tal' })).toEqual({ states: ['Por hacer', 'Prueba en producción', 'Hecho', 'Descartada'], done: ['Hecho', 'Descartada'] });
    (a.state.settings as any).verificationJira = { test: 'Descartada' };
    expect(await ids('prodCheck')).toEqual(['32']);
    expect(await ids('hecho')).toEqual(['31']);
  });
});

describe('Mail del Mac', () => {
  const data = fx('mail_jxa.json');
  it('sin proyecto ni secretos: lee Mail, filtra cuentas, guarda los fragmentos y explica Mail cerrada o sin cuentas', async () => {
    const requests: string[][] = [];
    let answer: any = data;
    const a = fakeStore();
    const m = createMail(a, async known => { requests.push(known); return answer; });
    expect(await m.configure({})).toMatchObject({ ok: true, detail: 'Mail responde. Cuentas: irene.valdes@taller.example (Gmail), irene@casa.example.' });
    const s = await m.poll();
    expect(s).toMatchObject({ complete: true });
    expect(s.notifications!.map(n => n.id)).toEqual(['mail-CAF-1a2b3c@mail.gmail.com', 'mail-abc-77@correo.example', 'mail-CAF-9z@mail.gmail.com']);
    // el texto ya leído no se vuelve a pedir, pero el fragmento sigue
    answer = { ...data, mensajes: data.mensajes.map((x: any) => ({ ...x, texto: undefined })) };
    const s2 = await m.poll();
    expect(requests.at(-1)).toEqual(expect.arrayContaining(['CAF-1a2b3c@mail.gmail.com', '<abc-77@correo.example>']));
    expect(s2.notifications![0].snippet).toMatch(/^Le he echado un ojo/);
    // solo la cuenta de Google
    expect(await m.configure({ cuentas: 'irene.valdes@taller.example' })).toMatchObject({ ok: true });
    expect((await m.poll()).notifications!.every(n => n.channel === 'Google')).toBe(true);
    expect(m.state().detail).toMatch(/2 correos sin leer/);
    answer = { cerrada: true };
    await expect(m.poll()).rejects.toThrow(/Mail está cerrada/);
    answer = { cuentas: [], mensajes: [] };
    expect((await m.attempt({})).detail).toMatch(/Cuentas de internet/);
    expect(keychain.data.size).toBe(0);   // nada al llavero
    expect(a.state.integrations.mail.fields).toEqual({ cuentas: 'irene.valdes@taller.example' });
  });
});

describe('Calendario del Mac', () => {
  it('sin secretos: lee Calendario, filtra calendarios y explica Calendario cerrada o sin calendarios', async () => {
    const today = new Date(); today.setHours(10, 0, 0, 0);
    let answer: any = { calendarios: ['trabajo@taller.example', 'Festivos'], eventos: [
      { calendario: 'trabajo@taller.example', uid: 'A', titulo: 'Daily', inicio: today.getTime(), fin: today.getTime() + 900_000, allElDay: false },
      { calendario: 'Festivos', uid: 'B', titulo: 'Fiesta', inicio: today.getTime(), fin: today.getTime() + 3_600_000, allElDay: false },
    ] };
    const requests: number[][] = [];
    const a = fakeStore();
    const c = createCalendar(a, async (since, until) => { requests.push([since, until]); return answer; });
    expect(await c.configure({})).toMatchObject({ ok: true, detail: 'Calendario responde. Calendarios: trabajo@taller.example, Festivos.' });
    expect((await c.poll()).events!.map(e => e.title)).toEqual(['Daily', 'Fiesta']);
    expect(requests[0][1] - requests[0][0]).toBe(14 * 86_400_000);
    expect(await c.configure({ calendarios: 'trabajo@taller.example' })).toMatchObject({ ok: true });
    expect((await c.poll()).events!.map(e => e.title)).toEqual(['Daily']);
    expect(c.state().detail).toMatch(/1 evento en 14 días/);
    answer = { cerrada: true };
    await expect(c.poll()).rejects.toThrow(/Calendario está cerrada/);
    answer = { calendarios: [], eventos: [] };
    expect((await c.attempt({})).detail).toMatch(/Cuentas de internet/);
    expect(keychain.data.size).toBe(0);
  });
});
