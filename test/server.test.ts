// El servidor de verdad, en un puerto y una carpeta de datos propios: rutas malformadas, orígenes, token y mensajes hostiles.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const PORT = 3700 + Math.floor(Math.random() * 60);
const DATA = mkdtempSync(path.join(tmpdir(), 'refugio-prueba-'));
const BASE = `http://127.0.0.1:${PORT}`;
let srv: ChildProcess; let token = '';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const open = (q: string, origin = BASE) => new Promise<WebSocket | number>(ok => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws${q}`, { headers: { Origin: origin } });
  ws.on('open', () => ok(ws)); ws.on('unexpected-response', (_r, res) => ok(res.statusCode ?? 0)); ws.on('error', () => ok(-1));
});

beforeAll(async () => {
  // node con el cargador de tsx en el mismo proceso (el CLI de tsx crea un hijo que sobreviviría al kill)
  srv = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { env: { ...process.env, SHELTER_PUERTO: String(PORT), SHELTER_DATOS: DATA, SHELTER_DEV: '' }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/salud')).ok) break; } catch {} await wait(150); }
  token = readFileSync(path.join(DATA, 'token'), 'utf8').trim();
}, 30_000);
afterAll(() => { srv?.kill('SIGKILL'); rmSync(DATA, { recursive: true, force: true }); });

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
    expect(await open('')).toBe(403);
    expect(await open('?t=malo')).toBe(403);
    expect(await open(`?t=${token}`, 'http://evil.example')).toBe(403);
    expect(await open(`?t=${token}`, 'http://localhost:5173')).toBe(403); // los orígenes de Vite solo con SHELTER_DEV
    const ws = await open(`?t=${token}`); expect(typeof ws).toBe('object'); (ws as WebSocket).close();
  });
  it('mensajes hostiles no lo tumban ni reescriben el estado', async () => {
    const ws = await open(`?t=${token}`) as WebSocket;
    const responses: any[] = []; ws.on('message', d => responses.push(JSON.parse(String(d))));
    ws.send(JSON.stringify({ t: 'hola', version: 'prueba' }));
    ws.send(JSON.stringify({ t: 'lateral', sessionId: 'no-existe', question: 'x' }));
    ws.send(JSON.stringify({ t: 'accion', name: 'guardar', request: 'g', data: { patch: { rooms: null, jugador: { scrap: 1e9 } } } }));
    ws.send(JSON.stringify({ t: 'accion', name: 'jugador', request: 'j', data: { patch: { scrap: 1e9 } } }));
    ws.send(JSON.stringify({ t: 'accion', name: 'retirarSala', request: 'r', data: { roomId: 'puerta' } }));
    await wait(800);
    expect((await fetch(BASE + '/salud')).ok).toBe(true);
    const states = responses.filter(m => m.t === 'estado' || m.t === 'bienvenida');
    const last = states[states.length - 1].state;
    expect(last.rooms.length).toBeGreaterThan(5);
    expect(last.jugador.scrap).toBeLessThan(1e9);
    expect(responses.find(m => m.request === 'j')?.error).toBeTruthy();
    expect(responses.find(m => m.request === 'r')?.error).toBeTruthy();
    ws.close();
  });
  it('no recluta la raíz ni el hogar, y al retirar una sala cierra sus terminales', async () => {
    const ws = await open(`?t=${token}`) as WebSocket;
    const responses: any[] = []; ws.on('message', d => responses.push(JSON.parse(String(d))));
    const ask = (name: string, data: any, request: string) => ws.send(JSON.stringify({ t: 'accion', name, request, data }));
    ask('reclutar', { path: '/' }, 'raiz'); ask('reclutar', { path: '~' }, 'hogar');
    const folder = mkdtempSync(path.join(tmpdir(), 'refugio-recluta-'));
    ask('reclutar', { path: folder }, 'rec');
    await wait(1500);
    expect(responses.find(m => m.request === 'raiz')?.error).toBeTruthy();
    expect(responses.find(m => m.request === 'hogar')?.error).toBeTruthy();
    const id = responses.find(m => m.request === 'rec')?.data?.id; expect(id).toBeTruthy();
    ws.send(JSON.stringify({ t: 'terminalAbrir', id: 'prueba-term', cwd: folder, cols: 80, rows: 24 }));
    await wait(800);
    ask('retirarSala', { roomId: id }, 'ret'); await wait(800);
    expect(responses.find(m => m.request === 'ret')?.error).toBeFalsy();
    const before = responses.length;
    ws.send(JSON.stringify({ t: 'terminalEntrada', id: 'prueba-term', data: 'echo VIVA-$((6*7))\r' }));
    await wait(800);
    expect(responses.slice(before).some(m => m.t === 'terminalDatos' && /VIVA-42/.test(m.data))).toBe(false);
    const repos = responses.filter(m => m.t === 'repos').pop()?.repos ?? {};
    expect(Object.keys(repos)).not.toContain(id);
    ws.close(); rmSync(folder, { recursive: true, force: true });
  }, 15_000);
  it('vincula una sala de repo a otra carpeta: conserva sitio y habitante, y la escena vuelve a la de su tipo', async () => {
    const ws = await open(`?t=${token}`) as WebSocket;
    const responses: any[] = []; ws.on('message', d => responses.push(JSON.parse(String(d))));
    const ask = (name: string, data: any, request: string) => ws.send(JSON.stringify({ t: 'accion', name, request, data }));
    ws.send(JSON.stringify({ t: 'hola', version: 'prueba' }));
    const folder = mkdtempSync(path.join(tmpdir(), 'refugio-vincular-'));
    writeFileSync(path.join(folder, 'Cargo.toml'), '[package]\nname = "x"\n');
    // dos salas de repo propias (el refugio nuevo no trae ninguna)
    const a = mkdtempSync(path.join(tmpdir(), 'refugio-sala-a-')), b = mkdtempSync(path.join(tmpdir(), 'refugio-sala-b-'));
    ask('reclutar', { path: a }, 'ra'); ask('reclutar', { path: b }, 'rb'); await wait(1200);
    const idA = responses.find(m => m.request === 'ra')?.data?.id, idB = responses.find(m => m.request === 'rb')?.data?.id;
    expect(idA && idB).toBeTruthy();
    const before = responses.filter(m => m.t === 'estado').pop().state;
    const dwellerA = before.dwellers.find((h: any) => h.roomId === idA)?.id; expect(dwellerA).toBeTruthy();
    ask('vincularSala', { roomId: 'puerta', path: folder }, 'servicio');
    ask('vincularSala', { roomId: idA, path: '/' }, 'raiz');
    ask('vincularSala', { roomId: idA, path: path.join(folder, 'no-existe') }, 'falta');
    ask('vincularSala', { roomId: idA, path: folder }, 'vin');
    await wait(1500);
    ask('vincularSala', { roomId: idB, path: folder }, 'repetida');
    ask('sala.quitarDecorado', { roomId: 'puerta' }, 'quitar');
    await wait(600);
    for (const p of ['servicio', 'raiz', 'falta', 'repetida', 'quitar']) expect(responses.find(m => m.request === p)?.error, p).toBeTruthy();
    expect(responses.find(m => m.request === 'vin')?.error).toBeFalsy();
    const last = responses.filter(m => m.t === 'estado' || m.t === 'bienvenida').pop().state;
    const room = last.rooms.find((s: any) => s.id === idA);
    expect(room).toMatchObject({ path: folder, name: path.basename(folder), type: 'repo' });
    expect(room.decor).toBeUndefined();
    expect(last.dwellers.find((h: any) => h.id === dwellerA)?.roomId).toBe(idA);
    expect(responses.filter(m => m.t === 'repos').pop()?.repos?.[idA]?.type).toBe('rust');
    for (const id of [idA, idB]) ask('retirarSala', { roomId: id }, 'fin-' + id);
    await wait(800);
    ws.close(); for (const d of [folder, a, b]) rmSync(d, { recursive: true, force: true });
  }, 15_000);
  it('un refugio nuevo empieza sin salas de repo ni datos DEMO, y la raíz elegida trae sus repos y retira las de fuera', async () => {
    const ws = await open(`?t=${token}`) as WebSocket;
    const responses: any[] = []; ws.on('message', d => responses.push(JSON.parse(String(d))));
    const ask = (name: string, data: any, request: string) => ws.send(JSON.stringify({ t: 'accion', name, request, data }));
    ws.send(JSON.stringify({ t: 'hola', version: 'prueba' })); await wait(600);
    const initial = responses.find(m => m.t === 'bienvenida').state;
    expect(initial.rooms.filter((s: any) => s.type === 'repo')).toEqual([]);
    // ni datos de prueba ni fuentes que lean solas (Mail y Calendario del Mac, GitHub con gh): todas apagadas
    expect(new Set(Object.values(initial.integrations).map((i: any) => i.mode))).toEqual(new Set(['off']));
    expect(responses.filter(m => m.t === 'notificaciones').pop()?.list ?? []).toEqual([]);
    ask('git.prsTablero', {}, 'prs'); await wait(600);
    expect(responses.find(m => m.request === 'prs')?.data).toMatchObject({ prs: [] });
    expect(responses.find(m => m.request === 'prs')?.data?.demo).toBeFalsy();
    // una raíz con dos repos de git, una carpeta suelta y un ala (dos repos dentro), y una sala de antes fuera de ella
    const root = mkdtempSync(path.join(tmpdir(), 'refugio-raiz-'));
    for (const r of ['api', 'web', 'ala/uno', 'ala/dos']) { mkdirSync(path.join(root, r), { recursive: true }); execFileSync('git', ['init', '-q'], { cwd: path.join(root, r) }); }
    mkdirSync(path.join(root, 'notas'));
    const outside = mkdtempSync(path.join(tmpdir(), 'refugio-fuera-'));
    ask('reclutar', { path: outside }, 'fuera'); await wait(800);
    const outsideId = responses.find(m => m.request === 'fuera')?.data?.id; expect(outsideId).toBeTruthy();
    ask('guardar', { patch: { reposRoot: root } }, 'g'); await wait(2500);
    expect(responses.find(m => m.request === 'g')?.error).toBeFalsy();
    const last = responses.filter(m => m.t === 'estado').pop().state;
    const paths = last.rooms.filter((s: any) => s.type === 'repo' || (s.type === 'coordinacion' && s.id !== 'tareas')).map((s: any) => s.path).sort();
    expect(paths).toEqual(['ala', 'api', 'web'].map(r => path.join(root, r)));
    expect(last.rooms.some((s: any) => s.id === outsideId)).toBe(false);
    expect(last.dwellers.some((h: any) => h.roomId === outsideId)).toBe(false);
    for (const s of last.rooms.filter((x: any) => paths.includes(x.path))) expect(last.dwellers.some((h: any) => h.roomId === s.id)).toBe(true);
    ws.close(); for (const d of [root, outside]) rmSync(d, { recursive: true, force: true });
  }, 20_000);
});
