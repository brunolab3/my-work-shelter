// El límite de sesiones vivas (ajustes `sessionLimit`, 1–20) y cuánto sube la pregunta que ofrece el refugio cuando
// lo alcanza una conversación nueva (server/main.ts, startWork).
export const SESSION_LIMIT_MAX = 20;
export const SESSION_LIMIT_STEP = 2;

// el límite al que se ofrece subir, o nada si ya está en el máximo
export function raisedSessionLimit(limit: number): number | undefined {
  return limit >= SESSION_LIMIT_MAX ? undefined : Math.min(SESSION_LIMIT_MAX, limit + SESSION_LIMIT_STEP);
}
