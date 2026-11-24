// «New session with a handoff» (sessions.ts: handoff()): once the dweller has written the handoff summary, a new
// conversation for the same dweller, folder, model and permissions starts with it as its first message, and the old one
// is closed, never deleted: it stays in the room's logbook to resume. If the new one can't start, the old one stays open.
import type { SessionSummary, WorkOptions } from '../shared/protocol.ts';
import { t } from '../shared/language.ts';

export interface HandoffDeps {
  start(m: { dwellerId: string; roomId: string; prompt: string; options: WorkOptions }): Promise<string>;
  close(id: string): void;
}

export const handoffPrompt = (summary: string) => t('prompt.handoff.start', { summary: summary.trim() });

export async function startFromHandoff(d: HandoffDeps, old: SessionSummary, summary: string): Promise<string> {
  const id = await d.start({
    dwellerId: old.dwellerId, roomId: old.roomId, prompt: handoffPrompt(summary),
    options: { cwd: old.cwd, model: old.model, effort: old.effort, permissions: old.permissionMode, worktree: false, handoffFrom: old.id },
  });
  d.close(old.id);
  return id;
}
