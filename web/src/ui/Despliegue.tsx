// Tablero de despliegue de la sala de planificación: tus PR por estado (borrador, en revisión, piden cambios, aprobado,
// fusionado), los bloqueos entre ellos con flechas (apilados, «depends on #12» en la descripción, el orden del plan
// repartido de su tarea o marcados aquí con B), los PR de una misma tarea en otros repos enlazados sin orden y el orden en que se pueden fusionar y desplegar (shared/despliegue.ts). P le pide el plan al habitante de la sala.
// Abre al momento con lo último que se leyó (guardado en la página) y lo pone al día por detrás.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { vivo, cliente } from '../red/cliente';
import { SFX } from '../audio/sonido';
import { t, tIs } from '@shared/idioma';
import { Device, Keys, closePanel, useKeys } from './aparato';
import { goA } from './Paneles';
import { openLink } from './Navegadores';
import { type PRBoard } from '@shared/tablero';
import { trTextPR } from './Operativas';
import { taskColor, pRTask } from '@shared/tareas';
import { knowTasks, useColorsTasks } from './tareas';
import { DEPLOYMENT_COLUMNS, bloqueosEntre, columnaDespliegue, taskLinks, olasDespliegue, promptDeployment, refPR, type Blocker, type BlockerManual, type TaskOrder } from '@shared/despliegue';

const REASON: Record<Blocker['motivo'], string> = { pila: 'apilado', texto: 'lo dice el PR', plan: 'el plan de la tarea', manual: 'marcado aquí' };
type DataGH = { prs: PRBoard[]; demo?: boolean; error?: string };
interface Memory { gh?: DataGH; manuales?: BlockerManual[]; orden?: TaskOrder[] }
const MEMORY = 'refugio:despliegue';
let recuerdo: Memory = (() => { try { return JSON.parse(localStorage.getItem(MEMORY) || '{}'); } catch { return {}; } })();
function remember(r: Memory) { recuerdo = { ...recuerdo, ...r }; try { localStorage.setItem(MEMORY, JSON.stringify(recuerdo)); } catch {} }

const corto = (p: PRBoard) => `${p.repo.split('/').pop()}#${p.numero}`;

// en cada columna, los PR de una misma tarea juntos, en un bloque: la tarea va donde va su mejor PR (la primera ola o el
// más reciente) y dentro, en el orden de la columna
function porTarea(lista: PRBoard[]): PRBoard[] {
  const grupos = new Map<string, PRBoard[]>();
  for (const p of lista) { const k = pRTask(p); (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(p); }
  return [...grupos.values()].flat();
}
const bloques = (lista: PRBoard[]) => lista.reduce<{ tarea: string; prs: PRBoard[] }[]>((out, p) => {
  const k = pRTask(p), ult = out[out.length - 1];
  if (ult?.tarea === k) ult.prs.push(p); else out.push({ tarea: k, prs: [p] });
  return out;
}, []);

export function DeploymentBoard({ salaId, volver }: { salaId: string; volver: () => void }) {
  const sala = vivo.usar(e => e.estado?.salas?.find((s: any) => s.id === salaId));
  const habitante = vivo.usar(e => (e.estado?.habitantes ?? []).find((h: any) => h.salaId === salaId));
  const [gh, setGh] = useState<DataGH | null>(recuerdo.gh ?? null);
  const [manuales, setManual] = useState<BlockerManual[]>(recuerdo.manuales ?? []);
  const [orden, setOrder] = useState<TaskOrder[]>(recuerdo.orden ?? []);
  const [reading, setReading] = useState(false);
  const [aviso, setNotice] = useState('');
  const [seeMerged, setSeeMerged] = useState(true);
  const [col, setCol] = useState(0); const [i, setI] = useState(0);
  const [marking, setMarking] = useState<string | null>(null);   // el PR que espera: se elige a cuál
  const cargar = () => {
    setReading(true);
    // con error, se queda lo que había (y se dice por qué no está al día)
    cliente.accion<DataGH>('git.prsTablero', {}).then(g => { setGh(g); if (!g.error) remember({ gh: g }); })
      .catch(e => setGh(v => ({ prs: v?.prs ?? [], demo: v?.demo, error: e.message }))).finally(() => setReading(false));
    cliente.accion<BlockerManual[]>('despliegue.bloqueos').then(m => { setManual(m); remember({ manuales: m }); }).catch(() => {});
    cliente.accion<TaskOrder[]>('despliegue.orden').then(o => { setOrder(o); remember({ orden: o }); }).catch(() => {});
  };
  useEffect(() => { cargar(); }, []);

  const prs = useMemo(() => gh?.prs ?? [], [gh]);
  useColorsTasks();
  useEffect(() => knowTasks(prs.map(pRTask)), [prs]);
  const bloqueos = useMemo(() => bloqueosEntre(prs, manuales, orden), [prs, manuales, orden]);
  const links = useMemo(() => taskLinks(prs, bloqueos), [prs, bloqueos]);
  const { waves, ciclo } = useMemo(() => olasDespliegue(prs, bloqueos), [prs, bloqueos]);
  const ola = useMemo(() => new Map(waves.flatMap((o, k) => o.map(p => [p.url, k + 1] as const))), [waves]);
  const byUrl = useMemo(() => new Map(prs.map(p => [p.url, p])), [prs]);
  const columnas = DEPLOYMENT_COLUMNS.filter(c => seeMerged || c.id !== 'fusionado')
    .map(c => ({ ...c, prs: porTarea(prs.filter(p => columnaDespliegue(p) === c.id).sort((a, b) => (ola.get(a.url) ?? 99) - (ola.get(b.url) ?? 99) || b.actualizado - a.actualizado)) }));
  const sel: PRBoard | undefined = columnas[col]?.prs[Math.min(i, (columnas[col]?.prs.length ?? 1) - 1)];
  const waitA = (u: string) => bloqueos.filter(b => b.de === u);
  const blocksA = (u: string) => bloqueos.filter(b => b.por === u);

  const marcar = async (de: string, por: string) => {
    setMarking(null);
    if (de === por) return;
    const ya = manuales.some(b => b.de === de && b.por === por);
    try { const m = await cliente.accion<BlockerManual[]>('despliegue.bloquear', { de, por, quitar: ya }); setManual(m); remember({ manuales: m }); SFX.conmutar(); dispatchEvent(new Event('refugio:despliegue')); }
    catch (e) { setNotice((e as Error).message); SFX.noAllowed(); }
  };
  const removeManual = async (de: string) => {
    let l = manuales;
    for (const b of manuales.filter(b => b.de === de)) l = await cliente.accion<BlockerManual[]>('despliegue.bloquear', { de, por: b.por, quitar: true }).catch(() => l);
    setManual(l); remember({ manuales: l }); SFX.conmutar(); dispatchEvent(new Event('refugio:despliegue'));
  };
  const askPlan = () => {
    if (!habitante) { setNotice(t('panels.salaHasNoDweller', { sala: sala?.nombre ?? t('panels.theRoom') })); SFX.noAllowed(); return; }
    if (!prs.some(p => p.estado === 'abierto' || p.estado === 'borrador')) { setNotice(t('panels.youHaveNoPullRequests')); SFX.noAllowed(); return; }
    cliente.enviar({ t: 'empezar', dwellerId: habitante.id, salaId, prompt: promptDeployment(prs, bloqueos), opciones: { permisos: 'plan' } });
    SFX.shortSuccess(); closePanel(); goA(salaId, habitante.id, true);
  };

  useKeys(e => {
    if (e.code === 'Escape') { if (marking) { setMarking(null); SFX.cerrar(); } else volver(); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { setCol(c => Math.min(columnas.length - 1, c + 1)); setI(0); SFX.tick(); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { setCol(c => Math.max(0, c - 1)); setI(0); SFX.tick(); }
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(x => Math.min(x + 1, Math.max(0, (columnas[col]?.prs.length ?? 1) - 1))); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(x => Math.max(0, x - 1)); SFX.tick(); }
    else if (e.code === 'Enter' || e.code === 'KeyE' || e.code === 'KeyB') { if (marking && sel) marcar(marking, sel.url); else if (e.code === 'KeyB' && sel) { setMarking(sel.url); SFX.clic(); } else if (sel) openLink(sel.url); }
    else if (e.code === 'KeyX' && sel) removeManual(sel.url);
    else if (e.code === 'KeyH') { setSeeMerged(x => !x); setCol(0); setI(0); SFX.conmutar(); }
    else if (e.code === 'KeyR') { cargar(); SFX.clic(); }
    else if (e.code === 'KeyP') askPlan();
  }, [columnas, col, i, sel, marking, manuales, prs, bloqueos, habitante]);

  // flechas: del PR que bloquea al que espera, medidas sobre las fichas ya pintadas
  const lienzo = useRef<HTMLDivElement>(null);
  const [flechas, setArrows] = useState<{ d: string; b: Blocker; activa: boolean }[]>([]);
  useLayoutEffect(() => {
    const caja = lienzo.current; if (!caja) return;
    const measure = () => {
      const r0 = caja.getBoundingClientRect();
      const rect = (u: string) => { const el = caja.querySelector<HTMLElement>(`[data-pr="${CSS.escape(u)}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return { x0: r.left - r0.left + caja.scrollLeft, x1: r.right - r0.left + caja.scrollLeft, y: r.top - r0.top + caja.scrollTop + Math.min(r.height / 2, 18) }; };
      const nuevas = bloqueos.flatMap(b => {
        const a = rect(b.por), z = rect(b.de); if (!a || !z) return [];
        let d: string;
        if (a.x1 <= z.x0) { const m = (a.x1 + z.x0) / 2; d = `M${a.x1},${a.y} C${m},${a.y} ${m},${z.y} ${z.x0 - 4},${z.y}`; }
        else if (z.x1 <= a.x0) { const m = (a.x0 + z.x1) / 2; d = `M${a.x0},${a.y} C${m},${a.y} ${m},${z.y} ${z.x1 + 4},${z.y}`; }
        else { const x = Math.max(a.x1, z.x1), s = 26; d = `M${a.x1},${a.y} C${x + s},${a.y} ${x + s},${z.y} ${z.x1 + 4},${z.y}`; }   // en la misma columna, por fuera
        return [{ d, b, activa: byUrl.get(b.por)?.estado !== 'fusionado' }];
      });
      // solo si cambian (medir no debe volver a pintar sin motivo)
      setArrows(v => v.length === nuevas.length && v.every((f, k) => f.d === nuevas[k].d && f.activa === nuevas[k].activa) ? v : nuevas);
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(caja);
    return () => ro.disconnect();
  }, [bloqueos, seeMerged, byUrl]);

  const relation = (u: string) => !sel || u === sel.url ? '' : bloqueos.some(b => b.de === sel.url && b.por === u) ? ' bloquea-sel' : bloqueos.some(b => b.por === sel.url && b.de === u) ? ' espera-sel' : '';
  const inSel = (b: Blocker) => !!sel && (b.de === sel.url || b.por === sel.url);
  return (
    <Device rotulo={`${(sala?.nombre ?? t('panels.logistics')).toUpperCase()} · ${t('world.deploymentPlan')}${gh?.demo ? ' · DEMO' : ''}`} ancho={110} alto onClose={volver}>
      {aviso && <p className="aviso-consola" onClick={() => setNotice('')}>{aviso}</p>}
      {gh?.error && <p className="tenue">{gh.error}</p>}
      {!gh && <p className="tenue">{t('panels.readingYourGithubPullRequests')}</p>}
      {gh && reading && <p className="tenue">{t('panels.syncingWithGithub')}</p>}
      {marking && <p className="voz">{t('panels.whichPrDoes')} <b>{corto(byUrl.get(marking)!)}</b>? {t('panels.waitForPickItAnd')}</p>}
      <div ref={lienzo} className="kanban kanban-despliegue" style={{ gridTemplateColumns: `repeat(${Math.max(1, columnas.length)}, 1fr)` }}>
        <svg className="flechas-despliegue" aria-hidden>
          <defs>
            <marker id="punta-bloqueo" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--rojo)" /></marker>
            <marker id="punta-hecho" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#b48cff" /></marker>
          </defs>
          {flechas.map(f => <path key={f.b.de + '>' + f.b.por} d={f.d} className={'flecha' + (f.activa ? '' : ' hecha') + (f.b.motivo === 'manual' ? ' manual' : '') + (inSel(f.b) ? ' sel' : '')} markerEnd={`url(#${f.activa ? 'punta-bloqueo' : 'punta-hecho'})`} />)}
        </svg>
        {columnas.map((c, ci) => (
          <div key={c.id} className={'kanban-col' + (ci === col ? ' activa' : '')}>
            <h3>{tIs(c.nombre)} <span className="tenue">{c.prs.length}</span></h3>
            {bloques(c.prs).map(b => (
              <div key={b.tarea} className={'bloque-tarea' + (b.prs.length > 1 ? ' varios' : '')} style={{ '--tarea': taskColor(b.tarea) } as React.CSSProperties}>
                {b.prs.length > 1 && <div className="bloque-tarea-cab"><span className="marca-tarea" />{b.tarea} <span className="tenue">· {b.prs.length}</span></div>}
            {b.prs.map(p => {
              const k = c.prs.indexOf(p);
              const esp = waitA(p.url), blq = blocksA(p.url);
              const pendientes = esp.filter(b => byUrl.get(b.por)?.estado !== 'fusionado');
              const junto = links.filter(e => e.a === p.url || e.b === p.url).map(e => byUrl.get(e.a === p.url ? e.b : e.a)!);
              return (
                <div key={p.url} data-pr={p.url} style={{ '--tarea': taskColor(pRTask(p)) } as React.CSSProperties} className={'ficha-issue ficha-pr con-tarea' + (ci === col && k === Math.min(i, c.prs.length - 1) ? ' sel' : '') + relation(p.url) + (marking === p.url ? ' marcando' : '') + (pendientes.length ? ' bloqueada' : '')}
                  onMouseEnter={() => { setCol(ci); setI(k); }} onClick={() => { if (marking) marcar(marking, p.url); }} onDoubleClick={() => !marking && openLink(p.url)} title={`${refPR(p)} · ${trTextPR(p)}`}>
                  <span className="marca-tarea" title={pRTask(p)} /><span className="ident">{corto(p)}</span>{ola.has(p.url) && <span className="ola" title={t('panels.deploymentWaveGoesAfterThe')}>{t('panels.waveN', { n: ola.get(p.url) ?? 0 })}</span>} {p.titulo}
                  <small className="tenue">{trTextPR(p)}</small>
                  {esp.length > 0 && <small className={pendientes.length ? 'espera' : 'tenue'}>⛔ {t('panels.waitsFor')} {esp.map(b => <span key={b.por} title={tIs(REASON[b.motivo])}>{corto(byUrl.get(b.por)!)}{byUrl.get(b.por)?.estado === 'fusionado' ? ' ✓' : ''} </span>)}</small>}
                  {blq.length > 0 && <small className="tenue">→ {t('panels.blocks')} {blq.map(b => corto(byUrl.get(b.de)!)).join(', ')}</small>}
                  {junto.length > 0 && <small className="tenue" title={t('panels.sameTaskInAnotherRepo')}>⋯ {t('panels.sameTaskAs')} {junto.map(corto).join(', ')}</small>}
                </div>
              );
            })}
              </div>
            ))}
            {!c.prs.length && <p className="tenue">—</p>}
          </div>
        ))}
      </div>
      {waves.length > 0 && <p className="orden-despliegue"><b>{t('panels.order')}</b> {waves.map((o, k) => <span key={k}>{k > 0 && ' → '}<b>{k + 1}</b> {o.map(corto).join(', ')}</span>)}</p>}
      {ciclo.length > 0 && <p className="aviso-consola">{t('panels.cyclicBlockersNobodyCanGo')} {ciclo.map(corto).join(', ')}. {t('panels.removeOneWithX')}</p>}
      {sel && waitA(sel.url).length > 0 && <p className="tenue">{corto(sel)} {t('panels.waitsFor')} {waitA(sel.url).map(b => `${corto(byUrl.get(b.por)!)} (${tIs(REASON[b.motivo])})`).join(', ')}.</p>}
      <div className="botonera">
        <button className="boton-taller" onClick={askPlan} title={t('panels.handsTheBoardToQuien', { quien: habitante?.nombre ?? t('panels.theRoomSDweller') })}>{habitante ? t('panels.pAskNombreForThe', { nombre: habitante.nombre }) : t('panels.pAskForTheDeployment')}</button>
      </div>
      <Keys><kbd>←→</kbd>{t('panels.column')} <kbd>↑↓</kbd>{t('panels.pr')} <kbd>Enter</kbd>{marking ? t('panels.waitsForThisOne') : t('panels.openThePr')} <kbd>B</kbd>{t('panels.markWhichOneItWaits')} <kbd>X</kbd>{t('panels.removeTheMarked')} <kbd>H</kbd>{seeMerged ? t('panels.hideMerged') : t('panels.showMerged')} <kbd>P</kbd>{t('panels.deploymentPlan')} <kbd>R</kbd>{t('panels.reload')} <kbd>Esc</kbd>{marking ? t('panels.cancel') : t('menu.back')}</Keys>
    </Device>
  );
}
