// Piezas comunes del cliente de git
import { t } from '@shared/idioma';
export type Letter = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '?';
export const LETTER: Record<string, string> = { M: t('windows.modified'), A: t('windows.added'), D: t('windows.deleted'), R: t('windows.renamed'), C: t('windows.copied'), T: t('windows.typeChanged'), U: t('windows.conflicted'), '?': t('windows.untracked') };
export function hace(cuando: number) {
  const m = Math.round((Date.now() - cuando) / 60000);
  return m < 1 ? t('windows.now') : m < 60 ? t('windows.nMinAgo', { n: m }) : m < 1440 ? t('windows.nHAgo', { n: Math.round(m / 60) }) : m < 1440 * 45 ? t('windows.nDAgo', { n: Math.round(m / 1440) }) : m < 1440 * 365 ? t('windows.nMonthsAgo', { n: Math.round(m / 43200) }) : t('windows.nYearsAgo', { n: Math.round(m / 525600) });
}
