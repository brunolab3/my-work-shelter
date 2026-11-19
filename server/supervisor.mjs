// Supervisor del servidor de work-shelter: lo lanza, y cuando sale con el código 75 (botón «Reiniciar» de la
// regleta) lo vuelve a lanzar con el mismo secreto, así la ventana abierta se reengancha sola; con el 76 sale él también
// con ese código para que la app se vuelva a abrir entera (server/main.ts, restartGame). Si se cae por un
// error, lo reintenta cada pocos segundos (en cuanto se arregle el código, vuelve). Ctrl+C o «Salir» lo paran.
// Uso: node server/supervisor.mjs   (lo usan ./shelter y npm run dev)
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RESTART = 75;
const HANDOVER = 76;   // reinicio que necesita volver a abrir la app entera (lo hace ella al ver salir este código)
const token = /^[0-9a-f]{32,}$/.test(process.env.SHELTER_TOKEN ?? '') ? process.env.SHELTER_TOKEN : randomBytes(24).toString('hex');
let child = null, stopping = false;

function launch() {
  const since = Date.now();
  // node con el cargador de tsx en el mismo proceso (el CLI de tsx crea un nieto que no recibe las señales)
  child = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, SHELTER_TOKEN: token, SHELTER_SUPERVISADO: '1' } });
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) process.exit(code ?? 0);
    if (code === RESTART) { console.log('Servidor reiniciado.'); launch(); return; }
    if (code === HANDOVER) { console.log('Reiniciando la app entera…'); process.exit(HANDOVER); }
    // salida normal (Salir, sin clientes) o puerto ocupado: se acaba aquí
    if (code === 0 || code === 2 || signal === 'SIGINT' || signal === 'SIGTERM') process.exit(code ?? 0);
    const wait = Date.now() - since > 15_000 ? 500 : 3000;
    console.error(`El servidor se ha caído (${signal ?? 'código ' + code}). Lo vuelvo a lanzar en ${wait / 1000} s…`);
    setTimeout(() => { if (!stopping) launch(); }, wait);
  });
}
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { stopping = true; if (child) child.kill('SIGINT'); else process.exit(0); });
launch();
