# Set dressings: each room's scene

Every repo room has a scene. Without a set dressing, the stock scene for its repo type:

- **Studio** for web and Node.
- **Laboratory** for Python.
- **Foundry** for Rust and Go.
- **Archive** for folders without code.
- **Workshop** for everything else.

There are also hand-made scenes: web workshop, shop window, brand archive and screening room. They go to repos whose
name or type calls for them (`estiloSala` in `server/repos.ts`).

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
| `decorado_actual` | The guide and how the room is now. |
| `catalogo_atrezo` | The models in the game's art, with their size measured from their glTF (`server/atrezo.ts`). |
| `aplicar_decorado` | Validates, saves and shows it at once. |
| `ver_sala` | A photo of the room taken with the game itself in a windowless Chromium (`server/capturaSala.ts`), with the pieces the game sees floating or sunk. |
| `quitar_decorado` | Returns the room to its stock scene. |

They only touch their own room's dressing, so they don't ask for permission. The repo is not touched.

## What a set dressing is

A set dressing is data, never code. The format and its validation are in `shared/decorado.ts`. The server validates it
on receiving it and when loading the state: it trims what's outside the room, drops models not in the catalogue and
cleans the texts. It's saved in the room, in `refugio.json`.

The client builds it in `web/src/mundo/salas/decorado.ts`. A model that fails to load is skipped: a broken piece never
leaves the room half-built.

- `base`: the starting scene. Any of the stock ones or `vacia` (empty). In the empty one, the game adds the
  essentials: the screen with the repo's real status, the dweller's desk and the spot for its centrepiece, where the
  dressing says or in their default place.
- Room style: `subtitulo`, `resumen`, `acento`, `paleta`, `paredes`, `luz` and `espejo`.
- `piezas`: catalogue models (`pack/nombre`) with position, rotation and size. They can rest on another (`sobre`),
  stick to the wall (`pared`), hang (`y`) or lie down. They can carry a tint (`color`) or glow (`luz`).
- `carteles` and `pantallas`: on the back wall. Screens are phosphor and type their lines in a loop.
- `puesto`, `pieza`, `aficion` and `lamparas`: where the dweller works, where it uses the centrepiece, its corner and
  the lights.

Coordinates in metres:

- **x**, from -6 to 6.
- **y**, from the floor (0) to the ceiling (4.43). The wall is visible up to y ≈ 3.6.
- **z**, from -2.3 (back wall) to 2.3 (cutaway edge). The strip z > 0.8 is the walkway and stays clear.

Rotation is in degrees: 0 faces the player and 180 faces the wall.

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

Format tests are in `shared/decorado.test.ts` and catalogue tests in `server/atrezo.test.ts`.
