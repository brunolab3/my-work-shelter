// Google (Gmail y Google Calendar), solo lectura: correo sin leer de los últimos 7 días en Recibidos y eventos del
// calendario principal de hoy a +14 días. Cada usuario crea SU cliente OAuth («Aplicación de escritorio») en Google
// Cloud y pega su ID y su secreto en la cámara acorazada (en una app de escritorio el secreto no es confidencial,
// pero va al llavero igualmente). OAuth 2.0 código de autorización + PKCE con retorno a http://localhost:<puerto>.
// Con la pantalla de consentimiento en «Pruebas», Google corta la sesión a los 7 días: se explica al reconectar.
// El refresh token va al llavero (google.refreshToken). El access token vive solo en memoria.
// With both fields empty, the session of the `gws` CLI (Google Workspace CLI) is borrowed instead, as GitHub does
// with `gh`: see gwsCredentials().
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Store } from '../state.ts';
import { ConnectorBase, ConfigSource, ErrorSource, ask, delay, type Field } from './common.ts';
import { readSecret, saveSecret, eraseSecret } from './keychain.ts';
import { listenReturned, type Returned } from './oauth.ts';
import { googleEvents, explainErrorGoogle, explainErrorOAuthGoogle, dayStart, gmailNotification, TIME_ZONE } from './normalize.ts';
import type { CalendarEvent, Notification } from './adapters.ts';
import { t } from '../../shared/language.ts';

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CALENDAR = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
// Solo lectura
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly';
export const SESSION_ACCOUNT = 'google.refreshToken';
const EACH_CALENDAR = 5 * 60_000;
const WITHOUT_SESSION = () => t('integrations.googleNoSession');
const WITHOUT_CLIENT = () => t('integrations.googleNoClient');
// gws errors the user fixes in a terminal: no point in running gws again every minute until then
const GWS_RETRY = 5 * 60_000;

export const FIELDS_GOOGLE: Field[] = [
  { name: 'clientId', label: 'ID de cliente', optional: true, help: 'Google Cloud → APIs y servicios → Credenciales → tu cliente OAuth (tipo «Aplicación de escritorio») → «ID de cliente». Vacíos el ID y el secreto: se usa la sesión de la herramienta gws si la tienes iniciada.', example: '1234567890-abc….apps.googleusercontent.com' },
  { name: 'clientSecret', label: 'Secreto de cliente', secret: true, optional: true, help: 'En el mismo cliente OAuth, «Secreto de cliente». Empieza por GOCSPX-.' },
];
export const hasSessionGoogle = () => readSecret(SESSION_ACCOUNT).then(v => !!v, () => false);

// Credentials of the `gws` session (an authorized_user JSON: client_id, client_secret, refresh_token), read with
// `gws auth export --unmasked` only when the access token has to be renewed, and never stored. gws gets the game's
// environment, so GOOGLE_WORKSPACE_CLI_CONFIG_DIR and GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND apply; without the first,
// command-center-starter's directory (~/.config/gws-command-center, file backend) is tried too.
export interface GwsCredentials { client_id: string; client_secret: string; refresh_token: string }
function gwsExport(env: NodeJS.ProcessEnv): Promise<GwsCredentials | null> {
  return new Promise(resolve => execFile('gws', ['auth', 'export', '--unmasked'], { env, timeout: 10_000 }, (err, output) => {
    if (err) return resolve(null);
    const text = String(output);
    try {
      const j = JSON.parse(text.slice(text.indexOf('{')));
      resolve(j?.client_id && j.client_secret && j.refresh_token ? { client_id: j.client_id, client_secret: j.client_secret, refresh_token: j.refresh_token } : null);
    } catch { resolve(null); }   // not signed in: {"error": …} or nothing
  }));
}
export async function gwsCredentials(): Promise<GwsCredentials | null> {
  const env = process.env;
  const c = await gwsExport(env);
  if (c || env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR) return c;
  const center = path.join(os.homedir(), '.config/gws-command-center');
  return existsSync(center) ? gwsExport({ ...env, GOOGLE_WORKSPACE_CLI_CONFIG_DIR: center, GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND: env.GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND ?? 'file' }) : null;
}
// What a gws session lacks to read mail and calendar, from the `scope` of the token response (broader scopes count)
const NEEDED = [
  { name: 'Gmail', valid: ['gmail.readonly', 'gmail.modify', 'https://mail.google.com/'] },
  { name: 'Google Calendar', valid: ['calendar.readonly', 'calendar', 'calendar.events.readonly', 'calendar.events'] },
];
export function missingScopes(scope: string): string[] {
  const has = new Set(scope.split(/\s+/).map(s => s.replace('https://www.googleapis.com/auth/', '')));
  return NEEDED.filter(n => !n.valid.some(v => has.has(v))).map(n => n.name);
}

class Google extends ConnectorBase {
  id = 'google' as const;
  intervalMs = 60_000;
  private access: { token: string; expires: number } | null = null;
  private email: string | null = null;
  private session = false;
  private listener: Returned | null = null;
  private lastCalendar = 0;
  private metadata = new Map<string, any>();   // id → mensaje (format=metadata): no se vuelve a pedir
  constructor(store: Store) { super(store, new ConfigSource(store, 'google', FIELDS_GOOGLE)); }
  private get client() { return this.config.publicFields().clientId ?? ''; }
  private get ownClient() { return !!this.client && this.config.has('clientSecret'); }
  // both fields empty: the gws session (half a client is a mistake, not gws)
  private get ofGws() { return !this.client && !this.config.has('clientSecret'); }

  protected ready() { return this.ofGws || (this.ownClient && this.session); }
  protected missingConfig() { return this.ownClient ? WITHOUT_SESSION() : WITHOUT_CLIENT(); }
  protected onRestart() { this.access = null; this.email = null; this.lastCalendar = 0; this.metadata.clear(); }
  async poll() { this.session = await hasSessionGoogle(); return super.poll(); }

  // ------------------------------------------------ OAuth
  private async token(body: Record<string, string>) {
    const secret = await this.config.secret('clientSecret');
    if (!this.client || !secret) throw new ErrorSource(WITHOUT_CLIENT());
    const r = await ask(TOKEN, { service: 'Google', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.client, client_secret: secret, ...body }).toString() });
    if (r.state !== 200 || !r.json?.access_token) throw new ErrorSource(explainErrorOAuthGoogle(r.json ?? { error_description: `HTTP ${r.state}` }), undefined, r.json?.error);
    this.access = { token: r.json.access_token, expires: Date.now() + (Number(r.json.expires_in) || 3600) * 1000 };
    if (r.json.refresh_token) { await saveSecret(SESSION_ACCOUNT, r.json.refresh_token); this.session = true; }
    return this.access.token;
  }
  private async tokenGws() {
    const c = await gwsCredentials();
    if (!c) throw new ErrorSource(t('integrations.googleGwsNoSession'), GWS_RETRY);
    const r = await ask(TOKEN, { service: 'Google', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, grant_type: 'refresh_token', refresh_token: c.refresh_token }).toString() });
    if (r.state !== 200 || !r.json?.access_token) {
      if (r.json?.error === 'invalid_grant') throw new ErrorSource(t('integrations.googleGwsSessionExpired'), GWS_RETRY, r.json.error);
      throw new ErrorSource(explainErrorOAuthGoogle(r.json ?? { error_description: `HTTP ${r.state}` }), undefined, r.json?.error);
    }
    const missing = r.json.scope ? missingScopes(String(r.json.scope)) : [];
    if (missing.length) throw new ErrorSource(t('integrations.googleGwsMissingScopes', { faltan: missing.join(', ') }), GWS_RETRY);
    this.access = { token: r.json.access_token, expires: Date.now() + (Number(r.json.expires_in) || 3600) * 1000 };
    return this.access.token;
  }
  private async tokenAccess(force = false) {
    if (!force && this.access && this.access.expires - Date.now() > 5 * 60_000) return this.access.token;
    if (this.ofGws) return this.tokenGws();
    const rt = await readSecret(SESSION_ACCOUNT);
    if (!rt) { this.session = false; throw new ErrorSource(WITHOUT_SESSION()); }
    return this.token({ grant_type: 'refresh_token', refresh_token: rt });
  }
  private async api(url: string, retry = true): Promise<any> {
    const token = await this.tokenAccess();
    const r = await ask(url, { service: 'Google', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (r.state === 401 && retry) { await this.tokenAccess(true); return this.api(url, false); }
    if (r.state === 429 || r.state === 503) throw new ErrorSource(explainErrorGoogle(r.state, r.json), delay(r, 60));
    if (r.state >= 400) throw new ErrorSource(explainErrorGoogle(r.state, r.json));
    return r.json;
  }
  private async whoAmI() {
    if (this.email) return this.email;
    const p = await this.api(`${GMAIL}/profile`);
    return this.email = String(p.emailAddress ?? '');
  }

  async startSession(): Promise<string> {
    if (this.listener) return this.listener.url;
    if (this.ofGws) throw new ErrorSource(t('integrations.googleGwsNoConnect'));
    if (!this.ownClient) throw new ErrorSource(WITHOUT_CLIENT());
    this.listener = await listenReturned({
      service: 'Google',
      // access_type=offline y prompt=consent: Google solo da refresh token así (y otra vez al reconectar)
      authorization: (redirect, state, challenge) => `${AUTHORIZE}?` + new URLSearchParams({ client_id: this.client, response_type: 'code', redirect_uri: redirect, scope: SCOPES, state: state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' }),
      onClose: () => { this.listener = null; },
      onBack: async ({ code, error, redirect, verifier }) => {
        if (error || !code) { const m = explainErrorOAuthGoogle((error ?? {}) as any); this.fail(m); this.notify?.('state'); return { ok: false, title: t('integrations.couldNotConnectWith', { servicio: 'Google' }), text: m }; }
        try {
          await this.token({ grant_type: 'authorization_code', code: code, redirect_uri: redirect, code_verifier: verifier });
          this.email = null; const email = await this.whoAmI();
          this.good(t('integrations.connectedAs', { quien: email })); this.notify?.('activate');
          return { ok: true, title: t('integrations.connected'), text: t('server.doneTheShelterCanNow') };
        } catch (e) { this.fail((e as Error).message); this.notify?.('state'); return { ok: false, title: t('integrations.couldNotConnectWith', { servicio: 'Google' }), text: (e as Error).message }; }
      },
    });
    return this.listener.url;
  }

  // ------------------------------------------------ sondeo
  protected async pollReal() {
    const email = await this.whoAmI();
    const q = new URLSearchParams({ q: 'is:unread in:inbox newer_than:7d', maxResults: '25' });
    const list: { id: string }[] = (await this.api(`${GMAIL}/messages?${q}`)).messages ?? [];
    const notifications: Notification[] = [];
    for (const { id } of list) {
      let m = this.metadata.get(id);
      if (!m) {
        const qm = new URLSearchParams({ format: 'metadata' }); for (const h of ['From', 'Subject', 'Date']) qm.append('metadataHeaders', h);
        m = await this.api(`${GMAIL}/messages/${encodeURIComponent(id)}?${qm}`);
        this.metadata.set(id, m);
      }
      const n = gmailNotification(m); if (n) notifications.push(n);
    }
    const live = new Set(list.map(x => x.id)); for (const id of this.metadata.keys()) if (!live.has(id)) this.metadata.delete(id);
    let events: CalendarEvent[] | undefined;
    if (Date.now() - this.lastCalendar > EACH_CALENDAR) {
      const start = dayStart();
      const qc = new URLSearchParams({ timeMin: new Date(start).toISOString(), timeMax: new Date(start + 15 * 86_400_000).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '100', timeZone: TIME_ZONE });
      events = googleEvents(await this.api(`${CALENDAR}?${qc}`));
      this.lastCalendar = Date.now();
    }
    this.good(t('server.connectedAsUnreadEmailsIn', { correo: email + (this.ofGws ? t('integrations.gwsSession') : ''), notificaciones: notifications.length }));
    return { notifications, complete: true, events };   // lo que se lee en Gmail sale del tablón
  }

  protected async tryReal(v: Record<string, string>) {
    if (!v.clientId && !v.clientSecret) {
      try { this.access = null; this.email = null; await this.tokenGws(); return { ok: true, detail: t('integrations.connectedAs', { quien: await this.whoAmI() + t('integrations.gwsSession') }) }; }
      catch (e) { return { ok: false, detail: (e as Error).message }; }
    }
    if (!v.clientSecret) return { ok: false, detail: WITHOUT_CLIENT() };
    if (!/\.apps\.googleusercontent\.com$/.test(v.clientId ?? '')) return { ok: false, detail: t('server.theClientIdEndsIn') };
    this.session = await hasSessionGoogle();
    if (!this.session) return { ok: true, detail: t('server.oauthClientSavedNowPress') };
    try { this.access = null; this.email = null; return { ok: true, detail: t('integrations.connectedAs', { quien: await this.whoAmI() }) }; }
    catch (e) { return { ok: false, detail: (e as Error).message }; }
  }
  async action(name: string, d: Record<string, any>) {
    if (name === 'forget') await eraseSecret(SESSION_ACCOUNT);
    return super.action(name, d);
  }
  protected async ownAction(name: string, d: Record<string, any>) {
    if (name === 'connect') {
      const url = await this.startSession();
      if (d.open !== false) execFile('/usr/bin/open', [url], () => {});   // navegador del sistema
      return { url };
    }
    if (name === 'disconnect') { await eraseSecret(SESSION_ACCOUNT); this.session = false; this.restart(); this.notify?.('state'); return this.state(); }
    return super.ownAction(name, d);
  }
  stop() { super.stop(); this.listener?.stop(); }
}

export function create(store: Store) { return new Google(store); }
