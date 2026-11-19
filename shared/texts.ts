// Catálogo de textos (shared/language.ts): clave en inglés → { es, en }, un archivo por zona en shared/texts/.
import type { Texto } from './language.ts';
import { MENU } from './texts/menu.ts';
import { WORLD } from './texts/world.ts';
import { PANELS } from './texts/panels.ts';
import { WINDOWS } from './texts/windows.ts';
import { PROMPTS } from './texts/prompts.ts';
import { SERVIDOR } from './texts/server.ts';
import { TOOLS } from './texts/tools.ts';
import { INTEGRATIONS } from './texts/integrations.ts';
import { PREFLIGHT } from './texts/preflight.ts';
import { MEETING } from './texts/meeting.ts';
import { DWELLERS } from './texts/dwellers.ts';
import { VERIFICATION } from './texts/verification.ts';

export const TEXTS: Record<string, Texto> = { ...MENU, ...WORLD, ...PANELS, ...WINDOWS, ...PROMPTS, ...SERVIDOR, ...TOOLS, ...INTEGRATIONS, ...PREFLIGHT, ...MEETING, ...DWELLERS, ...VERIFICATION };
