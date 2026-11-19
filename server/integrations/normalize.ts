// Normalizadores PUROS (sin red ni estado): respuestas de Microsoft Graph, Google (Gmail y Calendar), Discord, Slack,
// GitHub y Linear → Notificacion/Evento. También los textos de error en español. Se prueban contra test/fixtures
// (normalize.test.ts).
import type { Notification, CalendarEvent, Priority } from './adapters.ts';
import { t as tr, locale } from '../../shared/language.ts';

// ------------------------------------------------------------------ tiempo (la zona horaria del sistema)
// SHELTER_ZONA la fuerza (p. ej. «Europe/Paris»); si no, la del Mac.
export const TIME_ZONE = process.env.SHELTER_ZONA || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const DAY = 86_400_000;
const ZONES_WINDOWS: Record<string, string> = { 'Romance Standard Time': 'Europe/Madrid', 'W. Europe Standard Time': 'Europe/Berlin', 'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'UTC', 'Coordinated Universal Time': 'UTC', 'tzone://Microsoft/Utc': 'UTC' };
function validZone(z?: string) {
  const x = z ? ZONES_WINDOWS[z] ?? z : TIME_ZONE;
  try { new Intl.DateTimeFormat('en-US', { timeZone: x }); return x; } catch { return TIME_ZONE; }
}
const formats = new Map<string, Intl.DateTimeFormat>();
function parts(t: number, zone: string) {
  let f = formats.get(zone);
  if (!f) formats.set(zone, f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}
const offset = (t: number, zone: string) => { const p = parts(t, zone); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000; };
// «2026-10-13T09:30:00.0000000» en una zona (sin desfase en la cadena) → milisegundos Unix
export function localAEpoch(date: string, zone = TIME_ZONE): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(date);
  if (!m) return NaN;
  const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  const z = validZone(zone);
  if (z === 'UTC') return base;
  let t = base - offset(base, z); t = base - offset(t, z);
  return t;
}
export function dateInZone(t: number, zone = TIME_ZONE) { const p = parts(t, zone); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; }
export const dayStart = (t = Date.now(), zone = TIME_ZONE) => localAEpoch(dateInZone(t, zone), zone);
const nextDay = (date: string) => new Date(Date.parse(date.slice(0, 10) + 'T00:00:00Z') + DAY).toISOString().slice(0, 10);
// Fecha de un snowflake de Discord
export const dateSnowflake = (id: string) => Number((BigInt(id) >> 22n) + 1420070400000n);

// ------------------------------------------------------------------ texto
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', iexcl: '¡', iquest: '¿', euro: '€' };
export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (t, e: string) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENTITIES[e.toLowerCase()] ?? t);
}
// HTML → texto plano saneado
export function htmlText(html: string | false | null | undefined) {
  if (!html) return '';
  return decodeEntities(String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, ' ').replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ').trim();
}
// Markdown ligero (comentarios de Linear) → texto
export const markdownText = (s: string) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`~#>]+/g, '').replace(/\s+/g, ' ').trim();
export const truncate = (s: string, n = 280) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
const LINK_VIDEO = /https:\/\/(?:teams\.microsoft\.com\/l\/meetup-join|teams\.live\.com\/meet|meet\.google\.com|[\w.-]*zoom\.us\/j|[\w.-]*webex\.com\/(?:meet|join)|meet\.jit\.si)[^\s"'<>)]*/i;
export const linkVideo = (...texts: (string | undefined | null | false)[]) => { for (const t of texts) { const m = t ? LINK_VIDEO.exec(String(t)) : null; if (m) return m[0]; } return undefined; };

// ------------------------------------------------------------------ Microsoft Graph (Outlook)
export interface MicrosoftMe { name?: string; email?: string }
const dir = (x: any) => x?.emailAddress ?? {};
export function mailPriority(m: any, me: MicrosoftMe = {}): Priority {
  const view = String(m.bodyPreview ?? '');
  const name = me.name?.trim();
  const mentioned = m.mentionsPreview?.isMentioned === true || (!!name && (view.includes('@' + name) || view.includes('@' + name.split(/\s+/)[0] + ' ')));
  if (m.importance === 'high' || mentioned) return 'alta';
  const email = me.email?.toLowerCase();
  const direct = !!email && (m.toRecipients ?? []).some((r: any) => dir(r).address?.toLowerCase() === email);
  if (m.flag?.flagStatus === 'flagged' || (direct && m.inferenceClassification !== 'other' && m.importance !== 'low')) return 'media';
  return 'baja';
}
export function emailNotification(m: any, me: MicrosoftMe = {}): Notification | null {
  if (!m?.id || m['@removed'] || m.isRead === true) return null;
  const from = dir(m.from ?? m.sender);
  return {
    id: 'outlook-' + m.id, source: 'outlook', thread: 'outlook-' + (m.conversationId ?? m.id), channel: m.inferenceClassification === 'other' ? tr('integrations.outlookOther') : tr('integrations.outlookInbox'),
    author: from.name || from.address || tr('integrations.unknownSender'), title: (m.subject || tr('integrations.noSubject')) + (m.hasAttachments ? tr('integrations.withAttachment') : ''),
    snippet: truncate(String(m.bodyPreview ?? '').replace(/\s+/g, ' ').trim()), date: Date.parse(m.receivedDateTime), priority: mailPriority(m, me),
    link: m.webLink ? m.webLink + (m.webLink.includes('ispopout=') ? '' : '&ispopout=0') : 'https://outlook.office.com/mail/',
  };
}
export const mailsToNotifications = (json: any, me?: MicrosoftMe) => ((json?.value ?? []) as any[]).map(m => emailNotification(m, me)).filter((n): n is Notification => !!n);

const GENERIC_PLACES = /^(reunión de microsoft teams|microsoft teams meeting|microsoft teams)$/i;
export function outlookEvent(e: any): CalendarEvent | null {
  if (!e?.id || e.isCancelled) return null;
  const start = localAEpoch(e.start?.dateTime ?? '', e.start?.timeZone), end = localAEpoch(e.end?.dateTime ?? '', e.end?.timeZone);
  if (!Number.isFinite(start)) return null;
  const place = String(e.location?.displayName ?? '').trim();
  const video = e.onlineMeeting?.joinUrl || e.onlineMeetingUrl || linkVideo(place, e.bodyPreview);
  return {
    id: 'outlook-' + e.id, source: 'outlook', title: e.subject || tr('integrations.untitled'), start, end: Number.isFinite(end) ? end : start, allDay: !!e.isAllDay,
    place: place && !(video && GENERIC_PLACES.test(place)) ? place : undefined, videollamada: video || undefined,
    link: 'https://outlook.office365.com/calendar/item/' + encodeURIComponent(e.id), organizer: dir(e.organizer).name || undefined,
  };
}
export const outlookEvents = (json: any) => ((json?.value ?? []) as any[]).map(outlookEvent).filter((e): e is CalendarEvent => !!e);

// Errores de inicio de sesión (Entra ID): cuerpo de /token o parámetros de la redirección
export function explainErrorMicrosoft(x: { error?: string; error_description?: string; error_codes?: number[]; error_subcode?: string; suberror?: string }): string {
  const desc = String(x.error_description ?? '');
  const code = x.error_codes?.[0] ?? Number(/AADSTS(\d+)/.exec(desc)?.[1] ?? 0);
  switch (code) {
    case 65001: return tr('integrations.msPermissionsMissing');
    case 90094: case 65004: return tr('integrations.msNotGranted');
    case 50076: case 50079: return tr('integrations.msTwoStep');
    case 700082: case 50173: case 70008: case 70000: return tr('integrations.msSessionExpired');
  }
  if (x.error === 'access_denied' && x.error_subcode === 'cancel') return tr('integrations.msCancelled');
  if (x.error === 'consent_required' || x.suberror === 'consent_required') return tr('integrations.msConsentRequired');
  if (x.error === 'invalid_grant') return tr('integrations.msSessionExpired');
  return tr('integrations.msResponded', { detalle: desc.split(/\r?\n| Trace ID:/)[0] || x.error || tr('integrations.unknownError') });
}
export function explainErrorGraph(state: number, body: any): string {
  const c = body?.error?.code ?? '';
  if (state === 401) return tr('integrations.msSessionRejected');
  if (state === 403 || c === 'ErrorAccessDenied') return tr('integrations.msAccessDenied');
  if (c === 'MailboxNotEnabledForRESTAPI' || c === 'MailboxNotSupportedForRESTAPI') return tr('integrations.msMailboxNotExchange');
  if (state === 429) return tr('integrations.msRateLimited');
  if (state >= 500) return tr('integrations.msBadResponse', { estado: state });
  return tr('integrations.graphResponded', { estado: state, codigo: c ? ' (' + c + ')' : '', detalle: body?.error?.message ?? tr('integrations.noDetail') });
}

// ------------------------------------------------------------------ Discord
export const PERMISSIONS_DISCORD = 1024 + 65536;   // VIEW_CHANNEL | READ_MESSAGE_HISTORY = 66560 (solo lectura)
export const INTENTS = { GUILDS: 1, GUILD_MESSAGES: 512, MESSAGE_CONTENT: 32768 };
export const FLAG_CONTENT = (1 << 18) | (1 << 19);   // GATEWAY_MESSAGE_CONTENT | GATEWAY_MESSAGE_CONTENT_LIMITED
export const grantedContent = (flagsApp: number) => (flagsApp & FLAG_CONTENT) !== 0;
export const intentsDiscord = (content: boolean) => INTENTS.GUILDS | INTENTS.GUILD_MESSAGES | (content ? INTENTS.MESSAGE_CONTENT : 0);
export const invitationDiscord = (appId: string, guild?: string) => `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot&permissions=${PERMISSIONS_DISCORD}${guild ? `&guild_id=${guild}&disable_guild_select=true` : ''}`;

export interface ChannelDiscord { name: string; guild: string; parent?: string; type?: number; last?: string; visible?: boolean }
export interface ContextDiscord {
  me?: string; bot?: string; myRoles: Set<string>; content: boolean;
  channels: Map<string, ChannelDiscord>; roles: Map<string, string>; servers: Map<string, string>;
  chosen: Set<string>;   // vacío = todos los canales que ve el bot
  hidden?: Set<string>;   // canales que el bot ve y el Supervisor no (con el bot de administrador): no se avisa de ellos
}
// ¿Ve este miembro (el bot o el Supervisor) el canal? VIEW_CHANNEL tras los permisos de sus roles y las sobrescrituras
// del canal, como lo calcula Discord. undefined si `guild.members` no lo trae: no se sabe y se da por visible.
// Los hilos heredan la visibilidad de su canal padre (se resuelve al guardarlos).
export function canSeeDiscord(channel: any, guild: any, memberId?: string): boolean | undefined {
  const me = memberId && (guild.members ?? []).find((m: any) => m.user?.id === memberId);
  if (!me) return undefined;
  const VIEW = 1024n, ADMIN = 8n, bits = (x: unknown) => BigInt(String(x ?? 0));
  const myRoles = new Set<string>([guild.id, ...(me.roles ?? [])]);
  let p = 0n;
  for (const r of guild.roles ?? []) if (myRoles.has(r.id)) p |= bits(r.permissions);
  if (p & ADMIN) return true;
  const ow = channel.permission_overwrites ?? [];
  const all = ow.find((o: any) => o.id === guild.id);
  if (all) p = (p & ~bits(all.deny)) | bits(all.allow);
  let deny = 0n, give = 0n;
  for (const o of ow) if (o.type === 0 && o.id !== guild.id && myRoles.has(o.id)) { deny |= bits(o.deny); give |= bits(o.allow); }
  p = (p & ~deny) | give;
  const isMine = ow.find((o: any) => o.type === 1 && o.id === memberId);
  if (isMine) p = (p & ~bits(isMine.deny)) | bits(isMine.allow);
  return (p & VIEW) !== 0n;
}
export const contextDiscordEmpty = (): ContextDiscord => ({ myRoles: new Set(), content: true, channels: new Map(), roles: new Map(), servers: new Map(), chosen: new Set() });

export function priorityDiscord(m: any, ctx: ContextDiscord): Priority {
  if (ctx.me && ((m.mentions ?? []).some((u: any) => u.id === ctx.me) || (m.type === 19 && m.referenced_message?.author?.id === ctx.me))) return 'alta';
  if ((m.mention_roles ?? []).some((r: string) => ctx.myRoles.has(r))) return 'alta';
  if (m.mention_everyone) return 'media';
  return 'baja';
}
const userName = (u: any, member?: any) => member?.nick || u?.global_name || u?.username || tr('integrations.someone');
export function textDiscord(m: any, ctx: ContextDiscord): string {
  const users = new Map<string, string>(((m.mentions ?? []) as any[]).map(u => [u.id, userName(u, u.member)]));
  let t = String(m.content ?? '')
    .replace(/<@!?(\d+)>/g, (_, id) => '@' + (users.get(id) ?? tr('integrations.user')))
    .replace(/<@&(\d+)>/g, (_, id) => '@' + (ctx.roles.get(id) ?? tr('integrations.role')))
    .replace(/<#(\d+)>/g, (_, id) => '#' + (ctx.channels.get(id)?.name ?? tr('integrations.channel')))
    .replace(/<a?:(\w+):\d+>/g, ':$1:').replace(/<t:(\d+)(?::\w)?>/g, (_, s) => new Date(+s * 1000).toLocaleString(locale(), { timeZone: TIME_ZONE }))
    .replace(/\s+/g, ' ').trim();
  if (!t && m.embeds?.length) t = [m.embeds[0].title, m.embeds[0].description].filter(Boolean).join(' — ');
  if (!t && m.attachments?.length) t = tr('integrations.attachment', { nombres: m.attachments.map((a: any) => a.filename).join(', ') });
  if (!t && m.sticker_items?.length) t = '(sticker)';
  if (!t && !ctx.content) t = tr('integrations.discordNoContent');
  return truncate(t || tr('integrations.noText'));
}
// null = no se notifica (propio, del bot, fuera de los canales elegidos y sin mención)
export function discordNotification(m: any, ctx: ContextDiscord): Notification | null {
  if (!m?.id || !m.author) return null;
  if (m.author.id === ctx.bot || (ctx.me && m.author.id === ctx.me)) return null;
  if (m.type !== 0 && m.type !== 19 && m.type !== 20 && m.type !== 21) return null;   // solo mensajes normales, respuestas y comandos
  const channel = ctx.channels.get(m.channel_id);
  if (ctx.hidden?.has(m.channel_id) || (channel?.parent && ctx.hidden?.has(channel.parent))) return null;
  const parent = channel?.parent ? ctx.channels.get(channel.parent) : undefined;
  const priority = priorityDiscord(m, ctx);
  const picked = !ctx.chosen.size || ctx.chosen.has(m.channel_id) || (!!channel?.parent && ctx.chosen.has(channel.parent));
  if (!picked && priority !== 'alta') return null;
  const guild = m.guild_id ?? channel?.guild ?? '@me';
  const channelName = channel ? (parent ? `#${parent.name} › ${channel.name}` : '#' + channel.name) : '#canal';
  const author = userName(m.author, m.member);
  return {
    id: 'discord-' + m.id, source: 'discord', thread: 'discord-' + m.channel_id, channel: channelName, author,
    title: `${channelName}${ctx.servers.size > 1 && ctx.servers.get(guild) ? ' (' + ctx.servers.get(guild) + ')' : ''}`,
    snippet: textDiscord(m, ctx), date: m.timestamp ? Date.parse(m.timestamp) : dateSnowflake(m.id), priority,
    link: `https://discord.com/channels/${guild}/${m.channel_id}/${m.id}`,
  };
}
// Canales para elegir en la cámara acorazada: texto (0), anuncios (5) y foros (15), agrupados por categoría y ordenados
export function eligibleChannels(list: any[]): { id: string; name: string; type: number; category?: string; guild?: string }[] {
  const cats = new Map(list.filter(c => c.type === 4).map(c => [c.id, c]));
  const pos = (c: any) => c ? c.position ?? 0 : -1;
  return list.filter(c => [0, 5, 15].includes(c.type))
    .sort((a, b) => pos(cats.get(a.parent_id)) - pos(cats.get(b.parent_id)) || (a.position ?? 0) - (b.position ?? 0))
    .map(c => ({ id: c.id, name: c.name, type: c.type, category: cats.get(c.parent_id)?.name, guild: c.guild_id }));
}
// Cierre del Gateway: ¿se reconecta? y qué decirle al usuario
export function closingDiscord(code: number): { reconnect: boolean; resume: boolean; message?: string; withoutContent?: boolean } {
  switch (code) {
    case 4004: return { reconnect: false, resume: false, message: tr('integrations.discordInvalidToken') };
    case 4014: return { reconnect: true, resume: false, withoutContent: true, message: tr('integrations.discordNoContentIntent') };
    case 4013: return { reconnect: false, resume: false, message: tr('integrations.discordIntentsRejected') };
    case 4010: case 4011: case 4012: return { reconnect: false, resume: false, message: tr('integrations.discordClosedCode', { codigo: code }) };
    case 4007: case 4009: return { reconnect: true, resume: false };
    case 1000: case 1001: return { reconnect: true, resume: false };
    default: return { reconnect: true, resume: true };
  }
}
export function explainErrorDiscord(state: number, body: any): string {
  if (state === 401) return tr('integrations.discordBotTokenInvalid');
  if (state === 403 || body?.code === 50001 || body?.code === 50013) return tr('integrations.discordNoAccess');
  if (state === 404 || body?.code === 10003) return tr('integrations.discordNotFound');
  if (state === 429) return tr('integrations.discordRateLimited', { s: Math.ceil(Number(body?.retry_after ?? 5)) });
  return tr('integrations.discordResponded', { estado: state, detalle: body?.message ?? tr('integrations.noDetail') });
}

// ------------------------------------------------------------------ Google (Gmail y Calendar)
const headerGmail = (m: any, name: string) => ((m?.payload?.headers ?? []) as any[]).find(h => String(h.name).toLowerCase() === name.toLowerCase())?.value as string | undefined;
// «Ana Ruiz <ana@example.com>» → «Ana Ruiz» (o la dirección si no hay nombre)
export function senderName(s?: string) {
  if (!s) return tr('integrations.unknownSender');
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s);
  return (m ? m[1].trim() || m[2] : s).trim();
}
const categoryGmail = (): Record<string, string> => ({ CATEGORY_PROMOTIONS: tr('integrations.gmailPromotions'), CATEGORY_SOCIAL: tr('integrations.gmailSocial'), CATEGORY_UPDATES: tr('integrations.gmailUpdates'), CATEGORY_FORUMS: tr('integrations.gmailForums') });
// Un mensaje de users.messages.get (format=metadata). Sin UNREAD no se avisa. Prioridad: IMPORTANT de Gmail (y destacado) → media;
// importante en Principal → alta
export function gmailNotification(m: any): Notification | null {
  const labels: string[] = m?.labelIds ?? [];
  if (!m?.id || !labels.includes('UNREAD')) return null;
  const cats = categoryGmail(), category = labels.map(e => cats[e]).find(Boolean);
  const important = labels.includes('IMPORTANT');
  const priority: Priority = important && !category ? 'alta' : important || labels.includes('STARRED') ? 'media' : 'baja';
  const date = Number(m.internalDate) || Date.parse(headerGmail(m, 'Date') ?? '');
  return {
    id: 'google-' + m.id, source: 'google', thread: 'google-' + (m.threadId ?? m.id), channel: category ?? tr('integrations.inbox'),
    author: senderName(headerGmail(m, 'From')), title: headerGmail(m, 'Subject') || tr('integrations.noSubject'),
    snippet: truncate(decodeEntities(String(m.snippet ?? '')).replace(/\s+/g, ' ').trim()), date: Number.isFinite(date) ? date : Date.now(), priority,
    link: `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(m.threadId ?? m.id)}`,
  };
}
// ------------------------------------------------------------------ Mail del Mac (Gmail sin proyecto en Google Cloud)
// Un mensaje de mail.jxa (Mail.app). Mail no da hilos ni etiquetas: el hilo es el asunto sin «Re:»/«Fwd:» en esa cuenta y
// la prioridad, la bandera. Si la cuenta es de Gmail (también Google Workspace), el enlace abre ese correo en Gmail (en
// la cuenta de esa dirección); si no, en Mail.
export interface AccountMail { nombre: string; servidor?: string; mails?: string[] }
export interface MessageMail { id: string; cuenta: string; asunto?: string; remitente?: string; fecha?: number; marcado?: boolean; texto?: string }
export const isGmail = (c?: AccountMail) => !!c && /(^|\.)(gmail|googlemail)\.com$/i.test(c.servidor ?? '');
const threadSubject = (s: string) => s.replace(/^\s*((re|fwd?|rv|reenviado|aw|wg)\s*(\[\d+\])?\s*:\s*)+/i, '').trim().toLowerCase();
export function mailNotification(m: MessageMail, count?: AccountMail, snippet?: string): Notification | null {
  if (!m?.id) return null;
  const id = String(m.id).replace(/^<|>$/g, ''), subject = String(m.asunto ?? '').trim();
  const email = count?.mails?.[0];
  const link = isGmail(count)
    ? `https://mail.google.com/mail/${email ? '?authuser=' + encodeURIComponent(email) : 'u/0/'}#search/${encodeURIComponent('rfc822msgid:' + id)}`
    : `message://${encodeURIComponent('<' + id + '>')}`;
  return {
    id: 'mail-' + id, source: 'mail', thread: `mail-${m.cuenta}-${threadSubject(subject) || id}`, channel: m.cuenta || tr('integrations.inbox'),
    author: senderName(m.remitente), title: subject || tr('integrations.noSubject'),
    snippet: truncate(String(snippet ?? m.texto ?? '').replace(/\s+/g, ' ').trim()), date: Number(m.fecha) || Date.now(),
    priority: m.marcado ? 'alta' : 'media', link,
  };
}
export function explainErrorMail(output: string) {
  if (/-1743|not authori[sz]ed|no autorizad/i.test(output)) return tr('integrations.mailNotAllowed');
  if (/-600|isn.t running|no se está ejecutando/i.test(output)) return tr('integrations.mailClosed');
  if (/timed out|ETIMEDOUT|SIGTERM/i.test(output)) return tr('integrations.mailTimeout');
  return tr('integrations.mailCouldNotRead', { detalle: output.trim().split('\n').pop() || tr('integrations.noDetail') });
}
// ------------------------------------------------------------------ Calendario del Mac (calendar.jxa)
export interface EventCalendarMac { calendario: string; uid: string; titulo: string; inicio: number; fin: number; allElDay: boolean; lugar?: string; notas?: string; estado?: string; rule?: string; excluded?: number[] }
const WEEK_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
// fecha de UNTIL: 20200526T215959Z (UTC), 20200526T215959 o 20200526 (hora local; el día entero)
function ruleEnd(x: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(x);
  if (!m) return Infinity;
  const [y, mo, d, h = '23', mi = '59', sec = '59'] = m.slice(1);
  return m[7] ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec) : new Date(+y, +mo - 1, +d, +h, +mi, +sec).getTime();
}
/** Inicios de las repeticiones de una regla RRULE (lo que usa Calendario: FREQ DAILY/WEEKLY/MONTHLY/YEARLY con INTERVAL,
 *  COUNT, UNTIL, BYDAY, BYMONTHDAY y BYMONTH) que caen en [desde, hasta), sin las fechas excluidas. En hora local: una
 *  reunión de las 10 sigue a las 10 al cambiar de horario de verano */
export function repetitions(rule: string, start: number, since: number, until: number, excluded: number[] = []): number[] {
  const r = Object.fromEntries(rule.split(';').map(p => p.split('=')).filter(p => p.length === 2).map(([k, v]) => [k.toUpperCase(), v]));
  const freq = r.FREQ, step = Math.max(1, Number(r.INTERVAL) || 1), count = Number(r.COUNT) || Infinity, cap = Math.min(until, r.UNTIL ? ruleEnd(r.UNTIL) + 1 : Infinity);
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return [];
  const b = new Date(start), time = [b.getHours(), b.getMinutes(), b.getSeconds()] as const;
  const days = (r.BYDAY ?? '').split(',').filter(Boolean).map((x: string) => { const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(x); return m ? { n: m[1] ? +m[1] : 0, d: WEEK_DAYS.indexOf(m[2]) } : null; }).filter((x: any) => x && x.d >= 0) as { n: number; d: number }[];
  const monthDays = (r.BYMONTHDAY ?? '').split(',').filter(Boolean).map(Number).filter((n: number) => n && Math.abs(n) <= 31);
  const months = (r.BYMONTH ?? '').split(',').filter(Boolean).map(Number).filter((n: number) => n >= 1 && n <= 12);
  const en = (y: number, m: number, d: number) => new Date(y, m, d, ...time).getTime();
  const length = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  // los días de un mes que pide la regla (o el del inicio)
  const ofMonth = (y: number, m: number): number[] => {
    const n = length(y, m), out: number[] = [];
    if (days.length) for (const { n: k, d } of days) {
      const all = Array.from({ length: n }, (_, i) => i + 1).filter(x => new Date(y, m, x).getDay() === d);
      if (!k) out.push(...all); else { const x = k > 0 ? all[k - 1] : all[all.length + k]; if (x) out.push(x); }
    }
    else if (monthDays.length) for (const k of monthDays) { const x = k > 0 ? k : n + k + 1; if (x >= 1 && x <= n) out.push(x); }
    else if (b.getDate() <= n) out.push(b.getDate());
    return [...new Set(out)].sort((a, c) => a - c).map(x => en(y, m, x));
  };
  const outside = (t: number) => excluded.some(x => Math.abs(x - t) < 60_000);
  const out: number[] = [];
  let done = 0;
  for (let k = 0; k < 20_000; k++) {
    let period: number[];
    if (freq === 'DAILY') period = [en(b.getFullYear(), b.getMonth(), b.getDate() + k * step)];
    else if (freq === 'WEEKLY') {
      const monday = b.getDate() - ((b.getDay() + 6) % 7) + k * step * 7;
      period = (days.length ? days.map(x => x.d) : [b.getDay()]).map(d => en(b.getFullYear(), b.getMonth(), monday + ((d + 6) % 7))).sort((a, c) => a - c);
    } else if (freq === 'MONTHLY') { const f = new Date(b.getFullYear(), b.getMonth() + k * step, 1); period = ofMonth(f.getFullYear(), f.getMonth()); }
    else { const y = b.getFullYear() + k * step; period = (months.length ? months.map(m => m - 1) : [b.getMonth()]).flatMap(m => ofMonth(y, m)).sort((a, c) => a - c); }
    if (period.length && period[0] >= cap) break;
    for (const t of period) {
      if (t < start) continue;
      if (t >= cap || done >= count) return out;
      done++;
      if (t >= since && !outside(t)) out.push(t);
    }
  }
  return out;
}
// «Sugerencias de Siri»: lo que macOS saca del correo (invitaciones, reservas). No se actualiza al moverse la reunión de
// verdad, así que la duplica a la hora vieja: fuera
const SIRI_SUGGESTIONS = /^(siri suggestions|sugerencias de siri)$/i;
/** Los eventos de calendar.jxa entre desde y hasta: los repetidos, desplegados; sin cancelados, sin «Sugerencias de
 *  Siri» ni duplicados (una repetición movida llega como evento suelto con el mismo uid: manda ese) */
export function eventsOfCalendarMac(list: EventCalendarMac[], since: number, until: number): CalendarEvent[] {
  const loose = list.filter(e => !e.rule), out = new Map<string, CalendarEvent>();
  const daySame = (a: number, c: number) => new Date(a).toDateString() === new Date(c).toDateString();
  const set = (e: EventCalendarMac, start: number) => {
    const end = start + Math.max(0, e.fin - e.inicio), id = `calendario-${e.uid || e.titulo}-${start}`;
    if (end <= since || start >= until || out.has(id)) return;
    const video = linkVideo(e.lugar, e.notas);
    out.set(id, { id, source: 'calendario', title: e.titulo || tr('integrations.untitled'), start, end, allDay: e.allElDay, place: e.lugar || undefined, videollamada: video, link: video, organizer: e.calendario || undefined });
  };
  for (const e of list) {
    if (/cancel/i.test(e.estado ?? '') || SIRI_SUGGESTIONS.test(e.calendario) || !Number.isFinite(e.inicio) || !e.inicio) continue;
    if (!e.rule) { set(e, e.inicio); continue; }
    for (const t of repetitions(e.rule, e.inicio, since - Math.max(0, e.fin - e.inicio), until, e.excluded))
      if (!loose.some(x => x.uid && x.uid === e.uid && daySame(x.inicio, t))) set(e, t);
  }
  return [...out.values()].sort((a, c) => a.start - c.start);
}
export function explainErrorCalendar(output: string) {
  if (/-1743|not authori[sz]ed|no autorizad/i.test(output)) return tr('integrations.calendarNotAllowed');
  if (/-600|isn.t running|no se está ejecutando/i.test(output)) return tr('integrations.calendarClosed');
  if (/timed out|ETIMEDOUT|SIGTERM/i.test(output)) return tr('integrations.calendarTimeout');
  return tr('integrations.calendarCouldNotRead', { detalle: output.trim().split('\n').pop() || tr('integrations.noDetail') });
}

// Un evento de calendars/primary/events (singleEvents=true). Fuera los cancelados y los que he rechazado
export function googleEvent(e: any): CalendarEvent | null {
  if (!e?.id || e.status === 'cancelled') return null;
  if (((e.attendees ?? []) as any[]).some(a => a.self && a.responseStatus === 'declined')) return null;
  const all = !!e.start?.date && !e.start?.dateTime;
  const start = all ? localAEpoch(e.start.date) : Date.parse(e.start?.dateTime ?? '');
  if (!Number.isFinite(start)) return null;
  const end = all ? localAEpoch(e.end?.date ?? nextDay(e.start.date)) : Date.parse(e.end?.dateTime ?? '');
  const video = e.hangoutLink || ((e.conferenceData?.entryPoints ?? []) as any[]).find(p => p.entryPointType === 'video')?.uri || linkVideo(e.location, e.description);
  return {
    id: 'google-' + e.id, source: 'google', title: e.summary || tr('integrations.untitled'), start, end: Number.isFinite(end) ? end : start, allDay: all,
    place: e.location || undefined, videollamada: video || undefined, link: e.htmlLink || 'https://calendar.google.com/', organizer: e.organizer?.displayName || e.organizer?.email || undefined,
  };
}
export const googleEvents = (json: any) => ((json?.items ?? []) as any[]).map(googleEvent).filter((e): e is CalendarEvent => !!e);
// Errores del inicio de sesión de Google (cuerpo de /token o parámetros de la redirección)
export function explainErrorOAuthGoogle(x: { error?: string; error_description?: string }): string {
  switch (x.error) {
    case 'access_denied': return tr('integrations.googleAccessDenied');
    case 'invalid_client': case 'unauthorized_client': return tr('integrations.googleInvalidClient');
    case 'invalid_grant': return tr('integrations.googleSessionExpired');
    case 'redirect_uri_mismatch': return tr('integrations.googleRedirectMismatch');
    case 'invalid_scope': return tr('integrations.googleInvalidScope');
  }
  return tr('integrations.googleResponded', { detalle: x.error_description || x.error || tr('integrations.unknownError') });
}
export function explainErrorGoogle(state: number, body: any): string {
  const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.details?.find((d: any) => d.reason)?.reason ?? body?.error?.status ?? '';
  if (state === 401) return tr('integrations.googleSessionRejected');
  if (/accessNotConfigured|SERVICE_DISABLED/.test(reason)) return tr('integrations.googleApiDisabled');
  if (state === 403 && /insufficient|PERMISSION_DENIED|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reason + ' ' + (body?.error?.message ?? ''))) return tr('integrations.googleMissingPermissions');
  if (state === 429 || /rateLimitExceeded|userRateLimitExceeded|RESOURCE_EXHAUSTED/.test(reason)) return tr('integrations.googleRateLimited');
  if (state >= 500) return tr('integrations.googleBadResponse', { estado: state });
  return tr('integrations.googleRespondedStatus', { estado: state, motivo: reason ? ' (' + reason + ')' : '', detalle: body?.error?.message ?? tr('integrations.noDetail') });
}

// ------------------------------------------------------------------ GitHub (notificaciones)
const reasonGithub = (): Record<string, string> => ({
  approval_requested: tr('integrations.ghApprovalRequested'), assign: tr('integrations.ghAssign'), author: tr('integrations.ghAuthor'), comment: tr('integrations.ghComment'),
  ci_activity: tr('integrations.ghCiActivity'), invitation: tr('integrations.ghInvitation'), manual: tr('integrations.ghManual'), member_feature_requested: tr('integrations.ghFeatureRequested'),
  mention: tr('integrations.ghMention'), review_requested: tr('integrations.ghReviewRequested'), security_alert: tr('integrations.ghSecurityAlert'), security_advisory_credit: tr('integrations.ghAdvisoryCredit'),
  state_change: tr('integrations.ghStateChange'), subscribed: tr('integrations.ghSubscribed'), team_mention: tr('integrations.ghTeamMention'),
});
const typeGithub = (): Record<string, string> => ({ PullRequest: 'PR', Issue: 'Issue', Release: 'Release', Commit: 'Commit', CheckSuite: 'CI', Discussion: tr('integrations.ghDiscussion'), RepositoryVulnerabilityAlert: tr('integrations.ghSecurity') });
// La URL de la API del asunto → la de la web (pulls/12 → pull/12; los releases van por id, así que a la lista)
export function urlWebGitHub(api?: string | null, repo?: string): string {
  const m = api ? /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/(pulls|issues|commits|releases|discussions)\/([^/?#]+)$/.exec(api) : null;
  if (!m) return repo || 'https://github.com/notifications';
  const [, name, type, id] = m;
  if (type === 'releases') return `https://github.com/${name}/releases`;
  return `https://github.com/${name}/${type === 'pulls' ? 'pull' : type === 'commits' ? 'commit' : type}/${id}`;
}
// Un hilo de GET /notifications. El id cambia con cada actualización del hilo (suena otra vez y vuelve a «sin ver»)
export function notificationOfGitHub(n: any): Notification | null {
  if (!n?.id || n.unread === false) return null;
  const reason = String(n.reason ?? '');
  const priority: Priority = ['mention', 'team_mention', 'review_requested', 'assign', 'security_alert', 'approval_requested'].includes(reason) ? 'alta' : reason === 'subscribed' ? 'baja' : 'media';
  const type = typeGithub()[n.subject?.type] ?? n.subject?.type ?? tr('integrations.ghNotice');
  const date = Date.parse(n.updated_at ?? '');
  return {
    id: `github-${n.id}-${Number.isFinite(date) ? date : 0}`, source: 'github', thread: 'github-' + n.id, channel: n.repository?.full_name ?? 'GitHub',
    author: n.repository?.full_name ?? 'GitHub', title: `${type} · ${n.subject?.title ?? tr('integrations.untitled')}`,
    snippet: (reasonGithub()[reason] ?? reason) || tr('integrations.ghNews'), date: Number.isFinite(date) ? date : Date.now(), priority,
    link: urlWebGitHub(n.subject?.url, n.repository?.html_url),
  };
}
export const notificationsOfGitHub = (json: any) => ((Array.isArray(json) ? json : []) as any[]).map(notificationOfGitHub).filter((n): n is Notification => !!n);
export function explainErrorGitHub(state: number, body: any): string {
  if (state === 401) return tr('integrations.ghTokenRejected');
  if (state === 403 && /rate limit/i.test(body?.message ?? '')) return tr('integrations.ghRateLimited');
  if (state === 403 || state === 404) return tr('integrations.ghCannotReadNotifications');
  if (state >= 500) return tr('integrations.ghBadResponse', { estado: state });
  return tr('integrations.ghResponded', { estado: state, detalle: body?.message ?? tr('integrations.noDetail') });
}

// ------------------------------------------------------------------ Slack
export interface ChannelSlack { name: string; type: 'canal' | 'privado' | 'directo' | 'grupo' }
export interface ContextSlack {
  me?: string; bot?: string; team?: string;
  channels: Map<string, ChannelSlack>; users: Map<string, string>;
  chosen: Set<string>;   // vacío = todos los canales a los que pertenece el token
}
export const contextSlackEmpty = (): ContextSlack => ({ channels: new Map(), users: new Map(), chosen: new Set() });
// Un canal de conversations.list / users.conversations → nombre legible y tipo
export function slackChannel(c: any, users: Map<string, string> = new Map()): ChannelSlack {
  if (c.is_im) return { name: '@' + (users.get(c.user) ?? c.user ?? tr('integrations.direct')), type: 'directo' };
  if (c.is_mpim) return { name: String(c.name ?? tr('integrations.group')).replace(/^mpdm-/, '').replace(/-1$/, '').split('--').join(', '), type: 'grupo' };
  return { name: '#' + (c.name ?? c.id), type: c.is_private ? 'privado' : 'canal' };
}
// Formato de Slack (<@U1>, <#C1|general>, <!here>, <https://x|texto>, &amp;) → texto plano legible
export function textSlack(t: string, ctx: ContextSlack): string {
  return String(t ?? '')
    .replace(/<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g, (_, id, n) => '@' + (n ?? ctx.users.get(id) ?? tr('integrations.user')))
    .replace(/<#([CG][A-Z0-9]+)(?:\|([^>]*))?>/g, (_, id, n) => '#' + (n || ctx.channels.get(id)?.name.replace(/^#/, '') || tr('integrations.channel')))
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, '@$1').replace(/<!subteam\^[A-Z0-9]+(?:\|([^>]+))?>/g, (_, n) => n ?? '@' + tr('integrations.group'))
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2').replace(/<(https?:[^>]+)>/g, '$1').replace(/<mailto:[^|>]+\|([^>]+)>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
export function prioritySlack(m: any, channel: ChannelSlack | undefined, ctx: ContextSlack): Priority {
  const t = String(m.text ?? '');
  if (channel?.type === 'directo' || (ctx.me && t.includes(`<@${ctx.me}`))) return 'alta';
  if (/<!(here|channel|everyone)/.test(t) || channel?.type === 'grupo') return 'media';
  return 'baja';
}
const SUBTYPES_SLACK = new Set([undefined, 'thread_broadcast', 'file_share', 'bot_message', 'me_message']);
// Un mensaje de conversations.history. null = propio, del propio bot, de sistema (alguien entra o sale) o fuera de los elegidos sin mención
export function slackNotification(m: any, channelId: string, ctx: ContextSlack): Notification | null {
  if (!m?.ts || !SUBTYPES_SLACK.has(m.subtype)) return null;
  if ((ctx.me && m.user === ctx.me) || (ctx.bot && m.bot_id === ctx.bot)) return null;
  const channel = ctx.channels.get(channelId);
  const priority = prioritySlack(m, channel, ctx);
  if (ctx.chosen.size && !ctx.chosen.has(channelId) && priority !== 'alta') return null;
  const name = channel?.name ?? '#' + tr('integrations.channel');
  let text = textSlack(m.text, ctx);
  if (!text && m.files?.length) text = tr('integrations.attachment', { nombres: (m.files as any[]).map(f => f.name ?? f.title ?? tr('integrations.file')).join(', ') });
  return {
    id: `slack-${channelId}-${m.ts}`, source: 'slack', thread: 'slack-' + channelId, channel: name,
    author: ctx.users.get(m.user) ?? m.user_profile?.real_name ?? m.username ?? m.bot_profile?.name ?? tr('integrations.someone'),
    title: name, snippet: truncate(text || tr('integrations.noText')), date: Math.round(Number(m.ts) * 1000), priority,
    link: ctx.team ? `https://app.slack.com/client/${ctx.team}/${channelId}` : 'https://app.slack.com/client',
  };
}
export function explainErrorSlack(error: string, needed?: string): string {
  switch (error) {
    case 'invalid_auth': case 'not_authed': case 'token_revoked': case 'token_expired': case 'account_inactive':
      return tr('integrations.slackTokenRejected');
    case 'missing_scope': return tr('integrations.slackMissingScope', { necesario: needed ? ' (' + needed + ')' : '' });
    case 'not_in_channel': return tr('integrations.slackNotInChannel');
    case 'channel_not_found': return tr('integrations.slackChannelNotFound');
    case 'ratelimited': return tr('integrations.slackRateLimited');
  }
  return tr('integrations.slackResponded', { detalle: error || tr('integrations.unknownError') });
}

// ------------------------------------------------------------------ Linear
export function linearNotification(n: any, now = Date.now()): Notification | null {
  // como el inbox de Linear: sin leídas, archivadas, pospuestas ni las de issues en la papelera
  if (!n?.id || n.readAt || n.archivedAt || n.issue?.trashed || (n.snoozedUntilAt && Date.parse(n.snoozedUntilAt) > now)) return null;
  const type = String(n.type ?? '');
  const i = n.issue;
  const priority: Priority = /Mention|AssignedToYou|Urgent/i.test(type) || n.category === 'mentions' || n.category === 'assignments' || i?.priority === 1 ? 'alta'
    : /Comment|Reaction|Due|SlaHigh/i.test(type) || n.category === 'commentsAndReplies' || n.category === 'reminders' ? 'media' : 'baja';
  const author = n.actor?.name || n.actor?.displayName || n.botActor?.name || 'Linear';
  const body = n.comment?.body ? markdownText(n.comment.body) : '';
  return {
    id: 'linear-' + n.id, source: 'linear', thread: i?.id ? 'linear-' + i.id : undefined, channel: i?.identifier ?? i?.team?.key, author,
    title: i ? `${i.identifier} · ${i.title}` : n.title || tr('integrations.linearNotification'),
    snippet: truncate([n.subtitle, body && `«${body}»`].filter(Boolean).join(': ')), date: Date.parse(n.createdAt), priority,
    link: n.url || i?.url || 'https://linear.app/',
  };
}
export const linearNotifications = (json: any, now?: number) => ((json?.data?.notifications?.nodes ?? []) as any[]).map(n => linearNotification(n, now)).filter((n): n is Notification => !!n);

export const STATES_ORDER = ['triage', 'started', 'unstarted', 'backlog', 'completed', 'canceled', 'duplicate'];
const typeName = (): Record<string, string> => ({ triage: tr('integrations.linearTriage'), backlog: tr('integrations.linearBacklog'), unstarted: tr('integrations.linearUnstarted'), started: tr('integrations.linearStarted'), completed: tr('integrations.linearCompleted'), canceled: tr('integrations.linearCanceled'), duplicate: tr('integrations.linearDuplicate') });
export interface IssueLinear { id: string; identifier: string; title: string; url: string; priority: number; textPriority: string; state: { id: string; name: string; type: string; color: string }; team?: string; project?: string; cycle?: number; labels: { name: string; color: string }[]; due?: string; estimate?: number; assignee?: string; updated?: number }
export function linearIssue(i: any): IssueLinear {
  return {
    id: i.id, identifier: i.identifier, title: i.title, url: i.url, priority: i.priority ?? 0, textPriority: i.priorityLabel ?? '',
    state: { id: i.state?.id, name: i.state?.name, type: i.state?.type, color: i.state?.color }, team: i.team?.key, project: i.project?.name, cycle: i.cycle?.number,
    labels: (i.labels?.nodes ?? []).map((l: any) => ({ name: l.name, color: l.color })), due: i.dueDate ?? undefined, estimate: i.estimate ?? undefined,
    assignee: i.assignee?.name, updated: i.updatedAt ? Date.parse(i.updatedAt) : undefined,
  };
}
// Mis issues por estado: grupos por tipo de estado (en curso primero) y dentro, por posición del estado y prioridad
export function groupMyIssues(json: any) {
  const nodes: any[] = json?.data?.viewer?.assignedIssues?.nodes ?? [];
  const groups = new Map<string, { type: string; name: string; issues: IssueLinear[] }>();
  const prio = (p: number) => p === 0 ? 5 : p;
  for (const n of [...nodes].sort((a, b) => (a.state?.position ?? 0) - (b.state?.position ?? 0) || prio(a.priority) - prio(b.priority))) {
    const t = n.state?.type ?? 'unstarted';
    if (!groups.has(t)) groups.set(t, { type: t, name: typeName()[t] ?? t, issues: [] });
    groups.get(t)!.issues.push(linearIssue(n));
  }
  return [...groups.values()].sort((a, b) => STATES_ORDER.indexOf(a.type) - STATES_ORDER.indexOf(b.type));
}
export function teamsCycles(json: any) {
  return ((json?.data?.teams?.nodes ?? []) as any[]).map(t => ({
    teamId: t.id, team: t.key, name: t.name, color: t.color, withCycles: !!t.cyclesEnabled,
    cycle: t.activeCycle ? { id: t.activeCycle.id, number: t.activeCycle.number, name: t.activeCycle.name ?? tr('integrations.linearCycle', { n: t.activeCycle.number }), start: Date.parse(t.activeCycle.startsAt), end: Date.parse(t.activeCycle.endsAt), progreso: Math.round((t.activeCycle.progress ?? 0) * 100), reach: t.activeCycle.scopeHistory ?? [], done: t.activeCycle.completedScopeHistory ?? [] } : null,
  }));
}
export function teamBoard(json: any) {
  const t = json?.data?.team; if (!t) return null;
  const issues = ((t.issues?.nodes ?? []) as any[]).map(i => ({ ...linearIssue(i), stateId: i.state?.id }));
  const columns = ((t.states?.nodes ?? []) as any[]).filter(s => s.type !== 'canceled' && s.type !== 'duplicate').sort((a, b) => a.position - b.position)
    .map(s => ({ id: s.id, name: s.name, type: s.type, color: s.color, issues: issues.filter(i => i.stateId === s.id).sort((a, b) => (a.priority || 5) - (b.priority || 5)) }));
  return { team: t.key, name: t.name, columns };
}
export function explainErrorLinear(state: number, json: any): string | null {
  const err = json?.errors?.[0];
  if (state === 401 || err?.extensions?.code === 'AUTHENTICATION_ERROR' || /authenticat/i.test(err?.message ?? '')) return tr('integrations.linearKeyRejected');
  if (err?.extensions?.code === 'RATELIMITED') return tr('integrations.linearRateLimited');
  if (err?.extensions?.code === 'FORBIDDEN' || state === 403) return tr('integrations.linearForbidden');
  if (err) return tr('integrations.linearResponded', { detalle: err.message });
  if (state >= 400) return tr('integrations.linearRespondedHttp', { estado: state });
  return null;
}

// ------------------------------------------------------------------ Tablón: una entrada por conversación
// Los avisos llegan por mensaje; el tablón los junta por hilo (canal de Discord o de Slack, conversación de correo,
// issue de Linear, hilo de GitHub). Da la cara el más reciente y dentro van los demás. El id cambia con cada mensaje nuevo
// (suena y vuelve a «sin ver»); para marcarla vista se mandan sus ids.
export interface NoticeMessage { id: string; author: string; text: string; date: number; view: boolean }
export interface Conversation extends Notification { thread: string; count: number; ids: string[]; authors: string[]; messages: NoticeMessage[] }
const WEIGHT: Record<Priority, number> = { baja: 0, media: 1, alta: 2 };
export function groupNotices(list: Notification[], maxMessages = 8): Conversation[] {
  const groups = new Map<string, Notification[]>();
  for (const n of [...list].sort((a, b) => b.date - a.date)) { const k = n.thread ?? n.id; const g = groups.get(k); if (g) g.push(n); else groups.set(k, [n]); }
  return [...groups].map(([thread, ns]) => {
    const face = ns[0], pending = ns.filter(n => !n.view);
    return {
      ...face, id: `${thread}#${face.id}`, thread, view: !pending.length,
      priority: (pending.length ? pending : ns).reduce<Priority>((p, n) => (WEIGHT[n.priority] > WEIGHT[p] ? n.priority : p), 'baja'),
      count: Math.max(ns.length, ...ns.map(n => n.unread ?? 0)), ids: ns.map(n => n.id), authors: [...new Set(ns.map(n => n.author))],
      messages: ns.slice(0, maxMessages).map(n => ({ id: n.id, author: n.author, text: n.snippet, date: n.date, view: !!n.view })),
    };
  });
}
