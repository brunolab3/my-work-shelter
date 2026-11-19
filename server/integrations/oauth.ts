// OAuth 2.0 de aplicación nativa (RFC 8252) común a Microsoft y Google: código de autorización + PKCE (S256) con
// retorno a http://localhost:<puerto libre> (IPv4 e IPv6, que «localhost» puede ser cualquiera de los dos). La escucha
// es de un solo uso: se cierra al volver el navegador o a los 5 minutos. Comprueba `state` y devuelve al conector el
// código (o el error) para que él lo canjee y pinte la página de vuelta.
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { t, language } from '../../shared/language.ts';

const WAIT_LOGIN = 5 * 60_000;

export const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function pkce() { const verifier = b64url(randomBytes(48)); return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }; }

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export function page(res: http.ServerResponse, ok: boolean, service: string, title: string, text: string) {
  res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
  res.end(`<!doctype html><html lang="${language()}"><meta charset="utf-8"><title>work-shelter · ${esc(service)}</title><body style="font:16px system-ui;background:#1d1a15;color:#eadfc8;display:grid;place-items:center;height:100vh;margin:0"><main style="max-width:34em;padding:2em;border:2px solid #6b5a3a;border-radius:8px;background:#2a251d"><h1 style="font-size:1.3em;color:${ok ? '#9fd38a' : '#f0a868'}">${esc(title)}</h1><p>${esc(text)}</p></main></body></html>`);
}

export interface Returned {
  url: string;                 // la de autorización, para abrir en el navegador
  stop(): void;
}
export interface ReturnedOptions {
  service: string;            // «Microsoft», «Google» (para las páginas)
  path?: string;               // ruta del retorno («/» en Microsoft, que admite http://localhost sin ruta)
  // con la redirección y el reto PKCE, la URL de autorización del proveedor
  authorization(redirect: string, state: string, challenge: string): string;
  // el navegador volvió con un código (o con un error): el conector lo canjea y dice qué página enseñar
  onBack(r: { code?: string; error?: Record<string, string>; redirect: string; verifier: string }): Promise<{ ok: boolean; title: string; text: string }>;
  onClose?(): void;
}

export async function listenReturned(op: ReturnedOptions): Promise<Returned> {
  const { verifier, challenge } = pkce();
  const state = b64url(randomBytes(16));
  const path = op.path ?? '/';
  let servers: http.Server[] = [];
  let timer: NodeJS.Timeout | null = null;
  const stop = () => {
    if (!servers.length) return;
    if (timer) clearTimeout(timer);
    for (const s of servers) { s.close(); s.closeIdleConnections(); }
    servers = [];
    op.onClose?.();
  };
  let redirect = '';
  const handle = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const u = new URL(req.url || '/', 'http://localhost');
    if (u.pathname !== path || (!u.searchParams.has('code') && !u.searchParams.has('error'))) { res.writeHead(404); res.end(); return; }
    if (u.searchParams.get('state') !== state) return page(res, false, op.service, t('integrations.linkExpired'), t('integrations.linkExpiredText', { servicio: op.service }));
    stop();
    const error = u.searchParams.get('error') ? Object.fromEntries(u.searchParams) : undefined;
    op.onBack({ code: u.searchParams.get('code') ?? undefined, error, redirect, verifier })
      .then(p => page(res, p.ok, op.service, p.title, p.text))
      .catch(e => page(res, false, op.service, t('integrations.couldNotConnectWith', { servicio: op.service }), (e as Error).message));
  };
  const s4 = http.createServer(handle);
  await new Promise<void>((ok, fail) => { s4.once('error', fail); s4.listen(0, '127.0.0.1', () => ok()); });
  const port = (s4.address() as AddressInfo).port;
  const s6 = http.createServer(handle); s6.on('error', () => {}); s6.listen(port, '::1');
  servers = [s4, s6];
  redirect = `http://localhost:${port}${path === '/' ? '' : path}`;
  timer = setTimeout(stop, WAIT_LOGIN);
  return { url: op.authorization(redirect, state, challenge), stop };
}
