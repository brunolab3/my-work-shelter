// Consumo de una conversación: cuánto de su ventana de contexto ocupa ya (barra verde, ámbar o roja, como el /context
// de Claude Code) y los tokens que lleva gastados. Lo mide el servidor tras cada turno (sesiones.ts, medirContexto)
import React from 'react';
import type { SessionSummary } from '@shared/protocolo';
import { t, idioma } from '@shared/idioma';

export const tokensShort = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' k' : String(n)).replace('.', idioma() === 'es' ? ',' : '.');
export const contextLevel = (p: number) => (p >= 85 ? 'alto' : p >= 60 ? 'medio' : 'bajo');

export function Usage({ s, largo }: { s: Pick<SessionSummary, 'contexto' | 'tokens'>; largo?: boolean }) {
  const c = s.contexto;
  if (!c && !s.tokens) return null;
  const titulo = [c && t('windows.contextUsed', { p: c.porcentaje, usados: tokensShort(c.usados), maximo: tokensShort(c.maximo) }), s.tokens && t('windows.tokensSpent', { n: tokensShort(s.tokens) })].filter(Boolean).join(' · ');
  return (
    <span className={'consumo' + (c ? ' ' + contextLevel(c.porcentaje) : '')} title={titulo}>
      {c && <><span className="consumo-barra"><i style={{ width: Math.min(100, c.porcentaje) + '%' }} /></span>{c.porcentaje} %</>}
      {largo && s.tokens ? <span className="tenue"> · {t('windows.nTokens', { n: tokensShort(s.tokens) })}</span> : null}
    </span>
  );
}
