// Aparatos propios de cada sala especial (puerta, panel de sala de repo; cámara acorazada, comunicaciones, planificación, logística
// y actividades en sus propios módulos; la música de la discoteca, en Discoteca.tsx).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { juego, type Panel } from './estadoJuego';
import { vivo, cliente } from '../red/cliente';
import { SFX } from '../audio/sonido';
import { t, tIs } from '@shared/idioma';
import { Device, Opciones, Keys, closePanel, useMenu, useKeys, type ItemMenu } from './aparato';
import { generateRecruit } from '@shared/reclutas';
import { PLANNING_ROOM } from '@shared/disposicion';
import { AREAS, SECTORS, sectorOf } from '@shared/sectores';
import { PanelCamera } from './Camara';
import { PanelCommunications, PanelPlanning, PanelLogistics, BoardJira } from './Operativas';
import { PanelActivity } from './Actividades';
import { DeploymentBoard } from './Despliegue';
import { OrganizeRooms } from './Organizar';
import { openSpotify } from './Discoteca';
import { PanelBodyshop, Retratillo } from './Probador';
import { lookOf, lookSummary } from '@shared/aspecto';
import { goA } from './Paneles';
import { idCopy } from './copias';
import { claimVisitors } from './Dialogo';
import { openGit } from './git/ventana';
import type { InfoRepo } from '@shared/protocolo';

// el resumen del aspecto (shared/aspecto.ts) sale en español: se traduce por partes
const trSummary = (s: string) => { const k = s.indexOf(': '); return tIs(s.slice(0, k)) + ': ' + s.slice(k + 2).split(', ').map(x => tIs(x)).join(', '); };

// Remote Control de la sala (server/controlRemoto.ts)
type StateRC = { estado: 'apagado' | 'encendido' | 'aceptar' | 'error'; detalle?: string; url?: string; nombre?: string };

export function PanelesSala({ panel }: { panel: Panel }) {
  switch (panel) {
    case 'puerta': return <Puerta />;
    case 'sala': return <RoomPanel />;
    case 'worktree': return <PanelWorktree />;
    case 'visitante': return <PanelVisitor />;
    case 'camara': return <PanelCamera />;
    case 'comunicaciones': return <PanelCommunications />;
    case 'planificacion': return <PanelPlanning />;
    case 'logistica': return <PanelLogistics />;
    case 'spotify': return <OpenSpotify />;
    case 'chapa': return <PanelBodyshop />;
    case 'organizar': return <OrganizeRooms />;
    default: return <PanelActivity panel={panel} />;
  }
}

// ---------------------------------------------------------------- Puerta Principal: reclutar y excavar
type Suggestion = { ruta: string; nombre: string; isGit: boolean; tipo: string; modified: number };
const TYPE: Record<string, string> = { web: 'web', landing: 'landing', marca: 'marca', video: 'vídeo', node: 'node', python: 'python', generico: 'carpeta' };
function hace(ms: number) { const d = (Date.now() - ms) / 86400_000; return d < 1 ? t('panels.today') : d < 2 ? t('panels.yesterday') : d < 30 ? t('windows.nDaysAgo', { n: Math.floor(d) }) : d < 60 ? t('panels.1MonthAgo') : d < 365 ? t('windows.nMonthsAgo', { n: Math.floor(d / 30) }) : t('panels.overAYearAgo'); }

function Puerta() {
  const raiz = vivo.usar(e => e.estado?.raizRepos ?? '~');
  const [sugs, setSuggestions] = useState<Suggestion[] | null>(null);
  const [paso, setStep] = useState<{ tipo: 'lista' } | { tipo: 'ruta'; crear: boolean } | { tipo: 'recluta'; ruta: string; nombre: string; crear?: boolean; git?: boolean }>({ tipo: 'lista' });
  useEffect(() => { cliente.accion<Suggestion[]>('sugerencias').then(setSuggestions).catch(() => setSuggestions([])); }, []);
  if (paso.tipo === 'recluta') return <CardNewRecruit {...paso} volver={() => setStep({ tipo: 'lista' })} />;
  if (paso.tipo === 'ruta') return <AskPath crear={paso.crear} raiz={raiz} volver={() => setStep({ tipo: 'lista' })} seguir={(ruta, git) => setStep({ tipo: 'recluta', ruta, nombre: ruta.split('/').filter(Boolean).pop() ?? ruta, crear: paso.crear, git })} />;
  const items: (ItemMenu & { f: () => void })[] = [
    ...(sugs ?? []).slice(0, 40).map(s => ({ texto: <><b>{s.nombre}</b> <span className="tenue">{s.isGit ? t('panels.repo') : t('panels.folder')} · {tIs(TYPE[s.tipo] ?? s.tipo)}</span></>, pista: hace(s.modified), f: () => setStep({ tipo: 'recluta', ruta: s.ruta, nombre: s.nombre }) })),
    { texto: t('panels.anotherFolderTypeThePath'), pista: t('panels.anyPathOnThisMac'), f: () => setStep({ tipo: 'ruta', crear: false }) },
    { texto: t('panels.createANewFolderOr'), pista: t('panels.insideRaiz', { raiz }), f: () => setStep({ tipo: 'ruta', crear: true }) },
  ];
  const [i, setI] = useMenu(items.length, k => items[k].f());
  return (
    <Device rotulo={t('panels.mainDoorRecruitment')} ancho={52}>
      <p className="voz">{t('panels.everyFolderYouAdmitIs')}</p>
      <p className="tenue">{t('panels.suggestionsFrom')} <code>{raiz}</code> {t('panels.mostRecentFirstTheRoot')}</p>
      <div className="lista-desplazable">
        {sugs === null ? <p className="tenue">{t('panels.readingRaiz', { raiz })}</p> : <Opciones items={items} i={i} setI={setI} onChoose={k => items[k].f()} />}
      </div>
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.admit')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

function AskPath({ crear, raiz, volver, seguir }: { crear: boolean; raiz: string; volver: () => void; seguir: (ruta: string, git: boolean) => void }) {
  const [texto, setText] = useState(crear ? '' : raiz.replace(/\/?$/, '/'));
  const [git, setGit] = useState(true);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useKeys(e => { if (e.code === 'Escape') volver(); });
  const ruta = crear ? raiz.replace(/\/?$/, '/') + texto.trim() : texto.trim();
  const valid = crear ? /^[\w.\-áéíóúñ ]+$/i.test(texto.trim()) : texto.trim().length > 1;
  return (
    <Device rotulo={crear ? t('panels.doorNewFolder') : t('panels.doorAnotherFolder')} ancho={52} onClose={volver}>
      <p>{crear ? t('panels.nameOfTheNewFolder') : t('panels.folderPath')}</p>
      <div className="linea-entrada activa">
        <span className="prompt-sim">{crear ? raiz.replace(/\/?$/, '/') : '›'}</span>
        <input ref={ref} className="campo" value={texto} onChange={e => setText(e.target.value)} spellCheck={false}
          onKeyDown={e => { if (e.key === 'Enter' && valid) { e.preventDefault(); SFX.clic(); seguir(ruta, git); } else if (e.key === 'Escape') { e.preventDefault(); volver(); } else if (e.key === 'Tab' && crear) { e.preventDefault(); setGit(g => !g); } }} />
      </div>
      {crear && <div className="fila-chips activa"><span className="etq">git init</span><button className={'chip' + (git ? ' on' : '')} onClick={() => setGit(true)}>{t('menu.yes')}</button><button className={'chip' + (!git ? ' on' : '')} onClick={() => setGit(false)}>{t('menu.no')}</button></div>}
      <Keys><kbd>Enter</kbd>{t('panels.continue2')} {crear && <><kbd>Tab</kbd>{t('panels.gitYesNo')} </>}<kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}

function CardNewRecruit({ ruta, nombre, crear, git, volver }: { ruta: string; nombre: string; crear?: boolean; git?: boolean; volver: () => void }) {
  const usados = juego.usar(e => e.habitantes.map(h => h.nombre.toLowerCase()));
  const [semilla, setSeed] = useState(() => (Date.now() % 1e9) | 0);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const tipos = juego.usar(e => e.habitantes.map(h => h.tipo));
  const r = useMemo(() => generateRecruit(semilla, usados, false, tipos), [semilla]);
  const admitir = async () => {
    if (sending) return; setSending(true); setError('');
    try { await cliente.accion('reclutar', { ruta, crear, git, habitante: { ...r, salaId: '' } }); SFX.shortSuccess(); closePanel(); }
    catch (err) { SFX.error(); setError((err as Error).message); setSending(false); }
  };
  const items: ItemMenu[] = [{ texto: <>{t('panels.digOutTheRoom')} <b>{nombre}</b> {t('panels.andWelcomeThem')}</> }, { texto: t('panels.sendInAnotherRecruit'), pista: 'R' }, { texto: t('windows.back') }];
  const elegir = (k: number) => { if (k === 0) admitir(); else if (k === 1) { setSeed(x => x * 7 + 13); SFX.tick(); } else volver(); };
  const [i, setI] = useMenu(items.length, elegir, e => { if (e.code === 'KeyR') { setSeed(x => x * 7 + 13); SFX.tick(); return true; } }, volver);
  return (
    <Device rotulo={t('panels.doorRecruitSheet')} ancho={50} onClose={volver}>
      <div className="ficha con-retrato">
        <Retratillo aspecto={lookOf(r)} />
        <div className="titulo-ficha">{r.nombre} <span className="mote">«{r.mote}»</span></div>
        <dl>
          <dt>{t('panels.room')}</dt><dd>{nombre} <span className="tenue">({ruta}{crear ? t('panels.itWillBeCreated') + (git ? t('panels.withGit') : '') : ''})</span></dd>
          <dt>{t('panels.look')}</dt><dd>{trSummary(lookSummary(lookOf(r)))} <span className="tenue">{t('panels.inChromePaintYouCan')}</span></dd>
          <dt>{t('panels.backstory')}</dt><dd>{r.bio}</dd>
          <dt>{t('panels.work')}</dt><dd>{t('panels.realClaudeCodeSessionsIn')}</dd>
        </dl>
      </div>
      {error && <p className="aviso-consola">{error}</p>}
      <Opciones items={items} i={i} setI={setI} onChoose={elegir} />
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('menu.confirm')} <kbd>R</kbd>{t('panels.anotherRecruit')} <kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}
// la sala pasa a otra carpeta: las sugerencias de la raíz de repos (como en la Puerta) u otra ruta escrita a mano, y
// luego la confirmación (cada paso, su componente: cada uno con su menú y sus teclas)
function LinkRoom({ sala, ejemplo, volver }: { sala: any; ejemplo: boolean; volver: () => void }) {
  const raiz = vivo.usar(e => e.estado?.raizRepos ?? '~');
  const [paso, setStep] = useState<{ tipo: 'lista' } | { tipo: 'ruta' } | { tipo: 'confirmar'; ruta: string; nombre: string }>({ tipo: 'lista' });
  const elegir = (ruta: string, nombre = ruta.split('/').filter(Boolean).pop() ?? ruta) => setStep({ tipo: 'confirmar', ruta, nombre });
  if (paso.tipo === 'ruta') return <AskPath crear={false} raiz={raiz} volver={() => setStep({ tipo: 'lista' })} seguir={ruta => elegir(ruta)} />;
  if (paso.tipo === 'confirmar') return <ConfirmLink sala={sala} ejemplo={ejemplo} ruta={paso.ruta} nombre={paso.nombre} volver={() => setStep({ tipo: 'lista' })} />;
  return <LinkList sala={sala} raiz={raiz} elegir={elegir} otra={() => setStep({ tipo: 'ruta' })} volver={volver} />;
}
function LinkList({ sala, raiz, elegir, otra, volver }: { sala: any; raiz: string; elegir: (ruta: string, nombre: string) => void; otra: () => void; volver: () => void }) {
  const [sugs, setSuggestions] = useState<Suggestion[] | null>(null);
  useEffect(() => { cliente.accion<Suggestion[]>('sugerencias').then(setSuggestions).catch(() => setSuggestions([])); }, []);
  const items: (ItemMenu & { f: () => void })[] = [
    ...(sugs ?? []).slice(0, 40).map(s => ({ texto: <><b>{s.nombre}</b> <span className="tenue">{s.isGit ? t('panels.repo') : t('panels.folder')} · {tIs(TYPE[s.tipo] ?? s.tipo)}</span></>, pista: hace(s.modified), f: () => elegir(s.ruta, s.nombre) })),
    { texto: t('panels.anotherFolderTypeThePath'), pista: t('panels.anyPathOnThisMac'), f: otra },
  ];
  const [i, setI] = useMenu(items.length, k => items[k].f(), undefined, volver);
  return (
    <Device rotulo={t('panels.roomPanelSalaLink', { sala: sala.nombre })} ancho={52} onClose={volver}>
      <p className="tenue">{t('panels.pickTheRoomSNew')} <code>{raiz}</code> {t('panels.mostRecentFirstThoseThat')}</p>
      <div className="lista-desplazable">
        {sugs === null ? <p className="tenue">{t('panels.readingRaiz', { raiz })}</p> : <Opciones items={items} i={i} setI={setI} onChoose={k => items[k].f()} />}
      </div>
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.continue2')} <kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}
function ConfirmLink({ sala, ejemplo, ruta, nombre, volver }: { sala: any; ejemplo: boolean; ruta: string; nombre: string; volver: () => void }) {
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const vincular = async () => {
    if (sending) return; setSending(true); setError('');
    try { await cliente.accion('vincularSala', { salaId: sala.id, ruta }); SFX.shortSuccess(); closePanel(); }
    catch (e) { SFX.error(); setError((e as Error).message); setSending(false); }
  };
  const items: ItemMenu[] = [{ texto: <>{t('panels.link')} <b>{sala.nombre}</b> {t('panels.to')} <b>{nombre}</b></> }, { texto: t('windows.back') }];
  const [i, setI] = useMenu(items.length, k => (k === 0 ? vincular() : volver()), undefined, volver);
  return (
    <Device rotulo={t('panels.roomPanelSalaLink', { sala: sala.nombre })} ancho={52} onClose={volver}>
      <p className="voz">{t('panels.theRoomMovesTo')} <code>{ruta}</code> {t('panels.andWillBeCalled')} <b>{nombre}</b>.</p>
      <p className="tenue">{t('panels.theirDwellerStaysWithTheir')}{sala.decorado ? t('panels.theSetDressingIsRemoved') : ''}. {ejemplo ? t('panels.theCopyOfTheExample') : t('panels.thePreviousFolderIsLeft')}</p>
      {error && <p className="aviso-consola">{error}</p>}
      <Opciones items={items} i={i} setI={setI} onChoose={k => (k === 0 ? vincular() : volver())} />
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('menu.confirm')} <kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}

export const LOOK: Record<string, string> = { Engineer: 'ingeniera de campo', Survivalist: 'superviviente', Hoarder: 'chatarrero', Hiker: 'excursionista', Protagonist_A: 'aventurera', Protagonist_B: 'aventurero', Driver: 'conductor', SpaceRanger: 'guardabosques espacial', Robot_One: 'robot de servicio', Robot_Two: 'robot de servicio', Clanker: 'robot de carga', CombatMech: 'mecha de guardia', '4GTN': 'androide samurái' };

// ---------------------------------------------------------------- panel de una sala de repositorio
/** «Adaptar la sala al repo»: su habitante lee el repo y le diseña una escena con el atrezo del juego (decoradoSala.ts
 *  en el servidor); la conversación queda abierta para seguir retocándola */
export async function adaptRoom(salaId: string) {
  const h = juego.get().habitantes.find(x => x.sala === salaId && !x.copia);
  if (!h) { SFX.noAllowed(); return; }
  const prompt = await cliente.accion<string>('sala.promptAdaptar');
  cliente.enviar({ t: 'empezar', dwellerId: h.id, salaId, prompt, opciones: {} });
  closePanel(); goA(salaId, h.id, true);
}

// (vincular a otra carpeta es otra vista con su propio menú: un componente aparte, para no cambiar los hooks del panel)
function RoomPanel() {
  const salaId = juego.usar(e => e.panelData?.salaId);
  const sala = vivo.usar(e => e.estado?.salas?.find((s: any) => s.id === salaId));
  const ejemplo = vivo.usar(e => !!e.repos[salaId]?.ejemplo);
  const [vincular, setLink] = useState(false);
  const [reparto, setAssignment] = useState(() => juego.get().panelData?.vista === 'reparto');   // desde el buscador: directo al tablero
  const [despliegue, setDeployment] = useState(() => juego.get().panelData?.vista === 'despliegue');
  const [organizar, setOrganize] = useState(() => juego.get().panelData?.vista === 'organizar');
  // abierto directamente en un tablero (la pantalla de la pared, ⌘K): al cerrarlo se vuelve al refugio, no al menú de la sala
  const [directo] = useState(() => !!juego.get().panelData?.vista);
  const salir = (f: (v: boolean) => void) => () => (directo ? closePanel() : f(false));
  if (!sala) return null;
  if (vincular) return <LinkRoom sala={sala} ejemplo={ejemplo} volver={() => setLink(false)} />;
  // la sala de coordinación (la carpeta con todos los repos) revisa las tareas y planifica su reparto por salas
  if (reparto) return <BoardJira coordinacion={salaId} volver={salir(setAssignment)} />;
  // y el despliegue: tus PR por estado, sus bloqueos y el orden en que pueden ir
  if (despliegue) return <DeploymentBoard salaId={salaId} volver={salir(setDeployment)} />;
  // un worktree y una conversación por cada tarea con PR abiertos en el repo de la sala
  if (organizar) return <OrganizeRooms salaId={salaId} volver={salir(setOrganize)} />;
  return <RoomMenu salaId={salaId} sala={sala} onLink={() => setLink(true)} onDistribute={() => setAssignment(true)} onDeploy={() => setDeployment(true)} onOrganize={() => setOrganize(true)} />;
}
function RoomMenu({ salaId, sala, onLink, onDistribute, onDeploy, onOrganize }: { salaId: string; sala: any; onLink: () => void; onDistribute: () => void; onDeploy: () => void; onOrganize: () => void }) {
  const repo = vivo.usar(e => e.repos[salaId]);
  const dwellers = juego.usar(e => e.habitantes.filter(h => h.sala === salaId && !h.copia));
  const [aviso, setNotice] = useState('');
  const [confirmar, setConfirm] = useState(false);
  const ofRepo = sala.tipo === 'repo' || sala.tipo === 'coordinacion';
  // la sala de planificación de serie va con la raíz de repos: ni se vincula a otra carpeta ni se retira
  const movable = ofRepo && sala.id !== PLANNING_ROOM;
  const [rc, setRc] = useState<StateRC | null>(null);
  useEffect(() => { if (ofRepo) cliente.accion<StateRC>('sala.controlRemoto', { salaId }).then(setRc).catch(() => {}); }, [salaId, ofRepo]);
  const abrir =(app: string) => cliente.accion('abrirEn', { app, ruta: sala.ruta }).then(() => setNotice(t('panels.opened'))).catch(e => setNotice(e.message));
  const inDevelopment = location.port === '5173';
  const items: (ItemMenu & { f: () => void })[] = [
    ...(sala.tipo === 'puente' ? [{ texto: t('panels.applyTheGameSChanges'), pista: inDevelopment ? t('panels.inDevelopmentTheyApplyThemselves') : t('panels.recompilesAndReloadsWithoutCutting'), f: async () => {
      if (inDevelopment) { setNotice(t('panels.withTheDevelopmentServerVite')); return; }
      try { await cliente.accion('aplicarCliente'); setNotice(t('panels.recompilingTheShelterWillReload')); } catch (e) { setNotice((e as Error).message); }
    } }] : []),
    ...(sala.tipo === 'coordinacion' && dwellers[0] ? [{ texto: <>{t('panels.jiraTasksPlanWith')} <b>{dwellers[0].nombre}</b> {t('panels.andSplitThemAcrossRooms')}</>, pista: t('panels.eachRepoInItsWorktree'), f: onDistribute }] : []),
    ...(sala.tipo === 'coordinacion' ? [{ texto: t('panels.deploymentPlanYourPullRequests'), pista: t('panels.theOrderInWhichThey'), f: onDeploy }] : []),
    ...(sala.tipo === 'repo' && repo?.isGit && dwellers[0] ? [{ texto: <>{t('panels.organizeByTasksAWorktree')} <b>{dwellers[0].nombre}</b> {t('panels.perTask')}</>, pista: t('panels.withUnmergedPrs'), f: onOrganize }] : []),
    ...(repo?.isGit ? [{ texto: t('panels.openInTheGitClient'), pista: repo.cambios ? t('panels.nChangesG', { n: repo.cambios }) : 'G', f: () => { closePanel(); openGit({ ruta: repo.ruta, vista: 'cambios' }); } }] : []),
    { texto: t('panels.openTheRoomSTerminal'), pista: 'T', f: () => { closePanel(); window.dispatchEvent(new CustomEvent('refugio:terminal', { detail: { salaId } })); } },
    { texto: t('panels.openInFinder'), f: () => abrir('finder') },
    { texto: t('panels.openInTheEditor'), f: () => abrir('editor') },
    { texto: t('panels.openInTerminalApp'), f: () => abrir('terminal') },
    ...(repo?.worktrees ?? []).filter(w => !w.principal).map(w => ({ texto: <>{t('panels.holographicCopy')} <b>{w.rama || t('windows.noBranch')}</b> <span className="tenue">(worktree)</span></>, pista: w.ocupado ? t('panels.insideX', { x: w.ocupado }) : w.cambios ? t('windows.nChanges', { n: w.cambios }) : w.advanced ? t('windows.nCommits', { n: w.advanced }) : t('panels.clean2'), f: () => juego.set({ panel: 'worktree', panelData: { salaId, aparato: 'wt:' + w.ruta } }) })),
    ...(ofRepo && dwellers[0] && repo?.existe !== false ? [{ texto: <>{t('panels.adaptTheRoomToThe')} <b>{dwellers[0].nombre}</b> {t('panels.designASceneForIt')}</>, pista: sala.decorado ? t('panels.orTouchUpTheOne') : t('panels.readsTheRepoAndDecorates'), f: () => adaptRoom(salaId).catch(e => setNotice((e as Error).message)) }] : []),
    ...(ofRepo && sala.decorado ? [{ texto: t('panels.backToTheDefaultScene'), pista: t('panels.removesTheSetDressing'), f: async () => {
      try { await cliente.accion('sala.quitarDecorado', { salaId }); setNotice(t('panels.theRoomGoesBackTo')); } catch (e) { setNotice((e as Error).message); }
    } }] : []),
    ...(ofRepo && repo?.existe !== false ? [{ texto: rc?.estado === 'encendido' ? t('panels.turnOffRemoteControl') : t('panels.turnOnRemoteControl'), pista: rc?.estado === 'encendido' ? t('panels.stopsShowingOnClaudeAi') : t('panels.thisRepoSSessionsFrom'), f: async () => {
      const switchOn = rc?.estado !== 'encendido';
      if (switchOn) setNotice(t('panels.turningOnRemoteControl'));
      try { const r = await cliente.accion<StateRC>('sala.controlRemoto', { salaId, switchOn }); setRc(r); setNotice(r.detalle ?? (r.estado === 'encendido' ? t('panels.onOpenTheCodeTab', { nombre: r.nombre ?? '' }) : t('panels.off'))); }
      catch (e) { setNotice((e as Error).message); }
    } }] : []),
    ...(rc?.estado === 'encendido' && rc.url ? [{ texto: t('panels.openItsRemoteControlOn'), pista: t('panels.inTheBrowser'), f: () => { window.open(rc.url, '_blank'); } }] : []),
    // el área del repo decide su sector y su color (verde frontend, amarillo backend, rojo críticos): Enter pasa a la siguiente
    ...(movable ? [{ texto: <>{t('panels.repoArea')} <b style={{ color: sectorOf(sala.tipo, sala.id, sala.area).letra }}>{tIs(sectorOf(sala.tipo, sala.id, sala.area).nombre).toLowerCase()}</b></>, pista: 'Enter: ' + AREAS.map(a => tIs(SECTORS[a].nombre).toLowerCase()).join(' → '), f: async () => {
      const area = AREAS[(AREAS.indexOf(sectorOf(sala.tipo, sala.id, sala.area).id as any) + 1) % AREAS.length];
      try { await cliente.accion('sala.area', { salaId, area }); SFX.clic(); } catch (e) { setNotice((e as Error).message); }
    } }] : []),
    ...(movable ? [{ texto: t('panels.linkTheRoomToAnother'), pista: t('panels.oneOfYourReposThe'), f: onLink }] : []),
    ...(movable ? [{ texto: confirmar ? t('panels.surePressEnterAgainTo') : t('panels.removeTheRoomFromThe'), pista: repo?.ejemplo ? t('panels.theExampleRepoSCopy') : t('panels.theFolderIsLeftUntouched'), peligro: true, f: async () => {
      if (!confirmar) { setConfirm(true); return; }
      try { await cliente.accion('retirarSala', { salaId }); closePanel(); } catch (e) { setNotice((e as Error).message); setConfirm(false); }
    } }] : []),
  ];
  const [i, setI] = useMenu(items.length, k => items[k].f());
  return (
    <Device rotulo={t('panels.roomPanelSala', { sala: sala.nombre })} ancho={52}>
      <div className="ficha"><dl>
        <dt>{t('panels.folder')}</dt><dd>{sala.ruta}{repo && repo.existe === false && <span className="aviso-consola"> · {t('panels.notFoundTheRoomStays')}</span>}</dd>
        {repo?.isGit ? <>
          <dt>{t('windows.branch')}</dt><dd>{repo.rama}{repo.cambios ? <span className="aviso-consola"> · {t('windows.nUncommittedChanges', { n: repo.cambios })}</span> : <span className="tenue"> · {t('panels.clean2')}</span>}</dd>
          <dt>{t('panels.lastCommit')}</dt><dd>{repo.lastCommit?.mensaje ?? '—'} <span className="tenue">{repo.lastCommit ? hace(repo.lastCommit.fecha) : ''}</span></dd>
        </> : <><dt>git</dt><dd className="tenue">{repo?.subrepos?.length ? t('panels.wingWithNRepos', { n: repo.subrepos.length }) : t('panels.notARepo')}</dd></>}
        <dt>{t('panels.type')}</dt><dd>{t(TYPE[repo?.tipo ?? ''] ?? repo?.tipo ?? '—')}{repo?.ejemplo && <span className="tenue"> · {t('panels.exampleRepo')}</span>}</dd>
        <dt>{t('panels.dwellers2')}</dt><dd>{dwellers.map(h => h.nombre).join(', ') || '—'}</dd>
        {ofRepo && rc && <><dt>remote control</dt><dd>{rc.estado === 'encendido' ? <>{t('panels.on')} <span className="tenue">· {t('panels.nombreOnClaudeAiCode', { nombre: rc.nombre ?? '' })}</span></> : rc.estado === 'apagado' ? <span className="tenue">{t('panels.off2')}</span> : <span className="aviso-consola">{rc.detalle}</span>}</dd></>}
        {ofRepo && <><dt>{t('panels.scene')}</dt><dd>{sala.decorado ? <>{sala.decorado.resumen || t('panels.customSetDressing')} <span className="tenue">{t('panels.designedByItsDweller')}</span></> : <span className="tenue">{t('panels.theDefaultOneForIts')}</span>}</dd></>}
      </dl></div>
      {aviso && <p className="aviso-consola">{aviso}</p>}
      <Opciones items={items} i={i} setI={k => { setI(k); if (k !== items.length - 1) setConfirm(false); }} onChoose={k => items[k].f()} />
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.use')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- copia holográfica (worktree)
function PanelWorktree() {
  const d = juego.usar(e => e.panelData);
  const ruta: string = String(d?.aparato ?? '').replace(/^wt:/, '');
  const salaId: string = d?.salaId;
  const dwellers = juego.usar(e => e.habitantes.filter(h => h.sala === salaId));
  const sala = vivo.usar(e => e.estado?.salas?.find((s: any) => s.id === salaId));
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [confirmar, setConfirm] = useState(false);
  const cargar = () => cliente.accion<any>('worktree.inspeccionar', { ruta }).then(setInfo).catch(e => setError(e.message));
  useEffect(() => { cargar(); }, [ruta]);
  // el worktree es una copia de su autor: él trabaja dentro e integra; si no es de esta sala, quien esté libre
  const authorId = vivo.usar(e => e.repos?.[salaId]?.worktrees?.find((w: any) => w.ruta === ruta)?.autor);
  const dentro = vivo.usar(e => Object.values(e.sesiones).find((s: any) => s.estado !== 'cerrada' && (s.cwd === ruta || s.cwd?.startsWith(ruta + '/'))) as any);
  const libre = dwellers.find(h => h.id === authorId) ?? dwellers.find(h => h.estado === 'ocioso' || h.estado === 'durmiendo' || h.estado === 'terminado') ?? dwellers[0];
  const insideWho = dentro && dwellers.find(h => h.id === dentro.dwellerId);
  // la copia holográfica habla por su propio intercomunicador (también de lo que hace dentro)
  const copia = juego.usar(e => e.copias.find(c => c.id === idCopy(ruta)));
  const items: (ItemMenu & { f: () => void })[] = info ? [
    ...(copia ? [{ texto: <>{t('panels.talkToTheCopyOf')} <b>{copia.copia?.nameAuthor}</b></>, pista: dentro ? t('panels.theirConversationInThisWorktree') : t('panels.theirIntercom'), f: () => { closePanel(); goA(salaId, copia.id, true); } }]
      : insideWho ? [{ texto: <>{t('panels.talkTo')} <b>{insideWho.nombre}</b> {t('panels.aboutWhatTheyReDoing')}</>, pista: t('panels.theirConversationInThisWorktree'), f: () => { closePanel(); goA(salaId, insideWho.id, true); } }] : []),
    { texto: t('windows.openATerminalInside'), f: async () => { const { openTerminalIn } = await import('./Terminales'); closePanel(); openTerminalIn('wt:' + ruta, salaId, `${sala?.nombre ?? ''} · ${info.rama}`, ruta); } },
    ...(copia || libre ? [{ texto: copia ? <>{t('panels.workInsideWithTheCopy')}</> : <>{t('panels.workInsideWith')} <b>{libre!.nombre}</b></>, pista: t('panels.newSessionInThisWorktree'), f: () => { juego.set({ workIn: { cwd: ruta, rama: info.rama } }); closePanel(); goA(salaId, copia?.id ?? libre!.id, true); } }] : []),
    ...(libre ? [{ texto: <>{t('panels.mergeHave')} <b>{libre.nombre}</b> {t('panels.mergeTheBranchAndClean')}</>, pista: t('panels.intoBaseWithTheirPermissions', { base: info.base }), f: async () => {
      const prompt = await cliente.accion<string>('worktree.promptIntegrar', { ruta });
      cliente.enviar({ t: 'empezar', dwellerId: libre.id, salaId, prompt, opciones: {} });
      closePanel(); goA(salaId, libre.id, true);
    } }] : []),
    { texto: info.ocupado ? t('panels.discardNoSomeoneIsWorking') : confirmar ? t('panels.againEnterOrClickDelete') : t('panels.discardTheCopyTurnsOff'), peligro: true, apagado: info.ocupado, f: async () => {
      if (info.ocupado) { SFX.noAllowed(); return; }
      if (!confirmar) { setConfirm(true); return; }
      try {
        await cliente.accion('worktree.desechar', { ruta, forzar: info.estado.length > 0 || info.commits.length > 0 }); SFX.apagado(); closePanel();
        // el holograma se apaga ya, sin esperar al próximo repaso de los repos
        cliente.accion<InfoRepo>('repo', { salaId }).then(r => vivo.set(e => ({ repos: { ...e.repos, [salaId]: r } }))).catch(() => {});
      } catch (e) { setError((e as Error).message); setConfirm(false); }
    } },
  ] : [];
  const [i, setI] = useMenu(items.length, k => items[k].f());
  return (
    <Device rotulo={dwellers.find(h => h.id === authorId) ? t('panels.holographicCopyOfNombreRama', { nombre: dwellers.find(h => h.id === authorId)!.nombre.toUpperCase(), rama: info?.rama ?? '…' }) : t('panels.holographicCopyRama', { rama: info?.rama ?? '…' })} ancho={60} piloto={info?.ocupado ? 'error' : info?.estado?.length ? 'esperando' : 'trabajando'}>
      {!info ? <p className="tenue">{error || t('panels.connectingToTheCopy')}</p> : <>
        <div className="ficha"><dl>
          <dt>{t('panels.path')}</dt><dd>{info.ruta}</dd>
          <dt>{t('windows.branch')}</dt><dd>{info.rama} <span className="tenue">{t('panels.onTopOfBase', { base: info.base })}</span></dd>
          <dt>{t('panels.inside')}</dt><dd>{info.ocupado ? <span className="aviso-consola">{t('panels.aSessionIsWorking')}</span> : t('panels.nobody')}</dd>
        </dl></div>
        <div className="dos-columnas">
          <div><h3>{t('panels.uncommittedChangesN', { n: info.estado.length })}</h3><pre className="lista-git">{info.estado.slice(0, 14).join('\n') || '—'}</pre></div>
          <div><h3>{t('panels.commitsToMergeN', { n: info.commits.length })}</h3><pre className="lista-git">{info.commits.slice(0, 14).join('\n') || '—'}</pre></div>
        </div>
        {error && <p className="aviso-consola">{error}</p>}
        {/* el aviso de la confirmación va debajo, para no mover la lista bajo el ratón entre el primer clic y el segundo */}
        <Opciones items={items} i={i} setI={setI} onChoose={k => items[k].f()} />
        {confirmar && <p className="aviso-consola">{t('panels.youWillLoseCambiosUncommitted', { cambios: info.estado.length, commits: info.commits.length, base: info.base })}{info.ignored.length ? t('panels.andNIgnoredFilesE', { n: info.ignored.length, ej: info.ignored.slice(0, 3).join(', ') }) : ''}.</p>}
      </>}
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.use')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

// ---------------------------------------------------------------- visitante: las sesiones de la sala abiertas fuera
// no es un aparato: lleva al intercomunicador del habitante de la sala, con la lista de esas sesiones
function PanelVisitor() {
  const d = juego.usar(e => e.panelData);
  useEffect(() => { juego.set({ panel: null, panelData: null }); if (d?.salaId) claimVisitors(d.salaId); }, []);
  return null;
}

// la cabina de la discoteca no es un aparato: abre Spotify, que suena dentro del juego
function OpenSpotify() {
  useEffect(() => { juego.set({ panel: null, panelData: null }); openSpotify(); }, []);
  return null;
}
