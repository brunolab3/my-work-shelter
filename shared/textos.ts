// Catálogo de textos (shared/idioma.ts): clave en inglés → { es, en }, un archivo por zona en shared/textos/.
import type { Texto } from './idioma.ts';
import { MENU } from './textos/menu.ts';
import { WORLD } from './textos/mundo.ts';
import { PANELS } from './textos/paneles.ts';
import { WINDOWS } from './textos/ventanas.ts';
import { PROMPTS } from './textos/prompts.ts';
import { SERVIDOR } from './textos/servidor.ts';
import { TOOLS } from './textos/herramientas.ts';
import { INTEGRATIONS } from './textos/integraciones.ts';

export const TEXTS: Record<string, Texto> = { ...MENU, ...WORLD, ...PANELS, ...WINDOWS, ...PROMPTS, ...SERVIDOR, ...TOOLS, ...INTEGRATIONS };
