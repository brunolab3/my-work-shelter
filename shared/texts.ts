// Catálogo de textos (shared/language.ts): clave en inglés → { es, en }, un archivo por zona en shared/texts/.
import type { LocalizedText } from './language.ts';
import { MENU } from './texts/menu.ts';
import { WORLD } from './texts/world.ts';
import { PANELS } from './texts/panels.ts';
import { WINDOWS } from './texts/windows.ts';
import { PROMPTS } from './texts/prompts.ts';
import { SERVER } from './texts/server.ts';
import { TOOLS } from './texts/tools.ts';
import { INTEGRATIONS } from './texts/integrations.ts';
import { PREFLIGHT } from './texts/preflight.ts';
import { MEETING } from './texts/meeting.ts';
import { DWELLERS } from './texts/dwellers.ts';
import { VERIFICATION } from './texts/verification.ts';
import { REVIEWS } from './texts/reviews.ts';
import { WORK_LOG } from './texts/workLog.ts';

export const TEXTS: Record<string, LocalizedText> = { ...MENU, ...WORLD, ...PANELS, ...WINDOWS, ...PROMPTS, ...SERVER, ...TOOLS, ...INTEGRATIONS, ...PREFLIGHT, ...MEETING, ...DWELLERS, ...VERIFICATION, ...REVIEWS, ...WORK_LOG };
