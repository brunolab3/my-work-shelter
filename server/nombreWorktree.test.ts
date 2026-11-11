// Nombre del worktree de un trabajo nuevo (sesiones.ts): la tarea se lee en la rama y en el holograma de la sala
import { describe, expect, it } from 'vitest';
import { nombreWorktree } from './sesiones.ts';

describe('nombreWorktree', () => {
  it('resume la tarea sin tildes ni signos y añade un sufijo', () => {
    expect(nombreWorktree('Arregla la validación del Login, ¡ya!', 36 ** 4 + 35)).toBe('shelter-arregla-la-validacion-del-login-000z');
  });
  it('corta por palabras enteras', () => {
    const n = nombreWorktree('ABCD-48210 avisar y bloquear al guardar notas con fechas pasadas', 0);
    expect(n).toBe('shelter-abcd-48210-avisar-y-bloquear-al-0000');
  });
  it('sin texto aprovechable, solo el sufijo', () => {
    expect(nombreWorktree('¿?', 1)).toBe('shelter-0001');
  });
});
