// Pre-flight of a task: is each of its PRs, in every repo, ready to merge? (model in shared/preflight.ts, data from the
// `preflight.tarea` action): one row per PR with its state, CI, review, conflicts and the PRs it waits for, and the
// merge waves below (merged PRs struck through, a wave all merged ✔), then its production verification plan to approve and
// its checkpoints' states. Clicking a row opens the PR; clicking its blockers, the PR it waits for. Getting ready to push
// (compare, checklist, sync) is not here: the push gate asks for it (gateMissing). Opened from the task's block in the deployment plan, the copy's intercom and ⌘K. A small floating box
// over whatever is open (not a panel): Esc or a click outside closes it and leaves everything underneath as it was.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { client } from '../net/client';
import { SFX } from '../audio/sound';
import { t } from '@shared/language';
import { keyboard } from '../engine/keyboard';
import { Keys, useKeys } from './device';
import { Store } from './store';
import { openLink } from './Browsers';
import { search } from './Search';
import { jiraBoard, useColorsTasks } from './tasks';
import { taskColor, taskKey } from '@shared/tasks';
import { refPR } from '@shared/deploy';
import { linkState, mergeReady, shortRef, type Cell, type PartLink, type PartPreflight, type TaskPreflight } from '@shared/preflight';
import { deadlineOf, isApproved, KIND_TEXT, STATE_TEXT, type CheckpointState, type TaskTracker, type VerificationPlan } from '@shared/verification';
import { describeWhenShort } from '@shared/scheduled';

const MARK: Record<Cell['mark'], string> = { ok: '✓', aviso: '⚠', mal: '✗', nada: '—' };
const READY: Record<ReturnType<typeof mergeReady>['state'], string> = { fusionado: '✔', listo: '✓', aviso: '⚠', falta: '✗' };
const STATE: Record<string, string> = { abierto: 'preflight.blockers.open', borrador: 'preflight.review.draft', fusionado: 'preflight.review.merged', cerrado: 'preflight.sync.closed' };

// the open pre-flight (one at a time) and where it was opened from: the box sits below that, or centred near the top
const open = new Store<{ key: string | null; anchor?: { x: number; y: number; below: number } }>({ key: null });

/** Opens the pre-flight of a task over whatever is open; `desde`: the element it was opened from (the box anchors to it) */
export function openPreflight(key: string, since?: Element | null) {
  const r = since?.getBoundingClientRect();
  open.set({ key: taskKey(key) ?? key, anchor: r ? { x: r.left, y: r.top, below: r.bottom } : undefined });
}
const closePreflight = () => { SFX.close(); open.set({ key: null, anchor: undefined }); };

const openPR = (p: PartPreflight) => { if (p.pr) openLink(p.pr.url); else SFX.notAllowed(); };

function CellView({ c, onClick, title }: { c: Cell; onClick?: () => void; title?: string }) {
  return <td className={'pf-celda pf-' + c.mark} title={title}>
    {onClick ? <button className="pf-boton" onClick={e => { e.stopPropagation(); onClick(); }}><span className="pf-marca">{MARK[c.mark]}</span> {c.text}</button>
      : <><span className="pf-marca">{MARK[c.mark]}</span>{c.text !== MARK[c.mark] ? ' ' + c.text : ''}</>}
  </td>;
}
const linkTitle = (l: PartLink) => l.url ? `${l.ref} · ${l.title ?? ''}\n${linkState(l)}` : `${l.room} · ${linkState(l)}`;

// production verification (shared/verification.ts): the plan the task's dweller proposed, to approve before the merge,
// and each checkpoint's state after it; a signal's where, baseline and evidence in its tooltip
const STATE_MARK: Record<CheckpointState, Cell['mark']> = { 'waiting-deploy': 'nada', live: 'nada', 'waiting-traffic': 'nada', evidenced: 'ok', failed: 'mal', inconclusive: 'aviso' };
const SIGNAL_MARK = { pending: '·', evidenced: '✓', failed: '✗' } as const;
function Verification({ key, plan, tracker, approved, moved }: { key: string; plan?: VerificationPlan; tracker?: TaskTracker; approved: (p: VerificationPlan) => void; moved: (state: string) => void }) {
  const [error, setError] = useState('');
  const [moving, setMoving] = useState(false);
  // the tracker's status: its board's prod-check one (picked in the vault) and, once verified, the workflow's move to done
  const move = () => {
    SFX.click(); setError(''); setMoving(true);
    client.action<{ state: string }>('verificacion.cerrar', { key }).then(x => { SFX.shortSuccess(); moved(x.state); }).catch(e => setError((e as Error).message)).finally(() => setMoving(false));
  };
  const line = tracker && <p className="tenue">{t('verification.tracker', { estado: tracker.state })}{' · '}
    {tracker.test ? t('verification.boardProdCheck', { tablero: tracker.board, prueba: tracker.test }) : t('verification.boardUnset', { tablero: tracker.board })}
    {tracker.move && <> <button className="boton-taller" disabled={moving} onClick={move}>{t('verification.moveDone', { hecho: tracker.done ?? t('verification.doneColumn') })}</button></>}</p>;
  if (!plan) return <>{line}<p className="tenue">{t('verification.none')}</p></>;
  const approve = () => {
    SFX.click(); setError('');
    client.action<VerificationPlan | null>('verificacion.aprobar', { key }).then(p => { if (p) approved(p); }).catch(e => setError((e as Error).message));
  };
  const ok = isApproved(plan);
  return <div className="pf-verificacion">
    <p><b>{t('verification.title')}</b> <span className={ok ? 'pf-ok' : 'pf-aviso'}>· {t(ok ? 'verification.approved' : 'verification.unapproved', { version: plan.version })}</span>
      {!ok && <> <button className="boton-taller" onClick={approve} title={t('verification.approveHint')}>{t('verification.approve')}</button></>}</p>
    {line}
    {error && <p className="aviso-consola" onClick={() => setError('')}>{error}</p>}
    {plan.points.map(c => {
      const deadline = deadlineOf(c);
      return <div key={c.id} className="pf-punto">
        <span className={'pf-' + STATE_MARK[c.state]} title={c.stuck ? t(STATE_TEXT[c.stuck]) : undefined}>{t(STATE_TEXT[c.state])}</span> <b>{c.type === 'final' ? t('verification.final') : c.pr}</b> {c.title !== c.pr ? c.title : ''}
        <span className="tenue">{c.services.length ? ' · ' + t('verification.services', { lista: c.services.map(s => (c.live[s] ? s + ' ✓' : s)).join(', ') }) : ''}
          {' · '}{deadline ? t('verification.deadline', { cuando: describeWhenShort(deadline) }) : t('verification.deadlineHours', { n: c.deadlineHours })}</span>
        {c.note && <div className="tenue">{t('verification.note', { texto: c.note.text })}</div>}
        <ul>{c.signals.map(x => <li key={x.id} className={'pf-' + (x.state === 'evidenced' ? 'ok' : x.state === 'failed' ? 'mal' : 'nada')}
          title={[t('verification.where', { donde: x.where }), ...(x.base ? [t('verification.baseline', { base: x.base })] : []), ...(x.evidence ? [t('verification.evidence', { texto: x.evidence.text })] : [])].join('\n')}>
          {SIGNAL_MARK[x.state]} <span className="tenue">{t(KIND_TEXT[x.type])}:</span> <span className="pf-senal">{x.what}</span></li>)}</ul>
      </div>;
    })}
  </div>;
}

/** Mounted once (main.tsx): the box, when a pre-flight is open */
export function PreflightPopover() {
  const { key, anchor } = open.use(e => e);
  return key ? <Popover key={key} taskKey={key} anchor={anchor} /> : null;
}

function Popover({ taskKey: key, anchor }: { taskKey: string; anchor?: { x: number; y: number; below: number } }) {
  const [r, setR] = useState<TaskPreflight | null>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [i, setI] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<React.CSSProperties | undefined>(undefined);
  const tareas = jiraBoard.use(x => x.tareas);
  useColorsTasks();
  const load = (force = false) => {
    setReading(true); setError('');
    client.action<TaskPreflight>('preflight.tarea', { key, force }).then(setR).catch(e => setError((e as Error).message)).finally(() => setReading(false));
  };
  useEffect(() => { SFX.open(); load(); }, []);
  // back in the window (from GitHub), the latest: a review or a merge changes the row
  useEffect(() => { const f = () => { if (document.visibilityState === 'visible') load(); }; addEventListener('focus', f); return () => removeEventListener('focus', f); }, []);
  // the game's keys are ignored while typing in a field (the intercom's): the box takes the focus while open and gives
  // it back on close; the Overseer doesn't walk, and what was blocked before stays blocked
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null, blocked = keyboard.blocked;
    before?.blur?.(); box.current?.focus({ preventScroll: true }); keyboard.blocked = true;
    return () => { keyboard.blocked = blocked; if (before?.isConnected) before.focus?.({ preventScroll: true }); };
  }, []);
  // ⌘K over it: the search goes on top, so the box closes
  useEffect(() => search.subscribe(() => { if (search.get().open) open.set({ key: null, anchor: undefined }); }), []);
  // below what it was opened from (above it if it doesn't fit), inside the screen
  useLayoutEffect(() => {
    const b = box.current; if (!b || !anchor) return;
    const w = b.offsetWidth, h = b.offsetHeight, m = 8;
    const top = anchor.below + 6 + h <= innerHeight - m ? anchor.below + 6 : Math.max(m, anchor.y - 6 - h);
    setSpot({ left: Math.min(Math.max(m, anchor.x), innerWidth - w - m), top, transform: 'none' });
  }, [anchor, r, error]);

  // the PRs, in merge order (the order of the waves), then the rest
  const orden = r?.waves.flat() ?? [];
  const wave = (p: PartPreflight) => { const n = orden.indexOf(refPR(p.pr!)); return n < 0 ? 999 : n; };
  const prs = (r?.parts ?? []).filter(p => p.pr).sort((a, b) => wave(a) - wave(b));
  const withoutPR = (r?.parts ?? []).filter(p => !p.pr).map(p => p.room ?? p.repo?.split('/').pop() ?? '?');
  const k = Math.min(i, Math.max(0, prs.length - 1)), sel = prs[k];
  useKeys(e => {
    if (e.metaKey || e.ctrlKey) return false;
    if (e.code === 'Escape') closePreflight();
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(Math.min(k + 1, Math.max(0, prs.length - 1))); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(Math.max(0, k - 1)); SFX.tick(); }
    else if ((e.code === 'Enter' || e.code === 'KeyO') && sel) openPR(sel);
    else if (e.code === 'KeyR') { load(true); SFX.click(); }
  }, [prs, k, sel], true);   // on top: the board underneath registers its keys again on each render

  const title = r?.title ?? tareas?.find(x => x.key === key)?.title;
  const color = r?.color ?? taskColor(key);
  const byRef = new Map(prs.map(p => [refPR(p.pr!), mergeReady(p).state]));
  const allMerged = prs.length > 0 && prs.every(p => p.pr!.state === 'fusionado') && !withoutPR.length;
  return <>
    {/* a click outside only closes it: the whole click (down, up) lands on the veil, nothing underneath gets it */}
    <div className="pf-velo interactivo" onPointerDown={e => { e.preventDefault(); e.stopPropagation(); }} onClick={e => { e.stopPropagation(); closePreflight(); }} />
    <div ref={box} className="pf-caja interactivo" role="dialog" aria-label={`${t('preflight.title')} ${key}`} tabIndex={-1} style={{ ...spot, '--tarea': color } as React.CSSProperties}>
      <div className="pf-titulo">
        <span className="marca-tarea" /><b>✈ {key}</b>{title ? <span className="tenue"> · {title}</span> : null}{r?.demo ? <span className="tenue"> · DEMO</span> : null}
        <button className="consola-x" onClick={closePreflight} title={t('panels.closeEsc')}>Esc</button>
      </div>
      {error && <p className="aviso-consola" onClick={() => setError('')}>{error}</p>}
      {r?.error && <p className="tenue">{r.error}</p>}
      {!r && !error && <p className="tenue">{t('preflight.reading')}</p>}
      {r && reading && <p className="tenue">{t('panels.syncingWithGithub')}</p>}
      {r && !prs.length && <p className="tenue">{t('preflight.noPRs', { clave: key })}</p>}
      {prs.length > 0 && <div className="pf-lista"><table className="pf-tabla">
        <thead><tr>
          <th /><th>{t('preflight.col.pr')}</th><th>{t('preflight.col.state')}</th><th>{t('preflight.col.ci')}</th><th>{t('preflight.col.review')}</th>
          <th>{t('preflight.col.conflicts')}</th><th>{t('preflight.col.blockers')}</th>
        </tr></thead>
        <tbody>{prs.map((p, n) => {
          const pr = p.pr!, ready = mergeReady(p);
          const blocker = p.waitsOn.find(l => l.state !== 'fusionado' && l.url);
          return <tr key={p.id} className={'pf-fila' + (n === k ? ' sel' : '') + (ready.state === 'fusionado' ? ' pf-hecha' : '')} onMouseEnter={() => setI(n)} onClick={() => openPR(p)} title={t('preflight.cellHint.pr')}>
            <td className={'pf-estado pf-' + ready.state} title={ready.missing.join('\n') || t(ready.state === 'fusionado' ? 'preflight.review.merged' : 'preflight.state.listo')}>{READY[ready.state]}</td>
            <td className="pf-parte" title={`${shortRef(pr)} · ${pr.title}\n${t('preflight.cellHint.pr')}`}><span className="ident">{shortRef(pr)}</span> {pr.title}</td>
            <td className={'pf-celda pf-' + (pr.state === 'borrador' ? 'aviso' : 'nada')}>{t(STATE[pr.state])}</td>
            <CellView c={p.ci} />
            <CellView c={p.review} />
            <CellView c={p.conflicts} />
            <CellView c={p.blockers} onClick={blocker?.url ? () => openLink(blocker.url!) : undefined} title={[...(blocker?.url ? [t('preflight.cellHint.blocker')] : []), ...p.waitsOn.map(linkTitle)].join('\n') || undefined} />
          </tr>;
        })}</tbody>
      </table></div>}
      {r && withoutPR.length > 0 && <p className="tenue">{t('preflight.withoutPR', { salas: [...new Set(withoutPR)].join(', ') })}</p>}
      {r && r.waves.length > 0 && <p className="orden-despliegue"><b>{t('preflight.waves')}</b> {r.waves.map((o, n) => {
        const done = o.every(x => byRef.get(x) === 'fusionado');
        return <span key={n} className={done ? 'pf-ola-hecha' : undefined}>{n > 0 && ' → '}<b>{n + 1}{done ? ' ✔' : ''}</b> {o.map((x, j) => {
          const e = byRef.get(x);
          return <span key={x} className={e === 'fusionado' ? 'pf-hecha' : e === 'listo' ? 'pf-listo' : ''}>{j > 0 && ', '}{x.replace(/^[^/]+\//, '')}{e === 'listo' ? ' ✓' : ''}</span>;
        })}</span>;
      })}</p>}
      {allMerged && <p className="pf-aterrizada">✔ {t('preflight.landed')}</p>}
      {r && <Verification key={key} plan={r.verification} tracker={r.tracker} approved={p => setR({ ...r, verification: p })} moved={state => setR({ ...r, tracker: r.tracker && { ...r.tracker, state, move: false } })} />}
      {r && r.cycle.length > 0 && <p className="aviso-consola">{t('preflight.cycle')} {r.cycle.map(x => x.replace(/^[^/]+\//, '')).join(', ')}</p>}
      <Keys><kbd>↑↓</kbd>{t('preflight.keys.row')} <kbd>Enter</kbd>{t('preflight.keys.pr')} <kbd>R</kbd>{t('panels.reload')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </div>
  </>;
}
