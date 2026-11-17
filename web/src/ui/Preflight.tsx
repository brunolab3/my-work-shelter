// Pre-flight of a task: is each of its PRs, in every repo, ready to merge? (model in shared/preflight.ts, data from the
// `preflight.tarea` action): one row per PR with its state, CI, review, conflicts and the PRs it waits for, and the
// merge waves below (merged PRs struck through, a wave all merged ✔), then its production verification plan to approve and
// its checkpoints' states. Clicking a row opens the PR; clicking its blockers, the PR it waits for. Getting ready to push
// (compare, checklist, sync) is not here: the push gate asks for it (gateMissing). Opened from the task's block in the deployment plan, the copy's intercom and ⌘K. A small floating box
// over whatever is open (not a panel): Esc or a click outside closes it and leaves everything underneath as it was.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cliente } from '../net/client';
import { SFX } from '../audio/sound';
import { t } from '@shared/language';
import { teclado } from '../engine/keyboard';
import { Keys, useKeys } from './device';
import { Store } from './store';
import { openLink } from './Browsers';
import { buscador } from './Search';
import { jiraBoard, useColorsTasks } from './tasks';
import { taskColor, taskKey } from '@shared/tasks';
import { refPR } from '@shared/deploy';
import { linkState, mergeReady, shortRef, type Cell, type PartLink, type PartPreflight, type TaskPreflight } from '@shared/preflight';
import { deadlineOf, isApproved, KIND_TEXT, STATE_TEXT, type CheckpointState, type TaskTracker, type VerificationPlan } from '@shared/verification';
import { describeWhenShort } from '@shared/scheduled';

const MARK: Record<Cell['marca'], string> = { ok: '✓', aviso: '⚠', mal: '✗', nada: '—' };
const READY: Record<ReturnType<typeof mergeReady>['estado'], string> = { fusionado: '✔', listo: '✓', aviso: '⚠', falta: '✗' };
const STATE: Record<string, string> = { abierto: 'preflight.blockers.open', borrador: 'preflight.review.draft', fusionado: 'preflight.review.merged', cerrado: 'preflight.sync.closed' };

// the open pre-flight (one at a time) and where it was opened from: the box sits below that, or centred near the top
const abierto = new Store<{ clave: string | null; ancla?: { x: number; y: number; abajo: number } }>({ clave: null });

/** Opens the pre-flight of a task over whatever is open; `desde`: the element it was opened from (the box anchors to it) */
export function openPreflight(clave: string, desde?: Element | null) {
  const r = desde?.getBoundingClientRect();
  abierto.set({ clave: taskKey(clave) ?? clave, ancla: r ? { x: r.left, y: r.top, abajo: r.bottom } : undefined });
}
const closePreflight = () => { SFX.cerrar(); abierto.set({ clave: null, ancla: undefined }); };

const openPR = (p: PartPreflight) => { if (p.pr) openLink(p.pr.url); else SFX.noAllowed(); };

function Celda({ c, onClick, title }: { c: Cell; onClick?: () => void; title?: string }) {
  return <td className={'pf-celda pf-' + c.marca} title={title}>
    {onClick ? <button className="pf-boton" onClick={e => { e.stopPropagation(); onClick(); }}><span className="pf-marca">{MARK[c.marca]}</span> {c.texto}</button>
      : <><span className="pf-marca">{MARK[c.marca]}</span>{c.texto !== MARK[c.marca] ? ' ' + c.texto : ''}</>}
  </td>;
}
const linkTitle = (l: PartLink) => l.url ? `${l.ref} · ${l.titulo ?? ''}\n${linkState(l)}` : `${l.sala} · ${linkState(l)}`;

// production verification (shared/verification.ts): the plan the task's dweller proposed, to approve before the merge,
// and each checkpoint's state after it; a signal's where, baseline and evidence in its tooltip
const STATE_MARK: Record<CheckpointState, Cell['marca']> = { 'waiting-deploy': 'nada', live: 'nada', 'waiting-traffic': 'nada', evidenced: 'ok', failed: 'mal', inconclusive: 'aviso' };
const SIGNAL_MARK = { pending: '·', evidenced: '✓', failed: '✗' } as const;
function Verification({ clave, plan, tracker, aprobado, movida }: { clave: string; plan?: VerificationPlan; tracker?: TaskTracker; aprobado: (p: VerificationPlan) => void; movida: (estado: string) => void }) {
  const [error, setError] = useState('');
  const [moviendo, setMoving] = useState(false);
  // the tracker's status: its board's prod-check one (picked in the vault) and, once verified, the workflow's move to done
  const mover = () => {
    SFX.clic(); setError(''); setMoving(true);
    cliente.accion<{ estado: string }>('verificacion.cerrar', { clave }).then(x => { SFX.shortSuccess(); movida(x.estado); }).catch(e => setError((e as Error).message)).finally(() => setMoving(false));
  };
  const linea = tracker && <p className="tenue">{t('verification.tracker', { estado: tracker.estado })}{' · '}
    {tracker.prueba ? t('verification.boardProdCheck', { tablero: tracker.tablero, prueba: tracker.prueba }) : t('verification.boardUnset', { tablero: tracker.tablero })}
    {tracker.mover && <> <button className="boton-taller" disabled={moviendo} onClick={mover}>{t('verification.moveDone', { hecho: tracker.hecho ?? t('verification.doneColumn') })}</button></>}</p>;
  if (!plan) return <>{linea}<p className="tenue">{t('verification.none')}</p></>;
  const aprobar = () => {
    SFX.clic(); setError('');
    cliente.accion<VerificationPlan | null>('verificacion.aprobar', { clave }).then(p => { if (p) aprobado(p); }).catch(e => setError((e as Error).message));
  };
  const ok = isApproved(plan);
  return <div className="pf-verificacion">
    <p><b>{t('verification.title')}</b> <span className={ok ? 'pf-ok' : 'pf-aviso'}>· {t(ok ? 'verification.approved' : 'verification.unapproved', { version: plan.version })}</span>
      {!ok && <> <button className="boton-taller" onClick={aprobar} title={t('verification.approveHint')}>{t('verification.approve')}</button></>}</p>
    {linea}
    {error && <p className="aviso-consola" onClick={() => setError('')}>{error}</p>}
    {plan.puntos.map(c => {
      const plazo = deadlineOf(c);
      return <div key={c.id} className="pf-punto">
        <span className={'pf-' + STATE_MARK[c.estado]} title={c.atascado ? t(STATE_TEXT[c.atascado]) : undefined}>{t(STATE_TEXT[c.estado])}</span> <b>{c.tipo === 'final' ? t('verification.final') : c.pr}</b> {c.titulo !== c.pr ? c.titulo : ''}
        <span className="tenue">{c.servicios.length ? ' · ' + t('verification.services', { lista: c.servicios.map(s => (c.vivos[s] ? s + ' ✓' : s)).join(', ') }) : ''}
          {' · '}{plazo ? t('verification.deadline', { cuando: describeWhenShort(plazo) }) : t('verification.deadlineHours', { n: c.plazoHoras })}</span>
        {c.nota && <div className="tenue">{t('verification.note', { texto: c.nota.texto })}</div>}
        <ul>{c.señales.map(x => <li key={x.id} className={'pf-' + (x.estado === 'evidenced' ? 'ok' : x.estado === 'failed' ? 'mal' : 'nada')}
          title={[t('verification.where', { donde: x.donde }), ...(x.base ? [t('verification.baseline', { base: x.base })] : []), ...(x.evidencia ? [t('verification.evidence', { texto: x.evidencia.texto })] : [])].join('\n')}>
          {SIGNAL_MARK[x.estado]} <span className="tenue">{t(KIND_TEXT[x.tipo])}:</span> <span className="pf-senal">{x.que}</span></li>)}</ul>
      </div>;
    })}
  </div>;
}

/** Mounted once (main.tsx): the box, when a pre-flight is open */
export function PreflightPopover() {
  const { clave, ancla } = abierto.usar(e => e);
  return clave ? <Popover key={clave} clave={clave} ancla={ancla} /> : null;
}

function Popover({ clave, ancla }: { clave: string; ancla?: { x: number; y: number; abajo: number } }) {
  const [r, setR] = useState<TaskPreflight | null>(null);
  const [error, setError] = useState('');
  const [leyendo, setReading] = useState(false);
  const [i, setI] = useState(0);
  const caja = useRef<HTMLDivElement>(null);
  const [sitio, setSitio] = useState<React.CSSProperties | undefined>(undefined);
  const tareas = jiraBoard.usar(x => x.tareas);
  useColorsTasks();
  const cargar = (forzar = false) => {
    setReading(true); setError('');
    cliente.accion<TaskPreflight>('preflight.tarea', { clave, forzar }).then(setR).catch(e => setError((e as Error).message)).finally(() => setReading(false));
  };
  useEffect(() => { SFX.abrir(); cargar(); }, []);
  // back in the window (from GitHub), the latest: a review or a merge changes the row
  useEffect(() => { const f = () => { if (document.visibilityState === 'visible') cargar(); }; addEventListener('focus', f); return () => removeEventListener('focus', f); }, []);
  // the game's keys are ignored while typing in a field (the intercom's): the box takes the focus while open and gives
  // it back on close; the Overseer doesn't walk, and what was blocked before stays blocked
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null, bloqueado = teclado.bloqueado;
    antes?.blur?.(); caja.current?.focus({ preventScroll: true }); teclado.bloqueado = true;
    return () => { teclado.bloqueado = bloqueado; if (antes?.isConnected) antes.focus?.({ preventScroll: true }); };
  }, []);
  // ⌘K over it: the search goes on top, so the box closes
  useEffect(() => buscador.subscribe(() => { if (buscador.get().abierto) abierto.set({ clave: null, ancla: undefined }); }), []);
  // below what it was opened from (above it if it doesn't fit), inside the screen
  useLayoutEffect(() => {
    const b = caja.current; if (!b || !ancla) return;
    const w = b.offsetWidth, h = b.offsetHeight, m = 8;
    const top = ancla.abajo + 6 + h <= innerHeight - m ? ancla.abajo + 6 : Math.max(m, ancla.y - 6 - h);
    setSitio({ left: Math.min(Math.max(m, ancla.x), innerWidth - w - m), top, transform: 'none' });
  }, [ancla, r, error]);

  // the PRs, in merge order (the order of the waves), then the rest
  const orden = r?.olas.flat() ?? [];
  const ola = (p: PartPreflight) => { const n = orden.indexOf(refPR(p.pr!)); return n < 0 ? 999 : n; };
  const prs = (r?.partes ?? []).filter(p => p.pr).sort((a, b) => ola(a) - ola(b));
  const sinPR = (r?.partes ?? []).filter(p => !p.pr).map(p => p.sala ?? p.repo?.split('/').pop() ?? '?');
  const k = Math.min(i, Math.max(0, prs.length - 1)), sel = prs[k];
  useKeys(e => {
    if (e.metaKey || e.ctrlKey) return false;
    if (e.code === 'Escape') closePreflight();
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(Math.min(k + 1, Math.max(0, prs.length - 1))); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(Math.max(0, k - 1)); SFX.tick(); }
    else if ((e.code === 'Enter' || e.code === 'KeyO') && sel) openPR(sel);
    else if (e.code === 'KeyR') { cargar(true); SFX.clic(); }
  }, [prs, k, sel], true);   // on top: the board underneath registers its keys again on each render

  const titulo = r?.titulo ?? tareas?.find(x => x.clave === clave)?.titulo;
  const color = r?.color ?? taskColor(clave);
  const porRef = new Map(prs.map(p => [refPR(p.pr!), mergeReady(p).estado]));
  const todoFusionado = prs.length > 0 && prs.every(p => p.pr!.estado === 'fusionado') && !sinPR.length;
  return <>
    {/* a click outside only closes it: the whole click (down, up) lands on the veil, nothing underneath gets it */}
    <div className="pf-velo interactivo" onPointerDown={e => { e.preventDefault(); e.stopPropagation(); }} onClick={e => { e.stopPropagation(); closePreflight(); }} />
    <div ref={caja} className="pf-caja interactivo" role="dialog" aria-label={`${t('preflight.title')} ${clave}`} tabIndex={-1} style={{ ...sitio, '--tarea': color } as React.CSSProperties}>
      <div className="pf-titulo">
        <span className="marca-tarea" /><b>✈ {clave}</b>{titulo ? <span className="tenue"> · {titulo}</span> : null}{r?.demo ? <span className="tenue"> · DEMO</span> : null}
        <button className="consola-x" onClick={closePreflight} title={t('panels.closeEsc')}>Esc</button>
      </div>
      {error && <p className="aviso-consola" onClick={() => setError('')}>{error}</p>}
      {r?.error && <p className="tenue">{r.error}</p>}
      {!r && !error && <p className="tenue">{t('preflight.reading')}</p>}
      {r && leyendo && <p className="tenue">{t('panels.syncingWithGithub')}</p>}
      {r && !prs.length && <p className="tenue">{t('preflight.noPRs', { clave })}</p>}
      {prs.length > 0 && <div className="pf-lista"><table className="pf-tabla">
        <thead><tr>
          <th /><th>{t('preflight.col.pr')}</th><th>{t('preflight.col.state')}</th><th>{t('preflight.col.ci')}</th><th>{t('preflight.col.review')}</th>
          <th>{t('preflight.col.conflicts')}</th><th>{t('preflight.col.blockers')}</th>
        </tr></thead>
        <tbody>{prs.map((p, n) => {
          const pr = p.pr!, listo = mergeReady(p);
          const bloqueo = p.esperaA.find(l => l.estado !== 'fusionado' && l.url);
          return <tr key={p.id} className={'pf-fila' + (n === k ? ' sel' : '') + (listo.estado === 'fusionado' ? ' pf-hecha' : '')} onMouseEnter={() => setI(n)} onClick={() => openPR(p)} title={t('preflight.cellHint.pr')}>
            <td className={'pf-estado pf-' + listo.estado} title={listo.falta.join('\n') || t(listo.estado === 'fusionado' ? 'preflight.review.merged' : 'preflight.state.listo')}>{READY[listo.estado]}</td>
            <td className="pf-parte" title={`${shortRef(pr)} · ${pr.titulo}\n${t('preflight.cellHint.pr')}`}><span className="ident">{shortRef(pr)}</span> {pr.titulo}</td>
            <td className={'pf-celda pf-' + (pr.estado === 'borrador' ? 'aviso' : 'nada')}>{t(STATE[pr.estado])}</td>
            <Celda c={p.ci} />
            <Celda c={p.revision} />
            <Celda c={p.conflictos} />
            <Celda c={p.bloqueos} onClick={bloqueo?.url ? () => openLink(bloqueo.url!) : undefined} title={[...(bloqueo?.url ? [t('preflight.cellHint.blocker')] : []), ...p.esperaA.map(linkTitle)].join('\n') || undefined} />
          </tr>;
        })}</tbody>
      </table></div>}
      {r && sinPR.length > 0 && <p className="tenue">{t('preflight.withoutPR', { salas: [...new Set(sinPR)].join(', ') })}</p>}
      {r && r.olas.length > 0 && <p className="orden-despliegue"><b>{t('preflight.waves')}</b> {r.olas.map((o, n) => {
        const hecha = o.every(x => porRef.get(x) === 'fusionado');
        return <span key={n} className={hecha ? 'pf-ola-hecha' : undefined}>{n > 0 && ' → '}<b>{n + 1}{hecha ? ' ✔' : ''}</b> {o.map((x, j) => {
          const e = porRef.get(x);
          return <span key={x} className={e === 'fusionado' ? 'pf-hecha' : e === 'listo' ? 'pf-listo' : ''}>{j > 0 && ', '}{x.replace(/^[^/]+\//, '')}{e === 'listo' ? ' ✓' : ''}</span>;
        })}</span>;
      })}</p>}
      {todoFusionado && <p className="pf-aterrizada">✔ {t('preflight.landed')}</p>}
      {r && <Verification clave={clave} plan={r.verificacion} tracker={r.tracker} aprobado={p => setR({ ...r, verificacion: p })} movida={estado => setR({ ...r, tracker: r.tracker && { ...r.tracker, estado, mover: false } })} />}
      {r && r.ciclo.length > 0 && <p className="aviso-consola">{t('preflight.cycle')} {r.ciclo.map(x => x.replace(/^[^/]+\//, '')).join(', ')}</p>}
      <Keys><kbd>↑↓</kbd>{t('preflight.keys.row')} <kbd>Enter</kbd>{t('preflight.keys.pr')} <kbd>R</kbd>{t('panels.reload')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </div>
  </>;
}
