// Catálogo de las fuentes de las integraciones, compartido por el servidor y el cliente: nombre, etiqueta corta,
// color y qué trae cada una. El orden es el de la cámara acorazada. Una fuente nueva: aquí, su conector en
// server/integraciones/<id>.ts, sus datos DEMO en server/integraciones/demo.ts y su ficha en web/src/ui/Camara.tsx.
export const SOURCES = ['outlook', 'google', 'mail', 'calendario', 'discord', 'slack', 'github', 'linear', 'jira'] as const;
export type SourceId = typeof SOURCES[number];

export interface InfoSource {
  nombre: string;            // en la cámara acorazada y en los paneles
  corto: string;             // en la insignia del tablón
  color: string;             // insignia, eventos y agenda
  calendario?: boolean;      // trae eventos
  chat?: boolean;            // conversaciones por canal (el tablón las trata como chats)
  completa?: boolean;        // el sondeo trae TODO lo pendiente: lo leído en su web sale solo del tablón
  oauth?: string;            // se conecta iniciando sesión en el navegador («Conectar con …»)
  canales?: boolean;         // se eligen los canales a vigilar una vez conectada
  withoutNotices?: boolean;       // no trae avisos al tablón (solo paneles, como el tablero de Jira en Logística)
  desactivada?: boolean;     // apagada en este refugio: sin conector, ni ficha en la cámara, ni avisos (el código sigue ahí)
}

export const INFO_SOURCE: Record<SourceId, InfoSource> = {
  outlook: { nombre: 'Microsoft 365 (Outlook)', corto: 'Outlook', color: '#6f8fb0', calendario: true, completa: true, oauth: 'Microsoft', desactivada: true },
  google: { nombre: 'Google (Gmail y Calendar)', corto: 'Gmail', color: '#b0a05a', calendario: true, completa: true, oauth: 'Google' },
  mail: { nombre: 'Mail del Mac (Gmail sin Google Cloud)', corto: 'Mail', color: '#8f86b0', completa: true },
  calendario: { nombre: 'Calendario del Mac', corto: 'Calendario', color: '#b0707a', calendario: true, withoutNotices: true },
  discord: { nombre: 'Discord (bot)', corto: 'Discord', color: '#b07a4a', chat: true, canales: true },
  slack: { nombre: 'Slack', corto: 'Slack', color: '#a07088', chat: true, canales: true },
  github: { nombre: 'GitHub', corto: 'GitHub', color: '#8a96a8', completa: true },
  linear: { nombre: 'Linear', corto: 'Linear', color: '#7fae86', completa: true, desactivada: true },
  jira: { nombre: 'Jira', corto: 'Jira', color: '#5a8fd0', withoutNotices: true },
};
// Las que funcionan en este refugio (para volver a encender una, quítale `desactivada`)
export const ACTIVE_SOURCES = SOURCES.filter(f => !INFO_SOURCE[f].desactivada);
export const activa = (f: string) => (ACTIVE_SOURCES as readonly string[]).includes(f);
export const CALENDAR_SOURCES = ACTIVE_SOURCES.filter(f => INFO_SOURCE[f].calendario);
