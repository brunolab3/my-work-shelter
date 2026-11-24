// Revisiones de tus PR, a la sala que los trabaja: cada minuto se miran tus PR abiertos en GitHub (con `gh`, solo
// con GitHub conectado en la cámara acorazada) y lo nuevo de otros (revisiones, comentarios en el código y en la
// conversación, también los de bots: revisores automáticos, informes de pruebas) va como mensaje a la conversación abierta en la rama del PR: el worktree de esa rama en la sala de su
// repo o, si no, el de la tarea (la clave de Jira de la rama). El habitante lo analiza y propone un plan (qué arreglar
// y qué contestar) al Supervisor, que lo aprueba antes de tocar nada. El robot mensajero lo lleva desde Control de
// Versiones y se lo da en mano al holograma de ese worktree (o al habitante, si es la copia principal). Toda tarea
// con PR tiene su worktree (organize.ts): sin conversación abierta, se retoma la última de ese worktree (o se empieza
// una) con la revisión; sin worktree, se avisa (es raro: falta organizar la sala).
// Sin conversación que lo reciba, se vuelve a intentar en la siguiente vuelta.
// Solo lectura hacia GitHub: contestar en el PR lo hace el habitante desde su conversación, con el permiso del Supervisor.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { SessionSummary } from '../shared/protocol.ts';
import { t } from '../shared/language.ts';
import type { PackPart } from '../shared/scheduled.ts';
import { recentFirst, sessionRecency } from '../shared/recent.ts';
import { withoutNothingThatMake as nothingToDo, cleanBody, reviewLedger, openThreads, ledgerPending, type ReviewLedger, type ReviewThread } from '../shared/reviewCount.ts';

export interface EventPR { id: string; type: 'revision' | 'hilo' | 'comentario'; author: string; bot?: boolean; body: string; url: string; date: number; state?: string; file?: string; line?: number }
export interface PRWithReview { number: number; title: string; url: string; repo: string; branch: string; events: EventPR[]; ledger: ReviewLedger; threads: ReviewThread[] }
export interface RoomPR { id: string; name: string; path: string; branch?: string; worktrees: { path: string; branch: string }[]; repo?: string }

export const REVIEWS_QUERY = `query {
  viewer { login }
  prs: search(query: "is:pr is:open author:@me archived:false sort:updated-desc", type: ISSUE, first: 30) { nodes { ... on PullRequest {
    number title url headRefName repository { nameWithOwner }
    reviews(last: 50) { nodes { id state body url submittedAt author { __typename login } } }
    reviewThreads(last: 100) { nodes { isResolved isOutdated path line primero: comments(first: 1) { nodes { body url author { login } } } comments(last: 10) { nodes { id body url createdAt author { __typename login } } } } }
    comments(last: 50) { nodes { id body url createdAt author { __typename login } } }
  } } }
}`;

export { nothingToDo as withoutNothingThatMake };

/** Lo de otros en cada PR que pide algo: revisiones que piden cambios o comentan algo con texto, comentarios de hilos
 *  sin resolver y comentarios de la conversación, también los de bots (un revisor automático o un informe de pruebas
 *  pueden traer algo que arreglar: el habitante decide en su plan). Las aprobaciones, solo si su texto pide algo («ok,
 *  pero antes de fusionar…», un aviso sobre el orden de fusión). Fuera: lo que solo es un visto bueno o un agradecimiento
 *  («LGTM 🚀», «:white_check_mark:»; sinNadaQueHacer): no genera un plan */
export function reviewsOfGitHub(j: any): { me: string; prs: PRWithReview[] } {
  const me = String(j?.data?.viewer?.login ?? '');
  const other = (a: any) => !!a?.login && a.login !== me;
  const bot = (a: any) => (a?.__typename === 'Bot' ? { bot: true } : {});
  const text = cleanBody;   // sin las marcas que esconden los bots en comentarios HTML: que no gasten la cita
  const date = (s: any) => { const t = Date.parse(s ?? ''); return Number.isFinite(t) ? t : 0; };
  const prs = (j?.data?.prs?.nodes ?? []).filter((n: any) => n?.number).map((n: any): PRWithReview => {
    const events: EventPR[] = [];
    for (const r of n.reviews?.nodes ?? []) {
      if (!r?.id || !other(r.author) || !['CHANGES_REQUESTED', 'COMMENTED', 'APPROVED'].includes(r.state)) continue;
      if (r.state !== 'CHANGES_REQUESTED' && nothingToDo(text(r.body))) continue;   // sus comentarios en el código llegan por los hilos
      events.push({ id: r.id, type: 'revision', author: r.author.login, ...bot(r.author), body: text(r.body), url: r.url ?? n.url, date: date(r.submittedAt), state: r.state });
    }
    for (const h of n.reviewThreads?.nodes ?? []) {
      if (!h || h.isResolved) continue;
      for (const c of h.comments?.nodes ?? []) if (c?.id && other(c.author) && !nothingToDo(text(c.body)))
        events.push({ id: c.id, type: 'hilo', author: c.author.login, ...bot(c.author), body: text(c.body), url: c.url ?? n.url, date: date(c.createdAt), file: h.path ?? undefined, line: h.line ?? undefined });
    }
    for (const c of n.comments?.nodes ?? []) if (c?.id && other(c.author) && !nothingToDo(text(c.body)))
      events.push({ id: c.id, type: 'comentario', author: c.author.login, ...bot(c.author), body: text(c.body), url: c.url ?? n.url, date: date(c.createdAt) });
    events.sort((a, b) => a.date - b.date);
    return { number: n.number, title: n.title ?? '', url: n.url ?? '', repo: n.repository?.nameWithOwner ?? '', branch: n.headRefName ?? '', events, ledger: reviewLedger(n, me), threads: openThreads(n, me) };
  });
  return { me, prs };
}

/** owner/nombre de un remoto de GitHub (ssh o https), en minúsculas; undefined si no es de GitHub */
export function remoteRepo(url: string): string | undefined {
  const m = /github\.com[:/]+([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? m[1].toLowerCase() : undefined;
}
/** La clave de Jira de una rama (feature/ABC-123-algo → ABC-123) */
export const branchKey = (branch: string) => /(?:^|[^a-z0-9])([a-z][a-z0-9]+-\d+)(?=$|[^0-9])/i.exec(branch)?.[1]?.toUpperCase();
/** Los números de PR que lleva el nombre de un worktree de una tarea sin clave (shelter-pr-12-13: organize.ts) */
export const prsOfName = (name: string) => (/(?:^|-)pr-((?:\d+-?)+)$/i.exec(name)?.[1] ?? '').split('-').filter(Boolean).map(Number);

/** La conversación abierta que trabaja en la rama de un PR: en un worktree (o la carpeta) de la sala de su repo con esa
 *  rama; si no, una de esa sala en un worktree con la clave de la tarea en el nombre. La más reciente */
export function sessionOfPR(pr: { repo: string; branch: string; number?: number }, rooms: RoomPR[], sessions: SessionSummary[]): { session: SessionSummary; room: RoomPR } | undefined {
  const ofRepo = rooms.filter(s => s.repo && s.repo === pr.repo.toLowerCase());
  const openSessions = sessions.filter(s => s.state !== 'cerrada').sort((a, b) => recentFirst(sessionRecency(a), sessionRecency(b)));
  const branchOf = (s: SessionSummary, room: RoomPR) => {
    const where = path.resolve(s.worktree ?? s.cwd);
    return room.worktrees.find(w => path.resolve(w.path) === where)?.branch ?? (where === path.resolve(room.path) ? room.branch : undefined);
  };
  for (const s of openSessions) { const room = ofRepo.find(x => x.id === s.roomId); if (room && branchOf(s, room) === pr.branch) return { session: s, room }; }
  const key = branchKey(pr.branch)?.toLowerCase();
  if (key) for (const s of openSessions) {
    const room = ofRepo.find(x => x.id === s.roomId);
    if (room && path.basename(s.worktree ?? s.cwd).toLowerCase().includes(key)) return { session: s, room };
  }
  // sin clave: el worktree de su tarea lleva su número en el nombre (shelter-pr-12-13)
  for (const s of openSessions) {
    const room = ofRepo.find(x => x.id === s.roomId);
    if (room && pr.number && prsOfName(path.basename(s.worktree ?? s.cwd)).includes(pr.number)) return { session: s, room };
  }
  return undefined;
}

/** El worktree de la tarea de un PR en la sala de su repo: con su rama, con su clave o con su número en el nombre (si
 *  su rama está en la copia principal, la copia principal) */
export function worktreeOfPR(pr: { branch: string; number: number; title?: string }, room: RoomPR): string | undefined {
  const others = room.worktrees.filter(w => path.resolve(w.path) !== path.resolve(room.path));
  const key = (branchKey(pr.branch) ?? (pr.title ? branchKey(pr.title) : undefined))?.toLowerCase();
  return others.find(w => w.branch === pr.branch)?.path
    ?? (key ? others.find(w => path.basename(w.path).toLowerCase().includes(key))?.path : undefined)
    ?? others.find(w => prsOfName(path.basename(w.path)).includes(pr.number))?.path
    ?? (room.branch === pr.branch ? room.path : undefined);
}

const MAX_BODY = 1500, MAX_EVENTS = 15;
const quote = (t: string) => (t.length > MAX_BODY ? t.slice(0, MAX_BODY) + '…' : t).split('\n').map(l => '   > ' + l).join('\n');
const THAT: Record<string, string> = { CHANGES_REQUESTED: 'prompt.review.changesRequested', COMMENTED: 'prompt.review.commented', APPROVED: 'prompt.review.approvedWithNote' };

/** El mensaje para el habitante: lo nuevo del PR y que proponga un plan antes de tocar nada */
export function reviewMessage(pr: PRWithReview, events: EventPR[]): string {
  const key = branchKey(pr.branch);
  const list = events.slice(0, MAX_EVENTS).map((e, i) => {
    const what = e.type === 'revision' ? t(THAT[e.state ?? ''] ?? 'prompt.review.reviews') : e.type === 'hilo' ? t('prompt.review.onLine', { lugar: `${e.file ?? '?'}${e.line ? ':' + e.line : ''}` }) : t('prompt.review.onConversation');
    return `${i + 1}. **${e.author}**${e.bot ? ' (bot)' : ''} ${what} (${e.url})${e.body ? '\n' + quote(e.body) : ''}`;
  });
  return [
    t('prompt.review.title', { clave: key ? `[${key}] ` : '', numero: pr.number, repo: pr.repo, titulo: pr.title, rama: pr.branch, url: pr.url }),
    '',
    ...list,
    ...(events.length > MAX_EVENTS ? [t('prompt.review.more', { n: events.length - MAX_EVENTS })] : []),
    '',
    ...ledgerLines(pr.ledger),
    '',
    t('prompt.review.ask'),
  ].join('\n');
}

/** La cuenta de lo que queda por contestar en el PR (shared/reviewCount.ts) y el recordatorio: cada hilo, arreglado o
 *  contestado, y cada resumen contestado antes de descartar una revisión o volver a pedirla */
export function ledgerLines(l?: ReviewLedger): string[] {
  if (!l) return [];
  return [
    ledgerPending(l)
      ? t('prompt.review.ledger', { hilos: l.unresolved, viejos: l.outdated ? t('prompt.review.ledgerOutdated', { n: l.outdated }) : '', resumenes: l.unansweredSummaries })
      : t('prompt.review.ledgerClear'),
    t('prompt.review.ledgerRule'),
  ];
}

export interface CtxReviews {
  connection(): Promise<{ real: boolean; token?: string }>;
  query(token?: string): Promise<any>;                // el JSON de CONSULTA_REVISIONES
  rooms(): Promise<RoomPR[]>;
  sessions(): SessionSummary[];
  notify(sessionId: string, text: string, pr: PackPart & { url: string; label: string }): boolean;   // packed per PR (scheduled.ts: pack)
  open(roomId: string, cwd: string, text: string): Promise<boolean>;   // retoma la última conversación de esa carpeta (o empieza una) con el texto
  delivered(roomId: string, worktree: string, pr: PRWithReview, events: EventPR[]): void;   // el robot mensajero sale de Control de Versiones hacia el holograma de ese worktree, y se avisa al Supervisor
  withoutConversation(text: string): void;                   // aviso al Supervisor
}

/** Lo ya entregado (por id de GitHub) y desde cuándo se mira: lo de antes de conectar no se manda */
export class ReviewsPR {
  private since = 0;
  private seen: string[] = [];
  private bots = false;   // desde que se entregan los de bots: los que ya había al empezar no se mandan de golpe
  private notified = new Set<string>();
  private file: string;
  private ledgers = new Map<string, ReviewLedger>();   // por URL del PR, de la última vuelta: lo pinta el tablero de despliegue
  /** Lo que queda por contestar en uno de tus PR abiertos (undefined hasta la primera vuelta con GitHub conectado) */
  ledgerOf(url: string): ReviewLedger | undefined { return this.ledgers.get(url); }
  private threads = new Map<string, ReviewThread[]>();   // los hilos sin resolver, por URL del PR: los lista el pre-flight
  threadsOf(url: string): ReviewThread[] | undefined { return this.threads.get(url); }
  constructor(dir: string, private ctx: CtxReviews) {
    this.file = path.join(dir, 'revisiones-pr.json');
    try { if (existsSync(this.file)) { const j = JSON.parse(readFileSync(this.file, 'utf8')); this.since = Number(j.since) || 0; this.bots = !!j.bots; this.seen = Array.isArray(j.seen) ? j.seen.filter((x: unknown) => typeof x === 'string') : []; } } catch {}
  }
  private save() { const tmp = this.file + '.tmp'; writeFileSync(tmp, JSON.stringify({ since: this.since, bots: this.bots, seen: this.seen.slice(-3000) }), { mode: 0o600 }); renameSync(tmp, this.file); }

  // one round at a time: a slow one (opening conversations) must not overlap the next and deliver twice
  private inProgress?: Promise<void>;
  poll() { return this.inProgress ??= this.round().finally(() => { this.inProgress = undefined; }); }

  private async round() {
    const c = await this.ctx.connection();
    if (!c.real) return;
    const { prs } = reviewsOfGitHub(await this.ctx.query(c.token));
    this.ledgers = new Map(prs.map(pr => [pr.url, pr.ledger]));
    this.threads = new Map(prs.map(pr => [pr.url, pr.threads]));
    if (!this.since) { this.since = Date.now(); this.bots = true; this.save(); return; }   // la primera vez solo se marca desde cuándo
    if (!this.bots) { this.seen.push(...prs.flatMap(pr => pr.events.filter(e => e.bot).map(e => e.id))); this.bots = true; this.save(); }
    const seen = new Set(this.seen);
    const pending = prs.map(pr => ({ pr, fresh: pr.events.filter(e => e.date > this.since && !seen.has(e.id)) })).filter(x => x.fresh.length);
    if (!pending.length) return;
    const rooms = await this.ctx.rooms(), sessions = this.ctx.sessions();
    let changed = false;
    for (const { pr, fresh } of pending) {
      const target = sessionOfPR(pr, rooms, sessions);
      const text = reviewMessage(pr, fresh);
      if (target && this.ctx.notify(target.session.id, text, { url: pr.url, label: `${pr.repo}#${pr.number}`, kind: 'review', text })) {
        this.seen.push(...fresh.map(e => e.id)); changed = true;
        this.ctx.delivered(target.room.id, path.resolve(target.session.worktree ?? target.session.cwd), pr, fresh);
        continue;
      }
      // sin conversación abierta: la del worktree de su tarea (retomada o nueva)
      const room = rooms.find(s => s.repo === pr.repo.toLowerCase());
      const wt = room && worktreeOfPR(pr, room);
      if (room && wt && await this.ctx.open(room.id, wt, text).catch(() => false)) {
        this.seen.push(...fresh.map(e => e.id)); changed = true;
        this.ctx.delivered(room.id, path.resolve(wt), pr, fresh);
        continue;
      }
      const key = `${pr.repo}#${pr.number}:${fresh.at(-1)!.id}`;
      if (this.notified.has(key)) continue;
      this.notified.add(key);
      this.ctx.withoutConversation(!room ? t('server.reviewNoRoom', { numero: pr.number, repo: pr.repo })
        : !wt ? t('server.reviewNoWorktree', { numero: pr.number, repo: pr.repo, rama: pr.branch, sala: room.name })
        : t('server.reviewCouldNotOpen', { numero: pr.number, repo: pr.repo }));
    }
    if (changed) this.save();
  }
}
