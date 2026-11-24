// Avisos de macOS: si un habitante (o una copia) se queda esperando tu respuesta con el juego detrás de otra app,
// minimizado u oculto, lo dice el Mac; pulsar el aviso trae el juego con esa conversación abierta. Los da la app
// (electron/main.cjs, que no avisa con el juego delante ni después de salir a la superficie); en el navegador, nada.
// The Dock icon also carries a badge while someone waits for you (dockBadge in pendingNotices.ts).
import { live } from '../net/client';
import { juego } from './gameState';
import { openConversation } from './Dialog';
import { sessionOwner } from './copies';
import { firstMapNow } from '../engine/focus';
import { noticeChanges, dockBadge } from './pendingNotices';
import { t, tIs } from '@shared/language';
import type { SessionSummary } from '@shared/protocol';

interface WindowSystem { notify?: (id: string, title: string, body: string) => Promise<boolean>; removeNotice?: (id: string) => Promise<void>; onNoticeClick?: (f: (id: string) => void) => void; setBadge?: (text: string) => Promise<void> }

function texts(s: SessionSummary) {
  const p = s.pending!, j = juego.get(), hid = sessionOwner(s, j.copies);
  const h = [...j.dwellers, ...j.copies].find(x => x.id === hid);
  const title = h ? t('windows.dwellerWaitsForYou', { nombre: h.name, sala: h.nameRoom }) : t('windows.someoneWaitsForYou');
  const body = p.type === 'question' && p.questions?.[0] ? p.questions[0].question : tIs(p.title);
  return { title, body: (p.ofHelper ? t('windows.aHelperNombreAsks', { nombre: p.ofHelper }) : '') + body };
}

export function watchSystemNotices() {
  const w = (window as any).shelterVentana as WindowSystem | undefined;
  if (!w?.notify) return;
  w.onNoticeClick?.(id => openConversation(id));
  const seen = new Map<string, string>();
  let badge: string | undefined;
  const watch = () => {
    const b = dockBadge(live.get().sessions);
    if (b !== badge) { badge = b; w.setBadge?.(b).catch(() => {}); }
    const { add, remove } = noticeChanges(live.get().sessions, seen, firstMapNow());
    for (const id of remove) w.removeNotice?.(id).catch(() => {});
    for (const s of add) { const x = texts(s); w.notify!(s.id, x.title, x.body).catch(() => {}); }
  };
  live.subscribe(watch);
  watch();
}
