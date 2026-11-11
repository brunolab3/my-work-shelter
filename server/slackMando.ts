// Mando a distancia por Slack (lo que hace, en mando.ts): una app de Slack del propio Supervisor, creada desde el
// manifiesto que enseña la cámara acorazada. Escribe solo en el mensaje directo con quien empareja (un
// código de un solo uso que se le manda al bot por privado); lo demás se ignora sin responder. Aparte de la integración
// de avisos de Slack (integraciones/slack.ts), que es de solo lectura: otra app y otro token, para que el lector de
// avisos nunca pueda escribir. Sin puertos abiertos: Socket Mode (el servidor abre un WebSocket hacia Slack). Los dos tokens, en el llavero: el de la app (xapp-, connections:write) y el del bot (xoxb-).
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { WebSocket } from 'ws';
import { readSecret, saveSecret, eraseSecret } from './integraciones/llavero.ts';
import { t } from '../shared/idioma.ts';
import { RemoteBot, PAIRING_MS, type RemoteDeps, type Vista } from './mando.ts';

const API = 'https://slack.com/api/';
const CUENTA_APP = 'slackRemote.appToken';
const CUENTA_BOT = 'slackRemote.botToken';
const TOKEN_APP = /^xapp-[A-Za-z0-9-]{20,}$/;
const TOKEN_BOT = /^xoxb-[A-Za-z0-9-]{20,}$/;
const LETRAS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // sin 0/O ni 1/I/L: se teclea a mano en el móvil
const INTENTOS = 5;                                   // códigos equivocados antes de caducar el vigente
// límites de Block Kit: 3000 caracteres por sección, 25 botones por bloque de acciones, 75 por botón, 50 bloques
const SECCION = 2900, POR_BLOQUE = 25, BOTON = 75;

export type SlackApi = (metodo: string, params: Record<string, unknown>, token: string, signal?: AbortSignal) => Promise<any>;
export const apiSlack: SlackApi = async (metodo, params, token, signal) => {
  const r = await fetch(API + metodo, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${token}` }, body: JSON.stringify(params), signal: signal ?? AbortSignal.timeout(20_000) });
  const j: any = await r.json().catch(() => ({}));
  // el error de Slack es un código corto (invalid_auth, not_in_channel…): nunca lleva el token
  if (!j.ok) throw new Error(t('server.slackRemoteError', { por: String(j.error ?? r.status) }));
  return j;
};

/** La conexión de Socket Mode, reducida a lo que se usa (para poder fingirla en las pruebas) */
export interface Enchufe { enviar(s: string): void; cerrar(): void }
export type AbrirEnchufe = (url: string, h: { mensaje(s: string): void; cerrado(): void }) => Enchufe;
const abrirWs: AbrirEnchufe = (url, h) => {
  const ws = new WebSocket(url);
  ws.on('message', d => h.mensaje(String(d)));
  ws.on('close', () => h.cerrado());
  ws.on('error', e => console.error('Slack (mando):', e.message));
  return { enviar: s => { if (ws.readyState === ws.OPEN) ws.send(s); }, cerrar: () => ws.close() };
};

interface Config { teamId?: string; team?: string; bot?: string; botUserId?: string; channel?: string; userId?: string; aprobar?: boolean }
export interface SlackRemoteState { conectado: boolean; team?: string; bot?: string; emparejado: boolean; codigo?: string; aprobar: boolean }
export interface SlackRemoteDeps extends RemoteDeps { datos: string; api?: SlackApi; abrir?: AbrirEnchufe }
interface Ref { channel: string; ts: string }

/** Solo cuenta lo que llega del espacio de trabajo, el mensaje directo y la persona emparejados */
export function deQuienTocaSlack(o: { team?: string; channel?: string; user?: string }, c: Config): boolean {
  return !!c.teamId && !!c.channel && !!c.userId && o.team === c.teamId && o.channel === c.channel && o.user === c.userId;
}

/** Un mensaje como bloques de Slack: el texto en secciones de texto plano (nada se interpreta como formato) y los
 *  botones en bloques de acciones, cada uno con su `dato` en `value` */
export function bloques(v: Vista) {
  const out: any[] = [];
  let resto = v.text;
  while (resto.length) {
    let corte = resto.length <= SECCION ? resto.length : resto.lastIndexOf('\n', SECCION);
    if (corte < SECCION / 2) corte = Math.min(SECCION, resto.length);
    out.push({ type: 'section', text: { type: 'plain_text', text: resto.slice(0, corte), emoji: false } });
    resto = resto.slice(corte).replace(/^\n/, '');
  }
  const botones = v.filas.flat();
  for (let i = 0; i < botones.length; i += POR_BLOQUE) {
    out.push({ type: 'actions', elements: botones.slice(i, i + POR_BLOQUE).map((b, j) => ({ type: 'button', action_id: `b${i + j}`, value: b.dato, text: { type: 'plain_text', text: b.texto.slice(0, BOTON), emoji: false } })) });
  }
  return out.slice(0, 50);
}
// el texto de la notificación (pantalla bloqueada): solo la primera línea, nunca el comando ni el plan
const aviso = (v: Vista) => v.text.split('\n')[0].slice(0, 150) || '…';
const normalizar = (s: string) => s.toUpperCase().replace(/[\s-]/g, '');

export class SlackRemote extends RemoteBot<Ref> {
  protected readonly canal = 'Slack (mando)';
  private c: Config;
  private tokens: { app: string; bot: string } | null = null;
  private pairing?: { codigo: string; hasta: number; fallos: number };
  private corriendo?: AbortController;
  private api: SlackApi;
  private abrir: AbrirEnchufe;
  private archivo: string;
  constructor(d: SlackRemoteDeps) {
    super(d);
    this.api = d.api ?? apiSlack;
    this.abrir = d.abrir ?? abrirWs;
    this.archivo = path.join(d.datos, 'slack-mando.json');
    try { this.c = JSON.parse(readFileSync(this.archivo, 'utf8')); } catch { this.c = {}; }
  }
  private guardar() { try { writeFileSync(this.archivo, JSON.stringify(this.c), { mode: 0o600 }); } catch {} this.d.alCambiar?.(); }
  private llamar(metodo: string, p: Record<string, unknown>) { if (!this.tokens) throw new Error(t('server.slackRemoteNotConnected')); return this.api(metodo, p, this.tokens.bot); }

  protected listo() { return !!this.tokens && !!this.c.channel; }
  protected aprueba() { return this.c.aprobar !== false; }
  protected async mandar(v: Vista) {
    const r = await this.llamar('chat.postMessage', { channel: this.c.channel, text: aviso(v), blocks: bloques(v), unfurl_links: false, unfurl_media: false });
    return r?.ts ? { channel: String(r.channel), ts: String(r.ts) } : undefined;
  }
  protected cambiarBotones(ref: Ref, v: Vista) { return this.llamar('chat.update', { channel: ref.channel, ts: ref.ts, text: aviso(v), blocks: bloques(v) }); }
  protected recoger(ref: Ref, text: string) { return this.llamar('chat.update', { channel: ref.channel, ts: ref.ts, text, blocks: bloques({ text, filas: [] }) }); }

  estado(): SlackRemoteState {
    const codigo = this.tokens && !this.c.channel && this.pairing && this.pairing.hasta > Date.now() ? this.pairing.codigo : undefined;
    return { conectado: !!this.tokens, team: this.c.team, bot: this.c.bot, emparejado: !!this.c.channel, codigo, aprobar: this.c.aprobar !== false };
  }

  /** al arrancar el servidor: si hay tokens guardados, se pone a escuchar */
  async iniciar() {
    const [app, bot] = await Promise.all([readSecret(CUENTA_APP).catch(() => null), readSecret(CUENTA_BOT).catch(() => null)]);
    if (app && bot) { this.tokens = { app, bot }; this.escuchar(); }
  }

  /** con los dos tokens de la app: se comprueban con Slack, se guardan en el llavero y se prepara el código de emparejar */
  async conectar(app: string, bot: string) {
    app = app.trim(); bot = bot.trim();
    if (!TOKEN_APP.test(app)) throw new Error(t('server.slackRemoteInvalidAppToken'));
    if (!TOKEN_BOT.test(bot)) throw new Error(t('server.slackRemoteInvalidBotToken'));
    const yo = await this.api('auth.test', {}, bot);
    await this.api('apps.connections.open', {}, app);   // que el de la app vale y Socket Mode está encendido
    this.parar();
    await saveSecret(CUENTA_APP, app);
    await saveSecret(CUENTA_BOT, bot);
    this.tokens = { app, bot };
    this.c = { teamId: String(yo.team_id ?? ''), team: String(yo.team ?? ''), bot: String(yo.user ?? ''), botUserId: String(yo.user_id ?? ''), aprobar: this.c.aprobar };
    return this.emparejar();
  }
  /** código de un solo uso (10 min) para emparejar: se le manda al bot por mensaje directo */
  emparejar() {
    if (!this.tokens) throw new Error(t('server.slackRemoteNotConnected'));
    this.c.channel = undefined; this.c.userId = undefined;
    const letras = Array.from({ length: 8 }, () => LETRAS[randomInt(LETRAS.length)]).join('');
    this.pairing = { codigo: `${letras.slice(0, 4)}-${letras.slice(4)}`, hasta: Date.now() + PAIRING_MS, fallos: 0 };
    this.guardar(); this.escuchar();
    return this.estado();
  }
  async desconectar() {
    this.parar();
    this.tokens = null; this.c = {}; this.pairing = undefined;
    await Promise.all([eraseSecret(CUENTA_APP).catch(() => {}), eraseSecret(CUENTA_BOT).catch(() => {})]);
    try { rmSync(this.archivo, { force: true }); } catch {}
    this.d.alCambiar?.();
    return this.estado();
  }
  ponerAprobar(si: boolean) { this.c.aprobar = si; this.guardar(); return this.estado(); }
  parar() { this.corriendo?.abort(); this.corriendo = undefined; }

  // ---------------- entrada: Socket Mode, con espera creciente si falla la red o Slack pide reconectar
  private escuchar() {
    if (this.corriendo || !this.tokens) return;
    const ac = this.corriendo = new AbortController();
    (async () => {
      let espera = 1000;
      while (!ac.signal.aborted && this.tokens) {
        try {
          const { url } = await this.api('apps.connections.open', {}, this.tokens.app, AbortSignal.any([ac.signal, AbortSignal.timeout(20_000)]));
          await new Promise<void>(fin => {
            const cortar = () => s.cerrar();
            const s: Enchufe = this.abrir(String(url), {
              mensaje: raw => { if (this.sobre(raw, s)) espera = 1000; },
              cerrado: () => { ac.signal.removeEventListener('abort', cortar); fin(); },
            });
            ac.signal.addEventListener('abort', cortar, { once: true });
          });
        } catch (e) {
          if (ac.signal.aborted) break;
          console.error('Slack (mando):', (e as Error).message);
        }
        if (ac.signal.aborted) break;
        await new Promise(r => setTimeout(r, espera)); espera = Math.min(espera * 2, 60_000);
      }
    })();
  }

  /** Un sobre de Socket Mode: se da por recibido al momento (Slack espera menos de 3 s) y luego se atiende.
   *  Devuelve si es el saludo de una conexión nueva. Público para las pruebas */
  sobre(raw: string, s: Enchufe): boolean {
    let j: any;
    try { j = JSON.parse(raw); } catch { return false; }
    if (j.envelope_id) s.enviar(JSON.stringify({ envelope_id: j.envelope_id }));
    if (j.type === 'disconnect') { s.cerrar(); return false; }
    if (j.type === 'events_api' || j.type === 'interactive') this.recibir(j).catch(e => console.error('Slack (mando):', (e as Error).message));
    return j.type === 'hello';
  }

  /** Un evento (mensaje directo) o un botón pulsado (público para las pruebas) */
  async recibir(j: any) {
    if (j.type === 'interactive') {
      const p = j.payload;
      if (p?.type !== 'block_actions') return;
      const de = { team: p.team?.id ?? p.user?.team_id, channel: p.channel?.id ?? p.container?.channel_id, user: p.user?.id };
      if (!deQuienTocaSlack(de, this.c)) return;
      const dato = String(p.actions?.[0]?.value ?? '');
      // la respuesta a un botón: un mensaje que solo ve quien lo pulsa
      await this.pulsar(dato, texto => texto ? this.llamar('chat.postEphemeral', { channel: this.c.channel, user: this.c.userId, text: texto }) : Promise.resolve());
      return;
    }
    const ev = j.payload?.event;
    const team = j.payload?.team_id ?? ev?.team;
    // solo mensajes de personas por privado al bot (ni ediciones, ni los del propio bot)
    if (ev?.type !== 'message' || ev.subtype || ev.bot_id || !ev.user || ev.user === this.c.botUserId || ev.channel_type !== 'im') return;
    if (this.pairing && !this.c.channel && team === this.c.teamId) {
      if (this.pairing.hasta > Date.now() && typeof ev.text === 'string' && normalizar(ev.text) === normalizar(this.pairing.codigo)) {
        this.c.channel = ev.channel; this.c.userId = ev.user; this.pairing = undefined; this.guardar();
        await this.mandar({ text: t('server.remotePaired'), filas: [] });
        await this.mandarListado();
      } else if (++this.pairing.fallos >= INTENTOS) { this.pairing = undefined; this.d.alCambiar?.(); }
      return;
    }
    if (!deQuienTocaSlack({ team, channel: ev.channel, user: ev.user }, this.c)) return;
    // cualquier otra cosa del mensaje directo emparejado: la lista (no se manda nada a las conversaciones)
    await this.mandarListado();
  }
}
