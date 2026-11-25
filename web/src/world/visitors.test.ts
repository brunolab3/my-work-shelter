import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

// the robot's model, the network store and the sounds, stubbed: what matters is when it walks out and leaves the scene
const state = vi.hoisted(() => ({ visitors: [] as unknown[], listeners: [] as (() => void)[], loads: [] as (() => void)[] }));
vi.mock('./character', () => ({
  Character: class {
    root = new THREE.Object3D(); mixer: unknown; path: THREE.Vector3[] = []; onArrive: (() => void) | null = null;
    goalTurn = 0; inRest = ''; play() {} seek() {} gesture() {} headPoint() { return new THREE.Vector3(); }
    load() { return new Promise<void>(res => state.loads.push(() => { this.mixer = {}; res(); })); }
    goA(p: THREE.Vector3[], _run: boolean, cb: (() => void) | null) { this.path = p; this.onArrive = cb; }
    // one update reaches the goal
    update() { if (!this.path.length) return; this.path = []; const cb = this.onArrive; this.onArrive = null; cb?.(); }
  },
}));
vi.mock('../net/client', () => ({ live: { get: () => ({ visitors: state.visitors }), subscribe: (f: () => void) => state.listeners.push(f) } }));
vi.mock('../audio/sound', () => ({ SFX: { roomGate() {} } }));
vi.mock('./copySpot', () => ({ visitorX: () => 0 }));
const { Visitors } = await import('./visitors');

const visitor = { claudeId: 'c1', roomId: 'r1', cwd: '/x', title: '', modified: 0 };
const setup = () => {
  const scene = new THREE.Scene();
  const room = { id: 'r1', side: 'left', width: 10, group: new THREE.Group(), interactive: [] };
  const v = new Visitors({ rooms: [room], motor: { scene } } as any);
  const set = (vs: unknown[]) => { state.visitors = vs; v.sync(); };
  const loaded = async () => { for (const l of state.loads.splice(0)) l(); await new Promise(r => setTimeout(r)); };
  return { scene, room, v, set, loaded };
};

describe('Visitors', () => {
  beforeEach(() => { state.visitors = []; state.loads = []; });

  it('walks out and leaves the scene once its sessions are brought in', async () => {
    const { scene, room, v, set, loaded } = setup();
    set([visitor]); await loaded(); v.update(0.1);
    expect(scene.children).toHaveLength(1);
    set([]);
    expect(room.interactive).toHaveLength(0);
    v.update(0.1);
    expect(scene.children).toHaveLength(0);
  });

  it('never comes in when its sessions go away while it loads', async () => {
    const { scene, v, set, loaded } = setup();
    set([visitor]); set([]); await loaded(); v.update(0.1);
    expect(scene.children).toHaveLength(0);
    expect(v.figures.size).toBe(0);
  });

  it('a new visitor in the room while the old robot walks out gets its own robot', async () => {
    const { scene, v, set, loaded } = setup();
    set([visitor]); await loaded();
    set([]); set([{ ...visitor, claudeId: 'c2' }]); await loaded();
    v.update(0.1);
    expect(scene.children).toHaveLength(1);
    expect(v.figures.get('r1')?.sessions[0]).toMatchObject({ claudeId: 'c2' });
  });
});
