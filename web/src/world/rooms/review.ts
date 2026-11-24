// The Review room (type 'review'): others' PRs that ask for the Overseer's review (shared/reviews.ts). Its centrepiece is
// the wall screen with the three columns (to review, changes requested, approved), one card per review (a task across
// repos, or a lone PR) in its task's colour; a click opens the board (web/src/ui/Review.tsx). Each review opened has its
// hologram standing at the front edge, like a repo room's copies (holograms.ts). Below the screen, the reading table.
import { t } from '@shared/language';
import * as THREE from 'three';
import { R } from '../../engine/assets';
import { sign, canvas, textureOf, splitByWords, SOURCES, PhosphorScreen } from '../../engine/textures';
import { signInWall, stain, highBand, workStation, screenReal, type Context } from './common';
import { live } from '../../net/client';
import { REVIEW_COLUMNS, type Review, type ReviewBoard } from '@shared/reviews';
import { taskColor } from '@shared/tasks';
import { knowTasks, versionColors } from '../../ui/tasks';

const short = (p: { repo: string; number: number }) => `${p.repo.split('/').pop()}#${p.number}`;
/** A review's colour: its task's (a lone PR's key has none: the holograms' cyan) */
export const reviewTone = (r: Pick<Review, 'key'>) => taskColor(r.key);

/** The big screen: three columns of review cards */
export class ReviewScreen {
  c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; private signature = '';
  constructor(private color = '#9fd0ff') { ({ c: this.c, g: this.g } = canvas(1408, 624)); this.tex = textureOf(this.c); this.set({ state: 'reading', reviews: [] }); }
  /** What it shows now (QA) */
  shown() { return JSON.parse(this.signature || '[]'); }
  set(board: ReviewBoard) {
    const reviews = board.reviews;
    const f = JSON.stringify([board.state, reviews.map(r => [r.key, r.column, r.started, r.title, reviewTone(r), r.prs.map(p => [p.url, p.column, p.author, p.draft])])]);
    if (f === this.signature) return; this.signature = f;
    const { g } = this; const W = this.c.width, H = this.c.height; const col = this.color;
    const INK = '#dce9f2', BACKGROUND = '#060b12', CARD = '#0f1722';
    g.fillStyle = BACKGROUND; g.fillRect(0, 0, W, H); g.textBaseline = 'top'; g.textAlign = 'left';
    g.fillStyle = col; g.font = `700 30px ${SOURCES.mono}`; g.shadowColor = col; g.shadowBlur = 10;
    g.fillText(t('world.review.title'), 28, 18); g.shadowBlur = 0;
    g.font = `600 24px ${SOURCES.mono}`; g.textAlign = 'right';
    g.fillText(t('world.review.nToReview', { n: reviews.filter(r => r.column === 'review').length }), W - 28, 20); g.textAlign = 'left';
    const n = REVIEW_COLUMNS.length, cw = (W - 56) / n, yc = 70, y0 = 112, y1 = H - 28, gap = 10, MAXC = 5;
    const cols = REVIEW_COLUMNS.map(id => ({ id, list: reviews.filter(r => r.column === id) }));
    const rows = Math.max(1, ...cols.map(c => Math.min(c.list.length, MAXC)));
    const fh = THREE.MathUtils.clamp((y1 - y0 - (rows - 1) * gap) / rows, 70, 150), large = fh >= 110;
    const fId = large ? 24 : 19, fTit = large ? 21 : 17;
    cols.forEach((c, i) => {
      const x = 28 + i * cw + 7, w = cw - 14;
      g.fillStyle = col + '24'; g.fillRect(x, yc, w, 34);
      g.fillStyle = col; g.font = `700 22px ${SOURCES.mono}`; g.fillText(t(`reviews.column.${c.id}`).toUpperCase(), x + 12, yc + 6);
      g.textAlign = 'right'; g.fillText(String(c.list.length), x + w - 10, yc + 6); g.textAlign = 'left';
      const vis = c.list.slice(0, c.list.length > MAXC ? MAXC - 1 : MAXC), more = c.list.length - vis.length;
      if (!vis.length) {
        g.setLineDash([10, 8]); g.strokeStyle = col + '44'; g.lineWidth = 2; g.strokeRect(x + 2, y0, w - 4, fh); g.setLineDash([]);
        g.fillStyle = col + '66'; g.font = `600 20px ${SOURCES.mono}`; g.textAlign = 'center';
        g.fillText(i === 0 && board.state !== 'ok' ? (board.state === 'off' ? 'GitHub —' : t('reviews.reading')) : '—', x + w / 2, y0 + 20); g.textAlign = 'left';
      }
      vis.forEach((r, k) => {
        const y = y0 + k * (fh + gap), tone = reviewTone(r);
        g.fillStyle = CARD; g.fillRect(x, y, w, fh);
        g.strokeStyle = tone + 'aa'; g.lineWidth = r.started ? 3.5 : 2; g.strokeRect(x + 1.5, y + 1.5, w - 3, fh - 3);
        g.fillStyle = tone; g.fillRect(x, y, 10, fh);
        g.font = `700 ${fId}px ${SOURCES.mono}`; g.fillText(`${r.started ? '◉ ' : ''}${r.key.includes('#') ? short(r.prs[0]) : r.key}`, x + 16, y + 8);
        g.textAlign = 'right'; g.font = `600 15px ${SOURCES.mono}`; g.fillStyle = col;
        g.fillText(r.prs.map(p => short(p) + (p.draft ? '·d' : '')).join(' ').slice(0, 40), x + w - 10, y + 11); g.textAlign = 'left';
        g.fillStyle = INK; g.font = `500 ${fTit}px ${SOURCES.mono}`;
        const lines = Math.max(1, Math.floor((fh - fId - 40) / (fTit * 1.2)));
        splitByWords(g, r.title, w - 28, Math.min(3, lines)).forEach((l, m) => g.fillText(l, x + 16, y + fId + 16 + m * fTit * 1.2));
        g.fillStyle = col + 'aa'; g.font = `500 15px ${SOURCES.mono}`;
        g.fillText(t('reviews.byAuthor', { autor: [...new Set(r.prs.map(p => p.author))].join(', ') }), x + 16, y + fh - 24);
      });
      if (more) { const y = y0 + vis.length * (fh + gap); g.fillStyle = col + '1c'; g.fillRect(x, y, w, 34); g.fillStyle = col; g.font = `600 18px ${SOURCES.mono}`; g.fillText(t('world.tex.nMore', { n: more }), x + 14, y + 8); }
    });
    for (let y = 0; y < H; y += 3) { g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, y, W, 1); }
    this.tex.needsUpdate = true;
  }
}

export async function furnishReview(ctx: Context) {
  const { g, v, zB, K, P, seed } = ctx;
  await highBand(ctx, { timer: 5.1, valves: [-4.6], segments: [[-4.9, 1.8]] });   // nothing in front of the screen
  const screenBoard = new ReviewScreen('#9fd0ff');
  const YT = 2.5;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.6, 0.12), new THREE.MeshStandardMaterial({ color: '#141820', roughness: 0.5, metalness: 0.5 }));
  frame.position.set(0, YT, zB + 0.36); g.add(frame); ctx.device('reviews', frame);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.3, 2.35), new THREE.MeshStandardMaterial({ map: screenBoard.tex, emissiveMap: screenBoard.tex, emissive: '#ffffff', emissiveIntensity: 1.0, color: '#000' }));
  screen.position.set(0, YT, zB + 0.43); g.add(screen);
  screen.userData.interactive = 'reviews';   // a click on the screen opens the board (shelter.ts, click)
  ctx.room.userData.reviewScreen = screenBoard;
  // on the left, the reviewer's desk
  const pStation = new PhosphorScreen(384, 256, v.screen); pStation.speed = 22; screenReal(ctx, pStation, 'activity'); ctx.room.screens.push(pStation);
  await workStation(ctx, { id: 'workstation', x: -3.05, z: -0.7, rotation: 0.8, tex: pStation.tex, chair: R.furniture('chair_desk_A'),
    onTop: [{ path: R.furniture('book_set'), x: -0.55, z: 0.2, c: { width: 0.4, rot: 0.2 } }, { path: R.furniture('mug_A'), x: 0.7, z: 0.15, c: { scale: K * 0.7 } }] });
  // the piece: the reading table, where printed diffs are read side by side
  P(R.furniture('table_medium'), { pos: [0, 0, zB + 1.9], width: 2.2 });
  for (const [id, x] of [['desk', -1.4], ['desk-2', 1.4]] as const) ctx.room.points.push({ id, type: 'piece', pos: new THREE.Vector3(x, 0, zB + 2.7), rotation: Math.atan2(-x, -0.8),
    actions: [{ clip: 'Interact' }, { clip: 'Holding_A', utensil: 'journal', dur: 4 }] });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(-1.2, zB + 1.2), new THREE.Vector2(1.2, zB + 2.6)));
  // the right: shelf with folders and the house sign
  const shelf = P(R.sf('Props_Shelf_Tall'), { pos: [5.45, 0, zB + 0.5], height: 2.3, rot: 0 });
  for (const [k, y] of [0.6, 1.05, 1.5].entries()) ctx.restsOn(shelf, R.furniture('book_set'), { pos: [5.4 + (k % 2) * 0.15, 0, zB + 0.5], width: 0.55, rot: k * 0.2 }, { since: y });
  ctx.room.obstacles.push(new THREE.Box2(new THREE.Vector2(4.9, zB), new THREE.Vector2(6, zB + 1.1)));
  signInWall(g, sign(t('world.poster.review'), t('world.poster.reviewFoot'), '#d2e2ee', '#1f3550', 'gear', seed), 4.1, 2.8, 0.56, 0.78, zB + 0.33, -0.03);
  stain(g, 0, 1.1, 1.2, seed);
  ctx.room.walkZones = [[-1.9, -1.5], [1.5, 2.2]];
  ctx.lamps = [{ x: -4.2, z: 0.6, o: { intensity: 80 } }, { x: 0, z: 0.9, o: { intensity: 105, shadow: true, corta: true } }, { x: 4.2, z: 0.6, o: { intensity: 80 } }];
  // data: the board the server sends (every minute, and as reviews open or retire)
  let seen: ReviewBoard | undefined, colors = -1;
  ctx.onUpdate((_dt, time) => {
    const b = live.get().reviews;
    if (b !== seen || colors !== versionColors.get().v) {
      if (b !== seen) knowTasks(b.reviews.map(r => r.key).filter(k => !k.includes('#')));
      seen = b; colors = versionColors.get().v; screenBoard.set(b);
    }
    (screen.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.95 + Math.sin(time * 11) * 0.03;
  });
}
