// Etiquetas sobre la cabeza de los habitantes: una línea (glifo de estado + nombre + detalle), proyectadas cada fotograma.
import * as THREE from 'three';
import type { Dweller } from './dweller';
import { live } from '../net/client';
import { soonestByPlace, describeWhenShort } from '@shared/scheduled';
import { t } from '@shared/language';

// The ⏰ on a dweller (its room's main copy) or a hologram (its worktree) with a scheduled message pending, with when the
// next one is due: seen in the shelter before opening its conversation. Worked out again when the list or the repos
// change, and each minute (the short date depends on today)
let marks: { list: unknown; repos: unknown; minute: number; m: Map<string, string> } | undefined;
export function scheduledMark(roomId: string, worktree?: string): string | undefined {
  const { scheduled, repos } = live.get(), minute = Math.floor(Date.now() / 60_000);
  if (!marks || marks.list !== scheduled || marks.repos !== repos || marks.minute !== minute) {
    const m = new Map<string, string>();
    for (const [k, x] of soonestByPlace(scheduled, id => repos[id]?.worktrees ?? [])) m.set(k, t('world.scheduledMark', { cuando: describeWhenShort(x.when) }));
    marks = { list: scheduled, repos, minute, m };
  }
  return marks.m.get(`${roomId}|${worktree ?? ''}`);
}

const GLYPH: Record<string, string> = { durmiendo: 'z', ocioso: '·', pensando: '…', trabajando: '⚙', esperando: '?', terminado: '✓', error: '✕' };

export class TagsLayer {
  root: HTMLDivElement;
  private map = new Map<Dweller | object, { el: HTMLDivElement; name: HTMLSpanElement; detail: HTMLSpanElement; glyph: HTMLSpanElement; prompt: HTMLSpanElement; scheduled: HTMLSpanElement; epic: HTMLSpanElement; key: string }>();
  constructor() {
    this.root = document.createElement('div'); this.root.id = 'etiquetas';
    document.body.appendChild(this.root);
  }
  private create(k: object) {
    const el = document.createElement('div'); el.className = 'etiqueta';
    const glyph = document.createElement('span'); glyph.className = 'glifo';
    const name = document.createElement('span'); const detail = document.createElement('span'); detail.className = 'detalle';
    const prompt = document.createElement('span'); prompt.className = 'prompt';
    const scheduled = document.createElement('span'); scheduled.className = 'programado';
    const epic = document.createElement('span'); epic.className = 'marca-epica';
    el.append(glyph, epic, name, scheduled, detail, prompt); this.root.appendChild(el);
    const e = { el, name, detail, glyph, prompt, scheduled, epic, key: '' }; this.map.set(k, e); return e;
  }
  update(cam: THREE.PerspectiveCamera, items: { k: object; pos: THREE.Vector3; height: number; name: string; state: string; detail: string; near: boolean; supervisor?: boolean; device?: boolean; prompt?: string; key?: string; farSide?: boolean; aimed?: boolean; color?: string; epic?: { color: string; title: string }; scheduled?: string }[]) {
    const w = innerWidth, h = innerHeight; const v = new THREE.Vector3();
    const seen = new Set<object>();
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const it of items) {
      seen.add(it.k);
      const e = this.map.get(it.k) ?? this.create(it.k);
      const key = (it.color ?? '') + '|' + it.state + '|' + it.name + '|' + it.detail + '|' + it.near + '|' + it.prompt + '|' + it.key + '|' + it.farSide + '|' + it.aimed + '|' + (it.scheduled ?? '') + '|' + (it.epic ? it.epic.color + it.epic.title : '');
      if (key !== e.key) {
        e.key = key;
        e.el.className = 'etiqueta ' + it.state + (it.supervisor ? ' supervisor' : '') + (it.device ? ' de-aparato' : '') + (it.near ? ' cerca' : '') + (it.farSide && !it.aimed ? ' solo-glifo' : '');
        e.prompt.innerHTML = it.prompt ? `<span class="tecla">${it.key ?? 'E'}</span> ${it.prompt}` : ''; e.prompt.style.display = it.prompt ? '' : 'none';
        e.glyph.textContent = it.supervisor ? '★' : it.device ? '⚙' : GLYPH[it.state] ?? '·';
        e.el.style.setProperty('--tarea', it.color ?? 'transparent'); e.el.classList.toggle('con-tarea', !!it.color);   // la copia de una tarea, con su color
        e.name.textContent = it.name; e.detail.textContent = it.detail; e.detail.style.display = it.detail ? '' : 'none';
        e.scheduled.textContent = it.scheduled ?? ''; e.scheduled.style.display = it.scheduled ? '' : 'none';
        // the copy's task belongs to an epic: a small diamond in the epic's color (shared with the tabs and boards)
        e.epic.style.display = it.epic ? '' : 'none'; e.epic.style.setProperty('--epica', it.epic?.color ?? 'transparent'); e.epic.title = it.epic?.title ?? '';
      }
      v.copy(it.pos); v.y += it.height + 0.25; v.project(cam);
      if (v.z > 1) { if (e.el.style.display !== 'none') e.el.style.display = 'none'; continue; }
      if (e.el.style.display) e.el.style.display = '';
      // las etiquetas que chocan con otra ya colocada suben hasta quedar libres
      if (e.key !== (e as any).measured) { (e as any).measured = e.key; (e as any).width = e.el.offsetWidth; (e as any).height = e.el.offsetHeight; }
      const an = (e as any).width ?? 80, lh = (e as any).height ?? 20;
      const sx = (v.x + 1) / 2 * w; let sy = (1 - v.y) / 2 * h;
      for (let k = 0; k < 4; k++) {
        const r = { x0: sx - an / 2, x1: sx + an / 2, y0: sy - lh, y1: sy };
        const choca = placed.find(q => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0);
        if (!choca) break;
        sy = choca.y0 - 3;
      }
      placed.push({ x0: sx - an / 2, x1: sx + an / 2, y0: sy - lh, y1: sy });
      // solo se toca el DOM si se ha movido de verdad (cada escritura cuesta un recálculo de estilo)
      const tr = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px) translate(-50%, -100%)`;
      if ((e as any).tr !== tr) { (e as any).tr = tr; e.el.style.transform = tr; }
    }
    for (const [k, e] of this.map) if (!seen.has(k)) { e.el.remove(); this.map.delete(k); }
  }
}
