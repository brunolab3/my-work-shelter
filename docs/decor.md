# Set dressings: each room's scene

Every repo room has a scene. Without a set dressing, the stock scene for its repo type:

- **Studio** for web and Node.
- **Laboratory** for Python.
- **Foundry** for Rust and Go.
- **Archive** for folders without code.
- **Workshop** for everything else.

There are also hand-made scenes: web workshop, shop window, brand archive and screening room. They go to repos whose
name or type calls for them (`estiloSala` in `server/repos.ts`).

## The task board

Every repo room has one meaningful screen: its task board (`web/src/mundo/salas/tableroTareas.ts`, rows from
`shared/tableroSala.ts`). One row for the main copy and one per worktree, each with its task color, key and title, and
its branch when it isn't the worktree's own. Two badges: what its conversations are doing (waiting for you, working,
failed, done, open) and one state for all its task's PRs in this room's repo (CI failing, conflicts, changes asked,
in review, approved, draft, merged, closed: the one that most needs someone wins). The second line says what the
conversation is doing or waiting on. A click on a row talks to that copy's hologram; on the main copy's, to the room's
dweller. It's one canvas texture, redrawn only when what it shows changes.

It hangs at a fixed spot per scene (`boardSpot` in `shared/decorado.ts`: each stock scene's, mirrored with the room;
in the empty room, where the dressing puts `pantallaRepo`, at least 3 m wide). Stock scenes keep it clear, and their
only other screen is the dweller's desk monitor.

## Adapt the room to the repo

From the room panel (E next to it) or with ⌘K, "Adapt the room to the repo" asks its dweller to design it a scene of
its own:

1. Reads the repo: what it's about, who it's for and what it's built with.
2. Picks a physical metaphor (a database, a card-file room; a compiler, a forge…).
3. Builds the scene with the game's props.
4. Checks how it turned out with a photo and fixes it.

When done, it tells you what it built. The conversation stays open for touch-ups ("more light", "remove the sofa",
"put the sign on the left"). "Back to the default scene" removes the dressing.

The dweller works with the game's tools (`server/decoradoSala.ts`, an MCP server inside the game's process):

| Tool | What it does |
|---|---|
| `current_decor` | The guide and how the room is now. |
| `props_catalogue` | The models in the game's art, with their size measured from their glTF (`server/atrezo.ts`). |
| `apply_decor` | Validates, saves and shows it at once. |
| `view_room` | A photo of the room taken with the game itself in a windowless Chromium (`server/capturaSala.ts`), with the pieces the game sees floating or sunk. |
| `remove_decor` | Returns the room to its stock scene. |

They only touch their own room's dressing, so they don't ask for permission. The repo is not touched.

## What a set dressing is

A set dressing is data, never code. The format and its validation are in `shared/decorado.ts`. The server validates it
on receiving it and when loading the state: it trims what's outside the room, drops models not in the catalogue and
cleans the texts. It's saved in the room, in `refugio.json`.

The client builds it in `web/src/mundo/salas/decorado.ts`. A model that fails to load is skipped: a broken piece never
leaves the room half-built.

- `base`: the starting scene. Any of the stock ones or `vacia` (empty). In the empty one, the game adds the
  essentials: the task board (`pantallaRepo` says where), the dweller's desk and the spot for its centrepiece, where
  the dressing says or in their default place.
- Room style: `subtitulo`, `resumen`, `acento`, `paleta`, `paredes`, `luz` and `espejo`.
- `piezas`: catalogue models (`pack/nombre`) with position, rotation and size. They can rest on another (`sobre`),
  stick to the wall (`pared`), hang (`y`) or lie down. They can carry a tint (`color`) or glow (`luz`).
- `carteles`: signs on the back wall. There are no decorative screens: the guide steers dwellers to props with a
  trade (tools, plants, crates, machines) rather than the catalogue's computers and TVs.
- `puesto`, `pieza`, `aficion` and `lamparas`: where the dweller works, where it uses the centrepiece, its corner and
  the lights.

Coordinates in metres: x across the room, y up from the floor, z from the back wall to the cutaway edge, with a
walkway at the front that stays clear. The exact limits are `LIMITS` in `shared/decorado.ts` (the guide tool gives them
to the dweller).

Rotation is in degrees: 0 faces the player and 180 faces the wall.

Nothing may cover the task board. The review (`reviewDecor`) warns the dweller about pieces near the back wall and
signs in front of it, and the client leaves them out when it builds the room.

Older dressings: their decorative screens (`pantallas`) are dropped when the state loads (`sanitizeDecor`). Their
props are kept as designed, except what would cover the board. Ask the dweller to adapt the room again for a scene
without them.

All the art is the game's fixed CC0 set from KayKit and Quaternius (`docs/assets.md`): no models or textures are added.

## Link and retire

- **Link to another folder**: the room moves to a repo of yours and keeps its place, its dweller and its look.
  - Conversations from the previous folder are closed and stay in its history.
  - The scene goes back to the stock one for the new repo type.
- **Retire the room**: it leaves with its dweller.

In both cases, a copy of an old example repo (from shelters created before example repos were dropped) that no room
uses any more goes to the macOS Trash. Your own folders are never touched.

## QA

`scripts/qa-decorado.mjs [sala] [modelo] [foto.png]` launches "Adapt the room to the repo" with a real session. Use it
against a test shelter (`SHELTER_DATOS`, `SHELTER_PUERTO`). It checks that the room ends up with a dressing and saves a
photo.

Format tests are in `shared/decorado.test.ts` and catalogue tests in `server/atrezo.test.ts`. The task board:
`shared/tableroSala.test.ts` and `scripts/qa-tablero-sala.mjs <url> <png> [sala]` (test shelter, a room with two
worktrees: states, a live new worktree and clicks on rows; nothing reaches Claude Code, GitHub or Jira).
