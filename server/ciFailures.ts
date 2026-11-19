// La CI que falla en tus PR, a la sala que los trabaja: cada minuto (con GitHub conectado) se miran los checks del
// último commit de tus PR abiertos y, cuando uno pasa a fallar (FAILURE o ERROR) en su cabeza actual, se manda UN
// mensaje a la conversación del worktree de ese PR, como las revisiones (prReviews.ts: sessionOfPR, worktreeOfPR):
// el PR, el commit, los checks que fallan con su enlace y la cola del log de lo que falló (`gh run view --log-failed`).
// Una tarea puede tener PR en varios repos con bloqueos entre ellos (shared/deploy.ts): el mensaje lleva la clave
// de la tarea y los PR que esperan al que falla («bloquea: org/b#12»); esos no fallan por ello y no reciben nada.
// Una vez por PR y commit (DATOS/fallos-ci.json). La primera vez solo se apunta lo que ya fallaba: no llega de golpe
// la CI rota de antes de existir esto; un PR nuevo, o un commit nuevo, que falla, sí.
// Solo lectura hacia GitHub: el habitante propone un plan y el Supervisor lo aprueba antes de tocar nada.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { SessionSummary } from '../shared/protocol.ts';
import type { PRBoard } from '../shared/board.ts';
import { dependenciesInText, pRKey, refPR, type Blocker } from '../shared/deploy.ts';
import { t } from '../shared/language.ts';
import type { CICheck } from '../shared/preflight.ts';
import { sessionOfPR, worktreeOfPR, type RoomPR } from './prReviews.ts';

export interface FailedCheck { name: string; url: string; run?: number }
export interface PRWithCI extends PRBoard { failures: FailedCheck[]; all: CICheck[] }

export const CI_QUERY = `query {
  prs: search(query: "is:pr is:open author:@me archived:false sort:updated-desc", type: ISSUE, first: 50) { nodes { ... on PullRequest {
    number title body url isDraft state updatedAt reviewDecision headRefName headRefOid baseRefName repository { nameWithOwner }
    commits(last: 1) { nodes { commit { oid statusCheckRollup { state contexts(first: 60) { nodes {
      __typename
      ... on CheckRun { name conclusion detailsUrl checkSuite { workflowRun { databaseId } } }
      ... on StatusContext { context state targetUrl }
    } } } } } }
  } } }
}`;

const FAILING = new Set(['FAILURE', 'ERROR']);
const RUN_FAILED = new Set(['FAILURE', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED']);
const RUN_OK = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const WORST: Record<CICheck['state'], number> = { ok: 0, pendiente: 1, mal: 2 };
/** A check run for the pre-flight: a cancelled one doesn't pass (it gets no CI message either: it's often superseded),
 *  a stale one is waiting */
const checkRunState = (conclusion?: string): CICheck['state'] => !conclusion ? 'pendiente' : RUN_FAILED.has(conclusion) || conclusion === 'CANCELLED' ? 'mal' : RUN_OK.has(conclusion) ? 'ok' : 'pendiente';
/** El id de la ejecución de Actions de un enlace (…/actions/runs/123/job/456) */
export const runOfUrl = (url: string) => { const m = /\/actions\/runs\/(\d+)/.exec(url); return m ? Number(m[1]) : undefined; };

/** Tus PR abiertos con el estado de su CI y, si falla, qué checks */
export function ciOfGitHub(j: any): PRWithCI[] {
  return (j?.data?.prs?.nodes ?? []).filter((n: any) => n?.number).map((n: any): PRWithCI => {
    const commit = n.commits?.nodes?.[0]?.commit;
    const failures: FailedCheck[] = [], all: CICheck[] = [];
    for (const c of commit?.statusCheckRollup?.contexts?.nodes ?? []) {
      // todos, para el pre-flight (cada check, una línea): bien, mal o aún en marcha
      const r = c?.__typename === 'CheckRun' ? checkRunState(c.conclusion) : c?.__typename === 'StatusContext' ? (FAILING.has(c.state) ? 'mal' : c.state === 'SUCCESS' ? 'ok' : 'pendiente') : undefined;
      const name = String(c?.name ?? c?.context ?? '');
      // two checks with the same name (one per workflow): the worst one shows
      const already = all.find(x => x.name === name);
      if (r && name && !already) all.push({ name, state: r });
      else if (r && already && WORST[r] > WORST[already.state]) already.state = r;
      if (c?.__typename === 'CheckRun' && RUN_FAILED.has(c.conclusion)) {
        const url = String(c.detailsUrl ?? n.url);
        failures.push({ name: String(c.name ?? '?'), url, run: Number(c.checkSuite?.workflowRun?.databaseId) || runOfUrl(url) });
      } else if (c?.__typename === 'StatusContext' && FAILING.has(c.state)) failures.push({ name: String(c.context ?? '?'), url: String(c.targetUrl ?? n.url) });
    }
    const repo = n.repository?.nameWithOwner ?? '';
    return {
      number: n.number, title: n.title ?? '', url: n.url ?? '', repo, branch: n.headRefName ?? '',
      state: n.isDraft ? 'borrador' : 'abierto', review: n.reviewDecision ?? undefined,
      checks: commit?.statusCheckRollup?.state ?? undefined, updated: Date.parse(n.updatedAt ?? '') || 0,
      base: n.baseRefName ?? undefined, head: n.headRefOid ?? commit?.oid ?? undefined,
      dependencies: dependenciesInText(`${n.title ?? ''}\n${n.body ?? ''}`, repo), failures, all,
    };
  });
}

/** PR y commit: cada fallo de CI se entrega una vez */
export const failureId = (p: Pick<PRBoard, 'repo' | 'number' | 'head'>) => `${refPR(p)}@${p.head ?? ''}`;
export const isFailing = (p: PRBoard) => !!p.head && FAILING.has(p.checks ?? '');

/** Los PR que pasan a fallar: su CI falla en su cabeza y ese (PR, commit) no se ha entregado aún */
export function newFailures(prs: PRWithCI[], delivered: Set<string>): PRWithCI[] {
  return prs.filter(p => isFailing(p) && !delivered.has(failureId(p)));
}

/** Los PR (abiertos) que esperan al que falla: directa o indirectamente, como «org/repo#N» */
export function blockedBy(pr: PRBoard, prs: PRBoard[], blockers: Blocker[]): string[] {
  const byUrl = new Map(prs.map(p => [p.url, p]));
  const out: string[] = [], seen = new Set([pr.url]);
  const tail = [pr.url];
  while (tail.length) {
    const by = tail.shift()!;
    for (const b of blockers) if (b.by === by && !seen.has(b.from)) {
      seen.add(b.from); tail.push(b.from);
      const q = byUrl.get(b.from);
      if (q && (q.state === 'abierto' || q.state === 'borrador')) out.push(refPR(q));
    }
  }
  return out;
}

const MAX_LOG = 4000, MAX_LINES = 80, MAX_CHECKS = 12;
/** La cola de un log, sin códigos de color ni la marca de tiempo de cada línea de Actions y con un tope */
export function logTail(log: string): string {
  const lines = log.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map(l => l.replace(/^(\S+\t\S+\t)?\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '$1').trimEnd()).filter(Boolean);
  let out = lines.slice(-MAX_LINES).join('\n');
  if (out.length > MAX_LOG) out = '…' + out.slice(-MAX_LOG);
  return out;
}

/** El mensaje para el habitante: qué falla, a quién bloquea y que proponga un plan antes de tocar nada */
export function ciMessage(pr: PRWithCI, blocks: string[], log?: string): string {
  const key = pRKey(pr);
  return [
    t('prompt.ci.title', { clave: key ? `[${key}] ` : '', numero: pr.number, repo: pr.repo, titulo: pr.title, rama: pr.branch, commit: (pr.head ?? '').slice(0, 10), url: pr.url }),
    '',
    ...(pr.failures.length ? pr.failures.slice(0, MAX_CHECKS).map(f => `- **${f.name}**: ${f.url}`) : [t('prompt.ci.noDetail')]),
    ...(pr.failures.length > MAX_CHECKS ? [t('prompt.review.more', { n: pr.failures.length - MAX_CHECKS })] : []),
    ...(blocks.length ? ['', t('prompt.ci.blocks', { prs: blocks.join(', ') })] : []),
    ...(log ? ['', t('prompt.ci.log'), '```', log.replace(/```/g, "'''"), '```'] : []),
    '',
    t('prompt.ci.ask'),
  ].join('\n');
}

export interface CtxCI {
  connection(): Promise<{ real: boolean; token?: string }>;
  query(token?: string): Promise<any>;                         // el JSON de CI_QUERY
  log(repo: string, run: number, token?: string): Promise<string>;  // `gh run view <run> --log-failed`
  blockers(prs: PRBoard[]): Promise<Blocker[]>;                     // los del tablero de despliegue (manuales y del plan incluidos)
  rooms(): Promise<RoomPR[]>;
  sessions(): SessionSummary[];
  notify(sessionId: string, text: string): boolean;
  open(roomId: string, cwd: string, text: string): Promise<boolean>;
  delivered(roomId: string, worktree: string, pr: PRWithCI, blocks: string[]): void;   // robot mensajero y aviso
  withoutConversation(text: string): void;
}

export class CIFailures {
  private started = false;
  private delivered: string[] = [];
  private notified = new Set<string>();
  private file: string;
  constructor(dir: string, private ctx: CtxCI) {
    this.file = path.join(dir, 'fallos-ci.json');
    try { if (existsSync(this.file)) { const j = JSON.parse(readFileSync(this.file, 'utf8')); this.started = !!j.started; this.delivered = Array.isArray(j.delivered) ? j.delivered.filter((x: unknown) => typeof x === 'string') : []; } } catch {}
  }
  private save() { const tmp = this.file + '.tmp'; writeFileSync(tmp, JSON.stringify({ started: this.started, delivered: this.delivered.slice(-2000) }), { mode: 0o600 }); renameSync(tmp, this.file); }

  private checks = new Map<string, CICheck[]>();   // los de cada PR abierto, de la última vuelta: los lista el pre-flight
  checksOf(url: string): CICheck[] | undefined { return this.checks.get(url); }

  // one round at a time: a slow one (logs, opening conversations) must not overlap the next and deliver twice
  private inProgress?: Promise<void>;
  poll() { return this.inProgress ??= this.round().finally(() => { this.inProgress = undefined; }); }
  private logs = new Map<string, string | undefined>();   // failed-run log tail per failure, fetched once while it retries

  private async round() {
    const c = await this.ctx.connection();
    if (!c.real) return;
    const prs = ciOfGitHub(await this.ctx.query(c.token));
    this.checks = new Map(prs.map(p => [p.url, p.all]));
    const fresh = newFailures(prs, new Set(this.delivered));
    // la primera vez, lo que ya fallaba se da por visto
    if (!this.started) { this.started = true; this.delivered.push(...fresh.map(failureId)); this.save(); return; }
    const pending = new Set(fresh.map(failureId));
    for (const k of this.logs.keys()) if (!pending.has(k)) this.logs.delete(k);
    if (!fresh.length) return;
    const blockers = await this.ctx.blockers(prs).catch(() => [] as Blocker[]);
    const rooms = await this.ctx.rooms(), sessions = this.ctx.sessions();
    let changed = false;
    for (const pr of fresh) {
      const blocks = blockedBy(pr, prs, blockers);
      const k = failureId(pr);
      const target = sessionOfPR(pr, rooms, sessions);
      const room = rooms.find(s => s.repo === pr.repo.toLowerCase());
      const wt = room && worktreeOfPR(pr, room);
      const noTarget = () => {
        if (!this.notified.has(k)) { this.notified.add(k); this.ctx.withoutConversation(t('server.ciNoConversation', { numero: pr.number, repo: pr.repo, rama: pr.branch })); }
      };
      // nowhere to deliver it: the log isn't fetched (it retries on the next round)
      if (!target && !(room && wt)) { noTarget(); continue; }
      if (!this.logs.has(k)) {
        const run = pr.failures.find(f => f.run)?.run;
        this.logs.set(k, run ? await this.ctx.log(pr.repo, run, c.token).then(logTail).catch(() => undefined) : undefined);
      }
      const text = ciMessage(pr, blocks, this.logs.get(k));
      let where: { room: string; wt: string } | undefined;
      if (target && this.ctx.notify(target.session.id, text)) where = { room: target.room.id, wt: target.session.worktree ?? target.session.cwd };
      else if (room && wt && await this.ctx.open(room.id, wt, text).catch(() => false)) where = { room: room.id, wt };
      else { noTarget(); continue; }   // se reintenta en la siguiente vuelta
      this.logs.delete(k);
      this.delivered.push(k); changed = true;
      this.ctx.delivered(where.room, path.resolve(where.wt), pr, blocks);
    }
    if (changed) this.save();
  }
}
