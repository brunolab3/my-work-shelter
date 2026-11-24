// Notas del Supervisor en una página del refugio (/pagina/…, server/localPages.ts la mete al final de cada página
// HTML). Corre dentro del <iframe> aislado (origen opaco, sin almacenamiento ni red): seleccionar un trozo → «✎ Nota»;
// un clic en lo marcado la edita o la borra. Las notas viven en el juego (web/src/ui/Browsers.tsx), que las guarda
// y las manda a la conversación: aquí solo se marcan (CSS Custom Highlight, sin tocar el DOM de la página) y se avisa
// de cada cambio con postMessage. En las comparaciones (filas con número de línea), además, «+» al pasar por una línea
// deja una nota en ella, como en GitHub. JavaScript sin compilar: se mete tal cual en la página.
(() => {
  if (window.__refugioNotas) return;
  window.__refugioNotas = true;
  const post = m => parent.postMessage(Object.assign({ shelter: 'notes' }, m), '*');
  let notes = [];
  let texts = null;   // llegan del juego con las notas guardadas (en el idioma del juego)
  const ranks = new Map();
  const mark = typeof Highlight === 'function' && CSS.highlights ? new Highlight() : null;
  if (mark) CSS.highlights.set('shelter-note', mark);
  const style = document.createElement('style');
  style.textContent = '::highlight(refugio-nota){background:rgba(255,196,0,.38);color:inherit}';
  (document.head || document.documentElement).appendChild(style);

  // la interfaz, en su propia raíz de sombra: el CSS de la página no la toca ni ella a la página
  const host = document.createElement('div');
  host.id = 'shelter-notes';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    *{box-sizing:border-box;font:13px/1.4 ui-monospace,Menlo,monospace}
    .boton{position:fixed;pointer-events:auto;background:#1d1a14;color:#f3e3b5;border:1px solid #c9a24a;border-radius:4px;padding:3px 8px;cursor:pointer;box-shadow:0 2px 8px #0008}
    .caja{position:fixed;pointer-events:auto;width:340px;background:#1d1a14;color:#f3e3b5;border:1px solid #c9a24a;border-radius:6px;padding:8px;box-shadow:0 6px 24px #000a}
    .cita{color:#c9b98a;font-style:italic;max-height:4.2em;overflow:hidden;margin-bottom:6px}
    textarea{width:100%;min-height:84px;resize:vertical;background:#0f0d0a;color:#f3e3b5;border:1px solid #6b5a33;border-radius:4px;padding:6px}
    .fila{display:flex;gap:6px;justify-content:flex-end;margin-top:6px}
    .fila button{background:#2b261c;color:#f3e3b5;border:1px solid #6b5a33;border-radius:4px;padding:3px 10px;cursor:pointer}
    .fila .si{border-color:#c9a24a}.fila .borrar{margin-right:auto;color:#f0a090}
    .mas{padding:0 6px;font-weight:700;line-height:16px;background:#1f6feb;color:#fff;border-color:#388bfd}
    [hidden]{display:none}
  </style>
  <button class="boton" hidden></button>
  <button class="boton plus" hidden>+</button>
  <div class="caja" hidden><div class="cita"></div><textarea></textarea>
    <div class="fila"><button class="borrar"></button><button class="no"></button><button class="si"></button></div></div>`;
  const button = root.querySelector('.boton:not(.plus)'), more = root.querySelector('.plus'), box = root.querySelector('.caja'), area = root.querySelector('textarea');
  const citaEl = root.querySelector('.cita'), bBorrar = root.querySelector('.borrar'), bNo = root.querySelector('.no'), bSi = root.querySelector('.si');
  const mount = () => { if (!host.isConnected) (document.body || document.documentElement).appendChild(host); };

  // texto de la página con los espacios plegados, y de dónde sale cada carácter (para volver a encontrar una cita)
  const fold = s => s.replace(/\s+/g, ' ').trim();
  function index() {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement && n.parentElement.closest('script,style,noscript,#refugio-notas') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let text = '', pos = [], space = true, n;
    while ((n = w.nextNode())) {
      const d = n.data;
      for (let i = 0; i < d.length; i++) {
        if (/\s/.test(d[i])) { if (!space) { text += ' '; pos.push([n, i]); space = true; } }
        else { text += d[i]; pos.push([n, i]); space = false; }
      }
      if (!space) { text += ' '; pos.push([n, d.length]); space = true; }
    }
    return { text, pos };
  }
  function search(quote, near) {
    const c = fold(quote); if (!c) return null;
    const { text, pos } = index();
    let i = text.indexOf(c), best = i;
    // si la cita sale varias veces, la más cercana a donde estaba
    while (near != null && i >= 0) { if (Math.abs(i - near) < Math.abs(best - near)) best = i; i = text.indexOf(c, i + 1); }
    if (best < 0) return null;
    const a = pos[best], b = pos[best + c.length - 1];
    const r = document.createRange(); r.setStart(a[0], a[1]); r.setEnd(b[0], b[1] + 1);
    return { r, start: best };
  }
  function offsetDe(rank) {
    const { pos } = index();
    const k = pos.findIndex(([n, o]) => n === rank.startContainer && o >= rank.startOffset);
    return k < 0 ? null : k;
  }
  // la sección: el encabezado (o lo marcado con data-seccion) anterior más cercano
  function section(rank) {
    const el = rank.startContainer.nodeType === 1 ? rank.startContainer : rank.startContainer.parentElement;
    const inside = el && el.closest('[data-seccion]');
    if (inside) return fold(inside.getAttribute('data-section') || '').slice(0, 300);
    const cand = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[data-seccion]')].filter(h => !h.closest('#refugio-notas'));
    let best = null;
    for (const h of cand) if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING || h.contains(el)) best = h;
    return best ? fold(best.getAttribute('data-section') || best.textContent || '').slice(0, 300) : '';
  }
  function pintar() {
    ranks.clear(); if (mark) mark.clear();
    for (const n of notes) { const f = search(n.quote, n.start); if (f) { ranks.set(n.id, f.r); if (mark) mark.add(f.r); } }
  }
  const notify = () => post({ type: 'lista', notes });

  // editar: una nota nueva (con su rango) o una que ya está
  let editing = null;
  function open(n, rect) {
    if (!texts) return;
    editing = n; mount();
    citaEl.textContent = '«' + (n.quote.length > 220 ? n.quote.slice(0, 220) + '…' : n.quote) + '»';
    area.value = n.text || ''; area.placeholder = texts.placeholder;
    bSi.textContent = texts.save; bNo.textContent = texts.cancel; bBorrar.textContent = texts.deleteMessage;
    bBorrar.hidden = !notes.some(x => x.id === n.id);
    box.hidden = false; button.hidden = true;
    const x = Math.min(Math.max(8, rect.left), innerWidth - 350), y = rect.bottom + 8 + 180 < innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - 190);
    box.style.left = x + 'px'; box.style.top = y + 'px';
    setTimeout(() => area.focus(), 0);
  }
  function close() { box.hidden = true; editing = null; }
  function save() {
    if (!editing) return;
    const text = area.value.trim().slice(0, 5000);
    if (!text) { close(); return; }
    const already = notes.findIndex(x => x.id === editing.id);
    const n = Object.assign({}, editing, { text });
    if (already >= 0) notes[already] = n; else notes.push(n);
    close(); pintar(); notify(); getSelection().removeAllRanges();
  }
  bSi.onclick = save; bNo.onclick = close;
  bBorrar.onclick = () => { if (editing) { notes = notes.filter(x => x.id !== editing.id); close(); pintar(); notify(); } };
  area.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } });

  // seleccionar → «✎ Nota» junto a la selección
  let pending = null;
  document.addEventListener('mouseup', e => {
    if (!texts || e.composedPath().includes(host)) return;
    setTimeout(() => {
      const s = getSelection();
      if (!s || s.isCollapsed || !s.rangeCount) { button.hidden = true; return; }
      const r = s.getRangeAt(0), quote = fold(s.toString()).slice(0, 2000);
      if (!quote) { button.hidden = true; return; }
      pending = { r: r.cloneRange(), quote };
      const rect = r.getBoundingClientRect(); mount();
      button.textContent = texts.note; button.hidden = false;
      button.style.left = Math.min(innerWidth - 90, Math.max(8, rect.right - 40)) + 'px';
      button.style.top = (rect.bottom + 6 + 30 < innerHeight ? rect.bottom + 6 : rect.top - 32) + 'px';
    }, 0);
  });
  button.addEventListener('mousedown', e => e.preventDefault());   // que no se pierda la selección
  button.onclick = () => {
    if (!pending) return;
    const { r, quote } = pending; pending = null;
    open({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), quote, section: section(r), start: offsetDe(r), text: '' }, r.getBoundingClientRect());
  };
  // un clic en lo marcado: editar esa nota
  document.addEventListener('click', e => {
    if (!texts || e.composedPath().includes(host) || !getSelection().isCollapsed) return;
    const p = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (!p) return;
    for (const [id, r] of ranks) {
      try { if (r.isPointInRange(p.startContainer, p.startOffset)) { const n = notes.find(x => x.id === id); if (n) { e.preventDefault(); open(n, r.getBoundingClientRect()); } return; } } catch {}
    }
  }, true);
  // a link of the page: the game opens it (a click, its default way; a right click, its options), never the <iframe>.
  // Its raw href: resolved here it would point at /pagina/<key>/…, not at the file. After the note's click above
  for (const type of ['click', 'contextmenu']) document.addEventListener(type, e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.composedPath().includes(host) || (type === 'click' && e.button !== 0)) return;
    if (a.hash && a.href.split('#')[0] === location.href.split('#')[0]) return;   // an anchor of this page
    e.preventDefault();
    post({ type: 'link', href: a.getAttribute('href'), x: e.clientX, y: e.clientY, menu: type === 'contextmenu' });
  });
  // en una comparación (filas con número de línea, td.n), como en GitHub: «+» al pasar por una línea y una nota en ella
  let row = null;
  const lineaDe = tr => [...tr.querySelectorAll('td.n')].map(td => td.textContent.trim()).filter(Boolean).pop() || '';
  document.addEventListener('mouseover', e => {
    if (!texts || e.composedPath().includes(host) || !box.hidden) return;
    const tr = e.target.closest && e.target.closest('tr');
    if (!tr || !tr.querySelector('td.n') || !lineaDe(tr)) return;
    row = tr; mount();
    const r = tr.getBoundingClientRect(), n = tr.querySelector('td.n').getBoundingClientRect();
    more.hidden = false; more.style.left = Math.max(2, n.left - 20) + 'px'; more.style.top = (r.top + Math.max(0, (r.height - 18) / 2)) + 'px';
  });
  more.onclick = () => {
    if (!row) return;
    const cell = row.querySelector('td.c') || row.lastElementChild;
    const r = document.createRange(); r.selectNodeContents(cell);
    // desde el primer texto del código (sin el signo + o −): así se sabe cuál de las líneas iguales es
    const w = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, { acceptNode: t => (t.parentElement.closest('.s') || !t.data.trim() ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_ACCEPT) });
    const first = w.nextNode(); if (first) r.setStart(first, first.data.search(/\S/));
    const line = lineaDe(row), own = row.getAttribute('data-section');
    const quote = fold(r.toString()).slice(0, 2000) || '(' + line + ')';
    more.hidden = true;
    open({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), quote, section: (own ? fold(own) : (section(r) + ':' + line)).slice(0, 300), start: offsetDe(r), text: '' }, row.getBoundingClientRect());
  };
  addEventListener('scroll', () => { button.hidden = true; more.hidden = true; }, true);
  // el juego recarga la página cuando cambia su archivo: le dice por dónde va para volver ahí (con mermaid la página
  // crece al pintarse: se vuelve a colocar al cargar del todo y un momento después)
  let avisoScroll = 0;
  addEventListener('scroll', () => { clearTimeout(avisoScroll); avisoScroll = setTimeout(() => post({ type: 'scroll', y: scrollY }), 150); });
  const volverA = y => { const go = () => scrollTo(0, y); go(); if (document.readyState !== 'complete') addEventListener('load', go, { once: true }); setTimeout(go, 400); setTimeout(go, 1200); };

  // ⌘F from the game (web/src/ui/FindBar.tsx): the matches of a text in the page, marked like the notes and with the
  // same matching as matchOffsets in web/src/ui/findText.ts; the game is told how many there are and which is current
  const findAll = mark ? new Highlight() : null, findNow = mark ? new Highlight() : null;
  if (findAll) { findNow.priority = 1; CSS.highlights.set('shelter-find', findAll); CSS.highlights.set('shelter-find-current', findNow); }
  style.textContent += '::highlight(shelter-find){background:rgba(255,196,0,.35);color:inherit}::highlight(shelter-find-current){background:#ff9632;color:#000}';
  let found = [], foundAt = -1, foundQuery = '';
  function matches(q) {
    const nodes = [], shown = new Map();
    const visible = el => { if (!shown.has(el)) shown.set(el, !el.closest('script,style,noscript,#refugio-notas') && (el.checkVisibility ? el.checkVisibility() : true)); return shown.get(el); };
    const w = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement && visible(n.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    let text = '', n;
    while ((n = w.nextNode())) { nodes.push([n, text.length]); text += n.data; }
    const low = text.toLowerCase(), lq = q.toLowerCase(), same = low.length === text.length && lq.length === q.length;
    const hay = same ? low : text, needle = same ? lq : q, out = [];
    const at = k => { let lo = 0, hi = nodes.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nodes[mid][1] <= k) lo = mid; else hi = mid - 1; } return nodes[lo]; };
    for (let i = hay.indexOf(needle); i >= 0 && out.length < 1000; i = hay.indexOf(needle, i + needle.length)) {
      const a = at(i), b = at(i + q.length - 1), r = document.createRange();
      r.setStart(a[0], i - a[1]); r.setEnd(b[0], i + q.length - b[1]); out.push(r);
    }
    return out;
  }
  function find(q, dir, again) {
    if (!again || q !== foundQuery) { foundQuery = q; found = q ? matches(q) : []; foundAt = -1; if (findAll) { findAll.clear(); for (const r of found) findAll.add(r); } }
    foundAt = !found.length ? -1 : foundAt < 0 ? (dir > 0 ? 0 : found.length - 1) : (foundAt + dir + found.length) % found.length;
    if (findNow) findNow.clear();
    const r = found[foundAt];
    if (r) {
      if (findNow) findNow.add(r);
      const box = r.getBoundingClientRect();
      if (box.top < 0 || box.bottom > innerHeight) scrollBy(0, box.top - innerHeight / 3);
    }
    post({ type: 'found', n: found.length, i: foundAt });
  }
  function findClear() { found = []; foundAt = -1; foundQuery = ''; if (findAll) { findAll.clear(); findNow.clear(); } }

  // del juego: las notas guardadas de esta página y los textos; «limpiar», cuando ya se han mandado
  addEventListener('message', e => {
    if (e.source !== parent || !e.data || e.data.shelter !== 'notes') return;
    if (e.data.type === 'restore') { texts = e.data.texts || texts; notes = Array.isArray(e.data.notes) ? e.data.notes : []; pintar(); if (e.data.scroll > 0) volverA(Number(e.data.scroll)); }
    else if (e.data.type === 'clear') { notes = []; close(); pintar(); }
    else if (e.data.type === 'find') find(String(e.data.query || ''), e.data.dir < 0 ? -1 : 1, !!e.data.again);
    else if (e.data.type === 'findClear') findClear();
  });
  const hello = () => post({ type: 'hello' });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hello); else hello();
})();
