// Prompts a los habitantes (lo que reciben como mensaje del Supervisor), en los dos idiomas. Los nombres de las
// herramientas del juego (decorado_actual, repartir_trabajo…) no se traducen: son los de verdad.
import type { Texto } from '../idioma.ts';

export const PROMPTS: Record<string, Texto> = {
  // «Adaptar la sala al repo» (server/decoradoSala.ts)
  'prompt.adaptRoom': {
    es: 'Adapta tu sala del refugio a lo que hay en este repo. Mira el repo por encima (README, estructura, lenguaje, de qué va y para quién) y diseña una escena que lo cuente de un vistazo: la pieza protagonista, el atrezo, los carteles y las pantallas, con los colores y la luz que le peguen. Hazlo con las herramientas del juego: primero decorado_actual (trae la guía y cómo está la sala), luego catalogo_atrezo para elegir piezas, aplicar_decorado para montarla y ver_sala para comprobar cómo queda; corrige hasta que te guste (cuatro o cinco vueltas como mucho). No cambies ningún archivo del repo: esto es solo decorar la sala. Al terminar, cuéntame en dos o tres líneas qué has montado y por qué.',
    en: 'Adapt your shelter room to what is in this repo. Skim the repo (README, structure, language, what it is about and who it is for) and design a scene that tells it at a glance: the centrepiece, the props, the signs and the screens, with colours and lighting that fit. Use the game tools: first decorado_actual (it brings the guide and the current state of the room), then catalogo_atrezo to pick pieces, aplicar_decorado to build it and ver_sala to check how it looks; fix it until you like it (four or five rounds at most). Do not change any file in the repo: this is only about decorating the room. When you finish, tell me in two or three lines what you built and why.',
  },
  // al sacar una conversación a mitad de trabajo a una terminal (server/escritorio.ts)
  'prompt.continueOutside': {
    es: 'Sigue con lo que estabas haciendo: te he sacado del refugio a esta terminal a mitad de trabajo.',
    en: 'Carry on with what you were doing: I moved you out of the shelter to this terminal halfway through.',
  },
  // conversación de una tarea con PR (server/organizar.ts)
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
  // parte de un plan repartido a una sala (server/reparto.ts)
  'prompt.job.partOf': { es: 'Este trabajo es una parte de un plan coordinado desde la sala «{sala}»{tarea}.', en: 'This work is one part of a plan coordinated from the “{sala}” room{tarea}.' },
  'prompt.job.forTask': { es: ' para la tarea {clave}', en: ' for task {clave}' },
  'prompt.job.others': { es: 'En paralelo, otras salas se ocupan de: {otros}. Si necesitas algo de ellas, dímelo en vez de tocar su repo.', en: 'In parallel, other rooms are handling: {otros}. If you need something from them, tell me instead of touching their repo.' },
  'prompt.job.after': { es: 'Tu parte se fusiona después de la de {salas}: puede depender de lo suyo, pero no al revés.', en: 'Your part is merged after {salas}: it can depend on theirs, but not the other way round.' },
  'prompt.job.sharedPlan': { es: 'El plan entero es compartido (plan {plan}): léelo con plan_compartido antes de empezar. Si cambia, te llegará un aviso: vuelve a leerlo y ajusta tu parte. Si ves que hay que cambiarlo, propónlo con proponer_cambio_plan en vez de desviarte por tu cuenta.', en: 'The whole plan is shared (plan {plan}): read it with plan_compartido before starting. If it changes you will get a notice: read it again and adjust your part. If you think it needs changing, propose it with proponer_cambio_plan instead of going your own way.' },
  'prompt.job.worktree': { es: 'Trabajas en un worktree propio de este repo: haz commits en su rama. No hagas push ni abras pull requests salvo que te lo pida.', en: 'You work in a worktree of your own for this repo: commit on its branch. Do not push or open pull requests unless I ask you to.' },
  // mensaje de otra sala (server/avisosSalas.ts)
  'prompt.room.from': { es: '📨 Mensaje de la sala «{sala}» ({habitante}){tarea}:', en: '📨 Message from the “{sala}” room ({habitante}){tarea}:' },
  'prompt.room.task': { es: ', tarea {clave}', en: ', task {clave}' },
  'prompt.room.reply': { es: '(Para contestar o pedirle algo, usa enviar_a_sala con sala «{salaId}».)', en: '(To reply or ask it something, use enviar_a_sala with room “{salaId}”.)' },
  // revisión nueva de un PR (server/revisionesPR.ts)
  'prompt.review.title': { es: '🔎 {clave}Revisión nueva en tu PR #{numero} de {repo} («{titulo}»), rama `{rama}`: {url}', en: '🔎 {clave}New review on your PR #{numero} in {repo} (“{titulo}”), branch `{rama}`: {url}' },
  'prompt.review.changesRequested': { es: 'pide cambios', en: 'requests changes' },
  'prompt.review.commented': { es: 'deja una revisión', en: 'leaves a review' },
  'prompt.review.approvedWithNote': { es: 'aprueba, con una nota', en: 'approves, with a note' },
  'prompt.review.reviews': { es: 'revisa', en: 'reviews' },
  'prompt.review.onLine': { es: 'comenta en `{lugar}`', en: 'comments on `{lugar}`' },
  'prompt.review.onConversation': { es: 'comenta en la conversación', en: 'comments on the conversation' },
  'prompt.review.more': { es: '…y {n} más: míralos en el PR.', en: '…and {n} more: see them on the PR.' },
  'prompt.review.ask': { es: 'Analiza cada comentario con el código de este worktree y propón al Supervisor un plan: qué arreglarías (y cómo), qué no y por qué, y qué contestarías en cada hilo (con el texto de la respuesta). No cambies código, no hagas push ni contestes en GitHub hasta que el Supervisor apruebe el plan.', en: 'Analyse each comment against the code in this worktree and propose a plan to the Overseer: what you would fix (and how), what not and why, and what you would reply on each thread (with the text of the reply). Do not change code, push or reply on GitHub until the Overseer approves the plan.' },
  // planificar una tarea de Jira (shared/tablero.ts)
  'prompt.plan.priority': { es: 'prioridad {p}', en: 'priority {p}' },
  'prompt.plan.intro': { es: 'Planifica esta tarea de Jira ({url}){datos}. Todavía no ha empezado.', en: 'Plan this Jira task ({url}){datos}. It has not started yet.' },
  'prompt.plan.description': { es: 'Descripción:\n\n{texto}', en: 'Description:\n\n{texto}' },
  'prompt.plan.noDescription': { es: 'No tengo su descripción: léela en Jira si tienes cómo, o pídemela.', en: 'I do not have its description: read it in Jira if you can, or ask me for it.' },
  'prompt.plan.steps': {
    es: 'Desde aquí ves todos los repos. Antes de tocar nada:\n1. Entiende la tarea y busca en los repos qué hay que cambiar y dónde. Pregúntame lo que no esté claro.\n2. Mira con salas_del_refugio qué repos tienen sala en el refugio.\n3. Propónme un plan por repo: qué cambia en cada uno, en qué orden y lo que comparten (contratos, APIs, migraciones).\n4. Cuando lo apruebe, repártelo con repartir_trabajo: un trabajo por sala, con instrucciones que basten por sí solas, y la clave de la tarea.\nNo edites los repos desde aquí: cada sala trabaja en su worktree.',
    en: 'From here you can see every repo. Before touching anything:\n1. Understand the task and look in the repos for what needs to change and where. Ask me about anything unclear.\n2. Check with salas_del_refugio which repos have a room in the shelter.\n3. Propose a plan per repo: what changes in each, in what order and what they share (contracts, APIs, migrations).\n4. Once I approve it, hand it out with repartir_trabajo: one job per room, with instructions that stand on their own, and the task key.\nDo not edit the repos from here: each room works in its own worktree.',
  },
  // plan de despliegue (shared/despliegue.ts)
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
  'prompt.deploy.sameTask': { es: ' · misma tarea ({clave}) que {prs}, sin orden conocido', en: ' · same task ({clave}) as {prs}, no known order' },
  'prompt.deploy.line': { es: '- {pr} «{titulo}» · {columna}{ci}{espera}{junto} · {url}', en: '- {pr} “{titulo}” · {columna}{ci}{espera}{junto} · {url}' },
};
