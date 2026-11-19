// Worktrees como copias holográficas de quien los creó: inspeccionar (estado y commits), desechar (con lo que se pierde a la vista)
// e integrar (lo hace un habitante con sus permisos). Basado en code-town/server/worktrees.ts (MIT).
import { execFile } from 'node:child_process';
import type { Sessions } from './sessions.ts';
import type { InfoRepo } from '../shared/protocol.ts';
import type { Store } from './state.ts';
import { gitEnvironment } from './gitEnv.ts';
import { t } from '../shared/language.ts';

function git(cwd: string, args: string[], timeout = 15000): Promise<string> {
  return new Promise((res, rej) => execFile('git', ['-C', cwd, ...args], { timeout, maxBuffer: 8 * 1024 * 1024, env: gitEnvironment() }, (err, out, errOut) => err ? rej(new Error(String(errOut || err.message).trim())) : res(String(out))));
}

interface Ctx { sessions: Sessions; repos: Record<string, InfoRepo>; pathRoom: (r: string) => string | undefined; store: Store; terminals?: { openSessions(): { id: string; cwd: string }[] } }

export function busy(path: string, ctx: Ctx) {
  return ctx.sessions.list().some(s => s.state !== 'cerrada' && (s.cwd === path || s.cwd.startsWith(path + '/')));
}

export async function actionWorktree(name: string, d: Record<string, any>, ctx: Ctx) {
  const roomId = ctx.pathRoom(String(d.path));
  const room = ctx.store.state.rooms.find(s => s.id === roomId);
  if (!room?.path) throw new Error(t('server.thatWorktreeDoesNotBelong'));
  const wt = ctx.repos[room.id]?.worktrees.find(w => w.path === d.path);
  if (!wt || wt.main) throw new Error(t('server.iCannotFindThatWorktree'));
  const base = ctx.repos[room.id]?.worktrees.find(w => w.main)?.branch || 'main';
  switch (name) {
    case 'inspeccionar': {
      const [state, ignored, log] = await Promise.all([
        git(wt.path, ['status', '--short']),
        git(wt.path, ['status', '--porcelain', '--ignored', '--untracked-files=normal']).then(o => o.split('\n').filter(l => l.startsWith('!! ')).map(l => l.slice(3))),
        git(wt.path, ['log', '--oneline', '-n', '30', `${base}..HEAD`]).catch(() => ''),
      ]);
      return { path: wt.path, branch: wt.branch, base, state: state.split('\n').filter(Boolean), ignored, commits: log.split('\n').filter(Boolean), busy: busy(wt.path, ctx) };
    }
    case 'desechar': {
      if (busy(wt.path, ctx)) throw new Error(t('server.someoneIsWorkingInThere'));
      if (ctx.terminals?.openSessions().some(t => t.cwd === wt.path || t.cwd.startsWith(wt.path + '/'))) throw new Error(t('server.thereIsATerminalOpen'));
      // Claude Code deja bloqueados los worktrees que crea: se desbloquea y se fuerza dos veces (git lo exige con candado)
      await git(room.path, ['worktree', 'unlock', wt.path]).catch(() => '');
      try { await git(room.path, ['worktree', 'remove', ...(d.force ? ['--force', '--force'] : []), wt.path], 30000); }
      catch (e) {
        const m = (e as Error).message;
        if (/contains modified or untracked|is dirty/i.test(m)) throw new Error(t('server.theCopyHasUnsavedChanges'));
        if (/locked/i.test(m)) throw new Error(t('server.theCopyIsLockedBy'));
        throw new Error(t('server.couldNotDiscardCopy', { error: m.split('\n')[0] }));
      }
      await git(room.path, ['worktree', 'prune']).catch(() => '');
      if (wt.branch) await git(room.path, ['branch', d.force ? '-D' : '-d', wt.branch]).catch(() => '');
      return true;
    }
    case 'promptIntegrar':
      return t('prompt.merge.worktree', { rama: wt.branch ?? '', ruta: wt.path, base });
    default: throw new Error(t('server.unknownAction', { nombre: 'worktree.' + name }));
  }
}
