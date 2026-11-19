// Paisaje sonoro de cada sala: un lecho continuo (bucles y capas sintéticas) y detalles sueltos al azar, con su paneo.
// Cada sala suena por su perfil (el tipo de sala; en las de repo, lo que hay montado dentro: taller web, escaparate,
// fundición, laboratorio…); el hueco del ascensor y la calle tienen el suyo. world.ts dice cada fotograma cuánto se oye
// cada perfil (`mezclar`): la sala donde está el Supervisor, entera; las de al lado, a través de la pared (bajas y
// sin agudos); en la vista general, una mezcla suave de lo que hay a la vista. Al moverse, los perfiles se funden.
import { sound } from './sound';
import { SYNTHETIC_DETAILS, SYNTHETIC_LAYERS, type SyntheticDetail, type SyntheticLayer, type LiveLayer } from './synthesis';
import { press } from './keyboard';

interface LayerDef {
  file?: string; synth?: SyntheticLayer; vol: number; rate?: number;
  underStep?: number; heightStep?: number;
  cycle?: [number, number, number, number];   // se enciende y se apaga sola: [enMarcha min, max, parada min, max] (s)
}
interface DetailDef {
  sounds?: string[]; synth?: SyntheticDetail; drop?: true; keys?: true;
  every: [number, number];       // segundos entre uno y otro
  vol: number; var?: number; rate?: number; echo?: number; underStep?: number; heightStep?: number;
  opener?: number;                // ±paneo dentro de la sala (por defecto 0,6)
  segment?: [number, number];     // de una muestra larga, un trozo de esta duración (s), con fundidos
  burst?: [number, number, number, number];  // repeticiones: [mín, máx] veces cada [mín, máx] s
}
export interface Profile { layers: LayerDef[]; details: DetailDef[]; timer?: number; echo?: number }

const PAPER = ['papel_1', 'papel_2', 'papel_3'];
const MOUSE = ['raton_1', 'raton_2'];
const typing = (every: [number, number], vol: number): DetailDef => ({ keys: true, every, vol, underStep: 5000 });

// ------------------------------------------------------------------------------------------------ perfiles
export const PROFILES: Record<string, Profile> = {
  // radio de onda corta con voces y músicas lejanas, teletipo que va y viene, morse, avisos por radio y el módem
  comunicaciones: {
    layers: [
      { file: 'amb_onda_corta', vol: 0.2, heightStep: 250 }, { file: 'amb_teletipo', vol: 0.16, cycle: [8, 22, 4, 14] },
      { file: 'amb_oficina', vol: 0.1, underStep: 2500 }, { synth: 'fluorescente', vol: 0.005 },
    ],
    details: [
      { sounds: ['radio_voz_1', 'radio_voz_2', 'radio_voz_3'], every: [7, 16], vol: 0.16, heightStep: 450, underStep: 2400, echo: 0.2 },
      { synth: 'morse', every: [8, 18], vol: 0.035 }, { synth: 'squelch', every: [6, 14], vol: 0.04 },
      { sounds: ['fax_modem'], every: [45, 90], vol: 0.14, underStep: 4000 }, { sounds: ['telefono_lejano'], every: [40, 90], vol: 0.12 },
      { sounds: ['impresora_1', 'impresora_2'], every: [30, 60], vol: 0.14 }, typing([6, 14], 0.12),
    ],
  },
  // la agenda: oficina con gente, teléfonos, reloj de pared, impresora, papeles y la cafetera
  planificacion: {
    timer: 0.09, layers: [{ file: 'amb_oficina', vol: 0.36 }, { synth: 'fluorescente', vol: 0.005 }],
    details: [
      { sounds: ['telefono_lejano'], every: [25, 60], vol: 0.14 }, { sounds: ['impresora_1', 'impresora_2'], every: [20, 45], vol: 0.22 },
      { sounds: PAPER, every: [6, 14], vol: 0.22 }, { sounds: ['rpg_bookFlip1'], every: [25, 50], vol: 0.16 },
      { sounds: ['cafetera'], every: [60, 120], vol: 0.16 }, typing([5, 12], 0.12), { sounds: MOUSE, every: [6, 14], vol: 0.12, burst: [1, 2, 0.15, 0.3] },
    ],
  },
  // almacén en marcha: nave, cinta transportadora, carretillas y transpalés, palés, escáner y la radio del almacén
  logistica: {
    echo: 0.15, layers: [{ file: 'amb_almacen', vol: 0.3 }, { file: 'amb_cinta', vol: 0.14, cycle: [20, 45, 8, 20] }, { synth: 'fluorescente', vol: 0.006 }],
    details: [
      { sounds: ['carretilla'], every: [16, 35], vol: 0.26 }, { sounds: ['transpale'], every: [18, 40], vol: 0.22 },
      { sounds: ['palet_1', 'palet_2'], every: [10, 24], vol: 0.22, echo: 0.25 }, { sounds: ['caja_1', 'caja_2', 'caja_3'], every: [6, 14], vol: 0.2, var: 0.06 },
      { sounds: ['escaner'], every: [4, 10], vol: 0.16, burst: [1, 3, 0.6, 1.4] }, { synth: 'marchaAtras', every: [30, 60], vol: 0.025 },
      { sounds: ['taladro'], every: [30, 70], vol: 0.16 }, { sounds: ['megafonia_1', 'megafonia_2', 'megafonia_3'], every: [60, 120], vol: 0.12, heightStep: 500, underStep: 2400, echo: 0.5 },
    ],
  },
  // sala de servidores: ventiladores densos, discos que buscan, relés y teclados mecánicos
  git: {
    layers: [{ file: 'amb_servidores_densos', vol: 0.24 }, { file: 'amb_servidores', vol: 0.14 }],
    details: [
      { sounds: ['disco_duro_1', 'disco_duro_2'], every: [4, 10], vol: 0.16 }, typing([3, 7], 0.15), { synth: 'reles', every: [5, 11], vol: 0.05 },
      { sounds: MOUSE, every: [5, 12], vol: 0.12, burst: [1, 3, 0.15, 0.4] }, { synth: 'pitidosMando', every: [30, 60], vol: 0.018 },
    ],
  },
  // puente de mando: actividad de sala de control, megafonía ininteligible, radio, la maqueta holográfica que respira,
  // pitidos de mando, relés y alguna alarma suave a lo lejos
  puente: {
    echo: 0.12,
    layers: [
      { file: 'amb_centro_mando', vol: 0.26 }, { file: 'amb_sala_control', vol: 0.12 }, { synth: 'holograma', vol: 0.018 },
      { file: 'bucle_motor', vol: 0.05, rate: 0.7, underStep: 600 },
    ],
    details: [
      { sounds: ['megafonia_1', 'megafonia_2', 'megafonia_3'], every: [22, 45], vol: 0.18, heightStep: 550, underStep: 2300, echo: 0.6 },
      { sounds: ['radio_voz_1', 'radio_voz_2', 'radio_voz_3'], every: [10, 22], vol: 0.13, heightStep: 450, underStep: 2300, echo: 0.2 },
      { synth: 'pitidosMando', every: [3, 8], vol: 0.03 }, { synth: 'reles', every: [5, 11], vol: 0.04 }, { synth: 'squelch', every: [20, 40], vol: 0.025 },
      { sounds: ['alarma_suave'], every: [70, 140], vol: 0.07, underStep: 1800, echo: 0.5 }, typing([5, 12], 0.12),
      { sounds: ['sf_computerNoise_000'], segment: [1.5, 3], every: [18, 36], vol: 0.09 },
    ],
  },
  // la cámara acorazada: bordón blindado, relojería de los mecanismos, diales, cerrojos y las barreras láser
  camara: {
    echo: 0.25, layers: [{ synth: 'bordon', vol: 0.035 }, { file: 'amb_roca', vol: 0.09, underStep: 900 }, { file: 'amb_sala_control', vol: 0.14, underStep: 1200 }],
    details: [
      { sounds: ['relojeria'], every: [6, 14], vol: 0.18 }, { synth: 'ticAcorazada', every: [7, 16], vol: 0.05 },
      { sounds: ['dial_caja'], every: [18, 40], vol: 0.2 }, { sounds: ['cerrojo_1', 'cerrojo_2'], every: [22, 50], vol: 0.24, echo: 0.3 },
      { sounds: ['laser_alarma'], every: [60, 120], vol: 0.05, underStep: 1800, echo: 0.5 }, { sounds: ['alarma_suave'], every: [90, 180], vol: 0.05, underStep: 900, echo: 0.6 },
      { sounds: ['rpg_metalLatch'], every: [20, 40], vol: 0.12 }, { drop: true, every: [15, 35], vol: 0.05 }, { synth: 'tintineoMetal', every: [20, 40], vol: 0.02 },
    ],
  },
  // la puerta del refugio: el viento de la superficie entrando, la compuerta enorme que gime, hidráulica y vapor
  puerta: {
    echo: 0.2, layers: [{ file: 'amb_viento', vol: 0.3, underStep: 2200 }, { file: 'amb_generador', vol: 0.09 }, { file: 'amb_hueco', vol: 0.1 }],
    details: [
      { sounds: ['puerta_enorme'], every: [25, 55], vol: 0.22, echo: 0.4 }, { sounds: ['hidraulica_1', 'hidraulica_2'], every: [14, 32], vol: 0.24 },
      { sounds: ['vapor_1', 'vapor_2'], every: [12, 28], vol: 0.16 }, { sounds: ['clank'], every: [20, 45], vol: 0.12 },
      { synth: 'racha', every: [6, 14], vol: 0.06, opener: 0.9 }, { sounds: ['crujido_1', 'crujido_2'], every: [25, 50], vol: 0.14 },
      { sounds: ['megafonia_1', 'megafonia_2', 'megafonia_3'], every: [70, 140], vol: 0.1, heightStep: 550, underStep: 2200, echo: 0.6 },
    ],
  },
  // a pie de calle: viento del páramo, rachas y algún cuervo
  calle: {
    layers: [{ file: 'amb_viento', vol: 0.42 }],
    details: [{ synth: 'racha', every: [6, 15], vol: 0.07, opener: 0.9 }, { sounds: ['cuervo'], every: [25, 70], vol: 0.1, opener: 0.9 }, { sounds: ['crujido_1', 'crujido_2'], every: [30, 70], vol: 0.08 }],
  },
  // el hueco del ascensor: corriente de aire, cables que crujen, goteras con eco
  hueco: {
    echo: 0.35, layers: [{ file: 'amb_hueco', vol: 0.35 }],
    details: [
      { sounds: ['crujido_1', 'crujido_2'], every: [10, 25], vol: 0.18, echo: 0.4 }, { drop: true, every: [6, 15], vol: 0.07 },
      { synth: 'tintineoMetal', every: [12, 30], vol: 0.02 }, { sounds: ['clank'], every: [30, 60], vol: 0.07, echo: 0.5, underStep: 2500 },
    ],
  },
  // cultivos: agua corriendo, la bomba, aspersores y goteo
  hidroponia: {
    layers: [{ file: 'amb_agua', vol: 0.22 }, { synth: 'bomba', vol: 0.02 }],
    details: [{ sounds: ['aspersor'], every: [14, 32], vol: 0.2 }, { drop: true, every: [3, 9], vol: 0.07 }, { sounds: ['amb_burbujas'], segment: [2, 4], every: [25, 50], vol: 0.12 }],
  },
  // galería de tiro: disparos en las calles de tiro, casquillos por el suelo, el carril de las dianas y la nave con eco
  galeria: {
    echo: 0.45, layers: [{ synth: 'fluorescente', vol: 0.012 }, { file: 'amb_roca', vol: 0.07, underStep: 1200 }, { file: 'amb_almacen', vol: 0.12, underStep: 1500 }],
    details: [
      { sounds: ['disparo_lejano_1', 'disparo_lejano_2', 'disparo_lejano_3'], every: [3, 9], vol: 0.2, var: 0.06, echo: 0.35, burst: [1, 3, 0.35, 0.9] },
      { sounds: ['casquillos'], every: [6, 14], vol: 0.16 }, { sounds: ['carril_dianas'], every: [14, 30], vol: 0.2 },
      { synth: 'parpadeo', every: [25, 50], vol: 0.03 }, { synth: 'tintineoMetal', every: [10, 22], vol: 0.025, echo: 0.6 },
      { sounds: ['golpe_metal'], every: [20, 45], vol: 0.08, echo: 0.6, underStep: 2000 },
    ],
  },
  // la discoteca: con la música de Spotify sonando, el bus de ambiente ya baja (sonido.atenuarAmbiente)
  discoteca: {
    layers: [{ synth: 'fluorescente', vol: 0.008 }, { file: 'amb_generador', vol: 0.05, rate: 0.7 }, { file: 'amb_sala_control', vol: 0.14, underStep: 1500 }],
    details: [{ sounds: ['copas'], every: [18, 40], vol: 0.18 }, { sounds: ['copas'], every: [30, 60], vol: 0.12, rate: 1.25 }],
  },
  // Chapa y Pintura: el compresor que arranca y para, aerógrafo, tijeras y maquinilla
  chapa: {
    layers: [{ file: 'amb_compresor', vol: 0.2, cycle: [15, 35, 25, 60] }],
    details: [
      { sounds: ['aerografo'], every: [12, 28], vol: 0.2 }, { sounds: ['tijeras_1', 'tijeras_2'], every: [7, 16], vol: 0.28, burst: [2, 4, 0.25, 0.5] },
      { sounds: ['maquinilla'], every: [35, 70], vol: 0.18 }, { sounds: ['vapor_1', 'vapor_2'], every: [30, 60], vol: 0.12 },
      { sounds: ['rpg_metalLatch'], every: [40, 80], vol: 0.12 },
    ],
  },
  // ---- salas de repo, por lo que hay montado dentro
  web: {
    layers: [{ synth: 'fluorescente', vol: 0.006 }, { file: 'bucle_ordenador', vol: 0.08, underStep: 2500 }],
    details: [typing([5, 12], 0.12), { sounds: MOUSE, every: [4, 10], vol: 0.15, burst: [1, 3, 0.15, 0.4] }, { sounds: ['cafetera'], every: [60, 120], vol: 0.15 }, { sounds: PAPER, every: [30, 60], vol: 0.12 }, { sounds: ['dig_twoTone1'], every: [50, 90], vol: 0.05 }],
  },
  landing: {
    layers: [{ synth: 'fluorescente', vol: 0.01 }, { file: 'bucle_ordenador', vol: 0.06, underStep: 2200 }],
    details: [{ sounds: MOUSE, every: [6, 14], vol: 0.12, burst: [1, 2, 0.2, 0.4] }, typing([10, 20], 0.1), { sounds: PAPER, every: [30, 60], vol: 0.1 }, { synth: 'parpadeo', every: [40, 80], vol: 0.02 }],
  },
  marca: {
    timer: 0.07, layers: [{ file: 'amb_ventilacion', vol: 0.05, underStep: 1500 }],
    details: [{ sounds: PAPER, every: [6, 14], vol: 0.2 }, { sounds: ['impresora_1', 'impresora_2'], every: [40, 80], vol: 0.18 }, { sounds: ['rpg_bookFlip1'], every: [20, 40], vol: 0.14 }, { sounds: MOUSE, every: [10, 20], vol: 0.1 }],
  },
  video: {
    layers: [{ file: 'amb_proyector', vol: 0.22 }],
    details: [{ sounds: MOUSE, every: [8, 16], vol: 0.1 }, typing([15, 30], 0.08), { synth: 'reles', every: [20, 40], vol: 0.03 }],
  },
  banco: {
    layers: [{ file: 'amb_generador', vol: 0.07, rate: 0.9 }, { synth: 'fluorescente', vol: 0.006 }],
    details: [
      { sounds: ['golpe_metal', 'imp_impactMetal_light_000'], every: [12, 25], vol: 0.12, var: 0.08 }, { sounds: ['clank'], every: [20, 40], vol: 0.12 },
      { sounds: ['engranajes'], every: [25, 50], vol: 0.15 }, { sounds: ['vapor_1', 'vapor_2'], every: [30, 60], vol: 0.1 }, typing([10, 20], 0.08),
    ],
  },
  fundicion: {
    layers: [{ file: 'amb_fuego', vol: 0.28 }],
    details: [
      { sounds: ['yunque_1', 'yunque_2'], every: [6, 14], vol: 0.2, echo: 0.3, burst: [2, 4, 0.45, 0.7] }, { sounds: ['vapor_1', 'vapor_2'], every: [20, 40], vol: 0.15 },
      { sounds: ['golpe_metal'], every: [25, 40], vol: 0.1 }, { sounds: ['sf_explosionCrunch_000'], every: [30, 60], vol: 0.05, rate: 1.8 },
    ],
  },
  laboratorio: {
    layers: [{ file: 'amb_burbujas', vol: 0.22 }, { synth: 'fluorescente', vol: 0.006 }],
    details: [{ synth: 'pitidosMando', every: [10, 25], vol: 0.02 }, { sounds: ['copas'], every: [20, 40], vol: 0.08, rate: 1.3 }, { sounds: ['vapor_1', 'vapor_2'], every: [30, 60], vol: 0.08 }, typing([10, 20], 0.08)],
  },
  estudio: {
    layers: [{ synth: 'fluorescente', vol: 0.006 }, { file: 'bucle_ordenador', vol: 0.07, underStep: 2500 }],
    details: [typing([5, 12], 0.12), { sounds: MOUSE, every: [5, 12], vol: 0.14, burst: [1, 3, 0.15, 0.4] }, { sounds: ['cafetera'], every: [60, 120], vol: 0.15 }, { sounds: PAPER, every: [40, 80], vol: 0.1 }],
  },
  archivo: {
    timer: 0.07, layers: [{ file: 'amb_ventilacion', vol: 0.05, underStep: 1500 }],
    details: [{ sounds: PAPER, every: [6, 14], vol: 0.2 }, { sounds: ['rpg_bookFlip1'], every: [15, 30], vol: 0.15 }, { sounds: ['rpg_bookOpen'], every: [30, 60], vol: 0.12 }, { sounds: ['rpg_metalLatch'], every: [25, 50], vol: 0.1 }],
  },
};

// ------------------------------------------------------------------------------------------------ mezclador
export interface Listen { weight: number; pan: number; underStep: number }

const random = (a: number, b: number) => a + Math.random() * (b - a);
const SILENCE = 0.003;

class Active {
  input: GainNode; private filter: BiquadFilterNode; private panner: StereoPannerNode; private level: GainNode;
  private layers: { alive?: LiveLayer; src?: AudioBufferSourceNode; g: GainNode; def: LayerDef; on: boolean; changed: number }[] = [];
  private next: number[];
  private timer = 0; private tock = false;
  weight = 0; quiet = 0;

  constructor(private ctx: AudioContext, readonly id: string, readonly profile: Profile) {
    this.input = ctx.createGain();
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 20000; this.filter.Q.value = 0.5;
    this.panner = ctx.createStereoPanner();
    this.level = ctx.createGain(); this.level.gain.value = 0;
    this.input.connect(this.filter); this.filter.connect(this.panner); this.panner.connect(this.level); this.level.connect(sound.output('ambiente'));
    if (profile.echo) { const e = ctx.createGain(); e.gain.value = profile.echo; this.level.connect(e); e.connect(sound.echo); }
    const now = ctx.currentTime;
    // los primeros detalles no llegan todos a la vez al entrar
    this.next = profile.details.map(d => now + random(0.25, 1) * d.every[0]);
    for (const def of profile.layers) this.mountLayer(def);
  }

  private mountLayer(def: LayerDef) {
    const ctx = this.ctx, g = ctx.createGain();
    const on = !def.cycle || Math.random() < 0.5;
    g.gain.value = 0; g.gain.setTargetAtTime(on ? def.vol : 0, ctx.currentTime, 0.4);
    let queue: AudioNode = g;
    if (def.underStep) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = def.underStep; queue.connect(f); queue = f; }
    if (def.heightStep) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = def.heightStep; queue.connect(f); queue = f; }
    queue.connect(this.input);
    const c: (typeof this.layers)[number] = { g, def, on, changed: ctx.currentTime + (def.cycle ? random(def.cycle[0], def.cycle[1]) : 0) };
    this.layers.push(c);
    if (def.synth) c.alive = SYNTHETIC_LAYERS[def.synth](ctx, g, 1);
    else if (def.file) void sound.buffer(def.file).then(buf => {
      if (!buf || this.dead) return;
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = def.rate ?? 1;
      src.connect(g); src.start(0, Math.random() * buf.duration); c.src = src;
    });
  }

  dead = false;
  place(e: Listen) {
    const t = this.ctx.currentTime;
    this.weight = e.weight;
    this.level.gain.setTargetAtTime(e.weight, t, 0.7);   // fundido de ~2 s al cambiar de sala
    this.filter.frequency.setTargetAtTime(e.underStep, t, 0.5);
    this.panner.pan.setTargetAtTime(e.pan, t, 0.5);
  }

  update() {
    const ctx = this.ctx, t = ctx.currentTime;
    // capas que se encienden y se apagan (el compresor)
    for (const c of this.layers) if (c.def.cycle && t > c.changed) {
      const [a, b, x, y] = c.def.cycle; c.on = !c.on;
      c.changed = t + (c.on ? random(a, b) : random(x, y));
      c.g.gain.setTargetAtTime(c.on ? c.def.vol : 0, t, c.on ? 0.6 : 0.9);
    }
    // reloj de pared: tic y tac cada segundo, programados con antelación en el reloj de audio
    if (this.profile.timer && this.weight > 0.05) {
      if (this.timer < t) this.timer = Math.ceil(t) + 0.02;
      while (this.timer < t + 0.2) {
        void sound.play(this.tock ? 'reloj_tac' : 'reloj_tic', { target: this.input, vol: this.profile.timer, var: 0.01, pan: 0.35, delay: this.timer - t });
        this.tock = !this.tock; this.timer += 1;
      }
    }
    // detalles: solo si la sala se oye algo (las de al lado, la mitad de a menudo)
    if (this.weight < 0.12) return;
    this.profile.details.forEach((d, k) => {
      if (t < this.next[k]) return;
      this.next[k] = t + random(d.every[0], d.every[1]) * (this.weight < 0.5 ? 1.8 : 1);
      const times = d.burst ? d.burst[0] + Math.floor(Math.random() * (d.burst[1] - d.burst[0] + 1)) : 1;
      const pan = random(-1, 1) * (d.opener ?? 0.6);
      let delay = 0;
      for (let i = 0; i < times; i++) {
        this.fire(d, pan, delay);
        if (d.burst) delay += random(d.burst[2], d.burst[3]);
      }
    });
  }

  private fire(d: DetailDef, pan: number, delay: number) {
    const ctx = this.ctx;
    if (d.sounds) { void sound.play(d.sounds, { target: this.input, vol: d.vol, var: d.var ?? 0.04, rate: d.rate, pan, echo: d.echo, underStep: d.underStep, heightStep: d.heightStep, delay, dur: d.segment ? random(d.segment[0], d.segment[1]) : undefined }); return; }
    if (d.drop) { sound.drop(pan, this.input, d.vol); return; }
    if (d.keys) {
      // alguien tecleando una frase al otro lado de la sala
      let r = delay; const n = 4 + Math.floor(Math.random() * 14);
      for (let i = 0; i < n; i++) { press(Math.random() < 0.15 ? ' ' : 'x', { bus: 'ambiente', target: this.input, vol: d.vol * random(0.6, 1.1), pan, underStep: d.underStep, delay: r }); r += random(0.07, 0.19); }
      return;
    }
    if (d.synth) {
      const p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(this.input);
      let target: AudioNode = p;
      if (d.echo) { const e = ctx.createGain(); e.gain.value = d.echo; p.connect(e); e.connect(sound.echo); }
      SYNTHETIC_DETAILS[d.synth](ctx, target, d.vol);
      setTimeout(() => p.disconnect(), 8000);
    }
  }

  dismount() {
    this.dead = true;
    for (const c of this.layers) { c.alive?.stop(); try { c.src?.stop(); } catch {} }
    this.level.disconnect();
  }
}

const active = new Map<string, Active>();
const inUse = (file: string) => [...active.values()].some(a => a.profile.layers.some(c => c.file === file));

/**
 * Cuánto se oye cada perfil ahora (los que no aparecen, se callan). Los perfiles se montan al empezar a oírse y se
 * desmontan tras unos segundos callados; sus bucles largos se olvidan al rato para no ocupar memoria.
 */
export function mix(weights: Map<string, Listen>) {
  const ctx = sound.ctx; if (!ctx) return;
  for (const [id, e] of weights) {
    if (e.weight < SILENCE || !PROFILES[id]) continue;
    let a = active.get(id);
    if (!a) { a = new Active(ctx, id, PROFILES[id]); active.set(id, a); }
    a.place(e); a.quiet = 0;
  }
  const t = ctx.currentTime;
  for (const [id, a] of active) {
    if (!weights.has(id) || weights.get(id)!.weight < SILENCE) {
      if (a.weight > 0) a.place({ weight: 0, pan: 0, underStep: 800 });
      if (!a.quiet) a.quiet = t;
      if (t - a.quiet > 6) {
        a.dismount(); active.delete(id);
        const long = a.profile.layers.map(c => c.file).filter((x): x is string => !!x);
        setTimeout(() => { for (const x of long) if (!inUse(x)) sound.forget(x); }, 90_000);
      }
    }
    a.update();
  }
}

/** Para QA: qué perfiles suenan y cuánto */
export function activeProfiles() { return [...active.values()].map(a => ({ id: a.id, weight: +a.weight.toFixed(3) })); }
