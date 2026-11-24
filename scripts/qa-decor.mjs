// QA de «Adaptar la sala al repo» de punta a punta: el habitante de una sala lee su repo y le diseña una escena con las
// herramientas del juego (server/roomDecor.ts); al final la sala tiene decorado válido y se guarda una foto.
// Uso: node scripts/qa-decor.mjs [sala] [modelo] [foto.png]   (por defecto: la primera sala de repo, sonnet)
// Ojo: lanza una sesión real de Claude Code (gasta de tu plan) y aprueba lo que pida que solo lea: úsalo contra un
// refugio de pruebas (SHELTER_DATOS=/ruta/temporal y SHELTER_PUERTO), nunca contra el tuyo.
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const port = process.env.SHELTER_PUERTO || 3778;
let [room, model = 'sonnet', photo] = process.argv.slice(2);
const data = process.env.SHELTER_DATOS || path.join(import.meta.dirname, '..', '.data');
const token = readFileSync(path.join(data, 'token'), 'utf8').trim();
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?t=${token}`, { headers: { Origin: `http://127.0.0.1:${port}` } });
const t0 = Date.now(); const log = (...a) => console.log(`+${((Date.now() - t0) / 1000).toFixed(0)}s`, ...a);
const ask = (name, data) => new Promise((ok, fail) => { const request = Math.random().toString(36).slice(2); waiting.set(request, { ok, fail }); ws.send(JSON.stringify({ t: 'action', name, data, request })); });
const waiting = new Map();
let state = null, sessionId = null, last = '', end = false;
const READ_ONLY = /^(ls|cat|head|tail|wc|find|tree|git (log|status|show|ls-files|diff)|grep|rg)\b/;
ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', version: 'qa' })));
ws.on('message', async raw => {
  const m = JSON.parse(String(raw));
  if (m.t === 'response') { const e = waiting.get(m.request); waiting.delete(m.request); if (e) m.error ? e.fail(new Error(m.error)) : e.ok(m.data); return; }
  if (m.t === 'welcome' || m.t === 'state') state = m.state;
  if (m.t === 'welcome') {
    room ??= state.rooms.find(x => x.type === 'repo')?.id;
    const s = state.rooms.find(x => x.id === room); const h = state.dwellers.find(x => x.roomId === room);
    if (!s || !h) { log('No hay sala o habitante', room); process.exit(1); }
    log(`sala ${s.name} (${s.path}), habitante ${h.name}, decorado antes: ${s.decor ? s.decor.base : 'ninguno'}`);
    const prompt = await ask('room.adaptPrompt');
    ws.send(JSON.stringify({ t: 'start', dwellerId: h.id, roomId: room, prompt, options: { model, permissions: 'default' } }));
  } else if (m.t === 'session' && m.session.roomId === room) {
    const s = m.session; sessionId = s.id;
    if (s.activity && s.activity.text !== last) { last = s.activity.text; log('·', last); }
    if (s.pending) {
      const cmd = String((s.pending.input ?? []).map(b => b.text).join(' '));
      const si = s.pending.type === 'permiso' && (s.pending.tool !== 'Bash' || READ_ONLY.test(cmd.trim()));
      log(si ? 'PERMISO (sí):' : 'PERMISO (no):', s.pending.title, cmd.slice(0, 120));
      ws.send(JSON.stringify({ t: 'answer', sessionId, requestId: s.pending.id, decision: si ? 'si' : 'no', ...(si ? {} : { message: 'En esta prueba solo se lee el repo.' }) }));
    }
    if ((s.state === 'terminada' || s.state === 'error') && !end) {
      end = true;
      log(s.state.toUpperCase(), s.error ?? '', '\n' + (s.lastText ?? '').slice(0, 600));
      await new Promise(r => setTimeout(r, 800));
      const d = state.rooms.find(x => x.id === room)?.decor;
      if (!d) { log('FALLO: la sala no tiene decorado'); process.exit(1); }
      log(`decorado: base ${d.base}, ${d.pieces?.length ?? 0} piezas, ${d.signs?.length ?? 0} carteles, ${d.screens?.length ?? 0} pantallas · «${d.subtitle ?? ''}» · ${d.summary ?? ''}`);
      ws.send(JSON.stringify({ t: 'closeSession', sessionId }));
      if (photo) execFileSync('node', [path.join(import.meta.dirname, 'capture.mjs'), `http://127.0.0.1:${port}/?sala=${room}`, photo, '1280', '720', '--pasos=40', "--eval=window.__juego.set({panel:null});document.getElementById('ui').style.visibility='hidden'"], { stdio: 'inherit', env: process.env });
      process.exit(0);
    }
  } else if (m.t === 'notice') log('aviso:', m.text);
});
setTimeout(() => { log('TIEMPO AGOTADO'); process.exit(2); }, 20 * 60_000);
