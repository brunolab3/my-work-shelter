// Worktrees como copias holográficas de quien los creó: inspeccionar (estado y commits), desechar (con lo que se pierde a la vista)
// e integrar (lo hace un habitante con sus permisos). Basado en code-town/server/worktrees.ts (MIT).
import { execFile } from 'node:child_process';
import type { Sessions } from './sesiones.ts';
import type { InfoRepo } from '../shared/protocolo.ts';
import type { Store } from './estado.ts';
import { entornoGit } from './entornoGit.ts';
import { t } from '../shared/idioma.ts';

function git(cwd: string, args: string[], timeout = 15000): Promise<string> {
  return new Promise((res, rej) => execFile('git', ['-C', cwd, ...args], { timeout, maxBuffer: 8 * 1024 * 1024, env: entornoGit() }, (err, out, errOut) => err ? rej(new Error(String(errOut || err.message).trim())) : res(String(out))));
}

interface Ctx { sesiones: Sessions; repos: Record<string, InfoRepo>; pathRoom: (r: string) => string | undefined; almacen: Store; terminales?: { abiertas(): { id: string; cwd: string }[] } }

export function ocupado(ruta: string, ctx: Ctx) {
  return ctx.sesiones.lista().some(s => s.estado !== 'cerrada' && (s.cwd === ruta || s.cwd.startsWith(ruta + '/')));
}

export async function actionWorktree(nombre: string, d: Record<string, any>, ctx: Ctx) {
  const salaId = ctx.pathRoom(String(d.ruta));
  const sala = ctx.almacen.estado.salas.find(s => s.id === salaId);
  if (!sala?.ruta) throw new Error(t('server.thatWorktreeDoesNotBelong'));
  const wt = ctx.repos[sala.id]?.worktrees.find(w => w.ruta === d.ruta);
  if (!wt || wt.principal) throw new Error(t('server.iCannotFindThatWorktree'));
  const base = ctx.repos[sala.id]?.worktrees.find(w => w.principal)?.rama || 'main';
  switch (nombre) {
    case 'inspeccionar': {
      const [estado, ignored, log] = await Promise.all([
        git(wt.ruta, ['status', '--short']),
        git(wt.ruta, ['status', '--porcelain', '--ignored', '--untracked-files=normal']).then(o => o.split('\n').filter(l => l.startsWith('!! ')).map(l => l.slice(3))),
        git(wt.ruta, ['log', '--oneline', '-n', '30', `${base}..HEAD`]).catch(() => ''),
      ]);
      return { ruta: wt.ruta, rama: wt.rama, base, estado: estado.split('\n').filter(Boolean), ignored, commits: log.split('\n').filter(Boolean), ocupado: ocupado(wt.ruta, ctx) };
    }
    case 'desechar': {
      if (ocupado(wt.ruta, ctx)) throw new Error(t('server.someoneIsWorkingInThere'));
      if (ctx.terminales?.abiertas().some(t => t.cwd === wt.ruta || t.cwd.startsWith(wt.ruta + '/'))) throw new Error(t('server.thereIsATerminalOpen'));
      // Claude Code deja bloqueados los worktrees que crea: se desbloquea y se fuerza dos veces (git lo exige con candado)
      await git(sala.ruta, ['worktree', 'unlock', wt.ruta]).catch(() => '');
      try { await git(sala.ruta, ['worktree', 'remove', ...(d.forzar ? ['--force', '--force'] : []), wt.ruta], 30000); }
      catch (e) {
        const m = (e as Error).message;
        if (/contains modified or untracked|is dirty/i.test(m)) throw new Error(t('server.theCopyHasUnsavedChanges'));
        if (/locked/i.test(m)) throw new Error(t('server.theCopyIsLockedBy'));
        throw new Error('No he podido desechar la copia: ' + m.split('\n')[0]);
      }
      await git(sala.ruta, ['worktree', 'prune']).catch(() => '');
      if (wt.rama) await git(sala.ruta, ['branch', d.forzar ? '-D' : '-d', wt.rama]).catch(() => '');
      return true;
    }
    case 'promptIntegrar':
      return [
        `Integra la rama \`${wt.rama}\` (en el worktree \`${wt.ruta}\`) en \`${base}\` en este repositorio y luego limpia:`,
        '1. Si el worktree tiene cambios sin commitear, para y pregúntame qué hacer con ellos.',
        `2. Pon \`${base}\` al día si sigue a un remoto y fusiona \`${wt.rama}\`. Resuelve conflictos con cuidado y pregúntame si dudas.`,
        '3. Ejecuta las comprobaciones o tests del proyecto si los tiene.',
        `4. Elimina el worktree con \`git worktree remove ${wt.ruta}\` y borra la rama con \`git branch -d ${wt.rama}\`.`,
        'No hagas push salvo que te lo pida.',
      ].join('\n');
    default: throw new Error('Acción de worktree desconocida: ' + nombre);
  }
}
