// Plausible simulated data (DEMO) for when a source is not configured: written in Spanish, with its English in
// demoEnglish.ts for a shelter in English. Fictional shelter projects and dates relative to «now» (system time zone),
// generated stably per day so they don't flicker. Every person, team and company is made up.
import type { Notification, CalendarEvent, Priority, SourceId } from './adapters.ts';
import { dayStart } from './normalize.ts';
import { inDemoLanguage } from './demoEnglish.ts';

function seed(n: number) { let s = n >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const MIN = 60_000, H = 60 * MIN;

// [autor, título, fragmento, prioridad]
const MAILS: [string, string, string, Priority][] = [
  ['Irene Valdés', 'Revisión de la guía de migración', 'Te paso los cambios de la guía a la versión 5; si te encaja la publicamos hoy.', 'alta'],
  ['Tomás Ibarra', 'Factura de octubre — proveedor de hosting', 'Adjunto la factura. Recordad que el plan sube de precio el mes que viene si no migramos.', 'media'],
  ['Nerea Calvo', 'Plan de pruebas de la nueva versión', 'He dejado el plan de pruebas en la wiki. ¿Le echas un ojo antes del viernes?', 'media'],
  ['Avisos de CI', '[express] Build fallida en la rama main', 'El job «test» ha fallado en el commit a3f9c21: 2 tests en router.test.js no pasan.', 'alta'],
  ['Bruno Esteve', 'Resultados del benchmark', 'Con el corpus grande sale un 12 % más rápido que la versión anterior. ¿Lo contamos en el changelog?', 'media'],
  ['Intendencia del Refugio', 'Inventario mensual del almacén', 'Antes del día 30, apuntad en la hoja lo que hayáis sacado del almacén de la planta -2.', 'baja'],
  ['Olga Prieto', 'Reunión con el cliente movida al jueves', 'El cliente no puede el miércoles; la pasamos al jueves a las 11:30 con el mismo enlace.', 'media'],
];
const GMAIL: [string, string, string, Priority][] = [
  ['Asociación de Vecinos del Refugio', 'Turnos de limpieza del filtro de aire', 'Esta semana te toca el jueves. Si no puedes, cámbialo con alguien en el tablón de la planta baja.', 'baja'],
  ['Hugo Lara', '¿Quedamos para el hackathon?', 'Tengo una idea para el reto de accesibilidad: necesito a alguien que sepa de Rust. ¿Te apuntas?', 'media'],
  ['Biblioteca Municipal', 'Tu préstamo vence mañana', '«Patrones de diseño para refugios» vence mañana. Puedes renovarlo una vez desde tu cuenta.', 'baja'],
  ['Rosa Quintana', 'Fotos del viaje', 'Ya están las fotos en la carpeta compartida. La del atardecer es para enmarcar.', 'alta'],
];
const MAIL: [string, string, string, Priority][] = [
  ['Equipo de Viajes', 'Tu reserva para el congreso', 'Confirmado: dos noches en el hotel del recinto ferial. El código de reserva va en el adjunto.', 'media'],
  ['Marta Gil', 'Notas de la retro', 'He pasado a limpio lo que salió en la retro; lo importante, en la primera sección.', 'alta'],
];
const DISCORD: [string, string, string, Priority][] = [
  ['#express', 'Iker', '¿Alguien ha tocado la configuración de los tests? Me tardan el doble en arrancar.', 'media'],
  ['#express', 'Irene', '@Supervisor ¿puedes aprobar el PR #42? Es solo documentación.', 'alta'],
  ['#awesome', 'Nerea', 'He ordenado la lista por temas. Quedan tres enlaces rotos.', 'baja'],
  ['#sala-comun', 'Tomás', 'Hoy hay sopa de setas de la hidroponía en el comedor 🍲', 'baja'],
  ['#avisos-ci', 'bot-ci', 'La documentación, desplegada en preview: https://preview.example.com/docs', 'baja'],
  ['#ripgrep', 'Bruno', '@equipo-rendimiento la búsqueda se queda colgada con un archivo de 4 GB, ¿alguna idea?', 'alta'],
];
const SLACK: [string, string, string, Priority][] = [
  ['#producto', 'Olga Prieto', 'Mañana cerramos el alcance del lanzamiento. Traed vuestras dudas a la reunión de las 10.', 'media'],
  ['@Iker Sáez', 'Iker Sáez', '¿Tienes un minuto para mirar el error del carrito? Creo que es la caché del navegador.', 'alta'],
  ['#random', 'Hugo Lara', 'Alguien se ha dejado un táper en la nevera de la planta -2 desde el lunes 👀', 'baja'],
  ['#soporte', 'Rosa Quintana', '@here hay tres clientes que no reciben el correo de confirmación del pedido.', 'media'],
];
const GITHUB: [string, string, string, Priority, string][] = [
  ['refugio/express', 'PR · Rutas con parámetros opcionales', 'te piden revisión', 'alta', 'pull/42'],
  ['refugio/requests', 'Issue · El reintento no respeta el timeout', 'te lo han asignado', 'alta', 'issues/17'],
  ['refugio/awesome', 'Release · v2.1.0', 'sigues el repositorio', 'baja', 'releases'],
  ['refugio/ripgrep', 'CI · Fallo en «bench»', 'actividad de CI', 'media', 'actions'],
];
const LINEAR: [string, string, string, Priority][] = [
  ['REF-212', 'Irene Valdés', 'Te han asignado «Rutas con barra final duplicada» (express).', 'media'],
  ['REF-219', 'Iker Sáez', 'Comentario en «Migrar rutas al nuevo router»: «¿Lo dejamos para el siguiente ciclo?»', 'baja'],
  ['REF-231', 'Nerea Calvo', '«Reintentos con espera exponencial» ha pasado a En revisión.', 'baja'],
  ['REF-240', 'Bruno Esteve', 'Te han mencionado en «Buscar dentro de archivos comprimidos» (ripgrep).', 'alta'],
];

function demoNotificationsEs(source: SourceId): Notification[] {
  const day = dayStart();
  const r = seed(Math.floor(day / 86400000) * 7 + source.length);
  const now = Date.now();
  const n = (i: number, x: Partial<Notification> & { priority: Priority }): Notification =>
    ({ id: `demo-${source}-${Math.floor(day / 86400000)}-${i}`, source, author: '', title: '', snippet: '', date: now - Math.floor(5 + r() * 300) * MIN, demo: true, ...x });
  switch (source) {
    case 'outlook': return MAILS.map(([author, title, snippet, priority], i) => n(i, { author, title, snippet, priority, link: 'https://outlook.office.com/mail/' }));
    case 'google': return GMAIL.map(([author, title, snippet, priority], i) => n(i, { author, title, snippet, priority, channel: 'Recibidos', link: 'https://mail.google.com/mail/u/0/#inbox' }));
    case 'mail': return MAIL.map(([author, title, snippet, priority], i) => n(i, { author, title, snippet, priority, channel: 'Google', link: 'https://mail.google.com/mail/u/0/#inbox' }));
    case 'discord': return DISCORD.map(([channel, author, snippet, priority], i) => n(i, { channel, thread: `demo-discord-${channel}`, author, title: channel, snippet, priority, link: 'https://discord.com/channels/@me' }));
    case 'slack': return SLACK.map(([channel, author, snippet, priority], i) => n(i, { channel, thread: `demo-slack-${channel}`, author, title: channel, snippet, priority, link: 'https://app.slack.com/client' }));
    case 'github': return GITHUB.map(([repo, title, snippet, priority], i) => n(i, { channel: repo, thread: `demo-github-${i}`, author: repo, title, snippet, priority, link: 'https://github.com/notifications' }));
    case 'linear': return LINEAR.map(([key, author, snippet, priority], i) => n(i, { channel: key, author, title: `${key} · ${author}`, snippet, priority, link: 'https://linear.app/' }));
    case 'jira': return [];   // sin avisos: solo el tablero de Logística
    case 'calendario': return [];   // sin avisos: solo la agenda
  }
}

// [día (0 = hoy), hora, duración en horas (≥ 24: todo el día), título, videollamada, lugar]
type EventDemo = [number, number, number, string, string?, string?];
const EVENTS: Partial<Record<SourceId, EventDemo[]>> = {
  outlook: [
    [0, 10, 0.25, 'Cambio de turno del refugio', 'https://teams.microsoft.com/l/meetup-join/demo'], [0, 12, 1, 'Revisión del plan de pruebas con Nerea', 'https://teams.microsoft.com/l/meetup-join/demo2'],
    [0, 16.5, 0.5, 'Llamada con el cliente: lanzamiento', 'https://teams.microsoft.com/l/meetup-join/demo3'], [1, 10, 0.25, 'Cambio de turno del refugio', 'https://teams.microsoft.com/l/meetup-join/demo'],
    [1, 11, 1.5, 'Planificación del ciclo 14'], [2, 10, 1, 'Demo interna: la versión 5'], [3, 11.5, 1, 'Reunión con el cliente (movida)', 'https://teams.microsoft.com/l/meetup-join/demo4'],
    [4, 13, 0, 'Simulacro de evacuación', undefined, 'Puerta Principal, planta baja'],
  ],
  calendario: [
    [0, 9.5, 0.25, 'Daily del equipo', 'https://meet.google.com/demo-mno-pqr'], [1, 9.5, 0.25, 'Daily del equipo', 'https://meet.google.com/demo-mno-pqr'],
    [2, 15, 1, 'Revisión de la arquitectura de pagos', undefined, 'Sala Bóveda, planta -1'],
  ],
  google: [
    [0, 19, 1, 'Entrenamiento de escalada', undefined, 'Rocódromo de la planta -3'], [1, 13.5, 1, 'Comida con Hugo', 'https://meet.google.com/demo-abc-def'],
    [2, 0, 24, 'Cumpleaños de Rosa'], [3, 18, 1.5, 'Club de lectura', 'https://meet.google.com/demo-ghi-jkl'],
  ],
};
function demoEventsEs(source: SourceId): CalendarEvent[] {
  const day = dayStart();
  return (EVENTS[source] ?? []).map(([d, h, dur, title, video, place], i) => {
    const all = dur >= 24;
    const start = day + d * 86400000 + (all ? 0 : h * H);
    return { id: `demo-${source}-ev-${Math.floor(day / 86400000)}-${i}`, source, title, start, end: all ? start + 86400000 : start + Math.max(dur, 0.25) * H, allDay: all, videollamada: video, place, link: source === 'outlook' ? 'https://outlook.office.com/calendar/' : source === 'calendario' ? video : 'https://calendar.google.com/', demo: true };
  });
}

// Panel de Linear en DEMO (mismo formato que el real: mis issues por estado y ciclo actual), con proyectos ficticios
function demoPanelLinearEs() {
  const now = Date.now(), day = 86400_000;
  const issue = (n: number, title: string, type: string, name: string, priority: number, project: string, labels: string[] = []) => ({
    id: 'demo-' + n, identifier: `REF-${n}`, title, url: 'https://linear.app/', priority, textPriority: ['Sin prioridad', 'Urgente', 'Alta', 'Media', 'Baja'][priority],
    state: { id: type, name, type }, team: 'REF', project, cycle: 14, labels: labels.map(x => ({ name: x, color: '#888' })), updated: now - n * 3600_000,
  });
  const groups = [
    { type: 'started', name: 'En curso', issues: [issue(212, 'Rutas con barra final duplicada', 'started', 'En curso', 2, 'Express', ['bug']), issue(219, 'Migrar rutas al nuevo router', 'started', 'En curso', 3, 'Express'), issue(240, 'Buscar dentro de archivos comprimidos', 'started', 'En revisión', 2, 'Ripgrep'), issue(236, 'Sesiones con conexiones persistentes', 'started', 'En revisión', 3, 'Requests'), issue(238, 'Comprobar los enlaces rotos de la lista', 'started', 'En curso', 3, 'Awesome'), issue(239, 'Colores en la salida de Windows', 'started', 'En revisión', 2, 'Ripgrep')] },
    { type: 'unstarted', name: 'Por hacer', issues: [issue(231, 'Reintentos con espera exponencial', 'unstarted', 'Por hacer', 3, 'Requests', ['mejora']), issue(244, 'Sección nueva: herramientas de terminal', 'unstarted', 'Por hacer', 2, 'Awesome'), issue(247, 'Revisar la licencia de los ejemplos', 'unstarted', 'Por hacer', 4, 'Express')] },
    { type: 'backlog', name: 'Backlog', issues: [issue(198, 'Binarios para más arquitecturas', 'backlog', 'Backlog', 0, 'Ripgrep'), issue(201, 'Tipos para los adaptadores', 'backlog', 'Backlog', 4, 'Requests')] },
  ];
  return { me: { name: 'Supervisor (demo)' }, myIssues: groups, cycles: [{ teamId: 'demo', team: 'REF', name: 'Refugio', cycle: { id: 'c14', number: 14, name: 'Ciclo 14', start: now - 6 * day, end: now + 8 * day, progreso: 46 } }], when: now, demo: true };
}

// Tablero del equipo en DEMO (mismo formato que tableroDeEquipo): columnas por estado del equipo con sus incidencias
function demoBoardLinearEs() {
  const p = demoPanelLinearEs();
  const all = p.myIssues.flatMap(g => g.issues);
  const extra = [
    { id: 'demo-251', identifier: 'REF-251', title: 'Caché de imágenes en la portada', priority: 3, textPriority: 'Media', state: { id: 'started', name: 'En curso', type: 'started' }, project: 'Taller', assignee: 'Iker Sáez' },
    { id: 'demo-188', identifier: 'REF-188', title: 'Plantilla de correo de bienvenida', priority: 4, textPriority: 'Baja', state: { id: 'completed', name: 'Hecho', type: 'completed' }, project: 'Escaparate', assignee: 'Irene Valdés' },
    { id: 'demo-190', identifier: 'REF-190', title: 'Exportar la paleta a la herramienta de diseño', priority: 3, textPriority: 'Media', state: { id: 'completed', name: 'Hecho', type: 'completed' }, project: 'Marca', assignee: 'Supervisor (demo)' },
  ];
  const issues = [...all, ...extra] as any[];
  const states = [['backlog', 'Backlog'], ['unstarted', 'Por hacer'], ['started', 'En curso'], ['review', 'En revisión'], ['completed', 'Hecho']];
  return { team: 'REF', name: 'Refugio', demo: true, columns: states.map(([type, name]) => ({ id: type, name, type, issues: issues.filter(i => type === 'review' ? i.state.name === 'En revisión' : i.state.type === type && i.state.name !== 'En revisión') })) };
}

// Tablero de Jira en DEMO (mismo formato que el panel real): tareas de un proyecto ficticio. Sus claves (REF-…) son las
// que llevan las ramas de los PR de demoPRsTablero() en server/git.ts, para que el cruce se vea.
function demoPanelJiraEs() {
  const now = Date.now();
  const red = { key: 'REF-200', title: 'Red fiable' }, paths = { key: 'REF-210', title: 'Router nuevo' };
  const t = (n: number, title: string, state: string, category: 'new' | 'indeterminate' | 'done', type: string, priority: string, hours: number, epic?: { key: string; title: string }) =>
    ({ key: `REF-${n}`, title, url: 'https://jira.example/browse/REF-' + n, state, category, type, priority, project: 'Refugio', updated: now - hours * H, ...(epic ? { epic } : {}) });
  return {
    me: 'Supervisor (demo)', when: now, demo: true,
    tareas: [
      t(212, 'Rutas con barra final duplicada', 'En curso', 'indeterminate', 'Error', 'High', 2, paths),
      t(240, 'Buscar dentro de archivos comprimidos', 'En revisión', 'indeterminate', 'Historia', 'High', 5),
      t(236, 'Sesiones con conexiones persistentes', 'En revisión', 'indeterminate', 'Historia', 'Medium', 20, red),
      t(231, 'Reintentos con espera exponencial', 'Por hacer', 'new', 'Tarea', 'Medium', 30, red),
      t(244, 'Sección nueva: herramientas de terminal', 'Por hacer', 'new', 'Tarea', 'Low', 48),
      t(219, 'Migrar rutas al nuevo router', 'Hecho', 'done', 'Historia', 'Medium', 26, paths),
    ],
  };
}

export const demoNotifications = (source: SourceId): Notification[] => inDemoLanguage(demoNotificationsEs(source));
export const demoEvents = (source: SourceId): CalendarEvent[] => inDemoLanguage(demoEventsEs(source));
export const demoPanelLinear = () => inDemoLanguage(demoPanelLinearEs());
export const demoBoardLinear = () => inDemoLanguage(demoBoardLinearEs());
export const demoPanelJira = () => inDemoLanguage(demoPanelJiraEs());
