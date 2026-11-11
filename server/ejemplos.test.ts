import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { EXAMPLES_FOLDER, isCloneOfExample, examplePath } from './ejemplos.ts';

describe('repos de ejemplo', () => {
  it('solo es copia de ejemplo lo que está directamente en su carpeta (lo demás, tuyo, no se tira nunca)', () => {
    expect(isCloneOfExample(examplePath('express'))).toBe(true);
    expect(isCloneOfExample(examplePath('express') + '/')).toBe(true);
    for (const r of [EXAMPLES_FOLDER, path.join(examplePath('express'), 'src'), path.join(EXAMPLES_FOLDER, '..', 'salas', 'puerta'), '/Users/alguien/Sites/express', path.join(EXAMPLES_FOLDER, 'x', '..', '..', 'otro')]) expect(isCloneOfExample(r), r).toBe(false);
  });
});
