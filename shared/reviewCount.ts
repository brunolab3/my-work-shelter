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
export function withoutNothingThatMake(body: string): boolean {
  const t = body.toLowerCase().replace(/@[\w-]+/g, ' ').replace(/:[a-z0-9_+-]+:/g, ' ').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, ' ');
  if (t.includes('?') || t.length > 80) return false;
  const parts = t.split(/[\n.,;!¡]+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return parts.every(x => COURTESY.test(x));
}

// los bots esconden sus marcas en comentarios HTML (<!-- ci-status: … -->): fuera
export const cleanBody = (b: unknown) => String(b ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
const when = (s: unknown) => { const t = Date.parse(String(s ?? '')); return Number.isFinite(t) ? t : 0; };
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** ¿Contesta este texto tuyo a esa revisión? Si nombra a quien la hizo (@login), enlaza la revisión o cita una línea suya
 *  (« > …»). GitHub no enlaza las respuestas a un resumen: sin una de esas tres, no se sabe a qué contesta */
export function answersReview(text: string, review: { login: string; url?: string; body: string }): boolean {
  const t = text.toLowerCase();
  if (new RegExp(`@${review.login.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i').test(text)) return true;
  const anchor = /#pullrequestreview-\d+/.exec(review.url ?? '')?.[0];
  if (anchor && t.includes(anchor)) return true;
  const body = norm(review.body);
  return text.split('\n').some(l => { const m = /^\s*>\s?(.*)$/.exec(l); const c = m ? norm(m[1]) : ''; return c.length >= 10 && body.includes(c); });
}

/** La cuenta de un PR (nodo PullRequest de GraphQL con reviewThreads, reviews y comments), siendo `author` su autor */
export function reviewLedger(n: any, author: string): ReviewLedger {
  const me = author.toLowerCase();
  const other = (a: any) => !!a?.login && String(a.login).toLowerCase() !== me;
  const isMine = (a: any) => !!a?.login && String(a.login).toLowerCase() === me;
  let unresolved = 0, outdated = 0;
  for (const h of n?.reviewThreads?.nodes ?? []) {
    if (!h || h.isResolved) continue;
    const opener = h.first?.nodes?.[0] ?? h.comments?.nodes?.[0];
    if (!other(opener?.author)) continue;
    unresolved++; if (h.isOutdated) outdated++;
  }
  // lo tuyo con texto, con su fecha: comentarios de la conversación y tus propias revisiones
  const yours = [
    ...(n?.comments?.nodes ?? []).filter((c: any) => isMine(c?.author)).map((c: any) => ({ text: cleanBody(c.body), date: when(c.createdAt) })),
    ...(n?.reviews?.nodes ?? []).filter((r: any) => isMine(r?.author)).map((r: any) => ({ text: cleanBody(r.body), date: when(r.submittedAt) })),
  ].filter(x => x.text);
  let unansweredSummaries = 0;
  for (const r of n?.reviews?.nodes ?? []) {
    if (!r || !other(r.author) || !['CHANGES_REQUESTED', 'COMMENTED'].includes(r.state)) continue;
    const body = cleanBody(r.body);
    if (!body || withoutNothingThatMake(body)) continue;
    const since = when(r.submittedAt), rev = { login: String(r.author.login), url: r.url, body };
    if (!yours.some(x => x.date > since && answersReview(x.text, rev))) unansweredSummaries++;
  }
  return { unresolved, outdated, unansweredSummaries };
}

/** Un hilo de revisión sin resolver que abrió otro: dónde, quién, su primera línea y su enlace */
export interface ReviewThread { file: string; line?: number; author: string; text: string; url: string; outdated: boolean }
/** Los hilos sin resolver de un PR (los mismos que cuenta reviewLedger), siendo `author` su autor */
export function openThreads(n: any, author: string): ReviewThread[] {
  const me = author.toLowerCase(), out: ReviewThread[] = [];
  for (const h of n?.reviewThreads?.nodes ?? []) {
    if (!h || h.isResolved) continue;
    const opener = h.first?.nodes?.[0] ?? h.comments?.nodes?.[0];
    const login = opener?.author?.login ? String(opener.author.login) : '';
    if (!login || login.toLowerCase() === me) continue;
    const text = cleanBody(opener?.body ?? h.comments?.nodes?.[0]?.body).split('\n').map((l: string) => l.trim()).find(Boolean) ?? '';
    out.push({ file: String(h.path ?? ''), line: Number(h.line) || undefined, author: login, text: text.length > 160 ? text.slice(0, 159) + '…' : text,
      url: String(opener?.url ?? h.comments?.nodes?.[0]?.url ?? n?.url ?? ''), outdated: !!h.isOutdated });
  }
  return out;
}

/** ¿Queda algo por contestar? */
export const ledgerPending = (l?: ReviewLedger) => !!l && (l.unresolved > 0 || l.unansweredSummaries > 0);
