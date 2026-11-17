// Avisos de macOS: si un habitante (o una copia) se queda esperando tu respuesta con el juego detrás de otra app,
// minimizado u oculto, lo dice el Mac; pulsar el aviso trae el juego con esa conversación abierta. Los da la app
// (electron/main.cjs, que no avisa con el juego delante ni después de salir a la superficie); en el navegador, nada.
// The Dock icon also carries a badge while someone waits for you (dockBadge in pendingNotices.ts).
import { vivo } from '../net/client';
import { juego } from './gameState';
import { openConversation } from './Dialog';
import { sessionOwner } from './copies';
import { firstMapNow } from '../engine/focus';
import { noticeChanges, dockBadge } from './pendingNotices';
import { t, tIs } from '@shared/language';
import type { SessionSummary } from '@shared/protocol';

interface WindowSystem { notify?: (id: string, titulo: string, cuerpo: string) => Promise<boolean>; removeNotice?: (id: string) => Promise<void>; onNoticeClick?: (f: (id: string) => void) => void; setBadge?: (texto: string) => Promise<void> }

function texts(s: SessionSummary) {
  const p = s.pending!, j = juego.get(), hid = sessionOwner(s, j.copias);
  const h = [...j.habitantes, ...j.copias].find(x => x.id === hid);
  const titulo = h ? t('windows.dwellerWaitsForYou', { nombre: h.nombre, sala: h.nameRoom }) : t('windows.someoneWaitsForYou');
  const cuerpo = p.tipo === 'pregunta' && p.preguntas?.[0] ? p.preguntas[0].question : tIs(p.titulo);
  return { titulo, cuerpo: (p.ofHelper ? t('windows.aHelperNombreAsks', { nombre: p.ofHelper }) : '') + cuerpo };
}

export function watchSystemNotices() {
  const w = (window as any).shelterVentana as WindowSystem | undefined;
  if (!w?.notify) return;
  w.onNoticeClick?.(id => openConversation(id));
  const visto = new Map<string, string>();
  let insignia: string | undefined;
  const mirar = () => {
    const b = dockBadge(vivo.get().sesiones);
    if (b !== insignia) { insignia = b; w.setBadge?.(b).catch(() => {}); }
    const { dar, quitar } = noticeChanges(vivo.get().sesiones, visto, firstMapNow());
    for (const id of quitar) w.removeNotice?.(id).catch(() => {});
    for (const s of dar) { const x = texts(s); w.notify!(s.id, x.titulo, x.cuerpo).catch(() => {}); }
  };
  vivo.subscribe(mirar);
  mirar();
}
