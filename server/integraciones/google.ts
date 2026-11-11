// Google (Gmail y Google Calendar), solo lectura: correo sin leer de los últimos 7 días en Recibidos y eventos del
// calendario principal de hoy a +14 días. Cada usuario crea SU cliente OAuth («Aplicación de escritorio») en Google
// Cloud y pega su ID y su secreto en la cámara acorazada (en una app de escritorio el secreto no es confidencial,
// pero va al llavero igualmente). OAuth 2.0 código de autorización + PKCE con retorno a http://localhost:<puerto>.
// Con la pantalla de consentimiento en «Pruebas», Google corta la sesión a los 7 días: se explica al reconectar.
// El refresh token va al llavero (google.refreshToken). El access token vive solo en memoria.
import { execFile } from 'node:child_process';
import type { Store } from '../estado.ts';
import { ConnectorBase, ConfigSource, ErrorSource, ask, retraso, type Field } from './comun.ts';
import { readSecret, saveSecret, eraseSecret } from './llavero.ts';
import { listenReturned, type Returned } from './oauth.ts';
import { googleEvents, explainErrorGoogle, explainErrorOAuthGoogle, dayStart, gmailNotification, ZONA } from './normalizar.ts';
import type { Evento, Notification } from './adaptadores.ts';
import { t } from '../../shared/idioma.ts';

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CALENDARIO = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
// Solo lectura
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly';
export const SESSION_ACCOUNT = 'google.refreshToken';
const EACH_CALENDAR = 5 * 60_000;
const WITHOUT_SESSION = 'Falta iniciar sesión: pulsa «Conectar con Google» en la cámara acorazada.';
const WITHOUT_CLIENT = 'Faltan el ID y el secreto de tu cliente OAuth de Google: pégalos en la cámara acorazada y guarda.';

export const FIELDS_GOOGLE: Field[] = [
  { nombre: 'clientId', etiqueta: 'ID de cliente', ayuda: 'Google Cloud → APIs y servicios → Credenciales → tu cliente OAuth (tipo «Aplicación de escritorio») → «ID de cliente».', ejemplo: '1234567890-abc….apps.googleusercontent.com' },
  { nombre: 'clientSecret', etiqueta: 'Secreto de cliente', secreto: true, ayuda: 'En el mismo cliente OAuth, «Secreto de cliente». Empieza por GOCSPX-.' },
];
export const hasSessionGoogle = () => readSecret(SESSION_ACCOUNT).then(v => !!v, () => false);

class Google extends ConnectorBase {
  id = 'google' as const;
  intervalMs = 60_000;
  private acceso: { token: string; caduca: number } | null = null;
  private correo: string | null = null;
  private sesion = false;
  private escucha: Returned | null = null;
  private lastCalendar = 0;
  private metadatos = new Map<string, any>();   // id → mensaje (format=metadata): no se vuelve a pedir
  constructor(almacen: Store) { super(almacen, new ConfigSource(almacen, 'google', FIELDS_GOOGLE)); }
  private get cliente() { return this.config.publicos().clientId ?? ''; }

  protected listo() { return this.config.listo() && this.sesion; }
  protected missingConfig() { return this.config.listo() ? WITHOUT_SESSION : WITHOUT_CLIENT; }
  protected onRestart() { this.acceso = null; this.correo = null; this.lastCalendar = 0; this.metadatos.clear(); }
  async sondear() { this.sesion = await hasSessionGoogle(); return super.sondear(); }

  // ------------------------------------------------ OAuth
  private async token(cuerpo: Record<string, string>) {
    const secreto = await this.config.secreto('clientSecret');
    if (!this.cliente || !secreto) throw new ErrorSource(WITHOUT_CLIENT);
    const r = await ask(TOKEN, { servicio: 'Google', metodo: 'POST', cabeceras: { 'Content-Type': 'application/x-www-form-urlencoded' }, cuerpo: new URLSearchParams({ client_id: this.cliente, client_secret: secreto, ...cuerpo }).toString() });
    if (r.estado !== 200 || !r.json?.access_token) throw new ErrorSource(explainErrorOAuthGoogle(r.json ?? { error_description: `HTTP ${r.estado}` }), undefined, r.json?.error);
    this.acceso = { token: r.json.access_token, caduca: Date.now() + (Number(r.json.expires_in) || 3600) * 1000 };
    if (r.json.refresh_token) { await saveSecret(SESSION_ACCOUNT, r.json.refresh_token); this.sesion = true; }
    return this.acceso.token;
  }
  private async tokenAccess(forzar = false) {
    if (!forzar && this.acceso && this.acceso.caduca - Date.now() > 5 * 60_000) return this.acceso.token;
    const rt = await readSecret(SESSION_ACCOUNT);
    if (!rt) { this.sesion = false; throw new ErrorSource(WITHOUT_SESSION); }
    return this.token({ grant_type: 'refresh_token', refresh_token: rt });
  }
  private async api(url: string, retry = true): Promise<any> {
    const token = await this.tokenAccess();
    const r = await ask(url, { servicio: 'Google', cabeceras: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (r.estado === 401 && retry) { await this.tokenAccess(true); return this.api(url, false); }
    if (r.estado === 429 || r.estado === 503) throw new ErrorSource(explainErrorGoogle(r.estado, r.json), retraso(r, 60));
    if (r.estado >= 400) throw new ErrorSource(explainErrorGoogle(r.estado, r.json));
    return r.json;
  }
  private async whoSoy() {
    if (this.correo) return this.correo;
    const p = await this.api(`${GMAIL}/profile`);
    return this.correo = String(p.emailAddress ?? '');
  }

  async startSession(): Promise<string> {
    if (this.escucha) return this.escucha.url;
    if (!this.config.listo()) throw new ErrorSource(WITHOUT_CLIENT);
    this.escucha = await listenReturned({
      servicio: 'Google',
      // access_type=offline y prompt=consent: Google solo da refresh token así (y otra vez al reconectar)
      authorization: (redireccion, estado, challenge) => `${AUTHORIZE}?` + new URLSearchParams({ client_id: this.cliente, response_type: 'code', redirect_uri: redireccion, scope: SCOPES, state: estado, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' }),
      onClose: () => { this.escucha = null; },
      onBack: async ({ codigo, error, redireccion, verifier }) => {
        if (error || !codigo) { const m = explainErrorOAuthGoogle((error ?? {}) as any); this.mal(m); this.avisar?.('estado'); return { ok: false, titulo: 'No se pudo conectar con Google', texto: m }; }
        try {
          await this.token({ grant_type: 'authorization_code', code: codigo, redirect_uri: redireccion, code_verifier: verifier });
          this.correo = null; const correo = await this.whoSoy();
          this.bien(`Conectado como ${correo}.`); this.avisar?.('activar');
          return { ok: true, titulo: 'Conectado', texto: t('server.doneTheShelterCanNow') };
        } catch (e) { this.mal((e as Error).message); this.avisar?.('estado'); return { ok: false, titulo: 'No se pudo conectar con Google', texto: (e as Error).message }; }
      },
    });
    return this.escucha.url;
  }

  // ------------------------------------------------ sondeo
  protected async pollReal() {
    const correo = await this.whoSoy();
    const q = new URLSearchParams({ q: 'is:unread in:inbox newer_than:7d', maxResults: '25' });
    const lista: { id: string }[] = (await this.api(`${GMAIL}/messages?${q}`)).messages ?? [];
    const notificaciones: Notification[] = [];
    for (const { id } of lista) {
      let m = this.metadatos.get(id);
      if (!m) {
        const qm = new URLSearchParams({ format: 'metadata' }); for (const h of ['From', 'Subject', 'Date']) qm.append('metadataHeaders', h);
        m = await this.api(`${GMAIL}/messages/${encodeURIComponent(id)}?${qm}`);
        this.metadatos.set(id, m);
      }
      const n = gmailNotification(m); if (n) notificaciones.push(n);
    }
    const live = new Set(lista.map(x => x.id)); for (const id of this.metadatos.keys()) if (!live.has(id)) this.metadatos.delete(id);
    let eventos: Evento[] | undefined;
    if (Date.now() - this.lastCalendar > EACH_CALENDAR) {
      const ini = dayStart();
      const qc = new URLSearchParams({ timeMin: new Date(ini).toISOString(), timeMax: new Date(ini + 15 * 86_400_000).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '100', timeZone: ZONA });
      eventos = googleEvents(await this.api(`${CALENDARIO}?${qc}`));
      this.lastCalendar = Date.now();
    }
    this.bien(t('server.connectedAsUnreadEmailsIn', { correo, notificaciones: notificaciones.length }));
    return { notificaciones, complete: true, eventos };   // lo que se lee en Gmail sale del tablón
  }

  protected async tryReal(v: Record<string, string>) {
    if (!/\.apps\.googleusercontent\.com$/.test(v.clientId ?? '')) return { ok: false, detalle: t('server.theClientIdEndsIn') };
    this.sesion = await hasSessionGoogle();
    if (!this.sesion) return { ok: true, detalle: t('server.oauthClientSavedNowPress') };
    try { this.acceso = null; this.correo = null; return { ok: true, detalle: `Conectado como ${await this.whoSoy()}.` }; }
    catch (e) { return { ok: false, detalle: (e as Error).message }; }
  }
  async accion(nombre: string, d: Record<string, any>) {
    if (nombre === 'olvidar') await eraseSecret(SESSION_ACCOUNT);
    return super.accion(nombre, d);
  }
  protected async ownAction(nombre: string, d: Record<string, any>) {
    if (nombre === 'conectar') {
      const url = await this.startSession();
      if (d.abrir !== false) execFile('/usr/bin/open', [url], () => {});   // navegador del sistema
      return { url };
    }
    if (nombre === 'desconectar') { await eraseSecret(SESSION_ACCOUNT); this.sesion = false; this.reiniciar(); this.avisar?.('estado'); return this.estado(); }
    return super.ownAction(nombre, d);
  }
  parar() { super.parar(); this.escucha?.parar(); }
}

export function crear(almacen: Store) { return new Google(almacen); }
