// Cámara acorazada: integraciones (estado, pasos, campos, probar conexión, interruptor demo/real) y ajustes del
// refugio (nombre, raíz de repos, límite de sesiones, atuendo del Supervisor, reseteo). Los secretos van al llavero de macOS
// a través del servidor; aquí solo se escriben y nunca se muestran de vuelta.
import React, { useEffect, useRef, useState } from 'react';
import { juego } from './estadoJuego';
import { t, idioma, tIs } from '@shared/idioma';
import { vivo, cliente } from '../red/cliente';
import { SFX } from '../audio/sonido';
import { Device, Opciones, Keys, closePanel, useMenu, useKeys, type ItemMenu } from './aparato';
import { SHOP } from '@shared/catalogo';
import { GAME_NAME } from '@shared/protocolo';
import { isRoomOfRepo, PLANNING_ROOM, alphabeticalOrder } from '@shared/disposicion';
import { ACTIVE_SOURCES, INFO_SOURCE, type SourceId } from '@shared/fuentes';

export interface IntegrationField { id: string; etiqueta: string; secreto?: boolean; ayuda?: string; ejemplo?: string }
export interface IntegrationCard { id: SourceId; nombre: string; que: string; pasos: React.ReactNode[]; campos: IntegrationField[] }
const enlace = (url: string, texto = url.replace(/^https:\/\//, '')) => <a href={url} target="_blank" rel="noreferrer">{texto}</a>;

// Qué trae cada fuente y cómo conseguir lo que hay que pegar. Los campos los define el conector del servidor.
const GUIDES: Record<SourceId, { que: string; pasos: React.ReactNode[] }> = {
  outlook: {
    que: 'correo sin leer de los últimos 7 días y calendario de los próximos 14 (solo lectura)',
    pasos: [
      <>{t('panels.in')} {enlace('https://entra.microsoft.com')} {t('panels.applications')} <b>{t('panels.appRegistrations')}</b> → <b>{t('panels.newRegistration')}</b>. {t('panels.nameWorkShelterAccountTypes')}.</>,
      <>{t('panels.redirectPlatform')} <b>{t('panels.publicClientNativeMobileAnd')}</b> {t('panels.withTheUri')} <code>http://localhost</code>.</>,
      <>{t('panels.in')} <b>{t('panels.apiPermissions')}</b> {t('panels.microsoftGraphDelegatedPermissions')}: <code>Mail.Read</code>, <code>Calendars.Read</code>, <code>User.Read</code> {t('panels.and')} <code>offline_access</code>. {t('panels.noClientSecretIsNeeded')}.</>,
      <>{t('panels.copyThe')} <b>{t('panels.applicationClientId')}</b> ({t('panels.andIfTheAppIs')} <b>{t('panels.directoryId')}</b>), {t('panels.pasteItHereAnd')} <b>{t('windows.save')}</b>. {t('panels.then')}, <b>{t('panels.connectWithMicrosoft')}</b> {t('panels.andSignIn')}.</>,
      <>{t('panels.ifYourOrganizationRequiresAdmin')}.</>,
    ],
  },
  google: {
    que: 'correo sin leer de Gmail (7 días) y Google Calendar de los próximos 14 días (solo lectura)',
    pasos: [
      <>{t('panels.in')} {enlace('https://console.cloud.google.com')} {t('panels.createAProjectAndEnable')} <b>Gmail API</b> {t('panels.and')} <b>Google Calendar API</b> ({t('panels.apisServicesLibrary')}).</>,
      <>{t('panels.oauthConsentScreenType')} <b>{t('panels.external')}</b>, {t('panels.setTo')} <b>{t('panels.testing')}</b>, {t('panels.andAddYourselfUnder')} <b>{t('panels.testUsers')}</b>. ({t('panels.inTestingModeGoogleEnds')}.)</>,
      <>{t('panels.credentials')} <b>{t('panels.createCredentials')}</b> {t('panels.oauthClientIdType')} <b>{t('panels.desktopApp')}</b>.</>,
      <>{t('panels.pasteThe')} <b>{t('panels.clientId')}</b> {t('panels.andThe')} <b>{t('panels.clientSecret')}</b> {t('panels.and')} <b>{t('windows.save')}</b>. {t('panels.then')}, <b>{t('panels.connectWithGoogle')}</b> {t('panels.andAgreeToReadMail')}.</>,
    ],
  },
  mail: {
    que: 'correo sin leer de los últimos 7 días que ya tienes en Mail del Mac: Gmail sin crear nada en Google Cloud (solo lectura)',
    pasos: [
      <>{t('panels.in')} <b>{t('panels.systemSettingsInternetAccounts')}</b> {t('panels.addYourGoogleOrOther')} <b>Mail</b> {t('panels.turnedOnMacosHandlesThe')}.</>,
      <>{t('panels.open')} <b>Mail</b> {t('panels.andWaitForItTo')}.</>,
      <><b>{t('windows.save')}</b>: {t('panels.theFirstTimeMacosAsks')}.</>,
      <>{t('panels.clickingAGmailNoticeOpens')}.</>,
    ],
  },
  calendario: {
    que: 'eventos de hoy a 14 días de los calendarios que ya tienes en Calendario del Mac: Google, Exchange o iCloud sin crear nada (solo lectura)',
    pasos: [
      <>{t('panels.in')} <b>{t('panels.systemSettingsInternetAccounts')}</b> {t('panels.addYourAccountGoogleExchange')} <b>Calendarios</b> {t('panels.turnedOnMacosHandlesThe')}.</>,
      <>{t('panels.open')} <b>Calendario</b> {t('panels.andWaitForItTo')}.</>,
      <><b>{t('windows.save')}</b>: {t('panels.theFirstTimeMacosAsks2')}.</>,
      <>{t('panels.meetingsWithAMeetZoom')}.</>,
    ],
  },
  discord: {
    que: 'mensajes de los canales que elijas y tus menciones, con un bot oficial (solo lectura)',
    pasos: [
      <>{t('panels.in')} {enlace('https://discord.com/developers/applications', 'discord.com/developers')} → <b>New Application</b> → Bot → <b>Reset Token</b> {t('panels.andCopyItNeverUse')}.</>,
      <>{t('panels.underBotEnable')} <b>Message Content Intent</b> ({t('panels.otherwiseYouLlOnlySee')}).</>,
      <>{t('panels.oauth2UrlGeneratorScope')} <code>bot</code>, {t('panels.permissions')} <b>View Channels</b> {t('panels.and')} <b>Read Message History</b>. {t('panels.openTheUrlAndInvite')}.</>,
      <>{t('panels.pasteTheToken')}, <b>{t('windows.save')}</b> {t('panels.andOnceConnected')}, <b>{t('panels.chooseChannels')}</b>.</>,
    ],
  },
  slack: {
    que: 'mensajes nuevos de los canales que elijas, tus menciones y, con token de usuario, tus mensajes directos (solo lectura)',
    pasos: [
      <>{t('panels.in')} {enlace('https://api.slack.com/apps')} → <b>Create New App</b> {t('panels.fromScratchInYourWorkspace')}.</>,
      <>{t('panels.oauthPermissionsScopesWithA')} (<b>Bot Token Scopes</b>): <code>channels:read</code>, <code>channels:history</code>, <code>groups:read</code>, <code>groups:history</code>, <code>users:read</code>. {t('panels.withAUserToken')} (<b>User Token Scopes</b>), {t('panels.theSamePlus')} <code>im:read</code>, <code>im:history</code>, <code>mpim:read</code> {t('panels.and')} <code>mpim:history</code>.</>,
      <><b>Install to Workspace</b> {t('panels.andCopyThe')} <b>Bot User OAuth Token</b> {t('panels.xoxbOrThe')} <b>User OAuth Token</b> {t('panels.xoxpWithTheBotOne')} <code>/invite</code>.</>,
      <>{t('panels.pasteTheToken')}, <b>{t('windows.save')}</b> {t('panels.andOnceConnected')}, <b>{t('panels.chooseChannels')}</b>.</>,
    ],
  },
  github: {
    que: 'tus notificaciones sin leer: revisiones que te piden, menciones, asignaciones y CI (solo lectura)',
    pasos: [
      <>{t('panels.ifYouUseThe')} <code>gh</code> {t('panels.toolAndAreSignedIn')} (<code>gh auth login</code>), {t('panels.nothingMoreIsNeededLeave')} <b>{t('windows.save')}</b>.</>,
      <>{t('panels.ifNot')}: {enlace('https://github.com/settings/tokens', 'github.com/settings/tokens')} → <b>Generate new token (classic)</b> {t('panels.withThePermission')} <code>notifications</code>. {t('panels.fineGrainedTokensDonT')}.</>,
      <>{t('panels.pasteTheTokenAnd')} <b>{t('windows.save')}</b>.</>,
    ],
  },
  linear: {
    que: 'notificaciones e incidencias asignadas; el habitante de Planificación usa el MCP oficial de Linear para escribir',
    pasos: [
      <>{t('panels.inLinearSettingsAccountSecurity')} <b>Personal API keys</b> {t('panels.newKeyReadOnlyIs')}.</>,
      <>{t('panels.forThePlanningDwellerTo')}.</>,
    ],
  },
  jira: {
    que: 'tus tareas asignadas y su estado, para el tablero de Planificación, cruzadas con tus pull requests de GitHub (solo lectura)',
    pasos: [
      <>{t('panels.in')} {enlace('https://id.atlassian.com/manage-profile/security/api-tokens', 'id.atlassian.com → Seguridad → Tokens de API')} → <b>{t('panels.createApiToken')}</b> {t('panels.theRegularOneNoScopes')}.</>,
      <>{t('panels.pasteYourJiraSiteE')}. <code>empresa.atlassian.net</code>), {t('panels.yourAtlassianEmailAndThe')} <b>{t('windows.save')}</b>.</>,
      <>{t('panels.pullRequestsComeFromGithub')} <code>gh</code> {t('panels.isEnoughAPrGoes')} (<code>ABC-123</code>) {t('panels.appearsInItsBranchOr')}.</>,
    ],
  },
};
export const INTEGRATIONS: IntegrationCard[] = ACTIVE_SOURCES.map(id => ({ id, nombre: INFO_SOURCE[id].nombre, ...GUIDES[id], campos: [] }));

type View = { tipo: 'menu' } | { tipo: 'integracion'; id: string } | { tipo: 'slackRemote' } | { tipo: 'refugio' } | { tipo: 'salas' } | { tipo: 'supervisor' } | { tipo: 'reset' };

export function PanelCamera() {
  const [vista, setView] = useState<View>({ tipo: 'menu' });
  if (vista.tipo === 'integracion') return <IntegrationView ficha={INTEGRATIONS.find(f => f.id === vista.id)!} volver={() => setView({ tipo: 'menu' })} />;
  if (vista.tipo === 'slackRemote') return <SlackRemoteView volver={() => setView({ tipo: 'menu' })} />;
  if (vista.tipo === 'refugio') return <ShelterView volver={() => setView({ tipo: 'menu' })} />;
  if (vista.tipo === 'salas') return <RoomsView volver={() => setView({ tipo: 'menu' })} />;
  if (vista.tipo === 'supervisor') return <ViewSupervisor volver={() => setView({ tipo: 'menu' })} />;
  if (vista.tipo === 'reset') return <ViewReset volver={() => setView({ tipo: 'menu' })} />;
  return <MenuCamera ir={setView} />;
}

const TXT_STATE: Record<string, string> = { demo: 'DEMO', conectada: 'conectada', error: 'error', 'sin-configurar': 'sin configurar' };
function MenuCamera({ ir }: { ir: (v: View) => void }) {
  const ints = vivo.usar(e => e.integraciones);
  const hidden = vivo.usar(e => e.estado?.ocultas?.length ?? 0);
  // el mando a distancia de Slack no es una fuente de avisos (no lee nada): tiene su propio estado
  const [sk, setSk] = useState<SlackRemoteState | null>(null);
  useEffect(() => { cliente.accion<SlackRemoteState>('slackRemote.estado').then(setSk).catch(() => {}); }, []);
  const skPiloto = sk?.emparejado ? 'conectada' : sk?.conectado ? 'demo' : 'sin-configurar';
  const items: (ItemMenu & { f: () => void })[] = [
    ...INTEGRATIONS.map(f => { const st = ints[f.id]; return { texto: <><span className={'piloto-mini ' + (st?.estado ?? 'demo')} /> {f.nombre}</>, pista: t(TXT_STATE[st?.estado ?? 'demo']) + (st?.detalle && st.estado === 'error' ? ' — ' + st.detalle : ''), f: () => ir({ tipo: 'integracion', id: f.id }) }; }),
    { texto: <><span className={'piloto-mini ' + skPiloto} /> {t('panels.slackRemoteMenu')}</>, pista: sk?.emparejado ? t('panels.slackRemoteVaultPaired') : sk?.conectado ? t('panels.slackRemoteVaultNotPaired') : t('panels.slackRemoteVaultHint'), f: () => ir({ tipo: 'slackRemote' }) },
    { texto: t('panels.theShelterNameReposRoot'), f: () => ir({ tipo: 'refugio' }) },
    { texto: t('panels.shelterRooms'), pista: hidden ? t('panels.shelterRoomsHint', { n: hidden }) : undefined, f: () => ir({ tipo: 'salas' }) },
    { texto: t('panels.overseerSOutfit'), f: () => ir({ tipo: 'supervisor' }) },
    { texto: t('panels.optionsSoundAndDictationLanguage'), pista: 'Esc', f: () => juego.set({ panel: 'opciones' }) },
    { texto: t('menu.keyboardShortcuts'), pista: 'F1', f: () => juego.set({ panel: 'ayuda' }) },
    { texto: t('panels.resetTheShelter'), peligro: true, f: () => ir({ tipo: 'reset' }) },
  ];
  const [i, setI] = useMenu(items.length, k => items[k].f());
  return (
    <Device rotulo={t('panels.vault')} ancho={54}>
      <p className="voz">{t('panels.keysCredentialsAndSettingsHanzo')}</p>
      <Opciones items={items} i={i} setI={setI} onChoose={k => items[k].f()} />
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('windows.open')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

function IntegrationView({ ficha: base, volver }: { ficha: IntegrationCard; volver: () => void }) {
  // los campos los define el conector del servidor (nombre, etiqueta, secreto, ayuda); los pasos son de la cámara
  const [def, setDef] = useState<{ campos: IntegrationField[]; valores: Record<string, string>; guardados: string[] } | null>(null);
  useEffect(() => { cliente.accion<any>('integracion.campos', { fuente: base.id }).then(r => setDef({ campos: r.campos.map((c: any) => ({ id: c.nombre, etiqueta: c.etiqueta + (c.opcional ? t('panels.optional') : ''), secreto: c.secreto, ayuda: c.ayuda, ejemplo: c.ejemplo })), valores: r.valores ?? {}, guardados: r.guardados ?? [] })).catch(() => {}); }, []);
  if (!def) return <Device rotulo={t('panels.vaultNombre', { nombre: base.nombre.toUpperCase() })} ancho={62} onClose={volver}><p className="tenue">{t('panels.readingTheConfiguration')}</p></Device>;
  return <FormIntegration key="f" ficha={{ ...base, campos: def.campos.length || !base.campos.length ? def.campos : base.campos }} valuesIni={def.valores} savedIni={def.guardados} volver={volver} />;
}

function FormIntegration({ ficha, valuesIni, savedIni, volver }: { ficha: IntegrationCard; valuesIni: Record<string, string>; savedIni: string[]; volver: () => void }) {
  const st = vivo.usar(e => e.integraciones[ficha.id]);
  const guardados: Record<string, string> = { ...valuesIni, ...(st?.campos ?? {}), ...Object.fromEntries(savedIni.map(g => [g, '1'])) };
  const [valores, setValues] = useState<Record<string, string>>(() => Object.fromEntries(ficha.campos.map(c => [c.id, c.secreto ? '' : guardados[c.id] ?? ''])));
  const [foco, setFocus] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ocupado, setBusy] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const real = st?.modo === 'real';
  const oauth = INFO_SOURCE[ficha.id].oauth;
  const acciones = [
    ...(ficha.campos.length ? [{ id: 'probar', texto: t('panels.testConnection') }, { id: 'guardar', texto: t('windows.save') }] : []),
    ...(oauth ? [{ id: 'conectar', texto: st?.estado === 'conectada' ? t('panels.switchAccount') : t('panels.connectWithOauth', { oauth: oauth ?? '' }) }, ...(st?.estado === 'conectada' ? [{ id: 'desconectar', texto: t('panels.signOut') }] : [])] : []),
    ...(INFO_SOURCE[ficha.id].canales && st?.estado === 'conectada' ? [{ id: 'canales', texto: t('panels.chooseChannels') }] : []),
    { id: 'modo', texto: real ? t('panels.switchToDemo') : t('panels.useRealData') },
    // apagada (como empieza un refugio nuevo): también se puede probar con datos DEMO
    ...(st?.modo === 'off' ? [{ id: 'demo', texto: t('panels.switchToDemo') }] : []),
  ];
  const [canales, setChannels] = useState<{ id: string | number; nombre: string; servidor?: string; elegido: boolean }[] | null>(null);
  const n = ficha.campos.length + acciones.length;
  const sentFields = () => Object.fromEntries(Object.entries(valores).filter(([, v]) => v.trim() !== ''));
  const hacer = async (id: string) => {
    setBusy(true); setMsg(null);
    try {
      if (id === 'probar') { const r: any = await cliente.accion('integracion.probar', { fuente: ficha.id, campos: sentFields() }); setMsg({ ok: r.ok, texto: r.detalle }); r.ok ? SFX.shortSuccess() : SFX.error(); }
      else if (id === 'guardar') { const r: any = await cliente.accion('integracion.guardar', { fuente: ficha.id, campos: sentFields() }); setMsg({ ok: r.ok, texto: r.detalle }); r.ok ? SFX.shortSuccess() : SFX.error(); if (r.ok) setValues(v => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ficha.campos.find(c => c.id === k)?.secreto ? '' : x]))); }
      else if (id === 'conectar') { await cliente.accion('integracion.conectar', { fuente: ficha.id }); setMsg({ ok: true, texto: t('panels.oauthHasBeenOpenedIn', { oauth: oauth ?? '' }) }); }
      else if (id === 'desconectar') { await cliente.accion('integracion.desconectar', { fuente: ficha.id }); setMsg({ ok: true, texto: t('panels.signedOut') }); }
      else if (id === 'modo') { await cliente.accion('integracion.modo', { fuente: ficha.id, modo: real ? 'demo' : 'real' }); SFX.conmutar(); }
      else if (id === 'demo') { await cliente.accion('integracion.modo', { fuente: ficha.id, modo: 'demo' }); SFX.conmutar(); }
      else if (id === 'canales') { setChannels(await cliente.accion<any[]>('integracion.canales', { fuente: ficha.id })); }
    } catch (e) { setMsg({ ok: false, texto: (e as Error).message }); SFX.error(); }
    setBusy(false);
  };
  useEffect(() => { if (foco < ficha.campos.length) refs.current[foco]?.focus(); else (document.activeElement as HTMLElement)?.blur?.(); }, [foco]);
  useKeys(e => {
    if (e.code === 'Escape') { volver(); return; }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { setFocus(f => (f + 1) % n); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setFocus(f => (f - 1 + n) % n); SFX.tick(); }
    else if ((e.code === 'Enter' || e.code === 'KeyE' || e.code === 'Space') && foco >= ficha.campos.length) { SFX.clic(); hacer(acciones[foco - ficha.campos.length].id); }
  }, [foco, valores, real]);
  const fieldKey = (e: React.KeyboardEvent, k: number) => {
    if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); setFocus((k + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus((k - 1 + n) % n); }
    else if (e.key === 'Escape') { e.preventDefault(); volver(); }
  };
  return (
    <Device rotulo={t('panels.vaultNombre', { nombre: ficha.nombre.toUpperCase() })} ancho={62} alto onClose={volver} piloto={st?.estado === 'conectada' ? 'trabajando' : st?.estado === 'error' ? 'error' : 'esperando'}>
      <div className="lista-desplazable">
        <p><b>{t('panels.status')}</b> {t(TXT_STATE[st?.estado ?? 'demo'])}{st?.detalle ? <span className="tenue"> — {st.detalle}</span> : null}{st?.ultima ? <span className="tenue"> · {t('panels.lastRead')} {new Date(st.ultima).toLocaleTimeString(idioma() === 'en' ? 'en-GB' : 'es-ES', { hour: '2-digit', minute: '2-digit' })}</span> : null}</p>
        <p className="tenue">{t('panels.whatItBringsToThe')} {tIs(ficha.que)}.</p>
        <h3>{t('panels.stepByStep')}</h3>
        <ol className="pasos">{ficha.pasos.map((p, k) => <li key={k}>{p}</li>)}</ol>
        {ficha.campos.length > 0 && <h3>{t('panels.details')}</h3>}
        {ficha.campos.map((c, k) => (
          <label key={c.id} className={'campo-taller' + (foco === k ? ' activa' : '')} onClick={() => setFocus(k)}>
            <span className="etq">{c.etiqueta}{c.secreto && <small> · {t('panels.toTheKeychain')}</small>}</span>
            <input ref={el => { refs.current[k] = el; }} type={c.secreto ? 'password' : 'text'} value={valores[c.id] ?? ''} placeholder={c.secreto ? (guardados[c.id] ? t('panels.savedTypeToChangeIt') : '') : c.ejemplo ?? ''} spellCheck={false} autoComplete="off"
              onFocus={() => setFocus(k)} onChange={e => setValues(v => ({ ...v, [c.id]: e.target.value }))} onKeyDown={e => fieldKey(e, k)} />
            {c.ayuda && <small className="tenue">{c.ayuda}</small>}
          </label>
        ))}
        <div className="botonera">{acciones.map((a, k) => <button key={a.id} className={'boton-taller' + (foco === ficha.campos.length + k ? ' activa' : '')} disabled={ocupado} onMouseEnter={() => setFocus(ficha.campos.length + k)} onClick={() => hacer(a.id)}>{a.texto}</button>)}</div>
        {msg && <p className={msg.ok ? '' : 'aviso-consola'}>{msg.ok ? '✓ ' : '✗ '}{msg.texto}</p>}
        {canales && <div className="selector-canales">
          <h3>{t('panels.channelsBeingWatched')}</h3>
          {canales.map((c, k) => <label key={String(c.id)} className="chip-canal"><input type="checkbox" checked={c.elegido} onChange={e => setChannels(cs => cs!.map((x, j) => (j === k ? { ...x, elegido: e.target.checked } : x)))} /> {c.servidor ? <span className="tenue">{c.servidor} · </span> : null}#{c.nombre}</label>)}
          <div className="botonera"><button className="boton-taller" onClick={async () => { const ids = canales.filter(c => c.elegido).map(c => String(c.id)).join(','); const r: any = await cliente.accion('integracion.guardar', { fuente: ficha.id, campos: { canales: ids } }); setMsg({ ok: r.ok, texto: r.ok ? t('panels.channelsSaved') : r.detalle }); setChannels(null); }}>{t('panels.saveChannels')}</button><button className="boton-taller" onClick={() => setChannels(null)}>{t('windows.cancel')}</button></div>
        </div>}
      </div>
      <Keys><kbd>↑↓</kbd>{t('panels.move')} <kbd>Enter</kbd>{t('panels.nextPress')} <kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}

function ShelterView({ volver }: { volver: () => void }) {
  const e = vivo.usar(x => x.estado);
  const [v, setV] = useState({ nombre: e?.nombre || GAME_NAME, raizRepos: e?.raizRepos ?? '~', limiteSesiones: String(e?.limiteSesiones ?? 6) });
  const [msg, setMsg] = useState('');
  const [foco, setFocus] = useState(0);
  const campos: [keyof typeof v, string][] = [['nombre', t('panels.shelterName')], ['raizRepos', t('panels.reposRootDoorSuggestionsAnd')], ['limiteSesiones', t('panels.simultaneousSessionLimit')]];
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => { refs.current[foco]?.focus(); }, [foco]);
  const guardar = async () => {
    const lim = Math.max(1, Math.min(20, parseInt(v.limiteSesiones) || 6));
    try { await cliente.accion('guardar', { parche: { nombre: v.nombre.trim() || GAME_NAME, raizRepos: v.raizRepos.trim() || '~', limiteSesiones: lim } }); SFX.shortSuccess(); setMsg(t('panels.saved')); } catch (err) { setMsg((err as Error).message); }
  };
  useKeys(ev => { if (ev.code === 'Escape') volver(); });
  return (
    <Device rotulo={t('panels.vaultWorkShelter')} ancho={50} onClose={volver}>
      {campos.map(([k, etq], i) => (
        <label key={k} className={'campo-taller' + (foco === i ? ' activa' : '')}>
          <span className="etq">{etq}</span>
          <input ref={el => { refs.current[i] = el; }} value={v[k]} spellCheck={false} onFocus={() => setFocus(i)} onChange={ev => setV(x => ({ ...x, [k]: ev.target.value }))}
            onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); if (i === campos.length - 1) guardar(); else setFocus(i + 1); } else if (ev.key === 'ArrowDown' || ev.key === 'Tab') { ev.preventDefault(); setFocus((i + 1) % campos.length); } else if (ev.key === 'ArrowUp') { ev.preventDefault(); setFocus((i - 1 + campos.length) % campos.length); } else if (ev.key === 'Escape') { ev.preventDefault(); volver(); } }} />
        </label>
      ))}
      <div className="botonera"><button className="boton-taller" onClick={guardar}>{t('windows.save')}</button></div>
      {msg && <p className="aviso-consola">{msg}</p>}
      <Keys><kbd>Enter</kbd>{t('panels.nextOnTheLastOne')} <kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}

// Qué repos tienen sala: las de repo a la vista y las ocultas (state.ocultas), en orden alfabético; Enter cambia una
function RoomsView({ volver }: { volver: () => void }) {
  const salas = vivo.usar(e => e.estado?.salas ?? []);
  const ocultas = vivo.usar(e => e.estado?.ocultas ?? []);
  const [msg, setMsg] = useState('');
  const lista: { id: string; nombre: string; ruta?: string; oculta: boolean }[] = [
    ...salas.filter((s: any) => isRoomOfRepo(s.tipo) && s.id !== PLANNING_ROOM).map((s: any) => ({ id: s.id, nombre: s.nombre, ruta: s.ruta, oculta: false })),
    ...ocultas.map((o: any) => ({ id: o.sala.id, nombre: o.sala.nombre, ruta: o.sala.ruta, oculta: true })),
  ].sort(alphabeticalOrder);
  const cambiar = async (k: number) => {
    const s = lista[k]; if (!s) return;
    try { await cliente.accion(s.oculta ? 'sala.mostrar' : 'sala.ocultar', { salaId: s.id }); SFX.conmutar(); setMsg(''); } catch (err) { SFX.noAllowed(); setMsg((err as Error).message); }
  };
  const items: ItemMenu[] = lista.map(s => ({ texto: <>{s.oculta ? '☐' : '☑'} {s.nombre}</>, pista: s.ruta }));
  const [i, setI] = useMenu(items.length, cambiar, undefined, volver);
  return (
    <Device rotulo={t('panels.vaultRooms')} ancho={54} onClose={volver}>
      <p className="tenue">{t('panels.vaultRoomsIntro')}</p>
      {lista.length ? <Opciones items={items} i={i} setI={setI} onChoose={cambiar} /> : <p className="tenue">{t('panels.vaultRoomsNone')}</p>}
      {msg && <p className="aviso-consola">{msg}</p>}
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.toggle')} <kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}

function ViewSupervisor({ volver }: { volver: () => void }) {
  const sup = vivo.usar(e => e.estado?.supervisor ?? { personaje: 'Protagonist_B', accesorios: [] });
  const jugador = vivo.usar(e => e.estado?.jugador);
  const outfits: string[] = jugador?.outfit ?? [];
  const items: (ItemMenu & { f: () => void })[] = [
    // el aspecto entero (humano o robot, cara, pelo, ropa, colores) se cambia en el probador de Chapa y Pintura
    { texto: <>{t('panels.changeLookIn')} <b>{t('world.bodyShop')}</b></>, pista: t('panels.pFromAnywhere'), f: () => juego.set({ panel: 'chapa', panelData: { quien: 'supervisor' } }) },
    ...outfits.filter(a => SHOP.some(x => x.id === a && x.tipo === 'accesorio')).map(a => ({ texto: <>{sup.accesorios?.includes(a) ? '☑' : '☐'} {tIs(SHOP.find(x => x.id === a)?.nombre ?? a)}</>, pista: t('panels.shopAccessory'), f: () => cliente.accion('juego.equipar', { article: a, quien: 'supervisor' }).then(() => SFX.conmutar()).catch(() => SFX.noAllowed()) })),
  ];
  const [i, setI] = useMenu(items.length, k => items[k].f(), undefined, volver);
  return (
    <Device rotulo={t('panels.vaultOverseerSOutfit')} ancho={44} onClose={volver}>
      <Opciones items={items} i={i} setI={setI} onChoose={k => items[k].f()} />
      {!outfits.length && <p className="tenue">{t('panels.accessoriesAreBoughtWithScrap')}</p>}
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.putItOn')} <kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}

function ViewReset({ volver }: { volver: () => void }) {
  const [paso, setStep] = useState(0);
  const items: ItemMenu[] = [{ texto: t('panels.noGoBack') }, { texto: paso ? t('panels.yesReallyWipeTheShelter') : t('panels.resetTheShelter2'), peligro: true }];
  const elegir = async (k: number) => {
    if (k === 0) return volver();
    if (!paso) { setStep(1); return; }
    await cliente.accion('reiniciarRefugio'); SFX.apagado(); setTimeout(() => location.reload(), 600);
  };
  const [i, setI] = useMenu(2, elegir, undefined, volver);
  return (
    <Device rotulo={t('panels.vaultReset')} ancho={44} piloto="error" onClose={volver}>
      <p className="aviso-consola">{t('panels.allSessionsAreStoppedAnd')}</p>
      <p className="tenue">{t('panels.noFolderOrRepoIs')}</p>
      <Opciones items={items} i={i} setI={setI} onChoose={elegir} />
    </Device>
  );
}

// ---------------------------------------------------------------- Slack, mando a distancia (server/slackMando.ts)
// Una app de Slack propia, creada desde este manifiesto (Socket Mode: sin URL pública): las peticiones de aprobación,
// para responderlas desde el móvil sin salir del refugio, y la lista de conversaciones para pasarlas a Remote Control.
// Solo lo justo: escribir y leer su propio mensaje directo; nada de canales
const MANIFIESTO_SLACK = JSON.stringify({
  display_information: { name: 'Refugio', description: 'Mando a distancia del refugio' },
  features: { bot_user: { display_name: 'Refugio', always_online: false }, app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false } },
  oauth_config: { scopes: { bot: ['chat:write', 'im:history'] } },
  settings: { event_subscriptions: { bot_events: ['message.im'] }, interactivity: { is_enabled: true }, org_deploy_enabled: false, socket_mode_enabled: true, token_rotation_enabled: false },
}, null, 2);
export interface SlackRemoteState { conectado: boolean; team?: string; bot?: string; emparejado: boolean; codigo?: string; aprobar: boolean }
function SlackRemoteView({ volver }: { volver: () => void }) {
  const [st, setSt] = useState<SlackRemoteState | null>(null);
  const [app, setApp] = useState('');
  const [bot, setBot] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const pedir = (accion: string, d?: Record<string, unknown>) => {
    setOcupado(true); setMsg(null);
    return cliente.accion(accion, d).then((r: any) => { setSt(r); SFX.tick(); return r; }).catch((e: Error) => { setMsg({ ok: false, texto: e.message }); SFX.noAllowed(); }).finally(() => setOcupado(false));
  };
  // mientras se espera el emparejado, se mira cada pocos segundos si ya ha llegado el código por mensaje directo
  useEffect(() => {
    cliente.accion('slackRemote.estado').then((r: any) => setSt(r)).catch(() => {});
    const id = setInterval(() => cliente.accion('slackRemote.estado').then((r: any) => setSt(r)).catch(() => {}), 3000);
    return () => clearInterval(id);
  }, []);
  const listos = !!app.trim() && !!bot.trim();
  const conectar = () => { if (listos) pedir('slackRemote.conectar', { appToken: app, botToken: bot }).then(r => { if (r) { setApp(''); setBot(''); } }); };
  const copiar = () => navigator.clipboard.writeText(MANIFIESTO_SLACK).then(() => { setMsg({ ok: true, texto: t('panels.slackRemoteManifestCopied') }); SFX.tick(); }).catch(() => {});
  return (
    <Device rotulo={t('panels.vaultNombre', { nombre: 'SLACK' })} ancho={62} onClose={volver} piloto={st?.emparejado ? 'trabajando' : st?.conectado ? 'esperando' : 'ociosa'}>
      <p className="voz">{t('panels.slackRemoteIntro')}</p>
      <p className="tenue">{t('panels.slackRemotePrivacy')}</p>
      {st && !st.conectado && <>
        <ol className="pasos">
          <li>{t('panels.slackRemoteStep1')} <button className="boton-taller" onClick={copiar}>{t('panels.slackRemoteCopyManifest')}</button></li>
          <li>{t('panels.slackRemoteStep2')}</li>
          <li>{t('panels.slackRemoteStep3')}</li>
        </ol>
        <label className="campo-taller activa">
          <span className="etq">{t('panels.slackRemoteAppToken')}<small> · {t('panels.toTheKeychain')}</small></span>
          <input type="password" value={app} spellCheck={false} autoComplete="off" autoFocus placeholder="xapp-…" onChange={e => setApp(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') conectar(); }} />
        </label>
        <label className="campo-taller activa">
          <span className="etq">{t('panels.slackRemoteBotToken')}<small> · {t('panels.toTheKeychain')}</small></span>
          <input type="password" value={bot} spellCheck={false} autoComplete="off" placeholder="xoxb-…" onChange={e => setBot(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') conectar(); }} />
        </label>
        <div className="botonera"><button className="boton-taller" disabled={ocupado || !listos} onClick={conectar}>{t('panels.slackRemoteConnect')}</button></div>
      </>}
      {st?.conectado && <>
        <p><b>{t('panels.status')}</b> {st.emparejado ? t('panels.slackRemotePairedWith', { bot: '@' + st.bot, team: st.team ?? '' }) : t('panels.slackRemoteWaitingPairing', { bot: '@' + st.bot, team: st.team ?? '' })}</p>
        {!st.emparejado && (st.codigo
          ? <p>{t('panels.slackRemoteSendCode', { bot: '@' + st.bot })} <b className="codigo-emparejar">{st.codigo}</b></p>
          : <p className="aviso-consola">{t('panels.slackRemoteCodeExpired')}</p>)}
        <div className="botonera">
          {st.emparejado && <button className="boton-taller" disabled={ocupado} onClick={() => pedir('slackRemote.aprobar', { si: !st.aprobar })}>{st.aprobar ? t('panels.slackRemoteApprovalsOn') : t('panels.slackRemoteApprovalsOff')}</button>}
          <button className="boton-taller" disabled={ocupado} onClick={() => pedir('slackRemote.emparejar')}>{st.emparejado ? t('panels.slackRemotePairAgain') : t('panels.slackRemoteNewCode')}</button>
          <button className="boton-taller" disabled={ocupado} onClick={() => pedir('slackRemote.desconectar')}>{t('panels.slackRemoteDisconnect')}</button>
        </div>
      </>}
      {msg && <p className={msg.ok ? '' : 'aviso-consola'}>{msg.texto}</p>}
      <Keys><kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}
