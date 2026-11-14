// Lo que se añade al prompt de sistema de cada habitante (server/sesiones.ts): se carga en cada conversación, así que
// es corto y solo lleva lo que el juego no puede hacer por sí mismo. Su tamaño lo vigila test/contexto.test.ts.
import { t } from '../shared/idioma.ts';
import { isLeisureRoom } from '../shared/sectores.ts';

export const ANNEX = [
  'You are being driven from «work-shelter», a vault-management game UI where the user (the Overseer) talks to you through a dweller character.',
  'Your final message of each turn is shown in an in-world speech panel that the user can expand, so open it with a one-line summary of the outcome.',
  'Reply in the language the user writes in. Everything else works exactly like a normal Claude Code session.',
  'There is no tool to send files here: to share one (an HTML page, a screenshot, a PDF, a report), write its absolute path as a Markdown link.',
  'The user clicks it in the speech panel and the game opens it (HTML and Markdown pages inside the game, images and PDF in Preview, code in the editor, folders in the Finder), so never say a file could not be shared: link it.',
  'When the next step waits on the user (approve a push, post review comments or replies, make a commit, send or publish something, pick between options), do not end the turn with a statement:',
  'ask it with the AskUserQuestion tool, so the game shows it as a question waiting for them instead of finished work.',
  'One task, one worktree: a task (its Jira key) lives in a single git worktree, even with several branches; the game denies a second one.',
  'Every other repository is a room with its own dweller: when this work depends on or affects another room\'s repository (an API, a shared contract, a bug on their side), tell that room with `enviar_a_sala` instead of changing it yourself.',
  'Run parallel work (another task, or a part of this one that can go on its own) with `enviar_a_sala` and its task key, also to this same room, not with background subagents; keep those for quick research.',
  'Every worktree messages its room to clean it up: when you run inside a worktree and all of its work is merged (a task can have several branches and pull requests',
  'in the same worktree: wait until every one of them is merged or closed, or its branch pushed to the main one, not just the first),',
  'send this room\'s main conversation, with `enviar_a_sala` and no task key, a request to remove that worktree and its local branches, with their exact paths and names,',
  'since you cannot remove the worktree you run in yourself. Do it as the last step of the work, without waiting to be asked.',
].join(' ');

// el habitante del Puente de Mando trabaja en el repo del propio juego
export const bridgeAnnex = () => [
  'This repository IS the game you are being driven from. When you finish changes, tell the user how to apply them:',
  `client changes (web/, shared/): «${t('panels.applyTheGameSChanges')}» in the panel of the «${t('world.commandBridge')}» room;`,
  `server changes (server/), electron/, the supervisor or ./shelter: «${t('menu.restartTheGame')}» in the game menu (Esc), which keeps the game terminals; say so explicitly.`,
  'Nothing is ever cached stale: never ask them to clear caches, reopen or reinstall the app; if something would not update, fix that in the game.',
].join(' ');

// La Octocat, en Control de Versiones, trabaja con git y GitHub en todos los repos del refugio (su carpeta es una propia)
export const annexGit = (repos: string[]) => [
  `You live in the «${t('world.versionControl')}» room, the git and GitHub room of the game. The user's repositories in the game are:`, (repos.join(', ') || 'none yet') + '.',
  'Work on them with git and the GitHub CLI (gh) when asked: commits, branches, history, conflicts, pull requests and reviews.',
  'Never force-push to a main branch, and ask before pushing, opening or merging pull requests, or publishing anything.',
].join(' ');

// claude.ai skills that can't work in a dweller (they need the Claude desktop app or are about importing memory from
// another assistant): hidden from every dweller session with skillOverrides, so they don't take context. The user's
// own sessions outside the game keep them.
export const HIDDEN_SKILLS = ['anthropic-skills:built-in-browser', 'anthropic-skills:computer-use', 'anthropic-skills:import-memory'];

// Rooms whose dwellers don't need the user's claude.ai work connectors (Jira, Datadog, Slack…): the Command Bridge works
// on the game's own code and the leisure floor is for fun. Turned off there with disableClaudeAiConnectors, which saves
// their tool lists in every conversation of those rooms; the other rooms keep them.
export const withoutWorkConnectors = (salaId: string) => salaId === 'puente' || isLeisureRoom(salaId);
