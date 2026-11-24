// Retoques a mano del despiece automático de algunas cabezas (qué es gorro y qué es pelo cuando el color engaña).
// Los números de componente son su orden por tamaño (el 0, el más grande), como los lista la herramienta figures.html.
import type { Settings } from './breakdown';

export const SETTINGS: Record<string, Settings> = {
  Knight: { hair: [[218, 174, 126]] },
  ToySoldier: { tintsFace: [[200, 54, 63]] },   // los coloretes son de la cara, no del bigote
  // gorras: la visera, las orejeras y la chapa son gorro; lo que asoma por debajo, pelo
  Protagonist_A: { comp: { 1: 'cap', 3: 'cap', 6: 'cap', 12: 'cap' } },
  Protagonist_B: { comp: { 1: 'cap', 3: 'cap', 17: 'cap', 18: 'cap' } },
  // capuchas y cintas
  Cleric: { comp: { 0: 'cap', 1: 'cap', 8: 'cap', 9: 'cap' } },
  Rogue_Hooded: { comp: { 0: 'cap' } },
  Druid: { tintsCap: [[103, 108, 12]], comp: { 1: 'cap', 2: 'cap', 3: 'cap' } },
  Marksman: { comp: { 0: 'cap', 1: 'cap', 3: 'cejas', 5: 'cejas' } },   // (sus cejas no salen pares: una tiene más triángulos)
  Survivalist: { comp: { 1: 'cap' } },
  // la peluca del payaso, los lazos de la chica mágica y el antifaz del héroe
  Clown: { hairIsCap: true, tintsFace: [[222, 213, 202], [99, 160, 208]] },   // el blanco y los rombos de los ojos, maquillaje
  MagicalGirl: { tintsCap: [[216, 43, 42]] },
  SpaceRanger: { tintsCap: [[77, 108, 131]] },   // el cuello del traje no es pelo
  Superhero: { tintsCap: [[36, 117, 181], [216, 43, 42]] },   // (el antifaz no se ofrece: pintado sobre su cráneo, no casa con otras caras)
};
