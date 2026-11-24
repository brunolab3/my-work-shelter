// Remote Control por sala: un `claude remote-control` en la carpeta de la sala, para abrir y seguir sesiones de ese
// proyecto desde claude.ai/code o la app de Claude del móvil (corren en este Mac). Es un proceso aparte (detached):
// sobrevive a los reinicios del servidor y a cerrar el juego; se apaga desde el panel de la sala o al retirarla.
// Lo que está encendido se apunta en DATOS/control-remoto/<sala>.json (y su salida, en <sala>.log); al arrancar, el
// servidor vuelve a encender lo apuntado si se había caído.
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { DATA } from './state.ts';
import { cleanEnvironment, pathClaude } from './sessions.ts';
import { t } from '../shared/language.ts';

const DIR = path.join(DATA, 'control-remoto');
const card = (roomId: string) => path.join(DIR, `${roomId.replace(/[^\w-]/g, '_')}.json`);
const registry = (roomId: string) => path.join(DIR, `${roomId.replace(/[^\w-]/g, '_')}.log`);

export interface StateControlRemote { state: 'off' | 'on' | 'accept' | 'error'; detail?: string; url?: string; name?: string }
interface Card { pid: number; cwd: string; name: string; since: number }

const read = (roomId: string): Card | null => { try { return JSON.parse(readFileSync(card(roomId), 'utf8')); } catch { return null; } };
const withoutColors = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
const output = (roomId: string) => { try { return withoutColors(readFileSync(registry(roomId), 'utf8')).slice(-20_000); } catch { return ''; } };

// ¿sigue vivo ese pid y es un remote-control? (un pid reciclado por otro programa no cuenta)
function live(pid: number) {
  try { process.kill(pid, 0); } catch { return false; }
  try { return /remote-control|\brc\b/.test(execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8', timeout: 3000 })); } catch { return false; }
}

/** Lo que dice su salida: hay que aceptar Remote Control la primera vez, la carpeta no es de confianza, o su enlace. */
export function readOutput(text: string): { accept?: boolean; withoutTrust?: boolean; url?: string; last?: string } {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  return {
    accept: /Enable Remote Control\?/i.test(text),
    withoutTrust: /Workspace not trusted/i.test(text),
    url: text.match(/https:\/\/claude\.ai\/code[^\s"')]*/g)?.at(-1),
    last: lines.at(-1),
  };
}

export function state(roomId: string): StateControlRemote {
  const f = read(roomId);
  if (!f) return { state: 'off' };
  const s = readOutput(output(roomId));
  if (s.accept) return { state: 'accept', name: f.name, detail: t('server.theFirstTimeRemoteControl') };
  if (s.withoutTrust) return { state: 'error', name: f.name, detail: t('server.claudeCodeDoesNotTrust') };
  if (!live(f.pid)) return { state: 'error', name: f.name, detail: s.last ? t('server.remoteStoppedDetail', { detalle: s.last.slice(0, 200) }) : t('server.remoteStopped') };
  return { state: 'on', name: f.name, url: s.url };
}

export async function switchOn(roomId: string, cwd: string, roomName: string): Promise<StateControlRemote> {
  const f = read(roomId);
  if (f && live(f.pid) && f.cwd === cwd) return state(roomId);
  if (f) shutDown(roomId);
  const claude = pathClaude();
  if (!claude) throw new Error(t('server.claudeCodeClaudeCannotBe'));
  if (!existsSync(cwd)) throw new Error(t('server.theRoomSFolderDoes'));
  mkdirSync(DIR, { recursive: true });
  const name = `${roomName} · work-shelter`;
  const log = openSync(registry(roomId), 'w');
  try {
    const p = spawn(claude, ['remote-control', '--name', name, '--permission-mode', 'auto'], { cwd, detached: true, stdio: ['ignore', log, log], env: cleanEnvironment() });
    p.unref();
    if (!p.pid) throw new Error(t('server.couldNotLaunchClaudeRemote'));
    writeFileSync(card(roomId), JSON.stringify({ pid: p.pid, cwd, name, since: Date.now() } satisfies Card));
  } finally { closeSync(log); }
  // lo que pase en los primeros segundos (pedir que se acepte, carpeta sin confianza, el enlace) se ve ya
  for (let t = 0; t < 40; t++) {
    await new Promise(ok => setTimeout(ok, 200));
    const e = state(roomId);
    if (e.state !== 'on' || e.url) break;
  }
  const e = state(roomId);
  // si pide aceptar o no arranca, no se deja colgado esperando una respuesta que no llegará
  if (e.state !== 'on') shutDown(roomId);
  return e;
}

function kill(pid: number) {
  if (!live(pid)) return;
  try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch {} }
  setTimeout(() => { if (live(pid)) { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch {} } } }, 3000).unref();
}

export function shutDown(roomId: string) {
  const f = read(roomId);
  if (f) kill(f.pid);
  rmSync(card(roomId), { force: true });
}

/** Al arrancar el servidor: lo apuntado que se haya caído (un reinicio del Mac) se vuelve a encender. */
export async function restore(rooms: { id: string; name: string; cwd?: string }[]) {
  for (const s of rooms) {
    const f = read(s.id);
    if (!f) continue;
    if (!s.cwd) { shutDown(s.id); continue; }
    if (!live(f.pid)) await switchOn(s.id, s.cwd, s.name).catch(() => {});
  }
}
