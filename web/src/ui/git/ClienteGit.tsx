// Cliente de git del refugio (sala de Control de Versiones), al estilo del control de código de los editores: a la
// izquierda, el repo, la rama y la caja del commit con lo preparado y lo cambiado (preparar y quitar con un clic,
// descartar con confirmación); a la derecha, el diff del archivo elegido (preparar o descartar por bloques o por
// líneas sueltas), el historial con su grafo, las ramas y el cajón (stash) y tu GitHub.
// Repos: los de las salas del refugio (y el del propio juego), sus worktrees y los de las alas de coordinación.
// El mensaje del commit lo escribes tú (⌘Intro hace el commit); la generación con IA queda para cuando el refugio
// tenga inferencia.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { vivo, cliente } from '../../red/cliente';
import { t } from '@shared/idioma';
import { SFX } from '../../audio/sonido';
import { firstMapNow } from '../../motor/foco';
import { windowShortcut, WindowButtons, CMD, MAC } from '../ventanas';
import { openTerminalIn } from '../Terminales';
import { openFiles } from '../archivos/ventana';
import { windowGit, choosePath, lastPath, minimizeGit, closeGit, onFrontGit, toggleMaximizeGit, type ViewGit, type WindowGit } from './ventana';
import { VisorDiff, type PatchThat } from './VisorDiff';
import { Historial } from './Historial';
import { GitHub } from './GitHub';
import { PullRequests } from './PullRequests';
import { hace, LETTER, type Letter } from './comun';

interface FileGit { ruta: string; origen?: string; letra: Letter }
interface StateGit {
  ruta: string; rama: string | null; cabeza: string | null; upstream: string | null; adelante: number; atras: number;
  preparados: FileGit[]; cambios: FileGit[]; conflictos: FileGit[];
  operacion: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null; recortado: boolean; lastMessage: string; remote: string[]; cajon: number;
}
type Grupo = 'preparados' | 'cambios' | 'conflictos';
interface Choice { grupo: Grupo; ruta: string }
interface Repo { ruta: string; nombre: string; salaId: string; detalle: string; cambios: number; worktree?: boolean }

const OPERATION: Record<string, string> = { merge: t('windows.mergeInProgress'), rebase: t('windows.rebaseInProgress'), 'cherry-pick': t('windows.cherryPickInProgress'), revert: t('windows.revertInProgress') };
const drafts = new Map<string, string>();

// ---------------------------------------------------------------- los repos del refugio
function useRepos(): Repo[] {
  const salas: any[] = vivo.usar(e => e.estado?.salas ?? []);
  const repos = vivo.usar(e => e.repos);
  return useMemo(() => {
    const out: Repo[] = [];
    for (const s of salas) {
      const r = repos[s.id]; if (!s.ruta || !r) continue;
      if (r.isGit) {
        out.push({ ruta: r.ruta, nombre: s.nombre, salaId: s.id, detalle: r.rama ?? '', cambios: r.cambios });
        for (const w of r.worktrees ?? []) if (!w.principal) out.push({ ruta: w.ruta, nombre: `${s.nombre} ◇ ${w.rama}`, salaId: s.id, detalle: 'worktree', cambios: w.cambios, worktree: true });
      }
      for (const sub of r.subrepos ?? []) out.push({ ruta: sub, nombre: `${s.nombre} / ${sub.split('/').pop()}`, salaId: s.id, detalle: '', cambios: 0 });
    }
    return out;
  }, [salas, repos]);
}

export function ClienteGit() {
  const v = windowGit.usar(e => e);
  const repos = useRepos();
  if (!v.abierta) return null;
  // el repo: el elegido; si no, el último que usaste; si no, el que más cambios tiene
  const ruta = [v.ruta, lastPath()].find(r => r && repos.some(x => x.ruta === r)) ?? [...repos].sort((a, b) => b.cambios - a.cambios)[0]?.ruta ?? null;
  return <Window v={v} repos={repos} ruta={ruta} />;
}

function Window({ v, repos, ruta }: { v: WindowGit; repos: Repo[]; ruta: string | null }) {
  const repo = repos.find(r => r.ruta === ruta);
  const [estado, setState] = useState<StateGit | null>(null);
  const [errorState, setErrorState] = useState('');
  const [ocupado, setBusy] = useState('');
  const [aviso, setNotice] = useState<{ texto: string; error: boolean; id: number } | null>(null);
  const [confirmar, setConfirm] = useState<{ texto: React.ReactNode; boton: string; si: () => void } | null>(null);
  const [sel, setSel] = useState<Choice | null>(null);
  const [paralelo, setParallel] = useState(() => localStorage.getItem('refugio.git.paralelo') === '1');
  const [plegados, setFolded] = useState<Record<Grupo, boolean>>({ preparados: false, cambios: false, conflictos: false });
  const caja = useRef<HTMLDivElement>(null);

  const avisar = useCallback((texto: string, error = false) => { setNotice({ texto, error, id: Date.now() }); if (error) SFX.error(); }, []);
  useEffect(() => { if (aviso && !aviso.error) { const t = setTimeout(() => setNotice(a => (a?.id === aviso.id ? null : a)), 4500); return () => clearTimeout(t); } }, [aviso]);

  const refrescar = useCallback(() => {
    if (!ruta) return Promise.resolve();
    return cliente.accion<StateGit>('git.estado', { ruta }).then(e => { if (e.ruta === ruta) { setState(e); setErrorState(''); } }).catch(e => setErrorState(e.message));
  }, [ruta]);
  useEffect(() => { setState(null); setSel(null); setErrorState(''); refrescar(); }, [ruta]);
  // mientras está a la vista, el estado se relee cada 3 s (y al volver a la ventana)
  useEffect(() => {
    if (v.minimizada) return;
    const t = setInterval(() => { if (firstMapNow()) refrescar(); }, 3000);
    const f = () => refrescar(); addEventListener('focus', f);
    return () => { clearInterval(t); removeEventListener('focus', f); };
  }, [v.minimizada, refrescar]);

  // acción de git con su aviso; al acabar, el estado se relee
  const hacer = useCallback(async <T,>(nombre: string, datos: Record<string, unknown>, que: string, ok?: string | ((r: T) => string)): Promise<T | undefined> => {
    if (!ruta) return;
    setBusy(que); windowGit.set({ ocupado: true });
    try {
      const r = await cliente.accion<T>('git.' + nombre, { ruta, ...datos }, 200_000);
      if (ok) { avisar(typeof ok === 'function' ? ok(r) : ok); SFX.shortSuccess(); }
      return r;
    } catch (e: any) { avisar(e.message, true); return undefined; }
    finally { setBusy(''); windowGit.set({ ocupado: false }); await refrescar(); }
  }, [ruta, refrescar, avisar]);

  // la elección sigue al archivo si cambia de grupo (al prepararlo, sigue viéndose su diff en preparados)
  const grupos: Record<Grupo, FileGit[]> = { conflictos: estado?.conflictos ?? [], preparados: estado?.preparados ?? [], cambios: estado?.cambios ?? [] };
  const lista: Choice[] = (['conflictos', 'preparados', 'cambios'] as Grupo[]).flatMap(g => (plegados[g] ? [] : grupos[g].map(a => ({ grupo: g, ruta: a.ruta }))));
  useEffect(() => {
    if (!estado) return;
    if (sel && grupos[sel.grupo].some(a => a.ruta === sel.ruta)) return;
    const otro = sel && (['preparados', 'cambios', 'conflictos'] as Grupo[]).find(g => grupos[g].some(a => a.ruta === sel.ruta));
    setSel(otro ? { grupo: otro, ruta: sel!.ruta } : lista[0] ?? null);
  }, [estado]);
  const fileSel = sel ? grupos[sel.grupo].find(a => a.ruta === sel.ruta) : undefined;

  // ---- acciones sobre archivos
  const preparar = (as: FileGit[]) => hacer('preparar', { archivos: as.map(a => a.ruta) }, t('windows.staging'));
  const quitar = (as: FileGit[]) => hacer('quitar', { archivos: as.map(a => a.ruta) }, t('windows.unstaging'));
  const descartar = (as: FileGit[]) => {
    if (!as.length) return;
    const nuevos = as.filter(a => a.letra === '?'), consecutive = as.filter(a => a.letra !== '?');
    setConfirm({
      texto: <>{t('windows.discard3')} {as.length === 1 ? <b>{as[0].ruta}</b> : <b>{t('windows.nFiles', { n: as.length })}</b>}?{nuevos.length ? <> {nuevos.length === as.length ? (as.length === 1 ? t('windows.itIsNewItWill') : t('windows.theyAreNewTheyWill')) : t('windows.nAreNewAndWill', { n: nuevos.length })}.</> : ` ${t('windows.itGoesBackToHow')}`} {t('windows.thisCannotBeUndone')}</>,
      boton: t('windows.discard4'), si: () => hacer('descartar', { archivos: consecutive.map(a => a.ruta), withoutFollow: nuevos.map(a => a.ruta) }, t('windows.discarding'), t('windows.discarded')),
    });
  };
  const applyPatch = (parche: string, que: PatchThat, howMuch: string) => {
    const ir = () => hacer('parche', { parche, modo: que }, t('windows.applying'), que === 'preparar' ? t('windows.stagedQue', { que: howMuch }) : que === 'quitar' ? t('windows.unstagedQue', { que: howMuch }) : t('windows.discardedQue', { que: howMuch }));
    if (que === 'descartar') setConfirm({ texto: <>{t('windows.discard3')} {howMuch} {t('windows.from')} <b>{sel?.ruta}</b>? {t('windows.thisCannotBeUndone')}</>, boton: t('windows.discard4'), si: ir }); else ir();
  };
  const abrirArchivo = (a: FileGit) => hacer('abrirArchivo', { archivo: a.ruta }, t('windows.opening'));

  // ---- teclas: ↑↓ por los archivos, Espacio prepara o quita, Supr descarta, Intro abre en el editor
  const mover = (paso: number) => { if (!lista.length) return; const i = sel ? lista.findIndex(x => x.grupo === sel.grupo && x.ruta === sel.ruta) : -1; setSel(lista[Math.max(0, Math.min(lista.length - 1, i + paso))]); SFX.tick(); };
  const listKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); mover(1); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); mover(-1); }
    else if (e.key === ' ' && fileSel && sel) { e.preventDefault(); (sel.grupo === 'preparados' ? quitar : preparar)([fileSel]); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && fileSel && sel?.grupo === 'cambios') { e.preventDefault(); descartar([fileSel]); }
    else if (e.key === 'Enter' && fileSel) { e.preventDefault(); abrirArchivo(fileSel); }
  };

  const acciones = { maximizada: v.maximizada, closeTab: closeGit, closeWindow: closeGit, minimizar: minimizeGit, toggleMaximize: toggleMaximizeGit, goTab: (n: number) => { const vs: ViewGit[] = ['cambios', 'historial', 'ramas', 'github', 'prs']; if (vs[n - 1]) windowGit.set({ vista: vs[n - 1] }); }, moveTab: () => {} };
  const total = (estado?.preparados.length ?? 0) + (estado?.cambios.length ?? 0) + (estado?.conflictos.length ?? 0);
  const firma = estado ? `${estado.cabeza}|${estado.rama}|${total}|${estado.adelante}|${estado.atras}` : '';

  return (
    <div ref={caja} className={'ventana-git interactivo' + (v.maximizada ? ' maximizada' : '') + (v.minimizada ? ' minimizada' : '')} style={{ zIndex: v.maximizada ? 200000 + v.z : v.z }}
      onPointerDown={() => { if (!v.minimizada && !(document.activeElement && caja.current?.contains(document.activeElement))) onFrontGit(); }}
      onKeyDownCapture={e => { if (windowShortcut(e, acciones)) return; if (e.key === 'Escape' && confirmar) { e.preventDefault(); setConfirm(null); } }}
      onKeyDown={e => e.stopPropagation()} role="dialog" aria-label={t('world.gitClient')}>
      <div className="vt-cabeza vn-cabeza" onDoubleClick={e => { if (!(e.target as HTMLElement).closest('button, select')) toggleMaximizeGit(); }}>
        <span className="rejilla" /><span className={'piloto ' + (ocupado ? 'trabajando' : total ? 'esperando' : 'ociosa')} />
        <span className="vt-titulo">GIT · {repo?.nombre ?? t('windows.noRepo')}</span>
        <span className="vt-ruta" title={ruta ?? ''}>{ocupado || ruta}</span>
        <WindowButtons maximizada={v.maximizada} minimizar={minimizeGit} toggleMaximize={toggleMaximizeGit} cerrar={closeGit} closesThat={t('windows.theGitClient')} />
      </div>
      {!ruta ? <div className="gd-vacio">{t('windows.thereIsNoGitRepo')}</div> : (
        <div className="gc-cuerpo">
          <aside className="gc-lateral">
            <select className="gc-repo" value={ruta} onChange={e => choosePath(e.target.value)} title={t('windows.repoThoseOfTheShelter')}>
              {repos.map(r => <option key={r.ruta} value={r.ruta}>{r.nombre}{r.cambios ? ` · ${t('windows.nChanges', { n: r.cambios })}` : ''}</option>)}
            </select>
            <Rama estado={estado} ocupado={!!ocupado} hacer={hacer} />
            {estado?.operacion && (
              <div className="gc-operacion">
                <b>{OPERATION[estado.operacion]}</b>
                <span>{estado.conflictos.length ? (estado.conflictos.length === 1 ? t('windows.resolveTheConflictStageIt') : t('windows.resolveTheNConflictsStage', { n: estado.conflictos.length })) : t('windows.stageWhatYouResolvedAnd')} {estado.operacion === 'merge' ? t('windows.commit') : t('windows.continue')}</span>
                <span className="gc-fila-botones">
                  {estado.operacion !== 'merge' && <button className="gc-boton principal" disabled={!!ocupado || !!estado.conflictos.length} onClick={() => hacer('continuar', {}, t('windows.continuing'), t('windows.done'))}>{t('windows.continue2')}</button>}
                  <button className="gc-boton" disabled={!!ocupado} onClick={() => setConfirm({ texto: <>{t('windows.abort')} {OPERATION[estado.operacion!].toLowerCase()}? {t('windows.everythingGoesBackToHow')}</>, boton: t('windows.abort2'), si: () => hacer('abortar', {}, t('windows.aborting'), t('windows.aborted')) })}>{t('windows.abort2')}</button>
                </span>
              </div>
            )}
            <BoxCommit ruta={ruta} estado={estado} ocupado={!!ocupado} hacer={hacer} avisar={avisar} />
            <div className="gc-archivos" tabIndex={0} onKeyDown={listKey}>
              {errorState && <div className="gd-aviso">{errorState}</div>}
              {estado?.recortado && <div className="gd-aviso">{t('windows.thereAreTooManyFiles')}</div>}
              {(['conflictos', 'preparados', 'cambios'] as Grupo[]).map(g => grupos[g].length > 0 || g === 'cambios' ? (
                <Section key={g} grupo={g} archivos={grupos[g]} folded={plegados[g]} plegar={() => setFolded(p => ({ ...p, [g]: !p[g] }))} sel={sel} elegir={a => setSel({ grupo: g, ruta: a.ruta })}
                  preparar={preparar} quitar={quitar} descartar={descartar} abrir={abrirArchivo} ocupado={!!ocupado} />
              ) : null)}
              {estado && !total && <div className="gc-limpio">{t('windows.nothingToCommitTheWorking')}</div>}
            </div>
            {aviso && <div className={'gc-aviso' + (aviso.error ? ' error' : '')} onClick={() => setNotice(null)} title={t('windows.clickToDismiss')}>{aviso.texto}</div>}
          </aside>
          <main className="gc-principal">
            <div className="gc-pestanas">
              {([['cambios', t('windows.changes')], ['historial', t('windows.history')], ['ramas', t('windows.branchesStash')], ['github', 'GitHub'], ['prs', 'Pull requests']] as [ViewGit, string][]).map(([id, txt], i) => (
                <button key={id} className={'gc-pestana' + (v.vista === id ? ' activa' : '')} onClick={() => { windowGit.set({ vista: id }); SFX.tick(); }} title={`${txt} (${CMD}${i + 1})`}>{txt}{id === 'ramas' && estado?.cajon ? <small> · {t('windows.nInTheStash', { n: estado.cajon })}</small> : null}</button>
              ))}
              <span className="gc-pestanas-der">
                <button className={'gc-boton' + (paralelo ? ' on' : '')} onClick={() => { setParallel(p => { localStorage.setItem('refugio.git.paralelo', p ? '0' : '1'); return !p; }); SFX.conmutar(); }} title={t('windows.unifiedOrSideBySide')}>{paralelo ? t('windows.sideBySide') : t('windows.unified')}</button>
                <button className="gc-boton" onClick={() => openFiles({ raiz: ruta, ...(fileSel && fileSel.letra !== 'D' ? { rel: fileSel.ruta } : {}) })} title={t('windows.browseAndEditTheFiles')}>{t('windows.files3')}</button>
                {repo && <button className="gc-boton" onClick={() => openTerminalIn('git:' + ruta, repo.salaId, repo.nombre, ruta)} title={t('windows.openAShelterTerminalIn')}>{t('windows.terminal2')}</button>}
              </span>
            </div>
            <div className="gc-vista">
              {v.vista === 'cambios' && (fileSel && sel
                ? <DiffFile ruta={ruta} archivo={fileSel} grupo={sel.grupo} firma={firma} paralelo={paralelo} ocupado={!!ocupado} aplicar={applyPatch} preparar={preparar} quitar={quitar} descartar={descartar} abrir={abrirArchivo} avisar={avisar} />
                : <div className="gd-vacio">{estado ? (total ? t('windows.pickAFileOnThe') : t('windows.nothingToShowNoChanges')) : t('windows.readingTheRepo')}</div>)}
              {v.vista === 'historial' && <Historial ruta={ruta} firma={firma} paralelo={paralelo} avisar={avisar} />}
              {v.vista === 'ramas' && <Branches ruta={ruta} estado={estado} firma={firma} ocupado={!!ocupado} hacer={hacer} confirmar={setConfirm} avisar={avisar} />}
              {v.vista === 'github' && <GitHub avisar={avisar} />}
              {v.vista === 'prs' && <PullRequests avisar={avisar} />}
            </div>
          </main>
        </div>
      )}
      {confirmar && (
        <div className="vt-confirmar" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const c = confirmar; setConfirm(null); c.si(); } }}>
          <div className="vt-confirmar-caja">
            <p>{confirmar.texto}</p>
            <div className="vt-confirmar-botones">
              <button className="consola-x peligro" autoFocus onClick={() => { const c = confirmar; setConfirm(null); c.si(); }}>{confirmar.boton} ({t('windows.enter')})</button>
              <button className="consola-x" onClick={() => setConfirm(null)}>{t('windows.cancelEsc')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type Make = <T>(nombre: string, datos: Record<string, unknown>, que: string, ok?: string | ((r: T) => string)) => Promise<T | undefined>;

// ---------------------------------------------------------------- rama y sincronización
function Rama({ estado, ocupado, hacer }: { estado: StateGit | null; ocupado: boolean; hacer: Make }) {
  if (!estado) return <div className="gc-rama tenue">{t('windows.reading')}</div>;
  const withoutRemote = !estado.remote.length;
  const sync = !estado.upstream ? (estado.rama && !withoutRemote ? t('windows.publishRama', { rama: estado.rama }) : null) : estado.adelante || estado.atras ? `${t('windows.sync')}${estado.atras ? ` ↓${estado.atras}` : ''}${estado.adelante ? ` ↑${estado.adelante}` : ''}` : null;
  return (
    <div className="gc-rama">
      <span className="gc-rama-nombre" title={estado.upstream ? t('windows.tracksUpstream', { upstream: estado.upstream }) : withoutRemote ? t('windows.noRemote') : t('windows.noRemoteBranchYet')}>⎇ {estado.rama ?? t('windows.detachedHeadHash', { hash: estado.cabeza?.slice(0, 7) ?? t('windows.noCommits') })}</span>
      {estado.upstream && <span className="gc-ab" title={t('windows.adelanteToPushAtrasTo', { adelante: estado.adelante, atras: estado.atras, upstream: estado.upstream })}>{estado.atras ? <i className="baja">↓{estado.atras}</i> : null}{estado.adelante ? <i className="sube">↑{estado.adelante}</i> : null}</span>}
      <span className="gc-fila-botones">
        {!withoutRemote && <button className="gc-boton icono" disabled={ocupado} onClick={() => hacer('sincronizar', { que: 'fetch' }, t('windows.fetchingFromTheRemote'), t('windows.remoteUpToDate'))} title={t('windows.fetchGetWhatIsNew')}>⟳</button>}
        {estado.upstream && <button className="gc-boton icono" disabled={ocupado} onClick={() => hacer('sincronizar', { que: 'pull' }, 'Pull…', t('windows.pullDone'))} title={t('windows.pullDownloadAndMergeWhat')}>↓</button>}
        {!withoutRemote && estado.rama && <button className="gc-boton icono" disabled={ocupado} onClick={() => hacer('sincronizar', { que: 'push' }, 'Push…', t('windows.pushDone'))} title={estado.upstream ? t('windows.pushUploadYourCommits') : t('windows.pushPublishTheBranchTo')}>↑</button>}
      </span>
      {sync && <button className="gc-boton ancho" disabled={ocupado} onClick={() => hacer('sincronizar', { que: 'sync' }, t('windows.syncing'), t('windows.synced'))}>{sync}</button>}
    </div>
  );
}

// ---------------------------------------------------------------- la caja del commit
function BoxCommit({ ruta, estado, ocupado, hacer, avisar }: { ruta: string; estado: StateGit | null; ocupado: boolean; hacer: Make; avisar: (t: string, e?: boolean) => void }) {
  const [msg, setMsg] = useState(() => drafts.get(ruta) ?? '');
  const [menu, setMenu] = useState(false);
  useEffect(() => { setMsg(drafts.get(ruta) ?? ''); }, [ruta]);
  const cambiar = (t: string) => { setMsg(t); drafts.set(ruta, t); };
  const preparados = estado?.preparados.length ?? 0, cambios = (estado?.cambios.length ?? 0);
  const todo = !preparados && cambios > 0;
  const puede = !!estado && !ocupado && !!msg.trim() && (preparados > 0 || cambios > 0) && !estado.conflictos.length;
  const commit = async (o: { amend?: boolean; push?: boolean } = {}) => {
    setMenu(false);
    if (!o.amend && !puede) { if (!msg.trim()) avisar(t('windows.writeTheCommitMessage'), true); return; }
    const r = await hacer<{ hash: string }>('commit', { mensaje: msg, amend: !!o.amend, todo: todo && !o.amend }, o.amend ? t('windows.amending') : t('windows.committing'), x => (o.amend ? t('windows.amendedHash', { hash: x.hash }) : t('windows.committedHash', { hash: x.hash })) + (estado?.rama ? ' ' + t('windows.onRama', { rama: estado.rama }) : '') + '.');
    if (!r) return;
    cambiar(''); SFX.success();
    if (o.push) await hacer('sincronizar', { que: 'push' }, 'Push…', t('windows.commitPushed'));
  };
  const deshacer = async () => { setMenu(false); const r = await hacer<{ mensaje: string }>('deshacerCommit', {}, t('windows.undoingTheCommit'), t('windows.lastCommitUndoneItsChanges')); if (r?.mensaje && !msg.trim()) cambiar(r.mensaje); };
  return (
    <div className="gc-commit">
      <div className="gc-commit-caja">
        <textarea value={msg} onChange={e => cambiar(e.target.value)} rows={Math.min(8, Math.max(2, msg.split('\n').length))} spellCheck={false}
          placeholder={estado?.rama ? t('windows.messageAtajoEnterToCommit', { shortcut: CMD, rama: estado.rama }) : t('windows.messageAtajoEnterToCommit2', { shortcut: CMD })}
          onKeyDown={e => { if (e.key === 'Enter' && (MAC ? e.metaKey : e.ctrlKey)) { e.preventDefault(); commit(); } }} />
        <button className="gc-ia" disabled title={t('windows.generateTheMessageWithAi')}>✨</button>
      </div>
      <div className="gc-commit-botones">
        <button className="gc-boton principal ancho" disabled={!puede} onClick={() => commit()} title={todo ? t('windows.nothingIsStagedEverythingGets') : t('windows.commitTheStagedChangesAtajo', { shortcut: CMD })}>
          ✓ {todo ? t('windows.stageAllAndCommit') : 'Commit'}{estado?.rama && !todo ? <small> {t('windows.onRama', { rama: estado.rama })}</small> : null}
        </button>
        <button className="gc-boton icono principal" disabled={ocupado || !estado} onClick={() => setMenu(m => !m)} title={t('windows.moreWaysToCommit')}>▾</button>
        {menu && (
          <div className="gc-menu" onMouseLeave={() => setMenu(false)}>
            <button disabled={!puede || !estado?.remote.length} onClick={() => commit({ push: true })}>{t('windows.commitAndPush')}</button>
            <button disabled={!estado?.cabeza} onClick={() => commit({ amend: true })} title={t('windows.redoTheLastCommitWith')}>{t('windows.amendLastCommit')}</button>
            <button disabled={!estado?.cabeza} onClick={deshacer} title={t('windows.undoesItAndLeavesIts')}>{t('windows.undoLastCommit')}</button>
            {estado?.lastMessage && <button onClick={() => { cambiar(estado.lastMessage); setMenu(false); }}>{t('windows.copyTheLastCommitMessage')}</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- listas de archivos
function Section({ grupo, archivos, folded, plegar, sel, elegir, preparar, quitar, descartar, abrir, ocupado }: {
  grupo: Grupo; archivos: FileGit[]; folded: boolean; plegar: () => void; sel: Choice | null; elegir: (a: FileGit) => void; ocupado: boolean;
  preparar: (a: FileGit[]) => void; quitar: (a: FileGit[]) => void; descartar: (a: FileGit[]) => void; abrir: (a: FileGit) => void;
}) {
  const titulo = grupo === 'preparados' ? t('windows.staged') : grupo === 'conflictos' ? t('windows.conflicts') : t('windows.changes');
  return (
    <section className={'gc-seccion ' + grupo}>
      <header onClick={plegar}>
        <span className="gc-plegar">{folded ? '▸' : '▾'}</span>
        <span className="gc-seccion-titulo">{titulo}</span>
        <span className="gc-seccion-botones" onClick={e => e.stopPropagation()}>
          {grupo === 'preparados' && archivos.length > 0 && <button disabled={ocupado} onClick={() => quitar(archivos)} title={t('windows.unstageAll')}>−</button>}
          {grupo === 'cambios' && archivos.length > 0 && <><button disabled={ocupado} onClick={() => descartar(archivos)} title={t('windows.discardAllChanges')}>↶</button><button disabled={ocupado} onClick={() => preparar(archivos)} title={t('windows.stageAll')}>+</button></>}
          {grupo === 'conflictos' && archivos.length > 0 && <button disabled={ocupado} onClick={() => preparar(archivos)} title={t('windows.markAllAsResolvedStage')}>✓</button>}
        </span>
        <span className="gc-cuenta">{archivos.length}</span>
      </header>
      {!folded && (
        <ul>
          {archivos.map(a => {
            const partes = a.ruta.split('/'), nombre = partes.pop(), carpeta = partes.join('/');
            const activa = sel?.grupo === grupo && sel.ruta === a.ruta;
            return (
              <li key={a.ruta} className={activa ? 'activa' : ''} onClick={() => elegir(a)} onDoubleClick={() => abrir(a)} ref={el => { if (activa) el?.scrollIntoView({ block: 'nearest' }); }} title={`${a.origen ? a.origen + ' → ' : ''}${a.ruta} · ${LETTER[a.letra] ?? a.letra}`}>
                <span className={'gc-nombre' + (a.letra === 'D' ? ' tachado' : '')}>{nombre}</span>
                <span className="gc-carpeta">{carpeta}</span>
                <span className="gc-botones-archivo" onClick={e => e.stopPropagation()}>
                  {a.letra !== 'D' && <button onClick={() => abrir(a)} title={t('windows.openInTheEditorEnter')}>↗</button>}
                  {grupo === 'cambios' && <button disabled={ocupado} onClick={() => descartar([a])} title={t('windows.discardTheChangesDel')}>↶</button>}
                  {grupo === 'preparados' ? <button disabled={ocupado} onClick={() => quitar([a])} title={t('windows.unstageSpace')}>−</button>
                    : <button disabled={ocupado} onClick={() => preparar([a])} title={grupo === 'conflictos' ? t('windows.markAsResolved') : t('windows.stageSpace')}>{grupo === 'conflictos' ? '✓' : '+'}</button>}
                </span>
                <span className={'gc-letra l-' + (a.letra === '?' ? 'U' : a.letra)}>{a.letra === '?' ? 'U' : grupo === 'conflictos' ? '!' : a.letra}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- el diff del archivo elegido
function DiffFile({ ruta, archivo, grupo, firma, paralelo, ocupado, aplicar, preparar, quitar, descartar, abrir, avisar }: {
  ruta: string; archivo: FileGit; grupo: Grupo; firma: string; paralelo: boolean; ocupado: boolean; avisar: (t: string, e?: boolean) => void;
  aplicar: (p: string, q: PatchThat, c: string) => void; preparar: (a: FileGit[]) => void; quitar: (a: FileGit[]) => void; descartar: (a: FileGit[]) => void; abrir: (a: FileGit) => void;
}) {
  const [diff, setDiff] = useState<{ texto: string; binario: boolean; recortado: boolean; clave: string } | null>(null);
  const [entero, setWhole] = useState(false);
  const clave = `${ruta}|${grupo}|${archivo.ruta}|${entero}`;
  useEffect(() => {
    let vivo = true;
    cliente.accion<any>('git.diff', { ruta, archivo: archivo.ruta, origen: archivo.origen, prepared: grupo === 'preparados', withoutFollow: archivo.letra === '?', contexto: entero ? 100000 : 3 })
      .then(d => { if (vivo) setDiff(x => (x && x.clave === clave && x.texto === d.texto ? x : { ...d, clave })); }).catch(e => { if (vivo) avisar(e.message, true); });
    return () => { vivo = false; };
  }, [clave, firma]);
  const modo = grupo === 'preparados' ? 'preparados' : 'cambios';
  return (
    <div className="gc-diff">
      <div className="gc-diff-cab">
        <span className={'gc-letra l-' + (archivo.letra === '?' ? 'U' : archivo.letra)}>{archivo.letra === '?' ? 'U' : archivo.letra}</span>
        <span className="gc-diff-ruta">{archivo.origen ? <><span className="tenue">{archivo.origen} → </span>{archivo.ruta}</> : archivo.ruta}</span>
        <span className="tenue">{grupo === 'preparados' ? t('windows.stagedIndexLastCommit') : grupo === 'conflictos' ? t('windows.conflicted') : archivo.letra === '?' ? t('windows.newUntracked') : t('windows.workingCopyStaged')}</span>
        <span className="gc-fila-botones">
          <button className={'gc-boton' + (entero ? ' on' : '')} onClick={() => setWhole(x => !x)} title={t('windows.showTheWholeFileAround')}>{entero ? t('windows.wholeFile') : t('windows.changesOnly')}</button>
          {archivo.letra !== 'D' && <button className="gc-boton" onClick={() => abrir(archivo)}>{t('windows.open2')}</button>}
          {grupo === 'cambios' && <button className="gc-boton" disabled={ocupado} onClick={() => descartar([archivo])}>{t('windows.discard2')}</button>}
          {grupo === 'preparados' ? <button className="gc-boton" disabled={ocupado} onClick={() => quitar([archivo])}>{t('windows.unstage')}</button>
            : <button className="gc-boton principal" disabled={ocupado} onClick={() => preparar([archivo])}>{grupo === 'conflictos' ? t('windows.resolved') : t('windows.stage')}</button>}
        </span>
      </div>
      <div className="gc-diff-cuerpo">
        {diff && diff.clave === clave ? <VisorDiff texto={diff.texto} binario={diff.binario} recortado={diff.recortado} modo={grupo === 'conflictos' ? 'commit' : modo} paralelo={paralelo} ocupado={ocupado} onApply={aplicar} /> : <div className="gd-vacio">{t('windows.readingTheDiff')}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ramas y cajón
interface BranchGit { nombre: string; remota: boolean; hash: string; upstream?: string; adelante: number; atras: number; lost: boolean; fecha: number; actual: boolean; asunto: string }
function Branches({ ruta, estado, firma, ocupado, hacer, confirmar, avisar }: { ruta: string; estado: StateGit | null; firma: string; ocupado: boolean; hacer: Make; confirmar: (c: { texto: React.ReactNode; boton: string; si: () => void }) => void; avisar: (t: string, e?: boolean) => void }) {
  const [ramas, setBranches] = useState<BranchGit[] | null>(null);
  const [cajon, setDrawer] = useState<{ ref: string; asunto: string; fecha: number }[]>([]);
  const [nueva, setNew] = useState('');
  const [nota, setNote] = useState('');
  const [filtro, setFilter] = useState('');
  useEffect(() => {
    cliente.accion<BranchGit[]>('git.ramas', { ruta }).then(setBranches).catch(e => avisar(e.message, true));
    cliente.accion<any[]>('git.cajon', { ruta }).then(setDrawer).catch(() => {});
  }, [ruta, firma]);
  const q = filtro.trim().toLowerCase();
  const locales = (ramas ?? []).filter(r => !r.remota && (!q || r.nombre.toLowerCase().includes(q)));
  const remotas = (ramas ?? []).filter(r => r.remota && (!q || r.nombre.toLowerCase().includes(q)));
  const hasChanges = !!estado && (estado.preparados.length + estado.cambios.length) > 0;
  const crear = async () => { if (!nueva.trim()) return; const r = await hacer('crearRama', { nombre: nueva.trim() }, t('windows.creatingTheBranch'), t('windows.branchNombreCreatedYouAre', { nombre: nueva.trim() })); if (r !== undefined) setNew(''); };
  const borrar = (r: BranchGit) => confirmar({ texto: <>{t('windows.deleteTheBranch')} <b>{r.nombre}</b>?{r.upstream ? '' : ` ${t('windows.itIsNotOnAny')}`}</>, boton: t('windows.delete'), si: async () => {
    const ok = await hacer('borrarRama', { nombre: r.nombre }, t('windows.deleting'), t('windows.branchNombreDeleted', { nombre: r.nombre }));
    if (ok === undefined) confirmar({ texto: <>{t('windows.theBranch')} <b>{r.nombre}</b> {t('windows.hasCommitsThatAreOn')}</>, boton: t('windows.deleteAnyway'), si: () => hacer('borrarRama', { nombre: r.nombre, forzar: true }, t('windows.deleting'), t('windows.branchNombreDeleted', { nombre: r.nombre })) });
  } });
  const fila = (r: BranchGit) => (
    <li key={(r.remota ? 'r:' : 'l:') + r.nombre} className={r.actual ? 'actual' : ''}>
      <span className="gr-nombre" title={r.nombre}>{r.actual ? '● ' : ''}{r.nombre}</span>
      <span className="gr-ab">{r.lost ? <i className="tenue">{t('windows.remoteDeleted')}</i> : <>{r.atras ? <i className="baja">↓{r.atras}</i> : null}{r.adelante ? <i className="sube">↑{r.adelante}</i> : null}</>}</span>
      <span className="gr-asunto" title={r.asunto}>{r.asunto}</span>
      <span className="tenue gr-cuando">{hace(r.fecha)}</span>
      <span className="gc-fila-botones">
        {!r.actual && <button className="gc-boton" disabled={ocupado} onClick={() => hacer('cambiarRama', { rama: r.nombre, remota: r.remota }, t('windows.switchingBranch'), t('windows.nowOnRama', { rama: r.remota ? r.nombre.split('/').slice(1).join('/') : r.nombre }))}>{t('windows.switch')}</button>}
        {!r.actual && !r.remota && <button className="gc-boton icono" disabled={ocupado} onClick={() => borrar(r)} title={t('windows.deleteTheBranch2')}>🗑</button>}
      </span>
    </li>
  );
  return (
    <div className="gr">
      <div className="gc-herramientas">
        <input className="gc-filtro" placeholder={t('windows.filterBranches')} value={filtro} onChange={e => setFilter(e.target.value)} />
        <input className="gc-filtro" placeholder={t('windows.newBranchFromHere')} value={nueva} onChange={e => setNew(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') crear(); }} />
        <button className="gc-boton principal" disabled={ocupado || !nueva.trim()} onClick={crear}>{t('windows.createBranch')}</button>
      </div>
      <div className="gr-columnas">
        <section>
          <h4>{t('windows.localBranches')} <span className="tenue">({locales.length})</span></h4>
          <ul className="gr-lista">{locales.map(fila)}{ramas && !locales.length && <li className="tenue">{t('windows.none')}</li>}</ul>
          {remotas.length > 0 && <><h4>{t('windows.remotes')} <span className="tenue">({remotas.length})</span></h4><ul className="gr-lista">{remotas.map(fila)}</ul></>}
        </section>
        <section>
          <h4>{t('windows.stash')} <span className="tenue">(stash · {cajon.length})</span></h4>
          <p className="tenue">{t('windows.setAsideYourHalfDone')}</p>
          <div className="gc-herramientas">
            <input className="gc-filtro" placeholder={t('windows.noteOptional')} value={nota} onChange={e => setNote(e.target.value)} />
            <button className="gc-boton principal" disabled={ocupado || !hasChanges} onClick={async () => { if (await hacer('cajonGuardar', { mensaje: nota.trim() }, t('windows.savingToTheStash'), t('windows.changesSavedToTheStash')) !== undefined) setNote(''); }}>{t('windows.stashChanges')}</button>
          </div>
          <ul className="gr-lista">
            {cajon.map(c => (
              <li key={c.ref}>
                <span className="gr-nombre">{c.ref.replace('stash@', '#').replace(/[{}]/g, '')}</span>
                <span className="gr-asunto" title={c.asunto}>{c.asunto}</span>
                <span className="tenue gr-cuando">{hace(c.fecha)}</span>
                <span className="gc-fila-botones">
                  <button className="gc-boton principal" disabled={ocupado} onClick={() => hacer('cajonSacar', { ref: c.ref }, t('windows.poppingFromTheStash'), t('windows.changesReturnedToTheWorking'))} title={t('windows.applyItAndRemoveIt')}>{t('windows.pop')}</button>
                  <button className="gc-boton" disabled={ocupado} onClick={() => hacer('cajonSacar', { ref: c.ref, quedarse: true }, t('windows.applying'), t('windows.appliedStillInTheStash'))} title={t('windows.applyItAndKeepIt')}>{t('windows.apply')}</button>
                  <button className="gc-boton icono" disabled={ocupado} onClick={() => confirmar({ texto: <>{t('windows.drop')} <b>{c.asunto}</b> {t('windows.fromTheStashItWill')}</>, boton: t('windows.drop2'), si: () => hacer('cajonTirar', { ref: c.ref }, t('windows.dropping'), t('windows.dropped')) })} title={t('windows.dropItDrop')}>🗑</button>
                </span>
              </li>
            ))}
            {!cajon.length && <li className="tenue">{t('windows.theStashIsEmpty')}</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
