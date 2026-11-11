// Copias holográficas (worktrees) como interlocutores propios: cada copia tiene su intercomunicador, independiente
// del de su autor, como un clon. Lo que se trabaja dentro de un worktree es de su copia; lo demás, del habitante.
import type { InfoWorktree, SessionSummary } from '@shared/protocolo';
import { vivo } from '../red/cliente';
import { t } from '@shared/idioma';
import { juego, type DwellerSummary } from './estadoJuego';

const PREFIX = 'holo:';
export const idCopy = (ruta: string) => PREFIX + ruta;
export const isCopy = (id: string | null | undefined) => !!id?.startsWith(PREFIX);
export const rutaDeCopia = (id: string) => id.slice(PREFIX.length);

/** Ruta del worktree que contiene `cwd` (de los conocidos o, recién creado por Claude Code, por la forma de su ruta). */
export function pathWorktree(cwd: string | undefined, conocidos: InfoWorktree[]): string | undefined {
  if (!cwd) return;
  for (const w of conocidos) if (!w.principal && (cwd === w.ruta || cwd.startsWith(w.ruta + '/'))) return w.ruta;
  return /^(.*\/\.claude\/worktrees\/[^/]+)/.exec(cwd)?.[1];
}

export const worktreesKnown = (): InfoWorktree[] => Object.values(vivo.get().repos ?? {}).flatMap(r => r?.worktrees ?? []).filter(w => !w.principal);

/** De quién es una sesión: de la copia del worktree donde trabaja (si su holograma está en el refugio) o de su habitante. */
export function sessionOwner(s: SessionSummary, copias = juego.get().copias): string {
  const ruta = pathWorktree(s.cwd, worktreesKnown());
  return ruta && copias.some(c => c.id === idCopy(ruta)) ? idCopy(ruta) : s.dwellerId;
}

/** Habitante o copia holográfica con ese id. */
export const interlocutor = (id: string | null | undefined, e = juego.get()): DwellerSummary | undefined =>
  id ? e.habitantes.find(h => h.id === id) ?? e.copias.find(c => c.id === id) : undefined;

export function branchCaption(rama: string) { return (rama || t('windows.noBranch')).replace(/^(worktree-)?(shelter|refugio)-/, '').slice(0, 18) || rama; }
