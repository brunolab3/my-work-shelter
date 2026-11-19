// QA de «salir a la superficie» con un servidor propio (datos temporales, puerto 3791) que en vez de abrir iTerm
// apunta lo que abriría (SHELTER_ESCRITORIO_PRUEBA). Puerto 3793 (o SHELTER_PUERTO_QA). Comprueba:
//  1. sacar una terminal: el comando que se abriría la engancha de verdad (el mismo shell) y el juego lo sabe
//  2. sacar una conversación real (haiku, una frase): se cierra en el juego y sale `claude --resume <id>`
//  3. con esa conversación abierta «fuera», el refugio no deja retomarla
//  4. el juego se cae (se va el cliente sin «Salir»): lo abierto sale solo y la terminal enganchada sobrevive
// Uso: node scripts/qa-surface.mjs [--sin-sesion]   (SHELTER_PUERTO_QA para otro puerto)
import WebSocket from 'ws';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.SHELTER_PUERTO_QA || 3793);
const DATA = mkdtempSync(path.join(os.tmpdir(), 'ws-superficie-'));
const NOTES = path.join(DATA, 'escritorio.jsonl');
const SOCKET = path.join(os.tmpdir(), `work-shelter-${createHash('sha1').update(path.resolve(DATA)).digest('hex').slice(0, 10)}.sock`);
const withSession = !process.argv.includes('--sin-sesion');
const t0 = Date.now(); const log = (...a) => console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s`, ...a);
const failures = [];
const check = (ok, what) => { log(ok ? '✓' : '✗', what); if (!ok) failures.push(what); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const notes = () => existsSync(NOTES) ? readFileSync(NOTES, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
async function until(f, ms = 15000, what = '') { for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) { const r = f(); if (r) return r; } throw new Error('Tiempo agotado: ' + what); }

const env = { ...process.env, SHELTER_DATOS: DATA, SHELTER_PUERTO: String(PORT), SHELTER_ESCRITORIO_PRUEBA: NOTES, SHELTER_SALIR_SIN_CLIENTES: '1' };
const busy = await fetch(`http://127.0.0.1:${PORT}/salud`).then(() => true, () => false);
if (busy) { console.error(`El puerto ${PORT} ya está ocupado: usa SHELTER_PUERTO_QA=otro`); process.exit(2); }
const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = ''; server.stdout.on('data', d => { serverOutput += d; }); server.stderr.on('data', d => { serverOutput += d; });
const hooks = [];
let fake = null;
function finish(code) {
  for (const e of hooks) try { e.kill('SIGKILL'); } catch {}
  try { fake?.kill('SIGKILL'); } catch {}
  try { server.kill('SIGKILL'); } catch {}
  // el anfitrión de terminales de esta prueba
  const s = net.connect(SOCKET); s.on('connect', () => { s.write(JSON.stringify({ op: 'servidor' }) + '\n' + JSON.stringify({ op: 'cerrarTodas' }) + '\n' + JSON.stringify({ op: 'apagar' }) + '\n'); setTimeout(() => process.exit(code), 300); }); s.on('error', () => process.exit(code));
}
setTimeout(() => { log('TIEMPO AGOTADO'); console.log(serverOutput.slice(-2000)); finish(2); }, 240_000);

// un `./shelter enganchar` de verdad, dentro de un pseudoterminal, como lo haría iTerm (un puente en Python: `script`
// no da terminal si su entrada no lo es)
const BRIDGE = `import os, pty, select, sys
pid, fd = pty.fork()
if pid == 0: os.execv('/bin/bash', ['bash', '-c', sys.argv[1]])
while True:
    r, _, _ = select.select([fd, 0], [], [])
    try:
        if fd in r: d = os.read(fd, 65536); os.write(1, d) if d else sys.exit(0)
        if 0 in r: d = os.read(0, 65536); os.write(fd, d) if d else sys.exit(0)
    except OSError: sys.exit(0)`;
function hookOutside(command) {
  const p = spawn('python3', ['-c', BRIDGE, command], { cwd: os.homedir(), stdio: ['pipe', 'pipe', 'pipe'] });
  let text = ''; p.stdout.on('data', d => { text += d; });
  hooks.push(p);
  return { p, text: () => text, write: s => p.stdin.write(s) };
}

try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/salud`)).ok) break; } catch {} await sleep(150); }
  const token = readFileSync(path.join(DATA, 'token'), 'utf8').trim();
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?t=${token}`, { headers: { Origin: `http://127.0.0.1:${PORT}` } });
  const received = [];
  let n = 0;
  const pending = new Map();
  ws.on('message', raw => { const m = JSON.parse(String(raw)); received.push(m); if (m.t === 'respuesta' && pending.has(m.request)) { const f = pending.get(m.request); pending.delete(m.request); f(m); } });
  await new Promise(ok => ws.on('open', ok));
  const send = m => ws.send(JSON.stringify(m));
  const ask = (m) => new Promise(ok => { const request = 'q' + (++n); pending.set(request, ok); send({ ...m, request }); });
  const action = (name, data) => ask({ t: 'accion', name, data });
  send({ t: 'hola', version: 'qa' });
  const welcome = await until(() => received.find(m => m.t === 'bienvenida'), 10000, 'bienvenida');
  // una sala especial sin repo (su carpeta está dentro de los datos temporales): nada de lo que pase toca un repo
  const dw = welcome.state.dwellers.find(h => welcome.state.rooms.some(s => s.id === h.roomId && !s.path && s.type !== 'puente'));
  const room = welcome.state.rooms.find(s => s.id === dw.roomId);
  const folder = room.folder ?? path.join(DATA, 'salas', room.id);
  log('sala', room.id, 'habitante', dw.name, 'claude', welcome.claudeOk);

  // 1. terminal
  const tid = 'sala:' + room.id;
  // la carpeta de una sala especial se crea al trabajar en ella; aquí se crea a mano
  (await import('node:fs')).mkdirSync(folder, { recursive: true });
  send({ t: 'terminalAbrir', id: tid, cwd: folder, cols: 90, rows: 26 });
  await until(() => received.some(m => m.t === 'terminalDatos' && m.id === tid), 10000, 'terminal abierta').catch(e => { console.log(received.filter(m => m.t !== 'bienvenida').map(m => JSON.stringify(m).slice(0, 200))); throw e; });
  send({ t: 'terminalEntrada', id: tid, data: 'export MARCA=refugio-$((40+2))\r' });
  await sleep(500);
  const r1 = await action('superficie.sacar', { terminals: [tid] });
  check(!r1.error && r1.data.terminals === 1, 'sacar una terminal responde 1 terminal');
  const a1 = notes().at(-1);
  check(a1 && /enganchar 'sala:/.test(a1.items[0].command) && a1.items[0].command.includes(SOCKET), 'se abriría `./shelter enganchar` con su socket');
  const outside = hookOutside(a1.items[0].command);
  await until(() => received.some(m => m.t === 'terminalEstado' && m.id === tid && m.outside === 1), 10000, 'el juego sabe que está fuera').catch(e => { console.log('FUERA:', JSON.stringify(outside.text().slice(-600))); throw e; });
  check(true, 'el juego marca la terminal como abierta en el escritorio');
  outside.write('echo "$MARCA"\r');
  await until(() => outside.text().includes('refugio-42'), 8000, 'el shell de fuera es el mismo');
  check(true, 'fuera se escribe en el mismo shell (ve la variable del juego)');
  await until(() => received.some(m => m.t === 'terminalDatos' && m.id === tid && String(m.data).includes('refugio-42')), 5000, 'el juego ve lo de fuera');
  check(true, 'el juego ve lo que se escribe fuera');

  // 2 y 3. conversación
  if (withSession && welcome.claudeOk) {
    const sid = (await ask({ t: 'empezar', dwellerId: dw.id, roomId: room.id, prompt: 'Responde solo con la palabra: superficie', options: { model: 'haiku', permissions: 'acceptEdits' } })).data;
    const sess = await until(() => { const s = received.filter(m => m.t === 'sesion' && m.session.id === sid).at(-1)?.session; return s && s.state === 'terminada' && s.claudeId ? s : null; }, 90000, 'la conversación termina');
    log('conversación', sess.claudeId, '→', (sess.lastText || '').slice(0, 40));
    const r2 = await action('superficie.sacar', { sessions: [sid] });
    check(!r2.error && r2.data.sessions === 1, 'sacar una conversación responde 1 conversación');
    const a2 = notes().at(-1);
    check(a2?.items[0].command === `cd '${sess.cwd}' && claude --resume ${sess.claudeId} --model 'haiku' --permission-mode acceptEdits`, 'se abriría `claude --resume` en su carpeta: ' + a2?.items[0].command);
    await until(() => received.some(m => m.t === 'sesion' && m.session.id === sid && m.session.state === 'cerrada'), 10000, 'cerrada en el juego');
    check(true, 'la conversación se cierra en el juego');
    // un `claude --resume <id>` fuera (de mentira): el refugio no deja retomarla
    fake = spawn('/bin/bash', ['-c', `exec -a "claude --resume ${sess.claudeId}" sleep 60`], { stdio: 'ignore' });
    await sleep(300);
    const hist = await ask({ t: 'historial', roomId: room.id });
    check(hist.data.some(x => x.claudeId === sess.claudeId && x.outside), 'el archivo la marca como abierta en el escritorio');
    const r3 = await ask({ t: 'empezar', dwellerId: dw.id, roomId: room.id, prompt: '', options: { resume: sess.claudeId } });
    check(!!r3.error && /escritorio/.test(r3.error), 'no deja retomarla mientras siga fuera');
    fake.kill('SIGKILL'); fake = null;
    // a mitad de trabajo (esperando un permiso): se interrumpe aquí y fuera se le pide que siga
    const sid2 = (await ask({ t: 'empezar', dwellerId: dw.id, roomId: room.id, prompt: 'Ejecuta con la herramienta Bash exactamente: sleep 1 && echo listo. Luego responde «hecho».', options: { model: 'haiku', permissions: 'default' } })).data;
    const sess2 = await until(() => { const s = received.filter(m => m.t === 'sesion' && m.session.id === sid2).at(-1)?.session; return s && s.claudeId && (s.state === 'esperando' || s.state === 'trabajando') ? s : null; }, 90000, 'la segunda conversación trabaja o espera');
    log('segunda conversación', sess2.state);
    const r4 = await action('superficie.sacar', { sessions: [sid2] });
    const a4 = notes().at(-1);
    check(!r4.error && r4.data.sessions === 1 && a4.items[0].command.includes(`--resume ${sess2.claudeId}`) && a4.items[0].command.includes('Sigue con lo que estabas haciendo'), 'a mitad de trabajo: se interrumpe y fuera se le pide que siga');
  } else log('(sin conversación real)');

  // 4. el juego se cae: otra terminal abierta y el cliente se va sin «Salir»
  const tid2 = tid + '::2';
  send({ t: 'terminalAbrir', id: tid2, cwd: folder, cols: 90, rows: 26 });
  await until(() => received.some(m => m.t === 'terminalDatos' && m.id === tid2), 10000, 'segunda terminal');
  const before = notes().length;
  ws.terminate();
  log('cliente fuera; espero el margen de 20 s…');
  const fall = await until(() => notes().length > before ? notes().at(-1) : null, 40000, 'salida a la superficie al caerse');
  check(fall.windowNew && fall.items.length === 1 && fall.items[0].command.includes(`'${tid2}'`), 'al caerse sale sola la terminal que no estaba fuera, en ventana nueva');
  const outside2 = hookOutside(fall.items[0].command);
  await until(() => server.exitCode !== null, 20000, 'el servidor se apaga');
  check(true, 'el servidor se apaga tras sacarlo todo');
  outside2.write('echo sigo-$((5+5))\r');
  await until(() => outside2.text().includes('sigo-10'), 8000, 'la terminal de fuera sigue tras el apagado');
  check(true, 'la terminal enganchada sigue viva con el juego apagado');
  outside.write('echo "$MARCA"-bis\r');
  await until(() => outside.text().includes('refugio-42-bis'), 8000, 'la primera también');
  check(true, 'la primera terminal sacada también sigue');
} catch (e) { failures.push(e.message); log('✗', e.message); console.log(serverOutput.slice(-1500)); }
console.log(failures.length ? `\nFALLA: ${failures.length}\n- ${failures.join('\n- ')}` : '\nTODO BIEN');
finish(failures.length ? 1 : 0);
