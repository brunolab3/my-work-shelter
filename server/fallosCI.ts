// La CI que falla en tus PR, a la sala que los trabaja: cada minuto (con GitHub conectado) se miran los checks del
// último commit de tus PR abiertos y, cuando uno pasa a fallar (FAILURE o ERROR) en su cabeza actual, se manda UN
// mensaje a la conversación del worktree de ese PR, como las revisiones (revisionesPR.ts: sessionOfPR, worktreeOfPR):
// el PR, el commit, los checks que fallan con su enlace y la cola del log de lo que falló (`gh run view --log-failed`).
// Una tarea puede tener PR en varios repos con bloqueos entre ellos (shared/despliegue.ts): el mensaje lleva la clave
// de la tarea y los PR que esperan al que falla («bloquea: org/b#12»); esos no fallan por ello y no reciben nada.
// Una vez por PR y commit (DATOS/fallos-ci.json). La primera vez solo se apunta lo que ya fallaba: no llega de golpe
// la CI rota de antes de existir esto; un PR nuevo, o un commit nuevo, que falla, sí.
// Solo lectura hacia GitHub: el habitante propone un plan y el Supervisor lo aprueba antes de tocar nada.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { SessionSummary } from '../shared/protocolo.ts';
import type { PRBoard } from '../shared/tablero.ts';
import { dependenciasEnTexto, pRKey, refPR, type Blocker } from '../shared/despliegue.ts';
import { t } from '../shared/idioma.ts';
import type { CICheck } from '../shared/preflight.ts';
import { sessionOfPR, worktreeOfPR, type RoomPR } from './revisionesPR.ts';

export interface FailedCheck { nombre: string; url: string; run?: number }
export interface PRWithCI extends PRBoard { fallos: FailedCheck[]; todos: CICheck[] }

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
const PEOR: Record<CICheck['estado'], number> = { ok: 0, pendiente: 1, mal: 2 };
/** A check run for the pre-flight: a cancelled one doesn't pass (it gets no CI message either: it's often superseded),
 *  a stale one is waiting */
const checkRunState = (conclusion?: string): CICheck['estado'] => !conclusion ? 'pendiente' : RUN_FAILED.has(conclusion) || conclusion === 'CANCELLED' ? 'mal' : RUN_OK.has(conclusion) ? 'ok' : 'pendiente';
/** El id de la ejecución de Actions de un enlace (…/actions/runs/123/job/456) */
export const runOfUrl = (url: string) => { const m = /\/actions\/runs\/(\d+)/.exec(url); return m ? Number(m[1]) : undefined; };

/** Tus PR abiertos con el estado de su CI y, si falla, qué checks */
export function ciOfGitHub(j: any): PRWithCI[] {
  return (j?.data?.prs?.nodes ?? []).filter((n: any) => n?.number).map((n: any): PRWithCI => {
    const commit = n.commits?.nodes?.[0]?.commit;
    const fallos: FailedCheck[] = [], todos: CICheck[] = [];
    for (const c of commit?.statusCheckRollup?.contexts?.nodes ?? []) {
      // todos, para el pre-flight (cada check, una línea): bien, mal o aún en marcha
      const r = c?.__typename === 'CheckRun' ? checkRunState(c.conclusion) : c?.__typename === 'StatusContext' ? (FAILING.has(c.state) ? 'mal' : c.state === 'SUCCESS' ? 'ok' : 'pendiente') : undefined;
      const nombre = String(c?.name ?? c?.context ?? '');
      // two checks with the same name (one per workflow): the worst one shows
      const ya = todos.find(x => x.nombre === nombre);
      if (r && nombre && !ya) todos.push({ nombre, estado: r });
      else if (r && ya && PEOR[r] > PEOR[ya.estado]) ya.estado = r;
      if (c?.__typename === 'CheckRun' && RUN_FAILED.has(c.conclusion)) {
        const url = String(c.detailsUrl ?? n.url);
        fallos.push({ nombre: String(c.name ?? '?'), url, run: Number(c.checkSuite?.workflowRun?.databaseId) || runOfUrl(url) });
      } else if (c?.__typename === 'StatusContext' && FAILING.has(c.state)) fallos.push({ nombre: String(c.context ?? '?'), url: String(c.targetUrl ?? n.url) });
    }
    const repo = n.repository?.nameWithOwner ?? '';
    return {
      numero: n.number, titulo: n.title ?? '', url: n.url ?? '', repo, rama: n.headRefName ?? '',
      estado: n.isDraft ? 'borrador' : 'abierto', revision: n.reviewDecision ?? undefined,
      checks: commit?.statusCheckRollup?.state ?? undefined, actualizado: Date.parse(n.updatedAt ?? '') || 0,
      base: n.baseRefName ?? undefined, cabeza: n.headRefOid ?? commit?.oid ?? undefined,
      dependencias: dependenciasEnTexto(`${n.title ?? ''}\n${n.body ?? ''}`, repo), fallos, todos,
    };
  });
}

/** PR y commit: cada fallo de CI se entrega una vez */
export const failureId = (p: Pick<PRBoard, 'repo' | 'numero' | 'cabeza'>) => `${refPR(p)}@${p.cabeza ?? ''}`;
export const isFailing = (p: PRBoard) => !!p.cabeza && FAILING.has(p.checks ?? '');

/** Los PR que pasan a fallar: su CI falla en su cabeza y ese (PR, commit) no se ha entregado aún */
export function newFailures(prs: PRWithCI[], entregados: Set<string>): PRWithCI[] {
  return prs.filter(p => isFailing(p) && !entregados.has(failureId(p)));
}

/** Los PR (abiertos) que esperan al que falla: directa o indirectamente, como «org/repo#N» */
export function blockedBy(pr: PRBoard, prs: PRBoard[], bloqueos: Blocker[]): string[] {
  const byUrl = new Map(prs.map(p => [p.url, p]));
  const out: string[] = [], vistos = new Set([pr.url]);
  const cola = [pr.url];
  while (cola.length) {
    const por = cola.shift()!;
    for (const b of bloqueos) if (b.por === por && !vistos.has(b.de)) {
      vistos.add(b.de); cola.push(b.de);
      const q = byUrl.get(b.de);
      if (q && (q.estado === 'abierto' || q.estado === 'borrador')) out.push(refPR(q));
    }
  }
  return out;
}

const MAX_LOG = 4000, MAX_LINES = 80, MAX_CHECKS = 12;
/** La cola de un log, sin códigos de color ni la marca de tiempo de cada línea de Actions y con un tope */
export function logTail(log: string): string {
  const lineas = log.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map(l => l.replace(/^(\S+\t\S+\t)?\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '$1').trimEnd()).filter(Boolean);
  let out = lineas.slice(-MAX_LINES).join('\n');
  if (out.length > MAX_LOG) out = '…' + out.slice(-MAX_LOG);
  return out;
}

/** El mensaje para el habitante: qué falla, a quién bloquea y que proponga un plan antes de tocar nada */
export function ciMessage(pr: PRWithCI, bloquea: string[], log?: string): string {
  const clave = pRKey(pr);
  return [
    t('prompt.ci.title', { clave: clave ? `[${clave}] ` : '', numero: pr.numero, repo: pr.repo, titulo: pr.titulo, rama: pr.rama, commit: (pr.cabeza ?? '').slice(0, 10), url: pr.url }),
    '',
    ...(pr.fallos.length ? pr.fallos.slice(0, MAX_CHECKS).map(f => `- **${f.nombre}**: ${f.url}`) : [t('prompt.ci.noDetail')]),
    ...(pr.fallos.length > MAX_CHECKS ? [t('prompt.review.more', { n: pr.fallos.length - MAX_CHECKS })] : []),
    ...(bloquea.length ? ['', t('prompt.ci.blocks', { prs: bloquea.join(', ') })] : []),
    ...(log ? ['', t('prompt.ci.log'), '```', log.replace(/```/g, "'''"), '```'] : []),
    '',
    t('prompt.ci.ask'),
  ].join('\n');
}

export interface CtxCI {
  connection(): Promise<{ real: boolean; token?: string }>;
  consultar(token?: string): Promise<any>;                         // el JSON de CI_QUERY
  log(repo: string, run: number, token?: string): Promise<string>;  // `gh run view <run> --log-failed`
  bloqueos(prs: PRBoard[]): Promise<Blocker[]>;                     // los del tablero de despliegue (manuales y del plan incluidos)
  salas(): Promise<RoomPR[]>;
  sesiones(): SessionSummary[];
  avisar(sesionId: string, texto: string): boolean;
  abrir(salaId: string, cwd: string, texto: string): Promise<boolean>;
  delivered(salaId: string, worktree: string, pr: PRWithCI, bloquea: string[]): void;   // robot mensajero y aviso
  withoutConversation(texto: string): void;
}

export class CIFailures {
  private iniciado = false;
  private entregados: string[] = [];
  private avisados = new Set<string>();
  private archivo: string;
  constructor(dir: string, private ctx: CtxCI) {
    this.archivo = path.join(dir, 'fallos-ci.json');
    try { if (existsSync(this.archivo)) { const j = JSON.parse(readFileSync(this.archivo, 'utf8')); this.iniciado = !!j.iniciado; this.entregados = Array.isArray(j.entregados) ? j.entregados.filter((x: unknown) => typeof x === 'string') : []; } } catch {}
  }
  private guardar() { const tmp = this.archivo + '.tmp'; writeFileSync(tmp, JSON.stringify({ iniciado: this.iniciado, entregados: this.entregados.slice(-2000) }), { mode: 0o600 }); renameSync(tmp, this.archivo); }

  private checks = new Map<string, CICheck[]>();   // los de cada PR abierto, de la última vuelta: los lista el pre-flight
  checksOf(url: string): CICheck[] | undefined { return this.checks.get(url); }

  // one round at a time: a slow one (logs, opening conversations) must not overlap the next and deliver twice
  private enCurso?: Promise<void>;
  sondear() { return this.enCurso ??= this.vuelta().finally(() => { this.enCurso = undefined; }); }
  private logs = new Map<string, string | undefined>();   // failed-run log tail per failure, fetched once while it retries

  private async vuelta() {
    const c = await this.ctx.connection();
    if (!c.real) return;
    const prs = ciOfGitHub(await this.ctx.consultar(c.token));
    this.checks = new Map(prs.map(p => [p.url, p.todos]));
    const nuevos = newFailures(prs, new Set(this.entregados));
    // la primera vez, lo que ya fallaba se da por visto
    if (!this.iniciado) { this.iniciado = true; this.entregados.push(...nuevos.map(failureId)); this.guardar(); return; }
    const pendientes = new Set(nuevos.map(failureId));
    for (const k of this.logs.keys()) if (!pendientes.has(k)) this.logs.delete(k);
    if (!nuevos.length) return;
    const bloqueos = await this.ctx.bloqueos(prs).catch(() => [] as Blocker[]);
    const salas = await this.ctx.salas(), sesiones = this.ctx.sesiones();
    let cambio = false;
    for (const pr of nuevos) {
      const bloquea = blockedBy(pr, prs, bloqueos);
      const k = failureId(pr);
      const destino = sessionOfPR(pr, salas, sesiones);
      const sala = salas.find(s => s.repo === pr.repo.toLowerCase());
      const wt = sala && worktreeOfPR(pr, sala);
      const sinDestino = () => {
        if (!this.avisados.has(k)) { this.avisados.add(k); this.ctx.withoutConversation(t('server.ciNoConversation', { numero: pr.numero, repo: pr.repo, rama: pr.rama })); }
      };
      // nowhere to deliver it: the log isn't fetched (it retries on the next round)
      if (!destino && !(sala && wt)) { sinDestino(); continue; }
      if (!this.logs.has(k)) {
        const run = pr.fallos.find(f => f.run)?.run;
        this.logs.set(k, run ? await this.ctx.log(pr.repo, run, c.token).then(logTail).catch(() => undefined) : undefined);
      }
      const texto = ciMessage(pr, bloquea, this.logs.get(k));
      let donde: { sala: string; wt: string } | undefined;
      if (destino && this.ctx.avisar(destino.sesion.id, texto)) donde = { sala: destino.sala.id, wt: destino.sesion.worktree ?? destino.sesion.cwd };
      else if (sala && wt && await this.ctx.abrir(sala.id, wt, texto).catch(() => false)) donde = { sala: sala.id, wt };
      else { sinDestino(); continue; }   // se reintenta en la siguiente vuelta
      this.logs.delete(k);
      this.entregados.push(k); cambio = true;
      this.ctx.delivered(donde.sala, path.resolve(donde.wt), pr, bloquea);
    }
    if (cambio) this.guardar();
  }
}
