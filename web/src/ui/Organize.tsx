// Organizar las salas por tareas (server/organize.ts): cada sala de repo, un worktree por cada tarea con PR tuyos sin
// fusionar y en cada uno su propia conversación con el habitante, que trabaja sus PR de uno en uno (si van apilados,
// rebasando los de encima). Primero el plan; Enter lo hace.
import React, { useEffect, useState } from 'react';
import { client } from '../net/client';
import { SFX } from '../audio/sound';
import { t } from '@shared/language';
import { Device, Keys, closePanel, useKeys } from './device';
import { knowTasks, useColorsTasks } from './tasks';
import { TaskMark } from './windows';

interface Step { task: string; prs: string[]; where: string; create: boolean; main: boolean; conversation: boolean }
interface Row { roomId: string; room: string; repo?: string; steps: Step[]; done?: string[] }

export function OrganizeRooms({ roomId, goBack = closePanel }: { roomId?: string; goBack?: () => void }) {
  const [data, setData] = useState<{ demo?: boolean; rooms: Row[] } | null>(null);
  const [state, setState] = useState<'plan' | 'haciendo' | 'hecho'>('plan');
  const [error, setError] = useState('');
  useEffect(() => { client.action<any>('room.organize', { roomId, apply: false }, 60_000).then(setData).catch(e => setError(e.message)); }, [roomId]);
  const withTasks = (data?.rooms ?? []).filter(s => s.steps.length);
  useColorsTasks();
  useEffect(() => knowTasks(withTasks.flatMap(s => s.steps.map(p => p.task.replace(/^PR #/, 'PR-')))), [data]);
  const makeThat = withTasks.some(s => s.steps.some(p => p.create || !p.conversation));
  const act = () => {
    if (!makeThat || state !== 'plan' || data?.demo) { SFX.notAllowed(); return; }
    setState('haciendo'); SFX.click();
    client.action<any>('room.organize', { roomId, apply: true }, 180_000).then(d => { setData(d); setState('hecho'); SFX.shortSuccess(); }).catch(e => { setError(e.message); setState('plan'); SFX.notAllowed(); });
  };
  useKeys(e => {
    if (e.code === 'Escape') goBack();
    else if (e.code === 'Enter' || e.code === 'KeyE') { if (state === 'hecho') goBack(); else act(); }
  }, [state, data, makeThat]);
  return (
    <Device label={(roomId ? t('panels.organizeTheRoomByTasks') : t('panels.organizeTheRoomsByTasks2')) + (data?.demo ? ' · DEMO' : '')} width={84} onClose={goBack}>
      <p className="voz">{t('panels.oneWorktreePerTaskWith')}</p>
      {error && <p className="aviso-consola">{error}</p>}
      {data?.demo && <p className="tenue">{t('panels.demoConnectGithubInThe')}</p>}
      {!data && !error && <p className="tenue">{t('panels.readingYourOpenPullRequests')}</p>}
      <div className="lista-desplazable organizar">
        {withTasks.map(s => (
          <section key={s.roomId}>
            <h3>{s.room} <span className="tenue">{s.repo}</span></h3>
            <ul>
              {s.steps.map(p => (
                <li key={p.task}>
                  <TaskMark taskKey={p.task.replace(/^PR #/, 'PR-')} /><b className="ident">{p.task}</b> <span className="tenue">→ {p.main ? t('panels.theMainCopyItsBranch') : p.create ? t('panels.newWorktreeDonde', { donde: p.where }) : t('panels.itsWorktreeDonde', { donde: p.where })} · {p.conversation ? t('panels.alreadyHasAConversation') : t('panels.newConversation')}</span>
                  <small className="tenue">{p.prs.join(' → ')}</small>
                </li>
              ))}
            </ul>
            {s.done && <ul className="hecho">{s.done.map((h, k) => <li key={k}>✓ {h}</li>)}</ul>}
          </section>
        ))}
        {data && !withTasks.length && <p className="tenue">{roomId ? t('panels.thisRoomHasNoUnmerged') : t('panels.noRoomHasUnmergedPull')}</p>}
        {data && !roomId && data.rooms.some(s => !s.steps.length) && <p className="tenue">{t('panels.noOpenPrs')} {data.rooms.filter(s => !s.steps.length).map(s => s.room).join(', ')}.</p>}
      </div>
      {state === 'haciendo' && <p className="tenue">{t('panels.creatingWorktreesAndStartingConversations')}</p>}
      {state === 'plan' && makeThat && !data?.demo && <div className="botonera"><button className="boton-taller" onClick={act}>{t('panels.enterOrganize')}</button></div>}
      <Keys>{state === 'hecho' ? <><kbd>Enter</kbd>{t('menu.close')} </> : makeThat && !data?.demo ? <><kbd>Enter</kbd>{t('panels.organize')} </> : null}<kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}
