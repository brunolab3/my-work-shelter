// Qué avisos de macOS hay que dar o quitar (systemNotices.ts): uno por conversación que espera tu respuesta (una pregunta,
// un permiso o un plan), solo cuando la petición llega con el juego en segundo plano; se quita al contestarla.
import type { SessionSummary } from '@shared/protocol';

export interface Changes { add: SessionSummary[]; remove: string[] }

// visto: conversación → la petición ya vista (avisada o llegada con el juego delante); se actualiza aquí
export function noticeChanges(sessions: Record<string, SessionSummary>, seen: Map<string, string>, inForeground: boolean): Changes {
  const add: SessionSummary[] = [], remove: string[] = [];
  for (const s of Object.values(sessions)) {
    const p = s.state !== 'closed' ? s.pending : undefined;
    if (!p) continue;
    if (seen.get(s.id) === p.id) continue;
    if (seen.has(s.id)) remove.push(s.id);   // otra petición en la misma conversación: sustituye a la anterior
    seen.set(s.id, p.id);
    if (!inForeground) add.push(s);
  }
  for (const id of [...seen.keys()]) {
    const s = sessions[id];
    if (s?.pending && s.state !== 'closed') continue;
    seen.delete(id); remove.push(id);
  }
  return { add, remove };
}

// Dock badge (systemNotices.ts): the number of requests waiting for your answer (questions, permissions, plans);
// without any, a dot while a conversation has finished its turn unread; empty when nothing waits for you
export function dockBadge(sessions: Record<string, SessionSummary>): string {
  const openSessions = Object.values(sessions).filter(s => s.state !== 'closed');
  const requests = openSessions.reduce((n, s) => n + (s.pending ? Math.max(1, s.pendingCount) : 0), 0);
  if (requests) return String(requests);
  return openSessions.some(s => s.state === 'finished' && s.unread) ? '•' : '';
}
