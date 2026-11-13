# Going to the surface

For when the game crashes or shouldn't be seen: everything you have open in the shelter (conversations with dwellers
and terminals) carries on in a normal terminal on your desktop. It uses iTerm if installed; otherwise, Terminal
(`SHELTER_TERMINAL=terminal` or `iterm` to choose). In the game, all of this is also in the Overseer's Manual (F1),
section "To the surface (outside the game)".

## The four ways

| How | What it takes out |
| --- | --- |
| **⇧⌥⌘Esc** (from any app) | Everything. The game vanishes at once (window, Dock icon and sound) and whatever is open goes to a new iTerm window, one tab each. The same key, opening the app or clicking its icon brings it back as it was. |
| **↗ button or ⌘⇧E** in an intercom or a terminal | Only the active tab, to a tab of the iTerm window in front. |
| **`./shelter superficie`** (in the game folder) | Everything. With the game open it asks the game; with the game down, it resumes the conversations left open and attaches the terminals still alive. `--lista` only shows what there is. |
| **By itself, if the game crashes** | If the window disappears without going through "Leave the shelter" and doesn't come back within 20 s, everything goes to your desktop before the shelter shuts down. If only the page hangs, the window reloads by itself and nothing goes out. |

Careful: **⇧⌥⌘Esc held for 3 seconds** is macOS's "force quit". Press it quickly. If it ever closes the game,
everything goes out anyway after 20 s.

## Conversations

- They close in the game and open outside with `cd <folder> && claude --resume <id>`, with the same model, effort
  and permissions. When you leave Claude Code you stay in the project folder, with your shell and your history.
- If they were working or waiting for a permission, they're interrupted and, outside, asked to carry on with what they
  were doing.
- **To bring them back:** exit with `/exit` in iTerm and, in the game, talk to the dweller → "Resume a previous job".
  While they're still open outside, the archive marks them with ↗ and the game won't resume them (two Claude Codes
  writing the same conversation would corrupt it).
- Outside they lack what only exists in the game: the Planning Linear MCP, the Logistics tools and the shelter's
  instructions.

## Terminals

- It's not a copy: it's the same terminal (the same shell, with whatever it's running) in the game and outside at
  once. What you type in one place shows in the other.
- While open outside, the outside window's size rules, and in the game the tab carries ↗ and says "also on your
  desktop".
- It survives closing the game while still open outside. When you reopen the game, it reappears in its tab.
- Closing the iTerm tab releases it: it stays in the game (with the game closed, it closes itself after 10 minutes).
  `exit` ends it in both places.
- By hand: `./shelter enganchar <id>` (the id is the game tab's, e.g. `sala:my-api` or `sala:my-api::2`).

## The first time

macOS asks permission for work-shelter to control iTerm. If you deny it, allow it in System Settings › Privacy &
Security › Automation.

## For whoever touches the code

`server/escritorio.ts` (commands and AppleScript), `server/superficie.ts` (`./shelter superficie` and `enganchar`),
the `superficie.sacar` action in `server/main.ts`, `Sessions.sacar` in `server/sesiones.ts`, the outside clients of
the host in `server/anfitrionTerminales.ts` and the panic key in `electron/main.cjs`. QA:
`node scripts/qa-superficie.mjs` (own server on 3793; `SHELTER_ESCRITORIO_PRUEBA` logs what it would open instead of
opening windows).

## To the Claude app

The ✳ button in the intercom (or "Continue … in the Claude app" in ⌘K) closes the conversation in the shelter and
opens it in the Claude desktop app with its link `claude://resume?session=<id>`, which imports it into its list (it
reads the same transcript in `~/.claude/projects`). To bring it back, "Resume a previous job" on its dweller (closing
it in the app first, so it isn't written in two places). Server: `superficie.appClaude` (`server/main.ts`) and
`openInAppClaude` (`server/escritorio.ts`; with `SHELTER_ESCRITORIO_PRUEBA` it logs the link instead of opening it).

## Remote Control for a room

In a repo room's panel, "Turn on Remote Control" leaves a `claude remote-control --permission-mode auto` running in
its folder, named "<room> · work-shelter": from the Code tab of the Claude app on your phone or from claude.ai/code you
open sessions on that repo that run on this Mac. It's a separate process (`server/controlRemoto.ts`): it survives
restarting or closing the game, is recorded in `DATOS/control-remoto/` and, when the server starts, is turned back on
if it had died; it's turned off from the same panel or when the room is retired or relinked. The first time, Claude
Code asks you to accept Remote Control: the game detects it, stops it and explains how to accept it once in the
room's terminal. Intercom conversations don't show up there (they go through the SDK, without Remote Control).

## To the phone with Remote Control

The 📱 button in the intercom (or "Continue … on your phone (Remote Control)" in ⌘K) takes that conversation to an
iTerm tab with `claude --resume <id> --remote-control "<repo>:<TASK>"` (the worktree's task or the key in the title;
without one, `<repo>:<title>`; `remoteName` in `shared/tareas.ts`): it keeps running on your Mac and opens, under that
name, from the Claude app on your phone or claude.ai/code. While open outside it's a visitor in its room: bring it
back from the robot. "Everything to your phone" (Esc menu or ⌘K) does the same with every open conversation, in a new
window; terminals stay in the game. As when going to the surface, the conversation closes in the shelter first. It
needs the Mac awake. Server: `superficie.sacar` with `remoto` (`server/main.ts`) and `resumeCommand`
(`server/escritorio.ts`).

## Slack remote control

So you don't have to be in the shelter when a dweller needs you and you're away: "Slack (remote control)" in the
Vault, with the other integrations (it's not a notice source: it reads nothing). You copy the manifest, create the app
from it at api.slack.com/apps (Socket Mode, only `chat:write` and `im:history`, event `message.im`), generate the app
token (`xapp-`, with `connections:write`), install it (bot token, `xoxb-`) and paste both (into the keychain, accounts
`slackRemote.appToken` and `slackRemote.botToken`). To pair, send the bot a direct message with the code the game
shows (one use, 10 minutes; five failed attempts expire it).

- **Approvals**: the bot only writes on its own when a conversation asks for approval (permission, plan, question or
  trust), with the request exactly as the game's dialog shows it and its buttons: yes / no (never "yes, always"), and
  for questions one option per button, one at a time (multi-answer ones, in the shelter). It's answered in the shelter
  itself: the conversation keeps going here. Anything that doesn't fit whole (about 3500 characters) can't be approved
  from the phone. Once answered, here or there (or when its conversation closes), the message is deleted and its
  buttons stop working. The reply to each button arrives as a message only you see. A request waits 3 minutes before going
  out: answered in the shelter by then, it never leaves; while you're using the game (its window in front and keyboard
  or mouse in the last 2 minutes) it keeps waiting.
- **Status**: the chat only holds the open decisions and, always last, one status message with the rooms and their
  open conversations (dweller, title, state and end time), with a 📱 button per conversation (and another for all)
  that hands it over to Remote Control to continue in the Claude app. It's edited quietly as conversations change and
  moves below each new decision; writing anything brings it to the bottom. After a restart, the decisions left in the
  chat (no longer valid) are deleted.

What goes out: the labels and, to approve, the request in plain-text blocks (nothing is interpreted as formatting),
with invisible characters made visible (⟦U+XXXX⟧) and token-shaped secrets masked (token characters only: masking
never hides code); the notification carries only the first line (who's asking), never the command. Never what's said.
It's a different app from the Slack notices one (`integraciones/slack.ts`), which stays read-only. Slack is not
end-to-end encrypted and keeps messages under the workspace's rules: in a company's, ask first. It only obeys the
paired workspace, direct message and person; everything else is ignored without reply. No open ports: Socket Mode (the
server opens a WebSocket to Slack and reopens it if Slack asks or it drops). Only the real shelter listens (without
`SHELTER_DATOS`; test ones, with `SHELTER_SLACK=1`). Code: the common part in `server/mando.ts`, the Slack part in
`server/slackMando.ts` (tests in `server/slackMando.test.ts`), actions `slackRemote.*` and its view `SlackRemoteView`
in the Vault (`web/src/ui/Camara.tsx`); invisible characters in `shared/visible.ts` (the same as the dialog).
