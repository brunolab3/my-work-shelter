// Intercomunicador del refugio: hablar con un habitante es una sesión REAL de Claude Code en la carpeta de su sala.
// Es una ventana como las terminales (windows.tsx): una por habitante, con pestañas, y cada conversación (cada
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
//   rama y sus cambios, y las conversaciones de dentro del worktree (copies.ts). Si un trabajo del habitante se muda a
//   un worktree, su pestaña pasa a la ventana de la copia, y si se estaba viendo, se sigue con la copia.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SessionSummary, LogInput, ToolOutput, HistoryElement, Command, PendingRequest, Visitor, QueuedMessage } from '@shared/protocol';
import { originLabel, queuedIn, withdrawable } from '@shared/messageQueue';
import { flaggedIds, flagOf, flaggedInIntercom, tabFlaggable, type Flaggable } from '@shared/flagged';
import { MODELS, EFFORTS, PERMISSION_MODES } from '@shared/protocol';
import { t, tIs, trBio } from '@shared/language';
import { juego, type DwellerSummary } from './gameState';
import { live, client, loadLog, loadOlder, trimLog, addNotice } from '../net/client';
import { scrollAfterPrepend } from '@shared/logPages';
import { markdown, markdownLine } from './markdown';
import { RequestView, ToolText } from './plainText';
import { keyboard } from '../engine/keyboard';
import { SFX } from '../audio/sound';
import { physicsKey } from '../audio/keyboard';
import { Store } from './store';
import { useMenu as useMenuBase, Options } from './device';
import { CMD, MAC, nextZ, windowShortcut, WindowButtons, Tabs, TabList, DraftMark, FlagMark, FLAG_SHORTCUT, TaskMark, Confirmation, nthTab, nextTab, PILOT, stateLabel, type ItemTab, type TabState } from './windows';
import { sessionOwner, interlocutor, branchCaption, copyCaption, copyTask, pathWorktree, worktreesKnown } from './copies';
import { Usage, tokensShort } from './usage';
import { takeASurface, toClaudeApp } from './surface';
import { openLink, openPage, pageForSession, pageAnswers, pageNotes, validatePage, revealPage, makeRoomForIntercom, answerPage, carryPageAnswers } from './Browsers';
import { sessionPages, pendingPages, samePage, livePages, questionInput } from '@shared/sessionPages';
import { directionMark, scheduledSender } from './scheduledSender';
import { AFTER_TURN, byPlace, describeWhen, describeWhenShort, localInput, ofConversationView, ofPlace, scheduledDirection, schedulePresets, type ScheduledMessage } from '@shared/scheduled';
import type { PRBoard } from '@shared/board';
import { worktreePRs, taskColor } from '@shared/tasks';
import { lookOf, lookSignature } from '@shared/appearance';
import { thumbnail } from '../world/figure/studio';
import { openPreflight } from './Preflight';
import { taskHasPRs } from '@shared/preflight';
import { recentFirst } from '@shared/recent';
import { groupTabs, talkerFirst } from './tabOrder';
import { byRoomOrder, moveRoom, roomOrderOf } from '@shared/roomOrder';
import { jiraBoard, knowTasks, myPRs, useColorsTasks } from './tasks';
import { type AttachmentLocal, uploadFiles, chooseFiles, uploading, listsPaths, AttachmentsTray, SentAttachments, useDictation, InputButtons, DictationStrip, attachShortcut } from './inputLine';

import { syncIntercoms, dropLeft, savedIntercoms, restoredIntercoms, readyAttachments, withText, unused, type InView, type View, type TabCom, type WindowCom } from './intercomSync';
export { withText, type WindowCom };
export const intercoms = new Store<{ list: WindowCom[] }>({ list: [] });

const PREFERENCES = 'shelter.work';
function prefs() { try { return JSON.parse(localStorage.getItem(PREFERENCES) || '{}'); } catch { return {}; } }

// ---------------------------------------------------------------- ventanas y pestañas
let nTab = 0;
const newId = () => 'p' + (++nTab);
/** When a tab was opened, across intercoms: ids count up */
const created = (id: string) => Number(id.slice(1));

// ---------------------------------------------------------------- lo escrito no se pierde
// Las pestañas y lo que el Supervisor tiene escrito en ellas (texto y adjuntos ya subidos) se guardan en la página y
// sobreviven a una recarga («Aplicar los cambios del juego»), a un reinicio del servidor y a que la conversación se
// cierre sin que él la cierre (sola, al reiniciar, desde fuera): entonces la pestaña se queda, lista para retomar la
// conversación (Enter), con lo escrito si lo había. Las pestañas se quedan hasta que él las cierra (Esc dos veces o
// cerrando la pestaña tras confirmarlo, si hay algo escrito).
// Tabs with nothing in them and no conversation are not kept: they go once he leaves them (dropLeft), and a reload
// doesn't bring them back.
const SAVED = 'shelter.intercoms';
/** Writes the intercoms to the page's storage now (also before the memory watchdog reloads: memoryReload.ts) */
export function saveIntercoms() {
  try { localStorage.setItem(SAVED, JSON.stringify(savedIntercoms(intercoms.get().list))); } catch {}
}
function restoreIntercoms(): WindowCom[] {
  try { return restoredIntercoms(JSON.parse(localStorage.getItem(SAVED) || '[]'), newId, nextZ); } catch { return []; }
}
if (typeof window !== 'undefined') {
  intercoms.set({ list: restoreIntercoms() });
  let t: ReturnType<typeof setTimeout> | undefined;
  intercoms.subscribe(() => { clearTimeout(t); t = setTimeout(saveIntercoms, 250); });
  addEventListener('pagehide', saveIntercoms); addEventListener('beforeunload', saveIntercoms);
}
// Al servidor, las conversaciones que se están viendo o tienen algo escrito: esas no se cierran solas (media hora
// quietas) mientras el Supervisor las lee o contesta
let useSignature = '';
function notifyInUse() {
  const talking = juego.get().talkingWith, ids = new Set<string>();
  for (const v of intercoms.get().list) for (const p of v.tabs) if (p.view.type === 'session' && (withText(p) || (v.dwellerId === talking && p.id === v.active))) ids.add(p.view.sessionId);
  const f = [...ids].sort().join('|'); if (f === useSignature) return;
  useSignature = f; client.send({ t: 'inUse', sessions: [...ids] });
}
const liveSessions = (hid: string) => Object.values(live.get().sessions).filter(s => sessionOwner(s) === hid && s.state !== 'closed' && !closingSessions.has(s.id));
const closingSessions = new Set<string>();   // sesiones que se han mandado cerrar (no vuelven a abrir pestaña)
const inRunning = (s?: SessionSummary) => !!s && (s.state === 'starting' || s.state === 'working' || s.state === 'waiting');
/** A talker's place among those with something for you: waiting first, then marked as pending, then by urgency */
const reviewRank = (q: Talker) => q.state === 'waiting' ? 0 : q.flagged ? 1 : 2 + (q.first ? urgency(q.first) : 5);
const urgency = (s: SessionSummary) => s.state === 'waiting' ? 0 : s.state === 'error' ? 1 : s.state === 'finished' && s.unread ? 2 : inRunning(s) ? 3 : 4;
/** Its state on the tabs (windows.tsx): unread is not the same as read */
const tabState = (s?: SessionSummary): TabState | undefined => !s ? undefined : s.state === 'waiting' ? 'waiting' : s.state === 'error' ? 'error' : s.state === 'finished' && s.unread ? 'unread' : inRunning(s) ? 'working' : 'idle';
export const sessionPilot = (s?: SessionSummary) => !s ? 'idle' : s.state === 'waiting' ? 'waiting' : s.state === 'error' ? 'error' : inRunning(s) ? 'working' : 'idle';
const sessionOf = (p: TabCom) => (p.view.type === 'session' ? live.get().sessions[p.view.sessionId] : undefined);

const win = (hid: string) => intercoms.get().list.find(v => v.dwellerId === hid);
/** La conversación de la pestaña a la vista en el intercomunicador abierto (para el buscador). */
export function sessionInView(): SessionSummary | undefined {
  const hid = juego.get().talkingWith, v = hid ? win(hid) : undefined, p = v?.tabs.find(x => x.id === v.active);
  const s = p && sessionOf(p);
  return s && s.state !== 'closed' ? s : undefined;
}
function update(hid: string, f: Partial<WindowCom> | ((v: WindowCom) => Partial<WindowCom>)) {
  intercoms.set(e => ({ list: e.list.map(v => (v.dwellerId === hid ? { ...v, ...(typeof f === 'function' ? f(v) : f) } : v)) }));
}
function setTab(hid: string, pid: string, p: Partial<TabCom>) { update(hid, v => ({ tabs: v.tabs.map(x => (x.id === pid ? { ...x, ...p } : x)) })); }

// Dónde sale: si ya se veía otro intercomunicador, como estaba ese (ampliado o a la derecha); si no (venía del refugio o
// de la barra), siempre a la derecha, sin ampliar: no se recuerda que estuvo ampliado. Lo que esté ampliado delante
// (una página, un navegador) deja sitio (makeRoomForIntercom)
let shownWith: string | null = null;
function openIntercom(hid: string) {
  const before = shownWith && shownWith !== hid ? win(shownWith) : undefined, maximized = !!before?.maximized;
  shownWith = hid;
  if (win(hid)) update(hid, { maximized: maximized });
  if (!maximized) makeRoomForIntercom();
  openIntercomWindow(hid, maximized);
  const v = win(hid), p = v?.tabs.find(x => x.id === v.active);
  pageForSession(p && sessionOf(p)?.id);
}
// al hablar con un habitante: su ventana, con una pestaña por cada trabajo suyo (la más urgente delante)
function openIntercomWindow(hid: string, maximized: boolean) {
  let v = win(hid);
  if (!v) {
    const sess = liveSessions(hid).sort((a, b) => a.created - b.created);
    const tabs: TabCom[] = sess.length ? sess.map(s => ({ id: newId(), view: { type: 'session', sessionId: s.id } })) : [{ id: newId(), view: { type: juego.get().workIn ? 'new' : 'menu' } }];
    const first = [...sess].sort((a, b) => urgency(a) - urgency(b) || b.updated - a.updated)[0];
    v = { dwellerId: hid, tabs, active: tabs[first ? sess.indexOf(first) : 0].id, maximized: maximized, z: nextZ(), known: sess.map(s => s.id) };
    intercoms.set(e => ({ list: [...e.list, v!] }));
    // una copia holográfica sin conversación abierta retoma por defecto la última de su worktree (si sigue en el menú)
    if (!sess.length && !juego.get().workIn) resumeLastOfCopy(hid, tabs[0].id);
    if (!sess.length) return;
  } else update(hid, { z: nextZ() });
  // «trabajar dentro de la copia» (worktree) llega con el worktree elegido: pestaña de trabajo nuevo
  if (juego.get().workIn) newTab(hid, { type: 'new' });
}
function resumeLastOfCopy(hid: string, pid: string) {
  const c = interlocutor(hid);
  if (!c?.copy) return;
  client.ask<HistoryElement[]>({ t: 'history', roomId: c.room, cwd: c.copy.path }).then(list => {
    const last = list.filter(x => !x.outside).sort((a, b) => b.modified - a.modified)[0];
    if (!last) return;
    const p = win(hid)?.tabs.find(x => x.id === pid);
    if (p?.view.type === 'menu') setTab(hid, pid, { view: { type: 'new', resume: last } });
  }).catch(() => {});
}
function newTab(hid: string, view: View = { type: 'menu' }) {
  const id = newId();
  update(hid, v => ({ tabs: [...v.tabs, { id, view }], active: id }));
  SFX.open();
}
function activate(hid: string, pid: string) {
  update(hid, { active: pid }); SFX.tick();
  const p = win(hid)?.tabs.find(x => x.id === pid);
  pageForSession(p && sessionOf(p)?.id);   // la ventana «Página», con la de esta conversación (o fuera)
}
function goView(hid: string, pid: string, view: View) { setTab(hid, pid, { view, draft: undefined, attachments: undefined }); }
// los adjuntos que esperan en la pestaña (se suben solos: la pestaña puede minimizarse mientras tanto)
function changeAttachments(hid: string, pid: string, f: (l: AttachmentLocal[]) => AttachmentLocal[]) { update(hid, v => ({ tabs: v.tabs.map(x => (x.id === pid ? { ...x, attachments: f(x.attachments ?? []) } : x)) })); }
function attach(hid: string, pid: string, files: FileList | File[] | null | undefined) {
  if (!files?.length) return;
  uploadFiles(files, a => changeAttachments(hid, pid, l => [...l, a]), (id, c) => changeAttachments(hid, pid, l => l.map(x => (x.id === id ? { ...x, ...c } : x))));
  SFX.tick();
}
const removeAttachment = (hid: string, pid: string) => (id: string) => { changeAttachments(hid, pid, l => l.filter(x => x.id !== id)); SFX.click(); };

// volver al refugio sin cerrar nada: la ventana queda en la barra
export function minimizeIntercom() {
  if (!juego.get().talkingWith) return;
  SFX.close(); juego.set({ talkingWith: null, workIn: null }); window.dispatchEvent(new CustomEvent('shelter:dialog-end'));
}
// Esc arriba del todo: con trabajos (o algo escrito), minimizar; sin ellos no queda nada que guardar y se cierra
function exit(hid: string) {
  const v = win(hid);
  if (v?.tabs.some(p => sessionOf(p) || withText(p))) minimizeIntercom();
  else { intercoms.set(e => ({ list: e.list.filter(x => x.dwellerId !== hid) })); minimizeIntercom(); }
}
// desde la barra: se vuelve con el habitante (viaje rápido) y la ventana aparece como estaba
export function restoreIntercom(hid: string) {
  const h = interlocutor(hid); if (!h) return;
  window.dispatchEvent(new CustomEvent('shelter:go', { detail: { roomId: h.room, dwellerId: hid, talk: true } }));
}
// Desde el buscador (⌘K): una conversación abierta, en su pestaña y con su habitante a la vista
export function openConversation(sessionId: string) {
  const s = live.get().sessions[sessionId]; if (!s || s.state === 'closed') return;
  const hid = sessionOwner(s);
  sync();   // la ventana y la pestaña de cada trabajo vivo existen siempre
  const v = win(hid);
  const t = v?.tabs.find(p => p.view.type === 'session' && p.view.sessionId === sessionId);
  if (v && t) update(hid, { active: t.id, z: nextZ() });
  else if (v) newTab(hid, { type: 'session', sessionId });
  restoreIntercom(hid);
}
// …o una del archivo: si sigue viva, a ella; si no, a una pestaña para retomarla (Enter y sigue)
export function resumeConversation(hid: string, el: HistoryElement) {
  const alive = Object.values(live.get().sessions).find(x => x.claudeId === el.claudeId && x.state !== 'closed');
  if (alive) { openConversation(alive.id); return; }
  if (win(hid)) newTab(hid, { type: 'new', resume: el });
  else {
    // la ventana nueva lleva también los trabajos vivos del habitante, pero delante la que se retoma
    const sess = liveSessions(hid).sort((a, b) => a.created - b.created), id = newId();
    const tabs: TabCom[] = [...sess.map(x => ({ id: newId(), view: { type: 'session' as const, sessionId: x.id } })), { id, view: { type: 'new', resume: el } }];
    intercoms.set(e => ({ list: [...e.list, { dwellerId: hid, tabs, active: id, maximized: false, z: nextZ(), known: sess.map(x => x.id) }] }));
  }
  restoreIntercom(hid);
}
// El visitante de una sala (sus sesiones abiertas fuera del refugio): al intercomunicador de su habitante, con la lista
// de esas sesiones (la más reciente arriba); cada una se retoma ahí (la de un worktree pasa sola a su holograma)
export function claimVisitors(roomId: string) {
  const dwellers = juego.get().dwellers.filter(h => h.room === roomId);
  const h = dwellers.find(x => x.state === 'idle' || x.state === 'sleeping' || x.state === 'finished') ?? dwellers[0];
  if (!h) { SFX.notAllowed(); return; }
  const v = win(h.id), already = v?.tabs.find(x => x.view.type === 'visitors');
  if (already) update(h.id, { active: already.id });
  else if (v) newTab(h.id, { type: 'visitors' });
  else {
    const sess = liveSessions(h.id).sort((a, b) => a.created - b.created), id = newId();
    const tabs: TabCom[] = [...sess.map(x => ({ id: newId(), view: { type: 'session' as const, sessionId: x.id } })), { id, view: { type: 'visitors' } }];
    intercoms.set(e => ({ list: [...e.list, { dwellerId: h.id, tabs, active: id, maximized: false, z: nextZ(), known: sess.map(x => x.id) }] }));
  }
  restoreIntercom(h.id);
}
// retomar en esta pestaña una conversación del archivo, sin pasar por «trabajo nuevo» (la del visitante, ya confirmada)
function resumeHere(h: DwellerSummary, pid: string, el: HistoryElement) {
  const hid = h.id;
  setTab(hid, pid, { sessionWait: true });
  client.ask<string>({ t: 'start', dwellerId: h.copy?.authorId ?? hid, roomId: h.room, prompt: '', options: { resume: el.claudeId, cwd: el.cwd } })
    .then(sessionId => {
      update(hid, v => ({ known: [...v.known, sessionId], tabs: v.tabs.filter(x => x.id === pid || !(x.view.type === 'session' && x.view.sessionId === sessionId)).map(x => (x.id === pid ? { ...x, sessionWait: false, view: { type: 'session', sessionId } } : x)) }));
      sync();
    })
    .catch(() => { SFX.error(); setTab(hid, pid, { sessionWait: false, view: { type: 'new', resume: el } }); });
  SFX.shortSuccess();
}
function toggleMaximize(hid: string) { update(hid, v => ({ maximized: !v.maximized })); SFX.click(); }
// cerrar termina las conversaciones de esas pestañas (quedan en el archivo); si alguna trabaja o espera, o tiene
// algo escrito sin enviar (que se borraría), se pregunta
export function askClose(hid: string, ids?: string[]) {
  const v = win(hid); if (!v) return;
  const which = ids ?? v.tabs.map(p => p.id);
  if (v.tabs.some(p => which.includes(p.id) && (inRunning(sessionOf(p)) || withText(p)))) { update(hid, { confirm: which }); SFX.lowNotice(); return; }
  closeAlready(hid, which);
}
function closeAlready(hid: string, ids: string[]) {
  const v = win(hid); if (!v) return;
  for (const p of v.tabs) if (ids.includes(p.id)) { const s = sessionOf(p); if (s) { closingSessions.add(s.id); client.send({ t: 'closeSession', sessionId: s.id }); } }
  const rest = v.tabs.filter(p => !ids.includes(p.id));
  SFX.close();
  if (!rest.length) { intercoms.set(e => ({ list: e.list.filter(x => x.dwellerId !== hid) })); if (juego.get().talkingWith === hid) minimizeIntercom(); return; }
  const i = v.tabs.findIndex(p => p.id === v.active);
  update(hid, { tabs: rest, confirm: undefined, active: rest.some(p => p.id === v.active) ? v.active : rest[Math.min(i, rest.length - 1)].id });
}

// a la superficie: la conversación de esa pestaña sigue en tu escritorio; la pestaña se va sola cuando se cierra aquí
function takeTab(hid: string, pid: string) {
  const p = win(hid)?.tabs.find(x => x.id === pid);
  const s = p && sessionOf(p);
  if (!s) { SFX.notAllowed(); return; }
  takeASurface({ sessions: [s.id] });
}

// Each live conversation has its tab, and one that starts by itself never takes the one in view (intercomSync.ts).
// Only with this connection's session list: before the welcome (on page load) or offline, the one there is not valid
// and tabs still alive would be removed.
let onDay = false;
function sync() {
  if (!onDay) return;
  const list = intercoms.get().list;
  const { next, handoff } = syncIntercoms({ list, sessions: live.get().sessions, owner: s => sessionOwner(s), closing: closingSessions, talking: juego.get().talkingWith, newId, nextZ });
  if (next !== list) intercoms.set({ list: next });
  if (handoff) setTimeout(() => restoreIntercom(handoff));
}
live.subscribe(() => { if (!live.get().connected) onDay = false; sync(); });
client.listen(m => { if (m.t === 'welcome') { onDay = true; useSignature = ''; sync(); notifyInUse(); } });
intercoms.subscribe(notifyInUse); juego.subscribe(notifyInUse);
// a tab with nothing in it and no conversation goes once the Overseer leaves it (for another tab or out of the intercom)
const inView = (): InView => { const talking = juego.get().talkingWith; return { talking, active: talking ? win(talking)?.active : undefined }; };
let seen = inView();
function dropLeftTabs() {
  const before = seen; seen = inView();
  const list = intercoms.get().list, next = dropLeft(list, before, seen);
  if (next !== list) intercoms.set({ list: next });
}
intercoms.subscribe(dropLeftTabs); juego.subscribe(dropLeftTabs);
// las copias aparecen (y se van) con el mundo: entonces cambia de quién son algunas conversaciones
let copiesSignature = '';
juego.subscribe(() => { const f = juego.get().copies.map(c => c.id).join('|'); if (f !== copiesSignature) { copiesSignature = f; sync(); } });

// ---------------------------------------------------------------- interfaz
export function Dialog() {
  const id = juego.use(e => e.talkingWith);
  const h = juego.use(e => interlocutor(e.talkingWith, e));
  const v = intercoms.use(e => e.list.find(x => x.dwellerId === id));
  useEffect(() => { if (id) openIntercom(id); else shownWith = null; }, [id]);
  if (!id || !h || !v) return null;
  return <Console key={id} h={h} v={v} />;
}

// A small bust of a talker for the who selector: dwellers in their own colors, holograms in their author's tinted with
// their task's color (cyan without one), as their projector shows them. Photos are kept by look, so reopening is instant
const busts = new Map<string, string>();
function TalkerBust({ x }: { x: DwellerSummary }) {
  useColorsTasks();
  const card = (live.use(e => e.state?.dwellers) as any[] | undefined)?.find(f => f.id === (x.copy?.authorId ?? x.id));
  const look = card && card.type !== 'Octocat' ? lookOf(card) : null;
  const key = look ? lookSignature(look) : '';
  const [url, setUrl] = useState(() => busts.get(key));
  useEffect(() => {
    if (!look) return;
    const already = busts.get(key); setUrl(already); if (already) return;
    let valid = true;
    thumbnail(look, 'torso').then(u => { if (u) busts.set(key, u); if (valid && u) setUrl(u); });
    return () => { valid = false; };
  }, [key]);
  const task = x.copy ? copyTask(x.copy) : undefined;
  useEffect(() => { if (task) knowTasks([task]); }, [task]);
  const tone = x.copy ? taskColor(task) : undefined;
  return <span className={'console-who-photo' + (x.copy ? ' holo' : '')} style={tone ? { '--tone': tone } as React.CSSProperties : undefined} aria-hidden>{url && <img src={url} alt="" draggable={false} />}</span>;
}

// The room's talkers (its dwellers, robot-looking ones too, and its worktrees' holographic copies; by state, then most recent conversation first
// (talkerFirst), those without one last, dwellers before holograms), each with its intercom panel's open conversations
// and the most urgent one: the selector above the portrait and the bar's hover lists (Bar.tsx) show one row each, with
// its most urgent conversation's state and when the latest of them last moved, and how many of them are marked as pending
// (⚑, flags: shared/flagged.ts); the conversations themselves are the tabs
/** A talker as the lists name them: a dweller by name, a hologram by its task (or branch) and its author */
const talkerName = (x: DwellerSummary) => x.copy ? `◇ ${copyCaption(x.copy, copyTask(x.copy) ?? branchCaption(x.copy.branch))} · ${x.copy.nameAuthor}` : x.name;
export type Talker = { x: DwellerSummary; sess: SessionSummary[]; first?: SessionSummary; state?: TabState; name: string; draft: boolean; flagged: number };
export function roomTalkers(room: string, dwellers: DwellerSummary[], copies: DwellerSummary[], list: WindowCom[], sessions: Record<string, SessionSummary>, flags: Set<string>): Talker[] {
  return [...dwellers.filter(x => x.room === room), ...copies.filter(c => c.room === room)].map(x => {
    const tabs = list.find(w => w.dwellerId === x.id)?.tabs ?? [];
    const sess = tabs.map(p => p.view.type === 'session' ? sessions[p.view.sessionId] : undefined).filter(Boolean) as SessionSummary[];
    const first = [...sess].sort((a, b) => urgency(a) - urgency(b) || b.updated - a.updated)[0];
    const name = talkerName(x);
    return { x, sess, first, state: tabState(first), name, draft: tabs.some(withText), flagged: flaggedInIntercom(tabs, sessions, flags) };
  }).map(q => ({ q, r: { state: q.state, when: Math.max(0, ...q.sess.map(s => s.updated)), name: q.name, id: q.x.id } }))
    .sort((a, b) => talkerFirst(a.r, b.r))
    .map(y => y.q);
}
export function TalkerRow({ q, current, sel, option, onClick, onMouseEnter }: { q: Talker; current: boolean; sel?: boolean; option?: boolean; onClick: () => void; onMouseEnter?: () => void }) {
  // under the name: the most urgent conversation's title, how many more are open and a hologram's uncommitted changes
  // (the title is the one cut short)
  const parts = [q.first && (q.first.title || t('windows.conversation')), q.sess.length > 1 && t('windows.plusNConversations', { n: q.sess.length - 1 }),
    q.x.copy?.changes && t('windows.nChanges', { n: q.x.copy.changes })].filter(Boolean) as string[];
  const detail = parts.join(' · ');
  return (
    <button role={option ? 'option' : undefined} aria-selected={option ? current : undefined} onClick={onClick} onMouseEnter={onMouseEnter} title={detail ? `${q.name}\n${detail}` : q.name}
      className={'bar-peek-row' + (q.x.copy ? ' of-copy' : '') + (current ? ' current' : '') + (sel ? ' sel' : '') + (q.state === 'waiting' ? ' urgent' : q.flagged ? ' pending' : '') + (q.state === 'unread' ? ' unread' : '') + (q.state ? ' e-' + q.state : '')}>
      <span className={'pilot ' + (q.state ? PILOT[q.state] : 'off')} />
      <TalkerBust x={q.x} />
      <span className="peek-bar-body">
        <span className="peek-bar-title">{q.draft && <DraftMark />}<b>{q.name}</b>{q.flagged ? <> <FlagMark on n={q.flagged > 1 ? q.flagged : undefined} /></> : null}</span>
        {detail && <small className="peek-bar-detail">{parts.map((x, i) => <span key={i}>{x}</span>)}</small>}
      </span>
      <span className="peek-bar-state">{q.state ? stateLabel(q.state) : t('windows.noSession')}</span>
      <small className="peek-bar-when">{q.sess.length ? ago(Math.max(...q.sess.map(s => s.updated))) : ''}</small>
    </button>
  );
}

// Above the portrait, by the tabs: whom else to talk to in the room (its dwellers and its worktrees' holographic copies),
// shown even when the room's own dweller is its only talker (Planning, with no holograms), so it always opens on a row.
// Closed, a chip like the bar's, lit by the most urgent conversation of who you talk to; open, one row per talker as the
// bar's hover list (TalkerRow). Picking one brings their intercom to the front on their most urgent conversation; their
// tabs stay in their own strip and in the bar's ⋯ N list (ComTabs)
/** The width the list has from the chip to the intercom's right edge (the intercom clips what goes past it) */
const room = (el: HTMLElement | null) => el ? (el.closest('.console') ?? document.body).getBoundingClientRect().right - el.getBoundingClientRect().left - 12 : 400;
function WhoSelector({ h }: { h: DwellerSummary }) {
  const dwellers = juego.use(e => e.dwellers), copies = juego.use(e => e.copies);
  const list = intercoms.use(e => e.list);
  const sessions = live.use(e => e.sessions);
  const flags = useFlags();
  const [open, setOpen] = useState(false);
  // the row the keyboard or the pointer is on, by talker (the list re-sorts as states change); none: the open one
  const [selId, setSelId] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('pointerdown', outside, true); return () => removeEventListener('pointerdown', outside, true);
  }, [open]);
  const talkers = roomTalkers(h.room, dwellers, copies, list, sessions, flags);
  if (!talkers.length) return null;
  const me = talkers.find(q => q.x.id === h.id) ?? talkers[0];
  const sel = Math.max(0, talkers.findIndex(q => q.x.id === (selId ?? me.x.id)));
  // the others with something for you (waiting, unread, failed or marked as pending), most urgent first, pending after
  // waiting: the chip says so while closed, in the colour of the first
  const toReview = talkers.filter(q => q !== me && (q.state === 'waiting' || q.state === 'unread' || q.state === 'error' || q.flagged))
    .sort((a, b) => reviewRank(a) - reviewRank(b));
  const tone = (q: Talker | undefined) => q?.state === 'waiting' ? ' urgent' : q?.flagged ? ' pending' : '';
  // and, quieter, the others with something typed and not sent
  const drafts = talkers.filter(q => q !== me && q.draft);
  const pick = (q: Talker) => {
    setOpen(false);
    if (q === me) return;
    const pid = q.first && list.find(w => w.dwellerId === q.x.id)?.tabs.find(p => p.view.type === 'session' && p.view.sessionId === q.first!.id)?.id;
    if (pid) goTab(pid); else restoreIntercom(q.x.id);
  };
  const openTarget = () => { setSelId(null); setOpen(x => !x); };
  const key = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSelId(talkers[(sel + (e.key === 'ArrowDown' ? 1 : -1) + talkers.length) % talkers.length].x.id); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(talkers[sel]); }
  };
  return (
    <div className="console-who" ref={box} onKeyDown={key}>
      <button className={'chip-terminal front' + (h.copy ? ' of-copy' : '') + (tone(me) === ' urgent' ? tone(me) : tone(toReview[0]) || tone(me))} aria-haspopup="listbox" aria-expanded={open}
        title={[t('windows.talkToSomeoneElse'), toReview.length ? t('windows.othersToReview', { n: toReview.length }) + ': ' + toReview.map(q => q.name).join(', ') : '', drafts.length ? t('windows.othersWithDraft', { n: drafts.length }) + ': ' + drafts.map(q => q.name).join(', ') : ''].filter(Boolean).join('\n')} onClick={openTarget}>
        <span className={'pilot ' + (me.state ? PILOT[me.state] : 'off')} aria-hidden />
        <TalkerBust x={me.x} />
        <span className="console-who-name">{me.name}</span>
        {toReview.length > 0 && <span className={'console-who-notice ' + (toReview[0].state === 'waiting' || !toReview[0].flagged ? 'e-' + toReview[0].state : 'pending')} aria-label={t('windows.othersToReview', { n: toReview.length })}>+{toReview.length}</span>}
        {drafts.length > 0 && <span className="mark-draft" aria-label={t('windows.othersWithDraft', { n: drafts.length })}>✎</span>}
        <span className="type">▾</span>
      </button>
      {/* the list steps aside while a close is being confirmed */}
      {open && !list.some(w => w.confirm) && (
        <div className="peek-bar console-who-list" role="listbox" aria-label={t('windows.talkToSomeoneElse')}
          style={{ '--gap': `${room(box.current)}px` } as React.CSSProperties}>
          {talkers.map(q => <TalkerRow key={q.x.id} q={q} current={q === me} sel={talkers[sel] === q} option onClick={() => pick(q)} onMouseEnter={() => setSelId(q.x.id)} />)}
        </div>
      )}
    </div>
  );
}

const VIEW_NAME: Record<string, string> = { menu: t('windows.menu'), new: t('windows.newJob'), history: t('windows.archive'), card: t('windows.profile'), visitors: t('world.visitors') };
/** A tab of `o`'s intercom as the strip and the list show it; flags: the conversations marked as pending */
function tabItem(x: TabCom, o: DwellerSummary, sessions: Record<string, SessionSummary>, flags: Set<string>): ItemTab {
  const sx = x.view.type === 'session' ? sessions[x.view.sessionId] : undefined, path = pathWorktree(sx?.cwd, worktreesKnown());
  return { id: x.id, name: sx ? sx.title || t('windows.conversation') : x.sessionWait ? t('windows.starting2') : VIEW_NAME[x.view.type] ?? t('windows.menu'), state: x.sessionWait ? 'working' : tabState(sx),
    title: sx?.title, room: o.nameRoom, roomId: o.room, task: path ? copyTask(worktreesKnown().find(w => w.path === path) ?? { path }) : o.copy ? copyTask(o.copy) : undefined, activity: sx ? ago(sx.updated) : undefined, draft: withText(x), queued: queuedIn([sx]) || undefined,
    flagged: flagOf(tabFlaggable(x, sessions), flags) };
}
/** The rooms' order in the intercom lists (shared/roomOrder.ts), repainting when it changes */
export const useRoomOrder = () => roomOrderOf(live.use(e => e.state?.settings));
/** The conversations marked as pending (shared/flagged.ts), repainting when they change */
export const useFlags = () => flaggedIds(live.use(e => e.state?.settings));
/** ⚑ Mark a conversation as pending, or clear it: only the Overseer does (sending to it doesn't) */
function toggleFlag(s: Flaggable | undefined) {
  const on = flagOf(s, flaggedIds(live.get().state?.settings));
  if (on === undefined) { SFX.notAllowed(); return; }
  SFX.tick();
  client.action('conversation.pending', { claudeId: s!.claudeId, on: !on }).catch(e => { SFX.error(); addNotice('error', (e as Error).message); });
}
/** The conversation of a tab, open or closed (shown, or about to be resumed), for its ⚑ */
const tabConversation = (pid: string): Flaggable | undefined => { const p = intercoms.get().list.flatMap(w => w.tabs).find(x => x.id === pid); return tabFlaggable(p, live.get().sessions); };

// The ⋯ N button at the end of the bar's COM row (Bar.tsx; ⌘⇧A from an intercom): every open conversation of every
// intercom, by room, to filter, go to one (switching to its intercom) and close. Other intercoms' menus stay out.
export const comList = new Store<{ open: boolean }>({ open: false });
const LIST_SHORTCUT = `${CMD}${MAC ? '⇧' : ''}A`;
export function ComTabs() {
  const list = intercoms.use(e => e.list);
  const sessions = live.use(e => e.sessions);
  const talking = juego.use(e => e.talkingWith);
  const who = juego.use(e => (id: string) => interlocutor(id, e));
  const open = comList.use(e => e.open);
  const flags = useFlags();
  const button = useRef<HTMLButtonElement>(null);
  const current = list.find(w => w.dwellerId === talking);
  const order = useRoomOrder();
  // by room, in the order the Overseer arranged them (new rooms after, where their first-opened tab is), and in it by
  // whose they are (its dweller, each hologram), each where its first-opened tab is
  const items = byRoomOrder(groupTabs(groupTabs(list.flatMap(w => {
    const o = who(w.dwellerId); if (!o) return [];
    return w.tabs.filter(x => w === current || x.view.type === 'session' || x.sessionWait).map((x): ItemTab => ({ ...tabItem(x, o, sessions, flags),
      group: o.id, who: talkerName(o) }));
  }).sort((a, b) => created(a.id) - created(b.id))), x => x.roomId ?? ''), x => x.roomId ?? '', order);
  // dragging a room's header (or ⇧↑↓ on it) moves the whole room; the drop goes to the room whose rows are under the pointer
  const [drag, setDrag] = useState<{ room: string; over?: string } | null>(null);
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (!refocus.current) return;
    document.querySelector<HTMLElement>(`.bar-list-com .vt-list-group[data-room="${CSS.escape(refocus.current)}"]`)?.focus(); refocus.current = null;
  });
  if (items.length < 2) return null;
  const shown = [...new Set(items.map(p => p.roomId ?? ''))];
  const move = (room: string, target: string | undefined) => {
    if (!target || target === room) return;
    SFX.tick();
    client.action('com.roomOrder', { order: moveRoom(order, shown, room, target) }).catch(e => { SFX.error(); addNotice('error', (e as Error).message); });
  };
  const roomUnder = (y: number) => [...document.querySelectorAll<HTMLElement>('.bar-list-com .vt-list-group[data-room]')]
    .filter(el => el.getBoundingClientRect().top <= y).at(-1)?.dataset.room;
  const exit = () => comList.set({ open: false });
  const go = (pid: string) => { exit(); goTab(pid); };
  // above the bar, from its left edge
  const r = open ? button.current?.closest('.bar-windows')?.getBoundingClientRect() : undefined;
  return <>
    <button ref={button} className={'vt-all' + (open ? ' active' : '')} onClick={() => comList.set(e => ({ open: !e.open }))} title={t('windows.allConversations', { n: items.length, shortcut: LIST_SHORTCUT })}>⋯ {items.length} <FlagMark n={items.filter(p => p.flagged).length} /></button>
    {/* the list steps aside while a close is being confirmed */}
    {open && r && !list.some(w => w.confirm) && createPortal(
      <div className="bar-list-com" style={{ left: r.left, bottom: innerHeight - r.top + 4, '--gap': `${innerWidth - r.left - 8}px` } as React.CSSProperties}
        onDragOver={e => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const over = roomUnder(e.clientY); if (over !== drag.over) setDrag({ ...drag, over }); }}
        onDrop={e => { if (!drag) return; e.preventDefault(); move(drag.room, roomUnder(e.clientY)); setDrag(null); }}>
        <TabList items={items} group active={current?.active ?? ''} activate={go} close={closeTabs} exit={exit} flag={pid => toggleFlag(tabConversation(pid))} header={(p, before) => {
          // the room once, then whose: their bust and name, a hologram's task in its color
          const o = who(p.group!), task = o?.copy ? copyTask(o.copy) : undefined;
          return <>
            {p.roomId !== before?.roomId && <div className={'vt-list-group movable' + (drag?.room === p.roomId ? ' dragging' : drag?.over === p.roomId && drag?.room !== p.roomId ? ' drop-target' : '')}
              data-room={p.roomId} tabIndex={0} draggable title={t('windows.moveRoom')}
              onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.room ?? ''); setDrag({ room: p.roomId! }); }}
              onDragEnd={() => setDrag(null)}
              onKeyDown={e => {
                const step = !e.shiftKey ? 0 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0;
                if (!step) return;
                e.preventDefault(); e.stopPropagation(); refocus.current = p.roomId!;
                move(p.roomId!, shown[shown.indexOf(p.roomId!) + step]);
              }}>{p.room}</div>}
            {o && <div className={'vt-list-who' + (o.copy ? ' of-copy' : '') + (o.id === talking ? ' current' : '')}><TalkerBust x={o} /><b>{p.who}</b>{task && <TaskMark taskKey={task} />}</div>}
          </>;
        }} />
      </div>, document.body)}
  </>;
}
/** Go to an intercom tab: its intercom comes to the front (if another was) on that tab */
function goTab(pid: string) {
  const d = intercoms.get().list.find(w => w.tabs.some(p => p.id === pid))?.dwellerId; if (!d) return;
  if (d === juego.get().talkingWith) { activate(d, pid); return; }
  update(d, { active: pid, z: nextZ() }); SFX.tick(); restoreIntercom(d);
}
/** Close tabs of several intercoms: each asks about its own; if another one than the one in front has to ask, it switches to it */
function closeTabs(pids: string[]) {
  const hid = juego.get().talkingWith;
  let other: string | undefined;
  for (const w of intercoms.get().list) {
    const ids = w.tabs.filter(p => pids.includes(p.id)).map(p => p.id); if (!ids.length) continue;
    askClose(w.dwellerId, ids);
    if (w.dwellerId !== hid && win(w.dwellerId)?.confirm) other ??= w.dwellerId;
  }
  if (other && !(hid && win(hid)?.confirm)) { update(other, { active: win(other)!.confirm![0] }); restoreIntercom(other); }
}

function Console({ h, v }: { h: DwellerSummary; v: WindowCom }) {
  const sessions = live.use(e => e.sessions);
  const connected = live.use(e => e.connected);
  const claudeOk = live.use(e => e.claudeOk);
  const repo = live.use(e => e.repos[h.room]);
  const copy = h.copy;
  const p = v.tabs.find(x => x.id === v.active) ?? v.tabs[0];
  const s = p?.view.type === 'session' ? sessions[p.view.sessionId] : undefined;
  const hid = h.id;
  // the strip holds this intercom's own conversations, in the order they were opened; the others' are reached from the
  // selector and the bar, whose ⋯ N lists them all (ComTabs)
  const flags = useFlags();
  const items = v.tabs.map(x => tabItem(x, h, sessions, flags));
  const orden = useRef(items); orden.current = items;
  useEffect(() => { keyboard.blocked = true; return () => { keyboard.blocked = false; }; }, []);
  // al abrirse, el teclado es suyo: si estaba en una terminal, se suelta
  useEffect(() => { const a = document.activeElement as HTMLElement | null; if (a?.closest?.('.window-terminal')) a.blur(); }, []);
  // atajos de ventana, también escribiendo (antes que nadie; las terminales, el cliente de git y los archivos llevan los suyos)
  const ref = useRef(v); ref.current = v;
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('.window-terminal, .window-git')) return;
      const w = ref.current;
      windowShortcut(e, {
        maximized: w.maximized, newTab: () => newTab(hid), closeTab: () => askClose(hid, [w.active]), closeWindow: () => askClose(hid),
        minimize: minimizeIntercom, toggleMaximize: () => toggleMaximize(hid), list: () => comList.set(e => ({ open: !e.open })),
        moveTab: d => { const x = nextTab(orden.current, w.active, d); if (x) activate(hid, x); },
        goTab: n => { const x = nthTab(orden.current, n); if (x) activate(hid, x); },
        takeOut: () => takeTab(hid, w.active),
        flag: () => toggleFlag(tabConversation(w.active)),
      });
    };
    addEventListener('keydown', f, true); return () => removeEventListener('keydown', f, true);
  }, [hid]);

  if (!p) return null;
  const go = (view: View) => goView(hid, p.id, view);
  const onMenu = () => go({ type: 'menu' });
  const view = p.view.type === 'session' && !s ? { type: 'menu' as const } : p.view;
  // the conversation in view, open or closed: its summary, or the one being resumed
  const conversation: Flaggable | undefined = s ?? (view.type === 'new' && view.resume ? { claudeId: view.resume.claudeId } : undefined);
  const high = v.maximized || view.type === 'session' || view.type === 'new' || view.type === 'history' || view.type === 'visitors';
  const worst = v.tabs.map(sessionOf).filter(Boolean).sort((a, b) => urgency(a!) - urgency(b!))[0];
  const confirming = v.confirm ? v.tabs.filter(x => v.confirm!.includes(x.id)).map(sessionOf).filter(inRunning) as SessionSummary[] : [];
  const written = v.confirm ? v.tabs.filter(x => v.confirm!.includes(x.id) && withText(x)).length : 0;
  const writtenNotice = written ? (written > 1 ? t('windows.youHaveUnsentTextIn', { n: written }) : v.confirm!.length > 1 ? t('windows.youHaveUnsentTextIn2') : t('windows.youHaveUnsentText')) : '';
  return (
    <div className={'console interactive' + (high ? ' high' : '') + (v.maximized ? ' maximized' : '') + (copy ? ' of-copy' : '')} role="dialog" aria-label={t('windows.talkToName', { name: h.name })}>
      <div className="console-bevel">
        <div className="console-head" onDoubleClick={e => { if (!(e.target as HTMLElement).closest('button')) toggleMaximize(hid); }}>
          <span className="grid" aria-hidden />
          <span className={'pilot ' + (worst?.state ?? 'off')} aria-hidden />
          <span className="console-label">{copy ? <>{t('windows.intercom')} · {t('windows.holographicCopyOfAuthor', { author: copy.nameAuthor })} · {copyCaption(copy)} · {h.nameRoom}</> : <>{t('windows.intercom')} · {h.name} · {h.nameRoom}</>}</span>
          <WindowButtons flag={flagOf(s, flags) === undefined ? undefined : { on: !!flagOf(s, flags), toggle: () => toggleFlag(s) }} takeOut={s ? () => takeTab(hid, p.id) : undefined} wingApp={s ? () => toClaudeApp({ sessionId: s.id }) : undefined} remote={s ? () => takeASurface({ sessions: [s.id], remote: true }) : undefined} takesThat={t('windows.thisConversation')} maximized={v.maximized} minimize={minimizeIntercom} toggleMaximize={() => toggleMaximize(hid)} close={() => askClose(hid)} closesThat={t('windows.theIntercomAndItsConversations')} />
        </div>
        <Tabs items={items} confirming={!!v.confirm} active={v.active} activate={pid => activate(hid, pid)} close={pids => askClose(hid, pids)} onNew={() => newTab(hid)} opensThat={copy ? t('windows.newTabAnotherJobInside') : t('windows.newTabAnotherJobWith')} />
        <div className="console-body">
          <aside className="console-side">
            <WhoSelector h={h} />
            <div className={'portrait-crt' + (copy ? ' holo' : '')}><LivePortrait /></div>
            {copy ? <>
              <div className="console-name">{copy.nameAuthor} <span className="mark-copy">◇</span></div>
              <div className="console-nickname">{t('windows.holographicCopy')}</div>
              <StateChip s={s} />
              <div className="console-data">{t('windows.branch')} <b>{copy.branch || t('windows.noBranch')}</b></div>
              <div className="console-data">{copy.changes ? t('windows.nChanges', { n: copy.changes }) : t('windows.noChanges')}{copy.advanced ? ` · ${t('windows.nCommitsToMerge', { n: copy.advanced })}` : ''}</div>
            </> : <>
              <div className="console-name">{h.name}</div>
              <div className="console-nickname">«{tIs(h.nickname)}»</div>
              <StateChip s={s} />
              {repo?.branch && <div className="console-data">{t('windows.branch')} <b>{repo.branch}</b>{repo.changes ? ` · ${t('windows.nChanges', { n: repo.changes })}` : ''}</div>}
            </>}
            {s?.model && <div className="console-data">{s.model.replace('claude-', '')}</div>}
            {s && (s.context || s.tokens) ? <div className="console-data"><Usage s={s} length /></div> : null}
            {/* right under the dweller, by importance: pages to review, the ⚑ pending mark, the task's PRs and pre-flight, then the scheduled
                ones; each hidden with nothing, and the whole section with none (CSS `:has`) */}
            <div className="console-actions" role="group" aria-label={t('windows.actions')}>
              <div className="console-actions-title" aria-hidden>{t('windows.actions')}</div>
              {s ? <PagesMenu key={s.id} s={s} /> : view.type === 'new' && view.resume ? <ResumePages key={view.resume.claudeId} roomId={h.room} claudeId={view.resume.claudeId} /> : null}
              <FlagButton c={conversation} flags={flags} />
              {copy ? <WorktreePRs copy={copy} roomId={h.room} /> : null}
              {copy ? <PreflightButton copy={copy} /> : null}
              {/* with `key`: each conversation with its own list (nothing from the previous tab while its own arrives) */}
              <ScheduledMenu key={'p' + (s?.id ?? (view.type === 'new' ? view.resume?.claudeId : '') ?? '')} h={h} s={s} resume={view.type === 'new' ? view.resume?.claudeId : undefined} />
            </div>
          </aside>
          <div className="console-tab" key={p.id}>
            {!connected ? <WithoutConnection /> : !claudeOk ? <WithoutClaude /> :
              p.sessionWait ? <div className="screen-console phosphor"><p className="voice">{t('windows.startingTheJob')}</p></div> :
              view.type === 'menu' ? <Menu h={h} go={go} exit={() => exit(hid)} /> :
              view.type === 'new' ? <New h={h} p={p} resume={view.resume} goBack={onMenu} /> :
              view.type === 'visitors' ? <Visitors h={h} goBack={onMenu} resume={el => resumeHere(h, p.id, el)} /> :
              view.type === 'history' ? <HistoryView h={h} goBack={onMenu} pick={el => {
                const already = Object.values(live.get().sessions).find(x => x.claudeId === el.claudeId && x.state !== 'closed');
                if (already) { const t = v.tabs.find(x => x.view.type === 'session' && x.view.sessionId === already.id); if (t) activate(hid, t.id); else go({ type: 'session', sessionId: already.id }); }
                else if (el.inProgress) SFX.notAllowed();
                else go({ type: 'new', resume: el });
              }} /> :
              view.type === 'card' ? <Card h={h} goBack={onMenu} /> :
              s ? <Session h={h} s={s} p={p} exit={() => exit(hid)} onClose={() => { closingSessions.add(s.id); client.send({ t: 'closeSession', sessionId: s.id }); onMenu(); }} /> : null}
          </div>
        </div>
        {v.confirm && <Confirmation title={v.confirm.length > 1 ? t('windows.closeTheTabs') : confirming.length ? t('windows.closeThisConversation') : t('windows.closeThisTab')}
          text={confirming.length
            ? <>{copy ? t('windows.authorSCopy', { author: copy.nameAuthor }) : h.name} {t('windows.isWorkingOn')} {confirming.length > 1 ? t('windows.nJobs', { n: confirming.length }) : <>«{confirming[0]?.title ?? t('windows.aJob')}»</>}{confirming.some(x => x.state === 'waiting') ? ` ${t('windows.andIsWaitingForYou')}` : ''}. {t('windows.ifYouCloseItIt2')}{writtenNotice ? <> {writtenNotice}: {t('windows.wouldBeDeleted')}</> : null} {t('windows.toLetItCarryOn')}</>
            : <>{writtenNotice}. {t('windows.ifYouCloseItIt3')}</>}
          button={confirming.length ? undefined : t('windows.closeAndDeleteEnter')}
          close={() => closeAlready(hid, v.confirm!)} minimize={() => { update(hid, { confirm: undefined }); minimizeIntercom(); }} cancel={() => update(hid, { confirm: undefined })} />}
      </div>
    </div>
  );
}

// Monta el lienzo del retrato en vivo que prepara el mundo (busto del habitante con su animación actual)
function LivePortrait() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const c = (window as any).__portrait as HTMLCanvasElement | undefined; if (c && ref.current) ref.current.appendChild(c); }, []);
  return <div ref={ref} className="portrait-canvas" />;
}

function StateChip({ s }: { s?: SessionSummary }) {
  const st: Record<string, [string, string]> = { starting: [t('windows.starting'), 'work'], working: [t('windows.working'), 'work'], waiting: [t('windows.waitingForYou'), 'hold'], finished: [t('windows.finished'), 'end'], idle: [t('windows.ready'), 'end'], error: [t('windows.fault'), 'err'], closed: [t('windows.closed'), 'rest'] };
  if (!s) return <span className="chip-state rest">{t('windows.noSession')}</span>;
  const [txt, cls] = st[s.state] ?? [s.state, 'rest'];
  return <span className={'chip-state ' + cls}>{txt}</span>;
}

function WithoutConnection() {
  const attempts = live.use(e => e.attempts);
  return <div className="screen-console phosphor"><p className="notice-console">{t('windows.noLinkToTheShelter')}{'.'.repeat(1 + (attempts % 3))}</p><p className="dim">{t('windows.ifYouClosedItReopen')} <code>./shelter</code>.</p></div>;
}
function WithoutClaude() {
  return <div className="screen-console phosphor"><p className="notice-console">{t('windows.iCanTFindClaude')}</p><p>{t('windows.theDwellersWorkWithYour')} (<code>claude</code> {t('windows.inATerminalThen')} <code>/login</code>) {t('windows.andReopenTheShelter')}</p></div>;
}

// ---------------------------------------------------------------- menús con teclado: Esc (y ←) es «atrás»
const useMenu = (n: number, f: (i: number) => void, behind: () => void, extra?: (e: KeyboardEvent) => boolean | void) =>
  useMenuBase(n, f, e => { const x = extra?.(e); if (x !== undefined) return x; if (e.code === 'ArrowLeft' || e.code === 'Backspace') { behind(); return true; } return undefined; }, behind);

function Menu({ h, go, exit }: { h: DwellerSummary; go: (v: View) => void; exit: () => void }) {
  // trabajo y terminal van en la carpeta de trabajo de su sala (las especiales tienen una propia); los de una copia, en su worktree
  const folder = h.folder ?? h.path, copy = h.copy;
  const terminal = async () => {
    if (!copy) { window.dispatchEvent(new CustomEvent('shelter:terminal', { detail: { roomId: h.room } })); return; }
    const { openTerminalIn } = await import('./Terminals');
    openTerminalIn('wt:' + copy.path, h.room, `${h.nameRoom} · ${copy.branch}`, copy.path);
  };
  // revisar la copia (cambios, commits, integrar, desechar) es el aparato de la copia: el intercomunicador baja a la barra
  const toReview = () => { exit(); juego.set({ panel: 'worktree', panelData: { roomId: h.room, device: 'wt:' + copy!.path } }); };
  const options = [
    { text: copy ? t('windows.startANewJobInside') : t('windows.startANewJob'), hint: t('windows.inFolder', { folder: (folder ?? t('windows.theirRoom')).replace(/^\/Users\/[^/]+/, '~') }), f: () => go({ type: 'new' }) },
    { text: t('windows.resumeAPreviousJob'), hint: copy ? t('windows.fromThisWorktree') : t('windows.includingTerminalOnes'), f: () => go({ type: 'history' }) },
    ...(folder ? [{ text: copy ? t('windows.openATerminalInside') : t('windows.openTheirTerminal'), hint: 'T', f: terminal }] : []),
    ...(copy ? [{ text: t('windows.reviewTheCopyChangesCommits'), f: toReview }] : []),
    { text: t('windows.viewTheirProfile'), f: () => go({ type: 'card' }) },
    // su aspecto se cambia en el probador de Chapa y Pintura (la Octocat es como es)
    ...(!copy && h.type !== 'Octocat' ? [{ text: t('windows.changeTheirLook'), hint: t('world.bodyShop'), f: () => { exit(); juego.set({ panel: 'bodyshop', panelData: { who: h.id } }); } }] : []),
    { text: t('menu.backToTheShelter'), hint: 'Esc', f: exit },
  ];
  const items = options;
  const pick = (j: number) => options[j]?.f();
  const [i, setI] = useMenu(items.length, pick, exit, e => { if (e.code === 'KeyT' && folder) { terminal(); return true; } return undefined; });
  const greeting = useMemo(() => greetingOf(h), [h.id]);
  return (
    <div className="screen-console phosphor">
      <p className="voice">{greeting}</p>
      <Options items={items} i={i} setI={setI} onChoose={pick} />
      <p className="help-console"><kbd>↑↓</kbd> {t('menu.select')} <kbd>Enter</kbd> {t('menu.accept')} <kbd>Esc</kbd> {t('menu.backToTheShelter2')} <kbd>{CMD}T</kbd> {t('windows.anotherTab')}</p>
    </div>
  );
}

function greetingOf(h: DwellerSummary) {
  if (h.copy) {
    const r = branchCaption(h.copy.branch);
    const phrases = [t('windows.copyOfAuthorOnlineHere', { author: h.copy.nameAuthor, branch: r }), t('windows.iMAuthorSCopy', { author: h.copy.nameAuthor, branch: r }), h.copy.changes ? t('windows.projectionStableBranchWith', { branch: r, n: h.copy.changes }) : t('windows.projectionStableBranchShall', { branch: r })];
    return phrases[Math.floor(Math.random() * phrases.length)];
  }
  const phrases = h.robot
    ? [t('windows.unitReadyStateTheTask'), t('windows.diagnosticsCompleteAwaitingOrders'), t('windows.myCircuitsAreAtYour')]
    : h.state === 'sleeping' ? [t('windows.huhWhatOhOverseerI'), t('windows.fiveMoreMinutesOkayOkay')]
    : [t('windows.whatAreWeDoingToday'), t('windows.tellMeWhatSUp'), t('windows.hereIAmShallWe'), t('windows.allQuietInRoomFor', { room: h.nameRoom })];
  return phrases[Math.floor(Math.random() * phrases.length)];
}

function Card({ h, goBack }: { h: DwellerSummary; goBack: () => void }) {
  const repo = live.use(e => e.repos[h.room]);
  const [i, setI] = useMenu(1, () => goBack(), goBack);
  const c = h.copy;
  if (c) return (
    <div className="screen-console phosphor card">
      <dl>
        <dt>{t('windows.copyOf')}</dt><dd>{c.nameAuthor} «{tIs(c.nicknameAuthor)}»</dd>
        <dt>{t('windows.room')}</dt><dd>{h.nameRoom}</dd>
        <dt>Worktree</dt><dd><code>{c.path}</code></dd>
        <dt>{t('windows.branch2')}</dt><dd>{c.branch || t('windows.noBranch')} · {t('windows.nUncommittedChanges', { n: c.changes })} · {t('windows.nCommitsToMerge', { n: c.advanced })}</dd>
        <dt>{t('windows.status')}</dt><dd>{tIs(h.state)}{h.detail ? ' · ' + h.detail : ''}</dd>
        <dt>{t('windows.record')}</dt><dd>{trBio(h.bio)}</dd>
      </dl>
      <Options items={[{ text: t('windows.back'), hint: 'Esc' }]} i={i} setI={setI} onChoose={goBack} />
    </div>
  );
  return (
    <div className="screen-console phosphor card">
      <dl>
        <dt>{t('windows.name')}</dt><dd>{h.name} «{tIs(h.nickname)}»</dd>
        <dt>{t('windows.room')}</dt><dd>{h.nameRoom}{h.folder ?? h.path ? <> · <code>{h.folder ?? h.path}</code></> : null}</dd>
        {repo?.branch && <><dt>{t('windows.branch2')}</dt><dd>{repo.branch} · {t('windows.nUncommittedChanges', { n: repo.changes })}</dd></>}
        {repo?.lastCommit && <><dt>{t('windows.lastCommit')}</dt><dd>{repo.lastCommit.message} <span className="dim">({ago(repo.lastCommit.date)})</span></dd></>}
        <dt>{t('windows.status')}</dt><dd>{tIs(h.state)}{h.detail ? ' · ' + h.detail : ''}</dd>
        <dt>{t('windows.record')}</dt><dd>{trBio(h.bio)}</dd>
      </dl>
      <Options items={[{ text: t('windows.back'), hint: 'Esc' }]} i={i} setI={setI} onChoose={goBack} />
    </div>
  );
}

export function ago(when: number) {
  const m = Math.round((Date.now() - when) / 60000);
  if (m < 1) return t('windows.justNow'); if (m < 60) return t('windows.nMinAgo', { n: m }); const hh = Math.round(m / 60); if (hh < 48) return t('windows.nHAgo', { n: hh }); return t('windows.nDaysAgo', { n: Math.round(hh / 24) });
}

// ---------------------------------------------------------------- historial (conversaciones reales de la carpeta)
function HistoryView({ h, goBack, pick }: { h: DwellerSummary; goBack: () => void; pick: (el: HistoryElement) => void }) {
  const [list, setList] = useState<HistoryElement[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { client.ask<HistoryElement[]>({ t: 'history', roomId: h.room, cwd: h.copy?.path }).then(setList).catch(e => setError(e.message)); }, [h.room, h.copy?.path]);
  const flags = useFlags();
  const items = [...(list ?? []).map(el => ({ text: (flags.has(el.claudeId) ? t('windows.flag.mark') + ' ' : '') + (el.outside ? '↗ ' : '') + el.title, hint: `${ago(el.modified)}${el.branch ? ' · ' + el.branch : ''}${el.inProgress ? ` · ${t('windows.inProgress')}` : ''}${el.outside ? ` · ${t('windows.openOnYourDesktop')}` : ''}` })), { text: t('windows.back'), hint: 'Esc' }];
  // la que sigue abierta en tu escritorio no se retoma aquí a la vez (se corrompería): primero /exit allí o, si la
  // pestaña se cerró sin salir y el proceso sigue vivo, Enter otra vez la cierra a la fuerza y la retoma aquí
  const [force, setForce] = useState(-1);
  const onChoose = (k: number) => {
    if (!list || k >= list.length) return goBack();
    const el = list[k];
    if (!el.outside) return pick(el);
    if (force !== k) { SFX.notAllowed(); setForce(k); setError(t('windows.thatConversationIsStillOpen')); return; }
    setForce(-1); setError(t('windows.forcingClose'));
    client.action<number>('surface.forceClose', { claudeId: el.claudeId })
      .then(() => { setError(''); pick({ ...el, outside: false }); })
      .catch(e => { SFX.error(); setError((e as Error).message); });
  };
  const [i, setI] = useMenu(items.length, onChoose, goBack);
  return (
    <div className="screen-console phosphor">
      <p className="voice">{list === null ? t('windows.searchingTheArchive') : list.length ? (h.copy ? t('windows.thisIsWhatIsIn') : t('windows.thisIsWhatIsIn2')) : t('windows.thereAreNoPreviousConversations')}</p>
      {error && <p className="notice-console">{error}</p>}
      <div className="list-scrollable"><Options items={items} i={i} setI={setI} onChoose={onChoose} /></div>
      <p className="help-console"><kbd>↑↓</kbd> {t('menu.select')} <kbd>Enter</kbd> {t('windows.resume')} <kbd>Esc</kbd> <kbd>←</kbd> {t('windows.back2')}</p>
    </div>
  );
}

// ---------------------------------------------------------------- visitantes (sesiones de la sala abiertas fuera del refugio)
// Solo las de fuera, la más reciente arriba; los títulos y si siguen con `claude --resume` vienen del archivo de la sala y
// de cada worktree con visitas. Enter la retoma aquí (si sigue abierta con --resume, la cierra allí antes)
function Visitors({ h, goBack, resume }: { h: DwellerSummary; goBack: () => void; resume: (el: HistoryElement) => void }) {
  const visits = live.use(e => e.visitors.filter(v => v.roomId === h.room));
  const branches = live.use(e => e.repos[h.room]?.worktrees);
  const [file, setArchive] = useState<Map<string, HistoryElement> | null>(null);
  const [error, setError] = useState('');
  // la lista del último aviso del servidor puede ir hasta 15 s atrasada: se pide al momento y, hasta tenerla con sus
  // títulos, se enseña «cargando» (no media lista que luego crece)
  const [fresh, setFresh] = useState(false);
  useEffect(() => { client.action<Visitor[]>('visitors').then(v => live.set({ visitors: v })).catch(() => {}).finally(() => setFresh(true)); }, []);
  const dirs = [...new Set(visits.map(v => v.worktree ?? ''))].sort().join('|');
  useEffect(() => {
    if (!fresh) return;
    Promise.all(dirs.split('|').map(d => client.ask<HistoryElement[]>({ t: 'history', roomId: h.room, cwd: d || undefined }).catch(() => [])))
      .then(ls => setArchive(new Map(ls.flat().map(x => [x.claudeId, x]))));
  }, [h.room, dirs, fresh]);
  const list: HistoryElement[] = visits.map(v => {
    const x = file?.get(v.claudeId);
    return { claudeId: v.claudeId, title: x?.title || v.title, modified: v.modified, cwd: v.cwd, outside: x?.outside, branch: v.worktree ? branches?.find(w => w.path === v.worktree)?.branch || v.worktree.split('/').pop() : undefined };
  }).sort((a, b) => recentFirst({ when: a.modified, name: a.title, id: a.claudeId }, { when: b.modified, name: b.title, id: b.claudeId }));
  const items = [...list.map(el => ({ text: '↗ ' + el.title, hint: `${ago(el.modified)}${el.branch ? ' · ◇ ' + el.branch : ''}` })), { text: t('windows.back'), hint: 'Esc' }];
  const onChoose = (k: number) => {
    if (k >= list.length) return goBack();
    const el = list[k];
    if (!el.outside) return resume(el);
    setError(t('windows.forcingClose'));
    client.action<number>('surface.forceClose', { claudeId: el.claudeId }).then(() => resume({ ...el, outside: false })).catch(e => { SFX.error(); setError((e as Error).message); });
  };
  const [i, setI] = useMenu(items.length, onChoose, goBack);
  if (!file) return <div className="screen-console phosphor"><p className="voice">{t('windows.lookingForVisitors')}</p></div>;
  return (
    <div className="screen-console phosphor">
      <p className="voice">{list.length ? t('windows.visitorSessionsHere') : t('windows.noVisitorSessions')}</p>
      {error && <p className="notice-console">{error}</p>}
      <div className="list-scrollable"><Options items={items} i={i} setI={setI} onChoose={onChoose} /></div>
      <p className="help-console"><kbd>↑↓</kbd> {t('menu.select')} <kbd>Enter</kbd> {t('windows.resumeHere')} <kbd>Esc</kbd> <kbd>←</kbd> {t('windows.back2')}</p>
    </div>
  );
}

// Esc con algo escrito no lo borra a la primera (como en Claude Code): avisa y, si se repite enseguida, lo hace
function useEscDouble() {
  const [armed, setArmed] = useState(false);
  const ref = useRef(false); ref.current = armed;
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 1600); return () => clearTimeout(t); }, [armed]);
  return { armed, press: (hasText: boolean, action: () => void) => { if (!hasText || ref.current) { ref.current = false; setArmed(false); action(); } else { ref.current = true; setArmed(true); SFX.tick(); } } };
}

// ---------------------------------------------------------------- trabajo nuevo / retomar
function New({ h, p, resume, goBack }: { h: DwellerSummary; p: TabCom; resume?: HistoryElement; goBack: () => void }) {
  const p0 = prefs();
  const [text, setText0] = useState(p.draft ?? '');
  const setText = (t: string) => { setText0(t); setTab(h.id, p.id, { draft: t }); };
  const [model, setModel] = useState<string>(p0.model ?? '');
  const [effort, setEffort] = useState<string>(p0.effort ?? '');
  // los permisos no se recuerdan: cada conversación nueva empieza en automático (lo demás se elige para esa)
  const [permissions, setPermissions] = useState<string>('auto');
  // hablar con el habitante de la sala es trabajar en su copia principal: los worktrees son de las tareas (organizar la
  // sala por tareas, el reparto de Planificación) o de quien lo elija aquí. Las demás (Puente de Mando…) trabajan siempre
  // en su carpeta
  const ofProject = live.use(e => (e.state?.rooms ?? []).find((s: any) => s.id === h.room)?.type === 'repo');
  const [worktree, setWorktree] = useState(false);
  const workInGame = juego.use(e => e.workIn);
  // una copia trabaja siempre dentro de su worktree, como su autor
  const workIn = h.copy ? { cwd: h.copy.path, branch: h.copy.branch } : workInGame;
  const [row, setRow] = useState(0); // 0 texto, 1 modelo, 2 esfuerzo, 3 permisos, 4 worktree
  const [transcript, setTranscript] = useState<LogInput[] | null>(null);
  const [error, setError] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const esc = useEscDouble();
  const behind = () => esc.press(!!text.trim(), goBack);
  useEffect(() => { area.current?.focus(); }, []);
  useEffect(() => { if (resume) client.ask<LogInput[]>({ t: 'loadConversation', roomId: h.room, claudeId: resume.claudeId, limit: RESUME_PREVIEW }).then(setTranscript).catch(() => setTranscript([])); }, [resume?.claudeId]);
  const rows = [
    { name: t('windows.model'), values: MODELS, current: model, set: setModel },
    { name: t('windows.effort'), values: EFFORTS, current: effort, set: setEffort },
    { name: t('windows.permissions'), values: PERMISSION_MODES, current: permissions, set: setPermissions },
  ];
  // la pestaña espera a que el servidor diga qué sesión es la suya y pasa a la conversación
  const send = (txt = text) => {
    if (uploading(p.attachments)) { SFX.notAllowed(); setError(t('windows.waitForTheAttachmentsTo')); return; }
    const paths = listsPaths(p.attachments);
    if (!txt.trim() && !resume && !paths.length) { SFX.notAllowed(); return; }
    try { localStorage.setItem(PREFERENCES, JSON.stringify({ model, effort })); } catch {}
    setError('');
    const hid = h.id, pid = p.id;
    setTab(hid, pid, { sessionWait: true });
    const inside = h.copy ? workIn : juego.get().workIn;
    client.ask<string>({ t: 'start', dwellerId: h.copy?.authorId ?? hid, roomId: h.room, prompt: txt.trim(), attachments: paths, options: { model, effort, permissions, worktree: inside || !ofProject ? false : worktree, resume: resume?.claudeId, cwd: resume?.cwd ?? inside?.cwd } })
      .then(sessionId => {
        update(hid, v => ({ known: [...v.known, sessionId], tabs: v.tabs.filter(x => x.id === pid || !(x.view.type === 'session' && x.view.sessionId === sessionId)).map(x => (x.id === pid ? { ...x, sessionWait: false, draft: undefined, attachments: undefined, view: { type: 'session', sessionId } } : x)) }));
        sync();
      })
      .catch(e => { setTab(hid, pid, { sessionWait: false }); SFX.error(); setError((e as Error).message); });
    juego.set({ workIn: null });
    SFX.shortSuccess();
  };
  // ⌥Enter: background work for the day's final 5-hour window or, with `when` (⏰ Schedule), at that time (server/scheduled.ts),
  // to the conversation being resumed or a new one here
  const sendLater = (when?: string) => {
    if (!text.trim()) { SFX.notAllowed(); return; }
    if (p.attachments?.length) { SFX.notAllowed(); setError(t('windows.nextWindowNoAttachments')); return; }
    const inside = h.copy ? workIn : juego.get().workIn;
    if (!inside && !resume && ofProject && worktree) { SFX.notAllowed(); setError(t('windows.nextWindowNoWorktree')); return; }
    setError('');
    client.action<ScheduledMessage>('scheduled.window', { roomId: h.room, cwd: resume?.cwd ?? inside?.cwd, claudeId: resume?.claudeId, title: resume?.title, message: text, when })
      .then(x => { setText(''); SFX.shortSuccess(); addNotice('info', laterDone(x)); })
      .catch(e => { SFX.error(); setError((e as Error).message); });
  };
  useEffect(() => keyboard.listen(e => {
    if (e.code === 'Escape') { behind(); return true; }
    if (row > 0) {
      if (e.code === 'ArrowDown' || e.code === 'Tab') { setRow(f => Math.min(ofProject && !workIn ? 4 : 3, f + 1)); return true; }
      if (e.code === 'ArrowUp') { setRow(f => { const n = Math.max(0, f - 1); if (n === 0) setTimeout(() => area.current?.focus()); return n; }); return true; }
      if (row <= 3 && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        const fr = rows[row - 1]; const k = fr.values.findIndex(v => v.value === fr.current); const n = (k + (e.code === 'ArrowRight' ? 1 : -1) + fr.values.length) % fr.values.length; fr.set(fr.values[n].value); SFX.tick(); return true;
      }
      if (row === 4 && (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'Space')) { setWorktree(w => !w); SFX.toggle(); return true; }
      if (e.code === 'Enter') { send(); return true; }
      return true;
    }
    return true;
  }), [row, text, model, effort, permissions, worktree, !!workIn, ofProject, p.attachments]);
  const dictation = useDictation({ area, text, setText, onSend: send });
  const [onTop, drop] = useDrop(f => attach(h.id, p.id, f));
  return (
    <div className={'screen-console phosphor formulario' + (onTop ? ' dropping' : '')} {...drop}>
      {resume && (
        <div className="transcript-preview">
          <p className="voice">{t('windows.resumingTitleWhen', { title: resume.title, when: ago(resume.modified) })}</p>
          <div className="list-scrollable mini">{transcript === null ? <p className="dim">{t('windows.loading')}</p> : transcript.map(e => <Entry key={e.id} e={e} />)}</div>
        </div>
      )}
      <p className="voice">{resume ? t('windows.whatDoIDoWith') : t('windows.whatNeedsDoing')}</p>
      {/* la caja de texto ocupa la mitad superior; las opciones, la inferior */}
      <div className="form-write">
        <div className={'line-entry' + (row === 0 ? ' active' : '')}>
          <span className="prompt-sim">&gt;</span>
          <textarea ref={area} value={text} rows={3} readOnly={dictation.active} placeholder={resume ? t('windows.optionalAddAnInstructionOr') : t('windows.describeTheJobAsIn')}
            onFocus={() => setRow(0)}
            onChange={e => { setText(e.target.value); }}
            onPaste={e => { if (e.clipboardData?.files.length) { e.preventDefault(); attach(h.id, p.id, e.clipboardData.files); } }}
            onKeyDown={e => {
              physicsKey(e.nativeEvent);
              if (dictation.key(e)) return;
              if (attachShortcut(e)) { e.preventDefault(); chooseFiles(f => attach(h.id, p.id, f)); return; }
              if (e.key === 'Enter' && e.altKey) { e.preventDefault(); sendLater(); }
              else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              else if (e.key === 'Escape') { e.preventDefault(); behind(); }
              else if (e.key === 'Tab' || (e.key === 'ArrowDown' && !text.includes('\n'))) { e.preventDefault(); setRow(1); area.current?.blur(); }
            }} />
          <InputButtons attach={() => chooseFiles(f => attach(h.id, p.id, f))} dictation={dictation} />
        </div>
        <AttachmentsTray list={p.attachments} remove={removeAttachment(h.id, p.id)} />
        <DictationStrip dictation={dictation} />
      </div>
      <div className="form-options">
        {rows.map((fr, k) => (
          <div key={fr.name} className={'row-chips' + (row === k + 1 ? ' active' : '')} onClick={() => setRow(k + 1)}>
            <span className="lbl">{fr.name}</span>
            {fr.values.map(v => <button key={v.value} className={'chip' + (v.value === fr.current ? ' on' : '')} onClick={() => fr.set(v.value)} title={(v as any).hint ? tIs((v as any).hint) : ''}>{tIs(v.text)}</button>)}
          </div>
        ))}
        {workIn ? <div className="row-chips"><span className="lbl">Worktree</span><span className="chip on">{t('windows.insideTheCopyBranch', { branch: workIn.branch })}</span></div> :
        // un worktree solo tiene sentido en una sala de proyecto (las demás trabajan en su carpeta)
        ofProject && <div className={'row-chips' + (row === 4 ? ' active' : '')} onClick={() => setRow(4)}>
          <span className="lbl">Worktree</span>
          <button className={'chip' + (!worktree ? ' on' : '')} onClick={() => setWorktree(false)}>{t('windows.inTheMainCopy')}</button>
          <button className={'chip' + (worktree ? ' on' : '')} onClick={() => setWorktree(true)}>{t('windows.inASeparateWorktree')}</button>
        </div>}
        {error && <p className="notice-console">{error}</p>}
        <ComposerHelp send={t('windows.start')} shortcuts={t('windows.shortcutsNewHint', { cmd: CMD })} sendLater={sendLater} armed={esc.armed && t('windows.againGoBackAndDelete')} />
      </div>
    </div>
  );
}

// how many of its last entries a conversation to resume shows (read from its transcript)
const RESUME_PREVIEW = 12;

// ---------------------------------------------------------------- conversación viva
// la carpeta de una conversación (su worktree, si trabaja en uno): ahí apuntan las rutas relativas de sus respuestas
const folderOf = (s: SessionSummary) => s.worktree ?? s.cwd;
function Entry({ e, base, sessionId }: { e: LogInput; base?: string; sessionId?: string }) {
  const at = { 'data-entry': e.id };   // ⌘F scrolls to a match by it (FindBar.tsx)
  if (e.type === 'asistente' || e.type === 'lateral') return <div {...at} className={'ent ' + e.type} dangerouslySetInnerHTML={{ __html: markdown(e.text, base) }} />;
  if (e.type === 'usuario') return <div {...at} className={'ent user' + (e.origin ? ' from-outside' : '')}><span className="who">{originLabel(e.origin)}&gt;</span> <span dangerouslySetInnerHTML={{ __html: markdown(e.text, base) }} />{e.attachments?.length ? <SentAttachments list={e.attachments} /> : null}</div>;
  if (e.type === 'tool') return <div {...at} className={'ent tool' + (e.isError ? ' error' : '') + (e.helper ? ' of-helper' : '')}>{e.helper ? '  ⚙ ' : '⚙ '}<span><ToolText t={e.text} /></span>{e.detail && <pre className="detail-err">{e.detail}</pre>}{e.output && sessionId && <OutputView o={e.output} sessionId={sessionId} id={e.id} tool={e.tool} />}</div>;
  if (e.type === 'error') return <div {...at} className="ent error" dangerouslySetInnerHTML={{ __html: markdown(e.text) }} />;
  return <div {...at} className={'ent ' + e.type}>{e.text}</div>;
}

// A failed tool's output, folded to one line (tool, size, first line): the whole text stays on disk
// (server/toolOutputs.ts) until it is opened or copied
const sizeLabel = (n: number) => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const readOutput = (sessionId: string, id: string) => client.action<string | null>('output.read', { sessionId, id });
function OutputView({ o, sessionId, id, tool }: { o: ToolOutput; sessionId: string; id: string; tool?: string }) {
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const whole = async (): Promise<string> => {
    if (text != null) return text;
    const x = await readOutput(sessionId, id);
    if (x == null) throw new Error('gone');
    setText(x); return x;
  };
  const toggle = () => { SFX.click(); if (open) { setOpen(false); return; } whole().then(() => setOpen(true)).catch(() => { SFX.notAllowed(); addNotice('warning', t('windows.output.gone')); }); };
  const copy = () => whole().then(x => navigator.clipboard.writeText(x)).then(() => SFX.shortSuccess()).catch(() => { SFX.notAllowed(); addNotice('warning', t('windows.output.gone')); });
  return <div className="output-tool">
    <button className="console-x output-line" aria-expanded={open} title={t(open ? 'windows.output.hide' : 'windows.output.show')} onClick={toggle}>
      {open ? '▾' : '▸'} {tool ?? ''} · {sizeLabel(o.size)} · <span className="dim">{o.first}</span>
    </button>
    <button className="console-x" title={t('windows.output.copyHint')} onClick={copy}>⧉ {t('windows.output.copy')}</button>
    {open && text != null && <pre className="detail-err">{text}</pre>}
  </div>;
}

// What was sent to this conversation while it was busy and it has not taken yet (shared/messageQueue.ts), oldest first:
// it moves into the log when Claude Code takes it. What the Overseer wrote can be withdrawn, or taken back to the composer
function Queued({ s, edit }: { s: SessionSummary; edit: (m: QueuedMessage) => void }) {
  const queue = s.queue ?? [];
  const withdraw = async (m: QueuedMessage, then?: () => void) => {
    const ok = await client.ask<boolean>({ t: 'withdraw', sessionId: s.id, messageId: m.id }).catch(() => false);
    if (!ok) { SFX.notAllowed(); addNotice('warning', t('windows.queue.tooLate')); return; }
    SFX.click(); then?.();
  };
  // Enviar ya: interrupts the turn and sends it now (Ctrl C, then this message); the server takes it back from the queue
  const sendNow = async (m: QueuedMessage) => {
    const ok = await client.ask<boolean>({ t: 'sendNow', sessionId: s.id, messageId: m.id }).catch(() => false);
    if (!ok) { SFX.notAllowed(); addNotice('warning', t('windows.queue.tooLate')); return; }
    SFX.click();
  };
  return (
    <div className="queue-messages">
      <div className="queue-title">{t('windows.queue.title', { n: queue.length })} <span className="dim">· {t('windows.queue.hint')}</span></div>
      {queue.map(m => (
        <div key={m.id} className={'queue-message' + (m.origin.kind !== 'overseer' ? ' from-outside' : '')}>
          <span className="who">{originLabel(m.origin)}&gt;</span>
          <span className="queue-text" title={m.text}>{m.text.replace(/\s+/g, ' ')}{m.attachments?.length ? ` 📎${m.attachments.length}` : ''}</span>
          {withdrawable(m) && <span className="queue-actions">
            <button onClick={() => sendNow(m)} title={t('windows.queue.sendNowTitle')}>{t('windows.queue.sendNow')}</button>
            <button onClick={() => withdraw(m, () => edit(m))} title={t('windows.queue.editTitle')}>{t('windows.queue.edit')}</button>
            <button onClick={() => withdraw(m)}>{t('windows.queue.withdraw')}</button>
          </span>}
        </div>
      ))}
    </div>
  );
}

function Session({ h, s, p, exit, onClose }: { h: DwellerSummary; s: SessionSummary; p: TabCom; exit: () => void; onClose: () => void }) {
  const entries = live.use(e => e.entries[s.id]) ?? [];
  const older = live.use(e => !!e.older[s.id]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const partial = live.use(e => e.partial[s.id]) ?? '';
  const [text, setText0] = useState(p.draft ?? '');
  const setText = (t: string | ((x: string) => string)) => setText0(x => { const n = typeof t === 'function' ? t(x) : t; setTab(h.id, p.id, { draft: n }); return n; });
  const [commands, setCommands] = useState<Command[]>([]);
  const [selCmd, setSelCmd] = useState(0);
  const canvas = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);
  const workingLive = s.state === 'working' || s.state === 'starting';
  // al verla, la respuesta queda leída
  useEffect(() => { if (s.unread && (s.state === 'finished' || s.state === 'error')) client.send({ t: 'read', sessionId: s.id }); }, [s.unread, s.state]);
  useEffect(() => { loadLog(s.id); }, [s.id]);
  useEffect(() => { const el = canvas.current; if (el && pinned.current) el.scrollTop = el.scrollHeight; }, [entries.length, partial, s.pending?.id]);
  // older pages as the Overseer reaches the top (shared/logPages.ts), with what was in view kept in place; back at the
  // bottom, only the latest page stays held
  const beforeOlder = useRef<{ top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = canvas.current, b = beforeOlder.current;
    if (!el || !b) return;
    beforeOlder.current = null;
    el.scrollTop = scrollAfterPrepend(b.top, b.height, el.scrollHeight);
  }, [entries[0]?.id]);
  const askOlder = (el: HTMLDivElement) => {
    if (el.scrollTop >= OLDER_AT_PX || !older || loadingOlder) return;
    setLoadingOlder(true);
    beforeOlder.current = { top: el.scrollTop, height: el.scrollHeight };
    loadOlder(s.id).then(got => { if (!got) beforeOlder.current = null; }).finally(() => setLoadingOlder(false));
  };
  const onScroll = (el: HTMLDivElement) => {
    pinned.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    if (pinned.current) trimLog(s.id);
    askOlder(el);
  };
  // a page that doesn't fill the intercom has no scroll to reach the top with: the next one comes on its own
  useEffect(() => { const el = canvas.current; if (el && el.scrollHeight <= el.clientHeight) askOlder(el); }, [entries.length, older, loadingOlder]);
  useEffect(() => { if (!s.pending) area.current?.focus(); }, [s.pending?.id]);
  useEffect(() => { if (text.startsWith('/') && !commands.length) client.ask<Command[]>({ t: 'commands', sessionId: s.id }).then(c => setCommands(c?.length ? c : COMMANDS_BASE)).catch(() => setCommands(COMMANDS_BASE)); }, [text]);
  const suggestions = text.startsWith('/') && !text.includes(' ') ? [...OWN_COMMANDS, ...commands].filter(c => c.name.toLowerCase().startsWith(text.slice(1).toLowerCase())).slice(0, 8) : [];
  const scroll = (d: number) => { const el = canvas.current; if (el) { el.scrollTop += d * el.clientHeight * 0.8; onScroll(el); } };
  const interrupt = () => { client.send({ t: 'interrupt', sessionId: s.id }); SFX.click(); };
  const compact = () => { client.send({ t: 'send', sessionId: s.id, text: '/compact' }); pinned.current = true; SFX.click(); };
  // the handoff notice's other choice (server/sessions.ts: handoff()): the new session starts once the summary is written
  const handoff = () => { pinned.current = true; client.action('session.handoff', { sessionId: s.id }).then(() => SFX.click()).catch(e => { SFX.error(); addNotice('error', (e as Error).message); }); };
  const send = (raw = text) => {
    const t = raw.trim();
    if (uploading(p.attachments)) { SFX.notAllowed(); return; }
    const paths = listsPaths(p.attachments);
    if (!t && !paths.length) return;
    if (paths.length && (!t || !t.startsWith('/'))) { client.send({ t: 'send', sessionId: s.id, text: t, attachments: paths }); setTab(h.id, p.id, { attachments: undefined }); }
    else if (t === '/stop' || t === '/parar') client.send({ t: 'interrupt', sessionId: s.id });
    else if (t.startsWith('/btw ')) client.send({ t: 'sideQuestion', sessionId: s.id, question: t.slice(5) });
    else if (t === '/cuaderno') window.dispatchEvent(new CustomEvent('shelter:log', { detail: { sessionId: s.id } }));
    else if (t === '/cerrar') { setText(''); onClose(); return; }
    else client.send({ t: 'send', sessionId: s.id, text: t });
    setText(''); pinned.current = true; SFX.shortSuccess();
  };
  // ⌥Enter: background work for this conversation in the day's final 5-hour window or, with `when` (⏰ Schedule), at that time (server/scheduled.ts)
  const sendLater = (when?: string) => {
    if (!text.trim() || text.trim().startsWith('/')) { SFX.notAllowed(); return; }
    if (p.attachments?.length) { SFX.notAllowed(); addNotice('warning', t('windows.nextWindowNoAttachments')); return; }
    client.action<ScheduledMessage>('scheduled.window', { sessionId: s.id, message: text, when })
      .then(x => { setText(''); SFX.shortSuccess(); addNotice('info', laterDone(x)); })
      .catch(e => { SFX.error(); addNotice('warning', (e as Error).message); });
  };
  useEffect(() => keyboard.listen(e => {
    if ((e.ctrlKey && (e.code === 'ArrowUp' || e.code === 'KeyW')) || e.code === 'PageUp') { scroll(-1); return true; }
    if ((e.ctrlKey && (e.code === 'ArrowDown' || e.code === 'KeyS')) || e.code === 'PageDown') { scroll(1); return true; }
    if (e.ctrlKey && e.code === 'KeyC') { interrupt(); return true; }
    if (e.code === 'Escape') { exit(); return true; }
    // escribir sin estar en el campo lleva a él; ⌘, Ctrl, ⌥ o una tecla sola (⌘ de ⌘C) no: el foco se llevaría la
    // selección de la conversación y no habría nada que copiar
    if (!s.pending && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace')) { area.current?.focus(); return false; }
    return false;
  }), [s.pending?.id]);
  const dictation = useDictation({ area, text, setText, onSend: send });
  const esc = useEscDouble();
  const [onTop, drop] = useDrop(f => attach(h.id, p.id, f));
  const lineState = s.state === 'starting' ? t('windows.gettingReady') : s.activity ? s.activity.text : workingLive && s.background ? t('windows.waitingNInBackground', { n: s.background }) : workingLive ? t('windows.thinking') : '';
  const helpers = s.helpers.filter(a => a.state === 'working').length;
  return (
    <div className={'screen-console phosphor session' + (onTop ? ' dropping' : '')} data-session={s.id} {...drop}>
      <div className="title-session">{s.title}{s.worktree ? <span className="dim"> · worktree</span> : null}</div>
      <div className="canvas" ref={canvas} onScroll={e => onScroll(e.currentTarget)}>
        {entries.length > 0 && <div className="ent system dim notebook-start">{older ? (loadingOlder ? t('windows.log.loadingOlder') : t('windows.log.scrollForOlder')) : t('windows.log.start')}</div>}
        {(s.pending ? entries.filter((e, i) => !(e.type === 'system' && e.text.startsWith('❓')) && !(e.type === 'tool' && i >= entries.length - 3)) : entries).map(e => <Entry key={e.id} e={e} base={folderOf(s)} sessionId={s.id} />)}
        {partial && workingLive && <div className="ent asistente partial" dangerouslySetInnerHTML={{ __html: markdown(partial, folderOf(s)) + '<span class="cursor-typing">▌</span>' }} />}
        {s.pending && <Pending s={s} p={s.pending} tab={p} hid={h.id} exit={exit} />}
        {s.state === 'error' && s.error && <div className="ent error">⚠ {s.error}</div>}
        {s.limit && !workingLive && <div className="ent system">⏳ {limitLine(s.limit)}</div>}
        {s.handoff === 'offered' && !workingLive && <div className="ent system notice-handover">
          <p>{t('windows.handoff.notice', { used: tokensShort(s.context?.used ?? 0) })}</p>
          <div className="buttons-handover"><button onClick={compact}>{t('windows.compact')}</button><button title={t('windows.handoff.newHint')} onClick={handoff}>{t('windows.handoff.new')}</button></div>
        </div>}
        {s.handoff === 'writing' && <div className="ent system">✎ {t('windows.handoff.writing')}</div>}
      </div>
      {!!s.queue?.length && <Queued s={s} edit={m => {
        // back to the composer, after whatever is being written, with its attachments
        setText(x => x.trim() ? `${x}\n${m.text}` : m.text);
        if (m.attachments?.length) changeAttachments(h.id, p.id, l => [...l, ...m.attachments!.map(a => ({ id: `cola-${m.id}-${a.path}`, name: a.name, image: a.image, path: a.path }))]);
        area.current?.focus();
      }} />}
      {!s.pending && <div className="line-state">
        {workingLive ? <span className="spinning">◐</span> : s.state === 'waiting' ? <span className="urgent">?</span> : s.state === 'finished' ? <span>✓</span> : <span>·</span>}
        <span className="txt"><ToolText t={lineState || (s.limit ? limitLine(s.limit) : s.state === 'finished' || s.state === 'idle' ? t('windows.doneYouCanReplyOpen') : '')} /></span>
        {helpers > 0 && <span className="dim"> · {helpers > 1 ? t('windows.nHelpers', { n: helpers }) : t('windows.nHelper', { n: helpers })}</span>}
        {s.lateral && !s.lateral.answer && <span className="dim"> · {t('windows.sideQuestion')}</span>}
        <Usage s={s} compact={compact} />
        <span className="mode">{tIs(PERMISSION_MODES.find(m => m.value === s.permissionMode)?.text ?? s.permissionMode ?? '')}</span>
      </div>}
      {!s.pending && (
        <div className="line-entry active">
          {suggestions.length > 0 && <ul className="suggestions">{suggestions.map((c, k) => <li key={c.name} className={k === selCmd ? 'active' : ''} onMouseDown={ev => { ev.preventDefault(); setText('/' + c.name + ' '); }}><b>/{c.name}</b> <span>{c.description}</span></li>)}</ul>}
          <span className="prompt-sim">&gt;</span>
          <textarea ref={area} value={text} rows={2} readOnly={dictation.active} placeholder={workingLive ? t('windows.addSomethingWhileItWorks') : t('windows.replyDictateWithDOr')}
            onChange={e => { setText(e.target.value); setSelCmd(0); }}
            onPaste={e => { if (e.clipboardData?.files.length) { e.preventDefault(); attach(h.id, p.id, e.clipboardData.files); } }}
            onKeyDown={e => {
              physicsKey(e.nativeEvent);
              if (dictation.key(e)) return;
              if (attachShortcut(e)) { e.preventDefault(); chooseFiles(f => attach(h.id, p.id, f)); return; }
              if (suggestions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setSelCmd(k => (k + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length); return; }
              if (suggestions.length && e.key === 'Tab') { e.preventDefault(); setText('/' + suggestions[selCmd].name + ' '); return; }
              if (e.key === 'Enter' && e.altKey) { e.preventDefault(); sendLater(); return; }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (suggestions.length && text.trim() === text && !text.includes(' ')) setText('/' + suggestions[selCmd].name + ' '); else send(); return; }
              if (e.key === 'Escape') { e.preventDefault(); if (text) esc.press(true, () => setText('')); else exit(); return; }
              if ((e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'w')) || e.key === 'PageUp') { e.preventDefault(); scroll(-1); return; }
              if ((e.ctrlKey && (e.key === 'ArrowDown' || e.key === 's')) || e.key === 'PageDown') { e.preventDefault(); scroll(1); return; }
              if (e.key === 'c' && e.ctrlKey && !text) { e.preventDefault(); interrupt(); return; }
            }} />
          <InputButtons attach={() => chooseFiles(f => attach(h.id, p.id, f))} dictation={dictation} />
        </div>
      )}
      {!s.pending && <AttachmentsTray list={p.attachments} remove={removeAttachment(h.id, p.id)} />}
      {!s.pending && <DictationStrip dictation={dictation} />}
      <ComposerHelp send={t('windows.send')} shortcuts={t('windows.shortcutsHint', { cmd: CMD })} sendLater={sendLater} armed={esc.armed && t('windows.againDeleteWhatYouWrote')} afterTurn />
    </div>
  );
}

// how close to the top the next older page is asked for
const OLDER_AT_PX = 120;

// stopped by the usage limit (server/limitResume.ts): when it resumes, or when the limit renews until it's queued
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const limitLine = (l: NonNullable<SessionSummary['limit']>) => l.resumeAt ? t('windows.limitWaiting', { when: hhmm(l.resumeAt) }) : t('windows.limitWaitingReset', { when: hhmm(l.resetsAt) });

// Las páginas de la conversación (planes, informes, comparaciones que ha enlazado): cuáles quedan por revisar, abrirlas
// (sus notas vuelven a esta conversación) y validar sin notas las que estén bien (shared/sessionPages.ts)
const PR_STATE: Record<PRBoard['state'], string> = { open: '●', draft: '◌', merged: '✓', closed: '✕' };
const prStateName = (e: PRBoard['state']) => e === 'open' ? t('windows.prState.open') : e === 'draft' ? t('windows.prState.draft') : e === 'merged' ? t('windows.prState.merged') : t('windows.prState.closed');
function WorktreePRs({ copy, roomId }: { copy: { path: string; branch: string }; roomId: string }) {
  const fromBoard = jiraBoard.use(x => x.prs);
  const [read, setRead] = useState<PRBoard[] | null>(null);
  const { path, branch } = copy;
  useEffect(() => { let stillAlive = true; myPRs().then(l => { if (stillAlive) setRead(l); }); return () => { stillAlive = false; }; }, [branch]);
  const folder: string = live.use(e => ((e.state?.rooms ?? []) as any[]).find(x => x.id === roomId)?.path ?? '');
  // los de la tarea del worktree (todas sus ramas) en el repo de esta sala
  const prs = useMemo(() => branch ? worktreePRs(fromBoard.length ? fromBoard : read ?? [], { path, branch }, folder) : [],
    [fromBoard, read, path, branch, folder]);
  const [open, setOpen] = useState(false);
  const list = useListAtButton(open);
  if (!prs.length) return null;
  const openCount = prs.filter(p => p.state === 'open' || p.state === 'draft').length;
  // like the pages: a button with the count and, on click, the whole list at the button
  return <span className="pages-session prs-copia">
    <button className="console-x" title={t('windows.taskPRsHint')} onClick={() => { setOpen(x => !x); SFX.click(); }}>
      ⑂ {t('windows.pullRequests')} ({openCount < prs.length ? `${openCount}/${prs.length}` : prs.length})
    </button>
    {open && <ul ref={list} className="pages-list">{prs.map(p => <li key={p.url} className={'pr-' + p.state}>
      <span className="pr-brand" title={prStateName(p.state)}>{PR_STATE[p.state]}</span>
      <button className="page-name" title={`${p.repo}#${p.number} · ${p.branch}\n${p.title}`} onClick={() => { openLink(p.url); setOpen(false); }}>#{p.number} {p.title}</button>
      <span className="dim">{prStateName(p.state)}</span>
      {p.checks === 'FAILURE' || p.checks === 'ERROR' ? <span className="pr-bad">✕ CI</span> : null}
      {p.review === 'APPROVED' ? <span className="pr-good">✓</span> : p.review === 'CHANGES_REQUESTED' ? <span className="pr-bad">±</span> : null}
    </li>)}</ul>}
  </span>;
}

// the pre-flight of the copy's task: all its parts in every repo (Preflight.tsx), only once the task has a PR (the same
// list `WorktreePRs` reads)
// ⚑ The pending mark of the conversation in view, open or closed (closed ones have no title-bar ⚑ nor tab to mark)
function FlagButton({ c, flags }: { c?: Flaggable; flags: Set<string> }) {
  const on = flagOf(c, flags);
  if (on === undefined) return null;
  return <span className="pages-session marca-conversacion">
    <button className={'console-x button-mark' + (on ? ' checked' : '')} aria-pressed={on} title={t(on ? 'windows.flag.clear' : 'windows.flag.set', { shortcut: FLAG_SHORTCUT })} onClick={() => toggleFlag(c)}>⚑ {t(on ? 'windows.flag.buttonOn' : 'windows.flag.button')}</button>
  </span>;
}

function PreflightButton({ copy }: { copy: { path: string; branch: string } }) {
  const task = copyTask(copy);
  const withPRs = jiraBoard.use(x => !!task && taskHasPRs(task, x.prs));
  if (!task || !withPRs) return null;
  return <span className="pages-session preflight-copia">
    <button className="console-x" title={t('preflight.actionHint')} onClick={e => { SFX.click(); openPreflight(task, e.currentTarget); }}>✈ {t('preflight.action', { key: task })}</button>
  </span>;
}

// the log's entries that can link pages, read from the whole log (the intercom holds only a page of it) and kept only
// while a conversation is in view (none with an empty `key`)
function useLinkEntries(data: { sessionId: string } | { roomId: string; claudeId: string }, key: string) {
  const [l, setL] = useState<LogInput[]>([]);
  useEffect(() => {
    if (!key) { setL([]); return; }
    let stillAlive = true;
    client.action<LogInput[]>('log.links', data).then(x => { if (stillAlive) setL(Array.isArray(x) ? x : []); }).catch(() => {});
    return () => { stillAlive = false; };
  }, [key]);
  return l;
}
function PagesMenu({ s }: { s: SessionSummary }) {
  const held = live.use(e => e.entries[s.id]);
  const fromLog = useLinkEntries({ sessionId: s.id }, s.id);
  // after a handoff, the old conversation's pages too, from its transcript while it exists, and its answers
  const old = s.handoffClaudeId;
  const fromOld = useLinkEntries({ roomId: s.roomId, claudeId: old ?? '' }, old ? `${s.roomId}\n${old}` : '');
  useEffect(() => { if (old) carryPageAnswers(old, s.id); }, [old, s.id, s.claudeId]);
  const log = useMemo(() => { const ids = new Set((held ?? []).map(e => e.id)); return [...(old ? fromOld : []), ...fromLog.filter(e => !ids.has(e.id)), ...(held ?? [])]; }, [held, fromLog, fromOld, old]);
  // con la pregunta que espera respuesta: lo que enlaza (la comparación que pide aprobar) ya sale
  const questions = s.pending?.type === 'question' ? s.pending.questions : undefined;
  const since = useMemo(() => Date.now(), [s.pending?.id]);
  const entries = useMemo(() => [...(log ?? []), ...(questions?.length ? [questionInput(questions, since)] : [])], [log, questions, since]);
  return <PagesList sessionId={s.id} claudeId={s.claudeId} entries={entries} base={folderOf(s)} />;
}

// the after-turn ones first, then the dated ones, then the background work, pending until the day's final 5-hour window
const tiers = (l: ScheduledMessage[]) => [...l.filter(x => x.afterTurn), ...l.filter(x => !x.nextWindow && !x.afterTurn), ...l.filter(x => x.nextWindow)];

// The scheduled messages (server/scheduled.ts) of what the intercom shows: those the open conversation scheduled and
// those waiting for its turn to end (from anyone: another room, the game, the Overseer's «When it finishes»); with
// none open, those of the conversation being resumed or, from the menu, every one of this room or hologram (ofPlace), so
// they're seen before opening their conversation; the room's dweller's lists the whole room, under a heading per
// hologram (byPlace: the main copy first) once one of its worktrees has some, and one per task whose hologram is still
// to come (a message to the room with a key that has no worktree yet: it moves to that hologram once it appears). When the next one is due and, unfolded,
// each with ✎ (change the time or the text) and ✕ (cancel it)
function ScheduledMenu({ h, s, resume }: { h: DwellerSummary; s?: SessionSummary; resume?: string }) {
  const all = live.use(e => e.scheduled);
  const worktrees = live.use(e => e.repos[h.room]?.worktrees);
  const rooms: any[] = live.use(e => e.state?.rooms ?? []);
  const conversation = s ?? (resume ? { claudeId: resume } : undefined);
  const groups = useMemo(() => {
    const l: { worktree?: string; task?: string; items: ScheduledMessage[] }[] = conversation ? [{ items: ofConversationView(all, conversation) }]
      : h.copy ? [{ worktree: h.copy.path, items: ofPlace(all, h.room, h.copy.path, worktrees ?? []) }] : byPlace(all, h.room, worktrees ?? []);
    // what arrives here (from others, then its own reminders) before what it sends elsewhere, so they don't interleave
    const rank = { in: 0, self: 1, out: 2 };
    return l.map(g => ({ ...g, items: tiers(g.items).sort((a, b) => rank[scheduledDirection(a, conversation)] - rank[scheduledDirection(b, conversation)]) }));
  }, [all, worktrees, s?.id, s?.claudeId, resume, h.room, h.copy?.path]);
  const mine = useMemo(() => tiers(groups.flatMap(g => g.items).sort((a, b) => a.when - b.when)), [groups]);
  const headed = !conversation && !h.copy && groups.some(g => g.worktree || g.task);
  const groupName = (g: { worktree?: string; task?: string }) => {
    if (g.task) return t('windows.scheduledNewHologram', { key: g.task });
    const w = g.worktree && worktrees?.find(x => x.path === g.worktree);
    return w ? `◇ ${copyCaption(w, copyTask(w) ?? branchCaption(w.branch))}` : t('windows.scheduledMainCopy');
  };
  const [open, setOpen] = useState(false);
  const list = useListAtButton(open);
  const [editing, setEditing] = useState<{ id: string; when: string; message: string; error?: string } | null>(null);
  if (!mine.length) return null;
  const cancel = (x: ScheduledMessage) => { client.action('scheduled.cancel', { id: x.id }).then(() => SFX.click()).catch(() => SFX.notAllowed()); };
  const sendNow = (x: ScheduledMessage) => { client.action('scheduled.now', { id: x.id }).then(() => SFX.click()).catch(() => SFX.notAllowed()); };
  const save = () => {
    if (!editing) return;
    client.action('scheduled.edit', { id: editing.id, when: editing.when || undefined, message: editing.message })
      .then(() => { setEditing(null); SFX.click(); }).catch(e => { setEditing(x => x && { ...x, error: (e as Error).message }); SFX.notAllowed(); });
  };
  const here = (x: ScheduledMessage) => !!conversation && x.target.type === 'conversation' && ((!!s && x.target.sessionId === s.id) || (!!conversation.claudeId && x.target.claudeId === conversation.claudeId));
  const target = (x: ScheduledMessage) => x.target.type === 'room' ? `→ ${x.target.room}${x.target.key ?? x.target.thread ? ' ' + (x.target.key ?? x.target.thread) : ''}`
    : here(x) ? t('windows.scheduledToThis')
    : t('windows.scheduledToConversation', { title: x.target.title || t('windows.conversation') });
  const pack = (x: ScheduledMessage) => x.pr ? t('windows.scheduledPack', { pr: x.pr.label, n: x.pr.parts.length })
    : x.messages && x.messages.parts.length > 1 ? t('windows.scheduledMessages', { n: x.messages.parts.length }) : undefined;
  const whenShort = (x: ScheduledMessage) => x.afterTurn ? pack(x) || t('windows.scheduledAfterTurn') : x.nextWindow ? t('windows.scheduledWindow') : describeWhenShort(x.when);
  return (
    <span className="pages-session scheduled-session">
      <button className="console-x" title={t(conversation ? 'windows.scheduledHint' : 'windows.scheduledHintPlace')} onClick={() => { setOpen(x => !x); setEditing(null); SFX.click(); }}>
        {t(mine.length > 1 ? 'windows.scheduledN' : 'windows.scheduled', { n: mine.length, when: whenShort(mine[0]) })}
      </button>
      {open && <ul ref={list} className="pages-list scheduled-list" onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { setEditing(null); setOpen(false); } }}>{groups.map(g => <Fragment key={g.worktree ?? (g.task ? 'task:' + g.task : '')}>
        {headed && <li className="scheduled-group" title={g.task ? t('windows.scheduledNewHologramHint') : undefined}><span>{t('windows.scheduledGroup', { name: groupName(g), n: g.items.length })}</span></li>}
        {g.items.map(x => <Fragment key={x.id}>
        {editing?.id === x.id
        ? <li className="scheduled-editing">
            <input type="datetime-local" value={editing.when} onChange={e => setEditing({ ...editing, when: e.target.value, error: undefined })} />
            <textarea rows={4} value={editing.message} onChange={e => setEditing({ ...editing, message: e.target.value, error: undefined })} />
            {editing.error && <span className="pr-bad">{editing.error}</span>}
            <span><button className="console-x" onClick={save}>{t('windows.scheduledSave')}</button> <button className="console-x" onClick={() => setEditing(null)}>✕</button></span>
          </li>
        : <li title={x.message}>
            {(m => <span className={m.className} title={m.hint}>{m.text}</span>)(directionMark(scheduledDirection(x, conversation)))}
            {x.afterTurn ? <span className="dim" title={t(x.pr ? 'windows.scheduledPackHint' : pack(x) ? 'windows.scheduledMessagesHint' : 'windows.scheduleAfterTurnHint')}>{pack(x) || t('windows.scheduledAfterTurn')}</span>
              : x.nextWindow ? <span className="dim" title={t('windows.nextWindowHint') + '\n' + describeWhen(x.when)}>{t('windows.scheduledWindow')}</span>
              : <span className={x.when < Date.now() ? 'urgent' : ''} title={x.when < Date.now() ? t('windows.scheduledLate') : describeWhen(x.when)}>⏰ {describeWhenShort(x.when)}</span>}
            <span className="dim" title={!x.afterTurn && pack(x) ? t('windows.scheduledMessagesHint') : undefined}>{scheduledSender(x, id => rooms.find(r => r.id === id)?.name)} · {target(x)}{!x.afterTurn && pack(x) ? ` ${pack(x)}` : ''}</span>
            <span className="page-name">{x.message.replace(/\s+/g, ' ')}</span>
            <button className="console-x" title={t('windows.scheduledEdit')} onClick={() => setEditing({ id: x.id, when: x.nextWindow || x.afterTurn ? '' : localInput(x.when), message: x.message })}>✎</button>
            {(x.nextWindow || x.overLimit || x.afterTurn) && <button className="console-x" title={t('windows.scheduledSendNow')} onClick={() => sendNow(x)}>▶</button>}
            <button className="console-x" title={t('windows.scheduledCancel')} onClick={() => cancel(x)}>✕</button>
          </li>}</Fragment>)}</Fragment>)}</ul>}
    </span>
  );
}
const laterDone = (x: ScheduledMessage) => t(x.afterTurn ? 'windows.scheduleAfterTurnDone' : x.nextWindow ? 'windows.nextWindowDone' : 'windows.scheduleAtDone', { when: describeWhenShort(x.when) });

// ⏰ Schedule in the composer's help line: in an open conversation «When it finishes» first (AFTER_TURN: when its turn
// ends), then one-click presets (schedulePresets) or any date and time; `pick` sends the draft for then (action
// `programados.ventana` with `when`, checked on the server like schedule_message). It opens upwards, over the conversation
// The composer's bottom line: only what it needs as buttons (schedule first, then the day's last window: both send it
// later); every shortcut is in the ⌨'s panel, shown on hover or keyboard focus (a native title barely shows in Electron).
// It wraps instead of clipping when the intercom is narrow.
function ComposerHelp({ send, shortcuts, sendLater, armed, afterTurn }: { send: string; shortcuts: string; sendLater: (when?: string) => void; armed: string | false; afterTurn?: boolean }) {
  return (
    <p className="help-console help-composer">
      <span><kbd>Enter</kbd> {send}</span>
      <ScheduleAt pick={sendLater} afterTurn={afterTurn} />
      <button className="console-x" onClick={() => sendLater()} title={`${t('windows.nextWindowHint')} (⌥ Enter)`}>⏳ {t('windows.nextWindow')}</button>
      {armed && <span className="urgent">{armed}</span>}
      <span className="shortcuts-composer" tabIndex={0} aria-label={shortcuts.replace(/[[\]]/g, '')}>⌨ {t('windows.shortcuts')}
        <span className="shortcuts-panel" aria-hidden>
          {shortcuts.split(/\n| · /).map((x, i) => <span key={i}>{x.split(/(\[[^\]]+\])/).map((p, j) => p.startsWith('[') ? <kbd key={j}>{p.slice(1, -1)}</kbd> : p)}</span>)}
        </span>
      </span>
    </p>
  );
}

function ScheduleAt({ pick, afterTurn }: { pick: (when: string) => void; afterTurn?: boolean }) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState('');
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', out);
    return () => document.removeEventListener('mousedown', out);
  }, [open]);
  const go = (w: string) => { if (!w) { SFX.notAllowed(); return; } setOpen(false); pick(w); };
  const now = Date.now();
  return (
    <span ref={box} className="schedule-time">
      <button className="console-x" title={t('windows.scheduleAtHint')} onClick={() => { setOpen(x => !x); setWhen(localInput(now + 3_600_000)); SFX.click(); }}>⏰ {t('windows.scheduleAt')}</button>
      {open && <ul className="pages-list schedule-list" onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') go(when); }}>
        {afterTurn && <li><button className="chip" title={t('windows.scheduleAfterTurnHint')} onClick={() => go(AFTER_TURN)}>{t('windows.scheduleAfterTurn')}</button></li>}
        {schedulePresets(now).map(x => <li key={x.key}><button className="chip" onClick={() => go(localInput(x.when))}>{t(PRESET_TEXT[x.key])} <span className="dim">{describeWhenShort(x.when, now)}</span></button></li>)}
        <li><input type="datetime-local" value={when} min={localInput(now)} onChange={e => setWhen(e.target.value)} /> <button className="console-x" onClick={() => go(when)}>{t('windows.scheduleAtGo')}</button></li>
      </ul>}
    </span>
  );
}
const PRESET_TEXT = { in1h: 'windows.scheduleIn1h', in3h: 'windows.scheduleIn3h', tomorrow: 'windows.scheduleTomorrow', monday: 'windows.scheduleMonday' } as const;

// Una conversación por retomar (cerrada o perdida en un reinicio): sus páginas salen igual, leídas de su transcripción;
// abrirlas, validarlas o quitarlas no le escribe nada (al retomarla, lo hecho sigue contado)
function ResumePages({ roomId, claudeId }: { roomId: string; claudeId: string }) {
  const entries = useLinkEntries({ roomId, claudeId }, `${roomId}\n${claudeId}`);
  return <PagesList sessionId={claudeId} claudeId={claudeId} entries={entries} />;
}

// The action lists (pages, scheduled, PRs) open at their own button: right below it whenever there's room for a few rows
// there (or all of them), otherwise to its right over the conversation, moved up just enough to end inside the intercom;
// never taller nor wider than what's left of it (rows shorten their texts, never their buttons), with scroll. Fitted
// again when the intercom resizes or the rows change
function useListAtButton(open: boolean) {
  const ref = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const ul = ref.current, anchor = ul?.parentElement, zone = ul?.closest('.console-body');
    if (!open || !ul || !anchor || !zone) return;
    const fit = () => {
      const z = zone.getBoundingClientRect(), b = anchor.getBoundingClientRect();
      const k = anchor.offsetWidth ? b.width / anchor.offsetWidth : 1;  // screen px per CSS px (a scaled intercom)
      const margin = 6, height = (z.height - 2 * margin) / k, few = 160;
      const width = (left: number) => ({ maxWidth: `${left}px`, minWidth: `min(26em, ${left}px)` });
      Object.assign(ul.style, { maxHeight: 'none', top: '', left: '' });
      const natural = ul.scrollHeight;
      const below = (z.bottom - b.bottom - margin) / k;
      if (natural <= below || below >= Math.min(few, height / 2)) {
        Object.assign(ul.style, { top: '100%', left: '0', maxHeight: `${Math.max(0, below - 3)}px`, ...width((z.right - b.left - margin) / k) });
        return;
      }
      const h = Math.min(natural, height);
      const top = Math.max((z.top + margin - b.top) / k, Math.min(0, (z.bottom - margin - b.top) / k - h));
      Object.assign(ul.style, { top: `${top}px`, left: `calc(100% + ${margin}px)`, maxHeight: `${height}px`, ...width((z.right - b.right) / k - 2 * margin) });
    };
    fit();
    const rows = new MutationObserver(fit);
    rows.observe(ul, { childList: true, subtree: true, characterData: true });
    addEventListener('resize', fit);
    return () => { rows.disconnect(); removeEventListener('resize', fit); };
  }, [open]);
  return ref;
}

// cuándo se cambió cada página (null: ya no está), compartido por todas las pestañas
const pageTimes = new Map<string, number | null>();
function PagesList({ sessionId, claudeId, entries, base }: { sessionId: string; claudeId?: string; entries: LogInput[]; base?: string }) {
  // (sin la conversación en marcha, las notas de la página se copian: no hay a quién mandarlas)
  const alive = live.use(e => !!e.sessions[sessionId]);
  const s = { id: sessionId };
  const bySession = pageAnswers.use(x => x[sessionId]), byClaude = pageAnswers.use(x => (claudeId ? x[claudeId] : undefined));
  const answers = useMemo(() => ({ ...bySession, ...byClaude }), [bySession, byClaude]);
  const drafts = pageNotes.use(x => x);
  const all = useMemo(() => sessionPages(entries, answers, base), [entries, answers, base]);
  // solo las que siguen en el Mac (se pregunta al servidor cuando cambia la lista o se abre), y cuándo se cambió cada
  // una por última vez (un plan se reescribe sin que cambie el enlace). Lo ya sabido sale al momento, de `pageTimes`
  const paths = all.map(p => p.path).join('\n');
  const known = () => { const l = paths ? paths.split('\n') : []; return l.every(r => pageTimes.has(r)) ? l : null; };
  const [existing, setExist] = useState<Set<string> | null>(() => { const l = known(); return l && new Set(l.filter(r => pageTimes.get(r))); });
  const [updated, setUpdated] = useState<Record<string, number>>(() => Object.fromEntries((known() ?? []).flatMap(r => pageTimes.get(r) ? [[r, pageTimes.get(r)!]] : [])));
  const [open, setOpen] = useState(false);
  const list = useListAtButton(open);
  useEffect(() => {
    if (!paths) return;
    let stillAlive = true;
    client.action('pages.updated', { paths: paths.split('\n') }).then((l: any) => {
      const m = l && typeof l === 'object' ? l as Record<string, number> : {};
      for (const r of paths.split('\n')) pageTimes.set(r, m[r] ?? null);
      if (stillAlive) { setExist(new Set(Object.keys(m))); setUpdated(m); }
    }).catch(() => {});
    return () => { stillAlive = false; };
  }, [paths, open && 'open']);
  // las más recientes arriba: enlazadas o reescritas (un plan rehecho sube aunque no se vuelva a enlazar)
  const latest = (p: { path: string; ts: number }) => Math.max(p.ts, updated[p.path] ?? 0);
  const pages = livePages(all, existing).sort((a, b) => latest(b) - latest(a) || a.path.localeCompare(b.path));
  if (!pages.length) return null;
  const pending = pendingPages(pages).length;
  const openTarget = (path: string) => {
    client.action('link.local', { path }).then((r: any) => { if (r?.page) openPage(r.page.url, r.page.title, alive ? s.id : undefined, r.page.path); else SFX.click(); }).catch(() => SFX.notAllowed());
    setOpen(false);
  };
  const inDraft = (path: string) => Object.entries(drafts).find(([k]) => samePage(k, path))?.[1].length ?? 0;
  return (
    <span className="pages-session pages-main">
      <button className={'console-x' + (pending ? ' urgent' : '')} title={t('windows.pagesHint')} onClick={() => { setOpen(x => !x); SFX.click(); }}>
        📄 {t('windows.pages')} {pending ? `· ${pending} ${t('windows.pagePending')}` : `(${pages.length})`}
      </button>
      {open && <ul ref={list} className="pages-list">{pages.map(p => {
        const n = inDraft(p.path);
        return <li key={p.path} className={p.answer ? 'dim' : ''}>
          <button className="page-name" title={p.path} onClick={() => openTarget(p.path)}>{p.name}</button>
          {updated[p.path] && <span className="dim" title={new Date(updated[p.path]).toLocaleString()}>{t('windows.pageUpdated', { when: ago(updated[p.path]) })} · </span>}
          <span className={p.answer ? '' : 'urgent'}>{p.answer ? '✓ ' + t(p.answer.state === 'notes' ? 'windows.pageNotesSent' : 'windows.pageValidatedState') : '• ' + t('windows.pagePending')}</span>
          {n > 0 && <span className="dim"> · {t('windows.pageDraftNotes', { n })}</span>}
          <button className="console-x" title={t('windows.showInFinderHint')} onClick={() => revealPage(p.path)}>📁</button>
          {!p.answer && n === 0 && <button className="console-x" title={t('windows.validatePageHint')} onClick={() => { validatePage(s.id, p.path); setOpen(false); }}>✓ {t('windows.validate')}</button>}
          <button className="console-x" title={t('windows.removePageHint')} onClick={() => { answerPage(s.id, p.path, 'quitada'); SFX.click(); }}>✕</button>
        </li>;
      })}</ul>}
    </span>
  );
}

// soltar archivos en cualquier parte de la conversación los adjunta (y no deja que la ventana navegue al archivo)
function useDrop(onDrop: (f: FileList) => void) {
  const [onTop, setAbove] = useState(false);
  const withFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  return [onTop, {
    onDragOver: (e: React.DragEvent) => { if (!withFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!onTop) setAbove(true); },
    onDragLeave: (e: React.DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setAbove(false); },
    onDrop: (e: React.DragEvent) => { if (!withFiles(e)) return; e.preventDefault(); setAbove(false); onDrop(e.dataTransfer.files); },
  }] as const;
}

const OWN_COMMANDS: Command[] = [
  { name: 'btw', description: t('windows.sideQuestionWithoutInterruptingThe'), hint: t('windows.question') },
  { name: 'stop', description: t('windows.stopWhatItIsDoing') },
  { name: 'log', description: t('windows.openTheConversationNotebookR') },
  { name: 'cerrar', description: t('windows.closeThisConversationItStays') },
];
const COMMANDS_BASE: Command[] = [
  { name: 'compact', description: t('windows.compactTheConversation') }, { name: 'context', description: t('windows.contextUsage') },
  { name: 'model', description: t('windows.changeModel') }, { name: 'effort', description: t('windows.changeEffort') }, { name: 'clear', description: t('windows.startFromScratch') },
];

// ---------------------------------------------------------------- permisos, preguntas y planes
const ARMED_MS = 800;
function Pending({ s, p, tab, hid, exit }: { s: SessionSummary; p: PendingRequest; tab: TabCom; hid: string; exit: () => void }) {
  // lo que se está escribiendo (el porqué de un no, otra respuesta) se guarda en la pestaña: minimizar no lo pierde
  const [reason, setReason0] = useState<string | null>(tab.reason?.request === p.id ? tab.reason.text : null);
  const setReason = (t: string | null) => { setReason0(t); setTab(hid, tab.id, { reason: t === null ? undefined : { request: p.id, text: t } }); };
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [qi, setPq] = useState(0);
  const respond = (decision: 'si' | 'always' | 'no', message?: string, answer?: Record<string, string>) => { client.send({ t: 'answer', sessionId: s.id, requestId: p.id, decision, message, responses: answer }); SFX.click(); };
  let items: { text: React.ReactNode; hint?: React.ReactNode; danger?: boolean; kind?: string; f: () => void }[] = [];
  const question = p.type === 'question' ? p.questions?.[qi] : undefined;
  if (p.type === 'permission') items = [
    { text: t('windows.yes'), f: () => respond('si') },
    ...(p.canAlways ? [{ text: t('windows.yesAndDonTAsk'), f: () => respond('always') }] : []),
    { text: t('windows.noAndILlTell'), danger: true, f: () => setReason('') },
  ];
  else if (p.type === 'trust') items = [
    { text: t('windows.yesLoadItThisTime'), f: () => respond('si') },
    { text: t('windows.yesAndDonTAsk2'), f: () => respond('always') },
    { text: t('windows.noWorkWithoutIt'), danger: true, f: () => respond('no') },
  ];
  else if (p.type === 'plan') items = [
    { text: t('windows.approveThePlan'), hint: t('windows.willAskPermissionToEdit'), f: () => respond('si') },
    { text: t('windows.approveAndLetItEdit'), f: () => respond('always') },
    { text: t('windows.keepPlanningILlTell'), danger: true, f: () => setReason('') },
  ];
  else if (question) items = [
    // las respuestas de una pregunta pueden ser largas o llevar enlaces: enteras, en varias líneas (clase «larga»)
    ...question.options.map(o => ({ text: o.label, hint: o.description ? <span dangerouslySetInnerHTML={{ __html: markdownLine(o.description, folderOf(s)) }} /> : undefined, kind: 'long', f: () => { const r = { ...responses, [question.question]: o.label }; setResponses(r); if (qi + 1 < (p.questions?.length ?? 0)) setPq(qi + 1); else respond('si', undefined, r); } })),
    { text: t('windows.somethingElse'), f: () => setReason('') },
    { text: t('windows.skipTheQuestion'), danger: true, f: () => respond('no', t('prompt.userPreferredNotToAnswer')) },
  ];
  // una petición que aparece mientras se escribe no se contesta con las teclas que venían detrás (Espacio, Enter, E,
  // W/S): el menú solo atiende al teclado tras una pausa sin teclear; cada tecla antes de eso se traga y alarga la espera
  const armed = useRef(Date.now() + ARMED_MS);
  useEffect(() => { armed.current = Date.now() + ARMED_MS; }, [p.id, qi]);
  // aquí ← no es «atrás» (la petición sigue esperando): Esc vuelve al refugio y la deja pendiente
  const [i, setI] = useMenuBase(items.length, k => items[k]?.f(), e => {
    if (e.code === 'Escape') return undefined;
    if (reason !== null) return false;
    if (Date.now() < armed.current) { armed.current = Date.now() + ARMED_MS; return true; }
  }, exit);
  return (
    <div className={'request ' + p.type}>
      <div className="request-title">{p.ofHelper ? t('windows.aHelperNameAsks', { name: p.ofHelper }) : ''}{question ? null : p.title}</div>
      {/* la pregunta es prosa de Claude: en markdown (enlaces que se abren, listas), con su propio scroll si es muy larga */}
      {question && <div className="request-question" dangerouslySetInnerHTML={{ __html: markdown(question.question, folderOf(s)) }} />}
      {/* lo que pide una herramienta, siempre en texto plano (plainText.tsx); el plan, que es prosa, en markdown */}
      {(p.type === 'permission' || p.type === 'trust') && (p.input?.length || p.reason) ? <RequestView blocks={p.input ?? []} reason={p.reason} /> : null}
      {p.type === 'plan' && p.detail && <div className="request-detail" dangerouslySetInnerHTML={{ __html: markdown(p.detail, folderOf(s)) }} />}
      {reason === null ? <Options items={items} i={i} setI={setI} onChoose={k => items[k]?.f()} /> : (
        <div className="line-entry active">
          <span className="prompt-sim">&gt;</span>
          <textarea autoFocus rows={2} value={reason} placeholder={p.type === 'question' ? t('windows.yourAnswer') : t('windows.tellItWhyOrEnter')} onChange={e => setReason(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (p.type === 'question' && question) { const r = { ...responses, [question.question]: reason }; if (qi + 1 < (p.questions?.length ?? 0)) { setResponses(r); setPq(qi + 1); setReason(null); } else respond('si', undefined, r); } else respond('no', reason); }
              if (e.key === 'Escape') { e.preventDefault(); setReason(null); }
              e.stopPropagation();
            }} />
        </div>
      )}
    </div>
  );
}

// una página que se abre al lado (Browsers.tsx): si el intercomunicador a la vista está ampliado, vuelve a la derecha
// para que se vean los dos
if (typeof window !== 'undefined') addEventListener('shelter:page-beside', () => {
  const hid = juego.get().talkingWith, v = hid ? win(hid) : undefined;
  if (v?.maximized) update(hid!, { maximized: false });
});
