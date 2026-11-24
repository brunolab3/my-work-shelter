// Salas operativas: tablón de comunicaciones (todas las fuentes en un solo feed), calendario unificado (Microsoft 365
// y Google Calendar) y Logística (tareas de Jira con sus pull requests, y Linear). Solo lectura: se abre el original con Enter, en su navegador del refugio.
// The one exception is the Jira board, which moves a task to another status after the Overseer confirms it.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { juego } from './gameState';
import { t, language, tIs } from '@shared/language';
import { live, client } from '../net/client';
import { SFX } from '../audio/sound';
import { Device, Keys, closePanel, useKeys } from './device';
import { goA } from './Panels';
import { describeWhenShort, describeWhen } from '@shared/scheduled';
import { openBrowser, openLink, openNotice, SPOTS } from './Browsers';
import { SOURCES as IDS_SOURCES, ACTIVE_SOURCES, CALENDAR_SOURCES, INFO_SOURCE, active } from '@shared/sources';
import { PLANNING_ROOM } from '@shared/layout';
import { openGit } from './git/window';
import { openPreflight } from './Preflight';
import { taskHasPRs } from '@shared/preflight';
import { taskColor, pRTask } from '@shared/tasks';
import { aimColors, knowTasks, useColorsTasks, jiraBoard } from './tasks';
import { crossBoard, columnOf, COLUMN_COLORS, COLUMNS, prText, planPrompt, type BoardColumn, type JiraTransition, type PRBoard, type TaskWithPR, type TaskJira } from '@shared/board';
import { EpicMark } from './windows';
import { WorkLog, verifyLadder } from './WorkLog';

const SOURCES: Record<string, string> = Object.fromEntries(IDS_SOURCES.map(f => [f, INFO_SOURCE[f].short]));
const LOC = language() === 'en' ? 'en-GB' : 'es-ES';
const fmtHour = new Intl.DateTimeFormat(LOC, { hour: '2-digit', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat(LOC, { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDayShort = new Intl.DateTimeFormat(LOC, { weekday: 'short', day: 'numeric' });
function ago(ts: number) { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? t('windows.now') : m < 60 ? t('windows.nMinAgo', { n: m }) : m < 1440 ? t('windows.nHAgo', { n: Math.round(m / 60) }) : t('windows.nDAgo', { n: Math.round(m / 1440) }); }
// Cada aviso del tablón es una conversación (el servidor junta los mensajes: canal de Discord o Slack, hilo de correo,
// issue de Linear, hilo de GitHub). Las fuentes «completas» dicen qué está sin leer allí: lo leído allí sale solo.
const WITH_READ = new Set<string>(IDS_SOURCES.filter(f => INFO_SOURCE[f].complete));
const isChat = (n: any) => !!INFO_SOURCE[n.source as keyof typeof INFO_SOURCE]?.chat;
// fila: en los chats, la conversación y el último mensaje; en correo y Linear, quién y el asunto
const row = (n: any) => isChat(n) ? [n.title, n.title === n.author ? n.snippet : `${n.author}: ${n.snippet}`] : [n.author, n.title];
// lo que tiene navegador propio en el refugio (ver SITIOS en Browsers.tsx) se abre dentro; el resto, fuera
const openOutside = (url?: string) => openLink(url);

// ---------------------------------------------------------------- comunicaciones
export function PanelCommunications({ onlySource }: { onlySource?: string } = {}) {
  const all: any[] = live.use(e => e.notifications);
  const ints = live.use(e => e.integrations);
  const filters: string[] = onlySource ? [onlySource] : ['todas', ...ACTIVE_SOURCES.filter(x => !INFO_SOURCE[x].withoutNotices)];
  // 1–9: entrar a la web de cada fuente en su navegador del refugio, sin pasar por un aviso
  const webs = onlySource ? [] : filters.filter(x => SPOTS[x]);
  const [f, setF] = useState(0);
  const [onlyNew, setOnlyNew] = useState(false);
  const [i, setI] = useState(0);
  const list = useMemo(() => all.filter(n => (filters[f] === 'todas' || n.source === filters[f]) && (!onlyNew || !n.view)), [all, f, onlyNew]);
  const sel = list[Math.min(i, list.length - 1)];
  useEffect(() => { if (sel && !sel.view) { const tm = setTimeout(() => client.action('integracion.marcarVista', { ids: sel.ids ?? [sel.id] }).catch(() => {}), 1200); return () => clearTimeout(tm); } }, [sel?.id]);
  useKeys(e => {
    if (e.code === 'Escape') closePanel();
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(x => Math.min(list.length - 1, x + 1)); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(x => Math.max(0, x - 1)); SFX.tick(); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { setF(x => (x + 1) % filters.length); setI(0); SFX.tick(); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { setF(x => (x - 1 + filters.length) % filters.length); setI(0); SFX.tick(); }
    else if ((e.code === 'Enter' || e.code === 'KeyE') && sel) openNotice(sel);
    else if (e.code === 'KeyN') { setOnlyNew(x => !x); setI(0); SFX.toggle(); }
    else if (e.code === 'KeyV') { client.action('integracion.marcarVista', { ids: list.filter(n => !n.view).flatMap(n => n.ids ?? [n.id]) }); SFX.shortSuccess(); }
    else if (/^Digit[1-9]$/.test(e.code) && webs[+e.code.slice(5) - 1]) openBrowser(webs[+e.code.slice(5) - 1]);
  }, [list, sel, f]);
  const withoutSee = (fu: string) => all.filter(n => !n.view && (fu === 'todas' || n.source === fu)).length;
  return (
    <Device label={onlySource ? t('panels.planningFuente', { fuente: SOURCES[onlySource].toUpperCase() }) : t('panels.communicationsNoticeBoard')} width={78} height pilot={withoutSee('todas') ? 'esperando' : 'ociosa'}>
      {!onlySource && <div className="pestanas">{filters.map((x, k) => <button key={x} className={'chip' + (k === f ? ' on' : '')} onClick={() => { setF(k); setI(0); }}>{x === 'todas' ? t('panels.all') : SOURCES[x]}{withoutSee(x) ? ' · ' + t('panels.nUnseen', { n: withoutSee(x) }) : ''}{x !== 'todas' && ints[x]?.state === 'demo' ? ' ' + t('panels.demo') : ''}</button>)}
        <span className="tenue derecha">{onlyNew ? t('panels.onlyUnseen') : t('panels.all2')} · {t('panels.nToggles')}</span></div>}
      <div className="feed">
        <ul className="feed-lista lista-desplazable">
          {list.map((n, k) => (
            <li key={n.id} className={'aviso-' + n.priority + (k === i ? ' activa' : '') + (n.view ? ' vista' : '')} onMouseEnter={() => setI(k)} onClick={() => { setI(k); }} onDoubleClick={() => openNotice(n)} ref={el => { if (k === i) el?.scrollIntoView({ block: 'nearest' }); }}>
              <span className={'fuente f-' + n.source}>{SOURCES[n.source]}</span>
              <span className="quien">{row(n)[0]}</span>
              <span className="titulo">{row(n)[1]}</span>
              <span className="cuando">{n.count > 1 && <b className="cuantos">{n.count}</b>}{ago(n.date)}</span>
            </li>
          ))}
          {!list.length && <li className="vacio tenue">{onlyNew || !all.length ? t('panels.allCaughtUpNothingPending') : t('panels.nothingHere')}</li>}
        </ul>
        <div className="feed-detalle">
          {sel ? <>
            <div className="tenue">{SOURCES[sel.source]}{sel.channel ? ' · ' + sel.channel : ''} · {fmtDay.format(sel.date)} {fmtHour.format(sel.date)}{sel.demo ? ' · DEMO' : ''}</div>
            <div className="titulo-ficha">{sel.title}</div>
            {(sel.count ?? 1) > 1 && <p className="tenue">{sel.count} {WITH_READ.has(sel.source) ? t('panels.unreadInFuente', { fuente: SOURCES[sel.source] }) : t('panels.messages')}{sel.authors?.length > 1 ? ' · ' + sel.authors.join(', ') : ''}</p>}
            {sel.priority === 'alta' && <p className="aviso-consola">{t('panels.highPriority')}</p>}
            {sel.count > (sel.messages?.length ?? 1) && <p className="tenue">{t('panels.andNEarlier', { n: sel.count - sel.messages.length })}</p>}
            <ul className="hilo">{[...(sel.messages ?? [{ id: sel.id, author: sel.author, text: sel.snippet, date: sel.date }])].reverse().map((m: any) => (
              <li key={m.id}><b>{m.author}</b> <span className="tenue">{fmtHour.format(m.date)}</span><p className="fragmento">{m.text}</p></li>))}</ul>
            {sel.link ? <p className="tenue">{isChat(sel) ? t('panels.enterOpensTheConversationIn', { fuente: SOURCES[sel.source] }) : t('panels.enterOpensTheOriginalIn', { fuente: SOURCES[sel.source] })}{WITH_READ.has(sel.source) && !sel.demo ? ' ' + t('panels.onceYouReadItThere') : ''} {t('panels.theBoardIsReadOnly')}</p> : null}
          </> : null}
        </div>
      </div>
      {webs.length > 0 && <div className="botonera abrir-webs"><span className="tenue">{t('panels.openHere')}</span>{webs.map((x, k) => <button key={x} className="boton-taller" onClick={() => openBrowser(x)} title={t('panels.openSitioInItsShelter', { sitio: SPOTS[x].name, k: k + 1 })}>{k + 1} · {SPOTS[x].name}</button>)}</div>}
      <Keys><kbd>↑↓</kbd>{t('panels.notices')} {!onlySource && <><kbd>←→</kbd>{t('panels.source')} </>}<kbd>Enter</kbd>{t('panels.openTheOriginal')} <kbd>N</kbd>{t('panels.onlyUnseen2')} <kbd>V</kbd>{t('panels.markAllSeen')} {webs.length > 0 && <><kbd>1–{webs.length}</kbd>{t('panels.openTheWeb')} </>}<kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- calendario unificado
export function PanelPlanning() {
  const events: any[] = live.use(e => e.events);
  const scheduled = live.use(e => e.scheduled);
  const rooms: any[] = live.use(e => e.state?.rooms ?? []);
  const [day, setDay] = useState(0);
  const [i, setI] = useState(0);
  const dayStart = (k: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + k); return d.getTime(); };
  const days = Array.from({ length: 7 }, (_, k) => dayStart(k));
  const dayOf = (ts: number) => events.filter(ev => ev.start < ts + 86400_000 && ev.end > ts).sort((a, b) => a.start - b.start);
  const list = dayOf(days[day]);
  const sel = list[Math.min(i, list.length - 1)];
  const now = Date.now();
  const next = events.filter(ev => ev.end > now).sort((a, b) => a.start - b.start)[0];
  const [agenda, setAgenda] = useState(false);
  const [notice, setNotice] = useState('');
  const refresh = async () => { setNotice(t('panels.readingCalendars')); await Promise.all(CALENDAR_SOURCES.map(f => client.action('integracion.refrescar', { source: f }).catch(() => {}))); setNotice(t('panels.upToDate')); SFX.shortSuccess(); };
  useKeys(e => {
    if (e.code === 'Escape') closePanel();
    else if (e.code === 'KeyA') { setAgenda(x => !x); SFX.toggle(); }
    else if (e.code === 'KeyR') refresh();
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { setDay(d => Math.min(6, d + 1)); setI(0); SFX.tick(); }
    else if (e.code === 'ArrowLeft') { setDay(d => Math.max(0, d - 1)); setI(0); SFX.tick(); }   // (la A es agenda/semana)
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(x => Math.min(list.length - 1, x + 1)); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(x => Math.max(0, x - 1)); SFX.tick(); }
    else if ((e.code === 'Enter' || e.code === 'KeyE') && sel) sel.videollamada ? openOutside(sel.videollamada) : openNotice(sel);
  }, [list, sel]);
  return (
    <Device label={t('panels.agendaCalendar')} width={80}>
      <p>{next ? <>{t('panels.next')} <b>{next.title}</b> <span className="tenue">· {next.start <= now ? t('windows.justNow') : fmtDayShort.format(next.start) + ' ' + fmtHour.format(next.start)} · {SOURCES[next.source]}</span></> : <span className="tenue">{t('panels.noUpcomingEvents')}</span>}</p>
      {notice && <p className="tenue">{notice}</p>}
      {agenda ? <ul className="agenda">{events.filter(ev => ev.end > now).sort((a, b) => a.start - b.start).slice(0, 14).map(ev => (
        <li key={ev.id} className={'f-' + ev.source + (ev.start <= now ? ' ahora' : '')} onDoubleClick={() => (ev.videollamada ? openOutside(ev.videollamada) : openNotice(ev))}>
          <span className="cuando">{ev.start <= now ? t('windows.now') : ev.start - now < 3600_000 ? t('panels.inNMin', { n: Math.round((ev.start - now) / 60000) }) : fmtDayShort.format(ev.start) + ' ' + fmtHour.format(ev.start)}</span>
          <b>{ev.title}</b> <span className="tenue">{SOURCES[ev.source]}{ev.videollamada ? ' · ' + t('panels.videoCall') : ''}</span>
        </li>))}</ul> :
      <div className="semana">
        {days.map((ts, k) => (
          <div key={ts} className={'dia' + (k === day ? ' activa' : '') + (k === 0 ? ' hoy' : '')} onClick={() => { setDay(k); setI(0); }}>
            <div className="cab">{k === 0 ? t('panels.today') : k === 1 ? t('panels.tomorrow') : fmtDayShort.format(ts)}</div>
            {dayOf(ts).map((ev, j) => (
              <div key={ev.id} className={'ev f-' + ev.source + (k === day && j === Math.min(i, list.length - 1) ? ' sel' : '') + (ev.end < now ? ' pasado' : '') + (ev.start <= now && ev.end > now ? ' ahora' : '')} onMouseEnter={() => { if (k === day) setI(j); }}>
                <span className="h">{ev.allDay ? t('panels.allDay') : fmtHour.format(ev.start)}</span> {ev.title}
              </div>
            ))}
          </div>
        ))}
      </div>
      }
      {!agenda && sel && <div className="detalle-evento">
        <div className="titulo-ficha">{sel.title}</div>
        <p>{fmtDay.format(sel.start)} · {sel.allDay ? t('panels.allDay') : `${fmtHour.format(sel.start)}–${fmtHour.format(sel.end)}`} <span className="tenue">· {SOURCES[sel.source]}{sel.demo ? ' · DEMO' : ''}</span></p>
        {sel.organizer && <p className="tenue">{t('panels.organizer')} {sel.organizer}</p>}
        {sel.place && <p className="tenue">{t('panels.location')} {sel.place}</p>}
        {sel.videollamada && <p>{t('panels.videoCallPressEnterTo')}</p>}
      </div>}
      {/* los mensajes que los habitantes han dejado para más adelante (server/scheduled.ts) */}
      {scheduled.length > 0 && <>
        <p className="tenue">⏰ {t('panels.scheduledMessages')}</p>
        <ul className="agenda">{scheduled.slice(0, 10).map(x => (
          <li key={x.id} title={x.message}>
            <span className="cuando" title={describeWhen(x.when)}>{describeWhenShort(x.when)}</span>
            <b>{rooms.find(y => y.id === x.origin.roomId)?.name ?? x.origin.roomId}</b>{x.target.type === 'sala' ? ' ' + t('panels.scheduledToRoom', { sala: x.target.room }) : ''} <span className="tenue">{x.message.replace(/\s+/g, ' ').slice(0, 90)}</span>
          </li>))}</ul>
      </>}
      <Keys><kbd>←→</kbd>{t('panels.day')} <kbd>↑↓</kbd>{t('panels.event')} <kbd>Enter</kbd>{t('panels.joinOrOpen')} <kbd>A</kbd>{agenda ? t('panels.week') : t('panels.agenda')} <kbd>R</kbd>{t('panels.refresh')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- Logística (Jira y PR, Linear)
export function PanelLogistics() {
  const st = live.use(e => e.integrations.jira);
  const commander = juego.use(e => e.dwellers.find(h => h.room === 'logistica'));
  const withLinear = active('linear');
  const direct0 = juego.get().panelData?.view;
  const [view, setView] = useState<'jira' | 'tablero' | 'menu' | 'avisos' | 'bitacora'>(() => (direct0 === 'jira' || direct0 === 'bitacora' ? direct0 : 'menu'));   // clic en la pantalla de la pared: directo al tablero
  // abierto directamente (la pantalla de la pared, ⌘K): al cerrarlo se vuelve al refugio, no al menú de la consola
  const [direct] = useState(() => direct0 === 'jira' || direct0 === 'bitacora');
  const onMenu = () => (direct ? closePanel() : setView('menu'));
  const [notice, setNotice] = useState('');
  const items = [
    { text: t('panels.boardMyJiraTasksAnd'), f: () => setView('jira') },
    { text: t('worklog.menu'), f: () => setView('bitacora') },
    { text: t('trophies.verify.menu'), f: () => { setNotice(''); verifyLadder().catch(e => { SFX.notAllowed(); setNotice(e.message); }); } },
    ...(withLinear ? [
      { text: t('panels.openLinearRightHere'), f: () => { closePanel(); openBrowser('linear'); } },
      { text: t('panels.linearMyIssuesByStatus'), f: () => setView('tablero') },
      { text: t('panels.linearNotices'), f: () => setView('avisos') },
    ] : []),
    ...(commander ? [{ text: t('windows.talkToNombre', { nombre: commander.name }) + (withLinear ? t('panels.createMoveOrCommentOn') : ''), f: () => { closePanel(); goA('logistica', commander.id, true); } }] : []),
  ];
  const [i, setI] = useState(0);
  useKeys(e => {
    if (view !== 'menu') return false;
    if (e.code === 'Escape') closePanel();
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') setI(x => (x + 1) % items.length);
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') setI(x => (x - 1 + items.length) % items.length);
    else if (e.code === 'Enter' || e.code === 'KeyE') { SFX.click(); items[i].f(); }
  }, [view, i]);
  if (view === 'jira') return <JiraBoard goBack={onMenu} />;
  if (view === 'bitacora') return <WorkLog goBack={onMenu} />;
  if (view === 'avisos') return <PanelCommunications onlySource="linear" />;
  if (view === 'tablero') return <BoardLinear goBack={() => setView('menu')} />;
  return (
    <Device label={t('panels.planning')} width={56} pilot={st?.state === 'conectada' ? 'trabajando' : 'esperando'}>
      <p className="voz">{withLinear ? t('panels.theBoardsShowWhatJira') : t('panels.theBoardShowsYourJira')}</p>
      {notice && <p className="aviso-consola">{notice}</p>}
      <ul className="opciones-consola">{items.map((it, k) => <li key={k} className={k === i ? 'activa' : ''} onMouseEnter={() => setI(k)} onClick={() => it.f()}><span className="cursor">{k === i ? '▶' : ' '}</span><span>{it.text}</span></li>)}</ul>
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.use')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- planificar una tarea en la sala de planificación
// La sala de planificación (tipo 'coordinacion'; la agenda es otra) es una sala de serie con la raíz de repos del refugio
// (SALA_PLANIFICACION; también puede haber otras, de carpetas con varios repos reclutadas en la Puerta): su habitante ve
// todos los repos, planifica la tarea con el Supervisor (empieza en modo plan) y, con el plan aprobado, la reparte a la
// sala de cada repo, cada parte en su worktree (server/dispatch.ts)
export const coordinationRooms = (): any[] => ((live.get().state?.rooms ?? []) as any[]).filter(s => s.type === 'coordinacion' && s.path)
  .sort((a, b) => Number(b.id === PLANNING_ROOM) - Number(a.id === PLANNING_ROOM));
export async function planTask(task: TaskJira, roomId?: string): Promise<string | null> {
  const room = coordinationRooms().find(s => !roomId || s.id === roomId);
  if (!room) return t('panels.thereIsNoLogisticsRoom');
  const h = ((live.get().state?.dwellers ?? []) as any[]).find(x => x.roomId === room.id);
  if (!h) return t('panels.theRoomSalaHasNo', { sala: room.name });
  // con la descripción, si Jira la da (en DEMO no hay)
  const complete = await client.action<TaskJira & { description?: string }>('integracion.tarea', { source: 'jira', key: task.key }).catch(() => task);
  client.send({ t: 'empezar', dwellerId: h.id, roomId: room.id, prompt: planPrompt(complete), options: { permissions: 'plan' } });
  SFX.shortSuccess(); closePanel(); goA(room.id, h.id, true);
  return null;
}
// las salas que trabajan ya en una tarea: sus conversaciones empiezan por la clave (la planificación y el reparto)
const inRunning = (sessions: Record<string, any>, key: string) => [...new Set(Object.values(sessions).filter((s: any) => s.state !== 'cerrada' && String(s.title ?? '').startsWith(key + ' ')).map((s: any) => s.roomId as string))];

// ---------------------------------------------------------------- tablero de Jira: mis tareas por estado con sus PR
// Columnas Por hacer / En curso / En revisión / Hecho, cada ficha con sus PR (por la clave de Jira de la rama o el título).
// La lista de PR está en Control de Versiones (pestaña Pull requests del cliente de git). Dragging a card to another
// column (or ⇧←→) asks Jira which of its workflow's transitions lead there and, once the Overseer confirms one, applies
// it (the connector's `mover`, the only write to Jira).
const KIND_PR: Record<PRBoard['state'], string> = { abierto: 'pr-abierto', borrador: 'pr-borrador', fusionado: 'pr-fusionado', cerrado: 'pr-cerrado' };
export const trTextPR = (p: PRBoard) => prText(p).split(' · ').map(x => tIs(x)).join(' · ');
const prBadge = (p: PRBoard) => <span className={'insignia-pr ' + KIND_PR[p.state] + (p.state === 'abierto' && p.review === 'CHANGES_REQUESTED' ? ' pr-cambios' : '') + (p.checks === 'FAILURE' || p.checks === 'ERROR' ? ' pr-ci-mal' : '')} title={`${p.repo}#${p.number} · ${trTextPR(p)}`}>#{p.number} {trTextPR(p)}</span>;
// coordinacion: el tablero abierto desde una sala de coordinación (P planifica ahí; si no, en la primera que haya)
export function JiraBoard({ goBack, coordination }: { goBack: () => void; coordination?: string }) {
  const ints = live.use(e => e.integrations);
  const sessions = live.use(e => e.sessions);
  const rooms: any[] = live.use(e => e.state?.rooms ?? []);
  const jiraStatuses = live.use(e => e.state?.settings?.verificationJira);   // Jira's prod-check status (its column)
  const roomName = (id: string) => rooms.find(s => s.id === id)?.name ?? id;
  const coord = rooms.find(s => s.type === 'coordinacion' && s.path && (!coordination || s.id === coordination));
  const [notice, setNotice] = useState('');
  const plan = (ta?: TaskWithPR) => { if (!ta) return; setNotice(t('panels.readingTheTask')); planTask(ta, coord?.id).then(e => { if (e) { setNotice(e); SFX.notAllowed(); } }).catch(e => setNotice(e.message)); };
  const [jira, setJira] = useState<{ tareas: TaskJira[]; demo?: boolean } | null>(null);
  const [gh, setGh] = useState<{ prs: PRBoard[]; demo?: boolean; error?: string } | null>(null);
  const [error, setError] = useState('');
  const [showDone, setShowDone] = useState(true);
  const [col, setCol] = useState(0); const [i, setI] = useState(0);
  const [move, setMove] = useState<{ task: TaskWithPR; column: BoardColumn; options: JiraTransition[]; k: number } | null>(null);
  const [moved, setMoved] = useState<Record<string, { text: string; fail?: boolean }>>({});   // each move's result, on its card
  const [dragged, setDragged] = useState<TaskWithPR | null>(null);
  const [restsOn, setOver] = useState<BoardColumn | null>(null);
  const [follow, setFollow] = useState<string | null>(null);   // the moved card keeps the selection in its new column
  const load = (force = false) => {
    client.action<any>('integracion.panel', { source: 'jira', force }).then(d => { aimColors(d.tareas ?? []); setJira(d); setError(''); jiraBoard.set({ tareas: d.tareas ?? [] }); }).catch(e => setError(e.message));
    client.action<any>('git.prsTablero', {}).then(d => { setGh(d); jiraBoard.set({ prs: d?.prs ?? [] }); }).catch(e => setGh({ prs: [], error: e.message }));
  };
  useEffect(() => { load(); }, []);
  const crossing = useMemo(() => crossBoard(jira?.tareas ?? [], gh?.prs ?? [], jiraStatuses), [jira, gh, jiraStatuses]);
  useColorsTasks();
  useEffect(() => knowTasks([...(jira?.tareas ?? []).map(t => t.key), ...(gh?.prs ?? []).map(pRTask)]), [jira, gh]);
  const columns = crossing.columns.filter(c => showDone || c.id !== 'hecho');
  useEffect(() => {
    if (!follow) return;
    const ci = columns.findIndex(c => c.tareas.some(x => x.key === follow));
    if (ci >= 0) { setCol(ci); setI(columns[ci].tareas.findIndex(x => x.key === follow)); setFollow(null); }
  }, [crossing]);
  const colName = (c: BoardColumn) => tIs(COLUMNS.find(x => x.id === c)!.name);
  // which of Jira's transitions lead to that column: none says so, one or more open the confirmation
  const propose = (ta: TaskWithPR | undefined, column: BoardColumn | undefined) => {
    if (!ta || !column || column === columnOf(ta, jiraStatuses) || move) return;
    if (jira?.demo) { setNotice(t('panels.jiraDemoCantMove')); SFX.notAllowed(); return; }
    setNotice(t('panels.jiraAskingTransitions', { clave: ta.key }));
    client.action<{ transitions: JiraTransition[] }>('integracion.transiciones', { source: 'jira', key: ta.key, column, current: ta.state }).then(({ transitions }) => {
      if (!transitions.length) { setNotice(t('panels.jiraNoTransition', { clave: ta.key, estado: ta.state, columna: colName(column) })); SFX.notAllowed(); return; }
      setNotice(''); setMove({ task: ta, column, options: transitions, k: 0 }); SFX.open();
    }).catch(e => { setNotice(e.message); SFX.notAllowed(); });
  };
  const confirm = () => {
    if (!move) return;
    const { task: ta, column, options, k } = move;
    setMove(null); SFX.click();
    setMoved(m => ({ ...m, [ta.key]: { text: t('panels.jiraMoving') } }));
    client.action<{ state: string }>('integracion.mover', { source: 'jira', key: ta.key, column, id: options[k].id }).then(r => {
      setMoved(m => ({ ...m, [ta.key]: { text: '✔ ' + t('panels.jiraMovedTo', { estado: r.state }) } }));
      SFX.shortSuccess(); setFollow(ta.key); load();
    }).catch(e => { setMoved(m => ({ ...m, [ta.key]: { text: '✗ ' + e.message, fail: true } })); SFX.notAllowed(); });
  };
  const taskSel: TaskWithPR | undefined = columns[col]?.tareas[Math.min(i, (columns[col]?.tareas.length ?? 1) - 1)];
  const selPrs: PRBoard[] = taskSel?.prs ?? [];
  const startBy = columns[col]?.id === 'porHacer' && !!taskSel;
  // the pre-flight of the selected task (F or its button), anchored to its card
  const kanban = useRef<HTMLDivElement>(null);
  const withPreflight = !!taskSel && taskHasPRs(taskSel.key, selPrs);
  const preflight = () => { if (!taskSel) return; SFX.click(); openPreflight(taskSel.key, kanban.current?.querySelector('.ficha-issue.sel')); };
  useKeys(e => {
    if (move) {
      if (e.code === 'Escape') setMove(null);
      else if (e.code === 'Enter' || e.code === 'KeyE') confirm();
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') setMove({ ...move, k: Math.min(move.options.length - 1, move.k + 1) });
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') setMove({ ...move, k: Math.max(0, move.k - 1) });
      return;
    }
    if (e.code === 'Escape') goBack();
    else if (e.shiftKey && (e.code === 'ArrowRight' || e.code === 'ArrowLeft')) propose(taskSel, columns[col + (e.code === 'ArrowRight' ? 1 : -1)]?.id);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { setCol(c => Math.min(columns.length - 1, c + 1)); setI(0); SFX.tick(); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { setCol(c => Math.max(0, c - 1)); setI(0); SFX.tick(); }
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(x => Math.min(x + 1, Math.max(0, (columns[col]?.tareas.length ?? 1) - 1))); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(x => Math.max(0, x - 1)); SFX.tick(); }
    else if (e.code === 'Enter' || e.code === 'KeyE') openOutside(taskSel?.url);
    else if (/^Digit[1-9]$/.test(e.code) && selPrs[+e.code.slice(5) - 1]) openOutside(selPrs[+e.code.slice(5) - 1].url);
    else if (e.code === 'KeyT') { closePanel(); openGit({ view: 'prs' }); }
    else if (e.code === 'KeyH') { setShowDone(x => !x); setCol(0); setI(0); SFX.toggle(); }
    else if (e.code === 'KeyR') { load(true); SFX.click(); }
    else if (e.code === 'KeyP' && startBy) plan(taskSel);
    else if (e.code === 'KeyF' && withPreflight) preflight();
  }, [columns, col, i, taskSel, selPrs, startBy, withPreflight, coord?.id, move, jira]);
  const demo = jira?.demo || gh?.demo;
  return (
    <Device label={`${coordination ? (coord?.name ?? t('panels.logistics')).toUpperCase() + ' · ' + t('panels.split') : t('panels.planning')} · ${t('panels.myJiraTasks')}${demo ? ' · DEMO' : ''}`} width={96} height onClose={goBack}>
      {error && <p className="aviso-consola">{error}</p>}
      {notice && <p className="aviso-consola">{notice}</p>}
      {coordination && <p className="voz">{coord ? t('panels.pickATaskToStart') : t('panels.pickATaskToStart2')}</p>}
      {gh?.error && <p className="tenue">{gh.error}</p>}
      {ints.jira?.state === 'demo' && <p className="tenue">{t('panels.jiraInDemoConnectIt')}</p>}
      {(!jira || !gh) && !error && <p className="tenue">{t('panels.readingJiraAndGithub')}</p>}
      <div ref={kanban} className="kanban kanban-jira" style={{ gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))` }}>
        {columns.map((c, ci) => (
          <div key={c.id} className={'kanban-col' + (COLUMN_COLORS[c.id] ? ' kanban-estado' : '') + (ci === col ? ' activa' : '') + (restsOn === c.id ? ' soltar' : '')} style={{ '--estado': COLUMN_COLORS[c.id] } as React.CSSProperties}
            onDragOver={e => { if (dragged && columnOf(dragged, jiraStatuses) !== c.id) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(c.id); } }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(x => (x === c.id ? null : x)); }}
            onDrop={e => { e.preventDefault(); const ta = dragged; setDragged(null); setOver(null); propose(ta ?? undefined, c.id); }}>
            <h3>{tIs(c.name)} <span className="tenue">{c.tareas.length}</span></h3>
            {c.tareas.map((ta, k) => (<React.Fragment key={ta.key}>
              {ta.epic && ta.epic.key !== c.tareas[k - 1]?.epic?.key && <div className="kanban-epica" title={t('windows.epicOf', { clave: ta.epic.key, titulo: ta.epic.title })}><EpicMark taskKey={ta.key} /><span className="ident">{ta.epic.key}</span> {ta.epic.title}</div>}
              <div className={'ficha-issue' + (c.id !== 'hecho' ? ' con-tarea' : '') + (ci === col && k === Math.min(i, c.tareas.length - 1) ? ' sel' : '') + (dragged?.key === ta.key ? ' arrastrada' : '')} style={c.id !== 'hecho' ? { '--tarea': taskColor(ta.key) } as React.CSSProperties : undefined} onMouseEnter={() => { if (!dragged) { setCol(ci); setI(k); } }} onDoubleClick={() => openOutside(ta.url)}
                draggable={!move} onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ta.key); setDragged(ta); }} onDragEnd={() => { setDragged(null); setOver(null); }}>
                {c.id !== 'hecho' && <span className="marca-tarea" />}<EpicMark taskKey={ta.key} /><span className="ident">{ta.key}</span> {ta.title}
                <small className="tenue">{[ta.state, ta.type, ta.priority].filter(Boolean).join(' · ')}</small>
                {ta.prs.length > 0 && <div className="prs-ficha">{ta.prs.map(p => <span key={p.url}>{prBadge(p)}</span>)}</div>}
                {inRunning(sessions, ta.key).length > 0 && <small className="tenue">{t('panels.inProgress')} {inRunning(sessions, ta.key).map(roomName).join(', ')}</small>}
                {moved[ta.key] && <small className={'movida' + (moved[ta.key].fail ? ' mal' : '')}>{moved[ta.key].text}</small>}
              </div>
            </React.Fragment>))}
            {!c.tareas.length && <p className="tenue">—</p>}
          </div>
        ))}
      </div>
      {crossing.withoutTask.length > 0 && <p className="tenue">{t('panels.nPrsWithoutAJira', { n: crossing.withoutTask.length })}</p>}
      {startBy && <div className="botonera"><button className="boton-taller" onClick={() => plan(taskSel)} title={t('panels.planClaveInSalaWith', { clave: taskSel!.key, sala: coord?.name ?? t('panels.theLogisticsRoom') })}>{coord ? t('panels.pPlanClaveInSala', { clave: taskSel!.key, sala: coord.name }) : t('panels.pPlanClaveAndSplit', { clave: taskSel!.key })}</button></div>}
      {selPrs.length > 0 && <div className="botonera">{selPrs.slice(0, 9).map((p, k) => <button key={p.url} className="boton-taller" onClick={() => openOutside(p.url)} title={p.title}>{k + 1} · {p.repo}#{p.number}</button>)}{withPreflight && <button className="boton-taller" onClick={preflight} title={t('preflight.actionHint')}>{t('preflight.keyF', { clave: taskSel!.key })}</button>}</div>}
      <Keys><kbd>←→</kbd>{t('panels.column')} <kbd>↑↓</kbd>{t('panels.task')} <kbd>⇧←→</kbd>{t('panels.moveTheTask')} <kbd>Enter</kbd>{t('panels.openTheTask')} {selPrs.length > 0 && <><kbd>1–{Math.min(9, selPrs.length)}</kbd>{t('panels.openThePr')} </>}{startBy && <><kbd>P</kbd>{t('panels.planAndSplit')} </>}{withPreflight && <><kbd>F</kbd>{t('preflight.title')} </>}<kbd>T</kbd>{t('panels.allYourPrs')} <kbd>H</kbd>{showDone ? t('panels.hideDone') : t('panels.showDone')} <kbd>R</kbd>{t('panels.reload')} <kbd>Esc</kbd>{t('menu.back')}</Keys>
      {move && <div className="vt-confirmar mover-jira">
        <div className="vt-confirmar-caja">
          <p><b>{move.task.key}</b>: {move.task.state} → <b>{move.options[move.k].a}</b></p>
          {move.options.length > 1 && <>
            <p className="tenue">{t('panels.jiraSeveralTransitions', { columna: colName(move.column) })}</p>
            <ul className="opciones-consola">{move.options.map((x, k) => <li key={x.id} className={k === move.k ? 'activa' : ''} onClick={() => setMove({ ...move, k })}><span className="cursor">{k === move.k ? '▶' : ' '}</span><span>{x.name === x.a ? x.a : `${x.name} → ${x.a}`}</span></li>)}</ul>
          </>}
          <p className="tenue">{t('panels.jiraMoveWrites')}</p>
          <div className="vt-confirmar-botones">
            <button className="consola-x peligro" onClick={confirm}>{t('panels.jiraMove')} ({t('windows.enter')})</button>
            <button className="consola-x" onClick={() => setMove(null)}>{t('windows.cancelEsc')}</button>
          </div>
        </div>
      </div>}
    </Device>
  );
}

// ---------------------------------------------------------------- tablero de Linear: mis incidencias por estado, ciclo y filtros
function BoardLinear({ goBack }: { goBack: () => void }) {
  const [data, setData] = useState<any>(null);
  const [team, setTeam] = useState<any>(null);       // tablero del equipo (columnas = estados del equipo)
  const [showTeam, setShowTeam] = useState(false);
  const [error, setError] = useState('');
  const [col, setCol] = useState(0); const [i, setI] = useState(0);
  const [project, setProject] = useState<string | null>(null);
  const [onlyUrgent, setOnlyUrgent] = useState(false);
  const load = (force = false) => client.action<any>('integracion.panel', { source: 'linear', force }).then(d => { setData(d); setError(''); }).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);
  const loadTeam = () => client.action<any>('integracion.tablero', { source: 'linear', team: (data?.cycles ?? [])[0]?.team }).then(d => { setTeam(d); setError(''); }).catch(e => setError(e.message));
  useEffect(() => { if (showTeam && !team) loadTeam(); }, [showTeam]);
  const source: any[] = showTeam ? (team?.columns ?? []).map((c: any) => ({ type: c.id, name: c.name, issues: c.issues })) : (data?.myIssues ?? []);
  const groups: any[] = source.map((g: any) => ({ ...g, issues: g.issues.filter((x: any) => (!project || x.project === project) && (!onlyUrgent || (x.priority > 0 && x.priority <= 2))) }));
  const projects = [...new Set((data?.myIssues ?? []).flatMap((g: any) => g.issues.map((x: any) => x.project)).filter(Boolean))] as string[];
  const cycle = (data?.cycles ?? []).find((c: any) => c.cycle)?.cycle;
  const sel = groups[col]?.issues[Math.min(i, (groups[col]?.issues.length ?? 1) - 1)];
  useKeys(e => {
    if (e.code === 'Escape') goBack();
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { setCol(c => Math.min(groups.length - 1, c + 1)); setI(0); SFX.tick(); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { setCol(c => Math.max(0, c - 1)); setI(0); SFX.tick(); }
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(x => x + 1); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(x => Math.max(0, x - 1)); SFX.tick(); }
    else if (e.code === 'Enter' || e.code === 'KeyE') openOutside(sel?.url);
    else if (e.code === 'KeyP') { const k = project ? projects.indexOf(project) + 1 : 0; setProject(k < projects.length ? projects[k] : null); setI(0); SFX.toggle(); }
    else if (e.code === 'KeyU') { setOnlyUrgent(x => !x); setI(0); SFX.toggle(); }
    else if (e.code === 'KeyR') { showTeam ? loadTeam() : load(true); SFX.click(); }
    else if (e.code === 'KeyT') { setShowTeam(x => !x); setCol(0); setI(0); SFX.toggle(); }
  }, [groups, col, i, sel, project, projects, showTeam]);
  return (
    <Device label={`${t('panels.planning')} · ${showTeam ? t('panels.teamBoard') + ' ' + (team?.team ?? '') : t('panels.myIssues')}${data?.demo ? ' · DEMO' : ''}`} width={92} height onClose={goBack}>
      {error && <p className="aviso-consola">{error}</p>}
      {!data && !error && <p className="tenue">{t('panels.readingLinear')}</p>}
      {cycle && <div className="ciclo-linear"><b>{cycle.name}</b><span className="medidor"><span style={{ width: `${cycle.progreso}%` }} /></span><span>{cycle.progreso} % · {t('panels.ends')} {new Date(cycle.end).toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'short' })}</span></div>}
      <div className="pestanas"><button className={'chip' + (!project ? ' on' : '')} onClick={() => setProject(null)}>{t('panels.allProjects')}</button>{projects.map(p => <button key={p} className={'chip' + (project === p ? ' on' : '')} onClick={() => setProject(p)}>{p}</button>)}<button className={'chip' + (onlyUrgent ? ' on' : '')} onClick={() => setOnlyUrgent(x => !x)}>{t('panels.urgentAndHigh')}</button></div>
      <div className="kanban" style={{ gridTemplateColumns: `repeat(${Math.max(1, groups.length)}, 1fr)` }}>
        {groups.map((g, c) => (
          <div key={g.type} className={'kanban-col' + (c === col ? ' activa' : '')}>
            <h3>{g.name} <span className="tenue">{g.issues.length}</span></h3>
            {g.issues.map((x: any, k: number) => (
              <div key={x.id} className={'ficha-issue p' + x.priority + (c === col && k === Math.min(i, g.issues.length - 1) ? ' sel' : '')} onMouseEnter={() => { setCol(c); setI(k); }} onDoubleClick={() => openOutside(x.url)}>
                <span className="ident">{x.identifier}</span> {x.title}
                <small className="tenue">{[x.textPriority, x.project, showTeam ? x.assignee : '', x.state?.name !== g.name ? x.state?.name : ''].filter(Boolean).join(' · ')}</small>
              </div>
            ))}
            {!g.issues.length && <p className="tenue">—</p>}
          </div>
        ))}
      </div>
      <Keys><kbd>←→</kbd>{t('panels.column')} <kbd>↑↓</kbd>{t('panels.issue')} <kbd>Enter</kbd>{t('panels.openInLinear')} <kbd>P</kbd>{t('panels.project')} <kbd>U</kbd>{t('panels.urgent')} <kbd>T</kbd>{showTeam ? t('panels.myIssues2') : t('panels.teamBoard2')} <kbd>R</kbd>{t('panels.reload')} <kbd>Esc</kbd>{t('panels.backToChangeThemTalk')}</Keys>
    </Device>
  );
}
