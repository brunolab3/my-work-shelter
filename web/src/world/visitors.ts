// Visitantes: las sesiones de Claude Code abiertas fuera del refugio (una terminal, la app de Claude) en la carpeta de una
// sala o en sus worktrees se asoman como un solo robot por sala, junto al paso: nunca como un habitante. Con E o clic, al
// intercomunicador del habitante de la sala con la lista de esas sesiones (la más reciente arriba), para retomar cualquiera.
import * as THREE from 'three';
import type { Shelter } from './shelter';
import type { Room } from './rooms/common';
import { Character } from './character';
import { visitorX } from './copySpot';
import { live } from '../net/client';
import { SFX } from '../audio/sound';
import type { Visitor } from '@shared/protocol';
import { lookOf, type Look } from '@shared/appearance';
import { t } from '@shared/language';

// robots grandes (mechas de guardia, algo más grandes que los ayudantes): la chapa, de un color por sala
const BODYSHOPS = ['#8d939b', '#5b6068', '#2e6a9a', '#5a3f8a', '#b8732f'];
const SCALE = 0.75;   // algo más que los ayudantes (0,62): que no llenen la sala
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
function robotLook(roomId: string): Look {
  const base = lookOf({ type: 'CombatMech' }), c = BODYSHOPS[hash(roomId) % BODYSHOPS.length];
  return { ...base, colors: { ...base.colors, torso1: c, cabeza1: c } };
}

interface Figure { sessions: Visitor[]; p: Character; room: Room; ready: boolean }

export class Visitors {
  figures = new Map<string, Figure>();   // por sala
  constructor(private r: Shelter) { live.subscribe(() => this.sync()); }

  sync() {
    if (!this.r.rooms.length) return;
    const byRoom = new Map<string, Visitor[]>();
    for (const v of live.get().visitors ?? []) byRoom.set(v.roomId, [...(byRoom.get(v.roomId) ?? []), v]);
    for (const [roomId, sessions] of byRoom) {
      const room = this.r.rooms.find(s => s.id === roomId); if (!room) continue;
      const already = this.figures.get(roomId);
      if (already && already.room !== room) this.relocate(already, room);
      if (already) { if (already.ready && sessions.some(v => !already.sessions.some(x => x.claudeId === v.claudeId))) this.call(already); already.sessions = sessions; continue; }
      this.create(sessions, room);
    }
    for (const [id, f] of this.figures) if (!byRoom.has(id)) this.leave(f);
  }

  private async create(sessions: Visitor[], room: Room) {
    const p = new Character('CombatMech', robotLook(room.id));
    const f: Figure = { sessions, p, room, ready: false };
    this.figures.set(room.id, f);
    await p.load();
    p.root.scale.setScalar(SCALE);
    const side = room.side === 'izq' ? 1 : -1;
    p.root.position.set(room.group.position.x + side * (room.width / 2 + 0.4), room.group.position.y, 1.3);
    this.r.motor.scene.add(p.root);
    // (si la sala se volvió a montar mientras cargaba, a la nueva)
    const target = this.workstation(f.room);
    p.goA([target], false, () => { f.ready = true; p.goalTurn = -side * 0.6; p.inRest = 'Idle_B'; p.play('Idle_B'); this.call(f); });
    SFX.roomGate();
    this.label(f.room);
  }

  // junto al paso, por dentro de la sala
  private workstation(room: Room) { return new THREE.Vector3(room.group.position.x + visitorX(room), room.group.position.y, 1.45); }
  // su punto de uso (E o clic) vive en la sala: una sala que se vuelve a montar (un vecino nuevo, otro número, un
  // decorado) es otro objeto sin él, y el robot se quedaría a la vista sin poder usarse
  private label(room: Room) {
    const x = this.workstation(room).x - room.group.position.x;
    room.interactive = [...(room.interactive ?? []).filter(i => i.id !== 'vis:' + room.id), { id: 'vis:' + room.id, x, z: 1.45, text: t('world.visitorOutside'), panel: 'visitante' }];
  }
  private relocate(f: Figure, room: Room) {
    f.room = room; this.label(room);
    // si la sala cambió de sitio, el robot va con ella
    if (f.ready && f.p.root.position.distanceTo(this.workstation(room)) > 0.5) { f.p.path = []; f.p.onArrive = null; f.p.root.position.copy(this.workstation(room)); }
  }

  // al llegar (o si se asoma otra sesión más) salta y saluda para que se le vea
  private call(f: Figure) { f.p.seek(() => f.p.gesture('Waving', 'Idle_B')); }

  private leave(f: Figure) {
    this.figures.delete(f.room.id);
    f.room.interactive = (f.room.interactive ?? []).filter(i => i.id !== 'vis:' + f.room.id);
    const side = f.room.side === 'izq' ? 1 : -1;
    f.p.goA([new THREE.Vector3(f.room.group.position.x + side * (f.room.width / 2 + 0.6), f.room.group.position.y, 1.3)], false, () => this.r.motor.scene.remove(f.p.root));
  }

  update(dt: number) { for (const f of this.figures.values()) if (f.p.mixer) f.p.update(dt); }

  // un solo letrero por visitante: a mano (E) o bajo el ratón (clic), con cuántas sesiones hay fuera
  labels(farSide: boolean, near?: string, aimed?: string) {
    return [...this.figures.values()].filter(f => f.p.mixer).map(f => {
      const id = 'vis:' + f.room.id, isNear = id === near || id === aimed, n = f.sessions.length;
      return { k: f, pos: f.p.headPoint(), height: 0.2, name: n > 1 ? `${t('world.visitor')} · ${n}` : t('world.visitor'), state: 'ocioso', detail: isNear ? (n > 1 ? t('world.nSessionsOutside', { n }) : t('world.sessionOpenOutside')) : '', near: isNear, farSide, prompt: isNear ? t('world.seeSessions') : '', key: id === near ? 'E' : t('world.click'), aimed: id === aimed };
    });
  }
}
