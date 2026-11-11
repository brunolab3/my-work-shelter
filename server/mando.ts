// Mando a distancia: lo común a los bots del propio Supervisor (hoy, el de Slack: slackMando.ts). Lo normal es no salir del refugio: el bot solo escribe cuando un habitante pide aprobación (permiso, plan, pregunta o
// confianza) y se responde ahí mismo con sus botones. Además, a demanda, la lista de salas y conversaciones para pasarlas
// a Remote Control (la app de Claude). Nunca pasa lo que se habla: solo los rótulos (habitante, título, estado) y, para
// aprobar, la petición tal cual la ve el diálogo del juego, con los secretos tapados, los invisibles a la vista y borrada
// al responderla. Aquí, los mensajes y botones en un modelo neutro ({ text, filas }); cada bot los pinta a su manera y
// trae de vuelta el `dato` del botón pulsado. Con varios emparejados, la petición va a todos: al responderla en uno,
// la conversación cambia y los demás recogen su mensaje (`peticion`), como si se hubiera respondido en el refugio.
import path from 'node:path';
import { t } from '../shared/idioma.ts';
import type { SessionSummary, PendingRequest } from '../shared/protocolo.ts';
import { visible } from '../shared/visible.ts';

export const PAIRING_MS = 10 * 60_000;
const MAX_PETICION = 3500;   // lo que no cabe entero en un mensaje no se aprueba desde el móvil

/** Un botón: lo que se lee y lo que vuelve al pulsarlo (≤ 64 bytes, para que quepa en cualquier canal) */
export interface Boton { texto: string; dato: string }
export type Filas = Boton[][];
/** Un mensaje en texto plano (nunca Markdown: nada puede cerrar un bloque) con sus filas de botones */
export interface Vista { text: string; filas: Filas }

export interface RemoteDeps {
  sesiones: () => SessionSummary[];
  salas: () => { id: string; nombre: string }[];
  habitante: (s: SessionSummary) => string;
  /** pasa esas conversaciones a Remote Control (todas, sin ids) */
  aRemoteControl: (ids?: string[]) => Promise<{ sesiones: number; avisos: string[] }>;
  /** la respuesta a una petición, como la del diálogo del juego (nunca «siempre» desde el móvil) */
  responder: (sesionId: string, peticionId: string, decision: 'si' | 'no', responses?: Record<string, string>) => void;
  alCambiar?: () => void;
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

  async mandarListado() {
    if (!this.listo()) return;
    await this.mandar(listadoVista(this.d.salas(), this.d.sesiones(), this.d.habitante));
  }

  /** Con cada cambio de una conversación: si pide aprobación, se manda al móvil (una vez); si lo que se mandó ya no está
   *  pendiente (respondido en el refugio o en otro mando, cancelado o cerrada), su mensaje se recoge en una línea */
  async peticion(s: SessionSummary) {
    if (!this.listo()) return;
    for (const [k, e] of this.enviadas) if (e.sesionId === s.id && (s.pending?.id !== e.pet.id || s.estado === 'cerrada')) {
      this.enviadas.delete(k);
      await this.cerrarMensaje(e, t('server.remoteAnsweredElsewhere'));
    }
    const pet = s.pending;
    if (!pet || s.estado === 'cerrada' || !this.aprueba() || [...this.enviadas.values()].some(e => e.pet.id === pet.id)) return;
    const k = String(this.siguiente++);
    const quien = rotulo(s, this.d.habitante(s));
    const v = vistaPeticion(pet, quien);
    const e: Enviada<R> = { sesionId: s.id, pet, quien, text: v.text, paso: 0, respuestas: {}, revisable: v.revisable };
    this.enviadas.set(k, e);
    try { e.ref = await this.mandar({ text: v.text, filas: botonesPeticion(pet, k, 0, v.revisable, s.id) }); }
    catch (err) { this.enviadas.delete(k); console.error(`${this.canal}:`, (err as Error).message); }
  }

  /** Un botón pulsado por quien toca (el canal ya lo ha comprobado) */
  protected async pulsar(dato: string, aviso: Aviso) {
    const ap = /^(ok|no|q):(\d+)(?::(\d+))?$/.exec(dato);
    if (ap) { await this.contestar(aviso, ap[2], ap[1] as 'ok' | 'no' | 'q', Number(ap[3])); return; }
    if (dato === 'ls') { await aviso(); await this.mandarListado(); return; }
    if (!dato.startsWith('rc:')) { await aviso(); return; }
    const id = dato.slice(3);
    const vivas = abiertas(this.d.sesiones());
    const ids = id === '*' ? undefined : vivas.some(s => s.id === id) ? [id] : [];
    if (ids && !ids.length) { await aviso(t('server.remoteNoLongerOpen')); return; }
    await aviso(t('server.remoteOpeningRemoteControl'));
    const r = await this.d.aRemoteControl(ids).catch(e => ({ sesiones: 0, avisos: [(e as Error).message] }));
    const texto = r.sesiones ? t('server.remoteOpenedInRemoteControl', { n: r.sesiones }) : t('server.remoteCouldNotOpen');
    await this.mandar({ text: [texto, ...r.avisos].join('\n'), filas: [] });
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
    await this.cerrarMensaje(e, t(que === 'q' ? 'server.remoteAnswered' : decision === 'si' ? 'server.remoteApproved' : 'server.remoteDenied'));
  }
  // el mensaje de la petición se queda en una línea, sin el comando, el diff ni el plan
  private async cerrarMensaje(e: Enviada<R>, como: string) {
    if (e.ref === undefined) return;
    await this.recoger(e.ref, visible(`${como} · ${e.quien} · ${e.pet.titulo}`)).catch(() => {});
  }
}
