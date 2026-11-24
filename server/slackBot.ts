// Mando a distancia por Slack (lo que hace, en remoteBot.ts): una app de Slack del propio Supervisor, creada desde el
// manifiesto que enseña la cámara acorazada. Escribe solo en el mensaje directo con quien empareja (un
// código de un solo uso que se le manda al bot por privado); lo demás se ignora sin responder. Aparte de la integración
// de avisos de Slack (integrations/slack.ts), que es de solo lectura: otra app y otro token, para que el lector de
// avisos nunca pueda escribir. Sin puertos abiertos: Socket Mode (el servidor abre un WebSocket hacia Slack). Los dos tokens, en el llavero: el de la app (xapp-, connections:write) y el del bot (xoxb-).
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { WebSocket } from 'ws';
import { readSecret, saveSecret, eraseSecret } from './integrations/keychain.ts';
import { t } from '../shared/language.ts';
import { RemoteBot, type Trail, PAIRING_MS, type RemoteDeps, type View } from './remoteBot.ts';

const API = 'https://slack.com/api/';
const APP_ACCOUNT = 'slackRemote.appToken';
const BOT_ACCOUNT = 'slackRemote.botToken';
const TOKEN_APP = /^xapp-[A-Za-z0-9-]{20,}$/;
const TOKEN_BOT = /^xoxb-[A-Za-z0-9-]{20,}$/;
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // sin 0/O ni 1/I/L: se teclea a mano en el móvil
const ATTEMPTS = 5;                                   // códigos equivocados antes de caducar el vigente
// límites de Block Kit: 3000 caracteres por sección, 25 botones por bloque de acciones, 75 por botón, 50 bloques
const SECTION = 2900, PER_BLOCK = 25, BUTTON = 75;

export type SlackApi = (method: string, params: Record<string, unknown>, token: string, signal?: AbortSignal) => Promise<any>;
export const slackApi: SlackApi = async (method, params, token, signal) => {
  const r = await fetch(API + method, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${token}` }, body: JSON.stringify(params), signal: signal ?? AbortSignal.timeout(20_000) });
  const j: any = await r.json().catch(() => ({}));
  // el error de Slack es un código corto (invalid_auth, not_in_channel…): nunca lleva el token
  if (!j.ok) throw new Error(t('server.slackRemoteError', { by: String(j.error ?? r.status) }));
  return j;
};

/** La conexión de Socket Mode, reducida a lo que se usa (para poder fingirla en las pruebas) */
export interface Socket { send(s: string): void; close(): void }
export type OpenSocket = (url: string, h: { message(s: string): void; closed(): void }) => Socket;
const openWs: OpenSocket = (url, h) => {
  const ws = new WebSocket(url);
  ws.on('message', d => h.message(String(d)));
  ws.on('close', () => h.closed());
  ws.on('error', e => console.error('Slack (mando):', e.message));
  return { send: s => { if (ws.readyState === ws.OPEN) ws.send(s); }, close: () => ws.close() };
};

interface Config { teamId?: string; team?: string; bot?: string; botUserId?: string; channel?: string; userId?: string; approve?: boolean; trail?: Trail<Ref> }
export interface SlackRemoteState { connected: boolean; team?: string; bot?: string; paired: boolean; code?: string; approve: boolean }
export interface SlackRemoteDeps extends RemoteDeps { data: string; api?: SlackApi; open?: OpenSocket }
interface Ref { channel: string; ts: string }

/** Solo cuenta lo que llega del espacio de trabajo, el mensaje directo y la persona emparejados */
export function whoseTurnSlack(o: { team?: string; channel?: string; user?: string }, c: Config): boolean {
  return !!c.teamId && !!c.channel && !!c.userId && o.team === c.teamId && o.channel === c.channel && o.user === c.userId;
}

/** Un mensaje como bloques de Slack: el texto en secciones de texto plano (nada se interpreta como formato) y los
 *  botones en bloques de acciones, cada uno con su `dato` en `value` */
export function blocks(v: View) {
  const out: any[] = [];
  let rest = v.text;
  while (rest.length) {
    let truncation = rest.length <= SECTION ? rest.length : rest.lastIndexOf('\n', SECTION);
    if (truncation < SECTION / 2) truncation = Math.min(SECTION, rest.length);
    out.push({ type: 'section', text: { type: 'plain_text', text: rest.slice(0, truncation), emoji: false } });
    rest = rest.slice(truncation).replace(/^\n/, '');
  }
  const buttons = v.rows.flat();
  for (let i = 0; i < buttons.length; i += PER_BLOCK) {
    out.push({ type: 'actions', elements: buttons.slice(i, i + PER_BLOCK).map((b, j) => ({ type: 'button', action_id: `b${i + j}`, value: b.data, text: { type: 'plain_text', text: b.text.slice(0, BUTTON), emoji: false } })) });
  }
  return out.slice(0, 50);
}
// el texto de la notificación (pantalla bloqueada): solo la primera línea, nunca el comando ni el plan
const notice = (v: View) => v.text.split('\n')[0].slice(0, 150) || '…';
const normalize = (s: string) => s.toUpperCase().replace(/[\s-]/g, '');

export class SlackRemote extends RemoteBot<Ref> {
  protected readonly channel = 'Slack (mando)';
  private c: Config;
  private tokens: { app: string; bot: string } | null = null;
  private pairing?: { code: string; until: number; failures: number };
  private running?: AbortController;
  private api: SlackApi;
  private open: OpenSocket;
  private file: string;
  constructor(d: SlackRemoteDeps) {
    super(d);
    this.api = d.api ?? slackApi;
    this.open = d.open ?? openWs;
    this.file = path.join(d.data, 'slack-remote.json');
    try { this.c = JSON.parse(readFileSync(this.file, 'utf8')); } catch { this.c = {}; }
  }
  private save() { try { writeFileSync(this.file, JSON.stringify(this.c), { mode: 0o600 }); } catch {} this.d.onChange?.(); }
  private call(method: string, p: Record<string, unknown>) { if (!this.tokens) throw new Error(t('server.slackRemoteNotConnected')); return this.api(method, p, this.tokens.bot); }

  protected ready() { return !!this.tokens && !!this.c.channel; }
  protected approves() { return this.c.approve !== false; }
  protected async post(v: View) {
    const r = await this.call('chat.postMessage', { channel: this.c.channel, text: notice(v), blocks: blocks(v), unfurl_links: false, unfurl_media: false });
    return r?.ts ? { channel: String(r.channel), ts: String(r.ts) } : undefined;
  }
  protected changeButtons(ref: Ref, v: View) { return this.call('chat.update', { channel: ref.channel, ts: ref.ts, text: notice(v), blocks: blocks(v) }); }
  protected collect(ref: Ref, text: string) { return this.call('chat.update', { channel: ref.channel, ts: ref.ts, text, blocks: blocks({ text, rows: [] }) }); }
  protected edit(ref: Ref, v: View) { return this.call('chat.update', { channel: ref.channel, ts: ref.ts, text: notice(v), blocks: blocks(v) }); }
  protected deleteMessage(ref: Ref) { return this.call('chat.delete', { channel: ref.channel, ts: ref.ts }); }
  protected trail() { return this.c.trail; }
  protected saveTrail(r: Trail<Ref>) { this.c.trail = r; this.save(); }

  state(): SlackRemoteState {
    const code = this.tokens && !this.c.channel && this.pairing && this.pairing.until > Date.now() ? this.pairing.code : undefined;
    return { connected: !!this.tokens, team: this.c.team, bot: this.c.bot, paired: !!this.c.channel, code, approve: this.c.approve !== false };
  }

  /** al arrancar el servidor: si hay tokens guardados, se pone a escuchar */
  async start() {
    const [app, bot] = await Promise.all([readSecret(APP_ACCOUNT).catch(() => null), readSecret(BOT_ACCOUNT).catch(() => null)]);
    if (app && bot) { this.tokens = { app, bot }; this.listen(); await this.resume(); }
  }

  /** con los dos tokens de la app: se comprueban con Slack, se guardan en el llavero y se prepara el código de emparejar */
  async connect(app: string, bot: string) {
    app = app.trim(); bot = bot.trim();
    if (!TOKEN_APP.test(app)) throw new Error(t('server.slackRemoteInvalidAppToken'));
    if (!TOKEN_BOT.test(bot)) throw new Error(t('server.slackRemoteInvalidBotToken'));
    const me = await this.api('auth.test', {}, bot);
    await this.api('apps.connections.open', {}, app);   // que el de la app vale y Socket Mode está encendido
    this.stop();
    await saveSecret(APP_ACCOUNT, app);
    await saveSecret(BOT_ACCOUNT, bot);
    this.tokens = { app, bot };
    this.c = { teamId: String(me.team_id ?? ''), team: String(me.team ?? ''), bot: String(me.user ?? ''), botUserId: String(me.user_id ?? ''), approve: this.c.approve };
    return this.pair();
  }
  /** código de un solo uso (10 min) para emparejar: se le manda al bot por mensaje directo */
  pair() {
    if (!this.tokens) throw new Error(t('server.slackRemoteNotConnected'));
    this.c.channel = undefined; this.c.userId = undefined; this.c.trail = undefined; this.forget();
    const letters = Array.from({ length: 8 }, () => LETTERS[randomInt(LETTERS.length)]).join('');
    this.pairing = { code: `${letters.slice(0, 4)}-${letters.slice(4)}`, until: Date.now() + PAIRING_MS, failures: 0 };
    this.save(); this.listen();
    return this.state();
  }
  async disconnect() {
    this.stop();
    this.tokens = null; this.c = {}; this.pairing = undefined; this.forget();
    await Promise.all([eraseSecret(APP_ACCOUNT).catch(() => {}), eraseSecret(BOT_ACCOUNT).catch(() => {})]);
    try { rmSync(this.file, { force: true }); } catch {}
    this.d.onChange?.();
    return this.state();
  }
  setApprove(si: boolean) { this.c.approve = si; this.save(); return this.state(); }
  stop() { this.running?.abort(); this.running = undefined; }

  // ---------------- entrada: Socket Mode, con espera creciente si falla la red o Slack pide reconectar
  private listen() {
    if (this.running || !this.tokens) return;
    const ac = this.running = new AbortController();
    (async () => {
      let wait = 1000;
      while (!ac.signal.aborted && this.tokens) {
        try {
          const { url } = await this.api('apps.connections.open', {}, this.tokens.app, AbortSignal.any([ac.signal, AbortSignal.timeout(20_000)]));
          await new Promise<void>(end => {
            const cut = () => s.close();
            const s: Socket = this.open(String(url), {
              message: raw => { if (this.restsOn(raw, s)) wait = 1000; },
              closed: () => { ac.signal.removeEventListener('abort', cut); end(); },
            });
            ac.signal.addEventListener('abort', cut, { once: true });
          });
        } catch (e) {
          if (ac.signal.aborted) break;
          console.error('Slack (mando):', (e as Error).message);
        }
        if (ac.signal.aborted) break;
        await new Promise(r => setTimeout(r, wait)); wait = Math.min(wait * 2, 60_000);
      }
    })();
  }

  /** Un sobre de Socket Mode: se da por recibido al momento (Slack espera menos de 3 s) y luego se atiende.
   *  Devuelve si es el saludo de una conexión nueva. Público para las pruebas */
  restsOn(raw: string, s: Socket): boolean {
    let j: any;
    try { j = JSON.parse(raw); } catch { return false; }
    if (j.envelope_id) s.send(JSON.stringify({ envelope_id: j.envelope_id }));
    if (j.type === 'disconnect') { s.close(); return false; }
    if (j.type === 'events_api' || j.type === 'interactive') this.receive(j).catch(e => console.error('Slack (mando):', (e as Error).message));
    return j.type === 'hello';
  }

  /** Un evento (mensaje directo) o un botón pulsado (público para las pruebas) */
  async receive(j: any) {
    if (j.type === 'interactive') {
      const p = j.payload;
      if (p?.type !== 'block_actions') return;
      const from = { team: p.team?.id ?? p.user?.team_id, channel: p.channel?.id ?? p.container?.channel_id, user: p.user?.id };
      if (!whoseTurnSlack(from, this.c)) return;
      const data = String(p.actions?.[0]?.value ?? '');
      // la respuesta a un botón: un mensaje que solo ve quien lo pulsa
      await this.press(data, text => text ? this.call('chat.postEphemeral', { channel: this.c.channel, user: this.c.userId, text: text }) : Promise.resolve());
      return;
    }
    const ev = j.payload?.event;
    const team = j.payload?.team_id ?? ev?.team;
    // solo mensajes de personas por privado al bot (ni ediciones, ni los del propio bot)
    if (ev?.type !== 'message' || ev.subtype || ev.bot_id || !ev.user || ev.user === this.c.botUserId || ev.channel_type !== 'im') return;
    if (this.pairing && !this.c.channel && team === this.c.teamId) {
      if (this.pairing.until > Date.now() && typeof ev.text === 'string' && normalize(ev.text) === normalize(this.pairing.code)) {
        this.c.channel = ev.channel; this.c.userId = ev.user; this.pairing = undefined; this.save();
        await this.post({ text: t('server.remotePaired'), rows: [] });
        await this.sendListing();
      } else if (++this.pairing.failures >= ATTEMPTS) { this.pairing = undefined; this.d.onChange?.(); }
      return;
    }
    if (!whoseTurnSlack({ team, channel: ev.channel, user: ev.user }, this.c)) return;
    // cualquier otra cosa del mensaje directo emparejado: la lista (no se manda nada a las conversaciones)
    await this.sendListing();
  }
}
