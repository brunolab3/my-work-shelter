// Texturas de lienzo para la señalética y las pantallas del refugio (carteles, rótulos, terminales de fósforo).
import * as THREE from 'three';

export const SOURCES = {
  titulo: '"Refugio Titulo", "Big Shoulders Stencil Display", "Arial Narrow", sans-serif',
  rotulo: '"Refugio Rotulo", "Barlow Condensed", "Arial Narrow", sans-serif',
  mono: '"Refugio Mono", "IBM Plex Mono", Menlo, monospace',
};

export function lienzo(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return { c, g: c.getContext('2d')! };
}

export function textureOf(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Rótulos que se tienen que leer: el lienzo se ve siempre más pequeño que su tamaño (mipmaps) y el filtrado trilineal
// mezcla con el nivel inferior, más borroso; con un sesgo negativo se muestrea un nivel más fino (letras nítidas)
export function sharpCaption<M extends THREE.MeshStandardMaterial | THREE.MeshBasicMaterial>(m: M): M {
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'texture( map, vMapUv, -1.0 )'))
      .replace('#include <emissivemap_fragment>', THREE.ShaderChunk.emissivemap_fragment.replace('texture2D( emissiveMap, vEmissiveMapUv )', 'texture( emissiveMap, vEmissiveMapUv, -1.0 )'));
  };
  return m;
}

// Ruido de grano para que la pintura no quede plana (desgaste, polvo)
export function dirty(g: CanvasRenderingContext2D, w: number, h: number, fuerza = 0.12, semilla = 1) {
  let s = semilla * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < (w * h) / 60; i++) {
    const x = rnd() * w, y = rnd() * h, r = rnd() * 2.2;
    g.fillStyle = rnd() > 0.5 ? `rgba(0,0,0,${fuerza * rnd()})` : `rgba(255,240,210,${fuerza * 0.5 * rnd()})`;
    g.fillRect(x, y, r, r);
  }
  // churretes verticales
  for (let i = 0; i < w / 40; i++) {
    const x = rnd() * w, l = rnd() * h * 0.5;
    const gr = g.createLinearGradient(0, 0, 0, l);
    gr.addColorStop(0, `rgba(30,20,10,${fuerza * 0.9})`); gr.addColorStop(1, 'rgba(30,20,10,0)');
    g.fillStyle = gr; g.fillRect(x, 0, 1 + rnd() * 2, l);
  }
}

export function dangerStrip(w = 512, h = 64, a = '#d9a23a', b = '#221d18') {
  const { c, g } = lienzo(w, h);
  g.fillStyle = a; g.fillRect(0, 0, w, h);
  g.fillStyle = b;
  for (let x = -h; x < w + h; x += h) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h / 2, 0); g.lineTo(x + h, h); g.lineTo(x + h / 2, h); g.fill(); }
  dirty(g, w, h, 0.25, 3);
  const t = textureOf(c); t.wrapS = THREE.RepeatWrapping; return t;
}

// Rótulo pintado sobre placa metálica (nombre de sala, número)
export function roomCaption(nombre: string, sub: string, color: string, numero: string) {
  const W = 1024, H = 256;
  const { c, g } = lienzo(W, H);
  g.fillStyle = '#1c1a17'; g.fillRect(0, 0, W, H);
  g.fillStyle = color; g.fillRect(0, 0, 150, H);
  g.fillStyle = '#1c1a17'; g.font = `900 132px ${SOURCES.titulo}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(numero, 75, H / 2 + 8);
  g.textAlign = 'left'; g.fillStyle = '#efe4c8';
  let tam = 118; g.font = `800 ${tam}px ${SOURCES.titulo}`;
  while (g.measureText(nombre).width > W - 210 && tam > 40) { tam -= 4; g.font = `800 ${tam}px ${SOURCES.titulo}`; }
  g.fillText(nombre, 180, H * 0.43);
  g.font = `600 40px ${SOURCES.rotulo}`; g.fillStyle = '#b9ab8c';
  g.fillText(sub, 184, H * 0.8);
  // remaches
  g.fillStyle = '#6b655b';
  for (const [x, y] of [[166, 18], [W - 18, 18], [166, H - 18], [W - 18, H - 18]]) { g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); }
  dirty(g, W, H, 0.18, nombre.length);
  return textureOf(c);
}

// Cartel de propaganda del refugio (tipográfico, con desgaste)
export function cartel(lineas: string[], pie: string, fondo: string, tinta: string, simbolo: 'engranaje' | 'ojo' | 'rayo' | 'mano' = 'engranaje', semilla = 1) {
  const W = 512, H = 720;
  const { c, g } = lienzo(W, H);
  g.fillStyle = fondo; g.fillRect(0, 0, W, H);
  g.strokeStyle = tinta; g.lineWidth = 10; g.strokeRect(22, 22, W - 44, H - 44);
  // símbolo
  g.save(); g.translate(W / 2, 250); g.fillStyle = tinta; g.strokeStyle = tinta;
  if (simbolo === 'engranaje') {
    for (let i = 0; i < 12; i++) { g.rotate(Math.PI / 6); g.fillRect(-18, -150, 36, 50); }
    g.beginPath(); g.arc(0, 0, 112, 0, 7); g.fill(); g.fillStyle = fondo; g.beginPath(); g.arc(0, 0, 52, 0, 7); g.fill();
  } else if (simbolo === 'ojo') {
    g.beginPath(); g.ellipse(0, 0, 150, 80, 0, 0, 7); g.fill(); g.fillStyle = fondo; g.beginPath(); g.arc(0, 0, 55, 0, 7); g.fill(); g.fillStyle = tinta; g.beginPath(); g.arc(0, 0, 26, 0, 7); g.fill();
  } else if (simbolo === 'rayo') {
    g.beginPath(); g.moveTo(30, -150); g.lineTo(-70, 20); g.lineTo(0, 20); g.lineTo(-30, 150); g.lineTo(80, -30); g.lineTo(10, -30); g.closePath(); g.fill();
  } else {
    g.fillRect(-60, -40, 120, 150); for (let i = 0; i < 4; i++) g.fillRect(-60 + i * 31, -130, 26, 100); g.fillRect(60, -10, 50, 26);
  }
  g.restore();
  g.fillStyle = tinta; g.textAlign = 'center';
  let y = 455;
  for (const l of lineas) {
    let tam = 64; g.font = `900 ${tam}px ${SOURCES.titulo}`;
    while (g.measureText(l).width > W - 80 && tam > 30) { tam -= 3; g.font = `900 ${tam}px ${SOURCES.titulo}`; }
    g.fillText(l, W / 2, y); y += tam * 0.95;
  }
  let tp = 22; g.font = `600 ${tp}px ${SOURCES.rotulo}`; while (g.measureText(pie).width > W - 36 && tp > 13) { tp--; g.font = `600 ${tp}px ${SOURCES.rotulo}`; }
  g.fillText(pie, W / 2, H - 38);
  dirty(g, W, H, 0.3, semilla);
  // esquina despegada
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.moveTo(W, H - 90); g.lineTo(W - 90, H); g.lineTo(W, H); g.fill();
  return textureOf(c);
}

// Pantalla de fósforo animada (terminal): líneas que se van escribiendo
export class PhosphorScreen {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture;
  lineas: string[] = []; queue: string[] = []; color: string; titulo: string;
  private acum = 0; private cursor = 0; private parcial = '';
  activa = true; speed = 28; // caracteres por segundo
  private sucia = false; private drawingFrom = 0;
  constructor(w: number, h: number, color = '#7dffb0', titulo = '') {
    ({ c: this.c, g: this.g } = lienzo(w, h));
    this.color = color; this.titulo = titulo;
    this.tex = textureOf(this.c);
    this.draw();
  }
  escribir(texto: string | string[]) { this.queue.push(...([] as string[]).concat(texto)); }
  actualizar(dt: number, t: number) {
    this.acum += dt;
    let cambio = false;
    if (this.activa && (this.queue.length || this.parcial)) {
      const n = Math.floor(this.acum * this.speed);
      if (n > 0) {
        this.acum -= n / this.speed;
        for (let i = 0; i < n; i++) {
          if (!this.parcial && this.queue.length) { this.parcial = this.queue.shift()!; this.cursor = 0; this.lineas.push(''); }
          if (!this.parcial) break;
          this.cursor++;
          this.lineas[this.lineas.length - 1] = this.parcial.slice(0, this.cursor);
          if (this.cursor >= this.parcial.length) this.parcial = '';
        }
        cambio = true;
      }
    }
    this.sucia ||= cambio;
    this.drawingFrom += dt;
    if ((this.sucia && this.drawingFrom > 1 / 15) || Math.floor(t * 2) !== Math.floor((t - dt) * 2)) { this.draw(t); this.sucia = false; this.drawingFrom = 0; }
  }
  draw(t = 0) {
    const { g, c } = this; const W = c.width, H = c.height;
    g.fillStyle = '#04100a'; g.fillRect(0, 0, W, H);
    const lh = Math.round(H / 11);
    g.font = `500 ${Math.round(lh * 0.78)}px ${SOURCES.mono}`; g.textBaseline = 'top';
    g.shadowColor = this.color; g.shadowBlur = lh * 0.35; g.fillStyle = this.color;
    let y0 = lh * 0.4;
    if (this.titulo) { g.globalAlpha = 0.9; g.fillRect(0, 0, W, lh * 1.1); g.fillStyle = '#04100a'; g.shadowBlur = 0; g.fillText(this.titulo, lh * 0.4, lh * 0.18); g.fillStyle = this.color; g.shadowBlur = lh * 0.35; y0 = lh * 1.4; g.globalAlpha = 1; }
    const max = Math.floor((H - y0) / lh);
    const vis = this.lineas.slice(-max);
    const cabe = (l: string) => { const maxW = W - lh * 1.4; if (g.measureText(l).width <= maxW) return l; let t = l; while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); const esp = t.lastIndexOf(' '); return (esp > t.length * 0.6 ? t.slice(0, esp) : t).trimEnd() + '…'; };
    vis.forEach((l, i) => { g.globalAlpha = 0.55 + 0.45 * ((i + 1) / vis.length); g.fillText(cabe(l), lh * 0.4, y0 + i * lh); });
    g.globalAlpha = 1;
    if (Math.floor(t * 2) % 2 === 0) { const last = cabe(vis[vis.length - 1] || ''); g.fillRect(lh * 0.4 + g.measureText(last).width + 4, y0 + (vis.length - 1) * lh, lh * 0.45, lh * 0.8); }
    g.shadowBlur = 0;
    // líneas de barrido
    g.fillStyle = 'rgba(0,0,0,0.22)'; for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
    this.tex.needsUpdate = true;
  }
}

// Reloj de pared con la hora real (la del Mac). Se redibuja cada segundo.
export class Reloj {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; private ultimo = -1;
  constructor() { ({ c: this.c, g: this.g } = lienzo(256, 256)); this.tex = textureOf(this.c); this.draw(); }
  actualizar() { const s = Math.floor(Date.now() / 1000); if (s !== this.ultimo) { this.ultimo = s; this.draw(); } }
  draw() {
    const { g } = this; const W = 256, R = 120;
    const ahora = new Date();
    g.clearRect(0, 0, W, W);
    g.fillStyle = '#2b2925'; g.beginPath(); g.arc(128, 128, 126, 0, 7); g.fill();
    g.fillStyle = '#e6dcc3'; g.beginPath(); g.arc(128, 128, R - 6, 0, 7); g.fill();
    g.strokeStyle = '#2b2925'; g.lineCap = 'round';
    for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2; const l = i % 5 === 0 ? 14 : 6; g.lineWidth = i % 5 === 0 ? 5 : 2; g.beginPath(); g.moveTo(128 + Math.sin(a) * (R - 12), 128 - Math.cos(a) * (R - 12)); g.lineTo(128 + Math.sin(a) * (R - 12 - l), 128 - Math.cos(a) * (R - 12 - l)); g.stroke(); }
    g.fillStyle = '#7a2a1e'; g.font = `700 17px ${SOURCES.rotulo}`; g.textAlign = 'center'; g.fillText('WORK-SHELTER', 128, 92);
    const h = ahora.getHours() % 12 + ahora.getMinutes() / 60, m = ahora.getMinutes() + ahora.getSeconds() / 60, sg = ahora.getSeconds();
    const aguja = (ang: number, largo: number, ancho: number, color: string) => { g.strokeStyle = color; g.lineWidth = ancho; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.sin(ang) * largo, 128 - Math.cos(ang) * largo); g.stroke(); };
    aguja(h / 12 * Math.PI * 2, 58, 9, '#1c1a17'); aguja(m / 60 * Math.PI * 2, 86, 6, '#1c1a17'); aguja(sg / 60 * Math.PI * 2, 92, 2, '#b8402e');
    g.fillStyle = '#1c1a17'; g.beginPath(); g.arc(128, 128, 8, 0, 7); g.fill();
    dirty(g, W, W, 0.12, 8);
    this.tex.needsUpdate = true;
  }
}

// Manómetro: esfera con aguja (la presión sube con la actividad de la sala)
export class Gauge {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; valor = 0.3; private dib = -1;
  constructor() { ({ c: this.c, g: this.g } = lienzo(128, 128)); this.tex = textureOf(this.c); this.draw(); }
  actualizar(v: number) { this.valor = v; const q = Math.round(v * 60); if (q !== this.dib) { this.dib = q; this.draw(); } }
  draw() {
    const { g } = this;
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = '#8a6a3a'; g.beginPath(); g.arc(64, 64, 63, 0, 7); g.fill();
    g.fillStyle = '#ece3cc'; g.beginPath(); g.arc(64, 64, 54, 0, 7); g.fill();
    g.lineWidth = 6; g.strokeStyle = '#c0392b'; g.beginPath(); g.arc(64, 64, 44, Math.PI * 0.25 - Math.PI * 0.5 + Math.PI * 1.1, Math.PI * 0.25 + Math.PI); g.stroke();
    g.strokeStyle = '#222'; g.lineWidth = 2;
    for (let i = 0; i <= 10; i++) { const a = Math.PI * 0.75 + i / 10 * Math.PI * 1.5; g.beginPath(); g.moveTo(64 + Math.cos(a) * 48, 64 + Math.sin(a) * 48); g.lineTo(64 + Math.cos(a) * 40, 64 + Math.sin(a) * 40); g.stroke(); }
    const a = Math.PI * 0.75 + Math.min(1, Math.max(0, this.valor)) * Math.PI * 1.5;
    g.strokeStyle = '#111'; g.lineWidth = 4; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 42, 64 + Math.sin(a) * 42); g.stroke();
    g.fillStyle = '#111'; g.beginPath(); g.arc(64, 64, 6, 0, 7); g.fill();
    this.tex.needsUpdate = true;
  }
}

// Corcho con notas y PR pegados (la personalidad del habitante de la sala)
export function corcho(notas: { texto: string; color: string }[], semilla = 3) {
  const W = 512, H = 340; const { c, g } = lienzo(W, H);
  g.fillStyle = '#5a3d22'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#b98a55'; g.fillRect(14, 14, W - 28, H - 28);
  let s = semilla * 97; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${90 + rnd() * 60},${60 + rnd() * 40},${30 + rnd() * 20},0.5)`; g.fillRect(14 + rnd() * (W - 28), 14 + rnd() * (H - 28), 2, 2); }
  notas.forEach((n, i) => {
    const x = 40 + (i % 3) * 150 + rnd() * 20, y = 34 + Math.floor(i / 3) * 145 + rnd() * 16, w = 128, h = 110;
    g.save(); g.translate(x + w / 2, y + h / 2); g.rotate((rnd() - 0.5) * 0.18);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-w / 2 + 4, -h / 2 + 5, w, h);
    g.fillStyle = n.color; g.fillRect(-w / 2, -h / 2, w, h);
    g.fillStyle = '#c0392b'; g.beginPath(); g.arc(0, -h / 2 + 10, 6, 0, 7); g.fill();
    g.fillStyle = '#2a2520'; g.font = `600 17px ${SOURCES.mono}`; g.textAlign = 'center';
    const palabras = n.texto.split(' '); let linea = '', yy = -h / 2 + 38;
    for (const p of palabras) { const t = linea ? linea + ' ' + p : p; if (g.measureText(t).width > w - 16) { g.fillText(linea, 0, yy); yy += 21; linea = p; } else linea = t; }
    if (linea) g.fillText(linea, 0, yy);
    g.restore();
  });
  dirty(g, W, H, 0.12, semilla);
  return textureOf(c);
}

// Panel de estado de la sala (pizarra luminosa en la pared): barra de progreso del trabajo, estado y rama
export class PanelRoom {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture;
  titulo = 'HORNO DE BUILDS'; estado = 'EN REPOSO'; progreso = 0; lineas: string[] = []; color = '#7dffb0'; private clave = '';
  constructor() { ({ c: this.c, g: this.g } = lienzo(640, 256)); this.tex = textureOf(this.c); this.draw(0); }
  actualizar(t: number) { const k = this.titulo + this.estado + Math.round(this.progreso * 100) + this.lineas.join() + this.color + Math.floor(t * 2); if (k !== this.clave) { this.clave = k; this.draw(t); } }
  draw(t: number) {
    const { g } = this; const W = 640, H = 256;
    g.fillStyle = '#05100a'; g.fillRect(0, 0, W, H);
    g.shadowColor = this.color; g.shadowBlur = 10; g.fillStyle = this.color;
    g.font = `500 30px ${SOURCES.mono}`; g.textBaseline = 'top'; g.fillText(this.titulo, 24, 18);
    g.textAlign = 'right'; g.fillText(this.estado, W - 24, 18); g.textAlign = 'left';
    // barra segmentada
    const n = 24, bw = (W - 48) / n;
    for (let i = 0; i < n; i++) { g.globalAlpha = i / n < this.progreso ? 1 : 0.15; g.fillRect(24 + i * bw + 2, 72, bw - 4, 36); }
    g.globalAlpha = 1; g.font = `500 24px ${SOURCES.mono}`;
    this.lineas.slice(-3).forEach((l, i) => g.fillText(l, 24, 128 + i * 34));
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
    this.tex.needsUpdate = true;
  }
}

// Tierra de la cara de corte: masa oscura con estratos de grosor irregular (ruido de baja frecuencia) y vetas
export function strataTexture(semilla = 7) {
  const W = 1024, H = 1024; const { c, g } = lienzo(W, H);
  let s = semilla * 131; const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  // ruido de valor 1D periódico para ondular las fronteras entre estratos
  const nodos = Array.from({ length: 16 }, () => r());
  // periódico en el ancho de la textura (sin costuras al repetir en horizontal)
  const noise = (x: number, f: number, phase: number) => { const t = (x / W) * f; const i = Math.floor(t), k = t - i; const o = Math.floor(phase); const a = nodos[(o + (i % f)) % 16], b = nodos[(o + ((i + 1) % f)) % 16]; const u = k * k * (3 - 2 * k); return a + (b - a) * u; };
  const img = g.createImageData(W, H);
  const borders: { y: number; amp: number; f: number; phase: number; tone: number }[] = [];
  let y = 0;
  // estratos de grosor desigual; la ondulación de cada frontera nunca llega a la vecina (las vetas no se cruzan)
  let previous = 60;
  while (y < H + 100) { const thickness = 24 + Math.pow(r(), 1.4) * 170; borders.push({ y, amp: Math.min(8 + r() * 30, Math.min(thickness, previous) * 0.28), f: 2 + Math.floor(r() * 3), phase: r() * 16, tone: r() }); previous = thickness; y += thickness; }
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      let layer = 0, techo = 0, suelo = H;
      for (let k = 0; k < borders.length; k++) { const fr = borders[k]; const yy = fr.y + (noise(px, fr.f, fr.phase) - 0.5) * fr.amp * 2; if (py >= yy) { layer = k; techo = yy; } else { suelo = yy; break; } }
      const fr = borders[layer];
      const grano = (r() - 0.5) * 10;
      const mancha = noise(px, 4, fr.phase * 2 + layer) * 14;
      // relieve: cada estrato, más claro arriba (le da la luz en el canto) y más oscuro abajo (se mete bajo el siguiente)
      const inLayer = Math.min(1, Math.max(0, (py - techo) / Math.max(1, suelo - techo)));
      const relieve = 1.12 - 0.3 * inLayer;
      const base = (46 + fr.tone * 30 + mancha + grano) * relieve;
      const i = (py * W + px) * 4;
      img.data[i] = base + 8; img.data[i + 1] = base + 2; img.data[i + 2] = base - 6; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // vetas finas oscuras siguiendo algunas fronteras
  for (const fr of borders) {
    if (r() < 0.45) continue;
    g.strokeStyle = `rgba(12,9,7,${0.35 + r() * 0.35})`; g.lineWidth = 1 + r() * 2.5; g.beginPath();
    for (let px = 0; px <= W; px += 8) { const yy = fr.y + (noise(px, fr.f, fr.phase) - 0.5) * fr.amp * 2; if (px === 0) g.moveTo(px, yy); else g.lineTo(px, yy); }
    g.stroke();
  }
  // grietas: fisuras quebradas que bajan cruzando uno o dos estratos, oscuras con un filo de luz
  for (let k = 0; k < 22; k++) {
    let x = r() * W, yy = r() * H; const largo = 40 + r() * 140; const pts: [number, number][] = [[x, yy]];
    for (let d = 0; d < largo; d += 8 + r() * 10) { x += (r() - 0.5) * 14; yy += 8 + r() * 6; pts.push([x, yy]); }
    for (const [col, dx, ancho] of [['rgba(8,6,4,0.75)', 0, 2.4], ['rgba(255,214,170,0.14)', 1.6, 1]] as const) {
      g.strokeStyle = col; g.lineWidth = ancho; g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px + dx, py) : g.moveTo(px + dx, py))); g.stroke();
    }
  }
  // el canto de cada estrato, iluminado justo bajo la veta
  for (const fr of borders) {
    g.strokeStyle = `rgba(255,214,170,${0.1 + r() * 0.1})`; g.lineWidth = 2; g.beginPath();
    for (let px = 0; px <= W; px += 8) { const yy = fr.y + (noise(px, fr.f, fr.phase) - 0.5) * fr.amp * 2 + 3; if (px === 0) g.moveTo(px, yy); else g.lineTo(px, yy); }
    g.stroke();
  }
  const t = textureOf(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// Maqueta de página web para las pantallas del escaparate (la landing que se trabaja en la sala)
export function mockupLanding(titulo: string, variant = 0, w = 512, h = 320) {
  const { c, g } = lienzo(w, h);
  const backgrounds = ['#f3ead8', '#1d2230', '#f6d77a'];
  const inks = ['#1d1a16', '#f3ead8', '#2a1c08'];
  const acento = ['#e2602b', '#7ad1ff', '#2a1c08'][variant % 3];
  g.fillStyle = backgrounds[variant % 3]; g.fillRect(0, 0, w, h);
  g.fillStyle = inks[variant % 3];
  g.fillRect(24, 18, 70, 12); for (let i = 0; i < 4; i++) g.fillRect(w - 260 + i * 56, 20, 40, 8);
  g.font = `800 ${Math.round(h * 0.13)}px ${SOURCES.titulo}`; g.fillText(titulo, 24, h * 0.36);
  g.font = `500 ${Math.round(h * 0.05)}px ${SOURCES.mono}`; g.globalAlpha = 0.7; g.fillText('Aire limpio en todo el refugio.', 24, h * 0.47); g.globalAlpha = 1;
  g.fillStyle = acento; g.fillRect(24, h * 0.54, 150, 34); g.fillStyle = backgrounds[variant % 3]; g.font = `700 ${Math.round(h * 0.05)}px ${SOURCES.mono}`; g.fillText('Resérvalo', 36, h * 0.54 + 23);
  g.fillStyle = inks[variant % 3]; g.globalAlpha = 0.12;
  for (let i = 0; i < 3; i++) g.fillRect(24 + i * ((w - 48) / 3), h * 0.72, (w - 48) / 3 - 12, h * 0.22);
  g.globalAlpha = 1; g.fillStyle = acento; g.beginPath(); g.arc(w * 0.78, h * 0.42, h * 0.18, 0, 7); g.fill();
  return textureOf(c);
}

// Muro de muestras de marca: fichas de color con su código y variaciones del logotipo
export function markSamples(w = 1024, h = 512) {
  const { c, g } = lienzo(w, h);
  g.fillStyle = '#e9dfc9'; g.fillRect(0, 0, w, h);
  const colores = [['#b8402e', 'ÓXIDO 01'], ['#e8a23a', 'ÁMBAR 02'], ['#2f5d5a', 'VERDÍN 03'], ['#1f2a3a', 'NOCHE 04'], ['#d9c9a6', 'HUESO 05'], ['#7a3b6a', 'CIRUELA 06'], ['#4c7a3a', 'MUSGO 07'], ['#c7c1b6', 'NIEBLA 08']];
  colores.forEach(([col, nom], i) => {
    const x = 24 + (i % 4) * 150, y = 24 + Math.floor(i / 4) * 230;
    g.fillStyle = '#00000022'; g.fillRect(x + 6, y + 6, 130, 200);
    g.fillStyle = '#fbf6ea'; g.fillRect(x, y, 130, 200);
    g.fillStyle = col; g.fillRect(x + 8, y + 8, 114, 130);
    g.fillStyle = '#2a2520'; g.font = `700 18px ${SOURCES.rotulo}`; g.fillText(nom, x + 10, y + 162);
    g.font = `500 14px ${SOURCES.mono}`; g.fillText(col.toUpperCase(), x + 10, y + 184);
  });
  // logotipo y variantes
  const lx = 650;
  for (let i = 0; i < 3; i++) {
    const y = 40 + i * 150; const fondo = ['#1f2a3a', '#fbf6ea', '#b8402e'][i]; const tinta = ['#e8a23a', '#1f2a3a', '#fbf6ea'][i];
    g.fillStyle = fondo; g.fillRect(lx, y, 340, 120);
    g.fillStyle = tinta; g.beginPath(); g.arc(lx + 60, y + 60, 38, 0, 7); g.fill();
    g.fillStyle = fondo; g.beginPath(); g.arc(lx + 60, y + 60, 18, 0, 7); g.fill(); g.fillRect(lx + 56, y + 20, 8, 80);
    g.fillStyle = tinta; g.font = `900 46px ${SOURCES.titulo}`; g.fillText('REFUGIO', lx + 115, y + 58); g.font = `700 26px ${SOURCES.rotulo}`; g.fillText('GUÍA DE ESTILO', lx + 117, y + 90);
  }
  dirty(g, w, h, 0.12, 21);
  return textureOf(c);
}

// Fotogramas de vídeo y línea de tiempo para la sala de proyección
export function fotograma(n: number, w = 320, h = 200) {
  const { c, g } = lienzo(w, h);
  const skies = [['#ff9a5a', '#5a2a6a'], ['#7ad1ff', '#1d2a4a'], ['#ffd37a', '#c4502a'], ['#9dffb8', '#1a3a2a']];
  const [a, b] = skies[n % skies.length];
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w; x += 20) g.lineTo(x, h * 0.7 - Math.sin(x * 0.03 + n) * 20); g.lineTo(w, h); g.fill();
  g.fillStyle = '#fff'; g.font = `800 ${Math.round(h * 0.16)}px ${SOURCES.titulo}`; g.textAlign = 'center'; g.fillText(['ESCENA 1', 'PRODUCTO', 'CTA FINAL', 'CRÉDITOS'][n % 4], w / 2, h * 0.45);
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, h - 22, w, 22); g.fillStyle = '#ffb347'; g.font = `500 14px ${SOURCES.mono}`; g.textAlign = 'left'; g.fillText(`00:0${n % 10}:${String((n * 13) % 60).padStart(2, '0')} · 1920×1080 · 30 fps`, 8, h - 6);
  return textureOf(c);
}
export class TimeLine {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; head = 0;
  constructor() { ({ c: this.c, g: this.g } = lienzo(1024, 160)); this.tex = textureOf(this.c); this.draw(); }
  actualizar(dt: number, speed: number) { this.head = (this.head + dt * speed * 0.05) % 1; this.draw(); }
  draw() {
    const { g } = this; const W = 1024, H = 160;
    g.fillStyle = '#120e1a'; g.fillRect(0, 0, W, H);
    const pistas = [['#b8a0ff', [0, 0.18, 0.2, 0.45, 0.47, 0.8]], ['#ffb347', [0.05, 0.3, 0.35, 0.62]], ['#7ad1ff', [0.1, 0.95]]] as const;
    pistas.forEach(([col, segments], k) => { g.fillStyle = col; for (let i = 0; i < segments.length; i += 2) g.fillRect(20 + segments[i] * (W - 40), 18 + k * 42, (segments[i + 1] - segments[i]) * (W - 40) - 4, 32); });
    g.fillStyle = '#ff4a3a'; const x = 20 + this.head * (W - 40); g.fillRect(x - 2, 6, 4, H - 12);
    g.fillStyle = 'rgba(0,0,0,0.22)'; for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
    this.tex.needsUpdate = true;
  }
}

// Pantalla grande con lista (feed de notificaciones, tablero de issues…): filas con icono de fuente, autor y texto
export class ListScreen {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; private firma = '';
  constructor(public titulo: string, w = 768, h = 480, public color = '#9dffb8') { ({ c: this.c, g: this.g } = lienzo(w, h)); this.tex = textureOf(this.c); this.draw([]); }
  poner(filas: { etiqueta: string; texto: string; tinta?: string; urgente?: boolean }[]) {
    const f = JSON.stringify(filas.slice(0, 9)); if (f === this.firma) return; this.firma = f; this.draw(filas);
  }
  draw(filas: { etiqueta: string; texto: string; tinta?: string; urgente?: boolean }[]) {
    const { g, c } = this; const W = c.width, H = c.height;
    g.fillStyle = '#05100a'; g.fillRect(0, 0, W, H);
    g.fillStyle = this.color; g.globalAlpha = 0.9; g.fillRect(0, 0, W, 46); g.globalAlpha = 1;
    g.fillStyle = '#05100a'; g.font = `600 26px ${SOURCES.mono}`; g.textBaseline = 'middle'; g.fillText(this.titulo, 16, 24);
    const lh = (H - 60) / 9;
    filas.slice(0, 9).forEach((f, i) => {
      const y = 56 + i * lh;
      g.fillStyle = f.tinta ?? this.color; g.shadowColor = g.fillStyle; g.shadowBlur = 8;
      g.font = `600 22px ${SOURCES.mono}`; g.fillText(f.etiqueta.slice(0, 12), 16, y + lh / 2);
      g.fillStyle = f.urgente ? '#ffb000' : this.color; g.font = `400 22px ${SOURCES.mono}`;
      let t = f.texto; while (g.measureText(t).width > W - 200 && t.length > 4) t = t.slice(0, -2); if (t !== f.texto) t += '…';
      g.fillText(t, 180, y + lh / 2); g.shadowBlur = 0;
    });
    if (!filas.length) { g.fillStyle = this.color; g.globalAlpha = 0.5; g.font = `400 24px ${SOURCES.mono}`; g.fillText('sin novedades', 16, Math.min(90, (H + 46) / 2)); g.globalAlpha = 1; }
    g.fillStyle = 'rgba(0,0,0,0.22)'; for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
    this.tex.needsUpdate = true;
  }
}

// Pizarra de calendario de la semana (eventos reales o demo, por colores de fuente)
export class WeekWhiteboard {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; private firma = '';
  constructor() { ({ c: this.c, g: this.g } = lienzo(1024, 512)); this.tex = textureOf(this.c); this.draw([]); }
  poner(eventos: { titulo: string; inicio: number; fin: number; fuente: string; allElDay?: boolean }[]) {
    const f = JSON.stringify(eventos.map(e => [e.titulo, e.inicio])); if (f === this.firma) return; this.firma = f; this.draw(eventos);
  }
  draw(eventos: { titulo: string; inicio: number; fin: number; fuente: string; allElDay?: boolean }[]) {
    // hoy y los cuatro días siguientes; fichas apiladas por hora con la hora arriba y el título en dos líneas por palabras.
    // Abajo, la franja de ocupación de cada día: horas reunido de la jornada (8–20) y el hueco libre más largo.
    const { g } = this; const W = 1024, H = 512, N = 5;
    const Y0 = 62, Y1 = 352, CARD = 64;   // zona de fichas
    const B0 = 366, B1 = H - 14;           // franja de ocupación
    const hourY = (h: number) => Y0 + (Math.max(8, Math.min(20, h)) - 8) / 12 * (Y1 - Y0 - CARD);
    g.fillStyle = '#b8b09c'; g.fillRect(0, 0, W, H);
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const days = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
    const cw = (W - 40) / N;
    // la franja de abajo: un listón pintado sobre la pizarra con su rótulo
    g.fillStyle = '#9d937c'; g.fillRect(14, B0 - 6, W - 28, B1 - B0 + 8);
    g.strokeStyle = '#2a252066'; g.lineWidth = 2; g.beginPath(); g.moveTo(14, B0 - 6); g.lineTo(W - 14, B0 - 6); g.stroke();
    for (let i = 0; i < N; i++) {
      const x = 20 + i * cw; const fecha = new Date(hoy.getTime() + i * 86400000);
      g.fillStyle = i === 0 ? '#9a3424' : '#2a2520'; g.font = `800 32px ${SOURCES.titulo}`; g.textBaseline = 'top';
      g.fillText(i === 0 ? `HOY ${fecha.getDate()}` : `${days[fecha.getDay()]} ${fecha.getDate()}`, x + 10, 14);
      if (i) { g.strokeStyle = '#2a252055'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, 54); g.lineTo(x, H - 16); g.stroke(); }
      if (i === 0) { g.fillStyle = '#9a342416'; g.fillRect(x, 54, cw, H - 70); }
      if (i === 0) for (const hh of [9, 12, 15, 18]) { const yy = hourY(hh) + 32; g.strokeStyle = '#2a252022'; g.lineWidth = 1; g.beginPath(); g.moveTo(20, yy); g.lineTo(W - 20, yy); g.stroke(); g.fillStyle = '#2a252066'; g.font = `500 13px ${SOURCES.mono}`; g.fillText(String(hh), W - 40, yy - 14); }
      const ini = fecha.getTime(), dayEnd = ini + 86400000;
      const dayOf = eventos.filter(e => e.inicio < dayEnd && e.fin > ini).sort((p, q) => p.inicio - q.inicio);
      // cada ficha a la altura de su hora (de 8 a 20), sin pisar a la anterior; las que no caben, en «+N»
      let suelo = Y0; let caben = 0;
      for (const [k, e] of dayOf.entries()) {
        const hora = new Date(e.inicio).getHours() + new Date(e.inicio).getMinutes() / 60;
        const y = Math.max(suelo, e.allElDay || e.inicio < ini ? Y0 : hourY(hora));
        if (y + CARD > Y1 || (k === 3 && dayOf.length > 4)) break;
        suelo = y + CARD + 6; caben++;
        const col = e.fuente === 'google' ? '#3e5a3a' : '#3a5670';
        g.fillStyle = col; g.fillRect(x + 6, y, cw - 12, CARD);
        g.fillStyle = '#e9dfc8'; g.font = `700 17px ${SOURCES.mono}`;
        const d = new Date(e.inicio); g.fillText(e.allElDay ? 'todo el día' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, x + 12, y + 6);
        g.font = `500 16px ${SOURCES.mono}`;
        const lineas = splitByWords(g, e.titulo, cw - 26, 2);
        lineas.forEach((l, n) => g.fillText(l, x + 12, y + 26 + n * 18));
      }
      if (caben < dayOf.length) { g.fillStyle = '#2a2520aa'; g.font = `700 16px ${SOURCES.mono}`; g.fillText(`+ ${dayOf.length - caben} más`, x + 12, Math.min(Y1 - 18, suelo)); }
      if (!dayOf.length) { g.fillStyle = '#2a252066'; g.font = `500 16px ${SOURCES.mono}`; g.fillText('libre', x + 12, 66); }
      // ocupación del día: horas reunido entre las 8 y las 20 y el hueco libre más largo
      const J0 = ini + 8 * 3600000, J1 = ini + 20 * 3600000;
      const allDay = dayOf.some(e => e.allElDay || (e.inicio <= J0 && e.fin >= J1));
      const segments = dayOf.filter(e => !e.allElDay).map(e => [Math.max(J0, e.inicio), Math.min(J1, e.fin)] as [number, number]).filter(([p, q]) => q > p).sort((p, q) => p[0] - q[0]);
      const joined: [number, number][] = []; for (const t of segments) { const u = joined[joined.length - 1]; if (u && t[0] <= u[1]) u[1] = Math.max(u[1], t[1]); else joined.push([...t]); }
      const ocupado = allDay ? 12 : joined.reduce((s2, [p, q]) => s2 + (q - p), 0) / 3600000;
      let hueco: [number, number] = [J0, J0]; let prev = J0;
      for (const [p, q] of [...joined, [J1, J1] as [number, number]]) { if (p - prev > hueco[1] - hueco[0]) hueco = [prev, p]; prev = Math.max(prev, q); }
      const bx = x + 8, bw = cw - 16;
      g.fillStyle = '#2a2520'; g.font = `700 15px ${SOURCES.mono}`; g.fillText(i === 0 ? 'OCUPACIÓN' : ' ', bx, B0 + 4);
      // la barra: la jornada en 12 casillas con las horas reunido pintadas en su sitio
      const by = B0 + 26, bh = 26;
      g.fillStyle = '#d4cab2'; g.fillRect(bx, by, bw, bh);
      for (const [p, q] of allDay ? [[J0, J1] as [number, number]] : joined) { g.fillStyle = allDay ? '#6e3a4e' : '#3a5670'; g.fillRect(bx + bw * (p - J0) / (J1 - J0), by, Math.max(2, bw * (q - p) / (J1 - J0)), bh); }
      if (i === 0) { const ahora = Date.now(); if (ahora > J0 && ahora < J1) { const xx = bx + bw * (ahora - J0) / (J1 - J0); g.fillStyle = '#9a3424'; g.fillRect(xx - 1.5, by - 5, 3, bh + 10); } }
      g.strokeStyle = '#2a252088'; g.lineWidth = 1; for (let k = 1; k < 12; k++) { const xx = bx + bw * k / 12; g.beginPath(); g.moveTo(xx, by + bh - 6); g.lineTo(xx, by + bh); g.stroke(); }
      g.strokeStyle = '#2a2520'; g.lineWidth = 2; g.strokeRect(bx, by, bw, bh);
      const hm = (h: number) => { const m = Math.round(h * 60); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}` : `${m} min`; };
      const pct = Math.round(ocupado / 12 * 100);
      g.fillStyle = pct >= 60 ? '#9a3424' : '#2a2520'; g.font = `800 26px ${SOURCES.titulo}`; g.fillText(allDay ? 'CERRADO' : `${pct} %`, bx, by + bh + 8);
      g.fillStyle = '#2a2520cc'; g.font = `500 14px ${SOURCES.mono}`;
      if (!allDay) { g.textAlign = 'right'; g.fillText(ocupado ? hm(ocupado) + ' reunido' : 'sin reuniones', bx + bw, by + bh + 14); g.textAlign = 'left'; }
      const fmt = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
      g.fillStyle = '#2a2520'; g.font = `600 14px ${SOURCES.mono}`;
      g.fillText(allDay ? 'sin huecos' : `libre ${fmt(hueco[0])}–${fmt(hueco[1])}`, bx, by + bh + 42);
    }
    dirty(g, W, H, 0.1, 31);
    this.tex.needsUpdate = true;
  }
}

// corta un texto en líneas que caben, por palabras; la última lleva «…» si sobra
export function splitByWords(g: CanvasRenderingContext2D, texto: string, ancho: number, maxLines: number) {
  const palabras = texto.split(/\s+/); const lineas: string[] = []; let actual = '';
  for (const p of palabras) {
    const prueba = actual ? actual + ' ' + p : p;
    if (g.measureText(prueba).width <= ancho) { actual = prueba; continue; }
    if (actual) lineas.push(actual); actual = p;
    if (lineas.length === maxLines) break;
  }
  if (lineas.length < maxLines && actual) lineas.push(actual);
  const used = lineas.join(' ').split(/\s+/).length;
  if (used < palabras.length || g.measureText(lineas[lineas.length - 1] ?? '').width > ancho) {
    let u = lineas[lineas.length - 1] ?? '';
    while (u.length > 1 && g.measureText(u + '…').width > ancho) u = u.slice(0, -1);
    lineas[lineas.length - 1] = u.replace(/[\s,.;:]+$/, '') + '…';
  }
  return lineas.slice(0, maxLines);
}

// Tablero de Linear de la pantalla grande de Logística: columnas por estado con fichas (asignado y estimación)
// que llenan la altura aunque haya pocas, y abajo la gráfica del ciclo (lo que queda frente al ideal, día a día).
export interface BoardCard { id: string; titulo: string; prioridad?: number; sub?: string; asignado?: string; estimacion?: number; color?: string }   // color: el de su tarea (shared/tareas.ts)
export interface BoardCycle { nombre: string; progreso: number; inicio?: number; fin?: number; reach?: number[]; hecho?: number[] }
export class BoardKanban {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; private firma = '';
  // 1408×624: la misma proporción que la pantalla (5,3 × 2,35 m), sin estirar la letra
  constructor(private color = '#ff9a7a') { ({ c: this.c, g: this.g } = lienzo(1408, 624)); this.tex = textureOf(this.c); this.poner([], null); }
  poner(columnas: { nombre: string; fichas: BoardCard[] }[], ciclo: BoardCycle | null) {
    const f = JSON.stringify([columnas, ciclo]); if (f === this.firma) return; this.firma = f;
    const { g } = this; const W = this.c.width, H = this.c.height; const col = this.color;
    const INK = '#f2d8cc', BACKGROUND = '#0c0807', CARD = '#1f1311';
    g.fillStyle = BACKGROUND; g.fillRect(0, 0, W, H);
    g.textBaseline = 'top'; g.textAlign = 'left';
    // cabecera: título a la izquierda, ciclo y barra de progreso a la derecha
    g.fillStyle = col; g.font = `700 30px ${SOURCES.mono}`; g.shadowColor = col; g.shadowBlur = 10;
    g.fillText('LINEAR · MIS INCIDENCIAS', 28, 18); g.shadowBlur = 0;
    if (ciclo) {
      const dia = 86400000; const remain = ciclo.fin ? Math.max(0, Math.ceil((ciclo.fin - Date.now()) / dia)) : null;
      g.font = `600 24px ${SOURCES.mono}`; g.textAlign = 'right';
      g.fillText(`${ciclo.nombre.toUpperCase()} · ${ciclo.progreso} %${remain !== null ? ` · ${remain} DÍAS` : ''}`, W - 28, 20); g.textAlign = 'left';
      g.strokeStyle = col + '88'; g.lineWidth = 2; g.strokeRect(W - 452, 54, 424, 12); g.fillStyle = col; g.fillRect(W - 450, 56, 420 * ciclo.progreso / 100, 8);
    }
    // columnas: cada una reparte su altura entre sus fichas (con pocas incidencias, fichas más altas y con más detalle)
    const n = Math.max(1, columnas.length); const cw = (W - 56) / n;
    const yc = 78, y0 = 120, y1 = 374, hueco = 9, MAXF = 5;
    columnas.forEach((c, i) => {
      const x = 28 + i * cw + 5, w = cw - 10;
      g.fillStyle = col + '24'; g.fillRect(x, yc, w, 36);
      g.fillStyle = col; g.font = `700 24px ${SOURCES.mono}`; g.fillText(c.nombre.toUpperCase(), x + 14, yc + 6);
      const pts = c.fichas.reduce((s, fi) => s + (fi.estimacion ?? 0), 0);
      g.textAlign = 'right'; g.font = `600 22px ${SOURCES.mono}`; g.fillText(`${c.fichas.length}${pts ? ` · ${pts} pt` : ''}`, x + w - 12, yc + 8); g.textAlign = 'left';
      const vis = c.fichas.slice(0, c.fichas.length > MAXF ? MAXF - 1 : MAXF); const mas = c.fichas.length - vis.length;
      const filas = vis.length + (mas ? 1 : 0);
      if (!filas) {
        g.setLineDash([10, 8]); g.strokeStyle = col + '55'; g.lineWidth = 2; g.strokeRect(x + 2, y0, w - 4, y1 - y0); g.setLineDash([]);
        g.fillStyle = col + '77'; g.font = `600 24px ${SOURCES.mono}`; g.textAlign = 'center'; g.fillText('nada aquí', x + w / 2, (y0 + y1) / 2 - 12); g.textAlign = 'left';
        return;
      }
      const alto = mas ? 44 : 0;
      const fh = (y1 - y0 - alto - (vis.length - 1 + (mas ? 1 : 0)) * hueco) / Math.max(1, vis.length);
      vis.forEach((fi, k) => {
        const y = y0 + k * (fh + hueco);
        this.ficha(fi, x, y, w, fh, col, INK, CARD);
      });
      if (mas) { const y = y1 - alto; g.fillStyle = col + '1c'; g.fillRect(x, y, w, alto); g.fillStyle = col; g.font = `600 22px ${SOURCES.mono}`; g.fillText(`+ ${mas} más`, x + 16, y + 11); }
    });
    // pie: gráfica del ciclo
    this.graphic(ciclo, columnas, 28, 388, W - 56, 176, col, INK);   // por debajo de 564 lo tapan cabezas y holograma
    for (let y = 0; y < H; y += 3) { g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, y, W, 1); }
    this.tex.needsUpdate = true;
  }
  private ficha(fi: BoardCard, x: number, y: number, w: number, fh: number, col: string, tinta: string, fondo: string) {
    const { g } = this;
    g.fillStyle = fondo; g.fillRect(x, y, w, fh);
    // con el color de su tarea (lo reparte Logística: shared/tareas.ts) en el borde y la franja; la prioridad, al lado
    const prio = fi.prioridad === 1 ? '#ff5a4a' : fi.prioridad === 2 ? '#ffb000' : null;
    g.strokeStyle = fi.color ? fi.color + 'aa' : col + '33'; g.lineWidth = fi.color ? 2.5 : 1.5; g.strokeRect(x + 1, y + 1, w - 2, fh - 2);
    if (fi.color) { g.fillStyle = fi.color; g.fillRect(x, y, 10, fh); if (prio) { g.fillStyle = prio; g.fillRect(x + 10, y, 4, fh); } }
    else { g.fillStyle = prio ?? col + '99'; g.fillRect(x, y, 7, fh); }
    // tamaño de letra según el alto de la ficha: con pocas incidencias, fichas altas que se leen desde lejos;
    // con muchas, una sola fila (identificador, título y estimación)
    const grande = fh >= 120, compacta = fh < 64, baja = fh < 40;
    const fTit = grande ? Math.round(THREE.MathUtils.clamp(fh * 0.13, 27, 34)) : compacta ? 19 : 21, fId = grande ? 22 : compacta ? 16 : 20;
    const pad = grande ? 14 : baja ? Math.max(4, (fh - fId) / 2) : compacta ? 4 : 7;
    g.fillStyle = fi.color ?? col; g.font = `700 ${fId}px ${SOURCES.mono}`; g.fillText(fi.id, x + 20, y + pad);
    const widthId = g.measureText(fi.id).width;
    // estimación: pastilla a la derecha
    let titleEnd = x + w - 14;
    if (fi.estimacion != null) {
      const t = `${fi.estimacion} pt`; g.font = `700 ${fId - 2}px ${SOURCES.mono}`; const tw = g.measureText(t).width + 16;
      g.fillStyle = col + '30'; g.fillRect(x + w - tw - 10, y + pad - 3, tw, fId + 4); g.fillStyle = col; g.fillText(t, x + w - tw - 2, y + pad);
      titleEnd = x + w - tw - 20;
    }
    // asignado: iniciales en un disco, junto al identificador
    const quien = fi.asignado ?? '';
    const ini = quien.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '·';
    const r = fId * 0.6; const cx = x + 20 + widthId + r + 10, cy = y + pad + fId * 0.5;
    g.fillStyle = '#d08a5a'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a0f0c'; g.font = `800 ${Math.round(r * 1.05)}px ${SOURCES.mono}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ini, cx, cy + 1); g.textAlign = 'left'; g.textBaseline = 'top';
    if (grande && quien) { g.fillStyle = tinta + 'aa'; g.font = `500 ${fId - 3}px ${SOURCES.mono}`; g.fillText(quien.split(/\s+/)[0], cx + r + 8, y + pad + 2); }
    g.fillStyle = tinta; g.font = `500 ${fTit}px ${SOURCES.mono}`;
    if (baja) {   // una fila: el título entre el asignado y la estimación
      const x0 = cx + r + 12; const t = splitByWords(g, fi.titulo, titleEnd - x0, 1)[0] ?? ''; g.fillText(t, x0, y + pad); return;
    }
    // título por palabras, tantas líneas como quepan
    const lh = fTit * (grande ? 1.18 : 1.08); const yT = y + pad + fId + (grande ? 12 : compacta ? 2 : 4);
    const pie = grande && fi.sub ? fTit : 0;
    const linesMax = Math.max(1, Math.floor((y + fh - 3 - pie - yT) / lh));
    splitByWords(g, fi.titulo, w - 36, Math.min(4, linesMax)).forEach((l, m) => g.fillText(l, x + 20, yT + m * lh));
    if (pie) { g.fillStyle = col + 'aa'; g.font = `500 ${fTit - 6}px ${SOURCES.mono}`; const t = splitByWords(g, fi.sub!, w - 36, 1)[0] ?? ''; g.fillText(t, x + 20, y + fh - pad - fTit + 4); }
  }
  // lo que queda del ciclo, día a día: la línea ideal (discontinua) y la real con relleno, el día de hoy marcado
  // y las cifras a la derecha. Sin ciclo activo, el reparto de las incidencias por estado.
  private graphic(ciclo: BoardCycle | null, columnas: { nombre: string; fichas: BoardCard[] }[], bx: number, by: number, bw: number, bh: number, col: string, tinta: string) {
    const { g } = this;
    g.fillStyle = '#140d0b'; g.fillRect(bx, by, bw, bh); g.strokeStyle = col + '44'; g.lineWidth = 1.5; g.strokeRect(bx, by, bw, bh);
    const kpiW = 330; const gx = bx + 70, gy = by + 42, gw = bw - kpiW - 100, gh = bh - 74;
    g.fillStyle = col; g.font = `700 22px ${SOURCES.mono}`; g.fillText(ciclo ? 'PENDIENTE DEL CICLO' : 'INCIDENCIAS POR ESTADO', bx + 16, by + 10);
    const total = columnas.reduce((s, c) => s + c.fichas.length, 0);
    if (!ciclo) {
      const colores = [col + '66', '#ffb000', '#5dff8a']; let xx = gx;
      columnas.forEach((c, i) => { const w = total ? gw * c.fichas.length / total : gw / columnas.length; if (w < 6) return; g.fillStyle = colores[i % 3]; g.fillRect(xx, gy + 20, w - 4, gh - 40); g.fillStyle = '#120a08'; g.font = `700 24px ${SOURCES.mono}`; if (w > 120) g.fillText(`${c.nombre} ${c.fichas.length}`, xx + 12, gy + gh / 2 - 12); xx += w; });
      return;
    }
    const dia = 86400000; const ahora = Date.now();
    const ini = ciclo.inicio ?? ahora - 6 * dia, fin = ciclo.fin ?? ahora + 8 * dia;
    const N = Math.max(1, Math.round((fin - ini) / dia)); const hoy = THREE.MathUtils.clamp((ahora - ini) / dia, 0, N);
    // serie de lo que queda: del historial de Linear si llega; si no, del progreso de hoy repartido por días
    let queda: number[];
    if (ciclo.reach?.length && ciclo.hecho?.length) queda = ciclo.reach.map((a, k) => Math.max(0, a - (ciclo.hecho![k] ?? 0)));
    else {
      const reach = Math.max(4, columnas.reduce((s, c) => s + c.fichas.reduce((t, fi) => t + (fi.estimacion ?? 1), 0), 0));
      const d = Math.floor(hoy); queda = [];
      for (let k = 0; k <= d; k++) { const noise = k && k < d ? Math.sin(k * 2.3) * 0.06 : 0; const fr = THREE.MathUtils.clamp((d ? k / d : 0) * ciclo.progreso / 100 + noise, 0, 1); queda.push(Math.round(reach * (1 - (k ? fr : 0)))); }
    }
    const max = Math.max(1, ...queda, ...(ciclo.reach ?? []));
    const X = (k: number) => gx + gw * k / N, Y = (v: number) => gy + gh - gh * v / max;
    // rejilla y ejes
    g.strokeStyle = col + '22'; g.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const y = gy + gh * k / 4; g.beginPath(); g.moveTo(gx, y); g.lineTo(gx + gw, y); g.stroke(); }
    g.fillStyle = col + 'aa'; g.font = `500 18px ${SOURCES.mono}`; g.textAlign = 'right';
    g.fillText(String(max), gx - 10, gy - 8); g.fillText('0', gx - 10, gy + gh - 10); g.textAlign = 'left';
    const days = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    for (let k = 0; k <= N; k += Math.max(1, Math.round(N / 7))) { const d = new Date(ini + k * dia); g.fillStyle = col + '88'; g.fillText(`${days[d.getDay()]}${d.getDate()}`, X(k) - 14, gy + gh + 6); }
    // ideal
    g.setLineDash([10, 8]); g.strokeStyle = col + '77'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(X(0), Y(queda[0] ?? max)); g.lineTo(X(N), Y(0)); g.stroke(); g.setLineDash([]);
    // real, en escalones como en Linear, con el área debajo
    const pasos: [number, number][] = []; queda.forEach((v, k) => { if (k) pasos.push([X(Math.min(k, hoy)), Y(queda[k - 1])]); pasos.push([X(Math.min(k, hoy)), Y(v)]); });
    pasos.push([X(hoy), Y(queda[queda.length - 1] ?? 0)]);
    g.beginPath(); g.moveTo(X(0), gy + gh); pasos.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(X(hoy), gy + gh); g.closePath(); g.fillStyle = col + '30'; g.fill();
    g.beginPath(); pasos.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.strokeStyle = col; g.lineWidth = 4; g.shadowColor = col; g.shadowBlur = 8; g.stroke(); g.shadowBlur = 0;
    // hoy
    g.strokeStyle = '#ffb000'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(hoy), gy - 4); g.lineTo(X(hoy), gy + gh); g.stroke();
    g.fillStyle = '#ffb000'; g.font = `700 18px ${SOURCES.mono}`; g.fillText('HOY', X(hoy) + 6, gy - 6);
    // cifras
    const kx = bx + bw - kpiW; const resto = queda[queda.length - 1] ?? 0; const ideal = Math.round((queda[0] ?? 0) * (1 - hoy / N));
    g.strokeStyle = col + '33'; g.beginPath(); g.moveTo(kx - 16, by + 12); g.lineTo(kx - 16, by + bh - 12); g.stroke();
    const ud = ciclo.reach?.length ? '' : ' pt';
    const c2 = kx + 160;
    g.fillStyle = col + 'aa'; g.font = `600 18px ${SOURCES.mono}`; g.fillText('QUEDA', kx, by + 16); g.fillText('IDEAL HOY', c2, by + 16);
    g.fillStyle = tinta; g.font = `700 36px ${SOURCES.mono}`; g.fillText(`${resto}${ud}`, kx, by + 40);
    g.fillStyle = resto > ideal ? '#ffb000' : '#5dff8a'; g.fillText(`${ideal}${ud}`, c2, by + 40);
    g.fillStyle = col + 'aa'; g.font = `600 18px ${SOURCES.mono}`; g.fillText('RITMO', kx, by + 96);
    g.fillStyle = resto > ideal ? '#ffb000' : '#5dff8a'; g.font = `700 26px ${SOURCES.mono}`; g.fillText(resto > ideal ? `${resto - ideal}${ud} TARDE` : 'EN PLAZO', kx, by + 118);
  }
}
