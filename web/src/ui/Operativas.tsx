// Salas operativas: tablón de comunicaciones (todas las fuentes en un solo feed), calendario unificado (Microsoft 365
// y Google Calendar) y Logística (tareas de Jira con sus pull requests, y Linear). Solo lectura: se abre el original con Enter, en su navegador del refugio.
import React, { useEffect, useMemo, useState } from 'react';
import { juego } from './estadoJuego';
import { t, idioma, tIs } from '@shared/idioma';
import { vivo, cliente } from '../red/cliente';
import { SFX } from '../audio/sonido';
import { Device, Keys, closePanel, useKeys } from './aparato';
import { goA } from './Paneles';
import { openBrowser, openLink, openNotice, SPOTS } from './Navegadores';
import { SOURCES as IDS_SOURCES, ACTIVE_SOURCES, CALENDAR_SOURCES, INFO_SOURCE, activa } from '@shared/fuentes';
import { PLANNING_ROOM } from '@shared/disposicion';
import { openGit } from './git/ventana';
import { taskColor, pRTask } from '@shared/tareas';
import { aimColors, knowTasks, useColorsTasks, jiraBoard } from './tareas';
import { cruzarTablero, COLUMN_COLORS, textoPR, promptPlanificar, type PRBoard, type TaskWithPR, type TaskJira } from '@shared/tablero';

const SOURCES: Record<string, string> = Object.fromEntries(IDS_SOURCES.map(f => [f, INFO_SOURCE[f].corto]));
const LOC = idioma() === 'en' ? 'en-GB' : 'es-ES';
const fmtHour = new Intl.DateTimeFormat(LOC, { hour: '2-digit', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat(LOC, { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDayShort = new Intl.DateTimeFormat(LOC, { weekday: 'short', day: 'numeric' });
function hace(ts: number) { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? t('windows.now') : m < 60 ? t('windows.nMinAgo', { n: m }) : m < 1440 ? t('windows.nHAgo', { n: Math.round(m / 60) }) : t('windows.nDAgo', { n: Math.round(m / 1440) }); }
// Cada aviso del tablón es una conversación (el servidor junta los mensajes: canal de Discord o Slack, hilo de correo,
// issue de Linear, hilo de GitHub). Las fuentes «completas» dicen qué está sin leer allí: lo leído allí sale solo.
const WITH_READ = new Set<string>(IDS_SOURCES.filter(f => INFO_SOURCE[f].completa));
const isChat = (n: any) => !!INFO_SOURCE[n.fuente as keyof typeof INFO_SOURCE]?.chat;
// fila: en los chats, la conversación y el último mensaje; en correo y Linear, quién y el asunto
const fila = (n: any) => isChat(n) ? [n.titulo, n.titulo === n.autor ? n.fragmento : `${n.autor}: ${n.fragmento}`] : [n.autor, n.titulo];
// lo que tiene navegador propio en el refugio (ver SITIOS en Navegadores.tsx) se abre dentro; el resto, fuera
const openOutside = (url?: string) => openLink(url);

// ---------------------------------------------------------------- comunicaciones
export function PanelCommunications({ onlySource }: { onlySource?: string } = {}) {
  const todas: any[] = vivo.usar(e => e.notificaciones);
  const ints = vivo.usar(e => e.integraciones);
  const filters: string[] = onlySource ? [onlySource] : ['todas', ...ACTIVE_SOURCES.filter(x => !INFO_SOURCE[x].withoutNotices)];
  // 1–9: entrar a la web de cada fuente en su navegador del refugio, sin pasar por un aviso
  const webs = onlySource ? [] : filters.filter(x => SPOTS[x]);
  const [f, setF] = useState(0);
  const [onlyNew, setOnlyNew] = useState(false);
  const [i, setI] = useState(0);
  const lista = useMemo(() => todas.filter(n => (filters[f] === 'todas' || n.fuente === filters[f]) && (!onlyNew || !n.vista)), [todas, f, onlyNew]);
  const sel = lista[Math.min(i, lista.length - 1)];
  useEffect(() => { if (sel && !sel.vista) { const tm = setTimeout(() => cliente.accion('integracion.marcarVista', { ids: sel.ids ?? [sel.id] }).catch(() => {}), 1200); return () => clearTimeout(tm); } }, [sel?.id]);
  useKeys(e => {
    if (e.code === 'Escape') closePanel();
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(x => Math.min(lista.length - 1, x + 1)); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(x => Math.max(0, x - 1)); SFX.tick(); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { setF(x => (x + 1) % filters.length); setI(0); SFX.tick(); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { setF(x => (x - 1 + filters.length) % filters.length); setI(0); SFX.tick(); }
    else if ((e.code === 'Enter' || e.code === 'KeyE') && sel) openNotice(sel);
    else if (e.code === 'KeyN') { setOnlyNew(x => !x); setI(0); SFX.conmutar(); }
    else if (e.code === 'KeyV') { cliente.accion('integracion.marcarVista', { ids: lista.filter(n => !n.vista).flatMap(n => n.ids ?? [n.id]) }); SFX.shortSuccess(); }
    else if (/^Digit[1-9]$/.test(e.code) && webs[+e.code.slice(5) - 1]) openBrowser(webs[+e.code.slice(5) - 1]);
  }, [lista, sel, f]);
  const withoutSee = (fu: string) => todas.filter(n => !n.vista && (fu === 'todas' || n.fuente === fu)).length;
  return (
    <Device rotulo={onlySource ? t('panels.planningFuente', { fuente: SOURCES[onlySource].toUpperCase() }) : t('panels.communicationsNoticeBoard')} ancho={78} alto piloto={withoutSee('todas') ? 'esperando' : 'ociosa'}>
      {!onlySource && <div className="pestanas">{filters.map((x, k) => <button key={x} className={'chip' + (k === f ? ' on' : '')} onClick={() => { setF(k); setI(0); }}>{x === 'todas' ? t('panels.all') : SOURCES[x]}{withoutSee(x) ? ' · ' + t('panels.nUnseen', { n: withoutSee(x) }) : ''}{x !== 'todas' && ints[x]?.estado === 'demo' ? ' ' + t('panels.demo') : ''}</button>)}
        <span className="tenue derecha">{onlyNew ? t('panels.onlyUnseen') : t('panels.all2')} · {t('panels.nToggles')}</span></div>}
      <div className="feed">
        <ul className="feed-lista lista-desplazable">
          {lista.map((n, k) => (
            <li key={n.id} className={'aviso-' + n.prioridad + (k === i ? ' activa' : '') + (n.vista ? ' vista' : '')} onMouseEnter={() => setI(k)} onClick={() => { setI(k); }} onDoubleClick={() => openNotice(n)} ref={el => { if (k === i) el?.scrollIntoView({ block: 'nearest' }); }}>
              <span className={'fuente f-' + n.fuente}>{SOURCES[n.fuente]}</span>
              <span className="quien">{fila(n)[0]}</span>
              <span className="titulo">{fila(n)[1]}</span>
              <span className="cuando">{n.cuantos > 1 && <b className="cuantos">{n.cuantos}</b>}{hace(n.fecha)}</span>
            </li>
          ))}
          {!lista.length && <li className="vacio tenue">{onlyNew || !todas.length ? t('panels.allCaughtUpNothingPending') : t('panels.nothingHere')}</li>}
        </ul>
        <div className="feed-detalle">
          {sel ? <>
            <div className="tenue">{SOURCES[sel.fuente]}{sel.canal ? ' · ' + sel.canal : ''} · {fmtDay.format(sel.fecha)} {fmtHour.format(sel.fecha)}{sel.demo ? ' · DEMO' : ''}</div>
            <div className="titulo-ficha">{sel.titulo}</div>
            {(sel.cuantos ?? 1) > 1 && <p className="tenue">{sel.cuantos} {WITH_READ.has(sel.fuente) ? t('panels.unreadInFuente', { fuente: SOURCES[sel.fuente] }) : t('panels.messages')}{sel.authors?.length > 1 ? ' · ' + sel.authors.join(', ') : ''}</p>}
            {sel.prioridad === 'alta' && <p className="aviso-consola">{t('panels.highPriority')}</p>}
            {sel.cuantos > (sel.mensajes?.length ?? 1) && <p className="tenue">{t('panels.andNEarlier', { n: sel.cuantos - sel.mensajes.length })}</p>}
            <ul className="hilo">{[...(sel.mensajes ?? [{ id: sel.id, autor: sel.autor, texto: sel.fragmento, fecha: sel.fecha }])].reverse().map((m: any) => (
              <li key={m.id}><b>{m.autor}</b> <span className="tenue">{fmtHour.format(m.fecha)}</span><p className="fragmento">{m.texto}</p></li>))}</ul>
            {sel.enlace ? <p className="tenue">{isChat(sel) ? t('panels.enterOpensTheConversationIn', { fuente: SOURCES[sel.fuente] }) : t('panels.enterOpensTheOriginalIn', { fuente: SOURCES[sel.fuente] })}{WITH_READ.has(sel.fuente) && !sel.demo ? ' ' + t('panels.onceYouReadItThere') : ''} {t('panels.theBoardIsReadOnly')}</p> : null}
          </> : null}
        </div>
      </div>
      {webs.length > 0 && <div className="botonera abrir-webs"><span className="tenue">{t('panels.openHere')}</span>{webs.map((x, k) => <button key={x} className="boton-taller" onClick={() => openBrowser(x)} title={t('panels.openSitioInItsShelter', { sitio: SPOTS[x].nombre, k: k + 1 })}>{k + 1} · {SPOTS[x].nombre}</button>)}</div>}
      <Keys><kbd>↑↓</kbd>{t('panels.notices')} {!onlySource && <><kbd>←→</kbd>{t('panels.source')} </>}<kbd>Enter</kbd>{t('panels.openTheOriginal')} <kbd>N</kbd>{t('panels.onlyUnseen2')} <kbd>V</kbd>{t('panels.markAllSeen')} {webs.length > 0 && <><kbd>1–{webs.length}</kbd>{t('panels.openTheWeb')} </>}<kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- calendario unificado
export function PanelPlanning() {
  const eventos: any[] = vivo.usar(e => e.eventos);
  const [dia, setDay] = useState(0);
  const [i, setI] = useState(0);
  const dayStart = (k: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + k); return d.getTime(); };
  const days = Array.from({ length: 7 }, (_, k) => dayStart(k));
  const dayOf = (ts: number) => eventos.filter(ev => ev.inicio < ts + 86400_000 && ev.fin > ts).sort((a, b) => a.inicio - b.inicio);
  const lista = dayOf(days[dia]);
  const sel = lista[Math.min(i, lista.length - 1)];
  const ahora = Date.now();
  const proximo = eventos.filter(ev => ev.fin > ahora).sort((a, b) => a.inicio - b.inicio)[0];
  const [agenda, setAgenda] = useState(false);
  const [aviso, setNotice] = useState('');
  const refrescar = async () => { setNotice(t('panels.readingCalendars')); await Promise.all(CALENDAR_SOURCES.map(f => cliente.accion('integracion.refrescar', { fuente: f }).catch(() => {}))); setNotice(t('panels.upToDate')); SFX.shortSuccess(); };
  useKeys(e => {
    if (e.code === 'Escape') closePanel();
    else if (e.code === 'KeyA') { setAgenda(x => !x); SFX.conmutar(); }
    else if (e.code === 'KeyR') refrescar();
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { setDay(d => Math.min(6, d + 1)); setI(0); SFX.tick(); }
    else if (e.code === 'ArrowLeft') { setDay(d => Math.max(0, d - 1)); setI(0); SFX.tick(); }   // (la A es agenda/semana)
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(x => Math.min(lista.length - 1, x + 1)); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(x => Math.max(0, x - 1)); SFX.tick(); }
    else if ((e.code === 'Enter' || e.code === 'KeyE') && sel) sel.videollamada ? openOutside(sel.videollamada) : openNotice(sel);
  }, [lista, sel]);
  return (
    <Device rotulo={t('panels.agendaCalendar')} ancho={80}>
      <p>{proximo ? <>{t('panels.next')} <b>{proximo.titulo}</b> <span className="tenue">· {proximo.inicio <= ahora ? t('windows.justNow') : fmtDayShort.format(proximo.inicio) + ' ' + fmtHour.format(proximo.inicio)} · {SOURCES[proximo.fuente]}</span></> : <span className="tenue">{t('panels.noUpcomingEvents')}</span>}</p>
      {aviso && <p className="tenue">{aviso}</p>}
      {agenda ? <ul className="agenda">{eventos.filter(ev => ev.fin > ahora).sort((a, b) => a.inicio - b.inicio).slice(0, 14).map(ev => (
        <li key={ev.id} className={'f-' + ev.fuente + (ev.inicio <= ahora ? ' ahora' : '')} onDoubleClick={() => (ev.videollamada ? openOutside(ev.videollamada) : openNotice(ev))}>
          <span className="cuando">{ev.inicio <= ahora ? t('windows.now') : ev.inicio - ahora < 3600_000 ? t('panels.inNMin', { n: Math.round((ev.inicio - ahora) / 60000) }) : fmtDayShort.format(ev.inicio) + ' ' + fmtHour.format(ev.inicio)}</span>
          <b>{ev.titulo}</b> <span className="tenue">{SOURCES[ev.fuente]}{ev.videollamada ? ' · ' + t('panels.videoCall') : ''}</span>
        </li>))}</ul> :
      <div className="semana">
        {days.map((ts, k) => (
          <div key={ts} className={'dia' + (k === dia ? ' activa' : '') + (k === 0 ? ' hoy' : '')} onClick={() => { setDay(k); setI(0); }}>
            <div className="cab">{k === 0 ? t('panels.today') : k === 1 ? t('panels.tomorrow') : fmtDayShort.format(ts)}</div>
            {dayOf(ts).map((ev, j) => (
              <div key={ev.id} className={'ev f-' + ev.fuente + (k === dia && j === Math.min(i, lista.length - 1) ? ' sel' : '') + (ev.fin < ahora ? ' pasado' : '') + (ev.inicio <= ahora && ev.fin > ahora ? ' ahora' : '')} onMouseEnter={() => { if (k === dia) setI(j); }}>
                <span className="h">{ev.allElDay ? t('panels.allDay') : fmtHour.format(ev.inicio)}</span> {ev.titulo}
              </div>
            ))}
          </div>
        ))}
      </div>
      }
      {!agenda && sel && <div className="detalle-evento">
        <div className="titulo-ficha">{sel.titulo}</div>
        <p>{fmtDay.format(sel.inicio)} · {sel.allElDay ? t('panels.allDay') : `${fmtHour.format(sel.inicio)}–${fmtHour.format(sel.fin)}`} <span className="tenue">· {SOURCES[sel.fuente]}{sel.demo ? ' · DEMO' : ''}</span></p>
        {sel.organizador && <p className="tenue">{t('panels.organizer')} {sel.organizador}</p>}
        {sel.lugar && <p className="tenue">{t('panels.location')} {sel.lugar}</p>}
        {sel.videollamada && <p>{t('panels.videoCallPressEnterTo')}</p>}
      </div>}
      <Keys><kbd>←→</kbd>{t('panels.day')} <kbd>↑↓</kbd>{t('panels.event')} <kbd>Enter</kbd>{t('panels.joinOrOpen')} <kbd>A</kbd>{agenda ? t('panels.week') : t('panels.agenda')} <kbd>R</kbd>{t('panels.refresh')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- Logística (Jira y PR, Linear)
export function PanelLogistics() {
  const st = vivo.usar(e => e.integraciones.jira);
  const commander = juego.usar(e => e.habitantes.find(h => h.sala === 'logistica'));
  const withLinear = activa('linear');
  const [vista, setView] = useState<'jira' | 'tablero' | 'menu' | 'avisos'>(() => (juego.get().panelData?.vista === 'jira' ? 'jira' : 'menu'));   // clic en la pantalla de la pared: directo al tablero
  // abierto directamente (la pantalla de la pared, ⌘K): al cerrarlo se vuelve al refugio, no al menú de la consola
  const [directo] = useState(() => juego.get().panelData?.vista === 'jira');
  const onMenu = () => (directo ? closePanel() : setView('menu'));
  const items = [
    { texto: t('panels.boardMyJiraTasksAnd'), f: () => setView('jira') },
    ...(withLinear ? [
      { texto: t('panels.openLinearRightHere'), f: () => { closePanel(); openBrowser('linear'); } },
      { texto: t('panels.linearMyIssuesByStatus'), f: () => setView('tablero') },
      { texto: t('panels.linearNotices'), f: () => setView('avisos') },
    ] : []),
    ...(commander ? [{ texto: t('windows.talkToNombre', { nombre: commander.nombre }) + (withLinear ? t('panels.createMoveOrCommentOn') : ''), f: () => { closePanel(); goA('logistica', commander.id, true); } }] : []),
  ];
  const [i, setI] = useState(0);
  useKeys(e => {
    if (vista !== 'menu') return false;
    if (e.code === 'Escape') closePanel();
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') setI(x => (x + 1) % items.length);
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') setI(x => (x - 1 + items.length) % items.length);
    else if (e.code === 'Enter' || e.code === 'KeyE') { SFX.clic(); items[i].f(); }
  }, [vista, i]);
  if (vista === 'jira') return <BoardJira volver={onMenu} />;
  if (vista === 'avisos') return <PanelCommunications onlySource="linear" />;
  if (vista === 'tablero') return <BoardLinear volver={() => setView('menu')} />;
  return (
    <Device rotulo={t('panels.planning')} ancho={56} piloto={st?.estado === 'conectada' ? 'trabajando' : 'esperando'}>
      <p className="voz">{withLinear ? t('panels.theBoardsShowWhatJira') : t('panels.theBoardShowsYourJira')}</p>
      <ul className="opciones-consola">{items.map((it, k) => <li key={k} className={k === i ? 'activa' : ''} onMouseEnter={() => setI(k)} onClick={() => it.f()}><span className="cursor">{k === i ? '▶' : ' '}</span><span>{it.texto}</span></li>)}</ul>
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.use')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- planificar una tarea en la sala de planificación
// La sala de planificación (tipo 'coordinacion'; la agenda es otra) es una sala de serie con la raíz de repos del refugio
// (SALA_PLANIFICACION; también puede haber otras, de carpetas con varios repos reclutadas en la Puerta): su habitante ve
// todos los repos, planifica la tarea con el Supervisor (empieza en modo plan) y, con el plan aprobado, la reparte a la
// sala de cada repo, cada parte en su worktree (server/reparto.ts)
export const coordinationRooms = (): any[] => ((vivo.get().estado?.salas ?? []) as any[]).filter(s => s.tipo === 'coordinacion' && s.ruta)
  .sort((a, b) => Number(b.id === PLANNING_ROOM) - Number(a.id === PLANNING_ROOM));
export async function planTask(tarea: TaskJira, salaId?: string): Promise<string | null> {
  const sala = coordinationRooms().find(s => !salaId || s.id === salaId);
  if (!sala) return t('panels.thereIsNoLogisticsRoom');
  const h = ((vivo.get().estado?.habitantes ?? []) as any[]).find(x => x.salaId === sala.id);
  if (!h) return t('panels.theRoomSalaHasNo', { sala: sala.nombre });
  // con la descripción, si Jira la da (en DEMO no hay)
  const completa = await cliente.accion<TaskJira & { descripcion?: string }>('integracion.tarea', { fuente: 'jira', clave: tarea.clave }).catch(() => tarea);
  cliente.enviar({ t: 'empezar', dwellerId: h.id, salaId: sala.id, prompt: promptPlanificar(completa), opciones: { permisos: 'plan' } });
  SFX.shortSuccess(); closePanel(); goA(sala.id, h.id, true);
  return null;
}
// las salas que trabajan ya en una tarea: sus conversaciones empiezan por la clave (la planificación y el reparto)
const inRunning = (sesiones: Record<string, any>, clave: string) => [...new Set(Object.values(sesiones).filter((s: any) => s.estado !== 'cerrada' && String(s.titulo ?? '').startsWith(clave + ' ')).map((s: any) => s.salaId as string))];

// ---------------------------------------------------------------- tablero de Jira: mis tareas por estado con sus PR
// Columnas Por hacer / En curso / En revisión / Hecho, cada ficha con sus PR (por la clave de Jira de la rama o el título).
// La lista de PR está en Control de Versiones (pestaña Pull requests del cliente de git). Solo lectura.
const KIND_PR: Record<PRBoard['estado'], string> = { abierto: 'pr-abierto', borrador: 'pr-borrador', fusionado: 'pr-fusionado', cerrado: 'pr-cerrado' };
export const trTextPR = (p: PRBoard) => textoPR(p).split(' · ').map(x => tIs(x)).join(' · ');
const insigniaPR = (p: PRBoard) => <span className={'insignia-pr ' + KIND_PR[p.estado] + (p.estado === 'abierto' && p.revision === 'CHANGES_REQUESTED' ? ' pr-cambios' : '') + (p.checks === 'FAILURE' || p.checks === 'ERROR' ? ' pr-ci-mal' : '')} title={`${p.repo}#${p.numero} · ${trTextPR(p)}`}>#{p.numero} {trTextPR(p)}</span>;
// coordinacion: el tablero abierto desde una sala de coordinación (P planifica ahí; si no, en la primera que haya)
export function BoardJira({ volver, coordinacion }: { volver: () => void; coordinacion?: string }) {
  const ints = vivo.usar(e => e.integraciones);
  const sesiones = vivo.usar(e => e.sesiones);
  const salas: any[] = vivo.usar(e => e.estado?.salas ?? []);
  const roomName = (id: string) => salas.find(s => s.id === id)?.nombre ?? id;
  const coord = salas.find(s => s.tipo === 'coordinacion' && s.ruta && (!coordinacion || s.id === coordinacion));
  const [aviso, setNotice] = useState('');
  const planificar = (ta?: TaskWithPR) => { if (!ta) return; setNotice(t('panels.readingTheTask')); planTask(ta, coord?.id).then(e => { if (e) { setNotice(e); SFX.noAllowed(); } }).catch(e => setNotice(e.message)); };
  const [jira, setJira] = useState<{ tareas: TaskJira[]; demo?: boolean } | null>(null);
  const [gh, setGh] = useState<{ prs: PRBoard[]; demo?: boolean; error?: string } | null>(null);
  const [error, setError] = useState('');
  const [seeDone, setSeeDone] = useState(true);
  const [col, setCol] = useState(0); const [i, setI] = useState(0);
  const cargar = (forzar = false) => {
    cliente.accion<any>('integracion.panel', { fuente: 'jira', forzar }).then(d => { aimColors(d.tareas ?? []); setJira(d); setError(''); jiraBoard.set({ tareas: d.tareas ?? [] }); }).catch(e => setError(e.message));
    cliente.accion<any>('git.prsTablero', {}).then(d => { setGh(d); jiraBoard.set({ prs: d?.prs ?? [] }); }).catch(e => setGh({ prs: [], error: e.message }));
  };
  useEffect(() => { cargar(); }, []);
  const crossing = useMemo(() => cruzarTablero(jira?.tareas ?? [], gh?.prs ?? []), [jira, gh]);
  useColorsTasks();
  useEffect(() => knowTasks([...(jira?.tareas ?? []).map(t => t.clave), ...(gh?.prs ?? []).map(pRTask)]), [jira, gh]);
  const columnas = crossing.columnas.filter(c => seeDone || c.id !== 'hecho');
  const taskSel: TaskWithPR | undefined = columnas[col]?.tareas[Math.min(i, (columnas[col]?.tareas.length ?? 1) - 1)];
  const selPrs: PRBoard[] = taskSel?.prs ?? [];
  const startBy = columnas[col]?.id === 'porHacer' && !!taskSel;
  useKeys(e => {
    if (e.code === 'Escape') volver();
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { setCol(c => Math.min(columnas.length - 1, c + 1)); setI(0); SFX.tick(); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { setCol(c => Math.max(0, c - 1)); setI(0); SFX.tick(); }
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(x => Math.min(x + 1, Math.max(0, (columnas[col]?.tareas.length ?? 1) - 1))); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(x => Math.max(0, x - 1)); SFX.tick(); }
    else if (e.code === 'Enter' || e.code === 'KeyE') openOutside(taskSel?.url);
    else if (/^Digit[1-9]$/.test(e.code) && selPrs[+e.code.slice(5) - 1]) openOutside(selPrs[+e.code.slice(5) - 1].url);
    else if (e.code === 'KeyT') { closePanel(); openGit({ vista: 'prs' }); }
    else if (e.code === 'KeyH') { setSeeDone(x => !x); setCol(0); setI(0); SFX.conmutar(); }
    else if (e.code === 'KeyR') { cargar(true); SFX.clic(); }
    else if (e.code === 'KeyP' && startBy) planificar(taskSel);
  }, [columnas, col, i, taskSel, selPrs, startBy, coord?.id]);
  const demo = jira?.demo || gh?.demo;
  return (
    <Device rotulo={`${coordinacion ? (coord?.nombre ?? t('panels.logistics')).toUpperCase() + ' · ' + t('panels.split') : t('panels.planning')} · ${t('panels.myJiraTasks')}${demo ? ' · DEMO' : ''}`} ancho={96} alto onClose={volver}>
      {error && <p className="aviso-consola">{error}</p>}
      {aviso && <p className="aviso-consola">{aviso}</p>}
      {coordinacion && <p className="voz">{coord ? t('panels.pickATaskToStart') : t('panels.pickATaskToStart2')}</p>}
      {gh?.error && <p className="tenue">{gh.error}</p>}
      {ints.jira?.estado === 'demo' && <p className="tenue">{t('panels.jiraInDemoConnectIt')}</p>}
      {(!jira || !gh) && !error && <p className="tenue">{t('panels.readingJiraAndGithub')}</p>}
      <div className="kanban" style={{ gridTemplateColumns: `repeat(${Math.max(1, columnas.length)}, 1fr)` }}>
        {columnas.map((c, ci) => (
          <div key={c.id} className={'kanban-col' + (COLUMN_COLORS[c.id] ? ' kanban-estado' : '') + (ci === col ? ' activa' : '')} style={{ '--estado': COLUMN_COLORS[c.id] } as React.CSSProperties}>
            <h3>{tIs(c.nombre)} <span className="tenue">{c.tareas.length}</span></h3>
            {c.tareas.map((ta, k) => (
              <div key={ta.clave} className={'ficha-issue' + (c.id !== 'hecho' ? ' con-tarea' : '') + (ci === col && k === Math.min(i, c.tareas.length - 1) ? ' sel' : '')} style={c.id !== 'hecho' ? { '--tarea': taskColor(ta.clave) } as React.CSSProperties : undefined} onMouseEnter={() => { setCol(ci); setI(k); }} onDoubleClick={() => openOutside(ta.url)}>
                {c.id !== 'hecho' && <span className="marca-tarea" />}<span className="ident">{ta.clave}</span> {ta.titulo}
                <small className="tenue">{[ta.estado, ta.tipo, ta.prioridad].filter(Boolean).join(' · ')}</small>
                {ta.prs.length > 0 && <div className="prs-ficha">{ta.prs.map(p => <span key={p.url}>{insigniaPR(p)}</span>)}</div>}
                {inRunning(sesiones, ta.clave).length > 0 && <small className="tenue">{t('panels.inProgress')} {inRunning(sesiones, ta.clave).map(roomName).join(', ')}</small>}
              </div>
            ))}
            {!c.tareas.length && <p className="tenue">—</p>}
          </div>
        ))}
      </div>
      {crossing.withoutTask.length > 0 && <p className="tenue">{t('panels.nPrsWithoutAJira', { n: crossing.withoutTask.length })}</p>}
      {startBy && <div className="botonera"><button className="boton-taller" onClick={() => planificar(taskSel)} title={t('panels.planClaveInSalaWith', { clave: taskSel!.clave, sala: coord?.nombre ?? t('panels.theLogisticsRoom') })}>{coord ? t('panels.pPlanClaveInSala', { clave: taskSel!.clave, sala: coord.nombre }) : t('panels.pPlanClaveAndSplit', { clave: taskSel!.clave })}</button></div>}
      {selPrs.length > 0 && <div className="botonera">{selPrs.slice(0, 9).map((p, k) => <button key={p.url} className="boton-taller" onClick={() => openOutside(p.url)} title={p.titulo}>{k + 1} · {p.repo}#{p.numero}</button>)}</div>}
      <Keys><kbd>←→</kbd>{t('panels.column')} <kbd>↑↓</kbd>{t('panels.task')} <kbd>Enter</kbd>{t('panels.openTheTask')} {selPrs.length > 0 && <><kbd>1–{Math.min(9, selPrs.length)}</kbd>{t('panels.openThePr')} </>}{startBy && <><kbd>P</kbd>{t('panels.planAndSplit')} </>}<kbd>T</kbd>{t('panels.allYourPrs')} <kbd>H</kbd>{seeDone ? t('panels.hideDone') : t('panels.showDone')} <kbd>R</kbd>{t('panels.reload')} <kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- tablero de Linear: mis incidencias por estado, ciclo y filtros
function BoardLinear({ volver }: { volver: () => void }) {
  const [datos, setDatos] = useState<any>(null);
  const [equipo, setTeam] = useState<any>(null);       // tablero del equipo (columnas = estados del equipo)
  const [seeTeam, setSeeTeam] = useState(false);
  const [error, setError] = useState('');
  const [col, setCol] = useState(0); const [i, setI] = useState(0);
  const [proyecto, setProject] = useState<string | null>(null);
  const [onlyUrgent, setOnlyUrgent] = useState(false);
  const cargar = (forzar = false) => cliente.accion<any>('integracion.panel', { fuente: 'linear', forzar }).then(d => { setDatos(d); setError(''); }).catch(e => setError(e.message));
  useEffect(() => { cargar(); }, []);
  const loadTeam = () => cliente.accion<any>('integracion.tablero', { fuente: 'linear', equipo: (datos?.cycles ?? [])[0]?.equipo }).then(d => { setTeam(d); setError(''); }).catch(e => setError(e.message));
  useEffect(() => { if (seeTeam && !equipo) loadTeam(); }, [seeTeam]);
  const fuente: any[] = seeTeam ? (equipo?.columnas ?? []).map((c: any) => ({ tipo: c.id, nombre: c.nombre, issues: c.issues })) : (datos?.myIssues ?? []);
  const grupos: any[] = fuente.map((g: any) => ({ ...g, issues: g.issues.filter((x: any) => (!proyecto || x.proyecto === proyecto) && (!onlyUrgent || (x.prioridad > 0 && x.prioridad <= 2))) }));
  const proyectos = [...new Set((datos?.myIssues ?? []).flatMap((g: any) => g.issues.map((x: any) => x.proyecto)).filter(Boolean))] as string[];
  const ciclo = (datos?.cycles ?? []).find((c: any) => c.ciclo)?.ciclo;
  const sel = grupos[col]?.issues[Math.min(i, (grupos[col]?.issues.length ?? 1) - 1)];
  useKeys(e => {
    if (e.code === 'Escape') volver();
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { setCol(c => Math.min(grupos.length - 1, c + 1)); setI(0); SFX.tick(); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { setCol(c => Math.max(0, c - 1)); setI(0); SFX.tick(); }
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(x => x + 1); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(x => Math.max(0, x - 1)); SFX.tick(); }
    else if (e.code === 'Enter' || e.code === 'KeyE') openOutside(sel?.url);
    else if (e.code === 'KeyP') { const k = proyecto ? proyectos.indexOf(proyecto) + 1 : 0; setProject(k < proyectos.length ? proyectos[k] : null); setI(0); SFX.conmutar(); }
    else if (e.code === 'KeyU') { setOnlyUrgent(x => !x); setI(0); SFX.conmutar(); }
    else if (e.code === 'KeyR') { seeTeam ? loadTeam() : cargar(true); SFX.clic(); }
    else if (e.code === 'KeyT') { setSeeTeam(x => !x); setCol(0); setI(0); SFX.conmutar(); }
  }, [grupos, col, i, sel, proyecto, proyectos, seeTeam]);
  return (
    <Device rotulo={`${t('panels.planning')} · ${seeTeam ? t('panels.teamBoard') + ' ' + (equipo?.equipo ?? '') : t('panels.myIssues')}${datos?.demo ? ' · DEMO' : ''}`} ancho={92} alto onClose={volver}>
      {error && <p className="aviso-consola">{error}</p>}
      {!datos && !error && <p className="tenue">{t('panels.readingLinear')}</p>}
      {ciclo && <div className="ciclo-linear"><b>{ciclo.nombre}</b><span className="medidor"><span style={{ width: `${ciclo.progreso}%` }} /></span><span>{ciclo.progreso} % · {t('panels.ends')} {new Date(ciclo.fin).toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'short' })}</span></div>}
      <div className="pestanas"><button className={'chip' + (!proyecto ? ' on' : '')} onClick={() => setProject(null)}>{t('panels.allProjects')}</button>{proyectos.map(p => <button key={p} className={'chip' + (proyecto === p ? ' on' : '')} onClick={() => setProject(p)}>{p}</button>)}<button className={'chip' + (onlyUrgent ? ' on' : '')} onClick={() => setOnlyUrgent(x => !x)}>{t('panels.urgentAndHigh')}</button></div>
      <div className="kanban" style={{ gridTemplateColumns: `repeat(${Math.max(1, grupos.length)}, 1fr)` }}>
        {grupos.map((g, c) => (
          <div key={g.tipo} className={'kanban-col' + (c === col ? ' activa' : '')}>
            <h3>{g.nombre} <span className="tenue">{g.issues.length}</span></h3>
            {g.issues.map((x: any, k: number) => (
              <div key={x.id} className={'ficha-issue p' + x.prioridad + (c === col && k === Math.min(i, g.issues.length - 1) ? ' sel' : '')} onMouseEnter={() => { setCol(c); setI(k); }} onDoubleClick={() => openOutside(x.url)}>
                <span className="ident">{x.identificador}</span> {x.titulo}
                <small className="tenue">{[x.textPriority, x.proyecto, seeTeam ? x.asignado : '', x.estado?.nombre !== g.nombre ? x.estado?.nombre : ''].filter(Boolean).join(' · ')}</small>
              </div>
            ))}
            {!g.issues.length && <p className="tenue">—</p>}
          </div>
        ))}
      </div>
      <Keys><kbd>←→</kbd>{t('panels.column')} <kbd>↑↓</kbd>{t('panels.issue')} <kbd>Enter</kbd>{t('panels.openInLinear')} <kbd>P</kbd>{t('panels.project')} <kbd>U</kbd>{t('panels.urgent')} <kbd>T</kbd>{seeTeam ? t('panels.myIssues2') : t('panels.teamBoard2')} <kbd>R</kbd>{t('panels.reload')} <kbd>Esc</kbd>{t('panels.backToChangeThemTalk')}</Keys>
    </Device>
  );
}
