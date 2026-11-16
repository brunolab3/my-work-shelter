// Pre-flight of a task: is each of its PRs, in every repo, ready to merge? (model in shared/preflight.ts, data from the
// `preflight.tarea` action): one row per PR with its state, CI, review, conflicts and the PRs it waits for, and the
// merge order below. Clicking a row opens the PR; clicking its blockers, the PR it waits for. Getting ready to push
// (compare, checklist, sync) is not here: the push gate asks for it (gateMissing). Opened from the task's block in the
// deployment plan, the copy's intercom and ⌘K. Docked on the left (Device `lado`), so the intercom stays open beside it.
import React, { useEffect, useState } from 'react';
import { juego, type Panel } from './estadoJuego';
import { cliente } from '../red/cliente';
import { SFX } from '../audio/sonido';
import { t } from '@shared/idioma';
import { Device, Keys, closePanel, useKeys } from './aparato';
import { openPanel } from './Paneles';
import { openLink } from './Navegadores';
import { jiraBoard, useColorsTasks } from './tareas';
import { taskColor } from '@shared/tareas';
import { refPR } from '@shared/despliegue';
import { linkState, mergeReady, shortRef, type Cell, type PartLink, type PartPreflight, type TaskPreflight } from '@shared/preflight';

const MARK: Record<Cell['marca'], string> = { ok: '✓', aviso: '⚠', mal: '✗', nada: '—' };
const READY: Record<ReturnType<typeof mergeReady>['estado'], string> = { fusionado: '✔', listo: '✓', aviso: '⚠', falta: '✗' };
const STATE: Record<string, string> = { abierto: 'preflight.blockers.open', borrador: 'preflight.review.draft', fusionado: 'preflight.review.merged', cerrado: 'preflight.sync.closed' };

/** Abre el pre-flight de una tarea; `volver`: el aparato al que vuelve con Esc (el plan de despliegue) */
export function openPreflight(clave: string, volver?: { panel: Panel; panelData: any }) {
  // docked on the left: a maximized intercom goes back to the right, as for a page (Dialogo.tsx)
  dispatchEvent(new CustomEvent('refugio:pagina-al-lado'));
  openPanel('preflight', { clave: clave.toUpperCase(), volver });
}

const openPR = (p: PartPreflight) => { if (p.pr) openLink(p.pr.url); else SFX.noAllowed(); };

function Celda({ c, onClick, title }: { c: Cell; onClick?: () => void; title?: string }) {
  return <td className={'pf-celda pf-' + c.marca} title={title}>
    {onClick ? <button className="pf-boton" onClick={e => { e.stopPropagation(); onClick(); }}><span className="pf-marca">{MARK[c.marca]}</span> {c.texto}</button>
      : <><span className="pf-marca">{MARK[c.marca]}</span>{c.texto !== MARK[c.marca] ? ' ' + c.texto : ''}</>}
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
  // back in the window (from GitHub), the latest: a review or a merge changes the row
  useEffect(() => { const f = () => { if (document.visibilityState === 'visible') cargar(); }; addEventListener('focus', f); return () => removeEventListener('focus', f); }, [clave]);
  const volver = () => { if (datos?.volver) { SFX.cerrar(); openPanel(datos.volver.panel, datos.volver.panelData); } else closePanel(); };
  // the PRs, in merge order (the order of the waves), then the rest
  const orden = r?.olas.flat() ?? [];
  const ola = (p: PartPreflight) => { const n = orden.indexOf(refPR(p.pr!)); return n < 0 ? 999 : n; };
  const prs = (r?.partes ?? []).filter(p => p.pr).sort((a, b) => ola(a) - ola(b));
  const sinPR = (r?.partes ?? []).filter(p => !p.pr).map(p => p.sala ?? p.repo?.split('/').pop() ?? '?');
  const k = Math.min(i, Math.max(0, prs.length - 1)), sel = prs[k];
  useKeys(e => {
    if (e.code === 'Escape') volver();
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') { setI(Math.min(k + 1, Math.max(0, prs.length - 1))); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setI(Math.max(0, k - 1)); SFX.tick(); }
    else if ((e.code === 'Enter' || e.code === 'KeyO') && sel) openPR(sel);
    else if (e.code === 'KeyR') { cargar(true); SFX.clic(); }
  }, [prs, k, sel, datos]);

  const titulo = r?.titulo ?? tareas?.find(x => x.clave === clave)?.titulo;
  const color = r?.color ?? taskColor(clave);
  const porRef = new Map(prs.map(p => [refPR(p.pr!), mergeReady(p).estado]));
  return (
    <Device rotulo={`${t('preflight.title').toUpperCase()} · ${clave}${r?.demo ? ' · DEMO' : ''}`} lado onClose={volver}>
      <h2 className="pf-cabeza" style={{ '--tarea': color } as React.CSSProperties}><span className="marca-tarea" />{clave}{titulo ? <span className="tenue"> · {titulo}</span> : null}</h2>
      {error && <p className="aviso-consola" onClick={() => setError('')}>{error}</p>}
      {r?.error && <p className="tenue">{r.error}</p>}
      {!r && !error && <p className="tenue">{t('preflight.reading')}</p>}
      {r && leyendo && <p className="tenue">{t('panels.syncingWithGithub')}</p>}
      {r && !prs.length && <p className="tenue">{t('preflight.noPRs', { clave })}</p>}
      {prs.length > 0 && <div className="lista-desplazable"><table className="pf-tabla">
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
      {r && r.olas.length > 0 && <p className="orden-despliegue"><b>{t('preflight.waves')}</b> {r.olas.map((o, n) => <span key={n}>{n > 0 && ' → '}<b>{n + 1}</b> {o.map((x, j) => {
        const e = porRef.get(x);
        return <span key={x} className={e === 'fusionado' ? 'pf-hecha' : e === 'listo' ? 'pf-listo' : ''}>{j > 0 && ', '}{x.replace(/^[^/]+\//, '')}{e === 'listo' ? ' ✓' : ''}</span>;
      })}</span>)}</p>}
      {r && r.ciclo.length > 0 && <p className="aviso-consola">{t('preflight.cycle')} {r.ciclo.map(x => x.replace(/^[^/]+\//, '')).join(', ')}</p>}
      <Keys><kbd>↑↓</kbd>{t('preflight.keys.row')} <kbd>Enter</kbd>{t('preflight.keys.pr')} <kbd>R</kbd>{t('panels.reload')} <kbd>Esc</kbd>{datos?.volver ? t('menu.back') : t('menu.close')}</Keys>
    </Device>
  );
}
