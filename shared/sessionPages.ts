// Las páginas de una conversación: los planes, informes y comparaciones (HTML o Markdown del Mac) que ha enlazado el
// habitante. El intercomunicador las lista (Dialog.tsx) para saber cuáles quedan por revisar: una página está
// contestada cuando el Supervisor le ha mandado notas o la ha validado después de la última vez que se enlazó (si el
// habitante la vuelve a enlazar, tras cambiarla, queda otra vez por revisar). Puro: lo usan el cliente y las pruebas.

/** Lo que el Supervisor ha hecho con una página: mandarle notas, validarla sin notas o quitarla de la lista (vuelve si
 *  se enlaza otra vez) */
export interface PageAnswer { state: 'notes' | 'validated' | 'quitada'; ts: number }
export interface SessionPage { path: string; name: string; ts: number; answer?: PageAnswer }

const OF_PAGE = /\.(html?|md|markdown)$/i;
/** Images the game shows itself (thumbnails in replies, the «Página» window): the ones Chromium draws. HEIC, TIFF and
 *  PDF still open in Preview (server/open.ts) */
export const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
// [texto](/Users/…), [texto](<…con espacios…>), [texto](file:///…) y la ruta suelta (sin espacios)
const SEG = `[^\\s/<>()[\\]"'\`»]+`;
// también las carpetas temporales del Mac (/tmp, /private/tmp, /var/folders): ahí deja Claude Code sus páginas a veces
const START = '(?:\\/Users\\/|~\\/|file:\\/\\/\\/|\\/(?:private\\/)?tmp\\/|\\/(?:private\\/)?var\\/folders\\/)';
// [texto](<ruta>) · [texto](ruta, también con espacios si es una página) · una página suelta en una carpeta con espacios
// (como «Application Support») · cualquier otra ruta suelta
const LINK = new RegExp([
  `\\]\\(\\s*<(${START}[^>\\n]+)>\\s*\\)`,
  `\\]\\(\\s*(${START}[^)\\n]+?)\\s*\\)`,
  `(?<=^|[\\s(*_\`«"'])(${START}(?:${SEG}(?: ${SEG})*\\/)*${SEG}\\.(?:html?|md|markdown)(?![\\w-]))`,
  `(?<=^|[\\s(*_\`«"'])(${START}${SEG})`,
].join('|'), 'g');

/** La ruta de un enlace tal como la lee el servidor (file:// y %20 fuera) */
export function normalizePath(link: string): string {
  let r = link.trim().replace(/[.,;:!?]+$/, '');
  if (/^file:\/\//i.test(r)) r = r.replace(/^file:\/\//i, '');
  try { r = decodeURI(r); } catch {}
  return r.replace(/#.*$/, '').replace(/\/{2,}/g, '/');
}

/** Las páginas (HTML o Markdown) que enlaza un texto, sin repetir */
export function pagesInText(text: string): string[] {
  const out: string[] = [];
  for (const m of (text ?? '').matchAll(LINK)) {
    const r = normalizePath(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '');
    if (OF_PAGE.test(r) && !out.includes(r)) out.push(r);
  }
  return out;
}

// Una página con ruta relativa («tmp/informe.md», `docs/plan.html`): Claude Code las escribe así a menudo, relativas a
// la carpeta donde trabaja. Con esa carpeta, se convierten en enlaces a su ruta completa (en el texto, en código en línea
// y como destino de un enlace), para poder abrirlas y que salgan en las páginas de la conversación. Nunca dentro de un
// bloque de código, ni rutas con «..»; si el archivo no existe, la lista de páginas no la enseña.
const REL = String.raw`(?:\.\/)?(?:[\w@][\w@.-]*\/)*[\w@][\w@.-]*\.(?:html?|md|markdown)`;
const END = String.raw`(?![\w/-]|\.\w)`;
const BARE = new RegExp(String.raw`(?<=^|[\s«"'*_])(${REL})${END}(?![^\[\]\n]*\]\()`, 'g');
const TARGET = new RegExp(String.raw`\]\(\s*<?(${REL})>?\s*\)`, 'g');
const CODE = new RegExp(String.raw`^\x60(${REL})\x60$`);
// lo que ya es una ruta completa o una web (suelta o como destino de un enlace) no se toca: dentro, «_plan.md» de
// «/…/ABC-1_plan.md» parecería una página relativa
const ABSOLUTE = /(\]\(\s*<(?:\/|~\/|[a-z]+:)[^>\n]*>\s*\)|\]\(\s*(?:\/|~\/|[a-z]+:)[^)\n]*\)|(?<![\w.@-])(?:\/|~\/|[a-z]+:\/\/)[^\s)>\]]*)/gi;

/** El texto con las páginas de ruta relativa enlazadas a su ruta en `base` (la carpeta de la conversación) */
export function relativeLinks(text: string, base?: string): string {
  if (!text || !base) return text ?? '';
  const abs = (rel: string) => `${base.replace(/\/+$/, '')}/${rel.replace(/^\.\//, '')}`;
  // fuera de los bloques de código; dentro de cada trozo, el código en línea por un lado y el texto por otro
  return text.split(/(^```[\s\S]*?^```)/m).map((chunk, i) => i % 2 ? chunk : chunk.split(/(\x60[^\x60\n]+\x60)/).map((x, j, l) => {
    if (j % 2) { const m = CODE.exec(x); return m && !l[j - 1].endsWith('[') ? `[${x}](<${abs(m[1])}>)` : x; }
    const inside = (y: string) => { const r = [...y.matchAll(ABSOLUTE)].map(m => [m.index!, m.index! + m[0].length]); return (i: number) => r.some(([a, b]) => i >= a && i < b); };
    const d1 = inside(x), y = x.replace(TARGET, (m, rel, i) => d1(i) ? m : `](<${abs(rel)}>)`);
    const d2 = inside(y);
    return y.replace(BARE, (m, rel, i) => d2(i) ? m : `[${rel}](<${abs(rel)}>)`);
  }).join('')).join('');
}

/** Si dos rutas son la misma página: la del enlace puede ir con ~ y la del servidor es la real (/private/tmp por /tmp) */
export function samePage(a: string, b: string): boolean {
  const n = (x: string) => normalizePath(x).replace(/^\/private(?=\/(tmp|var)\/)/, '');
  const x = n(a), y = n(b);
  if (x === y) return true;
  const home = (r: string, other: string) => r.startsWith('~/') && /^\/Users\/[^/]+\//.test(other) && other.replace(/^\/Users\/[^/]+/, '~') === r;
  return home(x, y) || home(y, x);
}

/** Si una entrada cuenta para las páginas de la conversación: lo que escribe el habitante, sus preguntas (la respuesta
 *  las lleva; «¿la subo? La comparación está en …») y lo que le llega de otra sala (el plan o los documentos que
 *  acompañan a un encargo, server/roomNotices.ts: empieza por 📨) */
export const linksPages = (e: { type: string; text: string; question?: boolean }) => e.type === 'asistente' || (e.type === 'usuario' && (!!e.question || e.text.startsWith('📨')));

/** Una pregunta del habitante aún sin contestar, como entrada para las páginas: lo que enlaza sale ya en la lista, que
 *  es cuando hace falta (la comparación que pide aprobar) */
export const questionInput = (questions: { question: string; options?: { label: string; description?: string }[] }[], ts: number) =>
  ({ id: 'question', type: 'asistente' as const, ts, text: questions.map(q => [q.question, ...(q.options ?? []).map(o => o.description ?? '')].join('\n')).join('\n\n') });

/** Las páginas de una conversación (lo que ha escrito el habitante o le ha llegado de otra sala), la enlazada más tarde
 *  primero, con lo que se ha hecho con cada una */
export function sessionPages(entries: { type: string; text: string; ts: number; question?: boolean }[], answers: Record<string, PageAnswer>, base?: string): SessionPage[] {
  const last = new Map<string, number>();
  for (const e of entries) if (linksPages(e)) for (const r of pagesInText(relativeLinks(e.text, base))) last.set(r, Math.max(last.get(r) ?? 0, e.ts));
  return [...last].map(([path, ts]) => {
    const key = Object.keys(answers).find(k => samePage(k, path));
    const r = key ? answers[key] : undefined;
    return { path, name: path.split('/').pop() || path, ts, ...(r && r.ts >= ts ? { answer: r } : {}) };
  }).filter(p => p.answer?.state !== 'quitada').sort((a, b) => b.ts - a.ts);
}

/** A handoff (server/handoff.ts): the old conversation's answers carried into the new one's (`into`). An answer the
 *  new one already gave to that page stays when it is as recent; `into` itself when nothing changes */
export function carryAnswers(from: Record<string, PageAnswer> | undefined, into: Record<string, PageAnswer> | undefined): Record<string, PageAnswer> {
  const out = { ...into };
  let changed = false;
  for (const [path, r] of Object.entries(from ?? {})) {
    const key = Object.keys(out).find(k => samePage(k, path));
    if (key && out[key].ts >= r.ts) continue;
    if (key) delete out[key];
    out[path] = r; changed = true;
  }
  return changed ? out : into ?? {};
}

/** Las que se listan: las que siguen en el Mac (`existen`: las rutas que el servidor ha encontrado; sin saberlo aún,
 *  todas), las ya contestadas solo si se enlazaron en las dos últimas semanas y las pendientes durante el mes que se
 *  recuerdan las respuestas (Browsers.tsx). Las de un worktree ya quitado desaparecen solas */
export const PAGES_DAYS = 14;
export const PENDING_PAGES_DAYS = 30;
export const livePages = (l: SessionPage[], existing: Set<string> | null, now = Date.now()) =>
  l.filter(p => p.ts >= now - (p.answer ? PAGES_DAYS : PENDING_PAGES_DAYS) * 86_400_000 && (!existing || existing.has(p.path)));

/** Las que quedan por revisar */
export const pendingPages = (l: SessionPage[]) => l.filter(p => !p.answer);

/** Un enlace Markdown a una ruta que siempre se lee entero (con espacios, como «Application Support») */
export const pageLink = (path: string, text = path.split('/').pop() || path) => `[${text.replace(/[[\]]/g, '')}](${/[\s()<>]/.test(path) ? `<${path}>` : path})`;
