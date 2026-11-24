// Tablero de despliegue de la sala de planificación: tus PR por estado (borrador, en revisión, piden cambios, aprobado,
// fusionado), los bloqueos entre ellos con flechas (apilados, «depends on #12» en la descripción, el orden del plan
// repartido de su tarea o marcados aquí con B), los PR de una misma tarea en otros repos enlazados sin orden y el orden en que se pueden fusionar y desplegar (shared/deploy.ts). P le pide el plan al habitante de la sala.
// Abre al momento con lo último que se leyó (guardado en la página) y lo pone al día por detrás.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { live, client } from '../net/client';
import { SFX } from '../audio/sound';
import { t, tIs } from '@shared/language';
import { Device, Keys, closePanel, useKeys } from './device';
import { goA } from './Panels';
import { openLink } from './Browsers';
import { type PRBoard } from '@shared/board';
import { trTextPR } from './Operations';
import { openPreflight } from './Preflight';
import { taskColor, pRTask } from '@shared/tasks';
import { knowTasks, useColorsTasks, verificationMark } from './tasks';
import { ledgerPending, type ReviewLedger } from '@shared/reviewCount';
import { DEPLOYMENT_COLUMNS, blockersBetween, deploymentColumn, taskLinks, deployWaves, promptDeployment, refPR, type Blocker, type BlockerManual, type TaskOrder } from '@shared/deploy';

const REASON: Record<Blocker['reason'], string> = { pila: 'apilado', texto: 'lo dice el PR', plan: 'el plan de la tarea', manual: 'marcado aquí' };
type DataGH = { prs: PRBoard[]; demo?: boolean; error?: string };
interface Memory { gh?: DataGH; manual?: BlockerManual[]; orden?: TaskOrder[] }
const MEMORY = 'refugio:despliegue';
let memory: Memory = (() => { try { return JSON.parse(localStorage.getItem(MEMORY) || '{}'); } catch { return {}; } })();
function remember(r: Memory) { memory = { ...memory, ...r }; try { localStorage.setItem(MEMORY, JSON.stringify(memory)); } catch {} }

const short = (p: PRBoard) => `${p.repo.split('/').pop()}#${p.number}`;

// lo que queda por contestar en sus revisiones (hilos sin resolver, resúmenes sin respuesta); sin nada, no se pinta
function Ledger({ l }: { l: ReviewLedger }) {
  const parts = [l.unresolved > 0 && `💬 ${t('panels.ledgerThreads', { n: l.unresolved })}`, l.unansweredSummaries > 0 && `✉ ${t('panels.ledgerSummaries', { n: l.unansweredSummaries })}`].filter(Boolean);
  return <small className="espera" title={t('panels.ledgerTitle', { hilos: l.unresolved, viejos: l.outdated, resumenes: l.unansweredSummaries })}>{parts.join(' · ')}</small>;
}

// en cada columna, los PR de una misma tarea juntos, en un bloque: la tarea va donde va su mejor PR (la primera ola o el
// más reciente) y dentro, en el orden de la columna
function byTask(list: PRBoard[]): PRBoard[] {
  const groups = new Map<string, PRBoard[]>();
  for (const p of list) { const k = pRTask(p); (groups.get(k) ?? groups.set(k, []).get(k)!).push(p); }
  return [...groups.values()].flat();
}
const blocks = (list: PRBoard[]) => list.reduce<{ task: string; prs: PRBoard[] }[]>((out, p) => {
  const k = pRTask(p), ult = out[out.length - 1];
  if (ult?.task === k) ult.prs.push(p); else out.push({ task: k, prs: [p] });
  return out;
}, []);

export function DeploymentBoard({ roomId, goBack }: { roomId: string; goBack: () => void }) {
  const room = live.use(e => e.state?.rooms?.find((s: any) => s.id === roomId));
  const dweller = live.use(e => (e.state?.dwellers ?? []).find((h: any) => h.roomId === roomId));
  live.use(e => e.verifications);   // the merged cards' 🔭 mark follows the verification
  const [gh, setGh] = useState<DataGH | null>(memory.gh ?? null);
  const [manual, setManual] = useState<BlockerManual[]>(memory.manual ?? []);
  const [orden, setOrder] = useState<TaskOrder[]>(memory.orden ?? []);
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState('');
  const [showMerged, setShowMerged] = useState(true);
  const [col, setCol] = useState(0); const [i, setI] = useState(0);
  const [marking, setMarking] = useState<string | null>(null);   // el PR que espera: se elige a cuál
  const load = () => {
    setReading(true);
    // con error, se queda lo que había (y se dice por qué no está al día)
    client.action<DataGH>('git.prsBoard', {}).then(g => { setGh(g); if (!g.error) remember({ gh: g }); })
      .catch(e => setGh(v => ({ prs: v?.prs ?? [], demo: v?.demo, error: e.message }))).finally(() => setReading(false));
    client.action<BlockerManual[]>('deploy.blockers').then(m => { setManual(m); remember({ manual: m }); }).catch(() => {});
    client.action<TaskOrder[]>('deploy.order').then(o => { setOrder(o); remember({ orden: o }); }).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const prs = useMemo(() => gh?.prs ?? [], [gh]);
  useColorsTasks();
  useEffect(() => knowTasks(prs.map(pRTask)), [prs]);
  const blockers = useMemo(() => blockersBetween(prs, manual, orden), [prs, manual, orden]);
  const links = useMemo(() => taskLinks(prs, blockers), [prs, blockers]);
  const { waves, cycle } = useMemo(() => deployWaves(prs, blockers), [prs, blockers]);
  const wave = useMemo(() => new Map(waves.flatMap((o, k) => o.map(p => [p.url, k + 1] as const))), [waves]);
  const byUrl = useMemo(() => new Map(prs.map(p => [p.url, p])), [prs]);
  const columns = DEPLOYMENT_COLUMNS.filter(c => showMerged || c.id !== 'fusionado')
    .map(c => ({ ...c, prs: byTask(prs.filter(p => deploymentColumn(p) === c.id).sort((a, b) => (wave.get(a.url) ?? 99) - (wave.get(b.url) ?? 99) || b.updated - a.updated)) }));
  const sel: PRBoard | undefined = columns[col]?.prs[Math.min(i, (columns[col]?.prs.length ?? 1) - 1)];
  const waitA = (u: string) => blockers.filter(b => b.from === u);
  const blocksOf = (u: string) => blockers.filter(b => b.by === u);

  const mark = async (from: string, by: string) => {
    setMarking(null);
    if (from === by) return;
    const already = manual.some(b => b.from === from && b.by === by);
    try { const m = await client.action<BlockerManual[]>('deploy.block', { from, by, remove: already }); setManual(m); remember({ manual: m }); SFX.toggle(); dispatchEvent(new Event('refugio:despliegue')); }
    catch (e) { setNotice((e as Error).message); SFX.notAllowed(); }
  };
  const removeManual = async (from: string) => {
    let l = manual;
    for (const b of manual.filter(b => b.from === from)) l = await client.action<BlockerManual[]>('deploy.block', { from, by: b.by, remove: true }).catch(() => l);
    setManual(l); remember({ manual: l }); SFX.toggle(); dispatchEvent(new Event('refugio:despliegue'));
  };
  // the pre-flight of a PR's task: a box over the board, anchored to what opened it (the selected card, with F)
  const preflight = (task: string, since?: Element | null) => { SFX.click(); openPreflight(task, since); };
  const selCard = () => sel && canvas.current?.querySelector(`[data-pr="${CSS.escape(sel.url)}"]`);
  const askPlan = () => {
    if (!dweller) { setNotice(t('panels.salaHasNoDweller', { sala: room?.name ?? t('panels.theRoom') })); SFX.notAllowed(); return; }
    if (!prs.some(p => p.state === 'abierto' || p.state === 'borrador')) { setNotice(t('panels.youHaveNoPullRequests')); SFX.notAllowed(); return; }
    client.send({ t: 'start', dwellerId: dweller.id, roomId, prompt: promptDeployment(prs, blockers), options: { permissions: 'plan' } });
    SFX.shortSuccess(); closePanel(); goA(roomId, dweller.id, true);
  };

  useKeys(e => {
    if (e.code === 'Escape') { if (marking) { setMarking(null); SFX.close(); } else goBack(); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { setCol(c => Math.min(columns.length - 1, c + 1)); setI(0); SFX.tick(); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { setCol(c => Math.max(0, c - 1)); setI(0); SFX.tick(); }
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(x => Math.min(x + 1, Math.max(0, (columns[col]?.prs.length ?? 1) - 1))); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(x => Math.max(0, x - 1)); SFX.tick(); }
    else if (e.code === 'Enter' || e.code === 'KeyE' || e.code === 'KeyB') { if (marking && sel) mark(marking, sel.url); else if (e.code === 'KeyB' && sel) { setMarking(sel.url); SFX.click(); } else if (sel) openLink(sel.url); }
    else if (e.code === 'KeyX' && sel) removeManual(sel.url);
    else if (e.code === 'KeyH') { setShowMerged(x => !x); setCol(0); setI(0); SFX.toggle(); }
    else if (e.code === 'KeyR') { load(); SFX.click(); }
    else if (e.code === 'KeyP') askPlan();
    else if (e.code === 'KeyF' && sel) preflight(pRTask(sel), selCard());
  }, [columns, col, i, sel, marking, manual, prs, blockers, dweller]);

  // flechas: del PR que bloquea al que espera, medidas sobre las fichas ya pintadas
  const canvas = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState<{ d: string; b: Blocker; active: boolean }[]>([]);
  useLayoutEffect(() => {
    const box = canvas.current; if (!box) return;
    const measure = () => {
      const r0 = box.getBoundingClientRect();
      const rect = (u: string) => { const el = box.querySelector<HTMLElement>(`[data-pr="${CSS.escape(u)}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return { x0: r.left - r0.left + box.scrollLeft, x1: r.right - r0.left + box.scrollLeft, y: r.top - r0.top + box.scrollTop + Math.min(r.height / 2, 18) }; };
      const fresh = blockers.flatMap(b => {
        const a = rect(b.by), z = rect(b.from); if (!a || !z) return [];
        let d: string;
        if (a.x1 <= z.x0) { const m = (a.x1 + z.x0) / 2; d = `M${a.x1},${a.y} C${m},${a.y} ${m},${z.y} ${z.x0 - 4},${z.y}`; }
        else if (z.x1 <= a.x0) { const m = (a.x0 + z.x1) / 2; d = `M${a.x0},${a.y} C${m},${a.y} ${m},${z.y} ${z.x1 + 4},${z.y}`; }
        else { const x = Math.max(a.x1, z.x1), s = 26; d = `M${a.x1},${a.y} C${x + s},${a.y} ${x + s},${z.y} ${z.x1 + 4},${z.y}`; }   // en la misma columna, por fuera
        return [{ d, b, active: byUrl.get(b.by)?.state !== 'fusionado' }];
      });
      // solo si cambian (medir no debe volver a pintar sin motivo)
      setArrows(v => v.length === fresh.length && v.every((f, k) => f.d === fresh[k].d && f.active === fresh[k].active) ? v : fresh);
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(box);
    return () => ro.disconnect();
  }, [blockers, showMerged, byUrl]);

  const relation = (u: string) => !sel || u === sel.url ? '' : blockers.some(b => b.from === sel.url && b.by === u) ? ' bloquea-sel' : blockers.some(b => b.by === sel.url && b.from === u) ? ' espera-sel' : '';
  const inSel = (b: Blocker) => !!sel && (b.from === sel.url || b.by === sel.url);
  return (
    <Device label={`${(room?.name ?? t('panels.logistics')).toUpperCase()} · ${t('world.deploymentPlan')}${gh?.demo ? ' · DEMO' : ''}`} width={110} height onClose={goBack}>
      {notice && <p className="aviso-consola" onClick={() => setNotice('')}>{notice}</p>}
      {gh?.error && <p className="tenue">{gh.error}</p>}
      {!gh && <p className="tenue">{t('panels.readingYourGithubPullRequests')}</p>}
      {gh && reading && <p className="tenue">{t('panels.syncingWithGithub')}</p>}
      {marking && <p className="voz">{t('panels.whichPrDoes')} <b>{short(byUrl.get(marking)!)}</b>? {t('panels.waitForPickItAnd')}</p>}
      <div ref={canvas} className="kanban kanban-despliegue" style={{ gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, 1fr)` }}>
        <svg className="flechas-despliegue" aria-hidden>
          <defs>
            <marker id="punta-bloqueo" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--rojo)" /></marker>
            <marker id="punta-hecho" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#b48cff" /></marker>
          </defs>
          {arrows.map(f => <path key={f.b.from + '>' + f.b.by} d={f.d} className={'flecha' + (f.active ? '' : ' hecha') + (f.b.reason === 'manual' ? ' manual' : '') + (inSel(f.b) ? ' sel' : '')} markerEnd={`url(#${f.active ? 'punta-bloqueo' : 'punta-hecho'})`} />)}
        </svg>
        {columns.map((c, ci) => (
          <div key={c.id} className={'kanban-col' + (ci === col ? ' activa' : '')}>
            <h3>{tIs(c.name)} <span className="tenue">{c.prs.length}</span></h3>
            {blocks(c.prs).map(b => (
              <div key={b.task} className={'bloque-tarea' + (b.prs.length > 1 ? ' varios' : '')} style={{ '--tarea': taskColor(b.task) } as React.CSSProperties}>
                {b.prs.length > 1 && <div className="bloque-tarea-cab"><span className="marca-tarea" />{b.task} <span className="tenue">· {b.prs.length}</span><button className="consola-x bloque-tarea-preflight" title={t('preflight.open')} onClick={e => { e.stopPropagation(); preflight(b.task, e.currentTarget); }}>✈ {t('preflight.title')}</button></div>}
            {b.prs.map(p => {
              const k = c.prs.indexOf(p);
              const waits = waitA(p.url), blk = blocksOf(p.url);
              const pending = waits.filter(b => byUrl.get(b.by)?.state !== 'fusionado');
              const beside = links.filter(e => e.a === p.url || e.b === p.url).map(e => byUrl.get(e.a === p.url ? e.b : e.a)!);
              return (
                <div key={p.url} data-pr={p.url} style={{ '--tarea': taskColor(pRTask(p)) } as React.CSSProperties} className={'ficha-issue ficha-pr con-tarea' + (ci === col && k === Math.min(i, c.prs.length - 1) ? ' sel' : '') + relation(p.url) + (marking === p.url ? ' marcando' : '') + (pending.length ? ' bloqueada' : '')}
                  onMouseEnter={() => { setCol(ci); setI(k); }} onClick={() => { if (marking) mark(marking, p.url); }} onDoubleClick={() => !marking && openLink(p.url)} title={`${refPR(p)} · ${trTextPR(p)}`}>
                  <span className="marca-tarea" title={pRTask(p)} /><span className="ident">{short(p)}</span>{wave.has(p.url) && <span className="ola" title={t('panels.deploymentWaveGoesAfterThe')}>{t('panels.waveN', { n: wave.get(p.url) ?? 0 })}</span>} {p.title}
                  <small className="tenue">{trTextPR(p)}</small>
                  {p.state === 'fusionado' && verificationMark(pRTask(p), refPR(p)) && <small className="tenue" title={t('verification.title')}>{verificationMark(pRTask(p), refPR(p))}</small>}
                  {p.state !== 'fusionado' && p.state !== 'cerrado' && ledgerPending(p.ledger) && <Ledger l={p.ledger!} />}
                  {waits.length > 0 && <small className={pending.length ? 'espera' : 'tenue'}>⛔ {t('panels.waitsFor')} {waits.map(b => <span key={b.by} title={tIs(REASON[b.reason])}>{short(byUrl.get(b.by)!)}{byUrl.get(b.by)?.state === 'fusionado' ? ' ✓' : ''} </span>)}</small>}
                  {blk.length > 0 && <small className="tenue">→ {t('panels.blocks')} {blk.map(b => short(byUrl.get(b.from)!)).join(', ')}</small>}
                  {beside.length > 0 && <small className="tenue" title={t('panels.sameTaskInAnotherRepo')}>⋯ {t('panels.sameTaskAs')} {beside.map(short).join(', ')}</small>}
                </div>
              );
            })}
              </div>
            ))}
            {!c.prs.length && <p className="tenue">—</p>}
          </div>
        ))}
      </div>
      {waves.length > 0 && <p className="orden-despliegue"><b>{t('panels.order')}</b> {waves.map((o, k) => <span key={k}>{k > 0 && ' → '}<b>{k + 1}</b> {o.map(short).join(', ')}</span>)}</p>}
      {cycle.length > 0 && <p className="aviso-consola">{t('panels.cyclicBlockersNobodyCanGo')} {cycle.map(short).join(', ')}. {t('panels.removeOneWithX')}</p>}
      {sel && waitA(sel.url).length > 0 && <p className="tenue">{short(sel)} {t('panels.waitsFor')} {waitA(sel.url).map(b => `${short(byUrl.get(b.by)!)} (${tIs(REASON[b.reason])})`).join(', ')}.</p>}
      <div className="botonera">
        {sel && <button className="boton-taller" onClick={e => preflight(pRTask(sel), e.currentTarget)} title={t('preflight.actionHint')}>{t('preflight.keyF', { clave: pRTask(sel) })}</button>}
        <button className="boton-taller" onClick={askPlan} title={t('panels.handsTheBoardToQuien', { quien: dweller?.name ?? t('panels.theRoomSDweller') })}>{dweller ? t('panels.pAskNombreForThe', { nombre: dweller.name }) : t('panels.pAskForTheDeployment')}</button>
      </div>
      <Keys><kbd>←→</kbd>{t('panels.column')} <kbd>↑↓</kbd>{t('panels.pr')} <kbd>Enter</kbd>{marking ? t('panels.waitsForThisOne') : t('panels.openThePr')} <kbd>B</kbd>{t('panels.markWhichOneItWaits')} <kbd>X</kbd>{t('panels.removeTheMarked')} <kbd>H</kbd>{showMerged ? t('panels.hideMerged') : t('panels.showMerged')} <kbd>P</kbd>{t('panels.deploymentPlan')} <kbd>F</kbd>{t('preflight.title')} <kbd>R</kbd>{t('panels.reload')} <kbd>Esc</kbd>{marking ? t('panels.cancel') : t('menu.back')}</Keys>
    </Device>
  );
}
