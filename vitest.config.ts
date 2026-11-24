// Pruebas (vitest): desde la raíz del repo, para server/, shared/, test/ y web/src. Sin red: los conectores se
// prueban con los fixtures de test/fixtures.
import { defineConfig } from 'vitest/config';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'shared') } },
  // SHELTER_DATOS: los datos (y los repos de ejemplo que crea el estado inicial) en una carpeta temporal, nunca en los
  // del Supervisor
  // 30 s por prueba: las de git de verdad (organizar, comparar, git, preflight) pasan de 5 s con el Mac cargado
  test: { env: { SHELTER_DATOS: join(tmpdir(), `work-shelter-pruebas-${process.pid}`) }, root: __dirname, setupFiles: ['test/setup.ts'], testTimeout: 30_000, include: ['server/**/*.test.ts', 'shared/**/*.test.ts', 'test/**/*.test.ts', 'web/src/**/*.test.{ts,tsx}'], environment: 'node' },
});
