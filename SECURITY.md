# Security

## First of all: use it at your own risk

work-shelter is an experimental proposal published **as is, without warranty of any kind** (see
[`LICENSE`](LICENSE)). Nobody reviews or certifies its security, there is no commitment to maintain it or fix anything
within any timeframe, and what this document describes are the precautions the code **tries** to take, not promises.

The game drives agents that run commands on your Mac with your permissions, stores credentials for your services and
opens browsers with your sessions. If you install, use, modify or distribute it, **you are responsible for whatever
happens (to your machine, your data, your accounts or your organisation's)**. Review the code before using it with
anything you care about.

## Reporting a problem

There is no reporting channel: like the rest of the project, issues, pull requests and security advisories are not
read (see "No pull requests or issues" in the [README](README.md)). If you find something, fix it in your fork and, if
you think it's useful, tell people wherever you like.

## Precautions the code takes

It is designed as a local application for a single person on their Mac:

- **The game server** listens on `127.0.0.1:3778`, rejects other `Host` headers (against DNS rebinding) and, on the
  WebSocket, requires the game's `Origin` and a random secret generated at every start. The secret is not passed to
  Claude Code sessions, terminals or processes the game launches (git, `gh`, Chrome).
- **Files**: the explorer, the git client and attachments work inside the rooms' folders.
- **Commands**: launched with `execFile`/`spawn`, with separate arguments. The git the game runs on its own (each
  room's status, every 20 s) ignores `core.fsmonitor` from the repo's local config, and diffs run without `textconv`
  or an external diff.
- **Dwellers' permissions**: shown as literal text (the command or the diff, with invisible characters made visible)
  and you resolve them.
- **Folder trust**: if a repo ships Claude Code project config (`.claude/` with settings, hooks, rules, commands or
  agents, `.mcp.json`, `CLAUDE.md`), the game asks before loading it, unless you already accepted that folder in
  Claude Code or in the game. This includes repos the repos root adds as rooms automatically.
- **Electron**: `contextIsolation`, no `nodeIntegration`, the main window confined to its origin and the internal
  browsers (`<webview>`) in their own session, `https` only and no preload.
- **Secrets**: in the macOS keychain, not in the repo or in `.data/`; integrations ask for read-only permissions.
- **Slack remote control** (optional, with your own app; `server/mando.ts` and `server/slackMando.ts`): over Socket
  Mode (no open ports: the server opens the connection to Slack), with only `chat:write` and `im:history` and the
  `message.im` event. It sends approval requests exactly as the dialog shows them (invisible characters made visible,
  tokens masked, anything that doesn't fit whole can't be approved) with yes/no, never "always"; each button is only
  valid while that request is pending, and once answered the message is stripped of its content. It never sends what's
  said. It only obeys the workspace, the direct message and the person you pair with a one-time code (10 minutes; five
  failed attempts expire it). It's a different app from the Slack notices one, which stays read-only. Risks: Slack is
  not end-to-end encrypted and keeps messages under the workspace's rules (in a company's, its admins and retention
  reach them: ask first); anyone with your unlocked phone and Slack can approve. If you lose the tokens, revoke them
  at api.slack.com/apps: with them those messages can be read and your taps received elsewhere, but not one of yours
  faked towards the shelter.

## Known risks

What it **doesn't** cover, by design or because nobody has solved it:

- **Dwellers are Claude Code with your permissions**: whatever you approve runs on your Mac. The "edit without asking"
  and "skip permissions" modes do exactly that.
- **Outside folders**: the trust question only covers Claude Code configuration. A foreign folder can bring other
  things that run when touched, such as filters or hooks in its `.git/config`, or tasks your editor opens. Don't link
  as a room a folder you don't trust, and keep only repos you trust directly inside the repos root: each one becomes a
  room automatically.
- **The Command Bridge** works on the game's own code, and that code runs on restart or when the app opens (including
  `npm ci` if `package-lock.json` changes). Approving edits there amounts to approving that they run.
- **Installing with `curl … | bash`** runs `instalar.sh` as it is on GitHub at that moment and, afterwards, the code of
  the repo it downloads. Read it first if you like, or clone the repo and use `./shelter instalar-app`.
- **The installed app** (`/Applications/work-shelter-public.app`) loads the code from the game's folder
  (`~/.work-shelter-public` with the installer, or the folder you installed it from): whoever can write to that folder
  can change what the app does. Running the installer again fetches and runs the latest in the repo.
- **Development mode** (`npm run dev`): Vite serves the game folder's files to any local process, and among them is
  `.data/token`, the secret that controls the shelter (terminals included). Use it only on a machine where you trust
  everything running and, if you like, with `SHELTER_DATOS` pointing outside the repo.
- **The Spotify Chrome and the Google sign-in Chrome** are driven through their debugging protocol, open on a
  `127.0.0.1` port while they run. Another process or user on the same Mac could connect and reach those sessions.
- **The internal browsers** are confined to each site's domain, but third-party sign-ins (Microsoft, Google, Okta,
  Auth0…) and their redirects can lead to pages that aren't the site's, with no address bar in view.
- **Other processes of your user** can read the keychain secrets without warning (they're stored by
  `/usr/bin/security`).
- **The Linear key**, if you save it, goes into the environment of the Logistics dweller, whose MCP can write to
  Linear (see `docs/integraciones-uso.md`).
- **Other macOS accounts** on the same machine haven't been considered thoroughly: if you share the Mac, assume they
  may reach more than they should.
