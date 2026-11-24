// Slack: mensajes nuevos de los canales a los que pertenece el token, solo lectura (la app no tiene chat:write).
// Vale un token de bot (xoxb-, de una app propia instalada en tu espacio de trabajo: lee los canales a los que la
// invites) o uno de usuario (xoxp-, de la misma app con permisos de usuario: lee lo que ves tú, también tus mensajes
// directos). Sondeo cada minuto con conversations.history desde el último mensaje visto de cada canal (las primeras
// 24 h al conectar). Prioridad alta: mensajes directos y menciones a ti; media: @here/@channel y grupos.
import type { Store } from '../state.ts';
import { ConnectorBase, ConfigSource, ErrorSource, ask, delay, type Field } from './common.ts';
import { slackChannel, contextSlackEmpty, explainErrorSlack, slackNotification, type ContextSlack } from './normalize.ts';
import type { Notification } from './adapters.ts';
import { t as tr } from '../../shared/language.ts';

const API = 'https://slack.com/api/';
const MAX_CHANNELS = 25;        // por sondeo, los de actividad más reciente (el límite de conversations.history es ~50/min)
const EACH_CHANNELS = 10 * 60_000;

export const FIELDS_SLACK: Field[] = [
  { name: 'token', label: 'Token de OAuth (xoxb- o xoxp-)', secret: true, help: 'api.slack.com/apps → tu app → OAuth & Permissions → «Bot User OAuth Token» (xoxb-) o «User OAuth Token» (xoxp-).', example: 'xoxb-…' },
  { name: 'canales', label: 'Canales a vigilar', optional: true, help: 'Se eligen en la cámara acorazada una vez conectado (IDs separados por comas). Vacío: todos. Los mensajes directos y las menciones a ti llegan siempre.' },
  { name: 'usuario', label: 'Tu ID de miembro de Slack', optional: true, help: 'Solo con token de bot, para avisarte de tus menciones: en Slack, tu perfil → ⋮ → «Copiar ID de miembro» (empieza por U). Con token de usuario se sabe solo.' },
];

class Slack extends ConnectorBase {
  id = 'slack' as const;
  intervalMs = 60_000;
  private ctx: ContextSlack = contextSlackEmpty();
  private nameTeam = '';
  private whenChannels = 0;
  private lastSeen = new Map<string, string>();     // canal → ts del último mensaje visto
  private activity = new Map<string, number>();  // canal → cuándo se movió por última vez (para elegir los que se sondean)
  constructor(store: Store) { super(store, new ConfigSource(store, 'slack', FIELDS_SLACK)); }
  protected onRestart() { this.ctx = contextSlackEmpty(); this.whenChannels = 0; this.lastSeen.clear(); this.activity.clear(); this.nameTeam = ''; }

  private async call(method: string, params: Record<string, string> = {}, token?: string): Promise<any> {
    const t = token ?? await this.config.secret('token');
    if (!t) throw new ErrorSource(tr('server.theSlackTokenIsMissing'));
    const r = await ask(API + method + '?' + new URLSearchParams(params), { service: 'Slack', headers: { Authorization: `Bearer ${t}` } });
    if (r.state === 429) throw new ErrorSource(explainErrorSlack('ratelimited'), delay(r, 60));
    if (!r.json?.ok) throw new ErrorSource(explainErrorSlack(r.json?.error ?? `HTTP ${r.state}`, r.json?.needed));
    return r.json;
  }
  private chosen() { return new Set((this.config.publicFields().canales ?? '').split(/[\s,;]+/).filter(x => /^[CGD][A-Z0-9]{6,}$/.test(x))); }
  private async nameOf(user: string) {
    if (!user || this.ctx.users.has(user)) return;
    try { const u = (await this.call('users.info', { user: user })).user; this.ctx.users.set(user, u?.profile?.display_name || u?.real_name || u?.name || user); }
    catch { this.ctx.users.set(user, user); }
  }
  // Canales del token (y quién soy) cada 10 minutos
  private async refreshChannels() {
    if (Date.now() - this.whenChannels < EACH_CHANNELS && this.ctx.channels.size) return;
    const me = await this.call('auth.test');
    const token = (await this.config.secret('token')) ?? '';
    this.ctx.team = me.team_id; this.nameTeam = me.team ?? '';
    this.ctx.bot = me.bot_id;
    this.ctx.me = token.startsWith('xoxp-') ? me.user_id : this.config.publicFields().usuario || undefined;
    const channels: any[] = [];
    let cursor = '';
    for (let page = 0; page < 10; page++) {
      const r = await this.call('users.conversations', { types: 'public_channel,private_channel,mpim,im', exclude_archived: 'true', limit: '200', ...(cursor ? { cursor } : {}) });
      channels.push(...(r.channels ?? []));
      cursor = r.response_metadata?.next_cursor ?? ''; if (!cursor) break;
    }
    for (const c of channels) if (c.is_im) await this.nameOf(c.user);
    this.ctx.channels = new Map(channels.map(c => [c.id, slackChannel(c, this.ctx.users)]));
    this.ctx.chosen = this.chosen();
    this.whenChannels = Date.now();
  }

  protected async pollReal() {
    await this.refreshChannels();
    this.ctx.chosen = this.chosen();
    const since = String((Date.now() - 86_400_000) / 1000);
    // los elegidos (o todos), más los directos, por actividad reciente
    const ids = [...this.ctx.channels].filter(([id, c]) => !this.ctx.chosen.size || this.ctx.chosen.has(id) || c.type === 'direct')
      .map(([id]) => id).sort((a, b) => (this.activity.get(b) ?? 0) - (this.activity.get(a) ?? 0)).slice(0, MAX_CHANNELS);
    const notifications: Notification[] = [];
    for (const id of ids) {
      let r;
      try { r = await this.call('conversations.history', { channel: id, oldest: this.lastSeen.get(id) ?? since, limit: '20' }); }
      catch (e) { if (e instanceof ErrorSource && e.retryIn) throw e; continue; }   // un canal sin acceso no para el resto
      const messages: any[] = r.messages ?? [];
      if (!messages.length) continue;
      this.lastSeen.set(id, messages[0].ts); this.activity.set(id, Number(messages[0].ts) * 1000);
      for (const m of messages) { if (m.user) await this.nameOf(m.user); const n = slackNotification(m, id, this.ctx); if (n) notifications.push(n); }
    }
    this.good(tr('server.connectedToWatching', { slack: this.nameTeam || 'Slack', conversaciones: this.ctx.chosen.size ? tr('integrations.chosenChannels', { n: this.ctx.chosen.size }) : tr('integrations.conversations', { n: ids.length }), menciones: this.ctx.me ? '' : tr('integrations.slackSetMemberId') }));
    return { notifications };
  }
  protected async tryReal(v: Record<string, string>) {
    const t = v.token.trim();
    if (!/^xox[bp]-/.test(t)) return { ok: false, detail: tr('server.thatDoesNotLookLike2') };
    try {
      const me = await this.call('auth.test', {}, t);
      const n = (await this.call('users.conversations', { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '200' }, t)).channels?.length ?? 0;
      return { ok: true, detail: tr('integrations.slackValidToken', { equipo: me.team, quien: t.startsWith('xoxb-') ? ` (bot @${me.user})` : ` (${me.user})`, n, invita: n ? '' : tr('integrations.slackInvite') }) };
    } catch (e) { return { ok: false, detail: (e as Error).message }; }
  }
  protected async ownAction(name: string, d: Record<string, any>) {
    if (name === 'channels') {   // para el selector de la cámara acorazada, una vez conectado
      this.whenChannels = 0; await this.refreshChannels();
      const el = this.chosen();
      return [...this.ctx.channels].filter(([, c]) => c.type === 'channel' || c.type === 'private')
        .map(([id, c]) => ({ id, name: c.name.replace(/^#/, ''), server: this.nameTeam, picked: el.has(id) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return super.ownAction(name, d);
  }
}

export function create(store: Store) { return new Slack(store); }
