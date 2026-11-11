// Visitantes: una sesión de Claude Code abierta fuera del refugio (una terminal, la app de Claude) en la carpeta de una sala
// o en uno de sus worktrees aparece como un extraterrestre que se ha asomado junto al paso: nunca como un habitante. Si
// es de un worktree con tarea, lleva el color de la tarea en el traje y en el letrero (como su holograma). Con E: traer su
// conversación al refugio, en su worktree.
import * as THREE from 'three';
import type { Refugio } from './refugio';
import type { Sala } from './salas/comun';
import { Character } from './personaje';
import { vivo } from '../red/cliente';
import { SFX } from '../audio/sonido';
import type { Visitante } from '@shared/protocolo';
import { lookOf, type Look } from '@shared/aspecto';
import { taskColor, worktreeTask } from '@shared/tareas';
import { t } from '@shared/idioma';

// robots grandes (mechas de guardia, algo más grandes que los ayudantes): la chapa, de un color por conversación o, si es de
// un worktree con tarea, del de la tarea (y su luz también)
const CHAPAS = ['#8d939b', '#5b6068', '#2e6a9a', '#5a3f8a', '#b8732f'];
const ESCALA = 0.75;   // algo más que los ayudantes (0,62): que no llenen la sala
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
function robotLook(v: Visitante, color?: string): Look {
  const base = lookOf({ tipo: 'CombatMech' });
  return { ...base, colores: { ...base.colores, torso1: color ?? CHAPAS[hash(v.claudeId) % CHAPAS.length], cabeza1: color ?? CHAPAS[hash(v.claudeId) % CHAPAS.length], ...(color ? { luz: color } : {}) } };
}
// la tarea del worktree de un visitante (para su color), si la tiene
function tareaDe(v: Visitante) {
  if (!v.worktree) return undefined;
  const w = vivo.get().repos[v.salaId]?.worktrees.find(x => x.ruta === v.worktree);
  return worktreeTask({ ruta: v.worktree, rama: w?.rama });
}

interface Figure { v: Visitante; p: Character; sala: Sala; listo: boolean }

export class Visitors {
  figuras = new Map<string, Figure>();
  constructor(private r: Refugio) { vivo.subscribe(() => this.sincronizar()); }

  private sincronizar() {
    if (!this.r.salas.length) return;
    const lista = vivo.get().visitantes ?? [];
    const ids = new Set(lista.map(v => v.claudeId));
    for (const v of lista) {
      const sala = this.r.salas.find(s => s.id === v.salaId); if (!sala) continue;
      const ya = this.figuras.get(v.claudeId); if (ya) { ya.v = v; continue; }
      this.crear(v, sala);
    }
    for (const [id, f] of this.figuras) if (!ids.has(id)) this.leave(f);
  }

  private async crear(v: Visitante, sala: Sala) {
    const tarea = tareaDe(v), color = tarea ? taskColor(tarea) : undefined;
    const p = new Character('CombatMech', robotLook(v, color));
    const f: Figure = { v, p, sala, listo: false };
    this.figuras.set(v.claudeId, f);
    await p.cargar();
    p.raiz.scale.setScalar(ESCALA);
    const lado = sala.lado === 'izq' ? 1 : -1;
    const n = [...this.figuras.values()].filter(x => x.sala === sala).length - 1;
    p.raiz.position.set(sala.grupo.position.x + lado * (sala.ancho / 2 + 0.4), sala.grupo.position.y, 1.3);
    this.r.motor.scene.add(p.raiz);
    const destino = new THREE.Vector3(sala.grupo.position.x + lado * (sala.ancho / 2 - 1.1 - n * 0.9), sala.grupo.position.y, 1.45);
    p.goA([destino], false, () => { f.listo = true; p.goalTurn = -lado * 0.6; p.inRest = 'Idle_B'; p.reproducir('Idle_B'); });
    SFX.roomGate();
    sala.interactive = [...(sala.interactive ?? []).filter(i => i.id !== 'vis:' + v.claudeId), { id: 'vis:' + v.claudeId, x: destino.x - sala.grupo.position.x, z: 1.45, texto: t(v.worktree ? 'world.visitorOutsideWorktree' : 'world.visitorOutside'), panel: 'visitante' }];
  }

  private leave(f: Figure) {
    this.figuras.delete(f.v.claudeId);
    f.sala.interactive = (f.sala.interactive ?? []).filter(i => i.id !== 'vis:' + f.v.claudeId);
    const lado = f.sala.lado === 'izq' ? 1 : -1;
    f.p.goA([new THREE.Vector3(f.sala.grupo.position.x + lado * (f.sala.ancho / 2 + 0.6), f.sala.grupo.position.y, 1.3)], false, () => this.r.motor.scene.remove(f.p.raiz));
  }

  actualizar(dt: number) { for (const f of this.figuras.values()) if (f.p.mixer) f.p.actualizar(dt); }

  etiquetas(lejos: boolean, junto: THREE.Vector3) {
    return [...this.figuras.values()].filter(f => f.p.mixer).map(f => {
      const tarea = tareaDe(f.v);
      return { k: f, pos: f.p.headPoint(), alto: 0.2, nombre: tarea ? `${t('world.visitor')} · ${tarea}` : t('world.visitor'), estado: 'ocioso', detalle: f.p.raiz.position.distanceTo(junto) < 2.4 ? t('world.sessionOpenOutside') : '', cerca: false, lejos, ...(tarea ? { color: taskColor(tarea) } : {}) };
    });
  }
}
