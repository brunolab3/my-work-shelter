// Pestaña Pull requests del cliente de git (Control de Versiones): los que esperan tu revisión y los tuyos de las dos
// últimas semanas, con su estado, la revisión, la CI y la tarea de Jira a la que pertenecen (por la clave de la rama o del
// título). Todo viene de `gh` (y de Jira, si está conectado); se abren en el navegador de GitHub del refugio.
import React, { useEffect, useMemo, useState } from 'react';
import { client } from '../../net/client';
import { crossBoard, prText, type PRWithTask, type PRBoard, type TaskJira } from '@shared/board';
import { ago } from './common';
import { taskColor, pRTask } from '@shared/tasks';
import { aimColors, knowTasks, useColorsTasks } from '../tasks';
import { TaskMark } from '../windows';
import { openLink, openPRsGitHub } from '../Browsers';
import { t } from '@shared/language';

interface PRReview { number: number; title: string; url: string; repo: string; draft: boolean; updated: number }
const STATE: Record<PRBoard['state'], string> = { open: '', draft: 'dim', merged: 'merged', closed: 'bad' };

export function PullRequests({ notify }: { notify: (t: string, error?: boolean) => void }) {
  const [mine, setMine] = useState<{ prs: PRBoard[]; demo?: boolean; error?: string } | null>(null);
  const [toReview, setReview] = useState<{ list: PRReview[]; total: number } | null>(null);
  const [tareas, setTasks] = useState<TaskJira[]>([]);
  const [loading, setLoading] = useState(false);
  const read = (force = false) => {
    setLoading(true);
    Promise.all([
      client.action<any>('git.prsBoard', {}).then(setMine).catch(e => notify(e.message, true)),
      client.action<any>('git.github', { force }).then(d => setReview({ list: d.prs?.toReview ?? [], total: d.prs?.nReview ?? 0 })).catch(() => setReview({ list: [], total: 0 })),
      client.action<any>('integration.panel', { source: 'jira', force }).then(d => { aimColors(d.tareas ?? []); setTasks(d.tareas ?? []); }).catch(() => {}),
    ]).finally(() => setLoading(false));
  };
  useEffect(() => read(), []);
  const prs = useMemo(() => crossBoard(tareas, mine?.prs ?? []).prs, [tareas, mine]);
  useColorsTasks();
  useEffect(() => knowTasks(prs.map(pRTask)), [prs]);
  const open = prs.filter(p => p.state === 'open' || p.state === 'draft');
  const closed = prs.filter(p => p.state === 'merged' || p.state === 'closed');
  return (
    <div className="gg">
      <div className="gg-hoja">
        <div className="gg-cab">
          <div className="gg-quien">
            <div className="gg-usuario">Pull requests{mine?.demo ? <span className="dim"> · DEMO</span> : null}</div>
            <div className="dim">{t('windows.thoseWaitingForYourReview')}</div>
          </div>
          <span className="gg-mandos">
            <button className="gc-boton" onClick={() => openPRsGitHub()} title={t('windows.githubComPullsYoursThose')}>github.com/pulls ↗</button>
            <button className="gc-boton" disabled={loading} onClick={() => read(true)} title={t('windows.askGithubAgain')}>{loading ? t('windows.reading') : t('windows.refresh')}</button>
          </span>
        </div>
        {mine?.error && <div className="gd-aviso">{mine.error}</div>}
        {!mine && <div className="gd-vacio">{t('windows.askingGithub')}</div>}
        {mine && (
          <div className="gg-prs gg-prs-col">
            <section>
              <h4>{t('windows.awaitingYourReview')} <span className="dim">({toReview?.total ?? '…'})</span></h4>
              <ul>
                {(toReview?.list ?? []).map(p => (
                  <li key={p.url} onClick={() => openLink(p.url)} title={p.url}>
                    <span className="gg-pr-texto"><span className="gg-pr-titulo">{p.title}</span><span className="gg-pr-repo">{p.repo}#{p.number}</span></span>
                    {p.draft && <span className="gg-pr-estado dim">{t('windows.draft')}</span>}
                    <span className="gg-pr-cuando dim">{ago(p.updated)}</span>
                  </li>
                ))}
                {toReview && !toReview.list.length && <li className="dim">{t('windows.nobodyHasAskedYouFor')}</li>}
              </ul>
            </section>
            <List title={t('windows.yourOpenOnes')} list={open} empty={t('windows.youHaveNoneOpen')} />
            <List title={t('windows.mergedAndClosed')} list={closed} empty={t('windows.nothingMergedOrClosedIn')} />
          </div>
        )}
      </div>
    </div>
  );
}

function List({ title, list, empty }: { title: string; list: PRWithTask[]; empty: string }) {
  return (
    <section>
      <h4>{title} <span className="dim">({list.length})</span></h4>
      <ul>
        {list.map(p => {
          const fail = p.review === 'CHANGES_REQUESTED' || p.checks === 'FAILURE' || p.checks === 'ERROR';
          const good = p.state === 'open' && p.review === 'APPROVED' && p.checks !== 'FAILURE' && p.checks !== 'ERROR';
          return (
            <li key={p.url} onClick={() => openLink(p.url)} title={p.url}>
              <TaskMark taskKey={pRTask(p)} /><span className="gg-pr-texto"><span className="gg-pr-titulo">{p.title}</span><span className="gg-pr-repo">{p.repo}#{p.number}{p.base && p.base !== 'main' && p.base !== 'master' ? <> · {t('windows.intoBase', { base: p.base })}</> : null}</span></span>
              {p.tareas.map(t => <button key={t.key} className="gg-pr-tarea" style={{ color: taskColor(t.key), borderColor: taskColor(t.key) + '88' }} onClick={e => { e.stopPropagation(); openLink(t.url); }} title={`${t.title} · ${t.state}`}>{t.key}</button>)}
              <span className={'gg-pr-estado ' + (fail ? 'bad' : good ? 'ok' : STATE[p.state])}>{prText(p)}</span>
              <span className="gg-pr-cuando dim">{ago(p.updated)}</span>
            </li>
          );
        })}
        {!list.length && <li className="dim">{empty}</li>}
      </ul>
    </section>
  );
}
