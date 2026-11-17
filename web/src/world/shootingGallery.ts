// Galería de tiro: el Supervisor se planta en el mostrador con su arma, los blancos se mueven por el raíl y caen al
// acertarles. Rondas de 30 s; los puntos y el récord los valida el servidor (acción juego.tiro).
// Primera iteración sin terminar (README, «Lo que está a medias»): la mira solo se mueve en horizontal y el acierto
// compara la x en pantalla con tolerancia, sin rayo.
import * as THREE from 'three';
import type { Refugio } from './refugio';
import type { Sala } from './salas/comun';
import { arma as weaponData } from '@shared/catalogo';
import { SFX } from '../audio/sonido';

export class Gallery {
  activa = false;
  private sala: Sala | null = null;
  private weaponId = 'ballesta';
  private muzzleFlash: THREE.PointLight | null = null;
  constructor(private r: Refugio) {}

  get dianas(): THREE.Object3D[] { return this.sala?.userData.dianas ?? []; }

  empezar(weaponId: string) {
    const sala = this.r.salas.find(s => s.tipo === 'galeria'); if (!sala) return false;
    this.sala = sala; this.weaponId = weaponId; this.activa = true;
    this.r.goARoom(sala.id, true);
    const sup = this.r.supervisor;
    sup.parar(); sup.raiz.position.set(sala.grupo.position.x - 1.2, sala.grupo.position.y, 0.3);
    sup.goalTurn = Math.PI; sup.raiz.rotation.y = Math.PI;
    const a = weaponData(weaponId); const handsTwo = weaponId !== 'ballesta';
    if (a.ruta) sup.couple('arma', { ruta: a.ruta, bone: 'handslotr', escala: 1 });
    sup.inRest = handsTwo ? 'Ranged_2H_Aiming' : 'Ranged_1H_Aiming'; sup.reproducir(sup.inRest, 0.25);
    this.r.camara.encuadrar(new THREE.Vector3(sala.grupo.position.x, sala.grupo.position.y + 1.7, 0), 11.5, 4.2);
    if (!this.muzzleFlash) { this.muzzleFlash = new THREE.PointLight('#ffcf8a', 0, 5, 2); this.r.motor.scene.add(this.muzzleFlash); }
    this.r.activityMode = true;
    return true;
  }

  // posición en pantalla (NDC) de la línea de blancos, para el punto de mira
  heightMira() {
    const d = this.dianas[0]; if (!d || !this.sala) return 0;
    const p = d.getWorldPosition(new THREE.Vector3()); p.project(this.r.motor.camera); return p.y;
  }

  fire(x: number): { acierto: boolean; puntos: number } {
    if (!this.activa || !this.sala) return { acierto: false, puntos: 0 };
    const sup = this.r.supervisor; const handsTwo = this.weaponId !== 'ballesta';
    sup.gesture(handsTwo ? 'Ranged_2H_Shoot' : 'Ranged_1H_Shoot', sup.inRest, 0.05);
    SFX.disparo(this.weaponId === 'escopeta' ? 1.3 : this.weaponId === 'rifle' ? 1 : 0.7);
    const mano = sup.raiz.position.clone(); mano.y += 1.3; mano.z -= 0.4;
    if (this.muzzleFlash) { this.muzzleFlash.position.copy(mano); this.muzzleFlash.intensity = 14; }
    const tolerance = this.weaponId === 'escopeta' ? 0.075 : 0.045;
    const mult = weaponData(this.weaponId).multiplier ?? 1;
    let mejor: THREE.Object3D | null = null, dmin = Infinity;
    for (const d of this.dianas) {
      if (d.userData.fall > 0) continue;
      const p = d.getWorldPosition(new THREE.Vector3()).project(this.r.motor.camera);
      const dx = Math.abs(p.x - x); if (dx < tolerance && dx < dmin) { dmin = dx; mejor = d; }
    }
    if (!mejor) return { acierto: false, puntos: 0 };
    mejor.userData.fall = 1.6; SFX.blanco();
    const centro = 1 - dmin / tolerance;                                  // en el centro vale más
    const rapido = Math.abs(mejor.userData.vel ?? 0) > 0.25 ? 5 : 0;      // los que se mueven rápido, también
    return { acierto: true, puntos: Math.round((10 + centro * 10 + rapido) * mult) };
  }

  actualizar(dt: number) {
    if (this.muzzleFlash) this.muzzleFlash.intensity = Math.max(0, this.muzzleFlash.intensity - dt * 120);
    for (const d of this.dianas) {
      const prev = d.userData.xPrev ?? d.position.x; d.userData.vel = (d.position.x - prev) / Math.max(dt, 1e-3); d.userData.xPrev = d.position.x;
      if (d.userData.fall > 0) { d.userData.fall -= dt; d.rotation.x = THREE.MathUtils.damp(d.rotation.x, d.userData.fall > 0.4 ? -1.45 : 0, 12, dt); if (d.userData.fall <= 0) d.userData.fall = 0; }
      else d.rotation.x = THREE.MathUtils.damp(d.rotation.x, 0, 10, dt);
    }
  }

  terminar() {
    if (!this.activa) return;
    this.activa = false; this.r.activityMode = false;
    const sup = this.r.supervisor; sup.soltar('arma'); sup.inRest = 'Idle_A'; sup.reproducir('Idle_A', 0.3);
    if (this.r.currentRoom) this.r.frameRoom(this.r.currentRoom);
  }
}
