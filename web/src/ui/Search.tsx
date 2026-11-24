// Buscador del refugio (⌘K, desde cualquier sitio: el refugio, un intercomunicador, una terminal o un navegador).
// Todo lo que no es del juego en sí (eso va en el menú de Esc) se encuentra aquí escribiendo, sin acordarse de teclas:
// - Conversaciones: las abiertas (las que te esperan, delante) y las recientes de todas las salas, para retomarlas.
// - Acciones: lo que antes estaba en teclas y botones sueltos (plano, git, cuaderno, terminal, música, webs…), cada
//   una con su tecla a la vista para aprenderla; sin escribir, las que más usas, primero.
// - Al escribir, también habitantes (hablar con…) y salas (ir a…).
// ↑↓ eligen, Enter abre, Esc o ⌘K cierran. Lo elegido se apunta (en este navegador) para ordenar las recurrentes.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RecentConversation, SessionSummary } from '@shared/protocol';
import { Store } from './store';
import { t, tIs } from '@shared/language';
import { juego } from './gameState';
import { live, client, addNotice } from '../net/client';
import { SFX } from '../audio/sound';
import { MAC } from './windows';
import { openPanel, goA, busy, openGitOfRoom } from './Panels';
import { minimizeIntercom, openConversation, resumeConversation, ago, sessionInView } from './Dialog';
import { toClaudeApp, takeASurface } from './surface';
import { reloadView } from '../engine/render';
import { sessionOwner } from './copies';
import { openBrowser } from './Browsers';
import { openGit } from './git/window';
import { musicShortcut } from './Disco';
import { enter as enterBar } from './Bar';
import { adaptRoom } from './RoomPanels';
import { describeWhen, describeWhenShort } from '@shared/scheduled';
import { openPreflight } from './Preflight';
import { verifyLadder } from './WorkLog';
import { jiraBoard } from './tasks';
import { worktreeTask } from '@shared/tasks';
import { pRKey } from '@shared/deploy';
import { taskHasPRs } from '@shared/preflight';
import { recentFirst, sessionRecency } from '@shared/recent';

export const search = new Store<{ open: boolean }>({ open: false });
let recentLast: RecentConversation[] | null = null;   // las de la última vez: salen al momento mientras se piden otra vez
let before: Element | null = null;
export function openSearch() {
  if (search.get().open) return;
  before = document.activeElement;
  search.set({ open: true }); SFX.open();
}
function closeSearch(backOnFocus = true) {
  if (!search.get().open) return;
  search.set({ open: false });
  if (backOnFocus && before instanceof HTMLElement && document.contains(before)) before.focus();
  before = null;
}
const isCmdK = (e: KeyboardEvent) => (MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK';
// en captura: antes que las terminales y los intercomunicadores (⌘K es del refugio en todas partes)
addEventListener('keydown', e => {
  if (!isCmdK(e)) return;
  e.preventDefault(); e.stopPropagation();
  if (search.get().open) closeSearch(); else openSearch();
}, true);
// con el foco en un navegador (<webview>) las teclas no llegan a la página: Electron manda ⌘K aquí
(window as any).__searchShortcut = () => { if (search.get().open) closeSearch(); else openSearch(); };

// ---------------------------------------------------------------- lo que se puede hacer
// antes de una acción del refugio, se despeja la vista (aparato abierto o intercomunicador delante)
function onShelter() { if (juego.get().panel) juego.set({ panel: null, panelData: null }); minimizeIntercom(); }
const K = MAC ? '⌘' : 'Ctrl+';
interface Action { id: string; text: string; hint?: string; key?: string; keys?: string; f: () => void }
// the tasks with a pre-flight at hand, only those with a PR: those of the copies (worktrees), of your open PRs and then
// of the merged ones (to confirm a task fully landed)
function preflightTasks(): string[] {
  const out = new Set<string>();
  const prs = jiraBoard.get().prs;
  for (const c of juego.get().copies) { const k = c.copy && worktreeTask(c.copy); if (k && taskHasPRs(k, prs)) out.add(k); }
  for (const p of prs) { const k = (p.state === 'abierto' || p.state === 'borrador') && pRKey(p); if (k) out.add(k); }
  for (const p of prs) { const k = p.state === 'fusionado' && pRKey(p); if (k) out.add(k); }
  return [...out].slice(0, 16);
}
const preflightAction = (k: string): Action => ({ id: 'preflight:' + k, text: t('preflight.action', { clave: k }), hint: t('preflight.actionHint'), keys: `preflight pre-flight vuelo checks ci sync revision review bloqueos ${k}`, f: () => openPreflight(k) });   // over whatever is open: nothing closes
function actions(): Action[] {
  const j = juego.get();
  const room = (live.get().state?.rooms ?? []).find((s: any) => s.id === j.currentRoom);
  const coordination = ((live.get().state?.rooms ?? []) as any[]).find(s => s.type === 'coordinacion' && s.path);
  const withFolder =!!room && (room.path || room.folder || ['puente', 'git', 'comunicaciones', 'planificacion', 'logistica'].includes(room.type));
  const toView = sessionInView();
  return [
    ...(toView ? [{ id: 'app-claude', text: t('panels.continueTituloInTheClaude', { titulo: toView.title || t('windows.thisConversation') }), hint: t('panels.itClosesHere'), keys: 'claude app escritorio desktop abrir sacar', f: () => toClaudeApp({ sessionId: toView.id }) },
      { id: 'remote-control', text: t('panels.continueTituloOnYourPhone', { titulo: toView.title || t('windows.thisConversation') }), hint: t('panels.itClosesHere'), keys: 'remote control movil móvil phone telefono teléfono mobile', f: () => takeASurface({ sessions: [toView.id], remote: true }) }] : []),
    { id: 'todo-al-movil', text: t('menu.everythingToYourPhone'), hint: t('menu.openConversationsWithRemoteControl'), keys: 'remote control movil móvil phone telefono teléfono mobile superficie todo', f: () => takeASurface({ all: true, remote: true, windowNew: true }) },
    { id: 'esperan', text: t('panels.goToWhoeverIsWaiting'), key: 'Q', keys: 'pendiente permiso pregunta urgente', f: () => { const h = busy([...j.dwellers, ...j.copies]).find(x => x.state === 'esperando' || x.state === 'error'); if (h) goA(h.room, h.id, true); else SFX.notAllowed(); } },
    { id: 'ocupados', text: t('panels.whoIsBusy'), hint: t('panels.workingWaitingBrokenDown'), key: 'Tab', keys: 'ocupados trabajos estado', f: () => { onShelter(); openPanel('ocupados'); } },
    { id: 'plano', text: t('panels.shelterMap'), hint: t('panels.fastTravelToAnyRoom'), key: 'M', keys: 'mapa viajar salas', f: () => { onShelter(); openPanel('plano'); } },
    { id: 'cuaderno', text: t('panels.logbookOfAConversation'), hint: t('panels.theFullTranscript'), key: 'R', keys: 'transcripcion historial leer', f: () => { onShelter(); openPanel('cuaderno'); } },
    ...(withFolder ? [{ id: 'terminal', text: t('panels.salaTerminal', { sala: room.name }), hint: t('panels.shellInTheRoomS'), key: 'T', keys: 'terminal shell consola pty', f: () => window.dispatchEvent(new CustomEvent('refugio:terminal', { detail: { roomId: room.id } })) }] : []),
    ...(room && (room.type === 'repo' || room.type === 'coordinacion') ? [{ id: 'adaptar', text: t('panels.adaptSalaToTheRepo', { sala: room.name }), hint: t('panels.itsDwellerDesignsAScene'), keys: 'decorar decorado escena sala personalizar atrezo', f: () => { onShelter(); adaptRoom(room.id).catch(() => SFX.error()); } }] : []),
    { id: 'git', text: t('panels.versionControl'), hint: t('panels.changesCommitsBranchesAndGithub'), key: 'G', keys: 'git github commit rama pull push pr', f: () => openGitOfRoom(j.currentRoom) },
    { id: 'comunicaciones', text: t('world.communications'), hint: t('panels.emailAndChats'), key: 'N', keys: 'correo mail chats avisos notificaciones tablon', f: () => { onShelter(); goA('comunicaciones'); } },
    { id: 'planificacion', text: t('world.calendar'), hint: t('panels.calendarAndMeetings'), key: 'C', keys: 'calendario agenda reuniones eventos', f: () => { onShelter(); goA('planificacion'); } },
    { id: 'organizar', text: t('panels.organizeTheRoomsByTasks'), hint: t('panels.aWorktreeAndAConversation'), keys: 'organizar worktree worktrees tareas pr prs pull requests salas sesiones stack apilados', f: () => { onShelter(); openPanel('organizar'); } },
    { id: 'prs', text: t('panels.pullRequests'), hint: t('panels.yourPrsAndThoseAwaiting'), keys: 'pr prs pull requests revisiones review github', f: () => openGit({ view: 'prs' }) },
    { id: 'revision', text: t('reviews.boardAction', { n: live.get().reviews.reviews.filter(r => r.column === 'review').length }), hint: t('reviews.goToRoomHint'), keys: 'revision revisar review reviews pr prs pull requests otros aprobar cambios', f: () => { onShelter(); goA('review'); openPanel('revision', { roomId: 'review' }); } },
    { id: 'sala-revision', text: t('reviews.goToRoom'), hint: t('world.prsAwaitingYourReview'), keys: 'revision review sala hologramas', f: () => { onShelter(); goA('review'); } },
    { id: 'logistica', text: t('world.planning'), hint: t('panels.jiraBoard'), key: 'L', keys: 'jira linear tareas issues tablero', f: () => { onShelter(); goA('logistica'); } },
    { id: 'bitacora', text: t('worklog.menu'), hint: t('world.planning'), keys: 'sync update su bitacora log diario standup hecho tareas pr worktrees', f: () => { onShelter(); goA('logistica'); openPanel('logistica', { view: 'bitacora' }); } },
    { id: 'verificar-escalera', text: t('trophies.verify.menu'), hint: t('trophies.verify.hint'), keys: 'verificar escalera carrera nivel career ladder level verify', f: () => { onShelter(); verifyLadder().catch(() => SFX.notAllowed()); } },
    { id: 'trofeos', text: t('trophies.menu'), hint: t('panels.planning'), keys: 'trofeos logros carrera escalera career ladder trophies achievements', f: () => { onShelter(); goA('logistica'); openPanel('logistica', { view: 'trofeos' }); } },
    ...(coordination ? [{ id: 'reparto', text: t('panels.planTasksInSala', { sala: coordination.name }), hint: t('panels.analyzeAJiraTaskWith'), keys: 'jira tareas planificar planificacion plan repartir reparto coordinacion worktrees salas', f: () => { onShelter(); goA(coordination.id); openPanel('sala', { roomId: coordination.id, view: 'reparto' }); } },
      { id: 'despliegue', text: t('world.deploymentPlan2'), hint: t('panels.yourPrsByStatusAnd', { sala: coordination.name }), keys: 'despliegue deploy desplegar pr prs pull requests bloqueos dependencias orden fusionar merge', f: () => { onShelter(); goA(coordination.id); openPanel('sala', { roomId: coordination.id, view: 'despliegue' }); } }] : []),
    ...preflightTasks().map(preflightAction),
    { id: 'musica', text: t('panels.music'), hint: t('panels.spotifyAndTheDeck'), key: `${K}J`, keys: 'spotify musica discoteca pletina', f: () => musicShortcut() },
    { id: 'recargar', text: t('menu.reloadTheView'), hint: t('menu.ifTheShelterGoesBlack'), keys: 'negro pantalla recargar reload refrescar', f: () => reloadView() },
    { id: 'barra', text: t('panels.openWindows'), hint: t('panels.theBarAtTheBottom'), key: `${K}B`, keys: 'barra ventanas minimizadas', f: () => enterBar() },
    { id: 'chapa', text: t('world.bodyShop'), hint: t('panels.changeYourLookOrA'), key: 'P', keys: 'aspecto ropa pelo probador personaje', f: () => { onShelter(); openPanel('chapa'); } },
    { id: 'inventario', text: t('panels.inventoryAndShop'), key: 'I', keys: 'tienda chatarra accesorios guia', f: () => { onShelter(); openPanel('inventario'); } },
    { id: 'camara', text: t('world.vault'), hint: t('panels.credentialsIntegrationsAndShelterSettings'), keys: 'credenciales claves integraciones ajustes llavero limite sesiones raiz repos atuendo', f: () => { onShelter(); goA('camara'); openPanel('camara'); } },
    { id: 'web-linear', text: t('panels.openLinear'), hint: t('panels.web'), keys: 'navegador web', f: () => openBrowser('linear') },
    { id: 'web-outlook', text: t('panels.openOutlook'), hint: t('panels.web'), keys: 'navegador web correo mail', f: () => openBrowser('outlook') },
    { id: 'web-discord', text: t('panels.openDiscord'), hint: t('panels.web'), keys: 'navegador web chat', f: () => openBrowser('discord') },
    { id: 'web-slack', text: t('panels.openSlack'), hint: t('panels.web'), keys: 'navegador web chat', f: () => openBrowser('slack') },
    { id: 'web-github', text: t('panels.openGithub'), hint: t('panels.web'), keys: 'navegador web notificaciones', f: () => openBrowser('github') },
  ];
}

// ---------------------------------------------------------------- búsqueda
const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// cada palabra escrita tiene que estar en el texto (o en sus claves); puntúa más empezar palabra y estar en el título
function score(q: string[], title: string, rest = ''): number {
  if (!q.length) return 1;
  const t = normal(title), r = normal(rest);
  let p = 0;
  for (const w of q) {
    const i = t.indexOf(w);
    if (i >= 0) p += 3 + (i === 0 || /\W/.test(t[i - 1]) ? 2 : 0);
    else if (r.includes(w)) p += 1;
    else return 0;
  }
  return p;
}
const USES = 'refugio.buscador.usos';
const uses = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(USES) || '{}'); } catch { return {}; } };
function log(id: string) { try { const u = uses(); u[id] = (u[id] ?? 0) + 1; localStorage.setItem(USES, JSON.stringify(u)); } catch {} }

interface Row { id: string; section: string; text: string; hint?: string; key?: string; state?: string; f: () => void; p: number }
const STATE_ORDER: Record<string, number> = { esperando: 0, error: 1, trabajando: 2, arrancando: 2, terminada: 3, ociosa: 4 };
const TXT_STATE: Record<string, string> = { esperando: 'te espera', error: 'avería', trabajando: 'trabajando', arrancando: 'arrancando', terminada: 'terminado', ociosa: 'listo' };

export function Search() {
  const open = search.use(e => e.open);
  return open ? <Window /> : null;
}

function Window() {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const [recent, setRecent] = useState<RecentConversation[] | null>(recentLast);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const sessions = live.use(e => e.sessions);
  const dwellers = juego.use(e => e.dwellers);
  const copies = juego.use(e => e.copies);
  const rooms: any[] = live.use(e => e.state?.rooms ?? []);
  const scheduled = live.use(e => e.scheduled);
  useEffect(() => { input.current?.focus(); client.action<RecentConversation[]>('conversations.recent', { limit: 20 }).then(r => { recentLast = r; setRecent(r); }).catch(() => setRecent(x => x ?? [])); }, []);

  const rows = useMemo<Row[]>(() => {
    const words = normal(q).split(/\s+/).filter(Boolean);
    const searching = words.length > 0;
    const nameOf = (hid: string) => [...dwellers, ...copies].find(h => h.id === hid);
    const out: Row[] = [];
    // conversaciones abiertas: las que te esperan, delante
    const openSessions = Object.values(sessions).filter(s => s.state !== 'cerrada').sort((a, b) => (STATE_ORDER[a.state] ?? 5) - (STATE_ORDER[b.state] ?? 5) || recentFirst(sessionRecency(a), sessionRecency(b)));
    for (const s of openSessions as SessionSummary[]) {
      const h = nameOf(sessionOwner(s));
      const p = score(words, s.title, `${h?.name ?? ''} ${h?.nameRoom ?? ''} conversacion chat`);
      if (p) out.push({ id: 'ses:' + s.id, section: t('panels.searchOpenConversations'), text: s.title || t('windows.conversation'), hint: `${h?.name ?? '?'} · ${h?.nameRoom ?? ''}`, state: s.state, f: () => openConversation(s.id), p: p + 2 });
    }
    // recientes del archivo (las que no están abiertas ya)
    const liveIds = new Set(openSessions.map(s => s.claudeId).filter(Boolean));
    let n = 0;
    for (const r of recent ?? []) {
      if (liveIds.has(r.claudeId) || r.inProgress) continue;
      const h = dwellers.find(x => x.id === r.dwellerId);
      const p = score(words, r.title, `${h?.name ?? ''} ${h?.nameRoom ?? ''} ${r.branch ?? ''} conversacion chat reciente`);
      if (!p || (!searching && n >= 6)) continue;
      n++;
      out.push({ id: 'rec:' + r.claudeId, section: t('panels.searchRecentConversations'), text: r.title, hint: `${h?.name ?? ''} · ${h?.nameRoom ?? ''} · ${ago(r.modified)}${r.outside ? ' · ' + t('windows.openOnYourDesktop') : ''}`,
        f: () => { if (r.outside) { SFX.notAllowed(); addNotice('aviso', t('panels.thatConversationIsStillOpen')); return; } onShelter(); resumeConversation(r.dwellerId, r); }, p });
    }
    // mensajes programados (server/scheduled.ts): cuándo, quién y a dónde; Enter abre la conversación que lo
    // programó si sigue abierta o, si no, lleva con su habitante (cancelarlos o cambiarlos, en su intercomunicador)
    for (const x of scheduled) {
      const room = rooms.find(y => y.id === x.origin.roomId), h = dwellers.find(y => y.room === x.origin.roomId);
      const p = score(words, x.message, `${h?.name ?? ''} ${room?.name ?? ''} ${describeWhen(x.when)} programado programados mensaje recordatorio scheduled reminder`);
      if (!p) continue;
      const open = Object.values(sessions).find(y => y.state !== 'cerrada' && ((x.origin.claudeId && y.claudeId === x.origin.claudeId) || y.id === x.origin.sessionId));
      out.push({ id: 'prog:' + x.id, section: t('panels.scheduledMessages'), text: x.message.replace(/\s+/g, ' ').slice(0, 140),
        hint: t('panels.scheduledFor', { cuando: describeWhenShort(x.when), habitante: h?.name ?? '?', sala: room?.name ?? x.origin.roomId }) + (x.target.type === 'sala' ? ' ' + t('panels.scheduledToRoom', { sala: x.target.room }) : ''),
        f: () => { if (open) openConversation(open.id); else if (h) { onShelter(); goA(h.room, h.id, true); } }, p: p + 1 });
    }
    // acciones: sin escribir, las recurrentes (las que más usas) delante
    const u = uses();
    const acc = actions().map(a => ({ a, p: score(words, a.text, `${a.hint ?? ''} ${a.keys ?? ''} ${a.key ?? ''}`) })).filter(x => x.p);
    if (!searching) acc.sort((x, y) => (u[y.a.id] ?? 0) - (u[x.a.id] ?? 0));
    for (const { a, p } of acc) out.push({ id: a.id, section: !searching && (u[a.id] ?? 0) > 0 ? t('panels.searchFrequentActions') : t('windows.actions'), text: a.text, hint: a.hint, key: a.key, f: a.f, p: p + (u[a.id] ?? 0) * 0.01 });
    // a typed key («pre-flight abc-12») with a PR, even beyond the ones listed
    const typed = words.find(w => /^[a-z][a-z0-9]+-\d+$/.test(w))?.toUpperCase();
    if (typed && taskHasPRs(typed, jiraBoard.get().prs) && !out.some(f => f.id === 'preflight:' + typed)) { const a = preflightAction(typed); out.push({ id: a.id, section: t('windows.actions'), text: a.text, hint: a.hint, f: a.f, p: 4 }); }
    if (searching) {
      for (const h of dwellers) { const p = score(words, t('windows.talkToNombre', { nombre: h.name }), `${h.nickname} ${h.nameRoom} habitante`); if (p) out.push({ id: 'hab:' + h.id, section: t('panels.dwellers'), text: t('windows.talkToNombre', { nombre: h.name }), hint: h.nameRoom, f: () => { onShelter(); goA(h.room, h.id, true); }, p }); }
      for (const s of rooms) { const p = score(words, t('panels.goToSala', { sala: s.name }), `${s.type} sala`); if (p) out.push({ id: 'sala:' + s.id, section: t('panels.searchRooms'), text: t('panels.goToSala', { sala: s.name }), hint: s.path ? s.path.replace(/^\/Users\/[^/]+/, '~') : undefined, f: () => { onShelter(); goA(s.id); }, p }); }
    }
    // con algo escrito, por secciones en el orden de la mejor de cada una
    if (!searching) return out;
    const best = new Map<string, number>();
    for (const f of out) best.set(f.section, Math.max(best.get(f.section) ?? 0, f.p));
    return out.sort((a, b) => (best.get(b.section)! - best.get(a.section)!) || (a.section === b.section ? b.p - a.p : a.section.localeCompare(b.section))).slice(0, 40);
  }, [q, sessions, recent, dwellers, copies, rooms, scheduled]);

  useEffect(() => { setI(0); }, [q]);
  useEffect(() => { list.current?.querySelector('.fila-buscador.activa')?.scrollIntoView({ block: 'nearest' }); }, [i]);
  const pick = (k: number) => { const f = rows[k]; if (!f) { SFX.notAllowed(); return; } log(f.id.startsWith('ses:') || f.id.startsWith('rec:') ? 'conversaciones' : f.id); closeSearch(false); SFX.click(); f.f(); };

  return (
    <div className="fondo-buscador interactivo" onMouseDown={e => { if (e.target === e.currentTarget) closeSearch(); }}>
      <div className="buscador" role="dialog" aria-label={t('panels.shelterSearch')}>
        <div className="buscador-cabeza">
          <span className="prompt-sim">&gt;</span>
          <input ref={input} value={q} placeholder={t('panels.searchConversationsActionsDwellersOr')} spellCheck={false}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSearch(); }
              else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); setI(x => Math.min(rows.length - 1, x + 1)); SFX.tick(); }
              else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); setI(x => Math.max(0, x - 1)); SFX.tick(); }
              else if (e.key === 'PageDown') { e.preventDefault(); setI(x => Math.min(rows.length - 1, x + 8)); }
              else if (e.key === 'PageUp') { e.preventDefault(); setI(x => Math.max(0, x - 8)); }
              else if (e.key === 'Enter') { e.preventDefault(); pick(i); }
              e.stopPropagation();
            }} />
          <span className="tecla">{K}K</span>
        </div>
        <div className="buscador-lista" ref={list}>
          {rows.map((f, k) => (
            <div key={f.id}>
              {(k === 0 || rows[k - 1].section !== f.section) && <div className="seccion-buscador">{f.section}{f.section === t('panels.searchRecentConversations') && recent === null ? ' · ' + t('panels.searching') : ''}</div>}
              <div className={'fila-buscador' + (k === i ? ' activa' : '')} onMouseMove={() => { if (k !== i) setI(k); }} onClick={() => pick(k)}>
                {f.state && <span className={'piloto ' + (f.state === 'esperando' ? 'esperando' : f.state === 'error' ? 'error' : f.state === 'trabajando' || f.state === 'arrancando' ? 'trabajando' : 'ociosa')} />}
                <span className="txt">{f.text}</span>
                {f.hint && <span className="pista">{f.hint}{f.state ? ` · ${tIs(TXT_STATE[f.state] ?? f.state)}` : ''}</span>}
                {f.key && <span className="tecla">{f.key}</span>}
              </div>
            </div>
          ))}
          {!rows.length && <p className="tenue vacio-buscador">{t('panels.nothingForQTryAnother', { q })}</p>}
        </div>
        <div className="ayuda-consola"><kbd>↑↓</kbd> {t('menu.select')} <kbd>Enter</kbd> {t('windows.open')} <kbd>Esc</kbd> {t('menu.close')} <span className="tenue">· {t('panels.gameStuffOptionsRestartQuit')}</span> <kbd>Esc</kbd></div>
      </div>
    </div>
  );
}
