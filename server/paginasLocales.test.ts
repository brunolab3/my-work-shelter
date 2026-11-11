// Páginas HTML del Mac dentro del juego (paginasLocales.ts): se sirven con su llave, aisladas y sin salir de su carpeta
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { openLink, servePage, PAGE_CSP } from './paginasLocales.ts';

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
  it('un enlace a una página da su dirección en el juego (con llave) en vez de abrirla en el Mac', async () => {
    const r = await openLink(path.join(carpeta, 'mi plan.html') + ':3', '/Users/nadie') as any;
    expect(r.pagina.titulo).toBe('mi plan.html');
    expect(r.pagina.url).toMatch(/^\/pagina\/[0-9a-f]{32}\/mi%20plan\.html$/);
  });
  it('se sirve con la cabecera sandbox y sin conexiones, y también lo relativo de su carpeta', async () => {
    const { pagina } = await openLink(`file://${encodeURI(path.join(carpeta, 'mi plan.html'))}`, '/Users/nadie') as any;
    const p = await pedir(pagina.url);
    expect([p.status, p.texto, p.tipo]).toEqual([200, '<h1>Plan</h1>', 'text/html; charset=utf-8']);
    expect(p.csp).toBe(PAGE_CSP);
    expect(PAGE_CSP).toMatch(/^sandbox allow-scripts/); expect(PAGE_CSP).not.toContain('allow-same-origin'); expect(PAGE_CSP).toContain("connect-src 'none'");
    expect((await pedir(pagina.url.replace('mi%20plan.html', 'estilo.css'))).status).toBe(200);
  });
  it('nada fuera de la carpeta de la página: ni subiendo, ni por un enlace simbólico, ni con otra llave', async () => {
    const { pagina } = await openLink(path.join(carpeta, 'mi plan.html'), '/Users/nadie') as any;
    const llave = pagina.url.split('/')[2];
    expect((await pedir(`/pagina/${llave}/..%2Fsecreto.env`)).status).toBe(404);
    expect((await pedir(`/pagina/${llave}/atajo.env`)).status).toBe(404);
    expect((await pedir(`/pagina/${'0'.repeat(32)}/mi%20plan.html`)).status).toBe(404);
  });
});
