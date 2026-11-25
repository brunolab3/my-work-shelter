// Huellas del código: un resumen (sha1) del contenido de cada parte del juego para saber, sin fiarse de las fechas
// de los archivos, si lo que está en marcha es lo último. Lo usan ./shelter (al abrir), el servidor (al reiniciar y
// al aplicar cambios) y la ventana de Electron (para renovarse ella misma cuando cambian sus archivos).
//   client: what goes into the interface build (dist/web); its fingerprint is saved when building
//   server: what the server loads; /salud gives the running one's
//   app:    what is only read when the app opens (Electron, the supervisor and ./shelter): if it changes, the app reopens
// Usage: node scripts/fingerprints.cjs build [--if-needed]   ·   node scripts/fingerprints.cjs catch-up <port> <data>
// The Spanish names (compilar [--si-hace-falta], poner-al-dia, cliente, servidor) stay as aliases: servers, apps,
// ./shelter and supervisors started before the rename still call them.
'use strict';
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GROUPS = {
  client: ['web', 'shared', 'vite.config.ts', 'tsconfig.json', 'package-lock.json'],
  server: ['server', 'shared', 'package-lock.json', 'scripts/fingerprints.cjs'],
  app: ['electron', 'server/supervisor.mjs', 'shelter', 'scripts/fingerprints.cjs'],
};
const GROUP_ALIASES = { cliente: 'client', servidor: 'server' };
const COMMAND_ALIASES = { compilar: 'build', 'poner-al-dia': 'catch-up' };
const groupOf = name => Object.hasOwn(GROUPS, name) ? name : Object.hasOwn(GROUP_ALIASES, name) ? GROUP_ALIASES[name] : undefined;
const IGNORE = new Set(['.DS_Store', 'node_modules', 'icon']);
const CLIENT_MARK = path.join(ROOT, 'dist', '.huella-cliente');

function fingerprint(group, root = ROOT) {
  const h = createHash('sha1');
  const visit = rel => {
    const filePath = path.join(root, rel);
    let st; try { st = fs.statSync(filePath); } catch { return; }
    if (st.isDirectory()) { for (const n of fs.readdirSync(filePath).sort()) if (!IGNORE.has(n)) visit(path.join(rel, n)); return; }
    h.update(rel + '\0'); h.update(fs.readFileSync(filePath)); h.update('\0');
  };
  for (const rel of GROUPS[groupOf(group)]) visit(rel);
  return h.digest('hex');
}

function clientUpToDate(root = ROOT) {
  if (!fs.existsSync(path.join(root, 'dist', 'web', 'index.html'))) return false;
  try { return fs.readFileSync(path.join(root, 'dist', '.huella-cliente'), 'utf8').trim() === fingerprint('client', root); } catch { return false; }
}

// La huella se toma ANTES de compilar: si algo cambia mientras tanto, la próxima vez no coincide y se recompila
function compile({ ifNeeded = false } = {}) {
  if (ifNeeded && clientUpToDate()) return false;
  const h = fingerprint('client');
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'error'], { cwd: ROOT, stdio: 'inherit' });
  fs.writeFileSync(CLIENT_MARK, h + '\n');
  return true;
}

// Un servidor de antes de los últimos cambios que sigue en marcha se pone al día (server/main.ts, ponerAlDia): si tiene
// ventanas, se reinicia y se espera a que vuelva con el código de ahora; si no, se aparta y se espera a que libere el
// puerto para que ./shelter lance uno nuevo. Las terminales siguen vivas en los dos casos.
function ask(port, method, filePath, headers = {}) {
  return new Promise(ok => {
    const r = http.request({ host: '127.0.0.1', port: port, method: method, path: filePath, headers: headers, timeout: 3000 }, res => {
      let body = ''; res.on('data', d => { body += d; }); res.on('end', () => ok({ state: res.statusCode, body }));
    });
    r.on('error', () => ok(null)); r.on('timeout', () => { r.destroy(); ok(null); }); r.end();
  });
}
const health = async port => { const r = await ask(port, 'GET', '/salud'); try { return r && r.state === 200 ? JSON.parse(r.body) : null; } catch { return null; } };
async function setOnDay(port, data) {
  const current = await health(port);
  if (!current) return 'sin servidor';
  const h = fingerprint('server');
  if (current.code === h) return 'al día';
  let token = ''; try { token = fs.readFileSync(path.join(data, 'token'), 'utf8').trim(); } catch { /* sin secreto no se puede pedir */ }
  const r = await ask(port, 'POST', '/poner-al-dia', { 'X-Shelter-Token': token });
  if (!r || r.state !== 200 || !['reinicio', 'relevo'].includes(r.body)) return 'no se pudo poner al día' + (r ? ` (${r.state})` : '');
  const handover = r.body === 'relevo';
  for (let i = 0; i < 600; i++) {
    await new Promise(s => setTimeout(s, 250));
    const s = await health(port);
    if (handover && !s) { await new Promise(s => setTimeout(s, 500)); return 'apartado'; }
    if (!handover && s && s.code === h) return 'reiniciado';
  }
  return 'no ha respondido a tiempo';
}

function cli(argv) {
  const [name, ...args] = argv;
  const command = Object.hasOwn(COMMAND_ALIASES, name) ? COMMAND_ALIASES[name] : name;
  if (command === 'build') {
    try { compile({ ifNeeded: args.includes('--if-needed') || args.includes('--si-hace-falta') }); } catch { process.exit(1); }
  } else if (command === 'catch-up') {
    setOnDay(Number(args[0]) || 3778, args[1] || path.join(ROOT, '.data')).then(r => { console.log(r); process.exit(/^(al día|reiniciado|apartado|sin servidor)$/.test(r) ? 0 : 1); });
  } else if (groupOf(name)) console.log(fingerprint(name));
  else { console.error('Usage: node scripts/fingerprints.cjs build [--if-needed] | catch-up <port> <data> | client|server|app'); process.exit(2); }
}

module.exports = { fingerprint, clientUpToDate, compile, setOnDay, cli, GROUPS };
// names from before the English identifiers, for servers and apps started earlier that still call them
Object.assign(module.exports, { huella: fingerprint, clienteAlDia: clientUpToDate, compilar: compile });

if (require.main === module) cli(process.argv.slice(2));
