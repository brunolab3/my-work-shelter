// Microsoft 365 (Outlook) por Microsoft Graph, solo lectura: correo no leído reciente de la bandeja de entrada
// (metadatos + fragmento) y calendarView de hoy a +14 días. Cada usuario registra SU aplicación en Microsoft Entra
// (cliente público, plataforma «Aplicaciones móviles y de escritorio» con la redirección http://localhost) y pega su ID
// de cliente en la cámara acorazada: el refugio no trae identificadores de cliente de nadie. OAuth 2.0 código de
// autorización + PKCE con retorno a http://localhost:<puerto aleatorio> (Entra admite cualquier puerto en localhost).
// El refresh token va al llavero (outlook.refreshToken). El access token vive solo en memoria.
import { execFile } from 'node:child_process';
import type { Store } from '../estado.ts';
import { ConnectorBase, ConfigSource, ErrorSource, ask, retraso, type Field } from './comun.ts';
import { readSecret, saveSecret, eraseSecret } from './llavero.ts';
import { listenReturned, type Returned } from './oauth.ts';
import { mailsANotifications, outlookEvents, explainErrorGraph, explainErrorMicrosoft, dayStart, ZONA, type YoMicrosoft } from './normalizar.ts';
import type { Evento, Notification } from './adaptadores.ts';
import { t } from '../../shared/idioma.ts';

const authority = (inquilino?: string) => `https://login.microsoftonline.com/${encodeURIComponent(inquilino || 'common')}/oauth2/v2.0`;
// Solo lectura: el refugio no envía, mueve ni borra correo, ni toca el calendario
const SCOPES = 'openid profile offline_access User.Read Mail.Read Calendars.Read';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FIELDS_OUTLOOK: Field[] = [
  { nombre: 'clientId', etiqueta: 'ID de aplicación (cliente)', ayuda: 'Microsoft Entra → Registros de aplicaciones → tu app → «Id. de aplicación (cliente)». Es un GUID; no es secreto.', ejemplo: '00000000-0000-0000-0000-000000000000' },
  { nombre: 'tenant', etiqueta: 'Inquilino', opcional: true, ayuda: 'Vacío: «common» (cuentas de trabajo y personales, según cómo registraste la app). Si la app es de una sola organización, pon su «Id. de directorio (inquilino)».', ejemplo: 'common' },
];
export const SESSION_ACCOUNT = 'outlook.refreshToken';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const EACH_CALENDAR = 5 * 60_000;
const WITHOUT_SESSION = 'Falta iniciar sesión: pulsa «Conectar con Microsoft» en la cámara acorazada.';
const WITHOUT_CLIENT = 'Falta el ID de aplicación (cliente) de tu registro en Microsoft Entra: pégalo en la cámara acorazada y guarda.';

export const hasSessionMicrosoft = () => readSecret(SESSION_ACCOUNT).then(v => !!v, () => false);

class Outlook extends ConnectorBase {
  id = 'outlook' as const;
  intervalMs = 60_000;
  private acceso: { token: string; caduca: number } | null = null;
  private yo: YoMicrosoft | null = null;
  private sesion = false;          // hay refresh token en el llavero
  private escucha: Returned | null = null;
  private lastCalendar = 0;
  constructor(almacen: Store) { super(almacen, new ConfigSource(almacen, 'outlook', FIELDS_OUTLOOK)); }
  private get cliente() { return this.config.publicos().clientId ?? ''; }
  private get authority() { return authority(this.config.publicos().tenant); }

  protected listo() { return !!this.cliente && this.sesion; }
  protected missingConfig() { return this.cliente ? WITHOUT_SESSION : WITHOUT_CLIENT; }
  protected onRestart() { this.acceso = null; this.yo = null; this.lastCalendar = 0; }
  async sondear() { this.sesion = await hasSessionMicrosoft(); return super.sondear(); }

  // ------------------------------------------------ OAuth
  private async token(cuerpo: Record<string, string>) {
    if (!this.cliente) throw new ErrorSource(WITHOUT_CLIENT);
    const r = await ask(`${this.authority}/token`, { servicio: 'Microsoft', metodo: 'POST', cabeceras: { 'Content-Type': 'application/x-www-form-urlencoded' }, cuerpo: new URLSearchParams({ client_id: this.cliente, ...cuerpo }).toString() });
    if (r.estado !== 200 || !r.json?.access_token) throw new ErrorSource(explainErrorMicrosoft(r.json ?? { error_description: `HTTP ${r.estado}` }), undefined, r.json?.error);
    this.acceso = { token: r.json.access_token, caduca: Date.now() + (Number(r.json.expires_in) || 3600) * 1000 };
    if (r.json.refresh_token) { await saveSecret(SESSION_ACCOUNT, r.json.refresh_token); this.sesion = true; }   // rota: se sustituye siempre
    return this.acceso.token;
  }
  private async tokenAccess(forzar = false) {
    if (!forzar && this.acceso && this.acceso.caduca - Date.now() > 5 * 60_000) return this.acceso.token;
    const rt = await readSecret(SESSION_ACCOUNT);
    if (!rt) { this.sesion = false; throw new ErrorSource(WITHOUT_SESSION); }
    return this.token({ grant_type: 'refresh_token', refresh_token: rt, scope: SCOPES.replace('openid profile ', '') });
  }
  private async graph(ruta: string, cabeceras: Record<string, string> = {}, retry = true): Promise<any> {
    const token = await this.tokenAccess();
    const r = await ask(ruta.startsWith('http') ? ruta : GRAPH + ruta, { servicio: 'Microsoft Graph', cabeceras: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...cabeceras } });
    if (r.estado === 401 && retry) { await this.tokenAccess(true); return this.graph(ruta, cabeceras, false); }
    if (r.estado === 429 || r.estado === 503) throw new ErrorSource(explainErrorGraph(r.estado, r.json), retraso(r, 60));
    if (r.estado >= 400) throw new ErrorSource(explainErrorGraph(r.estado, r.json));
    return r.json;
  }
  private async whoSoy() {
    if (this.yo) return this.yo;
    const me = await this.graph('/me?$select=id,displayName,mail,userPrincipalName');
    return this.yo = { nombre: me.displayName, correo: me.mail || me.userPrincipalName };
  }

  // Escucha de un solo uso en localhost hasta que Microsoft vuelve con el código (oauth.ts). Devuelve la URL de inicio de sesión.
  async startSession(): Promise<string> {
    if (this.escucha) return this.escucha.url;
    if (!GUID.test(this.cliente)) throw new ErrorSource(WITHOUT_CLIENT);
    this.escucha = await listenReturned({
      servicio: 'Microsoft',
      authorization: (redireccion, estado, challenge) => `${this.authority}/authorize?` + new URLSearchParams({ client_id: this.cliente, response_type: 'code', redirect_uri: redireccion, response_mode: 'query', scope: SCOPES, state: estado, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' }),
      onClose: () => { this.escucha = null; },
      onBack: async ({ codigo, error, redireccion, verifier }) => {
        if (error || !codigo) { const m = explainErrorMicrosoft((error ?? {}) as any); this.mal(m); this.avisar?.('estado'); return { ok: false, titulo: 'No se pudo conectar con Microsoft', texto: m }; }
        try {
          await this.token({ grant_type: 'authorization_code', code: codigo, redirect_uri: redireccion, code_verifier: verifier, scope: SCOPES });
          this.yo = null; const yo = await this.whoSoy();
          this.bien(`Conectado como ${yo.nombre ?? yo.correo}.`); this.avisar?.('activar');
          return { ok: true, titulo: 'Conectado', texto: t('server.doneTheShelterCanNow2', { nombre: yo.nombre ? ', ' + yo.nombre : '' }) };
        } catch (e) { this.mal((e as Error).message); this.avisar?.('estado'); return { ok: false, titulo: 'No se pudo conectar con Microsoft', texto: (e as Error).message }; }
      },
    });
    return this.escucha.url;
  }

  // ------------------------------------------------ sondeo
  protected async pollReal() {
    const yo = await this.whoSoy();
    const desde = new Date(Date.now() - 7 * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z');
    // $orderby exige que su propiedad vaya primero en $filter (si no: 400 InefficientFilter)
    const q = new URLSearchParams({ $filter: `receivedDateTime ge ${desde} and isRead eq false`, $orderby: 'receivedDateTime desc', $select: 'id,conversationId,receivedDateTime,subject,bodyPreview,importance,isRead,webLink,from,sender,toRecipients,flag,inferenceClassification,hasAttachments', $top: '25' });
    const notificaciones: Notification[] = mailsANotifications(await this.graph(`/me/mailFolders/inbox/messages?${q}`), yo);
    let eventos: Evento[] | undefined;
    if (Date.now() - this.lastCalendar > EACH_CALENDAR) {
      const ini = dayStart();
      const qc = new URLSearchParams({ startDateTime: new Date(ini).toISOString(), endDateTime: new Date(ini + 15 * 86_400_000).toISOString(), $select: 'id,subject,bodyPreview,start,end,isAllDay,isCancelled,isOnlineMeeting,onlineMeetingProvider,onlineMeeting,location,organizer,showAs,type,webLink', $orderby: 'start/dateTime', $top: '100' });
      eventos = [];
      let siguiente: string | undefined = `/me/calendarView?${qc}`;
      for (let pag = 0; siguiente && pag < 5; pag++) {
        const j = await this.graph(siguiente, { Prefer: `outlook.timezone="${ZONA}"` });
        eventos.push(...outlookEvents(j)); siguiente = j['@odata.nextLink'];
      }
      this.lastCalendar = Date.now();
    }
    this.bien(t('server.connectedAsUnreadEmailsIn', { correo: yo.nombre ?? yo.correo, notificaciones: notificaciones.length }));
    return { notificaciones, complete: true, eventos };   // lo que se lee en Outlook sale del tablón
  }

  protected async tryReal(v: Record<string, string>) {
    if (!GUID.test(v.clientId ?? '')) return { ok: false, detalle: t('server.theApplicationClientIdIs') };
    this.sesion = await hasSessionMicrosoft();
    if (!this.sesion) return { ok: true, detalle: t('server.applicationIdSavedNowPress') };
    try { this.acceso = null; this.yo = null; const yo = await this.whoSoy(); return { ok: true, detalle: `Conectado como ${yo.nombre ?? ''} (${yo.correo ?? ''}).` }; }
    catch (e) { return { ok: false, detalle: (e as Error).message }; }
  }
  async accion(nombre: string, d: Record<string, any>) {
    if (nombre === 'olvidar') await eraseSecret(SESSION_ACCOUNT);
    return super.accion(nombre, d);
  }
  protected async ownAction(nombre: string, d: Record<string, any>) {
    if (nombre === 'conectar') {
      const url = await this.startSession();
      if (d.abrir !== false) execFile('/usr/bin/open', [url], () => {});   // navegador del sistema (sesión de Microsoft ya abierta)
      return { url };
    }
    if (nombre === 'desconectar') { await eraseSecret(SESSION_ACCOUNT); this.sesion = false; this.reiniciar(); this.avisar?.('estado'); return this.estado(); }
    return super.ownAction(nombre, d);
  }
  parar() { super.parar(); this.escucha?.parar(); }
}

export function crear(almacen: Store) { return new Outlook(almacen); }
