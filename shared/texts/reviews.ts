// The Review room: others' PRs that ask for the Overseer's review (shared/reviews.ts, server/reviewRoom.ts,
// web/src/ui/Review.tsx) (catalogue: shared/texts.ts)
import type { LocalizedText } from '../language.ts';

export const REVIEWS: Record<string, LocalizedText> = {
  // board
  'reviews.title': { es: 'PR que esperan tu revisión', en: 'PRs awaiting your review' },
  'reviews.column.review': { es: 'Por revisar', en: 'To review' },
  'reviews.column.changes': { es: 'Cambios pedidos', en: 'Changes requested' },
  'reviews.column.approved': { es: 'Aprobados', en: 'Approved' },
  'reviews.reading': { es: 'Leyendo GitHub…', en: 'Reading GitHub…' },
  'reviews.noGithub': { es: 'Conecta GitHub en la Cámara acorazada para ver los PR que esperan tu revisión.', en: 'Connect GitHub in the Vault to see the PRs awaiting your review.' },
  'reviews.empty': { es: 'Nada aquí', en: 'Nothing here' },
  'reviews.open': { es: 'Revisar', en: 'Review' },
  'reviews.openHint': { es: 'Abre su revisión: una copia de cada PR y una conversación para todos (Enter)', en: 'Opens its review: a copy of each PR and one conversation for all of them (Enter)' },
  'reviews.continue': { es: 'Seguir revisando', en: 'Continue review' },
  'reviews.done': { es: 'Terminar revisión', en: 'Done with this review' },
  'reviews.doneHint': { es: 'Quita sus copias y su holograma; el PR sigue en el tablero', en: 'Removes its copies and its hologram; the PR stays on the board' },
  'reviews.openPR': { es: 'Abrir PR', en: 'Open PR' },
  'reviews.draft': { es: 'borrador', en: 'draft' },
  'reviews.byAuthor': { es: 'de {autor}', en: 'by {autor}' },
  'reviews.noRoom': { es: 'Sin sala en el refugio: se revisa solo con el diff', en: 'No room in the shelter: reviewed from the diff only' },
  'reviews.hologram': { es: 'Con holograma en la sala', en: 'With a hologram in the room' },
  'reviews.goToRoom': { es: 'Sala de Revisión', en: 'Review room' },
  'reviews.goToRoomHint': { es: 'Los PR de otros que esperan tu revisión', en: 'Other people\'s PRs awaiting your review' },
  'reviews.boardAction': { es: 'PR por revisar ({n})', en: 'PRs to review ({n})' },
  'reviews.screen': { es: 'REVISIÓN', en: 'REVIEW' },
  // server
  'reviews.notFound': { es: 'No encuentro la revisión {clave}: puede que ya no espere la tuya.', en: 'Can\'t find the review {clave}: it may no longer await yours.' },
  'reviews.couldNotCheckOut': { es: 'No pude sacar una copia del PR #{numero} de {repo}: {error}', en: 'Couldn\'t check out PR #{numero} of {repo}: {error}' },
  'reviews.closeConversationFirst': { es: 'La revisión {clave} tiene una conversación abierta: ciérrala y vuelve a terminarla.', en: 'The review {clave} has an open conversation: close it and finish it again.' },
  'reviews.workLeft': { es: 'La revisión {clave} ya no tiene PR que esperen la tuya, pero hay cambios en su copia ({donde}). ¿La quito igualmente?', en: 'The review {clave} has no PRs awaiting yours anymore, but its copy has changes ({donde}). Remove it anyway?' },
  'reviews.removeAnyway': { es: 'Quitarla', en: 'Remove it' },
  'reviews.keep': { es: 'Dejarla', en: 'Keep it' },
  'reviews.retired': { es: 'Revisión {clave} terminada: sus copias y su holograma se han ido.', en: 'Review {clave} done: its copies and its hologram are gone.' },
  // to the review's conversation
  'reviews.prompt': {
    es: `Revisión de {clave}: el Supervisor te pide revisar estos PR de otra persona. Cada uno tiene su copia (worktree, separado en su commit de cabeza; sin rama local) en una subcarpeta de esta:
{prs}

{jira}

Antes de revisar cada repo, lee su CLAUDE.md y su AGENTS.md (y lo que enlacen): son sus normas. Lee el diff contra su base (\`git diff origin/<base>...HEAD\` en su copia, o \`gh pr diff\`), la descripción y las conversaciones del PR (\`gh pr view --comments\`), y comprueba que cumple la tarea.
Prepara la revisión de cada PR: un resumen, los comentarios en línea (archivo:línea, con el porqué y una propuesta) y el veredicto (aprobar, pedir cambios o comentar). Enséñasela al Supervisor y pregúntale con AskUserQuestion antes de publicar nada: no publiques sin su sí.`,
    en: `Review of {clave}: the Overseer asks you to review these PRs by someone else. Each one has its copy (a worktree, detached at its head commit; no local branch) in a subfolder of this one:
{prs}

{jira}

Before reviewing each repo, read its CLAUDE.md and AGENTS.md (and what they link): they are its rules. Read the diff against its base (\`git diff origin/<base>...HEAD\` in its copy, or \`gh pr diff\`), the PR's description and conversations (\`gh pr view --comments\`), and check that it does the task.
Draft the review of each PR: a summary, the inline comments (file:line, with the why and a suggestion) and the verdict (approve, request changes or comment). Show it to the Overseer and ask with AskUserQuestion before posting anything: don't post without their yes.`,
  },
  'reviews.promptPR': { es: '- {repo}#{numero} «{titulo}», de {autor} ({url}): {base} ← {rama}. Copia: {donde}', en: '- {repo}#{numero} “{titulo}”, by {autor} ({url}): {base} ← {rama}. Copy: {donde}' },
  'reviews.promptNoWorktree': { es: 'ninguna (su repo no tiene sala en el refugio: revisa con `gh pr diff`)', en: 'none (its repo has no room in the shelter: review with `gh pr diff`)' },
  'reviews.promptJira': { es: 'La tarea en Jira, {clave} «{titulo}» (estado: {estado}; épica: {epica}):\n{descripcion}', en: 'The task in Jira, {clave} “{titulo}” (status: {estado}; epic: {epica}):\n{descripcion}' },
  'reviews.promptJiraRead': { es: 'La tarea es {clave}: lee el ticket con tu conector de Jira antes de revisar.', en: 'The task is {clave}: read the ticket with your Jira connector before reviewing.' },
  'reviews.promptNoTask': { es: 'Este PR no lleva clave de tarea: su descripción es todo el contexto.', en: 'This PR has no task key: its description is all the context.' },
  'reviews.update': { es: 'Novedades en la revisión de {clave}:\n{cambios}', en: 'News in the review of {clave}:\n{cambios}' },
  'reviews.newPR': { es: 'Nuevo PR de la tarea: {repo}#{numero} «{titulo}» ({url}). Copia: {donde}', en: 'New PR of the task: {repo}#{numero} “{titulo}” ({url}). Copy: {donde}' },
  'reviews.newCommits': { es: '{repo}#{numero} tiene commits nuevos ({antes} → {ahora}); su copia ya está en {ahora}. Revisa lo que cambia (`git diff {antes} {ahora}`).', en: '{repo}#{numero} has new commits ({antes} → {ahora}); its copy is already at {ahora}. Review what changes (`git diff {antes} {ahora}`).' },
  'reviews.newCommitsNotMoved': { es: '{repo}#{numero} tiene commits nuevos ({antes} → {ahora}), pero su copia tiene cambios tuyos y sigue en {antes}.', en: '{repo}#{numero} has new commits ({antes} → {ahora}), but its copy has changes of yours and stays at {antes}.' },
  'reviews.requestedAgain': { es: '{autor} vuelve a pedir tu revisión en {repo}#{numero}.', en: '{autor} asks for your review again on {repo}#{numero}.' },
  'reviews.prLeft': { es: '{repo}#{numero} ya no espera tu revisión (fusionado, cerrado o retirada la petición): su copia se ha quitado.', en: '{repo}#{numero} no longer awaits your review (merged, closed or request withdrawn): its copy has been removed.' },
};
