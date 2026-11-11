// Reparto de luces dinámicas: un número FIJO de focos y puntuales (los shaders nunca se recompilan) que se asignan,
// con fundido, a las lámparas y piezas luminosas más cercanas al centro de la cámara. Las lámparas sin luz real
// muestran su poza falsa (decal aditivo) para que de lejos el refugio siga pareciendo encendido.
import * as THREE from 'three';
import type { LightAnchor, Sala } from './salas/comun';

interface Slot<L extends THREE.Light> { luz: L; anchor: LightAnchor | null; sala: Sala | null; actual: number }

export class LightsAssignment {
  private focos: Slot<THREE.SpotLight>[] = [];
  private puntos: Slot<THREE.PointLight>[] = [];
  private reloj = 0;
  private v = new THREE.Vector3();
  // sin sombra propia: los focos no proyectan (la del sol basta y es lo más caro)
  constructor(escena: THREE.Scene, nSpotlights = 6, nPoints = 3) {
    for (let i = 0; i < nSpotlights; i++) {
      const l = new THREE.SpotLight('#ffbe73', 0, 10, 0.72, 0.65, 1.5);
      escena.add(l, l.target); this.focos.push({ luz: l, anchor: null, sala: null, actual: 0 });
    }
    for (let i = 0; i < nPoints; i++) { const l = new THREE.PointLight('#ffffff', 0, 5, 2); escena.add(l); this.puntos.push({ luz: l, anchor: null, sala: null, actual: 0 }); }
  }

  actualizar(salas: Sala[], centro: THREE.Vector3, dt: number) {
    this.reloj -= dt;
    if (this.reloj <= 0) { this.reloj = 0.3; this.asignar(salas, centro); }
    for (const r of [...this.focos, ...this.puntos] as Slot<any>[]) {
      const goal = r.anchor ? r.anchor.intensidad : 0;
      r.actual = THREE.MathUtils.damp(r.actual, goal, 6, dt);
      r.luz.intensity = r.actual;
      if (r.anchor) { r.luz.color.copy(r.anchor.color); }
    }
  }

  private mundo(s: Sala, p: THREE.Vector3) { return this.v.copy(p).add(s.grupo.position); }

  private asignar(salas: Sala[], centro: THREE.Vector3) {
    const candidates: { a: LightAnchor; s: Sala; d: number }[] = [];
    for (const s of salas) for (const a of s.anclas) {
      const w = this.mundo(s, a.pos);
      const d = Math.hypot(w.x - centro.x, (w.y - centro.y) * 1.6) - (a.prioridad ?? 0) - (a.sombra ? 0.5 : 0);
      candidates.push({ a, s, d });
    }
    candidates.sort((x, y) => x.d - y.d);
    const focos = candidates.filter(c => c.a.tipo === 'foco');
    const puntos = candidates.filter(c => c.a.tipo === 'punto');
    // el foco con sombra va a la lámpara con sombra más cercana
    const withShadow = focos.find(c => c.a.sombra) ?? focos[0];
    const chosen = [withShadow, ...focos.filter(c => c !== withShadow)].filter(Boolean).slice(0, this.focos.length);
    this.place(this.focos, chosen, true);
    this.place(this.puntos, puntos.slice(0, this.puntos.length), false);
    // pozas falsas: visibles donde no hay luz real
    const reales = new Set(chosen.map(c => c.a));
    for (const c of focos) if (c.a.poza) c.a.poza.visible = !reales.has(c.a);
  }

  private place<L extends THREE.SpotLight | THREE.PointLight>(slots: Slot<L>[], chosen: { a: LightAnchor; s: Sala }[], isFocus: boolean) {
    const free = new Set(slots);
    const pendientes: { a: LightAnchor; s: Sala }[] = [];
    // mantener las que siguen elegidas en su ranura (sin parpadeo)
    for (const e of chosen) { const r = slots.find(x => x.anchor === e.a); if (r) free.delete(r); else pendientes.push(e); }
    for (const r of slots) if (r.anchor && !chosen.some(e => e.a === r.anchor)) { r.anchor = null; }
    const orden = [...free];
    for (const e of pendientes) {
      const r = orden.shift(); if (!r) break;
      r.anchor = e.a; r.sala = e.s; r.actual = 0;
      r.luz.position.copy(e.a.pos).add(e.s.grupo.position);
      if (isFocus) {
        const f = r.luz as unknown as THREE.SpotLight;
        f.target.position.copy(e.a.goal ?? e.a.pos).add(e.s.grupo.position).setY(e.s.grupo.position.y + (e.a.goal?.y ?? 0));
        f.angle = e.a.angulo ?? 0.72; f.penumbra = e.a.penumbra ?? 0.65; f.distance = e.a.distancia ?? 10;
      } else (r.luz as unknown as THREE.PointLight).distance = e.a.distancia ?? 5;
    }
  }
}
