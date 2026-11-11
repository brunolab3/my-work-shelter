// Cliente de git del refugio (sala de Control de Versiones): lo que hace un cliente de git de barra lateral, con el
// git de tu máquina. Estado del repo, diffs, preparar y quitar (archivos, bloques o líneas sueltas), descartar,
// commits (y enmendar), historial con su grafo, ramas, cajón (stash) y sincronizar con el remoto.
// Solo sobre carpetas del refugio (las salas y sus worktrees): la ruta la valida quien llama (`rutaPermitida`).
// Nada pregunta por la terminal (GIT_TERMINAL_PROMPT=0) ni abre un editor (GIT_EDITOR=true): si git necesita algo
// que no se le puede dar desde aquí, falla con su mensaje y el cliente lo enseña.
// La matriz de contribuciones y los pull requests salen de GitHub con `gh`, solo si GitHub está conectado en la cámara
// acorazada (con su token o con la sesión de `gh`); si no, DEMO, como el resto de integraciones. Conectado pero sin
// `gh`, la matriz se cuenta con tus commits en los repos del refugio.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { abrirEnEditor } from './abrir.ts';
import { entornoGit } from './entornoGit.ts';
import type { PRBoard } from '../shared/tablero.ts';
import { dependenciasEnTexto } from '../shared/despliegue.ts';
import { t } from '../shared/idioma.ts';

const entorno = () => entornoGit({ GIT_EDITOR: 'true', GIT_PAGER: 'cat', GCM_INTERACTIVE: 'never' });
const MAX_DIFF = 1_500_000;   // un diff más grande se corta (y se avisa)
const MAX_FILES = 3000;

interface Salida { out: string; err: string; code: number }
function ejecutar(cwd: string, args: string[], o: { entrada?: string; timeout?: number; codes?: number[] } = {}): Promise<Salida> {
  return new Promise((ok, mal) => {
    const p = spawn('git', ['-c', 'core.quotepath=false', '-c', 'color.ui=false', '-C', cwd, ...args], { env: entorno(), stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [], err: Buffer[] = []; let largo = 0;
    p.stdout.on('data', (b: Buffer) => { largo += b.length; if (largo < 64 * 1024 * 1024) out.push(b); });
    p.stderr.on('data', (b: Buffer) => err.push(b));
    const reloj = setTimeout(() => { p.kill('SIGTERM'); }, o.timeout ?? 20_000);
    p.on('error', e => { clearTimeout(reloj); mal(e); });
    p.on('close', (code, senal) => {
      clearTimeout(reloj);
      const r = { out: Buffer.concat(out).toString('utf8'), err: Buffer.concat(err).toString('utf8').trim(), code: code ?? -1 };
      if (senal) return mal(new Error(t('server.gitTookTooLongAnd', { args: args[0] })));
      if (r.code !== 0 && !(o.codes ?? []).includes(r.code)) return mal(new Error(cleanError(r.err || r.out) || `git ${args[0]} ha fallado (${r.code}).`));
      ok(r);
    });
    if (o.entrada !== undefined) p.stdin.end(o.entrada); else p.stdin.end();
  });
}
const git = async (cwd: string, args: string[], timeout?: number) => (await ejecutar(cwd, args, { timeout })).out;
const cleanError = (t: string) => t.split('\n').filter(l => !/^hint:/.test(l)).join('\n').trim().slice(0, 1200);

// ---------------------------------------------------------------- estado
export type Letter = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '?';
export interface FileGit { ruta: string; origen?: string; letra: Letter }
export interface StateGit {
  ruta: string; rama: string | null; cabeza: string | null; upstream: string | null; adelante: number; atras: number;
  preparados: FileGit[]; cambios: FileGit[]; conflictos: FileGit[];
  operacion: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null; recortado: boolean; lastMessage: string; remote: string[]; cajon: number;
}

export async function estado(ruta: string): Promise<StateGit> {
  const [st, mensaje, remote, cajon, dirGit] = await Promise.all([
    ejecutar(ruta, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']).then(r => r.out),
    git(ruta, ['log', '-1', '--format=%B']).catch(() => ''),
    git(ruta, ['remote']).catch(() => ''),
    git(ruta, ['stash', 'list', '--format=%gd']).catch(() => ''),
    git(ruta, ['rev-parse', '--absolute-git-dir']).catch(() => ''),
  ]);
  const e: StateGit = { ruta, rama: null, cabeza: null, upstream: null, adelante: 0, atras: 0, preparados: [], cambios: [], conflictos: [], operacion: null, recortado: false, lastMessage: mensaje.trim(), remote: remote.split('\n').filter(Boolean), cajon: cajon.split('\n').filter(Boolean).length };
  const regs = st.split('\0');
  for (let i = 0; i < regs.length; i++) {
    const r = regs[i]; if (!r) continue;
    if (r.startsWith('# branch.oid ')) { const v = r.slice(13); e.cabeza = v === '(initial)' ? null : v; }
    else if (r.startsWith('# branch.head ')) { const v = r.slice(14); e.rama = v === '(detached)' ? null : v; }
    else if (r.startsWith('# branch.upstream ')) e.upstream = r.slice(18);
    else if (r.startsWith('# branch.ab ')) { const m = /\+(\d+) -(\d+)/.exec(r); if (m) { e.adelante = +m[1]; e.atras = +m[2]; } }
    else if (r[0] === '?') e.cambios.push({ ruta: r.slice(2), letra: '?' });
    else if (r[0] === 'u') e.conflictos.push({ ruta: r.split(' ').slice(10).join(' '), letra: 'U' });
    else if (r[0] === '1' || r[0] === '2') {
      const partes = r.split(' '), xy = partes[1];
      const archivo = partes.slice(r[0] === '1' ? 8 : 9).join(' ');
      const origen = r[0] === '2' ? regs[++i] : undefined;
      if (xy[0] !== '.') e.preparados.push({ ruta: archivo, letra: xy[0] as Letter, ...(origen ? { origen } : {}) });
      if (xy[1] !== '.') e.cambios.push({ ruta: archivo, letra: xy[1] as Letter });
    }
  }
  for (const l of [e.preparados, e.cambios]) if (l.length > MAX_FILES) { l.length = MAX_FILES; e.recortado = true; }
  if (dirGit.trim()) {
    const d = dirGit.trim();
    e.operacion = existsSync(path.join(d, 'rebase-merge')) || existsSync(path.join(d, 'rebase-apply')) ? 'rebase' : existsSync(path.join(d, 'MERGE_HEAD')) ? 'merge' : existsSync(path.join(d, 'CHERRY_PICK_HEAD')) ? 'cherry-pick' : existsSync(path.join(d, 'REVERT_HEAD')) ? 'revert' : null;
  }
  return e;
}

// ---------------------------------------------------------------- diffs
export interface Diff { texto: string; binario: boolean; recortado: boolean }
function diffOf(texto: string): Diff {
  const recortado = texto.length > MAX_DIFF;
  return { texto: recortado ? texto.slice(0, MAX_DIFF) : texto, binario: /^Binary files .* differ$/m.test(texto) || /^GIT binary patch$/m.test(texto), recortado };
}
const safeFile = (a: unknown) => { const s = String(a ?? ''); if (!s || s.includes('\0') || path.isAbsolute(s) || s.split('/').includes('..')) throw new Error(t('server.invalidFilePath')); return s; };

export async function diff(ruta: string, d: { archivo: string; origen?: string; prepared?: boolean; withoutFollow?: boolean; contexto?: number }): Promise<Diff> {
  const archivo = safeFile(d.archivo), u = `-U${Math.max(0, Math.min(100_000, Number(d.contexto) || 3))}`;
  if (d.withoutFollow) return diffOf((await ejecutar(ruta, ['diff', '--no-index', '--no-ext-diff', '--no-textconv', u, '--', '/dev/null', archivo], { codes: [1] })).out);
  const rutas = d.origen ? ['--', safeFile(d.origen), archivo] : ['--', archivo];
  return diffOf(await git(ruta, ['diff', ...(d.prepared ? ['--cached', '-M'] : []), '--no-ext-diff', '--no-textconv', u, ...rutas]));
}

// ---------------------------------------------------------------- preparar, quitar, descartar
const lote = async (ruta: string, args: string[], archivos: string[]) => { for (let i = 0; i < archivos.length; i += 200) await git(ruta, [...args, '--', ...archivos.slice(i, i + 200)], 60_000); };

export async function preparar(ruta: string, archivos: string[]) { await lote(ruta, ['add', '-A'], archivos.map(safeFile)); }
export async function quitar(ruta: string, archivos: string[]) {
  const hasHead = await git(ruta, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => true, () => false);
  await lote(ruta, hasHead ? ['restore', '--staged'] : ['rm', '--cached', '-r', '-q'], archivos.map(safeFile));
}
/** Descarta cambios de la copia de trabajo: los de archivos seguidos vuelven a lo preparado; los nuevos se borran. */
export async function descartar(ruta: string, archivos: string[], withoutFollow: string[] = []) {
  if (archivos.length) await lote(ruta, ['restore', '--worktree'], archivos.map(safeFile));
  if (withoutFollow.length) await lote(ruta, ['clean', '-f', '-q'], withoutFollow.map(safeFile));
}
/** Aplica un trozo de diff (bloques o líneas elegidas, armado por el cliente) al índice o a la copia de trabajo. */
export async function applyPatch(ruta: string, parche: string, modo: 'preparar' | 'quitar' | 'descartar') {
  if (!parche.startsWith('diff --git ') || parche.length > MAX_DIFF) throw new Error(t('server.invalidPatch'));
  const args = ['apply', '--recount', '--whitespace=nowarn', ...(modo === 'descartar' ? ['--reverse'] : ['--cached', ...(modo === 'quitar' ? ['--reverse'] : [])]), '-'];
  await ejecutar(ruta, args, { entrada: parche.endsWith('\n') ? parche : parche + '\n' });
}

// ---------------------------------------------------------------- commits
export async function commit(ruta: string, d: { mensaje: string; amend?: boolean; todo?: boolean }) {
  const mensaje = String(d.mensaje ?? '').trim();
  if (!mensaje && !d.amend) throw new Error(t('server.writeACommitMessage'));
  if (d.todo) await git(ruta, ['add', '-A'], 60_000);
  const args = ['commit', ...(mensaje ? ['-m', mensaje] : ['--no-edit']), ...(d.amend ? ['--amend'] : [])];
  const r = await ejecutar(ruta, args, { timeout: 180_000 });   // los ganchos (lint, tests) pueden tardar
  return { hash: (await git(ruta, ['rev-parse', '--short', 'HEAD'])).trim(), salida: (r.out + '\n' + r.err).trim().slice(-2000) };
}
/** Deshace el último commit y deja sus cambios preparados (como «Deshacer el último commit» de los editores). */
export async function deshacerCommit(ruta: string) {
  const padre = await git(ruta, ['rev-parse', '--verify', '-q', 'HEAD~1']).then(() => true, () => false);
  if (!padre) throw new Error(t('server.thisIsTheRepoS'));
  const mensaje = (await git(ruta, ['log', '-1', '--format=%B'])).trim();
  await git(ruta, ['reset', '--soft', 'HEAD~1']);
  return { mensaje };
}

// ---------------------------------------------------------------- historial
export interface CommitGit { hash: string; parents: string[]; autor: string; correo: string; fecha: number; asunto: string; refs: string[] }
export async function historial(ruta: string, d: { todas?: boolean; n?: number; desde?: number }): Promise<{ commits: CommitGit[]; mas: boolean }> {
  const n = Math.max(20, Math.min(1000, Number(d.n) || 300)), jump = Math.max(0, Number(d.desde) || 0);
  const hasUp = await git(ruta, ['rev-parse', '--verify', '-q', '@{upstream}']).then(() => true, () => false);
  const refs = d.todas ? ['--branches', '--remotes', '--tags'] : ['HEAD', ...(hasUp ? ['@{upstream}'] : [])];
  const out = await git(ruta, ['log', '--topo-order', '--decorate=full', `--skip=${jump}`, '-n', String(n + 1), '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ct%x1f%s%x1f%D%x1e', ...refs, '--']).catch(e => { if (/does not have any commits|bad default revision|unknown revision/i.test(e.message)) return ''; throw e; });
  const commits = out.split('\x1e').map(l => l.replace(/^\n/, '')).filter(Boolean).map(l => {
    const [hash, parents, autor, correo, fecha, asunto, decor] = l.split('\x1f');
    return { hash, parents: parents ? parents.split(' ') : [], autor, correo, fecha: Number(fecha) * 1000, asunto, refs: (decor ?? '').split(', ').map(x => x.trim()).filter(Boolean).map(x => x.replace('HEAD -> ', 'HEAD → ').replace(/refs\/heads\//g, '').replace(/refs\/remotes\//g, '').replace(/^tag: refs\/tags\//, 'tag: ')).filter(x => !/\/HEAD$/.test(x)) };
  });
  return { commits: commits.slice(0, n), mas: commits.length > n };
}
const hashSafe = (h: unknown) => { const s = String(h ?? ''); if (!/^[0-9a-f]{4,64}$/i.test(s)) throw new Error(t('server.invalidCommit')); return s; };
export async function detailCommit(ruta: string, hash: string) {
  const h = hashSafe(hash);
  const [cab, numstat, nombres] = await Promise.all([
    git(ruta, ['show', '-s', '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ct%x1f%cn%x1f%ct%x1f%B', h]),
    git(ruta, ['show', '--format=', '--numstat', '-M', '--first-parent', '-m', h]),
    git(ruta, ['show', '--format=', '--name-status', '-M', '--first-parent', '-m', h]),
  ]);
  const [hash2, parents, autor, correo, fecha, , , cuerpo] = cab.split('\x1f');
  const stats = numstat.split('\n').filter(Boolean).map(l => { const [a, b] = l.split('\t'); return { mas: a === '-' ? null : +a, menos: b === '-' ? null : +b }; });
  const archivos = nombres.split('\n').filter(Boolean).map((l, i) => { const p = l.split('\t'); const letra = p[0][0] as Letter; return { letra, ruta: p[p.length - 1], ...(p.length > 2 ? { origen: p[1] } : {}), ...stats[i] }; });
  return { hash: hash2, parents: parents ? parents.split(' ') : [], autor, correo, fecha: Number(fecha) * 1000, mensaje: (cuerpo ?? '').trim(), archivos };
}
export async function diffCommit(ruta: string, hash: string, archivo: string, origen?: string) {
  const h = hashSafe(hash), a = safeFile(archivo);
  const rutas = origen ? ['--', safeFile(origen), a] : ['--', a];
  const hasParent = await git(ruta, ['rev-parse', '--verify', '-q', h + '^']).then(() => true, () => false);
  return diffOf(hasParent ? await git(ruta, ['diff', '-M', '--no-ext-diff', '--no-textconv', h + '^', h, ...rutas]) : await git(ruta, ['show', '--format=', '--no-ext-diff', '--no-textconv', h, ...rutas]));
}

// ---------------------------------------------------------------- ramas y cajón
export async function ramas(ruta: string) {
  const out = await git(ruta, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%1f%(refname:short)%1f%(objectname:short)%1f%(upstream:short)%1f%(upstream:track)%1f%(committerdate:unix)%1f%(HEAD)%1f%(contents:subject)', 'refs/heads', 'refs/remotes']);
  return out.split('\n').filter(Boolean).map(l => {
    const [ref, nombre, hash, upstream, track, fecha, cabeza, asunto] = l.split('\x1f');
    return { nombre, remota: ref.startsWith('refs/remotes/'), hash, upstream: upstream || undefined, adelante: +(/ahead (\d+)/.exec(track)?.[1] ?? 0), atras: +(/behind (\d+)/.exec(track)?.[1] ?? 0), lost: /gone/.test(track), fecha: Number(fecha) * 1000, actual: cabeza === '*', asunto };
  }).filter(r => !(r.remota && r.nombre.endsWith('/HEAD')) && r.nombre !== 'origin');
}
const branchName = async (ruta: string, n: unknown) => { const s = String(n ?? '').trim(); if (!s || s.startsWith('-')) throw new Error(t('server.invalidBranchName')); await git(ruta, ['check-ref-format', '--branch', s]).catch(() => { throw new Error(t('server.isNotAValidBranch', { v: s })); }); return s; };
export async function cambiarRama(ruta: string, d: { rama: string; remota?: boolean }) {
  // una remota sin rama local: se crea la local que la sigue (lo que hace `git switch` con su nombre corto)
  const rama = await branchName(ruta, d.rama);
  if (d.remota) { const local = rama.split('/').slice(1).join('/'); const existe = await git(ruta, ['rev-parse', '--verify', '-q', 'refs/heads/' + local]).then(() => true, () => false); await git(ruta, existe ? ['switch', local] : ['switch', '--track', rama], 60_000); }
  else await git(ruta, ['switch', rama], 60_000);
}
export async function crearRama(ruta: string, d: { nombre: string }) { await git(ruta, ['switch', '-c', await branchName(ruta, d.nombre)]); }
export async function borrarRama(ruta: string, d: { nombre: string; forzar?: boolean }) { await git(ruta, ['branch', d.forzar ? '-D' : '-d', await branchName(ruta, d.nombre)]); }

export async function cajon(ruta: string) {
  const out = await git(ruta, ['stash', 'list', '--format=%gd%x1f%s%x1f%ct']);
  return out.split('\n').filter(Boolean).map(l => { const [ref, asunto, fecha] = l.split('\x1f'); return { ref, asunto, fecha: Number(fecha) * 1000 }; });
}
const refDrawer = (r: unknown) => { const s = String(r ?? ''); if (!/^stash@\{\d+\}$/.test(s)) throw new Error(t('server.invalidStashEntry')); return s; };
export async function saveInDrawer(ruta: string, d: { mensaje?: string }) { await git(ruta, ['stash', 'push', '-u', ...(d.mensaje ? ['-m', String(d.mensaje).slice(0, 200)] : [])], 60_000); }
export async function takeOfDrawer(ruta: string, d: { ref: string; quedarse?: boolean }) { await git(ruta, ['stash', d.quedarse ? 'apply' : 'pop', refDrawer(d.ref)], 60_000); }
export async function throwOfDrawer(ruta: string, d: { ref: string }) { await git(ruta, ['stash', 'drop', refDrawer(d.ref)]); }

// ---------------------------------------------------------------- fusiones y rebases a medias
export async function abortar(ruta: string) {
  const op = (await estado(ruta)).operacion;
  if (!op) throw new Error(t('server.thereIsNoMergeOr'));
  await git(ruta, [op, '--abort'], 60_000);
}
export async function continuar(ruta: string) {
  const op = (await estado(ruta)).operacion;
  if (!op || op === 'merge') throw new Error(op === 'merge' ? 'Una fusión se termina con un commit.' : 'No hay nada a medias.');
  await ejecutar(ruta, [op, '--continue'], { timeout: 180_000 });
}

/** Abre un archivo del repo en tu editor (Cursor o VS Code; si no, el de texto de macOS: nunca la app por defecto de su
 *  tipo, que para un .command o un .app de un repo clonado sería ejecutarlo; ver abrir.ts). */
export async function abrirArchivo(ruta: string, archivo: string) {
  const f = path.join(ruta, safeFile(archivo));
  if (!existsSync(f)) throw new Error(t('server.thatFileIsNoLonger'));
  await abrirEnEditor(ruta, f);
}

// ---------------------------------------------------------------- remoto (solo cuando lo pide el Supervisor con su botón)
export async function sincronizar(ruta: string, que: 'fetch' | 'pull' | 'push' | 'sync') {
  const e = await estado(ruta);
  if (!e.remote.length) throw new Error(t('server.thisRepoHasNoRemote'));
  const largo = 180_000;
  const empujar = async () => {
    if (!e.rama) throw new Error(t('server.youAreNotOnAny'));
    if (e.upstream) return (await ejecutar(ruta, ['push'], { timeout: largo })).err;
    const remoto = e.remote.includes('origin') ? 'origin' : e.remote[0];
    return (await ejecutar(ruta, ['push', '-u', remoto, e.rama], { timeout: largo })).err;
  };
  const traer = async () => (await ejecutar(ruta, ['pull', '--no-edit'], { timeout: largo })).out;
  let salida = '';
  if (que === 'fetch') salida = (await ejecutar(ruta, ['fetch', '--all', '--prune'], { timeout: largo })).err;
  else if (que === 'pull') salida = await traer();
  else if (que === 'push') salida = await empujar();
  else { if (e.upstream && e.atras) salida += await traer(); if (!e.upstream || e.adelante || !e.atras) salida += '\n' + await empujar(); }
  return { salida: salida.trim().slice(-2000) };
}

// ---------------------------------------------------------------- GitHub: matriz de contribuciones y pull requests
export interface DayContrib { fecha: string; n: number; nivel: number }
export interface DataGitHub { fuente: 'github' | 'local'; demo?: boolean; usuario?: string; nombre?: string; total: number; days: DayContrib[]; prs?: { mine: PR[]; revisar: PR[]; nMine: number; nReview: number }; error?: string; ts: number }
interface PR { numero: number; titulo: string; url: string; repo: string; borrador: boolean; actualizado: number; revision?: string }

const LEVEL: Record<string, number> = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
const QUERY = `query {
  viewer { login name contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount contributionLevel } } } } }
  mios: search(query: "is:open is:pr author:@me archived:false sort:updated-desc", type: ISSUE, first: 12) { issueCount nodes { ...pr } }
  revisar: search(query: "is:open is:pr review-requested:@me archived:false sort:updated-desc", type: ISSUE, first: 12) { issueCount nodes { ...pr } }
}
fragment pr on PullRequest { number title url isDraft updatedAt reviewDecision repository { nameWithOwner } }`;

export function gh(args: string[], token?: string, timeout = 20_000): Promise<string> {
  const bin = ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh'];
  const probar = (i: number): Promise<string> => new Promise((ok, mal) => execFile(bin[i], args, { env: token ? { ...entorno(), GH_TOKEN: token } : entorno(), timeout, maxBuffer: 16 * 1024 * 1024 }, (err, out, errOut) => {
    if (err && (err as NodeJS.ErrnoException).code === 'ENOENT' && i + 1 < bin.length) return probar(i + 1).then(ok, mal);
    if (err) return mal(new Error(String(errOut || err.message).trim()));
    ok(String(out));
  }));
  return probar(0);
}

// Sin GitHub conectado: una matriz y unos PR inventados (estables por día), marcados DEMO
export function githubDemo(): DataGitHub {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const inicio = new Date(hoy); inicio.setDate(inicio.getDate() - 364 - inicio.getDay());
  const dia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const days: DayContrib[] = [];
  for (const d = new Date(inicio); d <= hoy; d.setDate(d.getDate() + 1)) {
    const h = Math.abs(Math.sin(d.getTime() / 86_400_000 * 12.9898) * 43758.5453) % 1, weekend = d.getDay() === 0 || d.getDay() === 6;
    const n = h < (weekend ? 0.75 : 0.25) ? 0 : Math.round((h - 0.2) * (weekend ? 4 : 14));
    days.push({ fecha: dia(d), n, nivel: !n ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 8 ? 3 : 4 });
  }
  const pr = (numero: number, titulo: string, repo: string, hours: number, revision?: string): { numero: number; titulo: string; url: string; repo: string; borrador: boolean; actualizado: number; revision?: string } =>
    ({ numero, titulo, url: `https://github.com/pulls#demo-${numero}`, repo, borrador: false, actualizado: Date.now() - hours * 3600_000, revision });
  return {
    fuente: 'github', demo: true, usuario: 'supervisor-demo', nombre: 'Supervisor (DEMO)', total: days.reduce((s, d) => s + d.n, 0), days, ts: Date.now(),
    prs: { mine: [pr(42, 'Rutas con parámetros opcionales', 'refugio/express', 3, 'REVIEW_REQUIRED'), pr(17, 'El reintento respeta el timeout', 'refugio/requests', 26, 'APPROVED')], revisar: [pr(8, 'Buscar dentro de archivos comprimidos', 'refugio/ripgrep', 5)], nMine: 2, nReview: 1 },
    error: 'DEMO: conecta GitHub en la cámara acorazada (tu token o la sesión de gh) para ver tu perfil y tus pull requests.',
  };
}

let cache: DataGitHub | null = null; let cacheOf = ''; let asking: Promise<DataGitHub> | null = null;
export function github(rutas: string[], forzar = false, connection: { real: boolean; token?: string } = { real: false }): Promise<DataGitHub> {
  if (!connection.real) return Promise.resolve(githubDemo());
  const de = connection.token ? 'token' : 'gh';
  if (cache && cacheOf === de && !forzar && Date.now() - cache.ts < 15 * 60_000) return Promise.resolve(cache);
  if (asking) return asking;
  asking = (async () => {
    cacheOf = de;
    try {
      const j = JSON.parse(await gh(['api', 'graphql', '-f', 'query=' + QUERY], connection.token));
      const v = j.data.viewer, cal = v.contributionsCollection.contributionCalendar;
      const pr = (n: any): PR => ({ numero: n.number, titulo: n.title, url: n.url, repo: n.repository?.nameWithOwner ?? '', borrador: !!n.isDraft, actualizado: Date.parse(n.updatedAt), revision: n.reviewDecision ?? undefined });
      cache = {
        fuente: 'github', usuario: v.login, nombre: v.name ?? undefined, total: cal.totalContributions, ts: Date.now(),
        days: cal.weeks.flatMap((w: any) => w.contributionDays.map((d: any) => ({ fecha: d.date, n: d.contributionCount, nivel: LEVEL[d.contributionLevel] ?? 0 }))),
        prs: { mine: (j.data.mine?.nodes ?? []).filter((n: any) => n?.number).map(pr), revisar: (j.data.revisar?.nodes ?? []).filter((n: any) => n?.number).map(pr), nMine: j.data.mine?.issueCount ?? 0, nReview: j.data.revisar?.issueCount ?? 0 },
      };
    } catch (err) {
      cache = { ...(await localContributions(rutas)), error: 'Sin GitHub (' + String((err as Error).message).split('\n')[0].slice(0, 160) + '): la matriz cuenta tus commits en los repos del refugio. Para la de tu perfil, instala gh y entra con «gh auth login».', ts: Date.now() };
    }
    return cache;
  })().finally(() => { asking = null; });
  return asking;
}

// ---------------------------------------------------------------- PR del tablero de Logística
// Tus PR abiertos y los cerrados o fusionados en las dos últimas semanas, con su rama (de ahí sale la tarea de Jira),
// la revisión y el estado de la CI del último commit. Sin GitHub conectado, unos inventados (DEMO) que cruzan con las
// tareas de demoPanelJira().
const QUERY_PRS = (desde: string) => `query {
  prs: search(query: "is:pr author:@me archived:false updated:>=${desde} sort:updated-desc", type: ISSUE, first: 60) { nodes { ... on PullRequest {
    number title body url isDraft state updatedAt reviewDecision headRefName baseRefName repository { nameWithOwner }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } }
}`;
export function prsOfGitHub(j: any): PRBoard[] {
  return (j?.data?.prs?.nodes ?? []).filter((n: any) => n?.number).map((n: any): PRBoard => ({
    numero: n.number, titulo: n.title, url: n.url, repo: n.repository?.nameWithOwner ?? '', rama: n.headRefName ?? '',
    estado: n.state === 'MERGED' ? 'fusionado' : n.state === 'CLOSED' ? 'cerrado' : n.isDraft ? 'borrador' : 'abierto',
    revision: n.reviewDecision ?? undefined, checks: n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? undefined, actualizado: Date.parse(n.updatedAt),
    base: n.baseRefName ?? undefined, dependencias: dependenciasEnTexto(`${n.title ?? ''}\n${n.body ?? ''}`, n.repository?.nameWithOwner ?? ''),
  }));
}
export function demoPRsBoard(): PRBoard[] {
  const pr = (numero: number, titulo: string, repo: string, rama: string, estado: PRBoard['estado'], hours: number, revision?: PRBoard['revision'], checks?: PRBoard['checks']): PRBoard =>
    ({ numero, titulo, url: `https://github.com/pulls#demo-${numero}`, repo, rama, estado, revision, checks, actualizado: Date.now() - hours * 3600_000 });
  return [
    pr(42, 'Rutas con parámetros opcionales', 'refugio/express', 'ref-212-barra-final', 'abierto', 3, 'REVIEW_REQUIRED', 'PENDING'),
    pr(51, 'Buscar en .zip y .tar.gz', 'refugio/ripgrep', 'feature/REF-240-comprimidos', 'abierto', 5, 'APPROVED', 'SUCCESS'),
    pr(17, 'REF-236 Reutilizar las conexiones de la sesión', 'refugio/requests', 'sesiones-persistentes', 'abierto', 20, 'CHANGES_REQUESTED', 'FAILURE'),
    pr(18, 'REF-236 Pruebas de la sesión con proxy', 'refugio/requests', 'ref-236-pruebas', 'borrador', 22, undefined, 'SUCCESS'),
    pr(39, 'Nuevo router: rutas anidadas', 'refugio/express', 'REF-219-router', 'fusionado', 26),
    pr(9, 'Ordenar la lista por temas', 'refugio/awesome', 'ordenar-temas', 'abierto', 8, 'REVIEW_REQUIRED', 'SUCCESS'),
  ].map(p => ({ ...p, base: p.numero === 18 ? 'sesiones-persistentes' : 'main', dependencias: p.numero === 42 ? ['refugio/express#39', 'refugio/ripgrep#51'] : [] }));   // #18 apilado sobre #17; #42 espera a #39 y #51
}
export async function prsTablero(connection: { real: boolean; token?: string }): Promise<{ prs: PRBoard[]; demo?: boolean; error?: string }> {
  if (!connection.real) return { prs: demoPRsBoard(), demo: true, error: 'DEMO: conecta GitHub en la cámara acorazada (tu token o la sesión de gh) para ver tus pull requests.' };
  const desde = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  try { return { prs: prsOfGitHub(JSON.parse(await gh(['api', 'graphql', '-f', 'query=' + QUERY_PRS(desde)], connection.token))) }; }
  catch (err) { return { prs: [], error: 'No se pudieron leer tus PR de GitHub (' + String((err as Error).message).split('\n')[0].slice(0, 160) + '). ¿Está gh instalado y con sesión («gh auth login»)?' }; }
}

// todos tus PR sin fusionar (para organizar las salas por tareas: server/organizar.ts), con su base y descripción
const OPEN_QUERY = `query {
  prs: search(query: "is:pr is:open author:@me archived:false sort:updated-desc", type: ISSUE, first: 100) { nodes { ... on PullRequest {
    number title body url isDraft state updatedAt reviewDecision headRefName baseRefName repository { nameWithOwner }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } }
}`;
export async function prsOpen(connection: { real: boolean; token?: string }): Promise<{ prs: PRBoard[]; demo?: boolean }> {
  if (!connection.real) return { prs: demoPRsBoard().filter(p => p.estado === 'abierto' || p.estado === 'borrador'), demo: true };
  return { prs: prsOfGitHub(JSON.parse(await gh(['api', 'graphql', '-f', 'query=' + OPEN_QUERY], connection.token))) };
}

/** La matriz del último año con tus commits en los repos del refugio (por tu user.email de git). */
export async function localContributions(rutas: string[]): Promise<DataGitHub> {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const inicio = new Date(hoy); inicio.setDate(inicio.getDate() - 364 - inicio.getDay());   // de domingo a hoy, como GitHub
  const dia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const cuenta = new Map<string, number>();
  await Promise.all(rutas.map(async r => {
    const correo = (await git(r, ['config', 'user.email']).catch(() => '')).trim(); if (!correo) return;
    const out = await git(r, ['log', '--branches', `--since=${inicio.toISOString()}`, `--author=${correo}`, '--format=%ct']).catch(() => '');
    for (const l of out.split('\n')) if (l) { const k = dia(new Date(Number(l) * 1000)); cuenta.set(k, (cuenta.get(k) ?? 0) + 1); }
  }));
  const days: DayContrib[] = [];
  for (const d = new Date(inicio); d <= hoy; d.setDate(d.getDate() + 1)) days.push({ fecha: dia(d), n: cuenta.get(dia(d)) ?? 0, nivel: 0 });
  // niveles por cuartiles de los días con algo, como GitHub
  const con = days.map(d => d.n).filter(Boolean).sort((a, b) => a - b);
  const q = (p: number) => con[Math.min(con.length - 1, Math.floor(con.length * p))] ?? 1;
  for (const d of days) d.nivel = !d.n ? 0 : d.n <= q(0.25) ? 1 : d.n <= q(0.5) ? 2 : d.n <= q(0.75) ? 3 : 4;
  return { fuente: 'local', total: days.reduce((s, d) => s + d.n, 0), days, ts: Date.now() };
}

// ---------------------------------------------------------------- despacho
export interface CtxGit { allowedPath: (r: string) => boolean; pathsRepos: () => string[]; alCambiar: (ruta: string) => void; github?: () => Promise<{ real: boolean; token?: string }> }
const WRITE = new Set(['abortar', 'continuar', 'preparar', 'quitar', 'descartar', 'parche', 'commit', 'deshacerCommit', 'cambiarRama', 'crearRama', 'borrarRama', 'cajonGuardar', 'cajonSacar', 'cajonTirar', 'sincronizar']);

export async function actionGit(nombre: string, d: Record<string, any>, ctx: CtxGit): Promise<unknown> {
  if (nombre === 'github') return github(ctx.pathsRepos(), !!d.forzar, (await ctx.github?.()) ?? { real: false });
  if (nombre === 'prsTablero') return prsTablero((await ctx.github?.()) ?? { real: false });
  const ruta = path.resolve(String(d.ruta ?? ''));
  if (!ctx.allowedPath(ruta)) throw new Error(t('server.thatFolderIsNotA'));
  const lista = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const r = await (async () => {
    switch (nombre) {
      case 'estado': return estado(ruta);
      case 'diff': return diff(ruta, d as any);
      case 'preparar': return preparar(ruta, lista(d.archivos));
      case 'quitar': return quitar(ruta, lista(d.archivos));
      case 'descartar': return descartar(ruta, lista(d.archivos), lista(d.withoutFollow));
      case 'parche': return applyPatch(ruta, String(d.parche ?? ''), d.modo === 'quitar' ? 'quitar' : d.modo === 'descartar' ? 'descartar' : 'preparar');
      case 'commit': return commit(ruta, d as any);
      case 'deshacerCommit': return deshacerCommit(ruta);
      case 'historial': return historial(ruta, d);
      case 'detalle': return detailCommit(ruta, d.hash);
      case 'diffCommit': return diffCommit(ruta, d.hash, d.archivo, d.origen);
      case 'ramas': return ramas(ruta);
      case 'cambiarRama': return cambiarRama(ruta, d as any);
      case 'crearRama': return crearRama(ruta, d as any);
      case 'borrarRama': return borrarRama(ruta, d as any);
      case 'cajon': return cajon(ruta);
      case 'cajonGuardar': return saveInDrawer(ruta, d);
      case 'cajonSacar': return takeOfDrawer(ruta, d as any);
      case 'cajonTirar': return throwOfDrawer(ruta, d as any);
      case 'abortar': return abortar(ruta);
      case 'continuar': return continuar(ruta);
      case 'abrirArchivo': return abrirArchivo(ruta, d.archivo);
      case 'sincronizar': return sincronizar(ruta, ['fetch', 'pull', 'push'].includes(d.que) ? d.que : 'sync');
      default: throw new Error('Acción de git desconocida: ' + nombre);
    }
  })().finally(() => { if (WRITE.has(nombre)) ctx.alCambiar(ruta); });
  return r ?? true;
}
