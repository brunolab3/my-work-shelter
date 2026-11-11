// Remote Control por sala: un `claude remote-control` en la carpeta de la sala, para abrir y seguir sesiones de ese
// proyecto desde claude.ai/code o la app de Claude del móvil (corren en este Mac). Es un proceso aparte (detached):
// sobrevive a los reinicios del servidor y a cerrar el juego; se apaga desde el panel de la sala o al retirarla.
// Lo que está encendido se apunta en DATOS/control-remoto/<sala>.json (y su salida, en <sala>.log); al arrancar, el
// servidor vuelve a encender lo apuntado si se había caído.
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { DATOS } from './estado.ts';
import { cleanEnvironment, pathClaude } from './sesiones.ts';
import { t } from '../shared/idioma.ts';

const DIR = path.join(DATOS, 'control-remoto');
const ficha = (salaId: string) => path.join(DIR, `${salaId.replace(/[^\w-]/g, '_')}.json`);
const registro = (salaId: string) => path.join(DIR, `${salaId.replace(/[^\w-]/g, '_')}.log`);

export interface StateControlRemote { estado: 'apagado' | 'encendido' | 'aceptar' | 'error'; detalle?: string; url?: string; nombre?: string }
interface Ficha { pid: number; cwd: string; nombre: string; desde: number }

const leer = (salaId: string): Ficha | null => { try { return JSON.parse(readFileSync(ficha(salaId), 'utf8')); } catch { return null; } };
const withoutColors = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
const salida = (salaId: string) => { try { return withoutColors(readFileSync(registro(salaId), 'utf8')).slice(-20_000); } catch { return ''; } };

// ¿sigue vivo ese pid y es un remote-control? (un pid reciclado por otro programa no cuenta)
function vivo(pid: number) {
  try { process.kill(pid, 0); } catch { return false; }
  try { return /remote-control|\brc\b/.test(execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8', timeout: 3000 })); } catch { return false; }
}

/** Lo que dice su salida: hay que aceptar Remote Control la primera vez, la carpeta no es de confianza, o su enlace. */
export function readOutput(texto: string): { aceptar?: boolean; withoutTrust?: boolean; url?: string; ultima?: string } {
  const lineas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  return {
    aceptar: /Enable Remote Control\?/i.test(texto),
    withoutTrust: /Workspace not trusted/i.test(texto),
    url: texto.match(/https:\/\/claude\.ai\/code[^\s"')]*/g)?.at(-1),
    ultima: lineas.at(-1),
  };
}

export function estado(salaId: string): StateControlRemote {
  const f = leer(salaId);
  if (!f) return { estado: 'apagado' };
  const s = readOutput(salida(salaId));
  if (s.aceptar) return { estado: 'aceptar', nombre: f.nombre, detalle: t('server.theFirstTimeRemoteControl') };
  if (s.withoutTrust) return { estado: 'error', nombre: f.nombre, detalle: t('server.claudeCodeDoesNotTrust') };
  if (!vivo(f.pid)) return { estado: 'error', nombre: f.nombre, detalle: s.ultima ? `Se ha parado: ${s.ultima.slice(0, 200)}` : 'Se ha parado.' };
  return { estado: 'encendido', nombre: f.nombre, url: s.url };
}

export async function switchOn(salaId: string, cwd: string, roomName: string): Promise<StateControlRemote> {
  const f = leer(salaId);
  if (f && vivo(f.pid) && f.cwd === cwd) return estado(salaId);
  if (f) apagar(salaId);
  const claude = pathClaude();
  if (!claude) throw new Error(t('server.claudeCodeClaudeCannotBe'));
  if (!existsSync(cwd)) throw new Error(t('server.theRoomSFolderDoes'));
  mkdirSync(DIR, { recursive: true });
  const nombre = `${roomName} · work-shelter`;
  const log = openSync(registro(salaId), 'w');
  try {
    const p = spawn(claude, ['remote-control', '--name', nombre, '--permission-mode', 'auto'], { cwd, detached: true, stdio: ['ignore', log, log], env: cleanEnvironment() });
    p.unref();
    if (!p.pid) throw new Error(t('server.couldNotLaunchClaudeRemote'));
    writeFileSync(ficha(salaId), JSON.stringify({ pid: p.pid, cwd, nombre, desde: Date.now() } satisfies Ficha));
  } finally { closeSync(log); }
  // lo que pase en los primeros segundos (pedir que se acepte, carpeta sin confianza, el enlace) se ve ya
  for (let t = 0; t < 40; t++) {
    await new Promise(ok => setTimeout(ok, 200));
    const e = estado(salaId);
    if (e.estado !== 'encendido' || e.url) break;
  }
  const e = estado(salaId);
  // si pide aceptar o no arranca, no se deja colgado esperando una respuesta que no llegará
  if (e.estado !== 'encendido') apagar(salaId);
  return e;
}

function matar(pid: number) {
  if (!vivo(pid)) return;
  try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch {} }
  setTimeout(() => { if (vivo(pid)) { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch {} } } }, 3000).unref();
}

export function apagar(salaId: string) {
  const f = leer(salaId);
  if (f) matar(f.pid);
  rmSync(ficha(salaId), { force: true });
}

/** Al arrancar el servidor: lo apuntado que se haya caído (un reinicio del Mac) se vuelve a encender. */
export async function restaurar(salas: { id: string; nombre: string; cwd?: string }[]) {
  for (const s of salas) {
    const f = leer(s.id);
    if (!f) continue;
    if (!s.cwd) { apagar(s.id); continue; }
    if (!vivo(f.pid)) await switchOn(s.id, s.cwd, s.nombre).catch(() => {});
  }
}
