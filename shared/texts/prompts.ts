// Prompts a los habitantes (lo que reciben como mensaje del Supervisor), en los dos idiomas. Los nombres de las
// herramientas del juego (current_decor, assign_work…) no se traducen: son los de verdad.
import type { LocalizedText } from '../language.ts';

export const PROMPTS: Record<string, LocalizedText> = {
  // respuesta a una pregunta del habitante cuando el Supervisor la salta (web/src/ui/Dialog.tsx)
  'prompt.userPreferredNotToAnswer': { es: 'El usuario ha preferido no responder.', en: 'The user preferred not to answer.' },
  // «Adaptar la sala al repo» (server/roomDecor.ts)
  'prompt.adaptRoom': {
    es: 'Adapta tu sala del refugio a lo que hay en este repo. Mira el repo por encima (README, estructura, lenguaje, de qué va y para quién) y diseña una escena que lo cuente de un vistazo: la pieza protagonista, el atrezo, los carteles y las pantallas, con los colores y la luz que le peguen. Hazlo con las herramientas del juego: primero current_decor (trae la guía y cómo está la sala), luego props_catalogue para elegir piezas, apply_decor para montarla y view_room para comprobar cómo queda; corrige hasta que te guste (cuatro o cinco vueltas como mucho). No cambies ningún archivo del repo: esto es solo decorar la sala. Al terminar, cuéntame en dos o tres líneas qué has montado y por qué.',
    en: 'Adapt your shelter room to what is in this repo. Skim the repo (README, structure, language, what it is about and who it is for) and design a scene that tells it at a glance: the centrepiece, the props, the signs and the screens, with colours and lighting that fit. Use the game tools: first current_decor (it brings the guide and the current state of the room), then props_catalogue to pick pieces, apply_decor to build it and view_room to check how it looks; fix it until you like it (four or five rounds at most). Do not change any file in the repo: this is only about decorating the room. When you finish, tell me in two or three lines what you built and why.',
  },
  // al sacar una conversación a mitad de trabajo a una terminal (server/desktop.ts)
  'prompt.continueOutside': {
    es: 'Sigue con lo que estabas haciendo: te he sacado del refugio a esta terminal a mitad de trabajo.',
    en: 'Carry on with what you were doing: I moved you out of the shelter to this terminal halfway through.',
  },
  // conversación de una tarea con PR (server/organize.ts)
  'prompt.task.title.one': { es: '{tarea} · tu PR abierto en {repo}', en: '{tarea} · your open PR in {repo}' },
  'prompt.task.title.many': { es: '{tarea} · tus {n} PR abiertos en {repo}', en: '{tarea} · your {n} open PRs in {repo}' },
  'prompt.task.onlyThis': { es: 'Este worktree es solo de esta tarea{clave}: aquí se trabajan sus PR, y ningún otro.', en: 'This worktree is only for this task{clave}: its PRs are worked on here, and no others.' },
  'prompt.task.stacked': { es: 'Van apilados, de la base hacia arriba:', en: 'They are stacked, from the base up:' },
  'prompt.task.these': { es: 'Son estos:', en: 'These are they:' },
  'prompt.task.pr': { es: '{i}. #{numero} «{titulo}» · rama `{rama}`{base} · {estado} · {url}', en: '{i}. #{numero} “{titulo}” · branch `{rama}`{base} · {estado} · {url}' },
  'prompt.task.onTopOf': { es: ' sobre `{base}`', en: ' on top of `{base}`' },
  'prompt.task.howTo': {
    es: 'Cómo trabajar:\n- Primero revisa cada PR (CI, revisiones y comentarios sin resolver: `gh pr view`, `gh pr checks`) y propónme un plan por PR, en orden.\n- De uno en uno, nunca varios a la vez: haz checkout de la rama del PR, arréglalo, haz commit y solo entonces pasa al siguiente.',
    en: 'How to work:\n- First review each PR (CI, reviews and unresolved comments: `gh pr view`, `gh pr checks`) and propose a plan per PR, in order.\n- One at a time, never several at once: check out the PR branch, fix it, commit and only then move on to the next.',
  },
  'prompt.task.rebase': { es: '- Después de cambiar uno, rebasa los de encima sobre él, en orden, antes de tocarlos. Si hay conflictos, para y pregúntame.', en: '- After changing one, rebase the ones above it onto it, in order, before touching them. If there are conflicts, stop and ask me.' },
  'prompt.task.noPush': { es: '- No hagas push ni contestes en GitHub sin que te lo apruebe. Las revisiones nuevas de estos PR te llegarán aquí.', en: '- Do not push or reply on GitHub without my approval. New reviews of these PRs will reach you here.' },
  // parte de un plan repartido a una sala (server/dispatch.ts)
  'prompt.job.partOf': { es: 'Este trabajo es una parte de un plan coordinado desde la sala «{sala}»{tarea}.', en: 'This work is one part of a plan coordinated from the “{sala}” room{tarea}.' },
  'prompt.job.forTask': { es: ' para la tarea {clave}', en: ' for task {clave}' },
  'prompt.job.others': { es: 'En paralelo, otras salas se ocupan de: {otros}. Si necesitas algo de ellas, dímelo en vez de tocar su repo.', en: 'In parallel, other rooms are handling: {otros}. If you need something from them, tell me instead of touching their repo.' },
  'prompt.job.after': { es: 'Tu parte se fusiona después de la de {salas}: puede depender de lo suyo, pero no al revés.', en: 'Your part is merged after {salas}: it can depend on theirs, but not the other way round.' },
  'prompt.job.sharedPlan': { es: 'El plan entero es compartido (plan {plan}): léelo con shared_plan antes de empezar. Si cambia, te llegará un aviso: vuelve a leerlo y ajusta tu parte. Si ves que hay que cambiarlo, propónlo con propose_plan_change en vez de desviarte por tu cuenta.', en: 'The whole plan is shared (plan {plan}): read it with shared_plan before starting. If it changes you will get a notice: read it again and adjust your part. If you think it needs changing, propose it with propose_plan_change instead of going your own way.' },
  'prompt.job.worktree': { es: 'Trabajas en un worktree propio de este repo: haz commits en su rama. No hagas push ni abras pull requests salvo que te lo pida.', en: 'You work in a worktree of your own for this repo: commit on its branch. Do not push or open pull requests unless I ask you to.' },
  // mensaje de otra sala (server/roomNotices.ts)
  'prompt.room.from': { es: '📨 Mensaje de la sala «{sala}» ({habitante}){tarea}:', en: '📨 Message from the “{sala}” room ({habitante}){tarea}:' },
  'prompt.room.task': { es: ', tarea {clave}', en: ', task {clave}' },
  'prompt.room.thread': { es: ', hilo {hilo}', en: ', thread {hilo}' },
  'prompt.cleanup.request': { es: 'El trabajo del worktree {ruta} (rama {rama}) está todo mergeado. {merge}Quita el worktree y su rama local {rama}, desde la copia principal. Si algo no está mergeado o hay cambios sin commit, no fuerces: dímelo.', en: 'All the work in the worktree {ruta} (branch {rama}) is merged. {merge}Remove the worktree and its local branch {rama}, from the main copy. If anything is not merged or there are uncommitted changes, do not force it: tell me.' },
  'prompt.cleanup.mergeLocal': { es: 'Primero junta {rama} en la rama `local`. ', en: 'First merge {rama} into the `local` branch. ' },
  'prompt.room.outside': { es: 'Es una petición de fuera de lo que estás haciendo: atiéndela, contesta en breve a quien la envía y sigue con lo tuyo.', en: 'This is a request from outside what you are doing: handle it, reply briefly to the sender and carry on with your work.' },
  'prompt.room.replyKey': { es: ' y key «{clave}»', en: ' and key “{clave}”' },
  'prompt.room.reply': { es: '(Si aún le debes a quien te escribió un resultado, o un bloqueo o una pregunta que tenga que contestar esa sala, usa send_to_room con room «{salaId}»{clave}: le llega a la conversación que te escribió. Las decisiones del Overseer (aprobaciones, elecciones, OKs) se le piden solo en tu conversación, con AskUserQuestion: no se las pases a quien te escribió, ni avisos de «esperando al Overseer», ni se las vuelvas a pedir si te llega uno. No envíes acuses de recibo ni confirmaciones, ni avisos de «hecho» a quien ya terminó.)', en: '(If you still owe the sender a result, or a blocker or question that the sender itself must answer, use send_to_room with room “{salaId}”{clave}: it reaches the conversation that wrote to you. The Overseer\'s decisions (approvals, choices, OKs) are asked only in your own conversation, with AskUserQuestion: do not pass them, or “waiting for the Overseer” notes, to the sender, nor ask them again when one reaches you. Do not send receipts or acknowledgments, nor “done” notes to a sender that has finished.)' },
  // mensaje programado que llega a su hora (server/scheduled.ts)
  'prompt.scheduled.title': { es: '⏰ Programado el {creado}:', en: '⏰ Scheduled on {creado}:' },
  'prompt.scheduled.late': { es: '(llega con retraso: tocaba el {cuando} y el juego estaba cerrado)', en: '(late: it was due {cuando} and the game was closed)' },
  // a conversation stopped by the usage limit, resumed once it renews (server/limitResume.ts)
  'prompt.limitResume': { es: 'El límite de uso de Claude se ha renovado: sigue donde lo dejaste.', en: 'The Claude usage limit has renewed: continue where you left off.' },
  'prompt.scheduled.overseer': { es: '⏳ El Supervisor te dejó esto el {creado} como trabajo de fondo (no urgente; nadie mira ahora: trabaja solo y deja el resultado listo para revisar):', en: '⏳ The Overseer left this for you on {creado} as background work (not urgent; nobody is watching now: work on your own and leave the result ready to review):' },
  // a PR's CI failures and reviews packed while its conversation was busy or its checks ran (server/scheduled.ts: pack)
  'prompt.packed.title': { es: '📦 {n} avisos de {pr}, juntados mientras estabas ocupado o su CI seguía en marcha (en el orden en que llegaron):', en: '📦 {n} notices about {pr}, packed while you were busy or its CI was still running (in the order they came):' },
  // revisión nueva de un PR (server/prReviews.ts)
  'prompt.review.title': { es: '🔎 {clave}Revisión nueva en tu PR #{numero} de {repo} («{titulo}»), rama `{rama}`: {url}', en: '🔎 {clave}New review on your PR #{numero} in {repo} (“{titulo}”), branch `{rama}`: {url}' },
  'prompt.review.changesRequested': { es: 'pide cambios', en: 'requests changes' },
  'prompt.review.commented': { es: 'deja una revisión', en: 'leaves a review' },
  'prompt.review.approvedWithNote': { es: 'aprueba, con una nota', en: 'approves, with a note' },
  'prompt.review.reviews': { es: 'revisa', en: 'reviews' },
  'prompt.review.onLine': { es: 'comenta en `{lugar}`', en: 'comments on `{lugar}`' },
  'prompt.review.onConversation': { es: 'comenta en la conversación', en: 'comments on the conversation' },
  'prompt.review.more': { es: '…y {n} más: míralos en el PR.', en: '…and {n} more: see them on the PR.' },
  'prompt.review.ledger': { es: '📒 Cuenta del PR: {hilos} hilos sin resolver{viejos} y {resumenes} resúmenes de revisión sin respuesta tuya.', en: '📒 PR ledger: {hilos} unresolved threads{viejos} and {resumenes} review summaries without a reply from you.' },
  'prompt.review.ledgerOutdated': { es: ' (de ellos, {n} desfasados: el código cambió, pero hay que contestarlos o resolverlos igual)', en: ' ({n} of them outdated: the code changed, but they still need a reply or to be resolved)' },
  'prompt.review.ledgerClear': { es: '📒 Cuenta del PR: ningún hilo sin resolver ni resumen sin respuesta.', en: '📒 PR ledger: no unresolved threads and no unanswered review summaries.' },
  'prompt.review.ledgerRule': { es: 'Atiende cada hilo (arréglalo o contesta en él) y contesta cada resumen de revisión (citándolo o nombrando a quien lo hizo) antes de descartar una revisión o volver a pedirla.', en: 'Address every thread (fix it or reply on it) and answer every review summary (quoting it or mentioning its reviewer) before dismissing a review or re-requesting one.' },
  'prompt.review.ask': { es: 'Analiza cada comentario con el código de este worktree y propón al Supervisor un plan: qué arreglarías (y cómo), qué no y por qué, y qué contestarías en cada hilo (con el texto de la respuesta). No cambies código, no hagas push ni contestes en GitHub hasta que el Supervisor apruebe el plan.', en: 'Analyse each comment against the code in this worktree and propose a plan to the Overseer: what you would fix (and how), what not and why, and what you would reply on each thread (with the text of the reply). Do not change code, push or reply on GitHub until the Overseer approves the plan.' },
  'prompt.ci.title': { es: '🚨 {clave}La CI falla en tu PR #{numero} de {repo} («{titulo}»), rama `{rama}`, commit `{commit}`: {url}', en: '🚨 {clave}CI is failing on your PR #{numero} in {repo} (“{titulo}”), branch `{rama}`, commit `{commit}`: {url}' },
  'prompt.ci.noDetail': { es: '(GitHub no dice qué check falla: míralo en el PR.)', en: '(GitHub does not say which check fails: see the PR.)' },
  'prompt.ci.blocks': { es: 'Bloquea: {prs} (esperan a este PR; no fallan ellos).', en: 'Blocks: {prs} (they wait for this PR; they are not failing themselves).' },
  'prompt.ci.log': { es: 'Final del log de lo que falló (`gh run view --log-failed`):', en: 'Tail of the failed log (`gh run view --log-failed`):' },
  'prompt.ci.ask': { es: 'Averigua la causa con el código de este worktree (el log completo, con `gh run view --log-failed`) y propón al Supervisor un plan: qué arreglarías y cómo, o por qué no es de este PR (un test inestable, otro repo). No cambies código ni hagas push hasta que el Supervisor apruebe el plan.', en: 'Find the cause with the code in this worktree (the full log, with `gh run view --log-failed`) and propose a plan to the Overseer: what you would fix and how, or why it is not this PR (a flaky test, another repo). Do not change code or push until the Overseer approves the plan.' },
  // planificar una tarea de Jira (shared/board.ts)
  'prompt.plan.priority': { es: 'prioridad {p}', en: 'priority {p}' },
  'prompt.plan.intro': { es: 'Planifica esta tarea de Jira ({url}){datos}. Todavía no ha empezado.', en: 'Plan this Jira task ({url}){datos}. It has not started yet.' },
  'prompt.plan.description': { es: 'Descripción:\n\n{texto}', en: 'Description:\n\n{texto}' },
  'prompt.plan.noDescription': { es: 'No tengo su descripción: léela en Jira si tienes cómo, o pídemela.', en: 'I do not have its description: read it in Jira if you can, or ask me for it.' },
  'prompt.plan.steps': {
    es: 'Desde aquí ves todos los repos. Antes de tocar nada:\n1. Entiende la tarea y busca en los repos qué hay que cambiar y dónde. Pregúntame lo que no esté claro.\n2. Mira con shelter_rooms qué repos tienen sala en el refugio.\n3. Propónme un plan por repo: qué cambia en cada uno, en qué orden y lo que comparten (contratos, APIs, migraciones).\n4. Cuando lo apruebe, repártelo con assign_work: un trabajo por sala, con instrucciones que basten por sí solas, y la clave de la tarea.\nNo edites los repos desde aquí: cada sala trabaja en su worktree.',
    en: 'From here you can see every repo. Before touching anything:\n1. Understand the task and look in the repos for what needs to change and where. Ask me about anything unclear.\n2. Check with shelter_rooms which repos have a room in the shelter.\n3. Propose a plan per repo: what changes in each, in what order and what they share (contracts, APIs, migrations).\n4. Once I approve it, hand it out with assign_work: one job per room, with instructions that stand on their own, and the task key.\nDo not edit the repos from here: each room works in its own worktree.',
  },
  // plan de despliegue (shared/deploy.ts)
  'prompt.deploy.title': { es: 'Plan de despliegue de mis pull requests', en: 'Deployment plan for my pull requests' },
  'prompt.deploy.steps': {
    es: 'Desde aquí ves todos los repos. Propónme un plan de despliegue:\n1. Revisa el orden de arriba: ¿falta algún bloqueo (contratos entre repos, migraciones, configuración, feature flags)? Los PR de una misma tarea en repos distintos sin orden conocido: dime cuál va primero. Mira el código si hace falta.\n2. Dime qué le falta a cada PR para poder fusionarse (revisión, CI, conflictos) y quién o qué lo desbloquea.\n3. Dame los pasos en orden: qué se fusiona y despliega junto, qué hay que comprobar entre un paso y el siguiente y cómo se vuelve atrás.\nNo fusiones, no despliegues ni toques los repos: solo el plan.',
    en: 'From here you can see every repo. Propose a deployment plan:\n1. Review the order above: is any blocker missing (contracts between repos, migrations, configuration, feature flags)? For PRs of the same task in different repos with no known order, tell me which goes first. Look at the code if needed.\n2. Tell me what each PR still needs before it can be merged (review, CI, conflicts) and who or what unblocks it.\n3. Give me the steps in order: what is merged and deployed together, what to check between one step and the next, and how to roll back.\nDo not merge, deploy or touch the repos: just the plan.',
  },
  'prompt.deploy.pending': { es: 'Pull requests pendientes, por orden posible de despliegue (cada ola espera a las anteriores):', en: 'Pending pull requests, in possible deployment order (each wave waits for the previous ones):' },
  'prompt.deploy.wave': { es: 'Ola {n}:', en: 'Wave {n}:' },
  'prompt.deploy.cycle': { es: 'En un ciclo de bloqueos (hay que romperlo):', en: 'In a blocking cycle (it has to be broken):' },
  'prompt.deploy.merged': { es: 'Ya fusionados (últimas dos semanas):', en: 'Already merged (last two weeks):' },
  'prompt.deploy.mergedMark': { es: ' (fusionado)', en: ' (merged)' },
  'prompt.deploy.waitsFor': { es: ' · espera a {prs}', en: ' · waits for {prs}' },
  'prompt.deploy.ledger': { es: ' · revisiones por contestar: {hilos} hilos sin resolver, {resumenes} resúmenes sin respuesta', en: ' · reviews to answer: {hilos} unresolved threads, {resumenes} unanswered summaries' },
  'prompt.deploy.sameTask': { es: ' · misma tarea ({clave}) que {prs}, sin orden conocido', en: ' · same task ({clave}) as {prs}, no known order' },
  'prompt.deploy.line': { es: '- {pr} «{titulo}» · {columna}{ci}{revisiones}{espera}{junto} · {url}', en: '- {pr} “{titulo}” · {columna}{ci}{revisiones}{espera}{junto} · {url}' },
  // integrar una copia holográfica en su rama base (server/worktrees.ts)
  'prompt.merge.worktree': {
    es: 'Integra la rama `{rama}` (en el worktree `{ruta}`) en `{base}` en este repositorio y luego limpia:\n1. Si el worktree tiene cambios sin commitear, para y pregúntame qué hacer con ellos.\n2. Pon `{base}` al día si sigue a un remoto y fusiona `{rama}`. Resuelve conflictos con cuidado y pregúntame si dudas.\n3. Ejecuta las comprobaciones o tests del proyecto si los tiene.\n4. Elimina el worktree con `git worktree remove {ruta}` y borra la rama con `git branch -d {rama}`.\nNo hagas push salvo que te lo pida.',
    en: 'Merge the branch `{rama}` (in the worktree `{ruta}`) into `{base}` in this repository and then clean up:\n1. If the worktree has uncommitted changes, stop and ask me what to do with them.\n2. Bring `{base}` up to date if it tracks a remote and merge `{rama}`. Resolve conflicts carefully and ask me if in doubt.\n3. Run the project\'s checks or tests if it has any.\n4. Remove the worktree with `git worktree remove {ruta}` and delete the branch with `git branch -d {rama}`.\nDo not push unless I ask you to.',
  },
  // attachments at the end of a message (server/attachments.ts)
  'prompt.attachmentsHeader': { es: '[Adjuntos del Supervisor]', en: '[Overseer\'s attachments]' },
  'prompt.attachmentImageNote': { es: ' (imagen, incluida en este mensaje)', en: ' (image, included in this message)' },
};
