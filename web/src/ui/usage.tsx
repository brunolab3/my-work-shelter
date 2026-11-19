// Consumo de una conversación: cuánto de su ventana de contexto ocupa ya (barra verde, ámbar o roja, como el /context
// de Claude Code) y los tokens que lleva gastados. Lo mide el servidor tras cada turno (sessions.ts, medirContexto)
import React from 'react';
import type { SessionSummary } from '@shared/protocol';
import { t, language } from '@shared/language';

export const tokensShort = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' k' : String(n)).replace('.', language() === 'es' ? ',' : '.');
export const contextLevel = (p: number) => (p >= 85 ? 'alto' : p >= 60 ? 'medio' : 'bajo');

// Compact is offered from the amber level (60 %, when the usual advice is to compact at a task boundary) and urged
// from the red one (85 %, close to Claude Code's own auto-compact). Only while idle: queued mid-turn it would wait
// for the turn to end anyway, and compacting mid-task loses what the dweller is in the middle of.
export function compactNeed(s: Pick<SessionSummary, 'context' | 'state'>): 'no' | 'sugerido' | 'urgente' {
  const c = s.context;
  if (!c || !['terminada', 'ociosa', 'error'].includes(s.state)) return 'no';
  const level = contextLevel(c.percentage);
  return level === 'alto' ? 'urgente' : level === 'medio' ? 'sugerido' : 'no';
}

export function Usage({ s, length, compact }: { s: Pick<SessionSummary, 'context' | 'tokens' | 'state'>; length?: boolean; compact?: () => void }) {
  const c = s.context;
  if (!c && !s.tokens) return null;
  const title = [c && t('windows.contextUsed', { p: c.percentage, usados: tokensShort(c.used), maximo: tokensShort(c.max) }), s.tokens && t('windows.tokensSpent', { n: tokensShort(s.tokens) })].filter(Boolean).join(' · ');
  const need = compact ? compactNeed(s) : 'no';
  return (
    <span className={'consumo' + (c ? ' ' + contextLevel(c.percentage) : '')} title={title}>
      {c && <><span className="consumo-barra"><i style={{ width: Math.min(100, c.percentage) + '%' }} /></span>{c.percentage} %</>}
      {length && s.tokens ? <span className="tenue"> · {t('windows.nTokens', { n: tokensShort(s.tokens) })}</span> : null}
      {need !== 'no' && <button className={'consumo-compactar' + (need === 'urgente' ? ' urgente' : '')} title={t(need === 'urgente' ? 'windows.compactUrgentHint' : 'windows.compactHint')} onClick={compact}>{t('windows.compact')}</button>}
    </span>
  );
}
