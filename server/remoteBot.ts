// Mando a distancia: lo común a los bots del propio Supervisor (hoy, el de Slack: slackBot.ts). Lo normal es no salir del refugio: el bot solo escribe cuando un habitante pide aprobación (permiso, plan, pregunta o
// confianza) y se responde ahí mismo con sus botones. Además, a demanda, la lista de salas y conversaciones para pasarlas
// a Remote Control (la app de Claude). Nunca pasa lo que se habla: solo los rótulos (habitante, título, estado) y, para
// aprobar, la petición tal cual la ve el diálogo del juego, con los secretos tapados, los invisibles a la vista y borrada
// al responderla. Aquí, los mensajes y botones en un modelo neutro ({ text, filas }); cada bot los pinta a su manera y
// trae de vuelta el `dato` del botón pulsado. Con varios emparejados, la petición va a todos: al responderla en uno,
// la conversación cambia y los demás recogen su mensaje (`peticion`), como si se hubiera respondido en el refugio.
// Las peticiones esperan unos minutos (`delayMs`) antes de salir del refugio: si se responden ahí antes, no se mandan;
// y mientras el Supervisor esté usando el juego (`enUso`: la ventana delante y tocándola), siguen esperando.
// El chat queda siempre así: arriba, las decisiones abiertas; abajo del todo, un solo mensaje de estado (las salas y sus
// conversaciones) que se edita sin avisar cuando algo cambia y baja debajo de cada decisión nueva. Lo resuelto (aquí,
// en el refugio o en otro mando) y lo de conversaciones que ya no están se borra. Lo escrito se guarda (`Rastro`): tras
// un reinicio, las decisiones de antes (que ya no valen) se borran y el estado se pone al día.
import path from 'node:path';
import { t, locale } from '../shared/language.ts';
import type { SessionSummary, PendingRequest } from '../shared/protocol.ts';
import { visible } from '../shared/visible.ts';
import { recentFirst, sessionRecency } from '../shared/recent.ts';

export const PAIRING_MS = 10 * 60_000;
/** Lo que espera una petición antes de salir al móvil, y cada cuánto se vuelve a mirar si el juego sigue en uso */
export const REMOTE_DELAY_MS = 3 * 60_000;
const RECHECK_MS = 30_000;
const STATUS_MS = 4_000;     // el estado se pone al día como mucho cada tanto (se edita: no avisa)
const NOTE_MS = 2 * 60_000;  // lo que contesta un botón (Remote Control abierto…) se lee en el estado un rato
const MAX_REQUEST = 3500;   // lo que no cabe entero en un mensaje no se aprueba desde el móvil

/** Un botón: lo que se lee y lo que vuelve al pulsarlo (≤ 64 bytes, para que quepa en cualquier canal) */
export interface Button { text: string; data: string }
export type Rows = Button[][];
/** Un mensaje en texto plano (nunca Markdown: nada puede cerrar un bloque) con sus filas de botones; `silencio`: sin
 *  notificación, donde el canal lo permite (el estado) */
export interface View { text: string; rows: Rows; silent?: boolean }
/** Lo que el bot tiene escrito en el chat (se guarda: tras un reinicio se borra o se pone al día) */
export interface Trail<R> { requests: R[]; state?: R }

export interface RemoteDeps {
  sessions: () => SessionSummary[];
  rooms: () => { id: string; name: string }[];
  dweller: (s: SessionSummary) => string;
  /** pasa esas conversaciones a Remote Control (todas, sin ids) */
  aRemoteControl: (ids?: string[]) => Promise<{ sessions: number; notices: string[] }>;
  /** la respuesta a una petición, como la del diálogo del juego (nunca «siempre» desde el móvil) */
  respond: (sessionId: string, requestId: string, decision: 'si' | 'no', responses?: Record<string, string>) => void;
  onChange?: () => void;
  /** lo que espera una petición antes de mandarse (sin él, sale en el acto) */
  delayMs?: number;
  /** el Supervisor está usando el juego: las peticiones esperan */
  inUse?: () => boolean;
}

const ICON: Record<string, string> = { starting: '🟡', working: '🟢', waiting: '⏳', finished: '✅', idle: '⚪', error: '🔴' };
export const openSessions = (l: SessionSummary[]) => l.filter(s => s.state !== 'closed').sort((a, b) => recentFirst(sessionRecency(a), sessionRecency(b)));

// lo único de cada conversación que sale hacia el móvil: habitante y título (y el worktree, si lo hay)
export const label = (s: SessionSummary, dweller: string) => [dweller, s.title?.trim() || undefined, s.worktree && path.basename(s.worktree)].filter(Boolean).join(' · ');
const time = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
const STATE: Record<string, string> = { starting: 'server.remoteStarting', working: 'server.remoteWorking', waiting: 'server.remoteWaiting', idle: 'server.remoteIdle', error: 'server.remoteStuck' };
export function stateOf(s: SessionSummary) { return s.state === 'finished' ? t('server.remoteFinishedAt', { time: time(s.updated) }) : t(STATE[s.state] ?? 'server.remoteIdle'); }

/** Lo que se manda al móvil: cada sala con sus conversaciones abiertas, y un botón de Remote Control por conversación
 *  (y otro para todas). Como mucho 4000 caracteres y 60 conversaciones con botón */
export function listingView(rooms: { id: string; name: string }[], sessions: SessionSummary[], dweller: (s: SessionSummary) => string): View {
  const l = openSessions(sessions);
  const lines: string[] = [];
  const withButton: SessionSummary[] = [];
  const known = new Set(rooms.map(x => x.id));
  const groups = [...rooms.map(x => ({ name: x.name, sess: l.filter(s => s.roomId === x.id) })), { name: '—', sess: l.filter(s => !known.has(s.roomId)) }];
  for (const g of groups) {
    if (g.name === '—' && !g.sess.length) continue;
    lines.push(g.sess.length ? `🏠 ${g.name}` : `🏠 ${g.name} · ${t('server.remoteNoneHere')}`);
    for (const s of g.sess) { lines.push(`   ${ICON[s.state] ?? '⚪'} ${label(s, dweller(s))} — ${stateOf(s)}`); withButton.push(s); }
  }
  let text = (l.length ? t('server.remoteChooseConversation') : t('server.remoteNoConversations')) + '\n\n' + lines.join('\n');
  if (text.length > 4000) text = text.slice(0, 3990) + '\n…';
  const rows: Rows = withButton.slice(0, 60).map(s => [{ text: `📱 ${ICON[s.state] ?? ''} ${label(s, dweller(s))}`.slice(0, 60), data: `rc:${s.id}`.slice(0, 64) }]);
  if (withButton.length > 1) rows.push([{ text: t('server.remoteAllToRemoteControl', { n: withButton.length }), data: 'rc:*' }]);
  rows.push([{ text: t('server.remoteRefresh'), data: 'ls' }]);
  return { text, rows };
}

// secretos con forma conocida (tokens de GitHub, Slack, OpenAI/Anthropic, AWS, Google, JWT, bots de Telegram y claves
// privadas): solo caracteres de token, para que tapar nunca esconda código (un `$(…)` o un `;` no encajan)
const SECRETS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bxapp-[A-Za-z0-9-]{10,}\b/g,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bAIza[A-Za-z0-9_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b\d{6,12}:AA[A-Za-z0-9_-]{30,}\b/g,
];
export function hideSecrets(text: string) {
  let n = 0;
  for (const re of SECRETS) text = text.replace(re, () => { n++; return '⟦secreto oculto⟧'; });
  return { text, hidden: n };
}

/** La petición como mensaje: texto plano, invisibles a la vista, secretos tapados. `revisable`: cabe entera (si no, no
 *  se ofrece aprobar desde el móvil) */
export function requestView(pet: PendingRequest, who: string) {
  const parts: string[] = [];
  parts.push(`❓ ${who}`, pet.title + (pet.ofHelper ? ` (${pet.ofHelper})` : ''));
  if (pet.reason) parts.push(t('server.remoteReason', { reason: pet.reason }));
  for (const b of pet.input ?? []) parts.push(b.type === 'path' ? `📄 ${b.text}` : b.type === 'code' ? `────────\n${b.text}\n────────` : b.text);
  if (pet.type === 'plan' && pet.detail) parts.push(pet.detail);
  for (const [k, q] of (pet.questions ?? []).entries()) parts.push(`${k + 1}. ${q.question}\n` + q.options.map((o, j) => `   ${String.fromCharCode(65 + j)}) ${o.label}${o.description ? ` — ${o.description}` : ''}`).join('\n'));
  const { text, hidden } = hideSecrets(visible(parts.join('\n\n')));
  const withNotice = hidden ? `${text}\n\n${t('server.remoteSecretsHidden', { n: hidden })}` : text;
  const revisable = withNotice.length <= MAX_REQUEST;
  return { text: revisable ? withNotice : withNotice.slice(0, 1500) + '\n…\n\n' + t('server.remoteTooLong'), revisable };
}
// botones de una petición: sí/no; en las preguntas, una opción por botón (de una en una; las de varias opciones, no)
export function requestButtons(pet: PendingRequest, k: string, step: number, revisable: boolean, sessionId: string): Rows {
  const rc = [{ text: t('server.remoteContinueOnPhone'), data: `rc:${sessionId}` }];
  if (!revisable) return [rc];
  if (pet.type === 'question') {
    const q = pet.questions?.[step];
    if (!q || q.multiSelect || !q.options.length) return [rc];
    return [...q.options.map((o, j) => [{ text: `${String.fromCharCode(65 + j)}) ${o.label}`.slice(0, 60), data: `q:${k}:${j}` }]), rc];
  }
  const si = pet.type === 'plan' ? 'server.remoteApprovePlan' : pet.type === 'trust' ? 'server.remoteTrustOnce' : 'server.remoteYes';
  const no = pet.type === 'plan' ? 'server.remoteKeepPlanning' : 'server.remoteNo';
  return [[{ text: t(si), data: `ok:${k}` }, { text: t(no), data: `no:${k}` }], rc];
}

interface Sent<R> { sessionId: string; pet: PendingRequest; who: string; text: string; ref?: R; step: number; answers: Record<string, string>; revisable: boolean }
/** La respuesta breve a un botón pulsado (sin texto: solo se da por recibido) */
export type Notice = (text?: string) => Promise<unknown>;

/** Un bot de mando a distancia: las peticiones mandadas, los botones y la lista. Cada canal pone cómo se manda, se
 *  cambia y se recoge un mensaje (`R`: con qué se encuentra luego un mensaje mandado) */
export abstract class RemoteBot<R> {
  // peticiones mandadas al móvil: clave corta (la del botón) → de qué sesión es, su mensaje y lo respondido hasta ahora
  private sent = new Map<string, Sent<R>>();
  // peticiones que aún esperan para salir: id de la petición → de qué sesión es y su temporizador
  private waiting = new Map<string, { sessionId: string; timer: ReturnType<typeof setTimeout> }>();
  private next = 1;
  protected abstract readonly channel: string;
  constructor(protected d: RemoteDeps) {}
  /** con token y emparejado: puede escribir */
  protected abstract ready(): boolean;
  /** «aprobar desde el móvil» encendido */
  protected abstract approves(): boolean;
  protected abstract post(v: View): Promise<R | undefined>;
  /** mismo texto, otros botones (la siguiente pregunta) */
  protected abstract changeButtons(ref: R, v: View): Promise<unknown>;
  /** el mensaje se queda en esta línea, sin botones */
  protected abstract collect(ref: R, text: string): Promise<unknown>;
  /** el mensaje con otro texto y otros botones (el estado) */
  protected abstract edit(ref: R, v: View): Promise<unknown>;
  /** el mensaje fuera del chat */
  protected abstract deleteMessage(ref: R): Promise<unknown>;
  /** lo que quedó escrito (guardado por el canal en su archivo) y cómo guardarlo */
  protected abstract trail(): Trail<R> | undefined;
  protected abstract saveTrail(r: Trail<R>): void;

  private stateRef?: R;
  private stateSignature = '';
  private stateTimer?: ReturnType<typeof setTimeout>;
  private tail: Promise<unknown> = Promise.resolve();
  private note?: { text: string; until: number };

  /** El estado, abajo del todo (lo pide quien escribe al bot): se manda de nuevo debajo de lo último */
  async sendListing() { await this.setState(true); }

  /** Al arrancar con el chat emparejado: las decisiones de antes del reinicio ya no valen (se borran) y el estado se
   *  pone al día donde estaba */
  protected async resume() {
    if (!this.ready()) return;
    const r = this.trail();
    for (const ref of r?.requests ?? []) await this.deleteMessage(ref).catch(() => {});
    this.stateRef = r?.state;
    this.persist();
    await this.setState();
  }
  /** Al desemparejar: lo escrito se olvida (el chat ya no es suyo) */
  protected forget() { this.sent.clear(); this.stateRef = undefined; this.stateSignature = ''; clearTimeout(this.stateTimer); this.stateTimer = undefined; }
  private persist() { this.saveTrail({ requests: [...this.sent.values()].flatMap(e => e.ref !== undefined ? [e.ref] : []), state: this.stateRef }); }

  /** El mensaje de estado: uno solo, siempre el último del chat. `abajo`: se manda de nuevo (debajo de lo que acaba de
   *  salir) y se borra el anterior; si no, se edita donde está, sin avisar, solo si cambia. En cola: nunca dos a la vez */
  protected setState(below = false) {
    const r = this.tail.then(() => this.currentState(below)).catch(e => console.error(`${this.channel}:`, (e as Error).message));
    this.tail = r;
    return r;
  }
  private async currentState(below: boolean) {
    clearTimeout(this.stateTimer); this.stateTimer = undefined;
    if (!this.ready()) return;
    const v = listingView(this.d.rooms(), this.d.sessions(), this.d.dweller);
    if (this.note && this.note.until > Date.now()) v.text = this.note.text + '\n\n' + v.text; else this.note = undefined;
    const signature = JSON.stringify(v);
    if (!below && this.stateRef !== undefined) {
      if (signature === this.stateSignature) return;
      try { await this.edit(this.stateRef, v); this.stateSignature = signature; return; }
      catch { /* borrado a mano o demasiado viejo para editarlo: va otro abajo */ }
    }
    const old = this.stateRef;
    this.stateRef = await this.post({ ...v, silent: true });
    this.stateSignature = signature;
    this.persist();
    if (old !== undefined) await this.deleteMessage(old).catch(() => {});
  }
  private refreshState() {
    if (this.stateTimer || !this.ready()) return;
    this.stateTimer = setTimeout(() => { this.stateTimer = undefined; this.setState(); }, STATUS_MS);
    this.stateTimer.unref?.();
  }

  /** Con cada cambio de una conversación: si pide aprobación, se manda al móvil (una vez, pasado `retrasoMs`); si lo que
   *  se mandó ya no está pendiente (respondido en el refugio o en otro mando, cancelado o cerrada), su mensaje se recoge
   *  en una línea, y lo que aún esperaba ya no sale */
  async request(s: SessionSummary) {
    for (const [id, w] of this.waiting) if (w.sessionId === s.id && (s.pending?.id !== id || s.state === 'closed')) {
      clearTimeout(w.timer);
      this.waiting.delete(id);
    }
    if (!this.ready()) return;
    // lo ya resuelto fuera (o de una conversación cerrada o que ya no está) se borra
    const live = new Map(this.d.sessions().map(x => [x.id, x]));
    live.set(s.id, s);
    let removed = false;
    for (const [k, e] of this.sent) {
      const x = live.get(e.sessionId);
      if (x && x.pending?.id === e.pet.id && x.state !== 'closed') continue;
      this.sent.delete(k); removed = true;
      await this.removeMessage(e, t('server.remoteAnsweredElsewhere'));
    }
    if (removed) this.persist();
    this.refreshState();
    const pet = s.pending;
    if (!pet || s.state === 'closed' || !this.approves() || this.waiting.has(pet.id) || [...this.sent.values()].some(e => e.pet.id === pet.id)) return;
    if (this.d.delayMs) this.wait(s.id, pet.id, this.d.delayMs);
    else await this.send(s, pet);
  }

  // pasado el plazo, sale si sigue pendiente y el juego no está en uso; si lo está, se vuelve a mirar en un rato
  private wait(sessionId: string, petId: string, ms: number) {
    const timer = setTimeout(() => {
      this.waiting.delete(petId);
      const s = this.d.sessions().find(x => x.id === sessionId);
      if (!s?.pending || s.pending.id !== petId || s.state === 'closed' || !this.ready() || !this.approves()) return;
      if (this.d.inUse?.()) { this.wait(sessionId, petId, RECHECK_MS); return; }
      this.send(s, s.pending).catch(() => {});
    }, ms);
    timer.unref?.();
    this.waiting.set(petId, { sessionId, timer });
  }

  private async send(s: SessionSummary, pet: PendingRequest) {
    if ([...this.sent.values()].some(e => e.pet.id === pet.id)) return;
    const k = String(this.next++);
    const who = label(s, this.d.dweller(s));
    const v = requestView(pet, who);
    const e: Sent<R> = { sessionId: s.id, pet, who, text: v.text, step: 0, answers: {}, revisable: v.revisable };
    this.sent.set(k, e);
    try { e.ref = await this.post({ text: v.text, rows: requestButtons(pet, k, 0, v.revisable, s.id) }); }
    catch (err) { this.sent.delete(k); console.error(`${this.channel}:`, (err as Error).message); return; }
    this.persist();
    await this.setState(true);   // el estado, otra vez debajo
  }

  /** Un botón pulsado por quien toca (el canal ya lo ha comprobado) */
  protected async press(data: string, notice: Notice) {
    const aim = /^(ok|no|q):(\d+)(?::(\d+))?$/.exec(data);
    if (aim) { await this.answer(notice, aim[2], aim[1] as 'ok' | 'no' | 'q', Number(aim[3])); return; }
    if (data === 'ls') { await notice(); await this.setState(); return; }
    if (!data.startsWith('rc:')) { await notice(); return; }
    const id = data.slice(3);
    const live = openSessions(this.d.sessions());
    const ids = id === '*' ? undefined : live.some(s => s.id === id) ? [id] : [];
    if (ids && !ids.length) { await notice(t('server.remoteNoLongerOpen')); return; }
    await notice(t('server.remoteOpeningRemoteControl'));
    const r = await this.d.aRemoteControl(ids).catch(e => ({ sessions: 0, notices: [(e as Error).message] }));
    const text = r.sessions ? t('server.remoteOpenedInRemoteControl', { n: r.sessions }) : t('server.remoteCouldNotOpen');
    // se lee en el estado un rato (sin otro mensaje en el chat)
    this.note = { text: [text, ...r.notices].join('\n'), until: Date.now() + NOTE_MS };
    await this.setState();
  }

  private async answer(notice: Notice, k: string, what: 'ok' | 'no' | 'q', option: number) {
    const e = this.sent.get(k);
    const sess = e && this.d.sessions().find(s => s.id === e.sessionId);
    // solo vale mientras siga siendo la petición pendiente de esa conversación (nada de botones viejos)
    if (!e || !sess || sess.state === 'closed' || sess.pending?.id !== e.pet.id || !e.revisable) {
      await notice(t('server.remoteNoLongerPending'));
      return;
    }
    if (what === 'q') {
      const q = e.pet.questions?.[e.step], o = q?.options[option];
      if (!q || !o || q.multiSelect) { await notice(); return; }
      e.answers[q.question] = o.label; e.step++;
      if (e.step < (e.pet.questions?.length ?? 0)) {
        await notice(o.label.slice(0, 190));
        if (e.ref !== undefined) await this.changeButtons(e.ref, { text: e.text, rows: requestButtons(e.pet, k, e.step, true, e.sessionId) }).catch(() => {});
        return;
      }
    }
    this.sent.delete(k);
    const decision = what === 'no' ? 'no' : 'si';
    try { this.d.respond(e.sessionId, e.pet.id, decision, what === 'q' ? e.answers : undefined); }
    catch (err) { await notice((err as Error).message.slice(0, 190)); return; }
    await notice(t(decision === 'si' ? 'server.remoteDoneYes' : 'server.remoteDoneNo'));
    await this.removeMessage(e, t(what === 'q' ? 'server.remoteAnswered' : decision === 'si' ? 'server.remoteApproved' : 'server.remoteDenied'));
    this.persist();
    this.refreshState();
  }
  // resuelta: el mensaje de la petición se borra; si el canal no deja, se queda en una línea, sin el comando, el diff
  // ni el plan
  private async removeMessage(e: Sent<R>, how: string) {
    if (e.ref === undefined) return;
    try { await this.deleteMessage(e.ref); }
    catch { await this.collect(e.ref, visible(`${how} · ${e.who} · ${e.pet.title}`)).catch(() => {}); }
  }
}
