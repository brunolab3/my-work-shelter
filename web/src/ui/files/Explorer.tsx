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
import { live, client } from '../../net/client';
import { t, language } from '@shared/language';
import { SFX } from '../../audio/sound';
import { firstMapNow } from '../../engine/focus';
import { WindowButtons, CMD, MAC, nextZ } from '../windows';
import { openTerminalIn } from '../Terminals';
import { openGit } from '../git/window';
import { filesWindow, chooseRoot, lastRoot, minimizeFiles, closeFiles, closeFilesAlready, onFrontFiles, toggleMaximizeFiles, askClosing, type FilesWindow } from './window';
import { flatten, changedFolders, searchFiles, queryYLine, languageOf, union, parentOf, nameOf, under, type Entry, type Row } from './common';

type M = typeof Monaco;
let loading: Promise<M> | null = null;
const loadMonaco = () => (loading ??= import('./monaco').then(m => m.monaco));

interface Root { path: string; name: string; roomId: string; detail: string }
type Type = 'loading' | 'text' | 'image' | 'binary' | 'large' | 'error';
interface Tab { key: string; root: string; rel: string; previous: boolean; type: Type; date: number | null; dirty: boolean; inDisc?: 'changed' | 'deleted'; data?: string; error?: string; resize?: number }
interface Confirm { text: React.ReactNode; buttons: { text: string; f: () => void; danger?: boolean }[] }
interface Edit { mode: 'rename' | 'archive' | 'folder'; folder: string; rel?: string }
interface Menu { x: number; y: number; rel: string; dir: boolean }

const key = (root: string, rel: string) => root + '\0' + rel;
const TITLE_LETTER: Record<string, string> = { M: t('windows.modified'), A: t('windows.added'), D: t('windows.deleted'), U: t('windows.conflicted'), '?': t('windows.newUntracked'), R: t('windows.renamed'), T: t('windows.typeChanged') };
const sizeLegible = (n?: number) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// lo que vive fuera de React: los modelos del editor (con su historial de deshacer), cómo se veía cada pestaña y la
// versión guardada de cada una (deshacer hasta ella la deja limpia, como en los editores)
const models = new Map<string, Monaco.editor.ITextModel>();
const views = new Map<string, Monaco.editor.ICodeEditorViewState | null>();
const saved = new Map<string, number>();
const keyOf = new WeakMap<Monaco.editor.ITextModel, string>();   // la pestaña de cada modelo (cambia al renombrar)
let clipboard: { origins: { root: string; rel: string }[]; move: boolean } | null = null;
let nModel = 0;

// carpetas desplegadas de cada raíz (se recuerdan entre sesiones)
const EXPANDED = 'shelter.files.expanded';
const expandedOf = (() => {
  let all: Record<string, string[]> = {};
  try { all = JSON.parse(localStorage.getItem(EXPANDED) || '{}'); } catch {}
  return {
    read: (root: string) => new Set(all[root] ?? []),
    save: (root: string, s: Set<string>) => { all[root] = [...s].slice(0, 300); try { localStorage.setItem(EXPANDED, JSON.stringify(all)); } catch {} },
  };
})();

// tras una recarga (aplicar cambios del juego, reiniciar), vuelve como estaba, con lo que no se había guardado
const REMEMBERED = 'shelter.files';
interface Memory { open: boolean; minimized: boolean; maximized: boolean; root: string | null; tabs: { root: string; rel: string; previous: boolean; text?: string }[]; active: string | null }
let currentMemory: () => Memory | null = () => null;
let recovered: Memory | null = null;
addEventListener('pagehide', () => { try { const r = currentMemory(); if (r) sessionStorage.setItem(REMEMBERED, JSON.stringify(r)); } catch {} });
try {
  const r = JSON.parse(sessionStorage.getItem(REMEMBERED) || 'null') as Memory | null; sessionStorage.removeItem(REMEMBERED);
  if (r?.open) { recovered = r; filesWindow.set({ isOpen: true, minimized: !!r.minimized, maximized: !!r.maximized, root: r.root, z: nextZ() }); }
} catch {}

// ---------------------------------------------------------------- las carpetas del refugio
function useRoots(): Root[] {
  const rooms: any[] = live.use(e => e.state?.rooms ?? []);
  const repos = live.use(e => e.repos);
  return useMemo(() => {
    const out: Root[] = [];
    for (const s of rooms) {
      if (!s.path) continue;
      const r = repos[s.id];
      out.push({ path: s.path, name: s.name, roomId: s.id, detail: r?.branch ?? (r?.subrepos?.length ? t('windows.nRepos', { n: r.subrepos.length }) : '') });
      for (const w of r?.worktrees ?? []) if (!w.main) out.push({ path: w.path, name: `${s.name} ◇ ${w.branch}`, roomId: s.id, detail: 'worktree' });
    }
    return out;
  }, [rooms, repos]);
}
/** La raíz de una carpeta cualquiera (un subrepo de un ala está dentro de la carpeta del ala). */
export const rootOf = (roots: { path: string }[], path: string | null | undefined) =>
  !path ? undefined : roots.find(r => r.path === path) ?? roots.filter(r => path.startsWith(r.path.replace(/\/$/, '') + '/')).sort((a, b) => b.path.length - a.path.length)[0];

export function Explorer() {
  const v = filesWindow.use(e => e);
  const roots = useRoots();
  if (!v.isOpen) return null;
  const root = rootOf(roots, v.root)?.path ?? rootOf(roots, lastRoot())?.path ?? roots[0]?.path ?? null;
  return <Window v={v} roots={roots} root={root} />;
}

function Window({ v, roots, root }: { v: FilesWindow; roots: Root[]; root: string | null }) {
  const room = roots.find(r => r.path === root);
  const [mon, setMon] = useState<M | null>(null);
  const [listed, setListed] = useState<Record<string, Entry[] | undefined>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => (root ? expandedOf.read(root) : new Set()));
  const [git, setGit] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [fast, setFast] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean; id: number } | null>(null);
  const [cursor, setCursor] = useState<{ line: number; col: number; sel: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null), treeRef = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null), zoneEditor = useRef<HTMLDivElement>(null);
  const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const closed = useRef<{ root: string; rel: string }[]>([]);
  const recent = useRef<string[]>([]);
  const state = useRef({ tabs, active, root, expanded }); state.current = { tabs, active, root, expanded };

  const notify = useCallback((text: string, error = false) => { setNotice({ text, error, id: Date.now() }); if (error) SFX.error(); }, []);
  useEffect(() => { if (notice) { const t = setTimeout(() => setNotice(a => (a?.id === notice.id ? null : a)), notice.error ? 9000 : 3500); return () => clearTimeout(t); } }, [notice]);
  const action = useCallback(<T,>(name: string, data: Record<string, unknown>) => client.action<T>('files.' + name, data, 60_000), []);
  const activeTab = tabs.find(p => p.key === active) ?? null;
  const update = (k: string, p: Partial<Tab>) => setTabs(ps => ps.map(x => (x.key === k ? { ...x, ...p } : x)));

  // ---- Monaco y el editor (uno para todas las pestañas: cada una con su modelo)
  useEffect(() => { let live = true; loadMonaco().then(m => { if (live) setMon(m); }, e => notify(t('windows.couldNotLoadTheEditor', { error: e.message }), true)); return () => { live = false; }; }, []);
  useEffect(() => {
    if (!mon || !host.current) return;
    const ed = mon.editor.create(host.current, {
      theme: 'shelter', automaticLayout: true, fontFamily: 'Menlo, Monaco, "SF Mono", monospace', fontSize: 13, lineHeight: 20,
      minimap: { enabled: true, renderCharacters: false }, smoothScrolling: true, cursorSmoothCaretAnimation: 'on', fixedOverflowWidgets: true,
      renderWhitespace: 'selection', bracketPairColorization: { enabled: true }, guides: { bracketPairs: 'active' }, stickyScroll: { enabled: true }, model: null,
    });
    editor.current = ed;
    const subs = [
      ed.onDidChangeCursorSelection(e => { const s = e.selection; setCursor({ line: s.positionLineNumber, col: s.positionColumn, sel: ed.getModel()?.getValueInRange(s).length ?? 0 }); }),
    ];
    return () => { subs.forEach(s => s.dispose()); ed.dispose(); editor.current = null; };
  }, [mon]);
  // el modelo de la pestaña activa (guardando cómo se veía la anterior)
  const inEditor = useRef<string | null>(null);
  useEffect(() => {
    const ed = editor.current; if (!ed) return;
    const p = activeTab, m = p?.type === 'text' ? models.get(p.key) : undefined;
    if (inEditor.current !== (m ? p!.key : null)) {
      if (inEditor.current && models.has(inEditor.current)) views.set(inEditor.current, ed.saveViewState());
      ed.setModel(m ?? null);
      if (m) { const vs = views.get(p!.key); if (vs) ed.restoreViewState(vs); }
      inEditor.current = m ? p!.key : null;
      setCursor(null);
    }
    applyPending();
  }, [mon, active, activeTab?.type]);
  // ir a una línea y pasar al editor, en cuanto el archivo pedido esté en él
  const pending = useRef<{ k: string; line?: number; column?: number; focus?: boolean } | null>(null);
  const applyPending = () => {
    const ed = editor.current, x = pending.current;
    if (!ed || !x || inEditor.current !== x.k || ed.getModel() !== models.get(x.k)) return;
    pending.current = null;
    if (x.line) { const pos = { lineNumber: x.line, column: x.column ?? 1 }; ed.setPosition(pos); ed.revealPositionInCenter(pos); }
    if (x.focus || x.line) ed.focus();
  };
  // al cerrar la ventana, se va todo
  useEffect(() => () => { for (const m of models.values()) m.dispose(); models.clear(); views.clear(); saved.clear(); }, []);

  // ---- abrir archivos
  const createModel = (m: M, k: string, rel: string, text: string) => {
    const uri = m.Uri.from({ scheme: 'archive', path: `/${++nModel}/${rel}` });
    const model = m.editor.createModel(text, languageOf(nameOf(rel), m.languages.getLanguages()), uri);
    models.set(k, model); saved.set(k, model.getAlternativeVersionId()); keyOf.set(model, k);
    model.onDidChangeContent(() => {
      const k = keyOf.get(model)!, dirty = model.getAlternativeVersionId() !== saved.get(k);
      // editar una pestaña de vista previa la fija, como en los editores
      setTabs(ps => ps.map(x => (x.key === k && (x.dirty !== dirty || (dirty && x.previous)) ? { ...x, dirty, previous: dirty ? false : x.previous } : x)));
    });
    return model;
  };
  const load = async (r: string, rel: string, k: string, recoveredText?: string) => {
    try {
      const x = await action<any>('read', { root: r, rel });
      const m = await loadMonaco();
      if (x.type === 'text') {
        const model = createModel(m, k, rel, x.text);
        if (recoveredText !== undefined && recoveredText !== x.text) model.pushEditOperations([], [{ range: model.getFullModelRange(), text: recoveredText }], () => null);
      }
      update(k, { type: x.type, date: x.date, resize: x.resize, data: x.data, dirty: !!models.get(k) && models.get(k)!.getAlternativeVersionId() !== saved.get(k) });
    } catch (e: any) { update(k, { type: 'error', error: e.message, date: null }); }
  };
  /** Abre (o trae) un archivo. `previa`: de un clic, la pestaña la ocupa el siguiente que se mire (en cursiva). */
  const open = useCallback(async (rel: string, o: { previous?: boolean; focus?: boolean; line?: number; column?: number; inRoot?: string } = {}) => {
    const r = o.inRoot ?? state.current.root; if (!r) return;
    const k = key(r, rel);
    let ps = state.current.tabs;
    const already = ps.find(p => p.key === k);
    if (already) { if (!o.previous && already.previous) ps = ps.map(p => (p.key === k ? { ...p, previous: false } : p)); }
    else {
      const tab: Tab = { key: k, root: r, rel, previous: !!o.previous, type: 'loading', date: null, dirty: false };
      // la vista previa que hubiera (sin tocar) deja su sitio
      const old = o.previous ? ps.find(p => p.previous && !p.dirty) : undefined;
      if (old) { models.get(old.key)?.dispose(); models.delete(old.key); views.delete(old.key); ps = ps.map(p => (p === old ? tab : p)); }
      else { const i = ps.findIndex(p => p.key === state.current.active); ps = [...ps.slice(0, i + 1), tab, ...ps.slice(i + 1)]; }
    }
    pending.current = o.focus || o.line ? { k, line: o.line, column: o.column, focus: o.focus } : null;
    // mientras se lee, el editor se esconde: las teclas se quedan en la ventana (no se escapan al refugio)
    if (o.focus && !already) zoneEditor.current?.focus({ preventScroll: true });
    setTabs(ps); setActive(k);
    recent.current = [k, ...recent.current.filter(x => x !== k)].slice(0, 50);
    if (!already) await load(r, rel, k);
    requestAnimationFrame(applyPending);   // si ya estaba en el editor, el efecto no vuelve a pasar
  }, [action]);

  // vuelve lo que había antes de recargar la página
  useEffect(() => {
    const r = recovered; recovered = null; if (!r) return;
    for (const p of r.tabs) {
      const k = key(p.root, p.rel);
      setTabs(ps => (ps.some(x => x.key === k) ? ps : [...ps, { key: k, root: p.root, rel: p.rel, previous: p.previous, type: 'loading', date: null, dirty: false }]));
      load(p.root, p.rel, k, p.text);
    }
    if (r.active) setActive(r.active);
  }, []);
  currentMemory = () => {
    const w = filesWindow.get();
    return { open: w.isOpen, minimized: w.minimized, maximized: w.maximized, root: w.root, active: state.current.active,
      tabs: state.current.tabs.filter(p => p.type !== 'error').map(p => ({ root: p.root, rel: p.rel, previous: p.previous, ...(p.dirty && models.get(p.key) ? { text: models.get(p.key)!.getValue() } : {}) })) };
  };
  useEffect(() => () => { currentMemory = () => null; }, []);

  // lo que piden desde fuera (abrir un archivo concreto)
  // (relativo a la carpeta pedida, que puede ser un repo dentro de la de un ala)
  useEffect(() => {
    if (!v.open || !root) return;
    const o = v.open, insideOf = v.root && v.root !== root && v.root.startsWith(root) ? v.root.slice(root.length).replace(/^\/+|\/+$/g, '') : '';
    const rel = union(insideOf, o.rel);
    filesWindow.set({ open: null }); reveal(rel); open(rel, { line: o.line, focus: true });
  }, [v.open, root]);

  // ---- el árbol: listados de las carpetas desplegadas, cambios de git y fechas de lo abierto
  const requested = useRef(0);
  const glance = useCallback(async (o: { git?: boolean; folders?: string[] } = {}) => {
    const { root: r, expanded: ex, tabs: ps } = state.current; if (!r) return;
    const n = ++requested.current;
    try {
      const x = await action<{ listed: Record<string, Entry[] | null>; git?: Record<string, string>; dates: Record<string, number | null> }>('peek', {
        root: r, folders: o.folders ?? ['', ...ex], git: o.git ?? true, open: o.folders ? [] : ps.filter(p => p.root === r).map(p => p.rel),
      });
      if (state.current.root !== r) return;
      setListed(l => { const out = o.folders ? { ...l } : {}; for (const [c, es] of Object.entries(x.listed)) if (es) out[c] = es; return out; });
      const lost = Object.entries(x.listed).filter(([c, es]) => !es && c).map(([c]) => c);
      if (lost.length) setExpanded(s => { const t = new Set([...s].filter(c => !lost.some(p => under(c, p)))); expandedOf.save(r, t); return t; });
      if (x.git && n === requested.current) setGit(x.git);
      reviewDates(r, x.dates);
    } catch (e: any) { if (!o.folders) notify(e.message, true); }
  }, [action]);
  // las pestañas de otras raíces también se vigilan
  const watchOther = useCallback(async () => {
    const rootBy = new Map<string, string[]>();
    for (const p of state.current.tabs) if (p.root !== state.current.root && p.date != null) rootBy.set(p.root, [...(rootBy.get(p.root) ?? []), p.rel]);
    for (const [r, rels] of rootBy) action<any>('peek', { root: r, folders: [], git: false, open: rels }).then(x => reviewDates(r, x.dates), () => {});
  }, [action]);
  // un archivo abierto que cambia en el disco: si no lo has tocado, se recarga (y se puede deshacer); si sí, se avisa
  const reviewDates = (r: string, dates: Record<string, number | null>) => {
    for (const p of state.current.tabs) {
      if (p.root !== r || !(p.rel in dates) || p.type === 'loading') continue;
      const f = dates[p.rel];
      if (f === null) { if (p.inDisc !== 'deleted' && p.date !== null) update(p.key, { inDisc: 'deleted' }); continue; }
      if (p.date !== null && Math.abs(f - p.date) <= 1) { if (p.inDisc) update(p.key, { inDisc: undefined }); continue; }
      if (models.has(p.key) && p.dirty) { if (p.inDisc !== 'changed') update(p.key, { inDisc: 'changed' }); continue; }
      reload(p);
    }
  };
  /** Lo del disco, en la pestaña (sustituye el texto con una edición: se puede deshacer). */
  const reload = (p: Tab) => action<any>('read', { root: p.root, rel: p.rel }).then(x => {
    const m = models.get(p.key);
    if (x.type === 'text' && m && !m.isDisposed()) {
      if (m.getValue() !== x.text) m.pushEditOperations([], [{ range: m.getFullModelRange(), text: x.text }], () => null);
      saved.set(p.key, m.getAlternativeVersionId());
      update(p.key, { date: x.date, resize: x.resize, dirty: false, inDisc: undefined });
    } else update(p.key, { type: x.type, date: x.date, resize: x.resize, data: x.data, inDisc: undefined });
  }, () => {});
  useEffect(() => {
    if (!root) return;
    setListed({}); setGit({}); setSel(null); setEdit(null);
    const ex = expandedOf.read(root); setExpanded(ex); state.current.expanded = ex; state.current.root = root;
    glance(); askList(root).catch(() => {});
  }, [root]);
  // mientras está a la vista, se relee cada 3 s (y al volver a la ventana)
  useEffect(() => {
    if (v.minimized) return;
    const t = setInterval(() => { if (firstMapNow()) { glance(); watchOther(); } }, 3000);
    const f = () => { glance(); watchOther(); }; addEventListener('focus', f);
    return () => { clearInterval(t); removeEventListener('focus', f); };
  }, [v.minimized, glance, watchOther]);

  const rows = useMemo(() => flatten(listed, expanded), [listed, expanded]);
  const changed = useMemo(() => changedFolders(git), [git]);
  const updateExpanded = (f: (s: Set<string>) => Set<string>) => {
    const t = f(new Set(state.current.expanded)); state.current.expanded = t; setExpanded(t);
    if (root) expandedOf.save(root, t);
    const missing = [...t].filter(c => !listed[c]); if (missing.length) glance({ folders: missing, git: false });
  };
  const toggle = (rel: string, openIt?: boolean) => updateExpanded(s => { if (openIt ?? !s.has(rel)) s.add(rel); else s.delete(rel); return s; });
  /** Despliega hasta el archivo y lo elige (como «revelar» en los editores). */
  const reveal = (rel: string) => {
    const parents: string[] = []; for (let p = parentOf(rel); p; p = parentOf(p)) parents.push(p);
    if (parents.some(p => !state.current.expanded.has(p))) updateExpanded(s => { parents.forEach(p => s.add(p)); return s; });
    setSel(rel);
  };
  // el árbol sigue a la pestaña activa (si es de esta raíz)
  useEffect(() => { if (activeTab && activeTab.root === root) reveal(activeTab.rel); }, [active]);
  // la fila elegida, a la vista
  useEffect(() => { if (sel != null) treeRef.current?.querySelector(`[data-rel="${CSS.escape(sel)}"]`)?.scrollIntoView({ block: 'nearest' }); }, [sel, rows]);

  // ---- guardar y cerrar
  const save = async (k: string, force = false): Promise<boolean> => {
    const p = state.current.tabs.find(x => x.key === k), m = models.get(k);
    if (!p || !m) return true;
    const version = m.getAlternativeVersionId();
    try {
      const r = await action<{ conflict: boolean; date: number }>('save', { root: p.root, rel: p.rel, text: m.getValue(), date: p.date ?? undefined, force });
      if (r.conflict) {
        return await new Promise<boolean>(ok => setConfirm({
          text: <><b>{nameOf(p.rel)}</b> {t('windows.hasChangedOnDiskSince')}</>,
          buttons: [
            { text: t('windows.overwriteWithMine'), danger: true, f: () => save(k, true).then(ok) },
            { text: t('windows.discardMineAndReload'), f: () => { reload(p); ok(false); } },
            { text: t('windows.cancel'), f: () => ok(false) },
          ],
        }));
      }
      saved.set(k, version);
      update(k, { date: r.date, dirty: m.getAlternativeVersionId() !== version, inDisc: undefined, previous: false, type: 'text' });
      SFX.tick();
      return true;
    } catch (e: any) { notify(e.message, true); return false; }
  };
  const saveAll = async () => { for (const p of state.current.tabs.filter(x => x.dirty)) if (!(await save(p.key))) return false; return true; };
  const removeTab = (k: string) => {
    const ps = state.current.tabs, i = ps.findIndex(p => p.key === k); if (i < 0) return;
    const p = ps[i];
    closed.current = [{ root: p.root, rel: p.rel }, ...closed.current.filter(x => key(x.root, x.rel) !== k)].slice(0, 20);
    if (inEditor.current === k) { editor.current?.setModel(null); inEditor.current = null; }
    models.get(k)?.dispose(); models.delete(k); views.delete(k); saved.delete(k);
    recent.current = recent.current.filter(x => x !== k);
    const rest = ps.filter(x => x.key !== k);
    setTabs(rest);
    if (state.current.active === k) {
      const other = recent.current.find(x => rest.some(r => r.key === x)) ?? rest[Math.min(i, rest.length - 1)]?.key ?? null;
      setActive(other);
      // el foco, a la que queda (o al árbol si no queda ninguna), no al refugio
      if (box.current?.contains(document.activeElement) || document.activeElement === document.body) { if (other) { pending.current = { k: other, focus: true }; zoneEditor.current?.focus({ preventScroll: true }); } else treeRef.current?.focus(); }
    }
  };
  const closeTab = (k: string | null) => {
    if (!k) { closeFiles(); return; }
    const p = state.current.tabs.find(x => x.key === k); if (!p) return;
    if (!p.dirty) { removeTab(k); return; }
    setActive(k);
    setConfirm({ text: <>{t('windows.saveTheChangesTo')} <b>{nameOf(p.rel)}</b>? {t('windows.otherwiseTheyAreLost')}</>, buttons: [
      { text: t('windows.save'), f: async () => { if (await save(k)) removeTab(k); } },
      { text: t('windows.donTSave'), danger: true, f: () => removeTab(k) },
      { text: t('windows.cancel'), f: () => {} },
    ] });
  };
  // cerrar la ventana con algo sin guardar pregunta
  const nClosing = askClosing.use(e => e.n);
  const firstClosing = useRef(nClosing);
  useEffect(() => {
    if (nClosing === firstClosing.current) return;
    const dirty = state.current.tabs.filter(p => p.dirty);
    if (!dirty.length) { closeFilesAlready(); return; }
    onFrontFiles();
    setConfirm({ text: <>{dirty.length === 1 ? <><b>{nameOf(dirty[0].rel)}</b> {t('windows.hasUnsavedChanges')}</> : <>{t('windows.thereAre')} <b>{t('windows.nFiles', { n: dirty.length })}</b> {t('windows.withUnsavedChanges')}</>} {t('windows.saveThemBeforeClosing')}</>, buttons: [
      { text: t('windows.saveAndClose'), f: async () => { if (await saveAll()) closeFilesAlready(); } },
      { text: t('windows.closeWithoutSaving'), danger: true, f: closeFilesAlready },
      { text: t('windows.cancel'), f: () => {} },
    ] });
  }, [nClosing]);

  // ---- operaciones con archivos
  const after = async (f: () => Promise<unknown>, ok?: string) => {
    try { await f(); if (ok) { notify(ok); SFX.shortSuccess(); } } catch (e: any) { notify(e.message, true); }
    await glance();
  };
  const selFolder = () => { if (sel == null) return ''; const f = rows.find(x => x.rel === sel); return f?.dir ? sel : parentOf(sel); };
  const newer = (dir: boolean, folder = selFolder()) => { if (folder) toggle(folder, true); setEdit({ mode: dir ? 'folder' : 'archive', folder }); setMenu(null); };
  const renameSel = (rel = sel) => { if (rel) { setSel(rel); setEdit({ mode: 'rename', folder: parentOf(rel), rel }); setMenu(null); } };
  const confirmEdit = async (name: string) => {
    const ed = edit; setEdit(null); treeRef.current?.focus();
    if (!ed || !root) return;
    name = name.trim(); if (!name || (ed.mode === 'rename' && name === nameOf(ed.rel!))) return;
    try {
      if (ed.mode === 'rename') {
        const r = await action<{ rel: string }>('rename', { root, rel: ed.rel, name });
        moveTabs(ed.rel!, r.rel); setSel(r.rel);
      } else {
        const r = await action<{ rel: string }>('create', { root, folder: ed.folder, name, dir: ed.mode === 'folder' });
        setSel(r.rel);
        if (ed.mode === 'archive') { await glance(); reveal(r.rel); open(r.rel, { focus: true }); return; }
      }
    } catch (e: any) { notify(e.message, true); }
    await glance();
  };
  // renombrar o mover algo abierto: sus pestañas lo siguen (con sus cambios y su historial)
  const moveTabs = (from: string, a: string, r = root) => {
    const ren = new Map<string, { k: string; rel: string }>();
    for (const p of state.current.tabs) if (p.root === r && under(p.rel, from)) { const rel = a + p.rel.slice(from.length); ren.set(p.key, { k: key(p.root, rel), rel }); }
    if (!ren.size) return;
    for (const [k1, { k: k2, rel }] of ren) {
      for (const map of [models, views, saved] as Map<string, any>[]) if (map.has(k1)) { map.set(k2, map.get(k1)); map.delete(k1); }
      const m = models.get(k2); if (m) { keyOf.set(m, k2); if (mon) mon.editor.setModelLanguage(m, languageOf(nameOf(rel), mon.languages.getLanguages())); }
      if (inEditor.current === k1) inEditor.current = k2;
      recent.current = recent.current.map(x => (x === k1 ? k2 : x));
    }
    setTabs(ps => ps.map(p => { const n = ren.get(p.key); return n ? { ...p, key: n.k, rel: n.rel } : p; }));
    setActive(x => (x && ren.get(x)?.k) || x);
  };
  const aTrash = (rel = sel) => {
    if (!rel || !root) return;
    const f = rows.find(x => x.rel === rel);
    setMenu(null);
    setConfirm({ text: <>{f?.dir ? t('windows.moveTheFolder') : t('windows.move')} <b>{rel}</b> {t('windows.toTheTrashYouCan')}</>, buttons: [
      { text: t('windows.moveToTrash'), danger: true, f: () => { const i = rows.findIndex(x => x.rel === rel); after(() => action('trash', { root, rels: [rel] })).then(() => { setSel(rows[i + 1]?.rel ?? rows[i - 1]?.rel ?? null); treeRef.current?.focus(); }); } },
      { text: t('windows.cancel'), f: () => treeRef.current?.focus() },
    ] });
  };
  const copy = (move: boolean, rel = sel) => { if (rel == null || !root || !rel) return; clipboard = { origins: [{ root, rel }], move }; notify(move ? t('windows.cutNameShortcutVTo', { name: nameOf(rel), shortcut: CMD }) : t('windows.copiedNameShortcutVTo', { name: nameOf(rel), shortcut: CMD })); setMenu(null); };
  const paste = (folder = selFolder()) => {
    const pp = clipboard; if (!pp || !root) { SFX.notAllowed(); return; }
    setMenu(null);
    after(async () => {
      const r = await action<{ rels: string[] }>('paste', { root, folder, origins: pp.origins, move: pp.move });
      if (pp.move) { pp.origins.forEach((o, i) => r.rels[i] && moveTabs(o.rel, r.rels[i], o.root)); clipboard = null; }
      if (r.rels[0]) { if (folder) toggle(folder, true); setSel(r.rels[0]); }
    });
  };
  const moveA = (rel: string, folder: string) => {
    if (!root || parentOf(rel) === folder || under(folder, rel)) return;
    after(async () => { const r = await action<{ rels: string[] }>('paste', { root, folder, origins: [{ root, rel }], move: true }); if (r.rels[0]) { moveTabs(rel, r.rels[0]); if (folder) toggle(folder, true); setSel(r.rels[0]); } });
  };
  const copyPath = (relative: boolean, rel = sel) => {
    if (rel == null || !root) return;
    const path = relative ? rel || '.' : root.replace(/\/$/, '') + (rel ? '/' + rel : '');
    navigator.clipboard.writeText(path).then(() => notify(t('windows.pathCopiedPath', { path: path })), () => notify(t('windows.couldNotCopyThePath'), true));
    setMenu(null);
  };
  const outside = (what: 'revelar' | 'openInEditor', rel = sel ?? '') => { if (root) action(what, { root, rel }).catch(e => notify(e.message, true)); setMenu(null); };

  // ---- teclas del árbol
  const typed = useRef({ text: '', t: 0 });
  const pick = (rel: string | null) => { setSel(rel); SFX.tick(); };
  const treeKey = (e: React.KeyboardEvent) => {
    if (edit) return;
    const cmd = MAC ? e.metaKey : e.ctrlKey;
    const i = sel == null ? -1 : rows.findIndex(f => f.rel === sel), f = rows[i];
    const go = (j: number) => { const g = rows[Math.max(0, Math.min(rows.length - 1, j))]; if (g) pick(g.rel); };
    let done = true;
    if (e.key === 'ArrowDown' && cmd) { if (f?.dir) toggle(f.rel); else if (f) open(f.rel, { focus: true }); }
    else if (e.key === 'ArrowUp' && cmd) { if (f && parentOf(f.rel)) pick(parentOf(f.rel)); }
    else if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i < 0 ? rows.length - 1 : i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(rows.length - 1);
    else if (e.key === 'PageDown') go(i + 15);
    else if (e.key === 'PageUp') go(i - 15);
    else if (e.key === 'ArrowRight') { if (f?.dir && !f.open) toggle(f.rel, true); else if (f?.dir && (rows[i + 1]?.level ?? -1) > f.level) go(i + 1); }
    else if (e.key === 'ArrowLeft') { if (f?.dir && f.open) toggle(f.rel, false); else if (f && parentOf(f.rel)) pick(parentOf(f.rel)); }
    else if ((e.key === 'Enter' && !cmd) || e.key === 'F2') { if (f) renameSel(f.rel); }
    else if (e.key === ' ') { if (f?.dir) toggle(f.rel); else if (f) open(f.rel, { previous: true }); }
    else if ((e.key === 'Backspace' && cmd) || e.key === 'Delete') { if (f) aTrash(f.rel); }
    else if (cmd && e.altKey && e.code === 'KeyC') copyPath(e.shiftKey);
    else if (cmd && e.altKey && e.code === 'KeyR') outside('revelar');
    else if (cmd && !e.altKey && e.code === 'KeyC') copy(false);
    else if (cmd && !e.altKey && e.code === 'KeyX') copy(true);
    else if (cmd && !e.altKey && e.code === 'KeyV') paste();
    else if (e.key === 'Escape') { if (clipboard?.move) { clipboard = null; notify(t('windows.cutCancelled')); } else done = false; }
    else if (e.key.length === 1 && !cmd && !e.ctrlKey && !e.altKey && e.key !== ' ') {
      // escribir salta a la siguiente fila cuyo nombre empieza así
      const now = Date.now(), t = typed.current;
      t.text = (now - t.t > 800 ? '' : t.text) + e.key.toLowerCase(); t.t = now;
      const since = t.text.length > 1 ? Math.max(0, i) : i + 1;
      const orden = [...rows.slice(since), ...rows.slice(0, since)];
      const g = orden.find(x => x.name.toLowerCase().startsWith(t.text));
      if (g) pick(g.rel); else SFX.notAllowed();
    }
    else done = false;
    if (done) { e.preventDefault(); e.stopPropagation(); }
  };

  // ---- teclas de la ventana (antes que el editor: solo las que el editor no usa)
  const moveTab = (step: number) => { const ps = state.current.tabs; if (ps.length < 2) return; const i = ps.findIndex(p => p.key === state.current.active); setActive(ps[(i + step + ps.length) % ps.length].key); SFX.tick(); };
  const windowKey = (e: React.KeyboardEvent) => {
    if (confirm) return;   // la pregunta lleva sus teclas
    const cmd = MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey;
    let f: (() => void) | null = null;
    if (e.key === 'Escape' && menu) f = () => setMenu(null);
    else if (e.ctrlKey && !e.metaKey && e.key === 'Tab') f = () => moveTab(e.shiftKey ? -1 : 1);
    else if (e.ctrlKey && e.metaKey && e.code === 'KeyF') f = toggleMaximizeFiles;
    else if (e.ctrlKey && !e.metaKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) f = () => goTab(Number(e.code.slice(5)));
    else if (cmd) {
      if (e.code === 'KeyP' && !e.shiftKey && !e.altKey) f = () => { setFast(r => !r); setMenu(null); };
      else if (e.code === 'KeyS' && e.altKey) f = () => { saveAll(); };
      else if (e.code === 'KeyS' && !e.shiftKey) f = () => { if (state.current.active) save(state.current.active); };
      else if (e.code === 'KeyW' && e.shiftKey) f = closeFiles;
      else if (e.code === 'KeyW' && !e.altKey) f = () => closeTab(state.current.active);
      else if (e.code === 'KeyT' && e.shiftKey) f = () => { const c = closed.current.shift(); if (c) open(c.rel, { inRoot: c.root, focus: true }); else SFX.notAllowed(); };
      else if (e.code === 'KeyM' && !e.shiftKey && !e.altKey) f = minimizeFiles;
      else if ((e.code === 'KeyE' && e.shiftKey) || (e.code === 'Digit0' && !e.shiftKey)) f = () => { treeRef.current?.focus(); if (sel == null && rows[0]) setSel(rows[0].rel); };
      else if (e.code === 'KeyN' && !e.altKey) f = () => { treeRef.current?.focus(); newer(e.shiftKey); };
      else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) f = () => moveTab(e.key === 'ArrowRight' ? 1 : -1);
      else if (/^Digit[1-9]$/.test(e.code) && !e.shiftKey && !e.altKey) f = () => goTab(Number(e.code.slice(5)));
    }
    if (!f) return;
    e.preventDefault(); e.stopPropagation(); f();
  };
  const goTab = (n: number) => { const ps = state.current.tabs; const p = n === 9 ? ps[ps.length - 1] : ps[n - 1]; if (p) { setActive(p.key); requestAnimationFrame(() => editor.current?.focus()); } };

  // al abrirse: el árbol (o el editor, si hay algo abierto) recibe las teclas
  useEffect(() => { if (!v.minimized) requestAnimationFrame(() => { if (!box.current?.contains(document.activeElement)) (state.current.active && editor.current?.getModel() ? editor.current.focus() : treeRef.current?.focus()); }); }, [v.minimized]);

  const dirty = tabs.filter(p => p.dirty).length;
  const headPath = activeTab ? `${activeTab.root.replace(/\/$/, '')}/${activeTab.rel}` : root ?? '';
  return (
    <div ref={box} className={'window-git ventana-archivos interactive' + (v.maximized ? ' maximized' : '') + (v.minimized ? ' minimized' : '')} style={{ zIndex: v.maximized ? 200000 + v.z : v.z }}
      onPointerDown={e => { if (menu && !(e.target as HTMLElement).closest('.gc-menu')) setMenu(null); if (!v.minimized && !(document.activeElement && box.current?.contains(document.activeElement))) onFrontFiles(); }}
      onKeyDownCapture={windowKey} onKeyDown={e => e.stopPropagation()} role="dialog" aria-label={t('windows.files')}>
      <div className="vt-head vn-head" onDoubleClick={e => { if (!(e.target as HTMLElement).closest('button, select')) toggleMaximizeFiles(); }}>
        <span className="grid" /><span className={'pilot ' + (dirty ? 'waiting' : 'idle')} />
        <span className="vt-title">{t('windows.files4')} · {room?.name ?? t('windows.noFolder')}</span>
        <span className="vt-path" title={headPath}>{headPath}</span>
        <WindowButtons maximized={v.maximized} minimize={minimizeFiles} toggleMaximize={toggleMaximizeFiles} close={closeFiles} closesThat={t('windows.theFilesWindow')} />
      </div>
      {!root ? <div className="gd-empty">{t('windows.thereIsNoRoomWith')}</div> : (
        <div className="ex-body">
          <aside className="ex-side">
            <div className="ex-side-head">
              <select className="gc-repo" value={root} onChange={e => { chooseRoot(e.target.value); treeRef.current?.focus(); }} title={t('windows.folderThatOfEachRoom')}>
                {roots.map(r => <option key={r.path} value={r.path}>{r.name}{r.detail ? ` · ${r.detail}` : ''}</option>)}
              </select>
              <span className="ex-buttons">
                <button onClick={() => newer(false)} title={t('windows.newFileShortcut', { shortcut: `${CMD}N` })}>＋</button>
                <button onClick={() => newer(true)} title={t('windows.newFolderShortcut', { shortcut: `${CMD}⇧N` })}>⊞</button>
                <button onClick={() => { glance(); SFX.tick(); }} title={t('windows.reloadTheFolder')}>⟳</button>
                <button onClick={() => { updateExpanded(() => new Set()); setSel(null); SFX.tick(); }} title={t('windows.collapseAllFolders')}>⊟</button>
              </span>
            </div>
            <div ref={treeRef} className={'ex-tree' + (dragging === '' ? ' target' : '')} tabIndex={0} onKeyDown={treeKey}
              onFocus={() => { if (sel == null && rows[0]) setSel(rows[0].rel); }}
              onContextMenu={e => { if (e.target === e.currentTarget) { e.preventDefault(); setSel(null); openMenu(e, '', true); } }}
              onDragOver={e => { if (dragging != null && e.target === e.currentTarget) { e.preventDefault(); } }}
              onDrop={e => { if (e.target === e.currentTarget && dragging) { e.preventDefault(); moveA(dragging, ''); } setDragging(null); }}>
              {edit && edit.mode !== 'rename' && edit.folder === '' && <RowNew level={0} dir={edit.mode === 'folder'} confirm={confirmEdit} cancel={() => { setEdit(null); treeRef.current?.focus(); }} />}
              {rows.map(f => (
                <React.Fragment key={f.rel}>
                  <TreeRow f={f} sel={sel === f.rel} letter={f.dir ? changed.get(f.rel) : git[f.rel]} active={activeTab?.root === root && activeTab?.rel === f.rel}
                    cut={!!clipboard?.move && clipboard.origins.some(o => o.root === root && o.rel === f.rel)}
                    renaming={edit?.mode === 'rename' && edit.rel === f.rel} confirm={confirmEdit} cancel={() => { setEdit(null); treeRef.current?.focus(); }}
                    click={ev => { setSel(f.rel); if (f.dir) toggle(f.rel); else open(f.rel, { previous: true }); if (ev.detail === 1) treeRef.current?.focus(); }}
                    clickDouble={() => { if (!f.dir) open(f.rel, { focus: true }); }}
                    menu={ev => { ev.preventDefault(); setSel(f.rel); openMenu(ev, f.rel, f.dir); }}
                    drag={{ start: () => setDragging(f.rel), drop: () => { if (dragging) moveA(dragging, f.dir ? f.rel : parentOf(f.rel)); setDragging(null); }, active: dragging != null && dragging !== f.rel }} />
                  {edit && edit.mode !== 'rename' && f.dir && f.open && edit.folder === f.rel && <RowNew level={f.level + 1} dir={edit.mode === 'folder'} confirm={confirmEdit} cancel={() => { setEdit(null); treeRef.current?.focus(); }} />}
                </React.Fragment>
              ))}
              {listed[''] && !rows.length && !edit && <div className="gc-clean">{t('windows.emptyFolderShortcutNCreates', { shortcut: CMD })}</div>}
              {!listed[''] && <div className="gc-clean">{t('windows.readingTheFolder')}</div>}
            </div>
            <div className="ex-hint">
              <span><kbd>{CMD}P</kbd> {t('windows.openByName')}</span><span><kbd>{t('windows.enter')}</kbd> {t('windows.rename')}</span><span><kbd>{MAC ? '⌘⌫' : t('windows.del')}</kbd> {t('windows.moveToTrash2')}</span>
            </div>
            {notice && <div className={'gc-notice' + (notice.error ? ' error' : '')} onClick={() => setNotice(null)} title={t('windows.clickToDismiss')}>{notice.text}</div>}
          </aside>
          <main className="ex-main">
            {tabs.length > 0 && (
              <div className="ex-tabs" onDoubleClick={e => { if (e.target === e.currentTarget) newer(false, ''); }}>
                {tabs.map((p, i) => {
                  const repeated = tabs.some(o => o !== p && nameOf(o.rel) === nameOf(p.rel));
                  return (
                    <div key={p.key} className={'ex-tab' + (p.key === active ? ' active' : '') + (p.previous ? ' preview' : '') + (p.inDisc === 'deleted' ? ' deleted' : '') + (p.dirty ? ' dirty' : '')}
                      onClick={() => { setActive(p.key); requestAnimationFrame(() => editor.current?.focus()); }} onDoubleClick={() => update(p.key, { previous: false })}
                      onAuxClick={e => { if (e.button === 1) closeTab(p.key); }}
                      title={`${p.root.replace(/\/$/, '')}/${p.rel}${p.inDisc === 'changed' ? '\n' + t('windows.itChangedOnDiskWhile') : p.inDisc === 'deleted' ? '\n' + t('windows.itIsNoLongerOn') : ''}${i < 9 ? `\n${CMD}${i + 1}` : ''}`}>
                      <span className="ex-tab-name">{nameOf(p.rel)}</span>
                      {(repeated || p.root !== root) && <span className="ex-tab-folder">{p.root !== root ? (roots.find(r => r.path === p.root)?.name ?? '') + (parentOf(p.rel) ? ' · ' : '') : ''}{parentOf(p.rel).split('/').pop()}</span>}
                      {p.inDisc === 'changed' && <span className="ex-tab-eye" title={t('windows.itChangedOnDisk')}>⚠</span>}
                      <button className="ex-tab-x" onClick={e => { e.stopPropagation(); closeTab(p.key); }} title={t('windows.closeShortcut', { shortcut: `${CMD}W` })}>{p.dirty ? '●' : '×'}</button>
                    </div>
                  );
                })}
              </div>
            )}
            <div ref={zoneEditor} className="ex-editor" tabIndex={-1}>
              <div ref={host} className="ex-monaco" style={{ visibility: activeTab?.type === 'text' ? 'inherit' : 'hidden' }} />
              {activeTab?.type !== 'text' && (
                <div className="ex-other">
                  {!activeTab && <Welcome root={root} loaded={!!mon} />}
                  {activeTab?.type === 'loading' && <div className="gd-empty">{t('windows.opening')}</div>}
                  {activeTab?.type === 'image' && <div className="ex-image"><img src={activeTab.data} alt={activeTab.rel} /><small>{nameOf(activeTab.rel)} · {sizeLegible(activeTab.resize)}</small></div>}
                  {(activeTab?.type === 'binary' || activeTab?.type === 'large' || activeTab?.type === 'error') && (
                    <div className="gd-empty">
                      <p>{activeTab.type === 'binary' ? t('windows.thisIsABinaryFile') : activeTab.type === 'large' ? t('windows.itIsTooLargeTo', { size: sizeLegible(activeTab.resize) }) : activeTab.error}</p>
                      {activeTab.type !== 'error' && <p><button className="gc-button" onClick={() => outside('openInEditor', activeTab.rel)}>{t('windows.openInCursor')}</button> <button className="gc-button" onClick={() => outside('revelar', activeTab.rel)}>{t('windows.showInFinder')}</button></p>}
                    </div>
                  )}
                </div>
              )}
            </div>
            {activeTab && (
              <div className="ex-state">
                <span className="ex-state-path">{activeTab.rel}</span>
                {activeTab.inDisc === 'changed' && <span className="ex-state-alert">{t('windows.changedOnDiskILl')}</span>}
                {activeTab.inDisc === 'deleted' && <span className="ex-state-alert">{t('windows.noLongerOnDiskSaving')}</span>}
                {git[activeTab.rel] && activeTab.root === root && <button className="gc-link" onClick={() => openGit({ path: root, view: 'changes' })} title={t('windows.seeItInTheGit')}>git: {TITLE_LETTER[git[activeTab.rel]] ?? git[activeTab.rel]}</button>}
                <span className="ex-state-right">
                  {cursor && activeTab.type === 'text' && <span>{t('windows.lnLineColCol', { line: cursor.line, col: cursor.col })}{cursor.sel ? ` (${t('windows.nSelected', { n: cursor.sel })})` : ''}</span>}
                  {activeTab.type === 'text' && models.get(activeTab.key) && <InfoModel m={models.get(activeTab.key)!} mon={mon} />}
                  <span className={activeTab.dirty ? 'ex-dirty' : 'dim'}>{activeTab.dirty ? t('windows.unsavedShortcutS', { shortcut: CMD }) : t('windows.saved')}</span>
                </span>
              </div>
            )}
          </main>
        </div>
      )}
      {fast && root && <OpenFast root={root} recent={recent.current.filter(k => k.startsWith(root + '\0')).map(k => k.slice(root.length + 1))} close={goBack => { setFast(false); if (goBack) requestAnimationFrame(() => (editor.current?.getModel() ? editor.current.focus() : treeRef.current?.focus())); }}
        open={(rel, line, column) => { setFast(false); reveal(rel); open(rel, { focus: true, line, column }); }} notify={notify} />}
      {menu && root && (
        <div className="gc-menu ex-menu" style={{ left: menu.x, top: menu.y }} onContextMenu={e => e.preventDefault()}>
          <button onClick={() => newer(false, menu.dir ? menu.rel : parentOf(menu.rel))}>{t('windows.newFile')} <kbd>{CMD}N</kbd></button>
          <button onClick={() => newer(true, menu.dir ? menu.rel : parentOf(menu.rel))}>{t('windows.newFolder')} <kbd>{CMD}⇧N</kbd></button>
          <hr />
          {menu.rel && <button onClick={() => copy(true, menu.rel)}>{t('windows.cut')} <kbd>{CMD}X</kbd></button>}
          {menu.rel && <button onClick={() => copy(false, menu.rel)}>{t('windows.copy2')} <kbd>{CMD}C</kbd></button>}
          <button disabled={!clipboard} onClick={() => paste(menu.dir ? menu.rel : parentOf(menu.rel))}>{t('windows.paste')} <kbd>{CMD}V</kbd></button>
          <hr />
          <button onClick={() => copyPath(false, menu.rel)}>{t('windows.copyPath')} <kbd>⌥{CMD}C</kbd></button>
          <button onClick={() => copyPath(true, menu.rel)}>{t('windows.copyRelativePath')} <kbd>⌥⇧{CMD}C</kbd></button>
          <button onClick={() => outside('revelar', menu.rel)}>{t('windows.showInFinder')} <kbd>⌥{CMD}R</kbd></button>
          <button onClick={() => outside('openInEditor', menu.rel)}>{t('windows.openInCursor')}</button>
          {menu.dir && room && <button onClick={() => { setMenu(null); const cwd = root.replace(/\/$/, '') + (menu.rel ? '/' + menu.rel : ''); openTerminalIn('archivos:' + cwd, room.roomId, menu.rel ? `${room.name} / ${nameOf(menu.rel)}` : room.name, cwd); }}>{t('windows.openATerminalHere')}</button>}
          {menu.rel && <><hr />
            <button onClick={() => renameSel(menu.rel)}>{t('windows.rename2')} <kbd>{t('windows.enter')}</kbd></button>
            <button className="danger" onClick={() => aTrash(menu.rel)}>{t('windows.moveToTrash')} <kbd>{MAC ? '⌘⌫' : t('windows.del')}</kbd></button></>}
        </div>
      )}
      {confirm && <Question c={confirm} close={() => setConfirm(null)} goBack={() => (editor.current?.getModel() && activeTab?.type === 'text' ? editor.current.focus() : treeRef.current?.focus())} />}
    </div>
  );

  function openMenu(e: React.MouseEvent, rel: string, dir: boolean) {
    const r = box.current!.getBoundingClientRect();
    setMenu({ x: Math.min(e.clientX - r.left, r.width - 260), y: Math.min(e.clientY - r.top, r.height - 380), rel, dir });
  }
}

// ---------------------------------------------------------------- piezas
function TreeRow({ f, sel, letter, active, cut, renaming, confirm, cancel, click, clickDouble, menu, drag }: {
  f: Row; sel: boolean; letter?: string; active: boolean; cut: boolean; renaming: boolean; confirm: (n: string) => void; cancel: () => void
  click: (e: React.MouseEvent) => void; clickDouble: () => void; menu: (e: React.MouseEvent) => void; drag: { start: () => void; drop: () => void; active: boolean }
}) {
  const [onTop, setAbove] = useState(false);
  return (
    <div data-rel={f.rel} className={'ex-row' + (sel ? ' sel' : '') + (active ? ' active' : '') + (f.e.ignored ? ' ignored' : '') + (cut ? ' cut' : '') + (letter ? ' l-' + (letter === '?' ? 'N' : letter) : '') + (onTop ? ' target' : '')}
      style={{ paddingLeft: 8 + f.level * 12 }} onClick={click} onDoubleClick={clickDouble} onContextMenu={menu}
      draggable={!renaming} onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f.rel); drag.start(); }}
      onDragOver={e => { if (drag.active) { e.preventDefault(); setAbove(true); } }} onDragLeave={() => setAbove(false)}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); setAbove(false); drag.drop(); }}
      title={(f.e.link ? t('windows.symbolicLink') + ' · ' : '') + (f.e.ignored ? t('windows.ignoredByGit') + ' · ' : '') + (letter ? (f.dir ? t('windows.hasChangesInside') : TITLE_LETTER[letter] ?? letter) : '') || undefined}>
      {Array.from({ length: f.level }, (_, i) => <span key={i} className="ex-guide" style={{ left: 14 + i * 12 }} />)}
      <span className={'ex-arrow' + (f.dir ? (f.open ? ' dir open' : ' dir') : '')} />
      {renaming ? <NameField initial={f.name} confirm={confirm} cancel={cancel} />
        : <span className="ex-name">{f.name}{f.e.link ? <i className="dim"> ↪</i> : null}</span>}
      {letter && !renaming && <span className="ex-letter">{f.dir ? '•' : letter === '?' ? 'U' : letter}</span>}
    </div>
  );
}

function RowNew({ level, dir, confirm, cancel }: { level: number; dir: boolean; confirm: (n: string) => void; cancel: () => void }) {
  return (
    <div className="ex-row sel" style={{ paddingLeft: 8 + level * 12 }}>
      <span className={'ex-arrow' + (dir ? ' dir' : '')} />
      <NameField initial="" confirm={confirm} cancel={cancel} placeholder={dir ? t('windows.folderName') : t('windows.fileNameFolderFileWorks')} />
    </div>
  );
}

/** El nombre, editable en la propia fila: Intro confirma, Esc cancela, salir de él confirma (como en los editores). */
function NameField({ initial, confirm, cancel, placeholder }: { initial: string; confirm: (n: string) => void; cancel: () => void; placeholder?: string }) {
  const ref = useRef<HTMLInputElement>(null), done = useRef(false);
  useEffect(() => {
    const i = ref.current; if (!i) return;
    i.focus();
    // el nombre sin la extensión, elegido
    const point = initial.lastIndexOf('.'); i.setSelectionRange(0, point > 0 ? point : initial.length);
  }, []);
  const end = (ok: boolean) => { if (done.current) return; done.current = true; ok ? confirm(ref.current?.value ?? '') : cancel(); };
  return <input ref={ref} className="ex-field" defaultValue={initial} placeholder={placeholder} spellCheck={false} onClick={e => e.stopPropagation()}
    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); end(true); } else if (e.key === 'Escape') { e.preventDefault(); end(false); } }}
    onBlur={() => end(true)} />;
}

function InfoModel({ m, mon }: { m: Monaco.editor.ITextModel; mon: M | null }) {
  const id = m.getLanguageId(), name = mon?.languages.getLanguages().find(l => l.id === id)?.aliases?.[0] ?? id;
  const o = m.getOptions();
  return <><span>{o.insertSpaces ? t('windows.spacesN', { n: o.tabSize }) : t('windows.tabSizeN', { n: o.tabSize })}</span><span>{m.getEOL() === '\n' ? 'LF' : 'CRLF'}</span><span>{name}</span></>;
}

function Welcome({ root, loaded }: { root: string; loaded: boolean }) {
  const shortcuts: [string, string][] = [
    [`${CMD}P`, t('windows.openAFileByName')], [`${CMD}S`, t('windows.save2')], [`${CMD}W`, t('windows.closeTheTab')], [`⌃Tab · ${CMD}1…9`, t('windows.switchTab')],
    [`${CMD}⇧E`, t('windows.backToTheTree')], ['↑↓ ←→', t('windows.moveAroundTheTree')], [t('windows.space'), t('windows.openWithoutLeavingTheTree')], [`${CMD}↓`, t('windows.openAndMoveToThe')],
    [`${t('windows.enter')} · F2`, t('windows.rename')], [`${CMD}N · ${CMD}⇧N`, t('windows.newFileOrFolder')], [`${CMD}C ${CMD}X ${CMD}V`, t('windows.copyCutAndPasteFiles')], [MAC ? '⌘⌫' : t('windows.del'), t('windows.moveToTrash2')],
  ];
  return (
    <div className="ex-welcome">
      <p className="dim">{root}</p>
      <dl>{shortcuts.map(([k, d]) => <React.Fragment key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></React.Fragment>)}</dl>
      <p className="dim">{loaded ? t('windows.insideTheEditorTheUsual') : t('windows.loadingTheEditor')}</p>
    </div>
  );
}

function Question({ c, close, goBack }: { c: Confirm; close: () => void; goBack: () => void }) {
  // al irse, el foco vuelve al editor o al árbol (y lo elegido lo puede llevar a otro sitio)
  const press = (f: () => void) => { goBack(); close(); f(); };
  return (
    <div className="vt-confirm" onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); const last = c.buttons[c.buttons.length - 1]; press(last.f); } }}>
      <div className="vt-confirm-box">
        <p>{c.text}</p>
        <div className="vt-confirm-buttons">
          {c.buttons.map((b, i) => <button key={b.text} className={'console-x' + (b.danger ? ' danger' : '')} autoFocus={i === 0} onClick={() => press(b.f)}>{b.text}{i === 0 ? ` (${t('windows.enter')})` : i === c.buttons.length - 1 ? ' (Esc)' : ''}</button>)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ⌘P
// la lista de archivos de cada carpeta: se pide al abrir la ventana (⌘P sale al momento) y vale 15 s
const lists = new Map<string, { rels: string[]; ts: number }>();
const asking = new Map<string, Promise<string[]>>();
function askList(root: string): Promise<string[]> {
  const c = lists.get(root); if (c && Date.now() - c.ts < 15_000) return Promise.resolve(c.rels);
  let p = asking.get(root);
  if (!p) {
    p = client.action<{ rels: string[] }>('files.all', { root }, 60_000).then(r => { lists.set(root, { rels: r.rels, ts: Date.now() }); return r.rels; }).finally(() => asking.delete(root));
    asking.set(root, p);
  }
  return p;
}
function OpenFast({ root, recent, close, open, notify }: { root: string; recent: string[]; close: (goBack: boolean) => void; open: (rel: string, line?: number, column?: number) => void; notify: (t: string, e?: boolean) => void }) {
  const [text, setText] = useState('');
  const [rels, setRels] = useState<string[] | null>(() => lists.get(root)?.rels ?? null);
  const [i, setI] = useState(recent.length > 1 ? 1 : 0);   // como en los editores: Intro sin escribir vuelve al anterior
  const [inWait, setInWait] = useState(false);              // Intro antes de que llegue la lista: se abre al llegar
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { let live = true; askList(root).then(r => { if (live) setRels(r); }, e => notify(e.message, true)); return () => { live = false; }; }, [root]);
  const { query, line, column } = queryYLine(text);
  const results = useMemo(() => {
    if (!query) return recent.map(rel => ({ rel, points: 0, marks: [] as number[] })).concat((rels ?? []).filter(r => !recent.includes(r)).slice(0, 40).map(rel => ({ rel, points: 0, marks: [] })));
    return searchFiles(query, rels ?? []);
  }, [query, rels, recent]);
  useEffect(() => { if (query) setI(0); }, [query]);
  useEffect(() => { list.current?.children[i]?.scrollIntoView({ block: 'nearest' }); }, [i]);
  const picked = results[Math.min(i, results.length - 1)];
  useEffect(() => { if (inWait && rels) { setInWait(false); if (picked) open(picked.rel, line, column); else SFX.notAllowed(); } }, [inWait, rels]);
  return (
    <div className="ex-quick" onKeyDown={e => e.stopPropagation()}>
      <input autoFocus value={text} onChange={e => setText(e.target.value)} spellCheck={false} placeholder={rels ? t('windows.searchNFilesByName', { n: rels.length.toLocaleString(language() === 'en' ? 'en-GB' : 'es-ES') }) : t('windows.readingTheFiles')}
        onBlur={() => setTimeout(() => close(false), 0)}
        onKeyDown={e => {
          const n = results.length;
          if (e.key === 'Escape' || ((MAC ? e.metaKey : e.ctrlKey) && e.code === 'KeyP')) { e.preventDefault(); close(true); }
          else if (e.key === 'ArrowDown' || (e.ctrlKey && e.code === 'KeyN')) { e.preventDefault(); if (n) setI(x => (x + 1) % n); }
          else if (e.key === 'ArrowUp' || (e.ctrlKey && e.code === 'KeyP')) { e.preventDefault(); if (n) setI(x => (x - 1 + n) % n); }
          else if (e.key === 'Enter') { e.preventDefault(); if (!rels && query) setInWait(true); else if (picked) open(picked.rel, line, column); else SFX.notAllowed(); }
        }} />
      <div ref={list} className="ex-quick-list">
        {results.map((r, k) => {
          const base = r.rel.lastIndexOf('/') + 1, marks = new Set(r.marks);
          const chunk = (since: number, until: number) => Array.from(r.rel.slice(since, until), (c, j) => (marks.has(since + j) ? <b key={j}>{c}</b> : c));
          return (
            <div key={r.rel} className={'ex-quick-item' + (k === i ? ' sel' : '')} onMouseDown={e => { e.preventDefault(); open(r.rel, line, column); }} onMouseMove={() => setI(k)}>
              <span className="ex-quick-name">{chunk(base, r.rel.length)}</span>
              <span className="ex-quick-folder">{chunk(0, Math.max(0, base - 1))}</span>
              {!query && recent.includes(r.rel) && <span className="ex-quick-recent">{t('windows.recentlyOpened')}</span>}
            </div>
          );
        })}
        {rels && query && !results.length && <div className="ex-quick-item dim">{t('windows.noFileHasThatName')}</div>}
      </div>
    </div>
  );
}
