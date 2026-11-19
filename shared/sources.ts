// Catálogo de las fuentes de las integraciones, compartido por el servidor y el cliente: nombre, etiqueta corta,
// color y qué trae cada una. El orden es el de la cámara acorazada. A new source: here, its connector in
// server/integrations/ (mapped in CONNECTORS in adapters.ts), sus datos DEMO en server/integrations/demo.ts y su ficha en web/src/ui/Vault.tsx.
export const SOURCES = ['outlook', 'google', 'mail', 'calendario', 'discord', 'slack', 'github', 'linear', 'jira'] as const;
export type SourceId = typeof SOURCES[number];

export interface InfoSource {
  name: string;            // en la cámara acorazada y en los paneles
  short: string;             // en la insignia del tablón
  color: string;             // insignia, eventos y agenda
  calendario?: boolean;      // trae eventos
  chat?: boolean;            // conversaciones por canal (el tablón las trata como chats)
  complete?: boolean;        // el sondeo trae TODO lo pendiente: lo leído en su web sale solo del tablón
  oauth?: string;            // se conecta iniciando sesión en el navegador («Conectar con …»)
  channels?: boolean;         // se eligen los canales a vigilar una vez conectada
  withoutNotices?: boolean;       // no trae avisos al tablón (solo paneles, como el tablero de Jira en Logística)
  disabled?: boolean;     // apagada en este refugio: sin conector, ni ficha en la cámara, ni avisos (el código sigue ahí)
}

export const INFO_SOURCE: Record<SourceId, InfoSource> = {
  outlook: { name: 'Microsoft 365 (Outlook)', short: 'Outlook', color: '#6f8fb0', calendario: true, complete: true, oauth: 'Microsoft', disabled: true },
  google: { name: 'Google (Gmail y Calendar)', short: 'Gmail', color: '#b0a05a', calendario: true, complete: true, oauth: 'Google' },
  mail: { name: 'Mail del Mac (Gmail sin Google Cloud)', short: 'Mail', color: '#8f86b0', complete: true },
  calendario: { name: 'Calendario del Mac', short: 'Calendario', color: '#b0707a', calendario: true, withoutNotices: true },
  discord: { name: 'Discord (bot)', short: 'Discord', color: '#b07a4a', chat: true, channels: true },
  slack: { name: 'Slack', short: 'Slack', color: '#a07088', chat: true, channels: true },
  github: { name: 'GitHub', short: 'GitHub', color: '#8a96a8', complete: true },
  linear: { name: 'Linear', short: 'Linear', color: '#7fae86', complete: true, disabled: true },
  jira: { name: 'Jira', short: 'Jira', color: '#5a8fd0', withoutNotices: true },
};
// Las que funcionan en este refugio (para volver a encender una, quítale `desactivada`)
export const ACTIVE_SOURCES = SOURCES.filter(f => !INFO_SOURCE[f].disabled);
export const active = (f: string) => (ACTIVE_SOURCES as readonly string[]).includes(f);
export const CALENDAR_SOURCES = ACTIVE_SOURCES.filter(f => INFO_SOURCE[f].calendario);
