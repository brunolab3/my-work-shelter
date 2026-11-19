// Adjuntos del intercomunicador: archivos que el Supervisor pega, arrastra o elige (capturas, imágenes de referencia,
// PDF, lo que sea). Se guardan en DATOS/uploads/<día> (se limpian a la semana) y van al habitante así:
// - las imágenes, dentro del mensaje (bloques de imagen: Claude las ve directamente), reducidas con `sips` si son
//   demasiado grandes para la API o están en un formato que no admite (HEIC, TIFF…);
// - todos, con su ruta en una lista al final del texto, para que pueda abrirlos o usarlos (copiar una imagen a un repo).
// La lista se reconoce al leer la conversación del archivo: el cuaderno los vuelve a enseñar como adjuntos.
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, writeFileSync, readFileSync, statSync, rmSync, existsSync, readdirSync, mkdtempSync } from 'node:fs';
import { execFile } from 'node:child_process';
import type { Attachment } from '../shared/protocol.ts';
import { t } from '../shared/language.ts';
import { TEXTS } from '../shared/texts.ts';

const MAX_FILE = 20 * 1024 * 1024;
const MAX_SIDE = 2000;                    // lado mayor de una imagen que va a Claude
const MAX_IMAGE = 3.5 * 1024 * 1024;     // la API admite 5 MB en base64: con 3,5 MB de imagen hay margen
const DIRECT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const CONVERTIBLES = new Set(['.heic', '.heif', '.tif', '.tiff', '.bmp']);
export const isImage = (filePath: string) => { const e = path.extname(filePath).toLowerCase(); return e in DIRECT || CONVERTIBLES.has(e); };

export const HEADER = '[Adjuntos del Supervisor]';
// the header and the image note go in the chosen language; reading a conversation back recognises both
const HEADERS = [HEADER, TEXTS['prompt.attachmentsHeader'].en!];
const IMAGE_NOTE = new RegExp(`^- (.+?)(${[TEXTS['prompt.attachmentImageNote'].es, TEXTS['prompt.attachmentImageNote'].en!].map(x => x.replace(/[()]/g, '\\$&')).join('|')})?$`);

export class Attachments {
  readonly dir: string;
  constructor(data: string) { this.dir = path.join(data, 'uploads'); }

  save(name: string, base64: string) {
    const dir = path.join(this.dir, new Date().toISOString().slice(0, 10));
    mkdirSync(dir, { recursive: true });
    const clean = String(name || 'archivo').replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]/g, '_').slice(0, 120) || 'archivo';
    const data = Buffer.from(String(base64 || ''), 'base64');
    if (data.length > MAX_FILE) throw new Error(t('server.theFileIsTooBig'));
    const target = path.join(dir, Date.now().toString(36) + '-' + clean);
    writeFileSync(target, data, { mode: 0o600 });
    return target;
  }

  // solo se mandan los que están en la carpeta de adjuntos (el cliente no elige rutas arbitrarias del disco)
  own(filePath: string) {
    const r = path.resolve(filePath);
    return r.startsWith(this.dir + path.sep) && existsSync(r) && statSync(r).isFile();
  }
  describe(paths: string[]): Attachment[] { return paths.filter(r => this.own(r)).map(r => ({ path: path.resolve(r), name: attachmentName(r), image: isImage(r) })); }

  // el contenido del mensaje de usuario para el Agent SDK: texto solo, o imágenes + texto con la lista de adjuntos
  async content(text: string, attachments: Attachment[]): Promise<string | Record<string, unknown>[]> {
    if (!attachments.length) return text;
    const blocks: Record<string, unknown>[] = [];
    const views = new Set<string>();
    for (const a of attachments) if (a.image) {
      try { const img = await imageForClaude(a.path); if (img) { blocks.push({ type: 'image', source: { type: 'base64', ...img } }); views.add(a.path); } } catch {}
    }
    blocks.push({ type: 'text', text: textWithAttachments(text, attachments.map(a => ({ ...a, image: views.has(a.path) }))) });
    return blocks;
  }

  // miniatura pequeña (JPEG en data URL) para el cuaderno: así no hace falta servir los adjuntos por HTTP
  async thumbnail(filePath: string, side = 360): Promise<string> {
    if (!this.own(filePath) || !isImage(filePath)) throw new Error(t('server.itIsNotAnAttached'));
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'shelter-mini-'));
    try {
      const out = path.join(tmp, 'm.jpg');
      await sips(['-Z', String(side), '-s', 'format', 'jpeg', '-s', 'formatOptions', '75', filePath, '--out', out]);
      return 'data:image/jpeg;base64,' + readFileSync(out).toString('base64');
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }

  // los de más de una semana, fuera
  clean(days = 7) {
    try { if (existsSync(this.dir)) for (const d of readdirSync(this.dir)) if (Date.now() - new Date(d).getTime() > days * 86400_000) rmSync(path.join(this.dir, d), { recursive: true, force: true }); } catch {}
  }
}

export const attachmentName = (filePath: string) => path.basename(filePath).replace(/^[0-9a-z]{6,10}-/, '');

// La lista de adjuntos al final del texto, legible para Claude (y reconocible al leer la conversación del archivo)
export function textWithAttachments(text: string, attachments: Attachment[]) {
  if (!attachments.length) return text;
  const lines = attachments.map(a => `- ${a.path}${a.image ? t('prompt.attachmentImageNote') : ''}`);
  return `${text.trim()}${text.trim() ? '\n\n' : ''}${t('prompt.attachmentsHeader')}\n${lines.join('\n')}`;
}
export function separateAttachments(t: string): { text: string; attachments: Attachment[] } {
  const header = HEADERS.reduce((a, h) => (t.lastIndexOf(h) > t.lastIndexOf(a) ? h : a));
  const i = t.lastIndexOf(header);
  if (i < 0 || (i > 0 && !t.slice(0, i).endsWith('\n\n'))) return { text: t, attachments: [] };
  const lines = t.slice(i + header.length).split('\n').filter(l => l.trim());
  if (!lines.length || !lines.every(l => l.startsWith('- '))) return { text: t, attachments: [] };
  const attachments = lines.map(l => { const m = IMAGE_NOTE.exec(l)!; return { path: m[1], name: attachmentName(m[1]), image: isImage(m[1]) }; });
  return { text: t.slice(0, i).trim(), attachments };
}

function sips(args: string[]) {
  return new Promise<string>((ok, ko) => execFile('/usr/bin/sips', args, { timeout: 30_000 }, (e, o) => (e ? ko(e) : ok(String(o)))));
}

async function imageForClaude(filePath: string): Promise<{ media_type: string; data: string } | null> {
  const ext = path.extname(filePath).toLowerCase();
  const info = await sips(['-g', 'pixelWidth', '-g', 'pixelHeight', filePath]);
  const width = Number(/pixelWidth: (\d+)/.exec(info)?.[1] ?? 0), height = Number(/pixelHeight: (\d+)/.exec(info)?.[1] ?? 0);
  if (!width || !height) return null;
  const direct = DIRECT[ext];
  if (direct && Math.max(width, height) <= MAX_SIDE && statSync(filePath).size <= MAX_IMAGE) return { media_type: direct, data: readFileSync(filePath).toString('base64') };
  // grande o en otro formato: a JPEG (o PNG si ya lo era y cabe) con el lado mayor como mucho de MAX_LADO
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'shelter-img-'));
  try {
    for (const [format, quality] of [['png', ''], ['jpeg', '88'], ['jpeg', '72']] as const) {
      if (format === 'png' && ext !== '.png') continue;
      const out = path.join(tmp, 'i.' + (format === 'png' ? 'png' : 'jpg'));
      await sips([...(Math.max(width, height) > MAX_SIDE ? ['-Z', String(MAX_SIDE)] : []), '-s', 'format', format, ...(quality ? ['-s', 'formatOptions', quality] : []), filePath, '--out', out]);
      if (statSync(out).size <= MAX_IMAGE) return { media_type: format === 'png' ? 'image/png' : 'image/jpeg', data: readFileSync(out).toString('base64') };
    }
    return null;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
