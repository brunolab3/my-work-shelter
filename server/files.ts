// Explorador de archivos del refugio: lo que hace la barra lateral de un editor (Cursor, VS Code) con las carpetas de
// las salas. Listar carpetas (con lo que ignora git atenuado y lo cambiado marcado), leer y guardar archivos de texto
// (también los que git ignora, como los .env), crear, renombrar, copiar, mover y tirar a la papelera de macOS, y la
// lista de archivos para abrir por nombre (⌘P).
// Solo dentro de las raíces del refugio (las carpetas de las salas y sus worktrees: las valida quien llama con
// `raizPermitida`), sin `..` ni enlaces que salgan de la raíz.
import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openInEditor as openEditorSafe } from './open.ts';
import { gitEnvironment } from './gitEnv.ts';
import { t } from '../shared/language.ts';

const MAX_TEXT = 8 * 1024 * 1024;        // más grande no se abre en el editor
const MAX_IMAGE = 12 * 1024 * 1024;
const MAX_LIST = 60_000;                 // archivos para ⌘P
// carpetas que no se recorren al buscar por nombre fuera de git (en un repo, las decide su .gitignore)
const HEAVY = new Set(['node_modules', '.git', '.next', '.nuxt', '.turbo', '.cache', '.parcel-cache', '.svelte-kit', '.vercel', 'dist', 'build', 'out', 'coverage', '.venv', 'venv', '__pycache__', 'target', 'Pods', 'DerivedData']);
const IMAGES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.avif': 'image/avif' };

// ---------------------------------------------------------------- rutas seguras
const relSafe = (r: unknown) => {
  const s = String(r ?? '').replace(/^\/+|\/+$/g, '');
  if (s.includes('\0') || s.split('/').some(p => p === '..' || p === '.')) throw new Error(t('server.invalidPath'));
  return s;
};
const safeName = (n: unknown) => {
  const s = String(n ?? '').trim();
  if (!s || s === '.' || s === '..' || s.includes('\0') || s.split('/').some(p => !p || p === '..' || p === '.')) throw new Error(t('server.isNotAValidName', { v: s }));
  return s;
};
/** Ruta absoluta de `rel` dentro de `raiz`; si existe (o existe su carpeta), comprueba que de verdad cae dentro (enlaces). */
async function inside(root: string, rel: string) {
  const abs = path.join(root, rel);
  const real = await fs.realpath(root);
  let p = abs;
  while (true) {
    try { const r = await fs.realpath(p); if (r !== real && !r.startsWith(real + path.sep)) throw new Error(t('server.thatPathIsOutsideThe')); break; }
    catch (e: any) { if (e.code !== 'ENOENT') throw e; const parent = path.dirname(p); if (parent === p) break; p = parent; }
  }
  return abs;
}

function run(bin: string, args: string[], o: { cwd?: string; input?: string; timeout?: number } = {}): Promise<{ out: string; code: number }> {
  return new Promise(ok => {
    const p = spawn(bin, args, { cwd: o.cwd, env: gitEnvironment(), stdio: ['pipe', 'pipe', 'ignore'] });
    const out: Buffer[] = []; let length = 0;
    p.stdout.on('data', (b: Buffer) => { length += b.length; if (length < 64 * 1024 * 1024) out.push(b); });
    const timer = setTimeout(() => p.kill('SIGTERM'), o.timeout ?? 15_000);
    p.on('error', () => { clearTimeout(timer); ok({ out: '', code: -1 }); });
    p.on('close', code => { clearTimeout(timer); ok({ out: Buffer.concat(out).toString('utf8'), code: code ?? -1 }); });
    p.stdin.end(o.input ?? '');
  });
}
const isGit = (root: string) => existsSync(path.join(root, '.git'));

// ---------------------------------------------------------------- carpetas
export interface Entry { name: string; dir: boolean; link?: boolean; ignored?: boolean }

async function listOne(root: string, rel: string): Promise<Entry[]> {
  const abs = await inside(root, rel);
  const ds = await fs.readdir(abs, { withFileTypes: true });
  const out = await Promise.all(ds.filter(d => d.name !== '.git' && d.name !== '.DS_Store').map(async d => {
    if (!d.isSymbolicLink()) return { name: d.name, dir: d.isDirectory() };
    const st = await fs.stat(path.join(abs, d.name)).catch(() => null);
    return { name: d.name, dir: !!st?.isDirectory(), link: true };
  }));
  // como los editores: carpetas primero, y por nombre sin distinguir mayúsculas (los números, en orden natural)
  return out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' }) : a.dir ? -1 : 1));
}

/** Lo que ignora git, de una vez para todas las entradas (rutas relativas a la raíz). */
async function ignored(root: string, rels: string[]): Promise<Set<string>> {
  if (!rels.length || !isGit(root)) return new Set();
  const r = await run('git', ['-C', root, 'check-ignore', '-z', '--stdin'], { input: rels.join('\0') + '\0' });
  return new Set(r.out.split('\0').filter(Boolean));
}

/** Letra de git de cada archivo cambiado (M, A, D, R, U o ? para los nuevos), relativa a la raíz. */
async function changesGit(root: string): Promise<Record<string, string>> {
  if (!isGit(root)) return {};
  const r = await run('git', ['-C', root, '-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
  const out: Record<string, string> = {}; let n = 0;
  for (const reg of r.out.split('\0')) {
    if (reg.length < 4 || ++n > 20_000) continue;
    const xy = reg.slice(0, 2), path = reg.slice(3);
    out[path] = xy === '??' ? '?' : xy.includes('U') || xy === 'AA' || xy === 'DD' ? 'U' : (xy[1] !== ' ' ? xy[1] : xy[0]);
  }
  return out;
}

/** El estado de lo que se ve: las carpetas desplegadas, los cambios de git y la fecha de los archivos abiertos. */
export async function glance(root: string, d: { folders?: unknown; open?: unknown; git?: boolean }) {
  const folders = (Array.isArray(d.folders) ? d.folders : ['']).slice(0, 400).map(relSafe);
  const listed: Record<string, Entry[] | null> = {};
  await Promise.all(folders.map(async c => { listed[c] = await listOne(root, c).catch(() => null); }));
  const all = Object.entries(listed).flatMap(([c, es]) => (es ?? []).map(e => (c ? c + '/' : '') + e.name));
  const [ign, git] = await Promise.all([ignored(root, all), d.git === false ? Promise.resolve(undefined) : changesGit(root)]);
  for (const [c, es] of Object.entries(listed)) for (const e of es ?? []) if (ign.has((c ? c + '/' : '') + e.name)) e.ignored = true;
  return { listed, git, dates: await dates(root, d.open) };
}

async function dates(root: string, open: unknown) {
  const out: Record<string, number | null> = {};
  await Promise.all((Array.isArray(open) ? open : []).slice(0, 200).map(async r => {
    const rel = relSafe(r);
    out[rel] = await fs.stat(path.join(root, rel)).then(s => s.mtimeMs, () => null);
  }));
  return out;
}

// ---------------------------------------------------------------- leer y guardar
export type Reading =
  | { type: 'text'; text: string; date: number; resize: number }
  | { type: 'image'; data: string; date: number; resize: number }
  | { type: 'binary' | 'large'; date: number; resize: number };

export async function read(root: string, rel: string): Promise<Reading> {
  const abs = await inside(root, relSafe(rel));
  const st = await fs.stat(abs);
  if (st.isDirectory()) throw new Error(t('server.itIsAFolder'));
  const date = st.mtimeMs, resize = st.size, mime = IMAGES[path.extname(abs).toLowerCase()];
  if (mime) {
    if (resize > MAX_IMAGE) return { type: 'large', date, resize };
    return { type: 'image', data: `data:${mime};base64,` + (await fs.readFile(abs)).toString('base64'), date, resize };
  }
  if (resize > MAX_TEXT) return { type: 'large', date, resize };
  const b = await fs.readFile(abs);
  if (b.subarray(0, 8000).includes(0)) return { type: 'binary', date, resize };
  return { type: 'text', text: b.toString('utf8'), date, resize };
}

/** Guarda el texto. Si el archivo ha cambiado en el disco desde que se leyó (`fecha`), no lo pisa salvo que se fuerce. */
export async function save(root: string, d: { rel: unknown; text: unknown; date?: unknown; force?: boolean }) {
  const abs = await inside(root, relSafe(d.rel));
  const text = String(d.text ?? '');
  if (Buffer.byteLength(text) > MAX_TEXT) throw new Error(t('server.tooBigToSaveFrom'));
  const before = await fs.stat(abs).catch(() => null);
  if (before?.isDirectory()) throw new Error(t('server.itIsAFolder'));
  if (before && !d.force && typeof d.date === 'number' && Math.abs(before.mtimeMs - d.date) > 1) return { conflict: true as const, date: before.mtimeMs };
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, text);   // writeFile sobre el que hay: conserva permisos, dueño y enlaces
  return { conflict: false as const, date: (await fs.stat(abs)).mtimeMs };
}

// ---------------------------------------------------------------- crear, renombrar, copiar, mover, borrar
export async function create(root: string, d: { folder: unknown; name: unknown; dir?: boolean }) {
  const rel = path.posix.join(relSafe(d.folder), safeName(d.name));
  const abs = await inside(root, rel);
  if (existsSync(abs)) throw new Error(t('server.thereIsAlreadySomethingCalled', { rel: path.basename(rel) }));
  if (d.dir) await fs.mkdir(abs, { recursive: true });
  else { await fs.mkdir(path.dirname(abs), { recursive: true }); await fs.writeFile(abs, '', { flag: 'wx' }); }
  return { rel };
}

export async function rename(root: string, d: { rel: unknown; name: unknown }) {
  const from = relSafe(d.rel); if (!from) throw new Error(t('server.theRootCannotBeRenamed'));
  const a = path.posix.join(path.posix.dirname(from), safeName(d.name));
  const [absOf, absTo] = await Promise.all([inside(root, from), inside(root, a)]);
  // en un disco que no distingue mayúsculas, «readme» → «README» es el mismo archivo: se deja
  if (existsSync(absTo) && from.toLowerCase() !== a.toLowerCase()) throw new Error(t('server.thereIsAlreadySomethingCalled2', { basename: path.basename(a) }));
  await fs.mkdir(path.dirname(absTo), { recursive: true });
  await fs.rename(absOf, absTo);
  return { rel: a };
}

/** Un nombre libre en la carpeta, como hacen los editores al pegar: «x copy.ts», «x copy 2.ts»… */
function freeName(folderAbs: string, name: string) {
  if (!existsSync(path.join(folderAbs, name))) return name;
  const ext = name.startsWith('.') && !name.slice(1).includes('.') ? '' : path.extname(name), base = name.slice(0, name.length - ext.length);
  for (let i = 1; ; i++) { const n = `${base} copy${i > 1 ? ' ' + i : ''}${ext}`; if (!existsSync(path.join(folderAbs, n))) return n; }
}

/** Pegar: copia (o mueve, si se cortaron) las rutas en la carpeta destino. Las rutas de origen pueden ser de otra raíz. */
export async function paste(root: string, d: { origins: unknown; folder: unknown; move?: boolean }, rootOf: (r: string) => string) {
  const folder = relSafe(d.folder), folderAbs = await inside(root, folder);
  const done: string[] = [];
  for (const o of (Array.isArray(d.origins) ? d.origins : []).slice(0, 500)) {
    const r = rootOf(String(o?.root ?? '')), rel = relSafe(o?.rel); if (!rel) continue;
    const abs = await inside(r, rel);
    if (folderAbs === abs || folderAbs.startsWith(abs + path.sep)) throw new Error(t('server.cannotGoInsideItself', { rel: path.basename(rel) }));
    if (d.move && path.dirname(abs) === folderAbs) continue;
    const name = d.move ? path.basename(rel) : freeName(folderAbs, path.basename(rel));
    const target = path.join(folderAbs, name);
    if (d.move) {
      if (existsSync(target)) throw new Error(t('server.thereIsAlreadySomethingCalled3', { nombre: name }));
      await fs.rename(abs, target).catch(async e => { if (e.code !== 'EXDEV') throw e; await fs.cp(abs, target, { recursive: true, errorOnExist: true, force: false }); await fs.rm(abs, { recursive: true }); });
    } else await fs.cp(abs, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    done.push(path.posix.join(folder, name));
  }
  return { rels: done };
}

/** A la papelera de macOS (se puede recuperar desde el Finder), como hacen los editores. */
export async function moveToTrash(root: string, rels: unknown) {
  const abs = await Promise.all((Array.isArray(rels) ? rels : []).slice(0, 500).map(r => { const s = relSafe(r); if (!s) throw new Error(t('server.theRootCannotBeThrown')); return inside(root, s); }));
  await toTrash(abs);
}
export async function toTrash(abs: string[]) {
  if (!abs.length) return;
  await new Promise<void>((ok, fail) => {
    if (existsSync('/usr/bin/trash')) return execFile('/usr/bin/trash', abs, err => (err ? fail(new Error(t('server.couldNotTrash', { error: err.message }))) : ok()));
    // macOS anteriores a /usr/bin/trash: el Finder
    const list = abs.map(a => `POSIX file ${JSON.stringify(a)}`).join(', ');
    execFile('osascript', ['-e', `tell application "Finder" to delete {${list}}`], err => (err ? fail(new Error(t('server.couldNotTrash', { error: err.message }))) : ok()));
  });
}

// ---------------------------------------------------------------- todos los archivos (para abrir por nombre, ⌘P)
export async function all(root: string): Promise<{ rels: string[]; truncated: boolean }> {
  let rels: string[];
  if (isGit(root)) {
    // lo que sigue git y lo nuevo, más los archivos sueltos que ignora (.env y compañía; las carpetas ignoradas, no)
    const [consecutive, ign] = await Promise.all([
      run('git', ['-C', root, '-c', 'core.quotepath=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate'], { timeout: 30_000 }),
      run('git', ['-C', root, '-c', 'core.quotepath=false', 'ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory'], { timeout: 30_000 }),
    ]);
    const seen = new Set<string>(); rels = [];
    for (const r of [...consecutive.out.split('\0'), ...ign.out.split('\0')]) if (r && !r.endsWith('/') && !seen.has(r)) { seen.add(r); rels.push(r); }
    // los borrados del disco (siguen en el índice) no se pueden abrir
    rels = (await Promise.all(rels.map(async r => (await fs.lstat(path.join(root, r)).then(s => !s.isDirectory(), () => false)) ? r : null))).filter((r): r is string => !!r);
  } else {
    rels = [];
    const walk = async (rel: string, level: number): Promise<void> => {
      if (rels.length >= MAX_LIST || level > 12) return;
      const ds = await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
      for (const d of ds) {
        const r = rel ? rel + '/' + d.name : d.name;
        if (d.isDirectory()) { if (!HEAVY.has(d.name)) await walk(r, level + 1); }
        else if (d.name !== '.DS_Store') rels.push(r);
      }
    };
    await walk('', 0);
  }
  return { rels: rels.slice(0, MAX_LIST), truncated: rels.length > MAX_LIST };
}

// ---------------------------------------------------------------- fuera del juego
export async function reveal(root: string, rel: unknown) { const abs = await inside(root, relSafe(rel)); spawn('open', ['-R', abs], { detached: true, stdio: 'ignore' }).unref(); }
// en el editor (o en el de texto de macOS; carpetas y paquetes, en el Finder): nunca con la app por defecto (open.ts)
export async function openInEditor(root: string, rel: unknown) { await openEditorSafe(root, await inside(root, relSafe(rel))); }

// ---------------------------------------------------------------- despacho
export interface CtxFiles { allowedRoots: () => string[]; onChange: (root: string) => void }
const WRITE = new Set(['save', 'create', 'rename', 'paste', 'trash']);

export async function filesAction(name: string, d: Record<string, any>, ctx: CtxFiles): Promise<unknown> {
  const allowed = ctx.allowedRoots();
  const rootOf = (r: string) => { const p = path.resolve(r || '/'); if (!allowed.includes(p)) throw new Error(t('server.thatFolderDoesNotBelong')); if (!existsSync(p)) throw new Error(t('server.theRoomSFolderIs')); return p; };
  const root = rootOf(String(d.root ?? ''));
  const r = await (async () => {
    switch (name) {
      case 'peek': return glance(root, d);
      case 'read': return read(root, d.rel);
      case 'save': return save(root, d as any);
      case 'create': return create(root, d as any);
      case 'rename': return rename(root, d as any);
      case 'paste': return paste(root, d as any, rootOf);
      case 'trash': return moveToTrash(root, d.rels);
      case 'all': return all(root);
      case 'reveal': return reveal(root, d.rel);
      case 'openInEditor': return openInEditor(root, d.rel);
      default: throw new Error(t('server.unknownAction', { nombre: 'files.' + name }));
    }
  })();
  if (WRITE.has(name)) ctx.onChange(root);
  return r ?? true;
}
