// Matriz de contribuciones (la de cuadritos verdes del perfil de GitHub): colores y rachas. La usan la pantalla de la
// sala de Control de Versiones y la pestaña GitHub del cliente de git.
export const GREEN_GITHUB = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'];

/** Rachas de días seguidos con contribuciones: la actual (si hoy aún no hay nada, cuenta hasta ayer) y la mejor. */
export function rachas(days: { n: number }[]) {
  let mejor = 0, consecutive = 0;
  for (const d of days) { consecutive = d.n ? consecutive + 1 : 0; mejor = Math.max(mejor, consecutive); }
  let actual = 0, i = days.length - 1;
  if (i >= 0 && !days[i].n) i--;
  for (; i >= 0 && days[i].n; i--) actual++;
  return { actual, mejor };
}
