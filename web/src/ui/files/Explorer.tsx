// Archivos: el explorador y el editor de las carpetas del refugio, al estilo de Cursor (y VS Code). A la izquierda, el
// árbol de la carpeta de la sala (con lo que ignora git atenuado y lo cambiado en color); a la derecha, pestañas y el
// editor (Monaco, el de VS Code: las mismas teclas para editar). Para tocar a mano un .env o cualquier archivo sin
// salir del juego. Los archivos van a la papelera de macOS, nunca se borran del todo.
//
// Teclas, como en Cursor (en macOS):
//   ventana: ⌘P abrir por nombre (también «ruta:línea») · ⌘S guardar · ⌥⌘S guardar todo · ⌘W cerrar la pestaña
//            ⌘⇧T reabrir la última cerrada · ⌃Tab, ⌥⌘←→ y ⌘1…⌘9 cambiar de pestaña · ⌘⇧E o ⌘0 al árbol
//            ⌘N archivo nuevo · ⌘⇧N carpeta nueva · ⌘M minimizar · ⌃⌘F ampliar · ⌘⇧W cerrar la ventana
//   árbol:   ↑↓ moverse · → desplegar o entrar · ← plegar o subir · Espacio abrir sin dejar el árbol
//            ⌘↓ abrir y pasar al editor · Intro o F2 renombrar · ⌘⌫ a la papelera · ⌘C ⌘X ⌘V copiar, cortar y pegar
//            ⌥⌘C copiar la ruta (⌥⌘⇧C, la relativa) · ⌥⌘R mostrar en el Finder · escribir salta al nombre
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import { vivo, cliente } from '../../red/cliente';
import { t, idioma } from '@shared/idioma';
import { SFX } from '../../audio/sonido';
import { firstMapNow } from '../../motor/foco';
import { WindowButtons, CMD, MAC, nextZ } from '../ventanas';
import { openTerminalIn } from '../Terminales';
import { openGit } from '../git/ventana';
import { filesWindow, chooseRoot, lastRoot, minimizeFiles, closeFiles, closeFilesAlready, onFrontFiles, toggleMaximizeFiles, askClosing, type FilesWindow } from './ventana';
import { flatten, changedFolders, searchFiles, queryYLine, languageOf, unir, parentOf, nameOf, bajo, type Entrada, type Row } from './comun';

type M = typeof Monaco;
let cargando: Promise<M> | null = null;
const loadMonaco = () => (cargando ??= import('./monaco').then(m => m.monaco));

interface Root { ruta: string; nombre: string; salaId: string; detalle: string }
type Type = 'cargando' | 'texto' | 'imagen' | 'binario' | 'grande' | 'error';
interface Pestana { clave: string; raiz: string; rel: string; previa: boolean; tipo: Type; fecha: number | null; sucia: boolean; inDisc?: 'cambiado' | 'borrado'; datos?: string; error?: string; tamano?: number }
interface Confirm { texto: React.ReactNode; botones: { texto: string; f: () => void; peligro?: boolean }[] }
interface Edit { modo: 'renombrar' | 'archivo' | 'carpeta'; carpeta: string; rel?: string }
interface Menu { x: number; y: number; rel: string; dir: boolean }

const clave = (raiz: string, rel: string) => raiz + '\0' + rel;
const TITLE_LETTER: Record<string, string> = { M: t('windows.modified'), A: t('windows.added'), D: t('windows.deleted'), U: t('windows.conflicted'), '?': t('windows.newUntracked'), R: t('windows.renamed'), T: t('windows.typeChanged') };
const sizeLegible = (n?: number) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// lo que vive fuera de React: los modelos del editor (con su historial de deshacer), cómo se veía cada pestaña y la
// versión guardada de cada una (deshacer hasta ella la deja limpia, como en los editores)
const modelos = new Map<string, Monaco.editor.ITextModel>();
const views = new Map<string, Monaco.editor.ICodeEditorViewState | null>();
const saved = new Map<string, number>();
const keyOf = new WeakMap<Monaco.editor.ITextModel, string>();   // la pestaña de cada modelo (cambia al renombrar)
let portapapeles: { origins: { raiz: string; rel: string }[]; mover: boolean } | null = null;
let nModel = 0;

// carpetas desplegadas de cada raíz (se recuerdan entre sesiones)
const EXPANDED = 'refugio.archivos.expandidos';
const expandedOf = (() => {
  let todo: Record<string, string[]> = {};
  try { todo = JSON.parse(localStorage.getItem(EXPANDED) || '{}'); } catch {}
  return {
    leer: (raiz: string) => new Set(todo[raiz] ?? []),
    guardar: (raiz: string, s: Set<string>) => { todo[raiz] = [...s].slice(0, 300); try { localStorage.setItem(EXPANDED, JSON.stringify(todo)); } catch {} },
  };
})();

// tras una recarga (aplicar cambios del juego, reiniciar), vuelve como estaba, con lo que no se había guardado
const REMEMBERED = 'refugio.archivos';
interface Memory { abierta: boolean; minimizada: boolean; maximizada: boolean; raiz: string | null; pestanas: { raiz: string; rel: string; previa: boolean; texto?: string }[]; activa: string | null }
let currentMemory: () => Memory | null = () => null;
let recovered: Memory | null = null;
addEventListener('pagehide', () => { try { const r = currentMemory(); if (r) sessionStorage.setItem(REMEMBERED, JSON.stringify(r)); } catch {} });
try {
  const r = JSON.parse(sessionStorage.getItem(REMEMBERED) || 'null') as Memory | null; sessionStorage.removeItem(REMEMBERED);
  if (r?.abierta) { recovered = r; filesWindow.set({ abierta: true, minimizada: !!r.minimizada, maximizada: !!r.maximizada, raiz: r.raiz, z: nextZ() }); }
} catch {}

// ---------------------------------------------------------------- las carpetas del refugio
function useRoots(): Root[] {
  const salas: any[] = vivo.usar(e => e.estado?.salas ?? []);
  const repos = vivo.usar(e => e.repos);
  return useMemo(() => {
    const out: Root[] = [];
    for (const s of salas) {
      if (!s.ruta) continue;
      const r = repos[s.id];
      out.push({ ruta: s.ruta, nombre: s.nombre, salaId: s.id, detalle: r?.rama ?? (r?.subrepos?.length ? t('windows.nRepos', { n: r.subrepos.length }) : '') });
      for (const w of r?.worktrees ?? []) if (!w.principal) out.push({ ruta: w.ruta, nombre: `${s.nombre} ◇ ${w.rama}`, salaId: s.id, detalle: 'worktree' });
    }
    return out;
  }, [salas, repos]);
}
/** La raíz de una carpeta cualquiera (un subrepo de un ala está dentro de la carpeta del ala). */
export const rootOf = (roots: { ruta: string }[], ruta: string | null | undefined) =>
  !ruta ? undefined : roots.find(r => r.ruta === ruta) ?? roots.filter(r => ruta.startsWith(r.ruta.replace(/\/$/, '') + '/')).sort((a, b) => b.ruta.length - a.ruta.length)[0];

export function Explorador() {
  const v = filesWindow.usar(e => e);
  const roots = useRoots();
  if (!v.abierta) return null;
  const raiz = rootOf(roots, v.raiz)?.ruta ?? rootOf(roots, lastRoot())?.ruta ?? roots[0]?.ruta ?? null;
  return <Window v={v} roots={roots} raiz={raiz} />;
}

function Window({ v, roots, raiz }: { v: FilesWindow; roots: Root[]; raiz: string | null }) {
  const sala = roots.find(r => r.ruta === raiz);
  const [mon, setMon] = useState<M | null>(null);
  const [listed, setListed] = useState<Record<string, Entrada[] | undefined>>({});
  const [expandidos, setExpanded] = useState<Set<string>>(() => (raiz ? expandedOf.leer(raiz) : new Set()));
  const [git, setGit] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [pestanas, setTabs] = useState<Pestana[]>([]);
  const [activa, setActive] = useState<string | null>(null);
  const [rapido, setFast] = useState(false);
  const [confirmar, setConfirm] = useState<Confirm | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [aviso, setNotice] = useState<{ texto: string; error: boolean; id: number } | null>(null);
  const [cursor, setCursor] = useState<{ linea: number; col: number; sel: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const caja = useRef<HTMLDivElement>(null), treeRef = useRef<HTMLDivElement>(null), anfitrion = useRef<HTMLDivElement>(null), zoneEditor = useRef<HTMLDivElement>(null);
  const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const closed = useRef<{ raiz: string; rel: string }[]>([]);
  const recientes = useRef<string[]>([]);
  const estado = useRef({ pestanas, activa, raiz, expandidos }); estado.current = { pestanas, activa, raiz, expandidos };

  const avisar = useCallback((texto: string, error = false) => { setNotice({ texto, error, id: Date.now() }); if (error) SFX.error(); }, []);
  useEffect(() => { if (aviso) { const t = setTimeout(() => setNotice(a => (a?.id === aviso.id ? null : a)), aviso.error ? 9000 : 3500); return () => clearTimeout(t); } }, [aviso]);
  const accion = useCallback(<T,>(nombre: string, datos: Record<string, unknown>) => cliente.accion<T>('archivos.' + nombre, datos, 60_000), []);
  const activeTab = pestanas.find(p => p.clave === activa) ?? null;
  const actualizar = (k: string, p: Partial<Pestana>) => setTabs(ps => ps.map(x => (x.clave === k ? { ...x, ...p } : x)));

  // ---- Monaco y el editor (uno para todas las pestañas: cada una con su modelo)
  useEffect(() => { let vivo = true; loadMonaco().then(m => { if (vivo) setMon(m); }, e => avisar(t('windows.couldNotLoadTheEditor', { error: e.message }), true)); return () => { vivo = false; }; }, []);
  useEffect(() => {
    if (!mon || !anfitrion.current) return;
    const ed = mon.editor.create(anfitrion.current, {
      theme: 'refugio', automaticLayout: true, fontFamily: 'Menlo, Monaco, "SF Mono", monospace', fontSize: 13, lineHeight: 20,
      minimap: { enabled: true, renderCharacters: false }, smoothScrolling: true, cursorSmoothCaretAnimation: 'on', fixedOverflowWidgets: true,
      renderWhitespace: 'selection', bracketPairColorization: { enabled: true }, guides: { bracketPairs: 'active' }, stickyScroll: { enabled: true }, model: null,
    });
    editor.current = ed;
    const subs = [
      ed.onDidChangeCursorSelection(e => { const s = e.selection; setCursor({ linea: s.positionLineNumber, col: s.positionColumn, sel: ed.getModel()?.getValueInRange(s).length ?? 0 }); }),
    ];
    return () => { subs.forEach(s => s.dispose()); ed.dispose(); editor.current = null; };
  }, [mon]);
  // el modelo de la pestaña activa (guardando cómo se veía la anterior)
  const inEditor = useRef<string | null>(null);
  useEffect(() => {
    const ed = editor.current; if (!ed) return;
    const p = activeTab, m = p?.tipo === 'texto' ? modelos.get(p.clave) : undefined;
    if (inEditor.current !== (m ? p!.clave : null)) {
      if (inEditor.current && modelos.has(inEditor.current)) views.set(inEditor.current, ed.saveViewState());
      ed.setModel(m ?? null);
      if (m) { const vs = views.get(p!.clave); if (vs) ed.restoreViewState(vs); }
      inEditor.current = m ? p!.clave : null;
      setCursor(null);
    }
    applyPending();
  }, [mon, activa, activeTab?.tipo]);
  // ir a una línea y pasar al editor, en cuanto el archivo pedido esté en él
  const pending = useRef<{ k: string; linea?: number; columna?: number; foco?: boolean } | null>(null);
  const applyPending = () => {
    const ed = editor.current, x = pending.current;
    if (!ed || !x || inEditor.current !== x.k || ed.getModel() !== modelos.get(x.k)) return;
    pending.current = null;
    if (x.linea) { const pos = { lineNumber: x.linea, column: x.columna ?? 1 }; ed.setPosition(pos); ed.revealPositionInCenter(pos); }
    if (x.foco || x.linea) ed.focus();
  };
  // al cerrar la ventana, se va todo
  useEffect(() => () => { for (const m of modelos.values()) m.dispose(); modelos.clear(); views.clear(); saved.clear(); }, []);

  // ---- abrir archivos
  const crearModelo = (m: M, k: string, rel: string, texto: string) => {
    const uri = m.Uri.from({ scheme: 'archivo', path: `/${++nModel}/${rel}` });
    const modelo = m.editor.createModel(texto, languageOf(nameOf(rel), m.languages.getLanguages()), uri);
    modelos.set(k, modelo); saved.set(k, modelo.getAlternativeVersionId()); keyOf.set(modelo, k);
    modelo.onDidChangeContent(() => {
      const k = keyOf.get(modelo)!, sucia = modelo.getAlternativeVersionId() !== saved.get(k);
      // editar una pestaña de vista previa la fija, como en los editores
      setTabs(ps => ps.map(x => (x.clave === k && (x.sucia !== sucia || (sucia && x.previa)) ? { ...x, sucia, previa: sucia ? false : x.previa } : x)));
    });
    return modelo;
  };
  const cargar = async (r: string, rel: string, k: string, recoveredText?: string) => {
    try {
      const x = await accion<any>('leer', { raiz: r, rel });
      const m = await loadMonaco();
      if (x.tipo === 'texto') {
        const modelo = crearModelo(m, k, rel, x.texto);
        if (recoveredText !== undefined && recoveredText !== x.texto) modelo.pushEditOperations([], [{ range: modelo.getFullModelRange(), text: recoveredText }], () => null);
      }
      actualizar(k, { tipo: x.tipo, fecha: x.fecha, tamano: x.tamano, datos: x.datos, sucia: !!modelos.get(k) && modelos.get(k)!.getAlternativeVersionId() !== saved.get(k) });
    } catch (e: any) { actualizar(k, { tipo: 'error', error: e.message, fecha: null }); }
  };
  /** Abre (o trae) un archivo. `previa`: de un clic, la pestaña la ocupa el siguiente que se mire (en cursiva). */
  const abrir = useCallback(async (rel: string, o: { previa?: boolean; foco?: boolean; linea?: number; columna?: number; inRoot?: string } = {}) => {
    const r = o.inRoot ?? estado.current.raiz; if (!r) return;
    const k = clave(r, rel);
    let ps = estado.current.pestanas;
    const ya = ps.find(p => p.clave === k);
    if (ya) { if (!o.previa && ya.previa) ps = ps.map(p => (p.clave === k ? { ...p, previa: false } : p)); }
    else {
      const nueva: Pestana = { clave: k, raiz: r, rel, previa: !!o.previa, tipo: 'cargando', fecha: null, sucia: false };
      // la vista previa que hubiera (sin tocar) deja su sitio
      const old = o.previa ? ps.find(p => p.previa && !p.sucia) : undefined;
      if (old) { modelos.get(old.clave)?.dispose(); modelos.delete(old.clave); views.delete(old.clave); ps = ps.map(p => (p === old ? nueva : p)); }
      else { const i = ps.findIndex(p => p.clave === estado.current.activa); ps = [...ps.slice(0, i + 1), nueva, ...ps.slice(i + 1)]; }
    }
    pending.current = o.foco || o.linea ? { k, linea: o.linea, columna: o.columna, foco: o.foco } : null;
    // mientras se lee, el editor se esconde: las teclas se quedan en la ventana (no se escapan al refugio)
    if (o.foco && !ya) zoneEditor.current?.focus({ preventScroll: true });
    setTabs(ps); setActive(k);
    recientes.current = [k, ...recientes.current.filter(x => x !== k)].slice(0, 50);
    if (!ya) await cargar(r, rel, k);
    requestAnimationFrame(applyPending);   // si ya estaba en el editor, el efecto no vuelve a pasar
  }, [accion]);

  // vuelve lo que había antes de recargar la página
  useEffect(() => {
    const r = recovered; recovered = null; if (!r) return;
    for (const p of r.pestanas) {
      const k = clave(p.raiz, p.rel);
      setTabs(ps => (ps.some(x => x.clave === k) ? ps : [...ps, { clave: k, raiz: p.raiz, rel: p.rel, previa: p.previa, tipo: 'cargando', fecha: null, sucia: false }]));
      cargar(p.raiz, p.rel, k, p.texto);
    }
    if (r.activa) setActive(r.activa);
  }, []);
  currentMemory = () => {
    const w = filesWindow.get();
    return { abierta: w.abierta, minimizada: w.minimizada, maximizada: w.maximizada, raiz: w.raiz, activa: estado.current.activa,
      pestanas: estado.current.pestanas.filter(p => p.tipo !== 'error').map(p => ({ raiz: p.raiz, rel: p.rel, previa: p.previa, ...(p.sucia && modelos.get(p.clave) ? { texto: modelos.get(p.clave)!.getValue() } : {}) })) };
  };
  useEffect(() => () => { currentMemory = () => null; }, []);

  // lo que piden desde fuera (abrir un archivo concreto)
  // (relativo a la carpeta pedida, que puede ser un repo dentro de la de un ala)
  useEffect(() => {
    if (!v.abrir || !raiz) return;
    const o = v.abrir, insideOf = v.raiz && v.raiz !== raiz && v.raiz.startsWith(raiz) ? v.raiz.slice(raiz.length).replace(/^\/+|\/+$/g, '') : '';
    const rel = unir(insideOf, o.rel);
    filesWindow.set({ abrir: null }); revelar(rel); abrir(rel, { linea: o.linea, foco: true });
  }, [v.abrir, raiz]);

  // ---- el árbol: listados de las carpetas desplegadas, cambios de git y fechas de lo abierto
  const pedido = useRef(0);
  const vistazo = useCallback(async (o: { git?: boolean; carpetas?: string[] } = {}) => {
    const { raiz: r, expandidos: ex, pestanas: ps } = estado.current; if (!r) return;
    const n = ++pedido.current;
    try {
      const x = await accion<{ listed: Record<string, Entrada[] | null>; git?: Record<string, string>; fechas: Record<string, number | null> }>('vistazo', {
        raiz: r, carpetas: o.carpetas ?? ['', ...ex], git: o.git ?? true, abiertos: o.carpetas ? [] : ps.filter(p => p.raiz === r).map(p => p.rel),
      });
      if (estado.current.raiz !== r) return;
      setListed(l => { const out = o.carpetas ? { ...l } : {}; for (const [c, es] of Object.entries(x.listed)) if (es) out[c] = es; return out; });
      const perdidas = Object.entries(x.listed).filter(([c, es]) => !es && c).map(([c]) => c);
      if (perdidas.length) setExpanded(s => { const t = new Set([...s].filter(c => !perdidas.some(p => bajo(c, p)))); expandedOf.guardar(r, t); return t; });
      if (x.git && n === pedido.current) setGit(x.git);
      reviewDates(r, x.fechas);
    } catch (e: any) { if (!o.carpetas) avisar(e.message, true); }
  }, [accion]);
  // las pestañas de otras raíces también se vigilan
  const watchOther = useCallback(async () => {
    const rootBy = new Map<string, string[]>();
    for (const p of estado.current.pestanas) if (p.raiz !== estado.current.raiz && p.fecha != null) rootBy.set(p.raiz, [...(rootBy.get(p.raiz) ?? []), p.rel]);
    for (const [r, rels] of rootBy) accion<any>('vistazo', { raiz: r, carpetas: [], git: false, abiertos: rels }).then(x => reviewDates(r, x.fechas), () => {});
  }, [accion]);
  // un archivo abierto que cambia en el disco: si no lo has tocado, se recarga (y se puede deshacer); si sí, se avisa
  const reviewDates = (r: string, fechas: Record<string, number | null>) => {
    for (const p of estado.current.pestanas) {
      if (p.raiz !== r || !(p.rel in fechas) || p.tipo === 'cargando') continue;
      const f = fechas[p.rel];
      if (f === null) { if (p.inDisc !== 'borrado' && p.fecha !== null) actualizar(p.clave, { inDisc: 'borrado' }); continue; }
      if (p.fecha !== null && Math.abs(f - p.fecha) <= 1) { if (p.inDisc) actualizar(p.clave, { inDisc: undefined }); continue; }
      if (modelos.has(p.clave) && p.sucia) { if (p.inDisc !== 'cambiado') actualizar(p.clave, { inDisc: 'cambiado' }); continue; }
      recargar(p);
    }
  };
  /** Lo del disco, en la pestaña (sustituye el texto con una edición: se puede deshacer). */
  const recargar = (p: Pestana) => accion<any>('leer', { raiz: p.raiz, rel: p.rel }).then(x => {
    const m = modelos.get(p.clave);
    if (x.tipo === 'texto' && m && !m.isDisposed()) {
      if (m.getValue() !== x.texto) m.pushEditOperations([], [{ range: m.getFullModelRange(), text: x.texto }], () => null);
      saved.set(p.clave, m.getAlternativeVersionId());
      actualizar(p.clave, { fecha: x.fecha, tamano: x.tamano, sucia: false, inDisc: undefined });
    } else actualizar(p.clave, { tipo: x.tipo, fecha: x.fecha, tamano: x.tamano, datos: x.datos, inDisc: undefined });
  }, () => {});
  useEffect(() => {
    if (!raiz) return;
    setListed({}); setGit({}); setSel(null); setEdit(null);
    const ex = expandedOf.leer(raiz); setExpanded(ex); estado.current.expandidos = ex; estado.current.raiz = raiz;
    vistazo(); askList(raiz).catch(() => {});
  }, [raiz]);
  // mientras está a la vista, se relee cada 3 s (y al volver a la ventana)
  useEffect(() => {
    if (v.minimizada) return;
    const t = setInterval(() => { if (firstMapNow()) { vistazo(); watchOther(); } }, 3000);
    const f = () => { vistazo(); watchOther(); }; addEventListener('focus', f);
    return () => { clearInterval(t); removeEventListener('focus', f); };
  }, [v.minimizada, vistazo, watchOther]);

  const filas = useMemo(() => flatten(listed, expandidos), [listed, expandidos]);
  const changed = useMemo(() => changedFolders(git), [git]);
  const ponerExpandidos = (f: (s: Set<string>) => Set<string>) => {
    const t = f(new Set(estado.current.expandidos)); estado.current.expandidos = t; setExpanded(t);
    if (raiz) expandedOf.guardar(raiz, t);
    const faltan = [...t].filter(c => !listed[c]); if (faltan.length) vistazo({ carpetas: faltan, git: false });
  };
  const alternar = (rel: string, abrirla?: boolean) => ponerExpandidos(s => { if (abrirla ?? !s.has(rel)) s.add(rel); else s.delete(rel); return s; });
  /** Despliega hasta el archivo y lo elige (como «revelar» en los editores). */
  const revelar = (rel: string) => {
    const parents: string[] = []; for (let p = parentOf(rel); p; p = parentOf(p)) parents.push(p);
    if (parents.some(p => !estado.current.expandidos.has(p))) ponerExpandidos(s => { parents.forEach(p => s.add(p)); return s; });
    setSel(rel);
  };
  // el árbol sigue a la pestaña activa (si es de esta raíz)
  useEffect(() => { if (activeTab && activeTab.raiz === raiz) revelar(activeTab.rel); }, [activa]);
  // la fila elegida, a la vista
  useEffect(() => { if (sel != null) treeRef.current?.querySelector(`[data-rel="${CSS.escape(sel)}"]`)?.scrollIntoView({ block: 'nearest' }); }, [sel, filas]);

  // ---- guardar y cerrar
  const guardar = async (k: string, forzar = false): Promise<boolean> => {
    const p = estado.current.pestanas.find(x => x.clave === k), m = modelos.get(k);
    if (!p || !m) return true;
    const version = m.getAlternativeVersionId();
    try {
      const r = await accion<{ conflicto: boolean; fecha: number }>('guardar', { raiz: p.raiz, rel: p.rel, texto: m.getValue(), fecha: p.fecha ?? undefined, forzar });
      if (r.conflicto) {
        return await new Promise<boolean>(ok => setConfirm({
          texto: <><b>{nameOf(p.rel)}</b> {t('windows.hasChangedOnDiskSince')}</>,
          botones: [
            { texto: t('windows.overwriteWithMine'), peligro: true, f: () => guardar(k, true).then(ok) },
            { texto: t('windows.discardMineAndReload'), f: () => { recargar(p); ok(false); } },
            { texto: t('windows.cancel'), f: () => ok(false) },
          ],
        }));
      }
      saved.set(k, version);
      actualizar(k, { fecha: r.fecha, sucia: m.getAlternativeVersionId() !== version, inDisc: undefined, previa: false, tipo: 'texto' });
      SFX.tick();
      return true;
    } catch (e: any) { avisar(e.message, true); return false; }
  };
  const saveAll = async () => { for (const p of estado.current.pestanas.filter(x => x.sucia)) if (!(await guardar(p.clave))) return false; return true; };
  const removeTab = (k: string) => {
    const ps = estado.current.pestanas, i = ps.findIndex(p => p.clave === k); if (i < 0) return;
    const p = ps[i];
    closed.current = [{ raiz: p.raiz, rel: p.rel }, ...closed.current.filter(x => clave(x.raiz, x.rel) !== k)].slice(0, 20);
    if (inEditor.current === k) { editor.current?.setModel(null); inEditor.current = null; }
    modelos.get(k)?.dispose(); modelos.delete(k); views.delete(k); saved.delete(k);
    recientes.current = recientes.current.filter(x => x !== k);
    const resto = ps.filter(x => x.clave !== k);
    setTabs(resto);
    if (estado.current.activa === k) {
      const otra = recientes.current.find(x => resto.some(r => r.clave === x)) ?? resto[Math.min(i, resto.length - 1)]?.clave ?? null;
      setActive(otra);
      // el foco, a la que queda (o al árbol si no queda ninguna), no al refugio
      if (caja.current?.contains(document.activeElement) || document.activeElement === document.body) { if (otra) { pending.current = { k: otra, foco: true }; zoneEditor.current?.focus({ preventScroll: true }); } else treeRef.current?.focus(); }
    }
  };
  const closeTab = (k: string | null) => {
    if (!k) { closeFiles(); return; }
    const p = estado.current.pestanas.find(x => x.clave === k); if (!p) return;
    if (!p.sucia) { removeTab(k); return; }
    setActive(k);
    setConfirm({ texto: <>{t('windows.saveTheChangesTo')} <b>{nameOf(p.rel)}</b>? {t('windows.otherwiseTheyAreLost')}</>, botones: [
      { texto: t('windows.save'), f: async () => { if (await guardar(k)) removeTab(k); } },
      { texto: t('windows.donTSave'), peligro: true, f: () => removeTab(k) },
      { texto: t('windows.cancel'), f: () => {} },
    ] });
  };
  // cerrar la ventana con algo sin guardar pregunta
  const nClosing = askClosing.usar(e => e.n);
  const firstClosing = useRef(nClosing);
  useEffect(() => {
    if (nClosing === firstClosing.current) return;
    const sucias = estado.current.pestanas.filter(p => p.sucia);
    if (!sucias.length) { closeFilesAlready(); return; }
    onFrontFiles();
    setConfirm({ texto: <>{sucias.length === 1 ? <><b>{nameOf(sucias[0].rel)}</b> {t('windows.hasUnsavedChanges')}</> : <>{t('windows.thereAre')} <b>{t('windows.nFiles', { n: sucias.length })}</b> {t('windows.withUnsavedChanges')}</>} {t('windows.saveThemBeforeClosing')}</>, botones: [
      { texto: t('windows.saveAndClose'), f: async () => { if (await saveAll()) closeFilesAlready(); } },
      { texto: t('windows.closeWithoutSaving'), peligro: true, f: closeFilesAlready },
      { texto: t('windows.cancel'), f: () => {} },
    ] });
  }, [nClosing]);

  // ---- operaciones con archivos
  const tras = async (f: () => Promise<unknown>, ok?: string) => {
    try { await f(); if (ok) { avisar(ok); SFX.shortSuccess(); } } catch (e: any) { avisar(e.message, true); }
    await vistazo();
  };
  const selFolder = () => { if (sel == null) return ''; const f = filas.find(x => x.rel === sel); return f?.dir ? sel : parentOf(sel); };
  const nuevo = (dir: boolean, carpeta = selFolder()) => { if (carpeta) alternar(carpeta, true); setEdit({ modo: dir ? 'carpeta' : 'archivo', carpeta }); setMenu(null); };
  const renameSel = (rel = sel) => { if (rel) { setSel(rel); setEdit({ modo: 'renombrar', carpeta: parentOf(rel), rel }); setMenu(null); } };
  const confirmEdit = async (nombre: string) => {
    const ed = edit; setEdit(null); treeRef.current?.focus();
    if (!ed || !raiz) return;
    nombre = nombre.trim(); if (!nombre || (ed.modo === 'renombrar' && nombre === nameOf(ed.rel!))) return;
    try {
      if (ed.modo === 'renombrar') {
        const r = await accion<{ rel: string }>('renombrar', { raiz, rel: ed.rel, nombre });
        moveTabs(ed.rel!, r.rel); setSel(r.rel);
      } else {
        const r = await accion<{ rel: string }>('crear', { raiz, carpeta: ed.carpeta, nombre, dir: ed.modo === 'carpeta' });
        setSel(r.rel);
        if (ed.modo === 'archivo') { await vistazo(); revelar(r.rel); abrir(r.rel, { foco: true }); return; }
      }
    } catch (e: any) { avisar(e.message, true); }
    await vistazo();
  };
  // renombrar o mover algo abierto: sus pestañas lo siguen (con sus cambios y su historial)
  const moveTabs = (de: string, a: string, r = raiz) => {
    const ren = new Map<string, { k: string; rel: string }>();
    for (const p of estado.current.pestanas) if (p.raiz === r && bajo(p.rel, de)) { const rel = a + p.rel.slice(de.length); ren.set(p.clave, { k: clave(p.raiz, rel), rel }); }
    if (!ren.size) return;
    for (const [k1, { k: k2, rel }] of ren) {
      for (const mapa of [modelos, views, saved] as Map<string, any>[]) if (mapa.has(k1)) { mapa.set(k2, mapa.get(k1)); mapa.delete(k1); }
      const m = modelos.get(k2); if (m) { keyOf.set(m, k2); if (mon) mon.editor.setModelLanguage(m, languageOf(nameOf(rel), mon.languages.getLanguages())); }
      if (inEditor.current === k1) inEditor.current = k2;
      recientes.current = recientes.current.map(x => (x === k1 ? k2 : x));
    }
    setTabs(ps => ps.map(p => { const n = ren.get(p.clave); return n ? { ...p, clave: n.k, rel: n.rel } : p; }));
    setActive(x => (x && ren.get(x)?.k) || x);
  };
  const aTrash = (rel = sel) => {
    if (!rel || !raiz) return;
    const f = filas.find(x => x.rel === rel);
    setMenu(null);
    setConfirm({ texto: <>{f?.dir ? t('windows.moveTheFolder') : t('windows.move')} <b>{rel}</b> {t('windows.toTheTrashYouCan')}</>, botones: [
      { texto: t('windows.moveToTrash'), peligro: true, f: () => { const i = filas.findIndex(x => x.rel === rel); tras(() => accion('papelera', { raiz, rels: [rel] })).then(() => { setSel(filas[i + 1]?.rel ?? filas[i - 1]?.rel ?? null); treeRef.current?.focus(); }); } },
      { texto: t('windows.cancel'), f: () => treeRef.current?.focus() },
    ] });
  };
  const copiar = (mover: boolean, rel = sel) => { if (rel == null || !raiz || !rel) return; portapapeles = { origins: [{ raiz, rel }], mover }; avisar(mover ? t('windows.cutNombreAtajoVTo', { nombre: nameOf(rel), shortcut: CMD }) : t('windows.copiedNombreAtajoVTo', { nombre: nameOf(rel), shortcut: CMD })); setMenu(null); };
  const pegar = (carpeta = selFolder()) => {
    const pp = portapapeles; if (!pp || !raiz) { SFX.noAllowed(); return; }
    setMenu(null);
    tras(async () => {
      const r = await accion<{ rels: string[] }>('pegar', { raiz, carpeta, origins: pp.origins, mover: pp.mover });
      if (pp.mover) { pp.origins.forEach((o, i) => r.rels[i] && moveTabs(o.rel, r.rels[i], o.raiz)); portapapeles = null; }
      if (r.rels[0]) { if (carpeta) alternar(carpeta, true); setSel(r.rels[0]); }
    });
  };
  const moveA = (rel: string, carpeta: string) => {
    if (!raiz || parentOf(rel) === carpeta || bajo(carpeta, rel)) return;
    tras(async () => { const r = await accion<{ rels: string[] }>('pegar', { raiz, carpeta, origins: [{ raiz, rel }], mover: true }); if (r.rels[0]) { moveTabs(rel, r.rels[0]); if (carpeta) alternar(carpeta, true); setSel(r.rels[0]); } });
  };
  const copyPath = (relativa: boolean, rel = sel) => {
    if (rel == null || !raiz) return;
    const ruta = relativa ? rel || '.' : raiz.replace(/\/$/, '') + (rel ? '/' + rel : '');
    navigator.clipboard.writeText(ruta).then(() => avisar(t('windows.pathCopiedRuta', { ruta })), () => avisar(t('windows.couldNotCopyThePath'), true));
    setMenu(null);
  };
  const fuera = (que: 'revelar' | 'abrirEnEditor', rel = sel ?? '') => { if (raiz) accion(que, { raiz, rel }).catch(e => avisar(e.message, true)); setMenu(null); };

  // ---- teclas del árbol
  const typed = useRef({ texto: '', t: 0 });
  const elegir = (rel: string | null) => { setSel(rel); SFX.tick(); };
  const treeKey = (e: React.KeyboardEvent) => {
    if (edit) return;
    const cmd = MAC ? e.metaKey : e.ctrlKey;
    const i = sel == null ? -1 : filas.findIndex(f => f.rel === sel), f = filas[i];
    const ir = (j: number) => { const g = filas[Math.max(0, Math.min(filas.length - 1, j))]; if (g) elegir(g.rel); };
    let hecho = true;
    if (e.key === 'ArrowDown' && cmd) { if (f?.dir) alternar(f.rel); else if (f) abrir(f.rel, { foco: true }); }
    else if (e.key === 'ArrowUp' && cmd) { if (f && parentOf(f.rel)) elegir(parentOf(f.rel)); }
    else if (e.key === 'ArrowDown') ir(i + 1);
    else if (e.key === 'ArrowUp') ir(i < 0 ? filas.length - 1 : i - 1);
    else if (e.key === 'Home') ir(0);
    else if (e.key === 'End') ir(filas.length - 1);
    else if (e.key === 'PageDown') ir(i + 15);
    else if (e.key === 'PageUp') ir(i - 15);
    else if (e.key === 'ArrowRight') { if (f?.dir && !f.abierta) alternar(f.rel, true); else if (f?.dir && (filas[i + 1]?.nivel ?? -1) > f.nivel) ir(i + 1); }
    else if (e.key === 'ArrowLeft') { if (f?.dir && f.abierta) alternar(f.rel, false); else if (f && parentOf(f.rel)) elegir(parentOf(f.rel)); }
    else if ((e.key === 'Enter' && !cmd) || e.key === 'F2') { if (f) renameSel(f.rel); }
    else if (e.key === ' ') { if (f?.dir) alternar(f.rel); else if (f) abrir(f.rel, { previa: true }); }
    else if ((e.key === 'Backspace' && cmd) || e.key === 'Delete') { if (f) aTrash(f.rel); }
    else if (cmd && e.altKey && e.code === 'KeyC') copyPath(e.shiftKey);
    else if (cmd && e.altKey && e.code === 'KeyR') fuera('revelar');
    else if (cmd && !e.altKey && e.code === 'KeyC') copiar(false);
    else if (cmd && !e.altKey && e.code === 'KeyX') copiar(true);
    else if (cmd && !e.altKey && e.code === 'KeyV') pegar();
    else if (e.key === 'Escape') { if (portapapeles?.mover) { portapapeles = null; avisar(t('windows.cutCancelled')); } else hecho = false; }
    else if (e.key.length === 1 && !cmd && !e.ctrlKey && !e.altKey && e.key !== ' ') {
      // escribir salta a la siguiente fila cuyo nombre empieza así
      const ahora = Date.now(), t = typed.current;
      t.texto = (ahora - t.t > 800 ? '' : t.texto) + e.key.toLowerCase(); t.t = ahora;
      const desde = t.texto.length > 1 ? Math.max(0, i) : i + 1;
      const orden = [...filas.slice(desde), ...filas.slice(0, desde)];
      const g = orden.find(x => x.nombre.toLowerCase().startsWith(t.texto));
      if (g) elegir(g.rel); else SFX.noAllowed();
    }
    else hecho = false;
    if (hecho) { e.preventDefault(); e.stopPropagation(); }
  };

  // ---- teclas de la ventana (antes que el editor: solo las que el editor no usa)
  const moveTab = (paso: number) => { const ps = estado.current.pestanas; if (ps.length < 2) return; const i = ps.findIndex(p => p.clave === estado.current.activa); setActive(ps[(i + paso + ps.length) % ps.length].clave); SFX.tick(); };
  const windowKey = (e: React.KeyboardEvent) => {
    if (confirmar) return;   // la pregunta lleva sus teclas
    const cmd = MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey;
    let f: (() => void) | null = null;
    if (e.key === 'Escape' && menu) f = () => setMenu(null);
    else if (e.ctrlKey && !e.metaKey && e.key === 'Tab') f = () => moveTab(e.shiftKey ? -1 : 1);
    else if (e.ctrlKey && e.metaKey && e.code === 'KeyF') f = toggleMaximizeFiles;
    else if (e.ctrlKey && !e.metaKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) f = () => goTab(Number(e.code.slice(5)));
    else if (cmd) {
      if (e.code === 'KeyP' && !e.shiftKey && !e.altKey) f = () => { setFast(r => !r); setMenu(null); };
      else if (e.code === 'KeyS' && e.altKey) f = () => { saveAll(); };
      else if (e.code === 'KeyS' && !e.shiftKey) f = () => { if (estado.current.activa) guardar(estado.current.activa); };
      else if (e.code === 'KeyW' && e.shiftKey) f = closeFiles;
      else if (e.code === 'KeyW' && !e.altKey) f = () => closeTab(estado.current.activa);
      else if (e.code === 'KeyT' && e.shiftKey) f = () => { const c = closed.current.shift(); if (c) abrir(c.rel, { inRoot: c.raiz, foco: true }); else SFX.noAllowed(); };
      else if (e.code === 'KeyM' && !e.shiftKey && !e.altKey) f = minimizeFiles;
      else if ((e.code === 'KeyE' && e.shiftKey) || (e.code === 'Digit0' && !e.shiftKey)) f = () => { treeRef.current?.focus(); if (sel == null && filas[0]) setSel(filas[0].rel); };
      else if (e.code === 'KeyN' && !e.altKey) f = () => { treeRef.current?.focus(); nuevo(e.shiftKey); };
      else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) f = () => moveTab(e.key === 'ArrowRight' ? 1 : -1);
      else if (/^Digit[1-9]$/.test(e.code) && !e.shiftKey && !e.altKey) f = () => goTab(Number(e.code.slice(5)));
    }
    if (!f) return;
    e.preventDefault(); e.stopPropagation(); f();
  };
  const goTab = (n: number) => { const ps = estado.current.pestanas; const p = n === 9 ? ps[ps.length - 1] : ps[n - 1]; if (p) { setActive(p.clave); requestAnimationFrame(() => editor.current?.focus()); } };

  // al abrirse: el árbol (o el editor, si hay algo abierto) recibe las teclas
  useEffect(() => { if (!v.minimizada) requestAnimationFrame(() => { if (!caja.current?.contains(document.activeElement)) (estado.current.activa && editor.current?.getModel() ? editor.current.focus() : treeRef.current?.focus()); }); }, [v.minimizada]);

  const sucias = pestanas.filter(p => p.sucia).length;
  const headPath = activeTab ? `${activeTab.raiz.replace(/\/$/, '')}/${activeTab.rel}` : raiz ?? '';
  return (
    <div ref={caja} className={'ventana-git ventana-archivos interactivo' + (v.maximizada ? ' maximizada' : '') + (v.minimizada ? ' minimizada' : '')} style={{ zIndex: v.maximizada ? 200000 + v.z : v.z }}
      onPointerDown={e => { if (menu && !(e.target as HTMLElement).closest('.gc-menu')) setMenu(null); if (!v.minimizada && !(document.activeElement && caja.current?.contains(document.activeElement))) onFrontFiles(); }}
      onKeyDownCapture={windowKey} onKeyDown={e => e.stopPropagation()} role="dialog" aria-label={t('windows.files')}>
      <div className="vt-cabeza vn-cabeza" onDoubleClick={e => { if (!(e.target as HTMLElement).closest('button, select')) toggleMaximizeFiles(); }}>
        <span className="rejilla" /><span className={'piloto ' + (sucias ? 'esperando' : 'ociosa')} />
        <span className="vt-titulo">{t('windows.files4')} · {sala?.nombre ?? t('windows.noFolder')}</span>
        <span className="vt-ruta" title={headPath}>{headPath}</span>
        <WindowButtons maximizada={v.maximizada} minimizar={minimizeFiles} toggleMaximize={toggleMaximizeFiles} cerrar={closeFiles} closesThat={t('windows.theFilesWindow')} />
      </div>
      {!raiz ? <div className="gd-vacio">{t('windows.thereIsNoRoomWith')}</div> : (
        <div className="ex-cuerpo">
          <aside className="ex-lateral">
            <div className="ex-lateral-cabeza">
              <select className="gc-repo" value={raiz} onChange={e => { chooseRoot(e.target.value); treeRef.current?.focus(); }} title={t('windows.folderThatOfEachRoom')}>
                {roots.map(r => <option key={r.ruta} value={r.ruta}>{r.nombre}{r.detalle ? ` · ${r.detalle}` : ''}</option>)}
              </select>
              <span className="ex-botones">
                <button onClick={() => nuevo(false)} title={t('windows.newFileAtajo', { shortcut: `${CMD}N` })}>＋</button>
                <button onClick={() => nuevo(true)} title={t('windows.newFolderAtajo', { shortcut: `${CMD}⇧N` })}>⊞</button>
                <button onClick={() => { vistazo(); SFX.tick(); }} title={t('windows.reloadTheFolder')}>⟳</button>
                <button onClick={() => { ponerExpandidos(() => new Set()); setSel(null); SFX.tick(); }} title={t('windows.collapseAllFolders')}>⊟</button>
              </span>
            </div>
            <div ref={treeRef} className={'ex-arbol' + (dragging === '' ? ' destino' : '')} tabIndex={0} onKeyDown={treeKey}
              onFocus={() => { if (sel == null && filas[0]) setSel(filas[0].rel); }}
              onContextMenu={e => { if (e.target === e.currentTarget) { e.preventDefault(); setSel(null); openMenu(e, '', true); } }}
              onDragOver={e => { if (dragging != null && e.target === e.currentTarget) { e.preventDefault(); } }}
              onDrop={e => { if (e.target === e.currentTarget && dragging) { e.preventDefault(); moveA(dragging, ''); } setDragging(null); }}>
              {edit && edit.modo !== 'renombrar' && edit.carpeta === '' && <RowNew nivel={0} dir={edit.modo === 'carpeta'} confirmar={confirmEdit} cancelar={() => { setEdit(null); treeRef.current?.focus(); }} />}
              {filas.map(f => (
                <React.Fragment key={f.rel}>
                  <TreeRow f={f} sel={sel === f.rel} letra={f.dir ? changed.get(f.rel) : git[f.rel]} activa={activeTab?.raiz === raiz && activeTab?.rel === f.rel}
                    cortada={!!portapapeles?.mover && portapapeles.origins.some(o => o.raiz === raiz && o.rel === f.rel)}
                    renaming={edit?.modo === 'renombrar' && edit.rel === f.rel} confirmar={confirmEdit} cancelar={() => { setEdit(null); treeRef.current?.focus(); }}
                    clic={ev => { setSel(f.rel); if (f.dir) alternar(f.rel); else abrir(f.rel, { previa: true }); if (ev.detail === 1) treeRef.current?.focus(); }}
                    clickDouble={() => { if (!f.dir) abrir(f.rel, { foco: true }); }}
                    menu={ev => { ev.preventDefault(); setSel(f.rel); openMenu(ev, f.rel, f.dir); }}
                    arrastre={{ empezar: () => setDragging(f.rel), soltar: () => { if (dragging) moveA(dragging, f.dir ? f.rel : parentOf(f.rel)); setDragging(null); }, activo: dragging != null && dragging !== f.rel }} />
                  {edit && edit.modo !== 'renombrar' && f.dir && f.abierta && edit.carpeta === f.rel && <RowNew nivel={f.nivel + 1} dir={edit.modo === 'carpeta'} confirmar={confirmEdit} cancelar={() => { setEdit(null); treeRef.current?.focus(); }} />}
                </React.Fragment>
              ))}
              {listed[''] && !filas.length && !edit && <div className="gc-limpio">{t('windows.emptyFolderAtajoNCreates', { shortcut: CMD })}</div>}
              {!listed[''] && <div className="gc-limpio">{t('windows.readingTheFolder')}</div>}
            </div>
            <div className="ex-pista">
              <span><kbd>{CMD}P</kbd> {t('windows.openByName')}</span><span><kbd>{t('windows.enter')}</kbd> {t('windows.rename')}</span><span><kbd>{MAC ? '⌘⌫' : t('windows.del')}</kbd> {t('windows.moveToTrash2')}</span>
            </div>
            {aviso && <div className={'gc-aviso' + (aviso.error ? ' error' : '')} onClick={() => setNotice(null)} title={t('windows.clickToDismiss')}>{aviso.texto}</div>}
          </aside>
          <main className="ex-principal">
            {pestanas.length > 0 && (
              <div className="ex-pestanas" onDoubleClick={e => { if (e.target === e.currentTarget) nuevo(false, ''); }}>
                {pestanas.map((p, i) => {
                  const repeated = pestanas.some(o => o !== p && nameOf(o.rel) === nameOf(p.rel));
                  return (
                    <div key={p.clave} className={'ex-pestana' + (p.clave === activa ? ' activa' : '') + (p.previa ? ' previa' : '') + (p.inDisc === 'borrado' ? ' borrada' : '') + (p.sucia ? ' sucia' : '')}
                      onClick={() => { setActive(p.clave); requestAnimationFrame(() => editor.current?.focus()); }} onDoubleClick={() => actualizar(p.clave, { previa: false })}
                      onAuxClick={e => { if (e.button === 1) closeTab(p.clave); }}
                      title={`${p.raiz.replace(/\/$/, '')}/${p.rel}${p.inDisc === 'cambiado' ? '\n' + t('windows.itChangedOnDiskWhile') : p.inDisc === 'borrado' ? '\n' + t('windows.itIsNoLongerOn') : ''}${i < 9 ? `\n${CMD}${i + 1}` : ''}`}>
                      <span className="ex-pestana-nombre">{nameOf(p.rel)}</span>
                      {(repeated || p.raiz !== raiz) && <span className="ex-pestana-carpeta">{p.raiz !== raiz ? (roots.find(r => r.ruta === p.raiz)?.nombre ?? '') + (parentOf(p.rel) ? ' · ' : '') : ''}{parentOf(p.rel).split('/').pop()}</span>}
                      {p.inDisc === 'cambiado' && <span className="ex-pestana-ojo" title={t('windows.itChangedOnDisk')}>⚠</span>}
                      <button className="ex-pestana-x" onClick={e => { e.stopPropagation(); closeTab(p.clave); }} title={t('windows.closeAtajo', { shortcut: `${CMD}W` })}>{p.sucia ? '●' : '×'}</button>
                    </div>
                  );
                })}
              </div>
            )}
            <div ref={zoneEditor} className="ex-editor" tabIndex={-1}>
              <div ref={anfitrion} className="ex-monaco" style={{ visibility: activeTab?.tipo === 'texto' ? 'inherit' : 'hidden' }} />
              {activeTab?.tipo !== 'texto' && (
                <div className="ex-otro">
                  {!activeTab && <Welcome raiz={raiz} cargado={!!mon} />}
                  {activeTab?.tipo === 'cargando' && <div className="gd-vacio">{t('windows.opening')}</div>}
                  {activeTab?.tipo === 'imagen' && <div className="ex-imagen"><img src={activeTab.datos} alt={activeTab.rel} /><small>{nameOf(activeTab.rel)} · {sizeLegible(activeTab.tamano)}</small></div>}
                  {(activeTab?.tipo === 'binario' || activeTab?.tipo === 'grande' || activeTab?.tipo === 'error') && (
                    <div className="gd-vacio">
                      <p>{activeTab.tipo === 'binario' ? t('windows.thisIsABinaryFile') : activeTab.tipo === 'grande' ? t('windows.itIsTooLargeTo', { tamano: sizeLegible(activeTab.tamano) }) : activeTab.error}</p>
                      {activeTab.tipo !== 'error' && <p><button className="gc-boton" onClick={() => fuera('abrirEnEditor', activeTab.rel)}>{t('windows.openInCursor')}</button> <button className="gc-boton" onClick={() => fuera('revelar', activeTab.rel)}>{t('windows.showInFinder')}</button></p>}
                    </div>
                  )}
                </div>
              )}
            </div>
            {activeTab && (
              <div className="ex-estado">
                <span className="ex-estado-ruta">{activeTab.rel}</span>
                {activeTab.inDisc === 'cambiado' && <span className="ex-estado-alerta">{t('windows.changedOnDiskILl')}</span>}
                {activeTab.inDisc === 'borrado' && <span className="ex-estado-alerta">{t('windows.noLongerOnDiskSaving')}</span>}
                {git[activeTab.rel] && activeTab.raiz === raiz && <button className="gc-enlace" onClick={() => openGit({ ruta: raiz, vista: 'cambios' })} title={t('windows.seeItInTheGit')}>git: {TITLE_LETTER[git[activeTab.rel]] ?? git[activeTab.rel]}</button>}
                <span className="ex-estado-der">
                  {cursor && activeTab.tipo === 'texto' && <span>{t('windows.lnLineaColCol', { linea: cursor.linea, col: cursor.col })}{cursor.sel ? ` (${t('windows.nSelected', { n: cursor.sel })})` : ''}</span>}
                  {activeTab.tipo === 'texto' && modelos.get(activeTab.clave) && <InfoModel m={modelos.get(activeTab.clave)!} mon={mon} />}
                  <span className={activeTab.sucia ? 'ex-sucio' : 'tenue'}>{activeTab.sucia ? t('windows.unsavedAtajoS', { shortcut: CMD }) : t('windows.saved')}</span>
                </span>
              </div>
            )}
          </main>
        </div>
      )}
      {rapido && raiz && <OpenFast raiz={raiz} recientes={recientes.current.filter(k => k.startsWith(raiz + '\0')).map(k => k.slice(raiz.length + 1))} cerrar={volver => { setFast(false); if (volver) requestAnimationFrame(() => (editor.current?.getModel() ? editor.current.focus() : treeRef.current?.focus())); }}
        abrir={(rel, linea, columna) => { setFast(false); revelar(rel); abrir(rel, { foco: true, linea, columna }); }} avisar={avisar} />}
      {menu && raiz && (
        <div className="gc-menu ex-menu" style={{ left: menu.x, top: menu.y }} onContextMenu={e => e.preventDefault()}>
          <button onClick={() => nuevo(false, menu.dir ? menu.rel : parentOf(menu.rel))}>{t('windows.newFile')} <kbd>{CMD}N</kbd></button>
          <button onClick={() => nuevo(true, menu.dir ? menu.rel : parentOf(menu.rel))}>{t('windows.newFolder')} <kbd>{CMD}⇧N</kbd></button>
          <hr />
          {menu.rel && <button onClick={() => copiar(true, menu.rel)}>{t('windows.cut')} <kbd>{CMD}X</kbd></button>}
          {menu.rel && <button onClick={() => copiar(false, menu.rel)}>{t('windows.copy2')} <kbd>{CMD}C</kbd></button>}
          <button disabled={!portapapeles} onClick={() => pegar(menu.dir ? menu.rel : parentOf(menu.rel))}>{t('windows.paste')} <kbd>{CMD}V</kbd></button>
          <hr />
          <button onClick={() => copyPath(false, menu.rel)}>{t('windows.copyPath')} <kbd>⌥{CMD}C</kbd></button>
          <button onClick={() => copyPath(true, menu.rel)}>{t('windows.copyRelativePath')} <kbd>⌥⇧{CMD}C</kbd></button>
          <button onClick={() => fuera('revelar', menu.rel)}>{t('windows.showInFinder')} <kbd>⌥{CMD}R</kbd></button>
          <button onClick={() => fuera('abrirEnEditor', menu.rel)}>{t('windows.openInCursor')}</button>
          {menu.dir && sala && <button onClick={() => { setMenu(null); const cwd = raiz.replace(/\/$/, '') + (menu.rel ? '/' + menu.rel : ''); openTerminalIn('archivos:' + cwd, sala.salaId, menu.rel ? `${sala.nombre} / ${nameOf(menu.rel)}` : sala.nombre, cwd); }}>{t('windows.openATerminalHere')}</button>}
          {menu.rel && <><hr />
            <button onClick={() => renameSel(menu.rel)}>{t('windows.rename2')} <kbd>{t('windows.enter')}</kbd></button>
            <button className="peligro" onClick={() => aTrash(menu.rel)}>{t('windows.moveToTrash')} <kbd>{MAC ? '⌘⌫' : t('windows.del')}</kbd></button></>}
        </div>
      )}
      {confirmar && <Question c={confirmar} cerrar={() => setConfirm(null)} volver={() => (editor.current?.getModel() && activeTab?.tipo === 'texto' ? editor.current.focus() : treeRef.current?.focus())} />}
    </div>
  );

  function openMenu(e: React.MouseEvent, rel: string, dir: boolean) {
    const r = caja.current!.getBoundingClientRect();
    setMenu({ x: Math.min(e.clientX - r.left, r.width - 260), y: Math.min(e.clientY - r.top, r.height - 380), rel, dir });
  }
}

// ---------------------------------------------------------------- piezas
function TreeRow({ f, sel, letra, activa, cortada, renaming, confirmar, cancelar, clic, clickDouble, menu, arrastre }: {
  f: Row; sel: boolean; letra?: string; activa: boolean; cortada: boolean; renaming: boolean; confirmar: (n: string) => void; cancelar: () => void
  clic: (e: React.MouseEvent) => void; clickDouble: () => void; menu: (e: React.MouseEvent) => void; arrastre: { empezar: () => void; soltar: () => void; activo: boolean }
}) {
  const [encima, setAbove] = useState(false);
  return (
    <div data-rel={f.rel} className={'ex-fila' + (sel ? ' sel' : '') + (activa ? ' activa' : '') + (f.e.ignorado ? ' ignorado' : '') + (cortada ? ' cortada' : '') + (letra ? ' l-' + (letra === '?' ? 'N' : letra) : '') + (encima ? ' destino' : '')}
      style={{ paddingLeft: 8 + f.nivel * 12 }} onClick={clic} onDoubleClick={clickDouble} onContextMenu={menu}
      draggable={!renaming} onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f.rel); arrastre.empezar(); }}
      onDragOver={e => { if (arrastre.activo) { e.preventDefault(); setAbove(true); } }} onDragLeave={() => setAbove(false)}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); setAbove(false); arrastre.soltar(); }}
      title={(f.e.enlace ? t('windows.symbolicLink') + ' · ' : '') + (f.e.ignorado ? t('windows.ignoredByGit') + ' · ' : '') + (letra ? (f.dir ? t('windows.hasChangesInside') : TITLE_LETTER[letra] ?? letra) : '') || undefined}>
      {Array.from({ length: f.nivel }, (_, i) => <span key={i} className="ex-guia" style={{ left: 14 + i * 12 }} />)}
      <span className={'ex-flecha' + (f.dir ? (f.abierta ? ' dir abierta' : ' dir') : '')} />
      {renaming ? <NameField inicial={f.nombre} confirmar={confirmar} cancelar={cancelar} />
        : <span className="ex-nombre">{f.nombre}{f.e.enlace ? <i className="tenue"> ↪</i> : null}</span>}
      {letra && !renaming && <span className="ex-letra">{f.dir ? '•' : letra === '?' ? 'U' : letra}</span>}
    </div>
  );
}

function RowNew({ nivel, dir, confirmar, cancelar }: { nivel: number; dir: boolean; confirmar: (n: string) => void; cancelar: () => void }) {
  return (
    <div className="ex-fila sel" style={{ paddingLeft: 8 + nivel * 12 }}>
      <span className={'ex-flecha' + (dir ? ' dir' : '')} />
      <NameField inicial="" confirmar={confirmar} cancelar={cancelar} placeholder={dir ? t('windows.folderName') : t('windows.fileNameFolderFileWorks')} />
    </div>
  );
}

/** El nombre, editable en la propia fila: Intro confirma, Esc cancela, salir de él confirma (como en los editores). */
function NameField({ inicial, confirmar, cancelar, placeholder }: { inicial: string; confirmar: (n: string) => void; cancelar: () => void; placeholder?: string }) {
  const ref = useRef<HTMLInputElement>(null), hecho = useRef(false);
  useEffect(() => {
    const i = ref.current; if (!i) return;
    i.focus();
    // el nombre sin la extensión, elegido
    const punto = inicial.lastIndexOf('.'); i.setSelectionRange(0, punto > 0 ? punto : inicial.length);
  }, []);
  const fin = (ok: boolean) => { if (hecho.current) return; hecho.current = true; ok ? confirmar(ref.current?.value ?? '') : cancelar(); };
  return <input ref={ref} className="ex-campo" defaultValue={inicial} placeholder={placeholder} spellCheck={false} onClick={e => e.stopPropagation()}
    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); fin(true); } else if (e.key === 'Escape') { e.preventDefault(); fin(false); } }}
    onBlur={() => fin(true)} />;
}

function InfoModel({ m, mon }: { m: Monaco.editor.ITextModel; mon: M | null }) {
  const id = m.getLanguageId(), nombre = mon?.languages.getLanguages().find(l => l.id === id)?.aliases?.[0] ?? id;
  const o = m.getOptions();
  return <><span>{o.insertSpaces ? t('windows.spacesN', { n: o.tabSize }) : t('windows.tabSizeN', { n: o.tabSize })}</span><span>{m.getEOL() === '\n' ? 'LF' : 'CRLF'}</span><span>{nombre}</span></>;
}

function Welcome({ raiz, cargado }: { raiz: string; cargado: boolean }) {
  const shortcuts: [string, string][] = [
    [`${CMD}P`, t('windows.openAFileByName')], [`${CMD}S`, t('windows.save2')], [`${CMD}W`, t('windows.closeTheTab')], [`⌃Tab · ${CMD}1…9`, t('windows.switchTab')],
    [`${CMD}⇧E`, t('windows.backToTheTree')], ['↑↓ ←→', t('windows.moveAroundTheTree')], [t('windows.space'), t('windows.openWithoutLeavingTheTree')], [`${CMD}↓`, t('windows.openAndMoveToThe')],
    [`${t('windows.enter')} · F2`, t('windows.rename')], [`${CMD}N · ${CMD}⇧N`, t('windows.newFileOrFolder')], [`${CMD}C ${CMD}X ${CMD}V`, t('windows.copyCutAndPasteFiles')], [MAC ? '⌘⌫' : t('windows.del'), t('windows.moveToTrash2')],
  ];
  return (
    <div className="ex-bienvenida">
      <p className="tenue">{raiz}</p>
      <dl>{shortcuts.map(([k, d]) => <React.Fragment key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></React.Fragment>)}</dl>
      <p className="tenue">{cargado ? t('windows.insideTheEditorTheUsual') : t('windows.loadingTheEditor')}</p>
    </div>
  );
}

function Question({ c, cerrar, volver }: { c: Confirm; cerrar: () => void; volver: () => void }) {
  // al irse, el foco vuelve al editor o al árbol (y lo elegido lo puede llevar a otro sitio)
  const pulsar = (f: () => void) => { volver(); cerrar(); f(); };
  return (
    <div className="vt-confirmar" onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); const ultimo = c.botones[c.botones.length - 1]; pulsar(ultimo.f); } }}>
      <div className="vt-confirmar-caja">
        <p>{c.texto}</p>
        <div className="vt-confirmar-botones">
          {c.botones.map((b, i) => <button key={b.texto} className={'consola-x' + (b.peligro ? ' peligro' : '')} autoFocus={i === 0} onClick={() => pulsar(b.f)}>{b.texto}{i === 0 ? ` (${t('windows.enter')})` : i === c.botones.length - 1 ? ' (Esc)' : ''}</button>)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ⌘P
// la lista de archivos de cada carpeta: se pide al abrir la ventana (⌘P sale al momento) y vale 15 s
const lists = new Map<string, { rels: string[]; ts: number }>();
const asking = new Map<string, Promise<string[]>>();
function askList(raiz: string): Promise<string[]> {
  const c = lists.get(raiz); if (c && Date.now() - c.ts < 15_000) return Promise.resolve(c.rels);
  let p = asking.get(raiz);
  if (!p) {
    p = cliente.accion<{ rels: string[] }>('archivos.todos', { raiz }, 60_000).then(r => { lists.set(raiz, { rels: r.rels, ts: Date.now() }); return r.rels; }).finally(() => asking.delete(raiz));
    asking.set(raiz, p);
  }
  return p;
}
function OpenFast({ raiz, recientes, cerrar, abrir, avisar }: { raiz: string; recientes: string[]; cerrar: (volver: boolean) => void; abrir: (rel: string, linea?: number, columna?: number) => void; avisar: (t: string, e?: boolean) => void }) {
  const [texto, setText] = useState('');
  const [rels, setRels] = useState<string[] | null>(() => lists.get(raiz)?.rels ?? null);
  const [i, setI] = useState(recientes.length > 1 ? 1 : 0);   // como en los editores: Intro sin escribir vuelve al anterior
  const [inWait, setInWait] = useState(false);              // Intro antes de que llegue la lista: se abre al llegar
  const lista = useRef<HTMLDivElement>(null);
  useEffect(() => { let vivo = true; askList(raiz).then(r => { if (vivo) setRels(r); }, e => avisar(e.message, true)); return () => { vivo = false; }; }, [raiz]);
  const { consulta, linea, columna } = queryYLine(texto);
  const resultados = useMemo(() => {
    if (!consulta) return recientes.map(rel => ({ rel, puntos: 0, marks: [] as number[] })).concat((rels ?? []).filter(r => !recientes.includes(r)).slice(0, 40).map(rel => ({ rel, puntos: 0, marks: [] })));
    return searchFiles(consulta, rels ?? []);
  }, [consulta, rels, recientes]);
  useEffect(() => { if (consulta) setI(0); }, [consulta]);
  useEffect(() => { lista.current?.children[i]?.scrollIntoView({ block: 'nearest' }); }, [i]);
  const elegido = resultados[Math.min(i, resultados.length - 1)];
  useEffect(() => { if (inWait && rels) { setInWait(false); if (elegido) abrir(elegido.rel, linea, columna); else SFX.noAllowed(); } }, [inWait, rels]);
  return (
    <div className="ex-rapido" onKeyDown={e => e.stopPropagation()}>
      <input autoFocus value={texto} onChange={e => setText(e.target.value)} spellCheck={false} placeholder={rels ? t('windows.searchNFilesByName', { n: rels.length.toLocaleString(idioma() === 'en' ? 'en-GB' : 'es-ES') }) : t('windows.readingTheFiles')}
        onBlur={() => setTimeout(() => cerrar(false), 0)}
        onKeyDown={e => {
          const n = resultados.length;
          if (e.key === 'Escape' || ((MAC ? e.metaKey : e.ctrlKey) && e.code === 'KeyP')) { e.preventDefault(); cerrar(true); }
          else if (e.key === 'ArrowDown' || (e.ctrlKey && e.code === 'KeyN')) { e.preventDefault(); if (n) setI(x => (x + 1) % n); }
          else if (e.key === 'ArrowUp' || (e.ctrlKey && e.code === 'KeyP')) { e.preventDefault(); if (n) setI(x => (x - 1 + n) % n); }
          else if (e.key === 'Enter') { e.preventDefault(); if (!rels && consulta) setInWait(true); else if (elegido) abrir(elegido.rel, linea, columna); else SFX.noAllowed(); }
        }} />
      <div ref={lista} className="ex-rapido-lista">
        {resultados.map((r, k) => {
          const base = r.rel.lastIndexOf('/') + 1, marks = new Set(r.marks);
          const trozo = (desde: number, hasta: number) => Array.from(r.rel.slice(desde, hasta), (c, j) => (marks.has(desde + j) ? <b key={j}>{c}</b> : c));
          return (
            <div key={r.rel} className={'ex-rapido-item' + (k === i ? ' sel' : '')} onMouseDown={e => { e.preventDefault(); abrir(r.rel, linea, columna); }} onMouseMove={() => setI(k)}>
              <span className="ex-rapido-nombre">{trozo(base, r.rel.length)}</span>
              <span className="ex-rapido-carpeta">{trozo(0, Math.max(0, base - 1))}</span>
              {!consulta && recientes.includes(r.rel) && <span className="ex-rapido-reciente">{t('windows.recentlyOpened')}</span>}
            </div>
          );
        })}
        {rels && consulta && !resultados.length && <div className="ex-rapido-item tenue">{t('windows.noFileHasThatName')}</div>}
      </div>
    </div>
  );
}
