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
import { decideMedal, emptyLedger, ledgerOf, logRows, mergeConversations, mergePRs, mergeReviews, mergeTasks, mergeVerified, mergeWorktrees, proposeMedal, syncText, type Ledger, type Medal } from '../shared/workLog.ts';
import { digestDue, evaluate, fileText, medalRequirements, newlyEarned, parseLadder, type CareerState } from '../shared/trophies.ts';

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
    return { source: 'none', file: this.ladderFile, ladder: { trophies: [], steps: [], digestRoom: 'logistica' }, errors: [] };
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

  /** A medal the Friday digest proposes (award_propose): saved as proposed, for the Overseer to accept or dismiss */
  proposeMedal(m: Parameters<typeof proposeMedal>[1]): ReturnType<typeof proposeMedal> {
    const r = proposeMedal(this.ledger, m, medalRequirements(this.ladder().ladder).map(q => q.id), this.now());
    if (r.ok) this.save();
    return r;
  }
  decideMedal(id: string, accept: boolean): Medal | undefined {
    const m = decideMedal(this.ledger, id, accept, this.now());
    if (m) this.save();
    return m;
  }
  /** The room whose dweller runs the Friday digest (and the only one offered award_propose) */
  digestRoom(): string { return this.ladder().ladder.digestRoom; }
  /** The Friday digest's first message when it is due (once a week, Friday from 09:00), else none. Only with requirements
   *  that take medals; the first sweep just starts the count, so the first one is the next Friday */
  digest(): string | undefined {
    const l = this.ledger, now = this.now(), reqs = medalRequirements(this.ladder().ladder);
    if (!reqs.length) return undefined;
    if (l.digestAt === undefined) { l.digestAt = now; this.save(); return undefined; }
    if (!digestDue(l.digestAt, now)) return undefined;
    l.digestAt = now; this.save();
    const since = now - 7 * 864e5;
    const conversations = Object.values(l.conversations).filter(c => c.last >= since).sort((a, b) => b.last - a.last).slice(0, 60)
      .map(c => `- ${c.task} · ${c.roomId} · «${c.title}» · claudeId ${c.claudeId} · ${c.cwd}`).join('\n');
    return t('prompt.medalDigest', {
      requisitos: reqs.map(q => `- ${q.id}: ${fileText(q.text)} — ${fileText(q.evidence)}`).join('\n'),
      log: syncText(logRows(l, since)) || '—', conversaciones: conversations || '—',
      propuestas: Object.values(l.medals).filter(m => m.proposedAt >= since - 7 * 864e5).map(m => `- ${m.requirement}: ${m.text} (${m.state})`).join('\n') || '—',
    });
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
