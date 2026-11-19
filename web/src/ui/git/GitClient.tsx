// Cliente de git del refugio (sala de Control de Versiones), al estilo del control de código de los editores: a la
// izquierda, el repo, la rama y la caja del commit con lo preparado y lo cambiado (preparar y quitar con un clic,
// descartar con confirmación); a la derecha, el diff del archivo elegido (preparar o descartar por bloques o por
// líneas sueltas), el historial con su grafo, las ramas y el cajón (stash) y tu GitHub.
// Repos: los de las salas del refugio (y el del propio juego), sus worktrees y los de las alas de coordinación.
// El mensaje del commit lo escribes tú (⌘Intro hace el commit); la generación con IA queda para cuando el refugio
// tenga inferencia.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { live, client } from '../../net/client';
import { t } from '@shared/language';
import { SFX } from '../../audio/sound';
import { firstMapNow } from '../../engine/focus';
import { windowShortcut, WindowButtons, CMD, MAC } from '../windows';
import { openTerminalIn } from '../Terminals';
import { openFiles } from '../files/window';
import { windowGit, choosePath, lastPath, minimizeGit, closeGit, onFrontGit, toggleMaximizeGit, type ViewGit, type WindowGit } from './window';
import { DiffViewer, type PatchThat } from './DiffViewer';
import { HistoryView } from './History';
import { GitHub } from './GitHub';
import { PullRequests } from './PullRequests';
import { ago, LETTER, type Letter } from './common';

interface FileGit { path: string; origin?: string; letter: Letter }
interface StateGit {
  path: string; branch: string | null; head: string | null; upstream: string | null; ahead: number; behind: number;
  staged: FileGit[]; changes: FileGit[]; conflicts: FileGit[];
  operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null; truncated: boolean; lastMessage: string; remote: string[]; drawer: number;
}
type Group = 'preparados' | 'cambios' | 'conflictos';
interface Choice { group: Group; path: string }
interface Repo { path: string; name: string; roomId: string; detail: string; changes: number; worktree?: boolean }

const OPERATION: Record<string, string> = { merge: t('windows.mergeInProgress'), rebase: t('windows.rebaseInProgress'), 'cherry-pick': t('windows.cherryPickInProgress'), revert: t('windows.revertInProgress') };
const drafts = new Map<string, string>();

// ---------------------------------------------------------------- los repos del refugio
function useRepos(): Repo[] {
  const rooms: any[] = live.use(e => e.state?.rooms ?? []);
  const repos = live.use(e => e.repos);
  return useMemo(() => {
    const out: Repo[] = [];
    for (const s of rooms) {
      const r = repos[s.id]; if (!s.path || !r) continue;
      if (r.isGit) {
        out.push({ path: r.path, name: s.name, roomId: s.id, detail: r.branch ?? '', changes: r.changes });
        for (const w of r.worktrees ?? []) if (!w.main) out.push({ path: w.path, name: `${s.name} ◇ ${w.branch}`, roomId: s.id, detail: 'worktree', changes: w.changes, worktree: true });
      }
      for (const sub of r.subrepos ?? []) out.push({ path: sub, name: `${s.name} / ${sub.split('/').pop()}`, roomId: s.id, detail: '', changes: 0 });
    }
    return out;
  }, [rooms, repos]);
}

export function GitClient() {
  const v = windowGit.use(e => e);
  const repos = useRepos();
  if (!v.open) return null;
  // el repo: el elegido; si no, el último que usaste; si no, el que más cambios tiene
  const path = [v.path, lastPath()].find(r => r && repos.some(x => x.path === r)) ?? [...repos].sort((a, b) => b.changes - a.changes)[0]?.path ?? null;
  return <Window v={v} repos={repos} path={path} />;
}

function Window({ v, repos, path }: { v: WindowGit; repos: Repo[]; path: string | null }) {
  const repo = repos.find(r => r.path === path);
  const [state, setState] = useState<StateGit | null>(null);
  const [errorState, setErrorState] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ text: string; error: boolean; id: number } | null>(null);
  const [confirm, setConfirm] = useState<{ text: React.ReactNode; button: string; si: () => void; no?: () => void } | null>(null);
  const [sel, setSel] = useState<Choice | null>(null);
  const [parallel, setParallel] = useState(() => localStorage.getItem('refugio.git.paralelo') === '1');
  const [folded, setFolded] = useState<Record<Group, boolean>>({ preparados: false, cambios: false, conflictos: false });
  const box = useRef<HTMLDivElement>(null);

  const notify = useCallback((text: string, error = false) => { setNotice({ text, error, id: Date.now() }); if (error) SFX.error(); }, []);
  useEffect(() => { if (notice && !notice.error) { const t = setTimeout(() => setNotice(a => (a?.id === notice.id ? null : a)), 4500); return () => clearTimeout(t); } }, [notice]);

  const refresh = useCallback(() => {
    if (!path) return Promise.resolve();
    return client.action<StateGit>('git.estado', { path }).then(e => { if (e.path === path) { setState(e); setErrorState(''); } }).catch(e => setErrorState(e.message));
  }, [path]);
  useEffect(() => { setState(null); setSel(null); setErrorState(''); refresh(); }, [path]);
  // mientras está a la vista, el estado se relee cada 3 s (y al volver a la ventana)
  useEffect(() => {
    if (v.minimized) return;
    const t = setInterval(() => { if (firstMapNow()) refresh(); }, 3000);
    const f = () => refresh(); addEventListener('focus', f);
    return () => { clearInterval(t); removeEventListener('focus', f); };
  }, [v.minimized, refresh]);

  // acción de git con su aviso; al acabar, el estado se relee
  const act = useCallback(async <T,>(name: string, data: Record<string, unknown>, what: string, ok?: string | ((r: T) => string), noGate = false): Promise<T | undefined> => {
    if (!path) return;
    // la puerta del pre-flight (server/preflight.ts): subir desde el worktree de una tarea sin el compare validado en su
    // commit (o sin la lista contestada) pregunta antes, como en las conversaciones
    if (!noGate && name === 'sincronizar' && (data.what === 'push' || data.what === 'sync')) {
      const g = await client.action<{ key: string; missing: string[] } | null>('preflight.puerta', { path }).catch(() => null);
      if (g?.missing.length) return new Promise<T | undefined>(res => setConfirm({
        text: <>{t('windows.preflightGate', { clave: g.key })}<br />{g.missing.map(f => <span key={f}>• {f}<br /></span>)}</>,
        button: t('windows.pushAnyway'), si: () => { act<T>(name, data, what, ok, true).then(res); }, no: () => res(undefined),
      }));
    }
    setBusy(what); windowGit.set({ busy: true });
    try {
      const r = await client.action<T>('git.' + name, { path, ...data }, 200_000);
      if (ok) { notify(typeof ok === 'function' ? ok(r) : ok); SFX.shortSuccess(); }
      return r;
    } catch (e: any) { notify(e.message, true); return undefined; }
    finally { setBusy(''); windowGit.set({ busy: false }); await refresh(); }
  }, [path, refresh, notify]);

  // la elección sigue al archivo si cambia de grupo (al prepararlo, sigue viéndose su diff en preparados)
  const groups: Record<Group, FileGit[]> = { conflictos: state?.conflicts ?? [], preparados: state?.staged ?? [], cambios: state?.changes ?? [] };
  const list: Choice[] = (['conflictos', 'preparados', 'cambios'] as Group[]).flatMap(g => (folded[g] ? [] : groups[g].map(a => ({ group: g, path: a.path }))));
  useEffect(() => {
    if (!state) return;
    if (sel && groups[sel.group].some(a => a.path === sel.path)) return;
    const other = sel && (['preparados', 'cambios', 'conflictos'] as Group[]).find(g => groups[g].some(a => a.path === sel.path));
    setSel(other ? { group: other, path: sel!.path } : list[0] ?? null);
  }, [state]);
  const fileSel = sel ? groups[sel.group].find(a => a.path === sel.path) : undefined;

  // ---- acciones sobre archivos
  const stage = (as: FileGit[]) => act('preparar', { files: as.map(a => a.path) }, t('windows.staging'));
  const remove = (as: FileGit[]) => act('quitar', { files: as.map(a => a.path) }, t('windows.unstaging'));
  const discard = (as: FileGit[]) => {
    if (!as.length) return;
    const fresh = as.filter(a => a.letter === '?'), consecutive = as.filter(a => a.letter !== '?');
    setConfirm({
      text: <>{t('windows.discard3')} {as.length === 1 ? <b>{as[0].path}</b> : <b>{t('windows.nFiles', { n: as.length })}</b>}?{fresh.length ? <> {fresh.length === as.length ? (as.length === 1 ? t('windows.itIsNewItWill') : t('windows.theyAreNewTheyWill')) : t('windows.nAreNewAndWill', { n: fresh.length })}.</> : ` ${t('windows.itGoesBackToHow')}`} {t('windows.thisCannotBeUndone')}</>,
      button: t('windows.discard4'), si: () => act('descartar', { files: consecutive.map(a => a.path), withoutFollow: fresh.map(a => a.path) }, t('windows.discarding'), t('windows.discarded')),
    });
  };
  const applyPatch = (patch: string, what: PatchThat, howMuch: string) => {
    const go = () => act('parche', { patch, mode: what }, t('windows.applying'), what === 'preparar' ? t('windows.stagedQue', { que: howMuch }) : what === 'quitar' ? t('windows.unstagedQue', { que: howMuch }) : t('windows.discardedQue', { que: howMuch }));
    if (what === 'descartar') setConfirm({ text: <>{t('windows.discard3')} {howMuch} {t('windows.from')} <b>{sel?.path}</b>? {t('windows.thisCannotBeUndone')}</>, button: t('windows.discard4'), si: go }); else go();
  };
  const openFile = (a: FileGit) => act('abrirArchivo', { file: a.path }, t('windows.opening'));

  // ---- teclas: ↑↓ por los archivos, Espacio prepara o quita, Supr descarta, Intro abre en el editor
  const move = (step: number) => { if (!list.length) return; const i = sel ? list.findIndex(x => x.group === sel.group && x.path === sel.path) : -1; setSel(list[Math.max(0, Math.min(list.length - 1, i + step))]); SFX.tick(); };
  const listKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); move(-1); }
    else if (e.key === ' ' && fileSel && sel) { e.preventDefault(); (sel.group === 'preparados' ? remove : stage)([fileSel]); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && fileSel && sel?.group === 'cambios') { e.preventDefault(); discard([fileSel]); }
    else if (e.key === 'Enter' && fileSel) { e.preventDefault(); openFile(fileSel); }
  };

  const actions = { maximized: v.maximized, closeTab: closeGit, closeWindow: closeGit, minimize: minimizeGit, toggleMaximize: toggleMaximizeGit, goTab: (n: number) => { const vs: ViewGit[] = ['cambios', 'historial', 'ramas', 'github', 'prs']; if (vs[n - 1]) windowGit.set({ view: vs[n - 1] }); }, moveTab: () => {} };
  const total = (state?.staged.length ?? 0) + (state?.changes.length ?? 0) + (state?.conflicts.length ?? 0);
  const signature = state ? `${state.head}|${state.branch}|${total}|${state.ahead}|${state.behind}` : '';

  return (
    <div ref={box} className={'ventana-git interactivo' + (v.maximized ? ' maximizada' : '') + (v.minimized ? ' minimizada' : '')} style={{ zIndex: v.maximized ? 200000 + v.z : v.z }}
      onPointerDown={() => { if (!v.minimized && !(document.activeElement && box.current?.contains(document.activeElement))) onFrontGit(); }}
      onKeyDownCapture={e => { if (windowShortcut(e, actions)) return; if (e.key === 'Escape' && confirm) { e.preventDefault(); const c = confirm; setConfirm(null); c.no?.(); } }}
      onKeyDown={e => e.stopPropagation()} role="dialog" aria-label={t('world.gitClient')}>
      <div className="vt-cabeza vn-cabeza" onDoubleClick={e => { if (!(e.target as HTMLElement).closest('button, select')) toggleMaximizeGit(); }}>
        <span className="rejilla" /><span className={'piloto ' + (busy ? 'trabajando' : total ? 'esperando' : 'ociosa')} />
        <span className="vt-titulo">GIT · {repo?.name ?? t('windows.noRepo')}</span>
        <span className="vt-ruta" title={path ?? ''}>{busy || path}</span>
        <WindowButtons maximized={v.maximized} minimize={minimizeGit} toggleMaximize={toggleMaximizeGit} close={closeGit} closesThat={t('windows.theGitClient')} />
      </div>
      {!path ? <div className="gd-vacio">{t('windows.thereIsNoGitRepo')}</div> : (
        <div className="gc-cuerpo">
          <aside className="gc-lateral">
            <select className="gc-repo" value={path} onChange={e => choosePath(e.target.value)} title={t('windows.repoThoseOfTheShelter')}>
              {repos.map(r => <option key={r.path} value={r.path}>{r.name}{r.changes ? ` · ${t('windows.nChanges', { n: r.changes })}` : ''}</option>)}
            </select>
            <Branch state={state} busy={!!busy} act={act} />
            {state?.operation && (
              <div className="gc-operacion">
                <b>{OPERATION[state.operation]}</b>
                <span>{state.conflicts.length ? (state.conflicts.length === 1 ? t('windows.resolveTheConflictStageIt') : t('windows.resolveTheNConflictsStage', { n: state.conflicts.length })) : t('windows.stageWhatYouResolvedAnd')} {state.operation === 'merge' ? t('windows.commit') : t('windows.continue')}</span>
                <span className="gc-fila-botones">
                  {state.operation !== 'merge' && <button className="gc-boton principal" disabled={!!busy || !!state.conflicts.length} onClick={() => act('continuar', {}, t('windows.continuing'), t('windows.done'))}>{t('windows.continue2')}</button>}
                  <button className="gc-boton" disabled={!!busy} onClick={() => setConfirm({ text: <>{t('windows.abort')} {OPERATION[state.operation!].toLowerCase()}? {t('windows.everythingGoesBackToHow')}</>, button: t('windows.abort2'), si: () => act('abortar', {}, t('windows.aborting'), t('windows.aborted')) })}>{t('windows.abort2')}</button>
                </span>
              </div>
            )}
            <CommitBox path={path} state={state} busy={!!busy} act={act} notify={notify} />
            <div className="gc-archivos" tabIndex={0} onKeyDown={listKey}>
              {errorState && <div className="gd-aviso">{errorState}</div>}
              {state?.truncated && <div className="gd-aviso">{t('windows.thereAreTooManyFiles')}</div>}
              {(['conflictos', 'preparados', 'cambios'] as Group[]).map(g => groups[g].length > 0 || g === 'cambios' ? (
                <Section key={g} group={g} files={groups[g]} folded={folded[g]} fold={() => setFolded(p => ({ ...p, [g]: !p[g] }))} sel={sel} pick={a => setSel({ group: g, path: a.path })}
                  stage={stage} remove={remove} discard={discard} open={openFile} busy={!!busy} />
              ) : null)}
              {state && !total && <div className="gc-limpio">{t('windows.nothingToCommitTheWorking')}</div>}
            </div>
            {notice && <div className={'gc-aviso' + (notice.error ? ' error' : '')} onClick={() => setNotice(null)} title={t('windows.clickToDismiss')}>{notice.text}</div>}
          </aside>
          <main className="gc-principal">
            <div className="gc-pestanas">
              {([['cambios', t('windows.changes')], ['historial', t('windows.history')], ['ramas', t('windows.branchesStash')], ['github', 'GitHub'], ['prs', 'Pull requests']] as [ViewGit, string][]).map(([id, txt], i) => (
                <button key={id} className={'gc-pestana' + (v.view === id ? ' activa' : '')} onClick={() => { windowGit.set({ view: id }); SFX.tick(); }} title={`${txt} (${CMD}${i + 1})`}>{txt}{id === 'ramas' && state?.drawer ? <small> · {t('windows.nInTheStash', { n: state.drawer })}</small> : null}</button>
              ))}
              <span className="gc-pestanas-der">
                <button className={'gc-boton' + (parallel ? ' on' : '')} onClick={() => { setParallel(p => { localStorage.setItem('refugio.git.paralelo', p ? '0' : '1'); return !p; }); SFX.toggle(); }} title={t('windows.unifiedOrSideBySide')}>{parallel ? t('windows.sideBySide') : t('windows.unified')}</button>
                <button className="gc-boton" onClick={() => openFiles({ root: path, ...(fileSel && fileSel.letter !== 'D' ? { rel: fileSel.path } : {}) })} title={t('windows.browseAndEditTheFiles')}>{t('windows.files3')}</button>
                {repo && <button className="gc-boton" onClick={() => openTerminalIn('git:' + path, repo.roomId, repo.name, path)} title={t('windows.openAShelterTerminalIn')}>{t('windows.terminal2')}</button>}
              </span>
            </div>
            <div className="gc-vista">
              {v.view === 'cambios' && (fileSel && sel
                ? <DiffFile path={path} file={fileSel} group={sel.group} signature={signature} parallel={parallel} busy={!!busy} apply={applyPatch} stage={stage} remove={remove} discard={discard} open={openFile} notify={notify} />
                : <div className="gd-vacio">{state ? (total ? t('windows.pickAFileOnThe') : t('windows.nothingToShowNoChanges')) : t('windows.readingTheRepo')}</div>)}
              {v.view === 'historial' && <HistoryView path={path} signature={signature} parallel={parallel} notify={notify} />}
              {v.view === 'ramas' && <Branches path={path} state={state} signature={signature} busy={!!busy} act={act} confirm={setConfirm} notify={notify} />}
              {v.view === 'github' && <GitHub notify={notify} />}
              {v.view === 'prs' && <PullRequests notify={notify} />}
            </div>
          </main>
        </div>
      )}
      {confirm && (
        <div className="vt-confirmar" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const c = confirm; setConfirm(null); c.si(); } }}>
          <div className="vt-confirmar-caja">
            <p>{confirm.text}</p>
            <div className="vt-confirmar-botones">
              <button className="consola-x peligro" autoFocus onClick={() => { const c = confirm; setConfirm(null); c.si(); }}>{confirm.button} ({t('windows.enter')})</button>
              <button className="consola-x" onClick={() => { const c = confirm; setConfirm(null); c.no?.(); }}>{t('windows.cancelEsc')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type Make = <T>(name: string, data: Record<string, unknown>, what: string, ok?: string | ((r: T) => string)) => Promise<T | undefined>;

// ---------------------------------------------------------------- rama y sincronización
function Branch({ state, busy, act }: { state: StateGit | null; busy: boolean; act: Make }) {
  if (!state) return <div className="gc-rama tenue">{t('windows.reading')}</div>;
  const withoutRemote = !state.remote.length;
  const sync = !state.upstream ? (state.branch && !withoutRemote ? t('windows.publishRama', { rama: state.branch }) : null) : state.ahead || state.behind ? `${t('windows.sync')}${state.behind ? ` ↓${state.behind}` : ''}${state.ahead ? ` ↑${state.ahead}` : ''}` : null;
  return (
    <div className="gc-rama">
      <span className="gc-rama-nombre" title={state.upstream ? t('windows.tracksUpstream', { upstream: state.upstream }) : withoutRemote ? t('windows.noRemote') : t('windows.noRemoteBranchYet')}>⎇ {state.branch ?? t('windows.detachedHeadHash', { hash: state.head?.slice(0, 7) ?? t('windows.noCommits') })}</span>
      {state.upstream && <span className="gc-ab" title={t('windows.adelanteToPushAtrasTo', { adelante: state.ahead, atras: state.behind, upstream: state.upstream })}>{state.behind ? <i className="baja">↓{state.behind}</i> : null}{state.ahead ? <i className="sube">↑{state.ahead}</i> : null}</span>}
      <span className="gc-fila-botones">
        {!withoutRemote && <button className="gc-boton icono" disabled={busy} onClick={() => act('sincronizar', { what: 'fetch' }, t('windows.fetchingFromTheRemote'), t('windows.remoteUpToDate'))} title={t('windows.fetchGetWhatIsNew')}>⟳</button>}
        {state.upstream && <button className="gc-boton icono" disabled={busy} onClick={() => act('sincronizar', { what: 'pull' }, 'Pull…', t('windows.pullDone'))} title={t('windows.pullDownloadAndMergeWhat')}>↓</button>}
        {!withoutRemote && state.branch && <button className="gc-boton icono" disabled={busy} onClick={() => act('sincronizar', { what: 'push' }, 'Push…', t('windows.pushDone'))} title={state.upstream ? t('windows.pushUploadYourCommits') : t('windows.pushPublishTheBranchTo')}>↑</button>}
      </span>
      {sync && <button className="gc-boton ancho" disabled={busy} onClick={() => act('sincronizar', { what: 'sync' }, t('windows.syncing'), t('windows.synced'))}>{sync}</button>}
    </div>
  );
}

// ---------------------------------------------------------------- la caja del commit
function CommitBox({ path, state, busy, act, notify }: { path: string; state: StateGit | null; busy: boolean; act: Make; notify: (t: string, e?: boolean) => void }) {
  const [msg, setMsg] = useState(() => drafts.get(path) ?? '');
  const [menu, setMenu] = useState(false);
  useEffect(() => { setMsg(drafts.get(path) ?? ''); }, [path]);
  const change = (t: string) => { setMsg(t); drafts.set(path, t); };
  const staged = state?.staged.length ?? 0, changes = (state?.changes.length ?? 0);
  const all = !staged && changes > 0;
  const can = !!state && !busy && !!msg.trim() && (staged > 0 || changes > 0) && !state.conflicts.length;
  const commit = async (o: { amend?: boolean; push?: boolean } = {}) => {
    setMenu(false);
    if (!o.amend && !can) { if (!msg.trim()) notify(t('windows.writeTheCommitMessage'), true); return; }
    const r = await act<{ hash: string }>('commit', { message: msg, amend: !!o.amend, all: all && !o.amend }, o.amend ? t('windows.amending') : t('windows.committing'), x => (o.amend ? t('windows.amendedHash', { hash: x.hash }) : t('windows.committedHash', { hash: x.hash })) + (state?.branch ? ' ' + t('windows.onRama', { rama: state.branch }) : '') + '.');
    if (!r) return;
    change(''); SFX.success();
    if (o.push) await act('sincronizar', { what: 'push' }, 'Push…', t('windows.commitPushed'));
  };
  const undo = async () => { setMenu(false); const r = await act<{ message: string }>('deshacerCommit', {}, t('windows.undoingTheCommit'), t('windows.lastCommitUndoneItsChanges')); if (r?.message && !msg.trim()) change(r.message); };
  return (
    <div className="gc-commit">
      <div className="gc-commit-caja">
        <textarea value={msg} onChange={e => change(e.target.value)} rows={Math.min(8, Math.max(2, msg.split('\n').length))} spellCheck={false}
          placeholder={state?.branch ? t('windows.messageAtajoEnterToCommit', { shortcut: CMD, rama: state.branch }) : t('windows.messageAtajoEnterToCommit2', { shortcut: CMD })}
          onKeyDown={e => { if (e.key === 'Enter' && (MAC ? e.metaKey : e.ctrlKey)) { e.preventDefault(); commit(); } }} />
        <button className="gc-ia" disabled title={t('windows.generateTheMessageWithAi')}>✨</button>
      </div>
      <div className="gc-commit-botones">
        <button className="gc-boton principal ancho" disabled={!can} onClick={() => commit()} title={all ? t('windows.nothingIsStagedEverythingGets') : t('windows.commitTheStagedChangesAtajo', { shortcut: CMD })}>
          ✓ {all ? t('windows.stageAllAndCommit') : 'Commit'}{state?.branch && !all ? <small> {t('windows.onRama', { rama: state.branch })}</small> : null}
        </button>
        <button className="gc-boton icono principal" disabled={busy || !state} onClick={() => setMenu(m => !m)} title={t('windows.moreWaysToCommit')}>▾</button>
        {menu && (
          <div className="gc-menu" onMouseLeave={() => setMenu(false)}>
            <button disabled={!can || !state?.remote.length} onClick={() => commit({ push: true })}>{t('windows.commitAndPush')}</button>
            <button disabled={!state?.head} onClick={() => commit({ amend: true })} title={t('windows.redoTheLastCommitWith')}>{t('windows.amendLastCommit')}</button>
            <button disabled={!state?.head} onClick={undo} title={t('windows.undoesItAndLeavesIts')}>{t('windows.undoLastCommit')}</button>
            {state?.lastMessage && <button onClick={() => { change(state.lastMessage); setMenu(false); }}>{t('windows.copyTheLastCommitMessage')}</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- listas de archivos
function Section({ group, files, folded, fold, sel, pick, stage, remove, discard, open, busy }: {
  group: Group; files: FileGit[]; folded: boolean; fold: () => void; sel: Choice | null; pick: (a: FileGit) => void; busy: boolean;
  stage: (a: FileGit[]) => void; remove: (a: FileGit[]) => void; discard: (a: FileGit[]) => void; open: (a: FileGit) => void;
}) {
  const title = group === 'preparados' ? t('windows.staged') : group === 'conflictos' ? t('windows.conflicts') : t('windows.changes');
  return (
    <section className={'gc-seccion ' + group}>
      <header onClick={fold}>
        <span className="gc-plegar">{folded ? '▸' : '▾'}</span>
        <span className="gc-seccion-titulo">{title}</span>
        <span className="gc-seccion-botones" onClick={e => e.stopPropagation()}>
          {group === 'preparados' && files.length > 0 && <button disabled={busy} onClick={() => remove(files)} title={t('windows.unstageAll')}>−</button>}
          {group === 'cambios' && files.length > 0 && <><button disabled={busy} onClick={() => discard(files)} title={t('windows.discardAllChanges')}>↶</button><button disabled={busy} onClick={() => stage(files)} title={t('windows.stageAll')}>+</button></>}
          {group === 'conflictos' && files.length > 0 && <button disabled={busy} onClick={() => stage(files)} title={t('windows.markAllAsResolvedStage')}>✓</button>}
        </span>
        <span className="gc-cuenta">{files.length}</span>
      </header>
      {!folded && (
        <ul>
          {files.map(a => {
            const parts = a.path.split('/'), name = parts.pop(), folder = parts.join('/');
            const active = sel?.group === group && sel.path === a.path;
            return (
              <li key={a.path} className={active ? 'activa' : ''} onClick={() => pick(a)} onDoubleClick={() => open(a)} ref={el => { if (active) el?.scrollIntoView({ block: 'nearest' }); }} title={`${a.origin ? a.origin + ' → ' : ''}${a.path} · ${LETTER[a.letter] ?? a.letter}`}>
                <span className={'gc-nombre' + (a.letter === 'D' ? ' tachado' : '')}>{name}</span>
                <span className="gc-carpeta">{folder}</span>
                <span className="gc-botones-archivo" onClick={e => e.stopPropagation()}>
                  {a.letter !== 'D' && <button onClick={() => open(a)} title={t('windows.openInTheEditorEnter')}>↗</button>}
                  {group === 'cambios' && <button disabled={busy} onClick={() => discard([a])} title={t('windows.discardTheChangesDel')}>↶</button>}
                  {group === 'preparados' ? <button disabled={busy} onClick={() => remove([a])} title={t('windows.unstageSpace')}>−</button>
                    : <button disabled={busy} onClick={() => stage([a])} title={group === 'conflictos' ? t('windows.markAsResolved') : t('windows.stageSpace')}>{group === 'conflictos' ? '✓' : '+'}</button>}
                </span>
                <span className={'gc-letra l-' + (a.letter === '?' ? 'U' : a.letter)}>{a.letter === '?' ? 'U' : group === 'conflictos' ? '!' : a.letter}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- el diff del archivo elegido
function DiffFile({ path, file, group, signature, parallel, busy, apply, stage, remove, discard, open, notify }: {
  path: string; file: FileGit; group: Group; signature: string; parallel: boolean; busy: boolean; notify: (t: string, e?: boolean) => void;
  apply: (p: string, q: PatchThat, c: string) => void; stage: (a: FileGit[]) => void; remove: (a: FileGit[]) => void; discard: (a: FileGit[]) => void; open: (a: FileGit) => void;
}) {
  const [diff, setDiff] = useState<{ text: string; binary: boolean; truncated: boolean; key: string } | null>(null);
  const [whole, setWhole] = useState(false);
  const key = `${path}|${group}|${file.path}|${whole}`;
  useEffect(() => {
    let live = true;
    client.action<any>('git.diff', { path, file: file.path, origin: file.origin, prepared: group === 'preparados', withoutFollow: file.letter === '?', context: whole ? 100000 : 3 })
      .then(d => { if (live) setDiff(x => (x && x.key === key && x.text === d.text ? x : { ...d, key })); }).catch(e => { if (live) notify(e.message, true); });
    return () => { live = false; };
  }, [key, signature]);
  const mode = group === 'preparados' ? 'preparados' : 'cambios';
  return (
    <div className="gc-diff">
      <div className="gc-diff-cab">
        <span className={'gc-letra l-' + (file.letter === '?' ? 'U' : file.letter)}>{file.letter === '?' ? 'U' : file.letter}</span>
        <span className="gc-diff-ruta">{file.origin ? <><span className="tenue">{file.origin} → </span>{file.path}</> : file.path}</span>
        <span className="tenue">{group === 'preparados' ? t('windows.stagedIndexLastCommit') : group === 'conflictos' ? t('windows.conflicted') : file.letter === '?' ? t('windows.newUntracked') : t('windows.workingCopyStaged')}</span>
        <span className="gc-fila-botones">
          <button className={'gc-boton' + (whole ? ' on' : '')} onClick={() => setWhole(x => !x)} title={t('windows.showTheWholeFileAround')}>{whole ? t('windows.wholeFile') : t('windows.changesOnly')}</button>
          {file.letter !== 'D' && <button className="gc-boton" onClick={() => open(file)}>{t('windows.open2')}</button>}
          {group === 'cambios' && <button className="gc-boton" disabled={busy} onClick={() => discard([file])}>{t('windows.discard2')}</button>}
          {group === 'preparados' ? <button className="gc-boton" disabled={busy} onClick={() => remove([file])}>{t('windows.unstage')}</button>
            : <button className="gc-boton principal" disabled={busy} onClick={() => stage([file])}>{group === 'conflictos' ? t('windows.resolved') : t('windows.stage')}</button>}
        </span>
      </div>
      <div className="gc-diff-cuerpo">
        {diff && diff.key === key ? <DiffViewer text={diff.text} binary={diff.binary} truncated={diff.truncated} mode={group === 'conflictos' ? 'commit' : mode} parallel={parallel} busy={busy} onApply={apply} /> : <div className="gd-vacio">{t('windows.readingTheDiff')}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ramas y cajón
interface BranchGit { name: string; remote: boolean; hash: string; upstream?: string; ahead: number; behind: number; lost: boolean; date: number; current: boolean; subject: string }
function Branches({ path, state, signature, busy, act, confirm, notify }: { path: string; state: StateGit | null; signature: string; busy: boolean; act: Make; confirm: (c: { text: React.ReactNode; button: string; si: () => void }) => void; notify: (t: string, e?: boolean) => void }) {
  const [branches, setBranches] = useState<BranchGit[] | null>(null);
  const [drawer, setDrawer] = useState<{ ref: string; subject: string; date: number }[]>([]);
  const [newBranch, setNew] = useState('');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState('');
  useEffect(() => {
    client.action<BranchGit[]>('git.ramas', { path }).then(setBranches).catch(e => notify(e.message, true));
    client.action<any[]>('git.cajon', { path }).then(setDrawer).catch(() => {});
  }, [path, signature]);
  const q = filter.trim().toLowerCase();
  const local = (branches ?? []).filter(r => !r.remote && (!q || r.name.toLowerCase().includes(q)));
  const remotes = (branches ?? []).filter(r => r.remote && (!q || r.name.toLowerCase().includes(q)));
  const hasChanges = !!state && (state.staged.length + state.changes.length) > 0;
  const create = async () => { if (!newBranch.trim()) return; const r = await act('crearRama', { name: newBranch.trim() }, t('windows.creatingTheBranch'), t('windows.branchNombreCreatedYouAre', { nombre: newBranch.trim() })); if (r !== undefined) setNew(''); };
  const deleteMessage = (r: BranchGit) => confirm({ text: <>{t('windows.deleteTheBranch')} <b>{r.name}</b>?{r.upstream ? '' : ` ${t('windows.itIsNotOnAny')}`}</>, button: t('windows.delete'), si: async () => {
    const ok = await act('borrarRama', { name: r.name }, t('windows.deleting'), t('windows.branchNombreDeleted', { nombre: r.name }));
    if (ok === undefined) confirm({ text: <>{t('windows.theBranch')} <b>{r.name}</b> {t('windows.hasCommitsThatAreOn')}</>, button: t('windows.deleteAnyway'), si: () => act('borrarRama', { name: r.name, force: true }, t('windows.deleting'), t('windows.branchNombreDeleted', { nombre: r.name })) });
  } });
  const row = (r: BranchGit) => (
    <li key={(r.remote ? 'r:' : 'l:') + r.name} className={r.current ? 'actual' : ''}>
      <span className="gr-nombre" title={r.name}>{r.current ? '● ' : ''}{r.name}</span>
      <span className="gr-ab">{r.lost ? <i className="tenue">{t('windows.remoteDeleted')}</i> : <>{r.behind ? <i className="baja">↓{r.behind}</i> : null}{r.ahead ? <i className="sube">↑{r.ahead}</i> : null}</>}</span>
      <span className="gr-asunto" title={r.subject}>{r.subject}</span>
      <span className="tenue gr-cuando">{ago(r.date)}</span>
      <span className="gc-fila-botones">
        {!r.current && <button className="gc-boton" disabled={busy} onClick={() => act('cambiarRama', { branch: r.name, remote: r.remote }, t('windows.switchingBranch'), t('windows.nowOnRama', { rama: r.remote ? r.name.split('/').slice(1).join('/') : r.name }))}>{t('windows.switch')}</button>}
        {!r.current && !r.remote && <button className="gc-boton icono" disabled={busy} onClick={() => deleteMessage(r)} title={t('windows.deleteTheBranch2')}>🗑</button>}
      </span>
    </li>
  );
  return (
    <div className="gr">
      <div className="gc-herramientas">
        <input className="gc-filtro" placeholder={t('windows.filterBranches')} value={filter} onChange={e => setFilter(e.target.value)} />
        <input className="gc-filtro" placeholder={t('windows.newBranchFromHere')} value={newBranch} onChange={e => setNew(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create(); }} />
        <button className="gc-boton principal" disabled={busy || !newBranch.trim()} onClick={create}>{t('windows.createBranch')}</button>
      </div>
      <div className="gr-columnas">
        <section>
          <h4>{t('windows.localBranches')} <span className="tenue">({local.length})</span></h4>
          <ul className="gr-lista">{local.map(row)}{branches && !local.length && <li className="tenue">{t('windows.none')}</li>}</ul>
          {remotes.length > 0 && <><h4>{t('windows.remotes')} <span className="tenue">({remotes.length})</span></h4><ul className="gr-lista">{remotes.map(row)}</ul></>}
        </section>
        <section>
          <h4>{t('windows.stash')} <span className="tenue">(stash · {drawer.length})</span></h4>
          <p className="tenue">{t('windows.setAsideYourHalfDone')}</p>
          <div className="gc-herramientas">
            <input className="gc-filtro" placeholder={t('windows.noteOptional')} value={note} onChange={e => setNote(e.target.value)} />
            <button className="gc-boton principal" disabled={busy || !hasChanges} onClick={async () => { if (await act('cajonGuardar', { message: note.trim() }, t('windows.savingToTheStash'), t('windows.changesSavedToTheStash')) !== undefined) setNote(''); }}>{t('windows.stashChanges')}</button>
          </div>
          <ul className="gr-lista">
            {drawer.map(c => (
              <li key={c.ref}>
                <span className="gr-nombre">{c.ref.replace('stash@', '#').replace(/[{}]/g, '')}</span>
                <span className="gr-asunto" title={c.subject}>{c.subject}</span>
                <span className="tenue gr-cuando">{ago(c.date)}</span>
                <span className="gc-fila-botones">
                  <button className="gc-boton principal" disabled={busy} onClick={() => act('cajonSacar', { ref: c.ref }, t('windows.poppingFromTheStash'), t('windows.changesReturnedToTheWorking'))} title={t('windows.applyItAndRemoveIt')}>{t('windows.pop')}</button>
                  <button className="gc-boton" disabled={busy} onClick={() => act('cajonSacar', { ref: c.ref, keep: true }, t('windows.applying'), t('windows.appliedStillInTheStash'))} title={t('windows.applyItAndKeepIt')}>{t('windows.apply')}</button>
                  <button className="gc-boton icono" disabled={busy} onClick={() => confirm({ text: <>{t('windows.drop')} <b>{c.subject}</b> {t('windows.fromTheStashItWill')}</>, button: t('windows.drop2'), si: () => act('cajonTirar', { ref: c.ref }, t('windows.dropping'), t('windows.dropped')) })} title={t('windows.dropItDrop')}>🗑</button>
                </span>
              </li>
            ))}
            {!drawer.length && <li className="tenue">{t('windows.theStashIsEmpty')}</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
