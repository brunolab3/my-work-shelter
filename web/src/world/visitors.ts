// Visitantes: las sesiones de Claude Code abiertas fuera del refugio (una terminal, la app de Claude) en la carpeta de una
// sala o en sus worktrees se asoman como un solo robot por sala, junto al paso: nunca como un habitante. Con E o clic, al
// intercomunicador del habitante de la sala con la lista de esas sesiones (la más reciente arriba), para retomar cualquiera.
import * as THREE from 'three';
import type { Refugio } from './refugio';
import type { Sala } from './salas/comun';
import { Character } from './personaje';
import { vivo } from '../red/cliente';
import { SFX } from '../audio/sonido';
import type { Visitante } from '@shared/protocolo';
import { lookOf, type Look } from '@shared/aspecto';
import { t } from '@shared/idioma';

// robots grandes (mechas de guardia, algo más grandes que los ayudantes): la chapa, de un color por sala
const CHAPAS = ['#8d939b', '#5b6068', '#2e6a9a', '#5a3f8a', '#b8732f'];
const ESCALA = 0.75;   // algo más que los ayudantes (0,62): que no llenen la sala
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
function robotLook(salaId: string): Look {
  const base = lookOf({ tipo: 'CombatMech' }), c = CHAPAS[hash(salaId) % CHAPAS.length];
  return { ...base, colores: { ...base.colores, torso1: c, cabeza1: c } };
}

interface Figure { sesiones: Visitante[]; p: Character; sala: Sala; listo: boolean }

export class Visitors {
  figuras = new Map<string, Figure>();   // por sala
  constructor(private r: Refugio) { vivo.subscribe(() => this.sincronizar()); }

  sincronizar() {
    if (!this.r.salas.length) return;
    const porSala = new Map<string, Visitante[]>();
    for (const v of vivo.get().visitantes ?? []) porSala.set(v.salaId, [...(porSala.get(v.salaId) ?? []), v]);
    for (const [salaId, sesiones] of porSala) {
      const sala = this.r.salas.find(s => s.id === salaId); if (!sala) continue;
      const ya = this.figuras.get(salaId);
      if (ya && ya.sala !== sala) this.mudar(ya, sala);
      if (ya) { if (ya.listo && sesiones.some(v => !ya.sesiones.some(x => x.claudeId === v.claudeId))) this.llamar(ya); ya.sesiones = sesiones; continue; }
      this.crear(sesiones, sala);
    }
    for (const [id, f] of this.figuras) if (!porSala.has(id)) this.leave(f);
  }

  private async crear(sesiones: Visitante[], sala: Sala) {
    const p = new Character('CombatMech', robotLook(sala.id));
    const f: Figure = { sesiones, p, sala, listo: false };
    this.figuras.set(sala.id, f);
    await p.cargar();
    p.raiz.scale.setScalar(ESCALA);
    const lado = sala.lado === 'izq' ? 1 : -1;
    p.raiz.position.set(sala.grupo.position.x + lado * (sala.ancho / 2 + 0.4), sala.grupo.position.y, 1.3);
    this.r.motor.scene.add(p.raiz);
    // (si la sala se volvió a montar mientras cargaba, a la nueva)
    const destino = this.puesto(f.sala);
    p.goA([destino], false, () => { f.listo = true; p.goalTurn = -lado * 0.6; p.inRest = 'Idle_B'; p.reproducir('Idle_B'); this.llamar(f); });
    SFX.roomGate();
    this.rotular(f.sala);
  }

  // junto al paso, por dentro de la sala
  private puesto(sala: Sala) { const lado = sala.lado === 'izq' ? 1 : -1; return new THREE.Vector3(sala.grupo.position.x + lado * (sala.ancho / 2 - 1.1), sala.grupo.position.y, 1.45); }
  // su punto de uso (E o clic) vive en la sala: una sala que se vuelve a montar (un vecino nuevo, otro número, un
  // decorado) es otro objeto sin él, y el robot se quedaría a la vista sin poder usarse
  private rotular(sala: Sala) {
    const x = this.puesto(sala).x - sala.grupo.position.x;
    sala.interactive = [...(sala.interactive ?? []).filter(i => i.id !== 'vis:' + sala.id), { id: 'vis:' + sala.id, x, z: 1.45, texto: t('world.visitorOutside'), panel: 'visitante' }];
  }
  private mudar(f: Figure, sala: Sala) {
    f.sala = sala; this.rotular(sala);
    // si la sala cambió de sitio, el robot va con ella
    if (f.listo && f.p.raiz.position.distanceTo(this.puesto(sala)) > 0.5) { f.p.ruta = []; f.p.onArrive = null; f.p.raiz.position.copy(this.puesto(sala)); }
  }

  // al llegar (o si se asoma otra sesión más) salta y saluda para que se le vea
  private llamar(f: Figure) { f.p.saltar(() => f.p.gesture('Waving', 'Idle_B')); }

  private leave(f: Figure) {
    this.figuras.delete(f.sala.id);
    f.sala.interactive = (f.sala.interactive ?? []).filter(i => i.id !== 'vis:' + f.sala.id);
    const lado = f.sala.lado === 'izq' ? 1 : -1;
    f.p.goA([new THREE.Vector3(f.sala.grupo.position.x + lado * (f.sala.ancho / 2 + 0.6), f.sala.grupo.position.y, 1.3)], false, () => this.r.motor.scene.remove(f.p.raiz));
  }

  actualizar(dt: number) { for (const f of this.figuras.values()) if (f.p.mixer) f.p.actualizar(dt); }

  // un solo letrero por visitante: a mano (E) o bajo el ratón (clic), con cuántas sesiones hay fuera
  etiquetas(lejos: boolean, near?: string, aimed?: string) {
    return [...this.figuras.values()].filter(f => f.p.mixer).map(f => {
      const id = 'vis:' + f.sala.id, cerca = id === near || id === aimed, n = f.sesiones.length;
      return { k: f, pos: f.p.headPoint(), alto: 0.2, nombre: n > 1 ? `${t('world.visitor')} · ${n}` : t('world.visitor'), estado: 'ocioso', detalle: cerca ? (n > 1 ? t('world.nSessionsOutside', { n }) : t('world.sessionOpenOutside')) : '', cerca, lejos, prompt: cerca ? t('world.seeSessions') : '', tecla: id === near ? 'E' : t('world.click'), apuntado: id === aimed };
    });
  }
}
