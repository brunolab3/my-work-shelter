# Shelter design

## Layout
- Elevator shaft at x = 0 (3.4 m with walls). Rooms to the left (x < 0) and right (x > 0) of the elevator; `orden` 0 next to the elevator, 1 the next one.
- Each room is 12 m wide (3 modules) + the cutaway pillars (FRAME = 0.45 m). A room's centre: `x = ±(1.7 + FRAME + 6 + orden·(12 + FRAME))`.
- Floors: `y = −planta · FLOOR` (FLOOR = 4.43 + 0.85). Labelled PB (ground), -1, -2… (`floorCaption`). The ground floor is at street level.
- A room's place isn't chosen by hand: `distribute` (`shared/disposicion.ts`) computes it from the rooms there are. The server applies it when loading the saved state, when recruiting and when retiring a room (unless the Overseer moved rooms by hand from the map: then the layout stays manual until reset):
  - PB: the Main Gate, alone, left of the elevator. You come in and go out through it.
  - -1: Vault | Command Bridge.
  - -2: Communications (outer) and Calendar (next to the elevator) | Planning, Version Control and Logistics.
  - -3: the repos, in alphabetical order from left to right and split across both sides (half, rounded up, on the left). 8 fit per floor; if there are more, they continue on -4 and so on.
  - The last floor: leisure (Hydroponics and Disco | Shooting Gallery and Body Shop).
- Street: the wasteland terrain at ground-floor height, with the sky (gradient and silhouettes of hills and dead trees from the KayKit nature pack). At street level stand the Main Gate, with the "REFUGIO 42" sign on the roof, and the elevator tower.
- Rock: a cut face with strata from the street down, with holes for the rooms and the elevator shaft; unexcavated areas are rock (no caves for now).

## Circulation
- Each floor has a walkway (z ≈ 1.2) that crosses its rooms through doors in the partitions (side walls with a door gap) and reaches the elevator.
- The elevator has a cabin that really goes up and down (with doors, sound, chime). Characters get in, the cabin travels and they get out.
- Navigation graph: nodes per floor (doors, centre of each room, elevator landing) and vertical edges through the elevator. Route = A* over that graph; horizontal movement uses the walk clips and vertical movement the cabin.
- Overseer: A/D (←→) along the floor, W/S (↑↓) in depth inside a room; on the elevator landing, W/S call the cabin to go up or down. Click on a room's floor: go there (by elevator if needed).

## Light with many rooms (performance)
- A fixed set of dynamic lights (6 spots, 1 with shadow, and 1 point light for the centrepiece) assigned every half second to the lamps nearest the camera. The number of lights never changes (shaders aren't recompiled).
- Lamps without an assigned light show their emissive bulb and a fake pool (additive decal) so they look lit from afar.
- The sun's shadow follows the camera framing.

## Room types (own personality, fixed art)
| Type | Centrepiece | Palette | Dweller | Notes |
|---|---|---|---|---|
| Stock repo: Studio (web and Node) | Server rack with pilot lights and a wall of screens | rust, phosphor | the room's recruit | sofa |
| Stock repo: Laboratory (Python) | Glass terrarium | olive, green | the room's recruit | test bench with sink, tray greenhouse |
| Stock repo: Foundry (Rust and Go) | Brick forge with hood and chimney | rust red, copper | the room's recruit | anvil on a stump, crucible, quenching tub |
| Stock repo: Archive (no code) | Tall shelf of boxes | ochre | the room's recruit | card file with terminal, reading table |
| Repo with a set dressing ("Adapt the room to the repo") | Whatever its dweller designs with the game's props | its own | the room's | `shared/decorado.ts`, `docs/decorados.md`; can also start from the hand-made web workshop, shop window, brand archive or screening room |
| Logistics (type `coordinacion`, folder = repos root) | Wall screen with the deployment plan (click opens the board) | — | Inés «Divide y Vencerás» | plan table where work is split; plans Jira tasks across repos. Wings (folders with several repos) are also `coordinacion` rooms |
| Communications | Radio switchboard with antennas and pneumatic tube | green | Ondina | screen with the real notification feed |
| Calendar (type `planificacion`) | Week calendar board (real events) | blue | Calixto | clocks, map table |
| Planning (type `logistica`) | Tactical screen with the Jira board and your PRs | red | CM-4 (Clanker) | console arc; the Overseer starts here |
| Version Control (type `git`) | Git client for every repo in the shelter | graphite, green | the Octocat (own model, animated by code) | contribution matrix and pull requests |
| Command Bridge | Live holographic model of the shelter on a projector (the game's repo) | graphite and brass | Néstor «El Arquitecto» (Survivalist, original look) | code columns, power core (the generator), plan table |
| Vault | Wall of safe-deposit boxes, one per integration with its pilot light, behind a laser barrier | steel and red | Hanzo «Doble Factor» (4GTN with katana) | biometric scanner, turret and drone, gold reserve, shelter cameras |
| Main Gate | Giant gear door | steel, yellow | Guardián (4GTN android) | recruiting; queue of recruits (suggested folders) |
| Hydroponics | Crop beds that grow with tool use | green, magenta (grow lights) | Fermín | activity: harvest |
| Disco | DJ booth (Spotify) | neon | DJ-80 | dance floor with dancers |
| Shooting Gallery | Targets and counter | red, yellow | Dora | activity: target shooting (first iteration, unfinished: see README) |
| Body Shop | Barber's and wardrobe: change looks | aqua | Fito | fitting room (`web/src/ui/Probador.tsx`) |
