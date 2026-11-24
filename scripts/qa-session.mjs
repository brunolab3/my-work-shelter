// QA del núcleo de sesiones por WebSocket: arranca una sesión real de Claude Code, recibe streaming,
// responde un permiso, comprueba el resultado, hace un segundo turno, interrumpe y cierra.
// Ojo: lanza sesiones reales de Claude Code (gastan de tu plan) y puede aprobar permisos: úsalo contra un refugio de
// pruebas (arranca el juego con SHELTER_DATOS=/ruta/temporal), nunca contra el tuyo.
import WebSocket from 'ws';
const port = process.env.SHELTER_PUERTO || 3778;
// la sala: la que se pase o la primera de repo del refugio (ya no hay salas de ejemplo con nombre fijo)
let room = process.argv[2];
import { readFileSync } from 'node:fs';
import path from 'node:path';
const token = readFileSync(path.join(process.env.SHELTER_DATOS || path.join(import.meta.dirname, '..', '.data'), 'token'), 'utf8').trim();
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?t=${token}`, { headers: { Origin: `http://127.0.0.1:${port}` } });
const t0 = Date.now(); const log = (...a) => console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s`, ...a);
let sessionId = null, phase = 0, texts = 0;
ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', version: 'qa' })); });
ws.on('message', raw => {
  const m = JSON.parse(String(raw));
  if (m.t === 'welcome') {
    log('bienvenida: claude', m.claudeOk, m.versionClaude, 'salas', m.state.rooms.length);
    room ??= m.state.rooms.find(s => s.type === 'repo')?.id;
    const dwellerId = m.state.dwellers.find(h => h.roomId === room)?.id;
    if (!room || !dwellerId) { log('No hay sala de repo con habitante: recluta una o pásala como argumento'); process.exit(1); }
    ws.send(JSON.stringify({ t: 'start', dwellerId, roomId: room, prompt: 'Ejecuta exactamente este comando con la herramienta Bash: `echo refugio > /tmp/refugio-qa.txt && cat /tmp/refugio-qa.txt` y dime en una frase el resultado. Nada más.', options: { permissions: 'default' } }));
  } else if (m.t === 'session') {
    const s = m.session; sessionId = s.id;
    if (s.pending && phase === 0) { phase = 1; log('PERMISO:', s.pending.title, '\n' + (s.pending.input ?? []).map(b => b.text).join('\n')); ws.send(JSON.stringify({ t: 'answer', sessionId, requestId: s.pending.id, decision: 'si' })); }
    if (s.activity && s.activity.text !== globalThis.__last) { globalThis.__last = s.activity.text; log('actividad:', s.activity.text); }
    if (phase === 0 && s.state === 'terminada') log('(no pidió permiso: las reglas del usuario lo permiten)');
    if (s.state === 'terminada' && phase <= 1) { phase = 2; log('TERMINADA turno 1:', (s.lastText || '').slice(0, 160), '| claudeId', s.claudeId); ws.send(JSON.stringify({ t: 'send', sessionId, text: 'Ahora responde solo: «vale».' })); }
    else if (s.state === 'terminada' && phase === 2) { phase = 3; log('TERMINADA turno 2:', s.lastText); ws.send(JSON.stringify({ t: 'closeSession', sessionId })); }
    else if (s.state === 'cerrada') { log('CERRADA. textos en streaming:', texts); ws.close(); process.exit(0); }
    else if (s.state === 'error') { log('ERROR:', s.error); process.exit(1); }
  } else if (m.t === 'text') texts++;
  else if (m.t === 'notice') log('aviso:', m.text);
});
setTimeout(() => { log('TIEMPO AGOTADO en fase', phase); process.exit(2); }, 120000);
