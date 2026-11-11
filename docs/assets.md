# Shelter art

This is the material the game is built from. Nothing is hand-drawn: the finish comes from these packs, the lighting and the composition. The packs are **CC0** (public domain: free use, no attribution required), verified by reading the original licences (copy in `LICENSES/`).

## Sources (pinned by commit)

| Material | Author | Licence | GitHub mirror (pinned commit) |
|---|---|---|---|
| Characters, props and **133 humanoid animations** | KayKit / Kay Lousberg (kaylousberg.com), full collection v6 | CC0 | `GeorgeQLe/assets-kaykit-3d-characters` @ `af08a62d3669370ec4636ae6314b38cdcd5dd759` |
| Sci-fi interior modules, furniture, survival, cyberpunk | Quaternius (quaternius.com) | CC0 | `trebeljahr/quaternius-showcase` @ `e90ffea347393537703ae6f9d73e36492820f5a9` (folder `public/glb/<pack>/`) |

`./shelter` downloads it the first time from those commits into `./assets/` (`scripts/descargar-assets.mjs` with `scripts/manifest_assets.json`, and `scripts/descargar-extra.mjs` for the remaining pieces; idempotent). It isn't versioned: only third-party pieces that can't be fetched from a pinned commit go in `assets/terceros/`.

**Optional** sources from the same author and licence, in case more pieces are needed (same aesthetic, so they don't break coherence): `GeorgeQLe/assets-kaykit-3d-environments` (City Builder Bits, Dungeon Remastered, Platformer, Medieval…) and `GeorgeQLe/assets-kaykit-3d-props` (Restaurant Bits, Halloween Bits, tools, furniture). And the Quaternius mirror has more packs (`rpg_items_pack`, `platformer_game_pack`, `street_pack`, `ultimate_space_pack`, `mech_pack`…). Kenney (kenney.nl, CC0) is compatible in spirit too, but its mirror isn't pinned here: if you use it, pin the source.

Exceptions to CC0, with their licence in `LICENSES/`: the Version Control Octocat (community model, CC-BY 4.0, in `assets/terceros/octocat/`) and the interface fonts (OFL, in `web/public/fuentes/`). The app icon (`electron/icono/`) is an AI-generated image made for this project and carries the repo's licence.

What is **not** used: nothing from Bethesda or Klei, and no textures or sprites from game "rips".

## The cast (KayKit characters, `Rig_Medium` rig, 23 bones, embedded textures)

They all share a skeleton, so **any clip in `character-animations-1.1/Animations/gltf/Rig_Medium/*.glb` applies to any of them** without retargeting (verified in three.js with `AnimationMixer`: bone names match: `root, hips, spine, chest, head, upperarm.l/r, lowerarm.l/r, wrist.l/r, hand.l/r, handslot.l/r, upperleg.l/r, lowerleg.l/r, foot.l/r, toes.l/r`…). KayKit's official previews are the yardstick for how they should look on screen.

| Character | File (under `assets/kaykit/`) | Natural role in the shelter |
|---|---|---|
| Engineer | `adventurers-2.0/Characters/gltf/Engineer.glb` | Repo room engineer (glasses, beard, backpack) |
| Survivalist | `mystery-monthly-series-4/9 - March 2024 - Survivalist/character/Survivalist.glb` | Survivor (gas mask); props: `…/assets/gltf/` (backpack, ballistic shields, stop sign, hydrant) |
| Hoarder | `mystery-monthly-series-6/8 - February 2026 - Hoarder/characters/Hoarder.glb` | Wasteland scavenger (scarf, bags) |
| Hiker | `mystery-monthly-series-5/11 - May 2025 - Hiker/characters/Hiker.glb` | Explorer; props: tent, backpack |
| Protagonist_A / Protagonist_B | `mystery-monthly-series-5/10 - April 2025 - Protagonists/characters/Protagonist_*.glb` | Young dwellers (cap, glasses); a good playable Overseer |
| Driver | `mystery-monthly-series-4/2 - August 2023 - Driver/character/gltf/Driver.glb` | Mechanic / driver (sunglasses); props: car |
| SpaceRanger (+ `_FlightMode`) | `mystery-monthly-series-4/7 - January 2024 - Space Ranger/character/SpaceRanger*.glb` | Surface exploration suit |
| Clanker | `mystery-monthly-series-5/9 - March 2025 - Clanker/characters/Clanker.glb` | Heavy robot (tamed AI); wider than tall: scale it by height ~2.3 |
| Robot_One / Robot_Two | `mystery-monthly-series-4/12 - June 2024 - Robot/characters/Robot_*.glb` | Assistant robots / subagents |
| 4GTN (+ `_Forgotten`) | `mystery-monthly-series-6/7 - January 2026 - 4GTN/characters/4GTN*.glb` | Samurai robot; the "Forgotten" variant suits the lore's abandoned AI |
| Animatronic_Normal / _Creepy | `mystery-monthly-series-4/5 - November 2023 - Animatronic/characters/gltf/Animatronic_*.glb` | Lore: the rogue AI on the surface |
| CombatMech | `mystery-monthly-series-5/1 - July 2024 - Combat Mech/characters/CombatMech.glb` | Visitors (sessions open outside the game) |

Swappable accessories in `adventurers-2.0/Assets/gltf/` (123 gltf+bin files: tools, helmets, backpacks, ammo boxes, torches…): they attach to the `handslot.l/r` bone or the head for variety (hats, tools while working).

Unused (they don't fit the theme): Knight, Mage, Rogue, Barbarian, Druid, Ranger, Skeletons, Toy Soldier, Clown, Witch, Vampire, Plant Warrior…

## Animation inventory (`Rig_Medium_*.glb`)

- **General** (15): Death_A, Death_A_Pose, Death_B, Death_B_Pose, Hit_A, Hit_B, Idle_A, Idle_B, Interact, PickUp, Spawn_Air, Spawn_Ground, T-Pose, Throw, Use_Item
- **MovementBasic** (11): Jump_Full_Long, Jump_Full_Short, Jump_Idle, Jump_Land, Jump_Start, Running_A, Running_B, T-Pose, Walking_A, Walking_B, Walking_C
- **MovementAdvanced** (13): Crawling, Crouching, Dodge_Backward/Forward/Left/Right, Running_HoldingBow, Running_HoldingRifle, Running_Strafe_Left/Right, Sneaking, T-Pose, Walking_Backwards
- **Simulation** (14): Cheering, Lie_Down, Lie_Idle, Lie_StandUp, Push_Ups, Sit_Chair_Down, Sit_Chair_Idle, Sit_Chair_StandUp, Sit_Floor_Down, Sit_Floor_Idle, Sit_Floor_StandUp, Sit_Ups, T-Pose, Waving
- **Tools** (29): Chop, Chopping, Dig, Digging, Fishing_Bite/Cast/Catch/Idle/Reeling/Struggling/Tug, Hammer, Hammering, Holding_A/B/C, Lockpick, Lockpicking, Pickaxe, Pickaxing, Saw, Sawing, T-Pose, Work_A/B/C, Working_A/B/C
- **CombatMelee** (22) and **CombatRanged** (20): attacks, blocks, aiming, shooting, magic. Useful for minigames (target shooting) and for the surface lore.
- **Special** (15): skeleton animations and an experimental transformation; not used for now.

Natural map from dweller state → clip: thinking/reading = `Idle_B` or `Sit_Chair_Idle` + clipboard accessory; running a tool = `Working_A/B/C`, `Hammering`, `Sawing`; waiting for permission = `Idle_A` + `Waving`; done = `Cheering`; error = `Hit_A/B`; asleep (no session) = `Lie_Idle`; stroll = `Walking_A/B/C`; hurry = `Running_A`; pick up/use = `PickUp`, `Use_Item`, `Interact`; subagent = robot with `Working_C` / `Digging`.

## Module inventory (Quaternius, GLB, flat untextured materials)

- **modular_sci_fi** (91): Wall_1..5, Wall_Empty, walls with single/double door (`DoorSingle_Wall_SideA/B`, `DoorDouble_Wall_SideA/B`, Long versions), walls with windows (`Window_Wall_SideA/B`, `LongWindow_Wall`, `SmallWindows_Wall`, `ThreeWindows_Wall`), `Door_Single`, `Door_Double`, FloorTile_Basic/Basic2/Corner/Double_Hallway/Empty/InnerCorner/Side, RoofTile_* (vents, pipes, plates), Column_1/2/3/Slim, Staircase, Pipes, Details_* (Arrow, Basic_1..4, Cylinder, Dots, Hexagon, Output, Pipes_Long/Medium/Small, Plate_*, Triangles, Vent_1..5, X), Props_Base, Props_Capsule, Props_Chest, Props_Computer, Props_ComputerSmall, Props_ContainerFull, Props_Crate, Props_CrateLong, Props_Laser, Props_Pod, Props_Shelf, Props_Shelf_Tall, Props_Statue, Props_Teleporter_1/2, Props_Vessel/_Short/_Tall.
- **house_interior_pack** (123): beds (Bed_Bunk, Bed_King, Bed_Single), sofas, chairs, tables, stool, bookshelves, chests of drawers, bedside tables, kitchen (sink, oven, fridge, cupboards), full bathroom, lamps (Light_Ceiling1..6, Light_Desk, Light_Floor1..4, Light_Stand, Light_Chandelier, Light_Cube…), plants (Houseplant_1..8), rugs, doors (Door_1..9, Door_Double), windows, bins, columns, fireplace, cutlery.
- **survival_pack** (53): Radio, Battery_Big/Small, PropaneTank, GasCan, FirstAidKit(_Hard), Backpack, Bonfire(_Fire), Tent, Torch, WoodenTorch, Shovel, Axe, Knife, Pan, Pot, Compass, Matchbox, Phone, FlareGun, WaterBottle_1..3, Can_*, BearTrap, Raft, Trashcan, WoodLog, firearms (Pistol, Revolver, Shotgun…).
- **cyberpunk_pack** (71): Computer, Computer_Large, TV_1..3, Pipe_1/2, Pipe_Corner(_2), Cable_Long/Small/Thick, AC(_Side/_Stacked), Antenna_1/2, Light_Square, Light_Street_1/2, Lever, Lootbox, Fence, Rail_*, Sign_* (incl. Sign_Corner_Hazard), Support(_Long/_Short), Platform_*, Tank, Turret_*, Enemy_* (drones, mechs), Character, Collectible_*, Pickup_*.

## Real measurements (bounding box in three.js after applying the nodes), to scale correctly

The accessors in Quaternius GLBs are **not** usable for measuring (they carry scale 100 and rotations in the nodes): always measure with `Box3.setFromObject`. Units: Quaternius ≈ metres; KayKit characters 2.2–2.4 tall (Clanker 5.6 wide × 3.8 tall; CombatMech large).

| Module | width × height × depth |
|---|---|
| Wall_1/2/3, Window_Wall, DoorSingle_Wall | 4.00 × 4.43 × 0.5–1.25 |
| FloorTile_Basic / Basic2 | 2.00 × 0.09 × 2.00 |
| Column_1 / Column_Slim | 0.68 × 4.46 × 0.68 |
| Pipes (horizontal) | 3.51 × 0.37 × 0.13 |
| Details_Pipes_Long (**vertical**) | 0.51 × 1.58 × 0.09 |
| Details_Vent_1 | 0.53 × 0.31 × 0.04 |
| Details_Plate_Large | 1.05 × 1.08 × 0.03 |
| Door_Single | 1.67 × 2.79 × 0.45 |
| Staircase | 3.78 × 1.45 × 3.11 |
| Props_Computer / ComputerSmall | 0.58 × 2.08 × 0.64 / 0.75 × 1.54 × 0.46 |
| Props_Shelf_Tall / Props_Crate / Props_ContainerFull | 2.06 × 3.11 × 0.81 / 0.80 cube / 1.20 × 0.58 × 0.75 |
| Props_Pod / Props_Capsule / Props_Base | 1.81 × 3.61 × 1.81 / 0.87 × 1.62 × 0.87 / 2.40 × 0.32 × 2.40 |
| Computer_Large (cyberpunk) | 1.29 × 2.38 × 0.69 |
| Bed_Bunk | 2.17 × 3.03 × 4.00 (long in z) |
| Light_Ceiling1 / Houseplant_3 | 0.44 × 0.82 × 0.44 / 0.34 × 0.84 × 0.34 |
| PropaneTank / GasCan / Radio / FirstAidKit (survival, they come large) | 2.16 × 2.89 / 1.88 × 2.47 / 1.69 × 2.10 / 1.56 × 1.36 → scale them to real size (≈1.1, 0.6, 0.35, 0.6 tall) |

## Technical notes (what to know when building a room)

1. **Quaternius materials**: they come with `metalness 0.4` and `roughness ≈ 0.4` and no environment map, so they look dark and dirty. In the shelter they're set to `metalness ≈ 0.05`, `roughness ≈ 0.7`. Material names are stable and useful for recoloring: `Main` (mid grey), `DarkGrey`, `Light` (**light grey, not a lamp**: don't make it emissive), `Accent` (orange: on walls it's recolored to a muted teal, on props it's left), `DarkAccent`, `Black`, `Screen` (screens: green emissive looks good).
2. **Scale along the right axis**: `fit` by width on a vertical module (Details_Pipes_Long, Cable_Long) produces 13–40-unit monsters. Measure first, scale by the dimension that really sets the size.
3. **KayKit characters**: `MeshStandardMaterial` with a texture (embedded gradient atlas). Set `map.colorSpace = SRGBColorSpace`. They cast and receive shadows fine. Scale them by height to world size.
4. **Lighting**: one warm directional with shadows (`PCFSoft`, 2048), soft hemisphere, two warm point lights at the lamps and a green one at the screens, `ACESFilmic` with exposure ≈ 1.2. Without this everything looks like plastic; with too strong an orange light everything turns yellow.
5. Rock masses around the room must not cast shadows (they put black wedges inside the room).
6. `GLTFLoader.parse` accepts an ArrayBuffer, so assets can be embedded or served locally; no network needed at runtime.
7. Modules share geometry if you load them once and clone (`scene.clone(true)` + clone materials only if you'll recolor); with hundreds of modules, instance or merge geometries per room to keep 60 fps.
