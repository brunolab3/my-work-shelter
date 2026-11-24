// Trophies and the career ladder, derived from the work log's ledger (shared/workLog.ts) on every read, never saved.
// The ladder file (the Overseer's DATOS/escalera.json, else docs/ladder.example.json; read by server/workLog.ts)
// defines the awards (medal kinds, `kind: awards`), the measured trophies (a built-in kind with a threshold and
// filters) and the steps. Each requirement is a vertical's trophy: it counts awards (accepted medals of the awards it
// lists or that name it, and the trophies it lists once earned, another requirement's included) and reaches the
// levels its file sets (bronze, silver, gold: how many awards each needs); it is won at its lowest level.
// Pure: used by the client, the server and the tests.
import { language, t } from './language.ts';
import type { Ledger, Medal } from './workLog.ts';

export const TROPHY_KINDS = ['prsMerged', 'tasksDone', 'reviewsGiven', 'multiRepoTasks', 'verifiedInProd', 'awards'] as const;
export type TrophyKind = typeof TROPHY_KINDS[number];
/** The file's own text: a plain string or one per language */
export type FileText = string | { es?: string; en?: string };
export const fileText = (x: FileText | undefined): string => (typeof x === 'string' ? x : x ? (language() === 'en' ? x.en ?? x.es : x.es ?? x.en) ?? '' : '');

export interface TrophyRule {
  id: string; name: FileText; description?: FileText; kind: TrophyKind; n: number;
  within?: number;                       // days: n facts inside that many days
  since?: number;                        // only facts from that date (ms)
  project?: string; issueType?: string;  // only tasks of that Jira project (key prefix) or issue type
  repos?: number;                        // multiRepoTasks: at least this many repos (2 by default)
  requirement?: string;                  // awards: the ladder requirement it belongs to (medals of old files name it)
  evidence?: FileText;                   // awards: what the Friday digest looks for (else its requirement's)
  sources?: AwardSource[];               // awards: where its evidence may come from (DEFAULT_SOURCES if none)
}
/** Where an award's evidence comes from: the Overseer's PRs on GitHub, their own Slack (through their Slack connector,
 *  only once one is authorized), the week's work log and conversations, or entered by hand by the Overseer */
export const AWARD_SOURCES = ['github', 'slack', 'digest', 'manual'] as const;
export type AwardSource = typeof AWARD_SOURCES[number];
export const DEFAULT_SOURCES: AwardSource[] = ['github', 'digest', 'manual'];
/** An award: a trophy of kind `awards`, filled by medals proposed for it with evidence from one of its sources */
export interface Award { id: string; name: FileText; requirement?: string; evidence: FileText; sources: AwardSource[] }
/** A vertical trophy's levels: how many awards each needs (set per trophy in the file; any of them may be left out) */
export const LEVELS = ['bronze', 'silver', 'gold'] as const;
export type Level = typeof LEVELS[number];
export type Levels = Partial<Record<Level, number>>;
/** A requirement is its vertical's trophy. `trophies`: the awards, measured trophies and other requirements that count
 *  toward it by rule (any award whose `requirement` names it counts too); `levels`: none, judged by people.
 *  `evidence`: what the Friday digest looks for, for the awards that belong to it and say none of their own */
export interface Requirement { id: string; text: FileText; trophies: string[]; levels?: Levels; evidence?: FileText }
export interface Step { id: string; name: FileText; requirements: Requirement[] }
/** `digestRoom`: the room whose dweller runs the Friday digest (Planning by default; Logistics or Communications) */
export const DIGEST_ROOMS = ['logistics', 'tareas', 'comms'] as const;
export interface Ladder { trophies: TrophyRule[]; steps: Step[]; digestRoom: typeof DIGEST_ROOMS[number] }

/** The ladder in a file's text, with what is wrong in it (each a line for the panel; bad parts are left out) */
export function parseLadder(text: string): { ladder: Ladder; errors: string[] } {
  const errors: string[] = [], ladder: Ladder = { trophies: [], steps: [], digestRoom: 'logistics' };
  let j: any;
  try { j = JSON.parse(text); } catch (e) { return { ladder, errors: [t('trophies.error.json', { error: String((e as Error).message).slice(0, 120) })] }; }
  if (j?.digestRoom != null) { if (DIGEST_ROOMS.includes(j.digestRoom)) ladder.digestRoom = j.digestRoom; else errors.push(t('trophies.error.digestRoom', { room: String(j.digestRoom), rooms: DIGEST_ROOMS.join(', ') })); }
  const isText = (x: unknown): x is FileText => typeof x === 'string' ? !!x.trim() : !!x && typeof x === 'object' && ['es', 'en'].some(k => typeof (x as any)[k] === 'string');
  for (const [i, r] of (Array.isArray(j?.trophies) ? j.trophies : []).entries()) {
    const id = typeof r?.id === 'string' && r.id.trim() ? r.id.trim() : '';
    const bad = (what: string) => errors.push(t('trophies.error.trophy', { id: id || `#${i + 1}`, what: what }));
    if (!id) { bad('id'); continue; }
    if (ladder.trophies.some(x => x.id === id)) { bad(t('trophies.error.repeated')); continue; }
    if (!TROPHY_KINDS.includes(r.kind)) { bad(t('trophies.error.kind', { kind: String(r.kind), kinds: TROPHY_KINDS.join(', ') })); continue; }
    const n = Number(r.n ?? 1);
    if (!Number.isInteger(n) || n < 1) { bad('n'); continue; }
    const within = r.within == null ? undefined : /^(\d+)d$/.exec(String(r.within))?.[1];
    if (r.within != null && !within) { bad('within'); continue; }
    const since = r.since == null ? undefined : Date.parse(String(r.since));
    if (since !== undefined && Number.isNaN(since)) { bad('since'); continue; }
    ladder.trophies.push({
      id, name: isText(r.name) ? r.name : id, kind: r.kind, n, ...(isText(r.description) ? { description: r.description } : {}),
      ...(within ? { within: Number(within) } : {}), ...(since !== undefined ? { since } : {}),
      ...(typeof r.project === 'string' ? { project: r.project.toUpperCase() } : {}), ...(typeof r.issueType === 'string' ? { issueType: r.issueType } : {}),
      ...(Number.isInteger(r.repos) && r.repos > 1 ? { repos: r.repos } : {}),
      ...(r.kind === 'awards' ? {
        ...(typeof r.requirement === 'string' && r.requirement.trim() ? { requirement: r.requirement.trim() } : {}),
        ...(isText(r.evidence) ? { evidence: r.evidence } : {}),
        ...(Array.isArray(r.sources) ? { sources: [...new Set(r.sources.filter((x: unknown): x is AwardSource => AWARD_SOURCES.includes(x as AwardSource)))] as AwardSource[] } : {}),
      } : {}),
    });
    if (Array.isArray(r.sources) && r.sources.some((x: unknown) => !AWARD_SOURCES.includes(x as AwardSource))) bad(t('trophies.error.sources', { sources: AWARD_SOURCES.join(', ') }));
  }
  const reqIds = new Set<string>((Array.isArray(j?.steps) ? j.steps : []).flatMap((s: any) => Array.isArray(s?.requirements) ? s.requirements : []).map((q: any) => typeof q?.id === 'string' ? q.id.trim() : '').filter(Boolean));
  const known = new Set([...ladder.trophies.map(x => x.id), ...reqIds]);
  for (const [i, s] of (Array.isArray(j?.steps) ? j.steps : []).entries()) {
    const id = typeof s?.id === 'string' && s.id.trim() ? s.id.trim() : `#${i + 1}`;
    const requirements: Requirement[] = [];
    for (const [k, q] of (Array.isArray(s?.requirements) ? s.requirements : []).entries()) {
      const rid = typeof q?.id === 'string' && q.id.trim() ? q.id.trim() : `${id}.${k + 1}`;
      const list: string[] = (Array.isArray(q?.trophies) ? q.trophies : []).filter((x: unknown): x is string => typeof x === 'string');
      for (const x of list.filter(x => !known.has(x))) errors.push(t('trophies.error.unknownTrophy', { req: rid, id: x }));
      const trophies = list.filter(x => known.has(x) && x !== rid);
      // levels: increasing whole counts; a file from before levels gets one, gold, where its old `mode` was met
      let levels: Levels | undefined;
      if (q?.levels != null) {
        const given = LEVELS.filter(k => q.levels?.[k] != null).map(k => [k, Number(q.levels[k])] as const);
        if (given.length && given.every(([, n], k) => Number.isInteger(n) && n >= 1 && (!k || n > given[k - 1][1]))) levels = Object.fromEntries(given);
        else errors.push(t('trophies.error.levels', { req: rid }));
      } else if (trophies.length) levels = { gold: q?.mode === 'any' ? 1 : trophies.length };
      requirements.push({ id: rid, text: isText(q?.text) ? q.text : rid, trophies, ...(levels ? { levels } : {}), ...(isText(q?.evidence) ? { evidence: q.evidence } : {}) });
    }
    ladder.steps.push({ id, name: isText(s?.name) ? s.name : id, requirements });
  }
  // an award says what evidence to look for, itself or through its requirement
  const withEvidence = new Set(medalRequirements(ladder).map(q => q.id));
  const looksFor = (x: TrophyRule) => x.kind !== 'awards' || !!x.evidence || withEvidence.has(x.requirement ?? '');
  for (const x of ladder.trophies.filter(x => !looksFor(x))) errors.push(t('trophies.error.awards', { id: x.id, req: x.requirement || '—' }));
  ladder.trophies = ladder.trophies.filter(looksFor);
  if (!ladder.trophies.length && !errors.length) errors.push(t('trophies.error.empty'));
  return { ladder, errors };
}

/** A fact that counts toward a trophy: when it happened and what it is (a task key or a PR ref) */
export interface TrophyFact { at: number; ref: string; url?: string }

/** The facts of a rule's kind that pass its filters, oldest first */
export function trophyFacts(l: Ledger, r: TrophyRule): TrophyFact[] {
  const project = (key?: string) => !r.project || (key ?? '').toUpperCase().startsWith(r.project + '-');
  const type = (key?: string) => !r.issueType || (!!key && l.tasks[key.toUpperCase()]?.type?.toLowerCase() === r.issueType.toLowerCase());
  const ok = (key?: string) => project(key) && type(key);
  let out: TrophyFact[] = [];
  const tasks = Object.values(l.tasks);
  switch (r.kind) {
    case 'prsMerged': out = Object.values(l.prs).filter(p => p.mergedAt && ok(p.task)).map(p => ({ at: p.mergedAt!, ref: `${p.repo}#${p.number}`, url: p.url })); break;
    case 'tasksDone': out = tasks.filter(x => x.doneAt && ok(x.key)).map(x => ({ at: x.doneAt!, ref: x.key, url: x.url })); break;
    case 'reviewsGiven': out = Object.values(l.reviews).filter(x => (!r.project && !r.issueType) || ok(x.task)).map(x => ({ at: x.at, ref: `${x.repo}#${x.ref.split('#').pop()}`, url: x.url })); break;
    case 'multiRepoTasks': {
      const repos = new Map<string, Set<string>>();
      for (const p of Object.values(l.prs)) if (p.state !== 'closed') { const s = repos.get(p.task) ?? new Set(); s.add(p.repo.toLowerCase()); repos.set(p.task, s); }
      out = tasks.filter(x => x.doneAt && ok(x.key) && (repos.get(x.key)?.size ?? 0) >= (r.repos ?? 2)).map(x => ({ at: x.doneAt!, ref: x.key, url: x.url }));
      break;
    }
    case 'verifiedInProd': out = tasks.filter(x => x.verifiedAt && ok(x.key)).map(x => ({ at: x.verifiedAt!, ref: x.key, url: x.url })); break;
    // a medal for this award (old ones, from before awards had their own medals: by requirement)
    case 'awards': out = Object.values(l.medals ?? {}).filter(m => m.state === 'accepted' && (m.award ? m.award === r.id : m.requirement === r.requirement)).map(m => ({ at: m.decidedAt ?? m.proposedAt, ref: m.text.slice(0, 40), url: m.evidence[0] })); break;
  }
  return out.filter(f => r.since === undefined || f.at >= r.since).sort((a, b) => a.at - b.at);
}

export interface TrophyState {
  rule: TrophyRule;
  count: number;          // facts that count now (inside its window, if it has one)
  progress: number;       // 0..1 (1 once earned)
  earnedAt?: number;      // when the n-th fact came (inside one window): earned stays earned
  facts: TrophyFact[];    // those that earned it, or the ones counting so far
}
export function trophyState(l: Ledger, r: TrophyRule, now: number): TrophyState {
  const all = trophyFacts(l, r), win = r.within ? r.within * 864e5 : Infinity;
  let earnedAt: number | undefined, facts = all;
  for (let i = r.n - 1; i < all.length && earnedAt === undefined; i++) {
    if (all[i].at - all[i - r.n + 1].at <= win) { earnedAt = all[i].at; facts = all.slice(i - r.n + 1, i + 1); }
  }
  const counting = earnedAt !== undefined ? facts : all.filter(f => now - f.at <= win);
  return { rule: r, count: counting.length, progress: earnedAt !== undefined ? 1 : Math.min(counting.length / r.n, 0.99), ...(earnedAt !== undefined ? { earnedAt } : {}), facts: counting };
}

/** A requirement as its vertical's trophy: the awards it counts (`medals` accepted, `won` trophies), its level and
 *  the next one. `met`: won (its lowest level reached); `progress`: toward its top level */
export interface RequirementState {
  req: Requirement; progress: number; met: boolean; measured: boolean;
  count: number; level?: Level; next?: { level: Level; n: number }; wonAt?: number;
  medals: Medal[]; won: string[]; facts: TrophyFact[];
}
export interface StepState { step: Step; requirements: RequirementState[]; progress: number; complete: boolean }
/** `verticals`: each measured requirement once, as its trophy; `ready`: the last step of an unbroken run from the first
 *  whose trophies are all won (ready to ask for it) */
export interface CareerState { trophies: TrophyState[]; verticals: RequirementState[]; steps: StepState[]; current?: string; ready?: string }

/** Every trophy and every step of the ladder with its progress; `current`: the first step not yet complete */
export function evaluate(ladder: Ladder, l: Ledger, now: number): CareerState {
  const trophies = ladder.trophies.map(r => trophyState(l, r, now));
  const by = new Map(trophies.map(x => [x.rule.id, x]));
  const reqs = new Map<string, Requirement>();
  for (const s of ladder.steps) for (const q of s.requirements) if (!reqs.has(q.id)) reqs.set(q.id, q);
  const accepted = Object.values(l.medals ?? {}).filter(m => m.state === 'accepted');
  const done = new Map<string, RequirementState>(), visiting = new Set<string>();
  const vertical = (q: Requirement): RequirementState | undefined => {
    if (done.has(q.id)) return done.get(q.id);
    if (visiting.has(q.id)) return undefined;   // a ring of requirements counting each other: the inner one doesn't count
    visiting.add(q.id);
    let st: RequirementState = { req: q, progress: 0, met: false, measured: false, count: 0, medals: [], won: [], facts: [] };
    if (q.levels) {
      // the awards that count: those it lists, and any whose requirement is this one (old medals name only that)
      const awards = new Set(ladder.trophies.filter(x => x.kind === 'awards' && (q.trophies.includes(x.id) || x.requirement === q.id)).map(x => x.id));
      const medals = accepted.filter(m => (m.award ? awards.has(m.award) : m.requirement === q.id));
      const won: { id: string; at: number }[] = [];
      let partial = 0;   // measured trophies on their way fill the cup a little, without counting as awards yet
      for (const id of q.trophies) {
        const x = by.get(id);
        if (x) { if (x.rule.kind !== 'awards') { if (x.earnedAt !== undefined) won.push({ id, at: x.earnedAt }); else partial += x.progress; } continue; }
        const other = reqs.get(id), o = other && vertical(other);
        if (o?.wonAt !== undefined) won.push({ id, at: o.wonAt });
      }
      const facts: TrophyFact[] = [
        ...medals.map(m => ({ at: m.decidedAt ?? m.proposedAt, ref: m.text.slice(0, 40), ...(m.evidence[0] ? { url: m.evidence[0] } : {}) })),
        ...won.map(w => ({ at: w.at, ref: fileText(by.get(w.id)?.rule.name ?? reqs.get(w.id)?.text) || w.id })),
      ].sort((a, b) => a.at - b.at);
      const steps = LEVELS.filter(k => q.levels![k] !== undefined).map(k => ({ level: k, n: q.levels![k]! }));
      const count = facts.length, reached = steps.filter(x => count >= x.n), top = steps[steps.length - 1].n;
      const level = reached[reached.length - 1]?.level, next = steps.find(x => count < x.n);
      st = { ...st, measured: true, count, progress: next ? Math.min((count + partial) / top, 0.99) : 1, met: !!level, ...(level ? { level, wonAt: facts[steps[0].n - 1].at } : {}), ...(next ? { next } : {}), medals, won: won.map(w => w.id), facts };
    }
    visiting.delete(q.id); done.set(q.id, st);
    return st;
  };
  const steps = ladder.steps.map((step): StepState => {
    const requirements = step.requirements.map(q => vertical(q)!);
    const measured = requirements.filter(r => r.measured);
    const progress = measured.length ? measured.filter(r => r.met).length / measured.length : 0;
    return { step, requirements, progress, complete: measured.length > 0 && measured.every(r => r.met) };
  });
  let ready: string | undefined;
  for (const s of steps) { if (s.complete) ready = s.step.id; else break; }
  return { trophies, verticals: [...done.values()].filter(x => x.measured), steps, current: steps.find(s => !s.complete)?.step.id, ...(ready ? { ready } : {}) };
}

/** The requirements with `evidence` (what their awards look for when they say none), unique by id */
export function medalRequirements(ladder: Ladder): Requirement[] {
  const out = new Map<string, Requirement>();
  for (const s of ladder.steps) for (const q of s.requirements) if (q.evidence && !out.has(q.id)) out.set(q.id, q);
  return [...out.values()];
}

/** The ladder's awards, each with what to look for and its sources */
export function awardsOf(ladder: Ladder): Award[] {
  const reqs = new Map(medalRequirements(ladder).map(q => [q.id, q]));
  return ladder.trophies.filter(x => x.kind === 'awards').map(x => ({
    id: x.id, name: x.name, ...(x.requirement ? { requirement: x.requirement } : {}),
    evidence: x.evidence ?? reqs.get(x.requirement ?? '')?.evidence ?? '', sources: x.sources?.length ? x.sources : DEFAULT_SOURCES,
  }));
}

/** The Friday digest is due: the last Friday 09:00 (local time) came after the last one started. The first time
 *  (`last` undefined) it isn't: it starts on the next Friday, not on the day this shipped */
export function digestDue(last: number | undefined, now: number): boolean {
  if (last === undefined) return false;
  const d = new Date(now); d.setHours(9, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - 5 + 7) % 7));   // back to Friday
  if (d.getTime() > now) d.setDate(d.getDate() - 7);
  return d.getTime() > last;
}

/** Trophies earned and levels reached not yet announced: a measured trophy by its id, a vertical's level as `id@level`
 *  (awards are medals, accepted by the Overseer: not announced) */
export function newlyEarned(c: CareerState, notified: string[]): { key: string; name: string }[] {
  return [
    ...c.trophies.filter(x => x.rule.kind !== 'awards' && x.earnedAt !== undefined).map(x => ({ key: x.rule.id, name: fileText(x.rule.name) })),
    ...c.verticals.filter(x => x.level).map(x => ({ key: `${x.req.id}@${x.level}`, name: `${fileText(x.req.text)} (${t(`trophies.level.${x.level}`)})` })),
  ].filter(x => !notified.includes(x.key));
}

// ---------------------------------------------------------------- the ladder's verification (asked by the Overseer)
// A session checks each requirement against the work and reports with ladder_progress; the game settles it here and
// writes only the file's "progress" key. The trophy rules are the source of truth: where a requirement has trophies,
// its verdict is theirs (the session's is overridden); the session judges only those no trophy measures, with evidence.
export type Verdict = 'met' | 'partial' | 'not-met';
export const VERDICTS: Verdict[] = ['met', 'partial', 'not-met'];
export interface RequirementProgress { verdict: Verdict; evidence: string[]; notes?: string; byRules: boolean }
export interface LadderProgress { at: number; level?: string; summary?: string; requirements: Record<string, RequirementProgress> }
export interface SessionReport { level?: string; summary?: string; requirements: { id: string; verdict: string; evidence?: string[]; notes?: string }[] }

/** The verification as the game keeps it: the rules' verdicts, the session's for the rest, and the level reached (the
 *  last step of an unbroken run from the first whose requirements are all met). `overridden`: where the session
 *  disagreed with the rules; `unproven`: what it called met or partial without evidence (kept as not met) */
export function settleProgress(ladder: Ladder, career: CareerState, report: SessionReport, now: number): { progress: LadderProgress; overridden: string[]; unproven: string[] } {
  const said = new Map(report.requirements.map(r => [r.id.trim(), r]));
  const trophy = new Map(career.trophies.map(x => [x.rule.id, x]));
  const requirements: Record<string, RequirementProgress> = {}, overridden: string[] = [], unproven: string[] = [];
  for (const st of career.steps) for (const q of st.requirements) {
    if (requirements[q.req.id]) continue;
    const s = said.get(q.req.id), evidence = [...new Set((s?.evidence ?? []).map(x => x.trim()).filter(Boolean))];
    const notes = s?.notes?.trim() || undefined;
    if (q.measured) {
      const verdict: Verdict = q.met ? 'met' : q.progress > 0 ? 'partial' : 'not-met';
      if (s && s.verdict !== verdict) overridden.push(q.req.id);
      const facts = [...q.medals.map(m => m.evidence[0]), ...q.won.flatMap(id => trophy.get(id)?.facts.map(f => f.url ?? f.ref) ?? [])].filter(Boolean);
      requirements[q.req.id] = { verdict, evidence: [...new Set([...facts, ...evidence])].slice(0, 12), ...(notes ? { notes } : {}), byRules: true };
    } else {
      let verdict: Verdict = VERDICTS.includes(s?.verdict as Verdict) ? s!.verdict as Verdict : 'not-met';
      if (verdict !== 'not-met' && !evidence.length) { unproven.push(q.req.id); verdict = 'not-met'; }
      requirements[q.req.id] = { verdict, evidence: evidence.slice(0, 12), ...(notes ? { notes } : {}), byRules: false };
    }
  }
  let level: string | undefined;
  for (const s of ladder.steps) { if (s.requirements.length && s.requirements.every(q => requirements[q.id]?.verdict === 'met')) level = s.id; else break; }
  return { progress: { at: now, ...(level ? { level } : {}), ...(report.summary?.trim() ? { summary: report.summary.trim().slice(0, 600) } : {}), requirements }, overridden, unproven };
}

/** The "progress" key as read back from the file (a broken one is none) */
export function progressOf(j: any): LadderProgress | undefined {
  const p = j?.progress;
  if (!p || typeof p !== 'object' || typeof p.at !== 'number' || !p.requirements || typeof p.requirements !== 'object') return undefined;
  return p as LadderProgress;
}
/** The file's text with only its "progress" key set (every other key kept as it was, in its order; the file's indent) */
export function withProgress(text: string, progress: LadderProgress): string {
  const j = JSON.parse(text);
  const indent = /^\{\r?\n(\t| +)"/.exec(text)?.[1] ?? '  ';
  return JSON.stringify({ ...j, progress }, null, indent) + '\n';
}
