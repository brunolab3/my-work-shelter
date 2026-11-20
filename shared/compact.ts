// When a dweller's conversation should be compacted, in tokens of context rather than a share of the window: every call
// re-reads the whole context, so on a 1M window a percentage (60 % = 600k) comes far too late. The game suggests
// «Compact» from SUGGEST, urges it from URGE, and has Claude Code compact by itself near the auto-compact window
// (vault setting; Claude Code keeps a ~33k buffer below it, so 400k compacts at ~367k)
export const COMPACT_SUGGEST = 150_000;
export const COMPACT_URGE = 300_000;
export const AUTO_COMPACT_DEFAULT = 400_000;
// the range Claude Code's `autoCompactWindow` setting accepts
export const AUTO_COMPACT_MIN = 100_000, AUTO_COMPACT_MAX = 1_000_000;

// the vault setting as the window to pass to Claude Code: unset means the default, 0 means Claude Code's own (undefined)
export function autoCompactWindow(v: unknown): number | undefined {
  if (v === 0) return undefined;
  const n = typeof v === 'number' && Number.isFinite(v) ? v : AUTO_COMPACT_DEFAULT;
  return Math.round(Math.max(AUTO_COMPACT_MIN, Math.min(AUTO_COMPACT_MAX, n)));
}

// when to offer «Compact»: tokens first; the percentage stays for small windows (40 % / 60 % of a 200k window come
// before 150k / 300k)
export function compactLevel(c: { used: number; percentage: number }): 'bajo' | 'medio' | 'alto' {
  return c.used >= COMPACT_URGE || c.percentage >= 60 ? 'alto' : c.used >= COMPACT_SUGGEST || c.percentage >= 40 ? 'medio' : 'bajo';
}

// the bar's colour: the same tokens, with its own percentage levels (amber from 60 %, red from 85 %)
export function contextLevel(c: { used: number; percentage: number }): 'bajo' | 'medio' | 'alto' {
  return c.used >= COMPACT_URGE || c.percentage >= 85 ? 'alto' : c.used >= COMPACT_SUGGEST || c.percentage >= 60 ? 'medio' : 'bajo';
}
