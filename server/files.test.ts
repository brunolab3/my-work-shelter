import { describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, symlinkSync, existsSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { filesAction } from './files.ts';
import { flatten, searchFiles, changedFolders, queryYLine, languageOf } from '../web/src/ui/files/common.ts';

const sh = (cwd: string, ...a: string[]) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
let root = '';
const act = (name: string, d: Record<string, unknown> = {}) => filesAction(name, { root, ...d }, { allowedRoots: () => [root], onChange: () => {} }) as Promise<any>;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'shelter-archivos-'));
  sh(root, 'init', '-q', '-b', 'main');
  sh(root, 'config', 'user.email', 'prueba@refugio'); sh(root, 'config', 'user.name', 'Prueba'); sh(root, 'config', 'commit.gpgsign', 'false');
  mkdirSync(path.join(root, 'src')); mkdirSync(path.join(root, 'node_modules/x'), { recursive: true });
  writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n.env\n');
  writeFileSync(path.join(root, 'src/app.ts'), 'export const a = 1;\n');
  writeFileSync(path.join(root, 'README.md'), '# hola\n');
  writeFileSync(path.join(root, 'node_modules/x/i.js'), '');
  sh(root, 'add', '.'); sh(root, 'commit', '-q', '-m', 'primero');
  writeFileSync(path.join(root, '.env'), 'CLAVE=1\n');
});

describe('archivos del refugio', () => {
  it('lista con carpetas primero, marca lo ignorado y los cambios de git', async () => {
    writeFileSync(path.join(root, 'src/app.ts'), 'export const a = 2;\n');
    writeFileSync(path.join(root, 'src/nuevo.ts'), '');
    const v = await act('vistazo', { folders: ['', 'src'] });
    expect(v.listed[''].map((e: any) => e.name)).toEqual(['node_modules', 'src', '.env', '.gitignore', 'README.md']);
    expect(v.listed[''].find((e: any) => e.name === '.env').ignored).toBe(true);
    expect(v.listed[''].find((e: any) => e.name === 'node_modules').ignored).toBe(true);
    expect(v.listed[''].find((e: any) => e.name === 'src').ignored).toBeUndefined();
    expect(v.git).toEqual({ 'src/app.ts': 'M', 'src/nuevo.ts': '?' });
  });

  it('lee y guarda (también lo que git ignora), sin pisar lo que ha cambiado en el disco', async () => {
    const l = await act('leer', { rel: '.env' });
    expect(l).toMatchObject({ type: 'texto', text: 'CLAVE=1\n' });
    const g = await act('guardar', { rel: '.env', text: 'CLAVE=2\n', date: l.date });
    expect(g.conflict).toBe(false);
    expect(readFileSync(path.join(root, '.env'), 'utf8')).toBe('CLAVE=2\n');
    // alguien lo toca por fuera
    writeFileSync(path.join(root, '.env'), 'CLAVE=3\n'); utimesSync(path.join(root, '.env'), new Date(), new Date(Date.now() + 5000));
    expect((await act('guardar', { rel: '.env', text: 'CLAVE=4\n', date: g.date })).conflict).toBe(true);
    expect(readFileSync(path.join(root, '.env'), 'utf8')).toBe('CLAVE=3\n');
    expect((await act('guardar', { rel: '.env', text: 'CLAVE=4\n', date: g.date, force: true })).conflict).toBe(false);
    expect(readFileSync(path.join(root, '.env'), 'utf8')).toBe('CLAVE=4\n');
  });

  it('distingue binarios e imágenes', async () => {
    writeFileSync(path.join(root, 'b.bin'), Buffer.from([1, 0, 2]));
    writeFileSync(path.join(root, 'p.png'), Buffer.from([137, 80, 78, 71]));
    expect((await act('leer', { rel: 'b.bin' })).type).toBe('binario');
    expect((await act('leer', { rel: 'p.png' })).data).toMatch(/^data:image\/png;base64,/);
  });

  it('no sale de la raíz: ni con .. ni con enlaces ni con otra carpeta', async () => {
    await expect(act('leer', { rel: '../x' })).rejects.toThrow(/no válida/);
    const outside = mkdtempSync(path.join(os.tmpdir(), 'shelter-fuera-'));
    writeFileSync(path.join(outside, 'secreto'), 'x');
    symlinkSync(outside, path.join(root, 'enlace'));
    await expect(act('leer', { rel: 'enlace/secreto' })).rejects.toThrow(/sale de la carpeta/);
    await expect(act('guardar', { rel: 'enlace/otro', text: 'x' })).rejects.toThrow(/sale de la carpeta/);
    await expect(filesAction('leer', { root: outside, rel: 'secreto' }, { allowedRoots: () => [root], onChange: () => {} })).rejects.toThrow(/ninguna sala/);
  });

  it('crea, renombra, pega (con nombre libre) y mueve', async () => {
    expect((await act('crear', { folder: 'src', name: 'lib/util.ts' })).rel).toBe('src/lib/util.ts');
    await expect(act('crear', { folder: 'src', name: 'app.ts' })).rejects.toThrow(/Ya hay/);
    expect((await act('renombrar', { rel: 'src/lib', name: 'comun' })).rel).toBe('src/comun');
    expect(existsSync(path.join(root, 'src/comun/util.ts'))).toBe(true);
    expect((await act('pegar', { folder: 'src', origins: [{ root, rel: 'src/app.ts' }] })).rels).toEqual(['src/app copy.ts']);
    expect((await act('pegar', { folder: 'src', origins: [{ root, rel: 'src/app.ts' }] })).rels).toEqual(['src/app copy 2.ts']);
    expect((await act('pegar', { folder: '', origins: [{ root, rel: '.env' }] })).rels).toEqual(['.env copy']);
    expect((await act('pegar', { folder: 'src/comun', origins: [{ root, rel: 'README.md' }], move: true })).rels).toEqual(['src/comun/README.md']);
    expect(existsSync(path.join(root, 'README.md'))).toBe(false);
    await expect(act('pegar', { folder: 'src/comun', origins: [{ root, rel: 'src' }], move: true })).rejects.toThrow(/sí misma/);
  });

  it('para ⌘P: lo de git, lo nuevo y los archivos ignorados sueltos (no las carpetas ignoradas)', async () => {
    writeFileSync(path.join(root, 'src/nuevo.ts'), '');
    const { rels } = await act('todos');
    expect(rels.sort()).toEqual(['.env', '.gitignore', 'README.md', 'src/app.ts', 'src/nuevo.ts']);
  });
});

describe('piezas del explorador', () => {
  it('aplana el árbol con lo desplegado', () => {
    const f = flatten({ '': [{ name: 'src', dir: true }, { name: 'a.ts', dir: false }], src: [{ name: 'b.ts', dir: false }] }, new Set(['src']));
    expect(f.map(x => [x.rel, x.level])).toEqual([['src', 0], ['src/b.ts', 1], ['a.ts', 0]]);
    expect(flatten({ '': [{ name: 'src', dir: true }] }, new Set()).length).toBe(1);
  });
  it('marca las carpetas con cambios dentro', () => {
    expect([...changedFolders({ 'a/b/c.ts': 'M', 'a/x.ts': 'D' })]).toEqual([['a/b', 'M'], ['a', 'D']]);
  });
  it('busca como ⌘P: el nombre antes que la ruta, y lo seguido antes que lo suelto', () => {
    const rels = ['web/src/ui/git/GitClient.tsx', 'server/git.ts', 'web/src/ui/Bar.tsx', 'docs/registro/git-notas.md', '.env.local'];
    expect(searchFiles('git', rels)[0].rel).toBe('server/git.ts');
    expect(searchFiles('gitcl', rels)[0].rel).toBe('web/src/ui/git/GitClient.tsx');
    expect(searchFiles('uibar', rels)[0].rel).toBe('web/src/ui/Bar.tsx');
    expect(searchFiles('env', rels)[0].rel).toBe('.env.local');
    expect(searchFiles('zzz', rels)).toEqual([]);
    expect(queryYLine('app.ts:42:7')).toEqual({ query: 'app.ts', line: 42, column: 7 });
    expect(queryYLine('app.ts')).toEqual({ query: 'app.ts' });
  });
  it('elige el idioma por nombre, patrón y extensión', () => {
    const languages = [{ id: 'typescript', extensions: ['.ts', '.tsx'] }, { id: 'dotenv', filenamePatterns: ['.env', '.env.*'] }, { id: 'dockerfile', filenames: ['Dockerfile'] }, { id: 'xml', extensions: ['.xml'] }, { id: 'yaml', extensions: ['.yml', '.d.yml'] }];
    expect(languageOf('a.tsx', languages)).toBe('typescript');
    expect(languageOf('.env.local', languages)).toBe('dotenv');
    expect(languageOf('.env', languages)).toBe('dotenv');
    expect(languageOf('Dockerfile', languages)).toBe('dockerfile');
    expect(languageOf('x.d.yml', languages)).toBe('yaml');
    expect(languageOf('LICENSE', languages)).toBe('plaintext');
  });
});
