// QA de Chapa y Pintura (el probador de aspecto): la sala, el guardián de la puerta (del tamaño de todos), el probador
// pestaña a pestaña con sus miniaturas, el cambio a robot, el azar, guardar (el servidor lo valida y el personaje del
// refugio se viste sin moverse) y que la Octocat no se puede tocar. Mide además la altura de todos los habitantes.
// Uso, con un refugio de pruebas:
//   SHELTER_DATOS=/tmp/shelter-qa SHELTER_PUERTO=3799 npm run dev   (en otra terminal)
//   SHELTER_DATOS=/tmp/shelter-qa node scripts/qa-body-shop.mjs [carpeta-de-capturas]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { withToken } from './token.mjs';

const [dir = '/tmp/qa-chapa'] = process.argv.slice(2);
if (!process.env.SHELTER_DATOS) { console.error('Uso: SHELTER_DATOS=/tmp/… node scripts/qa-body-shop.mjs [capturas]'); process.exit(2); }
mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
pg.on('pageerror', e => errors.push(e.message));
pg.on('console', m => { if ((m.type() === 'error' || /FALLO/.test(m.text())) && !/No target node found for track: handslot/.test(m.text())) errors.push(m.text()); });
await pg.goto(withToken('http://127.0.0.1:5173/'), { waitUntil: 'load' });
await pg.waitForFunction(() => typeof window.__ready === 'function', null, { timeout: 60000 });
await pg.evaluate(() => window.__ready());
await pg.waitForFunction(() => window.__live.get().state?.rooms, null, { timeout: 30000 });
const photo = async (n) => { await pg.screenshot({ path: `${dir}/${n}.png` }); console.log('->', `${dir}/${n}.png`); };
const wait = (ms) => pg.waitForTimeout(ms);
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await pg.keyboard.press(k); await wait(60); } };
let failures = 0; const ok = (c, txt) => { console.log((c ? 'OK   ' : 'FAILED') + ' ' + txt); if (!c) failures++; };

await pg.evaluate(async () => { await window.__client.action('save', { patch: { doneWelcome: true } }); await window.__client.action('look.save', { who: 'supervisor', look: null }); window.__game.set({ panel: null, panelData: null }); });
const go = async (id) => { await pg.evaluate(id => window.dispatchEvent(new CustomEvent('shelter:go', { detail: { roomId: id } })), id); await pg.waitForFunction(id => window.__shelter.currentRoom?.id === id, id, { timeout: 60000 }).catch(() => {}); await wait(3500); };

// ---- todos del mismo tamaño
await wait(4000);
// la altura de verdad de cada figura (la caja de sus mallas deformadas por los huesos), sin contar sombreros
const heights = await pg.evaluate(() => window.__shelter.dwellers.map(h => {
  const hidden = []; h.p.model.traverse(o => { if (o.isMesh && /Hat|Helmet|Crown|Hood|Wing|Jetpack/.test(o.name) && o.visible) { o.visible = false; hidden.push(o); } });
  const c = new window.__THREE.Box3(); h.p.model.updateMatrixWorld(true); h.p.model.traverse(o => { if (o.isMesh && o.visible && !o.name.startsWith('pieza:') && !o.name.startsWith('espalda:')) return; if (o.isMesh && o.visible) c.expandByObject(o, true); });
  hidden.forEach(o => { o.visible = true; });
  return [h.id.id, +(c.max.y - h.p.root.position.y).toFixed(2)];
}));
console.log('alturas:', heights.map(a => a.join(' ')).join(' · '));
const others = heights.filter(([id]) => id !== 'mona').map(a => a[1]);
ok(Math.max(...others) - Math.min(...others) < 0.4, `todos más o menos igual de altos: ${Math.min(...others)}–${Math.max(...others)} m`);

await go('gate'); await photo('1-puerta-guardian');
const g = await pg.evaluate(() => { const h = window.__shelter.dwellers.find(x => x.id.id === 'guardian'); return { especie: h.p.look?.especie, torso: h.p.look?.pieces.torso }; });
ok(g.especie === 'robot' && g.torso === 'torso.4GTN', 'el guardián es un androide como el de la cámara acorazada');

await go('bodyshop'); await photo('2-chapa');

// ---- el probador del Supervisor
await pg.evaluate(() => window.__game.set({ panel: 'bodyshop', panelData: { who: 'supervisor' } }));
await wait(2500); await photo('3-probador-cara');
for (const [n, k] of [['pelo', 2], ['barba', 1], ['sombrero', 1], ['torso', 2], ['piernas', 2], ['espalda', 1]]) {
  await key('Tab', k); await wait(2500); await key('ArrowRight', 2); await wait(1800); await photo('4-probador-' + n);
}
await key('Tab', 2); await wait(1200); await photo('5-probador-colores');
await key('ArrowRight', 3); await wait(900);
await key('KeyR'); await wait(2500); await photo('6-probador-azar');
await key('KeyH'); await wait(3000); await photo('7-probador-robot');
await key('KeyR'); await wait(2500); await photo('8-probador-robot-azar');
const before = await pg.evaluate(() => JSON.stringify(window.__shelter.supervisor.look));
await key('Enter'); await wait(1500);
const saved = await pg.evaluate(() => window.__live.get().state.supervisor.look);
ok(saved?.especie === 'robot', 'el aspecto guardado es el de robot');
const orden = o => JSON.stringify(Object.entries(o).filter(([, v]) => v).sort());
ok(orden(saved.pieces) === orden(JSON.parse(before).pieces), 'el Supervisor del refugio lleva lo que se ha guardado');
await wait(1500); await photo('9-supervisor-robot');

// ---- un habitante desde su intercomunicador; la Octocat no
const r = await pg.evaluate(async () => { try { await window.__client.action('look.save', { who: 'mona', look: { especie: 'human', pieces: {}, colors: {} } }); return 'guardado'; } catch (e) { return String(e.message ?? e); } });
ok(/Octocat/.test(r), 'la Octocat no se deja cambiar: ' + r);
const bad = await pg.evaluate(async () => { try { await window.__client.action('look.save', { who: 'guardian', look: { especie: 'human', pieces: { cara: 'no-existe', torso: 'torso.Knight' }, colors: { piel: 'red' } } }); return window.__live.get().state.dwellers.find(h => h.id === 'remi').look; } catch (e) { return String(e.message ?? e); } });
ok(bad?.pieces?.cara && bad.pieces.cara !== 'no-existe' && !bad.colors.piel && bad.pieces.torso === 'torso.Knight', 'el servidor sanea lo que no existe');

console.log(errors.length ? 'ERRORES:\n' + errors.slice(0, 12).join('\n') : 'sin errores en la página');
await b.close();
process.exit(failures || errors.length ? 1 : 0);
