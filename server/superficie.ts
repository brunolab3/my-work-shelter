// Salir a la superficie desde fuera del juego (lo usa ./shelter):
//   ./shelter superficie           lo que esté abierto en el refugio, a pestañas de iTerm (o Terminal)
//   ./shelter superficie --lista   qué hay abierto, sin abrir nada
//   ./shelter enganchar <id> [--socket ruta]   esta terminal pasa a ser la del juego con ese id (el mismo PTY)
// Con el juego en marcha se lo pide al servidor (que cierra cada conversación antes de retomarla fuera). Si el
// refugio entero se ha caído, retoma las conversaciones que había abiertas (DATOS/abiertas.json) y engancha las
// terminales que sigan vivas en su anfitrión.
import net from 'node:net';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { DATOS } from './estado.ts';
import { SOCKET_TERMINALS } from './terminales.ts';
import { openInDesktop, outsideOpen, hookCommand, resumeCommand, type ItemDesktop } from './escritorio.ts';
import { t, setLanguage, isLanguage } from '../shared/idioma.ts';

const RAIZ = path.resolve(import.meta.dirname, '..');
const PUERTO = Number(process.env.SHELTER_PUERTO || 3778);
const [orden, ...args] = process.argv.slice(2);
const opcion = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
// lo que dice por la terminal, en el idioma del refugio (el de su estado guardado; sin él, español)
try { const i = JSON.parse(readFileSync(path.join(DATOS, 'refugio.json'), 'utf8')).idioma; if (isLanguage(i)) setLanguage(i); } catch {}

// ---------------------------------------------------------------- enganchar una terminal del juego
// Al salir se dejan las cosas como estaban: sin protocolo de kitty, sin ratón, fuera de la pantalla alternativa
const RESTORE = '\x1b[<16u\x1b[?1049l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1004l\x1b[?2004l\x1b[?1l\x1b[?25h\x1b[0m';
function enganchar(id: string, socket: string) {
  const { stdin: entrada, stdout: salida } = process;
  if (!entrada.isTTY) { console.error(t('server.surface.needsATerminal')); process.exit(2); }
  const s = net.connect(socket);
  let resto = '', finished = false;
  const linea = (m: Record<string, unknown>) => { if (!s.destroyed) s.write(JSON.stringify(m) + '\n'); };
  const acabar = (codigo: number, texto?: string) => {
    if (finished) return; finished = true;
    try { entrada.setRawMode(false); } catch {}
    salida.write(RESTORE + (texto ? `\r\n\x1b[2m${texto}\x1b[0m\r\n` : ''));
    process.exit(codigo);
  };
  s.setEncoding('utf8');
  s.on('connect', () => {
    salida.write('\x1b[H\x1b[2J\x1b[3J');
    linea({ op: 'enganchar', id, cols: salida.columns, filas: salida.rows });
    entrada.setRawMode(true); entrada.setEncoding('utf8'); entrada.resume();
    entrada.on('data', (d: string) => linea({ op: 'entrada', datos: d }));
    salida.on('resize', () => linea({ op: 'tamano', cols: salida.columns, filas: salida.rows }));
  });
  s.on('data', (d: string) => {
    resto += d;
    let i: number;
    while ((i = resto.indexOf('\n')) >= 0) {
      let m: any; try { m = JSON.parse(resto.slice(0, i)); } catch { m = null; } resto = resto.slice(i + 1);
      if (m?.ev === 'datos') salida.write(m.datos);
      else if (m?.ev === 'fin') acabar(0, t('server.surface.terminalEnded'));
      else if (m?.ev === 'error') acabar(1, m.texto);
    }
  });
  s.on('error', e => acabar(1, t('server.surface.cannotFindShelter', { error: (e as NodeJS.ErrnoException).code ?? e.message })));
  s.on('close', () => acabar(0, t('server.surface.detached')));
}

// ---------------------------------------------------------------- con el juego en marcha
async function liveServer() {
  try { return (await fetch(`http://127.0.0.1:${PUERTO}/salud`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}
function askOnServer(nombre: string, datos: Record<string, unknown>) {
  const token = readFileSync(path.join(DATOS, 'token'), 'utf8').trim();
  const origen = `http://127.0.0.1:${PUERTO}`;
  return new Promise<any>((ok, ko) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PUERTO}/ws?t=${encodeURIComponent(token)}`, { origin: origen });
    const reloj = setTimeout(() => { ws.terminate(); ko(new Error(t('server.theShelterIsNotResponding'))); }, 60_000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'accion', nombre, datos, peticion: 'superficie' })));
    ws.on('message', raw => {
      let m: any; try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.t !== 'respuesta' || m.peticion !== 'superficie') return;
      clearTimeout(reloj); ws.close();
      if (m.error) ko(new Error(m.error)); else ok(m.datos);
    });
    ws.on('error', e => { clearTimeout(reloj); ko(e); });
  });
}

// ---------------------------------------------------------------- sin refugio
interface Open { claudeId: string; cwd: string; titulo?: string; habitante?: string; estado?: string; permisos?: string }
function openInDisc(): Open[] {
  try { const l = JSON.parse(readFileSync(path.join(DATOS, 'abiertas.json'), 'utf8')); return Array.isArray(l) ? l.filter(x => x && typeof x.claudeId === 'string' && typeof x.cwd === 'string') : []; } catch { return []; }
}
function liveTerminals(): Promise<{ id: string; cwd: string; program?: string; fuera: number }[]> {
  return new Promise(ok => {
    const s = net.connect(SOCKET_TERMINALS);
    let resto = '';
    s.setEncoding('utf8');
    s.on('connect', () => s.write(JSON.stringify({ op: 'lista' }) + '\n'));
    s.on('data', (d: string) => { resto += d; const i = resto.indexOf('\n'); if (i < 0) return; try { const m = JSON.parse(resto.slice(0, i)); ok(m.terminales ?? []); } catch { ok([]); } s.end(); });
    s.on('error', () => ok([]));
    s.on('close', () => ok([]));
  });
}

async function superficie(onlyList: boolean) {
  if (await liveServer()) {
    if (onlyList) { console.log(t('server.surface.shelterIsOpen')); return; }
    const r = await askOnServer('superficie.sacar', { todo: true, windowNew: true });
    console.log(r.sesiones || r.terminales ? t('server.surface.toTheSurface', { n: r.sesiones, m: r.terminales, app: r.app || t('server.surface.yourDesktop') }) : t('server.surface.nothingWasOpen'));
    for (const a of r.avisos ?? []) console.log('· ' + a);
    return;
  }
  // el refugio no está: lo que quedó abierto al caerse
  const fuera = outsideOpen();
  const conv = openInDisc().filter(a => !fuera.has(a.claudeId.toLowerCase()));
  const terms = (await liveTerminals()).filter(x => !x.fuera);
  if (onlyList) {
    console.log(conv.length || terms.length ? t('server.surface.closedLeftThis') : t('server.surface.closedNothingLeft'));
    for (const a of conv) console.log(t('server.surface.listConversation', { habitante: a.habitante ?? '', titulo: a.titulo ?? a.claudeId, cwd: a.cwd }));
    for (const x of terms) console.log(t('server.surface.listTerminal', { id: x.id + (x.program ? ' · ' + x.program : ''), cwd: x.cwd }));
    return;
  }
  const items: ItemDesktop[] = [
    ...terms.map(x => ({ titulo: t('server.surface.terminalTitle', { carpeta: path.basename(x.cwd) }), comando: hookCommand(path.join(RAIZ, 'shelter'), SOCKET_TERMINALS, x.id) })),
    ...conv.map(a => ({ titulo: `${a.habitante ?? t('server.surface.dweller')} · ${a.titulo ?? t('server.surface.conversation')}`, comando: resumeCommand({ claudeId: a.claudeId, cwd: a.cwd, permisos: a.permisos }) })),
  ];
  if (!items.length) { console.log(t('server.surface.closedNothingLeft')); return; }
  const app = await openInDesktop(items, { windowNew: true });
  console.log(t('server.surface.toTheSurface', { n: conv.length, m: terms.length, app }));
}

if (orden === 'enganchar') {
  if (!args[0] || args[0].startsWith('--')) { console.error(t('server.surface.usageHook')); process.exit(2); }
  enganchar(args[0], opcion('--socket') ?? SOCKET_TERMINALS);
} else if (orden === 'superficie') {
  superficie(args.includes('--lista')).then(() => process.exit(0), e => { console.error((e as Error).message); process.exit(1); });
} else { console.error(t('server.surface.usage')); process.exit(2); }
