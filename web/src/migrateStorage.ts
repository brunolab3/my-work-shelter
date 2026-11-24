// Lo que guarda el navegador (borradores, pestañas, preferencias) con las claves de antes de pasar el código a inglés: se
// pone al día antes de que ningún módulo lo lea (es lo primero que importa main.tsx), con los pasos que falten (la marca
// guarda el último aplicado; «sí» de antes, el primero). Ver shared/migrateKeys.ts
import { migrateKeys, MIGRATION_STEP } from '@shared/migrateKeys';
import { LEGACY_STORAGE_KEYS } from '@shared/legacyKeys';

// the marker was 'refugio.clavesEn' before the keys took English names
const MARKER = 'shelter.keysStep', OLD_MARKER = 'refugio.clavesEn';
try {
  // keys with Spanish names move to their English ones, sessionStorage too (the token)
  for (const st of [localStorage, sessionStorage]) for (const [old, now] of Object.entries(LEGACY_STORAGE_KEYS)) {
    const v = st.getItem(old); if (v === null) continue;
    if (st.getItem(now) === null) st.setItem(now, v);
    st.removeItem(old);
  }
  const m = localStorage.getItem(MARKER) ?? localStorage.getItem(OLD_MARKER), done = !m ? 0 : /^\d+$/.test(m) ? Number(m) : 1;
  if (done < MIGRATION_STEP) {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i); if (!k || k === MARKER) continue;
      const v = localStorage.getItem(k); if (!v || !/^[[{]/.test(v)) continue;
      try { localStorage.setItem(k, JSON.stringify(migrateKeys(JSON.parse(v), done))); } catch {}
    }
  }
  localStorage.setItem(MARKER, String(Math.max(done, MIGRATION_STEP)));
  localStorage.removeItem(OLD_MARKER);
} catch {}
