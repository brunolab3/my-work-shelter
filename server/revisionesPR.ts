// Revisiones de tus PR, a la sala que los trabaja: cada minuto se miran tus PR abiertos en GitHub (con `gh`, solo
// con GitHub conectado en la cámara acorazada) y lo nuevo de otros (revisiones, comentarios en el código y en la
// conversación, también los de bots: revisores automáticos, informes de pruebas) va como mensaje a la conversación abierta en la rama del PR: el worktree de esa rama en la sala de su
// repo o, si no, el de la tarea (la clave de Jira de la rama). El habitante lo analiza y propone un plan (qué arreglar
// y qué contestar) al Supervisor, que lo aprueba antes de tocar nada. El robot mensajero lo lleva desde Control de
// Versiones y se lo da en mano al holograma de ese worktree (o al habitante, si es la copia principal). Toda tarea
// con PR tiene su worktree (organizar.ts): sin conversación abierta, se retoma la última de ese worktree (o se empieza
// una) con la revisión; sin worktree, se avisa (es raro: falta organizar la sala).
// Sin conversación que lo reciba, se vuelve a intentar en la siguiente vuelta.
// Solo lectura hacia GitHub: contestar en el PR lo hace el habitante desde su conversación, con el permiso del Supervisor.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import type { SessionSummary } from '../shared/protocolo.ts';
import { t } from '../shared/idioma.ts';

export interface EventPR { id: string; tipo: 'revision' | 'hilo' | 'comentario'; autor: string; bot?: boolean; cuerpo: string; url: string; fecha: number; estado?: string; archivo?: string; linea?: number }
export interface PRWithReview { numero: number; titulo: string; url: string; repo: string; rama: string; eventos: EventPR[] }
export interface RoomPR { id: string; nombre: string; ruta: string; rama?: string; worktrees: { ruta: string; rama: string }[]; repo?: string }

export const REVIEWS_QUERY = `query {
  viewer { login }
  prs: search(query: "is:pr is:open author:@me archived:false sort:updated-desc", type: ISSUE, first: 30) { nodes { ... on PullRequest {
    number title url headRefName repository { nameWithOwner }
    reviews(last: 20) { nodes { id state body url submittedAt author { __typename login } } }
    reviewThreads(last: 50) { nodes { isResolved path line comments(last: 10) { nodes { id body url createdAt author { __typename login } } } } }
    comments(last: 20) { nodes { id body url createdAt author { __typename login } } }
  } } }
}`;

// lo que no pide nada: un visto bueno, un agradecimiento o un emoji («LGTM», «Thanks!», «👍», «Gracias, perfecto»).
// Solo si es corto y no lleva pregunta: con eso no hay plan que hacer
const COURTESY = /^(lgtm|looks good( to me)?|lg|thanks?( a lot| you( so much)?)?|thx|ty|nice( work| job| one)?|great( work| job)?|good (work|job|catch|stuff)|well done|awesome|cool|perfect|ship ?it|approved?|ok(ay)?|done|resolved|\+1|gracias|muchas gracias|perfecto|genial|vale|bien|buen trabajo|ok gracias|todo bien|aprobado|de acuerdo)$/;
export function withoutNothingThatMake(cuerpo: string): boolean {
  const t = cuerpo.toLowerCase().replace(/@[\w-]+/g, ' ').replace(/:[a-z0-9_+-]+:/g, ' ').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, ' ');
  if (t.includes('?') || t.length > 80) return false;
  const partes = t.split(/[\n.,;!¡]+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return partes.every(x => COURTESY.test(x));
}

/** Lo de otros en cada PR que pide algo: revisiones que piden cambios o comentan algo con texto, comentarios de hilos
 *  sin resolver y comentarios de la conversación, también los de bots (un revisor automático o un informe de pruebas
 *  pueden traer algo que arreglar: el habitante decide en su plan). Fuera: las aprobaciones sin más y lo que solo es un
 *  visto bueno o un agradecimiento (sinNadaQueHacer): no generan un plan */
export function reviewsOfGitHub(j: any): { yo: string; prs: PRWithReview[] } {
  const yo = String(j?.data?.viewer?.login ?? '');
  const otro = (a: any) => !!a?.login && a.login !== yo;
  const bot = (a: any) => (a?.__typename === 'Bot' ? { bot: true } : {});
  // los bots esconden sus marcas en comentarios HTML (<!-- ci-status: … -->): fuera, que no gasten la cita
  const texto = (b: any) => String(b ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
  const fecha = (s: any) => { const t = Date.parse(s ?? ''); return Number.isFinite(t) ? t : 0; };
  const prs = (j?.data?.prs?.nodes ?? []).filter((n: any) => n?.number).map((n: any): PRWithReview => {
    const eventos: EventPR[] = [];
    for (const r of n.reviews?.nodes ?? []) {
      if (!r?.id || !otro(r.author) || !['CHANGES_REQUESTED', 'COMMENTED', 'APPROVED'].includes(r.state)) continue;
      if (r.state !== 'CHANGES_REQUESTED' && withoutNothingThatMake(texto(r.body))) continue;   // sus comentarios en el código llegan por los hilos
      eventos.push({ id: r.id, tipo: 'revision', autor: r.author.login, ...bot(r.author), cuerpo: texto(r.body), url: r.url ?? n.url, fecha: fecha(r.submittedAt), estado: r.state });
    }
    for (const h of n.reviewThreads?.nodes ?? []) {
      if (!h || h.isResolved) continue;
      for (const c of h.comments?.nodes ?? []) if (c?.id && otro(c.author) && !withoutNothingThatMake(texto(c.body)))
        eventos.push({ id: c.id, tipo: 'hilo', autor: c.author.login, ...bot(c.author), cuerpo: texto(c.body), url: c.url ?? n.url, fecha: fecha(c.createdAt), archivo: h.path ?? undefined, linea: h.line ?? undefined });
    }
    for (const c of n.comments?.nodes ?? []) if (c?.id && otro(c.author) && !withoutNothingThatMake(texto(c.body)))
      eventos.push({ id: c.id, tipo: 'comentario', autor: c.author.login, ...bot(c.author), cuerpo: texto(c.body), url: c.url ?? n.url, fecha: fecha(c.createdAt) });
    eventos.sort((a, b) => a.fecha - b.fecha);
    return { numero: n.number, titulo: n.title ?? '', url: n.url ?? '', repo: n.repository?.nameWithOwner ?? '', rama: n.headRefName ?? '', eventos };
  });
  return { yo, prs };
}

/** owner/nombre de un remoto de GitHub (ssh o https), en minúsculas; undefined si no es de GitHub */
export function remoteRepo(url: string): string | undefined {
  const m = /github\.com[:/]+([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? m[1].toLowerCase() : undefined;
}
/** La clave de Jira de una rama (feature/ABC-123-algo → ABC-123) */
export const branchKey = (rama: string) => /(?:^|[^a-z0-9])([a-z][a-z0-9]+-\d+)(?=$|[^0-9])/i.exec(rama)?.[1]?.toUpperCase();
/** Los números de PR que lleva el nombre de un worktree de una tarea sin clave (shelter-pr-12-13: organizar.ts) */
export const prsOfName = (nombre: string) => (/(?:^|-)pr-((?:\d+-?)+)$/i.exec(nombre)?.[1] ?? '').split('-').filter(Boolean).map(Number);

/** La conversación abierta que trabaja en la rama de un PR: en un worktree (o la carpeta) de la sala de su repo con esa
 *  rama; si no, una de esa sala en un worktree con la clave de la tarea en el nombre. La más reciente */
export function sessionOfPR(pr: { repo: string; rama: string; numero?: number }, salas: RoomPR[], sesiones: SessionSummary[]): { sesion: SessionSummary; sala: RoomPR } | undefined {
  const delRepo = salas.filter(s => s.repo && s.repo === pr.repo.toLowerCase());
  const abiertas = sesiones.filter(s => s.estado !== 'cerrada').sort((a, b) => b.actualizada - a.actualizada);
  const branchOf = (s: SessionSummary, sala: RoomPR) => {
    const donde = path.resolve(s.worktree ?? s.cwd);
    return sala.worktrees.find(w => path.resolve(w.ruta) === donde)?.rama ?? (donde === path.resolve(sala.ruta) ? sala.rama : undefined);
  };
  for (const s of abiertas) { const sala = delRepo.find(x => x.id === s.salaId); if (sala && branchOf(s, sala) === pr.rama) return { sesion: s, sala }; }
  const clave = branchKey(pr.rama)?.toLowerCase();
  if (clave) for (const s of abiertas) {
    const sala = delRepo.find(x => x.id === s.salaId);
    if (sala && path.basename(s.worktree ?? s.cwd).toLowerCase().includes(clave)) return { sesion: s, sala };
  }
  // sin clave: el worktree de su tarea lleva su número en el nombre (shelter-pr-12-13)
  for (const s of abiertas) {
    const sala = delRepo.find(x => x.id === s.salaId);
    if (sala && pr.numero && prsOfName(path.basename(s.worktree ?? s.cwd)).includes(pr.numero)) return { sesion: s, sala };
  }
  return undefined;
}

/** El worktree de la tarea de un PR en la sala de su repo: con su rama, con su clave o con su número en el nombre (si
 *  su rama está en la copia principal, la copia principal) */
export function worktreeOfPR(pr: { rama: string; numero: number; titulo?: string }, sala: RoomPR): string | undefined {
  const otros = sala.worktrees.filter(w => path.resolve(w.ruta) !== path.resolve(sala.ruta));
  const clave = (branchKey(pr.rama) ?? (pr.titulo ? branchKey(pr.titulo) : undefined))?.toLowerCase();
  return otros.find(w => w.rama === pr.rama)?.ruta
    ?? (clave ? otros.find(w => path.basename(w.ruta).toLowerCase().includes(clave))?.ruta : undefined)
    ?? otros.find(w => prsOfName(path.basename(w.ruta)).includes(pr.numero))?.ruta
    ?? (sala.rama === pr.rama ? sala.ruta : undefined);
}

const MAX_BODY = 1500, MAX_EVENTS = 15;
const quote = (t: string) => (t.length > MAX_BODY ? t.slice(0, MAX_BODY) + '…' : t).split('\n').map(l => '   > ' + l).join('\n');
const THAT: Record<string, string> = { CHANGES_REQUESTED: 'prompt.review.changesRequested', APPROVED: 'prompt.review.approved', COMMENTED: 'prompt.review.commented' };

/** El mensaje para el habitante: lo nuevo del PR y que proponga un plan antes de tocar nada */
export function reviewMessage(pr: PRWithReview, eventos: EventPR[]): string {
  const clave = branchKey(pr.rama);
  const lista = eventos.slice(0, MAX_EVENTS).map((e, i) => {
    const que = e.tipo === 'revision' ? t(THAT[e.estado ?? ''] ?? 'prompt.review.reviews') : e.tipo === 'hilo' ? t('prompt.review.onLine', { lugar: `${e.archivo ?? '?'}${e.linea ? ':' + e.linea : ''}` }) : t('prompt.review.onConversation');
    return `${i + 1}. **${e.autor}**${e.bot ? ' (bot)' : ''} ${que} (${e.url})${e.cuerpo ? '\n' + quote(e.cuerpo) : ''}`;
  });
  return [
    t('prompt.review.title', { clave: clave ? `[${clave}] ` : '', numero: pr.numero, repo: pr.repo, titulo: pr.titulo, rama: pr.rama, url: pr.url }),
    '',
    ...lista,
    ...(eventos.length > MAX_EVENTS ? [t('prompt.review.more', { n: eventos.length - MAX_EVENTS })] : []),
    '',
    t('prompt.review.ask'),
  ].join('\n');
}

export interface CtxReviews {
  connection(): Promise<{ real: boolean; token?: string }>;
  consultar(token?: string): Promise<any>;                // el JSON de CONSULTA_REVISIONES
  salas(): Promise<RoomPR[]>;
  sesiones(): SessionSummary[];
  avisar(sesionId: string, texto: string): boolean;
  abrir(salaId: string, cwd: string, texto: string): Promise<boolean>;   // retoma la última conversación de esa carpeta (o empieza una) con el texto
  delivered(salaId: string, worktree: string, pr: PRWithReview, eventos: EventPR[]): void;   // el robot mensajero sale de Control de Versiones hacia el holograma de ese worktree, y se avisa al Supervisor
  withoutConversation(texto: string): void;                   // aviso al Supervisor
}

/** Lo ya entregado (por id de GitHub) y desde cuándo se mira: lo de antes de conectar no se manda */
export class ReviewsPR {
  private desde = 0;
  private seen: string[] = [];
  private bots = false;   // desde que se entregan los de bots: los que ya había al empezar no se mandan de golpe
  private avisados = new Set<string>();
  private archivo: string;
  constructor(dir: string, private ctx: CtxReviews) {
    this.archivo = path.join(dir, 'revisiones-pr.json');
    try { if (existsSync(this.archivo)) { const j = JSON.parse(readFileSync(this.archivo, 'utf8')); this.desde = Number(j.desde) || 0; this.bots = !!j.bots; this.seen = Array.isArray(j.seen) ? j.seen.filter((x: unknown) => typeof x === 'string') : []; } } catch {}
  }
  private guardar() { const tmp = this.archivo + '.tmp'; writeFileSync(tmp, JSON.stringify({ desde: this.desde, bots: this.bots, seen: this.seen.slice(-3000) }), { mode: 0o600 }); renameSync(tmp, this.archivo); }

  async sondear() {
    const c = await this.ctx.connection();
    if (!c.real) return;
    const { prs } = reviewsOfGitHub(await this.ctx.consultar(c.token));
    if (!this.desde) { this.desde = Date.now(); this.bots = true; this.guardar(); return; }   // la primera vez solo se marca desde cuándo
    if (!this.bots) { this.seen.push(...prs.flatMap(pr => pr.eventos.filter(e => e.bot).map(e => e.id))); this.bots = true; this.guardar(); }
    const seen = new Set(this.seen);
    const pendientes = prs.map(pr => ({ pr, nuevos: pr.eventos.filter(e => e.fecha > this.desde && !seen.has(e.id)) })).filter(x => x.nuevos.length);
    if (!pendientes.length) return;
    const salas = await this.ctx.salas(), sesiones = this.ctx.sesiones();
    let cambio = false;
    for (const { pr, nuevos } of pendientes) {
      const destino = sessionOfPR(pr, salas, sesiones);
      if (destino && this.ctx.avisar(destino.sesion.id, reviewMessage(pr, nuevos))) {
        this.seen.push(...nuevos.map(e => e.id)); cambio = true;
        this.ctx.delivered(destino.sala.id, path.resolve(destino.sesion.worktree ?? destino.sesion.cwd), pr, nuevos);
        continue;
      }
      // sin conversación abierta: la del worktree de su tarea (retomada o nueva)
      const sala = salas.find(s => s.repo === pr.repo.toLowerCase());
      const wt = sala && worktreeOfPR(pr, sala);
      if (sala && wt && await this.ctx.abrir(sala.id, wt, reviewMessage(pr, nuevos)).catch(() => false)) {
        this.seen.push(...nuevos.map(e => e.id)); cambio = true;
        this.ctx.delivered(sala.id, path.resolve(wt), pr, nuevos);
        continue;
      }
      const clave = `${pr.repo}#${pr.numero}:${nuevos.at(-1)!.id}`;
      if (this.avisados.has(clave)) continue;
      this.avisados.add(clave);
      this.ctx.withoutConversation(!sala ? `Revisión nueva en el PR #${pr.numero} de ${pr.repo}: ese repo no tiene sala en el refugio.`
        : !wt ? `Revisión nueva en el PR #${pr.numero} de ${pr.repo} (rama ${pr.rama}), y en «${sala.nombre}» no hay ningún worktree de su tarea: es raro. Organiza la sala por tareas (panel de la sala) y se la paso.`
        : `Revisión nueva en el PR #${pr.numero} de ${pr.repo}: no he podido abrir la conversación de su worktree (¿límite de sesiones?). Lo vuelvo a intentar en un minuto.`);
    }
    if (cambio) this.guardar();
  }
}
