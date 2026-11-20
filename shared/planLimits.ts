// The Claude plan's usage limits as the game knows them (server/planLimits.ts keeps them; the top bar shows them):
// one entry per window, keyed by the SDK's rateLimitType ('five_hour', 'seven_day', 'seven_day_opus'…).

export type LimitStatus = 'allowed' | 'allowed_warning' | 'rejected';
export interface PlanLimit {
  status: LimitStatus;
  utilization: number | null;   // percent of the window used, 0-100; null when unknown
  resetsAt: number | null;      // ms
  updated: number;              // ms
}
export type PlanLimits = Record<string, PlanLimit>;

// the windows the top bar shows, in order: the 5-hour one always, the weekly one once known
export const BAR_WINDOWS = ['five_hour', 'seven_day'] as const;

export type LimitLevel = 'desconocido' | 'bajo' | 'medio' | 'alto' | 'agotado';
export function limitLevel(l: PlanLimit | undefined): LimitLevel {
  if (l?.status === 'rejected') return 'agotado';
  if (l?.utilization == null) return 'desconocido';
  return l.utilization >= 90 ? 'alto' : l.utilization >= 70 || l.status === 'allowed_warning' ? 'medio' : 'bajo';
}

// the windows that have stopped Claude right now (any of them, not only the ones in the bar)
export const rejectedWindows = (ls: PlanLimits) => Object.keys(ls).filter(k => ls[k].status === 'rejected');
