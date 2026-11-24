// QA of the work log and trophies (shared/workLog.ts, shared/trophies.ts, server/workLog.ts; panels WorkLog.tsx in
// Planning and Trophies.tsx; the trophy shelf in web/src/world/rooms/trophyShelf.ts), with its own server in a
// test shelter and Playwright:
// - a saved ledger (DATOS/work-log.json, written before the server starts) is what `bitacora.leer` returns while Jira
//   and GitHub are not both in DEMO; the example ladder parses without errors and earns «first merge» from its merged PR;
// - Planning → Sync update: one line per task, keyless tasks last; X expands the PRs, worktrees and conversations
//   underneath; Tab changes the range (1 working day first, the default); C copies the Markdown (task line, PRs underneath);
// - Planning's board, opened from the wall: Board | Sync update on top, U or its Sync update opens it, Esc goes back to the board;
// - Planning's menu offers «Verify my career ladder»; a verification saved in the ladder's "progress" key shows its level
//   and each verdict in the panel, and the level on the shelf's plaque;
// - Planning → Trophies and career: a trophy per vertical on top (delivers in bronze from first merge), the measured
//   trophies, the ladder's two steps; a medal the Friday digest proposed waits on the carpet, A accepts it and it fills
//   one medal of its vertical's trophy; M enters one by hand (it counts at once);
// - a broken DATOS/ladder.json: the error line in the panel (R reads it again), never a crash;
// - Jira and GitHub in DEMO: a sample log, marked DEMO, not saved;
// - Planning's shelf: one cup per vertical, the won ones in their level's colour, the medals on the red cloth below; hovering it reads «Trophies and career», a click opens
//   the panel and Escape goes back to the shelter; a screenshot of the room with the label.
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
writeFileSync(path.join(DATA, 'work-log.json'), JSON.stringify({
  tasks: { 'ABC-1': { key: 'ABC-1', title: 'Checkout retries', url: 'https://jira.example/browse/ABC-1', state: 'Done', category: 'done', seen: now - 5 * D, updated: now - D, doneAt: now - D } },
  prs: {
    'org/api#5': { ref: 'org/api#5', url: 'https://github.com/org/api/pull/5', title: 'ABC-1 retry the payment', repo: 'org/api', number: 5, branch: 'ABC-1-retries', task: 'ABC-1', state: 'merged', seen: now - 4 * D, updated: now - 2 * D, mergedAt: now - 2 * D },
    'org/web#9': { ref: 'org/web#9', url: 'https://github.com/org/web/pull/9', title: 'ABC-1 retry banner', repo: 'org/web', number: 9, branch: 'ABC-1-banner', task: 'ABC-1', state: 'open', seen: now - 3 * D, updated: now - D },
  },
  worktrees: {
    '/r/api/.claude/worktrees/abc-1-retries': { path: '/r/api/.claude/worktrees/abc-1-retries', roomId: 'api', branch: 'ABC-1-retries', task: 'ABC-1', seen: now - 4 * D, last: now - D, goneAt: now - D },
    '/r/web/.claude/worktrees/shelter-preflight-popover--ab12': { path: '/r/web/.claude/worktrees/shelter-preflight-popover--ab12', roomId: 'web', task: 'preflight-popover', seen: now - D, last: now - D },
  },
  conversations: { c1: { claudeId: 'c1', title: 'Retry the payment', roomId: 'api', cwd: '/r/api/.claude/worktrees/abc-1-retries', task: 'ABC-1', seen: now - 4 * D, last: now - 2 * D } },
  reviews: {}, notified: ['first-merge'],
  medals: { m1: { id: 'm1', requirement: 'voice', text: 'Asked Ana to challenge the spec', evidence: ['https://slack.example/t/1'], state: 'proposed', proposedAt: now - D } },
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
    await pg.evaluate(async () => { await window.__ready(); await window.__client.action('save', { patch: { doneWelcome: true } }); window.__game.set({ panel: null, panelData: null }); });
  };
  await open();
  const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await pg.waitForTimeout(200); } return false; };
  const read = () => pg.evaluate(() => window.__client.action('workLog.read', {}));
  const mode = (source, m) => pg.evaluate(([source, m]) => window.__client.action('integration.mode', { source, mode: m }), [source, m]);
  await mode('jira', 'off');

  // ---- the saved ledger and the example ladder
  let r = await read();
  check(!r.demo && Object.keys(r.ledger.prs).length === 2, `the saved ledger is read (demo ${r.demo}, ${Object.keys(r.ledger.prs).length} PRs)`);
  check(r.ladder.source === 'example' && !r.ladder.errors.length, `the example ladder, without errors (${r.ladder.source}: ${r.ladder.errors.join(' | ')})`);
  const first = r.career.trophies.find(x => x.rule.id === 'first-merge');
  check(first?.earnedAt === now - 2 * D, 'first merge is earned at the PR\'s merge date');
  check(r.career.trophies.find(x => x.rule.id === 'cross-repo')?.earnedAt === now - D, 'a task across repos: ABC-1 done with PRs in api and web, earned when it was done');

  // ---- Planning's menu offers the verification; → Sync update
  await pg.evaluate(() => window.__game.set({ panel: 'logistics', panelData: null }));
  check(await until(async () => /(Verificar mi escalera|Verify my career ladder)/.test(await pg.textContent('.opciones-consola').catch(() => ''))), 'Planning\'s menu: verify my career ladder');
  await pg.evaluate(() => window.__game.set({ panel: null, panelData: null })); await pg.waitForTimeout(200);
  await pg.evaluate(() => window.__game.set({ panel: 'logistics', panelData: { view: 'log' } }));
  check(/(1 working day|1 día laborable)/.test(await pg.textContent('.bitacora-periodos .active').catch(() => '')), 'Sync update opens on the last working day');
  await pg.keyboard.press('Tab');   // → this week, where the fixture's activity is
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
  check(/Todo|All/.test(await pg.textContent('.bitacora-periodos .active')), 'Tab moves through the ranges');
  await pg.keyboard.press('Escape');

  // ---- the board opened from the wall: its Sync update entry (U or its button) goes back to the board
  await pg.evaluate(() => window.__game.set({ panel: null, panelData: null })); await pg.waitForTimeout(200);
  await pg.evaluate(() => window.__game.set({ panel: 'logistics', panelData: { view: 'jira' } }));
  check(await until(async () => /Sync update/.test(await pg.textContent('.modos-planning').catch(() => ''))), 'the board offers Board | Sync update on top');
  check(/U\s*Sync update/.test(await pg.textContent('.ayuda-consola').catch(() => '')), 'and its key, U');
  await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(dir, 'board-sync-update.png'), animations: 'disabled' });
  await pg.keyboard.press('KeyU');
  check(await until(async () => (await pg.$$('.bitacora-fila')).length === 2), 'U opens Sync update from the board');
  await pg.keyboard.press('Escape');
  check(await until(async () => (await pg.$$('.kanban-jira')).length === 1), 'Esc goes back to the board');
  await pg.click('.modos-planning button:has-text("Sync update")');
  check(await until(async () => (await pg.$$('.bitacora-fila')).length === 2), 'its button opens it too');
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(200); await pg.keyboard.press('Escape');
  check(await until(async () => !(await pg.evaluate(() => window.__game.get().panel))), 'Esc on the board, opened from the wall, closes it');

  // ---- Planning → Trophies and career
  await pg.evaluate(() => window.__game.set({ panel: 'logistics', panelData: { view: 'trophies' } }));
  check(await until(async () => (await pg.$$('.trofeo.vertical')).length === 7), 'one trophy per measured requirement of the example, on top');
  check((await pg.$$('.trofeo:not(.vertical)')).length === 6, 'and its six measured trophies');
  check((await pg.$$('.escalon')).length === 2, 'the two example steps');
  check(/Primer merge|First merge/.test(await pg.textContent('.trofeo:not(.vertical).ganado').catch(() => '')), 'first merge shows as earned');
  check(/(Entrega|Delivers)/.test(await pg.textContent('.trofeo.vertical.bronze').catch(() => '')) && /(bronce|bronze)/.test(await pg.textContent('.trofeo.vertical.bronze .nivel-trofeo')), 'and it wins «delivers» its bronze, in its colour');
  check((await pg.$$('.escalon ul li')).length === 8, 'every requirement under its step');
  check((await pg.$$('.medallas.alfombra li.proposed')).length === 1, 'the proposed medal on the carpet under the trophies, waiting for the Overseer');
  check((await pg.$$('.trofeo-medallas .medalla')).length === 0, 'its trophy has no medal yet');
  await pg.keyboard.press('KeyA');
  check(await until(async () => (await pg.$$('.medallas li.accepted')).length === 1), 'A accepts it');
  check(await until(async () => (await pg.$$('.trofeo-medallas .medalla')).length === 1), 'and it fills one medal of «Gets others to speak up»');
  await pg.keyboard.press('KeyM');
  await pg.waitForSelector('.medalla-mano input');
  await pg.fill('.medalla-mano input >> nth=0', 'Aligned the retry design with the payments lead');
  await pg.fill('.medalla-mano input >> nth=1', 'https://jira.example/browse/ABC-1?focusedCommentId=1');
  await pg.press('.medalla-mano input >> nth=1', 'Enter');
  check(await until(async () => (await pg.$$('.medallas li.accepted')).length === 2), 'M enters a medal by hand, accepted at once');
  check(await until(async () => (await pg.$$('.trofeo-medallas .medalla')).length === 2), 'and it fills a medal of its trophy');
  await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(dir, 'trophies.png'), animations: 'disabled' });
  // a broken ladder of the Overseer's: its error, read again with R
  writeFileSync(path.join(DATA, 'ladder.json'), '{ "trophies": [ nope');
  await pg.keyboard.press('KeyR');
  check(await until(async () => /JSON/.test((await pg.$$eval('.notice-console', l => l.map(x => x.textContent).join(' ')))) ), 'a broken ladder shows its error');
  await pg.evaluate(() => window.__client.action('workLog.ladder', {}));
  check(readFileSync(path.join(DATA, 'ladder.json'), 'utf8').includes('nope'), 'an existing ladder is never overwritten from the example');
  writeFileSync(path.join(DATA, 'ladder.json'), readFileSync(path.join(ROOT, 'docs', 'ladder.example.json'), 'utf8'));
  await pg.keyboard.press('KeyR');
  r = await read();
  check(r.ladder.source === 'local' && !r.ladder.errors.length, `the Overseer's own ladder, once valid (${r.ladder.source})`);
  check(/V/.test(await pg.textContent('.ayuda-consola')) && /(Sin verificar|Not verified)/.test(await pg.textContent('body')), 'not verified yet: V offers it');
  // a verification as the game writes it (ladder_progress → only the file's "progress" key)
  const ladderFile = path.join(DATA, 'ladder.json'), lj = JSON.parse(readFileSync(ladderFile, 'utf8'));
  writeFileSync(ladderFile, JSON.stringify({ ...lj, progress: { at: now, level: 'L1', summary: 'L1 reached; L2 needs volume.', requirements: { delivers: { verdict: 'met', evidence: ['https://github.com/org/api/pull/5'], byRules: true }, mentoring: { verdict: 'partial', evidence: ['https://slack.example/t/3'], notes: 'paired with a new joiner', byRules: false } } } }, null, 2));
  await pg.keyboard.press('KeyR');
  check(await until(async () => /(Nivel|Level): Engineer I/.test(await pg.textContent('.verificacion').catch(() => ''))), 'the last verification: its level');
  check((await pg.$$('.verificacion li')).length === 2 && /(juzgado por la sesión|judged by the session)/.test(await pg.textContent('.verificacion')), 'each verdict, by the rules or by the session');
  await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(dir, 'trophies-verified.png'), animations: 'disabled' });
  await pg.keyboard.press('Escape');

  // ---- both in DEMO: a sample log, not saved
  // (the PRs are cached for a minute: the DEMO ones arrive once the cache from before expires)
  await mode('jira', 'demo'); await mode('github', 'demo');
  check(await until(async () => (r = await read()).demo, 80000), 'both in DEMO: the log says so');
  check(Object.keys(r.ledger.tasks).length > 0, `DEMO: a sample log with the demo tasks (${Object.keys(r.ledger.tasks).length})`);
  check(!readFileSync(path.join(DATA, 'work-log.json'), 'utf8').includes('REF-'), 'DEMO data never reaches the saved ledger');

  // ---- Planning's shelf
  await open('?sala=logistica');
  const shelf = () => pg.evaluate(() => window.__shelter.rooms.find(s => s.id === 'logistics')?.userData.trophyShelf?.shown());
  check(await until(async () => (await shelf())?.cups === 7), 'the shelf has one cup per vertical');
  const s = await shelf();
  check(s?.earned >= 1 && s?.levels.includes('bronze'), `won ones in the colour of their level (${s?.levels})`);
  check(/ENGINEER I/.test(s?.plaque ?? ''), `the plaque shows the level (${s?.plaque})`);
  await sleep(4000);
  await pg.screenshot({ path: path.join(dir, 'planning-room.png'), animations: 'disabled', timeout: 15000 }).catch(() => console.log('(no room screenshot: timed out)'));
  // the shelf's zone on screen: hover reads its own label, a click opens Trophies and career, Escape back to the shelter
  const centre = () => pg.evaluate(() => {
    const r = window.__shelter, s = r.rooms.find(x => x.id === 'logistics'), z = s.interactive.find(i => i.id === 'trophies').zones[0];
    const c = z.getCenter(r.supervisor.root.position.clone()).add(s.group.position); c.project(window.__engine.camera);
    const lz = document.querySelector('canvas').getBoundingClientRect(); return { x: lz.left + (c.x + 1) / 2 * lz.width, y: lz.top + (1 - c.y) / 2 * lz.height };
  });
  let at = await centre();
  check(await until(async () => { at = await centre(); await pg.mouse.move(at.x, at.y); return (await pg.evaluate(() => window.__shelter.aimed?.it?.id)) === 'trophies'; }), 'hovering the shelf aims at the trophies');
  check(await until(async () => /Trofeos y carrera|Trophies and career/i.test(await pg.locator('body').innerText())), 'its label reads «Trophies and career» (or in Spanish)');
  await pg.screenshot({ path: path.join(dir, 'planning-shelf.png'), animations: 'disabled', timeout: 15000 }).catch(() => console.log('(no room screenshot: timed out)'));
  // clicked where the shelf is now (the camera may still be settling after the screenshot)
  const opened = () => pg.evaluate(() => { const j = window.__game.get(); return j.panel + ':' + j.panelData?.view; });
  check(await until(async () => { if (await opened() === 'logistica:trofeos') return true; at = await centre(); await pg.mouse.click(at.x, at.y); await sleep(300); return await opened() === 'logistica:trofeos'; }), 'a click opens the trophies from Planning');
  check(await until(async () => /TROFEOS Y CARRERA|TROPHIES AND CAREER/.test(await pg.locator('body').innerText())), 'the Trophies and career panel shows');
  await pg.keyboard.press('Escape');
  check(await until(async () => (await pg.evaluate(() => window.__game.get().panel)) === null), 'Escape goes back to the shelter');

  check(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} finally {
  await b.close(); server.kill();
}
if (failures) { console.log(output.slice(-3000)); console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall OK');
