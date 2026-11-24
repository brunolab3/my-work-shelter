// Aparatos del refugio que no son el intercomunicador: plano con viaje rápido y reorganización (M), lista de ocupados
// con salto directo (Tab), ayuda con todos los controles (F1) y el menú del juego (Esc): opciones, atajos, reiniciar,
// salir a la superficie y salir (empieza en «Volver al refugio»). Lo demás se busca con ⌘K (Search.tsx).
// También las teclas globales del refugio abierto.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { juego, type Panel, type DwellerSummary } from './gameState';
import { live, client, logPageSize, setLogPageSize } from '../net/client';
import { LOG_PAGE_SIZES } from '@shared/logPages';
import { keyboard } from '../engine/keyboard';
import { SFX, sound } from '../audio/sound';
import { Device, Options, Keys, closePanel, useMenu, useKeys, type ItemMenu } from './device';
import { RoomPanels } from './RoomPanels';
import { Welcome } from './Bridge';
import { floorCaption, isRoomOfRepo, PLANNING_ROOM } from '@shared/layout';
import { roomTone, sectorOf, floorSector, SECTORS, SECTORS_ORDER, AREAS } from '@shared/sectors';
import { ROOM_DESCRIPTION } from '@shared/initialShelter';
import { ACTIVE_SOURCES } from '@shared/sources';
import { ROOM_INFO, REPO_INFO, INTEGRATION_STATE } from '@shared/labels';
import { openGit } from './git/window';
import { DICTATION_LANGUAGES, dictationLanguage, setLanguageDictation } from './inputLine';
import { FRAME_RATES, frameRate, setFrameRate } from '../engine/frameRate';
import { MEMORY_LIMITS, hasMemoryWatch, memoryLimit, setMemoryLimit } from './memoryWatchdog';
import { MEMORY_THRESHOLDS } from '@shared/runningThings';
import { memoryThreshold, setMemoryThreshold } from './runningList';
import { takeASurface } from './surface';
import { reloadView } from '../engine/render';
import { Usage } from './usage';
import { t, language, setLanguage, LANGUAGES, tIs } from '@shared/language';
import { openSearch } from './Search';
import { terminals as openTerminals } from './Terminals';

export const openPanel = (panel: Panel, panelData: any = null) => { juego.set({ panel, panelData }); };
// lo que se abre desde el menú de Esc vuelve a él al salir (Esc o ×); abierto con su tecla, se cierra sin más
const fromMenu = () => juego.get().panelData?.since === 'menu';
const goBack = () => { if (fromMenu()) { SFX.close(); openPanel('menu'); } else closePanel(); };
export const goA = (roomId: string, dwellerId?: string, talk = false) => window.dispatchEvent(new CustomEvent('shelter:go', { detail: { roomId, dwellerId, talk } }));

const URGENCY: Record<string, number> = { waiting: 0, error: 1, finished: 2, working: 3, thinking: 3 };
/** El cliente de git: en una sala de repo, con su repo; en las demás, con el último que usaste */
export function openGitOfRoom(roomId: string) {
  const r = live.get().repos[roomId];
  openGit(r?.isGit ? { path: r.path, view: 'changes' } : {});
}
// el puesto de Control de Versiones no es un aparato: abre la ventana del cliente en sus cambios (y el de la matriz, en GitHub)
function OpenGit() {
  useEffect(() => { const d = juego.get().panelData; juego.set({ panel: null, panelData: null }); openGit({ view: d?.device === 'matrix' ? 'github' : 'changes' }); }, []);
  return null;
}

export const busy = (hs: DwellerSummary[]) => hs.filter(h => h.state in URGENCY).sort((a, b) => URGENCY[a.state] - URGENCY[b.state]);

export function Panels() {
  const panel = juego.use(e => e.panel);
  // teclas globales (solo con el refugio a la vista: sin diálogo ni aparato abierto)
  useEffect(() => keyboard.listen(e => {
    const j = juego.get();
    if (j.talkingWith || j.panel) return false;
    const shortcuts: Record<string, () => void> = {
      KeyM: () => openPanel('map'), Tab: () => openPanel('busy'), F1: () => openPanel('help'),
      KeyI: () => openPanel('inventory'), Escape: () => openPanel('menu'), KeyR: () => openPanel('log'),
      KeyQ: () => { const h = busy([...j.dwellers, ...j.copies]).find(x => x.state === 'waiting' || x.state === 'error'); if (h) goA(h.room, h.id, true); else SFX.notAllowed(); },
      KeyN: () => goA('comms'), KeyC: () => goA('calendar'), KeyL: () => goA('logistics'),
      KeyG: () => openGitOfRoom(j.currentRoom),
      KeyP: () => openPanel('bodyshop'),
    };
    const f = shortcuts[e.code]; if (!f) return false;
    f(); return true;
  }), []);
  // cerrar la pestaña con trabajo en marcha avisa
  useEffect(() => {
    if (/Electron/.test(navigator.userAgent)) return; // la ventana propia ya pregunta al cerrar
    const f = (ev: BeforeUnloadEvent) => { if (Object.values(live.get().sessions).some(s => s.state === 'working' || s.state === 'waiting')) { ev.preventDefault(); ev.returnValue = ''; } };
    addEventListener('beforeunload', f); return () => removeEventListener('beforeunload', f);
  }, []);
  if (!panel) return null;
  switch (panel) {
    case 'map': return <FloorPlan />;
    case 'busy': return <Busy />;
    case 'help': return <Help />;
    case 'options': return <GameOptions />;
    case 'menu': return <MenuGame />;
    case 'exit': return <Exit />;
    case 'restart': return <Restart />;
    case 'farewell': return <Farewell />;
    case 'welcome': return <Welcome />;
    case 'git': return <OpenGit />;
    default: return <RoomPanels panel={panel} />;
  }
}

// ---------------------------------------------------------------- plano del refugio
// el sitio de cada sala lo decide la disposición (shared/layout.ts); con «Editar» (O) se hacen obras: arrastrar una
// sala a otro hueco o a una franja entre plantas (abre una planta nueva; la que se queda vacía desaparece), arrastrar una
// planta entera por su rótulo, y volver a la disposición de serie
type Drag = { room: string } | { floor: number } | null;
function FloorPlan() {
  const rooms: any[] = live.use(e => e.state?.rooms ?? []);
  const dwellers = juego.use(e => e.dwellers);
  const current = juego.use(e => e.currentRoom);
  const [edit, setEdit] = useState(false);
  const [drag, setDrag] = useState<Drag>(null);
  const [restsOn, setOver] = useState('');   // el destino bajo el ratón mientras se arrastra
  // editando, la etiqueta de una sala de repo (su área: frontend, backend o críticos, con su color) cambia con un clic o C
  const hasArea = (s: any) => !!s && isRoomOfRepo(s.type) && s.id !== PLANNING_ROOM;
  const nextArea = (s: any) => {
    if (!hasArea(s)) { SFX.notAllowed(); return; }
    const area = AREAS[(AREAS.indexOf(sectorOf(s.type, s.id, s.area).id as any) + 1) % AREAS.length];
    client.action('room.area', { roomId: s.id, area }).then(() => SFX.toggle()).catch(() => SFX.notAllowed());
  };
  const floors = Math.max(0, ...rooms.map(s => s.floor)) + 1;
  // editando, un hueco libre más a cada lado para poder alargar cualquier planta
  const orders = Math.max(1, ...rooms.map(s => s.orden)) + (edit ? 2 : 1);
  const columns: { side: 'left' | 'right'; orden: number }[] = [...Array.from({ length: orders }, (_, k) => ({ side: 'left' as const, orden: orders - 1 - k })), ...Array.from({ length: orders }, (_, k) => ({ side: 'right' as const, orden: k }))];
  const roomIn = (p: number, c: { side: 'left' | 'right'; orden: number }) => rooms.find(s => s.floor === p && s.side === c.side && s.orden === c.orden);
  const [curId, setCurId] = useState<string>((rooms.find(s => s.id === current) ?? rooms[0])?.id ?? '');
  const sel = rooms.find(s => s.id === curId);
  // flechas: a la sala vecina de la misma planta, o a la más cercana (en horizontal) de la planta con salas de arriba o de abajo
  const xOf = (s: any) => (s.side === 'left' ? -(s.orden + 0.5) : s.orden + 0.5);
  const move = (dc: number, dp: number) => {
    if (!sel) { if (rooms[0]) setCurId(rooms[0].id); return; }
    let cands: any[] = [];
    if (dc) cands = rooms.filter(s => s.floor === sel.floor && Math.sign(xOf(s) - xOf(sel)) === dc);
    else for (let p = sel.floor + dp; p >= 0 && p < floors && !cands.length; p += dp) cands = rooms.filter(s => s.floor === p);
    const other = cands.sort((a, b) => Math.abs(xOf(a) - xOf(sel)) - Math.abs(xOf(b) - xOf(sel)))[0];
    if (other) { setCurId(other.id); SFX.tick(); } else SFX.notAllowed();
  };
  const pick = (s = sel) => { if (!s) return; closePanel(); goA(s.id); };
  const byHand = rooms.some(s => s.manual);
  const works = (d: Record<string, unknown>) => client.action('shelter.move', d).then(() => SFX.toggle()).catch(() => SFX.notAllowed());
  const stock = () => client.action('shelter.defaultLayout').then(() => SFX.toggle()).catch(() => SFX.notAllowed());
  const toggleEdit = () => { setEdit(x => !x); setDrag(null); SFX.toggle(); };
  // arrastrar y soltar: `destino` describe dónde caería lo arrastrado; la clave sirve para resaltarlo
  const droppable = (key: string, can: boolean, onDrop: () => void) => !edit || !can ? {} : {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (restsOn !== key) setOver(key); },
    onDragLeave: () => setOver(x => (x === key ? '' : x)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(''); setDrag(null); onDrop(); },
  };
  const draggable = (a: Drag) => !edit || !a ? {} : {
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', JSON.stringify(a)); setDrag(a); },
    onDragEnd: () => { setDrag(null); setOver(''); },
  };
  const ofRoom = drag && 'room' in drag ? drag.room : '';
  const ofFloor = drag && 'floor' in drag ? drag.floor : -1;
  useKeys(e => {
    if (e.code === 'KeyO') toggleEdit();
    else if (edit && e.code === 'KeyN' && byHand) stock();
    else if (edit && e.code === 'KeyC') nextArea(sel);
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') move(-1, 0);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') move(1, 0);
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') move(0, -1);
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') move(0, 1);
    else if (e.code === 'Enter' || e.code === 'KeyE' || e.code === 'Space') { SFX.click(); pick(); }
    else if (e.code === 'Escape' && edit) toggleEdit();
    else if (e.code === 'Escape' || e.code === 'KeyM') closePanel();
  }, [curId, rooms, edit, byHand]);
  const roomState = (id: string) => {
    const hs = dwellers.filter(h => h.room === id);
    return hs.some(h => h.state === 'error') ? 'error' : hs.some(h => h.state === 'waiting') ? 'waiting' : hs.some(h => h.state === 'working' || h.state === 'thinking') ? 'working' : hs.some(h => h.state === 'finished') ? 'finished' : 'idle';
  };
  const selHs = sel ? dwellers.filter(h => h.room === sel.id) : [];
  // el plano es una foto del corte de verdad, de frente, con las salas como zonas que se eligen
  const [photo, setPhoto] = useState<any>(null);
  const roomsSignature = rooms.map(s => `${s.id}:${s.floor}${s.side}${s.orden}`).join('|');
  useEffect(() => {
    const t = setTimeout(() => { try { setPhoto((window as any).__shelter?.mapSnapshot() ?? null); } catch { setPhoto(null); } }, 40);
    return () => clearTimeout(t);
  }, [roomsSignature]);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize([el.clientWidth, el.clientHeight])); ro.observe(el); return () => ro.disconnect();
  }, [!!photo]);
  const [fw, fh] = photo && size[0] ? (size[0] / size[1] > photo.look ? [size[1] * photo.look, size[1]] : [size[0], size[0] / photo.look]) : [0, 0];
  const pct = (r: number[]) => ({ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${(r[2] - r[0]) * 100}%`, height: `${(r[3] - r[1]) * 100}%` });
  const content = (s: any) => {
    const hs = dwellers.filter(x => x.room === s.id);
    return <>
      <span className="nom">{s.name}</span>
      {edit && hasArea(s) && (() => { const sec = sectorOf(s.type, s.id, s.area); return (
        <button className="plano-area" title={t('panels.clickToChangeArea')} style={{ ['--sector' as any]: sec.color, ['--tinta' as any]: sec.ink }}
          draggable={false} onMouseDown={ev => ev.stopPropagation()} onClick={ev => { ev.stopPropagation(); setCurId(s.id); nextArea(s); }}><b>{sec.code}</b>{tIs(sec.name)}</button>
      ); })()}
      <span className="hab">{hs.map(x => <i key={x.id} className={x.state} title={x.name} />)}</span>
      {s.id === current && <span className="tu">{t('windows.you')}</span>}
    </>;
  };
  return (
    <Device label={t('panels.shelterMapFastTravel')} width={84} height kind="map">
      <div className="plano-cuerpo">
        {photo && !edit ? <div className="plano-caja" ref={box}>
          <div className="plano-foto" style={{ width: fw, height: fh }}>
            <img src={photo.url} alt="" draggable={false} />
            {Array.from({ length: floors }, (_, p) => { const h = photo.gaps.find((x: any) => x.floor === p); return h ? <div key={p} className="plano-planta-rotulo" title={tIs(floorSector(p, floors, rooms).name)} style={{ top: `${h.r[1] * 100}%`, height: `${(h.r[3] - h.r[1]) * 100}%`, ['--sector' as any]: floorSector(p, floors, rooms).color, ['--tinta' as any]: floorSector(p, floors, rooms).ink, ['--letra' as any]: floorSector(p, floors, rooms).letter }}>{floorCaption(p)}<b>{floorSector(p, floors, rooms).code}</b></div> : null; })}
            {photo.gaps.map((h: any) => {
              const s = rooms.find(x => x.id === h.id); if (!s) return null;
              return (
                <div key={s.id} className={'plano-zona ' + roomState(s.id) + (s.id === curId ? ' cur' : '') + (s.id === current ? ' aqui' : '')}
                  style={{ ...pct(h.r), ['--acento' as any]: roomTone(s)[0] }}
                  onMouseEnter={() => setCurId(s.id)} onClick={() => { setCurId(s.id); pick(s); }}>
                  {content(s)}
                </div>
              );
            })}
          </div>
        </div> : <div className={'plano-corte' + (edit ? ' editando' : '')} style={{ gridTemplateColumns: `2.2em repeat(${orders}, 1fr) 2.6em repeat(${orders}, 1fr)` }}>
          <div className="plano-superficie" style={{ gridColumn: `1 / span ${orders * 2 + 2}` }} />
          {Array.from({ length: floors + (edit ? 1 : 0) }, (_, p) => {
            // editando, encima de cada planta (menos la PB) y al fondo, una franja que abre una planta nueva ahí
            const strip = edit && p >= 1 && (
              <div key={'n' + p} className={'map-new' + (restsOn === 'n' + p ? ' sobre' : '') + (ofRoom ? ' active' : '')} style={{ gridColumn: `1 / span ${orders * 2 + 2}` }}
                {...droppable('n' + p, !!ofRoom, () => works({ roomId: ofRoom, floor: p, side: 'right', orden: 0, newFloor: true }))}>
                {ofRoom ? t('panels.newFloorP', { p: floorCaption(p) }) : ''}
              </div>
            );
            if (p === floors) return strip;
            const sector = floorSector(p, floors, rooms);
            return (
              <React.Fragment key={p}>
                {strip}
                <div className={'map-floor' + (edit && p >= 1 ? ' movible' : '') + (restsOn === 'p' + p ? ' sobre' : '')} title={edit && p >= 1 ? t('panels.dragTheFloorToAnother') : tIs(sector.name)} style={{ ['--sector' as any]: sector.color, ['--tinta' as any]: sector.ink, ['--letra' as any]: sector.letter }}
                  {...draggable(p >= 1 ? { floor: p } : null)} {...droppable('p' + p, ofFloor >= 1 && p >= 1 && p !== ofFloor, () => works({ from: ofFloor, a: p }))}>
                  {floorCaption(p)}<b>{sector.code}</b>
                </div>
                {columns.map((c, k) => {
                  const s = roomIn(p, c);
                  const key = `${p}${c.side}${c.orden}`;
                  const cell = (
                    <div key={k} className={'map-cell' + (s ? ' ' + roomState(s.id) : ' vacia') + (s && s.id === curId ? ' cur' : '') + (s?.id === current ? ' aqui' : '') + (s && s.id === ofRoom ? ' moviendo' : '') + (restsOn === key ? ' sobre' : '') + (edit && p >= 1 && ofRoom ? ' hueco' : '')}
                      style={s ? { ['--acento' as any]: roomTone(s)[0] } : undefined}
                      {...draggable(s && s.type !== 'gate' ? { room: s.id } : null)}
                      {...droppable(key, !!ofRoom && p >= 1 && s?.id !== ofRoom, () => works({ roomId: ofRoom, floor: p, side: c.side, orden: c.orden }))}
                      onMouseEnter={() => s && setCurId(s.id)} onClick={() => { if (s && !edit) { setCurId(s.id); pick(s); } }}>
                      {s && content(s)}
                    </div>
                  );
                  return c.side === 'right' && c.orden === 0 ? <React.Fragment key={k}><div className={'plano-ascensor' + (p === 0 ? ' arriba' : '')}>{p === floors - 1 ? '' : '▮'}</div>{cell}</React.Fragment> : cell;
                })}
              </React.Fragment>
            );
          })}
        </div>}
        <div className="plano-ficha">
          {sel ? <RoomCard key={sel.id} room={sel} dwellers={selHs} /> : <div className="dim">{t('panels.hoverOverARoomOr')}</div>}
        </div>
      </div>
      <div className="plano-leyenda">{SECTORS_ORDER.map(k => SECTORS[k]).map(x => <span key={x.id} style={{ ['--sector' as any]: x.color, ['--tinta' as any]: x.ink, ['--letra' as any]: x.letter }}><b>{x.code}</b>{tIs(x.name)}<i>{tIs(x.motto)}</i></span>)}</div>
      <div className="botonera plano-obras">
        <button className={'boton-taller' + (edit ? ' active' : '')} onClick={toggleEdit}>{edit ? t('panels.done') : t('panels.edit')}</button>
        {edit && <span className="dim">{t('panels.dragARoomToAnother')}</span>}
        {edit && byHand && <button className="boton-taller" onClick={stock}>{t('panels.defaultLayout')}</button>}
      </div>
      {edit
        ? <Keys><kbd>C</kbd>{t('panels.changeArea')} <kbd>O</kbd>{t('windows.finish')} {byHand && <><kbd>N</kbd>{t('panels.defaultLayout2')} </>}<kbd>Esc</kbd>{t('windows.finish')}</Keys>
        : <Keys><kbd>←↑↓→</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.travel')} <kbd>O</kbd>{t('panels.editTheShelter')} <kbd>Esc</kbd>{t('menu.close')}</Keys>}
    </Device>
  );
}

const ROOM_KEY: Record<string, string> = { comms: 'N', calendar: 'C', logistics: 'L', bodyshop: 'P' };
const ago = (ts: number) => { const m = Math.round((Date.now() - ts) / 60000); return m < 60 ? t('windows.nMinAgo', { n: Math.max(1, m) }) : m < 2880 ? t('windows.nHAgo', { n: Math.round(m / 60) }) : t('windows.nDaysAgo', { n: Math.round(m / 1440) }); };
function RoomCard({ room, dwellers }: { room: any; dwellers: DwellerSummary[] }) {
  const repo = live.use(e => e.repos[room.id]);
  const notices = live.use(e => e.notifications);
  const events = live.use(e => e.events);
  const ints = live.use(e => e.integrations);
  const music = live.use(e => e.music);
  const sessions = Object.values(live.use(e => e.sessions)).filter(x => x.roomId === room.id && x.state !== 'closed' && (x.context || x.tokens));
  const isRepo = room.type === 'repo' || room.type === 'coordination';
  const data: [string, React.ReactNode][] = [];
  if (room.path) data.push(['Carpeta', <code>{room.path.replace(/^\/Users\/[^/]+/, '~')}</code>]);
  // consumo de cada conversación abierta de la sala (contexto ocupado y tokens)
  for (const x of sessions) data.push([x.id, <><span className="dim">{x.title || t('panels.conversation')}</span> <Usage s={x} length /></>]);
  if (repo?.exists === false) data.push(['Aviso', <span className="notice-console">{t('panels.folderNotFound')}</span>]);
  else if (repo) {
    if (repo.branch) data.push(['Rama', repo.branch]);
    if (repo.isGit) data.push(['Cambios', repo.changes ? t('panels.nUncommitted', { n: repo.changes }) : t('panels.clean')]);
    if (repo.lastCommit) data.push(['Último commit', <><span className="una-linea" title={repo.lastCommit.message}>{repo.lastCommit.message}</span><span className="dim">{ago(repo.lastCommit.date)}</span></>]);
    const capsules = repo.worktrees.filter(w => !w.main);
    if (capsules.length) data.push(['Copias', capsules.map(w => w.branch || t('windows.noBranch')).join(', ')]);
    if (repo.subrepos?.length) data.push(['Repos dentro', repo.subrepos.join(', ')]);
  }
  if (room.type === 'comms') { const n = notices.filter((x: any) => !x.view).length; data.push(['Avisos', n ? t('panels.nUnseen', { n }) : t('panels.allRead')]); }
  if (room.type === 'calendar') { const ev = events.filter((x: any) => x.end > Date.now()).sort((a: any, b: any) => a.start - b.start)[0]; data.push(['Próxima', ev ? <>{ev.title} <span className="dim">· {new Date(ev.start).toLocaleString((language() === 'en' ? 'en-GB' : 'es-ES'), { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span></> : t('panels.nothingOnTheAgenda')]); }
  if (room.type === 'logistics') data.push(['Jira', tIs(INTEGRATION_STATE[ints.jira?.state ?? 'demo'])], ...(ints.linear ? [['Linear', tIs(INTEGRATION_STATE[ints.linear.state ?? 'demo'])] as [string, string]] : []));
  if (room.type === 'disco') data.push(['Sonando', music?.hint && music.state !== 'stopped' ? <>{music.hint.title} <span className="dim">· {music.hint.artist}{music.state === 'paused' ? t('panels.paused') : ''}</span></> : t('panels.nothing')]);
  if (room.type === 'vault') { const ids = ACTIVE_SOURCES; data.push(['Integraciones', t('panels.nOfTotalConnected', { n: ids.filter(f => ints[f]?.state === 'connected').length, total: ids.length })]); }
  if (ROOM_KEY[room.type]) data.push(['Atajo', <><kbd>{ROOM_KEY[room.type]}</kbd> {t('panels.fromAnywhere')}</>]);
  const desc = ROOM_DESCRIPTION[room.type] ?? (isRepo ? t('panels.repository') + (repo?.type ? ' · ' + repo.type : '') : '');
  return <>
    <div className="titulo-ficha">{room.name} <span className="dim">· {floorCaption(room.floor)}</span></div>
    {(() => { const sec = sectorOf(room.type, room.id, room.area); return <div className="ficha-sector" style={{ ['--sector' as any]: roomTone(room)[0], ['--tinta' as any]: sec.ink, ['--letra' as any]: sec.letter }}><b>{sec.code}</b>{t('panels.sectorName', { name: tIs(sec.name).toLowerCase() })}</div>; })()}
    {desc && <div className="ficha-desc">{tIs(desc)}</div>}
    <p className="ficha-info">{tIs(ROOM_INFO[room.type] ?? (isRepo ? REPO_INFO : ''))}</p>
    {data.length > 0 && <dl className="ficha-datos">{data.map(([k, v]) => <React.Fragment key={k}><dt>{sessions.some(x => x.id === k) ? t('panels.context') : tIs(k)}</dt><dd>{v}</dd></React.Fragment>)}</dl>}
    <div className="ficha-seccion">{t('panels.dwellers')}</div>
    <ul className="plano-hab">{dwellers.map(h => <li key={h.id} className={h.state}><b>{h.name}</b> <span className="dim">{tIs(h.state)}</span> {h.detail && <span className="det">{h.detail}</span>}</li>)}{!dwellers.length && <li className="dim">{t('panels.nobodyLivesHere')}</li>}</ul>
  </>;
}

// ---------------------------------------------------------------- qué pasa ahora: ocupados, notificaciones, próximo evento
const STATE_TEXT: Record<string, string> = { waiting: 'te espera', error: 'avería', finished: 'terminó, sin leer', working: 'trabajando', thinking: 'pensando' };
function Busy() {
  // las copias holográficas (worktrees) cuentan como uno más: tienen su propio intercomunicador
  const hs = busy(juego.use(e => [...e.dwellers, ...e.copies]));
  const notices = live.use(e => e.notifications).filter((n: any) => !n.view);
  const events = live.use(e => e.events).filter((ev: any) => ev.end > Date.now()).slice(0, 3);
  const items: (ItemMenu & { f: () => void })[] = [
    ...hs.map(h => ({ text: <><span className={'glifo-estado ' + h.state} /> <b>{h.name}</b> <span className="dim">· {h.nameRoom}</span></>, hint: <>{tIs(STATE_TEXT[h.state])}{h.detail ? ' — ' + h.detail : ''}</>, kind: h.state, f: () => { closePanel(); goA(h.room, h.id, h.state !== 'working' && h.state !== 'thinking'); } })),
    { text: <>{t('world.communications')} <span className="dim">· {t('panels.nUnseen', { n: notices.length })}</span></>, hint: notices[0] ? `${notices[0].author}: ${notices[0].title}` : t('panels.nothingNew'), f: () => { closePanel(); goA('comms'); } },
    { text: <>{t('world.calendar')} <span className="dim">· {events.length ? t('panels.nextEvent') : t('panels.noEvents')}</span></>, hint: events[0] ? `${new Date(events[0].start).toLocaleTimeString((language() === 'en' ? 'en-GB' : 'es-ES'), { hour: '2-digit', minute: '2-digit' })} ${events[0].title}` : '', f: () => { closePanel(); goA('calendar'); } },
  ];
  const [i, setI] = useMenu(items.length, k => items[k].f(), e => (e.code === 'Tab' ? (closePanel(), true) : undefined));
  return (
    <Device label={t('panels.whatSHappeningNow')} width={46} pilot={hs.some(h => h.state === 'waiting') ? 'waiting' : hs.length ? 'working' : 'idle'}>
      {!hs.length && <p className="dim">{t('panels.nobodyIsWorkingRightNow')}</p>}
      <Options items={items} i={i} setI={setI} onChoose={k => items[k].f()} />
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.goAndTalkIfThey')} <kbd>Q</kbd>{t('panels.inTheShelterGoTo')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- ayuda: todos los controles
const CONTROLS: [string, string][] = [
  ['WASD / flechas', 'correr (con Shift, andar)'], ['W / S en el rellano', 'subir y bajar en ascensor'], ['E / Enter', 'hablar, usar, avanzar, elegir'], ['Espacio', 'saltar'],
  ['clic', 'ir a un sitio; clic en un habitante: ir y hablar'], ['rueda / Z / − =', 'zoom, vista general y vista de sala'],
  ['M', 'plano: viaje rápido y obras (O o «Editar»: arrastrar salas y plantas a su sitio)'], ['Tab', 'qué pasa ahora: ocupados, notificaciones y próximo evento'],
  ['Q', 'ir directo al primer habitante que te espera'], ['T', 'terminal real de la sala (shell sobre PTY)'],
  ['R', 'cuaderno: transcripción completa de una conversación'], ['I', 'inventario, guía de campo y tienda'],
  ['N / C / L', 'ir a comunicaciones, agenda o planificación'], ['G', 'cliente de git (en una sala de repo, con su repo)'], ['P', 'Chapa y Pintura: cambiar el aspecto (tuyo o de un habitante)'],
  ['⌘K', 'buscador, desde cualquier sitio: conversaciones abiertas y recientes, acciones (con su tecla), habitantes y salas; escribe y Enter'],
  ['Esc', 'cierra lo abierto; en el refugio, el menú del juego: opciones, atajos, reiniciar y salir (al escritorio, al móvil o cerrando)'],
];
const DIALOG_CONTROLS: [string, string][] = [
  ['Enter', 'enviar (Shift+Enter: salto de línea)'], ['/', 'menú de comandos de Claude Code con autocompletado'],
  ['/btw pregunta', 'pregunta lateral sin interrumpir el trabajo'], ['Ctrl+↑↓, RePág/AvPág', 'desplazar la conversación mientras escribes'],
  ['Ctrl+C', 'parar al habitante (también /stop)'], ['Esc', 'atrás; en la conversación borra lo escrito; arriba del todo, vuelves al refugio y el trabajo sigue'],
  ['← en los menús', 'atrás'], ['pegar, arrastrar · ⌘U · 📎', 'adjuntar capturas, imágenes o archivos (las imágenes las ve directamente)'],
  ['⌘D · 🎙', 'dictar: habla y pulsa Espacio (o ⌘D otra vez) para terminar; Enter termina y envía, Esc descarta. Lo transcribe macOS en tu Mac (idioma en Opciones)'],
  ['1 / 2 / 3 en permisos', 'permitir, permitir siempre en la sesión, denegar'],
  ['repo con configuración propia', 'si trae .claude/, .mcp.json o CLAUDE.md y no te fías aún de él, pregunta antes de empezar: 1 cargarla esta vez, 2 siempre para esa carpeta, 3 trabajar sin ella (sin sus hooks, MCP ni instrucciones)'],
];
const WINDOW_CONTROLS: [string, string][] = [
  ['⌘T', 'pestaña nueva: otro trabajo con el mismo habitante, u otro shell en la terminal'],
  ['⌘W / ⌘⇧W', 'cerrar la pestaña / la ventana; con algo en marcha, pregunta antes'], ['⌘1…⌘9, ⌃Tab', 'cambiar de pestaña'],
  ['⌘↓ · ⌘M · _', 'minimizar a la barra de abajo a la izquierda; todo sigue y al volver se ve igual'],
  ['⌘↑ · ▢', 'pantalla completa (⌘↓ la restaura; también doble clic en la cabecera)'],
  ['⌘B (B en el refugio)', 'barra de ventanas con el teclado: ←→ elegir, ↑↓ fila, Intro abrir, X cerrar, M minimizar, Esc salir'],
  ['⌘J (J en el refugio)', 'la música: sin Spotify, lo abre; con Spotify delante, lo minimiza; con la pletina, la despliega en mano: Espacio ⏯, ←→ ±10 s, ⇧←→ temas, ↑↓ volumen, Intro abre Spotify, Esc salir'],
  ['Esc y Ctrl+C en la terminal', 'van al programa, como en iTerm: paran a Claude Code o salen de él'],
  ['⌘⇧E · ↗', 'sacar la pestaña a una terminal de tu escritorio (ver «A la superficie»)'],
];
// Salir a la superficie: lo del juego sigue en iTerm (o Terminal) cuando el juego se cae o no conviene que se vea
const SURFACE_CONTROLS: [string, string][] = [
  ['⇧⌥⌘Esc', 'tecla de pánico, desde cualquier app: el juego desaparece (ventana, Dock y sonido) y todo lo abierto sale a una ventana de iTerm. Otra vez (o abrir la app): vuelve como estaba'],
  ['↗ · ⌘⇧E', 'saca solo la pestaña activa de un intercomunicador o de una terminal'],
  ['conversations', 'se cierran aquí y siguen fuera con claude --resume, en su carpeta y con sus permisos; si estaban trabajando, se interrumpen y fuera se les pide que sigan'],
  ['volver a traerlas', '/exit en iTerm y «Retomar un trabajo anterior» en el habitante; mientras sigan abiertas fuera, el archivo las marca con ↗ y no se retoman aquí (si cerraste la pestaña sin /exit, Enter dos veces en el archivo fuerza el cierre)'],
  ['terminales', 'son la misma (el mismo shell, con lo que tenga en marcha) aquí y fuera; mientras esté fuera manda su tamaño y sobrevive aunque cierres el juego'],
  ['si el juego se cae', 'a los 20 s sin ventana (sin pasar por «Salir»), todo sale solo a tu escritorio'],
  ['./shelter superficie', 'desde cualquier terminal: lo saca todo, también con el juego caído; con --lista solo enseña qué hay'],
  ['la primera vez', 'macOS pide permiso para manejar iTerm: Ajustes del Sistema › Privacidad y seguridad › Automatización'],
];
const CONTROLS_GIT: [string, string][] = [
  ['G', 'abrir el cliente de git (en una sala de repo, con su repo); también desde el puesto de Control de Versiones'],
  ['↑↓ en los archivos', 'elegir archivo (su diff a la derecha); Espacio prepara o quita, Supr descarta, Intro lo abre en el editor'],
  ['clic en el margen del diff', 'elegir líneas sueltas (⇧ clic, un tramo) para preparar, quitar o descartar solo esas'],
  ['⌘Intro', 'commit de lo preparado (sin nada preparado: se prepara todo)'], ['▾ junto a Commit', 'commit y push, enmendar o deshacer el último'],
  ['⌘1…⌘4', 'cambios, historial, ramas y cajón, GitHub'],
];
function Help() {
  useKeys(e => { if (e.code === 'Escape' || e.code === 'F1' || e.code === 'Enter') goBack(); });
  return (
    <Device label={t('panels.overseerSManual')} width={64} height onClose={goBack}>
      <div className="lista-desplazable ayuda-columnas">
        <section><h3>{t('panels.inTheShelter')}</h3><dl className="tabla-teclas">{CONTROLS.map(([k, v]) => <React.Fragment key={k}><dt>{tIs(k)}</dt><dd>{tIs(v)}</dd></React.Fragment>)}</dl>
          <h3>{t('panels.toTheSurfaceOutsideThe')}</h3><dl className="tabla-teclas">{SURFACE_CONTROLS.map(([k, v]) => <React.Fragment key={k}><dt>{tIs(k)}</dt><dd>{tIs(v)}</dd></React.Fragment>)}</dl></section>
        <section><h3>{t('panels.talkingToADweller')}</h3><dl className="tabla-teclas">{DIALOG_CONTROLS.map(([k, v]) => <React.Fragment key={k}><dt>{tIs(k)}</dt><dd>{tIs(v)}</dd></React.Fragment>)}</dl>
          <h3>{t('panels.intercomsAndTerminals')}</h3><dl className="tabla-teclas">{WINDOW_CONTROLS.map(([k, v]) => <React.Fragment key={k}><dt>{tIs(k)}</dt><dd>{tIs(v)}</dd></React.Fragment>)}</dl>
          <h3>{t('world.gitClient')}</h3><dl className="tabla-teclas">{CONTROLS_GIT.map(([k, v]) => <React.Fragment key={k}><dt>{tIs(k)}</dt><dd>{tIs(v)}</dd></React.Fragment>)}</dl>
          <h3>{t('panels.signals')}</h3>
          <dl className="tabla-teclas">
            <dt><span className="glifo-estado waiting" /> {t('panels.amber')}</dt><dd>{t('panels.waitingForYouPermissionQuestion')}</dd>
            <dt><span className="glifo-estado finished" /> {t('panels.green')}</dt><dd>{t('panels.finishedAndYouHavenT')}</dd>
            <dt><span className="glifo-estado error" /> {t('panels.red')}</dt><dd>{t('panels.breakdownTheSessionFailed')}</dd>
            <dt><span className="glifo-estado working" /> {t('panels.phosphor')}</dt><dd>{t('panels.workingTheScreensTheSteam')}</dd>
            <dt>{t('panels.littleRobots')}</dt><dd>{t('panels.helpersSubagentsInTheRoom')}</dd>
            <dt>DEMO</dt><dd>{t('panels.thatIntegrationShowsSimulatedData')}</dd>
            <dt>{t('panels.deck')}</dt><dd>{t('panels.bottomLeftWithSpotifyMinimized')}</dd>
          </dl></section>
      </div>
      <Keys><kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- opciones (por navegador)
type Row = { lbl: string; values: string[]; current: number; set: (k: number) => void };
function GameOptions() {
  const [, refresh] = useState(0);
  const au = sound.settings;
  const pct = ['0 %', '10 %', '20 %', '30 %', '40 %', '50 %', '60 %', '70 %', '80 %', '90 %', '100 %'];
  const vol = (k: string) => ({ lbl: t(({ master: 'menu.masterVolume', ambient: 'menu.ambience', music: 'menu.roomMusic', sfx: 'menu.effects', ui: 'menu.interface', voces: 'menu.dwellerChatter', keyboard: 'menu.typingYourKeyboard' } as any)[k]), values: pct, current: Math.round((au as any)[k] * 10), set: (n: number) => { sound.save({ [k]: n / 10 }); refresh(x => x + 1); SFX.tick(); } });
  const rows: Row[] = [
    // cambiar de idioma recarga la vista: los carteles de las salas se pintan al montarlas
    { lbl: t('menu.language') + (language() === 'es' ? ' · Language' : ''), values: LANGUAGES.map(x => x.text), current: Math.max(0, LANGUAGES.findIndex(x => x.value === language())), set: k => { const v = LANGUAGES[k].value; if (v === language()) return; setLanguage(v); client.action('language', { language: v }).catch(() => {}).finally(reloadView); } },
    vol('master'), vol('ambiente'), vol('musica'), vol('sfx'), vol('ui'), vol('voces'), vol('teclado'),
    { lbl: t('menu.mute'), values: [t('menu.no'), t('menu.yes')], current: au.silence ? 1 : 0, set: k => { sound.save({ silence: k === 1 }); refresh(x => x + 1); } },
    // fotogramas por segundo del refugio: en automático, menos cuando nada se mueve (gasta bastante menos CPU)
    { lbl: t('menu.frameRate'), values: [t('menu.frameRateAuto'), '60 fps', '30 fps'], current: FRAME_RATES.indexOf(frameRate()), set: k => { setFrameRate(FRAME_RATES[k]); refresh(x => x + 1); SFX.tick(); } },
    // the latest messages an intercom opens a conversation with; older ones load when scrolling up (shared/logPages.ts)
    { lbl: t('menu.logPageSize'), values: LOG_PAGE_SIZES.map(String), current: Math.max(0, LOG_PAGE_SIZES.indexOf(logPageSize())), set: k => { setLogPageSize(LOG_PAGE_SIZES[k]); refresh(x => x + 1); SFX.tick(); } },
    { lbl: t('menu.dictationLanguage'), values: DICTATION_LANGUAGES.map(x => x.text), current: Math.max(0, DICTATION_LANGUAGES.findIndex(x => x.value === dictationLanguage())), set: k => { setLanguageDictation(DICTATION_LANGUAGES[k].value); refresh(x => x + 1); SFX.tick(); } },
    // over it, the indicator's memory row offers «Reload now» (memoryWatchdog.ts); only in the game's own window
    // the top bar's memory chip (RunningThings.tsx): amber from 75 % of it, red above
    { lbl: t('menu.memoryThreshold'), values: MEMORY_THRESHOLDS.map(mb => `${mb / 1024} GB`), current: Math.max(0, MEMORY_THRESHOLDS.indexOf(memoryThreshold())), set: k => { setMemoryThreshold(MEMORY_THRESHOLDS[k]); refresh(x => x + 1); SFX.tick(); } },
    ...(hasMemoryWatch() ? [{ lbl: t('menu.memoryLimit'), values: MEMORY_LIMITS.map(mb => mb ? `${mb / 1024} GB` : t('menu.memoryLimitNever')), current: Math.max(0, MEMORY_LIMITS.indexOf(memoryLimit())), set: (k: number) => { setMemoryLimit(MEMORY_LIMITS[k]); refresh(x => x + 1); SFX.tick(); } }] : []),
  ];
  const [i, setI] = useMenu(rows.length, k => { const f = rows[k]; f.set((f.current + 1) % f.values.length); }, e => {
    const f = rows[i]; if (!f) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { f.set(Math.max(0, f.current - 1)); return true; }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { f.set(Math.min(f.values.length - 1, f.current + 1)); return true; }
  }, goBack);
  return (
    <Device label={t('menu.optionsSavedInThisBrowser')} width={44} onClose={goBack}>
      <ul className="opciones-consola filas-ajuste">
        {rows.map((f, k) => (
          <li key={f.lbl} className={k === i ? 'active' : ''} onMouseEnter={() => setI(k)}>
            <span className="cursor">{k === i ? '▶' : ' '}</span><span className="txt">{f.lbl}</span>
            <span className="selector"><button onClick={() => f.set(Math.max(0, f.current - 1))}>◀</button><b>{f.values[f.current]}</b><button onClick={() => f.set(Math.min(f.values.length - 1, f.current + 1))}>▶</button></span>
          </li>
        ))}
      </ul>
      <p className="dim">{t('menu.credentialsTheReposRootThe')}</p>
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>←→</kbd>{t('menu.change')} <kbd>Esc</kbd>{t(fromMenu() ? 'menu.back' : 'menu.close')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- menú del juego (Esc)
// Solo lo que es del juego en sí; lo demás (conversaciones, aparatos, webs, salas) está en el buscador (⌘K)
const MAC_K = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+';
function MenuGame() {
  const sub = (p: Panel) => () => { SFX.click(); openPanel(p, { since: 'menu' }); };
  const items: (ItemMenu & { f: () => void })[] = [
    { text: t('menu.backToTheShelter'), hint: 'Esc', f: closePanel },
    { text: t('menu.searchConversationsActionsAndRooms'), hint: `${MAC_K}K`, f: () => { closePanel(); openSearch(); } },
    { text: t('menu.options'), hint: t('menu.soundAndLanguage'), f: sub('options') },
    { text: t('menu.keyboardShortcuts'), hint: 'F1', f: sub('help') },
    { text: t('menu.reloadTheView'), hint: t('menu.ifTheShelterGoesBlack'), f: () => { SFX.click(); reloadView(); } },
    { text: t('menu.restartTheGame'), hint: t('menu.appliesServerChangesTerminalsKeep'), f: sub('restart') },
    { text: t('menu.leaveTheShelter'), hint: t('menu.surfacePhoneOrClose'), danger: true, f: sub('exit') },
  ];
  const [i, setI] = useMenu(items.length, k => items[k].f());
  return (
    <Device label={t('menu.overseerMenu')} width={46}>
      <Options items={items} i={i} setI={setI} onChoose={k => items[k].f()} />
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('menu.accept')} <kbd>Esc</kbd>{t('menu.backToTheShelter2')} <kbd>{MAC_K}K</kbd>{t('menu.searchEverythingElse')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- salir
// la única salida del menú: pregunta cómo se sale (lo abierto sigue en el escritorio o en el móvil, o se cierra todo)
function Exit() {
  const liveCount = Object.values(live.use(e => e.sessions)).filter(s => s.state !== 'closed').length;
  const terms = openTerminals.use(e => e.list.length);
  const hasAny = liveCount + terms > 0;
  const items: (ItemMenu & { f: () => void })[] = [
    { text: t('menu.stay'), f: goBack },
    { text: t('menu.goToTheSurface'), hint: t(hasAny ? 'menu.everythingOpenToYourDesktop' : 'menu.nothingOpenToTakeOut'), powerOff: !hasAny, f: () => { if (!hasAny) { SFX.notAllowed(); return; } closePanel(); takeASurface({ all: true }); } },
    { text: t('menu.everythingToYourPhone'), hint: t(liveCount ? 'menu.openConversationsWithRemoteControl' : 'menu.noOpenConversations'), powerOff: !liveCount, f: () => { if (!liveCount) { SFX.notAllowed(); return; } closePanel(); takeASurface({ all: true, remote: true, windowNew: true }); } },
    { text: liveCount ? (liveCount === 1 ? t('menu.leaveAndStopTheLive') : t('menu.leaveAndStopTheN', { n: liveCount })) : t('menu.leaveTheShelter'), danger: true, f: () => { SFX.powerOff(); client.send({ t: 'quit' }); openPanel('farewell'); } },
  ];
  const pick = (k: number) => items[k].f();
  const [i, setI] = useMenu(items.length, pick, undefined, goBack);
  return (
    <Device label={t('menu.mainHatch')} width={46} pilot={liveCount ? 'waiting' : 'idle'} onClose={goBack}>
      <p className="voice">{t('menu.howDoYouLeaveOverseer')}</p>
      {liveCount > 0 && <p className="notice-console">{t(liveCount === 1 ? 'menu.thereIs1LiveSession' : 'menu.thereAreNLiveSessions', { n: liveCount })}</p>}
      <Options items={items} i={i} setI={setI} onChoose={pick} />
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('menu.confirm')} <kbd>Esc</kbd>{t('menu.stay2')}</Keys>
    </Device>
  );
}
// reinicio desde la regleta: servidor y ventana, sin cerrar las terminales (para aplicar cambios hechos al juego)
function Restart() {
  const liveCount = Object.values(live.use(e => e.sessions)).filter(s => ['starting', 'working', 'waiting'].includes(s.state)).length;
  const [state, setState] = useState<{ inProgress?: boolean; error?: string }>({});
  const items: ItemMenu[] = [{ text: t('panels.continue') }, { text: state.inProgress ? t('panels.restarting') : liveCount ? (liveCount === 1 ? t('panels.restartAndCutTheRunning') : t('panels.restartAndCutTheN', { n: liveCount })) : t('menu.restartTheGame'), danger: liveCount > 0 }];
  const pick = (k: number) => {
    if (k === 0) { goBack(); return; }
    if (state.inProgress) return;
    setState({ inProgress: true }); SFX.powerOff();
    client.action('restartGame').catch((e: Error) => { setState({ error: e.message }); SFX.notAllowed(); });
  };
  const [i, setI] = useMenu(2, pick, undefined, goBack);
  return (
    <Device label={t('panels.restart')} onClose={goBack} width={40} pilot={state.error ? 'error' : liveCount ? 'waiting' : 'idle'}>
      <p className="voice">{t('panels.restartTheGameOverseer')}</p>
      <p>{t('panels.theServerRestartsWithAny')}</p>
      {liveCount > 0 && <p className="notice-console">{liveCount === 1 ? t('panels.1DwellerIsWorkingOr') : t('panels.nDwellersAreWorkingOr', { n: liveCount })}</p>}
      {state.inProgress && <p className="notice-console">{t('panels.checkingTheNewCodeAnd')}</p>}
      {state.error && <p className="notice-console">{state.error}</p>}
      <Options items={items} i={i} setI={setI} onChoose={pick} />
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('menu.confirm')} <kbd>Esc</kbd>{t('panels.continue2')}</Keys>
    </Device>
  );
}
function Farewell() {
  useEffect(() => { keyboard.blocked = true; document.title = t('panels.workShelterSealed'); }, []);
  return <div className="farewell interactivo"><div className="placa-despedida">{t('panels.theShelterIsSealed')}<small>{t('panels.seeYouSoonOverseerTo')} <code>./shelter</code></small></div></div>;
}
