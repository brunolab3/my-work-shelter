// Notas del Supervisor en una página del refugio (/pagina/…, server/paginasLocales.ts la mete al final de cada página
// HTML). Corre dentro del <iframe> aislado (origen opaco, sin almacenamiento ni red): seleccionar un trozo → «✎ Nota»;
// un clic en lo marcado la edita o la borra. Las notas viven en el juego (web/src/ui/Navegadores.tsx), que las guarda
// y las manda a la conversación: aquí solo se marcan (CSS Custom Highlight, sin tocar el DOM de la página) y se avisa
// de cada cambio con postMessage. JavaScript sin compilar: se mete tal cual en la página.
(() => {
  if (window.__refugioNotas) return;
  window.__refugioNotas = true;
  const post = m => parent.postMessage(Object.assign({ refugio: 'notas' }, m), '*');
  let notas = [];
  let textos = null;   // llegan del juego con las notas guardadas (en el idioma del juego)
  const rangos = new Map();
  const marca = typeof Highlight === 'function' && CSS.highlights ? new Highlight() : null;
  if (marca) CSS.highlights.set('refugio-nota', marca);
  const estilo = document.createElement('style');
  estilo.textContent = '::highlight(refugio-nota){background:rgba(255,196,0,.38);color:inherit}';
  (document.head || document.documentElement).appendChild(estilo);

  // la interfaz, en su propia raíz de sombra: el CSS de la página no la toca ni ella a la página
  const host = document.createElement('div');
  host.id = 'refugio-notas';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  const raiz = host.attachShadow({ mode: 'closed' });
  raiz.innerHTML = `<style>
    *{box-sizing:border-box;font:13px/1.4 ui-monospace,Menlo,monospace}
    .boton{position:fixed;pointer-events:auto;background:#1d1a14;color:#f3e3b5;border:1px solid #c9a24a;border-radius:4px;padding:3px 8px;cursor:pointer;box-shadow:0 2px 8px #0008}
    .caja{position:fixed;pointer-events:auto;width:340px;background:#1d1a14;color:#f3e3b5;border:1px solid #c9a24a;border-radius:6px;padding:8px;box-shadow:0 6px 24px #000a}
    .cita{color:#c9b98a;font-style:italic;max-height:4.2em;overflow:hidden;margin-bottom:6px}
    textarea{width:100%;min-height:84px;resize:vertical;background:#0f0d0a;color:#f3e3b5;border:1px solid #6b5a33;border-radius:4px;padding:6px}
    .fila{display:flex;gap:6px;justify-content:flex-end;margin-top:6px}
    .fila button{background:#2b261c;color:#f3e3b5;border:1px solid #6b5a33;border-radius:4px;padding:3px 10px;cursor:pointer}
    .fila .si{border-color:#c9a24a}.fila .borrar{margin-right:auto;color:#f0a090}
    [hidden]{display:none}
  </style>
  <button class="boton" hidden></button>
  <div class="caja" hidden><div class="cita"></div><textarea></textarea>
    <div class="fila"><button class="borrar"></button><button class="no"></button><button class="si"></button></div></div>`;
  const boton = raiz.querySelector('.boton'), caja = raiz.querySelector('.caja'), area = raiz.querySelector('textarea');
  const citaEl = raiz.querySelector('.cita'), bBorrar = raiz.querySelector('.borrar'), bNo = raiz.querySelector('.no'), bSi = raiz.querySelector('.si');
  const montar = () => { if (!host.isConnected) (document.body || document.documentElement).appendChild(host); };

  // texto de la página con los espacios plegados, y de dónde sale cada carácter (para volver a encontrar una cita)
  const plegar = s => s.replace(/\s+/g, ' ').trim();
  function indice() {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement && n.parentElement.closest('script,style,noscript,#refugio-notas') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let texto = '', pos = [], espacio = true, n;
    while ((n = w.nextNode())) {
      const d = n.data;
      for (let i = 0; i < d.length; i++) {
        if (/\s/.test(d[i])) { if (!espacio) { texto += ' '; pos.push([n, i]); espacio = true; } }
        else { texto += d[i]; pos.push([n, i]); espacio = false; }
      }
      if (!espacio) { texto += ' '; pos.push([n, d.length]); espacio = true; }
    }
    return { texto, pos };
  }
  function buscar(cita, cerca) {
    const c = plegar(cita); if (!c) return null;
    const { texto, pos } = indice();
    let i = texto.indexOf(c), mejor = i;
    // si la cita sale varias veces, la más cercana a donde estaba
    while (cerca != null && i >= 0) { if (Math.abs(i - cerca) < Math.abs(mejor - cerca)) mejor = i; i = texto.indexOf(c, i + 1); }
    if (mejor < 0) return null;
    const a = pos[mejor], b = pos[mejor + c.length - 1];
    const r = document.createRange(); r.setStart(a[0], a[1]); r.setEnd(b[0], b[1] + 1);
    return { r, inicio: mejor };
  }
  function offsetDe(rango) {
    const { pos } = indice();
    const k = pos.findIndex(([n, o]) => n === rango.startContainer && o >= rango.startOffset);
    return k < 0 ? null : k;
  }
  // la sección: el encabezado (o lo marcado con data-seccion) anterior más cercano
  function seccion(rango) {
    const el = rango.startContainer.nodeType === 1 ? rango.startContainer : rango.startContainer.parentElement;
    const dentro = el && el.closest('[data-seccion]');
    if (dentro) return plegar(dentro.getAttribute('data-seccion') || '').slice(0, 300);
    const cand = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[data-seccion]')].filter(h => !h.closest('#refugio-notas'));
    let mejor = null;
    for (const h of cand) if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING || h.contains(el)) mejor = h;
    return mejor ? plegar(mejor.getAttribute('data-seccion') || mejor.textContent || '').slice(0, 300) : '';
  }
  function pintar() {
    rangos.clear(); if (marca) marca.clear();
    for (const n of notas) { const f = buscar(n.cita, n.inicio); if (f) { rangos.set(n.id, f.r); if (marca) marca.add(f.r); } }
  }
  const avisar = () => post({ tipo: 'lista', notas });

  // editar: una nota nueva (con su rango) o una que ya está
  let editando = null;
  function abrir(n, rect) {
    if (!textos) return;
    editando = n; montar();
    citaEl.textContent = '«' + (n.cita.length > 220 ? n.cita.slice(0, 220) + '…' : n.cita) + '»';
    area.value = n.texto || ''; area.placeholder = textos.placeholder;
    bSi.textContent = textos.guardar; bNo.textContent = textos.cancelar; bBorrar.textContent = textos.borrar;
    bBorrar.hidden = !notas.some(x => x.id === n.id);
    caja.hidden = false; boton.hidden = true;
    const x = Math.min(Math.max(8, rect.left), innerWidth - 350), y = rect.bottom + 8 + 180 < innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - 190);
    caja.style.left = x + 'px'; caja.style.top = y + 'px';
    setTimeout(() => area.focus(), 0);
  }
  function cerrar() { caja.hidden = true; editando = null; }
  function guardar() {
    if (!editando) return;
    const texto = area.value.trim().slice(0, 5000);
    if (!texto) { cerrar(); return; }
    const ya = notas.findIndex(x => x.id === editando.id);
    const n = Object.assign({}, editando, { texto });
    if (ya >= 0) notas[ya] = n; else notas.push(n);
    cerrar(); pintar(); avisar(); getSelection().removeAllRanges();
  }
  bSi.onclick = guardar; bNo.onclick = cerrar;
  bBorrar.onclick = () => { if (editando) { notas = notas.filter(x => x.id !== editando.id); cerrar(); pintar(); avisar(); } };
  area.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); cerrar(); } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); guardar(); } });

  // seleccionar → «✎ Nota» junto a la selección
  let pendiente = null;
  document.addEventListener('mouseup', e => {
    if (!textos || e.composedPath().includes(host)) return;
    setTimeout(() => {
      const s = getSelection();
      if (!s || s.isCollapsed || !s.rangeCount) { boton.hidden = true; return; }
      const r = s.getRangeAt(0), cita = plegar(s.toString()).slice(0, 2000);
      if (!cita) { boton.hidden = true; return; }
      pendiente = { r: r.cloneRange(), cita };
      const rect = r.getBoundingClientRect(); montar();
      boton.textContent = textos.nota; boton.hidden = false;
      boton.style.left = Math.min(innerWidth - 90, Math.max(8, rect.right - 40)) + 'px';
      boton.style.top = (rect.bottom + 6 + 30 < innerHeight ? rect.bottom + 6 : rect.top - 32) + 'px';
    }, 0);
  });
  boton.addEventListener('mousedown', e => e.preventDefault());   // que no se pierda la selección
  boton.onclick = () => {
    if (!pendiente) return;
    const { r, cita } = pendiente; pendiente = null;
    abrir({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), cita, seccion: seccion(r), inicio: offsetDe(r), texto: '' }, r.getBoundingClientRect());
  };
  // un clic en lo marcado: editar esa nota
  document.addEventListener('click', e => {
    if (!textos || e.composedPath().includes(host) || !getSelection().isCollapsed) return;
    const p = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (!p) return;
    for (const [id, r] of rangos) {
      try { if (r.isPointInRange(p.startContainer, p.startOffset)) { const n = notas.find(x => x.id === id); if (n) { e.preventDefault(); abrir(n, r.getBoundingClientRect()); } return; } } catch {}
    }
  }, true);
  addEventListener('scroll', () => { boton.hidden = true; }, true);

  // del juego: las notas guardadas de esta página y los textos; «limpiar», cuando ya se han mandado
  addEventListener('message', e => {
    if (e.source !== parent || !e.data || e.data.refugio !== 'notas') return;
    if (e.data.tipo === 'restaurar') { textos = e.data.textos || textos; notas = Array.isArray(e.data.notas) ? e.data.notas : []; pintar(); }
    else if (e.data.tipo === 'limpiar') { notas = []; cerrar(); pintar(); }
  });
  const hola = () => post({ tipo: 'hola' });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hola); else hola();
})();
