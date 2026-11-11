// Los robots chiquitines que bailan en la pista de la discoteca. KayKit no trae un clip de baile: cada robot encadena
// clips del esqueleto (los brazos arriba de Cheering, el bote de Jump_Idle, los pasos en el sitio de las carreras y los
// desplazamientos laterales, la guardia del boxeador…) cambiando cada dos compases, con la velocidad ajustada para que
// cada vuelta del clip dure golpes enteros, y encima un movimiento por código a ritmo: bote en cada golpe, cadera y
// hombros que se balancean, cabeceo, giros de 90º en los cambios de compás y algún paso lateral. Cada uno con su estilo
// y su desfase. Sin música descansan: de pie mirando el móvil, charlando o sentados en el suelo al borde de la pista.
// No son obstáculos: si el Supervisor se mete en la pista, se apartan un poco.
import * as THREE from 'three';
import { Character } from '../personaje';
import type { Look } from '@shared/aspecto';

export interface Rhythm { sonando: boolean; bpm: number; pulse: number; energy: number }   // pulso: golpes desde el inicio (con decimales)

interface Estilo {
  clips: string[];                 // lo que baila, por turnos de dos compases
  accents: string[];               // gestos sueltos en algún cambio de compás
  giros: number[];                 // hacia dónde mira en cada compás (0: a la cámara)
  paso: number;                    // amplitud del paso lateral (m)
  bote: number;                    // altura del bote (m, a escala de robot)
  hip: number; shoulders: number; cabeza: number;
  descanso: string;                // sin música
}

const STYLES: Estilo[] = [
  { clips: ['Cheering', 'Jump_Idle', 'Running_Strafe_Left', 'Running_Strafe_Right'], accents: ['Ranged_Magic_Summon'], giros: [0, Math.PI / 2, 0, -Math.PI / 2], paso: 0.16, bote: 0.07, hip: 0.12, shoulders: 0.1, cabeza: 0.12, descanso: 'Idle_B' },
  { clips: ['Melee_Unarmed_Idle', 'Walking_C', 'Waving', 'Jump_Idle'], accents: ['Interact'], giros: [0.35, -0.35, 0.35, -0.35], paso: 0.1, bote: 0.05, hip: 0.16, shoulders: 0.06, cabeza: 0.18, descanso: 'Idle_A' },
  { clips: ['Ranged_Magic_Spellcasting', 'Running_A', 'Cheering', 'Melee_2H_Idle'], accents: ['Ranged_Magic_Summon'], giros: [0, 0, Math.PI / 2, 0, 0, -Math.PI / 2], paso: 0, bote: 0.06, hip: 0.1, shoulders: 0.14, cabeza: 0.1, descanso: 'Sit_Floor_Idle' },
  { clips: ['Jump_Idle', 'Running_Strafe_Right', 'Ranged_Magic_Raise', 'Walking_B'], accents: ['Ranged_Magic_Shoot'], giros: [-0.4, 0, 0.4, 0], paso: 0.2, bote: 0.08, hip: 0.08, shoulders: 0.12, cabeza: 0.14, descanso: 'Idle_B' },
  { clips: ['Waving', 'Melee_Unarmed_Idle', 'Running_Strafe_Left', 'Cheering'], accents: ['Interact'], giros: [0, -Math.PI / 2, 0, Math.PI / 2], paso: 0.14, bote: 0.06, hip: 0.14, shoulders: 0.1, cabeza: 0.16, descanso: 'Sit_Floor_Idle' },
];

// los clips que ya repiten solos (los gestos se cortan y se encadenan, ver `bailar`)
const TIME_ONE = new Set(['Interact', 'Ranged_Magic_Summon', 'Ranged_Magic_Shoot']);   // (los saltos y regates del pack acaban en el suelo: fuera)

interface Dancer {
  p: Character; e: Estilo; casa: THREE.Vector3; desfase: number;
  aparte: THREE.Vector3;          // lo que se aparta del Supervisor
  turno: number; beat: number; clip: string; listo: boolean; dancing: boolean; restTurn: number;
  huesos: { hip?: THREE.Object3D; pecho?: THREE.Object3D; cabeza?: THREE.Object3D };
  // la pose de esos huesos tal como la deja el clip, antes del retoque: se repone antes de cada fotograma (no todos los
  // clips traen pista para todos los huesos, y sin reponerla el retoque se iba sumando hasta tumbar al robot)
  pose: Map<THREE.Object3D, THREE.Quaternion>;
}

const tinte = (torso: string, piernas: string): Look['colores'] => ({ torso1: torso, cabeza1: torso, piernas1: piernas });

/** Monta los bailarines en `g` (coordenadas locales de la sala). `casas`: dónde baila cada uno; `ritmo()`: el pulso. */
export function mountDancers(g: THREE.Group, houses: [number, number][], rhythm: () => Rhythm, supervisor: () => THREE.Object3D | null) {
  const colores = [tinte('#c94f7c', '#3a3346'), tinte('#3fa7c9', '#2d3440'), tinte('#d9a03a', '#3b3329'), tinte('#7a5bd1', '#2e2a3d'), tinte('#5fbf86', '#2b3a33')];
  const bailarines: Dancer[] = [];
  houses.forEach(([x, z], i) => {
    const tipo = i % 2 ? 'Robot_Two' : 'Robot_One';
    const p = new Character(tipo, { especie: 'robot', piezas: { cabeza: `cabeza.${tipo}`, torso: `torso.${tipo}`, brazos: `brazos.${tipo}`, piernas: `piernas.${tipo}` }, colores: colores[i % colores.length] });
    const b: Dancer = { p, e: STYLES[i % STYLES.length], casa: new THREE.Vector3(x, 0, z), desfase: (i * 0.37) % 1, aparte: new THREE.Vector3(), turno: i, beat: -1, clip: '', listo: false, dancing: false, restTurn: [0.5, -0.4, 0.9, -0.8, 0.2][i % 5], huesos: {}, pose: new Map() };
    bailarines.push(b);
    p.cargar().then(() => {
      p.raiz.scale.multiplyScalar(0.62);
      p.raiz.position.copy(b.casa); p.raiz.rotation.y = p.goalTurn = b.restTurn;
      b.huesos = { hip: p.modelo.getObjectByName('hips') ?? undefined, pecho: p.modelo.getObjectByName('chest') ?? undefined, cabeza: p.modelo.getObjectByName('head') ?? undefined };
      p.animateAfter = () => retouch(b);
      descansar(b, true);
      g.add(p.raiz); b.listo = true;
    });
  });

  // sin música: cada uno a su descanso (los del suelo se sientan con su clip)
  function descansar(b: Dancer, ya = false) {
    b.dancing = false; b.clip = ''; b.beat = -1;
    b.p.goalTurn = b.restTurn;
    const d = b.e.descanso;
    if (d === 'Sit_Floor_Idle' && !ya) b.p.gesture('Sit_Floor_Down', () => b.p.reproducir('Sit_Floor_Idle', 0.2), 0.3);
    else b.p.reproducir(d, ya ? 0 : 0.5);
    b.p.inRest = d;
  }
  function empezar(b: Dancer) {
    b.dancing = true; b.beat = -1;
    if (b.e.descanso === 'Sit_Floor_Idle') { b.clip = 'Sit_Floor_StandUp'; b.p.gesture('Sit_Floor_StandUp', () => { b.clip = ''; }, 0.2); }
  }

  // la velocidad del clip para que una vuelta dure golpes enteros (1, 2, 4 u 8)
  function speed(p: Character, nombre: string, bpm: number) {
    const T = 60 / bpm, D = p.accion(nombre).getClip().duration;
    let mejor = 1, err = Infinity;
    for (const n of [1, 2, 4, 8]) { const v = D / (n * T); const e = Math.abs(Math.log(v)); if (v > 0.55 && v < 1.9 && e < err) { err = e; mejor = v; } }
    return mejor;
  }

  function bailar(b: Dancer, r: Rhythm) {
    const hits = r.pulse;                            // todos al mismo golpe; cada uno cambia de paso a su turno
    const beat = Math.floor(hits / 4);
    if (beat === b.beat || b.clip === 'Sit_Floor_StandUp') return;
    const cambio = beat % 2 === 0 || b.beat < 0;  // cada dos compases, otro paso
    b.beat = beat;
    b.p.goalTurn = b.e.giros[(beat + b.turno) % b.e.giros.length];
    if (!cambio) return;
    b.turno++;
    const siguiente = b.e.clips[(b.turno) % b.e.clips.length];
    // en algún cambio, un acento suelto (un salto, un regate) antes del paso nuevo
    if (b.e.accents.length && (beat + b.turno * 3) % 5 === 0) {
      const a = b.e.accents[(beat + b.turno) % b.e.accents.length];
      b.clip = a; b.p.gesture(a, () => { b.clip = siguiente; b.p.reproducir(siguiente, 0.15, { vel: speed(b.p, siguiente, r.bpm) }); }, 0.12);
      return;
    }
    b.clip = siguiente;
    const a = b.p.reproducir(siguiente, 0.18, { vel: speed(b.p, siguiente, r.bpm) });
    // que la vuelta del clip empiece en el golpe
    if (a && !TIME_ONE.has(siguiente)) a.time = ((hits % 1) * 60 / r.bpm) * a.timeScale;
  }

  // movimiento por código encima del clip, a ritmo (después de que el mezclador ponga la pose)
  const tmpV = new THREE.Vector3();
  function retouch(b: Dancer) {
    const r = currentRhythm; const f = r.pulse % 1, k = b.dancing ? marcha : 0;
    for (const h of [b.huesos.hip, b.huesos.pecho, b.huesos.cabeza]) if (h) { const q = b.pose.get(h); if (q) q.copy(h.quaternion); else b.pose.set(h, h.quaternion.clone()); }
    if (k < 0.01) return;
    const lado = Math.sin(Math.PI * (r.pulse + b.desfase));   // de un lado al otro cada golpe
    const fuerza = (0.65 + 0.35 * r.energy) * k;
    const { hip, pecho, cabeza } = b.huesos;
    if (hip) { hip.rotation.z += lado * b.e.hip * fuerza; hip.rotation.y += lado * b.e.hip * 0.6 * fuerza; }
    if (pecho) { pecho.rotation.z -= lado * b.e.shoulders * fuerza; pecho.rotation.x += Math.exp(-f * 6) * 0.08 * fuerza; }
    if (cabeza) cabeza.rotation.x += (Math.exp(-f * 7) * 1.2 - 0.3) * b.e.cabeza * fuerza;
  }

  let marcha = 0;
  let currentRhythm: Rhythm = { sonando: false, bpm: 118, pulse: 0, energy: 0 };
  const sup = new THREE.Vector3();
  function actualizar(dt: number) {
    const r = rhythm(); currentRhythm = r;
    marcha = THREE.MathUtils.damp(marcha, r.sonando ? 1 : 0, 3, dt);
    const s = supervisor(); let hasSup = false;
    if (s) { sup.copy(s.position); g.worldToLocal(sup); hasSup = Math.abs(sup.y) < 1.5 && Math.abs(sup.x) < 6.2 && Math.abs(sup.z) < 3; }
    for (const b of bailarines) {
      if (!b.listo) continue;
      if (r.sonando && !b.dancing) empezar(b);
      else if (!r.sonando && b.dancing) descansar(b);
      if (b.dancing) bailar(b, r);
      // se aparta del Supervisor (sin dejar de bailar)
      tmpV.set(0, 0, 0);
      if (hasSup) {
        const dx = b.casa.x - sup.x, dz = b.casa.z - sup.z, d = Math.hypot(dx, dz);
        // encima del todo: hacia su lado de la pista; si no, en la dirección contraria al Supervisor
        if (d < 1.1) { if (d < 0.08) tmpV.set(Math.sign(b.casa.x) || 1, 0, 0.3).normalize().multiplyScalar(1.1); else tmpV.set(dx, 0, dz).multiplyScalar((1.1 - d) / d); }
      }
      b.aparte.x = THREE.MathUtils.damp(b.aparte.x, tmpV.x, 4, dt); b.aparte.z = THREE.MathUtils.damp(b.aparte.z, tmpV.z, 4, dt);
      // paso lateral (va y viene cada dos compases) y bote en cada golpe
      const k = b.dancing ? marcha : 0, f = r.pulse % 1;
      const paso = b.e.paso * Math.sin(Math.PI * 2 * (r.pulse / 8 + b.desfase)) * k;
      const bote = b.e.bote * Math.sin(Math.PI * f) * (0.7 + 0.3 * r.energy) * k;
      const p = b.p.raiz;
      p.position.set(b.casa.x + paso + b.aparte.x, bote, b.casa.z + b.aparte.z);
      p.rotation.z = Math.sin(Math.PI * (r.pulse + b.desfase)) * 0.05 * k;   // todo el cuerpo se mece un poco
      for (const [h, q] of b.pose) h.quaternion.copy(q);   // sin el retoque del fotograma anterior
      b.p.actualizar(dt);
      if (b.dancing && b.clip && !TIME_ONE.has(b.clip) && b.p.actual && b.p.currentName === b.clip) b.p.actual.timeScale = speed(b.p, b.clip, r.bpm);
    }
  }
  return { bailarines, actualizar };
}
