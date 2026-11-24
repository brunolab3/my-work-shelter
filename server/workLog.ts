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
import { decideMedal, emptyLedger, ledgerOf, logRows, mergeConversations, mergePRs, mergeReviews, mergeTasks, mergeVerified, mergeWorktrees, proposeMedal, syncText, type Ledger, type Medal, type MedalProposal } from '../shared/workLog.ts';
import { awardsOf, digestDue, evaluate, fileText, newlyEarned, parseLadder, progressOf, settleProgress, withProgress, type CareerState, type LadderProgress, type SessionReport } from '../shared/trophies.ts';

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
export interface WorkLogRead { ledger: Ledger; demo: boolean; ladder: { source: LadderSource; file: string; local: string; errors: string[] }; career: CareerState; progress?: LadderProgress }

export class WorkLog {
  private ledger: Ledger = emptyLedger();
  private demo = false;                  // both Jira and GitHub in DEMO, as the last remote sweep found them (read() doesn't wait for them)
  private remoteAt = 0;                  // when read() last started a remote sweep
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
    return { source: 'none', file: this.ladderFile, ladder: { trophies: [], steps: [], digestRoom: 'logistics' }, errors: [] };
  }

  /** Merges what the sources hold now. `remote`: also Jira and GitHub (the local parts are cheap and go every time) */
  async sweep(src: WorkLogSources, remote: boolean): Promise<void> {
    const now = this.now(), l = this.ledger;
    let changed = false;
    if (remote) {
      const [jira, prs] = await Promise.all([src.jira().catch(() => null), src.prs().catch(() => null)]);
      this.demo = !!jira?.demo && !!prs?.demo;
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
      l.notified.push(...fresh.map(x => x.key)); changed = true;
      src.notify(fresh.length === 1 ? t('trophies.earned', { nombre: fresh[0].name }) : t('trophies.earnedMany', { n: fresh.length, nombres: fresh.map(x => x.name).join(', ') }));
    }
    if (changed) this.save();
  }

  /** A medal the Friday digest proposes (award_propose): saved as proposed, for the Overseer to accept or dismiss */
  proposeMedal(m: MedalProposal): ReturnType<typeof proposeMedal> {
    const r = proposeMedal(this.ledger, m, awardsOf(this.ladder().ladder), this.now(), { by: 'dweller' });
    if (r.ok) this.save();
    return r;
  }
  /** A medal the Overseer enters by hand (an award whose sources include manual): entering it is accepting it */
  enterMedal(m: Omit<MedalProposal, 'source'>): ReturnType<typeof proposeMedal> {
    const r = proposeMedal(this.ledger, { ...m, source: 'manual' }, awardsOf(this.ladder().ladder), this.now(), { by: 'overseer' });
    if (r.ok) decideMedal(this.ledger, r.medal.id, true, this.now());
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
  /** The Friday digest's first message when it is due (once a week, Friday from 09:00), else none. Only with awards the
   *  digest can propose (not only by hand); the first sweep just starts the count, so the first one is the next Friday.
   *  The Slack part when some award takes Slack: the session searches it with the Overseer's own Slack connector, and
   *  without one skips those awards and says so (the game holds no Slack token) */
  digest(): string | undefined {
    const l = this.ledger, now = this.now(), all = awardsOf(this.ladder().ladder);
    const usable = (x: string) => x !== 'manual';
    const awards = all.filter(a => a.sources.some(usable));
    if (!awards.length) return undefined;
    if (l.digestAt === undefined) { l.digestAt = now; this.save(); return undefined; }
    if (!digestDue(l.digestAt, now)) return undefined;
    l.digestAt = now; this.save();
    const since = now - 7 * 864e5;
    const conversations = Object.values(l.conversations).filter(c => c.last >= since).sort((a, b) => b.last - a.last).slice(0, 60)
      .map(c => `- ${c.task} · ${c.roomId} · «${c.title}» · claudeId ${c.claudeId} · ${c.cwd}`).join('\n');
    const slackAwards = all.filter(a => a.sources.includes('slack')).map(a => a.id);
    const slack = !slackAwards.length ? '' : t('prompt.medalDigest.slack', { desde: new Date(since).toISOString().slice(0, 10), hasta: new Date(now).toISOString().slice(0, 10), premios: slackAwards.join(', ') });
    return t('prompt.medalDigest', {
      requisitos: awards.map(a => `- ${a.id}: ${fileText(a.name)} — ${fileText(a.evidence)} [${a.sources.filter(usable).join(', ')}]`).join('\n'),
      slack,
      log: syncText(logRows(l, since)) || '—', conversaciones: conversations || '—',
      propuestas: Object.values(l.medals).filter(m => m.proposedAt >= since - 7 * 864e5).map(m => `- ${m.award ?? m.requirement}: ${m.text} (${m.state}; ${m.evidence.join(', ')})`).join('\n') || '—',
    });
  }

  /** The ledger and the career: with Jira and GitHub both in DEMO, one built from their demo data (not saved). Only in
   *  DEMO does it ask them again: otherwise the saved ledger is what the sweep keeps, and the panel opens without waiting */
  async read(src: WorkLogSources): Promise<WorkLogRead> {
    const now = this.now();
    // a remote round in the background, at most once a minute: the DEMO state it finds is what the next read shows
    if (now - this.remoteAt >= 60_000) { this.remoteAt = now; this.sweep(src, true).catch(() => {}); }
    let ledger = this.ledger, demo = this.demo;
    if (demo) {
      const [jira, prs] = await Promise.all([src.jira().catch(() => null), src.prs().catch(() => null)]);
      demo = !!jira?.demo && !!prs?.demo;
      if (demo) {
        ledger = emptyLedger();
        mergeTasks(ledger, jira!.tareas, now); mergePRs(ledger, prs!.prs, now);
        const w = src.worktrees(); mergeWorktrees(ledger, w.live, w.rooms, now); mergeConversations(ledger, src.sessions(), now);
        mergeReviews(ledger, src.reviews() ?? [], now);
      }
    }
    const { source, file, ladder, errors } = this.ladder();
    return { ledger, demo, ladder: { source, file, local: this.ladderFile, errors }, career: evaluate(ladder, ledger, now), ...(source === 'local' ? { progress: this.progress() } : {}) };
  }

  /** The last verification, as the Overseer's file holds it */
  progress(): LadderProgress | undefined {
    try { return progressOf(JSON.parse(readFileSync(this.ladderFile, 'utf8'))); } catch { return undefined; }
  }

  /** The first message of a ladder verification (the Overseer asks for it): the ladder with each requirement's state by
   *  the rules, the accepted medals, and the work since the last verification (90 days the first time) */
  verifyPrompt(): string {
    this.ensureLadder();
    const now = this.now(), { ladder, errors } = this.ladder(), l = this.ledger;
    if (!ladder.steps.length) throw new Error(errors[0] ?? t('trophies.error.empty'));
    const career = evaluate(ladder, l, now), trophy = new Map(career.trophies.map(x => [x.rule.id, x]));
    const steps = career.steps.map(st => [`## ${st.step.id} · ${fileText(st.step.name)}`, ...st.requirements.map(q => {
      // its awards against its levels, then each measured trophy it lists with its count and facts
      const levels = Object.entries(q.req.levels ?? {}).map(([k, n]) => `${k} ${n}`).join(', ');
      const measured = q.req.trophies.map(id => trophy.get(id)).filter(x => x && x.rule.kind !== 'awards').map(x => `${x!.rule.id} ${x!.count}/${x!.rule.n}${x!.earnedAt ? ' ✔' : ''}${x!.facts.length ? ' (' + x!.facts.slice(-5).map(f => f.url ?? f.ref).join(', ') + ')' : ''}`);
      const rules = [`${q.count} awards (${levels})${q.level ? ' → ' + q.level : ''}`, ...measured, ...q.medals.map(m => `🏅 ${m.evidence[0]}`)];
      return `- ${q.req.id}: ${fileText(q.req.text)} — ${q.measured ? t('prompt.ladderVerify.byRules', { estado: q.met ? 'met' : q.progress > 0 ? 'partial' : 'not-met', reglas: rules.join('; ') }) : t('prompt.ladderVerify.yours')}${q.req.evidence ? ' — ' + fileText(q.req.evidence) : ''}`;
    })].join('\n')).join('\n\n');
    const since = this.progress()?.at ?? now - 90 * 864e5;
    const medals = Object.values(l.medals).filter(m => m.state === 'accepted').map(m => `- ${m.award ?? m.requirement}: ${m.text} (${m.evidence.join(', ')})`).join('\n');
    const conversations = Object.values(l.conversations).filter(c => c.last >= since).sort((a, b) => b.last - a.last).slice(0, 80)
      .map(c => `- ${c.task} · ${c.roomId} · «${c.title}» · claudeId ${c.claudeId} · ${c.cwd}`).join('\n');
    return t('prompt.ladderVerify', { escalera: steps, medallas: medals || '—', log: syncText(logRows(l, since)) || '—', conversaciones: conversations || '—', archivo: this.ladderFile });
  }

  /** «Draft my career ladder»: the first message of a plan-mode conversation that asks the Overseer for their
   *  instructions and proposes the ladder file as a plan; the game writes nothing */
  draftPrompt(): string {
    return t('prompt.ladderDraft', { archivo: this.ladderFile, ejemplo: this.exampleFile, existe: existsSync(this.ladderFile) ? t('prompt.ladderDraft.exists') : '' });
  }

  /** The session's report (ladder_progress), settled by the rules and written as the file's "progress" key only */
  recordProgress(report: SessionReport): { ok: true; progress: LadderProgress; overridden: string[]; unproven: string[] } | { ok: false; error: string } {
    let text: string;
    try { text = readFileSync(this.ladderFile, 'utf8'); JSON.parse(text); } catch (e) { return { ok: false, error: t('trophies.error.json', { error: String((e as Error).message).slice(0, 120) }) }; }
    const { ladder } = parseLadder(text);
    const r = settleProgress(ladder, evaluate(ladder, this.ledger, this.now()), report, this.now());
    const tmp = this.ladderFile + '.tmp'; writeFileSync(tmp, withProgress(text, r.progress)); renameSync(tmp, this.ladderFile);
    return { ok: true, ...r };
  }
}
