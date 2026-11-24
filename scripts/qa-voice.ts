// QA del dictado del intercomunicador (server/voice.ts): una frase dicha con `say` se manda como lo hace el cliente
// (PCM de 16 bits a 16 kHz en trozos de 0,25 s, a tiempo real) y se comprueba lo transcrito, en vivo y al final.
//   npx tsx scripts/qa-voice.ts [datos]     (datos: carpeta donde compilar el transcriptor; por defecto, una temporal)
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Dictations, transcriber, type VoiceEvent } from '../server/voice.ts';

const PHRASE = 'Hola, revisa la captura del intercomunicador y dime por qué el botón de enviar se ve cortado.';
const data = process.argv[2] ?? mkdtempSync(path.join(os.tmpdir(), 'shelter-qa-voz-'));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'shelter-qa-voz-audio-'));
const fail = (m: string) => { console.error('✗ ' + m); process.exitCode = 1; };
try {
  let t = Date.now();
  await transcriber(data);
  console.log(`transcriptor listo en ${((Date.now() - t) / 1000).toFixed(1)} s`);
  execFileSync('/usr/bin/say', ['-v', 'Mónica', '-o', path.join(tmp, 'f.aiff'), PHRASE]);
  execFileSync('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', path.join(tmp, 'f.aiff'), path.join(tmp, 'f.wav')]);
  const pcm = readFileSync(path.join(tmp, 'f.wav')).subarray(44);
  const d = new Dictations(data);
  const events: VoiceEvent[] = [];
  const t0 = Date.now(), times: Record<string, number> = {};
  const end = new Promise<VoiceEvent>(ok => d.start('qa', 'es-ES', null, e => { times[e.state] ??= Date.now() - t0; events.push(e); if (e.state === 'final' || e.state === 'error') ok(e); }));
  for (let i = 0; i < pcm.length; i += 8000) { d.audio('qa', pcm.subarray(i, i + 8000).toString('base64')); await new Promise(r => setTimeout(r, 250)); }
  const speaks = Date.now();
  d.finish('qa');
  const e = await end;
  const partial = events.filter(x => x.state === 'partial');
  console.log(`listo a los ${times.ready} ms; primer parcial a los ${times.partial} ms; ${partial.length} parciales mientras se hablaba; final ${Date.now() - speaks} ms después de terminar`);
  if ((times.partial ?? 1e9) > 3000) fail('tarda demasiado en empezar a transcribir');
  console.log(`→ ${e.text}`);
  if (e.state !== 'final') fail(`el dictado ha fallado: ${e.text}`);
  if (partial.length < 3) fail('no ha ido transcribiendo en vivo');
  if (partial.some(x => !x.text)) fail('partials without text: server/voice/transcriber.swift and server/voice.ts disagree on the JSON key');
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const words = norm(PHRASE).split(' '), spoken = new Set(norm(e.text ?? '').split(' '));
  const accuracy = words.filter(p => spoken.has(p)).length / words.length;
  console.log(`acierto: ${(accuracy * 100).toFixed(0)} % de las palabras`);
  if (accuracy < 0.85) fail('transcripción demasiado pobre');
  // cancelar a medias no deja nada colgando ni manda texto
  const others: VoiceEvent[] = [];
  d.start('qa2', 'es-ES', null, x => others.push(x));
  d.audio('qa2', pcm.subarray(0, 32000).toString('base64'));
  await new Promise(r => setTimeout(r, 600));
  d.cancel('qa2');
  await new Promise(r => setTimeout(r, 400));
  if (others.some(x => x.state === 'final' || x.state === 'error')) fail('cancelar ha mandado algo');
  if (!process.exitCode) console.log('✓ dictado OK');
} finally {
  rmSync(tmp, { recursive: true, force: true });
  if (!process.argv[2]) rmSync(data, { recursive: true, force: true });
}
