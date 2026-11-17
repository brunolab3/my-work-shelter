// The tasks' production verification plans (model in shared/verification.ts), saved in DATOS/verificaciones.json by task
// key: the dweller writes them with verification_plan and verification_report (MCP `rooms`, roomNotices.ts) and the
// Overseer approves them in the pre-flight. The game queries nothing itself: the evidence is what the dweller found with
// its own observability connector. Deadlines are checked whenever a plan is read. Every few minutes (repasar, main.ts)
// the game opens the checkpoints whose PR merged (the final one once all have, or when the tracker puts the task in the
// board's prod-check status) and schedules their rechecks in the conversation that proposed the plan, as scheduled
// messages with backoff; a checkpoint that closes or turns inconclusive is told to the Overseer once, and an
// inconclusive one also to that conversation, to ask the Overseer: wait more, exercise it, or accept it with a reason.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { t } from '../shared/language.ts';
import { describeWhen } from '../shared/scheduled.ts';
import { deadlineOf, expire, isApproved, isClosed, needsRecheck, openCheckpoints, proposePlan, recheckAt, report, validPlan, KIND_TEXT, STATE_TEXT,
  type Checkpoint, type PlanConversation, type PlanInput, type ReportInput, type Result, type TaskPR, type VerificationPlan } from '../shared/verification.ts';

export interface CtxRecheck {
  prs(clave: string, plan: VerificationPlan): Promise<TaskPR[]>;
  enPrueba(clave: string): Promise<boolean>;   // the tracker has the task in its board's prod-check status
  // a scheduled message to the plan's conversation (scheduled.ts): its id, or none if it couldn't be scheduled
  programar(c: PlanConversation, cuando: number, mensaje: string): string | undefined;
  pendiente(id: string): boolean;
  cancelar(id: string): void;
  avisar(texto: string, nivel: 'info' | 'aviso'): void;
}

const MAX_PLANS = 100;

export class Verifications {
  private planes: Record<string, VerificationPlan> = {};
  private archivo: string;
  constructor(dir: string, private ahora: () => number = Date.now, private cambiado: (clave: string) => void = () => {}) {
    this.archivo = path.join(dir, 'verificaciones.json');
    try {
      if (existsSync(this.archivo)) {
        const j = JSON.parse(readFileSync(this.archivo, 'utf8'))?.planes ?? {};
        this.planes = Object.fromEntries(Object.entries(j).filter(([, p]) => validPlan(p))) as Record<string, VerificationPlan>;
      }
    } catch {}
  }
  private guardar(clave: string) {
    // the most recent tasks only
    this.planes = Object.fromEntries(Object.entries(this.planes).sort((a, b) => b[1].actualizado - a[1].actualizado).slice(0, MAX_PLANS));
    const tmp = this.archivo + '.tmp'; writeFileSync(tmp, JSON.stringify({ planes: this.planes }), { mode: 0o600 }); renameSync(tmp, this.archivo);
    this.cambiado(clave);
  }
  /** A task's plan, with its deadlines checked */
  get(clave: string): VerificationPlan | undefined {
    const p = this.planes[clave]; if (!p) return undefined;
    const q = expire(p, this.ahora());
    if (q !== p) { this.planes[clave] = q; this.guardar(clave); }
    return q;
  }
  /** `conversacion`: the one proposing it, where its rechecks go (the latest to propose it) */
  proponer(clave: string, input: PlanInput, conversacion?: PlanConversation): Result<VerificationPlan> {
    const r = proposePlan(clave, input, this.get(clave), this.ahora());
    return this.poner(clave, r.ok && conversacion ? { ok: true, valor: { ...r.valor, conversacion } } : r);
  }
  /** Every plan's state, for the boards and the holograms */
  estados(): Record<string, VerificationPlan> { return Object.fromEntries(Object.keys(this.planes).map(k => [k, this.get(k)!])); }

  /** Opens what merged, tells what closed or ran out of time, and keeps one recheck scheduled per open checkpoint */
  async repasar(ctx: CtxRecheck) {
    for (const clave of Object.keys(this.planes)) {
      const antes = this.get(clave);
      if (!antes?.conversacion || antes.puntos.every(c => c.avisado && (isClosed(c) || c.estado === 'inconclusive'))) continue;
      const ahora = this.ahora();
      const abiertos = antes.puntos.some(c => c.abierto == null && !isClosed(c))
        ? openCheckpoints(antes, await ctx.prs(clave, antes).catch(() => []), await ctx.enPrueba(clave).catch(() => false), ahora) : antes;
      const p = expire(abiertos, ahora);
      const puntos = p.puntos.map(c => this.revisarPunto(p, structuredClone(c), ctx, ahora));
      const nuevo = { ...p, puntos };
      if (JSON.stringify(nuevo) !== JSON.stringify(this.planes[clave])) { this.planes[clave] = nuevo; this.guardar(clave); }
    }
  }
  private revisarPunto(p: VerificationPlan, c: Checkpoint, ctx: CtxRecheck, ahora: number): Checkpoint {
    const conv = p.conversacion!;
    const nombre = `${p.clave} · ${c.tipo === 'final' ? t('verification.final') : c.pr}`;
    if (!needsRecheck(c) && c.programado) { if (ctx.pendiente(c.programado)) ctx.cancelar(c.programado); delete c.programado; }
    if ((isClosed(c) || c.estado === 'inconclusive') && !c.avisado) {
      c.avisado = true;
      if (c.estado === 'inconclusive') {
        ctx.programar(conv, ahora, t('prompt.verification.inconclusive', { clave: p.clave, id: c.id, atascado: t(STATE_TEXT[c.atascado ?? 'waiting-traffic']), plan: planText(p) }));
        ctx.avisar(t('server.verification.inconclusive', { nombre, atascado: t(STATE_TEXT[c.atascado ?? 'waiting-traffic']) }), 'aviso');
      } else ctx.avisar(t(c.estado === 'failed' ? 'server.verification.failed' : 'server.verification.evidenced', { nombre }), c.estado === 'failed' ? 'aviso' : 'info');
    }
    if (needsRecheck(c) && !(c.programado && ctx.pendiente(c.programado))) {
      const n = c.rechequeos ?? 0;
      const id = ctx.programar(conv, recheckAt(n, ahora), t('prompt.verification.recheck', { clave: p.clave, id: c.id, n: n + 1, plan: planText(p) }));
      if (id) { c.programado = id; c.rechequeos = n + 1; }
    }
    return c;
  }
  informar(clave: string, r: ReportInput): Result<VerificationPlan> | undefined {
    const p = this.get(clave);
    return p && this.poner(clave, report(p, r, this.ahora()));
  }
  /** The Overseer approves the current version (from the pre-flight) */
  aprobar(clave: string): VerificationPlan | undefined {
    const p = this.get(clave); if (!p) return undefined;
    this.planes[clave] = { ...p, aprobado: { version: p.version, ts: this.ahora() } }; this.guardar(clave);
    return this.planes[clave];
  }
  private poner(clave: string, r: Result<VerificationPlan>) {
    if (r.ok) { this.planes[clave] = r.valor; this.guardar(clave); }
    return r;
  }
}

/** A plan's error in words */
export const errorText = (r: { error: string; vars?: Record<string, string | number> }) => t(`verification.error.${r.error}`, r.vars);

/** A plan as the dweller reads it back after each call */
export function planText(p: VerificationPlan): string {
  return [
    t('tool.verification.heading', { clave: p.clave, version: p.version, aprobado: t(isApproved(p) ? 'verification.approved' : 'verification.unapproved', { version: p.version }) }),
    ...p.puntos.flatMap(c => {
      const plazo = deadlineOf(c);
      return [
        `- ${c.id} (${c.tipo === 'final' ? t('verification.final') : c.pr}) · ${t(STATE_TEXT[c.estado])}${c.servicios.length ? ' · ' + t('verification.services', { lista: c.servicios.map(s => (c.vivos[s] ? s + ' ✓' : s)).join(', ') }) : ''} · ${plazo ? t('verification.deadline', { cuando: describeWhen(plazo) }) : t('verification.deadlineHours', { n: c.plazoHoras })}`,
        ...(c.nota ? [`  ${t('verification.note', { texto: c.nota.texto })}`] : []),
        ...c.señales.map(s => `  - ${s.id} · ${t(KIND_TEXT[s.tipo])} · ${s.estado} · ${s.que} · ${t('verification.where', { donde: s.donde })}${s.base ? ' · ' + t('verification.baseline', { base: s.base }) : ''}${s.evidencia ? ' · ' + t('verification.evidence', { texto: s.evidencia.texto }) : ''}`),
      ];
    }),
  ].join('\n');
}
