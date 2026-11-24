import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MIGRATION_STEP } from '../../shared/migrateKeys.ts';

class FakeStorage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}
const local = new FakeStorage(), session = new FakeStorage();
const load = async () => { vi.resetModules(); await import('./migrateStorage.ts'); };

describe('browser storage from before the English key names', () => {
  beforeEach(() => { local.m.clear(); session.m.clear(); vi.stubGlobal('localStorage', local); vi.stubGlobal('sessionStorage', session); });

  it('moves the Spanish keys to the English ones, the token too, and migrates the saved values once', async () => {
    local.setItem('refugio.clavesEn', '3');
    local.setItem('refugio.idioma', 'en');
    local.setItem('refugio.git.ruta', '/r/tienda');
    local.setItem('refugio.intercoms', JSON.stringify({ tabs: [{ view: { type: 'conversacion' } }] }));
    session.setItem('refugio.token', 'abc');
    await load();
    expect(Object.fromEntries(local.m)).toEqual({ 'shelter.keysStep': String(MIGRATION_STEP), 'shelter.language': 'en', 'shelter.git.path': '/r/tienda', 'shelter.intercoms': JSON.stringify({ tabs: [{ view: { type: 'conversation' } }] }) });
    expect(Object.fromEntries(session.m)).toEqual({ 'shelter.token': 'abc' });
    const before = JSON.stringify([...local.m]);
    await load();
    expect(JSON.stringify([...local.m])).toBe(before);
  });

  it('a key already saved with its new name wins; an up-to-date old marker is not run again', async () => {
    local.setItem('refugio.clavesEn', String(MIGRATION_STEP));
    local.setItem('refugio.idioma', 'es'); local.setItem('shelter.language', 'en');
    local.setItem('shelter.intercoms', JSON.stringify({ view: { type: 'conversacion' } }));
    await load();
    expect(local.getItem('shelter.language')).toBe('en');
    expect(local.getItem('refugio.idioma')).toBeNull();
    expect(local.getItem('shelter.intercoms')).toBe(JSON.stringify({ view: { type: 'conversacion' } }));
    expect(local.getItem('shelter.keysStep')).toBe(String(MIGRATION_STEP));
  });
});
