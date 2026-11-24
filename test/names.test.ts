// Guard for names: no new Spanish in identifiers, in strings used as names (ids, actions, message types, states,
// keys, events, storage keys, file names), in t() placeholders or in file names. Visible text is test/language.test.ts's
// job: comments, regex literals, strings with spaces and the `es` values of shared/texts are not looked at, nor CSS
// class names until they move to English (className, querySelector, classList).
// What stays in Spanish is in ALLOWED, each with its reason.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { SPANISH_WORDS } from './spanishWords.ts';
import { TEXTS } from '../shared/texts.ts';

const ROOT = new URL('..', import.meta.url).pathname;
// a one-word string that is a catalogue text («Yelmo», «ESTUDIO») is text shown through tIs(), not a name
const CATALOGUE = new Set(Object.values(TEXTS).flatMap(v => [v.es, v.en]));
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const sources = tracked.filter(f => /^(server|shared|web\/src|electron|scripts|test)\//.test(f) && /\.(tsx?|mts|cjs|mjs|js)$/.test(f) && !f.startsWith('test/fixtures/'));

/** The Spanish words of a name: camelCase, snake_case, kebab-case, dots and digits split it */
export function spanishWords(name: string): string[] {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').toLowerCase().split(/[^a-zñ]+/);
  return words.filter(w => SPANISH_WORDS.has(w.normalize('NFD').replace(/[̀-ͯ]/g, '')));
}

const SELECTOR_CALLS = new Set(['querySelector', 'querySelectorAll', 'closest', 'matches', 'getElementsByClassName']);
const CLASS_LIST_CALLS = new Set(['add', 'remove', 'toggle', 'contains', 'replace']);
// inside className={…}, a selector, a classList call or `x.className = …`: a CSS class (they move to English in their
// own task)
function inCss(n: ts.Node): boolean {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isJsxAttribute(p)) return /^(className|class)$/.test(p.name.getText());
    if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression)) {
      const m = p.expression.name.text;
      if (SELECTOR_CALLS.has(m) || (CLASS_LIST_CALLS.has(m) && /classList$/.test(p.expression.expression.getText()))) return true;
    }
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && /\.className$/.test(p.left.getText())) return true;
    if (ts.isBlock(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

type Hit = { file: string; line: number; kind: string; name: string };
function scan(file: string): Hit[] {
  const src = readFileSync(ROOT + file, 'utf8');
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : /\.(c|m)?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const texts = file.startsWith('shared/texts/');
  const out: Hit[] = [];
  const hit = (n: ts.Node, k: string, name: string) => { if (spanishWords(name).length) out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, kind: k, name }); };
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) hit(n, 'identifier', n.text);
    else if (ts.isStringLiteralLike(n)) {
      if (texts) {
        // the catalogue: its keys are names; its texts are text, but their {placeholders} are names
        if (ts.isPropertyAssignment(n.parent) && n.parent.name === n) hit(n, 'text key', n.text);
        else for (const m of n.text.matchAll(/\{(\w+)\}/g)) hit(n, 'placeholder', m[1]);
      } else if (/^[A-Za-z_$][\w.:/@-]*$/.test(n.text) && n.text.length <= 80 && !CATALOGUE.has(n.text) && !inCss(n)) hit(n, 'string', n.text);
    } else if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name)) hit(n, 'identifier', n.name.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

// [file glob, name pattern, reason]: what may stay in Spanish
const ALLOWED: [string, RegExp, string][] = [
  // the economy and the shooting gallery are touched only through juego.* and the jugador state
  ['**', /^(juego|jugador)\b|^juego\./, 'economy: juego.* actions and the jugador state'],
  ['{server/game.ts,shared/catalog.ts,web/src/world/shootingGallery.ts,web/src/ui/Activities.tsx,web/src/ui/Vault.tsx}', /./, 'economy and shooting gallery'],
  // ids that are data: saved, and some typed by the Overseer or read by every dweller
  ['**', /^(cabeza|cara|pelo|cejas|barba|gafas|sombrero|espalda|piernas|brazos|complemento|piel|torso|especie|luz|pieza)\d*(\.|:|$)/i, 'look slots, colour slots and pieces: saved look ids'],
  ['{shared/appearance.ts,web/src/ui/FittingRoom.tsx,web/src/world/figure/**}', /^(colores|piezas|aparato-probador)$/, 'the fitting room tabs, named after the look fields'],
  ['**', /^(cultivos|cultivo|cosecha|tiro|ballesta|arma|armas|pieza|rareza|nueva|quien|inventario)$/, 'economy: crops, shooting gallery and pieces (jugador)'],
  ['shared/texts/panels.ts', /^panels\.(withArma|nCosechaToTheBackpack|bedNNowCultivo|valorScrapEach|enterBuyPrecioYouHave)$/, 'economy texts'],
  // what crosses a restart without reload
  ['**', /^SHELTER_[A-Z_]+$/, 'environment variables'],
  ['electron/**', /./, 'Electron: window globals, preload API and IPC channels cross a restart without reload'],
  ['**', /^(shelterVentana|shelterRemoto)$/, 'the preload API (window globals)'],
  ['web/src/ui/Browsers.tsx', /^(entrada|evaluar|rueda|tamano|raton|tecla|atras|texto)$/, 'remote Chrome IPC orders and their payloads'],
  ['web/src/ui/Browsers.tsx', /^persist:navegador$/, 'the in-game browsers\' session partition: renaming it logs every site out'],
  ['{server/terminalHost.ts,server/terminals.ts,server/surface.ts}', /^(hola|filas|bufer|fuera|terminales|salvoFuera|datos|peticion|texto|entrada|empujar|enganchar|tamano|modos|primerPlano|servidor|cerrarTodas)$/, 'terminal host socket messages: the host outlives a restart'],
  ['shared/protocol.ts', /^hola$/, 'LEGACY_WIRE: what a tab from before the English message names sends'],
  ['server/main.ts', /^servidor$/, 'fingerprint group of scripts/fingerprints.cjs (its export aliases stay)'],
  ['{web/src/ui/Panels.tsx}', /^(ambiente|musica|teclado)$/, 'saved audio bus names (web/src/audio/sound.ts settings)'],
  ['web/src/world/dweller.ts', /^Sentado_\w+$/, 'animation clips of the character assets'],
  // audio and third-party assets: their names are file names
  ['web/src/audio/**', /./, 'sound names are asset file names; saved audio settings keys'],
  ['{web/src/engine/**,web/src/world/**,web/src/tools/**}', /^(u[A-Z]\w*|[a-z]+_\w+)$/, 'shader uniforms and asset names'],
  // what reads old data
  ['{shared/legacyKeys.ts,shared/migrateKeys.ts,web/src/migrateStorage.ts,server/state.ts}', /./, 'reads data saved with the old names'],
  ['server/integrations/{mail,calendar,normalize}.ts', /^(cerrada|texto|notas|estado|asunto|remitente|fecha|marcado|inicio|fin|lugar|calendario|calendarios|eventos|cuenta|cuentas|mensajes|nombre|titulo)$/, 'fields of the Mail and Calendar JXA output'],
  ['**', /^(sitio|correo|calendarios|cuentas|canales|equipo|calendario|usuario|servidor|videollamada)$/, 'integration ids and field ids, saved since step 3 (keepKeys in shared/migrateKeys.ts)'],
  ['server/compare.ts', /^comparaciones$/, 'the compares folder from before, read to move it'],
  ['server/examples.ts', /^ejemplos$/, 'the example repos folder: its full path is saved in rooms'],
  ['server/git.ts', /^(refugio\/\w+|ref-212-barra-final|sesiones-persistentes|ordenar-temas)$/, 'GitHub demo data (DEMO, before connecting)'],
  ['{server/integrations/demo.ts,server/integrations/demoEnglish.ts}', /./, 'demo data and its dictionary'],
  // saved room fields and data the server already migrated to its final names
  ['**', /^orden$/, 'saved room field (layout)'],
  ['**', /^(roca|casa|mueble|herr|cocina|cultivo)$/, 'decor pack ids (asset folders)'],
  ['**', /^tool\.decor\.pack\.(casa|cultivo|roca|mueble|herr|cocina)$/, 'text keys of the decor pack ids'],
  ['**', /^tareas$/, 'the Planning room id (PLANNING_ROOM), saved and used by dwellers'],
  ['**', /^salas$/, 'the folder of the rooms of repos (ROOMS_FOLDER): saved in each room path'],
  // one-word visible text outside the catalogue and developer log prefixes: test/language.test.ts looks after text
  ['{server/compare.ts,server/main.ts,web/src/ui/Disco.tsx,web/src/world/rooms/landing.ts}', /^(nuevo|borrado|renombrado|Recluta|Medallas:|Verificaciones:|PAUSA|SONANDO|Filtros|Modelos)$/, 'visible text and log prefixes, not names'],
  // older in-page names, from before the English pass: renamed when their line is touched (AGENTS.md). Exact names only,
  // so a new Spanish name still fails
  ['server/main.ts', /^(controlRemoto|fuera|nombre|nuevo|tienda)$/, 'older name'],
  ['server/page/notes.js', /^(__refugioNotas|avisoScroll|bBorrar|citaEl|lineaDe|pintar|volverA)$/, 'older name'],
  ['server/scheduled.ts', /^sameSala$/, 'older name'],
  ['{server/integrations/normalize.ts,web/src/engine/textures.ts,web/src/ui/Bridge.tsx,web/src/ui/Operations.tsx,web/src/world/rooms/common.ts,web/src/world/rooms/operations.ts,web/src/world/shelter.ts}', /^progreso$/, 'older name'],
  ['web/src/world/**', /^(vapor|sube|VERDES|escala|ruta|actualizar|puerta|sala:)$/, 'older name'],
  ['{web/src/ui/Search.tsx,web/src/ui/Terminals.tsx}', /^sala:$/, 'older name: the prefix of a room\'s id in the finder and the terminals'],
  ['web/src/ui/files/Explorer.tsx', /^archivos:$/, 'older name'],
  ['web/src/ui/files/workers.d.ts', /^(Trabajador|opciones)$/, 'older name'],
  ['web/src/ui/linkOptions.ts', /^accion$/, 'older name'],
  ['web/src/ui/RoomPanels.tsx', /^sugs$/, 'older name'],
  ['web/src/tools/catalog.ts', /^desde$/, 'older name: a query parameter of the catalogue tool'],
  ['{web/src/ui/Bar.tsx,web/src/ui/Dialog.tsx,web/src/ui/FindBar.tsx,web/src/ui/plainText.tsx}', /^data-(sala|sesion|copiar)$/, 'older name: DOM data attributes, with the CSS task'],
  // tests and QA scripts: test data, made-up names
  ['{test/**,**/*.test.ts,**/*.test.tsx,scripts/**}', /./, 'test data and QA scripts'],
];

const glob = (g: string): RegExp => {
  const alt = (s: string): string => s.replace(/\{([^}]*)\}/g, (_, a: string) => '(' + a.split(',').map(alt).join('|') + ')');
  return new RegExp('^' + alt(g).replace(/\./g, '\\.').replace(/\*\*\//g, '(.*/)?').replace(/\*\*/g, '.*').replace(/(?<!\.)\*/g, '[^/]*') + '$');
};
const allowed = ALLOWED.map(([g, re, why]) => ({ g: glob(g), re, why }));
const used = new Set<number>();
const isAllowed = (file: string, name: string) => { const i = allowed.findIndex(a => a.g.test(file) && a.re.test(name)); if (i >= 0) used.add(i); return i >= 0; };

describe('names in English', () => {
  it('no Spanish word in identifiers, names in strings, text keys or placeholders', () => {
    const hits = sources.flatMap(scan).filter(h => !isAllowed(h.file, h.name));
    expect(hits.map(h => `${h.file}:${h.line} ${h.kind} ${h.name} (${spanishWords(h.name).join(', ')})`)).toEqual([]);
  });

  it('no Spanish word in the names of tracked files', () => {
    const bad = tracked.filter(f => !/^(assets|web\/public\/audio|test\/fixtures)\//.test(f) && f.split('/').some(seg => spanishWords(seg.replace(/\.[^.]+$/, '')).length) && !isAllowed(f, f));
    expect(bad).toEqual([]);
  });

  // after the two above: an entry nothing needs any more goes, so a new name can't hide behind it
  it('every allowlist entry is still needed', () => {
    expect(ALLOWED.filter((_, i) => !used.has(i)).map(([g, re, why]) => `${g} ${re} (${why})`)).toEqual([]);
  });

  it('splits names into their Spanish words, and English homographs are not Spanish', () => {
    expect(spanishWords('salaIdNueva')).toEqual(['sala', 'nueva']);
    expect(spanishWords('refugio:fin-dialogo')).toEqual(['refugio', 'dialogo']);
    expect(spanishWords('motorSolo con fin')).toEqual([]);
  });
});
