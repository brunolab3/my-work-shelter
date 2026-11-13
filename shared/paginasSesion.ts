// Las páginas de una conversación: los planes, informes y comparaciones (HTML o Markdown del Mac) que ha enlazado el
// habitante. El intercomunicador las lista (Dialogo.tsx) para saber cuáles quedan por revisar: una página está
// contestada cuando el Supervisor le ha mandado notas o la ha validado después de la última vez que se enlazó (si el
// habitante la vuelve a enlazar, tras cambiarla, queda otra vez por revisar). Puro: lo usan el cliente y las pruebas.

/** Lo que el Supervisor ha hecho con una página: mandarle notas, validarla sin notas o quitarla de la lista (vuelve si
 *  se enlaza otra vez) */
export interface PageAnswer { estado: 'notas' | 'validada' | 'quitada'; ts: number }
export interface SessionPage { ruta: string; nombre: string; ts: number; respuesta?: PageAnswer }

const OF_PAGE = /\.(html?|md|markdown)$/i;
// [texto](/Users/…), [texto](<…con espacios…>), [texto](file:///…) y la ruta suelta (sin espacios)
const SEG = `[^\\s/<>()[\\]"'\`»]+`;
const START = '(?:\\/Users\\/|~\\/|file:\\/\\/\\/)';
// [texto](<ruta>) · [texto](ruta, también con espacios si es una página) · una página suelta en una carpeta con espacios
// (como «Application Support») · cualquier otra ruta suelta
const LINK = new RegExp([
  `\\]\\(\\s*<(${START}[^>\\n]+)>\\s*\\)`,
  `\\]\\(\\s*(${START}[^)\\n]+?)\\s*\\)`,
  `(?<=^|[\\s(*_\`«"'])(${START}(?:${SEG}(?: ${SEG})*\\/)*${SEG}\\.(?:html?|md|markdown)(?![\\w-]))`,
  `(?<=^|[\\s(*_\`«"'])(${START}${SEG})`,
].join('|'), 'g');

/** La ruta de un enlace tal como la lee el servidor (file:// y %20 fuera) */
export function normalizePath(enlace: string): string {
  let r = enlace.trim().replace(/[.,;:!?]+$/, '');
  if (/^file:\/\//i.test(r)) r = r.replace(/^file:\/\//i, '');
  try { r = decodeURI(r); } catch {}
  return r.replace(/#.*$/, '').replace(/\/{2,}/g, '/');
}

/** Las páginas (HTML o Markdown) que enlaza un texto, sin repetir */
export function pagesInText(texto: string): string[] {
  const out: string[] = [];
  for (const m of (texto ?? '').matchAll(LINK)) {
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
export function relativeLinks(texto: string, base?: string): string {
  if (!texto || !base) return texto ?? '';
  const abs = (rel: string) => `${base.replace(/\/+$/, '')}/${rel.replace(/^\.\//, '')}`;
  // fuera de los bloques de código; dentro de cada trozo, el código en línea por un lado y el texto por otro
  return texto.split(/(^```[\s\S]*?^```)/m).map((trozo, i) => i % 2 ? trozo : trozo.split(/(\x60[^\x60\n]+\x60)/).map((x, j, l) => {
    if (j % 2) { const m = CODE.exec(x); return m && !l[j - 1].endsWith('[') ? `[${x}](<${abs(m[1])}>)` : x; }
    const dentro = (y: string) => { const r = [...y.matchAll(ABSOLUTE)].map(m => [m.index!, m.index! + m[0].length]); return (i: number) => r.some(([a, b]) => i >= a && i < b); };
    const d1 = dentro(x), y = x.replace(TARGET, (m, rel, i) => d1(i) ? m : `](<${abs(rel)}>)`);
    const d2 = dentro(y);
    return y.replace(BARE, (m, rel, i) => d2(i) ? m : `[${rel}](<${abs(rel)}>)`);
  }).join('')).join('');
}

/** Si dos rutas son la misma página: la del enlace puede ir con ~ y la del servidor es la real (/private/tmp por /tmp) */
export function samePage(a: string, b: string): boolean {
  const n = (x: string) => normalizePath(x).replace(/^\/private(?=\/(tmp|var)\/)/, '');
  const x = n(a), y = n(b);
  if (x === y) return true;
  const casa = (r: string, otra: string) => r.startsWith('~/') && /^\/Users\/[^/]+\//.test(otra) && otra.replace(/^\/Users\/[^/]+/, '~') === r;
  return casa(x, y) || casa(y, x);
}

/** Si una entrada cuenta para las páginas de la conversación: lo que escribe el habitante, sus preguntas (la respuesta
 *  las lleva; «¿la subo? La comparación está en …») y lo que le llega de otra sala (el plan o los documentos que
 *  acompañan a un encargo, server/avisosSalas.ts: empieza por 📨) */
export const linksPages = (e: { tipo: string; texto: string; pregunta?: boolean }) => e.tipo === 'asistente' || (e.tipo === 'usuario' && (!!e.pregunta || e.texto.startsWith('📨')));

/** Una pregunta del habitante aún sin contestar, como entrada para las páginas: lo que enlaza sale ya en la lista, que
 *  es cuando hace falta (la comparación que pide aprobar) */
export const questionInput = (preguntas: { question: string; options?: { label: string; description?: string }[] }[], ts: number) =>
  ({ id: 'pregunta', tipo: 'asistente' as const, ts, texto: preguntas.map(q => [q.question, ...(q.options ?? []).map(o => o.description ?? '')].join('\n')).join('\n\n') });

/** Las páginas de una conversación (lo que ha escrito el habitante o le ha llegado de otra sala), la enlazada más tarde
 *  primero, con lo que se ha hecho con cada una */
export function sessionPages(entradas: { tipo: string; texto: string; ts: number; pregunta?: boolean }[], respuestas: Record<string, PageAnswer>, base?: string): SessionPage[] {
  const ultima = new Map<string, number>();
  for (const e of entradas) if (linksPages(e)) for (const r of pagesInText(relativeLinks(e.texto, base))) ultima.set(r, Math.max(ultima.get(r) ?? 0, e.ts));
  return [...ultima].map(([ruta, ts]) => {
    const clave = Object.keys(respuestas).find(k => samePage(k, ruta));
    const r = clave ? respuestas[clave] : undefined;
    return { ruta, nombre: ruta.split('/').pop() || ruta, ts, ...(r && r.ts >= ts ? { respuesta: r } : {}) };
  }).filter(p => p.respuesta?.estado !== 'quitada').sort((a, b) => b.ts - a.ts);
}

/** Las que se listan: las que siguen en el Mac (`existen`: las rutas que el servidor ha encontrado; sin saberlo aún,
 *  todas), las ya contestadas solo si se enlazaron en las dos últimas semanas y las pendientes durante el mes que se
 *  recuerdan las respuestas (Navegadores.tsx). Las de un worktree ya quitado desaparecen solas */
export const PAGES_DAYS = 14;
export const PENDING_PAGES_DAYS = 30;
export const livePages = (l: SessionPage[], existen: Set<string> | null, ahora = Date.now()) =>
  l.filter(p => p.ts >= ahora - (p.respuesta ? PAGES_DAYS : PENDING_PAGES_DAYS) * 86_400_000 && (!existen || existen.has(p.ruta)));

/** Las que quedan por revisar */
export const pendingPages = (l: SessionPage[]) => l.filter(p => !p.respuesta);

/** Un enlace Markdown a una ruta que siempre se lee entero (con espacios, como «Application Support») */
export const pageLink = (ruta: string, texto = ruta.split('/').pop() || ruta) => `[${texto.replace(/[[\]]/g, '')}](${/[\s()<>]/.test(ruta) ? `<${ruta}>` : ruta})`;
