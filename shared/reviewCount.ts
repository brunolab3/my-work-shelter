// La cuenta de lo que queda por contestar en un PR tuyo: los hilos de revisión sin resolver y los resúmenes de revisión
// (el texto general de una revisión que pide cambios o comenta) sin respuesta tuya. Para no descartar una revisión ni
// volver a pedirla con algo sin contestar. Puro: lo usan el servidor (server/prReviews.ts), el tablero de despliegue
// y las pruebas. Entra el nodo PullRequest de GraphQL tal cual (REVIEWS_QUERY).

export interface ReviewLedger {
  unresolved: number;            // hilos sin resolver que abrió otro (los tuyos, notas propias, no cuentan)
  outdated: number;              // de esos, los que se quedaron atrás porque el código cambió: hay que contestarlos o resolverlos igual
  unansweredSummaries: number;   // resúmenes de revisión de otros (pide cambios o comenta, con texto) sin respuesta tuya después
}

// lo que no pide nada: un visto bueno, un agradecimiento o un emoji («LGTM», «Thanks!», «👍», «Gracias, perfecto»).
// Solo si es corto y no lleva pregunta: con eso no hay plan que hacer
const COURTESY = /^(lgtm|looks good( to me)?|lg|thanks?( a lot| you( so much)?)?|thx|ty|nice( work| job| one)?|great( work| job)?|good (work|job|catch|stuff)|well done|awesome|cool|perfect|ship ?it|approved?|ok(ay)?|done|resolved|\+1|gracias|muchas gracias|perfecto|genial|vale|bien|buen trabajo|ok gracias|todo bien|aprobado|de acuerdo)$/;
export function withoutNothingThatMake(cuerpo: string): boolean {
  const t = cuerpo.toLowerCase().replace(/@[\w-]+/g, ' ').replace(/:[a-z0-9_+-]+:/g, ' ').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, ' ');
  if (t.includes('?') || t.length > 80) return false;
  const partes = t.split(/[\n.,;!¡]+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return partes.every(x => COURTESY.test(x));
}

// los bots esconden sus marcas en comentarios HTML (<!-- ci-status: … -->): fuera
export const cleanBody = (b: unknown) => String(b ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
const when = (s: unknown) => { const t = Date.parse(String(s ?? '')); return Number.isFinite(t) ? t : 0; };
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** ¿Contesta este texto tuyo a esa revisión? Si nombra a quien la hizo (@login), enlaza la revisión o cita una línea suya
 *  (« > …»). GitHub no enlaza las respuestas a un resumen: sin una de esas tres, no se sabe a qué contesta */
export function answersReview(texto: string, review: { login: string; url?: string; cuerpo: string }): boolean {
  const t = texto.toLowerCase();
  if (new RegExp(`@${review.login.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i').test(texto)) return true;
  const ancla = /#pullrequestreview-\d+/.exec(review.url ?? '')?.[0];
  if (ancla && t.includes(ancla)) return true;
  const cuerpo = norm(review.cuerpo);
  return texto.split('\n').some(l => { const m = /^\s*>\s?(.*)$/.exec(l); const c = m ? norm(m[1]) : ''; return c.length >= 10 && cuerpo.includes(c); });
}

/** La cuenta de un PR (nodo PullRequest de GraphQL con reviewThreads, reviews y comments), siendo `author` su autor */
export function reviewLedger(n: any, author: string): ReviewLedger {
  const yo = author.toLowerCase();
  const otro = (a: any) => !!a?.login && String(a.login).toLowerCase() !== yo;
  const mio = (a: any) => !!a?.login && String(a.login).toLowerCase() === yo;
  let unresolved = 0, outdated = 0;
  for (const h of n?.reviewThreads?.nodes ?? []) {
    if (!h || h.isResolved) continue;
    const abre = h.primero?.nodes?.[0] ?? h.comments?.nodes?.[0];
    if (!otro(abre?.author)) continue;
    unresolved++; if (h.isOutdated) outdated++;
  }
  // lo tuyo con texto, con su fecha: comentarios de la conversación y tus propias revisiones
  const tuyo = [
    ...(n?.comments?.nodes ?? []).filter((c: any) => mio(c?.author)).map((c: any) => ({ texto: cleanBody(c.body), fecha: when(c.createdAt) })),
    ...(n?.reviews?.nodes ?? []).filter((r: any) => mio(r?.author)).map((r: any) => ({ texto: cleanBody(r.body), fecha: when(r.submittedAt) })),
  ].filter(x => x.texto);
  let unansweredSummaries = 0;
  for (const r of n?.reviews?.nodes ?? []) {
    if (!r || !otro(r.author) || !['CHANGES_REQUESTED', 'COMMENTED'].includes(r.state)) continue;
    const cuerpo = cleanBody(r.body);
    if (!cuerpo || withoutNothingThatMake(cuerpo)) continue;
    const desde = when(r.submittedAt), rev = { login: String(r.author.login), url: r.url, cuerpo };
    if (!tuyo.some(x => x.fecha > desde && answersReview(x.texto, rev))) unansweredSummaries++;
  }
  return { unresolved, outdated, unansweredSummaries };
}

/** Un hilo de revisión sin resolver que abrió otro: dónde, quién, su primera línea y su enlace */
export interface ReviewThread { archivo: string; linea?: number; autor: string; texto: string; url: string; outdated: boolean }
/** Los hilos sin resolver de un PR (los mismos que cuenta reviewLedger), siendo `author` su autor */
export function openThreads(n: any, author: string): ReviewThread[] {
  const yo = author.toLowerCase(), out: ReviewThread[] = [];
  for (const h of n?.reviewThreads?.nodes ?? []) {
    if (!h || h.isResolved) continue;
    const abre = h.primero?.nodes?.[0] ?? h.comments?.nodes?.[0];
    const login = abre?.author?.login ? String(abre.author.login) : '';
    if (!login || login.toLowerCase() === yo) continue;
    const texto = cleanBody(abre?.body ?? h.comments?.nodes?.[0]?.body).split('\n').map((l: string) => l.trim()).find(Boolean) ?? '';
    out.push({ archivo: String(h.path ?? ''), linea: Number(h.line) || undefined, autor: login, texto: texto.length > 160 ? texto.slice(0, 159) + '…' : texto,
      url: String(abre?.url ?? h.comments?.nodes?.[0]?.url ?? n?.url ?? ''), outdated: !!h.isOutdated });
  }
  return out;
}

/** ¿Queda algo por contestar? */
export const ledgerPending = (l?: ReviewLedger) => !!l && (l.unresolved > 0 || l.unansweredSummaries > 0);
