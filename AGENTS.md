# work-shelter — instructions for agents (Claude Code and Codex)

A shelter-management game that is a work interface on top of Claude Code: each repo is a room and each dweller is a real Claude Code session (Agent SDK) running with the player's own account. macOS only. Usage: `README.md`; features, where they live and their QA: `docs/map.md` (update it when you change one); security model: `SECURITY.md`.

- Code, comments and commits in English; older comments are in Spanish: translate them only in lines you touch.
- Visible texts and prompts to dwellers go through `t('zona.clave')` with its `{ es, en }` entry in `shared/texts/`, never hardcoded.
- The shooting gallery and economy are an unfinished first iteration: touch them only through the `juego.*` actions and the `jugador` state.
- No telemetry, no inference of its own (no Anthropic API keys), read-only outwards with the user's own app or token; the few external writes are listed in `SECURITY.md`.
- Checks: `npm test` and `npx tsc --noEmit -p .`.
- Applying changes: client (`web/`, `shared/`) with "Apply the game's changes" in the Command Bridge panel; server, `electron/` and the supervisor with "Restart the game" in the Esc menu.

**Lean knowledge.** This file, the dwellers' annex (`server/annex.ts`), skills and memories are loaded again and again: keep instructions for Claude only when code (a test, a hook, a game flow) or a skill can't do the job, and then minimal. One fact in one place. Personal workflow goes in a git-ignored `CLAUDE.local.md`, never here or in memories.
