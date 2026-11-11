// Rutas del Mac sueltas en el texto («/Users/…/compare.html», «~/…», «file:///…»), sin escribirlas como enlace: marked
// no las enlaza solas, y una pregunta o respuesta que solo dice dónde está el archivo se quedaba sin clic. Esta extensión
// las convierte en enlace (luego markdown.ts les pone `data-local`, como a los enlaces escritos). Nunca dentro de código
// ni de otro enlace, y solo al empezar una palabra; el punto o la coma con que acaba la frase no son de la ruta.
import type { MarkedExtension, Tokens } from 'marked';

const START = /(?<=^|[\s(*_])(?:\/Users\/|~\/|file:\/\/\/)/;
const RUTA = /^(?:\/Users\/|~\/|file:\/\/\/)[^\s<>()[\]"'`]+/;
// una página (HTML o Markdown) en una carpeta con espacios («Application Support»): los espacios solo entre palabras de
// una carpeta, nunca en el nombre del archivo, para no tragarse el resto de la frase
const SEG = '[^\\s/<>()[\\]"\'`]+';
export const PAGE_WITH_SPACES = new RegExp(`^(?:\\/Users\\/|~\\/|file:\\/\\/\\/)(?:${SEG}(?: ${SEG})*\\/)*${SEG}\\.(?:html?|md|markdown)(?![\\w-])`);
// [texto](/Users/…/Application Support/…html): sin los <…>, Markdown no lo toma por enlace
const LINK_WITH_SPACES = /^\[([^\]\n]*)\]\(([^)\n]*)\)/;
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const localPathLinks: MarkedExtension = {
  extensions: [{
    name: 'enlaceConEspacios',
    level: 'inline',
    start: src => { const i = src.search(/\[[^\]\n]*\]\((?:\/Users\/|~\/|file:\/\/\/)/); return i < 0 ? undefined : i; },
    tokenizer(src) {
      if (this.lexer.state.inLink) return undefined;
      const m = LINK_WITH_SPACES.exec(src);
      if (!m || !m[2].includes(' ') || PAGE_WITH_SPACES.exec(m[2])?.[0] !== m[2]) return undefined;
      return { type: 'enlaceConEspacios', raw: m[0], href: m[2], text: m[1] || m[2] };
    },
    renderer: token => `<a href="${escapeHtml(encodeURI((token as Tokens.Generic).href))}">${escapeHtml((token as Tokens.Generic).text)}</a>`,
  }, {
    name: 'rutaLocal',
    level: 'inline',
    start: src => { const i = src.search(START); return i < 0 ? undefined : i; },
    tokenizer(src) {
      if (this.lexer.state.inLink) return undefined;
      const ruta = PAGE_WITH_SPACES.exec(src)?.[0] ?? RUTA.exec(src)?.[0].replace(/[.,;:!?]+$/, '');
      return ruta ? { type: 'rutaLocal', raw: ruta, href: ruta } : undefined;
    },
    renderer: token => `<a href="${escapeHtml(encodeURI((token as Tokens.Generic).href))}">${escapeHtml(token.raw)}</a>`,
  }],
};
