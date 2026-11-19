// Secretos en el llavero de macOS mediante /usr/bin/security (sin dependencias nativas).
// Servicio «work-shelter-public», cuenta «<fuente>.<campo>» (p. ej. linear.apiKey, outlook.refreshToken).
// El secreto NUNCA va en argv (se vería en `ps`): se escribe con `security -i`, que lee la orden por stdin.
// El valor va en base64 para evitar comillas en el modo interactivo y que `-w` lo devuelva en hexadecimal si no es ASCII.
// Contrapartida (documentada): la app de confianza del elemento es el propio `security`, así que otro proceso del
// mismo usuario podría leerlo sin aviso. Para un Mac personal se acepta; nunca se escribe en .data/, git ni logs.
import { execFile } from 'node:child_process';
import { t } from '../../shared/language.ts';

export const SERVICE = 'work-shelter-public';
const SECURITY = '/usr/bin/security';
const NO_EXISTS = 44;

export interface Keychain {
  read(count: string): Promise<string | null>;
  save(count: string, value: string): Promise<void>;
  deleteMessage(count: string): Promise<void>;
}

function run(args: string[], input?: string): Promise<{ code: number; output: string; error: string }> {
  return new Promise(resolve => {
    const p = execFile(SECURITY, args, { timeout: 15_000, maxBuffer: 1 << 20 }, (err, output, error) => {
      const code = err ? (typeof (err as any).code === 'number' ? (err as any).code : -1) : 0;
      resolve({ code, output: String(output), error: String(error) });
    });
    if (input !== undefined) { p.stdin?.end(input); }
  });
}

// Mensaje sin el secreto: solo el código y la primera línea de stderr de `security` (que no lo contiene)
function fail(what: string, r: { code: number; error: string }) {
  return new Error(t('server.theMacosKeychainCouldNot', { que: what, codigo: r.code, split: r.error ? ': ' + r.error.trim().split('\n')[0] : '' }));
}

const accountValid = (c: string) => { if (!/^[a-z]+\.[A-Za-z0-9_-]+$/.test(c)) throw new Error(t('integrations.keychainInvalidAccount', { cuenta: c })); };

export const keychainMac: Keychain = {
  async read(count) {
    accountValid(count);
    const r = await run(['find-generic-password', '-s', SERVICE, '-a', count, '-w']);
    if (r.code === NO_EXISTS) return null;
    if (r.code !== 0) throw fail(t('integrations.keychainRead'), r);
    const b64 = r.output.trim();
    try { return Buffer.from(b64, 'base64').toString('utf8'); } catch { return null; }
  },
  async save(count, value) {
    accountValid(count);
    const b64 = Buffer.from(value, 'utf8').toString('base64');
    const source = count.split('.')[0];
    // `security -i` lee órdenes por stdin: el secreto no aparece en la lista de procesos
    const r = await run(['-i'], `add-generic-password -U -s ${SERVICE} -a ${count} -l "work-shelter: ${source}" -w ${b64}\n`);
    if (r.code !== 0) throw fail(t('integrations.keychainSave'), r);
    // En modo interactivo `security` puede salir con 0 aunque la orden falle: se comprueba leyendo
    const read = await this.read(count);
    if (read !== value) throw fail(t('integrations.keychainSave'), { code: r.code, error: r.error || t('integrations.keychainNotVerified') });
  },
  async deleteMessage(count) {
    accountValid(count);
    const r = await run(['delete-generic-password', '-s', SERVICE, '-a', count]);
    if (r.code !== 0 && r.code !== NO_EXISTS) throw fail(t('integrations.keychainErase'), r);
  },
};

// Llavero en memoria para pruebas (nunca se usa en producción salvo que lo pidan las pruebas)
export function keychainMemory(initial: Record<string, string> = {}): Keychain & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, async read(c) { return data.get(c) ?? null; }, async save(c, v) { data.set(c, v); }, async deleteMessage(c) { data.delete(c); } };
}

let current: Keychain = keychainMac;
export function useKeychain(l: Keychain) { current = l; }
export const readSecret = (count: string) => current.read(count);
export const saveSecret = (count: string, value: string) => current.save(count, value);
export const eraseSecret = (count: string) => current.deleteMessage(count);
