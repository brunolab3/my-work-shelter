// Microsoft 365 (Outlook) por Microsoft Graph, solo lectura: correo no leído reciente de la bandeja de entrada
// (metadatos + fragmento) y calendarView de hoy a +14 días. Cada usuario registra SU aplicación en Microsoft Entra
// (cliente público, plataforma «Aplicaciones móviles y de escritorio» con la redirección http://localhost) y pega su ID
// de cliente en la cámara acorazada: el refugio no trae identificadores de cliente de nadie. OAuth 2.0 código de
// autorización + PKCE con retorno a http://localhost:<puerto aleatorio> (Entra admite cualquier puerto en localhost).
// El refresh token va al llavero (outlook.refreshToken). El access token vive solo en memoria.
import { execFile } from 'node:child_process';
import type { Store } from '../state.ts';
import { ConnectorBase, ConfigSource, ErrorSource, ask, delay, type Field } from './common.ts';
import { readSecret, saveSecret, eraseSecret } from './keychain.ts';
import { listenReturned, type Returned } from './oauth.ts';
import { mailsToNotifications, outlookEvents, explainErrorGraph, explainErrorMicrosoft, dayStart, TIME_ZONE, type MicrosoftMe } from './normalize.ts';
import type { CalendarEvent, Notification } from './adapters.ts';
import { t } from '../../shared/language.ts';

const authority = (tenant?: string) => `https://login.microsoftonline.com/${encodeURIComponent(tenant || 'common')}/oauth2/v2.0`;
// Solo lectura: el refugio no envía, mueve ni borra correo, ni toca el calendario
const SCOPES = 'openid profile offline_access User.Read Mail.Read Calendars.Read';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FIELDS_OUTLOOK: Field[] = [
  { name: 'clientId', label: 'ID de aplicación (cliente)', help: 'Microsoft Entra → Registros de aplicaciones → tu app → «Id. de aplicación (cliente)». Es un GUID; no es secreto.', example: '00000000-0000-0000-0000-000000000000' },
  { name: 'tenant', label: 'Inquilino', optional: true, help: 'Vacío: «common» (cuentas de trabajo y personales, según cómo registraste la app). Si la app es de una sola organización, pon su «Id. de directorio (inquilino)».', example: 'common' },
];
export const SESSION_ACCOUNT = 'outlook.refreshToken';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const EACH_CALENDAR = 5 * 60_000;
const WITHOUT_SESSION = () => t('integrations.msNoSession');
const WITHOUT_CLIENT = () => t('integrations.msNoClient');

export const hasSessionMicrosoft = () => readSecret(SESSION_ACCOUNT).then(v => !!v, () => false);

class Outlook extends ConnectorBase {
  id = 'outlook' as const;
  intervalMs = 60_000;
  private access: { token: string; expires: number } | null = null;
  private me: MicrosoftMe | null = null;
  private session = false;          // hay refresh token en el llavero
  private listener: Returned | null = null;
  private lastCalendar = 0;
  constructor(store: Store) { super(store, new ConfigSource(store, 'outlook', FIELDS_OUTLOOK)); }
  private get client() { return this.config.publicFields().clientId ?? ''; }
  private get authority() { return authority(this.config.publicFields().tenant); }

  protected ready() { return !!this.client && this.session; }
  protected missingConfig() { return this.client ? WITHOUT_SESSION() : WITHOUT_CLIENT(); }
  protected onRestart() { this.access = null; this.me = null; this.lastCalendar = 0; }
  async poll() { this.session = await hasSessionMicrosoft(); return super.poll(); }

  // ------------------------------------------------ OAuth
  private async token(body: Record<string, string>) {
    if (!this.client) throw new ErrorSource(WITHOUT_CLIENT());
    const r = await ask(`${this.authority}/token`, { service: 'Microsoft', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.client, ...body }).toString() });
    if (r.state !== 200 || !r.json?.access_token) throw new ErrorSource(explainErrorMicrosoft(r.json ?? { error_description: `HTTP ${r.state}` }), undefined, r.json?.error);
    this.access = { token: r.json.access_token, expires: Date.now() + (Number(r.json.expires_in) || 3600) * 1000 };
    if (r.json.refresh_token) { await saveSecret(SESSION_ACCOUNT, r.json.refresh_token); this.session = true; }   // rota: se sustituye siempre
    return this.access.token;
  }
  private async tokenAccess(force = false) {
    if (!force && this.access && this.access.expires - Date.now() > 5 * 60_000) return this.access.token;
    const rt = await readSecret(SESSION_ACCOUNT);
    if (!rt) { this.session = false; throw new ErrorSource(WITHOUT_SESSION()); }
    return this.token({ grant_type: 'refresh_token', refresh_token: rt, scope: SCOPES.replace('openid profile ', '') });
  }
  private async graph(path: string, headers: Record<string, string> = {}, retry = true): Promise<any> {
    const token = await this.tokenAccess();
    const r = await ask(path.startsWith('http') ? path : GRAPH + path, { service: 'Microsoft Graph', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...headers } });
    if (r.state === 401 && retry) { await this.tokenAccess(true); return this.graph(path, headers, false); }
    if (r.state === 429 || r.state === 503) throw new ErrorSource(explainErrorGraph(r.state, r.json), delay(r, 60));
    if (r.state >= 400) throw new ErrorSource(explainErrorGraph(r.state, r.json));
    return r.json;
  }
  private async whoAmI() {
    if (this.me) return this.me;
    const me = await this.graph('/me?$select=id,displayName,mail,userPrincipalName');
    return this.me = { name: me.displayName, email: me.mail || me.userPrincipalName };
  }

  // Escucha de un solo uso en localhost hasta que Microsoft vuelve con el código (oauth.ts). Devuelve la URL de inicio de sesión.
  async startSession(): Promise<string> {
    if (this.listener) return this.listener.url;
    if (!GUID.test(this.client)) throw new ErrorSource(WITHOUT_CLIENT());
    this.listener = await listenReturned({
      service: 'Microsoft',
      authorization: (redirect, state, challenge) => `${this.authority}/authorize?` + new URLSearchParams({ client_id: this.client, response_type: 'code', redirect_uri: redirect, response_mode: 'query', scope: SCOPES, state: state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' }),
      onClose: () => { this.listener = null; },
      onBack: async ({ code, error, redirect, verifier }) => {
        if (error || !code) { const m = explainErrorMicrosoft((error ?? {}) as any); this.fail(m); this.notify?.('estado'); return { ok: false, title: t('integrations.couldNotConnectWith', { servicio: 'Microsoft' }), text: m }; }
        try {
          await this.token({ grant_type: 'authorization_code', code: code, redirect_uri: redirect, code_verifier: verifier, scope: SCOPES });
          this.me = null; const me = await this.whoAmI();
          this.good(t('integrations.connectedAs', { quien: me.name ?? me.email })); this.notify?.('activar');
          return { ok: true, title: t('integrations.connected'), text: t('server.doneTheShelterCanNow2', { nombre: me.name ? ', ' + me.name : '' }) };
        } catch (e) { this.fail((e as Error).message); this.notify?.('estado'); return { ok: false, title: t('integrations.couldNotConnectWith', { servicio: 'Microsoft' }), text: (e as Error).message }; }
      },
    });
    return this.listener.url;
  }

  // ------------------------------------------------ sondeo
  protected async pollReal() {
    const me = await this.whoAmI();
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z');
    // $orderby exige que su propiedad vaya primero en $filter (si no: 400 InefficientFilter)
    const q = new URLSearchParams({ $filter: `receivedDateTime ge ${since} and isRead eq false`, $orderby: 'receivedDateTime desc', $select: 'id,conversationId,receivedDateTime,subject,bodyPreview,importance,isRead,webLink,from,sender,toRecipients,flag,inferenceClassification,hasAttachments', $top: '25' });
    const notifications: Notification[] = mailsToNotifications(await this.graph(`/me/mailFolders/inbox/messages?${q}`), me);
    let events: CalendarEvent[] | undefined;
    if (Date.now() - this.lastCalendar > EACH_CALENDAR) {
      const start = dayStart();
      const qc = new URLSearchParams({ startDateTime: new Date(start).toISOString(), endDateTime: new Date(start + 15 * 86_400_000).toISOString(), $select: 'id,subject,bodyPreview,start,end,isAllDay,isCancelled,isOnlineMeeting,onlineMeetingProvider,onlineMeeting,location,organizer,showAs,type,webLink', $orderby: 'start/dateTime', $top: '100' });
      events = [];
      let next: string | undefined = `/me/calendarView?${qc}`;
      for (let page = 0; next && page < 5; page++) {
        const j = await this.graph(next, { Prefer: `outlook.timezone="${TIME_ZONE}"` });
        events.push(...outlookEvents(j)); next = j['@odata.nextLink'];
      }
      this.lastCalendar = Date.now();
    }
    this.good(t('server.connectedAsUnreadEmailsIn', { correo: me.name ?? me.email, notificaciones: notifications.length }));
    return { notifications, complete: true, events };   // lo que se lee en Outlook sale del tablón
  }

  protected async tryReal(v: Record<string, string>) {
    if (!GUID.test(v.clientId ?? '')) return { ok: false, detail: t('server.theApplicationClientIdIs') };
    this.session = await hasSessionMicrosoft();
    if (!this.session) return { ok: true, detail: t('server.applicationIdSavedNowPress') };
    try { this.access = null; this.me = null; const me = await this.whoAmI(); return { ok: true, detail: t('integrations.connectedAsWithMail', { nombre: me.name ?? '', correo: me.email ?? '' }) }; }
    catch (e) { return { ok: false, detail: (e as Error).message }; }
  }
  async action(name: string, d: Record<string, any>) {
    if (name === 'olvidar') await eraseSecret(SESSION_ACCOUNT);
    return super.action(name, d);
  }
  protected async ownAction(name: string, d: Record<string, any>) {
    if (name === 'conectar') {
      const url = await this.startSession();
      if (d.open !== false) execFile('/usr/bin/open', [url], () => {});   // navegador del sistema (sesión de Microsoft ya abierta)
      return { url };
    }
    if (name === 'desconectar') { await eraseSecret(SESSION_ACCOUNT); this.session = false; this.restart(); this.notify?.('estado'); return this.state(); }
    return super.ownAction(name, d);
  }
  stop() { super.stop(); this.listener?.stop(); }
}

export function create(store: Store) { return new Outlook(store); }
