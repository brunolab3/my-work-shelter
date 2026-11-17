// Copias de los repos de ejemplo con los que arrancaban los refugios de antes (ya no se clonan: un refugio nuevo toma
// sus salas de la raíz de repos). Solo se reconocen, para que al retirar o vincular una de aquellas salas su copia vaya
// a la papelera y para marcarlas como ejemplo en su ficha.
import os from 'node:os';
import path from 'node:path';

// (sin importar estado.ts, que importa este módulo: con SHELTER_DATOS, dentro de esos datos, como CARPETAS_SALAS)
export const EXAMPLES_FOLDER = process.env.SHELTER_DATOS ? path.join(path.resolve(process.env.SHELTER_DATOS), 'ejemplos') : path.join(os.homedir(), 'Library', 'Application Support', 'work-shelter-public', 'ejemplos');
export const examplePath = (carpeta: string) => path.join(EXAMPLES_FOLDER, carpeta);
/** Una copia de un repo de ejemplo (de las que clonaba el juego, directamente dentro de su carpeta) */
export const isCloneOfExample = (ruta: string) => path.dirname(path.resolve(ruta)) === EXAMPLES_FOLDER;
