// Qué avisos de macOS hay que dar o quitar (avisosSistema.ts): uno por conversación que espera tu respuesta (una pregunta,
// un permiso o un plan), solo cuando la petición llega con el juego en segundo plano; se quita al contestarla.
import type { SessionSummary } from '@shared/protocolo';

export interface Changes { dar: SessionSummary[]; quitar: string[] }

// visto: conversación → la petición ya vista (avisada o llegada con el juego delante); se actualiza aquí
export function noticeChanges(sesiones: Record<string, SessionSummary>, visto: Map<string, string>, enPrimerPlano: boolean): Changes {
  const dar: SessionSummary[] = [], quitar: string[] = [];
  for (const s of Object.values(sesiones)) {
    const p = s.estado !== 'cerrada' ? s.pending : undefined;
    if (!p) continue;
    if (visto.get(s.id) === p.id) continue;
    if (visto.has(s.id)) quitar.push(s.id);   // otra petición en la misma conversación: sustituye a la anterior
    visto.set(s.id, p.id);
    if (!enPrimerPlano) dar.push(s);
  }
  for (const id of [...visto.keys()]) {
    const s = sesiones[id];
    if (s?.pending && s.estado !== 'cerrada') continue;
    visto.delete(id); quitar.push(id);
  }
  return { dar, quitar };
}
