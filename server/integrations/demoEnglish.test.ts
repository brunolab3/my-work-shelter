import { describe, it, expect, afterEach } from 'vitest';
import { setLanguage } from '../../shared/language.ts';
import { demoNotifications, demoEvents, demoPanelLinear, demoBoardLinear, demoPanelJira } from './demo.ts';
import { demoPRsBoard, github } from '../git.ts';
import { SOURCES } from '../../shared/fonts.ts';

// every sentence of the DEMO data has its English (demoEnglish.ts): people's names, links and ids stay
const SKIP = new Set(['autor', 'asignado', 'id', 'url', 'enlace', 'videollamada', 'hilo', 'usuario', 'nombre_', 'yo', 'name', 'error', 'fecha']);
const nameLike = /^(?:REF-\d+ · |Release · )?@?\p{Lu}\p{Ll}+(?: \p{Lu}\p{Ll}+)?$|^Release · /u;
const all = async () => ({ n: SOURCES.map(f => demoNotifications(f)), e: SOURCES.map(f => demoEvents(f)), l: demoPanelLinear(), b: demoBoardLinear(), j: demoPanelJira(), p: demoPRsBoard(), g: (await github([])).prs });
function untranslated(es: any, en: any, key = '', out: string[] = []): string[] {
  if (typeof es === 'string') { if (!SKIP.has(key) && !/https?:/.test(es) && !nameLike.test(es) && (/\s/.test(es) || /[áéíóúñ¿¡]/.test(es)) && /[a-záéíóúñ]{3}/i.test(es) && es === en) out.push(`${key}: ${es}`); }
  else if (Array.isArray(es)) es.forEach((x, i) => untranslated(x, en[i], key, out));
  else if (es && typeof es === 'object') for (const k of Object.keys(es)) if (!['fecha', 'actualizada', 'actualizado', 'cuando', 'inicio', 'fin', 'ts'].includes(k)) untranslated(es[k], en[k], k, out);
  return out;
}

describe('DEMO data in English', () => {
  afterEach(() => setLanguage('es'));
  it('with the shelter in English, no Spanish sentence is left', async () => {
    setLanguage('es'); const es = await all();
    setLanguage('en'); const en = await all();
    expect(untranslated(es, en)).toEqual([]);
    expect(en.j.tareas[0].estado).toBe('In progress');
  });
});
