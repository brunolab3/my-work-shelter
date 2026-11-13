// Mando a distancia: lo común a los bots del propio Supervisor (hoy, el de Slack: slackMando.ts). Lo normal es no salir del refugio: el bot solo escribe cuando un habitante pide aprobación (permiso, plan, pregunta o
// confianza) y se responde ahí mismo con sus botones. Además, a demanda, la lista de salas y conversaciones para pasarlas
// a Remote Control (la app de Claude). Nunca pasa lo que se habla: solo los rótulos (habitante, título, estado) y, para
// aprobar, la petición tal cual la ve el diálogo del juego, con los secretos tapados, los invisibles a la vista y borrada
// al responderla. Aquí, los mensajes y botones en un modelo neutro ({ text, filas }); cada bot los pinta a su manera y
// trae de vuelta el `dato` del botón pulsado. Con varios emparejados, la petición va a todos: al responderla en uno,
// la conversación cambia y los demás recogen su mensaje (`peticion`), como si se hubiera respondido en el refugio.
// Las peticiones esperan unos minutos (`retrasoMs`) antes de salir del refugio: si se responden ahí antes, no se mandan;
// y mientras el Supervisor esté usando el juego (`enUso`: la ventana delante y tocándola), siguen esperando.
// El chat queda siempre así: arriba, las decisiones abiertas; abajo del todo, un solo mensaje de estado (las salas y sus
// conversaciones) que se edita sin avisar cuando algo cambia y baja debajo de cada decisión nueva. Lo resuelto (aquí,
// en el refugio o en otro mando) y lo de conversaciones que ya no están se borra. Lo escrito se guarda (`Rastro`): tras
// un reinicio, las decisiones de antes (que ya no valen) se borran y el estado se pone al día.
import path from 'node:path';
import { t } from '../shared/idioma.ts';
import type { SessionSummary, PendingRequest } from '../shared/protocolo.ts';
import { visible } from '../shared/visible.ts';

export const PAIRING_MS = 10 * 60_000;
/** Lo que espera una petición antes de salir al móvil, y cada cuánto se vuelve a mirar si el juego sigue en uso */
export const REMOTE_DELAY_MS = 3 * 60_000;
const RECHECK_MS = 30_000;
const STATUS_MS = 4_000;     // el estado se pone al día como mucho cada tanto (se edita: no avisa)
const NOTE_MS = 2 * 60_000;  // lo que contesta un botón (Remote Control abierto…) se lee en el estado un rato
const MAX_PETICION = 3500;   // lo que no cabe entero en un mensaje no se aprueba desde el móvil

/** Un botón: lo que se lee y lo que vuelve al pulsarlo (≤ 64 bytes, para que quepa en cualquier canal) */
export interface Boton { texto: string; dato: string }
export type Filas = Boton[][];
/** Un mensaje en texto plano (nunca Markdown: nada puede cerrar un bloque) con sus filas de botones; `silencio`: sin
 *  notificación, donde el canal lo permite (el estado) */
export interface Vista { text: string; filas: Filas; silencio?: boolean }
/** Lo que el bot tiene escrito en el chat (se guarda: tras un reinicio se borra o se pone al día) */
export interface Rastro<R> { peticiones: R[]; estado?: R }

export interface RemoteDeps {
  sesiones: () => SessionSummary[];
  salas: () => { id: string; nombre: string }[];
  habitante: (s: SessionSummary) => string;
  /** pasa esas conversaciones a Remote Control (todas, sin ids) */
  aRemoteControl: (ids?: string[]) => Promise<{ sesiones: number; avisos: string[] }>;
  /** la respuesta a una petición, como la del diálogo del juego (nunca «siempre» desde el móvil) */
  responder: (sesionId: string, peticionId: string, decision: 'si' | 'no', responses?: Record<string, string>) => void;
  alCambiar?: () => void;
  /** lo que espera una petición antes de mandarse (sin él, sale en el acto) */
  retrasoMs?: number;
  /** el Supervisor está usando el juego: las peticiones esperan */
  enUso?: () => boolean;
}

const ICONO: Record<string, string> = { arrancando: '🟡', trabajando: '🟢', esperando: '⏳', terminada: '✅', ociosa: '⚪', error: '🔴' };
export const abiertas = (l: SessionSummary[]) => l.filter(s => s.estado !== 'cerrada').sort((a, b) => b.actualizada - a.actualizada);

// lo único de cada conversación que sale hacia el móvil: habitante y título (y el worktree, si lo hay)
export const rotulo = (s: SessionSummary, habitante: string) => [habitante, s.titulo?.trim() || undefined, s.worktree && path.basename(s.worktree)].filter(Boolean).join(' · ');
const hora = (ms: number) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const ESTADO: Record<string, string> = { arrancando: 'server.remoteStarting', trabajando: 'server.remoteWorking', esperando: 'server.remoteWaiting', ociosa: 'server.remoteIdle', error: 'server.remoteStuck' };
export function estadoDe(s: SessionSummary) { return s.estado === 'terminada' ? t('server.remoteFinishedAt', { hora: hora(s.actualizada) }) : t(ESTADO[s.estado] ?? 'server.remoteIdle'); }

/** Lo que se manda al móvil: cada sala con sus conversaciones abiertas, y un botón de Remote Control por conversación
 *  (y otro para todas). Como mucho 4000 caracteres y 60 conversaciones con botón */
export function listadoVista(salas: { id: string; nombre: string }[], sesiones: SessionSummary[], habitante: (s: SessionSummary) => string): Vista {
  const l = abiertas(sesiones);
  const lineas: string[] = [];
  const conBoton: SessionSummary[] = [];
  const conocidas = new Set(salas.map(x => x.id));
  const grupos = [...salas.map(x => ({ nombre: x.nombre, ses: l.filter(s => s.salaId === x.id) })), { nombre: '—', ses: l.filter(s => !conocidas.has(s.salaId)) }];
  for (const g of grupos) {
    if (g.nombre === '—' && !g.ses.length) continue;
    lineas.push(g.ses.length ? `🏠 ${g.nombre}` : `🏠 ${g.nombre} · ${t('server.remoteNoneHere')}`);
    for (const s of g.ses) { lineas.push(`   ${ICONO[s.estado] ?? '⚪'} ${rotulo(s, habitante(s))} — ${estadoDe(s)}`); conBoton.push(s); }
  }
  let text = (l.length ? t('server.remoteChooseConversation') : t('server.remoteNoConversations')) + '\n\n' + lineas.join('\n');
  if (text.length > 4000) text = text.slice(0, 3990) + '\n…';
  const filas: Filas = conBoton.slice(0, 60).map(s => [{ texto: `📱 ${ICONO[s.estado] ?? ''} ${rotulo(s, habitante(s))}`.slice(0, 60), dato: `rc:${s.id}`.slice(0, 64) }]);
  if (conBoton.length > 1) filas.push([{ texto: t('server.remoteAllToRemoteControl', { n: conBoton.length }), dato: 'rc:*' }]);
  filas.push([{ texto: t('server.remoteRefresh'), dato: 'ls' }]);
  return { text, filas };
}

// secretos con forma conocida (tokens de GitHub, Slack, OpenAI/Anthropic, AWS, Google, JWT, bots de Telegram y claves
// privadas): solo caracteres de token, para que tapar nunca esconda código (un `$(…)` o un `;` no encajan)
const SECRETOS: RegExp[] = [
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
export function ocultarSecretos(texto: string) {
  let n = 0;
  for (const re of SECRETOS) texto = texto.replace(re, () => { n++; return '⟦secreto oculto⟧'; });
  return { texto, ocultos: n };
}

/** La petición como mensaje: texto plano, invisibles a la vista, secretos tapados. `revisable`: cabe entera (si no, no
 *  se ofrece aprobar desde el móvil) */
export function vistaPeticion(pet: PendingRequest, quien: string) {
  const partes: string[] = [];
  partes.push(`❓ ${quien}`, pet.titulo + (pet.ofHelper ? ` (${pet.ofHelper})` : ''));
  if (pet.motivo) partes.push(t('server.remoteReason', { motivo: pet.motivo }));
  for (const b of pet.entrada ?? []) partes.push(b.tipo === 'ruta' ? `📄 ${b.texto}` : b.tipo === 'codigo' ? `────────\n${b.texto}\n────────` : b.texto);
  if (pet.tipo === 'plan' && pet.detalle) partes.push(pet.detalle);
  for (const [k, q] of (pet.preguntas ?? []).entries()) partes.push(`${k + 1}. ${q.question}\n` + q.options.map((o, j) => `   ${String.fromCharCode(65 + j)}) ${o.label}${o.description ? ` — ${o.description}` : ''}`).join('\n'));
  const { texto, ocultos } = ocultarSecretos(visible(partes.join('\n\n')));
  const conAviso = ocultos ? `${texto}\n\n${t('server.remoteSecretsHidden', { n: ocultos })}` : texto;
  const revisable = conAviso.length <= MAX_PETICION;
  return { text: revisable ? conAviso : conAviso.slice(0, 1500) + '\n…\n\n' + t('server.remoteTooLong'), revisable };
}
// botones de una petición: sí/no; en las preguntas, una opción por botón (de una en una; las de varias opciones, no)
export function botonesPeticion(pet: PendingRequest, k: string, paso: number, revisable: boolean, sesionId: string): Filas {
  const rc = [{ texto: t('server.remoteContinueOnPhone'), dato: `rc:${sesionId}` }];
  if (!revisable) return [rc];
  if (pet.tipo === 'pregunta') {
    const q = pet.preguntas?.[paso];
    if (!q || q.multiSelect || !q.options.length) return [rc];
    return [...q.options.map((o, j) => [{ texto: `${String.fromCharCode(65 + j)}) ${o.label}`.slice(0, 60), dato: `q:${k}:${j}` }]), rc];
  }
  const si = pet.tipo === 'plan' ? 'server.remoteApprovePlan' : pet.tipo === 'confianza' ? 'server.remoteTrustOnce' : 'server.remoteYes';
  const no = pet.tipo === 'plan' ? 'server.remoteKeepPlanning' : 'server.remoteNo';
  return [[{ texto: t(si), dato: `ok:${k}` }, { texto: t(no), dato: `no:${k}` }], rc];
}

interface Enviada<R> { sesionId: string; pet: PendingRequest; quien: string; text: string; ref?: R; paso: number; respuestas: Record<string, string>; revisable: boolean }
/** La respuesta breve a un botón pulsado (sin texto: solo se da por recibido) */
export type Aviso = (texto?: string) => Promise<unknown>;

/** Un bot de mando a distancia: las peticiones mandadas, los botones y la lista. Cada canal pone cómo se manda, se
 *  cambia y se recoge un mensaje (`R`: con qué se encuentra luego un mensaje mandado) */
export abstract class RemoteBot<R> {
  // peticiones mandadas al móvil: clave corta (la del botón) → de qué sesión es, su mensaje y lo respondido hasta ahora
  private enviadas = new Map<string, Enviada<R>>();
  // peticiones que aún esperan para salir: id de la petición → de qué sesión es y su temporizador
  private esperando = new Map<string, { sesionId: string; timer: ReturnType<typeof setTimeout> }>();
  private siguiente = 1;
  protected abstract readonly canal: string;
  constructor(protected d: RemoteDeps) {}
  /** con token y emparejado: puede escribir */
  protected abstract listo(): boolean;
  /** «aprobar desde el móvil» encendido */
  protected abstract aprueba(): boolean;
  protected abstract mandar(v: Vista): Promise<R | undefined>;
  /** mismo texto, otros botones (la siguiente pregunta) */
  protected abstract cambiarBotones(ref: R, v: Vista): Promise<unknown>;
  /** el mensaje se queda en esta línea, sin botones */
  protected abstract recoger(ref: R, text: string): Promise<unknown>;
  /** el mensaje con otro texto y otros botones (el estado) */
  protected abstract editar(ref: R, v: Vista): Promise<unknown>;
  /** el mensaje fuera del chat */
  protected abstract borrar(ref: R): Promise<unknown>;
  /** lo que quedó escrito (guardado por el canal en su archivo) y cómo guardarlo */
  protected abstract rastro(): Rastro<R> | undefined;
  protected abstract guardarRastro(r: Rastro<R>): void;

  private estadoRef?: R;
  private estadoFirma = '';
  private estadoTimer?: ReturnType<typeof setTimeout>;
  private cola: Promise<unknown> = Promise.resolve();
  private nota?: { texto: string; hasta: number };

  /** El estado, abajo del todo (lo pide quien escribe al bot): se manda de nuevo debajo de lo último */
  async mandarListado() { await this.ponerEstado(true); }

  /** Al arrancar con el chat emparejado: las decisiones de antes del reinicio ya no valen (se borran) y el estado se
   *  pone al día donde estaba */
  protected async retomar() {
    if (!this.listo()) return;
    const r = this.rastro();
    for (const ref of r?.peticiones ?? []) await this.borrar(ref).catch(() => {});
    this.estadoRef = r?.estado;
    this.persistir();
    await this.ponerEstado();
  }
  /** Al desemparejar: lo escrito se olvida (el chat ya no es suyo) */
  protected olvidar() { this.enviadas.clear(); this.estadoRef = undefined; this.estadoFirma = ''; clearTimeout(this.estadoTimer); this.estadoTimer = undefined; }
  private persistir() { this.guardarRastro({ peticiones: [...this.enviadas.values()].flatMap(e => e.ref !== undefined ? [e.ref] : []), estado: this.estadoRef }); }

  /** El mensaje de estado: uno solo, siempre el último del chat. `abajo`: se manda de nuevo (debajo de lo que acaba de
   *  salir) y se borra el anterior; si no, se edita donde está, sin avisar, solo si cambia. En cola: nunca dos a la vez */
  protected ponerEstado(abajo = false) {
    const r = this.cola.then(() => this.estadoAhora(abajo)).catch(e => console.error(`${this.canal}:`, (e as Error).message));
    this.cola = r;
    return r;
  }
  private async estadoAhora(abajo: boolean) {
    clearTimeout(this.estadoTimer); this.estadoTimer = undefined;
    if (!this.listo()) return;
    const v = listadoVista(this.d.salas(), this.d.sesiones(), this.d.habitante);
    if (this.nota && this.nota.hasta > Date.now()) v.text = this.nota.texto + '\n\n' + v.text; else this.nota = undefined;
    const firma = JSON.stringify(v);
    if (!abajo && this.estadoRef !== undefined) {
      if (firma === this.estadoFirma) return;
      try { await this.editar(this.estadoRef, v); this.estadoFirma = firma; return; }
      catch { /* borrado a mano o demasiado viejo para editarlo: va otro abajo */ }
    }
    const viejo = this.estadoRef;
    this.estadoRef = await this.mandar({ ...v, silencio: true });
    this.estadoFirma = firma;
    this.persistir();
    if (viejo !== undefined) await this.borrar(viejo).catch(() => {});
  }
  private refrescarEstado() {
    if (this.estadoTimer || !this.listo()) return;
    this.estadoTimer = setTimeout(() => { this.estadoTimer = undefined; this.ponerEstado(); }, STATUS_MS);
    this.estadoTimer.unref?.();
  }

  /** Con cada cambio de una conversación: si pide aprobación, se manda al móvil (una vez, pasado `retrasoMs`); si lo que
   *  se mandó ya no está pendiente (respondido en el refugio o en otro mando, cancelado o cerrada), su mensaje se recoge
   *  en una línea, y lo que aún esperaba ya no sale */
  async peticion(s: SessionSummary) {
    for (const [id, w] of this.esperando) if (w.sesionId === s.id && (s.pending?.id !== id || s.estado === 'cerrada')) {
      clearTimeout(w.timer);
      this.esperando.delete(id);
    }
    if (!this.listo()) return;
    // lo ya resuelto fuera (o de una conversación cerrada o que ya no está) se borra
    const vivas = new Map(this.d.sesiones().map(x => [x.id, x]));
    vivas.set(s.id, s);
    let quitadas = false;
    for (const [k, e] of this.enviadas) {
      const x = vivas.get(e.sesionId);
      if (x && x.pending?.id === e.pet.id && x.estado !== 'cerrada') continue;
      this.enviadas.delete(k); quitadas = true;
      await this.quitarMensaje(e, t('server.remoteAnsweredElsewhere'));
    }
    if (quitadas) this.persistir();
    this.refrescarEstado();
    const pet = s.pending;
    if (!pet || s.estado === 'cerrada' || !this.aprueba() || this.esperando.has(pet.id) || [...this.enviadas.values()].some(e => e.pet.id === pet.id)) return;
    if (this.d.retrasoMs) this.esperar(s.id, pet.id, this.d.retrasoMs);
    else await this.enviar(s, pet);
  }

  // pasado el plazo, sale si sigue pendiente y el juego no está en uso; si lo está, se vuelve a mirar en un rato
  private esperar(sesionId: string, petId: string, ms: number) {
    const timer = setTimeout(() => {
      this.esperando.delete(petId);
      const s = this.d.sesiones().find(x => x.id === sesionId);
      if (!s?.pending || s.pending.id !== petId || s.estado === 'cerrada' || !this.listo() || !this.aprueba()) return;
      if (this.d.enUso?.()) { this.esperar(sesionId, petId, RECHECK_MS); return; }
      this.enviar(s, s.pending).catch(() => {});
    }, ms);
    timer.unref?.();
    this.esperando.set(petId, { sesionId, timer });
  }

  private async enviar(s: SessionSummary, pet: PendingRequest) {
    if ([...this.enviadas.values()].some(e => e.pet.id === pet.id)) return;
    const k = String(this.siguiente++);
    const quien = rotulo(s, this.d.habitante(s));
    const v = vistaPeticion(pet, quien);
    const e: Enviada<R> = { sesionId: s.id, pet, quien, text: v.text, paso: 0, respuestas: {}, revisable: v.revisable };
    this.enviadas.set(k, e);
    try { e.ref = await this.mandar({ text: v.text, filas: botonesPeticion(pet, k, 0, v.revisable, s.id) }); }
    catch (err) { this.enviadas.delete(k); console.error(`${this.canal}:`, (err as Error).message); return; }
    this.persistir();
    await this.ponerEstado(true);   // el estado, otra vez debajo
  }

  /** Un botón pulsado por quien toca (el canal ya lo ha comprobado) */
  protected async pulsar(dato: string, aviso: Aviso) {
    const ap = /^(ok|no|q):(\d+)(?::(\d+))?$/.exec(dato);
    if (ap) { await this.contestar(aviso, ap[2], ap[1] as 'ok' | 'no' | 'q', Number(ap[3])); return; }
    if (dato === 'ls') { await aviso(); await this.ponerEstado(); return; }
    if (!dato.startsWith('rc:')) { await aviso(); return; }
    const id = dato.slice(3);
    const vivas = abiertas(this.d.sesiones());
    const ids = id === '*' ? undefined : vivas.some(s => s.id === id) ? [id] : [];
    if (ids && !ids.length) { await aviso(t('server.remoteNoLongerOpen')); return; }
    await aviso(t('server.remoteOpeningRemoteControl'));
    const r = await this.d.aRemoteControl(ids).catch(e => ({ sesiones: 0, avisos: [(e as Error).message] }));
    const texto = r.sesiones ? t('server.remoteOpenedInRemoteControl', { n: r.sesiones }) : t('server.remoteCouldNotOpen');
    // se lee en el estado un rato (sin otro mensaje en el chat)
    this.nota = { texto: [texto, ...r.avisos].join('\n'), hasta: Date.now() + NOTE_MS };
    await this.ponerEstado();
  }

  private async contestar(aviso: Aviso, k: string, que: 'ok' | 'no' | 'q', opcion: number) {
    const e = this.enviadas.get(k);
    const ses = e && this.d.sesiones().find(s => s.id === e.sesionId);
    // solo vale mientras siga siendo la petición pendiente de esa conversación (nada de botones viejos)
    if (!e || !ses || ses.estado === 'cerrada' || ses.pending?.id !== e.pet.id || !e.revisable) {
      await aviso(t('server.remoteNoLongerPending'));
      return;
    }
    if (que === 'q') {
      const q = e.pet.preguntas?.[e.paso], o = q?.options[opcion];
      if (!q || !o || q.multiSelect) { await aviso(); return; }
      e.respuestas[q.question] = o.label; e.paso++;
      if (e.paso < (e.pet.preguntas?.length ?? 0)) {
        await aviso(o.label.slice(0, 190));
        if (e.ref !== undefined) await this.cambiarBotones(e.ref, { text: e.text, filas: botonesPeticion(e.pet, k, e.paso, true, e.sesionId) }).catch(() => {});
        return;
      }
    }
    this.enviadas.delete(k);
    const decision = que === 'no' ? 'no' : 'si';
    try { this.d.responder(e.sesionId, e.pet.id, decision, que === 'q' ? e.respuestas : undefined); }
    catch (err) { await aviso((err as Error).message.slice(0, 190)); return; }
    await aviso(t(decision === 'si' ? 'server.remoteDoneYes' : 'server.remoteDoneNo'));
    await this.quitarMensaje(e, t(que === 'q' ? 'server.remoteAnswered' : decision === 'si' ? 'server.remoteApproved' : 'server.remoteDenied'));
    this.persistir();
    this.refrescarEstado();
  }
  // resuelta: el mensaje de la petición se borra; si el canal no deja, se queda en una línea, sin el comando, el diff
  // ni el plan
  private async quitarMensaje(e: Enviada<R>, como: string) {
    if (e.ref === undefined) return;
    try { await this.borrar(e.ref); }
    catch { await this.recoger(e.ref, visible(`${como} · ${e.quien} · ${e.pet.titulo}`)).catch(() => {}); }
  }
}
