// Pre-flight de una tarea (fase 1, solo lectura; modelo en shared/preflight.ts, datos de la acción `preflight.tarea`):
// una fila por parte (cada PR de la tarea en todos los repos, los worktrees sin PR y las partes del plan sin empezar) con
// ✓/⚠/✗ de sincronía, CI, revisión y bloqueos; compare y checklist, «—» hasta sus fases. Debajo, el orden de fusión.
// Cada celda abre lo que la arregla: la conversación de la parte, el PR (o sus checks) o el cliente de git en su
// worktree. Se abre desde el bloque de la tarea en el plan de despliegue, el intercomunicador de la copia y ⌘K.
import React, { useEffect, useState } from 'react';
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
import { estadoParte, linkState, shortRef, type Cell, type PartLink, type PartPreflight, type TaskPreflight } from '@shared/preflight';

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

export function PanelPreflight() {
  const datos = juego.usar(e => e.panelData) as { clave?: string; volver?: { panel: Panel; panelData: any } } | null;
  const clave = datos?.clave ?? '';
  const [r, setR] = useState<TaskPreflight | null>(null);
  const [error, setError] = useState('');
  const [leyendo, setReading] = useState(false);
  const [i, setI] = useState(0);
  const tareas = jiraBoard.usar(x => x.tareas);
  useColorsTasks();
  const cargar = (forzar = false) => {
    if (!clave) return;
    setReading(true); setError('');
    cliente.accion<TaskPreflight>('preflight.tarea', { clave, forzar }).then(setR).catch(e => setError((e as Error).message)).finally(() => setReading(false));
  };
  useEffect(() => { setR(null); cargar(); }, [clave]);
  const volver = () => { if (datos?.volver) { SFX.cerrar(); openPanel(datos.volver.panel, datos.volver.panelData); } else closePanel(); };
  const partes = r?.partes ?? [];
  const sel = partes[Math.min(i, partes.length - 1)];
  useKeys(e => {
    if (e.code === 'Escape') volver();
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(x => Math.min(x + 1, Math.max(0, partes.length - 1))); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(x => Math.max(0, x - 1)); SFX.tick(); }
    else if ((e.code === 'Enter' || e.code === 'KeyE') && sel) talkToPart(sel);
    else if (e.code === 'KeyO' && sel) openPR(sel);
    else if (e.code === 'KeyG' && sel) openGitOf(sel);
    else if (e.code === 'KeyR') { cargar(true); SFX.clic(); }
  }, [partes, sel, datos]);

  const titulo = r?.titulo ?? tareas?.find(x => x.clave === clave)?.titulo;
  const color = r?.color ?? taskColor(clave);
  const pendiente = <td className="pf-celda pf-nada" title={t('preflight.laterPhase')}>—</td>;
  return (
    <Device rotulo={`${t('preflight.title').toUpperCase()} · ${clave}${r?.demo ? ' · DEMO' : ''}`} ancho={110} alto onClose={volver}>
      <h2 className="pf-cabeza" style={{ '--tarea': color } as React.CSSProperties}><span className="marca-tarea" />{clave}{titulo ? <span className="tenue"> · {titulo}</span> : null}</h2>
      {error && <p className="aviso-consola">{error}</p>}
      {r?.error && <p className="tenue">{r.error}</p>}
      {!r && !error && <p className="tenue">{t('preflight.reading')}</p>}
      {r && leyendo && <p className="tenue">{t('panels.syncingWithGithub')}</p>}
      {r && !partes.length && <p className="tenue">{t('preflight.nothing', { clave })}</p>}
      {partes.length > 0 && <div className="lista-desplazable"><table className="pf-tabla">
        <thead><tr>
          <th /><th>{t('preflight.col.part')}</th><th>{t('preflight.col.sync')}</th><th>{t('preflight.col.ci')}</th><th>{t('preflight.col.review')}</th>
          <th>{t('preflight.col.blockers')}</th><th title={t('preflight.laterPhase')}>{t('preflight.col.compare')}</th><th title={t('preflight.laterPhase')}>{t('preflight.col.checklist')}</th>
        </tr></thead>
        <tbody>{partes.map((p, k) => {
          const est = estadoParte(p);
          const bloqueo = p.esperaA.find(l => l.estado !== 'fusionado' && l.url);
          return <tr key={p.id} className={'pf-fila' + (k === Math.min(i, partes.length - 1) ? ' sel' : '')} onMouseEnter={() => setI(k)}>
            <td className={'pf-estado pf-' + est.estado} title={est.falta.join('\n') || t('preflight.state.listo')}>{ESTADO[est.estado]}</td>
            <td className="pf-parte">
              <button className="pf-boton" onClick={() => talkToPart(p)} title={t('preflight.cellHint.part')}>
                <b>{p.sala ?? p.repo?.split('/').pop() ?? t('preflight.noRoom')}</b>
                {p.pr ? <> <span className="ident">{shortRef(p.pr)}</span> {p.pr.titulo}</> : p.sinEmpezar ? <> <span className="tenue">{t('preflight.notStartedRow', { titulo: p.plan ?? '' })}</span></> : null}
                <small className="tenue">{p.rama ?? t('preflight.noBranchYet')}{p.plan && !p.sinEmpezar ? ` · ${p.plan}` : ''}</small>
              </button>
            </td>
            <Celda c={p.sync} onClick={p.worktree ? () => openGitOf(p) : undefined} title={t('preflight.cellHint.sync')} />
            <Celda c={p.ci} onClick={p.pr ? () => openPR(p, true) : undefined} title={t('preflight.cellHint.ci')} />
            <Celda c={p.revision} onClick={p.pr ? () => openPR(p) : undefined} title={t('preflight.cellHint.review')} />
            <Celda c={p.bloqueos} onClick={bloqueo?.url ? () => openLink(bloqueo.url!) : undefined} title={[t('preflight.cellHint.blocker'), ...p.esperaA.map(linkTitle)].join('\n')} />
            {pendiente}{pendiente}
          </tr>;
        })}</tbody>
      </table></div>}
      {r && r.olas.length > 0 && <p className="orden-despliegue"><b>{t('preflight.waves')}</b> {r.olas.map((o, k) => <span key={k}>{k > 0 && ' → '}<b>{k + 1}</b> {o.map(x => x.replace(/^[^/]+\//, '')).join(', ')}</span>)}</p>}
      {r && r.ciclo.length > 0 && <p className="aviso-consola">{t('preflight.cycle')} {r.ciclo.map(x => x.replace(/^[^/]+\//, '')).join(', ')}</p>}
      <Keys><kbd>↑↓</kbd>{t('preflight.keys.row')} <kbd>Enter</kbd>{t('preflight.keys.conversation')} <kbd>O</kbd>{t('preflight.keys.pr')} <kbd>G</kbd>{t('preflight.keys.git')} <kbd>R</kbd>{t('panels.reload')} <kbd>Esc</kbd>{datos?.volver ? t('menu.back') : t('menu.close')}</Keys>
    </Device>
  );
}
