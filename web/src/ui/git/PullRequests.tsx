// Pestaña Pull requests del cliente de git (Control de Versiones): los que esperan tu revisión y los tuyos de las dos
// últimas semanas, con su estado, la revisión, la CI y la tarea de Jira a la que pertenecen (por la clave de la rama o del
// título). Todo viene de `gh` (y de Jira, si está conectado); se abren en el navegador de GitHub del refugio.
import React, { useEffect, useMemo, useState } from 'react';
import { cliente } from '../../red/cliente';
import { cruzarTablero, textoPR, type PRWithTask, type PRBoard, type TaskJira } from '@shared/tablero';
import { hace } from './comun';
import { taskColor, pRTask } from '@shared/tareas';
import { aimColors, knowTasks, useColorsTasks } from '../tareas';
import { openLink, openPRsGitHub } from '../Navegadores';
import { t } from '@shared/idioma';

interface PRReview { numero: number; titulo: string; url: string; repo: string; borrador: boolean; actualizado: number }
const ESTADO: Record<PRBoard['estado'], string> = { abierto: '', borrador: 'tenue', fusionado: 'fusionado', cerrado: 'mal' };

export function PullRequests({ avisar }: { avisar: (t: string, error?: boolean) => void }) {
  const [mine, setMine] = useState<{ prs: PRBoard[]; demo?: boolean; error?: string } | null>(null);
  const [revisar, setReview] = useState<{ lista: PRReview[]; total: number } | null>(null);
  const [tareas, setTasks] = useState<TaskJira[]>([]);
  const [cargando, setLoading] = useState(false);
  const leer = (forzar = false) => {
    setLoading(true);
    Promise.all([
      cliente.accion<any>('git.prsTablero', {}).then(setMine).catch(e => avisar(e.message, true)),
      cliente.accion<any>('git.github', { forzar }).then(d => setReview({ lista: d.prs?.revisar ?? [], total: d.prs?.nReview ?? 0 })).catch(() => setReview({ lista: [], total: 0 })),
      cliente.accion<any>('integracion.panel', { fuente: 'jira', forzar }).then(d => { aimColors(d.tareas ?? []); setTasks(d.tareas ?? []); }).catch(() => {}),
    ]).finally(() => setLoading(false));
  };
  useEffect(() => leer(), []);
  const prs = useMemo(() => cruzarTablero(tareas, mine?.prs ?? []).prs, [tareas, mine]);
  useColorsTasks();
  useEffect(() => knowTasks(prs.map(pRTask)), [prs]);
  const abiertos = prs.filter(p => p.estado === 'abierto' || p.estado === 'borrador');
  const cerrados = prs.filter(p => p.estado === 'fusionado' || p.estado === 'cerrado');
  return (
    <div className="gg">
      <div className="gg-hoja">
        <div className="gg-cab">
          <div className="gg-quien">
            <div className="gg-usuario">Pull requests{mine?.demo ? <span className="tenue"> · DEMO</span> : null}</div>
            <div className="tenue">{t('windows.thoseWaitingForYourReview')}</div>
          </div>
          <span className="gg-mandos">
            <button className="gc-boton" onClick={() => openPRsGitHub()} title={t('windows.githubComPullsYoursThose')}>github.com/pulls ↗</button>
            <button className="gc-boton" disabled={cargando} onClick={() => leer(true)} title={t('windows.askGithubAgain')}>{cargando ? t('windows.reading') : t('windows.refresh')}</button>
          </span>
        </div>
        {mine?.error && <div className="gd-aviso">{mine.error}</div>}
        {!mine && <div className="gd-vacio">{t('windows.askingGithub')}</div>}
        {mine && (
          <div className="gg-prs gg-prs-col">
            <section>
              <h4>{t('windows.awaitingYourReview')} <span className="tenue">({revisar?.total ?? '…'})</span></h4>
              <ul>
                {(revisar?.lista ?? []).map(p => (
                  <li key={p.url} onClick={() => openLink(p.url)} title={p.url}>
                    <span className="gg-pr-texto"><span className="gg-pr-titulo">{p.titulo}</span><span className="gg-pr-repo">{p.repo}#{p.numero}</span></span>
                    {p.borrador && <span className="gg-pr-estado tenue">{t('windows.draft')}</span>}
                    <span className="gg-pr-cuando tenue">{hace(p.actualizado)}</span>
                  </li>
                ))}
                {revisar && !revisar.lista.length && <li className="tenue">{t('windows.nobodyHasAskedYouFor')}</li>}
              </ul>
            </section>
            <List titulo={t('windows.yourOpenOnes')} lista={abiertos} vacio={t('windows.youHaveNoneOpen')} />
            <List titulo={t('windows.mergedAndClosed')} lista={cerrados} vacio={t('windows.nothingMergedOrClosedIn')} />
          </div>
        )}
      </div>
    </div>
  );
}

function List({ titulo, lista, vacio }: { titulo: string; lista: PRWithTask[]; vacio: string }) {
  return (
    <section>
      <h4>{titulo} <span className="tenue">({lista.length})</span></h4>
      <ul>
        {lista.map(p => {
          const mal = p.revision === 'CHANGES_REQUESTED' || p.checks === 'FAILURE' || p.checks === 'ERROR';
          const bien = p.estado === 'abierto' && p.revision === 'APPROVED' && p.checks !== 'FAILURE' && p.checks !== 'ERROR';
          return (
            <li key={p.url} onClick={() => openLink(p.url)} title={p.url}>
              <span className="marca-tarea" style={{ '--tarea': taskColor(pRTask(p)) } as React.CSSProperties} title={pRTask(p)} /><span className="gg-pr-texto"><span className="gg-pr-titulo">{p.titulo}</span><span className="gg-pr-repo">{p.repo}#{p.numero}{p.base && p.base !== 'main' && p.base !== 'master' ? <> · {t('windows.intoBase', { base: p.base })}</> : null}</span></span>
              {p.tareas.map(t => <button key={t.clave} className="gg-pr-tarea" style={{ color: taskColor(t.clave), borderColor: taskColor(t.clave) + '88' }} onClick={e => { e.stopPropagation(); openLink(t.url); }} title={`${t.titulo} · ${t.estado}`}>{t.clave}</button>)}
              <span className={'gg-pr-estado ' + (mal ? 'mal' : bien ? 'ok' : ESTADO[p.estado])}>{textoPR(p)}</span>
              <span className="gg-pr-cuando tenue">{hace(p.actualizado)}</span>
            </li>
          );
        })}
        {!lista.length && <li className="tenue">{vacio}</li>}
      </ul>
    </section>
  );
}
