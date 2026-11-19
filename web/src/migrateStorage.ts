// Lo que guarda el navegador (borradores, pestañas, preferencias) con las claves de antes de pasar el código a inglés: se
// pone al día antes de que ningún módulo lo lea (es lo primero que importa main.tsx), con los pasos que falten (la marca
// guarda el último aplicado; «sí» de antes, el primero). Ver shared/migrateKeys.ts
import { migrateKeys, MIGRATION_STEP } from '@shared/migrateKeys';

const MARKER = 'refugio.clavesEn';
try {
  const m = localStorage.getItem(MARKER), done = !m ? 0 : /^\d+$/.test(m) ? Number(m) : 1;
  if (done < MIGRATION_STEP) {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i); if (!k || k === MARKER) continue;
      const v = localStorage.getItem(k); if (!v || !/^[[{]/.test(v)) continue;
      try { localStorage.setItem(k, JSON.stringify(migrateKeys(JSON.parse(v), done))); } catch {}
    }
    localStorage.setItem(MARKER, String(MIGRATION_STEP));
  }
} catch {}
