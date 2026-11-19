import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Attachments, textWithAttachments, separateAttachments, attachmentName, HEADER } from './attachments.ts';

let data: string, att: Attachments;
beforeAll(() => { data = mkdtempSync(path.join(os.tmpdir(), 'shelter-adj-')); att = new Attachments(data); });
afterAll(() => rmSync(data, { recursive: true, force: true }));

// PNG de 1×1 transparente
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('adjuntos del intercomunicador', () => {
  it('guarda en su carpeta, con nombre limpio, y solo da por propios los suyos', () => {
    const r = att.save('mi captura/../x?.png', PNG);
    expect(r.startsWith(path.join(data, 'uploads') + path.sep)).toBe(true);
    expect(attachmentName(r)).toBe('mi captura_.._x_.png');
    expect(att.own(r)).toBe(true);
    expect(att.own('/etc/hosts')).toBe(false);
    expect(att.own(path.join(data, 'uploads', '..', 'fuera.png'))).toBe(false);
    expect(att.describe([r, '/etc/hosts'])).toEqual([{ path: r, name: 'mi captura_.._x_.png', image: true }]);
  });

  it('la lista de adjuntos va al final del texto y se recupera al leer la conversación', () => {
    const a = [{ path: '/d/uploads/2026-10-14/mf3k2a1-captura.png', name: 'captura.png', image: true }, { path: '/d/uploads/2026-10-14/mf3k2a2-informe.pdf', name: 'informe.pdf', image: false }];
    const t = textWithAttachments('Mira esto\n\ny dime', a);
    expect(t).toBe(`Mira esto\n\ny dime\n\n${HEADER}\n- ${a[0].path} (imagen, incluida en este mensaje)\n- ${a[1].path}`);
    expect(separateAttachments(t)).toEqual({ text: 'Mira esto\n\ny dime', attachments: a });
    expect(separateAttachments(textWithAttachments('', a)).text).toBe('');
    expect(separateAttachments('sin adjuntos')).toEqual({ text: 'sin adjuntos', attachments: [] });
    expect(separateAttachments(`habla de ${HEADER} sin lista`).attachments).toEqual([]);
  });

  it('las imágenes van dentro del mensaje y el resto, por su ruta', async () => {
    const img = att.save('a.png', PNG), doc = att.save('b.txt', Buffer.from('hola').toString('base64'));
    const c = await att.content('¿qué ves?', att.describe([img, doc])) as any[];
    expect(c[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } });
    expect(c[1].type).toBe('text');
    expect(c[1].text).toContain(`- ${img} (imagen, incluida en este mensaje)`);
    expect(c[1].text).toContain(`- ${doc}`);
    expect(await att.content('solo texto', [])).toBe('solo texto');
  });

  it.runIf(process.platform === 'darwin')('las imágenes grandes se reducen antes de mandarlas', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'shelter-adj-img-'));
    try {
      const base = path.join(tmp, 'base.png'), small = path.join(tmp, 'p.png');
      writeFileSync(base, Buffer.from(PNG, 'base64'));
      execFileSync('/usr/bin/sips', ['-z', '3000', '4000', base, '--out', small], { stdio: 'ignore' });
      const filePath = att.save('grande.png', readFileSync(small).toString('base64'));
      const c = await att.content('', att.describe([filePath])) as any[];
      expect(c[0].type).toBe('image');
      const out = path.join(tmp, 'out.' + (c[0].source.media_type === 'image/png' ? 'png' : 'jpg'));
      writeFileSync(out, Buffer.from(c[0].source.data, 'base64'));
      const info = execFileSync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', out], { encoding: 'utf8' });
      expect(Math.max(Number(/pixelWidth: (\d+)/.exec(info)![1]), Number(/pixelHeight: (\d+)/.exec(info)![1]))).toBe(2000);
      expect(c[0].source.data.length).toBeLessThan(5 * 1024 * 1024);
      expect((await att.thumbnail(filePath)).startsWith('data:image/jpeg;base64,')).toBe(true);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }, 30_000);   // sips con una imagen de 3000×2000: con la máquina cargada pasa de los 5 s por defecto
});
