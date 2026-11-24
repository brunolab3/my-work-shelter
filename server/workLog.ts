// The work log's ledger (model in shared/workLog.ts), saved in DATOS/bitacora.json, and the career ladder file. Every
// sweep merges what the game already reads (Jira board, your PRs, the rooms' worktrees, the conversations, the Review
// room's PRs, production verifications): nothing new is asked outside. With Jira and GitHub both in DEMO the log shows
// a ledger built from the demo data, never saved. Trophies are derived on read (shared/trophies.ts); one newly earned
// is announced once.
import { copyFileSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { t } from '../shared/language.ts';
import type { PRBoard, TaskJira } from '../shared/board.ts';
import type { ReviewPR } from '../shared/reviews.ts';
import { emptyLedger, ledgerOf, mergeConversations, mergePRs, mergeReviews, mergeTasks, mergeVerified, mergeWorktrees, type Ledger } from '../shared/workLog.ts';
import { evaluate, fileText, newlyEarned, parseLadder, type CareerState } from '../shared/trophies.ts';

export interface WorkLogSources {
  jira(): Promise<{ tareas: TaskJira[]; demo?: boolean } | null>;        // null: Jira off or failing
  prs(): Promise<{ prs: PRBoard[]; demo?: boolean } | null>;
  worktrees(): { rooms: string[]; live: { path: string; roomId: string; branch?: string }[] };
  sessions(): { claudeId?: string; title: string; roomId: string; cwd: string; worktree?: string; updated: number }[];
  reviews(): ReviewPR[] | null;                                           // null: the Review room hasn't read GitHub
  verified(): string[];                                                   // tasks whose production verification ended evidenced
  notify(text: string): void;
}
export type LadderSource = 'local' | 'example' | 'none';
export interface WorkLogRead { ledger: Ledger; demo: boolean; ladder: { source: LadderSource; file: string; local: string; errors: string[] }; career: CareerState }

export class WorkLog {
  private ledger: Ledger = emptyLedger();
  private file: string;
  readonly ladderFile: string;
  constructor(dir: string, private exampleFile: string, private now: () => number = Date.now) {
    this.file = path.join(dir, 'bitacora.json');
    this.ladderFile = path.join(dir, 'escalera.json');
    try { if (existsSync(this.file)) this.ledger = ledgerOf(JSON.parse(readFileSync(this.file, 'utf8'))); } catch {}
  }
  private save() { const tmp = this.file + '.tmp'; writeFileSync(tmp, JSON.stringify(this.ledger), { mode: 0o600 }); renameSync(tmp, this.file); }

  /** The Overseer's ladder file, made from the example the first time (to open and edit it) */
  ensureLadder(): string {
    if (!existsSync(this.ladderFile)) { if (existsSync(this.exampleFile)) copyFileSync(this.exampleFile, this.ladderFile); else writeFileSync(this.ladderFile, '{ "trophies": [], "steps": [] }\n'); }
    return this.ladderFile;
  }
  /** The ladder: the Overseer's file, else the repo's example */
  ladder(): Omit<WorkLogRead['ladder'], 'local'> & ReturnType<typeof parseLadder> {
    for (const [file, source] of [[this.ladderFile, 'local'], [this.exampleFile, 'example']] as const) {
      if (!existsSync(file)) continue;
      let text = '';
      try { text = readFileSync(file, 'utf8'); } catch (e) { return { source, file, ...parseLadder(''), errors: [String((e as Error).message)] }; }
      return { source, file, ...parseLadder(text) };
    }
    return { source: 'none', file: this.ladderFile, ladder: { trophies: [], steps: [] }, errors: [] };
  }

  /** Merges what the sources hold now. `remote`: also Jira and GitHub (the local parts are cheap and go every time) */
  async sweep(src: WorkLogSources, remote: boolean): Promise<void> {
    const now = this.now(), l = this.ledger;
    let changed = false;
    if (remote) {
      const [jira, prs] = await Promise.all([src.jira().catch(() => null), src.prs().catch(() => null)]);
      if (jira && !jira.demo) changed = mergeTasks(l, jira.tareas, now) || changed;
      if (prs && !prs.demo) changed = mergePRs(l, prs.prs, now) || changed;
      const reviews = src.reviews();
      if (reviews) changed = mergeReviews(l, reviews, now) || changed;
      changed = mergeVerified(l, src.verified(), now) || changed;
    }
    const w = src.worktrees();
    changed = mergeWorktrees(l, w.live, w.rooms, now) || changed;
    changed = mergeConversations(l, src.sessions(), now) || changed;
    const fresh = newlyEarned(evaluate(this.ladder().ladder, l, now), l.notified);
    if (fresh.length) {
      l.notified.push(...fresh.map(x => x.rule.id)); changed = true;
      src.notify(fresh.length === 1 ? t('trophies.earned', { nombre: fileText(fresh[0].rule.name) }) : t('trophies.earnedMany', { n: fresh.length, nombres: fresh.map(x => fileText(x.rule.name)).join(', ') }));
    }
    if (changed) this.save();
  }

  /** The ledger and the career: with Jira and GitHub both in DEMO, one built from their demo data (not saved) */
  async read(src: WorkLogSources): Promise<WorkLogRead> {
    const now = this.now();
    const [jira, prs] = await Promise.all([src.jira().catch(() => null), src.prs().catch(() => null)]);
    const demo = !!jira?.demo && !!prs?.demo;
    let ledger = this.ledger;
    if (demo) {
      ledger = emptyLedger();
      mergeTasks(ledger, jira!.tareas, now); mergePRs(ledger, prs!.prs, now);
      const w = src.worktrees(); mergeWorktrees(ledger, w.live, w.rooms, now); mergeConversations(ledger, src.sessions(), now);
      mergeReviews(ledger, src.reviews() ?? [], now);
    }
    const { source, file, ladder, errors } = this.ladder();
    return { ledger, demo, ladder: { source, file, local: this.ladderFile, errors }, career: evaluate(ladder, ledger, now) };
  }
}
