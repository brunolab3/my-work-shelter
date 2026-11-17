// Lo que se oye en el mundo, cada fotograma (refugio.ts llama a `audioMundo.actualizar`):
// - el ambiente de cada sala según dónde está el Supervisor (ambiente.ts), con la calle y el hueco del ascensor;
// - las voces de los habitantes (voces.ts): murmuran al ritmo del texto que escriben en su intercomunicador, sueltan
//   una exclamación al terminar, al fallar o al pedir permiso, hablan solos de vez en cuando, charlan entre ellos y
//   roncan al dormir;
// - el tecleo de quien teclea en su puesto y los ruiditos de lo que hace (leer, trastear, el café…).
// Todo es espacial: paneo por la posición en pantalla y volumen por cercanía (su sala, entera; las de al lado, a
// través de la pared; más allá, nada). Con el intercomunicador abierto, la voz de quien habla suena en primer plano.
import * as THREE from 'three';
import type { SessionSummary } from '@shared/protocolo';
import { mundo, FLOOR, FRAME, type Sala } from '../mundo/salas/comun';
import { baseStock } from '@shared/decorado';
import { cliente, vivo } from '../red/cliente';
import { juego } from '../ui/estadoJuego';
import { sessionOwner, isCopy, rutaDeCopia } from '../ui/copias';
import { sonido, SFX } from './sonido';
import { mezclar, activeProfiles, type Listen } from './ambiente';
import { Voice, snore, type Species, type Exclamation } from './voces';
import { Typist } from './teclado';
import { pitidosMando } from './sintesis';
import { Turntable } from './tocadiscos';
import { CLUB, THREAD, ACOUSTICS_CLUB, THREAD_ACOUSTICS, ACOUSTICS_RADIO } from './temas';
import { registrarPulse, musicPulse, type MusicPulse } from './musica';

const ELEVATOR_MIDDLE = 3.4 / 2;   // ANCHO_ASCENSOR / 2 (ascensor.ts)
const azar = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;

/** Lo que el audio necesita del refugio (refugio.ts se pasa a sí mismo) */
export interface ViewAudio {
  viewGeneral: boolean; distRoom: number;
  camara: { goal: THREE.Vector3; distancia: number };
  hologramas: { figuras: Map<string, { p: { raiz: THREE.Object3D }; sala: Sala; authorId: string; estado: string }> };
}

/** Cómo se oye algo desde donde está el Supervisor: volumen (0..1), paneo y paso bajo (pared) */
export interface Heard { g: number; pan: number; underStep: number }

// ------------------------------------------------------------------------------------------------ oyente
const listener = { pos: new THREE.Vector3(), general: false, camX: 0, camY: 0, widthMiddle: 10, distancia: 27, sala: null as Sala | null, rellano: false, listo: false };

function insideOf(s: Sala, p: THREE.Vector3) { return Math.abs(p.x - s.grupo.position.x) <= s.ancho / 2 + FRAME && Math.abs(p.y - s.grupo.position.y) < FLOOR / 2; }

function setListener(v: ViewAudio) {
  const sup = mundo.supervisor(), cam = mundo.camara();
  if (!sup || !cam) return false;
  listener.general = v.viewGeneral || v.camara.distancia > v.distRoom * 1.6;
  listener.pos.copy(listener.general ? v.camara.goal : sup.position);
  listener.camX = cam.position.x; listener.camY = cam.position.y; listener.distancia = v.camara.distancia;
  listener.widthMiddle = Math.max(4, v.camara.distancia * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect);
  listener.sala = listener.general ? null : mundo.salas().find(s => insideOf(s, sup.position)) ?? null;
  listener.rellano = !listener.general && Math.abs(sup.position.x) <= ELEVATOR_MIDDLE + 0.2;
  listener.listo = true;
  return true;
}

const panOf = (x: number) => clamp((x - listener.camX) / listener.widthMiddle, -1, 1) * 0.75;

/** Cómo se oye un punto del mundo que está en la sala `sala` (o en ninguna) */
export function hear(pos: THREE.Vector3, sala?: Sala | null): Heard {
  if (!listener.listo) return { g: 0, pan: 0, underStep: 20000 };
  const pan = panOf(pos.x);
  if (listener.general) {
    const d = Math.hypot(pos.x - listener.pos.x, pos.y - listener.pos.y);
    return { g: 0.3 * clamp(1 - d / (listener.distancia * 0.8), 0, 1), pan, underStep: 2500 };
  }
  const o = listener.pos, dy = Math.abs(pos.y - o.y);
  if (dy > FLOOR * 1.4) return { g: 0, pan, underStep: 400 };
  const dx = Math.abs(pos.x - o.x);
  if (dy > FLOOR / 2) return { g: 0.07 * clamp(1 - dx / 10, 0, 1), pan, underStep: 450 };   // la planta de arriba o de abajo
  if (sala && sala === listener.sala) return { g: 1 - Math.min(0.45, dx / 24), pan, underStep: 20000 };
  return { g: 0.3 * clamp(1 - dx / 16, 0, 1), pan, underStep: 800 };    // la sala de al lado
}

// ------------------------------------------------------------------------------------------------ perfil de cada sala
/** El perfil sonoro de una sala: su tipo o, en las de repo, lo que hay montado dentro */
export function profileOf(s: Sala): string {
  if (s.tipo !== 'repo' && s.tipo !== 'coordinacion') return s.tipo;
  const guardada = (vivo.get().estado?.salas ?? []).find((x: any) => x.id === s.id);
  // la escena que tiene montada: la de su decorado (la sala vacía suena a banco de pruebas) o la de serie
  const base: string = guardada?.decorado?.base ?? baseStock({ tipo: s.tipo, estilo: guardada?.estilo }, vivo.get().repos[s.id]);
  return ({ escaparate: 'landing', proyeccion: 'video', tallerWeb: 'web', taller: 'banco', vacia: 'banco' } as Record<string, string>)[base] ?? base;
}

function ambientWeights(): Map<string, Listen> {
  const weights = new Map<string, Listen>();
  const poner = (id: string, e: Listen) => { const ya = weights.get(id); if (!ya || e.weight > ya.weight) weights.set(id, e); };
  const o = listener.pos;
  for (const s of mundo.salas()) {
    const x = s.grupo.position.x, y = s.grupo.position.y, pan = panOf(x) * 0.8;
    if (listener.general) {
      const d = Math.hypot(x - o.x, y + 2 - o.y);
      poner(profileOf(s), { weight: 0.16 * clamp(1 - d / (listener.distancia * 0.9), 0, 1), pan, underStep: 1800 });
      continue;
    }
    const dy = Math.abs(y - o.y);
    if (dy > FLOOR * 1.4) continue;
    if (s === listener.sala) { poner(profileOf(s), { weight: 1, pan: pan * 0.5, underStep: 20000 }); continue; }
    const fuera = Math.max(0, Math.abs(x - o.x) - s.ancho / 2);
    if (dy > FLOOR / 2) poner(profileOf(s), { weight: fuera < 2 ? 0.05 : 0, pan, underStep: 380 });
    else poner(profileOf(s), { weight: (listener.rellano ? 0.4 : 0.28) * clamp(1 - fuera / 12, 0, 1), pan, underStep: listener.rellano ? 1300 : 750 });
  }
  // la calle (planta baja, fuera de los edificios) y el hueco del ascensor
  const inStreet = !listener.general && Math.round(-o.y / FLOOR) === 0;
  if (listener.general) {
    poner('calle', { weight: o.y > -FLOOR ? 0.12 : 0, pan: 0, underStep: 2500 });
    poner('hueco', { weight: Math.abs(o.x) < 12 ? 0.05 : 0, pan: panOf(0), underStep: 1500 });
  } else {
    if (inStreet) poner('calle', listener.sala ? { weight: 0.25, pan: 0, underStep: 1100 } : { weight: listener.rellano ? 0.6 : 1, pan: 0, underStep: listener.rellano ? 4000 : 20000 });
    const dx = Math.abs(o.x);
    poner('hueco', listener.rellano ? { weight: 1, pan: 0, underStep: 20000 } : { weight: 0.25 * clamp(1 - (dx - ELEVATOR_MIDDLE) / 8, 0, 1), pan: panOf(0), underStep: 900 });
  }
  if (listener.general) {
    // de lejos, solo lo que más se oye: una mezcla suave, no un guirigay
    const orden = [...weights.entries()].sort((a, b) => b[1].weight - a[1].weight);
    for (const [id] of orden.slice(4)) weights.delete(id);
  }
  return weights;
}

// ------------------------------------------------------------------------------------------------ voces
interface Speaker { voz: Voice; pos: () => THREE.Vector3 | null; sala: () => Sala | null; primerPlano: () => boolean }
const speakers = new Map<string, Speaker>();
const speaks = new Map<string, { desde: number; descanso: number }>();   // por hablante: frases y descansos

function speciesOf(h: any): Species { return h.id?.tipo === 'Octocat' ? 'gato' : h.p?.aspecto?.especie === 'robot' ? 'robot' : 'humano'; }
const habitante = (id: string) => mundo.habitantes().find((h: any) => h.id.id === id);

/** El que habla con ese id: un habitante o una copia holográfica (con la voz de su autor) */
function speaker(id: string): Speaker | null {
  const ya = speakers.get(id); if (ya && !ya.voz.dead) return ya;
  const ctx = sonido.ctx; if (!ctx || !currentView) return null;
  let pos: () => THREE.Vector3 | null, sala: () => Sala | null, h: any;
  if (isCopy(id)) {
    const f = currentView.hologramas.figuras.get(rutaDeCopia(id)); if (!f) return null;
    h = habitante(f.authorId); pos = () => f.p.raiz.position; sala = () => f.sala;
  } else { h = habitante(id); if (!h) return null; pos = () => h.pos; sala = () => h.sala; }
  if (!h) return null;
  const voz = new Voice(ctx, { f0: h.id.voz || 140, especie: speciesOf(h), semilla: id }, sonido.salida('voces'), sonido.eco);
  const nuevo: Speaker = { voz, pos, sala, primerPlano: () => juego.get().talkingWith === id };
  speakers.set(id, nuevo); placeVoice(nuevo, true);
  return nuevo;
}

function placeVoice(x: Speaker, immediate = false) {
  if (x.primerPlano()) { x.voz.place(0.9, 0, 20000, immediate); return; }
  const p = x.pos(); if (!p) return;
  const o = hear(p, x.sala());
  x.voz.place(0.8 * o.g, o.pan, o.underStep, immediate);
}

/** Dice algo del repertorio (exclamación, murmullo, saludo, charla) con su voz, donde esté */
function say(id: string, tipo: Exclamation, fuerza = 1) {
  const x = speaker(id); if (!x) return;
  x.voz.boca = tipo === 'murmullo' ? 0.25 : 1;
  x.voz.say(x.voz.piecesOf(tipo, fuerza));
}

// texto del asistente en streaming → sílabas al ritmo en que llega (sin hablar por encima de lo que ya dice)
const textos = new Map<string, { resto: string; codigo: boolean; accumulated: string }>();
function onText(sesionId: string, delta: string) {
  if (!sonido.ctx || !listener.listo) return;
  const s = vivo.get().sesiones[sesionId] as SessionSummary | undefined; if (!s) return;
  const t = textos.get(sesionId) ?? { resto: '', codigo: false, accumulated: '' }; textos.set(sesionId, t);
  let txt = t.resto + delta;
  // lo que va dentro de un bloque de código no se murmura
  const partes = txt.split('```');
  let spoken = '';
  partes.forEach((p, k) => { if (k > 0) t.codigo = !t.codigo; if (!t.codigo) spoken += p; });
  // la última palabra puede venir a medias: espera al siguiente trozo
  const corte = spoken.search(/[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]+$/);
  t.resto = corte >= 0 ? spoken.slice(corte) : ''; if (corte >= 0) spoken = spoken.slice(0, corte);
  if (t.codigo) t.resto = '';
  // lo que llega se junta y se dice cuando acaba lo anterior: frases enteras, no sílabas sueltas a trompicones
  t.accumulated = (t.accumulated + spoken).slice(-400); txt = t.accumulated; if (!txt.trim()) return;

  const id = sessionOwner(s);
  const ahora = performance.now() / 1000;
  const fr = speaks.get(id) ?? { desde: 0, descanso: 0 }; speaks.set(id, fr);
  if (ahora < fr.descanso) return;
  const x = speaker(id); if (!x) return;
  const primer = x.primerPlano();
  if (!primer) { const p = x.pos(); if (!p || hear(p, x.sala()).g < 0.03) return; }
  // frases cortas con respiro: no se habla sin parar aunque el texto siga llegando
  if (x.voz.callada) fr.desde = ahora;
  if (ahora - fr.desde > (primer ? 6 : 3)) { fr.descanso = ahora + (primer ? azar(1.5, 3) : azar(5, 9)); fr.desde = fr.descanso; t.accumulated = ''; return; }
  if (x.voz.pending > 0.25) return;
  x.voz.boca = 1; x.voz.say(x.voz.textPieces(txt, primer ? 2.2 : 1.8)); t.accumulated = '';
}
cliente.escuchar(m => { if (m.t === 'texto') onText(m.sesionId, m.delta); });

// ------------------------------------------------------------------------------------------------ habitantes
interface Tracking { estado: string; chore: string; murmullo: number; snore: number; charla: number; noise: number; aviso: number; cerca: boolean; saludo: number; teclas: Typist }
const consecutive = new Map<string, Tracking>();
let lastExclamation = 0, lastGreeting = 0;

function exclaim(id: string, tipo: Exclamation, s: Tracking, ahora: number) {
  if (ahora - lastExclamation < 1.2 || ahora - s.aviso < 4) return;
  lastExclamation = ahora; s.aviso = ahora; say(id, tipo);
}

function habitantes(ahora: number) {
  const sup = mundo.supervisor();
  for (const h of mundo.habitantes() as any[]) {
    const id: string = h.id.id;
    const o = hear(h.pos, h.sala);
    let s = consecutive.get(id);
    if (!s) { s = { estado: h.estado, chore: h.chore ?? '', murmullo: ahora + azar(5, 25), snore: ahora + azar(0, 4), charla: ahora + azar(2, 8), noise: ahora + azar(2, 6), aviso: 0, cerca: false, saludo: 0, teclas: new Typist() }; consecutive.set(id, s); continue; }
    const chore: string = h.chore ?? (h.estado === 'trabajando' ? 'teclear' : h.estado === 'durmiendo' ? 'dormir' : '');
    const hears = o.g > 0.02;
    // cambios de estado: exclamaciones
    if (h.estado !== s.estado) {
      if (hears) {
        if (h.estado === 'terminado') exclaim(id, 'listo', s, ahora);
        else if (h.estado === 'error') exclaim(id, 'error', s, ahora);
        else if (h.estado === 'esperando') exclaim(id, 'pregunta', s, ahora);
      }
      s.estado = h.estado;
    }
    if (chore !== s.chore) {
      // lo que empieza a hacer: celebrar, quejarse de una avería, avisar, un café…
      if (hears) {
        if (chore === 'celebrar') exclaim(id, 'listo', s, ahora);
        else if (chore === 'averia') exclaim(id, 'error', s, ahora);
        else if (chore === 'avisar') exclaim(id, 'pregunta', s, ahora);
        else if (chore === 'cafe') void sonido.tocar(['cafetera', 'copas'], { bus: 'sfx', vol: 0.12 * o.g, pan: o.pan, underStep: o.underStep, rate: 1.4 });
      }
      s.chore = chore;
    }
    if (h.chatting || !hears) { if (!hears) s.teclas.tocar({ vol: 0, pan: 0 }); continue; }

    // tecleo en su puesto: deprisa si trabaja, a ratos si no
    if (chore === 'teclear') s.teclas.tocar({ vol: (h.estado === 'trabajando' ? 0.22 : 0.13) * o.g, pan: o.pan, underStep: Math.min(o.underStep, 5500), lento: h.estado !== 'trabajando' });
    // dormir: ronquido suave, solo en su sala
    if ((chore === 'dormir' || h.estado === 'durmiendo') && ahora > s.snore) {
      s.snore = ahora + azar(3.8, 5.2);
      if (o.g > 0.6) { const p = sonido.ctx!.createStereoPanner(); p.pan.value = o.pan; p.connect(sonido.salida('voces')); snore(sonido.ctx!, p, 0.05 * o.g, (h.id.voz || 140) < 150 ? 0.85 : 1.15); setTimeout(() => p.disconnect(), 6000); }
    }
    // hablar solo mientras trabaja o piensa
    if ((h.estado === 'trabajando' || h.estado === 'pensando' || chore === 'pensar') && ahora > s.murmullo) {
      s.murmullo = ahora + azar(25, 60);
      if (o.g > 0.25 && !speakers.get(id)?.voz.pending) say(id, 'murmullo', 0.9);
    }
    // charla entre habitantes
    if (chore === 'charlar' && ahora > s.charla) {
      s.charla = ahora + azar(7, 16);
      if (o.g > 0.2 && !speakers.get(id)?.voz.pending) say(id, 'charla', 0.8);
    }
    // ruiditos de lo que tiene entre manos
    if (ahora > s.noise) {
      s.noise = ahora + azar(5, 12);
      const v = o.g;
      if (chore === 'leer') void sonido.tocar(['papel_1', 'papel_2', 'papel_3', 'rpg_bookFlip1'], { bus: 'sfx', vol: 0.14 * v, pan: o.pan, underStep: o.underStep });
      else if (chore === 'trastear') void sonido.tocar(['golpe_metal', 'imp_impactMetal_light_000', 'clank', 'engranajes'], { bus: 'sfx', vol: 0.1 * v, var: 0.1, pan: o.pan, underStep: o.underStep });
    }
    // el Supervisor se acerca: un saludo de vez en cuando
    if (sup) {
      const cerca = Math.abs(sup.position.y - h.pos.y) < 1 && Math.hypot(sup.position.x - h.pos.x, sup.position.z - h.pos.z) < 2.2;
      if (cerca && !s.cerca && h.estado === 'ocioso' && chore !== 'dormir' && ahora - s.saludo > 180 && ahora - lastGreeting > 25 && Math.random() < 0.45) {
        s.saludo = ahora; lastGreeting = ahora; say(id, 'saludo', 0.9);
      }
      s.cerca = cerca;
    }
  }
}

// ------------------------------------------------------------------------------------------------ música de las salas
const club = CLUB.length ? new Turntable(CLUB, ACOUSTICS_CLUB) : null;
const hilo = THREAD.length ? new Turntable(THREAD, THREAD_ACOUSTICS) : null;
const radioStore = CLUB.length ? new Turntable([...THREAD.slice(0, 1), ...CLUB.slice(1, 2), ...THREAD.slice(1)], ACOUSTICS_RADIO) : null;
const spotify = () => vivo.get().musica?.estado === 'sonando';
const BPM_SPOTIFY = 118;
// el compás de la sala que lo pide (por id o por tipo): con Spotify sonando en la discoteca, a tempo fijo
registrarPulse((sala): MusicPulse | null => {
  const tipo = mundo.salas().find(s => s.id === sala)?.tipo ?? sala;
  if (tipo === 'discoteca') {
    if (spotify()) { const g = performance.now() / 1000 * BPM_SPOTIFY / 60; return { sonando: true, bpm: BPM_SPOTIFY, phase: g % 1, golpe: Math.floor(g), energy: 0.7 }; }
    return club && sonido.ctx ? club.pulse() : null;
  }
  if (tipo === 'chapa') return hilo && sonido.ctx ? hilo.pulse() : null;
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
  actualizar(_dt: number, vista: ViewAudio) {
    currentView = vista;
    if (!sonido.ctx || !setListener(vista)) return;
    const weights = ambientWeights();
    mezclar(weights);
    const nada: Listen = { weight: 0, pan: 0, underStep: 20000 };
    club?.actualizar(weights.get('discoteca') ?? nada, spotify());
    hilo?.actualizar(weights.get('chapa') ?? nada);
    radioStore?.actualizar(weights.get('logistica') ?? nada);
    const ahora = performance.now() / 1000;
    habitantes(ahora);
    // al abrir el intercomunicador de alguien, te saluda (en primer plano; no cada vez)
    const hc = juego.get().talkingWith;
    if (hc !== lastInterlocutor) {
      lastInterlocutor = hc;
      if (hc && ahora - (greeted.get(hc) ?? -1e9) > 60 && !speakers.get(hc)?.voz.pending) { greeted.set(hc, ahora); say(hc, 'saludo'); }
    }
    for (const [id, x] of speakers) { if (!x.voz.actualizar()) { speakers.delete(id); continue; } placeVoice(x); }
  },

  /**
   * Que un habitante diga algo de su repertorio con su voz, donde esté: 'listo', 'error', 'pregunta', 'murmullo'
   * (para sí, bajito), 'saludo' o 'charla'. `h` es el Habitante (o su id). No se pisa con lo que ya esté diciendo.
   */
  say(h: { id: { id: string } } | string, tipo: Exclamation = 'murmullo') {
    const id = typeof h === 'string' ? h : h.id.id;
    if (speakers.get(id)?.voz.pending) return;
    say(id, tipo, tipo === 'murmullo' ? 0.9 : 1);
  },

  /**
   * Sonido de una acción en un punto del mundo (lo que hace un habitante con la pieza de su sala, al trastear…),
   * con su paneo y su pared. `vol` multiplica el de la clase (1 = normal).
   */
  accion(pos: THREE.Vector3, clase: ActionKind, vol = 1, sala?: Sala | null) {
    if (!sonido.ctx) return;
    const s = sala ?? mundo.salas().find(x => insideOf(x, pos)) ?? null;
    const o = hear(pos, s); if (o.g < 0.02) return;
    if (clase === 'pitido') {
      const p = sonido.ctx.createStereoPanner(); p.pan.value = o.pan; p.connect(sonido.salida('sfx'));
      pitidosMando(sonido.ctx, p, 0.04 * vol * o.g); setTimeout(() => p.disconnect(), 3000); return;
    }
    const a = ACTIONS[clase];
    void sonido.tocar(a.s, { bus: 'sfx', vol: a.vol * vol * o.g, rate: a.rate, var: 0.06, pan: o.pan, underStep: o.underStep, eco: 0.08 });
  },

  hear,
  profileOf,
};

// QA: el estado del audio desde la consola o Playwright
(window as any).__audio = {
  sonido, profiles: activeProfiles, club: () => club?.estado(), hilo: () => hilo?.estado(), pulse: (sala: string) => musicPulse(sala), listener: () => ({ ...listener, pos: listener.pos.toArray(), sala: listener.sala?.id }),
  speakers: () => [...speakers.entries()].map(([id, x]) => ({ id, pending: x.voz.pending })),
  say: (id: string, tipo: Exclamation) => say(id, tipo), SFX,
};
