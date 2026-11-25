// Consumo de una conversación: cuánto de su ventana de contexto ocupa ya (barra verde, ámbar o roja, como el /context
// de Claude Code) y los tokens que lleva gastados. Lo mide el servidor tras cada turno (sessions.ts, medirContexto)
import React from 'react';
import type { SessionSummary } from '@shared/protocol';
import { t, language } from '@shared/language';
import { contextLevel, compactLevel } from '@shared/compact';

export const tokensShort = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' M' : n >= 1e3 ? Math.round(n / 1e3) + ' k' : String(n)).replace('.', language() === 'es' ? ',' : '.');

// Compact is offered from 150k tokens of context (worth doing at a task boundary) or 40 % of a small window, and urged
// from 300k or 60 %, well before Claude Code's own auto-compact; thresholds in shared/compact.ts, and the bar's colours
// keep their own levels (contextLevel). Only while idle: queued mid-turn it would wait for the turn to end anyway, and
// compacting mid-task loses what the dweller is in the middle of.
export function compactNeed(s: Pick<SessionSummary, 'context' | 'state'>): 'no' | 'sugerido' | 'urgent' {
  const c = s.context;
  if (!c || !['finished', 'idle', 'error'].includes(s.state)) return 'no';
  const level = compactLevel(c);
  return level === 'high' ? 'urgent' : level === 'medium' ? 'sugerido' : 'no';
}

export function Usage({ s, length, compact }: { s: Pick<SessionSummary, 'context' | 'tokens' | 'state'>; length?: boolean; compact?: () => void }) {
  const c = s.context;
  if (!c && !s.tokens) return null;
  const title = [c && t('windows.contextUsed', { p: c.percentage, used: tokensShort(c.used), maximum: tokensShort(c.max) }), s.tokens && t('windows.tokensSpent', { n: tokensShort(s.tokens) })].filter(Boolean).join(' · ');
  const need = compact ? compactNeed(s) : 'no';
  return (
    <span className={'consumption' + (c ? ' ' + contextLevel(c) : '')} title={title}>
      {c && <><span className="consumption-bar"><i style={{ width: Math.min(100, c.percentage) + '%' }} /></span>{c.percentage} %</>}
      {length && s.tokens ? <span className="dim"> · {t('windows.nTokens', { n: tokensShort(s.tokens) })}</span> : null}
      {need !== 'no' && <button className={'consumption-compact' + (need === 'urgent' ? ' urgent' : '')} title={t(need === 'urgent' ? 'windows.compactUrgentHint' : 'windows.compactHint')} onClick={compact}>{t('windows.compact')}</button>}
    </span>
  );
}
