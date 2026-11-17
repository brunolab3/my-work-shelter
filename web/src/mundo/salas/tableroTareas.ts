// The task board of a repo room: the room's one meaningful screen, on the back wall (its spot: boardSpot in
// shared/decorado.ts). One row for the main copy and one per worktree (shared/tableroSala.ts) with its task color, key
// and title, branch, what its conversations are doing or waiting on, and one state for its PRs in this repo. One canvas
// texture, redrawn only when what it shows changes; a click on a row talks to that copy (refugio.ts, `rowAt`).
import * as THREE from 'three';
import { t } from '@shared/idioma';
import { lienzo, textureOf, SOURCES } from '../../motor/texturas';
import { vivo } from '../../red/cliente';
import { boardRows, type BoardRow, type PRRollup, type SessionMark } from '@shared/tableroSala';
import type { BoardSpot } from '@shared/decorado';
import type { PRBoard } from '@shared/tablero';
import { taskColor } from '@shared/tareas';
import { jiraBoard, knowTasks, myPRs, taskTitle } from '../../ui/tareas';
import { branchCaption } from '../../ui/copias';
import { caja, materialSteel, type Contexto } from './comun';

const W = 1280;
const INK = '#dcf2e2', DIM = '#8fae9c', BACKGROUND = '#07110b', CARD = '#0f1d14';
const SESSION_COLOR: Record<SessionMark, string> = { esperando: '#ffb000', error: '#ff5a4a', trabajando: '#5dff8a', listo: '#7fd4ff', abierta: '#8aa79a' };
const PR_COLOR: Record<PRRollup, string> = { ci: '#ff5a4a', conflictos: '#ff5a4a', cambios: '#ff9a3a', revision: '#ffd24a', aprobado: '#5dff8a', borrador: '#8a9a90', fusionado: '#b48cff', cerrado: '#7a7a7a' };

/** What a row says and how it's labelled when pointed at */
export interface ShownRow extends BoardRow { titulo?: string; color: string }

export class TaskBoard {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture;
  private firma = ''; private filas: { row: ShownRow; y0: number; y1: number }[] = [];
  constructor(spot: BoardSpot, private color: string) {
    ({ c: this.c, g: this.g } = lienzo(W, Math.round(W * spot.alto / spot.ancho))); this.tex = textureOf(this.c);
  }
  /** The rows it shows now, top to bottom (QA) */
  shown(): ShownRow[] { return this.filas.map(f => f.row); }
  /** The row under a point of the board (its uv), if any */
  rowAt(uv: THREE.Vector2): ShownRow | null { const y = (1 - uv.y) * this.c.height; return this.filas.find(f => y >= f.y0 && y < f.y1)?.row ?? null; }

  poner(rows: ShownRow[], quien: string) {
    const f = JSON.stringify([rows, quien]); if (f === this.firma) return; this.firma = f;
    const { g } = this; const H = this.c.height, col = this.color;
    g.fillStyle = BACKGROUND; g.fillRect(0, 0, W, H); g.textBaseline = 'top'; g.textAlign = 'left';
    // header: the title and how many need you or are working
    const wts = rows.filter(r => !r.principal);
    g.fillStyle = col; g.font = `700 40px ${SOURCES.mono}`; g.shadowColor = col; g.shadowBlur = 10;
    g.fillText(t('world.taskBoard.title'), 28, 16); g.shadowBlur = 0;
    const esperan = rows.filter(r => r.sesion === 'esperando').length, trabajan = rows.filter(r => r.sesion === 'trabajando').length;
    const cuenta = [esperan && [t('world.taskBoard.nWaiting', { n: esperan }), SESSION_COLOR.esperando], trabajan && [t('world.taskBoard.nWorking', { n: trabajan }), SESSION_COLOR.trabajando], [t('world.taskBoard.nWorktrees', { n: wts.length }), DIM]].filter(Boolean) as [string, string][];
    g.font = `600 30px ${SOURCES.mono}`; g.textAlign = 'right';
    let xr = W - 28; for (const [txt, c] of cuenta.reverse()) { g.fillStyle = c; g.fillText(txt, xr, 22); xr -= g.measureText(txt).width + 28; }
    g.textAlign = 'left';
    // rows: taller (and with bigger type) when there are few, so they read from afar
    const y0 = 76, hueco = 8, avail = H - y0 - 14;
    const minimo = 88, cabe = Math.max(1, Math.floor((avail + hueco) / (minimo + hueco)));
    const vis = rows.length > cabe ? rows.slice(0, cabe - 1) : rows, mas = rows.length - vis.length;
    const n = vis.length + (mas ? 1 : 0);
    const fh = THREE.MathUtils.clamp((avail - (n - 1) * hueco) / n, minimo, 150), k = fh / 100;
    const f1 = Math.round(THREE.MathUtils.clamp(40 * k, 34, 48)), f2 = Math.round(THREE.MathUtils.clamp(30 * k, 26, 36));
    this.filas = [];
    vis.forEach((r, i) => {
      const y = y0 + i * (fh + hueco), x = 20, w = W - 40;
      this.filas.push({ row: r, y0: y, y1: y + fh });
      g.fillStyle = CARD; g.fillRect(x, y, w, fh);
      g.strokeStyle = r.sesion === 'esperando' ? SESSION_COLOR.esperando : r.color + '88'; g.lineWidth = r.sesion === 'esperando' ? 4 : 2; g.strokeRect(x + 1, y + 1, w - 2, fh - 2);
      g.fillStyle = r.color; g.fillRect(x, y, 12, fh);
      // badges on the right of the first line: the PRs' state, then the conversation's (the most urgent, outermost)
      const l1 = y + fh * 0.5 - f1 - 2, l2 = y + fh * 0.5 + 6;
      let xd = x + w - 14;
      g.font = `700 ${f2}px ${SOURCES.mono}`;
      const badge = (txt: string, c: string) => { const tw = g.measureText(txt).width + 18; xd -= tw; g.fillStyle = c + '30'; g.fillRect(xd, l1, tw, f1 + 4); g.strokeStyle = c; g.lineWidth = 2; g.strokeRect(xd + 1, l1 + 1, tw - 2, f1 + 2); g.fillStyle = c; g.fillText(txt, xd + 9, l1 + (f1 + 4 - f2) / 2); xd -= 12; };
      if (r.sesion) badge(t(`world.taskBoard.session.${r.sesion}`), SESSION_COLOR[r.sesion]);
      if (r.pr) badge(r.prs > 1 ? `${t(`world.taskBoard.pr.${r.pr}`)} ×${r.prs}` : t(`world.taskBoard.pr.${r.pr}`), PR_COLOR[r.pr]);
      // first line: the task (or the main copy) and its title
      const xt = x + 28;
      g.font = `700 ${f1}px ${SOURCES.mono}`; g.fillStyle = r.principal ? col : r.color;
      const clave = r.principal ? t('world.taskBoard.mainCopy') : r.clave ?? branchCaption(r.rama);
      g.fillText(fit(g, clave, xd - xt), xt, l1);
      const xk = xt + g.measureText(clave).width + 16;
      const titulo = r.principal ? quien : r.titulo;
      if (titulo && xk < xd - 60) { g.font = `500 ${f1}px ${SOURCES.mono}`; g.fillStyle = INK; g.fillText(fit(g, titulo, xd - xk), xk, l1); }
      // second line: the branch and what it's doing, waiting on, or how its copy is
      // (a worktree's branch only when it isn't the one named after it: that one says nothing the key doesn't)
      const propia = !r.principal && r.rama === 'worktree-' + r.ruta.split('/').pop();
      const rama = propia ? '' : `⑂ ${r.rama || t('windows.noBranch')}`;
      const estado = r.detalle ?? [r.cambios ? t('world.taskBoard.nUncommitted', { n: r.cambios }) : '', r.advanced ? t('world.taskBoard.nAhead', { n: r.advanced }) : ''].filter(Boolean).join(' · ');
      g.font = `500 ${f2}px ${SOURCES.mono}`; g.fillStyle = DIM;
      const ramaW = rama ? Math.min(g.measureText(rama).width, (w - 60) * 0.45) : 0;
      if (rama) g.fillText(fit(g, rama, ramaW), xt, l2);
      const xe = rama ? xt + ramaW + 14 : xt;
      if (estado) { g.fillStyle = r.detalle && r.sesion ? SESSION_COLOR[r.sesion] : DIM; g.fillText(fit(g, (rama ? '· ' : '') + estado, x + w - 20 - xe), xe, l2); }
    });
    if (mas) { const y = y0 + vis.length * (fh + hueco); g.fillStyle = col + '1c'; g.fillRect(20, y, W - 40, Math.min(fh, 60)); g.fillStyle = col; g.font = `600 26px ${SOURCES.mono}`; g.fillText(t('world.tex.nMore', { n: mas }), 44, y + 14); }
    if (!wts.length) { g.fillStyle = DIM; g.font = `500 30px ${SOURCES.mono}`; g.fillText(t('world.taskBoard.noWorktrees'), 28, Math.min(H - 40, y0 + fh + hueco + 14)); }
    for (let y = 0; y < H; y += 3) { g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(0, y, W, 1); }
    this.tex.needsUpdate = true;
  }
}

// a text cut to a width, with «…»
function fit(g: CanvasRenderingContext2D, s: string, ancho: number) {
  if (g.measureText(s).width <= ancho) return s;
  let u = s; while (u.length > 1 && g.measureText(u + '…').width > ancho) u = u.slice(0, -1);
  return u.trimEnd() + '…';
}

/** Hangs the room's task board at `spot` and keeps it up to date; returns its screen (a click on it picks a row) */
export function mountTaskBoard(ctx: Contexto, spot: BoardSpot): THREE.Mesh {
  const { g, v, zB, sala } = ctx;
  const board = new TaskBoard(spot, v.pantalla);
  g.add(caja(spot.ancho + 0.14, spot.alto + 0.14, 0.1, materialSteel('#1f1c19'), spot.x, spot.y, zB + 0.36));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(spot.ancho, spot.alto), new THREE.MeshStandardMaterial({ map: board.tex, emissiveMap: board.tex, emissive: '#ffffff', emissiveIntensity: 0.95, color: '#000' }));
  screen.position.set(spot.x, spot.y, zB + 0.42); screen.userData.estatico = false; g.add(screen);
  sala.userData.tableroTareas = { mesh: screen, board };
  // data: the room's worktrees and conversations (live), your PRs (shared, every two minutes) and the tasks' colors and
  // titles (they go in each row: a new one repaints it); it's checked every second and redrawn only when the rows change
  let prs: PRBoard[] = [], pedido = -1e9, espera = 0;
  ctx.alActualizar((dt, tt) => {
    if (tt - pedido > 30) { pedido = tt; myPRs().then(l => { prs = l; }).catch(() => {}); }
    espera -= dt; if (espera > 0) return; espera = 1;
    const e = vivo.get() as any;
    const r = e.repos?.[sala.id];
    const rows = boardRows(sala.id, sala.ruta ?? '', r?.worktrees ?? [], Object.values(e.sesiones ?? {}), jiraBoard.get().prs.length ? jiraBoard.get().prs : prs);
    knowTasks(rows.map(x => x.clave));
    const quien = (e.estado?.habitantes ?? []).find((h: any) => h.salaId === sala.id)?.nombre ?? '';
    board.poner(rows.map(x => ({ ...x, color: x.principal ? v.pantalla : taskColor(x.clave), ...(x.clave && taskTitle(x.clave) ? { titulo: taskTitle(x.clave) } : {}) })), quien);
  });
  return screen;
}
