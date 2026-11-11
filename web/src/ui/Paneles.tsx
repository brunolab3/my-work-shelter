// Aparatos del refugio que no son el intercomunicador: plano con viaje rápido y reorganización (M), lista de ocupados
// con salto directo (Tab), ayuda con todos los controles (F1) y el menú del juego (Esc): opciones, atajos, reiniciar,
// salir a la superficie y salir (empieza en «Volver al refugio»). Lo demás se busca con ⌘K (Buscador.tsx).
// También las teclas globales del refugio abierto.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { juego, type Panel, type DwellerSummary } from './estadoJuego';
import { vivo, cliente } from '../red/cliente';
import { teclado } from '../motor/teclado';
import { SFX, sonido } from '../audio/sonido';
import { Device, Opciones, Keys, closePanel, useMenu, useKeys, type ItemMenu } from './aparato';
import { PanelesSala } from './PanelesSala';
import { Welcome } from './Puente';
import { floorCaption, isRoomOfRepo, PLANNING_ROOM } from '@shared/disposicion';
import { roomTone, sectorOf, floorSector, SECTORS, SECTORS_ORDER, AREAS } from '@shared/sectores';
import { ROOM_DESCRIPTION } from '@shared/refugioInicial';
import { ACTIVE_SOURCES } from '@shared/fuentes';
import { openGit } from './git/ventana';
import { DICTATION_LANGUAGES, dictationLanguage, setLanguageDictation } from './entrada';
import { FRAME_RATES, frameRate, setFrameRate } from '../motor/ritmo';
import { takeASurface } from './superficie';
import { reloadView } from '../motor/render';
import { Usage } from './consumo';
import { t, idioma, setLanguage, LANGUAGES, tIs } from '@shared/idioma';
import { openSearch } from './Buscador';
import { terminales as openTerminals } from './Terminales';

export const openPanel = (panel: Panel, panelData: any = null) => { juego.set({ panel, panelData }); };
// lo que se abre desde el menú de Esc vuelve a él al salir (Esc o ×); abierto con su tecla, se cierra sin más
const fromMenu = () => juego.get().panelData?.desde === 'menu';
const volver = () => { if (fromMenu()) { SFX.cerrar(); openPanel('menu'); } else closePanel(); };
export const goA = (salaId: string, dwellerId?: string, talk = false) => window.dispatchEvent(new CustomEvent('refugio:ir', { detail: { salaId, dwellerId, talk } }));

const URGENCY: Record<string, number> = { esperando: 0, error: 1, terminado: 2, trabajando: 3, pensando: 3 };
/** El cliente de git: en una sala de repo, con su repo; en las demás, con el último que usaste */
export function openGitOfRoom(salaId: string) {
  const r = vivo.get().repos[salaId];
  openGit(r?.isGit ? { ruta: r.ruta, vista: 'cambios' } : {});
}
// el puesto de Control de Versiones no es un aparato: abre la ventana del cliente en sus cambios (y el de la matriz, en GitHub)
function OpenGit() {
  useEffect(() => { const d = juego.get().panelData; juego.set({ panel: null, panelData: null }); openGit({ vista: d?.aparato === 'matriz' ? 'github' : 'cambios' }); }, []);
  return null;
}

export const ocupados = (hs: DwellerSummary[]) => hs.filter(h => h.estado in URGENCY).sort((a, b) => URGENCY[a.estado] - URGENCY[b.estado]);

export function Paneles() {
  const panel = juego.usar(e => e.panel);
  // teclas globales (solo con el refugio a la vista: sin diálogo ni aparato abierto)
  useEffect(() => teclado.escuchar(e => {
    const j = juego.get();
    if (j.talkingWith || j.panel) return false;
    const shortcuts: Record<string, () => void> = {
      KeyM: () => openPanel('plano'), Tab: () => openPanel('ocupados'), F1: () => openPanel('ayuda'),
      KeyI: () => openPanel('inventario'), Escape: () => openPanel('menu'), KeyR: () => openPanel('cuaderno'),
      KeyQ: () => { const h = ocupados([...j.habitantes, ...j.copias]).find(x => x.estado === 'esperando' || x.estado === 'error'); if (h) goA(h.sala, h.id, true); else SFX.noAllowed(); },
      KeyN: () => goA('comunicaciones'), KeyC: () => goA('planificacion'), KeyL: () => goA('logistica'),
      KeyG: () => openGitOfRoom(j.currentRoom),
      KeyP: () => openPanel('chapa'),
    };
    const f = shortcuts[e.code]; if (!f) return false;
    f(); return true;
  }), []);
  // cerrar la pestaña con trabajo en marcha avisa
  useEffect(() => {
    if (/Electron/.test(navigator.userAgent)) return; // la ventana propia ya pregunta al cerrar
    const f = (ev: BeforeUnloadEvent) => { if (Object.values(vivo.get().sesiones).some(s => s.estado === 'trabajando' || s.estado === 'esperando')) { ev.preventDefault(); ev.returnValue = ''; } };
    addEventListener('beforeunload', f); return () => removeEventListener('beforeunload', f);
  }, []);
  if (!panel) return null;
  switch (panel) {
    case 'plano': return <Plano />;
    case 'ocupados': return <Busy />;
    case 'ayuda': return <Help />;
    case 'opciones': return <GameOptions />;
    case 'menu': return <MenuGame />;
    case 'salir': return <Salir />;
    case 'reiniciar': return <Reiniciar />;
    case 'despedida': return <Farewell />;
    case 'bienvenida': return <Welcome />;
    case 'git': return <OpenGit />;
    default: return <PanelesSala panel={panel} />;
  }
}

// ---------------------------------------------------------------- plano del refugio
// el sitio de cada sala lo decide la disposición (shared/disposicion.ts); con «Editar» (O) se hacen obras: arrastrar una
// sala a otro hueco o a una franja entre plantas (abre una planta nueva; la que se queda vacía desaparece), arrastrar una
// planta entera por su rótulo, y volver a la disposición de serie
type Drag = { sala: string } | { planta: number } | null;
function Plano() {
  const salas: any[] = vivo.usar(e => e.estado?.salas ?? []);
  const habitantes = juego.usar(e => e.habitantes);
  const actual = juego.usar(e => e.currentRoom);
  const [editar, setEditar] = useState(false);
  const [arrastre, setDrag] = useState<Drag>(null);
  const [sobre, setOver] = useState('');   // el destino bajo el ratón mientras se arrastra
  // editando, la etiqueta de una sala de repo (su área: frontend, backend o críticos, con su color) cambia con un clic o C
  const hasArea = (s: any) => !!s && isRoomOfRepo(s.tipo) && s.id !== PLANNING_ROOM;
  const nextArea = (s: any) => {
    if (!hasArea(s)) { SFX.noAllowed(); return; }
    const area = AREAS[(AREAS.indexOf(sectorOf(s.tipo, s.id, s.area).id as any) + 1) % AREAS.length];
    cliente.accion('sala.area', { salaId: s.id, area }).then(() => SFX.conmutar()).catch(() => SFX.noAllowed());
  };
  const plantas = Math.max(0, ...salas.map(s => s.planta)) + 1;
  // editando, un hueco libre más a cada lado para poder alargar cualquier planta
  const orders = Math.max(1, ...salas.map(s => s.orden)) + (editar ? 2 : 1);
  const columnas: { lado: 'izq' | 'der'; orden: number }[] = [...Array.from({ length: orders }, (_, k) => ({ lado: 'izq' as const, orden: orders - 1 - k })), ...Array.from({ length: orders }, (_, k) => ({ lado: 'der' as const, orden: k }))];
  const roomIn = (p: number, c: { lado: 'izq' | 'der'; orden: number }) => salas.find(s => s.planta === p && s.lado === c.lado && s.orden === c.orden);
  const [curId, setCurId] = useState<string>((salas.find(s => s.id === actual) ?? salas[0])?.id ?? '');
  const sel = salas.find(s => s.id === curId);
  // flechas: a la sala vecina de la misma planta, o a la más cercana (en horizontal) de la planta con salas de arriba o de abajo
  const xOf = (s: any) => (s.lado === 'izq' ? -(s.orden + 0.5) : s.orden + 0.5);
  const mover = (dc: number, dp: number) => {
    if (!sel) { if (salas[0]) setCurId(salas[0].id); return; }
    let cands: any[] = [];
    if (dc) cands = salas.filter(s => s.planta === sel.planta && Math.sign(xOf(s) - xOf(sel)) === dc);
    else for (let p = sel.planta + dp; p >= 0 && p < plantas && !cands.length; p += dp) cands = salas.filter(s => s.planta === p);
    const otra = cands.sort((a, b) => Math.abs(xOf(a) - xOf(sel)) - Math.abs(xOf(b) - xOf(sel)))[0];
    if (otra) { setCurId(otra.id); SFX.tick(); } else SFX.noAllowed();
  };
  const elegir = (s = sel) => { if (!s) return; closePanel(); goA(s.id); };
  const aMano = salas.some(s => s.manual);
  const works = (d: Record<string, unknown>) => cliente.accion('refugio.mover', d).then(() => SFX.conmutar()).catch(() => SFX.noAllowed());
  const stock = () => cliente.accion('refugio.disposicionDeSerie').then(() => SFX.conmutar()).catch(() => SFX.noAllowed());
  const toggleEdit = () => { setEditar(x => !x); setDrag(null); SFX.conmutar(); };
  // arrastrar y soltar: `destino` describe dónde caería lo arrastrado; la clave sirve para resaltarlo
  const droppable = (clave: string, puede: boolean, alSoltar: () => void) => !editar || !puede ? {} : {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (sobre !== clave) setOver(clave); },
    onDragLeave: () => setOver(x => (x === clave ? '' : x)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(''); setDrag(null); alSoltar(); },
  };
  const arrastrable = (a: Drag) => !editar || !a ? {} : {
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', JSON.stringify(a)); setDrag(a); },
    onDragEnd: () => { setDrag(null); setOver(''); },
  };
  const ofRoom = arrastre && 'sala' in arrastre ? arrastre.sala : '';
  const ofFloor = arrastre && 'planta' in arrastre ? arrastre.planta : -1;
  useKeys(e => {
    if (e.code === 'KeyO') toggleEdit();
    else if (editar && e.code === 'KeyN' && aMano) stock();
    else if (editar && e.code === 'KeyC') nextArea(sel);
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') mover(-1, 0);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') mover(1, 0);
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') mover(0, -1);
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') mover(0, 1);
    else if (e.code === 'Enter' || e.code === 'KeyE' || e.code === 'Space') { SFX.clic(); elegir(); }
    else if (e.code === 'Escape' && editar) toggleEdit();
    else if (e.code === 'Escape' || e.code === 'KeyM') closePanel();
  }, [curId, salas, editar, aMano]);
  const roomState = (id: string) => {
    const hs = habitantes.filter(h => h.sala === id);
    return hs.some(h => h.estado === 'error') ? 'error' : hs.some(h => h.estado === 'esperando') ? 'esperando' : hs.some(h => h.estado === 'trabajando' || h.estado === 'pensando') ? 'trabajando' : hs.some(h => h.estado === 'terminado') ? 'terminado' : 'ocioso';
  };
  const selHs = sel ? habitantes.filter(h => h.sala === sel.id) : [];
  // el plano es una foto del corte de verdad, de frente, con las salas como zonas que se eligen
  const [foto, setPhoto] = useState<any>(null);
  const roomsSignature = salas.map(s => `${s.id}:${s.planta}${s.lado}${s.orden}`).join('|');
  useEffect(() => {
    const t = setTimeout(() => { try { setPhoto((window as any).__refugio?.mapSnapshot() ?? null); } catch { setPhoto(null); } }, 40);
    return () => clearTimeout(t);
  }, [roomsSignature]);
  const caja = useRef<HTMLDivElement>(null);
  const [tam, setTam] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    const el = caja.current; if (!el) return;
    const ro = new ResizeObserver(() => setTam([el.clientWidth, el.clientHeight])); ro.observe(el); return () => ro.disconnect();
  }, [!!foto]);
  const [fw, fh] = foto && tam[0] ? (tam[0] / tam[1] > foto.aspecto ? [tam[1] * foto.aspecto, tam[1]] : [tam[0], tam[0] / foto.aspecto]) : [0, 0];
  const pct = (r: number[]) => ({ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${(r[2] - r[0]) * 100}%`, height: `${(r[3] - r[1]) * 100}%` });
  const contenido = (s: any) => {
    const hs = habitantes.filter(x => x.sala === s.id);
    return <>
      <span className="nom">{s.nombre}</span>
      {editar && hasArea(s) && (() => { const sec = sectorOf(s.tipo, s.id, s.area); return (
        <button className="plano-area" title={t('panels.clickToChangeArea')} style={{ ['--sector' as any]: sec.color, ['--tinta' as any]: sec.tinta }}
          draggable={false} onMouseDown={ev => ev.stopPropagation()} onClick={ev => { ev.stopPropagation(); setCurId(s.id); nextArea(s); }}><b>{sec.codigo}</b>{tIs(sec.nombre)}</button>
      ); })()}
      <span className="hab">{hs.map(x => <i key={x.id} className={x.estado} title={x.nombre} />)}</span>
      {s.id === actual && <span className="tu">{t('windows.you')}</span>}
    </>;
  };
  return (
    <Device rotulo={t('panels.shelterMapFastTravel')} ancho={84} alto clase="plano">
      <div className="plano-cuerpo">
        {foto && !editar ? <div className="plano-caja" ref={caja}>
          <div className="plano-foto" style={{ width: fw, height: fh }}>
            <img src={foto.url} alt="" draggable={false} />
            {Array.from({ length: plantas }, (_, p) => { const h = foto.huecos.find((x: any) => x.planta === p); return h ? <div key={p} className="plano-planta-rotulo" title={tIs(floorSector(p, plantas, salas).nombre)} style={{ top: `${h.r[1] * 100}%`, height: `${(h.r[3] - h.r[1]) * 100}%`, ['--sector' as any]: floorSector(p, plantas, salas).color, ['--tinta' as any]: floorSector(p, plantas, salas).tinta, ['--letra' as any]: floorSector(p, plantas, salas).letra }}>{floorCaption(p)}<b>{floorSector(p, plantas, salas).codigo}</b></div> : null; })}
            {foto.huecos.map((h: any) => {
              const s = salas.find(x => x.id === h.id); if (!s) return null;
              return (
                <div key={s.id} className={'plano-zona ' + roomState(s.id) + (s.id === curId ? ' cur' : '') + (s.id === actual ? ' aqui' : '')}
                  style={{ ...pct(h.r), ['--acento' as any]: roomTone(s)[0] }}
                  onMouseEnter={() => setCurId(s.id)} onClick={() => { setCurId(s.id); elegir(s); }}>
                  {contenido(s)}
                </div>
              );
            })}
          </div>
        </div> : <div className={'plano-corte' + (editar ? ' editando' : '')} style={{ gridTemplateColumns: `2.2em repeat(${orders}, 1fr) 2.6em repeat(${orders}, 1fr)` }}>
          <div className="plano-superficie" style={{ gridColumn: `1 / span ${orders * 2 + 2}` }} />
          {Array.from({ length: plantas + (editar ? 1 : 0) }, (_, p) => {
            // editando, encima de cada planta (menos la PB) y al fondo, una franja que abre una planta nueva ahí
            const franja = editar && p >= 1 && (
              <div key={'n' + p} className={'plano-nueva' + (sobre === 'n' + p ? ' sobre' : '') + (ofRoom ? ' activa' : '')} style={{ gridColumn: `1 / span ${orders * 2 + 2}` }}
                {...droppable('n' + p, !!ofRoom, () => works({ salaId: ofRoom, planta: p, lado: 'der', orden: 0, nueva: true }))}>
                {ofRoom ? t('panels.newFloorP', { p: floorCaption(p) }) : ''}
              </div>
            );
            if (p === plantas) return franja;
            const sector = floorSector(p, plantas, salas);
            return (
              <React.Fragment key={p}>
                {franja}
                <div className={'plano-planta' + (editar && p >= 1 ? ' movible' : '') + (sobre === 'p' + p ? ' sobre' : '')} title={editar && p >= 1 ? t('panels.dragTheFloorToAnother') : tIs(sector.nombre)} style={{ ['--sector' as any]: sector.color, ['--tinta' as any]: sector.tinta, ['--letra' as any]: sector.letra }}
                  {...arrastrable(p >= 1 ? { planta: p } : null)} {...droppable('p' + p, ofFloor >= 1 && p >= 1 && p !== ofFloor, () => works({ de: ofFloor, a: p }))}>
                  {floorCaption(p)}<b>{sector.codigo}</b>
                </div>
                {columnas.map((c, k) => {
                  const s = roomIn(p, c);
                  const clave = `${p}${c.lado}${c.orden}`;
                  const celda = (
                    <div key={k} className={'plano-celda' + (s ? ' ' + roomState(s.id) : ' vacia') + (s && s.id === curId ? ' cur' : '') + (s?.id === actual ? ' aqui' : '') + (s && s.id === ofRoom ? ' moviendo' : '') + (sobre === clave ? ' sobre' : '') + (editar && p >= 1 && ofRoom ? ' hueco' : '')}
                      style={s ? { ['--acento' as any]: roomTone(s)[0] } : undefined}
                      {...arrastrable(s && s.tipo !== 'puerta' ? { sala: s.id } : null)}
                      {...droppable(clave, !!ofRoom && p >= 1 && s?.id !== ofRoom, () => works({ salaId: ofRoom, planta: p, lado: c.lado, orden: c.orden }))}
                      onMouseEnter={() => s && setCurId(s.id)} onClick={() => { if (s && !editar) { setCurId(s.id); elegir(s); } }}>
                      {s && contenido(s)}
                    </div>
                  );
                  return c.lado === 'der' && c.orden === 0 ? <React.Fragment key={k}><div className={'plano-ascensor' + (p === 0 ? ' arriba' : '')}>{p === plantas - 1 ? '' : '▮'}</div>{celda}</React.Fragment> : celda;
                })}
              </React.Fragment>
            );
          })}
        </div>}
        <div className="plano-ficha">
          {sel ? <RoomCard key={sel.id} sala={sel} habitantes={selHs} /> : <div className="tenue">{t('panels.hoverOverARoomOr')}</div>}
        </div>
      </div>
      <div className="plano-leyenda">{SECTORS_ORDER.map(k => SECTORS[k]).map(x => <span key={x.id} style={{ ['--sector' as any]: x.color, ['--tinta' as any]: x.tinta, ['--letra' as any]: x.letra }}><b>{x.codigo}</b>{tIs(x.nombre)}<i>{tIs(x.motto)}</i></span>)}</div>
      <div className="botonera plano-obras">
        <button className={'boton-taller' + (editar ? ' activa' : '')} onClick={toggleEdit}>{editar ? t('panels.done') : t('panels.edit')}</button>
        {editar && <span className="tenue">{t('panels.dragARoomToAnother')}</span>}
        {editar && aMano && <button className="boton-taller" onClick={stock}>{t('panels.defaultLayout')}</button>}
      </div>
      {editar
        ? <Keys><kbd>C</kbd>{t('panels.changeArea')} <kbd>O</kbd>{t('windows.finish')} {aMano && <><kbd>N</kbd>{t('panels.defaultLayout2')} </>}<kbd>Esc</kbd>{t('windows.finish')}</Keys>
        : <Keys><kbd>←↑↓→</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.travel')} <kbd>O</kbd>{t('panels.editTheShelter')} <kbd>Esc</kbd>{t('menu.close')}</Keys>}
    </Device>
  );
}

// Ficha del plano: la sala que está bajo el ratón o elegida con las flechas. Más que el cartel: para qué sirve, cómo
// llegar y lo que pasa ahora dentro (repo, avisos, próxima reunión, integraciones, habitantes)
const INFO_ROOM: Record<string, string> = {
  puerta: 'La entrada del refugio, a pie de calle. El Guardián decide quién pasa: aquí se recluta y se excava una sala nueva para cada carpeta de la raíz de repos que aún no tiene la suya.',
  camara: 'Guarda las conexiones con Microsoft 365, Google, Discord, Slack, GitHub y Linear (los secretos van al llavero de macOS, nunca al disco) y los ajustes del refugio: nombre, raíz de repos y límite de sesiones.',
  puente: 'Desde aquí se gobierna el refugio: su habitante trabaja en el repo del propio juego. La maqueta holográfica enseña cada sala en vivo y desde el panel de la sala se aplican los cambios del juego.',
  comunicaciones: 'Correo, chats y avisos de Outlook, Gmail, Discord, Slack, GitHub y Linear en un solo tablón, de solo lectura: lo que te menciona va primero y Enter abre el original (en su navegador del refugio si lo tiene; los números abren cada web sin pasar por un aviso). También está la radio.',
  planificacion: 'Calendario unificado de Microsoft 365 y Google Calendar: la semana, la agenda de los próximos días y el enlace para unirse a cada reunión.',
  git: 'Control de versiones: el cliente de git de todos los repos del refugio (preparar por archivos, bloques o líneas, commits, historial con su grafo, ramas y cajón), tu matriz de contribuciones de GitHub y tus pull requests. La Octocat vive aquí. G lo abre desde cualquier sitio.',
  logistica: 'Tablero: tus tareas de Jira con sus pull requests y el estado de cada uno. Su habitante usa el MCP oficial de Linear para crear, mover o comentar incidencias, siempre con tu permiso.',
  hidroponia: 'Los cultivos del refugio, para cuidarlos entre tarea y tarea.',
  galeria: 'Galería de tiro para despejarse un rato. Guarda los récords.',
  discoteca: 'La música para currar, en la planta de ocio. La cabina del DJ abre Spotify, que suena aquí dentro: elige lo que quieras y minimízalo; la pletina de abajo a la izquierda sigue con lo que suena y los mandos.',
  chapa: 'Barbería y ropería del refugio. En el sillón de Fito se cambia el aspecto del Supervisor o de cualquier habitante: humano o robot, cara, pelo, barba, ropa, sombreros, gafas, mochilas y colores. P lo abre desde cualquier sitio. La Octocat es como es.',
  coordinacion: 'Sala de planificación: la carpeta raíz con todos tus repos. Desde el tablero de Jira (P en una tarea por hacer) su habitante analiza la tarea viendo todos los repos y traza el plan contigo; con el plan aprobado, la reparte a la sala de cada repo, cada parte en su worktree, para seguirla allí.',
};
const INFO_REPO = 'Sala de un repositorio: sus habitantes trabajan aquí con Claude Code. Desde el panel de la sala se abre una terminal en la carpeta o se trabaja en una copia aparte (un worktree), que aparece en la sala como el holograma de quien la creó.';
const ROOM_KEY: Record<string, string> = { comunicaciones: 'N', planificacion: 'C', logistica: 'L', chapa: 'P' };
const STATE_INT: Record<string, string> = { demo: 'DEMO (datos simulados)', conectada: 'conectada', error: 'con error', 'sin-configurar': 'sin configurar' };
const howMuchDoes = (ts: number) => { const m = Math.round((Date.now() - ts) / 60000); return m < 60 ? t('windows.nMinAgo', { n: Math.max(1, m) }) : m < 2880 ? t('windows.nHAgo', { n: Math.round(m / 60) }) : t('windows.nDaysAgo', { n: Math.round(m / 1440) }); };
function RoomCard({ sala, habitantes }: { sala: any; habitantes: DwellerSummary[] }) {
  const repo = vivo.usar(e => e.repos[sala.id]);
  const notices = vivo.usar(e => e.notificaciones);
  const eventos = vivo.usar(e => e.eventos);
  const ints = vivo.usar(e => e.integraciones);
  const musica = vivo.usar(e => e.musica);
  const sesiones = Object.values(vivo.usar(e => e.sesiones)).filter(x => x.salaId === sala.id && x.estado !== 'cerrada' && (x.contexto || x.tokens));
  const isRepo = sala.tipo === 'repo' || sala.tipo === 'coordinacion';
  const datos: [string, React.ReactNode][] = [];
  if (sala.ruta) datos.push(['Carpeta', <code>{sala.ruta.replace(/^\/Users\/[^/]+/, '~')}</code>]);
  // consumo de cada conversación abierta de la sala (contexto ocupado y tokens)
  for (const x of sesiones) datos.push([x.id, <><span className="tenue">{x.titulo || t('panels.conversation')}</span> <Usage s={x} largo /></>]);
  if (repo?.existe === false) datos.push(['Aviso', <span className="aviso-consola">{t('panels.folderNotFound')}</span>]);
  else if (repo) {
    if (repo.rama) datos.push(['Rama', repo.rama]);
    if (repo.isGit) datos.push(['Cambios', repo.cambios ? t('panels.nUncommitted', { n: repo.cambios }) : t('panels.clean')]);
    if (repo.lastCommit) datos.push(['Último commit', <><span className="una-linea" title={repo.lastCommit.mensaje}>{repo.lastCommit.mensaje}</span><span className="tenue">{howMuchDoes(repo.lastCommit.fecha)}</span></>]);
    const capsules = repo.worktrees.filter(w => !w.principal);
    if (capsules.length) datos.push(['Copias', capsules.map(w => w.rama || t('windows.noBranch')).join(', ')]);
    if (repo.subrepos?.length) datos.push(['Repos dentro', repo.subrepos.join(', ')]);
  }
  if (sala.tipo === 'comunicaciones') { const n = notices.filter((x: any) => !x.vista).length; datos.push(['Avisos', n ? t('panels.nUnseen', { n }) : t('panels.allRead')]); }
  if (sala.tipo === 'planificacion') { const ev = eventos.filter((x: any) => x.fin > Date.now()).sort((a: any, b: any) => a.inicio - b.inicio)[0]; datos.push(['Próxima', ev ? <>{ev.titulo} <span className="tenue">· {new Date(ev.inicio).toLocaleString((idioma() === 'en' ? 'en-GB' : 'es-ES'), { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span></> : t('panels.nothingOnTheAgenda')]); }
  if (sala.tipo === 'logistica') datos.push(['Jira', t(STATE_INT[ints.jira?.estado ?? 'demo'])], ...(ints.linear ? [['Linear', t(STATE_INT[ints.linear.estado ?? 'demo'])] as [string, string]] : []));
  if (sala.tipo === 'discoteca') datos.push(['Sonando', musica?.pista && musica.estado !== 'parada' ? <>{musica.pista.titulo} <span className="tenue">· {musica.pista.artista}{musica.estado === 'pausa' ? t('panels.paused') : ''}</span></> : t('panels.nothing')]);
  if (sala.tipo === 'camara') { const ids = ACTIVE_SOURCES; datos.push(['Integraciones', t('panels.nOfTotalConnected', { n: ids.filter(f => ints[f]?.estado === 'conectada').length, total: ids.length })]); }
  if (ROOM_KEY[sala.tipo]) datos.push(['Atajo', <><kbd>{ROOM_KEY[sala.tipo]}</kbd> {t('panels.fromAnywhere')}</>]);
  const desc = ROOM_DESCRIPTION[sala.tipo] ?? (isRepo ? t('panels.repository') + (repo?.tipo ? ' · ' + repo.tipo : '') : '');
  return <>
    <div className="titulo-ficha">{sala.nombre} <span className="tenue">· {floorCaption(sala.planta)}</span></div>
    {(() => { const sec = sectorOf(sala.tipo, sala.id, sala.area); return <div className="ficha-sector" style={{ ['--sector' as any]: roomTone(sala)[0], ['--tinta' as any]: sec.tinta, ['--letra' as any]: sec.letra }}><b>{sec.codigo}</b>{t('panels.nombreSector', { nombre: tIs(sec.nombre).toLowerCase() })}</div>; })()}
    {desc && <div className="ficha-desc">{tIs(desc)}</div>}
    <p className="ficha-info">{t(INFO_ROOM[sala.tipo] ?? (isRepo ? INFO_REPO : ''))}</p>
    {datos.length > 0 && <dl className="ficha-datos">{datos.map(([k, v]) => <React.Fragment key={k}><dt>{sesiones.some(x => x.id === k) ? t('panels.context') : tIs(k)}</dt><dd>{v}</dd></React.Fragment>)}</dl>}
    <div className="ficha-seccion">{t('panels.dwellers')}</div>
    <ul className="plano-hab">{habitantes.map(h => <li key={h.id} className={h.estado}><b>{h.nombre}</b> <span className="tenue">{tIs(h.estado)}</span> {h.detalle && <span className="det">{h.detalle}</span>}</li>)}{!habitantes.length && <li className="tenue">{t('panels.nobodyLivesHere')}</li>}</ul>
  </>;
}

// ---------------------------------------------------------------- qué pasa ahora: ocupados, notificaciones, próximo evento
const STATE_TEXT: Record<string, string> = { esperando: 'te espera', error: 'avería', terminado: 'terminó, sin leer', trabajando: 'trabajando', pensando: 'pensando' };
function Busy() {
  // las copias holográficas (worktrees) cuentan como uno más: tienen su propio intercomunicador
  const hs = ocupados(juego.usar(e => [...e.habitantes, ...e.copias]));
  const notices = vivo.usar(e => e.notificaciones).filter((n: any) => !n.vista);
  const eventos = vivo.usar(e => e.eventos).filter((ev: any) => ev.fin > Date.now()).slice(0, 3);
  const items: (ItemMenu & { f: () => void })[] = [
    ...hs.map(h => ({ texto: <><span className={'glifo-estado ' + h.estado} /> <b>{h.nombre}</b> <span className="tenue">· {h.nameRoom}</span></>, pista: <>{tIs(STATE_TEXT[h.estado])}{h.detalle ? ' — ' + h.detalle : ''}</>, clase: h.estado, f: () => { closePanel(); goA(h.sala, h.id, h.estado !== 'trabajando' && h.estado !== 'pensando'); } })),
    { texto: <>{t('world.communications')} <span className="tenue">· {t('panels.nUnseen', { n: notices.length })}</span></>, pista: notices[0] ? `${notices[0].autor}: ${notices[0].titulo}` : t('panels.nothingNew'), f: () => { closePanel(); goA('comunicaciones'); } },
    { texto: <>{t('world.calendar')} <span className="tenue">· {eventos.length ? t('panels.nextEvent') : t('panels.noEvents')}</span></>, pista: eventos[0] ? `${new Date(eventos[0].inicio).toLocaleTimeString((idioma() === 'en' ? 'en-GB' : 'es-ES'), { hour: '2-digit', minute: '2-digit' })} ${eventos[0].titulo}` : '', f: () => { closePanel(); goA('planificacion'); } },
  ];
  const [i, setI] = useMenu(items.length, k => items[k].f(), e => (e.code === 'Tab' ? (closePanel(), true) : undefined));
  return (
    <Device rotulo={t('panels.whatSHappeningNow')} ancho={46} piloto={hs.some(h => h.estado === 'esperando') ? 'esperando' : hs.length ? 'trabajando' : 'ociosa'}>
      {!hs.length && <p className="tenue">{t('panels.nobodyIsWorkingRightNow')}</p>}
      <Opciones items={items} i={i} setI={setI} onChoose={k => items[k].f()} />
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
  ['N / C / L', 'ir a comunicaciones, planificación o logística'], ['G', 'cliente de git (en una sala de repo, con su repo)'], ['P', 'Chapa y Pintura: cambiar el aspecto (tuyo o de un habitante)'],
  ['⌘K', 'buscador, desde cualquier sitio: conversaciones abiertas y recientes, acciones (con su tecla), habitantes y salas; escribe y Enter'],
  ['Esc', 'cierra lo abierto; en el refugio, el menú del juego: opciones, atajos, reiniciar, salir a la superficie y salir'],
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
  ['conversaciones', 'se cierran aquí y siguen fuera con claude --resume, en su carpeta y con sus permisos; si estaban trabajando, se interrumpen y fuera se les pide que sigan'],
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
  useKeys(e => { if (e.code === 'Escape' || e.code === 'F1' || e.code === 'Enter') volver(); });
  return (
    <Device rotulo={t('panels.overseerSManual')} ancho={64} alto onClose={volver}>
      <div className="lista-desplazable ayuda-columnas">
        <section><h3>{t('panels.inTheShelter')}</h3><dl className="tabla-teclas">{CONTROLS.map(([k, v]) => <React.Fragment key={k}><dt>{tIs(k)}</dt><dd>{tIs(v)}</dd></React.Fragment>)}</dl>
          <h3>{t('panels.toTheSurfaceOutsideThe')}</h3><dl className="tabla-teclas">{SURFACE_CONTROLS.map(([k, v]) => <React.Fragment key={k}><dt>{tIs(k)}</dt><dd>{tIs(v)}</dd></React.Fragment>)}</dl></section>
        <section><h3>{t('panels.talkingToADweller')}</h3><dl className="tabla-teclas">{DIALOG_CONTROLS.map(([k, v]) => <React.Fragment key={k}><dt>{tIs(k)}</dt><dd>{tIs(v)}</dd></React.Fragment>)}</dl>
          <h3>{t('panels.intercomsAndTerminals')}</h3><dl className="tabla-teclas">{WINDOW_CONTROLS.map(([k, v]) => <React.Fragment key={k}><dt>{tIs(k)}</dt><dd>{tIs(v)}</dd></React.Fragment>)}</dl>
          <h3>{t('world.gitClient')}</h3><dl className="tabla-teclas">{CONTROLS_GIT.map(([k, v]) => <React.Fragment key={k}><dt>{tIs(k)}</dt><dd>{tIs(v)}</dd></React.Fragment>)}</dl>
          <h3>{t('panels.signals')}</h3>
          <dl className="tabla-teclas">
            <dt><span className="glifo-estado esperando" /> {t('panels.amber')}</dt><dd>{t('panels.waitingForYouPermissionQuestion')}</dd>
            <dt><span className="glifo-estado terminado" /> {t('panels.green')}</dt><dd>{t('panels.finishedAndYouHavenT')}</dd>
            <dt><span className="glifo-estado error" /> {t('panels.red')}</dt><dd>{t('panels.breakdownTheSessionFailed')}</dd>
            <dt><span className="glifo-estado trabajando" /> {t('panels.phosphor')}</dt><dd>{t('panels.workingTheScreensTheSteam')}</dd>
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
type Row = { etq: string; valores: string[]; actual: number; poner: (k: number) => void };
function GameOptions() {
  const [, refrescar] = useState(0);
  const au = sonido.ajustes;
  const pct = ['0 %', '10 %', '20 %', '30 %', '40 %', '50 %', '60 %', '70 %', '80 %', '90 %', '100 %'];
  const vol = (k: string) => ({ etq: t(({ maestro: 'menu.masterVolume', ambiente: 'menu.ambience', musica: 'menu.roomMusic', sfx: 'menu.effects', ui: 'menu.interface', voces: 'menu.dwellerChatter', teclado: 'menu.typingYourKeyboard' } as any)[k]), valores: pct, actual: Math.round((au as any)[k] * 10), poner: (n: number) => { sonido.guardar({ [k]: n / 10 }); refrescar(x => x + 1); SFX.tick(); } });
  const filas: Row[] = [
    // cambiar de idioma recarga la vista: los carteles de las salas se pintan al montarlas
    { etq: t('menu.language') + (idioma() === 'es' ? ' · Language' : ''), valores: LANGUAGES.map(x => x.texto), actual: Math.max(0, LANGUAGES.findIndex(x => x.valor === idioma())), poner: k => { const v = LANGUAGES[k].valor; if (v === idioma()) return; setLanguage(v); cliente.accion('idioma', { idioma: v }).catch(() => {}).finally(reloadView); } },
    vol('maestro'), vol('ambiente'), vol('musica'), vol('sfx'), vol('ui'), vol('voces'), vol('teclado'),
    { etq: t('menu.mute'), valores: [t('menu.no'), t('menu.yes')], actual: au.silence ? 1 : 0, poner: k => { sonido.guardar({ silence: k === 1 }); refrescar(x => x + 1); } },
    // fotogramas por segundo del refugio: en automático, menos cuando nada se mueve (gasta bastante menos CPU)
    { etq: t('menu.frameRate'), valores: [t('menu.frameRateAuto'), '60 fps', '30 fps'], actual: FRAME_RATES.indexOf(frameRate()), poner: k => { setFrameRate(FRAME_RATES[k]); refrescar(x => x + 1); SFX.tick(); } },
    { etq: t('menu.dictationLanguage'), valores: DICTATION_LANGUAGES.map(x => x.texto), actual: Math.max(0, DICTATION_LANGUAGES.findIndex(x => x.valor === dictationLanguage())), poner: k => { setLanguageDictation(DICTATION_LANGUAGES[k].valor); refrescar(x => x + 1); SFX.tick(); } },
  ];
  const [i, setI] = useMenu(filas.length, k => { const f = filas[k]; f.poner((f.actual + 1) % f.valores.length); }, e => {
    const f = filas[i]; if (!f) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { f.poner(Math.max(0, f.actual - 1)); return true; }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { f.poner(Math.min(f.valores.length - 1, f.actual + 1)); return true; }
  }, volver);
  return (
    <Device rotulo={t('menu.optionsSavedInThisBrowser')} ancho={44} onClose={volver}>
      <ul className="opciones-consola filas-ajuste">
        {filas.map((f, k) => (
          <li key={f.etq} className={k === i ? 'activa' : ''} onMouseEnter={() => setI(k)}>
            <span className="cursor">{k === i ? '▶' : ' '}</span><span className="txt">{f.etq}</span>
            <span className="selector"><button onClick={() => f.poner(Math.max(0, f.actual - 1))}>◀</button><b>{f.valores[f.actual]}</b><button onClick={() => f.poner(Math.min(f.valores.length - 1, f.actual + 1))}>▶</button></span>
          </li>
        ))}
      </ul>
      <p className="tenue">{t('menu.credentialsTheReposRootThe')}</p>
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>←→</kbd>{t('menu.change')} <kbd>Esc</kbd>{t(fromMenu() ? 'menu.back' : 'menu.close')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- menú del juego (Esc)
// Solo lo que es del juego en sí; lo demás (conversaciones, aparatos, webs, salas) está en el buscador (⌘K)
const MAC_K = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+';
function MenuGame() {
  const vivas = Object.values(vivo.usar(e => e.sesiones)).filter(s => s.estado !== 'cerrada').length;
  const terms = openTerminals.usar(e => e.lista.length);
  const algo = vivas + terms > 0;
  const sub = (p: Panel) => () => { SFX.clic(); openPanel(p, { desde: 'menu' }); };
  const items: (ItemMenu & { f: () => void })[] = [
    { texto: t('menu.backToTheShelter'), pista: 'Esc', f: closePanel },
    { texto: t('menu.searchConversationsActionsAndRooms'), pista: `${MAC_K}K`, f: () => { closePanel(); openSearch(); } },
    { texto: t('menu.options'), pista: t('menu.soundAndLanguage'), f: sub('opciones') },
    { texto: t('menu.keyboardShortcuts'), pista: 'F1', f: sub('ayuda') },
    { texto: t('menu.reloadTheView'), pista: t('menu.ifTheShelterGoesBlack'), f: () => { SFX.clic(); reloadView(); } },
    { texto: t('menu.restartTheGame'), pista: t('menu.appliesServerChangesTerminalsKeep'), f: sub('reiniciar') },
    { texto: t('menu.goToTheSurface'), pista: t(algo ? 'menu.everythingOpenToYourDesktop' : 'menu.nothingOpenToTakeOut'), apagado: !algo, f: () => { if (!algo) { SFX.noAllowed(); return; } closePanel(); takeASurface({ todo: true }); } },
    { texto: t('menu.everythingToYourPhone'), pista: t(vivas ? 'menu.openConversationsWithRemoteControl' : 'menu.noOpenConversations'), apagado: !vivas, f: () => { if (!vivas) { SFX.noAllowed(); return; } closePanel(); takeASurface({ todo: true, remoto: true, windowNew: true }); } },
    { texto: t('menu.leaveTheShelter'), peligro: true, f: sub('salir') },
  ];
  const [i, setI] = useMenu(items.length, k => items[k].f());
  return (
    <Device rotulo={t('menu.overseerMenu')} ancho={46}>
      <Opciones items={items} i={i} setI={setI} onChoose={k => items[k].f()} />
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('menu.accept')} <kbd>Esc</kbd>{t('menu.backToTheShelter2')} <kbd>{MAC_K}K</kbd>{t('menu.searchEverythingElse')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- salir
function Salir() {
  const vivas = Object.values(vivo.usar(e => e.sesiones)).filter(s => s.estado !== 'cerrada').length;
  const items: ItemMenu[] = [{ texto: t('menu.stay') }, { texto: vivas ? (vivas === 1 ? t('menu.leaveAndStopTheLive') : t('menu.leaveAndStopTheN', { n: vivas })) : t('menu.leaveTheShelter'), peligro: true }];
  const elegir = (k: number) => { if (k === 0) volver(); else { SFX.apagado(); cliente.enviar({ t: 'salir' }); openPanel('despedida'); } };
  const [i, setI] = useMenu(2, elegir, undefined, volver);
  return (
    <Device rotulo={t('menu.mainHatch')} ancho={34} piloto={vivas ? 'esperando' : 'ociosa'} onClose={volver}>
      <p className="voz">{t('menu.closeTheShelterOverseer')}</p>
      {vivas > 0 && <p className="aviso-consola">{t(vivas === 1 ? 'menu.thereIs1LiveSession' : 'menu.thereAreNLiveSessions', { n: vivas })}</p>}
      <Opciones items={items} i={i} setI={setI} onChoose={elegir} />
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('menu.confirm')} <kbd>Esc</kbd>{t('menu.stay2')}</Keys>
    </Device>
  );
}
// reinicio desde la regleta: servidor y ventana, sin cerrar las terminales (para aplicar cambios hechos al juego)
function Reiniciar() {
  const vivas = Object.values(vivo.usar(e => e.sesiones)).filter(s => ['arrancando', 'trabajando', 'esperando'].includes(s.estado)).length;
  const [estado, setState] = useState<{ enCurso?: boolean; error?: string }>({});
  const items: ItemMenu[] = [{ texto: t('panels.continue') }, { texto: estado.enCurso ? t('panels.restarting') : vivas ? (vivas === 1 ? t('panels.restartAndCutTheRunning') : t('panels.restartAndCutTheN', { n: vivas })) : t('menu.restartTheGame'), peligro: vivas > 0 }];
  const elegir = (k: number) => {
    if (k === 0) { volver(); return; }
    if (estado.enCurso) return;
    setState({ enCurso: true }); SFX.apagado();
    cliente.accion('reiniciarJuego').catch((e: Error) => { setState({ error: e.message }); SFX.noAllowed(); });
  };
  const [i, setI] = useMenu(2, elegir, undefined, volver);
  return (
    <Device rotulo={t('panels.restart')} onClose={volver} ancho={40} piloto={estado.error ? 'error' : vivas ? 'esperando' : 'ociosa'}>
      <p className="voz">{t('panels.restartTheGameOverseer')}</p>
      <p>{t('panels.theServerRestartsWithAny')}</p>
      {vivas > 0 && <p className="aviso-consola">{vivas === 1 ? t('panels.1DwellerIsWorkingOr') : t('panels.nDwellersAreWorkingOr', { n: vivas })}</p>}
      {estado.enCurso && <p className="aviso-consola">{t('panels.checkingTheNewCodeAnd')}</p>}
      {estado.error && <p className="aviso-consola">{estado.error}</p>}
      <Opciones items={items} i={i} setI={setI} onChoose={elegir} />
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('menu.confirm')} <kbd>Esc</kbd>{t('panels.continue2')}</Keys>
    </Device>
  );
}
function Farewell() {
  useEffect(() => { teclado.bloqueado = true; document.title = t('panels.workShelterSealed'); }, []);
  return <div className="despedida interactivo"><div className="placa-despedida">{t('panels.theShelterIsSealed')}<small>{t('panels.seeYouSoonOverseerTo')} <code>./shelter</code></small></div></div>;
}
