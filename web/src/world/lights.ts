// Reparto de luces dinámicas: un número FIJO de focos y puntuales (los shaders nunca se recompilan) que se asignan,
// con fundido, a las lámparas y piezas luminosas más cercanas al centro de la cámara. Las lámparas sin luz real
// muestran su poza falsa (decal aditivo) para que de lejos el refugio siga pareciendo encendido.
import * as THREE from 'three';
import type { LightAnchor, Room } from './rooms/common';

interface Slot<L extends THREE.Light> { light: L; anchor: LightAnchor | null; room: Room | null; current: number }

export class LightsAssignment {
  private spotlights: Slot<THREE.SpotLight>[] = [];
  private points: Slot<THREE.PointLight>[] = [];
  private timer = 0;
  private v = new THREE.Vector3();
  // sin sombra propia: los focos no proyectan (la del sol basta y es lo más caro)
  constructor(scene: THREE.Scene, nSpotlights = 6, nPoints = 3) {
    for (let i = 0; i < nSpotlights; i++) {
      const l = new THREE.SpotLight('#ffbe73', 0, 10, 0.72, 0.65, 1.5);
      scene.add(l, l.target); this.spotlights.push({ light: l, anchor: null, room: null, current: 0 });
    }
    for (let i = 0; i < nPoints; i++) { const l = new THREE.PointLight('#ffffff', 0, 5, 2); scene.add(l); this.points.push({ light: l, anchor: null, room: null, current: 0 }); }
  }

  update(rooms: Room[], center: THREE.Vector3, dt: number) {
    this.timer -= dt;
    if (this.timer <= 0) { this.timer = 0.3; this.assign(rooms, center); }
    for (const r of [...this.spotlights, ...this.points] as Slot<any>[]) {
      const goal = r.anchor ? r.anchor.intensity * (r.anchor.level ?? 1) : 0;
      r.current = THREE.MathUtils.damp(r.current, goal, 6, dt);
      r.light.intensity = r.current;
      if (r.anchor) { r.light.color.copy(r.anchor.color); }
    }
  }

  private world(s: Room, p: THREE.Vector3) { return this.v.copy(p).add(s.group.position); }

  private assign(rooms: Room[], center: THREE.Vector3) {
    const candidates: { a: LightAnchor; s: Room; d: number }[] = [];
    for (const s of rooms) for (const a of s.anchors) {
      const w = this.world(s, a.pos);
      const d = Math.hypot(w.x - center.x, (w.y - center.y) * 1.6) - (a.priority ?? 0) - (a.shadow ? 0.5 : 0);
      candidates.push({ a, s, d });
    }
    candidates.sort((x, y) => x.d - y.d);
    const spotlights = candidates.filter(c => c.a.type === 'spot');
    const points = candidates.filter(c => c.a.type === 'point');
    // el foco con sombra va a la lámpara con sombra más cercana
    const withShadow = spotlights.find(c => c.a.shadow) ?? spotlights[0];
    const chosen = [withShadow, ...spotlights.filter(c => c !== withShadow)].filter(Boolean).slice(0, this.spotlights.length);
    this.place(this.spotlights, chosen, true);
    this.place(this.points, points.slice(0, this.points.length), false);
    // pozas falsas: visibles donde no hay luz real
    const reales = new Set(chosen.map(c => c.a));
    for (const c of spotlights) if (c.a.puddle) c.a.puddle.visible = !reales.has(c.a) && (c.a.level ?? 1) > 0.5;
  }

  private place<L extends THREE.SpotLight | THREE.PointLight>(slots: Slot<L>[], chosen: { a: LightAnchor; s: Room }[], isFocus: boolean) {
    const free = new Set(slots);
    const pending: { a: LightAnchor; s: Room }[] = [];
    // mantener las que siguen elegidas en su ranura (sin parpadeo)
    for (const e of chosen) { const r = slots.find(x => x.anchor === e.a); if (r) free.delete(r); else pending.push(e); }
    for (const r of slots) if (r.anchor && !chosen.some(e => e.a === r.anchor)) { r.anchor = null; }
    const orden = [...free];
    for (const e of pending) {
      const r = orden.shift(); if (!r) break;
      r.anchor = e.a; r.room = e.s; r.current = 0;
      r.light.position.copy(e.a.pos).add(e.s.group.position);
      if (isFocus) {
        const f = r.light as unknown as THREE.SpotLight;
        f.target.position.copy(e.a.goal ?? e.a.pos).add(e.s.group.position).setY(e.s.group.position.y + (e.a.goal?.y ?? 0));
        f.angle = e.a.angle ?? 0.72; f.penumbra = e.a.penumbra ?? 0.65; f.distance = e.a.distance ?? 10;
      } else (r.light as unknown as THREE.PointLight).distance = e.a.distance ?? 5;
    }
  }
}
