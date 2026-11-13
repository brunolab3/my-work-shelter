// Las herramientas del juego con las que el habitante de una sala de repo la decora («Adaptar la sala al repo»):
// un servidor MCP dentro del propio proceso (Agent SDK) que solo lee y escribe el decorado de SU sala. El decorado son
// datos (shared/decorado.ts), validados aquí antes de guardarlos: nada de lo que escriba el habitante se ejecuta.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { sanitizeDecor, reviewDecor, BASES_DECOR, DESCRIPTION_BASE, DECOR_WALLS, DECOR_PALETTES, SIGN_SYMBOLS, GESTURES, LIMITS, PACKS, type Decorado, type DecorPiece } from '../shared/decorado.ts';
import { catalogo, catalogInText, propsModel } from './atrezo.ts';
import { t, tIs } from '../shared/idioma.ts';

export interface CtxDecor {
  sala(id: string): { id: string; nombre: string; tipo: string; ruta?: string; estilo?: string; decorado?: Decorado } | undefined;
  /** la plantilla que lleva la sala sin decorado (fundición, laboratorio…) */
  plantilla(id: string): string;
  guardar(id: string, d: Decorado | null): void;
  capturar(id: string): Promise<{ png: Buffer; revision: string[] }>;
}

// la guía va en el idioma del juego: se arma al pedirla (decorado_actual), no al importar
export const decorGuide = () => t('tool.decor.guide', {
  pasillo: LIMITS.pasillo, paredVista: LIMITS.viewWall, bases: BASES_DECOR.map(b => t('tool.quoted', { v: b }) + ': ' + tIs(DESCRIPTION_BASE[b])).join('. '),
  paletas: DECOR_PALETTES.join(', '), paredes: DECOR_WALLS.join(', '), gestos: GESTURES.join(', '), lamparas: LIMITS.lamparas, piezas: LIMITS.piezas,
  carteles: LIMITS.carteles, simbolos: SIGN_SYMBOLS.join('|'), pantallas: LIMITS.pantallas,
});

const num = z.number();
const pointSchema = z.object({ x: num, z: num, giro: num.optional(), gestos: z.array(z.enum(GESTURES)).optional() });
const decorSchema = () => z.object({
  base: z.enum(BASES_DECOR),
  resumen: z.string().optional(), subtitulo: z.string().optional(), acento: z.string().optional().describe('#rrggbb'),
  paleta: z.enum(DECOR_PALETTES).optional(), paredes: z.array(z.enum(DECOR_WALLS)).length(3).optional(), luz: num.optional(), espejo: z.boolean().optional(),
  pantallaRepo: z.object({ x: num, y: num, ancho: num }).optional(),
  puesto: z.object({ x: num, z: num, giro: num.optional(), pantalla: z.enum(['monitor', 'doble', 'ordenador']).optional(), mesa: z.string().optional() }).optional(),
  pieza: pointSchema.optional(), aficion: pointSchema.optional(),
  lamparas: z.array(z.object({ x: num, z: num, color: z.string().optional(), intensidad: num.optional() })).optional(),
  piezas: z.array(z.object({
    modelo: z.string().describe(t('tool.decor.paramModel')), x: num, z: num, y: num.optional(), giro: num.optional().describe(t('tool.decor.paramDegrees')),
    alto: num.optional(), ancho: num.optional(), sobre: z.number().int().optional().describe(t('tool.decor.paramOn')),
    pared: z.boolean().optional(), tumbada: z.boolean().optional(), color: z.string().optional(), luz: z.string().optional(),
  })).optional(),
  carteles: z.array(z.object({ x: num, y: num, ancho: num, titulo: z.string(), lineas: z.array(z.string()), fondo: z.string().optional(), tinta: z.string().optional(), simbolo: z.enum(SIGN_SYMBOLS).optional(), giro: num.optional() })).optional(),
  pantallas: z.array(z.object({ x: num, y: num, ancho: num, titulo: z.string(), lineas: z.array(z.string()) })).optional(),
});

const texto = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const sizeOf = (p: DecorPiece): [number, number, number] | null => {
  const m = propsModel(p.modelo); if (!m) return null;
  const k = p.alto ? p.alto / m.tam[1] : p.ancho ? p.ancho / m.tam[0] : 1;
  return [m.tam[0] * k, m.tam[1] * k, m.tam[2] * k];
};

/** El servidor MCP «refugio» de una sesión en la sala `salaId` (uno por sesión lanzada) */
export function mcpDecor(salaId: string, ctx: CtxDecor) {
  const sala = () => { const s = ctx.sala(salaId); if (!s) throw new Error(t('tool.decor.roomGone')); return s; };
  // el habitante a veces pide aplicar y ver a la vez: la foto espera a que lo aplicado llegue al juego
  let aplicado = 0;
  return createSdkMcpServer({
    name: 'refugio', version: '1.0.0',
    tools: [
      tool('decorado_actual', t('tool.decor.currentDescription'), {},
        async () => {
          const s = sala();
          return texto(`${decorGuide()}\n\n${t('tool.decor.yourRoom', { nombre: s.nombre, ruta: s.ruta ?? '—' })}\n` + (s.decorado
            ? `${t('tool.decor.currentDecor')}\n${JSON.stringify(s.decorado)}`
            : t('tool.decor.noDecor', { plantilla: ctx.plantilla(salaId), descripcion: tIs(DESCRIPTION_BASE[ctx.plantilla(salaId) as keyof typeof DESCRIPTION_BASE] ?? '') })));
        }, { alwaysLoad: true, annotations: { readOnlyHint: true } }),
      tool('catalogo_atrezo', t('tool.decor.catalogDescription'),
        { buscar: z.string().optional().describe(t('tool.decor.paramSearch')), pack: z.string().optional().describe(Object.keys(PACKS).join(', ')) },
        async ({ buscar, pack }) => {
          if (!catalogo().length) return texto(t('tool.decor.noAssets'));
          if (!buscar && !pack) return texto(Object.entries(PACKS).map(([p, x]) => `${p} (${catalogo().filter(m => m.pack === p).length}): ${tIs(x.que)}`).join('\n') + '\n\n' + t('tool.decor.askPack'));
          return texto(catalogInText(buscar ?? '', pack ?? ''));
        }, { alwaysLoad: true, annotations: { readOnlyHint: true } }),
      tool('aplicar_decorado', t('tool.decor.applyDescription'),
        { decorado: decorSchema() },
        async ({ decorado }) => {
          sala();
          const { decorado: d, avisos } = sanitizeDecor(decorado);
          if (!d) return { ...texto(t('tool.decor.notApplied', { avisos: avisos.join(' ') })), isError: true };
          const revision = reviewDecor(d, sizeOf);
          ctx.guardar(salaId, d); aplicado = Date.now();
          return texto([t('tool.decor.applied'), ...(avisos.length ? [t('tool.decor.fixedOnValidate'), ...avisos.map(a => '- ' + a)] : []), ...(revision.length ? [t('tool.decor.looksWrong'), ...revision.map(a => '- ' + a)] : []), t('tool.decor.lookWithView')].join('\n'));
        }, { alwaysLoad: true }),
      tool('ver_sala', t('tool.decor.viewDescription'), {},
        async () => {
          sala();
          await new Promise(r => setTimeout(r, 500));
          if (Date.now() - aplicado < 1500) await new Promise(r => setTimeout(r, 1500));
          try {
            const { png, revision } = await ctx.capturar(salaId);
            return { content: [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }, { type: 'text' as const, text: revision.length ? t('tool.decor.gameSeesWrong') + '\n' + revision.slice(0, 30).map(r => '- ' + r).join('\n') : t('tool.decor.allGood') }] };
          } catch (e) { return { ...texto(t('tool.decor.photoFailed', { error: (e as Error).message })), isError: true }; }
        }, { alwaysLoad: true, annotations: { readOnlyHint: true } }),
      tool('quitar_decorado', t('tool.decor.removeDescription'), {},
        async () => { sala(); ctx.guardar(salaId, null); return texto(t('tool.decor.removed')); }, { alwaysLoad: true }),
    ],
  });
}

/** Lo que se le pide al habitante con «Adaptar la sala al repo» (sale como mensaje del Supervisor), en el idioma del juego */
export const promptAdaptar = () => t('prompt.adaptRoom');
