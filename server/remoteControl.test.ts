import { describe, expect, it } from 'vitest';
import { readOutput } from './controlRemoto.ts';

describe('Remote Control de la sala', () => {
  it('reconoce que hay que aceptarlo la primera vez', () => {
    expect(readOutput('Take this session with you…\nEnable Remote Control? (y/n) ').aceptar).toBe(true);
  });
  it('reconoce una carpeta sin confianza', () => {
    expect(readOutput('Error: Workspace not trusted. Please run `claude` in /x first').withoutTrust).toBe(true);
  });
  it('se queda con el último enlace de claude.ai/code', () => {
    const r = readOutput('Connected\nhttps://claude.ai/code?environment=env_1\nhttps://claude.ai/code?environment=env_2 \n');
    expect(r.url).toBe('https://claude.ai/code?environment=env_2');
    expect(r.aceptar).toBe(false);
  });
});
