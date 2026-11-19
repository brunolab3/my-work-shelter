// Foto de una sala del refugio (para el habitante que la decora, view_room en roomDecor.ts): el propio juego en un
// Chromium sin ventana (Playwright; si no tiene su navegador, el Google Chrome del Mac), con la cámara en la sala y la
// revisión de apoyos del juego (?revisar: piezas flotando o hundidas). Una foto cada vez.
import type { Browser } from 'playwright';
import { t } from '../shared/language.ts';

let inProgress: Promise<unknown> = Promise.resolve();

async function browser(): Promise<Browser> {
  const { chromium } = await import('playwright');
  const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
  try { return await chromium.launch({ args }); }
  catch (e) {
    try { return await chromium.launch({ channel: 'chrome', args }); }
    catch { throw new Error(t('server.noBrowserForPhoto', { error: (e as Error).message.split('\n')[0] })); }
  }
}

/** `url`: la del juego con ?sala=<id>&revisar y el secreto en el fragmento */
export function captureRoom(url: string, roomId: string): Promise<{ png: Buffer; review: string[] }> {
  const task = inProgress.catch(() => {}).then(async () => {
    const b = await browser();
    try {
      const pg = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      await pg.addInitScript('window.__noLoop = true;');
      await pg.goto(url, { waitUntil: 'load', timeout: 60_000 });
      await pg.waitForFunction(() => typeof (window as any).__ready === 'function', null, { timeout: 60_000 });
      await pg.evaluate(async () => { await (window as any).__ready(); });
      // la sala recién montada y la cámara ya en su sitio (unos pasos de animación)
      await pg.waitForFunction(id => (window as any).__shelter?.rooms?.some((s: any) => s.id === id), roomId, { timeout: 30_000 });
      // solo la sala: sin la bienvenida ni el resto de la interfaz (aquí, sin guardar nada: es otra ventana del mismo refugio)
      await pg.evaluate(() => { (window as any).__game?.set({ panel: null }); const ui = document.getElementById('ui'); if (ui) ui.style.visibility = 'hidden'; });
      for (let i = 0; i < 40; i++) await pg.evaluate(() => (window as any).__step?.(0.05));
      const png = await pg.screenshot({ type: 'png' });
      const review: string[] = await pg.evaluate(id => (window as any).__shelter?.rooms?.find((s: any) => s.id === id)?.userData?.review ?? [], roomId);
      // solo lo del decorado (las piezas se llaman «pieces[i] model»): el suelo y la obra de la sala no son cosa suya
      return { png, review: Array.isArray(review) ? review.map(String).filter(r => r.includes('pieces[')) : [] };
    } finally { await b.close().catch(() => {}); }
  });
  inProgress = task;
  return task;
}
