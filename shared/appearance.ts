// Aspecto de un personaje por piezas: humano o robot, montado sobre el mismo esqueleto de KayKit (Rig_Medium) con
// cabezas, cuerpos, brazos, piernas y complementos de todos los personajes del pack, y pintado por regiones.
// Lo comparten el servidor (valida lo guardado) y el cliente (monta la figura y el probador).

export type Species = 'humano' | 'robot';
export type Slot = 'cara' | 'cejas' | 'pelo' | 'barba' | 'cabeza' | 'sombrero' | 'gafas' | 'torso' | 'brazos' | 'piernas' | 'espalda' | 'complemento';
/** Regiones de color (índice del pintado en la figura; 0 = sin tocar) */
export const REGIONS = ['', 'piel', 'pelo', 'torso1', 'torso2', 'torso3', 'piernas1', 'piernas2', 'piernas3', 'cabeza1', 'cabeza2', 'sombrero1', 'sombrero2', 'espalda1', 'espalda2', 'luz'] as const;
export type Region = Exclude<(typeof REGIONS)[number], ''>;

export interface Look {
  especie: Species;
  pieces: Partial<Record<Slot, string>>;      // id de pieza; sin valor o '' = nada en esa ranura
  colors: Partial<Record<Region, string>>;     // '#rrggbb'; sin valor = el de la pieza
}

// ---------------------------------------------------------------- personajes de KayKit (fuentes de piezas)
const MM = (series: number, month: string, folder: string, file: string) => `kaykit/mystery-monthly-series-${series}/${month}/${folder}/${file}.glb`;
export const SOURCES: Record<string, { path: string; large?: boolean }> = {
  Barbarian: { path: 'kaykit/adventurers-2.0/Characters/gltf/Barbarian.glb' },
  Druid: { path: 'kaykit/adventurers-2.0/Characters/gltf/Druid.glb' },
  Engineer: { path: 'kaykit/adventurers-2.0/Characters/gltf/Engineer.glb' },
  Knight: { path: 'kaykit/adventurers-2.0/Characters/gltf/Knight.glb' },
  Mage: { path: 'kaykit/adventurers-2.0/Characters/gltf/Mage.glb' },
  Ranger: { path: 'kaykit/adventurers-2.0/Characters/gltf/Ranger.glb' },
  Rogue: { path: 'kaykit/adventurers-2.0/Characters/gltf/Rogue.glb' },
  Rogue_Hooded: { path: 'kaykit/adventurers-2.0/Characters/gltf/Rogue_Hooded.glb' },
  Mannequin_Medium: { path: 'kaykit/character-animations-1.1/Mannequin Character/characters/Mannequin_Medium.glb' },
  Mannequin_Large: { path: 'kaykit/character-animations-1.1/Mannequin Character/characters/Mannequin_Large.glb', large: true },
  Paladin: { path: MM(4, '10 - April 2024 - Paladin', 'characters/gltf', 'Paladin') },
  Paladin_with_Helmet: { path: MM(4, '10 - April 2024 - Paladin', 'characters/gltf', 'Paladin_with_Helmet') },
  Clown: { path: MM(4, '11 - May 2024 - Clown', 'characters', 'Clown') },
  Robot_One: { path: MM(4, '12 - June 2024 - Robot', 'characters', 'Robot_One') },
  Robot_Two: { path: MM(4, '12 - June 2024 - Robot', 'characters', 'Robot_Two') },
  Driver: { path: MM(4, '2 - August 2023 - Driver', 'character/gltf', 'Driver') },
  MonsterCostume: { path: MM(4, '3 - September 2023 - Monster Costume', 'character/gltf', 'MonsterCostume') },
  Werewolf_Man: { path: MM(4, '4 - October 2023 - Werewolf', 'characters/gltf', 'Werewolf_Man') },
  Animatronic_Normal: { path: MM(4, '5 - November 2023 - Animatronic', 'characters/gltf', 'Animatronic_Normal') },
  ActionFigure: { path: MM(4, '6 - December 2023 - Action Figure', 'character/gltf', 'ActionFigure') },
  SpaceRanger: { path: MM(4, '7 - January 2024 - Space Ranger', 'character', 'SpaceRanger') },
  SpaceRanger_FlightMode: { path: MM(4, '7 - January 2024 - Space Ranger', 'character', 'SpaceRanger_FlightMode') },
  Ninja: { path: MM(4, '8 - February 2024 - Ninja', 'character', 'Ninja') },
  Survivalist: { path: MM(4, '9 - March 2024 - Survivalist', 'character', 'Survivalist') },
  CombatMech: { path: MM(5, '1 - July 2024 - Combat Mech', 'characters', 'CombatMech') },
  Protagonist_A: { path: MM(5, '10 - April 2025 - Protagonists', 'characters', 'Protagonist_A') },
  Protagonist_B: { path: MM(5, '10 - April 2025 - Protagonists', 'characters', 'Protagonist_B') },
  Hiker: { path: MM(5, '11 - May 2025 - Hiker', 'characters', 'Hiker') },
  Tiefling: { path: MM(5, '12 - June 2025 - Tiefling', 'characters', 'Tiefling') },
  Superhero: { path: MM(5, '2 - August 2024 - Superhero', 'characters', 'Superhero') },
  Vampire: { path: MM(5, '4 - October 2024 - Vampire', 'characters', 'Vampire') },
  Witch: { path: MM(5, '5 - November 2024 - Witch', 'characters', 'Witch') },
  Helper_A: { path: MM(5, '6 - December 2024 - Helpers', 'characters', 'Helper_A') },
  Helper_B: { path: MM(5, '6 - December 2024 - Helpers', 'characters', 'Helper_B') },
  Caveman: { path: MM(5, '8 - February 2025 - Caveman', 'characters', 'Caveman') },
  Clanker: { path: MM(5, '9 - March 2025 - Clanker', 'characters', 'Clanker'), large: true },
  Lorekeeper: { path: MM(6, '1 - July 2025 - Lorekeeper', 'characters', 'Lorekeeper') },
  Marksman: { path: MM(6, '10 - April 2026 - Marksman', 'characters', 'Marksman') },
  MagicalGirl: { path: MM(6, '11 - May 2026 - Magical Girl', 'characters', 'MagicalGirl') },
  Farmer_A: { path: MM(6, '12 - June 2026 - Farmers', 'characters', 'Farmer_A') },
  Farmer_B: { path: MM(6, '12 - June 2026 - Farmers', 'characters', 'Farmer_B') },
  Cleric: { path: MM(6, '3 - September 2025 - Cleric', 'characters', 'Cleric') },
  ToySoldier: { path: MM(6, '6 - December 2025 - Toy Soldier', 'characters', 'ToySoldier') },
  '4GTN': { path: MM(6, '7 - January 2026 - 4GTN', 'characters', '4GTN'), large: true },
  '4GTN_Forgotten': { path: MM(6, '7 - January 2026 - 4GTN', 'characters', '4GTN_Forgotten'), large: true },
  Hoarder: { path: MM(6, '8 - February 2026 - Hoarder', 'characters', 'Hoarder') },
  Necromancer: { path: 'kaykit/skeletons-1.1/characters/gltf/Necromancer.glb' },
  Skeleton_Minion: { path: 'kaykit/skeletons-1.1/characters/gltf/Skeleton_Minion.glb' },
  Skeleton_Warrior: { path: 'kaykit/skeletons-1.1/characters/gltf/Skeleton_Warrior.glb' },
  Skeleton_Rogue: { path: 'kaykit/skeletons-1.1/characters/gltf/Skeleton_Rogue.glb' },
  Skeleton_Mage: { path: 'kaykit/skeletons-1.1/characters/gltf/Skeleton_Mage.glb' },
};
/** El esqueleto de todos (Rig_Medium con los huesos de la mano para los utensilios) */
export const SOURCE_BASE = 'Driver';

// ---------------------------------------------------------------- piezas
export interface Piece {
  id: string;
  name: string;
  slot: Slot;
  especie: Species | 'ambos';
  source: string;
  /** mallas del personaje (sufijo tras «Fuente_»); las de cabeza humana se sacan del despiece de su malla Head */
  meshes?: string[];
  /** de la cabeza humana: trozos del despiece (cara, cejas, pelo, barba o gorro) */
  breakdown?: boolean;
  /** existe (los aspectos de serie la llevan) pero el probador no la ofrece */
  hidden?: boolean;
  /** colores con los que sale si no se elige otro (los cráneos y endoesqueletos de los robots, cromados) */
  colors?: Partial<Record<Region, string>>;
  /** el sombrero tapa el pelo (cascos, capuchas cerradas) */
  hairLid?: boolean;
  /** el sombrero tapa también las orejas, las cejas y la barba (yelmos) */
  faceLid?: boolean;
}

const P: Piece[] = [];
const id = (slot: Slot, source: string, extra = '') => `${slot}.${source}${extra ? '.' + extra : ''}`;
function piece(slot: Slot, source: string, name: string, o: Partial<Piece> = {}) {
  const extra = o.meshes && ['sombrero', 'gafas', 'espalda', 'complemento'].includes(slot) ? o.meshes[0] : '';
  // lo de la cara (rostro, cejas, pelo y barba) es de humano; sombreros, gafas, mochilas y capas, de cualquiera
  P.push({ id: id(slot, source, extra), name, slot, source, especie: o.especie ?? (['cara', 'cejas', 'pelo', 'barba'].includes(slot) ? 'humano' : 'ambos'), ...o });
}
const header = (slot: Slot, source: string, name: string, o: Partial<Piece> = {}) => piece(slot, source, name, { breakdown: true, ...o });
// (la ropa de los humanos también la llevan los robots: con la chapa donde el humano enseña la piel)
const clothes = (source: string, torso: string, arms: string | null, legs: string | null, especie: Species | 'ambos' = 'ambos', meshTorso = 'Body') => {
  if (torso) piece('torso', source, torso, { meshes: [meshTorso], especie });
  if (arms) piece('brazos', source, arms, { meshes: ['ArmLeft', 'ArmRight'], especie });
  if (legs) piece('piernas', source, legs, { meshes: ['LegLeft', 'LegRight'], especie });
};

// caras (rostro con nariz, orejas, boca y ojos)
header('cara', 'Protagonist_B', 'Despierta');
header('cara', 'Protagonist_A', 'Pecas');
header('cara', 'Barbarian', 'Curtida');
header('cara', 'Caveman', 'Nariz chata');
header('cara', 'Driver', 'Sonrisa ladeada');
header('cara', 'Engineer', 'Mentón firme');
header('cara', 'Farmer_A', 'Campechana');
header('cara', 'Farmer_B', 'Mejillas sonrosadas');
header('cara', 'Helper_A', 'Risueña');
header('cara', 'Helper_B', 'Nariz respingona');
header('cara', 'Hiker', 'Serena');
header('cara', 'Hoarder', 'Avispada');
header('cara', 'Knight', 'Noble');
header('cara', 'Lorekeeper', 'Veterana');
header('cara', 'Mage', 'Ojerosa');
header('cara', 'Ninja', 'Impasible');
header('cara', 'Paladin', 'Templada');
header('cara', 'Ranger', 'Afilada');
header('cara', 'Rogue', 'Pícara');
header('cara', 'SpaceRanger', 'Heroica');
header('cara', 'Survivalist', 'Tuerta');
header('cara', 'Tiefling', 'Con cuernos');
header('cara', 'ToySoldier', 'Coloretes');
header('cara', 'Vampire', 'Pálida');
header('cara', 'Witch', 'Puntiaguda');
header('cara', 'Werewolf_Man', 'Cejijunta');
header('cara', 'Cleric', 'Bondadosa');
header('cara', 'Clown', 'Maquillaje de payaso');
header('cara', 'MagicalGirl', 'Ojos grandes');
header('cara', 'Marksman', 'Camuflada');

// cejas
for (const [f, n] of [['Barbarian', 'Pobladas'], ['Caveman', 'Gruesas'], ['Driver', 'Arqueadas'], ['Engineer', 'Rectas'], ['Farmer_A', 'Suaves'], ['Helper_A', 'Finas'], ['Knight', 'Elegantes'], ['Lorekeeper', 'Canosas y largas'], ['Mage', 'Oscuras'], ['MagicalGirl', 'Expresivas'], ['Ninja', 'Severas'], ['Paladin', 'Firmes'], ['Ranger', 'Altivas'], ['Rogue', 'Picudas'], ['SpaceRanger', 'De galán'], ['Survivalist', 'Fruncidas'], ['Tiefling', 'En punta'], ['ToySoldier', 'Pintadas'], ['Vampire', 'Diabólicas'], ['Werewolf_Man', 'Uniceja'], ['Witch', 'Escépticas'], ['Hiker', 'Tranquilas']] as const)
  header('cejas', f, n);

// pelo
for (const [f, n] of [['Driver', 'Tupé'], ['Engineer', 'Revuelto con patillas'], ['Farmer_A', 'Raya al lado'], ['Farmer_B', 'Media melena'], ['Helper_B', 'Flequillo'], ['Hoarder', 'Moño alto'], ['Knight', 'Peinado de príncipe'], ['Lorekeeper', 'Coronilla calva'], ['Mage', 'Melena lisa'], ['MagicalGirl', 'Coletas'], ['Ninja', 'Moño samurái'], ['Paladin', 'Rapado'], ['Ranger', 'Ondulado'], ['Rogue', 'Melena despeinada'], ['SpaceRanger', 'Engominado'], ['Survivalist', 'Canas de cuartel'], ['Tiefling', 'Melena con mechas'], ['Vampire', 'Pico de viuda'], ['Witch', 'Larga y recta'], ['Werewolf_Man', 'Leñador'], ['Caveman', 'Greñas'], ['Protagonist_A', 'Melena larga'], ['Helper_A', 'Trenzas']] as const)
  header('pelo', f, n);
// los de su propio gorro o casco: solo quedan bien con él puesto (están para que los de serie salgan como eran)
for (const f of ['Hiker', 'Protagonist_B', 'Superhero', 'ToySoldier']) header('pelo', f, 'Pelo de ' + f, { hidden: true });

// barba
for (const [f, n] of [['Barbarian', 'Barba de vikingo'], ['Caveman', 'Barba salvaje'], ['Engineer', 'Barba frondosa'], ['Farmer_A', 'Barba de granjero'], ['Hiker', 'Barba corta'], ['Lorekeeper', 'Barba de sabio'], ['Paladin', 'Barba cuidada'], ['Ranger', 'Perilla'], ['ToySoldier', 'Bigote de manillar'], ['Vampire', 'Bigote y perilla'], ['Survivalist', 'Barba de tres días']] as const)
  header('barba', f, n);

// sombreros, cascos y capuchas
piece('sombrero', 'Hiker', 'Sombrero de explorador', { meshes: ['Hat'] });
piece('sombrero', 'Farmer_A', 'Sombrero de paja', { meshes: ['Hat'] });
piece('sombrero', 'Farmer_B', 'Sombrero vaquero', { meshes: ['Hat'] });
piece('sombrero', 'Helper_A', 'Gorro de duende', { meshes: ['Hat'] });
piece('sombrero', 'Helper_B', 'Gorro de lana', { meshes: ['Hat'] });
piece('sombrero', 'Witch', 'Sombrero de bruja', { meshes: ['Hat'] });
piece('sombrero', 'Mage', 'Sombrero de mago', { meshes: ['Hat'] });
piece('sombrero', 'Knight', 'Yelmo', { meshes: ['Helmet', 'HelmetVisor'], hairLid: true, faceLid: true });
piece('sombrero', 'Paladin_with_Helmet', 'Casco de paladín', { meshes: ['Helmet'], hairLid: true, faceLid: true });
piece('sombrero', 'ToySoldier', 'Morrión', { meshes: ['Hat'], hairLid: true });
piece('sombrero', 'Clown', 'Sombrerito', { meshes: ['Hat'] });
piece('sombrero', 'Barbarian', 'Piel de oso', { meshes: ['BearHat'], hairLid: true });
piece('sombrero', 'Necromancer', 'Corona', { meshes: ['Crown'], especie: 'ambos' });
piece('sombrero', 'SpaceRanger_FlightMode', 'Casco espacial', { meshes: ['Helmet', 'Helmet_Visor'], hairLid: true, faceLid: true, especie: 'ambos' });
piece('sombrero', '4GTN_Forgotten', 'Sombrero de paja cónico', { meshes: ['Hat'], especie: 'ambos' });
piece('sombrero', 'Ninja', 'Cinta ninja', { meshes: ['Headband'] });
piece('sombrero', 'ActionFigure', 'Cinta de comando', { meshes: ['Headband'] });
piece('sombrero', 'Skeleton_Warrior', 'Casco con cuernos', { meshes: ['Helmet'], hairLid: true, especie: 'ambos' });
piece('sombrero', 'Skeleton_Mage', 'Sombrero de hechicero', { meshes: ['Hat'], especie: 'ambos' });
piece('sombrero', 'Skeleton_Rogue', 'Capucha de bandido', { meshes: ['Hood'], hairLid: true, especie: 'ambos' });
header('sombrero', 'Protagonist_A', 'Gorra con orejeras');
header('sombrero', 'Protagonist_B', 'Gorra de visera');
header('sombrero', 'Cleric', 'Capucha de clérigo', { hairLid: true });
header('sombrero', 'Rogue_Hooded', 'Capucha de pícaro', { hairLid: true });
header('sombrero', 'Druid', 'Capucha con astas', { hairLid: true });
header('sombrero', 'Marksman', 'Capucha de francotirador', { hairLid: true });
header('sombrero', 'Clown', 'Peluca de payaso', { hairLid: true });
header('sombrero', 'MagicalGirl', 'Lazos');
header('sombrero', 'Survivalist', 'Cinta de supervivencia');

// gafas, máscaras y parches
piece('gafas', 'Driver', 'Gafas de sol', { meshes: ['Sunglasses'], especie: 'ambos' });
piece('gafas', 'Engineer', 'Gafas de soldador', { meshes: ['Goggles'], especie: 'ambos' });
piece('gafas', 'Protagonist_A', 'Gafas redondas', { meshes: ['Glasses'] });
piece('gafas', 'Lorekeeper', 'Anteojos', { meshes: ['Glasses'] });
piece('gafas', 'Witch', 'Quevedos', { meshes: ['Glasses'] });
piece('gafas', 'Marksman', 'Visión nocturna', { meshes: ['NightvisionGoggles'], especie: 'ambos' });
piece('gafas', 'Hoarder', 'Máscara antigás', { meshes: ['FaceMask'] });
piece('gafas', 'Ninja', 'Embozo ninja', { meshes: ['Mask'] });
piece('gafas', 'Rogue_Hooded', 'Pañuelo de bandido', { meshes: ['Mask'] });
piece('gafas', 'ActionFigure', 'Puro', { meshes: ['Cigar'] });

// ropa de humano
clothes('Protagonist_B', 'Sudadera', 'Mangas de sudadera', 'Vaqueros con deportivas');
clothes('Protagonist_A', 'Chaqueta de aventurera', 'Mangas remangadas', 'Pantalón corto con medias');
clothes('Engineer', 'Mono de ingeniera', 'Mangas con guantes', 'Pantalón de trabajo');
clothes('Survivalist', 'Chaleco táctico', 'Mangas de camuflaje', 'Pantalón militar');
clothes('Hoarder', 'Abrigo de chatarrero', 'Mangas remendadas', 'Botas de chatarrero');
clothes('Hiker', 'Camisa de excursionista', 'Mangas de excursionista', 'Bermudas y botas');
clothes('Driver', 'Cazadora de piloto', 'Mangas de cazadora', 'Vaqueros de piloto');
clothes('SpaceRanger', 'Traje espacial', 'Guantes espaciales', 'Botas espaciales');
clothes('Barbarian', 'Pecho al aire con correa', 'Brazos con muñequeras', 'Pantalón de pieles');
clothes('Caveman', 'Taparrabos', 'Brazos desnudos', 'Piernas de cavernícola');
clothes('Cleric', 'Hábito', 'Mangas de hábito', 'Sandalias de hábito');
clothes('Clown', 'Traje de payaso', 'Mangas de payaso', 'Zapatones de payaso');
clothes('Druid', 'Túnica de druida', 'Mangas de druida', 'Polainas de druida');
clothes('Farmer_A', 'Peto vaquero', 'Mangas de granjero', 'Peto con botas de agua');
clothes('Helper_A', 'Casaca de duende', 'Mangas de duende', 'Mallas de duende');
clothes('Helper_B', 'Jersey de duende', 'Mangas de jersey', 'Mallas a rayas');
clothes('Knight', 'Armadura', 'Guanteletes', 'Grebas');
clothes('Lorekeeper', 'Túnica de cronista', 'Mangas de cronista', 'Pantalón de cronista');
clothes('Mage', 'Túnica de mago', 'Mangas de mago', 'Bajo de túnica');
clothes('MagicalGirl', 'Vestido de lazo', 'Manguitos', 'Botines con lazo');
clothes('Ninja', 'Peto ninja', 'Mangas ninja', 'Pantalón ninja', 'ambos', 'Chest');
clothes('Paladin', 'Coraza de paladín', 'Brazales de paladín', 'Botas de paladín');
clothes('Ranger', 'Jubón de guardabosques', 'Mangas de guardabosques', 'Calzas de guardabosques');
clothes('Rogue', 'Jubón de pícaro', 'Mangas de pícaro', 'Botas altas');
clothes('Superhero', 'Malla de héroe', 'Guantes de héroe', 'Botas de héroe');
clothes('Tiefling', 'Corsé con capa', 'Mangas abullonadas', 'Calzones bombachos');
clothes('ToySoldier', 'Casaca de gala', 'Mangas con galones', 'Pantalón de gala');
clothes('Vampire', 'Levita', 'Puños de encaje', 'Pantalón de levita');
clothes('Witch', 'Vestido de bruja', 'Mangas de bruja', 'Medias de bruja');
clothes('Marksman', 'Equipo de francotirador', 'Mangas de francotirador', 'Pantalón de francotirador');
clothes('ActionFigure', 'Camiseta de tirantes', 'Brazos de comando', 'Pantalón de camuflaje');
clothes('Werewolf_Man', 'Camisa de leñador', 'Mangas de leñador', 'Pantalón de leñador');
clothes('MonsterCostume', 'Disfraz de dinosaurio', 'Patas de dinosaurio', 'Patas traseras de dinosaurio');
clothes('Animatronic_Normal', 'Camiseta de la pizzería', null, null);

// espalda
piece('espalda', 'Engineer', 'Mochila de ingeniera', { meshes: ['Backpack'] });
piece('espalda', 'Hiker', 'Mochila de montaña', { meshes: ['Backpack'] });
piece('espalda', 'Hoarder', 'Mochila de chatarrero', { meshes: ['Backpack'] });
piece('espalda', 'Druid', 'Zurrón de druida', { meshes: ['Backpack'] });
piece('espalda', 'Protagonist_A', 'Mochila escolar', { meshes: ['Backpack'] });
piece('espalda', 'Protagonist_B', 'Mochila de viaje', { meshes: ['Backpack'] });
piece('espalda', 'Lorekeeper', 'Mochila de pergaminos', { meshes: ['Backpack'] });
piece('espalda', 'Knight', 'Capa de caballero', { meshes: ['Cape'] });
piece('espalda', 'Mage', 'Capa de mago', { meshes: ['Cape'] });
piece('espalda', 'Ranger', 'Capa de guardabosques', { meshes: ['Cape'] });
piece('espalda', 'Rogue', 'Capa corta', { meshes: ['Cape'] });
piece('espalda', 'Paladin', 'Capa de paladín', { meshes: ['Cape'] });
piece('espalda', 'Superhero', 'Capa de héroe', { meshes: ['Cape'] });
piece('espalda', 'Vampire', 'Alas de murciélago', { meshes: ['WingLeft', 'WingRight'], especie: 'ambos' });
piece('espalda', 'Ranger', 'Carcaj', { meshes: ['Quiver'] });
piece('espalda', 'SpaceRanger_FlightMode', 'Mochila cohete', { meshes: ['Jetpack', 'JetPack_WingLeft', 'JetPack_WingRight'], especie: 'ambos' });
piece('espalda', 'CombatMech', 'Alerones', { meshes: ['WingLeft', 'WingRight'], especie: 'robot' });
piece('espalda', 'ToySoldier', 'Llave de cuerda', { meshes: ['WindupKey'], especie: 'ambos' });
piece('espalda', 'Clanker', 'Tubos de escape', { meshes: ['ExhaustLeft', 'ExhaustRight'], especie: 'robot' });
piece('espalda', 'Tiefling', 'Cola', { meshes: ['Tail'] });

// complementos
piece('complemento', 'Hoarder', 'Riñoneras', { meshes: ['HipPouch_Left', 'HipPouch_Right'] });
piece('complemento', 'Hoarder', 'Bolsa de pecho', { meshes: ['FrontPouch'] });
piece('complemento', 'Hoarder', 'Gorguera', { meshes: ['CollarArmor'] });
piece('complemento', 'Cleric', 'Agua bendita', { meshes: ['HolyWater'] });
piece('complemento', 'CombatMech', 'Hombreras de combate', { meshes: ['ShoulderLeft', 'ShoulderRight'], especie: 'ambos' });
piece('complemento', 'Skeleton_Warrior', 'Capa raída', { meshes: ['Cloak'], especie: 'ambos' });

// robots: cabezas y cuerpos
const robot = (source: string, head: string, torso: string, arms: string, legs: string, extra: string[] = [], chrome = false) => {
  const c = chrome ? { colors: { cabeza1: '#aab2bb', head2: '#5b6068', torso1: '#9aa1a9', torso2: '#5b6068', torso3: '#c7a14a', piernas1: '#8d939b', piernas2: '#4a4f57' } } : {};
  piece('cabeza', source, head, { meshes: ['Head', ...extra], especie: 'robot', ...c });
  for (const [r, n, m] of [['torso', torso, 'Body'], ['brazos', arms, ''], ['piernas', legs, '']] as const)
    piece(r, source, n, { meshes: r === 'torso' ? [m] : r === 'brazos' ? ['ArmLeft', 'ArmRight'] : ['LegLeft', 'LegRight'], especie: 'robot', ...c });
};
robot('Robot_One', 'Unidad de servicio', 'Chasis de servicio', 'Brazos de servicio', 'Piernas de servicio');
robot('Robot_Two', 'Unidad de vigilancia', 'Chasis de vigilancia', 'Brazos de vigilancia', 'Piernas de vigilancia');
robot('Clanker', 'Cabeza de chatarra', 'Caldera', 'Pinzas de carga', 'Patas de carga');
robot('4GTN', 'Androide', 'Torso de androide', 'Brazos de androide', 'Piernas de androide');
robot('4GTN_Forgotten', 'Androide oxidado', 'Torso oxidado', 'Brazos oxidados', 'Piernas oxidadas');
robot('CombatMech', 'Cabeza de combate', 'Blindaje de combate', 'Brazos de combate', 'Piernas de combate');
robot('Mannequin_Medium', 'Maniquí', 'Torso de maniquí', 'Brazos de maniquí', 'Piernas de maniquí');
robot('Skeleton_Minion', 'Cráneo cromado', 'Endoesqueleto', 'Brazos de endoesqueleto', 'Piernas de endoesqueleto', ['Eyes', 'Jaw'], true);
robot('Skeleton_Warrior', 'Cráneo de guerra', 'Endoesqueleto blindado', 'Brazos blindados', 'Piernas blindadas', ['Eyes', 'Jaw'], true);
robot('Skeleton_Rogue', 'Cráneo ágil', 'Endoesqueleto ligero', 'Brazos ligeros', 'Piernas ligeras', ['Eyes', 'Jaw'], true);
robot('Necromancer', 'Cráneo con núcleo', 'Endoesqueleto con túnica', 'Brazos de túnica', 'Piernas de túnica', [], true);

export const PIECES: Piece[] = P;
export const PIECE = new Map(P.map(p => [p.id, p]));
export const HUMAN_SLOTS: Slot[] = ['cara', 'cejas', 'pelo', 'barba', 'sombrero', 'gafas', 'torso', 'brazos', 'piernas', 'espalda', 'complemento'];
export const SLOTS_ROBOT: Slot[] = ['cabeza', 'sombrero', 'gafas', 'torso', 'brazos', 'piernas', 'espalda', 'complemento'];
/** Ranuras que no pueden quedar vacías */
export const REQUIRED: Slot[] = ['cara', 'cabeza', 'torso', 'brazos', 'piernas'];

export function piecesOf(slot: Slot, especie: Species) { return P.filter(p => p.slot === slot && !p.hidden && (p.especie === especie || p.especie === 'ambos')); }

/** Los robots grandes (Clanker, 4GTN) llevan otro esqueleto (Rig_Large): su cuerpo manda en brazos, piernas y lo que
 *  cuelga de la espalda; su cabeza, en lo que se pone en ella. */
export const isLarge = (id: string | undefined) => !!id && !!SOURCES[PIECE.get(id)?.source ?? '']?.large;
const SENDS: Partial<Record<Slot, Slot>> = { brazos: 'torso', piernas: 'torso', espalda: 'torso', complemento: 'torso', sombrero: 'cabeza', gafas: 'cabeza' };
/** ¿Se puede poner esta pieza con el resto del aspecto? (mismo esqueleto que la pieza que manda) */
export function fits(p: Piece, pieces: Partial<Record<Slot, string>>) {
  const sends = SENDS[p.slot]; if (!sends) return true;
  const ref = sends === 'cabeza' ? pieces.cabeza ?? pieces.cara : pieces.torso;
  return isLarge(p.id) === isLarge(ref);
}

// ---------------------------------------------------------------- aspectos de serie (los modelos de KayKit tal cual)
const H = (f: string, extra: Partial<Record<Slot, string>> = {}): Look => {
  const has = (r: Slot) => PIECE.has(id(r, f)) ? id(r, f) : '';
  return { especie: 'humano', pieces: { cara: has('cara'), cejas: has('cejas'), pelo: has('pelo'), barba: has('barba'), torso: has('torso'), brazos: has('brazos'), piernas: has('piernas'), ...extra }, colors: {} };
};
const R = (f: string, extra: Partial<Record<Slot, string>> = {}): Look => ({ especie: 'robot', pieces: { cabeza: id('cabeza', f), torso: id('torso', f), brazos: id('brazos', f), piernas: id('piernas', f), ...extra }, colors: {} });
/** El aspecto de cada modelo de KayKit tal y como venía (los habitantes sin aspecto propio y los reclutas de la Puerta) */
export const STOCK: Record<string, Look> = {
  Protagonist_B: H('Protagonist_B', { sombrero: 'sombrero.Protagonist_B', espalda: 'espalda.Protagonist_B.Backpack' }),
  Protagonist_A: H('Protagonist_A', { sombrero: 'sombrero.Protagonist_A', gafas: 'gafas.Protagonist_A.Glasses', espalda: 'espalda.Protagonist_A.Backpack' }),
  Engineer: H('Engineer', { gafas: 'gafas.Engineer.Goggles' }),
  Survivalist: H('Survivalist', { sombrero: 'sombrero.Survivalist' }),
  Hoarder: H('Hoarder', { espalda: 'espalda.Hoarder.Backpack', complemento: 'complemento.Hoarder.HipPouch_Left' }),
  Hiker: H('Hiker', { sombrero: 'sombrero.Hiker.Hat', espalda: 'espalda.Hiker.Backpack' }),
  Driver: H('Driver', { gafas: 'gafas.Driver.Sunglasses' }),
  SpaceRanger: H('SpaceRanger'),
  Robot_One: R('Robot_One'),
  Robot_Two: R('Robot_Two'),
  Clanker: R('Clanker', { espalda: 'espalda.Clanker.ExhaustLeft' }),
  '4GTN': R('4GTN'),
  '4GTN_Forgotten': R('4GTN_Forgotten', { sombrero: 'sombrero.4GTN_Forgotten.Hat' }),
  CombatMech: R('CombatMech', { espalda: 'espalda.CombatMech.WingLeft', complemento: 'complemento.CombatMech.ShoulderLeft' }),
};
export const TYPES_STOCK = Object.keys(STOCK);

// ---------------------------------------------------------------- validación
const HEX = /^#[0-9a-f]{6}$/i;
/** Deja un aspecto en forma: solo piezas que existen, de su especie y su ranura, y colores #rrggbb. Null si no vale. */
export function sanitizeLook(a: unknown): Look | null {
  if (!a || typeof a !== 'object') return null;
  const x = a as any;
  const especie: Species = x.especie === 'robot' ? 'robot' : 'humano';
  const slots = especie === 'robot' ? SLOTS_ROBOT : HUMAN_SLOTS;
  const pieces: Partial<Record<Slot, string>> = {};
  for (const r of slots) {
    const v = x.pieces?.[r];
    const p = typeof v === 'string' ? PIECE.get(v) : undefined;
    if (p && p.slot === r && (p.especie === especie || p.especie === 'ambos')) pieces[r] = p.id;
  }
  for (const r of REQUIRED) if (slots.includes(r) && !pieces[r]) pieces[r] = piecesOf(r, especie)[0]?.id;
  for (const r of slots) { const p = pieces[r] ? PIECE.get(pieces[r]!) : undefined; if (p && !fits(p, pieces)) { if (REQUIRED.includes(r)) pieces[r] = piecesOf(r, especie).find(q => fits(q, pieces))?.id; else delete pieces[r]; } }
  const colors: Partial<Record<Region, string>> = {};
  for (const r of REGIONS) if (r && typeof x.colors?.[r] === 'string' && HEX.test(x.colors[r])) colors[r] = x.colors[r].toLowerCase();
  return { especie, pieces, colors };
}

/** El aspecto de un habitante: el suyo propio o, si no tiene, el de serie de su modelo (con su tono, si lo tiene:
 *  quien repetía modelo llevaba la ropa y el pelo de otro color) */
export function lookOf(h: { type?: string; look?: unknown; tone?: number }): Look {
  const own = sanitizeLook(h.look); if (own) return own;
  const a = structuredClone(STOCK[h.type ?? ''] ?? STOCK.Protagonist_B);
  if (h.tone) {
    const t = ((h.tone % 360) + 360) % 360;
    if (a.especie === 'robot') { a.colors.torso1 = hsl(t, 0.55, 0.42); a.colors.cabeza1 = a.colors.torso1; a.colors.piernas1 = hsl(t, 0.35, 0.3); }
    else { a.colors.torso1 = hsl(t, 0.45, 0.45); a.colors.piernas1 = hsl((t + 180) % 360, 0.25, 0.32); a.colors.pelo = HAIRS[Math.floor(t / 37) % 10]; }
  }
  return a;
}
function hsl(h: number, s: number, l: number) {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return '#' + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- al azar (reclutas)
export function lookOnRandom(r: () => number, especie: Species): Look {
  const pick = <T,>(l: T[]) => l[Math.floor(r() * l.length)];
  const pieces: Partial<Record<Slot, string>> = {};
  // primero lo que manda (cabeza y torso), luego lo que depende de ello
  const slots = (especie === 'robot' ? SLOTS_ROBOT : HUMAN_SLOTS).slice().sort((a, b) => +(b === 'torso' || b === 'cabeza') - +(a === 'torso' || a === 'cabeza'));
  // un conjunto (torso, brazos y piernas del mismo personaje) casi siempre: mezclarlo todo queda de mercadillo
  const torsos = piecesOf('torso', especie);
  const outfit = pick(especie === 'robot' && r() < 0.75 ? torsos.filter(p => p.especie === 'robot') : torsos).source;
  const prob: Partial<Record<Slot, number>> = { cejas: 1, pelo: 0.92, barba: 0.35, sombrero: 0.3, gafas: 0.2, espalda: 0.3, complemento: 0.1 };
  for (const rr of slots) {
    const list = piecesOf(rr, especie).filter(p => fits(p, pieces)); if (!list.length) continue;
    if (REQUIRED.includes(rr)) {
      const same = list.find(p => p.source === outfit && r() < 0.8);
      pieces[rr] = (rr === 'torso' || rr === 'brazos' || rr === 'piernas') && same ? same.id : pick(list).id;
      if (especie === 'robot' && rr === 'cabeza' && r() < 0.6) pieces[rr] = list.find(p => p.source === outfit)?.id ?? pieces[rr];
    } else if (r() < (prob[rr] ?? 0.2)) pieces[rr] = pick(list).id;
  }
  const colors: Partial<Record<Region, string>> = {};
  if (especie === 'humano') {
    colors.piel = pick(SKINS); colors.pelo = pick(r() < 0.8 ? HAIRS.slice(0, 10) : HAIRS);
    if (r() < 0.5) colors.torso1 = pick(FABRICS);
    if (r() < 0.4) colors.piernas1 = pick(FABRICS);
  } else {
    if (r() < 0.7) colors.torso1 = pick(BODYSHOPS);
    if (r() < 0.5) colors.cabeza1 = colors.torso1 ?? pick(BODYSHOPS);
    colors.luz = pick(LIGHTS);
  }
  return { especie, pieces, colors };
}

// ---------------------------------------------------------------- paletas del probador
export const SKINS = ['#ffe0c7', '#f5c9a6', '#f0bd98', '#e3a77e', '#d39466', '#c08155', '#a86d45', '#8d5636', '#6f4128', '#57301d', '#3f2216', '#f2c4b6'];
export const HAIRS = ['#1c1a19', '#3a2a1f', '#5b3b24', '#7a4e2c', '#a0663a', '#c58a4a', '#e0b56e', '#f0d79a', '#b8461f', '#8e2f17', '#d8d4cc', '#9a9590', '#5e5a57', '#2c4f8a', '#2f8a6a', '#7a3fa0', '#d0457a', '#e05a3a', '#3fb0c8', '#f2f0ea'];
export const FABRICS = ['#2b2d33', '#4a4f57', '#8b8f96', '#d8d2c4', '#f0ebe0', '#6b2b2b', '#a83a32', '#d9622b', '#e3a63a', '#c9b458', '#566b2e', '#3f6b3a', '#2f6a5f', '#2e5d7a', '#2b3f6b', '#4b3a7a', '#7a3a6a', '#b85a7a', '#6b4a32', '#a07a52', '#c7a77a', '#3a2f28', '#1f3a2f', '#7a8a9a'];
export const BODYSHOPS = ['#c9ccd1', '#8d939b', '#5b6068', '#33363b', '#c7a14a', '#b8732f', '#8a3b2b', '#a83232', '#d9622b', '#e3c33a', '#5d7a3a', '#2f6a5f', '#2e6a9a', '#2b3f6b', '#5a3f8a', '#d8d2c4', '#f0ebe0', '#6b4a32'];
export const LIGHTS = ['#5ad1ff', '#7dffb0', '#ff5a4a', '#ffb347', '#ffe066', '#c78bff', '#ff6fd8', '#ffffff', '#3dff6e', '#4a7dff'];

/** Firma de un aspecto para compararlo con otro (mismas piezas y colores, en el mismo orden) */
export const lookSignature = (a: Look | null | undefined) => (a ? JSON.stringify(sanitizeLook(a)) : '');

/** Qué colores se eligen en cada ranura del probador (los de su región) */
export const COLORS_OF: Record<Slot | 'colores', Region[]> = {
  cara: ['piel'], cejas: ['pelo'], pelo: ['pelo'], barba: ['pelo'],
  cabeza: ['cabeza1', 'cabeza2', 'luz'],   // (los robots, además, la chapa de las manos: «piel»)
  sombrero: ['sombrero1', 'sombrero2'], gafas: [],
  torso: ['torso1', 'torso2', 'torso3', 'piel'], brazos: ['torso1', 'torso2', 'piel'],
  piernas: ['piernas1', 'piernas2', 'piernas3'],
  espalda: ['espalda1', 'espalda2'], complemento: ['espalda1', 'espalda2'],
  colores: ['piel', 'pelo', 'torso1', 'torso2', 'torso3', 'piernas1', 'piernas2', 'piernas3', 'sombrero1', 'sombrero2', 'espalda1', 'espalda2', 'cabeza1', 'cabeza2', 'luz'],
};
export const nameRegion = (r: Region, especie: Species) => (r === 'piel' && especie === 'robot' ? 'Chapa de manos' : NAME_REGION[r]);
export const NAME_REGION: Record<Region, string> = {
  piel: 'Piel', pelo: 'Pelo, cejas y barba', torso1: 'Arriba · principal', torso2: 'Arriba · secundario', torso3: 'Arriba · detalles',
  piernas1: 'Abajo · principal', piernas2: 'Abajo · secundario', piernas3: 'Abajo · detalles', cabeza1: 'Cabeza · chapa', cabeza2: 'Cabeza · detalles',
  sombrero1: 'Sombrero · principal', sombrero2: 'Sombrero · detalles', espalda1: 'Espalda · principal', espalda2: 'Espalda · detalles', luz: 'Luces',
};
/** Paleta de cada región */
export function paletteOf(r: Region, especie: Species): string[] {
  if (r === 'piel') return especie === 'robot' ? BODYSHOPS : SKINS;
  if (r === 'pelo') return HAIRS;
  if (r === 'luz') return LIGHTS;
  return especie === 'robot' ? BODYSHOPS : FABRICS;
}
export const SLOT_NAME: Record<Slot, string> = {
  cara: 'Cara', cejas: 'Cejas', pelo: 'Pelo', barba: 'Barba', cabeza: 'Cabeza', sombrero: 'Sombrero', gafas: 'Gafas y máscaras',
  torso: 'Torso', brazos: 'Brazos', piernas: 'Piernas', espalda: 'Espalda', complemento: 'Complementos',
};

/** Pone (o quita, con null) una pieza y deja el resto en forma: lo que no encaja con el esqueleto nuevo se cambia por
 *  lo del mismo personaje (brazos y piernas del torso elegido) o se quita (mochilas, sombreros). */
export function setPiece(a: Look, slot: Slot, id: string | null): Look {
  const n: Look = { especie: a.especie, pieces: { ...a.pieces }, colors: { ...a.colors } };
  if (id) n.pieces[slot] = id; else delete n.pieces[slot];
  const source = id ? PIECE.get(id)?.source : undefined;
  for (const r of (n.especie === 'robot' ? SLOTS_ROBOT : HUMAN_SLOTS)) {
    const current = n.pieces[r] ? PIECE.get(n.pieces[r]!) : undefined;
    if (!current || fits(current, n.pieces)) continue;
    const list = piecesOf(r, n.especie).filter(p => fits(p, n.pieces));
    const same = list.find(p => p.source === source);
    if (REQUIRED.includes(r)) n.pieces[r] = (same ?? list[0])?.id; else delete n.pieces[r];
  }
  return n;
}

/** Una línea que describe un aspecto (fichas de recluta y de habitante) */
export function lookSummary(a: Look): string {
  const n = (r: Slot) => (a.pieces[r] ? PIECE.get(a.pieces[r]!)?.name.toLowerCase() : undefined);
  const parts = a.especie === 'robot'
    ? [n('cabeza'), n('torso'), n('sombrero'), n('espalda')]
    : [n('pelo') ?? 'sin pelo', n('barba'), n('torso'), n('sombrero'), n('gafas')];
  return (a.especie === 'robot' ? 'robot: ' : 'humano: ') + parts.filter(Boolean).join(', ');
}
