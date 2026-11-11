# Salir a la superficie

Para cuando el juego se cae o no conviene que se vea: todo lo que tienes abierto en el refugio (conversaciones con
los habitantes y terminales) sigue en una terminal normal de tu escritorio. Usa iTerm si está instalado; si no,
Terminal (`SHELTER_TERMINAL=terminal` o `iterm` para elegir). En el juego, todo esto está también en el Manual del
Supervisor (F1), sección «A la superficie».

## Las cuatro maneras

| Cómo | Qué saca |
| --- | --- |
| **⇧⌥⌘Esc** (desde cualquier app) | Todo. El juego desaparece al momento (ventana, icono del Dock y sonido) y lo abierto sale a una ventana nueva de iTerm, una pestaña por cosa. La misma tecla, abrir la app o un clic en su icono lo devuelve tal como estaba. |
| **Botón ↗ o ⌘⇧E** en un intercomunicador o una terminal | Solo la pestaña activa, a una pestaña de la ventana de iTerm que tengas delante. |
| **`./shelter superficie`** (en la carpeta del juego) | Todo. Con el juego abierto se lo pide a él; con el juego caído, retoma las conversaciones que quedaron abiertas y engancha las terminales que sigan vivas. `--lista` solo enseña qué hay. |
| **Sola, si el juego se cae** | Si la ventana desaparece sin pasar por «Salir» y no vuelve en 20 s, todo sale a tu escritorio antes de que el refugio se apague. Si solo se cuelga la página, la ventana se recarga sola y no sale nada. |

Ojo: **⇧⌥⌘Esc mantenido 3 segundos** es el «forzar salida» de macOS. Púlsala rápido. Si llegara a cerrar el juego,
a los 20 s todo sale igualmente.

## Conversaciones

- Se cierran en el juego y se abren fuera con `cd <carpeta> && claude --resume <id>`, con el mismo modelo, esfuerzo
  y permisos. Al salir de Claude Code te quedas en la carpeta del proyecto, con tu shell y tu historial.
- Si estaban trabajando o esperando un permiso, se interrumpen y fuera se les pide que sigan con lo que estaban
  haciendo.
- **Para traerlas de vuelta:** sal con `/exit` en iTerm y, en el juego, habla con el habitante → «Retomar un trabajo
  anterior». Mientras sigan abiertas fuera, el archivo las marca con ↗ y el juego no deja retomarlas (dos Claude Code
  escribiendo la misma conversación la corromperían).
- Fuera no tienen lo que solo existe en el juego: el MCP de Linear de Logística y las instrucciones del refugio.

## Terminales

- No es una copia: es la misma terminal (el mismo shell, con lo que tenga en marcha) en el juego y fuera a la vez. Lo
  que escribas en un sitio se ve en el otro.
- Mientras esté abierta fuera, manda el tamaño de la ventana de fuera, y en el juego la pestaña lleva ↗ y pone
  «también en tu escritorio».
- Sobrevive aunque cierres el juego mientras siga abierta fuera. Al volver a abrir el juego, reaparece en su pestaña.
- Cerrar la pestaña de iTerm la suelta: sigue en el juego (con el juego cerrado, se cierra sola a los 10 minutos). `exit` la termina en los dos sitios.
- A mano: `./shelter enganchar <id>` (el id es el de la pestaña del juego, p. ej. `sala:express` o `sala:express::2`).

## La primera vez

macOS pide permiso para que work-shelter maneje iTerm. Si lo deniegas, permítelo en Ajustes del Sistema ›
Privacidad y seguridad › Automatización.

## Para quien toca el código

`server/escritorio.ts` (comandos y AppleScript), `server/superficie.ts` (`./shelter superficie` y `enganchar`), la
acción `superficie.sacar` en `server/main.ts`, `Sesiones.sacar` en `server/sesiones.ts`, los clientes de fuera del
anfitrión en `server/anfitrionTerminales.ts` y la tecla de pánico en `electron/main.cjs`. QA:
`node scripts/qa-superficie.mjs` (servidor propio en 3793; `SHELTER_ESCRITORIO_PRUEBA` apunta lo que abriría en vez
de abrir ventanas).

## A la app de Claude

El botón ✳ del intercomunicador (o «Seguir … en la app de Claude» en ⌘K) cierra la conversación en el refugio y la
abre en la app de escritorio de Claude con su enlace `claude://resume?session=<id>`, que la importa en su lista (lee la
misma transcripción de `~/.claude/projects`). Para volver a traerla, «Retomar un trabajo anterior» en su habitante
(cerrándola antes en la app, para no escribirla en dos sitios). Servidor: `superficie.appClaude` (`server/main.ts`) y
`abrirEnAppClaude` (`server/escritorio.ts`; con `SHELTER_ESCRITORIO_PRUEBA` apunta el enlace en vez de abrirlo).

## Remote Control de una sala

En el panel de una sala de repo, «Encender Remote Control» deja un `claude remote-control --permission-mode auto` en
su carpeta, con el nombre «<sala> · work-shelter»: desde la pestaña Code de la app de Claude en el móvil o desde
claude.ai/code se abren sesiones de ese repo que corren en este Mac. Es un proceso aparte (`server/controlRemoto.ts`):
sobrevive a reiniciar o cerrar el juego, se apunta en `DATOS/control-remoto/` y, al arrancar el servidor, se vuelve a
encender si se había caído; se apaga desde el mismo panel o al retirar o vincular la sala. La primera vez Claude Code
pide aceptar Remote Control: el juego lo detecta, lo para y explica cómo aceptarlo una vez en la terminal de la sala.
Las conversaciones del intercomunicador no salen ahí (van por el SDK, sin Remote Control).

## Al móvil con Remote Control

El botón 📱 del intercomunicador (o «Seguir … en el móvil» en ⌘K) saca esa conversación a una pestaña de iTerm con
`claude --resume <id> --remote-control "<repo>:<TAREA>"` (la tarea del worktree o la clave del título; sin ella,
`<repo>:<título>`; `remoteName` en `shared/tareas.ts`): sigue en tu Mac y se abre, con ese nombre, desde la app de
Claude del móvil o claude.ai/code. Abierta fuera, es un visitante de su sala: desde el robot se trae de vuelta. «Todo al móvil» (menú de Esc o ⌘K) hace lo mismo con todas las conversaciones
abiertas, en una ventana nueva; las terminales se quedan en el juego. Como al salir a la superficie, la conversación se
cierra antes en el refugio. Necesita el Mac despierto. Servidor: `superficie.sacar` con `remoto` (`server/main.ts`) y
`resumeCommand` (`server/escritorio.ts`).

## Mando a distancia por Slack

Para no salir del refugio cuando un habitante te necesita y no estás delante: «Slack (mando a distancia)» en la cámara
acorazada, con las demás integraciones (no es una fuente de avisos: no lee nada). Copias el manifiesto, creas la app
desde él en api.slack.com/apps (Socket Mode, solo `chat:write` e `im:history`, evento `message.im`), generas el token
de la app (`xapp-`, con `connections:write`), la instalas (token del bot, `xoxb-`) y pegas los dos (al llavero, cuentas
`slackRemote.appToken` y `slackRemote.botToken`). Para emparejar, le mandas al bot por privado el código que enseña el
juego (un solo uso, 10 minutos; cinco intentos fallidos lo caducan).

- **Aprobaciones**: el bot solo escribe por su cuenta cuando una conversación pide aprobación (permiso, plan, pregunta o
  confianza), con la petición tal cual la enseña el diálogo del juego y sus botones: sí / no (nunca «sí, siempre»), y en
  las preguntas una opción por botón, de una en una (las de varias respuestas, en el refugio). Se responde en el propio
  refugio: la conversación sigue aquí. Lo que no cabe entero (unos 3500 caracteres) no se puede aprobar desde el móvil.
  Al responder, aquí o allí, el mensaje se queda en una línea sin el contenido, y sus botones dejan de valer. La
  respuesta a cada botón llega como mensaje que solo ves tú.
- **Lista**: escribiendo cualquier cosa, las salas con sus conversaciones abiertas (habitante, título, estado y hora de
  fin), con un botón 📱 por conversación (y otro para todas) que la pasa a Remote Control para seguirla en la app de
  Claude.

Lo que sale: los rótulos y, para aprobar, la petición en bloques de texto plano (nada se interpreta como formato), con
los caracteres invisibles a la vista (⟦U+XXXX⟧) y los secretos con forma de token tapados (solo caracteres de token:
tapar nunca esconde código); la notificación, solo con la primera línea (quién lo pide), nunca el comando. Nunca lo que
se habla. Es otra app que la de los avisos de Slack (`integraciones/slack.ts`), que sigue siendo de solo lectura. Slack
no cifra de extremo a extremo y guarda los mensajes con las normas del espacio de trabajo: en el de una empresa,
pregunta antes. Solo obedece al espacio de trabajo, al mensaje directo y a la persona emparejados; lo demás se ignora
sin responder. Sin puertos abiertos: Socket Mode (el servidor abre un WebSocket hacia Slack y lo reabre si Slack lo pide
o se cae). Solo lo escucha el refugio de verdad (sin `SHELTER_DATOS`; los de prueba, con `SHELTER_SLACK=1`). Código: lo
común en `server/mando.ts`, lo de Slack en `server/slackMando.ts` (pruebas en `server/slackMando.test.ts`), acciones
`slackRemote.*` y su vista `SlackRemoteView` en la cámara (`web/src/ui/Camara.tsx`); los invisibles, en
`shared/visible.ts` (los mismos del diálogo).
