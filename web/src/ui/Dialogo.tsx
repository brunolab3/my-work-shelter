// Intercomunicador del refugio: hablar con un habitante es una sesión REAL de Claude Code en la carpeta de su sala.
// Es una ventana como las terminales (ventanas.tsx): una por habitante, con pestañas, y cada conversación (cada
// trabajo) en su pestaña, así que un habitante lleva varios trabajos a la vez. ⌘T abre una pestaña con el menú.
// - Esc es «atrás»: de la ficha, el archivo o el trabajo nuevo, al menú; arriba del todo, vuelve al refugio: si hay
//   trabajos (o algo escrito), el intercomunicador se minimiza a la barra y siguen en marcha. En los menús, ← también
//   vuelve atrás. Con algo escrito, Esc avisa y solo a la segunda lo borra (en una conversación) o sale sin ello.
// - Lo escrito no se pierde nunca (guardarIntercoms): sobrevive a recargas, reinicios y a que la conversación se cierre
//   sola; cerrar a mano una pestaña con algo escrito pregunta antes.
// - Minimizar (_ · ⌘↓ · ⌘M), ampliar (▢ · ⌘↑) y cerrar (× · ⌘W la pestaña · ⌘⇧W todo). Cerrar una conversación la
//   termina (queda en el archivo para retomarla); si está trabajando o te espera, pregunta antes.
// - Desde la barra se vuelve con el habitante y se ve lo mismo que se dejó (también lo que estabas escribiendo).
// - ↗ (⌘⇧E) saca la conversación a una terminal de tu escritorio: se cierra aquí y sigue allí con `claude --resume`
//   (si estaba trabajando, se interrumpe y allí se le pide que siga). Mientras esté abierta fuera, el archivo la
//   marca y no se puede retomar aquí.
// - Ctrl+C para al habitante; Enter envía (Shift+Enter, salto de línea); Ctrl+↑/↓ o RePág/AvPág desplazan.
// - Las copias holográficas (worktrees) tienen su propio intercomunicador, como clones: su retrato en holograma, su
//   rama y sus cambios, y las conversaciones de dentro del worktree (copias.ts). Si un trabajo del habitante se muda a
//   un worktree, su pestaña pasa a la ventana de la copia, y si se estaba viendo, se sigue con la copia.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionSummary, LogInput, HistoryElement, Command, PendingRequest, Visitante } from '@shared/protocolo';
import { MODELS, EFFORTS, PERMISSION_MODES } from '@shared/protocolo';
import { t, tIs } from '@shared/idioma';
import { juego, type DwellerSummary } from './estadoJuego';
import { vivo, cliente, loadLog } from '../red/cliente';
import { markdown, markdownLine } from './markdown';
import { RequestView, ToolText } from './textoPlano';
import { teclado } from '../motor/teclado';
import { SFX } from '../audio/sonido';
import { physicsKey } from '../audio/teclado';
import { Store } from './almacen';
import { useMenu as useMenuBase, Opciones } from './aparato';
import { CMD, nextZ, windowShortcut, WindowButtons, Tabs, Confirmation } from './ventanas';
import { sessionOwner, interlocutor, branchCaption } from './copias';
import { Usage } from './consumo';
import { takeASurface, aAppClaude } from './superficie';
import { type AttachmentLocal, uploadFiles, chooseFiles, subiendo, listsPaths, AttachmentsTray, SentAttachments, useDictation, InputButtons, DictationStrip, attachShortcut } from './entrada';

type View = { tipo: 'menu' } | { tipo: 'nuevo'; reanudar?: HistoryElement } | { tipo: 'historial' } | { tipo: 'visitantes' } | { tipo: 'ficha' } | { tipo: 'sesion'; sesionId: string };
// recuerdo: la conversación de la pestaña (para retomarla con lo escrito si se cierra sin que el Supervisor la cierre)
interface TabCom { id: string; vista: View; borrador?: string; adjuntos?: AttachmentLocal[]; motivo?: { peticion: string; texto: string }; sessionWait?: boolean; recuerdo?: HistoryElement }
export interface WindowCom { dwellerId: string; pestanas: TabCom[]; activa: string; maximizada: boolean; z: number; known: string[]; confirmar?: string[] }
export const intercoms = new Store<{ lista: WindowCom[] }>({ lista: [] });

const PREFERENCES = 'refugio.trabajo';
function prefs() { try { return JSON.parse(localStorage.getItem(PREFERENCES) || '{}'); } catch { return {}; } }

// ---------------------------------------------------------------- ventanas y pestañas
let nTab = 0;
const newId = () => 'p' + (++nTab);

// ---------------------------------------------------------------- lo escrito no se pierde
// Las pestañas y lo que el Supervisor tiene escrito en ellas (texto y adjuntos ya subidos) se guardan en la página y
// sobreviven a una recarga («Aplicar los cambios del juego»), a un reinicio del servidor y a que la conversación se
// cierre sin que él la cierre (sola, al reiniciar, desde fuera): entonces la pestaña se queda con lo escrito, lista
// para retomar la conversación (Enter). Lo escrito solo se va si él lo borra: enviándolo, con Esc dos veces o
// cerrando la pestaña tras confirmarlo.
const SAVED = 'refugio.intercoms';
type SavedTab = Pick<TabCom, 'vista' | 'borrador' | 'adjuntos' | 'recuerdo'>;
interface SavedWindow { dwellerId: string; maximizada: boolean; known: string[]; activa: number; pestanas: SavedTab[] }
const readyAttachments = (l?: AttachmentLocal[]) => (l ?? []).filter(a => a.ruta && !a.error);
export const withText = (p: TabCom) => !!p.borrador?.trim() || readyAttachments(p.adjuntos).length > 0;
function saveIntercoms() {
  const lista: SavedWindow[] = [];
  for (const v of intercoms.get().lista) {
    // solo lo que merece volver: las conversaciones y lo que tiene algo escrito
    const pestanas = v.pestanas.filter(p => p.vista.tipo === 'sesion' || withText(p));
    if (!pestanas.length) continue;
    lista.push({ dwellerId: v.dwellerId, maximizada: v.maximizada, known: v.known.slice(-60), activa: Math.max(0, pestanas.findIndex(p => p.id === v.activa)),
      pestanas: pestanas.map(p => ({ vista: p.vista, borrador: p.borrador || undefined, recuerdo: p.recuerdo, adjuntos: readyAttachments(p.adjuntos).map(a => ({ ...a, vista: a.vista?.startsWith('blob:') ? undefined : a.vista })) })) });
  }
  try { localStorage.setItem(SAVED, JSON.stringify(lista)); } catch {}
}
function restoreIntercoms(): WindowCom[] {
  try {
    const l = JSON.parse(localStorage.getItem(SAVED) || '[]') as SavedWindow[];
    return l.filter(v => v?.dwellerId && v.pestanas?.length).map(v => {
      const pestanas: TabCom[] = v.pestanas.map(p => ({ ...p, id: newId(), adjuntos: p.adjuntos?.length ? p.adjuntos.map((a, i) => ({ ...a, id: `g${nTab}-${i}` })) : undefined }));
      return { dwellerId: v.dwellerId, maximizada: !!v.maximizada, known: v.known ?? [], z: nextZ(), pestanas, activa: (pestanas[v.activa] ?? pestanas[0]).id };
    });
  } catch { return []; }
}
if (typeof window !== 'undefined') {
  intercoms.set({ lista: restoreIntercoms() });
  let t: ReturnType<typeof setTimeout> | undefined;
  intercoms.subscribe(() => { clearTimeout(t); t = setTimeout(saveIntercoms, 250); });
  addEventListener('pagehide', saveIntercoms); addEventListener('beforeunload', saveIntercoms);
}
// Al servidor, las conversaciones que se están viendo o tienen algo escrito: esas no se cierran solas (media hora
// quietas) mientras el Supervisor las lee o contesta
let useSignature = '';
function notifyInUse() {
  const talking = juego.get().talkingWith, ids = new Set<string>();
  for (const v of intercoms.get().lista) for (const p of v.pestanas) if (p.vista.tipo === 'sesion' && (withText(p) || (v.dwellerId === talking && p.id === v.activa))) ids.add(p.vista.sesionId);
  const f = [...ids].sort().join('|'); if (f === useSignature) return;
  useSignature = f; cliente.enviar({ t: 'enUso', sesiones: [...ids] });
}
const vivas = (hid: string) => Object.values(vivo.get().sesiones).filter(s => sessionOwner(s) === hid && s.estado !== 'cerrada' && !cerrandose.has(s.id));
const cerrandose = new Set<string>();   // sesiones que se han mandado cerrar (no vuelven a abrir pestaña)
const inRunning = (s?: SessionSummary) => !!s && (s.estado === 'arrancando' || s.estado === 'trabajando' || s.estado === 'esperando');
const urgency = (s: SessionSummary) => s.estado === 'esperando' ? 0 : s.estado === 'error' ? 1 : s.estado === 'terminada' && s.sinLeer ? 2 : inRunning(s) ? 3 : 4;
export const sessionPilot = (s?: SessionSummary) => !s ? 'ociosa' : s.estado === 'esperando' ? 'esperando' : s.estado === 'error' ? 'error' : inRunning(s) ? 'trabajando' : 'ociosa';
const sessionOf = (p: TabCom) => (p.vista.tipo === 'sesion' ? vivo.get().sesiones[p.vista.sesionId] : undefined);

const ventana = (hid: string) => intercoms.get().lista.find(v => v.dwellerId === hid);
/** La conversación de la pestaña a la vista en el intercomunicador abierto (para el buscador). */
export function sessionALaView(): SessionSummary | undefined {
  const hid = juego.get().talkingWith, v = hid ? ventana(hid) : undefined, p = v?.pestanas.find(x => x.id === v.activa);
  const s = p && sessionOf(p);
  return s && s.estado !== 'cerrada' ? s : undefined;
}
function actualizar(hid: string, f: Partial<WindowCom> | ((v: WindowCom) => Partial<WindowCom>)) {
  intercoms.set(e => ({ lista: e.lista.map(v => (v.dwellerId === hid ? { ...v, ...(typeof f === 'function' ? f(v) : f) } : v)) }));
}
function setTab(hid: string, pid: string, p: Partial<TabCom>) { actualizar(hid, v => ({ pestanas: v.pestanas.map(x => (x.id === pid ? { ...x, ...p } : x)) })); }

// al hablar con un habitante: su ventana, con una pestaña por cada trabajo suyo (la más urgente delante)
function openIntercom(hid: string) {
  let v = ventana(hid);
  if (!v) {
    const ses = vivas(hid).sort((a, b) => a.created - b.created);
    const pestanas: TabCom[] = ses.length ? ses.map(s => ({ id: newId(), vista: { tipo: 'sesion', sesionId: s.id } })) : [{ id: newId(), vista: { tipo: juego.get().workIn ? 'nuevo' : 'menu' } }];
    const primera = [...ses].sort((a, b) => urgency(a) - urgency(b) || b.actualizada - a.actualizada)[0];
    v = { dwellerId: hid, pestanas, activa: pestanas[primera ? ses.indexOf(primera) : 0].id, maximizada: false, z: nextZ(), known: ses.map(s => s.id) };
    intercoms.set(e => ({ lista: [...e.lista, v!] }));
    // una copia holográfica sin conversación abierta retoma por defecto la última de su worktree (si sigue en el menú)
    if (!ses.length && !juego.get().workIn) resumeLastOfCopy(hid, pestanas[0].id);
    if (!ses.length) return;
  } else actualizar(hid, { z: nextZ() });
  // «trabajar dentro de la copia» (worktree) llega con el worktree elegido: pestaña de trabajo nuevo
  if (juego.get().workIn) newTab(hid, { tipo: 'nuevo' });
}
function resumeLastOfCopy(hid: string, pid: string) {
  const c = interlocutor(hid);
  if (!c?.copia) return;
  cliente.ask<HistoryElement[]>({ t: 'historial', salaId: c.sala, cwd: c.copia.ruta }).then(lista => {
    const ultima = lista.filter(x => !x.fuera).sort((a, b) => b.modified - a.modified)[0];
    if (!ultima) return;
    const p = ventana(hid)?.pestanas.find(x => x.id === pid);
    if (p?.vista.tipo === 'menu') setTab(hid, pid, { vista: { tipo: 'nuevo', reanudar: ultima } });
  }).catch(() => {});
}
function newTab(hid: string, vista: View = { tipo: 'menu' }) {
  const id = newId();
  actualizar(hid, v => ({ pestanas: [...v.pestanas, { id, vista }], activa: id }));
  SFX.abrir();
}
function activar(hid: string, pid: string) { actualizar(hid, { activa: pid }); SFX.tick(); }
function moveTab(hid: string, paso: number) {
  const v = ventana(hid); if (!v || v.pestanas.length < 2) return;
  const i = v.pestanas.findIndex(p => p.id === v.activa);
  activar(hid, v.pestanas[(i + paso + v.pestanas.length) % v.pestanas.length].id);
}
function goView(hid: string, pid: string, vista: View) { setTab(hid, pid, { vista, borrador: undefined, adjuntos: undefined }); }
// los adjuntos que esperan en la pestaña (se suben solos: la pestaña puede minimizarse mientras tanto)
function changeAttachments(hid: string, pid: string, f: (l: AttachmentLocal[]) => AttachmentLocal[]) { actualizar(hid, v => ({ pestanas: v.pestanas.map(x => (x.id === pid ? { ...x, adjuntos: f(x.adjuntos ?? []) } : x)) })); }
function adjuntar(hid: string, pid: string, archivos: FileList | File[] | null | undefined) {
  if (!archivos?.length) return;
  uploadFiles(archivos, a => changeAttachments(hid, pid, l => [...l, a]), (id, c) => changeAttachments(hid, pid, l => l.map(x => (x.id === id ? { ...x, ...c } : x))));
  SFX.tick();
}
const removeAttachment = (hid: string, pid: string) => (id: string) => { changeAttachments(hid, pid, l => l.filter(x => x.id !== id)); SFX.clic(); };

// volver al refugio sin cerrar nada: la ventana queda en la barra
export function minimizeIntercom() {
  if (!juego.get().talkingWith) return;
  SFX.cerrar(); juego.set({ talkingWith: null, workIn: null }); window.dispatchEvent(new CustomEvent('refugio:fin-dialogo'));
}
// Esc arriba del todo: con trabajos (o algo escrito), minimizar; sin ellos no queda nada que guardar y se cierra
function salir(hid: string) {
  const v = ventana(hid);
  if (v?.pestanas.some(p => sessionOf(p) || withText(p))) minimizeIntercom();
  else { intercoms.set(e => ({ lista: e.lista.filter(x => x.dwellerId !== hid) })); minimizeIntercom(); }
}
// desde la barra: se vuelve con el habitante (viaje rápido) y la ventana aparece como estaba
export function restoreIntercom(hid: string) {
  const h = interlocutor(hid); if (!h) return;
  window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { salaId: h.sala, dwellerId: hid, talk: true } }));
}
// Desde el buscador (⌘K): una conversación abierta, en su pestaña y con su habitante a la vista
export function openConversation(sesionId: string) {
  const s = vivo.get().sesiones[sesionId]; if (!s || s.estado === 'cerrada') return;
  const hid = sessionOwner(s);
  sincronizar();   // la ventana y la pestaña de cada trabajo vivo existen siempre
  const v = ventana(hid);
  const t = v?.pestanas.find(p => p.vista.tipo === 'sesion' && p.vista.sesionId === sesionId);
  if (v && t) actualizar(hid, { activa: t.id, z: nextZ() });
  else if (v) newTab(hid, { tipo: 'sesion', sesionId });
  restoreIntercom(hid);
}
// …o una del archivo: si sigue viva, a ella; si no, a una pestaña para retomarla (Enter y sigue)
export function resumeConversation(hid: string, el: HistoryElement) {
  const viva = Object.values(vivo.get().sesiones).find(x => x.claudeId === el.claudeId && x.estado !== 'cerrada');
  if (viva) { openConversation(viva.id); return; }
  if (ventana(hid)) newTab(hid, { tipo: 'nuevo', reanudar: el });
  else {
    // la ventana nueva lleva también los trabajos vivos del habitante, pero delante la que se retoma
    const ses = vivas(hid).sort((a, b) => a.created - b.created), id = newId();
    const pestanas: TabCom[] = [...ses.map(x => ({ id: newId(), vista: { tipo: 'sesion' as const, sesionId: x.id } })), { id, vista: { tipo: 'nuevo', reanudar: el } }];
    intercoms.set(e => ({ lista: [...e.lista, { dwellerId: hid, pestanas, activa: id, maximizada: false, z: nextZ(), known: ses.map(x => x.id) }] }));
  }
  restoreIntercom(hid);
}
// El visitante de una sala (sus sesiones abiertas fuera del refugio): al intercomunicador de su habitante, con la lista
// de esas sesiones (la más reciente arriba); cada una se retoma ahí (la de un worktree pasa sola a su holograma)
export function claimVisitors(salaId: string) {
  const dwellers = juego.get().habitantes.filter(h => h.sala === salaId);
  const h = dwellers.find(x => x.estado === 'ocioso' || x.estado === 'durmiendo' || x.estado === 'terminado') ?? dwellers[0];
  if (!h) { SFX.noAllowed(); return; }
  const v = ventana(h.id), ya = v?.pestanas.find(x => x.vista.tipo === 'visitantes');
  if (ya) actualizar(h.id, { activa: ya.id });
  else if (v) newTab(h.id, { tipo: 'visitantes' });
  else {
    const ses = vivas(h.id).sort((a, b) => a.created - b.created), id = newId();
    const pestanas: TabCom[] = [...ses.map(x => ({ id: newId(), vista: { tipo: 'sesion' as const, sesionId: x.id } })), { id, vista: { tipo: 'visitantes' } }];
    intercoms.set(e => ({ lista: [...e.lista, { dwellerId: h.id, pestanas, activa: id, maximizada: false, z: nextZ(), known: ses.map(x => x.id) }] }));
  }
  restoreIntercom(h.id);
}
// retomar en esta pestaña una conversación del archivo, sin pasar por «trabajo nuevo» (la del visitante, ya confirmada)
function resumeHere(h: DwellerSummary, pid: string, el: HistoryElement) {
  const hid = h.id;
  setTab(hid, pid, { sessionWait: true });
  cliente.ask<string>({ t: 'empezar', dwellerId: h.copia?.authorId ?? hid, salaId: h.sala, prompt: '', opciones: { reanudar: el.claudeId, cwd: el.cwd } })
    .then(sesionId => {
      actualizar(hid, v => ({ known: [...v.known, sesionId], pestanas: v.pestanas.filter(x => x.id === pid || !(x.vista.tipo === 'sesion' && x.vista.sesionId === sesionId)).map(x => (x.id === pid ? { ...x, sessionWait: false, vista: { tipo: 'sesion', sesionId } } : x)) }));
      sincronizar();
    })
    .catch(() => { SFX.error(); setTab(hid, pid, { sessionWait: false, vista: { tipo: 'nuevo', reanudar: el } }); });
  SFX.shortSuccess();
}
function toggleMaximize(hid: string) { actualizar(hid, v => ({ maximizada: !v.maximizada })); SFX.clic(); }
// cerrar termina las conversaciones de esas pestañas (quedan en el archivo); si alguna trabaja o espera, o tiene
// algo escrito sin enviar (que se borraría), se pregunta
export function askClose(hid: string, ids?: string[]) {
  const v = ventana(hid); if (!v) return;
  const which = ids ?? v.pestanas.map(p => p.id);
  if (v.pestanas.some(p => which.includes(p.id) && (inRunning(sessionOf(p)) || withText(p)))) { actualizar(hid, { confirmar: which }); SFX.lowNotice(); return; }
  closeAlready(hid, which);
}
function closeAlready(hid: string, ids: string[]) {
  const v = ventana(hid); if (!v) return;
  for (const p of v.pestanas) if (ids.includes(p.id)) { const s = sessionOf(p); if (s) { cerrandose.add(s.id); cliente.enviar({ t: 'cerrarSesion', sesionId: s.id }); } }
  const resto = v.pestanas.filter(p => !ids.includes(p.id));
  SFX.cerrar();
  if (!resto.length) { intercoms.set(e => ({ lista: e.lista.filter(x => x.dwellerId !== hid) })); if (juego.get().talkingWith === hid) minimizeIntercom(); return; }
  const i = v.pestanas.findIndex(p => p.id === v.activa);
  actualizar(hid, { pestanas: resto, confirmar: undefined, activa: resto.some(p => p.id === v.activa) ? v.activa : resto[Math.min(i, resto.length - 1)].id });
}

// a la superficie: la conversación de esa pestaña sigue en tu escritorio; la pestaña se va sola cuando se cierra aquí
function takeTab(hid: string, pid: string) {
  const p = ventana(hid)?.pestanas.find(x => x.id === pid);
  const s = p && sessionOf(p);
  if (!s) { SFX.noAllowed(); return; }
  takeASurface({ sesiones: [s.id] });
}

// Cada trabajo vivo tiene su pestaña: los que llegan de fuera (un visitante, un reinicio) la abren solos, y la
// ventana de quien trabaja sin estar a la vista espera en la barra. Las pestañas de conversaciones que se han cerrado
// (a mano o solas, a la media hora quietas) se van, salvo si tienen algo escrito: se quedan para retomarla con ello;
// y las que se han mudado a un worktree pasan a su copia (con lo escrito).
// Solo con la lista de sesiones de esta conexión: antes de la bienvenida (al cargar la página) o sin conexión, la que
// hay no vale y se quitarían pestañas que siguen vivas.
let onDay = false;
function sincronizar() {
  if (!onDay) return;
  const sesiones = vivo.get().sesiones, talking = juego.get().talkingWith;
  const lista = intercoms.get().lista;
  let nueva = lista, cambio = false, traspaso: string | null = null;
  const liveByDweller = new Map<string, SessionSummary[]>(), dueno = new Map<string, string>();
  const moved = new Map<string, TabCom>();   // pestañas de conversaciones que pasan a otra ventana (una copia)
  for (const s of Object.values(sesiones)) if (s.estado !== 'cerrada' && !cerrandose.has(s.id)) { const d = sessionOwner(s); dueno.set(s.id, d); liveByDweller.set(d, [...(liveByDweller.get(d) ?? []), s]); }
  for (const v of lista) for (const p of v.pestanas) if (p.vista.tipo === 'sesion' && dueno.has(p.vista.sesionId) && dueno.get(p.vista.sesionId) !== v.dwellerId) moved.set(p.vista.sesionId, p);
  nueva = lista.map(v => {
    const beforeActive = v.pestanas.find(p => p.id === v.activa);
    let touched = false;
    let pestanas = v.pestanas.flatMap((p): TabCom[] => {
      if (p.vista.tipo !== 'sesion') return [p];
      const s = sesiones[p.vista.sesionId], d = dueno.get(p.vista.sesionId);
      if (s && s.estado !== 'cerrada' && d === v.dwellerId) {
        // se apunta qué conversación es, por si luego se cierra con algo escrito
        if (s.claudeId && (p.recuerdo?.claudeId !== s.claudeId || p.recuerdo.titulo !== s.titulo)) { touched = true; return [{ ...p, recuerdo: { claudeId: s.claudeId, titulo: s.titulo, modified: s.actualizada, cwd: s.cwd } }]; }
        return [p];
      }
      if (d && d !== v.dwellerId) return [];                // se ha mudado a otra ventana
      if (!withText(p)) return [];
      // cerrada (o perdida en un reinicio) con lo escrito: la pestaña se queda para retomarla con ello
      touched = true;
      return [{ ...p, vista: p.recuerdo ? { tipo: 'nuevo', reanudar: { ...p.recuerdo, modified: Date.now() } } : { tipo: 'nuevo' } }];
    });
    // la conversación que se estaba viendo se ha ido a una copia: se sigue con ella
    if (talking === v.dwellerId && beforeActive?.vista.tipo === 'sesion' && !pestanas.some(p => p.id === beforeActive.id)) { const d = dueno.get(beforeActive.vista.sesionId); if (d && d !== v.dwellerId) traspaso = d; }
    const known = new Set(v.known);
    let activa = v.activa;
    for (const s of (liveByDweller.get(v.dwellerId) ?? []).sort((a, b) => a.created - b.created)) {
      if (known.has(s.id) && !moved.has(s.id)) continue;
      if (pestanas.some(p => p.sessionWait)) continue;   // la está abriendo una pestaña de esta ventana
      known.add(s.id);
      if (!pestanas.some(p => p.vista.tipo === 'sesion' && p.vista.sesionId === s.id)) { const id = newId(), m = moved.get(s.id); pestanas = [...pestanas, { ...m, id, vista: { tipo: 'sesion', sesionId: s.id } }]; activa = id; }
    }
    if (!touched && pestanas.length === v.pestanas.length && known.size === v.known.length && activa === v.activa) return v;
    cambio = true;
    if (!pestanas.length) {
      if (talking !== v.dwellerId || traspaso) return null;
      pestanas = [{ id: newId(), vista: { tipo: 'menu' } }];
    }
    if (!pestanas.some(p => p.id === activa)) activa = pestanas[pestanas.length - 1].id;
    return { ...v, pestanas, activa, known: [...known] };
  }).filter(Boolean) as WindowCom[];
  for (const [hid, ses] of liveByDweller) if (!nueva.some(v => v.dwellerId === hid)) {
    cambio = true;
    const pestanas: TabCom[] = ses.sort((a, b) => a.created - b.created).map(s => ({ ...moved.get(s.id), id: newId(), vista: { tipo: 'sesion', sesionId: s.id } }));
    nueva = [...nueva, { dwellerId: hid, pestanas, activa: pestanas[pestanas.length - 1].id, maximizada: false, z: nextZ(), known: ses.map(s => s.id) }];
  }
  if (cambio) intercoms.set({ lista: nueva });
  if (traspaso) { const d = traspaso; setTimeout(() => restoreIntercom(d)); }
}
vivo.subscribe(() => { if (!vivo.get().connected) onDay = false; sincronizar(); });
cliente.escuchar(m => { if (m.t === 'bienvenida') { onDay = true; useSignature = ''; sincronizar(); notifyInUse(); } });
intercoms.subscribe(notifyInUse); juego.subscribe(notifyInUse);
// las copias aparecen (y se van) con el mundo: entonces cambia de quién son algunas conversaciones
let copiesSignature = '';
juego.subscribe(() => { const f = juego.get().copias.map(c => c.id).join('|'); if (f !== copiesSignature) { copiesSignature = f; sincronizar(); } });

// ---------------------------------------------------------------- interfaz
export function Dialogo() {
  const id = juego.usar(e => e.talkingWith);
  const h = juego.usar(e => interlocutor(e.talkingWith, e));
  const v = intercoms.usar(e => e.lista.find(x => x.dwellerId === id));
  useEffect(() => { if (id) openIntercom(id); }, [id]);
  if (!id || !h || !v) return null;
  return <Console key={id} h={h} v={v} />;
}

const VIEW_NAME: Record<string, string> = { menu: t('windows.menu'), nuevo: t('windows.newJob'), historial: t('windows.archive'), ficha: t('windows.profile'), visitantes: t('world.visitors') };

function Console({ h, v }: { h: DwellerSummary; v: WindowCom }) {
  const sesiones = vivo.usar(e => e.sesiones);
  const connected = vivo.usar(e => e.connected);
  const claudeOk = vivo.usar(e => e.claudeOk);
  const repo = vivo.usar(e => e.repos[h.sala]);
  const copia = h.copia;
  const p = v.pestanas.find(x => x.id === v.activa) ?? v.pestanas[0];
  const s = p?.vista.tipo === 'sesion' ? sesiones[p.vista.sesionId] : undefined;
  const hid = h.id;
  useEffect(() => { teclado.bloqueado = true; return () => { teclado.bloqueado = false; }; }, []);
  // al abrirse, el teclado es suyo: si estaba en una terminal, se suelta
  useEffect(() => { const a = document.activeElement as HTMLElement | null; if (a?.closest?.('.ventana-terminal')) a.blur(); }, []);
  // atajos de ventana, también escribiendo (antes que nadie; las terminales, el cliente de git y los archivos llevan los suyos)
  const ref = useRef(v); ref.current = v;
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('.ventana-terminal, .ventana-git')) return;
      const w = ref.current;
      windowShortcut(e, {
        maximizada: w.maximizada, newTab: () => newTab(hid), closeTab: () => askClose(hid, [w.activa]), closeWindow: () => askClose(hid),
        minimizar: minimizeIntercom, toggleMaximize: () => toggleMaximize(hid), moveTab: d => moveTab(hid, d),
        goTab: n => { const x = n === 9 ? w.pestanas.at(-1) : w.pestanas[n - 1]; if (x) activar(hid, x.id); },
        sacar: () => takeTab(hid, w.activa),
      });
    };
    addEventListener('keydown', f, true); return () => removeEventListener('keydown', f, true);
  }, [hid]);

  if (!p) return null;
  const ir = (vista: View) => goView(hid, p.id, vista);
  const onMenu = () => ir({ tipo: 'menu' });
  const vista = p.vista.tipo === 'sesion' && !s ? { tipo: 'menu' as const } : p.vista;
  const alta = v.maximizada || vista.tipo === 'sesion' || vista.tipo === 'nuevo' || vista.tipo === 'historial' || vista.tipo === 'visitantes';
  const items = v.pestanas.map(x => { const sx = x.vista.tipo === 'sesion' ? sesiones[x.vista.sesionId] : undefined; return { id: x.id, nombre: sx ? sx.titulo || t('windows.conversation') : x.sessionWait ? t('windows.starting2') : VIEW_NAME[x.vista.tipo] ?? t('windows.menu'), piloto: x.sessionWait ? 'trabajando' : sessionPilot(sx), titulo: sx ? `${sx.titulo} · ${sx.estado}` : '' }; });
  const worst = v.pestanas.map(sessionOf).filter(Boolean).sort((a, b) => urgency(a!) - urgency(b!))[0];
  const confirming = v.confirmar ? v.pestanas.filter(x => v.confirmar!.includes(x.id)).map(sessionOf).filter(inRunning) as SessionSummary[] : [];
  const written = v.confirmar ? v.pestanas.filter(x => v.confirmar!.includes(x.id) && withText(x)).length : 0;
  const writtenNotice = written ? (written > 1 ? t('windows.youHaveUnsentTextIn', { n: written }) : v.confirmar!.length > 1 ? t('windows.youHaveUnsentTextIn2') : t('windows.youHaveUnsentText')) : '';
  return (
    <div className={'consola interactivo' + (alta ? ' alta' : '') + (v.maximizada ? ' maximizada' : '') + (copia ? ' de-copia' : '')} role="dialog" aria-label={t('windows.talkToNombre', { nombre: h.nombre })}>
      <div className="consola-bisel">
        <div className="consola-cabeza" onDoubleClick={e => { if (!(e.target as HTMLElement).closest('button')) toggleMaximize(hid); }}>
          <span className="rejilla" aria-hidden />
          <span className={'piloto ' + (worst?.estado ?? 'apagado')} aria-hidden />
          <span className="consola-rotulo">{copia ? <>{t('windows.intercom')} · {t('windows.holographicCopyOfAutor', { autor: copia.nameAuthor.toUpperCase() })} · {branchCaption(copia.rama)} · {h.nameRoom}</> : <>{t('windows.intercom')} · {h.nombre} · {h.nameRoom}</>}</span>
          <WindowButtons sacar={s ? () => takeTab(hid, p.id) : undefined} wingApp={s ? () => aAppClaude({ sesionId: s.id }) : undefined} remoto={s ? () => takeASurface({ sesiones: [s.id], remoto: true }) : undefined} takesThat={t('windows.thisConversation')} maximizada={v.maximizada} minimizar={minimizeIntercom} toggleMaximize={() => toggleMaximize(hid)} cerrar={() => askClose(hid)} closesThat={t('windows.theIntercomAndItsConversations')} />
        </div>
        <Tabs items={items} activa={v.activa} activar={pid => activar(hid, pid)} cerrar={pid => askClose(hid, [pid])} nueva={() => newTab(hid)} opensThat={copia ? t('windows.newTabAnotherJobInside') : t('windows.newTabAnotherJobWith')} />
        <div className="consola-cuerpo">
          <aside className="consola-lado">
            <div className={'retrato-crt' + (copia ? ' holo' : '')}><LivePortrait /></div>
            {copia ? <>
              <div className="consola-nombre">{copia.nameAuthor} <span className="marca-copia">◇</span></div>
              <div className="consola-mote">{t('windows.holographicCopy')}</div>
              <StateChip s={s} />
              <div className="consola-dato">{t('windows.branch')} <b>{copia.rama || t('windows.noBranch')}</b></div>
              <div className="consola-dato">{copia.cambios ? t('windows.nChanges', { n: copia.cambios }) : t('windows.noChanges')}{copia.advanced ? ` · ${t('windows.nCommitsToMerge', { n: copia.advanced })}` : ''}</div>
            </> : <>
              <div className="consola-nombre">{h.nombre}</div>
              <div className="consola-mote">«{h.mote}»</div>
              <StateChip s={s} />
              {repo?.rama && <div className="consola-dato">{t('windows.branch')} <b>{repo.rama}</b>{repo.cambios ? ` · ${t('windows.nChanges', { n: repo.cambios })}` : ''}</div>}
            </>}
            {s?.modelo && <div className="consola-dato">{s.modelo.replace('claude-', '')}</div>}
            {s && (s.contexto || s.tokens) ? <div className="consola-dato"><Usage s={s} largo /></div> : null}
          </aside>
          <div className="consola-pestana" key={p.id}>
            {!connected ? <WithoutConnection /> : !claudeOk ? <WithoutClaude /> :
              p.sessionWait ? <div className="pantalla-consola fosforo"><p className="voz">{t('windows.startingTheJob')}</p></div> :
              vista.tipo === 'menu' ? <Menu h={h} ir={ir} salir={() => salir(hid)} /> :
              vista.tipo === 'nuevo' ? <New h={h} p={p} reanudar={vista.reanudar} volver={onMenu} /> :
              vista.tipo === 'visitantes' ? <Visitors h={h} volver={onMenu} reanudar={el => resumeHere(h, p.id, el)} /> :
              vista.tipo === 'historial' ? <Historial h={h} volver={onMenu} elegir={el => {
                const ya = Object.values(vivo.get().sesiones).find(x => x.claudeId === el.claudeId && x.estado !== 'cerrada');
                if (ya) { const t = v.pestanas.find(x => x.vista.tipo === 'sesion' && x.vista.sesionId === ya.id); if (t) activar(hid, t.id); else ir({ tipo: 'sesion', sesionId: ya.id }); }
                else if (el.enCurso) SFX.noAllowed();
                else ir({ tipo: 'nuevo', reanudar: el });
              }} /> :
              vista.tipo === 'ficha' ? <Ficha h={h} volver={onMenu} /> :
              s ? <Session h={h} s={s} p={p} salir={() => salir(hid)} onClose={() => { cerrandose.add(s.id); cliente.enviar({ t: 'cerrarSesion', sesionId: s.id }); onMenu(); }} /> : null}
          </div>
        </div>
        {v.confirmar && <Confirmation titulo={v.confirmar.length > 1 ? t('windows.closeTheTabs') : confirming.length ? t('windows.closeThisConversation') : t('windows.closeThisTab')}
          texto={confirming.length
            ? <>{copia ? t('windows.autorSCopy', { autor: copia.nameAuthor }) : h.nombre} {t('windows.isWorkingOn')} {confirming.length > 1 ? t('windows.nJobs', { n: confirming.length }) : <>«{confirming[0]?.titulo ?? t('windows.aJob')}»</>}{confirming.some(x => x.estado === 'esperando') ? ` ${t('windows.andIsWaitingForYou')}` : ''}. {t('windows.ifYouCloseItIt2')}{writtenNotice ? <> {writtenNotice}: {t('windows.wouldBeDeleted')}</> : null} {t('windows.toLetItCarryOn')}</>
            : <>{writtenNotice}. {t('windows.ifYouCloseItIt3')}</>}
          boton={confirming.length ? undefined : t('windows.closeAndDeleteEnter')}
          cerrar={() => closeAlready(hid, v.confirmar!)} minimizar={() => { actualizar(hid, { confirmar: undefined }); minimizeIntercom(); }} cancelar={() => actualizar(hid, { confirmar: undefined })} />}
      </div>
    </div>
  );
}

// Monta el lienzo del retrato en vivo que prepara el mundo (busto del habitante con su animación actual)
function LivePortrait() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const c = (window as any).__portrait as HTMLCanvasElement | undefined; if (c && ref.current) ref.current.appendChild(c); }, []);
  return <div ref={ref} className="retrato-lienzo" />;
}

function StateChip({ s }: { s?: SessionSummary }) {
  const est: Record<string, [string, string]> = { arrancando: [t('windows.starting'), 'trab'], trabajando: [t('windows.working'), 'trab'], esperando: [t('windows.waitingForYou'), 'esp'], terminada: [t('windows.finished'), 'fin'], ociosa: [t('windows.ready'), 'fin'], error: [t('windows.fault'), 'err'], cerrada: [t('windows.closed'), 'oci'] };
  if (!s) return <span className="chip-estado oci">{t('windows.noSession')}</span>;
  const [txt, cls] = est[s.estado] ?? [s.estado, 'oci'];
  return <span className={'chip-estado ' + cls}>{txt}</span>;
}

function WithoutConnection() {
  const attempts = vivo.usar(e => e.attempts);
  return <div className="pantalla-consola fosforo"><p className="aviso-consola">{t('windows.noLinkToTheShelter')}{'.'.repeat(1 + (attempts % 3))}</p><p className="tenue">{t('windows.ifYouClosedItReopen')} <code>./shelter</code>.</p></div>;
}
function WithoutClaude() {
  return <div className="pantalla-consola fosforo"><p className="aviso-consola">{t('windows.iCanTFindClaude')}</p><p>{t('windows.theDwellersWorkWithYour')} (<code>claude</code> {t('windows.inATerminalThen')} <code>/login</code>) {t('windows.andReopenTheShelter')}</p></div>;
}

// ---------------------------------------------------------------- menús con teclado: Esc (y ←) es «atrás»
const useMenu = (n: number, f: (i: number) => void, atras: () => void, extra?: (e: KeyboardEvent) => boolean | void) =>
  useMenuBase(n, f, e => { const x = extra?.(e); if (x !== undefined) return x; if (e.code === 'ArrowLeft' || e.code === 'Backspace') { atras(); return true; } return undefined; }, atras);

function Menu({ h, ir, salir }: { h: DwellerSummary; ir: (v: View) => void; salir: () => void }) {
  // trabajo y terminal van en la carpeta de trabajo de su sala (las especiales tienen una propia); los de una copia, en su worktree
  const carpeta = h.carpeta ?? h.ruta, copia = h.copia;
  const terminal = async () => {
    if (!copia) { window.dispatchEvent(new CustomEvent('refugio:terminal', { detail: { salaId: h.sala } })); return; }
    const { openTerminalIn } = await import('./Terminales');
    openTerminalIn('wt:' + copia.ruta, h.sala, `${h.nameRoom} · ${copia.rama}`, copia.ruta);
  };
  // revisar la copia (cambios, commits, integrar, desechar) es el aparato de la copia: el intercomunicador baja a la barra
  const revisar = () => { salir(); juego.set({ panel: 'worktree', panelData: { salaId: h.sala, aparato: 'wt:' + copia!.ruta } }); };
  const opciones = [
    { texto: copia ? t('windows.startANewJobInside') : t('windows.startANewJob'), pista: t('windows.inCarpeta', { carpeta: (carpeta ?? t('windows.theirRoom')).replace(/^\/Users\/[^/]+/, '~') }), f: () => ir({ tipo: 'nuevo' }) },
    { texto: t('windows.resumeAPreviousJob'), pista: copia ? t('windows.fromThisWorktree') : t('windows.includingTerminalOnes'), f: () => ir({ tipo: 'historial' }) },
    ...(carpeta ? [{ texto: copia ? t('windows.openATerminalInside') : t('windows.openTheirTerminal'), pista: 'T', f: terminal }] : []),
    ...(copia ? [{ texto: t('windows.reviewTheCopyChangesCommits'), f: revisar }] : []),
    { texto: t('windows.viewTheirProfile'), f: () => ir({ tipo: 'ficha' }) },
    // su aspecto se cambia en el probador de Chapa y Pintura (la Octocat es como es)
    ...(!copia && h.tipo !== 'Octocat' ? [{ texto: t('windows.changeTheirLook'), pista: t('world.bodyShop'), f: () => { salir(); juego.set({ panel: 'chapa', panelData: { quien: h.id } }); } }] : []),
    { texto: t('menu.backToTheShelter'), pista: 'Esc', f: salir },
  ];
  const items = opciones;
  const elegir = (j: number) => opciones[j]?.f();
  const [i, setI] = useMenu(items.length, elegir, salir, e => { if (e.code === 'KeyT' && carpeta) { terminal(); return true; } return undefined; });
  const saludo = useMemo(() => greetingOf(h), [h.id]);
  return (
    <div className="pantalla-consola fosforo">
      <p className="voz">{saludo}</p>
      <Opciones items={items} i={i} setI={setI} onChoose={elegir} />
      <p className="ayuda-consola"><kbd>↑↓</kbd> {t('menu.select')} <kbd>Enter</kbd> {t('menu.accept')} <kbd>Esc</kbd> {t('menu.backToTheShelter2')} <kbd>{CMD}T</kbd> {t('windows.anotherTab')}</p>
    </div>
  );
}

function greetingOf(h: DwellerSummary) {
  if (h.copia) {
    const r = branchCaption(h.copia.rama);
    const phrases = [t('windows.copyOfAutorOnlineHere', { autor: h.copia.nameAuthor, rama: r }), t('windows.iMAutorSCopy', { autor: h.copia.nameAuthor, rama: r }), h.copia.cambios ? t('windows.projectionStableBranchRamaWith', { rama: r, n: h.copia.cambios }) : t('windows.projectionStableBranchRamaShall', { rama: r })];
    return phrases[Math.floor(Math.random() * phrases.length)];
  }
  const phrases = h.robot
    ? [t('windows.unitReadyStateTheTask'), t('windows.diagnosticsCompleteAwaitingOrders'), t('windows.myCircuitsAreAtYour')]
    : h.estado === 'durmiendo' ? [t('windows.huhWhatOhOverseerI'), t('windows.fiveMoreMinutesOkayOkay')]
    : [t('windows.whatAreWeDoingToday'), t('windows.tellMeWhatSUp'), t('windows.hereIAmShallWe'), t('windows.allQuietInSalaFor', { sala: h.nameRoom })];
  return phrases[Math.floor(Math.random() * phrases.length)];
}

function Ficha({ h, volver }: { h: DwellerSummary; volver: () => void }) {
  const repo = vivo.usar(e => e.repos[h.sala]);
  const [i, setI] = useMenu(1, () => volver(), volver);
  const c = h.copia;
  if (c) return (
    <div className="pantalla-consola fosforo ficha">
      <dl>
        <dt>{t('windows.copyOf')}</dt><dd>{c.nameAuthor} «{c.nicknameAuthor}»</dd>
        <dt>{t('windows.room')}</dt><dd>{h.nameRoom}</dd>
        <dt>Worktree</dt><dd><code>{c.ruta}</code></dd>
        <dt>{t('windows.branch2')}</dt><dd>{c.rama || t('windows.noBranch')} · {t('windows.nUncommittedChanges', { n: c.cambios })} · {t('windows.nCommitsToMerge', { n: c.advanced })}</dd>
        <dt>{t('windows.status')}</dt><dd>{h.estado}{h.detalle ? ' · ' + h.detalle : ''}</dd>
        <dt>{t('windows.record')}</dt><dd>{h.bio}</dd>
      </dl>
      <Opciones items={[{ texto: t('windows.back'), pista: 'Esc' }]} i={i} setI={setI} onChoose={volver} />
    </div>
  );
  return (
    <div className="pantalla-consola fosforo ficha">
      <dl>
        <dt>{t('windows.name')}</dt><dd>{h.nombre} «{h.mote}»</dd>
        <dt>{t('windows.room')}</dt><dd>{h.nameRoom}{h.carpeta ?? h.ruta ? <> · <code>{h.carpeta ?? h.ruta}</code></> : null}</dd>
        {repo?.rama && <><dt>{t('windows.branch2')}</dt><dd>{repo.rama} · {t('windows.nUncommittedChanges', { n: repo.cambios })}</dd></>}
        {repo?.lastCommit && <><dt>{t('windows.lastCommit')}</dt><dd>{repo.lastCommit.mensaje} <span className="tenue">({hace(repo.lastCommit.fecha)})</span></dd></>}
        <dt>{t('windows.status')}</dt><dd>{h.estado}{h.detalle ? ' · ' + h.detalle : ''}</dd>
        <dt>{t('windows.record')}</dt><dd>{h.bio}</dd>
      </dl>
      <Opciones items={[{ texto: t('windows.back'), pista: 'Esc' }]} i={i} setI={setI} onChoose={volver} />
    </div>
  );
}

export function hace(cuando: number) {
  const m = Math.round((Date.now() - cuando) / 60000);
  if (m < 1) return t('windows.justNow'); if (m < 60) return t('windows.nMinAgo', { n: m }); const hh = Math.round(m / 60); if (hh < 48) return t('windows.nHAgo', { n: hh }); return t('windows.nDaysAgo', { n: Math.round(hh / 24) });
}

// ---------------------------------------------------------------- historial (conversaciones reales de la carpeta)
function Historial({ h, volver, elegir }: { h: DwellerSummary; volver: () => void; elegir: (el: HistoryElement) => void }) {
  const [lista, setList] = useState<HistoryElement[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { cliente.ask<HistoryElement[]>({ t: 'historial', salaId: h.sala, cwd: h.copia?.ruta }).then(setList).catch(e => setError(e.message)); }, [h.sala, h.copia?.ruta]);
  const items = [...(lista ?? []).map(el => ({ texto: (el.fuera ? '↗ ' : '') + el.titulo, pista: `${hace(el.modified)}${el.rama ? ' · ' + el.rama : ''}${el.enCurso ? ` · ${t('windows.inProgress')}` : ''}${el.fuera ? ` · ${t('windows.openOnYourDesktop')}` : ''}` })), { texto: t('windows.back'), pista: 'Esc' }];
  // la que sigue abierta en tu escritorio no se retoma aquí a la vez (se corrompería): primero /exit allí o, si la
  // pestaña se cerró sin salir y el proceso sigue vivo, Enter otra vez la cierra a la fuerza y la retoma aquí
  const [forzar, setForce] = useState(-1);
  const onChoose = (k: number) => {
    if (!lista || k >= lista.length) return volver();
    const el = lista[k];
    if (!el.fuera) return elegir(el);
    if (forzar !== k) { SFX.noAllowed(); setForce(k); setError(t('windows.thatConversationIsStillOpen')); return; }
    setForce(-1); setError(t('windows.forcingClose'));
    cliente.accion<number>('superficie.forzarCierre', { claudeId: el.claudeId })
      .then(() => { setError(''); elegir({ ...el, fuera: false }); })
      .catch(e => { SFX.error(); setError((e as Error).message); });
  };
  const [i, setI] = useMenu(items.length, onChoose, volver);
  return (
    <div className="pantalla-consola fosforo">
      <p className="voz">{lista === null ? t('windows.searchingTheArchive') : lista.length ? (h.copia ? t('windows.thisIsWhatIsIn') : t('windows.thisIsWhatIsIn2')) : t('windows.thereAreNoPreviousConversations')}</p>
      {error && <p className="aviso-consola">{error}</p>}
      <div className="lista-desplazable"><Opciones items={items} i={i} setI={setI} onChoose={onChoose} /></div>
      <p className="ayuda-consola"><kbd>↑↓</kbd> {t('menu.select')} <kbd>Enter</kbd> {t('windows.resume')} <kbd>Esc</kbd> <kbd>←</kbd> {t('windows.back2')}</p>
    </div>
  );
}

// ---------------------------------------------------------------- visitantes (sesiones de la sala abiertas fuera del refugio)
// Solo las de fuera, la más reciente arriba; los títulos y si siguen con `claude --resume` vienen del archivo de la sala y
// de cada worktree con visitas. Enter la retoma aquí (si sigue abierta con --resume, la cierra allí antes)
function Visitors({ h, volver, reanudar }: { h: DwellerSummary; volver: () => void; reanudar: (el: HistoryElement) => void }) {
  const visitas = vivo.usar(e => e.visitantes.filter(v => v.salaId === h.sala));
  const ramas = vivo.usar(e => e.repos[h.sala]?.worktrees);
  const [archivo, setArchivo] = useState<Map<string, HistoryElement> | null>(null);
  const [error, setError] = useState('');
  // la lista del último aviso del servidor puede ir hasta 15 s atrasada: se pide al momento y, hasta tenerla con sus
  // títulos, se enseña «cargando» (no media lista que luego crece)
  const [fresca, setFresca] = useState(false);
  useEffect(() => { cliente.accion<Visitante[]>('visitantes').then(v => vivo.set({ visitantes: v })).catch(() => {}).finally(() => setFresca(true)); }, []);
  const dirs = [...new Set(visitas.map(v => v.worktree ?? ''))].sort().join('|');
  useEffect(() => {
    if (!fresca) return;
    Promise.all(dirs.split('|').map(d => cliente.ask<HistoryElement[]>({ t: 'historial', salaId: h.sala, cwd: d || undefined }).catch(() => [])))
      .then(ls => setArchivo(new Map(ls.flat().map(x => [x.claudeId, x]))));
  }, [h.sala, dirs, fresca]);
  const lista: HistoryElement[] = [...visitas].sort((a, b) => b.modified - a.modified).map(v => {
    const x = archivo?.get(v.claudeId);
    return { claudeId: v.claudeId, titulo: x?.titulo || v.titulo, modified: v.modified, cwd: v.cwd, fuera: x?.fuera, rama: v.worktree ? ramas?.find(w => w.ruta === v.worktree)?.rama || v.worktree.split('/').pop() : undefined };
  });
  const items = [...lista.map(el => ({ texto: '↗ ' + el.titulo, pista: `${hace(el.modified)}${el.rama ? ' · ◇ ' + el.rama : ''}` })), { texto: t('windows.back'), pista: 'Esc' }];
  const onChoose = (k: number) => {
    if (k >= lista.length) return volver();
    const el = lista[k];
    if (!el.fuera) return reanudar(el);
    setError(t('windows.forcingClose'));
    cliente.accion<number>('superficie.forzarCierre', { claudeId: el.claudeId }).then(() => reanudar({ ...el, fuera: false })).catch(e => { SFX.error(); setError((e as Error).message); });
  };
  const [i, setI] = useMenu(items.length, onChoose, volver);
  if (!archivo) return <div className="pantalla-consola fosforo"><p className="voz">{t('windows.lookingForVisitors')}</p></div>;
  return (
    <div className="pantalla-consola fosforo">
      <p className="voz">{lista.length ? t('windows.visitorSessionsHere') : t('windows.noVisitorSessions')}</p>
      {error && <p className="aviso-consola">{error}</p>}
      <div className="lista-desplazable"><Opciones items={items} i={i} setI={setI} onChoose={onChoose} /></div>
      <p className="ayuda-consola"><kbd>↑↓</kbd> {t('menu.select')} <kbd>Enter</kbd> {t('windows.resumeHere')} <kbd>Esc</kbd> <kbd>←</kbd> {t('windows.back2')}</p>
    </div>
  );
}

// Esc con algo escrito no lo borra a la primera (como en Claude Code): avisa y, si se repite enseguida, lo hace
function useEscDouble() {
  const [armado, setArmado] = useState(false);
  const ref = useRef(false); ref.current = armado;
  useEffect(() => { if (!armado) return; const t = setTimeout(() => setArmado(false), 1600); return () => clearTimeout(t); }, [armado]);
  return { armado, pulsar: (hasText: boolean, accion: () => void) => { if (!hasText || ref.current) { ref.current = false; setArmado(false); accion(); } else { ref.current = true; setArmado(true); SFX.tick(); } } };
}

// ---------------------------------------------------------------- trabajo nuevo / retomar
function New({ h, p, reanudar, volver }: { h: DwellerSummary; p: TabCom; reanudar?: HistoryElement; volver: () => void }) {
  const p0 = prefs();
  const [texto, setText0] = useState(p.borrador ?? '');
  const setText = (t: string) => { setText0(t); setTab(h.id, p.id, { borrador: t }); };
  const [modelo, setModelo] = useState<string>(p0.modelo ?? '');
  const [esfuerzo, setEffort] = useState<string>(p0.esfuerzo ?? '');
  // los permisos no se recuerdan: cada conversación nueva empieza en automático (lo demás se elige para esa)
  const [permisos, setPermissions] = useState<string>('auto');
  // hablar con el habitante de la sala es trabajar en su copia principal: los worktrees son de las tareas (organizar la
  // sala por tareas, el reparto de Planificación) o de quien lo elija aquí. Las demás (Puente de Mando…) trabajan siempre
  // en su carpeta
  const ofProject = vivo.usar(e => (e.estado?.salas ?? []).find((s: any) => s.id === h.sala)?.tipo === 'repo');
  const [worktree, setWorktree] = useState(false);
  const workInGame = juego.usar(e => e.workIn);
  // una copia trabaja siempre dentro de su worktree, como su autor
  const workIn = h.copia ? { cwd: h.copia.ruta, rama: h.copia.rama } : workInGame;
  const [fila, setRow] = useState(0); // 0 texto, 1 modelo, 2 esfuerzo, 3 permisos, 4 worktree
  const [transcripcion, setTranscript] = useState<LogInput[] | null>(null);
  const [error, setError] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const esc = useEscDouble();
  const atras = () => esc.pulsar(!!texto.trim(), volver);
  useEffect(() => { area.current?.focus(); }, []);
  useEffect(() => { if (reanudar) cliente.ask<LogInput[]>({ t: 'cargarConversacion', salaId: h.sala, claudeId: reanudar.claudeId }).then(setTranscript).catch(() => setTranscript([])); }, [reanudar?.claudeId]);
  const filas = [
    { nombre: t('windows.model'), valores: MODELS, actual: modelo, poner: setModelo },
    { nombre: t('windows.effort'), valores: EFFORTS, actual: esfuerzo, poner: setEffort },
    { nombre: t('windows.permissions'), valores: PERMISSION_MODES, actual: permisos, poner: setPermissions },
  ];
  // la pestaña espera a que el servidor diga qué sesión es la suya y pasa a la conversación
  const enviar = (txt = texto) => {
    if (subiendo(p.adjuntos)) { SFX.noAllowed(); setError(t('windows.waitForTheAttachmentsTo')); return; }
    const rutas = listsPaths(p.adjuntos);
    if (!txt.trim() && !reanudar && !rutas.length) { SFX.noAllowed(); return; }
    try { localStorage.setItem(PREFERENCES, JSON.stringify({ modelo, esfuerzo })); } catch {}
    setError('');
    const hid = h.id, pid = p.id;
    setTab(hid, pid, { sessionWait: true });
    const dentro = h.copia ? workIn : juego.get().workIn;
    cliente.ask<string>({ t: 'empezar', dwellerId: h.copia?.authorId ?? hid, salaId: h.sala, prompt: txt.trim(), adjuntos: rutas, opciones: { modelo, esfuerzo, permisos, worktree: dentro || !ofProject ? false : worktree, reanudar: reanudar?.claudeId, cwd: reanudar?.cwd ?? dentro?.cwd } })
      .then(sesionId => {
        actualizar(hid, v => ({ known: [...v.known, sesionId], pestanas: v.pestanas.filter(x => x.id === pid || !(x.vista.tipo === 'sesion' && x.vista.sesionId === sesionId)).map(x => (x.id === pid ? { ...x, sessionWait: false, borrador: undefined, adjuntos: undefined, vista: { tipo: 'sesion', sesionId } } : x)) }));
        sincronizar();
      })
      .catch(e => { setTab(hid, pid, { sessionWait: false }); SFX.error(); setError((e as Error).message); });
    juego.set({ workIn: null });
    SFX.shortSuccess();
  };
  useEffect(() => teclado.escuchar(e => {
    if (e.code === 'Escape') { atras(); return true; }
    if (fila > 0) {
      if (e.code === 'ArrowDown' || e.code === 'Tab') { setRow(f => Math.min(ofProject && !workIn ? 4 : 3, f + 1)); return true; }
      if (e.code === 'ArrowUp') { setRow(f => { const n = Math.max(0, f - 1); if (n === 0) setTimeout(() => area.current?.focus()); return n; }); return true; }
      if (fila <= 3 && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        const fr = filas[fila - 1]; const k = fr.valores.findIndex(v => v.valor === fr.actual); const n = (k + (e.code === 'ArrowRight' ? 1 : -1) + fr.valores.length) % fr.valores.length; fr.poner(fr.valores[n].valor); SFX.tick(); return true;
      }
      if (fila === 4 && (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'Space')) { setWorktree(w => !w); SFX.conmutar(); return true; }
      if (e.code === 'Enter') { enviar(); return true; }
      return true;
    }
    return true;
  }), [fila, texto, modelo, esfuerzo, permisos, worktree, !!workIn, ofProject, p.adjuntos]);
  const dictado = useDictation({ area, texto, setText, onSend: enviar });
  const [encima, soltar] = useDrop(f => adjuntar(h.id, p.id, f));
  return (
    <div className={'pantalla-consola fosforo formulario' + (encima ? ' soltando' : '')} {...soltar}>
      {reanudar && (
        <div className="transcripcion-previa">
          <p className="voz">{t('windows.resumingTituloCuando', { titulo: reanudar.titulo, cuando: hace(reanudar.modified) })}</p>
          <div className="lista-desplazable mini">{transcripcion === null ? <p className="tenue">{t('windows.loading')}</p> : transcripcion.slice(-12).map(e => <Entrada key={e.id} e={e} />)}</div>
        </div>
      )}
      <p className="voz">{reanudar ? t('windows.whatDoIDoWith') : t('windows.whatNeedsDoing')}</p>
      {/* la caja de texto ocupa la mitad superior; las opciones, la inferior */}
      <div className="formulario-escribir">
        <div className={'linea-entrada' + (fila === 0 ? ' activa' : '')}>
          <span className="prompt-sim">&gt;</span>
          <textarea ref={area} value={texto} rows={3} readOnly={dictado.activo} placeholder={reanudar ? t('windows.optionalAddAnInstructionOr') : t('windows.describeTheJobAsIn')}
            onFocus={() => setRow(0)}
            onChange={e => { setText(e.target.value); }}
            onPaste={e => { if (e.clipboardData?.files.length) { e.preventDefault(); adjuntar(h.id, p.id, e.clipboardData.files); } }}
            onKeyDown={e => {
              physicsKey(e.nativeEvent);
              if (dictado.tecla(e)) return;
              if (attachShortcut(e)) { e.preventDefault(); chooseFiles(f => adjuntar(h.id, p.id, f)); return; }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
              else if (e.key === 'Escape') { e.preventDefault(); atras(); }
              else if (e.key === 'Tab' || (e.key === 'ArrowDown' && !texto.includes('\n'))) { e.preventDefault(); setRow(1); area.current?.blur(); }
            }} />
          <InputButtons adjuntar={() => chooseFiles(f => adjuntar(h.id, p.id, f))} dictado={dictado} />
        </div>
        <AttachmentsTray lista={p.adjuntos} quitar={removeAttachment(h.id, p.id)} />
        <DictationStrip dictado={dictado} />
      </div>
      <div className="formulario-opciones">
        {filas.map((fr, k) => (
          <div key={fr.nombre} className={'fila-chips' + (fila === k + 1 ? ' activa' : '')} onClick={() => setRow(k + 1)}>
            <span className="etq">{fr.nombre}</span>
            {fr.valores.map(v => <button key={v.valor} className={'chip' + (v.valor === fr.actual ? ' on' : '')} onClick={() => fr.poner(v.valor)} title={(v as any).pista ?? ''}>{v.texto}</button>)}
          </div>
        ))}
        {workIn ? <div className="fila-chips"><span className="etq">Worktree</span><span className="chip on">{t('windows.insideTheCopyRama', { rama: workIn.rama })}</span></div> :
        // un worktree solo tiene sentido en una sala de proyecto (las demás trabajan en su carpeta)
        ofProject && <div className={'fila-chips' + (fila === 4 ? ' activa' : '')} onClick={() => setRow(4)}>
          <span className="etq">Worktree</span>
          <button className={'chip' + (!worktree ? ' on' : '')} onClick={() => setWorktree(false)}>{t('windows.inTheMainCopy')}</button>
          <button className={'chip' + (worktree ? ' on' : '')} onClick={() => setWorktree(true)}>{t('windows.inASeparateWorktree')}</button>
        </div>}
        {error && <p className="aviso-consola">{error}</p>}
        <p className="ayuda-consola"><kbd>Enter</kbd> {t('windows.start')} <kbd>⇧ Enter</kbd> {t('windows.newLine')} <kbd>{CMD}D</kbd> {t('windows.dictate2')} <kbd>{CMD}U</kbd> {t('windows.attach2')} <kbd>Tab</kbd> {t('windows.options')} <kbd>←→</kbd> {t('menu.select')} <kbd>Esc</kbd> {esc.armado ? <span className="urgente">{t('windows.againGoBackAndDelete')}</span> : t('windows.back2')}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- conversación viva
function Entrada({ e }: { e: LogInput }) {
  if (e.tipo === 'asistente' || e.tipo === 'lateral') return <div className={'ent ' + e.tipo} dangerouslySetInnerHTML={{ __html: markdown(e.texto) }} />;
  if (e.tipo === 'usuario') return <div className="ent usuario"><span className="quien">{t('windows.you')}&gt;</span> <span dangerouslySetInnerHTML={{ __html: markdown(e.texto) }} />{e.adjuntos?.length ? <SentAttachments lista={e.adjuntos} /> : null}</div>;
  if (e.tipo === 'herramienta') return <div className={'ent herramienta' + (e.esError ? ' error' : '') + (e.ayudante ? ' de-ayudante' : '')}>{e.ayudante ? '  ⚙ ' : '⚙ '}<span><ToolText t={e.texto} /></span>{e.detalle && <pre className="detalle-err">{e.detalle}</pre>}</div>;
  if (e.tipo === 'error') return <div className="ent error" dangerouslySetInnerHTML={{ __html: markdown(e.texto) }} />;
  return <div className={'ent ' + e.tipo}>{e.texto}</div>;
}

function Session({ h, s, p, salir, onClose }: { h: DwellerSummary; s: SessionSummary; p: TabCom; salir: () => void; onClose: () => void }) {
  const entradas = vivo.usar(e => e.entradas[s.id]) ?? [];
  const parcial = vivo.usar(e => e.parcial[s.id]) ?? '';
  const [texto, setText0] = useState(p.borrador ?? '');
  const setText = (t: string | ((x: string) => string)) => setText0(x => { const n = typeof t === 'function' ? tIs(x) : t; setTab(h.id, p.id, { borrador: n }); return n; });
  const [comandos, setCommands] = useState<Command[]>([]);
  const [selCmd, setSelCmd] = useState(0);
  const lienzo = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const pegado = useRef(true);
  const workingLive = s.estado === 'trabajando' || s.estado === 'arrancando';
  // al verla, la respuesta queda leída
  useEffect(() => { if (s.sinLeer && (s.estado === 'terminada' || s.estado === 'error')) cliente.enviar({ t: 'leida', sesionId: s.id }); }, [s.sinLeer, s.estado]);
  useEffect(() => { loadLog(s.id); }, [s.id]);
  useEffect(() => { const el = lienzo.current; if (el && pegado.current) el.scrollTop = el.scrollHeight; }, [entradas.length, parcial, s.pending?.id]);
  useEffect(() => { if (!s.pending) area.current?.focus(); }, [s.pending?.id]);
  useEffect(() => { if (texto.startsWith('/') && !comandos.length) cliente.ask<Command[]>({ t: 'comandos', sesionId: s.id }).then(c => setCommands(c?.length ? c : COMMANDS_BASE)).catch(() => setCommands(COMMANDS_BASE)); }, [texto]);
  const sugerencias = texto.startsWith('/') && !texto.includes(' ') ? [...OWN_COMMANDS, ...comandos].filter(c => c.nombre.toLowerCase().startsWith(texto.slice(1).toLowerCase())).slice(0, 8) : [];
  const desplazar = (d: number) => { const el = lienzo.current; if (el) { el.scrollTop += d * el.clientHeight * 0.8; pegado.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4; } };
  const interrumpir = () => { cliente.enviar({ t: 'interrumpir', sesionId: s.id }); SFX.clic(); };
  const enviar = (bruto = texto) => {
    const t = bruto.trim();
    if (subiendo(p.adjuntos)) { SFX.noAllowed(); return; }
    const rutas = listsPaths(p.adjuntos);
    if (!t && !rutas.length) return;
    if (rutas.length && (!t || !t.startsWith('/'))) { cliente.enviar({ t: 'enviar', sesionId: s.id, texto: t, adjuntos: rutas }); setTab(h.id, p.id, { adjuntos: undefined }); }
    else if (t === '/stop' || t === '/parar') cliente.enviar({ t: 'interrumpir', sesionId: s.id });
    else if (t.startsWith('/btw ')) cliente.enviar({ t: 'lateral', sesionId: s.id, pregunta: t.slice(5) });
    else if (t === '/cuaderno') window.dispatchEvent(new CustomEvent('refugio:cuaderno', { detail: { sesionId: s.id } }));
    else if (t === '/cerrar') { setText(''); onClose(); return; }
    else cliente.enviar({ t: 'enviar', sesionId: s.id, texto: t });
    setText(''); pegado.current = true; SFX.shortSuccess();
  };
  useEffect(() => teclado.escuchar(e => {
    if ((e.ctrlKey && (e.code === 'ArrowUp' || e.code === 'KeyW')) || e.code === 'PageUp') { desplazar(-1); return true; }
    if ((e.ctrlKey && (e.code === 'ArrowDown' || e.code === 'KeyS')) || e.code === 'PageDown') { desplazar(1); return true; }
    if (e.ctrlKey && e.code === 'KeyC') { interrumpir(); return true; }
    if (e.code === 'Escape') { salir(); return true; }
    // escribir sin estar en el campo lleva a él; ⌘, Ctrl, ⌥ o una tecla sola (⌘ de ⌘C) no: el foco se llevaría la
    // selección de la conversación y no habría nada que copiar
    if (!s.pending && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace')) { area.current?.focus(); return false; }
    return false;
  }), [s.pending?.id]);
  const dictado = useDictation({ area, texto, setText, onSend: enviar });
  const esc = useEscDouble();
  const [encima, soltar] = useDrop(f => adjuntar(h.id, p.id, f));
  const lineState = s.estado === 'arrancando' ? t('windows.gettingReady') : s.actividad ? s.actividad.texto : workingLive && s.segundoPlano ? t('windows.waitingNInBackground', { n: s.segundoPlano }) : workingLive ? t('windows.thinking') : '';
  const ayudantes = s.ayudantes.filter(a => a.estado === 'trabajando').length;
  return (
    <div className={'pantalla-consola fosforo sesion' + (encima ? ' soltando' : '')} {...soltar}>
      <div className="titulo-sesion">{s.titulo}{s.worktree ? <span className="tenue"> · worktree</span> : null}</div>
      <div className="lienzo" ref={lienzo} onScroll={e => { const el = e.currentTarget; pegado.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4; }}>
        {(s.pending ? entradas.filter((e, i) => !(e.tipo === 'sistema' && e.texto.startsWith('❓')) && !(e.tipo === 'herramienta' && i >= entradas.length - 3)) : entradas).map(e => <Entrada key={e.id} e={e} />)}
        {parcial && workingLive && <div className="ent asistente parcial" dangerouslySetInnerHTML={{ __html: markdown(parcial) + '<span class="cursor-escribe">▌</span>' }} />}
        {s.pending && <Pending s={s} p={s.pending} tab={p} hid={h.id} salir={salir} />}
        {s.estado === 'error' && s.error && <div className="ent error">⚠ {s.error}</div>}
      </div>
      {!s.pending && <div className="linea-estado">
        {workingLive ? <span className="girando">◐</span> : s.estado === 'esperando' ? <span className="urgente">?</span> : s.estado === 'terminada' ? <span>✓</span> : <span>·</span>}
        <span className="txt"><ToolText t={lineState || (s.estado === 'terminada' || s.estado === 'ociosa' ? t('windows.doneYouCanReplyOpen') : '')} /></span>
        {ayudantes > 0 && <span className="tenue"> · {ayudantes > 1 ? t('windows.nHelpers', { n: ayudantes }) : t('windows.nHelper', { n: ayudantes })}</span>}
        {s.lateral && !s.lateral.respuesta && <span className="tenue"> · {t('windows.sideQuestion')}</span>}
        <Usage s={s} />
        <span className="modo">{PERMISSION_MODES.find(m => m.valor === s.modoPermisos)?.texto ?? s.modoPermisos}</span>
      </div>}
      {!s.pending && (
        <div className="linea-entrada activa">
          {sugerencias.length > 0 && <ul className="sugerencias">{sugerencias.map((c, k) => <li key={c.nombre} className={k === selCmd ? 'activa' : ''} onMouseDown={ev => { ev.preventDefault(); setText('/' + c.nombre + ' '); }}><b>/{c.nombre}</b> <span>{c.descripcion}</span></li>)}</ul>}
          <span className="prompt-sim">&gt;</span>
          <textarea ref={area} value={texto} rows={2} readOnly={dictado.activo} placeholder={workingLive ? t('windows.addSomethingWhileItWorks') : t('windows.replyDictateWithDOr')}
            onChange={e => { setText(e.target.value); setSelCmd(0); }}
            onPaste={e => { if (e.clipboardData?.files.length) { e.preventDefault(); adjuntar(h.id, p.id, e.clipboardData.files); } }}
            onKeyDown={e => {
              physicsKey(e.nativeEvent);
              if (dictado.tecla(e)) return;
              if (attachShortcut(e)) { e.preventDefault(); chooseFiles(f => adjuntar(h.id, p.id, f)); return; }
              if (sugerencias.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setSelCmd(k => (k + (e.key === 'ArrowDown' ? 1 : -1) + sugerencias.length) % sugerencias.length); return; }
              if (sugerencias.length && e.key === 'Tab') { e.preventDefault(); setText('/' + sugerencias[selCmd].nombre + ' '); return; }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (sugerencias.length && texto.trim() === texto && !texto.includes(' ')) setText('/' + sugerencias[selCmd].nombre + ' '); else enviar(); return; }
              if (e.key === 'Escape') { e.preventDefault(); if (texto) esc.pulsar(true, () => setText('')); else salir(); return; }
              if ((e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'w')) || e.key === 'PageUp') { e.preventDefault(); desplazar(-1); return; }
              if ((e.ctrlKey && (e.key === 'ArrowDown' || e.key === 's')) || e.key === 'PageDown') { e.preventDefault(); desplazar(1); return; }
              if (e.key === 'c' && e.ctrlKey && !texto) { e.preventDefault(); interrumpir(); return; }
            }} />
          <InputButtons adjuntar={() => chooseFiles(f => adjuntar(h.id, p.id, f))} dictado={dictado} />
        </div>
      )}
      {!s.pending && <AttachmentsTray lista={p.adjuntos} quitar={removeAttachment(h.id, p.id)} />}
      {!s.pending && <DictationStrip dictado={dictado} />}
      <p className="ayuda-consola"><kbd>Enter</kbd> {t('windows.send')} <kbd>{CMD}D</kbd> {t('windows.dictate2')} <kbd>{CMD}U</kbd> {t('windows.attach2')} <kbd>Ctrl C</kbd> {t('windows.stop')} <kbd>Esc</kbd> {esc.armado ? <span className="urgente">{t('windows.againDeleteWhatYouWrote')}</span> : texto ? t('windows.twiceDeleteWhatYouWrote') : t('windows.backToTheShelterKeeps')} <kbd>{CMD}T</kbd> {t('windows.anotherJob')} <kbd>{CMD}↑↓</kbd> {t('windows.expandMinimize')}</p>
    </div>
  );
}

// soltar archivos en cualquier parte de la conversación los adjunta (y no deja que la ventana navegue al archivo)
function useDrop(alSoltar: (f: FileList) => void) {
  const [encima, setAbove] = useState(false);
  const withFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  return [encima, {
    onDragOver: (e: React.DragEvent) => { if (!withFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!encima) setAbove(true); },
    onDragLeave: (e: React.DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setAbove(false); },
    onDrop: (e: React.DragEvent) => { if (!withFiles(e)) return; e.preventDefault(); setAbove(false); alSoltar(e.dataTransfer.files); },
  }] as const;
}

const OWN_COMMANDS: Command[] = [
  { nombre: 'btw', descripcion: t('windows.sideQuestionWithoutInterruptingThe'), pista: t('windows.question') },
  { nombre: 'stop', descripcion: t('windows.stopWhatItIsDoing') },
  { nombre: 'cuaderno', descripcion: t('windows.openTheConversationNotebookR') },
  { nombre: 'cerrar', descripcion: t('windows.closeThisConversationItStays') },
];
const COMMANDS_BASE: Command[] = [
  { nombre: 'compact', descripcion: t('windows.compactTheConversation') }, { nombre: 'context', descripcion: t('windows.contextUsage') },
  { nombre: 'model', descripcion: t('windows.changeModel') }, { nombre: 'effort', descripcion: t('windows.changeEffort') }, { nombre: 'clear', descripcion: t('windows.startFromScratch') },
];

// ---------------------------------------------------------------- permisos, preguntas y planes
function Pending({ s, p, tab, hid, salir }: { s: SessionSummary; p: PendingRequest; tab: TabCom; hid: string; salir: () => void }) {
  // lo que se está escribiendo (el porqué de un no, otra respuesta) se guarda en la pestaña: minimizar no lo pierde
  const [motivo, setReason0] = useState<string | null>(tab.motivo?.peticion === p.id ? tab.motivo.texto : null);
  const setReason = (t: string | null) => { setReason0(t); setTab(hid, tab.id, { motivo: t === null ? undefined : { peticion: p.id, texto: t } }); };
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [pq, setPq] = useState(0);
  const responder = (decision: 'si' | 'siempre' | 'no', mensaje?: string, answer?: Record<string, string>) => { cliente.enviar({ t: 'responder', sesionId: s.id, peticionId: p.id, decision, mensaje, responses: answer }); SFX.clic(); };
  let items: { texto: React.ReactNode; pista?: React.ReactNode; peligro?: boolean; clase?: string; f: () => void }[] = [];
  const preg = p.tipo === 'pregunta' ? p.preguntas?.[pq] : undefined;
  if (p.tipo === 'permiso') items = [
    { texto: t('windows.yes'), f: () => responder('si') },
    ...(p.canAlways ? [{ texto: t('windows.yesAndDonTAsk'), f: () => responder('siempre') }] : []),
    { texto: t('windows.noAndILlTell'), peligro: true, f: () => setReason('') },
  ];
  else if (p.tipo === 'confianza') items = [
    { texto: t('windows.yesLoadItThisTime'), f: () => responder('si') },
    { texto: t('windows.yesAndDonTAsk2'), f: () => responder('siempre') },
    { texto: t('windows.noWorkWithoutIt'), peligro: true, f: () => responder('no') },
  ];
  else if (p.tipo === 'plan') items = [
    { texto: t('windows.approveThePlan'), pista: t('windows.willAskPermissionToEdit'), f: () => responder('si') },
    { texto: t('windows.approveAndLetItEdit'), f: () => responder('siempre') },
    { texto: t('windows.keepPlanningILlTell'), peligro: true, f: () => setReason('') },
  ];
  else if (preg) items = [
    // las respuestas de una pregunta pueden ser largas o llevar enlaces: enteras, en varias líneas (clase «larga»)
    ...preg.options.map(o => ({ texto: o.label, pista: o.description ? <span dangerouslySetInnerHTML={{ __html: markdownLine(o.description) }} /> : undefined, clase: 'larga', f: () => { const r = { ...responses, [preg.question]: o.label }; setResponses(r); if (pq + 1 < (p.preguntas?.length ?? 0)) setPq(pq + 1); else responder('si', undefined, r); } })),
    { texto: t('windows.somethingElse'), f: () => setReason('') },
    { texto: t('windows.skipTheQuestion'), peligro: true, f: () => responder('no', 'El usuario ha preferido no responder.') },
  ];
  // aquí ← no es «atrás» (la petición sigue esperando): Esc vuelve al refugio y la deja pendiente
  const [i, setI] = useMenuBase(items.length, k => items[k]?.f(), e => motivo !== null && e.code !== 'Escape' ? false : undefined, salir);
  return (
    <div className={'peticion ' + p.tipo}>
      <div className="peticion-titulo">{p.ofHelper ? t('windows.aHelperNombreAsks', { nombre: p.ofHelper }) : ''}{preg ? null : p.titulo}</div>
      {/* la pregunta es prosa de Claude: en markdown (enlaces que se abren, listas), con su propio scroll si es muy larga */}
      {preg && <div className="peticion-pregunta" dangerouslySetInnerHTML={{ __html: markdown(preg.question) }} />}
      {/* lo que pide una herramienta, siempre en texto plano (textoPlano.tsx); el plan, que es prosa, en markdown */}
      {(p.tipo === 'permiso' || p.tipo === 'confianza') && (p.entrada?.length || p.motivo) ? <RequestView blocks={p.entrada ?? []} motivo={p.motivo} /> : null}
      {p.tipo === 'plan' && p.detalle && <div className="peticion-detalle" dangerouslySetInnerHTML={{ __html: markdown(p.detalle) }} />}
      {motivo === null ? <Opciones items={items} i={i} setI={setI} onChoose={k => items[k]?.f()} /> : (
        <div className="linea-entrada activa">
          <span className="prompt-sim">&gt;</span>
          <textarea autoFocus rows={2} value={motivo} placeholder={p.tipo === 'pregunta' ? t('windows.yourAnswer') : t('windows.tellItWhyOrEnter')} onChange={e => setReason(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (p.tipo === 'pregunta' && preg) { const r = { ...responses, [preg.question]: motivo }; if (pq + 1 < (p.preguntas?.length ?? 0)) { setResponses(r); setPq(pq + 1); setReason(null); } else responder('si', undefined, r); } else responder('no', motivo); }
              if (e.key === 'Escape') { e.preventDefault(); setReason(null); }
              e.stopPropagation();
            }} />
        </div>
      )}
    </div>
  );
}
