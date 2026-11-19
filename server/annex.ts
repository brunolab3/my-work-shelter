// Lo que se añade al prompt de sistema de cada habitante (server/sessions.ts): se carga en cada conversación, así que
// es corto y solo lleva lo que el juego no puede hacer por sí mismo. Su tamaño lo vigila test/context.test.ts.
import { t } from '../shared/language.ts';
import { isLeisureRoom } from '../shared/sectors.ts';

export const ANNEX = [
  'You are being driven from «work-shelter», a vault-management game UI where the user (the Overseer) talks to you through a dweller character.',
  'Your final message of each turn is shown in an in-world speech panel that the user can expand, so open it with a one-line summary of the outcome.',
  'To share a file (an HTML page, a screenshot, a PDF, a report), write its absolute path as a Markdown link: the game opens it when clicked, so never say a file could not be shared.',
  'When the next step waits on the user (approve a push, post review comments or replies, make a commit, send or publish something, pick between options), ask it with the AskUserQuestion tool instead of ending the turn with a statement.',
  'When this work depends on or affects another room\'s repository (an API, a shared contract, a bug on their side), tell that room with `send_to_room` instead of changing it yourself.',
  'Run parallel work (another task, or a part of this one) with `send_to_room` and its task key, also to this same room, not with background subagents; keep those for quick research.',
  'When you run inside a worktree and all of its work is merged (every branch and pull request in it merged or closed, or pushed to the main branch, not just the first),',
  'as the last step, without waiting to be asked, call `request_worktree_cleanup`.',
].join(' ');

// el habitante del Puente de Mando trabaja en el repo del propio juego: cómo se aplican los cambios lo dice AGENTS.md;
// aquí solo los nombres de los botones en el idioma del Supervisor
export const bridgeAnnex = () => [
  `This repository IS the game you are being driven from. When you finish changes, tell the user how to apply them (AGENTS.md), naming «${t('panels.applyTheGameSChanges')}» and «${t('menu.restartTheGame')}».`,
  'Never ask them to clear caches, reopen or reinstall the app: if something would not update, fix that in the game.',
].join(' ');

// La Octocat, en Control de Versiones, trabaja con git y GitHub en todos los repos del refugio (su carpeta es una propia)
export const annexGit = (repos: string[]) => [
  `You live in the «${t('world.versionControl')}» room, the git and GitHub room of the game. The user's repositories in the game are:`, (repos.join(', ') || 'none yet') + '.',
  'Work on them with git and gh when asked. Never force-push to a main branch; ask before pushing, opening or merging pull requests, or publishing anything.',
].join(' ');

// claude.ai skills that can't work in a dweller (they need the Claude desktop app or are about importing memory from
// another assistant): hidden from every dweller session with skillOverrides, so they don't take context. The user's
// own sessions outside the game keep them.
export const HIDDEN_SKILLS = ['anthropic-skills:built-in-browser', 'anthropic-skills:computer-use', 'anthropic-skills:import-memory'];

// Rooms whose dwellers don't need the user's claude.ai work connectors (Jira, Datadog, Slack…): the Command Bridge works
// on the game's own code and the leisure floor is for fun. Turned off there with disableClaudeAiConnectors, which saves
// their tool lists in every conversation of those rooms; the other rooms keep them.
export const withoutWorkConnectors = (roomId: string) => roomId === 'puente' || isLeisureRoom(roomId);
