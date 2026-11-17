// Páginas HTML del Mac dentro del juego (localPages.ts): se sirven con su llave, aisladas y sin salir de su carpeta
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { openLink, linkKind, imageThumbnail, servePage, PAGE_CSP, withNotes } from './localPages.ts';

const base = mkdtempSync(path.join(os.tmpdir(), 'paginas-'));
const carpeta = path.join(base, 'repo', 'tmp'); mkdirSync(carpeta, { recursive: true });
writeFileSync(path.join(carpeta, 'mi plan.html'), '<h1>Plan</h1>');
writeFileSync(path.join(carpeta, 'estilo.css'), 'h1{}');
writeFileSync(path.join(base, 'repo', 'secreto.env'), 'CLAVE=1');
symlinkSync(path.join(base, 'repo', 'secreto.env'), path.join(carpeta, 'atajo.env'));

const servidor = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  servePage(req, res, url).then(ok => { if (!ok) { res.writeHead(404); res.end(); } });
});
const listo = new Promise<number>(ok => servidor.listen(0, '127.0.0.1', () => ok((servidor.address() as any).port)));
afterAll(() => servidor.close());
const pedir = async (ruta: string) => { const r = await fetch(`http://127.0.0.1:${await listo}${ruta}`); return { status: r.status, csp: r.headers.get('content-security-policy'), tipo: r.headers.get('content-type'), texto: await r.text() }; };

describe('páginas HTML del Mac en el juego', () => {
  it("a link's kind, without opening it: inside the game or not, and where the Mac would open it", async () => {
    expect(await linkKind(path.join(carpeta, 'mi plan.html') + ':3', '/Users/nadie')).toEqual({ juego: true, mac: 'web' });
    expect(await linkKind(path.join(carpeta, 'estilo.css'), '/Users/nadie')).toEqual({ juego: false, mac: 'editor' });
    expect(await linkKind(carpeta, '/Users/nadie')).toEqual({ juego: false, mac: 'carpeta' });
    await expect(linkKind(path.join(carpeta, 'falta.html'), '/Users/nadie')).rejects.toThrow();
  });
  it('un enlace a una página da su dirección en el juego (con llave) en vez de abrirla en el Mac', async () => {
    const r = await openLink(path.join(carpeta, 'mi plan.html') + ':3', '/Users/nadie') as any;
    expect(r.pagina.titulo).toBe('mi plan.html');
    expect(r.pagina.url).toMatch(/^\/pagina\/[0-9a-f]{32}\/mi%20plan\.html$/);
  });
  it('se sirve con la cabecera sandbox y sin conexiones, y también lo relativo de su carpeta', async () => {
    const { pagina } = await openLink(`file://${encodeURI(path.join(carpeta, 'mi plan.html'))}`, '/Users/nadie') as any;
    const p = await pedir(pagina.url);
    expect([p.status, p.tipo]).toEqual([200, 'text/html; charset=utf-8']);
    expect(p.texto.startsWith('<h1>Plan</h1><script>')).toBe(true);   // con la capa de notas al final
    expect(p.csp).toBe(PAGE_CSP);
    expect(PAGE_CSP).toMatch(/^sandbox allow-scripts/); expect(PAGE_CSP).not.toContain('allow-same-origin'); expect(PAGE_CSP).toContain("connect-src 'none'");
    expect((await pedir(pagina.url.replace('mi%20plan.html', 'estilo.css'))).status).toBe(200);
  });
  it('carga scripts de los CDN públicos (marked, mermaid), pero no de cualquier sitio ni imágenes de fuera', () => {
    const scripts = PAGE_CSP.split('; ').find(d => d.startsWith('script-src '))!;
    expect(scripts).toContain('https://cdn.jsdelivr.net');
    expect(scripts.split(' ')).not.toContain('https:');
    expect(PAGE_CSP.split('; ').find(d => d.startsWith('img-src '))).not.toContain('https');
  });
  it('un .md se ve como página en el juego: pasado a HTML, con sus diagramas mermaid y la capa de notas', async () => {
    writeFileSync(path.join(carpeta, 'plan.md'), '# Plan <b>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```mermaid\nflowchart TD\n  A --> B\n```\n');
    const { pagina } = await openLink(path.join(carpeta, 'plan.md'), '/Users/nadie') as any;
    expect(pagina.url).toMatch(/\/plan\.md$/);
    const p = await pedir(pagina.url);
    expect([p.status, p.tipo, p.csp]).toEqual([200, 'text/html; charset=utf-8', PAGE_CSP]);
    expect(p.texto).toContain('<title>plan.md</title>');
    expect(p.texto).toContain('<td>1</td>');
    expect(p.texto).toContain('<pre class="mermaid">flowchart TD\n  A --&gt; B\n</pre>');
    expect(p.texto).toContain('mermaid.min.js');
    expect(p.texto).toContain('postMessage');
  });
  it('la capa de notas va una vez, antes del último </body>, y sin cerrar su <script> antes de tiempo', () => {
    const html = withNotes('<html><body><p>a</p><pre>&lt;/body&gt;</pre></body></html>');
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html.endsWith('</script></body></html>')).toBe(true);
    expect(html).toContain("postMessage");
    expect(html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'))).not.toMatch(/<\/script/i);
    expect(withNotes('<p>sin body</p>').startsWith('<p>sin body</p><script>')).toBe(true);
  });
  it('nada fuera de la carpeta de la página: ni subiendo, ni por un enlace simbólico, ni con otra llave', async () => {
    const { pagina } = await openLink(path.join(carpeta, 'mi plan.html'), '/Users/nadie') as any;
    const llave = pagina.url.split('/')[2];
    expect((await pedir(`/pagina/${llave}/..%2Fsecreto.env`)).status).toBe(404);
    expect((await pedir(`/pagina/${llave}/atajo.env`)).status).toBe(404);
    expect((await pedir(`/pagina/${'0'.repeat(32)}/mi%20plan.html`)).status).toBe(404);
  });
});

describe('images of the Mac in the game', () => {
  const fotos = path.join(base, 'fotos'); mkdirSync(fotos);
  writeFileSync(path.join(fotos, 'captura.png'), 'PNG'); writeFileSync(path.join(fotos, 'vecina.png'), 'PNG');
  writeFileSync(path.join(fotos, 'nota.txt'), 'texto'); writeFileSync(path.join(fotos, 'foto.heic'), 'HEIC');
  it('a link to an image opens in the «Página» window, with a key that serves that image only', async () => {
    const { pagina } = await openLink(path.join(fotos, 'captura.png'), '/Users/nadie') as any;
    expect(pagina).toMatchObject({ titulo: 'captura.png', ruta: path.join(realpathSync(fotos), 'captura.png') });
    const p = await pedir(pagina.url);
    expect([p.status, p.tipo, p.csp]).toEqual([200, 'image/png', PAGE_CSP]);
    expect((await pedir(pagina.url.replace('captura.png', 'vecina.png'))).status).toBe(404);
    expect((await pedir(pagina.url.replace('captura.png', 'nota.txt'))).status).toBe(404);
  });
  it('thumbnails: only images the game draws (not text, not HEIC, not a folder)', async () => {
    expect(await imageThumbnail(`file://${path.join(fotos, 'captura.png')}`, '/Users/nadie')).toMatch(/^\/pagina\/[0-9a-f]{32}\/captura\.png$/);
    expect(await imageThumbnail(path.join(fotos, 'nota.txt'), '/Users/nadie')).toBeNull();
    expect(await imageThumbnail(path.join(fotos, 'foto.heic'), '/Users/nadie')).toBeNull();
    expect(await imageThumbnail(path.join(fotos, 'falta.png'), '/Users/nadie')).toBeNull();
    expect(await imageThumbnail('relativa.png', '/Users/nadie')).toBeNull();
  });
  it('an image beside a page uses the page folder\'s key; a page beside an image gets the folder\'s', async () => {
    writeFileSync(path.join(carpeta, 'grafica.png'), 'PNG');
    const pag = (await openLink(path.join(carpeta, 'mi plan.html'), '/Users/nadie') as any).pagina.url.split('/')[2];
    expect((await imageThumbnail(path.join(carpeta, 'grafica.png'), '/Users/nadie'))!.split('/')[2]).toBe(pag);
    writeFileSync(path.join(fotos, 'informe.html'), '<p>x</p>');
    const img = (await imageThumbnail(path.join(fotos, 'captura.png'), '/Users/nadie'))!.split('/')[2];
    const inf = (await openLink(path.join(fotos, 'informe.html'), '/Users/nadie') as any).pagina.url.split('/')[2];
    expect(inf).not.toBe(img);
    expect((await pedir(`/pagina/${inf}/vecina.png`)).status).toBe(200);
  });
});

describe('existingPages', () => {
  it('solo las que siguen en el Mac (las de un worktree quitado, no)', async () => {
    const { existingPages } = await import('./localPages.ts');
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const os = await import('node:os'); const path = await import('node:path');
    const d = mkdtempSync(path.join(os.tmpdir(), 'paginas-'));
    writeFileSync(path.join(d, 'plan.html'), '<p>plan</p>');
    expect(await existingPages([path.join(d, 'plan.html'), path.join(d, 'quitada', 'plan.html'), 42], os.homedir())).toEqual([path.join(d, 'plan.html')]);
  });
  it('con cuándo se cambió cada una por última vez', async () => {
    const { pagesUpdated } = await import('./localPages.ts');
    const { mkdtempSync, writeFileSync, utimesSync } = await import('node:fs');
    const os = await import('node:os'); const path = await import('node:path');
    const d = mkdtempSync(path.join(os.tmpdir(), 'paginas-'));
    writeFileSync(path.join(d, 'plan.html'), '<p>plan</p>');
    const cuando = new Date('2026-11-10T09:30:00Z');
    utimesSync(path.join(d, 'plan.html'), cuando, cuando);
    expect(await pagesUpdated([path.join(d, 'plan.html'), path.join(d, 'quitada.html')], os.homedir())).toEqual({ [path.join(d, 'plan.html')]: cuando.getTime() });
  });
});
