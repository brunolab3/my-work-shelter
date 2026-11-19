// Música propia de una sala: una lista de temas que se encadenan con fundido cruzado y que «suenan» siempre (un reloj
// lógico avanza aunque nadie esté cerca, así el compás que leen las luces y los que bailan no se corta); solo se
// reproducen de verdad cuando se oyen. Cada tema se baja entero una vez (blob) y lo toca un <audio> conectado al grafo
// (sin decodificarlo entero en memoria; con el blob se puede saltar a cualquier punto). La sala pone su acústica:
// paso bajo a través de la pared (desde fuera solo llega el bombo), reverberación propia y, si es hilo musical, el
// filtro de un altavoz de techo.
import { sound, roomResponse } from './sound';
import type { Listen } from './ambience';
import type { MusicPulse } from './music';

export interface Song { file: string; bpm: number; firstHit: number; duration: number; energy: number[] }
export interface Acoustics {
  vol: number;               // volumen dentro de la sala
  reverb: number;            // envío a la reverberación de la sala, dentro
  reverbOutside: number;       // y oída desde fuera (la pared deja pasar sobre todo la cola grave)
  room: [number, number];    // duración y caída de la respuesta de la sala
  wall: number;             // paso bajo (Hz) a través de la pared
  speaker?: boolean;         // hilo musical: altavoz de techo (paso banda y algo de nasal)
  radio?: boolean;           // transistor viejo: banda aún más estrecha
  bass?: number;           // realce de graves (dB) dentro: el bombo de un club se siente en el pecho
}

const CROSSING = 4;   // fundido entre temas (s)
const timer = () => performance.now() / 1000;

interface Track { el: HTMLAudioElement | null; url: string | null; g: GainNode | null; loading: boolean; used: number }

export class Turntable {
  private i = 0;                         // tema que suena (lógicamente)
  private origin = timer();              // instante (reloj de la página) en que el tema i estaba en su segundo 0
  private tracks: Track[];
  private mix: GainNode | null = null;
  private wall: BiquadFilterNode | null = null;
  private highlight: BiquadFilterNode | null = null;
  private panner: StereoPannerNode | null = null;
  private dry: GainNode | null = null;
  private wet: GainNode | null = null;
  private hearing = false;
  private quiet = 0;

  constructor(readonly songs: Song[], readonly acoustics: Acoustics) {
    this.tracks = songs.map(() => ({ el: null, url: null, g: null, loading: false, used: 0 }));
    // empieza en un punto al azar de la sesión: al llegar no siempre suena el mismo principio
    this.i = Math.floor(Math.random() * songs.length);
    this.origin = timer() - Math.random() * (songs[this.i].duration - CROSSING - 10);
  }

  private mount(ctx: AudioContext) {
    const a = this.acoustics;
    this.mix = ctx.createGain();
    let queue: AudioNode = this.mix;
    if (a.speaker || a.radio) {
      // altavoz de techo (o transistor): sin graves ni agudos, con su resonancia
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = a.radio ? 480 : 260; hp.Q.value = 0.8;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = a.radio ? 2900 : 5200; lp.Q.value = 0.9;
      const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = a.radio ? 1400 : 1700; pk.Q.value = 1.1; pk.gain.value = a.radio ? 6 : 3;
      queue.connect(hp); hp.connect(lp); lp.connect(pk); queue = pk;
    }
    this.highlight = ctx.createBiquadFilter(); this.highlight.type = 'lowshelf'; this.highlight.frequency.value = 110; this.highlight.gain.value = 0;
    this.wall = ctx.createBiquadFilter(); this.wall.type = 'lowpass'; this.wall.frequency.value = a.wall; this.wall.Q.value = 0.7;
    this.panner = ctx.createStereoPanner();
    queue.connect(this.highlight); this.highlight.connect(this.wall); this.wall.connect(this.panner);
    this.dry = ctx.createGain(); this.dry.gain.value = 0;
    this.wet = ctx.createGain(); this.wet.gain.value = 0;
    const conv = ctx.createConvolver(); conv.buffer = roomResponse(ctx, a.room[0], a.room[1]);
    this.panner.connect(this.dry); this.dry.connect(sound.output('musica'));
    this.panner.connect(this.wet); this.wet.connect(conv); conv.connect(sound.output('musica'));
  }

  // ---------------------------------------------------------------------------------------------- reloj lógico
  private advance(now = timer()) {
    let n = 0;
    while (now - this.origin >= this.songs[this.i].duration && n++ < 50) {
      this.origin += this.songs[this.i].duration - CROSSING;
      this.i = (this.i + 1) % this.songs.length;
    }
  }
  /** Temas que suenan ahora con su segundo y su peso (en el cruce, dos) */
  private active(now = timer()) {
    this.advance(now);
    const t = this.songs[this.i], o = now - this.origin;
    const out = [{ k: this.i, o, w: 1 }];
    if (o > t.duration - CROSSING && this.songs.length > 0) {
      const x = (o - (t.duration - CROSSING)) / CROSSING;
      out[0].w = Math.cos(x * Math.PI / 2);
      out.push({ k: (this.i + 1) % this.songs.length, o: o - (t.duration - CROSSING), w: Math.sin(x * Math.PI / 2) });
    }
    return out;
  }

  /** Compás del tema que suena, con el retardo de salida del audio (lo que se ve va con lo que se oye) */
  pulse(): MusicPulse {
    const ctx = sound.ctx;
    const lat = ctx ? (ctx.outputLatency || ctx.baseLatency || 0) : 0;
    const act = this.active(timer() - lat);
    const a = act.reduce((m, x) => (x.w > m.w ? x : m));
    const t = this.songs[a.k];
    const hits = Math.max(0, (a.o - t.firstHit) * t.bpm / 60);
    const e = t.energy.length ? t.energy[Math.min(t.energy.length - 1, Math.max(0, Math.floor(a.o / 4)))] : 0.7;
    return { playing: true, bpm: t.bpm, phase: hits % 1, beat: Math.floor(hits), energy: e * Math.min(1, a.o / 2) };
  }

  // ---------------------------------------------------------------------------------------------- carga
  private load(k: number) {
    const p = this.tracks[k], ctx = sound.ctx;
    if (p.el || p.loading || !ctx) return;
    p.loading = true;
    fetch(`/audio/${this.songs[k].file}.ogg`).then(r => (r.ok ? r.blob() : Promise.reject(r.status))).then(b => {
      p.loading = false;
      if (!this.mix) return;
      p.url = URL.createObjectURL(b);
      const el = new Audio(); el.src = p.url; el.preload = 'auto';
      const source = ctx.createMediaElementSource(el);
      p.g = ctx.createGain(); p.g.gain.value = 0; source.connect(p.g); p.g.connect(this.mix); p.el = el;
    }).catch(() => { p.loading = false; });
  }
  private drop(k: number) {
    const p = this.tracks[k];
    if (!p.el) return;
    p.el.pause(); p.el.removeAttribute('src'); p.el.load();
    if (p.url) URL.revokeObjectURL(p.url);
    p.g?.disconnect(); p.el = null; p.url = null; p.g = null;
  }

  // ---------------------------------------------------------------------------------------------- cada fotograma
  /** `e`: cuánto se oye la sala desde donde está el Supervisor; `bloqueado`: no suena (Spotify en la discoteca) */
  update(e: Listen, blocked = false) {
    const ctx = sound.ctx; if (!ctx) return;
    if (!this.mix) this.mount(ctx);
    const now = timer(), t = ctx.currentTime, a = this.acoustics;
    const wants = e.weight > 0.004 && !blocked;
    const inside = e.underStep > 10000;
    if (wants) { this.hearing = true; this.quiet = 0; } else if (this.hearing && !this.quiet) this.quiet = now;
    // volumen, pared, paneo y sala
    const vol = wants ? e.weight * a.vol : 0;
    this.dry!.gain.setTargetAtTime(vol, t, 0.5);
    this.wet!.gain.setTargetAtTime(vol * (inside ? a.reverb : a.reverbOutside), t, 0.5);
    this.wall!.frequency.setTargetAtTime(inside ? 20000 : a.wall, t, inside ? 0.35 : 0.6);
    this.highlight!.gain.setTargetAtTime(inside ? a.bass ?? 0 : 6, t, 0.5);
    this.panner!.pan.setTargetAtTime(e.pan, t, 0.5);
    // las pistas: las que tocan ahora, sincronizadas con el reloj lógico; el resto, paradas
    const act = wants || (this.quiet && now - this.quiet < 1.5) ? this.active(now) : [];
    const playing = new Set(act.map(x => x.k));
    for (const x of act) {
      const p = this.tracks[x.k]; this.load(x.k); p.used = now;
      if (!p.el || !p.g) continue;
      if (p.el.paused || Math.abs(p.el.currentTime - x.o) > 0.35) {
        try { p.el.currentTime = Math.max(0, x.o); } catch {}
        if (p.el.paused) void p.el.play().catch(() => {});
      }
      p.g.gain.setTargetAtTime(x.w, t, 0.15);
    }
    // el siguiente tema se baja con tiempo
    if (wants) { const o = now - this.origin, d = this.songs[this.i].duration; if (d - o < 40) this.load((this.i + 1) % this.songs.length); }
    this.tracks.forEach((p, k) => {
      if (playing.has(k) || !p.el) return;
      p.g?.gain.setTargetAtTime(0, t, 0.2);
      if (!p.el.paused && now - p.used > 1) p.el.pause();   // ya fundida
      if (now - p.used > 60) this.drop(k);      // un rato sin sonar: fuera de la memoria
    });
    if (!wants && this.quiet && now - this.quiet > 1.5) { for (const p of this.tracks) if (p.el && !p.el.paused) p.el.pause(); this.hearing = false; }
  }

  /** Para QA */
  state() { return { song: this.songs[this.i].file, second: +(timer() - this.origin).toFixed(2), touching: this.tracks.map((p, k) => p.el && !p.el.paused ? `${this.songs[k].file}@${p.el.currentTime.toFixed(1)}` : '').filter(Boolean) }; }
}
