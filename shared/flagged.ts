// Conversations the Overseer marked as pending (⚑): a reminder that they still have to act on them. Only they set and
// clear it (sending a message doesn't). Kept in the game's settings by Claude Code session id, so it survives restarts
// and comes back when the conversation is resumed. Set on open or closed ones; shown on its tab, the ⋯ N list, the
// archive and, while open, its dweller's or hologram's tag.
import type { SessionSummary } from './protocol.ts';
import { t } from './language.ts';

export const FLAGGED_MAX = 300;

/** The flagged Claude Code session ids from the game's settings */
export function flaggedIds(settings: unknown): Set<string> {
  const l = (settings as { flaggedConversations?: unknown } | null | undefined)?.flaggedConversations;
  return new Set(Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string') : []);
}

/** The list with `claudeId` flagged or not, newest last; the oldest go past FLAGGED_MAX */
export function setFlag(list: unknown, claudeId: string, on: boolean): string[] {
  const rest = [...flaggedIds({ flaggedConversations: list })].filter(x => x !== claudeId);
  return (on && claudeId ? [...rest, claudeId] : rest).slice(-FLAGGED_MAX);
}

/** A conversation the flag goes on: an open or closed one's summary, or just the Claude Code session id of one being resumed */
export type Flaggable = { claudeId?: string; state?: SessionSummary['state'] };

/** A conversation's flag, open or closed: undefined where it can't be set (no conversation, or one still starting) */
export const flagOf = (s: Flaggable | undefined, ids: Set<string>) => (s?.claudeId ? ids.has(s.claudeId) : undefined);

/** Whether a conversation counts as pending on its dweller's or hologram's tag: an open one whose session is flagged */
export const isFlagged = (s: SessionSummary | undefined, ids: Set<string>) => s?.state !== 'cerrada' && flagOf(s, ids) === true;

/** How many of these conversations (a dweller's or a hologram's) are pending */
export const flaggedIn = (sessions: Iterable<SessionSummary | undefined>, ids: Set<string>) => {
  let n = 0;
  for (const s of sessions) if (isFlagged(s, ids)) n++;
  return n;
};

/** The mark on a dweller's or a hologram's tag: ⚑ for one, ⚑ n for several, nothing for none */
export const flagMark = (n: number) => (n > 1 ? t('windows.flag.marks', { n }) : n ? t('windows.flag.mark') : undefined);
