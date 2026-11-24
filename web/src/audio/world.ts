// Lo que se oye en el mundo, cada fotograma (shelter.ts llama a `audioMundo.actualizar`):
// - el ambiente de cada sala según dónde está el Supervisor (ambience.ts), con la calle y el hueco del ascensor;
// - las voces de los habitantes (voices.ts): murmuran al ritmo del texto que escriben en su intercomunicador, sueltan
//   una exclamación al terminar, al fallar o al pedir permiso, hablan solos de vez en cuando, charlan entre ellos y
//   roncan al dormir;
// - el tecleo de quien teclea en su puesto y los ruiditos de lo que hace (leer, trastear, el café…).
// Todo es espacial: paneo por la posición en pantalla y volumen por cercanía (su sala, entera; las de al lado, a
// través de la pared; más allá, nada). Con el intercomunicador abierto, la voz de quien habla suena en primer plano.
import * as THREE from 'three';
import type { SessionSummary } from '@shared/protocol';
import { world, FLOOR, FRAME, type Room } from '../world/rooms/common';
import { baseStock } from '@shared/decor';
import { client, live } from '../net/client';
import { juego } from '../ui/gameState';
import { sessionOwner, isCopy, copyPath } from '../ui/copies';
import { sound, SFX } from './sound';
import { mix, activeProfiles, type Listen } from './ambience';
import { Voice, snore, type Species, type Exclamation } from './voices';
import { Typist } from './keyboard';
import { remoteBeeps } from './synthesis';
import { Turntable } from './turntable';
import { CLUB, THREAD, ACOUSTICS_CLUB, THREAD_ACOUSTICS, ACOUSTICS_RADIO } from './themes';
import { registerPulse, musicPulse, type MusicPulse } from './music';

const ELEVATOR_MIDDLE = 3.4 / 2;   // ANCHO_ASCENSOR / 2 (elevator.ts)
const random = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;

/** Lo que el audio necesita del refugio (shelter.ts se pasa a sí mismo) */
export interface ViewAudio {
  viewGeneral: boolean; distRoom: number;
  camara: { goal: THREE.Vector3; distance: number };
  holograms: { figures: Map<string, { p: { root: THREE.Object3D }; room: Room; authorId: string; state: string }> };
}

/** Cómo se oye algo desde donde está el Supervisor: volumen (0..1), paneo y paso bajo (pared) */
export interface Heard { g: number; pan: number; underStep: number }

// ------------------------------------------------------------------------------------------------ oyente
const listener = { pos: new THREE.Vector3(), general: false, camX: 0, camY: 0, widthMiddle: 10, distance: 27, room: null as Room | null, landing: false, ready: false };

function insideOf(s: Room, p: THREE.Vector3) { return Math.abs(p.x - s.group.position.x) <= s.width / 2 + FRAME && Math.abs(p.y - s.group.position.y) < FLOOR / 2; }

function setListener(v: ViewAudio) {
  const sup = world.supervisor(), cam = world.camara();
  if (!sup || !cam) return false;
  listener.general = v.viewGeneral || v.camara.distance > v.distRoom * 1.6;
  listener.pos.copy(listener.general ? v.camara.goal : sup.position);
  listener.camX = cam.position.x; listener.camY = cam.position.y; listener.distance = v.camara.distance;
  listener.widthMiddle = Math.max(4, v.camara.distance * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect);
  listener.room = listener.general ? null : world.rooms().find(s => insideOf(s, sup.position)) ?? null;
  listener.landing = !listener.general && Math.abs(sup.position.x) <= ELEVATOR_MIDDLE + 0.2;
  listener.ready = true;
  return true;
}

const panOf = (x: number) => clamp((x - listener.camX) / listener.widthMiddle, -1, 1) * 0.75;

/** Cómo se oye un punto del mundo que está en la sala `sala` (o en ninguna) */
export function hear(pos: THREE.Vector3, room?: Room | null): Heard {
  if (!listener.ready) return { g: 0, pan: 0, underStep: 20000 };
  const pan = panOf(pos.x);
  if (listener.general) {
    const d = Math.hypot(pos.x - listener.pos.x, pos.y - listener.pos.y);
    return { g: 0.3 * clamp(1 - d / (listener.distance * 0.8), 0, 1), pan, underStep: 2500 };
  }
  const o = listener.pos, dy = Math.abs(pos.y - o.y);
  if (dy > FLOOR * 1.4) return { g: 0, pan, underStep: 400 };
  const dx = Math.abs(pos.x - o.x);
  if (dy > FLOOR / 2) return { g: 0.07 * clamp(1 - dx / 10, 0, 1), pan, underStep: 450 };   // la planta de arriba o de abajo
  if (room && room === listener.room) return { g: 1 - Math.min(0.45, dx / 24), pan, underStep: 20000 };
  return { g: 0.3 * clamp(1 - dx / 16, 0, 1), pan, underStep: 800 };    // la sala de al lado
}

// ------------------------------------------------------------------------------------------------ perfil de cada sala
/** El perfil sonoro de una sala: su tipo o, en las de repo, lo que hay montado dentro */
export function profileOf(s: Room): string {
  if (s.type !== 'repo' && s.type !== 'coordinacion') return s.type;
  const saved = (live.get().state?.rooms ?? []).find((x: any) => x.id === s.id);
  // la escena que tiene montada: la de su decorado (la sala vacía suena a banco de pruebas) o la de serie
  const base: string = saved?.decor?.base ?? baseStock({ type: s.type, style: saved?.style }, live.get().repos[s.id]);
  return ({ escaparate: 'landing', proyeccion: 'video', tallerWeb: 'web', taller: 'banco', vacia: 'banco' } as Record<string, string>)[base] ?? base;
}

function ambientWeights(): Map<string, Listen> {
  const weights = new Map<string, Listen>();
  const set = (id: string, e: Listen) => { const already = weights.get(id); if (!already || e.weight > already.weight) weights.set(id, e); };
  const o = listener.pos;
  for (const s of world.rooms()) {
    const x = s.group.position.x, y = s.group.position.y, pan = panOf(x) * 0.8;
    if (listener.general) {
      const d = Math.hypot(x - o.x, y + 2 - o.y);
      set(profileOf(s), { weight: 0.16 * clamp(1 - d / (listener.distance * 0.9), 0, 1), pan, underStep: 1800 });
      continue;
    }
    const dy = Math.abs(y - o.y);
    if (dy > FLOOR * 1.4) continue;
    if (s === listener.room) { set(profileOf(s), { weight: 1, pan: pan * 0.5, underStep: 20000 }); continue; }
    const outside = Math.max(0, Math.abs(x - o.x) - s.width / 2);
    if (dy > FLOOR / 2) set(profileOf(s), { weight: outside < 2 ? 0.05 : 0, pan, underStep: 380 });
    else set(profileOf(s), { weight: (listener.landing ? 0.4 : 0.28) * clamp(1 - outside / 12, 0, 1), pan, underStep: listener.landing ? 1300 : 750 });
  }
  // la calle (planta baja, fuera de los edificios) y el hueco del ascensor
  const inStreet = !listener.general && Math.round(-o.y / FLOOR) === 0;
  if (listener.general) {
    set('calle', { weight: o.y > -FLOOR ? 0.12 : 0, pan: 0, underStep: 2500 });
    set('hueco', { weight: Math.abs(o.x) < 12 ? 0.05 : 0, pan: panOf(0), underStep: 1500 });
  } else {
    if (inStreet) set('calle', listener.room ? { weight: 0.25, pan: 0, underStep: 1100 } : { weight: listener.landing ? 0.6 : 1, pan: 0, underStep: listener.landing ? 4000 : 20000 });
    const dx = Math.abs(o.x);
    set('hueco', listener.landing ? { weight: 1, pan: 0, underStep: 20000 } : { weight: 0.25 * clamp(1 - (dx - ELEVATOR_MIDDLE) / 8, 0, 1), pan: panOf(0), underStep: 900 });
  }
  if (listener.general) {
    // de lejos, solo lo que más se oye: una mezcla suave, no un guirigay
    const orden = [...weights.entries()].sort((a, b) => b[1].weight - a[1].weight);
    for (const [id] of orden.slice(4)) weights.delete(id);
  }
  return weights;
}

// ------------------------------------------------------------------------------------------------ voces
interface Speaker { voice: Voice; pos: () => THREE.Vector3 | null; room: () => Room | null; foreground: () => boolean }
const speakers = new Map<string, Speaker>();
const speaks = new Map<string, { since: number; pause: number }>();   // por hablante: frases y descansos

function speciesOf(h: any): Species { return h.id?.type === 'Octocat' ? 'gato' : h.p?.look?.especie === 'robot' ? 'robot' : 'humano'; }
const dweller = (id: string) => world.dwellers().find((h: any) => h.id.id === id);

/** El que habla con ese id: un habitante o una copia holográfica (con la voz de su autor) */
function speaker(id: string): Speaker | null {
  const already = speakers.get(id); if (already && !already.voice.dead) return already;
  const ctx = sound.ctx; if (!ctx || !currentView) return null;
  let pos: () => THREE.Vector3 | null, room: () => Room | null, h: any;
  if (isCopy(id)) {
    const f = currentView.holograms.figures.get(copyPath(id)); if (!f) return null;
    h = dweller(f.authorId); pos = () => f.p.root.position; room = () => f.room;
  } else { h = dweller(id); if (!h) return null; pos = () => h.pos; room = () => h.room; }
  if (!h) return null;
  const voice = new Voice(ctx, { f0: h.id.voice || 140, especie: speciesOf(h), seed: id }, sound.output('voces'), sound.echo);
  const newer: Speaker = { voice, pos, room, foreground: () => juego.get().talkingWith === id };
  speakers.set(id, newer); placeVoice(newer, true);
  return newer;
}

function placeVoice(x: Speaker, immediate = false) {
  if (x.foreground()) { x.voice.place(0.9, 0, 20000, immediate); return; }
  const p = x.pos(); if (!p) return;
  const o = hear(p, x.room());
  x.voice.place(0.8 * o.g, o.pan, o.underStep, immediate);
}

/** Dice algo del repertorio (exclamación, murmullo, saludo, charla) con su voz, donde esté */
function say(id: string, type: Exclamation, strength = 1) {
  const x = speaker(id); if (!x) return;
  x.voice.mouth = type === 'murmullo' ? 0.25 : 1;
  x.voice.say(x.voice.piecesOf(type, strength));
}

// texto del asistente en streaming → sílabas al ritmo en que llega (sin hablar por encima de lo que ya dice)
const texts = new Map<string, { rest: string; code: boolean; accumulated: string }>();
function onText(sessionId: string, delta: string) {
  if (!sound.ctx || !listener.ready) return;
  const s = live.get().sessions[sessionId] as SessionSummary | undefined; if (!s) return;
  const t = texts.get(sessionId) ?? { rest: '', code: false, accumulated: '' }; texts.set(sessionId, t);
  let txt = t.rest + delta;
  // lo que va dentro de un bloque de código no se murmura
  const parts = txt.split('```');
  let spoken = '';
  parts.forEach((p, k) => { if (k > 0) t.code = !t.code; if (!t.code) spoken += p; });
  // la última palabra puede venir a medias: espera al siguiente trozo
  const truncation = spoken.search(/[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]+$/);
  t.rest = truncation >= 0 ? spoken.slice(truncation) : ''; if (truncation >= 0) spoken = spoken.slice(0, truncation);
  if (t.code) t.rest = '';
  // lo que llega se junta y se dice cuando acaba lo anterior: frases enteras, no sílabas sueltas a trompicones
  t.accumulated = (t.accumulated + spoken).slice(-400); txt = t.accumulated; if (!txt.trim()) return;

  const id = sessionOwner(s);
  const now = performance.now() / 1000;
  const fr = speaks.get(id) ?? { since: 0, pause: 0 }; speaks.set(id, fr);
  if (now < fr.pause) return;
  const x = speaker(id); if (!x) return;
  const foreground = x.foreground();
  if (!foreground) { const p = x.pos(); if (!p || hear(p, x.room()).g < 0.03) return; }
  // frases cortas con respiro: no se habla sin parar aunque el texto siga llegando
  if (x.voice.quiet) fr.since = now;
  if (now - fr.since > (foreground ? 6 : 3)) { fr.pause = now + (foreground ? random(1.5, 3) : random(5, 9)); fr.since = fr.pause; t.accumulated = ''; return; }
  if (x.voice.pending > 0.25) return;
  x.voice.mouth = 1; x.voice.say(x.voice.textPieces(txt, foreground ? 2.2 : 1.8)); t.accumulated = '';
}
client.listen(m => { if (m.t === 'text') onText(m.sessionId, m.delta); });

// ------------------------------------------------------------------------------------------------ habitantes
interface Tracking { state: string; chore: string; murmur: number; snore: number; chatter: number; noise: number; notice: number; near: boolean; greeting: number; keys: Typist }
const consecutive = new Map<string, Tracking>();
let lastExclamation = 0, lastGreeting = 0;

function exclaim(id: string, type: Exclamation, s: Tracking, now: number) {
  if (now - lastExclamation < 1.2 || now - s.notice < 4) return;
  lastExclamation = now; s.notice = now; say(id, type);
}

function dwellers(now: number) {
  const sup = world.supervisor();
  for (const h of world.dwellers() as any[]) {
    const id: string = h.id.id;
    const o = hear(h.pos, h.room);
    let s = consecutive.get(id);
    if (!s) { s = { state: h.state, chore: h.chore ?? '', murmur: now + random(5, 25), snore: now + random(0, 4), chatter: now + random(2, 8), noise: now + random(2, 6), notice: 0, near: false, greeting: 0, keys: new Typist() }; consecutive.set(id, s); continue; }
    const chore: string = h.chore ?? (h.state === 'trabajando' ? 'teclear' : h.state === 'durmiendo' ? 'dormir' : '');
    const hears = o.g > 0.02;
    // cambios de estado: exclamaciones
    if (h.state !== s.state) {
      if (hears) {
        if (h.state === 'terminado') exclaim(id, 'listo', s, now);
        else if (h.state === 'error') exclaim(id, 'error', s, now);
        else if (h.state === 'esperando') exclaim(id, 'pregunta', s, now);
      }
      s.state = h.state;
    }
    if (chore !== s.chore) {
      // lo que empieza a hacer: celebrar, quejarse de una avería, avisar, un café…
      if (hears) {
        if (chore === 'celebrar') exclaim(id, 'listo', s, now);
        else if (chore === 'averia') exclaim(id, 'error', s, now);
        else if (chore === 'avisar') exclaim(id, 'pregunta', s, now);
        else if (chore === 'cafe') void sound.play(['cafetera', 'copas'], { bus: 'sfx', vol: 0.12 * o.g, pan: o.pan, underStep: o.underStep, rate: 1.4 });
      }
      s.chore = chore;
    }
    if (h.chatting || !hears) { if (!hears) s.keys.play({ vol: 0, pan: 0 }); continue; }

    // tecleo en su puesto: deprisa si trabaja, a ratos si no
    if (chore === 'teclear') s.keys.play({ vol: (h.state === 'trabajando' ? 0.22 : 0.13) * o.g, pan: o.pan, underStep: Math.min(o.underStep, 5500), slow: h.state !== 'trabajando' });
    // dormir: ronquido suave, solo en su sala
    if ((chore === 'dormir' || h.state === 'durmiendo') && now > s.snore) {
      s.snore = now + random(3.8, 5.2);
      if (o.g > 0.6) { const p = sound.ctx!.createStereoPanner(); p.pan.value = o.pan; p.connect(sound.output('voces')); snore(sound.ctx!, p, 0.05 * o.g, (h.id.voice || 140) < 150 ? 0.85 : 1.15); setTimeout(() => p.disconnect(), 6000); }
    }
    // hablar solo mientras trabaja o piensa
    if ((h.state === 'trabajando' || h.state === 'pensando' || chore === 'pensar') && now > s.murmur) {
      s.murmur = now + random(25, 60);
      if (o.g > 0.25 && !speakers.get(id)?.voice.pending) say(id, 'murmullo', 0.9);
    }
    // charla entre habitantes
    if (chore === 'charlar' && now > s.chatter) {
      s.chatter = now + random(7, 16);
      if (o.g > 0.2 && !speakers.get(id)?.voice.pending) say(id, 'charla', 0.8);
    }
    // ruiditos de lo que tiene entre manos
    if (now > s.noise) {
      s.noise = now + random(5, 12);
      const v = o.g;
      if (chore === 'leer') void sound.play(['papel_1', 'papel_2', 'papel_3', 'rpg_bookFlip1'], { bus: 'sfx', vol: 0.14 * v, pan: o.pan, underStep: o.underStep });
      else if (chore === 'trastear') void sound.play(['golpe_metal', 'imp_impactMetal_light_000', 'clank', 'engranajes'], { bus: 'sfx', vol: 0.1 * v, var: 0.1, pan: o.pan, underStep: o.underStep });
    }
    // el Supervisor se acerca: un saludo de vez en cuando
    if (sup) {
      const near = Math.abs(sup.position.y - h.pos.y) < 1 && Math.hypot(sup.position.x - h.pos.x, sup.position.z - h.pos.z) < 2.2;
      if (near && !s.near && h.state === 'ocioso' && chore !== 'dormir' && now - s.greeting > 180 && now - lastGreeting > 25 && Math.random() < 0.45) {
        s.greeting = now; lastGreeting = now; say(id, 'saludo', 0.9);
      }
      s.near = near;
    }
  }
}

// ------------------------------------------------------------------------------------------------ música de las salas
const club = CLUB.length ? new Turntable(CLUB, ACOUSTICS_CLUB) : null;
const thread = THREAD.length ? new Turntable(THREAD, THREAD_ACOUSTICS) : null;
const radioStore = CLUB.length ? new Turntable([...THREAD.slice(0, 1), ...CLUB.slice(1, 2), ...THREAD.slice(1)], ACOUSTICS_RADIO) : null;
const spotify = () => live.get().music?.state === 'sonando';
const BPM_SPOTIFY = 118;
// el compás de la sala que lo pide (por id o por tipo): con Spotify sonando en la discoteca, a tempo fijo
registerPulse((room): MusicPulse | null => {
  const type = world.rooms().find(s => s.id === room)?.type ?? room;
  if (type === 'discoteca') {
    if (spotify()) { const g = performance.now() / 1000 * BPM_SPOTIFY / 60; return { playing: true, bpm: BPM_SPOTIFY, phase: g % 1, beat: Math.floor(g), energy: 0.7 }; }
    return club && sound.ctx ? club.pulse() : null;
  }
  if (type === 'chapa') return thread && sound.ctx ? thread.pulse() : null;
  return null;
});

// ------------------------------------------------------------------------------------------------ API
let currentView: ViewAudio | null = null;
let lastInterlocutor: string | null = null;
const greeted = new Map<string, number>();

export type ActionKind = 'metal' | 'herramienta' | 'papel' | 'caja' | 'agua' | 'vapor' | 'chispa' | 'pitido' | 'cristal' | 'cerrojo' | 'tijeras' | 'spray' | 'raton' | 'golpe';
const ACTIONS: Record<Exclude<ActionKind, 'pitido'>, { s: string[]; vol: number; rate?: number }> = {
  metal: { s: ['golpe_metal', 'imp_impactMetal_light_000', 'imp_impactPlate_light_000'], vol: 0.3 },
  herramienta: { s: ['engranajes', 'clank', 'rpg_metalLatch'], vol: 0.3 },
  papel: { s: ['papel_1', 'papel_2', 'papel_3', 'rpg_bookFlip1'], vol: 0.35 },
  caja: { s: ['caja_1', 'caja_2', 'caja_3'], vol: 0.35 },
  agua: { s: ['aspersor'], vol: 0.3 },
  vapor: { s: ['vapor_1', 'vapor_2'], vol: 0.3 },
  chispa: { s: ['sf_explosionCrunch_000'], vol: 0.15, rate: 1.8 },
  cristal: { s: ['copas'], vol: 0.3, rate: 1.2 },
  cerrojo: { s: ['cerrojo_1', 'cerrojo_2', 'rpg_metalLatch'], vol: 0.35 },
  tijeras: { s: ['tijeras_1', 'tijeras_2'], vol: 0.35 },
  spray: { s: ['aerografo'], vol: 0.3 },
  raton: { s: ['raton_1', 'raton_2'], vol: 0.3 },
  golpe: { s: ['yunque_1', 'yunque_2', 'golpe_metal'], vol: 0.3 },
};

export const audioWorld = {
  /** Cada fotograma, desde Refugio.actualizar: `audioMundo.actualizar(dt, this)` */
  update(_dt: number, view: ViewAudio) {
    currentView = view;
    if (!sound.ctx || !setListener(view)) return;
    const weights = ambientWeights();
    mix(weights);
    const none: Listen = { weight: 0, pan: 0, underStep: 20000 };
    club?.update(weights.get('discoteca') ?? none, spotify());
    thread?.update(weights.get('chapa') ?? none);
    radioStore?.update(weights.get('logistica') ?? none);
    const now = performance.now() / 1000;
    dwellers(now);
    // al abrir el intercomunicador de alguien, te saluda (en primer plano; no cada vez)
    const hc = juego.get().talkingWith;
    if (hc !== lastInterlocutor) {
      lastInterlocutor = hc;
      if (hc && now - (greeted.get(hc) ?? -1e9) > 60 && !speakers.get(hc)?.voice.pending) { greeted.set(hc, now); say(hc, 'saludo'); }
    }
    for (const [id, x] of speakers) { if (!x.voice.update()) { speakers.delete(id); continue; } placeVoice(x); }
  },

  /**
   * Que un habitante diga algo de su repertorio con su voz, donde esté: 'listo', 'error', 'pregunta', 'murmullo'
   * (para sí, bajito), 'saludo' o 'charla'. `h` es el Habitante (o su id). No se pisa con lo que ya esté diciendo.
   */
  say(h: { id: { id: string } } | string, type: Exclamation = 'murmullo') {
    const id = typeof h === 'string' ? h : h.id.id;
    if (speakers.get(id)?.voice.pending) return;
    say(id, type, type === 'murmullo' ? 0.9 : 1);
  },

  /**
   * Sonido de una acción en un punto del mundo (lo que hace un habitante con la pieza de su sala, al trastear…),
   * con su paneo y su pared. `vol` multiplica el de la clase (1 = normal).
   */
  action(pos: THREE.Vector3, kind: ActionKind, vol = 1, room?: Room | null) {
    if (!sound.ctx) return;
    const s = room ?? world.rooms().find(x => insideOf(x, pos)) ?? null;
    const o = hear(pos, s); if (o.g < 0.02) return;
    if (kind === 'pitido') {
      const p = sound.ctx.createStereoPanner(); p.pan.value = o.pan; p.connect(sound.output('sfx'));
      remoteBeeps(sound.ctx, p, 0.04 * vol * o.g); setTimeout(() => p.disconnect(), 3000); return;
    }
    const a = ACTIONS[kind];
    void sound.play(a.s, { bus: 'sfx', vol: a.vol * vol * o.g, rate: a.rate, var: 0.06, pan: o.pan, underStep: o.underStep, echo: 0.08 });
  },

  hear,
  profileOf,
};

// QA: el estado del audio desde la consola o Playwright
(window as any).__audio = {
  sound, profiles: activeProfiles, club: () => club?.state(), thread: () => thread?.state(), pulse: (room: string) => musicPulse(room), listener: () => ({ ...listener, pos: listener.pos.toArray(), room: listener.room?.id }),
  speakers: () => [...speakers.entries()].map(([id, x]) => ({ id, pending: x.voice.pending })),
  say: (id: string, type: Exclamation) => say(id, type), SFX,
};
