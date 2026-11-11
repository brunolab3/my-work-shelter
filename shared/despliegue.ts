// Tablero de despliegue de la sala de planificación: tus PR por estado, los bloqueos entre ellos y el orden en que se
// pueden fusionar y desplegar. Un PR espera a otro si va apilado encima (su base es la rama del otro), si su descripción
// lo dice («depends on #12», «bloqueado por org/repo#7», el enlace al PR…), si el plan repartido de su tarea dice que su
// repo espera a otro (la parte de una sala «espera_a» la de otra: server/planes.ts) o si el Supervisor lo marca a mano.
// Los PR de una misma tarea en repos distintos sin orden conocido van enlazados («misma tarea»), sin bloquearse.
// Puro: lo usan el cliente, el servidor y las pruebas.
import type { PRBoard } from './tablero';
import { textKey } from './tareas';
import { t } from './idioma';

export type BlockerReason = 'pila' | 'texto' | 'plan' | 'manual';
/** `de` espera a `por` (las dos, URL de PR) */
export interface Blocker { de: string; por: string; motivo: BlockerReason }
export interface BlockerManual { de: string; por: string }
/** Del plan repartido de una tarea: en ella, lo del repo `repo` («org/repo») espera a lo de los repos `esperaA` */
export interface TaskOrder { clave: string; repo: string; waitA: string[] }

export type DeploymentColumn = 'borrador' | 'revision' | 'cambios' | 'aprobado' | 'fusionado';
export const DEPLOYMENT_COLUMNS: { id: DeploymentColumn; nombre: string }[] = [
  { id: 'borrador', nombre: 'Borrador' }, { id: 'revision', nombre: 'En revisión' }, { id: 'cambios', nombre: 'Piden cambios' },
  { id: 'aprobado', nombre: 'Aprobado' }, { id: 'fusionado', nombre: 'Fusionado' },
];
export function columnaDespliegue(p: PRBoard): DeploymentColumn | null {
  if (p.estado === 'cerrado') return null;
  if (p.estado === 'fusionado') return 'fusionado';
  if (p.estado === 'borrador') return 'borrador';
  return p.revision === 'APPROVED' ? 'aprobado' : p.revision === 'CHANGES_REQUESTED' ? 'cambios' : 'revision';
}

// «org/repo#12» de una referencia escrita en la descripción; sin repo, el del propio PR
const WORDS = String.raw`(?:depends\s+on|depend(?:s|e)\s+(?:on|de)|blocked\s+by|bloquead[oa]\s+por|requires|requiere|needs|necesita|after|despu[eé]s\s+de|merge\s+after|stacked\s+on|apilad[oa]\s+(?:sobre|en))`;
const REF = String.raw`(?:https://github\.com/([\w.-]+/[\w.-]+)/pull/(\d+)|([\w.-]+/[\w.-]+)?#(\d+))`;
// una frase que habla de lo que tiene que ir antes («Merge with or after …», «Merge order: … must be in production
// first», «Blocked on …», una lista bajo «Blockers:»): cuentan todas las referencias de la frase, también las ramas entre
// comillas invertidas (`feature/ABC-12-algo`), que se cruzan con la rama de otro PR del tablero
const BLOCKER_PHRASE = /\b(?:depends?\s+on|blocked\s+(?:by|on)|blockers?|bloquead[oa]\s+por|bloqueos?|waits?\s+(?:for|on)|espera\s+a|stacked\s+on|apilad[oa]\s+(?:sobre|en)|(?:merge|deploy|release)[a-z]*\s+(?:(?:with\s+or|together\s+with\s+or)\s+)?after|merge\s+order|orden\s+de\s+(?:fusi[oó]n|despliegue)|(?:must|has\s+to|needs?\s+to|should)\s+(?:be\s+|go\s+)?(?:merged\s+|deployed\s+|released\s+|live\s+|in\s+production\s+|out\s+)?first|(?:that|this)\s+one\s+first|antes\s+que\s+(?:este|esta)|(?:do\s+not|don'?t|never|cannot|can'?t)\s+(?:be\s+)?(?:merge|deploy|release)[a-z]*\s+(?:before|until)|only\s+(?:be\s+)?(?:merged\s+|deployed\s+|released\s+)?after|until\b[^.]*\b(?:merged|in\s+production|deployed|live|released|ships?)|no\s+(?:se\s+)?(?:fusion|despleg|mezcl)[a-z]*\s+(?:hasta|antes)|hasta\s+que)\b/i;
const WITHOUT_ORDER = /\b(?:before\s+or\s+after|in\s+any\s+order|either\s+order|antes\s+o\s+despu[eé]s|en\s+cualquier\s+orden)\b/i;
const BRANCH = /`([\w.-]+(?:\/[\w.-]+)+|[A-Za-z][A-Za-z0-9]+-\d+[\w.-]*)`/g;
/** Los PR de los que dice depender un texto (descripción o título), normalizados como «org/repo#N» o, si lo nombra por
 *  su rama, «rama:<rama>», sin repetir */
export function dependenciasEnTexto(texto: string, repo: string): string[] {
  const out: string[] = [];
  const poner = (r: string) => { if (!out.includes(r)) out.push(r); };
  const refs = (t: string) => { for (const r of t.matchAll(new RegExp(REF, 'g'))) poner(r[1] ? `${r[1]}#${Number(r[2])}` : `${r[3] ?? repo}#${Number(r[4])}`); };
  const frase = new RegExp(WORDS + String.raw`\s*:?\s*((?:` + REF + String.raw`[\s,;y&and]*)+)`, 'gi');
  for (const m of (texto ?? '').matchAll(frase)) refs(m[1]);
  // por frases (y la lista que cuelga de un «Blockers:» o «Depends on:» sin referencias en su propia línea)
  let lista = false;
  for (const linea of (texto ?? '').split('\n')) {
    const item = /^\s*(?:[-*+]|\d+[.)])\s+/.test(linea);
    if (lista && !item) lista = false;
    if (lista) { refs(linea); for (const r of linea.matchAll(BRANCH)) poner('rama:' + r[1]); continue; }
    for (const f of linea.split(/(?<=[.!?])\s+(?=[^a-z\s])/)) {
      if (!BLOCKER_PHRASE.test(f) || WITHOUT_ORDER.test(f)) continue;
      const antes = out.length;
      refs(f); for (const r of f.matchAll(BRANCH)) poner('rama:' + r[1]);
      if (out.length === antes && !item && /:\s*$/.test(f.replace(/[*_`\s]+$/, ''))) lista = true;   // «…in production:**»
    }
  }
  return out;
}
export const refPR = (p: Pick<PRBoard, 'repo' | 'numero'>) => `${p.repo}#${p.numero}`;
/** La clave de Jira de un PR (rama, luego título), sin el PR-<número> de reserva: ese no junta repos distintos */
export const pRKey = (p: Pick<PRBoard, 'rama' | 'titulo'>) => textKey(p.rama) ?? textKey(p.titulo);
const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Todos los bloqueos entre los PR del tablero (los que apuntan a PR que no están en él no cuentan), sin repetir */
export function bloqueosEntre(prs: PRBoard[], manuales: BlockerManual[] = [], orden: TaskOrder[] = []): Blocker[] {
  const byRef = new Map(prs.map(p => [refPR(p), p]));
  const urls = new Set(prs.map(p => p.url));
  const out: Blocker[] = [];
  const poner = (de: string, por: string, motivo: BlockerReason) => { if (de !== por && !out.some(b => b.de === de && b.por === por)) out.push({ de, por, motivo }); };
  for (const p of prs) {
    // apilado: su base es la rama de otro PR del mismo repo (que no esté ya fusionado: entonces la base ya es la buena)
    if (p.base) for (const q of prs) if (q !== p && q.repo === p.repo && q.rama === p.base && q.estado !== 'cerrado') poner(p.url, q.url, 'pila');
    for (const ref of p.dependencias ?? []) {
      // por su rama (de cualquier repo del tablero), mejor uno sin cerrar
      const q = ref.startsWith('rama:') ? prs.filter(x => x !== p && x.rama === ref.slice(5)).sort((a, b) => Number(a.estado === 'cerrado') - Number(b.estado === 'cerrado'))[0] : byRef.get(ref);
      if (q) poner(p.url, q.url, 'texto');
    }
    // el orden del plan de su tarea: espera a los PR de la misma tarea en los repos a los que espera el suyo
    const clave = pRKey(p);
    for (const o of orden) if (clave && o.clave.toUpperCase() === clave && sameRepo(o.repo, p.repo))
      for (const q of prs) if (q !== p && q.estado !== 'cerrado' && pRKey(q) === clave && o.waitA.some(r => sameRepo(r, q.repo))) poner(p.url, q.url, 'plan');
  }
  for (const m of manuales) if (urls.has(m.de) && urls.has(m.por)) poner(m.de, m.por, 'manual');
  return out;
}

/** Los PR de una misma tarea en repos distintos que no tienen ningún bloqueo entre ellos (sin cerrar): van enlazados,
 *  sin orden, para que se vea que son la misma tarea (el orden lo pone el plan o se marca a mano) */
export function taskLinks(prs: PRBoard[], bloqueos: Blocker[]): { a: string; b: string; clave: string }[] {
  const live = prs.filter(p => p.estado !== 'cerrado');
  const out: { a: string; b: string; clave: string }[] = [];
  live.forEach((p, i) => {
    const clave = pRKey(p); if (!clave) return;
    for (const q of live.slice(i + 1)) if (pRKey(q) === clave && !sameRepo(p.repo, q.repo)
      && !bloqueos.some(b => (b.de === p.url && b.por === q.url) || (b.de === q.url && b.por === p.url))) out.push({ a: p.url, b: q.url, clave });
  });
  return out;
}

/** El orden de despliegue de lo que queda por fusionar: olas (lo de cada ola puede ir a la vez; cada una espera a las
 *  anteriores). Lo ya fusionado no espera a nadie ni bloquea; un PR cerrado sin fusionar tampoco. Los PR en un ciclo de
 *  bloqueos quedan fuera, en `ciclo`. */
export function olasDespliegue(prs: PRBoard[], bloqueos: Blocker[]): { waves: PRBoard[][]; ciclo: PRBoard[] } {
  const pendientes = prs.filter(p => p.estado === 'abierto' || p.estado === 'borrador');
  const vivo = new Set(pendientes.map(p => p.url));
  const espera = new Map(pendientes.map(p => [p.url, new Set(bloqueos.filter(b => b.de === p.url && vivo.has(b.por)).map(b => b.por))]));
  const waves: PRBoard[][] = [];
  let remain = pendientes;
  while (remain.length) {
    const ola = remain.filter(p => espera.get(p.url)!.size === 0);
    if (!ola.length) break;
    waves.push(ola);
    for (const p of ola) for (const s of espera.values()) s.delete(p.url);
    remain = remain.filter(p => !ola.includes(p));
  }
  return { waves, ciclo: remain };
}

/** El tablero como texto, para pedirle a la sala de planificación el plan de despliegue */
export function deploymentText(prs: PRBoard[], bloqueos: Blocker[]): string {
  const byUrl = new Map(prs.map(p => [p.url, p]));
  const { waves, ciclo } = olasDespliegue(prs, bloqueos);
  const links = taskLinks(prs, bloqueos);
  const linea = (p: PRBoard) => {
    const esp = bloqueos.filter(b => b.de === p.url).map(b => byUrl.get(b.por)).filter(Boolean).map(q => refPR(q!) + (q!.estado === 'fusionado' ? t('prompt.deploy.mergedMark') : ''));
    const junto = links.filter(e => e.a === p.url || e.b === p.url).map(e => byUrl.get(e.a === p.url ? e.b : e.a)!).map(refPR);
    return t('prompt.deploy.line', { pr: refPR(p), titulo: p.titulo ?? '', columna: columnaDespliegue(p) ?? '', ci: p.checks ? ' · CI ' + p.checks : '', espera: esp.length ? t('prompt.deploy.waitsFor', { prs: esp.join(', ') }) : '', junto: junto.length ? t('prompt.deploy.sameTask', { clave: pRKey(p) || '', prs: junto.join(', ') }) : '', url: p.url });
  };
  return [
    t('prompt.deploy.pending'),
    ...waves.flatMap((o, i) => [t('prompt.deploy.wave', { n: i + 1 }), ...o.map(linea)]),
    ...(ciclo.length ? [t('prompt.deploy.cycle'), ...ciclo.map(linea)] : []),
    '',
    t('prompt.deploy.merged'),
    ...prs.filter(p => p.estado === 'fusionado').map(linea),
  ].join('\n');
}

/** Lo que recibe el habitante de la sala de planificación al pedirle el plan de despliegue */
export function promptDeployment(prs: PRBoard[], bloqueos: Blocker[]): string {
  return [t('prompt.deploy.title'), '', deploymentText(prs, bloqueos), '', '---', t('prompt.deploy.steps')].join('\n');
}
