// The alert for a meeting about to start (shared/meeting.ts, web/src/ui/Hud.tsx) (catálogo: shared/texts.ts)
import type { Texto } from '../language.ts';

export const MEETING: Record<string, Texto> = {
  'meeting.startsIn1': { es: 'Empieza en 1 min', en: 'Starts in 1 min' },
  'meeting.startsNow': { es: 'Empieza ahora', en: 'Starting now' },
  'meeting.join': { es: 'Unirse', en: 'Join' },
  'meeting.dismiss': { es: 'Descartar', en: 'Dismiss' },
  'meeting.alert': { es: 'Reunión a punto de empezar', en: 'Meeting about to start' },
};
