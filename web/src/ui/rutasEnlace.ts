// Rutas del Mac sueltas en el texto («/Users/…/compare.html», «~/…», «file:///…»), sin escribirlas como enlace: marked
// no las enlaza solas, y una pregunta o respuesta que solo dice dónde está el archivo se quedaba sin clic. Esta extensión
// las convierte en enlace (luego markdown.ts les pone `data-local`, como a los enlaces escritos). Nunca dentro de código
// ni de otro enlace, y solo al empezar una palabra; el punto o la coma con que acaba la frase no son de la ruta.
import type { MarkedExtension, Tokens } from 'marked';

const START = /(?<=^|[\s(*_])(?:\/Users\/|~\/|file:\/\/\/)/;
const RUTA = /^(?:\/Users\/|~\/|file:\/\/\/)[^\s<>()[\]"'`]+/;
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const localPathLinks: MarkedExtension = {
  extensions: [{
    name: 'rutaLocal',
    level: 'inline',
    start: src => { const i = src.search(START); return i < 0 ? undefined : i; },
    tokenizer(src) {
      if (this.lexer.state.inLink) return undefined;
      const ruta = RUTA.exec(src)?.[0].replace(/[.,;:!?]+$/, '');
      return ruta ? { type: 'rutaLocal', raw: ruta, href: ruta } : undefined;
    },
    renderer: token => `<a href="${escapeHtml((token as Tokens.Generic).href)}">${escapeHtml(token.raw)}</a>`,
  }],
};
