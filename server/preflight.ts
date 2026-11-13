// Pre-flight de una tarea (fase 1, solo lectura; el modelo en shared/preflight.ts): junta lo que hay de una tarea en todo
// el refugio. Las salas de repo con sus worktrees, tus PR (los del tablero de despliegue más los abiertos de antes,
// leídos de GitHub a lo sumo una vez por minuto), los bloqueos entre ellos (los manuales de bloqueosPR.ts y el orden
// del plan) y las partes de su plan repartido (planes.ts). De git, solo lectura: la cabeza de cada rama de la tarea,
// sus cambios sin commitear y cuántos commits tiene y le faltan respecto a la cabeza de su PR en GitHub (sin `fetch`:
// si esa cabeza no está en el repo local, faltan commits remotos).
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import fs from 'node:fs/promises';
import type { PRBoard } from '../shared/tablero.ts';
import { bloqueosEntre, type BlockerManual, type TaskOrder } from '../shared/despliegue.ts';
import { preflightTarea, type CompareRecord, type LocalBranch, type PlanPart, type TaskPreflight } from '../shared/preflight.ts';
import type { ReviewLedger, ReviewThread } from '../shared/cuentaRevisiones.ts';
import { pRTask, worktreeTask } from '../shared/tareas.ts';
import type { RoomPR } from './revisionesPR.ts';
import { t } from '../shared/idioma.ts';

type Git = (cwd: string, args: string[]) => Promise<string>;
export interface DataPRs { prs: PRBoard[]; demo?: boolean; error?: string }

export interface CtxPreflight {
  prs(forzar: boolean): Promise<DataPRs>;
  salas(): Promise<RoomPR[]>;
  manuales(): BlockerManual[];
  orden(): Promise<TaskOrder[]>;
  plan(clave: string): PlanPart[] | undefined;
  color(clave: string): string | undefined;
  compares(): Promise<CompareRecord[]>;
  revisiones(url: string): { ledger?: ReviewLedger; hilos?: ReviewThread[] };   // de la última vuelta de revisionesPR.ts
  git: Git;
}

const sameRepo = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const quiet = (p: Promise<string>) => p.then(s => s.trim()).catch(() => '');

/** Las ramas de la tarea en cada sala: los worktrees de la tarea (por su nombre o su rama) y los que tienen sacada la
 *  rama de uno de sus PR, y las ramas locales de sus PR que no están sacadas en ninguno; cada una frente a su PR */
export async function localBranches(clave: string, prs: PRBoard[], salas: RoomPR[], git: Git): Promise<LocalBranch[]> {
  const K = clave.toUpperCase();
  const deLaTarea = prs.filter(p => p.estado !== 'cerrado' && pRTask(p) === K);
  const out: LocalBranch[] = [];
  await Promise.all(salas.map(async s => {
    const suyos = deLaTarea.filter(p => sameRepo(p.repo, s.repo));
    const ramas = new Set(suyos.map(p => p.rama));
    const sacadas = new Set<string>();
    const wts = s.worktrees.length ? s.worktrees : [{ ruta: s.ruta, rama: s.rama ?? '' }];
    await Promise.all(wts.map(async w => {
      if (!w.rama || (worktreeTask(w) !== K && !ramas.has(w.rama))) return;
      sacadas.add(w.rama);
      const [head, estado] = await Promise.all([quiet(git(w.ruta, ['rev-parse', 'HEAD'])), quiet(git(w.ruta, ['status', '--porcelain']))]);
      out.push({ salaId: s.id, rama: w.rama, head: head || undefined, worktree: path.resolve(w.ruta), cambios: estado.split('\n').filter(Boolean).length });
    }));
    await Promise.all([...ramas].filter(r => !sacadas.has(r)).map(async rama => {
      const head = await quiet(git(s.ruta, ['rev-parse', '--verify', '--quiet', `refs/heads/${rama}^{commit}`]));
      if (head) out.push({ salaId: s.id, rama, head });
    }));
    // frente a la cabeza de su PR en GitHub
    await Promise.all(out.filter(l => l.salaId === s.id && l.head).map(async l => {
      const cabeza = suyos.find(p => p.rama === l.rama)?.cabeza;
      if (!cabeza || cabeza === l.head) return;
      const hay = await git(s.ruta, ['cat-file', '-e', `${cabeza}^{commit}`]).then(() => true, () => false);
      if (!hay) { l.sinCabeza = true; return; }
      const [a, b] = (await quiet(git(s.ruta, ['rev-list', '--left-right', '--count', `${l.head}...${cabeza}`]))).split(/\s+/).map(Number);
      l.adelante = a || 0; l.detras = b || 0;
    }));
  }));
  return out.sort((a, b) => a.salaId.localeCompare(b.salaId) || a.rama.localeCompare(b.rama));
}

/** El pre-flight de una tarea, con todo lo del refugio */
export async function preflightOf(clave: string, ctx: CtxPreflight, forzar = false): Promise<TaskPreflight> {
  const K = clave.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(K)) throw new Error(t('server.notATaskKey', { clave: clave.slice(0, 40) }));
  const [gh, salas, orden] = await Promise.all([ctx.prs(forzar), ctx.salas(), ctx.orden().catch(() => [] as TaskOrder[])]);
  // lo que queda por contestar en sus revisiones, como en el tablero de despliegue
  const prs = gh.demo ? gh.prs : gh.prs.map(p => { const l = ctx.revisiones(p.url).ledger; return l ? { ...p, ledger: l } : p; });
  const hilos = Object.fromEntries(prs.map(p => [p.url, ctx.revisiones(p.url).hilos ?? []]));
  const [locales, compares] = await Promise.all([localBranches(K, prs, salas, ctx.git), ctx.compares().catch(() => [] as CompareRecord[])]);
  return preflightTarea(K, {
    prs, bloqueos: bloqueosEntre(prs, ctx.manuales(), orden), locales, compares, hilos,
    salas: salas.map(s => ({ id: s.id, nombre: s.nombre, repo: s.repo })),
    plan: ctx.plan(K), color: ctx.color(K), demo: gh.demo, error: gh.error,
  });
}

/** La comparación de toda la tarea: las partes con worktree (y PR sin fusionar, o sin PR aún) en el orden de fusión,
 *  cada una frente a la base de su PR */
export async function taskCompare(clave: string, ctx: CtxPreflight, build: (clave: string, partes: { worktree: string; nombre: string; base?: string }[]) => Promise<{ archivo: string }>) {
  const r = await preflightOf(clave, ctx);
  const ola = new Map(r.olas.flatMap((o, i) => o.map(ref => [ref, i] as const)));
  const partes = r.partes.filter(p => p.worktree && (!p.pr || p.pr.estado === 'abierto' || p.pr.estado === 'borrador'))
    .sort((a, b) => (a.pr ? ola.get(`${a.pr.repo}#${a.pr.numero}`) ?? 98 : 99) - (b.pr ? ola.get(`${b.pr.repo}#${b.pr.numero}`) ?? 98 : 99));
  if (!partes.length) throw new Error(t('server.preflightNothingToCompare', { clave: r.clave }));
  return build(r.clave, partes.map(p => ({ worktree: p.worktree!, nombre: p.repo?.split('/').pop() ?? p.sala ?? path.basename(p.worktree!), base: p.pr?.base })));
}

/** Tus PR para el pre-flight: los del tablero (dos semanas) y todos los abiertos, una lectura por minuto como mucho */
export function cachedPRs(leer: () => Promise<DataPRs>, ttl = 60_000) {
  let ultimo: { ts: number; p: Promise<DataPRs> } | null = null;
  return (forzar = false) => {
    if (!ultimo || forzar || Date.now() - ultimo.ts > ttl) {
      const p = leer().catch(e => { ultimo = null; throw e; });
      ultimo = { ts: Date.now(), p };
    }
    return ultimo.p;
  };
}

/** Lo que el Supervisor hace con cada página de comparación (validarla o mandarle notas), guardado en el servidor
 *  (DATOS/preflight.json) para atarlo al commit de la página (su `<página>.json`, server/comparar.ts). El cliente sigue
 *  llevando la suya por conversación (Navegadores.tsx): esta es la que cuenta para el pre-flight */
export class PageReviews {
  private respuestas: Record<string, { estado: 'validada' | 'notas'; ts: number }> = {};
  private archivo: string;
  constructor(dir: string, private carpeta: string) {
    this.archivo = path.join(dir, 'preflight.json');
    try { if (existsSync(this.archivo)) this.respuestas = JSON.parse(readFileSync(this.archivo, 'utf8')).respuestas ?? {}; } catch { this.respuestas = {}; }
  }
  private guardar() {
    const lista = Object.entries(this.respuestas).sort((a, b) => b[1].ts - a[1].ts).slice(0, 500);
    this.respuestas = Object.fromEntries(lista);
    const tmp = this.archivo + '.tmp'; writeFileSync(tmp, JSON.stringify({ respuestas: this.respuestas }), { mode: 0o600 }); renameSync(tmp, this.archivo);
  }
  /** Solo las páginas de comparación (las de la carpeta, con su `.json`); lo demás no cuenta y se ignora */
  responder(ruta: unknown, estado: unknown): boolean {
    const r = path.resolve(String(ruta ?? ''));
    if (path.dirname(r) !== path.resolve(this.carpeta) || !r.endsWith('.html') || !existsSync(r.replace(/\.html$/, '.json'))) return false;
    if (estado !== 'validada' && estado !== 'notas') return false;
    this.respuestas[r] = { estado, ts: Date.now() };
    this.guardar();
    return true;
  }
  /** Las comparaciones de la carpeta, con su respuesta */
  async compares(): Promise<CompareRecord[]> {
    const nombres = await fs.readdir(this.carpeta).catch(() => [] as string[]);
    const out: CompareRecord[] = [];
    await Promise.all(nombres.filter(n => n.endsWith('.json')).map(async n => {
      const archivo = path.join(path.resolve(this.carpeta), n.replace(/\.json$/, '.html'));
      try {
        const j = JSON.parse(await fs.readFile(path.join(this.carpeta, n), 'utf8'));
        if (!Array.isArray(j?.partes) || !existsSync(archivo)) return;
        out.push({ archivo, ts: Number(j.ts) || 0, tarea: typeof j.tarea === 'string' ? j.tarea : undefined, respuesta: this.respuestas[archivo],
          partes: j.partes.filter((x: any) => x && typeof x.worktree === 'string').map((x: any) => ({ worktree: path.resolve(x.worktree), rama: String(x.rama ?? ''), head: String(x.head ?? ''), base: x.base ? String(x.base) : undefined })) });
      } catch {}
    }));
    return out;
  }
}
