// Cámara frontal estable del refugio: sigue a un objetivo con suavidad, zoom con rueda entre vista de sala y vista general.
import * as THREE from 'three';

export class ShelterCamera {
  cam: THREE.PerspectiveCamera;
  goal = new THREE.Vector3(0, 2.3, 0);   // punto que se mira
  distancia = 27;                              // distancia deseada
  private dist = 27;
  private gaze = new THREE.Vector3(0, 2.3, 0);
  minDist = 9; maxDist = 140;
  elevation = 0.085;                           // inclinación hacia abajo (radianes) para ver el suelo
  limits: THREE.Box3 | null = null;
  desplazamiento = new THREE.Vector3();        // lo que se ha movido a mano (arrastrando), sobre el encuadre que toca
  temblor = 0;

  constructor(cam: THREE.PerspectiveCamera) { this.cam = cam; this.aplicar(); }

  /** Arrastre de `dx`, `dy` píxeles en un lienzo de `alto` píxeles: el refugio se mueve con el puntero */
  drag(dx: number, dy: number, alto: number) {
    const k = 2 * this.dist * Math.tan(THREE.MathUtils.degToRad(this.cam.fov) / 2) / alto;
    this.desplazamiento.x -= dx * k; this.desplazamiento.y += dy * k;
  }

  zoom(delta: number) { this.distancia = THREE.MathUtils.clamp(this.distancia * Math.exp(delta * 0.0012), this.minDist, this.maxDist); }

  encuadrar(centro: THREE.Vector3, ancho: number, alto: number) {
    const vFov = THREE.MathUtils.degToRad(this.cam.fov);
    const dHeight = alto / 2 / Math.tan(vFov / 2);
    const dWidth = ancho / 2 / Math.tan(vFov / 2) / this.cam.aspect;
    this.distancia = THREE.MathUtils.clamp(Math.max(dHeight, dWidth), this.minDist, this.maxDist);
    this.goal.copy(centro);
  }

  immediate() { this.dist = this.distancia; this.gaze.copy(this.goal); this.aplicar(); }

  actualizar(dt: number) {
    this.dist = THREE.MathUtils.damp(this.dist, this.distancia, 5, dt);
    const o = this.goal.clone().add(this.desplazamiento);
    // lo arrastrado no saca la vista del refugio: si choca con los límites, el desplazamiento se queda en el borde
    if (this.limits) { o.clamp(this.limits.min, this.limits.max); this.desplazamiento.subVectors(o, this.goal); }
    this.gaze.x = THREE.MathUtils.damp(this.gaze.x, o.x, 4.5, dt);
    this.gaze.y = THREE.MathUtils.damp(this.gaze.y, o.y, 4.5, dt);
    this.gaze.z = THREE.MathUtils.damp(this.gaze.z, o.z, 4.5, dt);
    this.temblor = Math.max(0, this.temblor - dt * 2);
    this.aplicar();
  }

  private aplicar() {
    const e = this.elevation * (1 - Math.min(1, (this.dist - 20) / 120) * 0.5);
    const t = this.temblor * this.temblor;
    this.cam.position.set(this.gaze.x + (Math.random() - 0.5) * t * 0.3, this.gaze.y + Math.sin(e) * this.dist + (Math.random() - 0.5) * t * 0.3, this.gaze.z + Math.cos(e) * this.dist);
    this.cam.lookAt(this.gaze);
    // niebla y planos acordes a la distancia
    this.cam.near = Math.max(0.5, this.dist * 0.2); this.cam.far = this.dist * 4 + 60;
    this.cam.updateProjectionMatrix();
  }
}
