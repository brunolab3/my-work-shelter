// Caracteres invisibles o de control a la vista como ⟦U+XXXX⟧: los usan los permisos del juego (web/src/ui/textoPlano.tsx)
// y los del mando a distancia (server/mando.ts), para que nada escondido pase por aprobado.
// C0 (salvo tabulador, salto de línea y retorno de carro), DEL, guion blando, separador mongol, ancho cero y marcas de
// dirección (U+200B–U+200F), incrustaciones y anulaciones bidi (U+202A–U+202E), operadores invisibles (U+2060–U+2064),
// aislamientos bidi (U+2066–U+2069) y BOM (U+FEFF)
export const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
export const marca = (c: string) => `⟦U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}⟧`;

/** el texto con cada carácter invisible o de control cambiado por su marca */
export const visible = (t: string) => t.replace(INVISIBLE, marca);
