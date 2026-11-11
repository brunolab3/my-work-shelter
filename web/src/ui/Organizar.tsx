// Organizar las salas por tareas (server/organizar.ts): cada sala de repo, un worktree por cada tarea con PR tuyos sin
// fusionar y en cada uno su propia conversación con el habitante, que trabaja sus PR de uno en uno (si van apilados,
// rebasando los de encima). Primero el plan; Enter lo hace.
import React, { useEffect, useState } from 'react';
import { cliente } from '../red/cliente';
import { SFX } from '../audio/sonido';
import { t } from '@shared/idioma';
import { Device, Keys, closePanel, useKeys } from './aparato';
import { taskColor } from '@shared/tareas';
import { knowTasks, useColorsTasks } from './tareas';

interface Step { tarea: string; prs: string[]; donde: string; crear: boolean; principal: boolean; conversation: boolean }
interface Row { salaId: string; sala: string; repo?: string; pasos: Step[]; hecho?: string[] }

export function OrganizeRooms({ salaId, volver = closePanel }: { salaId?: string; volver?: () => void }) {
  const [datos, setDatos] = useState<{ demo?: boolean; salas: Row[] } | null>(null);
  const [estado, setState] = useState<'plan' | 'haciendo' | 'hecho'>('plan');
  const [error, setError] = useState('');
  useEffect(() => { cliente.accion<any>('sala.organizar', { salaId, aplicar: false }, 60_000).then(setDatos).catch(e => setError(e.message)); }, [salaId]);
  const withTasks = (datos?.salas ?? []).filter(s => s.pasos.length);
  useColorsTasks();
  useEffect(() => knowTasks(withTasks.flatMap(s => s.pasos.map(p => p.tarea.replace(/^PR #/, 'PR-')))), [datos]);
  const makeThat = withTasks.some(s => s.pasos.some(p => p.crear || !p.conversation));
  const hacer = () => {
    if (!makeThat || estado !== 'plan' || datos?.demo) { SFX.noAllowed(); return; }
    setState('haciendo'); SFX.clic();
    cliente.accion<any>('sala.organizar', { salaId, aplicar: true }, 180_000).then(d => { setDatos(d); setState('hecho'); SFX.shortSuccess(); }).catch(e => { setError(e.message); setState('plan'); SFX.noAllowed(); });
  };
  useKeys(e => {
    if (e.code === 'Escape') volver();
    else if (e.code === 'Enter' || e.code === 'KeyE') { if (estado === 'hecho') volver(); else hacer(); }
  }, [estado, datos, makeThat]);
  return (
    <Device rotulo={(salaId ? t('panels.organizeTheRoomByTasks') : t('panels.organizeTheRoomsByTasks2')) + (datos?.demo ? ' · DEMO' : '')} ancho={84} onClose={volver}>
      <p className="voz">{t('panels.oneWorktreePerTaskWith')}</p>
      {error && <p className="aviso-consola">{error}</p>}
      {datos?.demo && <p className="tenue">{t('panels.demoConnectGithubInThe')}</p>}
      {!datos && !error && <p className="tenue">{t('panels.readingYourOpenPullRequests')}</p>}
      <div className="lista-desplazable organizar">
        {withTasks.map(s => (
          <section key={s.salaId}>
            <h3>{s.sala} <span className="tenue">{s.repo}</span></h3>
            <ul>
              {s.pasos.map(p => (
                <li key={p.tarea}>
                  <span className="marca-tarea" style={{ '--tarea': taskColor(p.tarea.replace(/^PR #/, 'PR-')) } as React.CSSProperties} /><b className="ident">{p.tarea}</b> <span className="tenue">→ {p.principal ? t('panels.theMainCopyItsBranch') : p.crear ? t('panels.newWorktreeDonde', { donde: p.donde }) : t('panels.itsWorktreeDonde', { donde: p.donde })} · {p.conversation ? t('panels.alreadyHasAConversation') : t('panels.newConversation')}</span>
                  <small className="tenue">{p.prs.join(' → ')}</small>
                </li>
              ))}
            </ul>
            {s.hecho && <ul className="hecho">{s.hecho.map((h, k) => <li key={k}>✓ {h}</li>)}</ul>}
          </section>
        ))}
        {datos && !withTasks.length && <p className="tenue">{salaId ? t('panels.thisRoomHasNoUnmerged') : t('panels.noRoomHasUnmergedPull')}</p>}
        {datos && !salaId && datos.salas.some(s => !s.pasos.length) && <p className="tenue">{t('panels.noOpenPrs')} {datos.salas.filter(s => !s.pasos.length).map(s => s.sala).join(', ')}.</p>}
      </div>
      {estado === 'haciendo' && <p className="tenue">{t('panels.creatingWorktreesAndStartingConversations')}</p>}
      {estado === 'plan' && makeThat && !datos?.demo && <div className="botonera"><button className="boton-taller" onClick={hacer}>{t('panels.enterOrganize')}</button></div>}
      <Keys>{estado === 'hecho' ? <><kbd>Enter</kbd>{t('menu.close')} </> : makeThat && !datos?.demo ? <><kbd>Enter</kbd>{t('panels.organize')} </> : null}<kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}
