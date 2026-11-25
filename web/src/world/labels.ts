// Etiquetas sobre la cabeza de los habitantes: una línea (glifo de estado + nombre + detalle), proyectadas cada fotograma.
import * as THREE from 'three';
import type { Dweller } from './dweller';
import { live } from '../net/client';
import { soonestByPlace, describeWhenShort } from '@shared/scheduled';
import { t } from '@shared/language';
import { queuedIn } from '@shared/messageQueue';
import { flaggedIds, flaggedIn, flagMark } from '@shared/flagged';
import type { SessionSummary } from '@shared/protocol';
import { placeTags, type PlacedTag, type TagBox } from './tagPlacement';

// The ✉ n on a dweller or a hologram whose conversations have messages they have not taken yet (shared/messageQueue.ts)
export function queuedMark(sessions: SessionSummary[]): string | undefined {
  const n = queuedIn(sessions);
  return n ? t('windows.queue.mark', { n }) : undefined;
}

// The ⚑ (or ⚑ n) on a dweller or a hologram with conversations the Overseer marked as pending (shared/flagged.ts)
export function flaggedMark(sessions: SessionSummary[]): string | undefined {
  return flagMark(flaggedIn(sessions, flaggedIds(live.get().state?.settings)));
}

// The ⏰ on a dweller (its room's main copy) or a hologram (its worktree) with a scheduled message pending, with when the
// next one is due: seen in the shelter before opening its conversation. Worked out again when the list or the repos
// change, and each minute (the short date depends on today)
let marks: { list: unknown; repos: unknown; minute: number; m: Map<string, string> } | undefined;
export function scheduledMark(roomId: string, worktree?: string): string | undefined {
  const { scheduled, repos } = live.get(), minute = Math.floor(Date.now() / 60_000);
  if (!marks || marks.list !== scheduled || marks.repos !== repos || marks.minute !== minute) {
    const m = new Map<string, string>();
    for (const [k, x] of soonestByPlace(scheduled, id => repos[id]?.worktrees ?? [])) m.set(k, t('world.scheduledMark', { when: describeWhenShort(x.when) }));
    marks = { list: scheduled, repos, minute, m };
  }
  return marks.m.get(`${roomId}|${worktree ?? ''}`);
}

const GLYPH: Record<string, string> = { sleeping: 'z', idle: '·', thinking: '…', working: '⚙', waiting: '?', finished: '✓', error: '✕' };

export class TagsLayer {
  root: HTMLDivElement;
  private map = new Map<Dweller | object, { el: HTMLDivElement; name: HTMLSpanElement; detail: HTMLSpanElement; glyph: HTMLSpanElement; prompt: HTMLSpanElement; scheduled: HTMLSpanElement; queued: HTMLSpanElement; flagged: HTMLSpanElement; epic: HTMLSpanElement; task: HTMLSpanElement; key: string }>();
  // where each tag was drawn last frame (screen pixels), to tell which one the pointer is over
  private drawn: PlacedTag[] = [];
  constructor() {
    this.root = document.createElement('div'); this.root.id = 'labels';
    document.body.appendChild(this.root);
  }
  private create(k: object) {
    const el = document.createElement('div'); el.className = 'label';
    const glyph = document.createElement('span'); glyph.className = 'glyph';
    const name = document.createElement('span'); const detail = document.createElement('span'); detail.className = 'detail';
    const prompt = document.createElement('span'); prompt.className = 'prompt';
    const scheduled = document.createElement('span'); scheduled.className = 'scheduled';
    const queued = document.createElement('span'); queued.className = 'queued';
    const flagged = document.createElement('span'); flagged.className = 'pending';
    const epic = document.createElement('span'); epic.className = 'epic-mark';
    const task = document.createElement('span'); task.className = 'task';
    el.append(glyph, epic, task, name, scheduled, queued, flagged, detail, prompt); this.root.appendChild(el);
    const e = { el, name, detail, glyph, prompt, scheduled, queued, flagged, epic, task, key: '' }; this.map.set(k, e); return e;
  }
  update(cam: THREE.PerspectiveCamera, items: { k: object; pos: THREE.Vector3; height: number; name: string; state: string; detail: string; near: boolean; supervisor?: boolean; device?: boolean; prompt?: string; key?: string; farSide?: boolean; aimed?: boolean; color?: string; epic?: { color: string; title: string }; task?: string; scheduled?: string; queued?: string; flagged?: string }[]) {
    const w = innerWidth, h = innerHeight; const v = new THREE.Vector3();
    const seen = new Set<object>();
    const boxes: TagBox[] = [];
    for (const it of items) {
      seen.add(it.k);
      const e = this.map.get(it.k) ?? this.create(it.k);
      const key = (it.color ?? '') + '|' + it.state + '|' + it.name + '|' + it.detail + '|' + it.near + '|' + it.prompt + '|' + it.key + '|' + it.farSide + '|' + it.aimed + '|' + (it.scheduled ?? '') + '|' + (it.queued ?? '') + '|' + (it.flagged ?? '') + '|' + (it.epic ? it.epic.color + it.epic.title : '') + '|' + (it.task ?? '');
      if (key !== e.key) {
        e.key = key;
        e.el.className = 'label ' + it.state + (it.supervisor ? ' supervisor' : '') + (it.device ? ' of-device' : '') + (it.near ? ' near' : '') + (it.farSide && !it.aimed ? ' glyph-only' : '');
        e.prompt.innerHTML = it.prompt ? `<span class="tecla">${it.key ?? 'E'}</span> ${it.prompt}` : ''; e.prompt.style.display = it.prompt ? '' : 'none';
        e.glyph.textContent = it.supervisor ? '★' : it.device ? '⚙' : GLYPH[it.state] ?? '·';
        e.el.style.setProperty('--task', it.color ?? 'transparent'); e.el.classList.toggle('with-task', !!it.color);   // la copia de una tarea, con su color
        // a hologram's task, kept when the tag shrinks to its glyph: which task each worktree is, at a glance
        e.task.textContent = it.task ?? ''; e.task.style.display = it.task ? '' : 'none';
        e.name.textContent = it.name; e.detail.textContent = it.detail; e.detail.style.display = it.detail ? '' : 'none';
        e.scheduled.textContent = it.scheduled ?? ''; e.scheduled.style.display = it.scheduled ? '' : 'none';
        e.queued.textContent = it.queued ?? ''; e.queued.style.display = it.queued ? '' : 'none';
        e.flagged.textContent = it.flagged ?? ''; e.flagged.style.display = it.flagged ? '' : 'none';
        // the copy's task belongs to an epic: a small diamond in the epic's color (shared with the tabs and boards)
        e.epic.style.display = it.epic ? '' : 'none'; e.epic.style.setProperty('--epic', it.epic?.color ?? 'transparent'); e.epic.title = it.epic?.title ?? '';
      }
      v.copy(it.pos); v.y += it.height + 0.25; v.project(cam);
      if (v.z > 1) { if (e.el.style.display !== 'none') e.el.style.display = 'none'; continue; }
      if (e.el.style.display) e.el.style.display = '';
      if (e.key !== (e as any).measured) { (e as any).measured = e.key; (e as any).width = e.el.offsetWidth; (e as any).height = e.el.offsetHeight; }
      boxes.push({ k: it.k, x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, width: (e as any).width ?? 80, height: (e as any).height ?? 20, aimed: it.aimed, lift: it.aimed ? (e as any).lift : undefined });
    }
    // tags that collide climb until free; a pointed one stays put under the pointer (tagPlacement.ts)
    const placed = placeTags(boxes);
    for (const q of placed) {
      const e = this.map.get(q.k)!; (e as any).lift = q.lift;
      // the DOM is only touched if it really moved (each write costs a style recalculation)
      const tr = `translate(${((q.x0 + q.x1) / 2).toFixed(0)}px, ${q.y1.toFixed(0)}px) translate(-50%, -100%)`;
      if ((e as any).tr !== tr) { (e as any).tr = tr; e.el.style.transform = tr; }
    }
    for (const [k, e] of this.map) if (!seen.has(k)) { e.el.remove(); this.map.delete(k); }
    this.drawn = placed;
  }
  /** The tag under a screen point (as drawn last frame), with a few pixels of slack */
  at(x: number, y: number) {
    return this.drawn.find(q => x > q.x0 - 4 && x < q.x1 + 4 && y > q.y0 - 4 && y < q.y1 + 8)?.k;
  }
}
