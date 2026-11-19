// Motor de audio del refugio: buses (ambiente, efectos, interfaz, voces, tecleo), bucles, disparos con variación,
// eco compartido y síntesis. Todo CC0 (ver LICENSES/AUDIO.md). El contexto se crea al primer gesto del usuario
// (política de autoplay). El ambiente por salas vive en ambience.ts, el murmullo en voices.ts, el teclado en keyboard.ts
// y lo que se oye en el mundo (quién habla, quién teclea y dónde) en world.ts.

export type Bus = 'ambiente' | 'musica' | 'sfx' | 'ui' | 'voces' | 'teclado';
export const BUSES: Bus[] = ['ambiente', 'musica', 'sfx', 'ui', 'voces', 'teclado'];

export interface SettingsAudio { master: number; ambiente: number; musica: number; sfx: number; ui: number; voces: number; teclado: number; silence: boolean }
const SETTINGS_DEF: SettingsAudio = { master: 0.8, ambiente: 0.7, musica: 0.6, sfx: 0.85, ui: 0.7, voces: 0.7, teclado: 0.6, silence: false };

export interface TouchOptions {
  bus?: Bus; vol?: number; var?: number; pan?: number; minInterval?: number; rate?: number; delay?: number;
  target?: AudioNode;     // en vez del bus (la cadena de una sala, de una voz…)
  underStep?: number;       // filtro de paso bajo (Hz): lo que se oye a través de una pared
  heightStep?: number;       // y de paso alto: altavoces pequeños, megafonía, radio
  echo?: number;            // envío al eco del refugio (0..1)
  since?: number; dur?: number;   // tramo de la muestra (s), con fundidos: para sacar un trozo de un bucle largo
}

class Sound {
  ctx: AudioContext | null = null;
  private buses = new Map<Bus, GainNode>();
  private master!: GainNode;
  echo!: GainNode;                     // entrada del eco compartido (reverberación del refugio)
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private last = new Map<string, number>();
  private rr = new Map<string, number>();
  settings: SettingsAudio;
  private loops = new Map<string, { src: AudioBufferSourceNode; g: GainNode }>();
  private pending: (() => void)[] = [];
  private onStart: (() => void)[] = [];

  constructor() {
    let a = SETTINGS_DEF;
    try { a = { ...SETTINGS_DEF, ...JSON.parse(localStorage.getItem('refugio.audio') || '{}') }; } catch {}
    this.settings = a;
    const start = () => { this.start(); removeEventListener('pointerdown', start); removeEventListener('keydown', start); };
    if (typeof addEventListener === 'function') { addEventListener('pointerdown', start); addEventListener('keydown', start); }   // (en las pruebas no hay ventana)
  }

  start() {
    if (this.ctx) return;
    const ctx = this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
    this.master = ctx.createGain(); this.master.connect(comp); comp.connect(ctx.destination);
    for (const b of BUSES) { const g = ctx.createGain(); g.connect(this.master); this.buses.set(b, g); }
    // eco del refugio: hormigón y chapa (respuesta sintética: ruido que decae, más oscuro al final)
    const conv = ctx.createConvolver(); conv.buffer = roomResponse(ctx, 1.7, 4.2);
    this.echo = ctx.createGain(); this.echo.gain.value = 0.55;
    const underEcho = ctx.createBiquadFilter(); underEcho.type = 'highpass'; underEcho.frequency.value = 160;
    this.echo.connect(underEcho); underEcho.connect(conv); conv.connect(this.master);
    this.applySettings();
    for (const f of this.pending.splice(0)) f();
    for (const f of this.onStart) f();
  }

  /** Llama a `f` cuando haya contexto de audio (ya, si lo hay) */
  whenReady(f: () => void) { if (this.ctx) f(); else this.onStart.push(f); }

  get active() { return !!this.ctx && this.ctx.state === 'running'; }
  /** Nodo de entrada de un bus (para cadenas propias: salas, voces…) */
  output(bus: Bus) { return this.buses.get(bus)!; }

  save(a: Partial<SettingsAudio>) {
    Object.assign(this.settings, a);
    try { localStorage.setItem('refugio.audio', JSON.stringify(this.settings)); } catch {}
    this.applySettings();
  }
  applySettings() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.silence ? 0 : this.settings.master, t, 0.05);
    for (const [b, g] of this.buses) g.gain.setTargetAtTime((this.settings as any)[b] * (b === 'ambiente' ? this.dimmed : 1), t, b === 'ambiente' ? 0.6 : 0.05);
  }
  // con música en la discoteca, el ambiente del refugio baja (no se apaga: sigue siendo un refugio)
  private dimmed = 1;
  dimAmbient(si: boolean) { const k = si ? 0.3 : 1; if (k === this.dimmed) return; this.dimmed = k; this.applySettings(); }
  get playingMusic() { return this.dimmed < 1; }

  /** Muestra decodificada (se pide una vez y se recuerda) */
  buffer(name: string) {
    let p = this.buffers.get(name);
    if (!p) {
      p = fetch(`/audio/${name}.ogg`).then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status)).then(ab => this.ctx!.decodeAudioData(ab)).catch(() => null);
      this.buffers.set(name, p);
    }
    return p;
  }
  /** Suelta una muestra larga que ya no suena (los bucles de las salas lejanas ocupan memoria decodificados) */
  forget(name: string) { this.buffers.delete(name); }

  /** Elige una muestra de la lista sin repetir la anterior */
  pick(list: string[]) {
    if (list.length < 2) return list[0];
    const key = list.join('|');
    const prev = this.rr.get(key) ?? -1; let i = Math.floor(Math.random() * (list.length - 1)); if (i >= prev) i++;
    this.rr.set(key, i); return list[i];
  }

  // Dispara un sonido. `nombre` puede ser una lista (turno sin repetir). vol en lineal, var = ±variación de tono.
  async play(name: string | string[], o: TouchOptions = {}) {
    if (!this.ctx) return;
    const list = Array.isArray(name) ? name : [name];
    const key = list.join('|');
    const now = performance.now();
    if (o.minInterval && now - (this.last.get(key) ?? 0) < o.minInterval) return;
    this.last.set(key, now);
    const buf = await this.buffer(this.pick(list));
    if (!buf || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (o.var ?? 0.03));
    const g = ctx.createGain(); g.gain.value = o.vol ?? 1;
    let node: AudioNode = g;
    src.connect(g);
    if (o.underStep && o.underStep < 18000) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.underStep; node.connect(f); node = f; }
    if (o.heightStep) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = o.heightStep; node.connect(f); node = f; }
    if (o.pan) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); node.connect(p); node = p; }
    node.connect(o.target ?? this.buses.get(o.bus ?? 'sfx')!);
    if (o.echo) { const e = ctx.createGain(); e.gain.value = o.echo; node.connect(e); e.connect(this.echo); }
    if (o.dur) {
      const since = o.since ?? Math.random() * Math.max(0, buf.duration - o.dur);
      const v = o.vol ?? 1, f = Math.min(0.25, o.dur / 4);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + f); g.gain.setValueAtTime(v, t + o.dur - f); g.gain.linearRampToValueAtTime(0, t + o.dur);
      src.start(t, since, o.dur + 0.05);
    } else src.start(t);
  }

  async loop(id: string, name: string, o: { bus?: Bus; vol?: number; rate?: number } = {}) {
    if (!this.ctx) { this.pending.push(() => this.loop(id, name, o)); return; }
    if (this.loops.has(id)) { this.loopVolume(id, o.vol ?? 1); return; }
    const buf = await this.buffer(name);
    if (!buf || !this.ctx || this.loops.has(id)) return;
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = o.rate ?? 1;
    const g = this.ctx.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(o.vol ?? 1, this.ctx.currentTime, 0.8);
    src.connect(g); g.connect(this.buses.get(o.bus ?? 'ambiente')!); src.start(0, Math.random() * buf.duration);
    this.loops.set(id, { src, g });
  }
  loopVolume(id: string, vol: number, timeout = 0.4) { const b = this.loops.get(id); if (b && this.ctx) b.g.gain.setTargetAtTime(vol, this.ctx.currentTime, timeout); }
  stopLoop(id: string) { const b = this.loops.get(id); if (b && this.ctx) { b.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3); setTimeout(() => b.src.stop(), 1500); this.loops.delete(id); } }

  // Lecho de todo el refugio, muy discreto: red eléctrica a 50 Hz y rumor de roca (ruido marrón filtrado). Lo que
  // caracteriza cada sitio lo pone ambience.ts
  buzz() {
    if (!this.ctx) { this.pending.push(() => this.buzz()); return; }
    const ctx = this.ctx; const output = ctx.createGain(); output.gain.value = 0.009; output.connect(this.buses.get('ambiente')!);
    for (const [f, a] of [[50, 1], [100, 0.5], [150, 0.18]] as const) { const o = ctx.createOscillator(); o.frequency.value = f; const g = ctx.createGain(); g.gain.value = a; o.connect(g); g.connect(output); o.start(); }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 0.003; lfo.connect(lg); lg.connect(output.gain); lfo.start();
    const noise = ctx.createBufferSource(); noise.buffer = noiseMarron(ctx, 6); noise.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170;
    const rg = ctx.createGain(); rg.gain.value = 0.07; noise.connect(lp); lp.connect(rg); rg.connect(this.buses.get('ambiente')!); noise.start();
  }

  // Gota procedural con eco (la usan las salas húmedas: cultivos, hueco del ascensor, cámara)
  drop(pan = 0, target?: AudioNode, vol = 0.09) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); const f0 = 700 + Math.random() * 700;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 2.2, t + 0.035);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.09);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    const echo = ctx.createGain(); echo.gain.value = 0.5;
    o.connect(g); g.connect(p); p.connect(target ?? this.buses.get('ambiente')!); g.connect(echo); echo.connect(this.echo);
    o.start(t); o.stop(t + 0.4);
  }

  // R4: disparo de feria (chasquido de ruido con cuerpo grave y cola de sala)
  shot(loud = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, n = Math.floor(ctx.sampleRate * 0.35);
    const b = ctx.createBuffer(1, n, ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 6);
    const src = ctx.createBufferSource(); src.buffer = b;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(5200, t); lp.frequency.exponentialRampToValueAtTime(600, t + 0.2);
    const g = ctx.createGain(); g.gain.value = 0.55 * loud;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.4 * loud, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    const echo = ctx.createGain(); echo.gain.value = 0.35;
    src.connect(lp); lp.connect(g); o.connect(og); og.connect(g); g.connect(this.buses.get('sfx')!); g.connect(echo); echo.connect(this.echo);
    src.start(t); o.start(t); o.stop(t + 0.2);
  }

  // R5: emisora de radio sintonizable: estática (muestra CC0) + portadora con voz/música simulada
  radio() {
    if (!this.ctx) return null;
    const ctx = this.ctx;
    const output = ctx.createGain(); output.gain.value = 0; output.connect(this.buses.get('sfx')!);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 330;
    const vib = ctx.createOscillator(); vib.frequency.value = 5.5; const vg = ctx.createGain(); vg.gain.value = 9; vib.connect(vg); vg.connect(o.frequency);
    const am = ctx.createOscillator(); am.frequency.value = 3.1; const ag = ctx.createGain(); ag.gain.value = 0.5; am.connect(ag);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.2;
    const tone = ctx.createGain(); tone.gain.value = 0.5; ag.connect(tone.gain);
    o.connect(bp); bp.connect(tone); tone.connect(output);
    o.start(); vib.start(); am.start();
    this.loop('radio-estatica', 'radio_estatica', { bus: 'sfx', vol: 0.3 });
    let melody = 0; const notes = [330, 392, 440, 392, 349, 330, 294, 330];
    const timer = setInterval(() => { o.frequency.setTargetAtTime(notes[melody++ % notes.length] * (0.98 + Math.random() * 0.04), ctx.currentTime, 0.02); }, 260);
    return {
      pin: (signal: number) => { output.gain.setTargetAtTime(0.28 * signal, ctx.currentTime, 0.05); this.loopVolume('radio-estatica', 0.34 * (1 - signal * 0.85) + 0.04, 0.05); },
      stop: () => { clearInterval(timer); output.gain.setTargetAtTime(0, ctx.currentTime, 0.05); setTimeout(() => { o.stop(); vib.stop(); am.stop(); output.disconnect(); }, 300); this.stopLoop('radio-estatica'); },
    };
  }
}

/** Ruido marrón (paseo aleatorio amortiguado), `seg` segundos, mono */
export function noiseMarron(ctx: BaseAudioContext, seg: number) {
  const n = Math.floor(ctx.sampleRate * seg), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0; for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  // junta sin clic: los últimos 50 ms se funden con el principio
  const f = Math.floor(ctx.sampleRate * 0.05); for (let i = 0; i < f; i++) { const k = i / f; d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k; }
  return b;
}
/** Ruido blanco, `seg` segundos, mono (lo comparten las voces y la síntesis) */
let white: AudioBuffer | null = null;
export function whiteNoise(ctx: BaseAudioContext) {
  if (white && white.sampleRate === ctx.sampleRate) return white;
  const n = ctx.sampleRate * 2; white = ctx.createBuffer(1, n, ctx.sampleRate); const d = white.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return white;
}
/** Respuesta al impulso de una sala: ruido estéreo decorrelado con caída exponencial (`caida`: más, más seca) y agudos
 *  que se apagan antes (hormigón y chapa). Para el eco común y para las salas con su propia acústica (discoteca…) */
export function roomResponse(ctx: BaseAudioContext, seg: number, fall = 4.2) {
  const n = Math.floor(ctx.sampleRate * seg), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c); let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate, k = Math.min(0.92, 0.25 + t * 0.9);   // cada vez más oscuro
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * Math.exp(-t * fall) * (i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1) * 2.2;
    }
  }
  return b;
}

export const sound = new Sound();

const KEYS = Array.from({ length: 12 }, (_, i) => `mec_tecla_${String(i + 1).padStart(2, '0')}`);

// Atajos con nombre para el resto del juego
export const SFX = {
  click: () => sound.play(['ui_click_001', 'ui_click_002', 'ui_click_003'], { bus: 'ui', vol: 0.55, minInterval: 40 }),
  hover: () => sound.play('ui_select_001', { bus: 'ui', vol: 0.18, minInterval: 60 }),
  tick: () => sound.play('ui_tick_002', { bus: 'ui', vol: 0.3, minInterval: 35 }),
  open: () => sound.play('ui_maximize_003', { bus: 'ui', vol: 0.5 }),
  close: () => sound.play('ui_minimize_003', { bus: 'ui', vol: 0.45 }),
  toggle: () => sound.play('ui_toggle_001', { bus: 'ui', vol: 0.5 }),
  lowNotice: () => sound.play('ui_bong_001', { bus: 'ui', vol: 0.4, minInterval: 3000 }),
  noticeMedia: () => sound.play('dig_twoTone1', { bus: 'ui', vol: 0.35, minInterval: 1500 }),
  highNotice: () => sound.play('dig_threeTone2', { bus: 'ui', vol: 0.4, minInterval: 1000 }),
  alarm: () => { sound.play('alarma_2', { bus: 'sfx', vol: 0.4 }); sound.play('alarma_2', { bus: 'sfx', vol: 0.4, delay: 0.75 }); },
  success: () => sound.play(['jin_jingles_STEEL00', 'jin_jingles_STEEL04', 'jin_jingles_STEEL10'], { bus: 'sfx', vol: 0.45 }),
  shortSuccess: () => sound.play('ui_confirmation_002', { bus: 'ui', vol: 0.5 }),
  error: () => sound.play('ui_error_006', { bus: 'sfx', vol: 0.55 }),
  notAllowed: () => sound.play('ui_error_004', { bus: 'ui', vol: 0.45, minInterval: 200 }),
  coins: () => sound.play(['rpg_handleCoins', 'rpg_handleCoins2'], { bus: 'sfx', vol: 0.55 }),
  // una tecla del teclado mecánico (para teclas concretas, con su sonido de espacio, intro o borrar: keyboard.ts)
  key: () => sound.play(KEYS, { bus: 'teclado', vol: 0.5, var: 0.04 }),
  step: (pan = 0, vol = 0.18) => sound.play(['imp_footstep_concrete_000', 'imp_footstep_concrete_001', 'imp_footstep_concrete_002', 'imp_footstep_concrete_003'], { bus: 'sfx', vol, var: 0.06, pan }),
  stepMetal: (pan = 0, vol = 0.2) => sound.play(['paso_metal_01', 'paso_metal_03', 'paso_metal_05', 'paso_metal_07', 'paso_metal_09', 'paso_metal_11'], { bus: 'sfx', vol, var: 0.06, pan }),
  vapor: (pan = 0) => sound.play(['vapor_1', 'vapor_2'], { bus: 'sfx', vol: 0.18, pan }),
  spark: (pan = 0) => sound.play('sf_explosionCrunch_000', { bus: 'sfx', vol: 0.12, rate: 1.8, pan }),
  console: (pan = 0) => sound.play('sf_computerNoise_000', { bus: 'sfx', vol: 0.08, pan, minInterval: 2500 }),
  roomGate: () => sound.play('sf_doorOpen_000', { bus: 'sfx', vol: 0.4 }),
  dig: () => sound.play(['imp_impactMining_000', 'imp_impactMining_001', 'imp_impactMining_002'], { bus: 'sfx', vol: 0.5, var: 0.08 }),
  elevatorDing: () => sound.play('ascensor_ding', { bus: 'sfx', vol: 0.4 }),
  gateElevator: () => sound.play('ascensor_puerta', { bus: 'sfx', vol: 0.35 }),
  clank: () => sound.play('clank', { bus: 'sfx', vol: 0.4 }),
  powerOff: () => sound.play('apagado', { bus: 'sfx', vol: 0.35 }),
  holoAppears: () => sound.play('dig_powerUp2', { bus: 'sfx', vol: 0.3 }),
  holoGlitch: () => sound.play('ui_glitch_001', { bus: 'sfx', vol: 0.4 }),
  shot: (f = 1) => sound.shot(f),
  white: () => sound.play(['golpe_metal', 'imp_impactPlate_light_000', 'imp_impactMetal_light_000'], { bus: 'sfx', vol: 0.5, var: 0.08 }),
  prize: () => sound.play('jin_jingles_HIT03', { bus: 'sfx', vol: 0.45 }),
  harvest: () => sound.play('pala', { bus: 'sfx', vol: 0.45 }),
};

// El lecho común a todo el refugio (muy bajo): el resto lo pone el ambiente de cada sala (ambience.ts, desde world.ts)
export function bootAmbient() {
  sound.loop('ventilacion', 'amb_ventilacion', { vol: 0.025 });
  sound.buzz();
}
