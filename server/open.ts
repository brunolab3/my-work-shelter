// Abrir cosas del refugio en el Mac sin ejecutar nada por el camino. `open <archivo>` usa la app por defecto de su tipo,
// y para un .app, .command, .terminal, .tool, .fileloc, .webloc, .workflow o .pkg de un repo clonado (o de un adjunto)
// eso es ejecutarlo. Por eso: el editor (Cursor o VS Code) si lo hay; si no, el editor de texto del sistema (`open -t`)
// para un archivo y el Finder (`open -R`, que solo lo enseña) para una carpeta o un paquete. Y antes de nada, la ruta
// real (con los enlaces resueltos) tiene que seguir dentro de la raíz que toca.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { t } from '../shared/language.ts';
import type { LocalKind } from '../shared/linkOptions.ts';

const EDITORS = [['/Applications/Cursor.app', 'Cursor'], ['/Applications/Visual Studio Code.app', 'Visual Studio Code']];
const editorOfMac = () => EDITORS.find(([path]) => existsSync(path))?.[1] ?? null;
const launch = (args: string[]) => spawn('open', args, { detached: true, stdio: 'ignore' }).unref();

/** La ruta real de `abs`, que tiene que caer dentro de la ruta real de `raiz` */
export async function realInside(root: string, abs: string) {
  const [r, a] = await Promise.all([fs.realpath(root), fs.realpath(abs)]);
  if (a !== r && !a.startsWith(r + path.sep)) throw new Error(t('server.thatPathIsOutsideThe'));
  return a;
}
// paquetes: carpetas que el Finder trata como un archivo (abrirlas puede ejecutarlas)
const PACKAGE = /\.(app|bundle|framework|plugin|kext|prefpane|appex|xpc|workflow|action|saver|qlgenerator|mdimporter|pkg|mpkg|xcodeproj|xcworkspace|playground)$/i;
export const isPackage = (path: string) => PACKAGE.test(path.replace(/\/+$/, ''));

/** Un archivo o carpeta de `raiz` en el editor; sin editor, el de texto del sistema (carpetas y paquetes: en el Finder) */
export async function openInEditor(root: string, abs: string) {
  const real = await realInside(root, abs);
  const folder = (await fs.stat(real)).isDirectory(), editor = editorOfMac();
  if (folder && (isPackage(real) || !editor)) { launch(['-R', real]); return; }
  launch(editor ? ['-a', editor, real] : ['-t', real]);
}

// adjuntos: imágenes y PDF en Vista Previa, texto en el editor de texto; lo demás (un .docx, un .zip, un .command…),
// enseñado en el Finder para que lo abra el Supervisor sabiendo qué es
const OF_PREVIEW = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|pdf)$/i;
const OF_TEXT = /\.(txt|md|markdown|json|jsonl|csv|tsv|log|ya?ml|toml|ini|conf|xml|html?|css|[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|sh|zsh|sql|diff|patch)$/i;
export async function openAttachment(root: string, abs: string) {
  const real = await realInside(root, abs);
  if (!(await fs.stat(real)).isFile()) { launch(['-R', real]); return; }
  launch(OF_PREVIEW.test(real) ? ['-a', 'Preview', real] : OF_TEXT.test(real) ? ['-t', real] : ['-R', real]);
}

// Un enlace a un archivo del Mac en la respuesta de un habitante («/Users/…/informe.html», «file:///…», «~/…», con o sin
// «:12» de línea): una página web en el navegador del sistema, imágenes y PDF en Vista Previa, código y texto en el
// editor y carpetas en el Finder; lo demás (un .app, un .command…) solo se enseña en el Finder, para no ejecutar nada.
const OF_BROWSER = /\.(html?|svg)$/i;
export function linkPath(link: string, home: string): string | null {
  let r = String(link ?? '').trim();
  if (/^file:\/\//i.test(r)) { try { r = decodeURIComponent(new URL(r).pathname); } catch { return null; } }
  else { try { r = decodeURIComponent(r); } catch {} }
  r = r.replace(/[?#].*$/, '').replace(/(:\d+){1,2}$/, '');   // ?consulta, #L12 y «:12:3» de línea y columna
  if (r === '~' || r.startsWith('~/')) r = home + r.slice(1);
  return path.isAbsolute(r) && !r.includes('\0') ? path.normalize(r) : null;
}
/** The real path of a link to a file of the Mac (it has to exist) */
export async function realOfLink(link: string, home: string) {
  const path = linkPath(link, home);
  if (!path) throw new Error(t('server.thatLinkIsNotA'));
  return fs.realpath(path).catch(() => { throw new Error(t('server.doesNotExist', { path: path })); });
}
/** Where openLocal would send it, without opening it (the options of a link, web/src/ui/linkOptions.ts) */
export async function localKind(real: string): Promise<LocalKind> {
  if ((await fs.stat(real)).isDirectory()) return isPackage(real) ? 'finder' : 'folder';
  return OF_BROWSER.test(real) ? 'web' : OF_PREVIEW.test(real) ? 'preview' : OF_TEXT.test(real) ? 'editor' : 'finder';
}
export async function openLocal(link: string, home: string) {
  const real = await realOfLink(link, home);
  const type = await localKind(real);
  if (type === 'folder') launch([real]);
  else if (type === 'web') launch([real]);   // la app que tengas para las páginas web: tu navegador
  else if (type === 'preview') launch(['-a', 'Preview', real]);
  else if (type === 'editor') { const editor = editorOfMac(); launch(editor ? ['-a', editor, real] : ['-t', real]); }
  else launch(['-R', real]);
  return type;
}

/** Enseña un archivo del Mac en el Finder (seleccionado), sin abrirlo: para compartir una página (un plan, una
 *  comparación) desde allí */
export async function revealLocal(link: string, home: string) {
  launch(['-R', await realOfLink(link, home)]);
}
