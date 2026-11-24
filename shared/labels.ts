// Textos de la interfaz que se guardan como datos en español: se muestran con tIs(), que los busca por su versión
// española en el catálogo (shared/texts/*.ts). Aquí, y no en cada panel, para que una prueba compruebe que todos
// tienen su traducción (shared/labels.test.ts)

// Ficha del plano: la sala que está bajo el ratón o elegida con las flechas. Más que el cartel: para qué sirve, cómo
// llegar y lo que pasa ahora dentro (repo, avisos, próxima reunión, integraciones, habitantes)
export const ROOM_INFO: Record<string, string> = {
  gate: 'La entrada del refugio, a pie de calle. El Guardián decide quién pasa: aquí se recluta y se excava una sala nueva para cada carpeta de la raíz de repos que aún no tiene la suya.',
  vault: 'Guarda las conexiones con Microsoft 365, Google, Discord, Slack, GitHub y Linear (los secretos van al llavero de macOS, nunca al disco) y los ajustes del refugio: nombre, raíz de repos y límite de sesiones.',
  bridge: 'Desde aquí se gobierna el refugio: su habitante trabaja en el repo del propio juego. La maqueta holográfica enseña cada sala en vivo y desde el panel de la sala se aplican los cambios del juego.',
  comms: 'Correo, chats y avisos de Outlook, Gmail, Discord, Slack, GitHub y Linear en un solo tablón, de solo lectura: lo que te menciona va primero y Enter abre el original (en su navegador del refugio si lo tiene; los números abren cada web sin pasar por un aviso). También está la radio.',
  calendar: 'Calendario unificado de Microsoft 365 y Google Calendar: la semana, la agenda de los próximos días y el enlace para unirse a cada reunión.',
  git: 'Control de versiones: el cliente de git de todos los repos del refugio (preparar por archivos, bloques o líneas, commits, historial con su grafo, ramas y cajón), tu matriz de contribuciones de GitHub y tus pull requests. La Octocat vive aquí. G lo abre desde cualquier sitio.',
  logistics: 'Tablero: tus tareas de Jira con sus pull requests y el estado de cada uno. Su habitante usa el MCP oficial de Linear para crear, mover o comentar incidencias, siempre con tu permiso.',
  review: 'Los PR de otros que esperan tu revisión, en tres columnas: por revisar, cambios pedidos y aprobados. Cada tarea tiene aquí su holograma, que revisa todos sus PR (de cualquier repo) en copias aparte, y nunca publica nada sin tu permiso.',
  hydroponics: 'Los cultivos del refugio, para cuidarlos entre tarea y tarea.',
  gallery: 'Galería de tiro para despejarse un rato. Guarda los récords.',
  disco: 'La música para currar, en la planta de ocio. La cabina del DJ abre Spotify, que suena aquí dentro: elige lo que quieras y minimízalo; la pletina de abajo a la izquierda sigue con lo que suena y los mandos.',
  bodyshop: 'Barbería y ropería del refugio. En el sillón de Fito se cambia el aspecto del Supervisor o de cualquier habitante: humano o robot, cara, pelo, barba, ropa, sombreros, gafas, mochilas y colores. P lo abre desde cualquier sitio. La Octocat es como es.',
  coordination: 'Sala de logística: la carpeta raíz con todos tus repos. Desde el tablero de Jira (P en una tarea por hacer) su habitante analiza la tarea viendo todos los repos y traza el plan contigo; con el plan aprobado, la reparte a la sala de cada repo, cada parte en su worktree, para seguirla allí.',
};
export const REPO_INFO = 'Sala de un repositorio: sus habitantes trabajan aquí con Claude Code. Desde el panel de la sala se abre una terminal en la carpeta o se trabaja en una copia aparte (un worktree), que aparece en la sala como el holograma de quien la creó.';
// estado de una integración: largo en la ficha del plano, corto en la Cámara
export const INTEGRATION_STATE: Record<string, string> = { demo: 'DEMO (datos simulados)', connected: 'conectada', error: 'con error', 'not-configured': 'sin configurar' };
export const INTEGRATION_STATE_SHORT: Record<string, string> = { demo: 'DEMO', connected: 'conectada', error: 'error', 'not-configured': 'sin configurar' };
// tipo de repo (`tipo` de las sugerencias y de la sala)
export const REPO_TYPE: Record<string, string> = { web: 'web', landing: 'landing', brand: 'marca', video: 'vídeo', node: 'node', python: 'python', generic: 'carpeta' };
// aspecto de cada personaje de serie (Puente, al elegir el del Supervisor)
export const LOOK: Record<string, string> = { Engineer: 'ingeniera de campo', Survivalist: 'superviviente', Hoarder: 'chatarrero', Hiker: 'excursionista', Protagonist_A: 'aventurera', Protagonist_B: 'aventurero', Driver: 'conductor', SpaceRanger: 'guardabosques espacial', Robot_One: 'robot de servicio', Robot_Two: 'robot de servicio', Clanker: 'robot de carga', CombatMech: 'mecha de guardia', '4GTN': 'androide samurái' };
// pestañas del inventario de actividades
export const ACTIVITY_TABS = ['Inventario', 'Guía de campo', 'Tienda', 'Récords'] as const;
export const FRESH_HARVEST = 'Recién cosechada en hidroponía.';
