# Integraciones: cómo funcionan, qué pide la cámara acorazada y el MCP de Linear

Qué hace cada conector de `server/integraciones/`, qué pide la cámara acorazada, dónde se guarda cada dato y cómo se
conecta el MCP oficial de Linear en Claude Code y en Codex. Las guías paso a paso para conseguir cada credencial están
también dentro del juego (cámara acorazada → la fuente).

## Principios

- **Tres estados por fuente**: demo (datos simulados, marcados DEMO), real conectada, o real con error y su motivo.
  En modo real sin datos completos, el estado es *sin configurar* y dice qué falta.
- **Solo lectura hacia fuera.** Ningún conector envía correos, mensajes ni eventos, y los permisos que se piden son
  de lectura. La única escritura es Linear, y la hace la conversación del habitante de Logística con el MCP oficial
  (eres tú actuando a través de él), no el juego.
- **Sin identificadores de nadie.** Cada usuario crea su propia app (Microsoft Entra, Google Cloud, bot de Discord,
  app de Slack) y pega sus datos. El repo no trae IDs de cliente, tokens ni URLs de ninguna organización.
- **Secretos solo en el llavero de macOS** (`server/integraciones/llavero.ts`): servicio `work-shelter-public`, cuenta
  `<fuente>.<campo>` (`linear.apiKey`, `discord.token`, `slack.token`, `github.token`, `google.clientSecret`,
  `outlook.refreshToken`, `google.refreshToken`). Se escriben con `security -i` (la orden va por stdin, así el secreto
  no aparece en `ps`) y en base64. En `.data/refugio.json` solo van los datos no secretos
  (`integraciones.<fuente>.campos`) y los **nombres** de los secretos guardados (`integraciones.<fuente>.secretos`).
  Nada de secretos en git, en logs ni en mensajes de error.
- **Sin telemetría.** El servidor escucha solo en `127.0.0.1`.

Limitación del llavero: con `/usr/bin/security`, la app de confianza del elemento es el propio `security`, así que
otro proceso de tu mismo usuario podría leerlo sin aviso. Para un Mac personal se acepta (evita dependencias
nativas); por eso los permisos que se piden son los mínimos y de solo lectura.

## Fuentes apagadas

Una fuente con `desactivada: true` en `shared/fuentes.ts` no crea conector ni sale en la cámara acorazada, el tablón,
el calendario ni Logística (`FUENTES_ACTIVAS`); su código sigue ahí. Ahora lo están **Microsoft 365** y **Linear**
(sin Linear, el habitante de Logística tampoco lleva su MCP). Para volver a encender una, quita la marca.

## Añadir una fuente nueva

1. Su id, nombre, color y qué trae, en `shared/fuentes.ts`.
2. El conector real en `server/integraciones/<id>.ts` con `export function crear(almacen)` (casi siempre, una
   subclase de `ConectorBase` de `comun.ts` con sus `Campo[]`).
3. Sus normalizadores puros en `normalizar.ts`, con fixtures sintéticos en `test/fixtures/` y pruebas.
4. Sus datos DEMO en `demo.ts`.
5. Su guía paso a paso en `web/src/ui/Camara.tsx` (`GUIAS`), y si tiene web que se pueda abrir dentro del juego, su
   sitio en `web/src/ui/Navegadores.tsx` (`SITIOS`).

## El tablón: lo pendiente, por conversación

Los conectores entregan mensajes con un `hilo` (canal de Discord o de Slack, conversación de correo, issue de Linear,
hilo de GitHub) y `Integraciones` los difunde agrupados (`agruparAvisos` en `normalizar.ts`): una entrada por
conversación con `cuantos`, `ids`, `autores` y los últimos `mensajes`. Su id cambia con cada mensaje nuevo (suena y
vuelve a «sin ver»); `marcarVista` recibe los `ids` de sus mensajes. Microsoft 365, Google, GitHub y Linear sondean
con `completas: true`: lo que devuelven es todo lo pendiente allí y lo que ya no viene (leído en su web) sale del
tablón. Discord y Slack no tienen estado de leído para un bot: acumulan lo que llega.

## Acciones de la cámara acorazada (por WebSocket, `integracion.<accion>` con `{ fuente, ... }`)

| Acción | Qué hace |
|---|---|
| `campos` | Devuelve `{ campos, valores, guardados }`: definición de los campos, valores públicos actuales y qué secretos hay guardados (sin su valor). |
| `probar` | `{ campos }` → `{ ok, detalle }`. Un secreto vacío significa «usar el guardado». |
| `guardar` | `{ campos, activar? }` → guarda (públicos al estado, secretos al llavero), prueba y, si pasa, cambia la fuente a real (salvo `activar: false`). |
| `modo` | `{ modo: 'demo' \| 'real' }`. |
| `refrescar` | Sondea ya. |
| `olvidar` | Borra los secretos del llavero y los campos, y vuelve a demo. |
| Microsoft / Google `conectar` | Abre en el navegador del sistema la autorización (`abrir: false` solo devuelve la URL). |
| Microsoft / Google `desconectar` | Borra la sesión (refresh token). |
| Discord `invitacion` | URL para invitar al bot con permisos de solo lectura (66560). |
| Discord / Slack `canales` | Canales para elegir. Guardar la selección con `guardar { campos: { canales: 'id1,id2' } }`. |
| Linear `panel` | `{ yo, misIssues (por estado), ciclos (ciclo actual por equipo) }`. |
| Linear `tablero` | `{ equipo: <clave> \| <id>, prioridad?: 'alta', etiqueta?, proyecto?, asignadoAMi?, ciclo?: 'actual' }` → columnas por estado. |

## Inicio de sesión con navegador (Microsoft y Google)

`server/integraciones/oauth.ts`: OAuth 2.0 de aplicación nativa (RFC 8252), código de autorización + PKCE (S256) y
`state` aleatorio, con retorno a `http://localhost:<puerto libre>` (IPv4 e IPv6). La escucha es de un solo uso y se
cierra al volver el navegador o a los 5 minutos. El access token vive solo en memoria; el refresh token, en el llavero.

## Campos de cada fuente

**Microsoft 365 (Outlook)** — Microsoft Graph, solo lectura. Registras tu propia app en Microsoft Entra.

| Campo | Etiqueta | Secreto | Ayuda |
|---|---|---|---|
| `clientId` | ID de aplicación (cliente) | no | Entra → Registros de aplicaciones → tu app → «Id. de aplicación (cliente)». |
| `tenant` | Inquilino | no (opcional) | Vacío: `common`. Si la app es de una sola organización, su «Id. de directorio». |

Registro: plataforma *Cliente público/nativo (móvil y escritorio)* con la URI `http://localhost` (Entra acepta
cualquier puerto en localhost), sin secreto. Permisos delegados: `User.Read`, `Mail.Read`, `Calendars.Read` y
`offline_access`. Sondeo: correo no leído de la bandeja de entrada de los últimos 7 días (metadatos + `bodyPreview`,
25 como máximo) cada 60 s; `calendarView` de hoy a +14 días cada 5 min, en la zona horaria del sistema.

**Google (Gmail y Calendar)** — solo lectura. Creas tu propio cliente OAuth en Google Cloud.

| Campo | Etiqueta | Secreto | Ayuda |
|---|---|---|---|
| `clientId` | ID de cliente | no | Google Cloud → APIs y servicios → Credenciales → cliente OAuth de tipo «Aplicación de escritorio». |
| `clientSecret` | Secreto de cliente | sí | El del mismo cliente (en una app de escritorio no es confidencial, pero va al llavero igualmente). |

Hay que activar Gmail API y Google Calendar API en el proyecto y, con la pantalla de consentimiento en «Pruebas»,
añadirte como usuario de prueba. En ese modo Google corta el refresh token a los 7 días: el estado lo explica y basta
con volver a conectar. Ámbitos: `gmail.readonly` y `calendar.readonly`. Sondeo: `is:unread in:inbox newer_than:7d`
(25 como máximo, metadatos y fragmento; los ya vistos no se vuelven a pedir) cada 60 s; el calendario principal de
hoy a +14 días cada 5 min.

**Mail del Mac (Gmail sin Google Cloud)** — solo lectura, sin secretos. Para quien no puede o no quiere crear un
proyecto en Google Cloud (o cuya organización no deja usar clientes OAuth propios): la cuenta de Google se añade en
Ajustes del Sistema → Cuentas de internet con «Mail» activado (el inicio de sesión es el de Apple) y el refugio lee la
app Mail con `server/integraciones/mail.jxa` (`osascript -l JavaScript`). La primera vez macOS pide permiso de
Automatización para controlar Mail. Mail tiene que estar abierta (no se abre sola). Sondeo cada 60 s: sin leer en el
Buzón de entrada de cada cuenta, últimos 7 días, 25 como máximo (~0,5 s); el texto (fragmento) solo de los nuevos y
con 10 s como mucho por lectura, porque el de un correo que Mail aún no ha bajado tarda ~8 s: lo que falte llega en las
siguientes. Los avisos de
cuentas de Gmail (`imap.gmail.com`, también Workspace) abren el correo en Gmail con `rfc822msgid:` en la cuenta de su
dirección; los de otras cuentas, en Mail (`message:`).

| Campo | Etiqueta | Secreto | Ayuda |
|---|---|---|---|
| `cuentas` | Solo estas cuentas (opcional) | no | Nombres de cuenta de Mail o direcciones, separados por comas. Vacío: todas. |

**Calendario del Mac** — solo lectura, sin secretos. Los calendarios que ya tienes en la app Calendario (cuentas de
Ajustes del Sistema → Cuentas de internet con «Calendarios» activado: Google, Exchange, iCloud…), sin proyecto en
Google Cloud. Lee con `server/integraciones/calendario.jxa` (`osascript -l JavaScript`); la primera vez macOS pide
permiso de Automatización para controlar Calendario, que tiene que estar abierta (no se abre sola). Sondeo cada 5 min,
de hoy a +14 días (~3 s): lee cada propiedad de todos los eventos de cada calendario de una vez y filtra en el lector
(con `whose`, Calendario tarda diez veces más). Por AppleScript, Calendario solo da el primer evento de cada serie: las
repeticiones las despliega `repeticiones()` en `normalizar.ts` (RRULE con FREQ, INTERVAL, COUNT, UNTIL, BYDAY,
BYMONTHDAY y BYMONTH, sin las fechas excluidas; una repetición movida llega como evento suelto con el mismo uid y
manda esa). Sin avisos en el tablón: solo la agenda. El enlace de Meet, Zoom o Teams sale del lugar o de las notas.

| Campo | Etiqueta | Secreto | Ayuda |
|---|---|---|---|
| `calendarios` | Solo estos calendarios (opcional) | no | Nombres de calendario tal como salen en Calendario, separados por comas. Vacío: todos. |

**Discord** — bot oficial; **prohibido** el token de usuario. Los mensajes directos no llegan (ningún bot los ve).

| Campo | Etiqueta | Secreto | Ayuda |
|---|---|---|---|
| `token` | Token del bot | sí | Portal de desarrolladores → app → Bot → Reset Token → Copy. Activar «Message Content Intent». |
| `canales` | Canales a vigilar | no (opcional) | Se eligen en la cámara acorazada una vez conectado. Vacío = todos los que ve el bot. Las menciones llegan siempre. |
| `usuario` | Tu ID de usuario de Discord | no (opcional) | Solo si la app pertenece a un equipo; si no, se deduce del dueño de la app. |

Gateway (WebSocket) con intents `GUILDS | GUILD_MESSAGES` y `MESSAGE_CONTENT` solo si el portal lo concede. Sin él,
o si el Gateway cierra con 4014, se reconecta sin ese intent y se notifican los mensajes con un aviso en lugar del
texto. Prioridad alta: menciones a ti, a tus roles y respuestas a tus mensajes; media: `@everyone`/`@here`; baja: el
resto de los canales elegidos. Al conectar se rellenan las últimas 24 h de los canales que el bot ve. Reanuda
(Resume) siempre que puede. El estado nombra los canales privados que el bot no ve y no se avisa de canales que tú no
ves.

**Slack** — app propia en tu espacio de trabajo, token de bot (`xoxb-`) o de usuario (`xoxp-`).

| Campo | Etiqueta | Secreto | Ayuda |
|---|---|---|---|
| `token` | Token de OAuth | sí | api.slack.com/apps → tu app → OAuth & Permissions. |
| `canales` | Canales a vigilar | no (opcional) | Se eligen una vez conectado. Vacío = todos. Directos y menciones llegan siempre. |
| `usuario` | Tu ID de miembro | no (opcional) | Solo con token de bot, para tus menciones. Con token de usuario se sabe solo. |

Ámbitos: `channels:read`, `channels:history`, `groups:read`, `groups:history`, `users:read` (y con token de usuario,
`im:read`, `im:history`, `mpim:read`, `mpim:history`). Ninguno de escritura. Sondeo cada 60 s con
`conversations.history` desde el último mensaje visto de cada conversación (25 como máximo por vuelta, las de
actividad más reciente; al conectar, las últimas 24 h).

**GitHub** — notificaciones sin leer (`GET /notifications`).

| Campo | Etiqueta | Secreto | Ayuda |
|---|---|---|---|
| `token` | Token personal (clásico) | sí (opcional) | Con el permiso `notifications`. Vacío: se usa la sesión de `gh` (`gh auth token`) si la hay. |

Los tokens fine-grained no sirven para la API de notificaciones. Sondeo cada 60 s con `If-Modified-Since` (un 304 no
gasta cuota). Prioridad alta: te piden revisión, te mencionan, te asignan, alertas de seguridad.

**Revisiones de tus PR, a su sala** (`server/revisionesPR.ts`). Con GitHub conectado, cada 2 min se leen con `gh` tus
PR abiertos (revisiones, hilos sin resolver y comentarios de la conversación; sin lo tuyo ni los comentarios de bots)
y lo nuevo va como mensaje a la conversación abierta en la rama del PR: el worktree (o la carpeta) de la sala de su repo
(por el remoto `origin`) con esa rama o, si no hay, un worktree de esa sala con la clave de la tarea en el nombre. El
habitante propone un plan (qué arreglar y qué contestar) y no toca nada hasta que el Supervisor lo aprueba; el robot
mensajero lo lleva desde Control de Versiones y se lo da en mano al holograma de ese worktree (al habitante, si es la
copia principal). Sin conversación en esa rama, un aviso, y se entrega en cuanto la haya.
Lo de antes de conectar no se manda; lo entregado se apunta en `revisiones-pr.json` (carpeta de datos).

**Linear** — GraphQL con clave personal (`Authorization: <clave>`, sin `Bearer`), solo lectura desde el juego.

| Campo | Etiqueta | Secreto | Ayuda |
|---|---|---|---|
| `apiKey` | Clave de API de Linear | sí | Settings → Account → Security & access → Personal API keys. «Read» para los paneles; «Write», «Create issues» y «Create comments» para que el habitante actúe. |

Notificaciones sin leer del inbox (las 100 últimas; sin archivadas ni pospuestas) cada 60 s; mis issues y ciclos
cada 5 min.

**Jira** — REST v3 de Jira Cloud con autenticación básica (correo + token de API), solo lectura. No trae avisos al
tablón (`sinAvisos` en `shared/fuentes.ts`): alimenta el tablero de Logística.

| Campo | Etiqueta | Secreto | Ayuda |
|---|---|---|---|
| `sitio` | Sitio de Jira | no | `empresa.atlassian.net` (se acepta la URL entera y se queda con el dominio). |
| `correo` | Correo de tu cuenta de Atlassian | no | El de tu usuario de Jira. |
| `token` | Token de API | sí | id.atlassian.com → Seguridad → Tokens de API → Crear token de API (sin ámbitos). |

Acción `panel` (`{ forzar? }`) → `{ yo, tareas }` con `POST /rest/api/3/search/jql` y
`assignee = currentUser() AND (statusCategory != Done OR updated >= -14d)`. Los PR del tablero salen de GitHub con `gh`
(acción `git.prsTablero`: tuyos, actualizados en las dos últimas semanas, con revisión y CI) y se cruzan con las tareas
en el cliente por la clave de Jira de la rama o del título (`cruzarTablero` en `shared/tablero.ts`).

Acción `tarea` (`{ clave }`) → la tarea con su descripción en texto (`textoDeADF`), para planificarla.

**Planificar y repartir una tarea.** En el tablero (desde Logística o desde el panel de la sala de Planificación), una
tarea «Por hacer» se planifica con P: el habitante de la sala de Planificación empieza en modo plan con la tarea y su
descripción (`promptPlanificar`), ve todos los repos y propone un plan por repo. Aprobado, lo reparte con las
herramientas del juego `salas_del_refugio` y `repartir_trabajo` (`server/reparto.ts`, MCP en el propio proceso, solo en
las salas de coordinación): el Supervisor confirma y cada parte empieza una conversación en la sala de su repo, en un
worktree propio cuya rama lleva la clave (así sus PR salen en la tarea). La ficha dice qué salas tienen ya algo en
marcha de esa tarea. La sala de Planificación es de serie (`SALA_PLANIFICACION`, tipo `coordinacion`, en la planta -2
junto a Control de Versiones; la agenda, tipo `planificacion`, es solo el calendario): su carpeta es siempre la raíz de
repos del refugio (`raizRepos`, en la cámara acorazada) y no se retira ni se vincula a otra carpeta. En la Puerta se
pueden reclutar más salas de coordinación (cualquier carpeta con varios repos dentro).

**Plan compartido.** `repartir_trabajo` guarda el plan entero (`server/planes.ts`, `DATOS/planes.json`, con versión e
historial) y cada parte lo lee con `plan_compartido` (MCP `plan` en las salas que tienen una parte). Desde Planificación,
`actualizar_plan` saca una versión nueva y manda un mensaje a la conversación de cada sala afectada (con `afectadas`,
solo a esas y con lo que le toca a cada una), y `avisar_sala` manda un mensaje sin cambiar el plan; los dos identifican
la tarea por su clave (`📋 [ABC-123] …`) y van a la conversación de la parte o, si ya no está, a la abierta en el
worktree de la tarea. Desde una parte, `proponer_cambio_plan` le lleva la propuesta a la conversación de Planificación.
Cada envío lo hace a la vista un robot mensajero con los planos (`web/src/mundo/mensajero.ts`, mensaje `mensajero`).

**Organizar las salas por tareas.** Desde el panel de una sala de repo («Organizar por tareas») o con ⌘K «Organizar las
salas por tareas» (todas): tus PR sin fusionar del repo de cada sala (por su remoto `origin`) se agrupan por tarea, la
clave de Jira de la rama o del título, y los apilados (la base de uno es la rama de otro) van siempre juntos
(`server/organizar.ts`). Cada tarea tiene su worktree (el que ya la trabaje, por rama o por nombre; si no, uno nuevo en
`.claude/worktrees/shelter-<clave>` con la rama de la base de la pila y las de encima como ramas locales del remoto; si su
rama está en la copia principal, ahí) y su propia conversación con el habitante, en modo plan, que trabaja sus PR de uno
en uno (checkout, arreglar y rebasar los de encima). Primero se enseña el plan y Enter lo hace; no empieza más
conversaciones que el límite de sesiones vivas. Las revisiones nuevas de esos PR llegan a esa conversación
(`sesionDelPR`, también por el número en el nombre: `shelter-pr-12-13`).

**El color de cada tarea.** Cada tarea (clave de Jira; sin ella, `PR-<número>`) tiene un color de una paleta de 16
(`shared/tareas.ts`) que reparte Logística: al leer el tablero de Jira, el servidor da a cada tarea el suyo y viaja con
ella (`server/coloresTareas.ts`, `DATOS/colores-tareas.json`; las que no son de Jira, con la acción `tareas.colores`): la
nueva recibe el que menos se usa entre las vistas en las dos últimas semanas. Es el mismo en el
tablero de Jira, el de despliegue, la pestaña Pull requests, organizar, las pantallas de Logística y Planificación y el
holograma (y el letrero) de la copia que trabaja la tarea: de un vistazo se ve qué tarea tiene sesiones en qué sala.

**Revisiones de tus PR.** Lo nuevo de otros en tus PR va a la conversación abierta en el worktree de su tarea
(`server/revisionesPR.ts`). Si no hay ninguna abierta, se retoma la última de ese worktree (o se empieza una, en modo
plan) con la revisión; si la tarea no tiene worktree, se avisa: es raro (falta organizar la sala por tareas).

**Plan de despliegue.** En la pantalla grande de la sala de Planificación (su escena de serie, sin decorado:
`web/src/mundo/salas/despliegue.ts`; un clic en ella lo abre), en el panel de la sala o con ⌘K «Plan de despliegue», tus PR por estado (borrador,
en revisión, piden cambios, aprobado, fusionado) con los bloqueos entre ellos como flechas y el orden en que pueden
fusionarse, por olas (`shared/despliegue.ts`, `web/src/ui/Despliegue.tsx`). Un PR espera a otro si va apilado encima (su
base es la rama del otro), si su título o descripción lo dice («depends on #12», «bloqueado por org/repo#7», el enlace
al PR) o si lo marcas con B (se guarda en `DATOS/bloqueos-pr.json`, `server/bloqueosPR.ts`; X lo quita). P le pasa el
tablero al habitante de la sala, que propone el plan en modo plan sin tocar los repos. La lista de tus PR y los que
esperan tu revisión está en Control de Versiones (pestaña Pull requests del cliente de git; T desde el tablero de Jira).

## MCP oficial de Linear para el habitante de Logística

`server/integraciones/linear.ts` exporta:

- `mcpLinear({ soloLectura? })` → `{ linear: { type: 'http', url: 'https://mcp.linear.app/mcp', headers? } }`
  (transporte HTTP transmitible).
- `entornoMcpLinear()` → `{ SHELTER_LINEAR_CLAVE: <clave> }` o `{}`.

Con clave en el llavero, la cabecera es literalmente `Authorization: Bearer ${SHELTER_LINEAR_CLAVE}`. El SDK pasa
`mcpServers` al CLI como argumento `--mcp-config` (visible en `ps`), por eso la clave **no** va ahí: Claude Code
expande `${VAR}` en las configuraciones MCP de la línea de comandos y la variable va solo en el entorno del proceso
hijo. Sin clave en el llavero se devuelve el servidor sin cabeceras y vale la autorización OAuth de Claude Code:
abrir `claude` en la carpeta, `/mcp` → `linear` → *Authenticate* e iniciar sesión en el navegador.

### Claude Code en la terminal (opcional, fuera del juego)

```bash
claude mcp add --transport http linear https://mcp.linear.app/mcp      # ámbito local; --scope user para todos
```

Luego `/mcp` → `linear` → *Authenticate*.

### Codex (`~/.codex/config.toml`, sección `mcp_servers`)

```bash
codex mcp add linear --url https://mcp.linear.app/mcp     # y luego: codex mcp login linear (OAuth en el navegador)
```

que equivale a:

```toml
[mcp_servers.linear]
url = "https://mcp.linear.app/mcp"
# Alternativa sin OAuth: la misma clave de API desde una variable de entorno
# bearer_token_env_var = "SHELTER_LINEAR_CLAVE"
```

## Pruebas

`npm test` ejecuta `server/integraciones/*.test.ts` sin red: normalizadores contra `test/fixtures/` y los conectores
completos con `fetch` simulado, llavero en memoria, el retorno de OAuth por localhost y un Gateway de Discord simulado
en `127.0.0.1`. Los fixtures son sintéticos (personas, empresas y dominios inventados; no hay credenciales).

## Límite conocido: la clave de Linear en el entorno del habitante de Logística

Para que el MCP oficial de Linear se autentique sin poner la clave en los argumentos (visibles con `ps`), el refugio
la pasa en la variable `SHELTER_LINEAR_CLAVE` del proceso de Claude Code de Logística. Esa variable la heredan también
sus herramientas (`Bash`, hooks, otros MCP): un `env` ejecutado por el habitante la mostraría en la transcripción. Si
no quieres ese riesgo, no guardes clave de Linear en la cámara acorazada: el MCP oficial pedirá autorizarlo por OAuth
en el navegador la primera vez, y el tablero de Logística seguirá en DEMO.
