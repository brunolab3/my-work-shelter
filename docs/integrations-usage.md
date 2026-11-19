# Integrations: how they work, what the Vault asks for, and the Linear MCP

What each connector in `server/integrations/` does, what the Vault asks for, where each piece of data is stored, how
Logistics and PR reviews use them, and how to connect Linear's official MCP in Claude Code and in Codex. Step-by-step
guides for getting each credential are also inside the game (Vault → the source).

## Principles

- **States per source**: off (how a new shelter starts, and where "forget" leaves it: nothing is read, not even the
  sources that need no setup), demo (simulated data, marked DEMO, only if you choose it), real and connected, or real
  with an error and its reason. In real mode without complete data, the state is *not configured* and says what's
  missing.
- **Read-only outwards.** No connector sends emails, messages or events, and the permissions requested are read
  permissions. The few external writes are listed in [`SECURITY.md`](../SECURITY.md#precautions-the-code-takes).
- **Nobody's identifiers.** Each user creates their own app (Microsoft Entra, Google Cloud, Discord bot, Slack app)
  and pastes its data. The repo ships no client IDs, tokens or URLs of any organisation.
- **Secrets only in the macOS keychain** (`server/integrations/keychain.ts`): service `work-shelter-public`, account
  `<source>.<field>` (`linear.apiKey`, `discord.token`, `slack.token`, `github.token`, `google.clientSecret`,
  `outlook.refreshToken`, `google.refreshToken`). They're written with `security -i` (the command goes through stdin,
  so the secret doesn't show in `ps`) and in base64. `.data/refugio.json` only holds the non-secret data
  (`integraciones.<source>.campos`) and the **names** of the saved secrets (`integraciones.<source>.secretos`). No
  secrets in git, logs or error messages. Its limitation (other processes of your user can read them):
  [`SECURITY.md`](../SECURITY.md#known-risks).

## Switched-off sources

A source with `desactivada: true` in `shared/sources.ts` creates no connector and doesn't appear in the Vault, the
notice board, the calendar or Planning (`ACTIVE_SOURCES`); its code is still there. Currently **Microsoft 365** and
**Linear** are off (without Linear, the Planning dweller doesn't carry its MCP either). To turn one back on, remove
the flag.

## Adding a new source

1. Its id, name, color and what it brings, in `shared/sources.ts`.
2. The real connector in `server/integrations/<id>.ts` with `export function crear(almacen)` (almost always a
   subclass of `ConnectorBase` from `common.ts` with its `Field[]`).
3. Its pure normalisers in `normalize.ts`, with synthetic fixtures in `test/fixtures/` and tests.
4. Its DEMO data in `demo.ts`.
5. Its step-by-step guide in `web/src/ui/Vault.tsx` (`GUIDES`), and if it has a website that can be opened inside
   the game, its entry in `web/src/ui/Browsers.tsx` (`SPOTS`).

## The notice board: what's pending, by conversation

Connectors deliver messages with a `hilo` (Discord or Slack channel, mail conversation, Linear issue, GitHub thread)
and `Integraciones` broadcasts them grouped (`groupNotices` in `normalize.ts`): one entry per conversation with
`cuantos`, `ids`, `authors` and the latest `mensajes`. Its id changes with each new message (it chimes and goes back
to "unseen"); `marcarVista` receives the `ids` of its messages. Microsoft 365, Google, Mac Mail, GitHub and Linear
poll with `complete: true`: what they return is everything pending there, and whatever no longer comes (read on its
website) leaves the board. Discord and Slack have no read state for a bot: they accumulate what arrives.

## Vault actions (over WebSocket, `integracion.<action>` with `{ fuente, ... }`)

| Action | What it does |
|---|---|
| `campos` | Returns `{ campos, valores, guardados }`: field definitions, current public values and which secrets are saved (without their value). |
| `probar` | `{ campos }` → `{ ok, detalle }`. An empty secret means "use the saved one". |
| `guardar` | `{ campos, activar? }` → saves (public values to the state, secrets to the keychain), tests and, if it passes, switches the source to real (unless `activar: false`). |
| `modo` | `{ modo: 'off' \| 'demo' \| 'real' }`. |
| `refrescar` | Polls now. |
| `olvidar` | Deletes the secrets from the keychain and the fields, and turns the source off. |
| Microsoft / Google `conectar` | Opens the authorisation in the system browser (`abrir: false` only returns the URL). |
| Microsoft / Google `desconectar` | Deletes the session (refresh token). |
| Discord `invitacion` | URL to invite the bot with read-only permissions (66560). |
| Discord / Slack `canales` | Channels to choose from. Save the selection with `guardar { campos: { canales: 'id1,id2' } }`. |
| Linear `panel` | `{ yo, myIssues (by state), cycles (current cycle per team) }`. |
| Linear `tablero` | `{ equipo: <key> \| <id>, prioridad?: 'alta', etiqueta?, proyecto?, assignedAMi?, ciclo?: 'actual' }` → columns by state. |

## Browser sign-in (Microsoft and Google)

`server/integrations/oauth.ts`: native-app OAuth 2.0 (RFC 8252), authorisation code + PKCE (S256) and a random
`state`, returning to `http://localhost:<free port>` (IPv4 and IPv6). The listener is single-use and closes when the
browser comes back or after 5 minutes. The access token lives only in memory; the refresh token, in the keychain.

## Fields of each source

**Microsoft 365 (Outlook)** — Microsoft Graph, read-only. You register your own app in Microsoft Entra.

| Field | Label | Secret | Help |
|---|---|---|---|
| `clientId` | Application (client) ID | no | Entra → App registrations → your app → "Application (client) ID". |
| `tenant` | Tenant | no (optional) | Empty: `common`. If the app is single-organisation, its "Directory ID". |

Registration: platform *Public client/native (mobile and desktop)* with the URI `http://localhost` (Entra accepts any
port on localhost), no secret. Delegated permissions: `User.Read`, `Mail.Read`, `Calendars.Read` and
`offline_access`. Polling: unread inbox mail from the last 7 days (metadata + `bodyPreview`, 25 at most) every 60 s;
`calendarView` from today to +14 days every 5 min, in the system time zone.

**Google (Gmail and Calendar)** — read-only. Either the session of the `gws` CLI (Google Workspace CLI, a
community tool) or your own OAuth client in Google Cloud.

| Field | Label | Secret | Help |
|---|---|---|---|
| `clientId` | Client ID | no (optional) | Google Cloud → APIs & Services → Credentials → OAuth client of type "Desktop app". Both empty: the `gws` session. |
| `clientSecret` | Client secret | yes (optional) | The same client's (not confidential in a desktop app, but it goes to the keychain anyway). |

With both fields empty, the connector borrows `gws`'s session, as GitHub does with `gh` (how: `gwsCredentials()` in
`google.ts`). Sign in with `gws auth login` including Gmail and Calendar (e.g. `-s gmail,calendar`); without a
session, with one Google revoked, or without those scopes, the Vault says what to run. "Connect with Google" is for
your own client only; to go from your own client to gws, "Forget" the source and save it empty.

With your own client, enable the Gmail API and Google Calendar API in the project and, with the consent screen in "Testing", add yourself
as a test user. In that mode Google cuts the refresh token after 7 days: the state explains it and reconnecting is
enough. Scopes: `gmail.readonly` and `calendar.readonly`. Polling, either way: `is:unread in:inbox newer_than:7d` (25 at most,
metadata and snippet; already-seen ones aren't fetched again) every 60 s; the primary calendar from today to +14 days
every 5 min.

**Mac Mail (Gmail without Google Cloud)** — read-only, no secrets. For whoever can't or doesn't want to create a
Google Cloud project (or whose organisation doesn't allow their own OAuth clients): the Google account is added in
System Settings → Internet Accounts with "Mail" on (the sign-in is Apple's) and the shelter reads the Mail app with
`server/integrations/mail.jxa` (`osascript -l JavaScript`). The first time, macOS asks for Automation permission to
control Mail. Mail must be open (it doesn't open itself). Polling every 60 s: unread in each account's Inbox, last 7
days, 25 at most (~0.5 s); the text (snippet) only for new ones and with at most 10 s per read, because a mail Mail
hasn't downloaded yet takes ~8 s: whatever is missing arrives in the next rounds. Notices from Gmail accounts
(`imap.gmail.com`, Workspace too) open the mail in Gmail with `rfc822msgid:` in the account of its address; those from
other accounts, in Mail (`message:`).

| Field | Label | Secret | Help |
|---|---|---|---|
| `cuentas` | Only these accounts (optional) | no | Mail account names or addresses, comma-separated. Empty: all. |

**Mac Calendar** — read-only, no secrets. The calendars you already have in the Calendar app (System Settings →
Internet Accounts with "Calendars" on: Google, Exchange, iCloud…), without a Google Cloud project. It reads with
`server/integrations/calendar.jxa` (`osascript -l JavaScript`); the first time, macOS asks for Automation
permission to control Calendar, which must be open (it doesn't open itself). Polling every 5 min, from today to +14
days (~3 s): it reads each property of all events of each calendar at once and filters in the reader (with `whose`,
Calendar takes ten times longer). Through AppleScript, Calendar only gives the first event of each series: repetitions
are expanded by `repetitions()` in `normalize.ts` (RRULE with FREQ, INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY and
BYMONTH, minus excluded dates; a moved occurrence arrives as a standalone event with the same uid and wins). No
notices on the board: only the calendar. The Meet, Zoom or Teams link comes from the location or the notes.

| Field | Label | Secret | Help |
|---|---|---|---|
| `calendarios` | Only these calendars (optional) | no | Calendar names as they appear in Calendar, comma-separated. Empty: all. |

**Discord** — official bot; the user token is **forbidden**. Direct messages don't arrive (no bot sees them).

| Field | Label | Secret | Help |
|---|---|---|---|
| `token` | Bot token | yes | Developer portal → app → Bot → Reset Token → Copy. Enable "Message Content Intent". |
| `canales` | Channels to watch | no (optional) | Chosen in the Vault once connected. Empty = every channel the bot sees. Mentions always arrive. |
| `usuario` | Your Discord user ID | no (optional) | Only if the app belongs to a team; otherwise it's inferred from the app's owner. |

Gateway (WebSocket) with intents `GUILDS | GUILD_MESSAGES` and `MESSAGE_CONTENT` only if the portal grants it. Without
it, or if the Gateway closes with 4014, it reconnects without that intent and messages are notified with a notice
instead of the text. High priority: mentions of you, of your roles and replies to your messages; medium:
`@everyone`/`@here`; low: the rest of the chosen channels. On connecting it backfills the last 24 h of the channels the
bot sees. It resumes (Resume) whenever it can. The state names the private channels the bot can't see, and there are
no notices from channels you can't see.

**Slack** — your own app in your workspace, bot token (`xoxb-`) or user token (`xoxp-`).

| Field | Label | Secret | Help |
|---|---|---|---|
| `token` | OAuth token | yes | api.slack.com/apps → your app → OAuth & Permissions. |
| `canales` | Channels to watch | no (optional) | Chosen once connected. Empty = all. Direct messages and mentions always arrive. |
| `usuario` | Your member ID | no (optional) | Only with a bot token, for your mentions. With a user token it's known by itself. |

Scopes: `channels:read`, `channels:history`, `groups:read`, `groups:history`, `users:read` (and with a user token,
`im:read`, `im:history`, `mpim:read`, `mpim:history`). None for writing. Polling every 60 s with
`conversations.history` from the last message seen in each conversation (25 at most per round, those with the most
recent activity; on connecting, the last 24 h). The Slack remote control is a separate app: see `docs/surface.md`.

**GitHub** — unread notifications (`GET /notifications`).

| Field | Label | Secret | Help |
|---|---|---|---|
| `token` | Personal token (classic) | yes (optional) | With the `notifications` scope. Empty: the `gh` session is used (`gh auth token`) if there is one. |

Fine-grained tokens don't work with the notifications API. Polling every 60 s with `If-Modified-Since` (a 304 costs
no quota). High priority: review requested, mentioned, assigned, security alerts.

**Linear** — GraphQL with a personal key (`Authorization: <key>`, without `Bearer`), read-only from the game.

| Field | Label | Secret | Help |
|---|---|---|---|
| `apiKey` | Linear API key | yes | Settings → Account → Security & access → Personal API keys. "Read" for the panels; "Write", "Create issues" and "Create comments" for the dweller to act. |

Unread inbox notifications (the last 100; no archived or snoozed) every 60 s; my issues and cycles every 5 min.

**Jira** — Jira Cloud REST v3 with basic auth (email + API token), read-only except for the status change you confirm
on the board (below). It brings no notices to the board
(`withoutNotices` in `shared/sources.ts`): it feeds the Planning board.

| Field | Label | Secret | Help |
|---|---|---|---|
| `sitio` | Jira site | no | `company.atlassian.net` (the whole URL is accepted and the domain kept). |
| `correo` | Your Atlassian account email | no | Your Jira user's. |
| `token` | API token | yes | id.atlassian.com → Security → API tokens → Create API token (no scopes: a read-only scoped token can't move tasks). |

Action `panel` (`{ forzar? }`) → `{ yo, tareas }` with `POST /rest/api/3/search/jql` and
`assignee = currentUser() AND (statusCategory != Done OR updated >= -14d)`. The board's PRs come from GitHub with `gh`
(action `git.prsTablero`: yours, updated in the last two weeks, with review and CI) and are matched with the tasks in
the client by the Jira key in the branch or title (`cruzarTablero` in `shared/board.ts`).

Action `tarea` (`{ clave }`) → the task with its description as text (`textoDeADF`), for planning it.

**Moving a task on the board.** Drag a card to another column (or ⇧←→ on the selected one). Action `transiciones`
(`{ clave, columna, actual? }`) reads `GET /rest/api/3/issue/{key}/transitions` and keeps those whose target status
falls in that column and isn't the current one (`jiraTransitions`, `transitionsTo` in `shared/board.ts`, the same
rules as the columns): none says the workflow doesn't allow it; otherwise a confirmation shows "KEY: From → To", with
↑↓ to pick when several lead there (Done and Won't do, say). Enter confirms: action `mover` (`{ clave, columna, id }`)
reads the transitions again, refuses an id Jira no longer offers towards that column and posts it
(`POST /rest/api/3/issue/{key}/transitions`), the game's only write to Jira. The card shows the result; the cached
board takes the new status right away (Jira's search lags a few seconds). A 403 means your account lacks "Transition
issues" in that project or the token is scoped read-only. In DEMO nothing moves. Dwellers have no Jira tool.

## Logistics, tasks and PRs

**The Logistics room.** A stock room (id `tareas`, `PLANNING_ROOM` in `shared/layout.ts`, type `coordinacion`,
floor -2 next to Version Control; its dweller is Inés). The Calendar room, type `planificacion`, is just the calendar.
Its folder is always the shelter's repos root (`reposRoot`, in the Vault), so its dweller sees every repo; it can't be
retired or linked to another folder. More `coordinacion` rooms (wings: any folder with several repos inside) can be
recruited at the Main Gate, and choosing the repos root adds them automatically.

**Planning and splitting a task.** On the board (from Planning or from the Logistics room panel), a "To do" task is
planned with P: the Logistics dweller starts in plan mode with the task and its description (`promptPlanificar`), looks
at every repo and proposes a plan per repo. Once approved, it splits it with the game's tools `shelter_rooms` and
`assign_work` (`server/dispatch.ts`, in-process MCP, only in coordination rooms): the Overseer confirms and each
part starts a conversation in its repo's room, in its own worktree whose branch carries the key (so its PRs show up in
the task). The card says which rooms already have something going for that task.

**Messages between rooms.** Every conversation, in any room, has `send_to_room` (`server/roomNotices.ts`, in-process
MCP `rooms`): it hands a message or a job to another room's dweller, no plan and no worktree. Without a task key it
always starts a new conversation with that dweller in its main copy (messages between rooms start work; they are not a
chat); with a key (a Jira one, ABC-123, or a descriptive kebab-case slug for work outside Jira, `preflight-popover`;
`taskKey` in `shared/tasks.ts`) it goes to the conversation open in that task's worktree in that room or, if there is none,
starts one in the task's worktree, creating it if the task has none (in the main copy only when the room's folder isn't a git repo). A slug
task's worktree is named `shelter-<slug>--<suffix>` so the key comes back from its folder or branch (`slugKeyOf`); slugs
are never read from prose, and Jira-only features (the Jira board's title and color) just find nothing. New conversations run in auto
permissions. Each message says which room sent it and how to reply; the messenger robot carries it and a notice shows it.
At most 3 messages a minute from one room to another. It also works inside the same room: with a task key, a dweller
hands that task (or a part of it that can go on its own) to the conversation in the task's worktree, its hologram, and
stays on the Overseer's conversation; there is no robot then: the dweller walks to the hologram and hands it over. A
conversation can't send a message to itself. `assign_work` is only for implementation plans.

**Scheduled messages.** The same MCP `rooms` has `schedule_message`, `list_scheduled` and `cancel_scheduled`
(`server/scheduled.ts`, pure scheduling in `shared/scheduled.ts`): when the Overseer leaves something for another day
("let's review it on Monday"), the dweller schedules a message with the open items. `when` is ISO 8601 in the Mac's
local time; a day without a time means 09:00, and anything due on Saturday or Sunday is held to Monday at 09:00. Without
`room` it comes back to the same conversation: the open one or, if it was closed, resumed by its Claude Code id in its
folder (worktree) in plan mode (if the worktree is gone, a new conversation in the room's folder); with `room` (and
`key`), it is delivered like `send_to_room` at that time. They are saved in `DATOS/mensajes-programados.json` (never
sent anywhere) and checked every minute and on start: whatever fell due while the game was closed arrives on the next
start, marked as late. What can't be delivered (the conversation is open outside, the session limit) stays and is
retried every minute, with one notice. At most 10 pending per conversation, 60 days ahead, no recurring schedules. The
intercom shows "⏰ n scheduled · when" under the portrait (✎ changes time or text, ✕ cancels; actions
`programados.editar` and `programados.cancelar`), and ⌘K and the Calendar list them all.

**Shared plan.** `assign_work` saves the whole plan (`server/plans.ts`, `DATOS/planes.json`, with versions and
history); Logistics rereads it with `read_plan` and each part with `shared_plan` (MCP `plan` in the rooms that have
a part). From Logistics, `update_plan` issues a new version and sends a message to the conversation of each affected
room (with `affected`, only to those and with what concerns each), and `notify_room` sends a message without changing
the plan; both identify the task by its key (`📋 [ABC-123] …`) and go to the part's conversation or, if it's gone, to
the one open in the task's worktree. From a part, `propose_plan_change` takes the proposal to Logistics'
conversation. Each delivery is made in view by a messenger robot carrying the blueprints (`web/src/world/messenger.ts`,
message `mensajero`).

**Organising rooms by tasks.** From a repo room's panel ("Organize by tasks") or with ⌘K "Organize the rooms by
tasks" (all of them): your unmerged PRs of each room's repo (by its `origin` remote) are grouped by task, the Jira key
in the branch or title, and stacked ones (one's base is another's branch) always go together (`server/organize.ts`).
Each task gets its worktree (the one already working on it, by branch or name; otherwise a new one in
`.claude/worktrees/shelter-<key>` with the stack's base branch and the ones above as local branches from the remote; if
its branch is in the main copy, there) and its own conversation with the dweller, in plan mode, working its PRs one by
one (checkout, fix and rebase the ones above). The plan is shown first and Enter carries it out; it never starts more
conversations than the live-session limit.

**Each task's color.** Each task (Jira key; without one, `PR-<number>`) has a color from a 16-color palette
(`shared/tasks.ts`) handed out by Planning: when reading the Jira board, the server gives each task its own and it
travels with it (`server/taskColors.ts`, `DATOS/colores-tareas.json`; non-Jira ones, with the `tareas.colores`
action): a new task gets the least used among those seen in the last two weeks. It's the same on the Jira board, the
deployment board, the Pull requests tab, organise, the Planning and Logistics screens and the hologram (and label) of
the copy working the task, and visitors from that worktree wear it too: at a glance you see which task has sessions in
which room.

**Reviews of your PRs, to the room that works them** (`server/prReviews.ts`). With GitHub connected, every minute
your open PRs are read with `gh` (reviews, unresolved threads and conversation comments, also from bots like code
reviewers or test reports; without your own or courtesy replies like "LGTM 🚀" or "thanks"; approvals only when their comment asks for something) and what's new goes as a message to the
conversation open on the PR's branch: the worktree (or folder) of its repo's room (by the `origin` remote) with that
branch or, failing that, the worktree of its task (`sessionOfPR`, also by the number in the name: `shelter-pr-12-13`).
With no conversation open there, the latest one in that worktree is resumed (or one is started, in plan mode) with the
review; if the task has no worktree, a notice says so (it's rare: the room needs organising by tasks). The dweller
proposes a plan (what to fix and what to reply) and touches nothing until the Overseer approves it. Each delivery shows
a visible notice (who reviewed, which PR, which room and branch) and the messenger robot carries it from Version
Control to the hologram of that worktree (to the dweller, if it's the main copy). Anything from before connecting
isn't sent; what's delivered is recorded in `revisiones-pr.json` (data folder).

**CI failures on your PRs, to the same conversation** (`server/ciFailures.ts`). Also every minute, the checks of the
latest commit of your open PRs are read; when a PR's CI fails (FAILURE or ERROR) on its current head, ONE message goes
to the conversation of that PR's worktree, found and opened just like reviews: the PR, its task key, the commit, the
failing checks with their links and the tail of `gh run view --log-failed`. If other PRs wait for it (stacked, "depends
on" in their description, the task's plan order or a manual blocker from the deployment plan, also across repos), the
message and the notice say "blocks: org/repo#12"; those PRs are not failing and get nothing. Once per PR and commit
(`fallos-ci.json`); the first poll only records what was already failing, so old red CI isn't flooded in. Read-only.

**Deployment plan.** On the big screen of the Logistics room (its stock scene, without a dressing:
`web/src/world/rooms/deploy.ts`; a click on it opens it), in the room panel or with ⌘K "Deployment plan": your PRs
by state (draft, in review, changes requested, approved, merged) with the blockers between them as arrows and the order
they can be merged in, by waves (`shared/deploy.ts`, `web/src/ui/Deploy.tsx`). In each column, the PRs of the
same task are grouped in a block of the task's color (headed by the key and the count when there are several), placed
where its best PR goes. A PR waits for another if it's stacked on top (its base is the other's branch), if its title
or description says so ("depends on #12", "blocked by org/repo#7", the PR link) or if you mark it with B (saved in
`DATOS/bloqueos-pr.json`, `server/prBlocks.ts`; X removes it). P hands the board to the room's dweller, who proposes
the plan in plan mode without touching the repos. The list of your PRs and those awaiting your review is in Version
Control (Pull requests tab of the git client; T from the Jira board).

**Pre-flight of a task** (`shared/preflight.ts`, `server/preflight.ts`, `web/src/ui/Preflight.tsx`,
action `preflight.tarea`). A small floating box per Jira key, over whatever is open and anchored to what opened it (it
is not a panel: nothing closes or resizes; Esc or a click outside closes it and leaves everything as it was), that answers
"can each PR of this task be merged now?": one row per PR of the task in every repo (the board's PRs, all open ones and
your PRs naming the key in their title or body at any age, so a task merged weeks ago still shows; read from GitHub at
most once a minute; R forces it),
in merge order (long titles truncated, full title on hover), with its state (draft, open, merged), CI, review (approved, changes requested or waiting, plus the
count of unresolved threads and unanswered summaries from the last `prReviews.ts` poll), conflicts (GitHub's
`mergeable`) and blockers ("waits for" / "blocks", with the other PR's state: a blocker's red CI is the blocker's
problem, not this row's). The first column (`mergeReady`) is ✓ only when the PR is open, green, approved without open
threads, mergeable and waits for nothing unmerged; its hover lists what's missing. Clicking a row (or Enter) opens the
PR; clicking its blockers, the PR it waits for. Below, the rooms of the task still without a PR and the merge waves
(merged PRs struck through, ready ones ✓, a wave all merged ✔; a task with everything merged says it has landed). Ways in: F or the ✈ on a task block in the Deployment plan, ✈ in a copy's
intercom (under its PR list) and ⌘K "Pre-flight ABC-123" (the tasks of your copies, open PRs and recently merged ones, slugs included, or a Jira key typed);
the last two only for a task with at least one open, draft or merged PR among your PRs (`taskHasPRs`, on the list
`git.prsTablero` already gives the board and the intercom; no extra GitHub read).

**The push gate** uses the same model per part (also worktrees without a PR), but none of it is shown in the window:
sync (local HEAD of its branch vs the PR's head on GitHub, without fetching, plus uncommitted changes), compare and
checklist. Compare: each compare page (`compare_changes`, `server/compare.ts`) writes a `<page>.json` beside it with
the worktree, branch and HEAD sha of each part; validating it or sending notes (in the page window or the intercom's
«📄 Pages») is saved on the server (action `paginas.responder`, `DATOS/preflight.json`, `PageReviews` in
`server/preflight.ts`), so it counts only while its HEAD is the validated one. Checklist: the Overseer's own
"before pushing" items, in the Vault (Shelter settings; pre-filled ONCE from the "Before pushing" section of
`~/.claude/CLAUDE.md`, `checklistFromClaudeMd`; saved in `ajustes.checklistPreflight`), answered by the dweller per
commit with `preflight_answer` (in the `review` MCP; `ok`, `n/a` with a note, or `pendiente`), which can read
its whole part (with its review threads and CI checks) with `preflight_status`. Each part's list also carries what its own repo asks (`repoChecks` in
`server/preflight.ts`, pure `repoChecklist`; files are only read, nothing is run by the game): the "Before pushing / Before
opening a PR / Pre-flight" section of its CLAUDE.md and AGENTS.md, its check-like skills in `.claude/skills` (review,
acceptance criteria, tests…; `skill · name`), and its check commands (`package.json` lint/test/typecheck scripts,
`Makefile` targets, `pre-commit`), which the dweller runs and answers like the rest. The gate: a `git push` (`pushOf`: also `git -C x push`, after a `cd` or inside `sh -c`, not `--dry-run`; only
`git push`, by the Overseer's decision) from a task worktree whose compare isn't validated at its HEAD, or (unless the
PR is a draft) whose list isn't answered, ASKS the Overseer first in the permission dialog (a `PreToolUse` hook in
`server/sessions.ts`, so it applies in every permission mode, also over Remote Control/Slack); no denies it with what's
missing. The git client's push and sync do the same check (action `preflight.puerta`).
QA: `scripts/qa-preflight.mjs` (own server and test shelter; needs the built client).

## Linear's official MCP for the Planning dweller

`server/integrations/linear.ts` exports:

- `mcpLinear({ onlyReading? })` → `{ linear: { type: 'http', url: 'https://mcp.linear.app/mcp', headers? } }`
  (streamable HTTP transport).
- `environmentMcpLinear()` → `{ SHELTER_LINEAR_CLAVE: <key> }` or `{}`.

With a key in the keychain, the header is literally `Authorization: Bearer ${SHELTER_LINEAR_CLAVE}`. The SDK passes
`mcpServers` to the CLI as the `--mcp-config` argument (visible in `ps`), so the key does **not** go there: Claude Code
expands `${VAR}` in command-line MCP configs and the variable lives only in the child process's environment. Without a
key in the keychain the server is returned without headers and Claude Code's OAuth authorisation applies: open
`claude` in the folder, `/mcp` → `linear` → *Authenticate* and sign in in the browser.

### Claude Code in the terminal (optional, outside the game)

```bash
claude mcp add --transport http linear https://mcp.linear.app/mcp      # local scope; --scope user for all
```

Then `/mcp` → `linear` → *Authenticate*.

### Codex (`~/.codex/config.toml`, `mcp_servers` section)

```bash
codex mcp add linear --url https://mcp.linear.app/mcp     # and then: codex mcp login linear (OAuth in the browser)
```

which is equivalent to:

```toml
[mcp_servers.linear]
url = "https://mcp.linear.app/mcp"
# Alternative without OAuth: the same API key from an environment variable
# bearer_token_env_var = "SHELTER_LINEAR_CLAVE"
```

## Tests

`npm test` runs `server/integrations/*.test.ts` without network: normalisers against `test/fixtures/` and the full
connectors with a mocked `fetch`, an in-memory keychain, the OAuth localhost return and a simulated Discord Gateway on
`127.0.0.1`. The fixtures are synthetic (invented people, companies and domains; no credentials).

## Known limit: the Linear key in the Planning dweller's environment

So that Linear's official MCP authenticates without putting the key in the arguments (visible with `ps`), the shelter
passes it in the `SHELTER_LINEAR_CLAVE` variable of the Planning Claude Code process. Its tools inherit that variable
too (`Bash`, hooks, other MCPs): an `env` run by the dweller would show it in the transcript. If you don't want that
risk, don't save a Linear key in the Vault: the official MCP will ask you to authorise it via OAuth in the browser the
first time, and the Planning board will stay in DEMO.
