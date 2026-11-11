// El servidor de verdad, en un puerto y una carpeta de datos propios: rutas malformadas, orígenes, token y mensajes hostiles.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const PUERTO = 3700 + Math.floor(Math.random() * 60);
const DATOS = mkdtempSync(path.join(tmpdir(), 'refugio-prueba-'));
const BASE = `http://127.0.0.1:${PUERTO}`;
let srv: ChildProcess; let token = '';
const espera = (ms: number) => new Promise(r => setTimeout(r, ms));
const abrir = (q: string, origen = BASE) => new Promise<WebSocket | number>(ok => {
  const ws = new WebSocket(`ws://127.0.0.1:${PUERTO}/ws${q}`, { headers: { Origin: origen } });
  ws.on('open', () => ok(ws)); ws.on('unexpected-response', (_r, res) => ok(res.statusCode ?? 0)); ws.on('error', () => ok(-1));
});

beforeAll(async () => {
  // node con el cargador de tsx en el mismo proceso (el CLI de tsx crea un hijo que sobreviviría al kill)
  srv = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { env: { ...process.env, SHELTER_PUERTO: String(PUERTO), SHELTER_DATOS: DATOS, SHELTER_DEV: '' }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/salud')).ok) break; } catch {} await espera(150); }
  token = readFileSync(path.join(DATOS, 'token'), 'utf8').trim();
}, 30_000);
afterAll(() => { srv?.kill('SIGKILL'); rmSync(DATOS, { recursive: true, force: true }); });

describe('servidor local', () => {
  it('una URL malformada no lo tumba', async () => {
    for (const u of ['/%', '/%E0%A4%A', '/assets/%']) expect((await fetch(BASE + u)).status).toBe(400);
    expect((await fetch(BASE + '/salud')).ok).toBe(true);
  });
  it('la página no lleva el secreto del arranque', async () => {
    const r = await fetch(BASE + '/'); const t = await r.text();
    expect(t).not.toContain(token);
  });
  it('no sirve nada fuera de sus carpetas', async () => {
    const r = await fetch(BASE + '/assets/..%2Fpackage.json');
    expect(await r.text()).not.toContain('"name": "work-shelter"');
  });
  it('el WebSocket exige el token del arranque y un origen del propio refugio', async () => {
    expect(await abrir('')).toBe(403);
    expect(await abrir('?t=malo')).toBe(403);
    expect(await abrir(`?t=${token}`, 'http://evil.example')).toBe(403);
    expect(await abrir(`?t=${token}`, 'http://localhost:5173')).toBe(403); // los orígenes de Vite solo con SHELTER_DEV
    const ws = await abrir(`?t=${token}`); expect(typeof ws).toBe('object'); (ws as WebSocket).close();
  });
  it('mensajes hostiles no lo tumban ni reescriben el estado', async () => {
    const ws = await abrir(`?t=${token}`) as WebSocket;
    const responses: any[] = []; ws.on('message', d => responses.push(JSON.parse(String(d))));
    ws.send(JSON.stringify({ t: 'hola', version: 'prueba' }));
    ws.send(JSON.stringify({ t: 'lateral', sesionId: 'no-existe', pregunta: 'x' }));
    ws.send(JSON.stringify({ t: 'accion', nombre: 'guardar', peticion: 'g', datos: { parche: { salas: null, jugador: { scrap: 1e9 } } } }));
    ws.send(JSON.stringify({ t: 'accion', nombre: 'jugador', peticion: 'j', datos: { parche: { scrap: 1e9 } } }));
    ws.send(JSON.stringify({ t: 'accion', nombre: 'retirarSala', peticion: 'r', datos: { salaId: 'puerta' } }));
    await espera(800);
    expect((await fetch(BASE + '/salud')).ok).toBe(true);
    const estados = responses.filter(m => m.t === 'estado' || m.t === 'bienvenida');
    const ultimo = estados[estados.length - 1].estado;
    expect(ultimo.salas.length).toBeGreaterThan(5);
    expect(ultimo.jugador.scrap).toBeLessThan(1e9);
    expect(responses.find(m => m.peticion === 'j')?.error).toBeTruthy();
    expect(responses.find(m => m.peticion === 'r')?.error).toBeTruthy();
    ws.close();
  });
  it('no recluta la raíz ni el hogar, y al retirar una sala cierra sus terminales', async () => {
    const ws = await abrir(`?t=${token}`) as WebSocket;
    const responses: any[] = []; ws.on('message', d => responses.push(JSON.parse(String(d))));
    const ask = (nombre: string, datos: any, peticion: string) => ws.send(JSON.stringify({ t: 'accion', nombre, peticion, datos }));
    ask('reclutar', { ruta: '/' }, 'raiz'); ask('reclutar', { ruta: '~' }, 'hogar');
    const carpeta = mkdtempSync(path.join(tmpdir(), 'refugio-recluta-'));
    ask('reclutar', { ruta: carpeta }, 'rec');
    await espera(1500);
    expect(responses.find(m => m.peticion === 'raiz')?.error).toBeTruthy();
    expect(responses.find(m => m.peticion === 'hogar')?.error).toBeTruthy();
    const id = responses.find(m => m.peticion === 'rec')?.datos?.id; expect(id).toBeTruthy();
    ws.send(JSON.stringify({ t: 'terminalAbrir', id: 'prueba-term', cwd: carpeta, cols: 80, filas: 24 }));
    await espera(800);
    ask('retirarSala', { salaId: id }, 'ret'); await espera(800);
    expect(responses.find(m => m.peticion === 'ret')?.error).toBeFalsy();
    const antes = responses.length;
    ws.send(JSON.stringify({ t: 'terminalEntrada', id: 'prueba-term', datos: 'echo VIVA-$((6*7))\r' }));
    await espera(800);
    expect(responses.slice(antes).some(m => m.t === 'terminalDatos' && /VIVA-42/.test(m.datos))).toBe(false);
    const repos = responses.filter(m => m.t === 'repos').pop()?.repos ?? {};
    expect(Object.keys(repos)).not.toContain(id);
    ws.close(); rmSync(carpeta, { recursive: true, force: true });
  }, 15_000);
  it('vincula una sala de repo a otra carpeta: conserva sitio y habitante, y la escena vuelve a la de su tipo', async () => {
    const ws = await abrir(`?t=${token}`) as WebSocket;
    const responses: any[] = []; ws.on('message', d => responses.push(JSON.parse(String(d))));
    const ask = (nombre: string, datos: any, peticion: string) => ws.send(JSON.stringify({ t: 'accion', nombre, peticion, datos }));
    ws.send(JSON.stringify({ t: 'hola', version: 'prueba' }));
    const carpeta = mkdtempSync(path.join(tmpdir(), 'refugio-vincular-'));
    writeFileSync(path.join(carpeta, 'Cargo.toml'), '[package]\nname = "x"\n');
    // dos salas de repo propias (el refugio nuevo no trae ninguna)
    const a = mkdtempSync(path.join(tmpdir(), 'refugio-sala-a-')), b = mkdtempSync(path.join(tmpdir(), 'refugio-sala-b-'));
    ask('reclutar', { ruta: a }, 'ra'); ask('reclutar', { ruta: b }, 'rb'); await espera(1200);
    const idA = responses.find(m => m.peticion === 'ra')?.datos?.id, idB = responses.find(m => m.peticion === 'rb')?.datos?.id;
    expect(idA && idB).toBeTruthy();
    const antes = responses.filter(m => m.t === 'estado').pop().estado;
    const habitanteA = antes.habitantes.find((h: any) => h.salaId === idA)?.id; expect(habitanteA).toBeTruthy();
    ask('vincularSala', { salaId: 'puerta', ruta: carpeta }, 'servicio');
    ask('vincularSala', { salaId: idA, ruta: '/' }, 'raiz');
    ask('vincularSala', { salaId: idA, ruta: path.join(carpeta, 'no-existe') }, 'falta');
    ask('vincularSala', { salaId: idA, ruta: carpeta }, 'vin');
    await espera(1500);
    ask('vincularSala', { salaId: idB, ruta: carpeta }, 'repetida');
    ask('sala.quitarDecorado', { salaId: 'puerta' }, 'quitar');
    await espera(600);
    for (const p of ['servicio', 'raiz', 'falta', 'repetida', 'quitar']) expect(responses.find(m => m.peticion === p)?.error, p).toBeTruthy();
    expect(responses.find(m => m.peticion === 'vin')?.error).toBeFalsy();
    const ultimo = responses.filter(m => m.t === 'estado' || m.t === 'bienvenida').pop().estado;
    const sala = ultimo.salas.find((s: any) => s.id === idA);
    expect(sala).toMatchObject({ ruta: carpeta, nombre: path.basename(carpeta), tipo: 'repo' });
    expect(sala.decorado).toBeUndefined();
    expect(ultimo.habitantes.find((h: any) => h.id === habitanteA)?.salaId).toBe(idA);
    expect(responses.filter(m => m.t === 'repos').pop()?.repos?.[idA]?.tipo).toBe('rust');
    for (const id of [idA, idB]) ask('retirarSala', { salaId: id }, 'fin-' + id);
    await espera(800);
    ws.close(); for (const d of [carpeta, a, b]) rmSync(d, { recursive: true, force: true });
  }, 15_000);
  it('un refugio nuevo empieza sin salas de repo ni datos DEMO, y la raíz elegida trae sus repos y retira las de fuera', async () => {
    const ws = await abrir(`?t=${token}`) as WebSocket;
    const responses: any[] = []; ws.on('message', d => responses.push(JSON.parse(String(d))));
    const ask = (nombre: string, datos: any, peticion: string) => ws.send(JSON.stringify({ t: 'accion', nombre, peticion, datos }));
    ws.send(JSON.stringify({ t: 'hola', version: 'prueba' })); await espera(600);
    const inicial = responses.find(m => m.t === 'bienvenida').estado;
    expect(inicial.salas.filter((s: any) => s.tipo === 'repo')).toEqual([]);
    // ni datos de prueba ni fuentes que lean solas (Mail y Calendario del Mac, GitHub con gh): todas apagadas
    expect(new Set(Object.values(inicial.integraciones).map((i: any) => i.modo))).toEqual(new Set(['off']));
    expect(responses.filter(m => m.t === 'notificaciones').pop()?.lista ?? []).toEqual([]);
    ask('git.prsTablero', {}, 'prs'); await espera(600);
    expect(responses.find(m => m.peticion === 'prs')?.datos).toMatchObject({ prs: [] });
    expect(responses.find(m => m.peticion === 'prs')?.datos?.demo).toBeFalsy();
    // una raíz con dos repos de git, una carpeta suelta y un ala (dos repos dentro), y una sala de antes fuera de ella
    const raiz = mkdtempSync(path.join(tmpdir(), 'refugio-raiz-'));
    for (const r of ['api', 'web', 'ala/uno', 'ala/dos']) { mkdirSync(path.join(raiz, r), { recursive: true }); execFileSync('git', ['init', '-q'], { cwd: path.join(raiz, r) }); }
    mkdirSync(path.join(raiz, 'notas'));
    const fuera = mkdtempSync(path.join(tmpdir(), 'refugio-fuera-'));
    ask('reclutar', { ruta: fuera }, 'fuera'); await espera(800);
    const idFuera = responses.find(m => m.peticion === 'fuera')?.datos?.id; expect(idFuera).toBeTruthy();
    ask('guardar', { parche: { raizRepos: raiz } }, 'g'); await espera(2500);
    expect(responses.find(m => m.peticion === 'g')?.error).toBeFalsy();
    const ultimo = responses.filter(m => m.t === 'estado').pop().estado;
    const rutas = ultimo.salas.filter((s: any) => s.tipo === 'repo' || (s.tipo === 'coordinacion' && s.id !== 'tareas')).map((s: any) => s.ruta).sort();
    expect(rutas).toEqual(['ala', 'api', 'web'].map(r => path.join(raiz, r)));
    expect(ultimo.salas.some((s: any) => s.id === idFuera)).toBe(false);
    expect(ultimo.habitantes.some((h: any) => h.salaId === idFuera)).toBe(false);
    for (const s of ultimo.salas.filter((x: any) => rutas.includes(x.ruta))) expect(ultimo.habitantes.some((h: any) => h.salaId === s.id)).toBe(true);
    ws.close(); for (const d of [raiz, fuera]) rmSync(d, { recursive: true, force: true });
  }, 20_000);
});
