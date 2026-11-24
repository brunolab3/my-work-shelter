// Páginas HTML del Mac dentro del juego (localPages.ts): se sirven con su llave, aisladas y sin salir de su carpeta
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { openLink, linkKind, imageThumbnail, servePage, PAGE_CSP, withNotes } from './localPages.ts';

const base = mkdtempSync(path.join(os.tmpdir(), 'paginas-'));
const folder = path.join(base, 'repo', 'tmp'); mkdirSync(folder, { recursive: true });
writeFileSync(path.join(folder, 'mi plan.html'), '<h1>Plan</h1>');
writeFileSync(path.join(folder, 'estilo.css'), 'h1{}');
writeFileSync(path.join(base, 'repo', 'secreto.env'), 'CLAVE=1');
symlinkSync(path.join(base, 'repo', 'secreto.env'), path.join(folder, 'atajo.env'));

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  servePage(req, res, url).then(ok => { if (!ok) { res.writeHead(404); res.end(); } });
});
const ready = new Promise<number>(ok => server.listen(0, '127.0.0.1', () => ok((server.address() as any).port)));
afterAll(() => server.close());
const request = async (path: string) => { const r = await fetch(`http://127.0.0.1:${await ready}${path}`); return { status: r.status, csp: r.headers.get('content-security-policy'), type: r.headers.get('content-type'), text: await r.text() }; };

describe('páginas HTML del Mac en el juego', () => {
  it("a link's kind, without opening it: inside the game or not, and where the Mac would open it", async () => {
    expect(await linkKind(path.join(folder, 'mi plan.html') + ':3', '/Users/nadie')).toEqual({ juego: true, mac: 'web' });
    expect(await linkKind(path.join(folder, 'estilo.css'), '/Users/nadie')).toEqual({ juego: false, mac: 'editor' });
    expect(await linkKind(folder, '/Users/nadie')).toEqual({ juego: false, mac: 'folder' });
    await expect(linkKind(path.join(folder, 'falta.html'), '/Users/nadie')).rejects.toThrow();
  });
  it('un enlace a una página da su dirección en el juego (con llave) en vez de abrirla en el Mac', async () => {
    const r = await openLink(path.join(folder, 'mi plan.html') + ':3', '/Users/nadie') as any;
    expect(r.page.title).toBe('mi plan.html');
    expect(r.page.url).toMatch(/^\/pagina\/[0-9a-f]{32}\/mi%20plan\.html$/);
  });
  it('se sirve con la cabecera sandbox y sin conexiones, y también lo relativo de su carpeta', async () => {
    const { page } = await openLink(`file://${encodeURI(path.join(folder, 'mi plan.html'))}`, '/Users/nadie') as any;
    const p = await request(page.url);
    expect([p.status, p.type]).toEqual([200, 'text/html; charset=utf-8']);
    expect(p.text.startsWith('<h1>Plan</h1><script>')).toBe(true);   // con la capa de notas al final
    expect(p.csp).toBe(PAGE_CSP);
    expect(PAGE_CSP).toMatch(/^sandbox allow-scripts/); expect(PAGE_CSP).not.toContain('allow-same-origin'); expect(PAGE_CSP).toContain("connect-src 'none'");
    expect((await request(page.url.replace('mi%20plan.html', 'estilo.css'))).status).toBe(200);
  });
  it('carga scripts de los CDN públicos (marked, mermaid), pero no de cualquier sitio ni imágenes de fuera', () => {
    const scripts = PAGE_CSP.split('; ').find(d => d.startsWith('script-src '))!;
    expect(scripts).toContain('https://cdn.jsdelivr.net');
    expect(scripts.split(' ')).not.toContain('https:');
    expect(PAGE_CSP.split('; ').find(d => d.startsWith('img-src '))).not.toContain('https');
  });
  it('un .md se ve como página en el juego: pasado a HTML, con sus diagramas mermaid y la capa de notas', async () => {
    writeFileSync(path.join(folder, 'plan.md'), '# Plan <b>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```mermaid\nflowchart TD\n  A --> B\n```\n');
    const { page } = await openLink(path.join(folder, 'plan.md'), '/Users/nadie') as any;
    expect(page.url).toMatch(/\/plan\.md$/);
    const p = await request(page.url);
    expect([p.status, p.type, p.csp]).toEqual([200, 'text/html; charset=utf-8', PAGE_CSP]);
    expect(p.text).toContain('<title>plan.md</title>');
    expect(p.text).toContain('<td>1</td>');
    expect(p.text).toContain('<pre class="mermaid">flowchart TD\n  A --&gt; B\n</pre>');
    expect(p.text).toContain('mermaid.min.js');
    expect(p.text).toContain('postMessage');
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
    const { page } = await openLink(path.join(folder, 'mi plan.html'), '/Users/nadie') as any;
    const key = page.url.split('/')[2];
    expect((await request(`/pagina/${key}/..%2Fsecreto.env`)).status).toBe(404);
    expect((await request(`/pagina/${key}/atajo.env`)).status).toBe(404);
    expect((await request(`/pagina/${'0'.repeat(32)}/mi%20plan.html`)).status).toBe(404);
  });
});

describe('images of the Mac in the game', () => {
  const photos = path.join(base, 'fotos'); mkdirSync(photos);
  writeFileSync(path.join(photos, 'captura.png'), 'PNG'); writeFileSync(path.join(photos, 'vecina.png'), 'PNG');
  writeFileSync(path.join(photos, 'nota.txt'), 'text'); writeFileSync(path.join(photos, 'foto.heic'), 'HEIC');
  it('a link to an image opens in the «Página» window, with a key that serves that image only', async () => {
    const { page } = await openLink(path.join(photos, 'captura.png'), '/Users/nadie') as any;
    expect(page).toMatchObject({ title: 'captura.png', path: path.join(realpathSync(photos), 'captura.png') });
    const p = await request(page.url);
    expect([p.status, p.type, p.csp]).toEqual([200, 'image/png', PAGE_CSP]);
    expect((await request(page.url.replace('captura.png', 'vecina.png'))).status).toBe(404);
    expect((await request(page.url.replace('captura.png', 'nota.txt'))).status).toBe(404);
  });
  it('thumbnails: only images the game draws (not text, not HEIC, not a folder)', async () => {
    expect(await imageThumbnail(`file://${path.join(photos, 'captura.png')}`, '/Users/nadie')).toMatch(/^\/pagina\/[0-9a-f]{32}\/captura\.png$/);
    expect(await imageThumbnail(path.join(photos, 'nota.txt'), '/Users/nadie')).toBeNull();
    expect(await imageThumbnail(path.join(photos, 'foto.heic'), '/Users/nadie')).toBeNull();
    expect(await imageThumbnail(path.join(photos, 'falta.png'), '/Users/nadie')).toBeNull();
    expect(await imageThumbnail('relativa.png', '/Users/nadie')).toBeNull();
  });
  it('an image beside a page uses the page folder\'s key; a page beside an image gets the folder\'s', async () => {
    writeFileSync(path.join(folder, 'grafica.png'), 'PNG');
    const page = (await openLink(path.join(folder, 'mi plan.html'), '/Users/nadie') as any).page.url.split('/')[2];
    expect((await imageThumbnail(path.join(folder, 'grafica.png'), '/Users/nadie'))!.split('/')[2]).toBe(page);
    writeFileSync(path.join(photos, 'informe.html'), '<p>x</p>');
    const img = (await imageThumbnail(path.join(photos, 'captura.png'), '/Users/nadie'))!.split('/')[2];
    const lower = (await openLink(path.join(photos, 'informe.html'), '/Users/nadie') as any).page.url.split('/')[2];
    expect(lower).not.toBe(img);
    expect((await request(`/pagina/${lower}/vecina.png`)).status).toBe(200);
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
    const when = new Date('2026-11-10T09:30:00Z');
    utimesSync(path.join(d, 'plan.html'), when, when);
    expect(await pagesUpdated([path.join(d, 'plan.html'), path.join(d, 'quitada.html')], os.homedir())).toEqual({ [path.join(d, 'plan.html')]: when.getTime() });
  });
});
