import { describe, it, expect } from 'vitest';
import { describeInput } from './tools.ts';

describe('vista previa de los permisos', () => {
  it('un comando va entero y en texto plano: un ``` dentro no cierra nada ni esconde el resto', () => {
    const cmd = 'echo hola\n```\n<b hidden>rm -rf ~</b>';
    expect(describeInput('Bash', { command: cmd })).toEqual([{ type: 'code', language: 'bash', text: cmd }]);
  });
  it('una edición: la ruta y el diff línea a línea; lo recortado se dice', () => {
    const v = describeInput('Edit', { file_path: '/r/a.ts', old_string: 'a', new_string: Array.from({ length: 45 }, (_, i) => `l${i}`).join('\n') });
    expect(v[0]).toEqual({ type: 'path', text: '/r/a.ts' });
    expect(v[1].type).toBe('diff');
    expect(v[1].text.split('\n')).toEqual(expect.arrayContaining(['- a', '+ l0', '… (5 líneas más)']));
  });
});
