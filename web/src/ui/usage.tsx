// Consumo de una conversación: cuánto de su ventana de contexto ocupa ya (barra verde, ámbar o roja, como el /context
// de Claude Code) y los tokens que lleva gastados. Lo mide el servidor tras cada turno (sessions.ts, medirContexto)
import React from 'react';
import type { SessionSummary } from '@shared/protocol';
import { t, idioma } from '@shared/language';

export const tokensShort = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' k' : String(n)).replace('.', idioma() === 'es' ? ',' : '.');
export const contextLevel = (p: number) => (p >= 85 ? 'alto' : p >= 60 ? 'medio' : 'bajo');

// Compact is offered from the amber level (60 %, when the usual advice is to compact at a task boundary) and urged
// from the red one (85 %, close to Claude Code's own auto-compact). Only while idle: queued mid-turn it would wait
// for the turn to end anyway, and compacting mid-task loses what the dweller is in the middle of.
export function compactNeed(s: Pick<SessionSummary, 'contexto' | 'estado'>): 'no' | 'sugerido' | 'urgente' {
  const c = s.contexto;
  if (!c || !['terminada', 'ociosa', 'error'].includes(s.estado)) return 'no';
  const nivel = contextLevel(c.porcentaje);
  return nivel === 'alto' ? 'urgente' : nivel === 'medio' ? 'sugerido' : 'no';
}

export function Usage({ s, largo, compactar }: { s: Pick<SessionSummary, 'contexto' | 'tokens' | 'estado'>; largo?: boolean; compactar?: () => void }) {
  const c = s.contexto;
  if (!c && !s.tokens) return null;
  const titulo = [c && t('windows.contextUsed', { p: c.porcentaje, usados: tokensShort(c.usados), maximo: tokensShort(c.maximo) }), s.tokens && t('windows.tokensSpent', { n: tokensShort(s.tokens) })].filter(Boolean).join(' · ');
  const necesidad = compactar ? compactNeed(s) : 'no';
  return (
    <span className={'consumo' + (c ? ' ' + contextLevel(c.porcentaje) : '')} title={titulo}>
      {c && <><span className="consumo-barra"><i style={{ width: Math.min(100, c.porcentaje) + '%' }} /></span>{c.porcentaje} %</>}
      {largo && s.tokens ? <span className="tenue"> · {t('windows.nTokens', { n: tokensShort(s.tokens) })}</span> : null}
      {necesidad !== 'no' && <button className={'consumo-compactar' + (necesidad === 'urgente' ? ' urgente' : '')} title={t(necesidad === 'urgente' ? 'windows.compactUrgentHint' : 'windows.compactHint')} onClick={compactar}>{t('windows.compact')}</button>}
    </span>
  );
}
