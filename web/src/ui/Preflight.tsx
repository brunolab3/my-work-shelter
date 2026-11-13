// Pre-flight de una tarea (fase 1, solo lectura; modelo en shared/preflight.ts, datos de la acción `preflight.tarea`):
// una fila por parte (cada PR de la tarea en todos los repos, los worktrees sin PR y las partes del plan sin empezar) con
// ✓/⚠/✗ de compare (validada en su commit), sincronía, CI, revisión (con sus hilos sin resolver, → los despliega) y
// bloqueos, y la lista «antes de subir» contestada en su commit (preflight_responder). Debajo, el orden de fusión y la comparación de toda la tarea (C, V la valida).
// Cada celda abre lo que la arregla: la conversación de la parte, el PR (o sus checks) o el cliente de git en su
// worktree. Se abre desde el bloque de la tarea en el plan de despliegue, el intercomunicador de la copia y ⌘K.
import React, { useEffect, useMemo, useState } from 'react';
import { juego, type Panel } from './estadoJuego';
import { vivo, cliente } from '../red/cliente';
import { SFX } from '../audio/sonido';
import { t } from '@shared/idioma';
import { Device, Keys, closePanel, useKeys } from './aparato';
import { openPanel, goA } from './Paneles';
import { openLink } from './Navegadores';
import { openGit } from './git/ventana';
import { openConversation } from './Dialogo';
import { idCopy } from './copias';
import { jiraBoard, useColorsTasks } from './tareas';
import { taskColor } from '@shared/tareas';
import type { ReviewThread } from '@shared/cuentaRevisiones';
import { answered, estadoParte, linkState, shortRef, type Cell, type PartLink, type PartPreflight, type TaskPreflight } from '@shared/preflight';

const MARK: Record<Cell['marca'], string> = { ok: '✓', aviso: '⚠', mal: '✗', nada: '—' };
const ESTADO: Record<ReturnType<typeof estadoParte>['estado'], string> = { listo: '✓', aviso: '⚠', falta: '✗' };
const norm = (r: string) => r.replace(/\/+$/, '');

/** Abre el pre-flight de una tarea; `volver`: el aparato al que vuelve con Esc (el plan de despliegue) */
export function openPreflight(clave: string, volver?: { panel: Panel; panelData: any }) {
  openPanel('preflight', { clave: clave.toUpperCase(), volver });
}

// la conversación de una parte: la abierta en su worktree; si no, su copia (holograma) o el habitante de su sala
function talkToPart(p: PartPreflight) {
  const s = p.worktree ? Object.values(vivo.get().sesiones).find(x => x.estado !== 'cerrada' && x.salaId === p.salaId && norm(x.worktree ?? x.cwd) === norm(p.worktree!)) : undefined;
  if (s) { closePanel(); openConversation(s.id); return; }
  const j = juego.get();
  if (p.worktree && j.copias.some(c => c.id === idCopy(p.worktree!))) { closePanel(); goA(p.salaId!, idCopy(p.worktree), true); return; }
  const h = p.salaId ? j.habitantes.find(x => x.sala === p.salaId) : undefined;
  if (h) { closePanel(); goA(h.sala, h.id, true); return; }
  SFX.noAllowed();
}
const openPR = (p: PartPreflight, checks = false) => { if (p.pr) openLink(p.pr.url + (checks ? '/checks' : '')); else SFX.noAllowed(); };
const openGitOf = (p: PartPreflight) => { if (p.worktree) { closePanel(); openGit({ ruta: p.worktree, vista: 'cambios' }); } else SFX.noAllowed(); };

function Celda({ c, onClick, title }: { c: Cell; onClick?: () => void; title?: string }) {
  return <td className={'pf-celda pf-' + c.marca}>
    <button className="pf-boton" onClick={e => { e.stopPropagation(); onClick?.(); }} disabled={!onClick} title={title}>
      <span className="pf-marca">{MARK[c.marca]}</span>{c.texto !== MARK[c.marca] ? ' ' + c.texto : ''}
    </button>
  </td>;
}
const linkTitle = (l: PartLink) => l.url ? `${l.ref} · ${l.titulo ?? ''}\n${linkState(l)}` : `${l.sala} · ${linkState(l)}`;

// lo que se puede elegir: cada parte y, con la parte abierta (→), cada uno de sus hilos sin resolver
type Item = { parte: PartPreflight; hilo?: ReviewThread };

export function PanelPreflight() {
  const datos = juego.usar(e => e.panelData) as { clave?: string; volver?: { panel: Panel; panelData: any } } | null;
  const clave = datos?.clave ?? '';
  const [r, setR] = useState<TaskPreflight | null>(null);
  const [error, setError] = useState('');
  const [leyendo, setReading] = useState(false);
  const [i, setI] = useState(0);
  const [abiertas, setOpen] = useState<Set<string>>(new Set());
  const tareas = jiraBoard.usar(x => x.tareas);
  useColorsTasks();
  const cargar = (forzar = false) => {
    if (!clave) return;
    setReading(true); setError('');
    cliente.accion<TaskPreflight>('preflight.tarea', { clave, forzar }).then(setR).catch(e => setError((e as Error).message)).finally(() => setReading(false));
  };
  useEffect(() => { setR(null); setOpen(new Set()); cargar(); }, [clave]);
  // al volver a la ventana (de una página o una conversación), lo último: una validación cambia la columna de compare
  useEffect(() => { const f = () => { if (document.visibilityState === 'visible') cargar(); }; addEventListener('focus', f); return () => removeEventListener('focus', f); }, [clave]);
  const volver = () => { if (datos?.volver) { SFX.cerrar(); openPanel(datos.volver.panel, datos.volver.panelData); } else closePanel(); };
  const partes = r?.partes ?? [];
  const items = useMemo<Item[]>(() => partes.flatMap(p => [{ parte: p }, ...(abiertas.has(p.id) ? p.hilos.map(h => ({ parte: p, hilo: h })) : [])]), [partes, abiertas]);
  const k = Math.min(i, Math.max(0, items.length - 1)), sel = items[k];
  const toggle = (p: PartPreflight, abrir?: boolean) => {
    if (!p.hilos.length) { SFX.noAllowed(); return; }
    setOpen(x => { const y = new Set(x); if (abrir ?? !y.has(p.id)) y.add(p.id); else y.delete(p.id); return y; }); SFX.clic();
  };
  // la comparación de toda la tarea: hacerla (o rehacerla) y abrirla; V la valida
  const [haciendo, setMaking] = useState(false);
  const compararTarea = () => {
    if (haciendo) return;
    setMaking(true); SFX.clic();
    cliente.accion<{ archivo: string }>('preflight.compararTarea', { clave }).then(x => { openLink(x.archivo); cargar(); }).catch(e => { setError((e as Error).message); SFX.noAllowed(); }).finally(() => setMaking(false));
  };
  const validarTarea = () => {
    const a = r?.compareTarea?.archivo; if (!a) { SFX.noAllowed(); return; }
    cliente.accion<boolean>('paginas.responder', { ruta: a, estado: 'validada' }).then(() => { SFX.shortSuccess(); cargar(); }).catch(() => SFX.noAllowed());
  };
  useKeys(e => {
    if (e.code === 'Escape') volver();
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(Math.min(k + 1, Math.max(0, items.length - 1))); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(Math.max(0, k - 1)); SFX.tick(); }
    else if (e.code === 'ArrowRight' && sel) toggle(sel.parte, true);
    else if (e.code === 'ArrowLeft' && sel) { if (abiertas.has(sel.parte.id)) { toggle(sel.parte, false); setI(items.findIndex(x => x.parte === sel.parte && !x.hilo)); } }
    else if (e.code === 'Space' && sel) toggle(sel.parte);
    else if ((e.code === 'Enter' || e.code === 'KeyE') && sel) talkToPart(sel.parte);
    else if (e.code === 'KeyO' && sel) { if (sel.hilo) openLink(sel.hilo.url); else openPR(sel.parte); }
    else if (e.code === 'KeyG' && sel) openGitOf(sel.parte);
    else if (e.code === 'KeyC') compararTarea();
    else if (e.code === 'KeyV') validarTarea();
    else if (e.code === 'KeyR') { cargar(true); SFX.clic(); }
  }, [items, k, sel, datos, abiertas, r, haciendo]);

  const titulo = r?.titulo ?? tareas?.find(x => x.clave === clave)?.titulo;
  const color = r?.color ?? taskColor(clave);
  const ct = r?.compareTarea;
  const ctEstado = !ct ? '' : ct.respuesta?.estado === 'validada' && ct.respuesta.ts >= ct.ts ? t('preflight.taskCompare.validated') : ct.respuesta?.estado === 'notas' && ct.respuesta.ts >= ct.ts ? t('preflight.compare.notes') : t('preflight.taskCompare.pending');
  return (
    <Device rotulo={`${t('preflight.title').toUpperCase()} · ${clave}${r?.demo ? ' · DEMO' : ''}`} ancho={110} alto onClose={volver}>
      <h2 className="pf-cabeza" style={{ '--tarea': color } as React.CSSProperties}><span className="marca-tarea" />{clave}{titulo ? <span className="tenue"> · {titulo}</span> : null}</h2>
      {error && <p className="aviso-consola" onClick={() => setError('')}>{error}</p>}
      {r?.error && <p className="tenue">{r.error}</p>}
      {!r && !error && <p className="tenue">{t('preflight.reading')}</p>}
      {r && leyendo && <p className="tenue">{t('panels.syncingWithGithub')}</p>}
      {r && !partes.length && <p className="tenue">{t('preflight.nothing', { clave })}</p>}
      {partes.length > 0 && <div className="lista-desplazable"><table className="pf-tabla">
        <thead><tr>
          <th /><th>{t('preflight.col.part')}</th><th>{t('preflight.col.compare')}</th><th>{t('preflight.col.sync')}</th><th>{t('preflight.col.ci')}</th><th>{t('preflight.col.review')}</th>
          <th>{t('preflight.col.blockers')}</th><th>{t('preflight.col.checklist')}</th>
        </tr></thead>
        <tbody>{items.map((it, n) => {
          const p = it.parte, activa = n === k;
          if (it.hilo) {
            const h = it.hilo;
            return <tr key={p.id + h.url} className={'pf-hilo' + (activa ? ' sel' : '')} onMouseEnter={() => setI(n)}>
              <td /><td colSpan={7}>
                <button className="pf-boton" onClick={() => openLink(h.url)} title={t('preflight.threadHint')}>
                  <span className="ident">{h.archivo}{h.linea ? ':' + h.linea : ''}</span> <b>{h.autor}</b>{h.outdated ? <span className="tenue"> · {t('preflight.threadOutdated')}</span> : null} <span className="tenue">— {h.texto}</span>
                </button>
              </td>
            </tr>;
          }
          const est = estadoParte(p);
          const bloqueo = p.esperaA.find(l => l.estado !== 'fusionado' && l.url);
          const abierta = abiertas.has(p.id);
          return <tr key={p.id} className={'pf-fila' + (activa ? ' sel' : '')} onMouseEnter={() => setI(n)}>
            <td className={'pf-estado pf-' + est.estado} title={est.falta.join('\n') || t('preflight.state.listo')}>{ESTADO[est.estado]}</td>
            <td className="pf-parte">
              <button className="pf-boton" onClick={() => talkToPart(p)} title={t('preflight.cellHint.part')}>
                <b>{p.sala ?? p.repo?.split('/').pop() ?? t('preflight.noRoom')}</b>
                {p.pr ? <> <span className="ident">{shortRef(p.pr)}</span> {p.pr.titulo}</> : p.sinEmpezar ? <> <span className="tenue">{t('preflight.notStartedRow', { titulo: p.plan ?? '' })}</span></> : null}
                <small className="tenue">{p.rama ?? t('preflight.noBranchYet')}{p.plan && !p.sinEmpezar ? ` · ${p.plan}` : ''}</small>
              </button>
            </td>
            <Celda c={p.compare} onClick={p.compareArchivo ? () => openLink(p.compareArchivo!) : undefined} title={t('preflight.cellHint.compare')} />
            <Celda c={p.sync} onClick={p.worktree ? () => openGitOf(p) : undefined} title={t('preflight.cellHint.sync')} />
            <Celda c={p.ci} onClick={p.pr ? () => openPR(p, true) : undefined} title={t('preflight.cellHint.ci')} />
            <td className={'pf-celda pf-' + p.revision.marca}>
              <button className="pf-boton" onClick={() => openPR(p)} disabled={!p.pr} title={t('preflight.cellHint.review')}><span className="pf-marca">{MARK[p.revision.marca]}</span>{p.revision.texto !== MARK[p.revision.marca] ? ' ' + p.revision.texto : ''}</button>
              {p.hilos.length > 0 && <button className="consola-x pf-hilos" onClick={() => toggle(p)} title={t('preflight.threadsHint')}>{abierta ? '▾' : '▸'} {t('preflight.threadsN', { n: p.hilos.length })}</button>}
            </td>
            <Celda c={p.bloqueos} onClick={bloqueo?.url ? () => openLink(bloqueo.url!) : undefined} title={[t('preflight.cellHint.blocker'), ...p.esperaA.map(linkTitle)].join('\n')} />
            <Celda c={p.checklist} onClick={p.worktree ? () => talkToPart(p) : undefined} title={[t('preflight.cellHint.checklist'), ...[...(r?.checklist ?? []), ...p.repoItems.filter(i => !r?.checklist.includes(i))].map((it, n) => `${answered(p.respuestas?.[it]) ? '✓' : '·'} ${n + 1}. ${it}${p.respuestas?.[it]?.nota ? ' — ' + p.respuestas[it].nota : ''}`), ...(p.ciChecks.length ? ['', t('preflight.ciChecks'), ...p.ciChecks.map(c => `${{ ok: '✓', mal: '✗', pendiente: '…' }[c.estado]} ${c.nombre}`)] : [])].join('\n')} />
          </tr>;
        })}</tbody>
      </table></div>}
      {r && r.olas.length > 0 && <p className="orden-despliegue"><b>{t('preflight.waves')}</b> {r.olas.map((o, n) => <span key={n}>{n > 0 && ' → '}<b>{n + 1}</b> {o.map(x => x.replace(/^[^/]+\//, '')).join(', ')}</span>)}</p>}
      {r && r.ciclo.length > 0 && <p className="aviso-consola">{t('preflight.cycle')} {r.ciclo.map(x => x.replace(/^[^/]+\//, '')).join(', ')}</p>}
      {partes.some(p => p.worktree) && <div className="botonera">
        <button className="boton-taller" onClick={compararTarea} disabled={haciendo} title={t('preflight.taskCompare.hint')}>{haciendo ? t('preflight.taskCompare.making') : t(ct ? 'preflight.taskCompare.redo' : 'preflight.taskCompare.make')}</button>
        {ct && <button className="boton-taller" onClick={() => openLink(ct.archivo)}>{t('preflight.taskCompare.open')} <span className="tenue">· {ctEstado}</span></button>}
        {ct && <button className="boton-taller" onClick={validarTarea} title={t('preflight.taskCompare.validateHint')}>{t('preflight.taskCompare.validate')}</button>}
      </div>}
      <Keys><kbd>↑↓</kbd>{t('preflight.keys.row')} <kbd>→←</kbd>{t('preflight.keys.threads')} <kbd>Enter</kbd>{t('preflight.keys.conversation')} <kbd>O</kbd>{sel?.hilo ? t('preflight.keys.thread') : t('preflight.keys.pr')} <kbd>G</kbd>{t('preflight.keys.git')} <kbd>C</kbd>{t('preflight.keys.taskCompare')} <kbd>V</kbd>{t('preflight.keys.validate')} <kbd>R</kbd>{t('panels.reload')} <kbd>Esc</kbd>{datos?.volver ? t('menu.back') : t('menu.close')}</Keys>
    </Device>
  );
}
