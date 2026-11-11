// Abrir cosas del refugio en el Mac sin ejecutar nada por el camino. `open <archivo>` usa la app por defecto de su tipo,
// y para un .app, .command, .terminal, .tool, .fileloc, .webloc, .workflow o .pkg de un repo clonado (o de un adjunto)
// eso es ejecutarlo. Por eso: el editor (Cursor o VS Code) si lo hay; si no, el editor de texto del sistema (`open -t`)
// para un archivo y el Finder (`open -R`, que solo lo enseña) para una carpeta o un paquete. Y antes de nada, la ruta
// real (con los enlaces resueltos) tiene que seguir dentro de la raíz que toca.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { t } from '../shared/idioma.ts';

const EDITORS = [['/Applications/Cursor.app', 'Cursor'], ['/Applications/Visual Studio Code.app', 'Visual Studio Code']];
const editorOfMac = () => EDITORS.find(([ruta]) => existsSync(ruta))?.[1] ?? null;
const lanzar = (args: string[]) => spawn('open', args, { detached: true, stdio: 'ignore' }).unref();

/** La ruta real de `abs`, que tiene que caer dentro de la ruta real de `raiz` */
export async function realInside(raiz: string, abs: string) {
  const [r, a] = await Promise.all([fs.realpath(raiz), fs.realpath(abs)]);
  if (a !== r && !a.startsWith(r + path.sep)) throw new Error(t('server.thatPathIsOutsideThe'));
  return a;
}
// paquetes: carpetas que el Finder trata como un archivo (abrirlas puede ejecutarlas)
const PACKAGE = /\.(app|bundle|framework|plugin|kext|prefpane|appex|xpc|workflow|action|saver|qlgenerator|mdimporter|pkg|mpkg|xcodeproj|xcworkspace|playground)$/i;
export const isPackage = (ruta: string) => PACKAGE.test(ruta.replace(/\/+$/, ''));

/** Un archivo o carpeta de `raiz` en el editor; sin editor, el de texto del sistema (carpetas y paquetes: en el Finder) */
export async function abrirEnEditor(raiz: string, abs: string) {
  const real = await realInside(raiz, abs);
  const carpeta = (await fs.stat(real)).isDirectory(), editor = editorOfMac();
  if (carpeta && (isPackage(real) || !editor)) { lanzar(['-R', real]); return; }
  lanzar(editor ? ['-a', editor, real] : ['-t', real]);
}

// adjuntos: imágenes y PDF en Vista Previa, texto en el editor de texto; lo demás (un .docx, un .zip, un .command…),
// enseñado en el Finder para que lo abra el Supervisor sabiendo qué es
const OF_PREVIEW = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|pdf)$/i;
const OF_TEXT = /\.(txt|md|markdown|json|jsonl|csv|tsv|log|ya?ml|toml|ini|conf|xml|html?|css|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|sh|zsh|sql|diff|patch)$/i;
export async function openAttachment(raiz: string, abs: string) {
  const real = await realInside(raiz, abs);
  if (!(await fs.stat(real)).isFile()) { lanzar(['-R', real]); return; }
  lanzar(OF_PREVIEW.test(real) ? ['-a', 'Preview', real] : OF_TEXT.test(real) ? ['-t', real] : ['-R', real]);
}

// Un enlace a un archivo del Mac en la respuesta de un habitante («/Users/…/informe.html», «file:///…», «~/…», con o sin
// «:12» de línea): una página web en el navegador del sistema, imágenes y PDF en Vista Previa, código y texto en el
// editor y carpetas en el Finder; lo demás (un .app, un .command…) solo se enseña en el Finder, para no ejecutar nada.
const OF_BROWSER = /\.(html?|svg)$/i;
export function linkPath(enlace: string, casa: string): string | null {
  let r = String(enlace ?? '').trim();
  if (/^file:\/\//i.test(r)) { try { r = decodeURIComponent(new URL(r).pathname); } catch { return null; } }
  else { try { r = decodeURIComponent(r); } catch {} }
  r = r.replace(/[?#].*$/, '').replace(/(:\d+){1,2}$/, '');   // ?consulta, #L12 y «:12:3» de línea y columna
  if (r === '~' || r.startsWith('~/')) r = casa + r.slice(1);
  return path.isAbsolute(r) && !r.includes('\0') ? path.normalize(r) : null;
}
export async function openLocal(enlace: string, casa: string) {
  const ruta = linkPath(enlace, casa);
  if (!ruta) throw new Error(t('server.thatLinkIsNotA'));
  const real = await fs.realpath(ruta).catch(() => { throw new Error('No existe: ' + ruta); });
  const st = await fs.stat(real);
  if (st.isDirectory()) { lanzar(isPackage(real) ? ['-R', real] : [real]); return 'carpeta'; }
  if (OF_BROWSER.test(real)) { lanzar([real]); return 'web'; }   // la app que tengas para las páginas web: tu navegador
  if (OF_PREVIEW.test(real)) { lanzar(['-a', 'Preview', real]); return 'vista'; }
  if (OF_TEXT.test(real)) { const editor = editorOfMac(); lanzar(editor ? ['-a', editor, real] : ['-t', real]); return 'editor'; }
  lanzar(['-R', real]); return 'finder';
}
