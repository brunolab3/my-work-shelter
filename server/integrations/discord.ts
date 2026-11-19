// Discord: SOLO bot oficial (token de bot). Prohibido el token de usuario (self-bot, contra los términos de Discord).
// Gateway por WebSocket (paquete ws) con intents mínimos GUILDS | GUILD_MESSAGES (+ MESSAGE_CONTENT si el portal lo
// concede; si no, se degrada: llegan los avisos y las menciones, sin el texto). REST solo para lo que el Gateway no da:
// la app (dueño = el usuario), los roles del usuario, la lista de canales para la cámara acorazada y rellenar huecos al conectar.
// Solo lectura: el bot no tiene SEND_MESSAGES y el juego nunca envía nada a los canales. Los mensajes directos no
// llegan: ningún bot puede leerlos.
import WebSocket from 'ws';
import type { Store } from '../state.ts';
import { ConnectorBase, ConfigSource, ErrorSource, message, ask, type Field } from './common.ts';
import { eligibleChannels, closingDiscord, grantedContent, contextDiscordEmpty, explainErrorDiscord, dateSnowflake, intentsDiscord, invitationDiscord, discordNotification, canSeeDiscord, type ContextDiscord } from './normalize.ts';
import type { Notification } from './adapters.ts';
import { t as tr } from '../../shared/language.ts';

const API = 'https://discord.com/api/v10';
let GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
// Solo para pruebas (Gateway simulado en 127.0.0.1)
export function useGatewayOfTest(url: string) { GATEWAY = url; }
const UA = 'DiscordBot (https://example.com/work-shelter, 0.1)';

export const FIELDS_DISCORD: Field[] = [
  { name: 'token', label: 'Token del bot', secret: true, help: 'discord.com/developers/applications → tu app «work-shelter» → Bot → Reset Token → Copy. Es el token de un BOT: nunca pegues el de tu cuenta personal (está prohibido y no funcionaría). Activa también «Message Content Intent» en esa misma página.' },
  { name: 'canales', label: 'Canales a vigilar', optional: true, help: 'Se eligen en la cámara acorazada una vez conectado (IDs separados por comas). Vacío: todos los canales que ve el bot. Las menciones a ti o a tus roles llegan siempre, con prioridad alta.' },
  { name: 'usuario', label: 'Tu ID de usuario de Discord', optional: true, help: 'Solo si el bot pertenece a un equipo de desarrolladores (si no, se deduce del dueño de la app). Discord → Ajustes → Avanzado → Modo desarrollador; luego clic derecho en tu nombre → Copiar ID de usuario.' },
];

class Discord extends ConnectorBase {
  id = 'discord' as const;
  intervalMs = 15_000;
  private ws: WebSocket | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private firstHeartbeat: NodeJS.Timeout | null = null;
  private reconnection: NodeJS.Timeout | null = null;
  private ackPending = false;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private urlResume: string | null = null;
  private attempts = 0;
  private stopped = true;
  private app: { id: string; name: string; flags: number; owner?: string } | null = null;
  private ctx: ContextDiscord = contextDiscordEmpty();
  private guilds = new Map<string, any>();   // roles y miembros del GUILD_CREATE, para saber qué canales ve el bot
  private raw = new Map<string, any>();   // canales tal como los da Discord (con sus sobrescrituras de permisos)
  private myRoles = new Map<string, string[]>();   // mis roles en cada servidor
  private queue: Notification[] = [];
  private filled = false;
  private rolesWhen = 0;
  private reasonFatal: string | null = null;
  constructor(store: Store) { super(store, new ConfigSource(store, 'discord', FIELDS_DISCORD)); }

  // ------------------------------------------------ REST
  private async rest(path: string, token?: string): Promise<any> {
    const t = token ?? await this.config.secret('token');
    if (!t) throw new ErrorSource(tr('server.theBotTokenIsMissing'));
    const r = await ask(API + path, { service: 'Discord', headers: { Authorization: `Bot ${t}`, 'User-Agent': UA } });
    if (r.state === 429) throw new ErrorSource(explainErrorDiscord(429, r.json), Math.ceil(Number(r.json?.retry_after ?? 5) * 1000));
    if (r.state >= 400) throw new ErrorSource(explainErrorDiscord(r.state, r.json));
    return r.json;
  }
  private async loadApp(token?: string) {
    const a = await this.rest('/applications/@me', token);
    return { id: a.id as string, name: a.name as string, flags: Number(a.flags ?? 0), owner: a.team ? undefined : a.owner?.id as string | undefined, team: !!a.team };
  }
  private chosen() { return new Set((this.config.publicFields().canales ?? '').split(/[\s,;]+/).filter(x => /^\d{5,}$/.test(x))); }

  // Roles del usuario en cada servidor (no requiere el intent privilegiado GUILD_MEMBERS); se refrescan cada 10 min
  private async refreshRoles() {
    if (!this.ctx.me || Date.now() - this.rolesWhen < 10 * 60_000) return;
    this.rolesWhen = Date.now();
    const roles = new Set<string>();
    for (const g of this.ctx.servers.keys()) {
      try { const m = await this.rest(`/guilds/${g}/members/${this.ctx.me}`); this.myRoles.set(g, m.roles ?? []); for (const r of m.roles ?? []) roles.add(r); } catch { /* no es miembro de ese servidor */ }
    }
    this.ctx.myRoles = roles;
    this.computeHidden();
  }
  // Canales que el bot ve y yo no (si el bot tiene más permisos que yo): de esos no se avisa
  private computeHidden() {
    const me = this.ctx.me, hidden = new Set<string>();
    if (me) for (const [id, c] of this.raw) {
      const g = this.guilds.get(c.guild_id), mine = this.myRoles.get(c.guild_id);
      if (g && mine && canSeeDiscord(c, { id: g.id, roles: g.roles, members: [{ user: { id: me }, roles: mine }] }, me) === false) hidden.add(id);
    }
    this.ctx.hidden = hidden;
  }
  // Al conectar por primera vez: últimos mensajes de los canales elegidos (24 h) para que el feed no empiece vacío.
  // Solo los que el bot ve y con actividad en ese plazo, los más recientes primero (en el orden del GUILD_CREATE
  // los 15 primeros solían ser canales privados sin acceso y se quedaban fuera los que de verdad se mueven)
  private async fill() {
    if (this.filled) return; this.filled = true;
    const since = Date.now() - 86_400_000;
    const all = !this.ctx.chosen.size;
    const ids = [...this.ctx.channels]
      .filter(([id, c]) => (all ? [0, 5, 10, 11, 12].includes(c.type ?? -1) : this.ctx.chosen.has(id) || (!!c.parent && this.ctx.chosen.has(c.parent))) && c.visible !== false)
      .filter(([, c]) => !c.last || dateSnowflake(c.last) >= since)
      .sort(([, a], [, b]) => (b.last ? dateSnowflake(b.last) : 0) - (a.last ? dateSnowflake(a.last) : 0))
      .map(([id]) => id).slice(0, 15);
    for (const id of ids) {
      try {
        const list: any[] = await this.rest(`/channels/${id}/messages?limit=20`);
        for (const m of list) { const n = discordNotification({ ...m, guild_id: m.guild_id ?? this.ctx.channels.get(id)?.guild }, this.ctx); if (n && n.date >= since) this.queue.push(n); }
      } catch (e) { if (e instanceof ErrorSource && e.retryIn) await new Promise(r => setTimeout(r, e.retryIn)); }
    }
    if (this.queue.length) this.notify?.('sondear');
  }

  // ------------------------------------------------ Gateway
  private send(op: number, d: unknown) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op, d })); }
  private async connect() {
    if (this.ws || this.reconnection) return;
    this.stopped = false;
    const token = await this.config.secret('token');
    if (!token) { this.situation = { state: 'sin-configurar', detail: tr('server.theBotTokenIsMissing') }; return; }
    if (!this.app) {
      const a = await this.loadApp(token);
      this.app = a; this.ctx.bot = a.id; this.ctx.content = grantedContent(a.flags);
      this.ctx.me = this.config.publicFields().usuario || a.owner;
    }
    this.ctx.chosen = this.chosen();
    const resume = !!(this.sessionId && this.urlResume);
    if (this.situation.state !== 'conectada') this.situation = { state: 'sin-configurar', detail: tr('server.connectingToTheDiscordGateway') };
    const ws = new WebSocket(resume ? `${this.urlResume}/?v=10&encoding=json` : GATEWAY, { handshakeTimeout: 20_000 });
    this.ws = ws;
    ws.on('message', data => { try { this.onMessage(JSON.parse(String(data)), token, resume); } catch (e) { console.error('[discord] mensaje del Gateway no válido:', message(e)); } });
    ws.on('close', code => this.onClose(ws, code));
    ws.on('error', e => { if (this.ws === ws) this.fail(tr('integrations.discordGatewayError', { error: e.message })); });
  }
  private onMessage(p: { op: number; d: any; s: number | null; t: string | null }, token: string, resume: boolean) {
    if (p.s != null) this.seq = p.s;
    switch (p.op) {
      case 10: {   // Hello: latido con jitter, luego Identify o Resume
        const every = Number(p.d.heartbeat_interval);
        this.stopHeartbeat();
        this.ackPending = false;
        this.firstHeartbeat = setTimeout(() => { this.firstHeartbeat = null; this.beat(); this.heartbeat = setInterval(() => this.beat(), every); }, Math.floor(every * Math.random()));
        if (resume) this.send(6, { token, session_id: this.sessionId, seq: this.seq });
        else this.send(2, { token, intents: intentsDiscord(this.ctx.content), properties: { os: 'darwin', browser: 'work-shelter', device: 'work-shelter' } });
        break;
      }
      case 11: this.ackPending = false; break;
      case 1: this.beat(true); break;
      case 7: this.ws?.close(4900, 'reconectar'); break;   // Reconnect: cerrar y reanudar
      case 9: {   // Invalid Session: d=true se puede reanudar; si no, Identify nuevo tras una espera
        if (!p.d) { this.sessionId = null; this.urlResume = null; this.seq = null; }
        setTimeout(() => this.ws?.close(4901, 'invalid session'), 1000 + Math.random() * 4000);
        break;
      }
      case 0: this.dispatch(p.t ?? '', p.d); break;
    }
  }
  private stopHeartbeat() {
    if (this.firstHeartbeat) { clearTimeout(this.firstHeartbeat); this.firstHeartbeat = null; }
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
  }
  private beat(already = false) {
    if (!already && this.ackPending) { this.ws?.terminate(); return; }   // conexión zombi: sin ACK del latido anterior
    this.ackPending = true; this.send(1, this.seq);
  }
  private dispatch(t: string, d: any) {
    switch (t) {
      case 'READY':
        this.sessionId = d.session_id; this.urlResume = d.resume_gateway_url; this.attempts = 0;
        if (d.user?.id) this.ctx.bot = d.user.id;
        for (const g of d.guilds ?? []) if (!this.ctx.servers.has(g.id)) this.ctx.servers.set(g.id, g.name ?? 'servidor');
        this.good(this.connectedText());
        this.notify?.('estado');
        setTimeout(() => { this.refreshRoles().then(() => this.fill()).catch(() => {}); }, 3000);   // tras los GUILD_CREATE
        break;
      case 'RESUMED': this.attempts = 0; this.good(this.connectedText()); this.notify?.('estado'); break;
      case 'GUILD_CREATE': case 'GUILD_UPDATE':
        if (d.unavailable) break;
        this.ctx.servers.set(d.id, d.name);
        if (d.channels) this.guilds.set(d.id, { id: d.id, roles: d.roles ?? this.guilds.get(d.id)?.roles, members: d.members ?? this.guilds.get(d.id)?.members });
        for (const r of d.roles ?? []) this.ctx.roles.set(r.id, r.name);
        for (const c of d.channels ?? []) this.raw.set(c.id, { ...c, guild_id: d.id });
        for (const c of d.channels ?? []) this.ctx.channels.set(c.id, { name: c.name, guild: d.id, type: c.type, parent: undefined, last: c.last_message_id ?? undefined, visible: canSeeDiscord(c, this.guilds.get(d.id), this.ctx.bot) });
        for (const h of d.threads ?? []) this.ctx.channels.set(h.id, { name: h.name, guild: d.id, type: h.type, parent: h.parent_id, last: h.last_message_id ?? undefined, visible: this.ctx.channels.get(h.parent_id)?.visible });
        if (t === 'GUILD_CREATE') { this.rolesWhen = 0; this.good(this.connectedText()); }
        this.computeHidden();
        break;
      case 'CHANNEL_CREATE': case 'CHANNEL_UPDATE': case 'THREAD_CREATE': case 'THREAD_UPDATE': {
        const thread = t.startsWith('THREAD'), g = this.guilds.get(d.guild_id);
        this.ctx.channels.set(d.id, { name: d.name, guild: d.guild_id, type: d.type, parent: thread ? d.parent_id : undefined, last: d.last_message_id ?? this.ctx.channels.get(d.id)?.last,
          visible: thread ? this.ctx.channels.get(d.parent_id)?.visible : g && canSeeDiscord(d, g, this.ctx.bot) });
        if (!thread) { this.raw.set(d.id, d); this.computeHidden(); this.good(this.connectedText()); }
        break;
      }
      case 'GUILD_ROLE_CREATE': case 'GUILD_ROLE_UPDATE': {
        this.ctx.roles.set(d.role.id, d.role.name);
        const g = this.guilds.get(d.guild_id);
        if (g) { g.roles = [...(g.roles ?? []).filter((r: any) => r.id !== d.role.id), d.role]; this.computeHidden(); }
        break;
      }
      case 'GUILD_DELETE': if (!d.unavailable) this.ctx.servers.delete(d.id); break;
      case 'MESSAGE_CREATE': {
        const c = this.ctx.channels.get(d.channel_id); if (c) c.last = d.id;
        const n = discordNotification(d, this.ctx);
        if (n) { this.queue.push(n); if (this.queue.length > 300) this.queue.splice(0, this.queue.length - 300); this.notify?.('sondear'); }
        break;
      }
    }
  }
  private connectedText() {
    const n = this.ctx.servers.size;
    const text = [...this.ctx.channels].filter(([, c]) => [0, 5, 15].includes(c.type ?? -1));
    const blind = text.filter(([id, c]) => c.visible === false && (!this.ctx.chosen.size || this.ctx.chosen.has(id))).map(([, c]) => '#' + c.name);
    const channels = this.ctx.chosen.size ? tr('integrations.chosenChannels', { n: this.ctx.chosen.size }) : tr('integrations.discordVisibleChannels', { n: text.length - blind.length });
    return tr(n === 1 ? 'integrations.discordConnectedOne' : 'integrations.discordConnected', { bot: this.app?.name ?? 'work-shelter', n, servidores: [...this.ctx.servers.values()].join(', '), canales: channels })
      + (blind.length ? tr(blind.length === 1 ? 'integrations.discordBlindOne' : 'integrations.discordBlind', { n: blind.length, canales: blind.slice(0, 8).join(', ') + (blind.length > 8 ? '…' : '') }) : '')
      + (this.ctx.content ? '' : tr('integrations.discordWithoutContent'))
      + (this.ctx.me ? '' : tr('integrations.discordSetUserId'));
  }
  private onClose(ws: WebSocket, code: number) {
    if (this.ws !== ws) return;
    this.ws = null;
    this.stopHeartbeat();
    if (this.stopped) return;
    const c = closingDiscord(code);
    if (c.withoutContent) { this.ctx.content = false; this.sessionId = null; }
    if (!c.resume) { this.sessionId = null; this.urlResume = null; this.seq = null; }
    if (!c.reconnect) { this.reasonFatal = c.message ?? tr('integrations.discordClosed', { codigo: code }); this.fail(this.reasonFatal); this.notify?.('estado'); return; }
    if (c.message) this.situation = { state: 'conectada', detail: c.message };
    const wait = c.withoutContent ? 1000 : Math.min(60_000, 1000 * 2 ** this.attempts++) + Math.random() * 1000;
    this.reconnection = setTimeout(() => { this.reconnection = null; this.connect().catch(e => this.fail(message(e))); }, wait);
  }
  protected onRestart() {
    this.stopped = true;
    if (this.reconnection) { clearTimeout(this.reconnection); this.reconnection = null; }
    this.stopHeartbeat();
    const ws = this.ws; this.ws = null; try { ws?.close(1000); } catch { /* ya cerrado */ }
    this.sessionId = null; this.urlResume = null; this.seq = null; this.app = null; this.reasonFatal = null;
    this.ctx = contextDiscordEmpty(); this.guilds.clear(); this.raw.clear(); this.myRoles.clear(); this.queue = []; this.filled = false; this.rolesWhen = 0;
  }

  // El sondeo arranca el Gateway si hace falta y entrega lo acumulado (el Gateway avisa con 'sondear' al llegar algo)
  protected async pollReal() {
    if (this.reasonFatal) throw new ErrorSource(this.reasonFatal);
    if (!this.ws && !this.reconnection) await this.connect();
    this.ctx.chosen = this.chosen();
    this.refreshRoles().catch(() => {});
    const notifications = this.queue; this.queue = [];
    return { notifications };
  }
  protected async tryReal(v: Record<string, string>) {
    const t = v.token.replace(/^Bot\s+/i, '').trim();
    if (!/^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(t)) return { ok: false, detail: tr('server.thatDoesNotLookLike') };
    let a;
    try { a = await this.loadApp(t); } catch (e) { return { ok: false, detail: message(e) }; }
    if (a.team && !v.usuario) return { ok: false, detail: tr('server.theBotBelongsToA') };
    const servers: any[] = await this.rest('/users/@me/guilds', t);
    const content = grantedContent(a.flags);
    if (!servers.length) return { ok: false, detail: tr('server.theTokenIsValidBot', { nombre: a.name, id: invitationDiscord(a.id) }) };
    return { ok: true, detail: tr('server.botIn', { nombre: a.name, name: servers.map(s => s.name).join(', '), texto: content ? tr('integrations.discordContentOn') : tr('integrations.discordContentOff') }) };
  }
  protected async ownAction(name: string, d: Record<string, any>) {
    if (name === 'invitacion') { const a = this.app ?? await this.loadApp(); return { url: invitationDiscord(a.id, d.guild) }; }
    if (name === 'canales') {   // para el selector de la cámara acorazada, una vez conectado
      const el = this.chosen();
      const servers: any[] = await this.rest('/users/@me/guilds');
      const out: any[] = [];
      for (const s of servers) for (const c of eligibleChannels(await this.rest(`/guilds/${s.id}/channels`))) out.push({ ...c, server: s.name, picked: el.has(c.id) });
      return out;
    }
    return super.ownAction(name, d);
  }
}

export function create(store: Store) { return new Discord(store); }
