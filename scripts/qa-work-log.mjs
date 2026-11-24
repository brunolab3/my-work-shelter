// QA of the work log and trophies (shared/workLog.ts, shared/trophies.ts, server/workLog.ts; panels WorkLog.tsx in
// Planning and Trophies.tsx in the Vault; the trophy shelf in web/src/world/rooms/vault.ts), with its own server in a
// test shelter and Playwright:
// - a saved ledger (DATOS/bitacora.json, written before the server starts) is what `bitacora.leer` returns while Jira
//   and GitHub are not both in DEMO; the example ladder parses without errors and earns «first merge» from its merged PR;
// - Planning → Sync update: one line per task, keyless tasks last; X expands the PRs, worktrees and conversations
//   underneath; Tab changes the range; C copies the Markdown (task line, PRs underneath);
// - Vault → Trophies and career: the ladder's two steps, every trophy, first merge earned with its date;
// - a broken DATOS/escalera.json: the error line in the panel (R reads it again), never a crash;
// - Jira and GitHub in DEMO: a sample log, marked DEMO, not saved;
// - the Vault's shelf: one cup per trophy, the earned ones gold; a screenshot of the room.
// Needs the built client (npx vite build). Usage: node scripts/qa-work-log.mjs [screenshots-folder]   (SHELTER_PUERTO_QA, 3795)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withToken } from './token.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const [dir = '_capturas'] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.SHELTER_PUERTO_QA || 3795);
const DATA = mkdtempSync(path.join(os.tmpdir(), 'ws-work-log-'));
process.env.SHELTER_DATOS = DATA;

// the saved ledger: ABC-1 done with two PRs in two repos (one merged) and a removed worktree; a slug task with a live one
const now = Date.now(), D = 864e5;
writeFileSync(path.join(DATA, 'bitacora.json'), JSON.stringify({
  tasks: { 'ABC-1': { key: 'ABC-1', title: 'Checkout retries', url: 'https://jira.example/browse/ABC-1', state: 'Done', category: 'done', seen: now - 5 * D, updated: now - D, doneAt: now - D } },
  prs: {
    'org/api#5': { ref: 'org/api#5', url: 'https://github.com/org/api/pull/5', title: 'ABC-1 retry the payment', repo: 'org/api', number: 5, branch: 'ABC-1-retries', task: 'ABC-1', state: 'fusionado', seen: now - 4 * D, updated: now - 2 * D, mergedAt: now - 2 * D },
    'org/web#9': { ref: 'org/web#9', url: 'https://github.com/org/web/pull/9', title: 'ABC-1 retry banner', repo: 'org/web', number: 9, branch: 'ABC-1-banner', task: 'ABC-1', state: 'abierto', seen: now - 3 * D, updated: now - D },
  },
  worktrees: {
    '/r/api/.claude/worktrees/abc-1-retries': { path: '/r/api/.claude/worktrees/abc-1-retries', roomId: 'api', branch: 'ABC-1-retries', task: 'ABC-1', seen: now - 4 * D, last: now - D, goneAt: now - D },
    '/r/web/.claude/worktrees/shelter-preflight-popover--ab12': { path: '/r/web/.claude/worktrees/shelter-preflight-popover--ab12', roomId: 'web', task: 'preflight-popover', seen: now - D, last: now - D },
  },
  conversations: { c1: { claudeId: 'c1', title: 'Retry the payment', roomId: 'api', cwd: '/r/api/.claude/worktrees/abc-1-retries', task: 'ABC-1', seen: now - 4 * D, last: now - 2 * D } },
  reviews: {}, notified: ['first-merge'],
}));

const server = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], { cwd: ROOT, env: { ...process.env, SHELTER_DATOS: DATA, SHELTER_PUERTO: String(PORT), SHELTER_SALIR_SIN_CLIENTES: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; server.stdout.on('data', d => { output += d; }); server.stderr.on('data', d => { output += d; });
let failures = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FALLO ') + text); if (!ok) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 120 && !(await fetch(`http://127.0.0.1:${PORT}/salud`).then(() => true, () => false)); i++) await sleep(250);

const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', e => errors.push(e.message));
  const open = async (url = '') => {
    await pg.goto(withToken(`http://127.0.0.1:${PORT}/${url}`), { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
    await pg.evaluate(async () => { await window.__ready(); await window.__client.action('guardar', { patch: { doneWelcome: true } }); window.__game.set({ panel: null, panelData: null }); });
  };
  await open();
  const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await pg.waitForTimeout(200); } return false; };
  const read = () => pg.evaluate(() => window.__client.action('bitacora.leer', {}));
  const mode = (source, m) => pg.evaluate(([source, m]) => window.__client.action('integracion.modo', { source, mode: m }), [source, m]);
  await mode('jira', 'off');

  // ---- the saved ledger and the example ladder
  let r = await read();
  check(!r.demo && Object.keys(r.ledger.prs).length === 2, `the saved ledger is read (demo ${r.demo}, ${Object.keys(r.ledger.prs).length} PRs)`);
  check(r.ladder.source === 'example' && !r.ladder.errors.length, `the example ladder, without errors (${r.ladder.source}: ${r.ladder.errors.join(' | ')})`);
  const first = r.career.trophies.find(x => x.rule.id === 'first-merge');
  check(first?.earnedAt === now - 2 * D, 'first merge is earned at the PR\'s merge date');
  check(r.career.trophies.find(x => x.rule.id === 'cross-repo')?.earnedAt === now - D, 'a task across repos: ABC-1 done with PRs in api and web, earned when it was done');

  // ---- Planning → Sync update
  await pg.evaluate(() => window.__game.set({ panel: 'logistica', panelData: { view: 'bitacora' } }));
  check(await until(async () => (await pg.$$('.bitacora-fila')).length === 2), 'two lines: ABC-1 and the slug task');
  const keys = await pg.$$eval('.bitacora-clave', l => l.map(x => x.textContent));
  check(keys[0] === 'ABC-1' && keys[1] === 'preflight-popover', `Jira tasks first, keyless last (${keys.join(', ')})`);
  check(/Sin tarea de Jira|Without a Jira task/.test(await pg.textContent('.bitacora-grupo').catch(() => '')), 'the keyless group has its header');
  await pg.keyboard.press('KeyX');
  const detail = await pg.$$eval('.bitacora-fila:first-of-type .bitacora-detalle li, .bitacora-fila .bitacora-detalle li', l => l.map(x => x.textContent));
  check(detail.some(x => /api#5/.test(x)) && detail.some(x => /web#9/.test(x)), 'X expands: both PRs');
  check(detail.some(x => /⎇/.test(x) && /(quitado|removed)/.test(x)), 'the removed worktree, with its date');
  check(detail.some(x => /💬 Retry the payment/.test(x)), 'the conversation');
  await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(dir, 'work-log.png'), animations: 'disabled' });
  await pg.keyboard.press('KeyC');
  const copied = await until(async () => /^- ABC-1 Checkout retries \(Done\)/.test(await pg.evaluate(() => navigator.clipboard.readText()).catch(() => '')));
  const text = await pg.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  check(copied && /\n {2}- api#5 ABC-1 retry the payment/.test(text), 'C copies the Markdown: the task, its PRs underneath');
  await pg.keyboard.press('Tab'); await pg.keyboard.press('Tab'); await pg.keyboard.press('Tab');   // → All
  check(/Todo|All/.test(await pg.textContent('.bitacora-periodos .activa')), 'Tab moves through the ranges');
  await pg.keyboard.press('Escape');

  // ---- Vault → Trophies and career
  await pg.evaluate(() => window.__game.set({ panel: 'camara', panelData: { view: 'trofeos' } }));
  check(await until(async () => (await pg.$$('.trofeo')).length === 6), 'the six example trophies');
  check((await pg.$$('.escalon')).length === 2, 'the two example steps');
  check(/Primer merge|First merge/.test(await pg.textContent('.trofeo.ganado').catch(() => '')), 'first merge shows as earned');
  check((await pg.$$('.escalon ul li')).length === 5, 'every requirement under its step');
  await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(dir, 'trophies.png'), animations: 'disabled' });
  // a broken ladder of the Overseer's: its error, read again with R
  writeFileSync(path.join(DATA, 'escalera.json'), '{ "trophies": [ nope');
  await pg.keyboard.press('KeyR');
  check(await until(async () => /JSON/.test((await pg.$$eval('.aviso-consola', l => l.map(x => x.textContent).join(' ')))) ), 'a broken ladder shows its error');
  await pg.evaluate(() => window.__client.action('bitacora.escalera', {}));
  check(readFileSync(path.join(DATA, 'escalera.json'), 'utf8').includes('nope'), 'an existing ladder is never overwritten from the example');
  writeFileSync(path.join(DATA, 'escalera.json'), readFileSync(path.join(ROOT, 'docs', 'ladder.example.json'), 'utf8'));
  await pg.keyboard.press('KeyR');
  r = await read();
  check(r.ladder.source === 'local' && !r.ladder.errors.length, `the Overseer's own ladder, once valid (${r.ladder.source})`);
  await pg.keyboard.press('Escape');

  // ---- both in DEMO: a sample log, not saved
  // (the PRs are cached for a minute: the DEMO ones arrive once the cache from before expires)
  await mode('jira', 'demo'); await mode('github', 'demo');
  check(await until(async () => (r = await read()).demo, 80000), 'both in DEMO: the log says so');
  check(Object.keys(r.ledger.tasks).length > 0, `DEMO: a sample log with the demo tasks (${Object.keys(r.ledger.tasks).length})`);
  check(!readFileSync(path.join(DATA, 'bitacora.json'), 'utf8').includes('REF-'), 'DEMO data never reaches the saved ledger');

  // ---- the Vault's shelf
  await open('?sala=camara');
  const shelf = () => pg.evaluate(() => window.__shelter.rooms.find(s => s.id === 'camara')?.userData.trophyShelf?.shown());
  check(await until(async () => (await shelf())?.cups === 6), 'the shelf has one cup per trophy');
  const s = await shelf();
  check(s?.earned >= 1, `earned ones in gold (${s?.earned})`);
  await sleep(4000);
  await pg.screenshot({ path: path.join(dir, 'vault-shelf.png'), animations: 'disabled', timeout: 15000 }).catch(() => console.log('(no room screenshot: timed out)'));

  check(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} finally {
  await b.close(); server.kill();
}
if (failures) { console.log(output.slice(-3000)); console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall OK');
