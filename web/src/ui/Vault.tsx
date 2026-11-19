// Cámara acorazada: integraciones (estado, pasos, campos, probar conexión, interruptor demo/real) y ajustes del
// refugio (nombre, raíz de repos, límite de sesiones, atuendo del Supervisor, reseteo). Los secretos van al llavero de macOS
// a través del servidor; aquí solo se escriben y nunca se muestran de vuelta.
import React, { useEffect, useRef, useState } from 'react';
import { juego } from './gameState';
import { t, language, tIs } from '@shared/language';
import { live, client } from '../net/client';
import { SFX } from '../audio/sound';
import { Device, Options, Keys, closePanel, useMenu, useKeys, type ItemMenu } from './device';
import { SHOP } from '@shared/catalog';
import { INTEGRATION_STATE_SHORT } from '@shared/labels';
import { GAME_NAME } from '@shared/protocol';
import { isRoomOfRepo, PLANNING_ROOM, alphabeticalOrder } from '@shared/layout';
import { ACTIVE_SOURCES, INFO_SOURCE, type SourceId } from '@shared/sources';

export interface IntegrationField { id: string; label: string; secret?: boolean; help?: string; example?: string }
export interface IntegrationCard { id: SourceId; name: string; what: string; steps: React.ReactNode[]; fields: IntegrationField[] }
const link = (url: string, text = url.replace(/^https:\/\//, '')) => <a href={url} target="_blank" rel="noreferrer">{text}</a>;

// Qué trae cada fuente y cómo conseguir lo que hay que pegar. Los campos los define el conector del servidor.
const GUIDES: Record<SourceId, { what: string; steps: React.ReactNode[] }> = {
  outlook: {
    what: 'correo sin leer de los últimos 7 días y calendario de los próximos 14 (solo lectura)',
    steps: [
      <>{t('panels.in')} {link('https://entra.microsoft.com')} {t('panels.applications')} <b>{t('panels.appRegistrations')}</b> → <b>{t('panels.newRegistration')}</b>. {t('panels.nameWorkShelterAccountTypes')}.</>,
      <>{t('panels.redirectPlatform')} <b>{t('panels.publicClientNativeMobileAnd')}</b> {t('panels.withTheUri')} <code>http://localhost</code>.</>,
      <>{t('panels.in')} <b>{t('panels.apiPermissions')}</b> {t('panels.microsoftGraphDelegatedPermissions')}: <code>Mail.Read</code>, <code>Calendars.Read</code>, <code>User.Read</code> {t('panels.and')} <code>offline_access</code>. {t('panels.noClientSecretIsNeeded')}.</>,
      <>{t('panels.copyThe')} <b>{t('panels.applicationClientId')}</b> ({t('panels.andIfTheAppIs')} <b>{t('panels.directoryId')}</b>), {t('panels.pasteItHereAnd')} <b>{t('windows.save')}</b>. {t('panels.then')}, <b>{t('panels.connectWithMicrosoft')}</b> {t('panels.andSignIn')}.</>,
      <>{t('panels.ifYourOrganizationRequiresAdmin')}.</>,
    ],
  },
  google: {
    what: 'correo sin leer de Gmail (7 días) y Google Calendar de los próximos 14 días (solo lectura)',
    steps: [
      <>{t('panels.ifYouUseThe')} <code>gws</code> {t('panels.toolAndAreSignedIn')} (<code>gws auth login</code>, {t('panels.withGmailAndCalendar')}), {t('panels.nothingMoreIsNeededLeaveFields')} <b>{t('windows.save')}</b>.</>,
      <>{t('panels.ifNot')}: {t('panels.in').toLowerCase()} {link('https://console.cloud.google.com')} {t('panels.createAProjectAndEnable')} <b>Gmail API</b> {t('panels.and')} <b>Google Calendar API</b> ({t('panels.apisServicesLibrary')}).</>,
      <>{t('panels.oauthConsentScreenType')} <b>{t('panels.external')}</b>, {t('panels.setTo')} <b>{t('panels.testing')}</b>, {t('panels.andAddYourselfUnder')} <b>{t('panels.testUsers')}</b>. ({t('panels.inTestingModeGoogleEnds')}.)</>,
      <>{t('panels.credentials')} <b>{t('panels.createCredentials')}</b> {t('panels.oauthClientIdType')} <b>{t('panels.desktopApp')}</b>.</>,
      <>{t('panels.pasteThe')} <b>{t('panels.clientId')}</b> {t('panels.andThe')} <b>{t('panels.clientSecret')}</b> {t('panels.and')} <b>{t('windows.save')}</b>. {t('panels.then')}, <b>{t('panels.connectWithGoogle')}</b> {t('panels.andAgreeToReadMail')}.</>,
    ],
  },
  mail: {
    what: 'correo sin leer de los últimos 7 días que ya tienes en Mail del Mac: Gmail sin crear nada en Google Cloud (solo lectura)',
    steps: [
      <>{t('panels.in')} <b>{t('panels.systemSettingsInternetAccounts')}</b> {t('panels.addYourGoogleOrOther')} <b>Mail</b> {t('panels.turnedOnMacosHandlesThe')}.</>,
      <>{t('panels.open')} <b>Mail</b> {t('panels.andWaitForItTo')}.</>,
      <><b>{t('windows.save')}</b>: {t('panels.theFirstTimeMacosAsks')}.</>,
      <>{t('panels.clickingAGmailNoticeOpens')}.</>,
    ],
  },
  calendario: {
    what: 'eventos de hoy a 14 días de los calendarios que ya tienes en Calendario del Mac: Google, Exchange o iCloud sin crear nada (solo lectura)',
    steps: [
      <>{t('panels.in')} <b>{t('panels.systemSettingsInternetAccounts')}</b> {t('panels.addYourAccountGoogleExchange')} <b>{t('integrations.macCalendarsToggle')}</b> {t('panels.turnedOnMacosHandlesThe')}.</>,
      <>{t('panels.open')} <b>{t('integrations.macCalendarApp')}</b> {t('panels.andWaitForItTo')}.</>,
      <><b>{t('windows.save')}</b>: {t('panels.theFirstTimeMacosAsks2')}.</>,
      <>{t('panels.meetingsWithAMeetZoom')}.</>,
    ],
  },
  discord: {
    what: 'mensajes de los canales que elijas y tus menciones, con un bot oficial (solo lectura)',
    steps: [
      <>{t('panels.in')} {link('https://discord.com/developers/applications', 'discord.com/developers')} → <b>New Application</b> → Bot → <b>Reset Token</b> {t('panels.andCopyItNeverUse')}.</>,
      <>{t('panels.underBotEnable')} <b>Message Content Intent</b> ({t('panels.otherwiseYouLlOnlySee')}).</>,
      <>{t('panels.oauth2UrlGeneratorScope')} <code>bot</code>, {t('panels.permissions')} <b>View Channels</b> {t('panels.and')} <b>Read Message History</b>. {t('panels.openTheUrlAndInvite')}.</>,
      <>{t('panels.pasteTheToken')}, <b>{t('windows.save')}</b> {t('panels.andOnceConnected')}, <b>{t('panels.chooseChannels')}</b>.</>,
    ],
  },
  slack: {
    what: 'mensajes nuevos de los canales que elijas, tus menciones y, con token de usuario, tus mensajes directos (solo lectura)',
    steps: [
      <>{t('panels.in')} {link('https://api.slack.com/apps')} → <b>Create New App</b> {t('panels.fromScratchInYourWorkspace')}.</>,
      <>{t('panels.oauthPermissionsScopesWithA')} (<b>Bot Token Scopes</b>): <code>channels:read</code>, <code>channels:history</code>, <code>groups:read</code>, <code>groups:history</code>, <code>users:read</code>. {t('panels.withAUserToken')} (<b>User Token Scopes</b>), {t('panels.theSamePlus')} <code>im:read</code>, <code>im:history</code>, <code>mpim:read</code> {t('panels.and')} <code>mpim:history</code>.</>,
      <><b>Install to Workspace</b> {t('panels.andCopyThe')} <b>Bot User OAuth Token</b> {t('panels.xoxbOrThe')} <b>User OAuth Token</b> {t('panels.xoxpWithTheBotOne')} <code>/invite</code>.</>,
      <>{t('panels.pasteTheToken')}, <b>{t('windows.save')}</b> {t('panels.andOnceConnected')}, <b>{t('panels.chooseChannels')}</b>.</>,
    ],
  },
  github: {
    what: 'tus notificaciones sin leer: revisiones que te piden, menciones, asignaciones y CI (solo lectura)',
    steps: [
      <>{t('panels.ifYouUseThe')} <code>gh</code> {t('panels.toolAndAreSignedIn')} (<code>gh auth login</code>), {t('panels.nothingMoreIsNeededLeave')} <b>{t('windows.save')}</b>.</>,
      <>{t('panels.ifNot')}: {link('https://github.com/settings/tokens', 'github.com/settings/tokens')} → <b>Generate new token (classic)</b> {t('panels.withThePermission')} <code>notifications</code>. {t('panels.fineGrainedTokensDonT')}.</>,
      <>{t('panels.pasteTheTokenAnd')} <b>{t('windows.save')}</b>.</>,
    ],
  },
  linear: {
    what: 'notificaciones e incidencias asignadas; el habitante de Planificación usa el MCP oficial de Linear para escribir',
    steps: [
      <>{t('panels.inLinearSettingsAccountSecurity')} <b>Personal API keys</b> {t('panels.newKeyReadOnlyIs')}.</>,
      <>{t('panels.forThePlanningDwellerTo')}.</>,
    ],
  },
  jira: {
    what: 'tus tareas asignadas y su estado, para el tablero de Planificación, cruzadas con tus pull requests de GitHub (solo lectura)',
    steps: [
      <>{t('panels.in')} {link('https://id.atlassian.com/manage-profile/security/api-tokens', t('windows.atlassianSecurityTokens'))} → <b>{t('panels.createApiToken')}</b> {t('panels.theRegularOneNoScopes')}.</>,
      <>{t('panels.pasteYourJiraSiteE')}. <code>empresa.atlassian.net</code>), {t('panels.yourAtlassianEmailAndThe')} <b>{t('windows.save')}</b>.</>,
      <>{t('panels.pullRequestsComeFromGithub')} <code>gh</code> {t('panels.isEnoughAPrGoes')} (<code>ABC-123</code>) {t('panels.appearsInItsBranchOr')}.</>,
    ],
  },
};
export const INTEGRATIONS: IntegrationCard[] = ACTIVE_SOURCES.map(id => ({ id, name: tIs(INFO_SOURCE[id].name), ...GUIDES[id], fields: [] }));

type View = { type: 'menu' } | { type: 'integracion'; id: string } | { type: 'slackRemote' } | { type: 'refugio' } | { type: 'salas' } | { type: 'supervisor' } | { type: 'reset' };

export function PanelCamera() {
  const [view, setView] = useState<View>({ type: 'menu' });
  if (view.type === 'integracion') return <IntegrationView card={INTEGRATIONS.find(f => f.id === view.id)!} goBack={() => setView({ type: 'menu' })} />;
  if (view.type === 'slackRemote') return <SlackRemoteView goBack={() => setView({ type: 'menu' })} />;
  if (view.type === 'refugio') return <ShelterView goBack={() => setView({ type: 'menu' })} />;
  if (view.type === 'salas') return <RoomsView goBack={() => setView({ type: 'menu' })} />;
  if (view.type === 'supervisor') return <ViewSupervisor goBack={() => setView({ type: 'menu' })} />;
  if (view.type === 'reset') return <ViewReset goBack={() => setView({ type: 'menu' })} />;
  return <MenuCamera go={setView} />;
}

function MenuCamera({ go }: { go: (v: View) => void }) {
  const ints = live.use(e => e.integrations);
  const hidden = live.use(e => e.state?.hidden?.length ?? 0);
  // el mando a distancia de Slack no es una fuente de avisos (no lee nada): tiene su propio estado
  const [sk, setSk] = useState<SlackRemoteState | null>(null);
  useEffect(() => { client.action<SlackRemoteState>('slackRemote.estado').then(setSk).catch(() => {}); }, []);
  const skPilot = sk?.paired ? 'conectada' : sk?.connected ? 'demo' : 'sin-configurar';
  const items: (ItemMenu & { f: () => void })[] = [
    ...INTEGRATIONS.map(f => { const st = ints[f.id]; return { text: <><span className={'piloto-mini ' + (st?.state ?? 'demo')} /> {f.name}</>, hint: tIs(INTEGRATION_STATE_SHORT[st?.state ?? 'demo']) + (st?.detail && st.state === 'error' ? ' — ' + st.detail : ''), f: () => go({ type: 'integracion', id: f.id }) }; }),
    { text: <><span className={'piloto-mini ' + skPilot} /> {t('panels.slackRemoteMenu')}</>, hint: sk?.paired ? t('panels.slackRemoteVaultPaired') : sk?.connected ? t('panels.slackRemoteVaultNotPaired') : t('panels.slackRemoteVaultHint'), f: () => go({ type: 'slackRemote' }) },
    { text: t('panels.theShelterNameReposRoot'), f: () => go({ type: 'refugio' }) },
    { text: t('panels.shelterRooms'), hint: hidden ? t('panels.shelterRoomsHint', { n: hidden }) : undefined, f: () => go({ type: 'salas' }) },
    { text: t('panels.overseerSOutfit'), f: () => go({ type: 'supervisor' }) },
    { text: t('panels.optionsSoundAndDictationLanguage'), hint: 'Esc', f: () => juego.set({ panel: 'opciones' }) },
    { text: t('menu.keyboardShortcuts'), hint: 'F1', f: () => juego.set({ panel: 'ayuda' }) },
    { text: t('panels.resetTheShelter'), danger: true, f: () => go({ type: 'reset' }) },
  ];
  const [i, setI] = useMenu(items.length, k => items[k].f());
  return (
    <Device label={t('panels.vault')} width={54}>
      <p className="voz">{t('panels.keysCredentialsAndSettingsHanzo')}</p>
      <Options items={items} i={i} setI={setI} onChoose={k => items[k].f()} />
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('windows.open')} <kbd>Esc</kbd>{t('menu.close')}</Keys>
    </Device>
  );
}

function IntegrationView({ card: base, goBack }: { card: IntegrationCard; goBack: () => void }) {
  // los campos los define el conector del servidor (nombre, etiqueta, secreto, ayuda); los pasos son de la cámara
  const [def, setDef] = useState<{ fields: IntegrationField[]; values: Record<string, string>; saved: string[] } | null>(null);
  useEffect(() => { client.action<any>('integracion.campos', { source: base.id }).then(r => setDef({ fields: r.fields.map((c: any) => ({ id: c.name, label: tIs(c.label) + (c.optional ? t('panels.optional') : ''), secret: c.secret, help: c.help, example: c.example })), values: r.values ?? {}, saved: r.saved ?? [] })).catch(() => {}); }, []);
  if (!def) return <Device label={t('panels.vaultNombre', { nombre: base.name.toUpperCase() })} width={62} onClose={goBack}><p className="tenue">{t('panels.readingTheConfiguration')}</p></Device>;
  return <FormIntegration key="f" card={{ ...base, fields: def.fields.length || !base.fields.length ? def.fields : base.fields }} valuesIni={def.values} savedIni={def.saved} goBack={goBack} />;
}

function FormIntegration({ card, valuesIni, savedIni, goBack }: { card: IntegrationCard; valuesIni: Record<string, string>; savedIni: string[]; goBack: () => void }) {
  const st = live.use(e => e.integrations[card.id]);
  const saved: Record<string, string> = { ...valuesIni, ...(st?.fields ?? {}), ...Object.fromEntries(savedIni.map(g => [g, '1'])) };
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(card.fields.map(c => [c.id, c.secret ? '' : saved[c.id] ?? ''])));
  const [focus, setFocus] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const real = st?.mode === 'real';
  const oauth = INFO_SOURCE[card.id].oauth;
  const actions = [
    ...(card.fields.length ? [{ id: 'probar', text: t('panels.testConnection') }, { id: 'guardar', text: t('windows.save') }] : []),
    ...(oauth ? [{ id: 'conectar', text: st?.state === 'conectada' ? t('panels.switchAccount') : t('panels.connectWithOauth', { oauth: oauth ?? '' }) }, ...(st?.state === 'conectada' ? [{ id: 'desconectar', text: t('panels.signOut') }] : [])] : []),
    ...(INFO_SOURCE[card.id].channels && st?.state === 'conectada' ? [{ id: 'canales', text: t('panels.chooseChannels') }] : []),
    { id: 'modo', text: real ? t('panels.switchToDemo') : t('panels.useRealData') },
    // apagada (como empieza un refugio nuevo): también se puede probar con datos DEMO
    ...(st?.mode === 'off' ? [{ id: 'demo', text: t('panels.switchToDemo') }] : []),
  ];
  const [channels, setChannels] = useState<{ id: string | number; name: string; server?: string; picked: boolean }[] | null>(null);
  const n = card.fields.length + actions.length;
  const sentFields = () => Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ''));
  const act = async (id: string) => {
    setBusy(true); setMsg(null);
    try {
      if (id === 'probar') { const r: any = await client.action('integracion.probar', { source: card.id, fields: sentFields() }); setMsg({ ok: r.ok, text: r.detail }); r.ok ? SFX.shortSuccess() : SFX.error(); }
      else if (id === 'guardar') { const r: any = await client.action('integracion.guardar', { source: card.id, fields: sentFields() }); setMsg({ ok: r.ok, text: r.detail }); r.ok ? SFX.shortSuccess() : SFX.error(); if (r.ok) setValues(v => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, card.fields.find(c => c.id === k)?.secret ? '' : x]))); }
      else if (id === 'conectar') { await client.action('integracion.conectar', { source: card.id }); setMsg({ ok: true, text: t('panels.oauthHasBeenOpenedIn', { oauth: oauth ?? '' }) }); }
      else if (id === 'desconectar') { await client.action('integracion.desconectar', { source: card.id }); setMsg({ ok: true, text: t('panels.signedOut') }); }
      else if (id === 'modo') { await client.action('integracion.modo', { source: card.id, mode: real ? 'demo' : 'real' }); SFX.toggle(); }
      else if (id === 'demo') { await client.action('integracion.modo', { source: card.id, mode: 'demo' }); SFX.toggle(); }
      else if (id === 'canales') { setChannels(await client.action<any[]>('integracion.canales', { source: card.id })); }
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); SFX.error(); }
    setBusy(false);
  };
  useEffect(() => { if (focus < card.fields.length) refs.current[focus]?.focus(); else (document.activeElement as HTMLElement)?.blur?.(); }, [focus]);
  useKeys(e => {
    if (e.code === 'Escape') { goBack(); return; }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { setFocus(f => (f + 1) % n); SFX.tick(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { setFocus(f => (f - 1 + n) % n); SFX.tick(); }
    else if ((e.code === 'Enter' || e.code === 'KeyE' || e.code === 'Space') && focus >= card.fields.length) { SFX.click(); act(actions[focus - card.fields.length].id); }
  }, [focus, values, real]);
  const fieldKey = (e: React.KeyboardEvent, k: number) => {
    if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); setFocus((k + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus((k - 1 + n) % n); }
    else if (e.key === 'Escape') { e.preventDefault(); goBack(); }
  };
  return (
    <Device label={t('panels.vaultNombre', { nombre: card.name.toUpperCase() })} width={62} height onClose={goBack} pilot={st?.state === 'conectada' ? 'trabajando' : st?.state === 'error' ? 'error' : 'esperando'}>
      <div className="lista-desplazable">
        <p><b>{t('panels.status')}</b> {tIs(INTEGRATION_STATE_SHORT[st?.state ?? 'demo'])}{st?.detail ? <span className="tenue"> — {st.detail}</span> : null}{st?.last ? <span className="tenue"> · {t('panels.lastRead')} {new Date(st.last).toLocaleTimeString(language() === 'en' ? 'en-GB' : 'es-ES', { hour: '2-digit', minute: '2-digit' })}</span> : null}</p>
        <p className="tenue">{t('panels.whatItBringsToThe')} {tIs(card.what)}.</p>
        <h3>{t('panels.stepByStep')}</h3>
        <ol className="pasos">{card.steps.map((p, k) => <li key={k}>{p}</li>)}</ol>
        {card.fields.length > 0 && <h3>{t('panels.details')}</h3>}
        {card.fields.map((c, k) => (
          <label key={c.id} className={'campo-taller' + (focus === k ? ' activa' : '')} onClick={() => setFocus(k)}>
            <span className="etq">{c.label}{c.secret && <small> · {t('panels.toTheKeychain')}</small>}</span>
            <input ref={el => { refs.current[k] = el; }} type={c.secret ? 'password' : 'text'} value={values[c.id] ?? ''} placeholder={c.secret ? (saved[c.id] ? t('panels.savedTypeToChangeIt') : '') : c.example ? tIs(c.example) : ''} spellCheck={false} autoComplete="off"
              onFocus={() => setFocus(k)} onChange={e => setValues(v => ({ ...v, [c.id]: e.target.value }))} onKeyDown={e => fieldKey(e, k)} />
            {c.help && <small className="tenue">{tIs(c.help)}</small>}
          </label>
        ))}
        <div className="botonera">{actions.map((a, k) => <button key={a.id} className={'boton-taller' + (focus === card.fields.length + k ? ' activa' : '')} disabled={busy} onMouseEnter={() => setFocus(card.fields.length + k)} onClick={() => act(a.id)}>{a.text}</button>)}</div>
        {msg && <p className={msg.ok ? '' : 'aviso-consola'}>{msg.ok ? '✓ ' : '✗ '}{msg.text}</p>}
        {channels && <div className="selector-canales">
          <h3>{t('panels.channelsBeingWatched')}</h3>
          {channels.map((c, k) => <label key={String(c.id)} className="chip-canal"><input type="checkbox" checked={c.picked} onChange={e => setChannels(cs => cs!.map((x, j) => (j === k ? { ...x, picked: e.target.checked } : x)))} /> {c.server ? <span className="tenue">{c.server} · </span> : null}#{c.name}</label>)}
          <div className="botonera"><button className="boton-taller" onClick={async () => { const ids = channels.filter(c => c.picked).map(c => String(c.id)).join(','); const r: any = await client.action('integracion.guardar', { source: card.id, fields: { channels: ids } }); setMsg({ ok: r.ok, text: r.ok ? t('panels.channelsSaved') : r.detail }); setChannels(null); }}>{t('panels.saveChannels')}</button><button className="boton-taller" onClick={() => setChannels(null)}>{t('windows.cancel')}</button></div>
        </div>}
        {(card.id === 'jira' || card.id === 'linear') && st?.state === 'conectada' && <BoardStatusesView source={card.id} />}
      </div>
      <Keys><kbd>↑↓</kbd>{t('panels.move')} <kbd>Enter</kbd>{t('panels.nextPress')} <kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}

// production verification (server/verificationBoards.ts): each board of your open tasks has its own workflow, so its
// prod-check status (the task waits there for its final checkpoint) and the done one after it are picked per board
type BoardSetup = { source: string; board: string; states: string[]; test?: string; done?: string; error?: string };
function BoardStatusesView({ source }: { source: 'jira' | 'linear' }) {
  const [boards, setBoards] = useState<BoardSetup[] | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { client.action<BoardSetup[]>('verificacion.tableros', { source }).then(setBoards).catch(e => setMsg((e as Error).message)); }, [source]);
  const set = async (b: BoardSetup, c: { test?: string; done?: string }) => {
    const v = { test: b.test, done: b.done, ...c };
    try { await client.action('verificacion.tablero', { board: b.board, ...v }); SFX.shortSuccess(); setBoards(l => l!.map(x => (x === b ? { ...x, ...v } : x))); setMsg(t('panels.saved')); }
    catch (e) { setMsg((e as Error).message); SFX.error(); }
  };
  const options = (b: BoardSetup, current?: string) => [...new Set([...(current ? [current] : []), ...b.states])];
  return <div className="estados-tablero">
    <h3>{t('verification.vault.title')}</h3>
    <p className="tenue">{t('verification.vault.hint')}</p>
    {!boards && !msg && <p className="tenue">{t('preflight.reading')}</p>}
    {boards && !boards.length && <p className="tenue">{t('verification.vault.noBoards')}</p>}
    {boards?.map(b => <div key={b.board} className="fila-tablero">
      <b>{b.board}</b>
      <label>{t('verification.vault.prodCheck')} <select value={b.test ?? ''} onChange={e => set(b, { test: e.target.value })}>
        <option value="">—</option>{options(b, b.test).map(x => <option key={x} value={x}>{x}</option>)}</select></label>
      <label>{t('verification.vault.done')} <select value={b.done ?? ''} onChange={e => set(b, { done: e.target.value })}>
        <option value="">—</option>{options(b, b.done).map(x => <option key={x} value={x}>{x}</option>)}</select></label>
      {b.error && <small className="aviso-consola">{b.error}</small>}
    </div>)}
    {msg && <p className="tenue">{msg}</p>}
  </div>;
}

function ShelterView({ goBack }: { goBack: () => void }) {
  const e = live.use(x => x.state);
  const [v, setV] = useState({ name: e?.name || GAME_NAME, reposRoot: e?.reposRoot ?? '~', sessionLimit: String(e?.sessionLimit ?? 6) });
  const [msg, setMsg] = useState('');
  const [focus, setFocus] = useState(0);
  const fields: [keyof typeof v, string][] = [['name', t('panels.shelterName')], ['reposRoot', t('panels.reposRootDoorSuggestionsAnd')], ['sessionLimit', t('panels.simultaneousSessionLimit')]];
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => { refs.current[focus]?.focus(); }, [focus]);
  const save = async () => {
    const lim = Math.max(1, Math.min(20, parseInt(v.sessionLimit) || 6));
    try { await client.action('guardar', { patch: { name: v.name.trim() || GAME_NAME, reposRoot: v.reposRoot.trim() || '~', sessionLimit: lim } }); SFX.shortSuccess(); setMsg(t('panels.saved')); } catch (err) { setMsg((err as Error).message); }
  };
  useKeys(ev => { if (ev.code === 'Escape') goBack(); });
  // la lista «antes de subir» del pre-flight (la primera vez, la de tu ~/.claude/CLAUDE.md): un punto por línea
  const [list, setList] = useState<string | null>(null);
  useEffect(() => { client.action<string[]>('preflight.checklist').then(l => setList(l.join('\n'))).catch(() => setList('')); }, []);
  const saveList = async () => {
    if (list === null) return;
    try { await client.action('guardar', { patch: { checklistPreflight: list.split('\n').map(x => x.trim()).filter(Boolean) } }); SFX.shortSuccess(); setMsg(t('panels.saved')); } catch (err) { setMsg((err as Error).message); }
  };
  return (
    <Device label={t('panels.vaultWorkShelter')} width={50} onClose={goBack}>
      {fields.map(([k, lbl], i) => (
        <label key={k} className={'campo-taller' + (focus === i ? ' activa' : '')}>
          <span className="etq">{lbl}</span>
          <input ref={el => { refs.current[i] = el; }} value={v[k]} spellCheck={false} onFocus={() => setFocus(i)} onChange={ev => setV(x => ({ ...x, [k]: ev.target.value }))}
            onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); if (i === fields.length - 1) save(); else setFocus(i + 1); } else if (ev.key === 'ArrowDown' || ev.key === 'Tab') { ev.preventDefault(); setFocus((i + 1) % fields.length); } else if (ev.key === 'ArrowUp') { ev.preventDefault(); setFocus((i - 1 + fields.length) % fields.length); } else if (ev.key === 'Escape') { ev.preventDefault(); goBack(); } }} />
        </label>
      ))}
      <div className="botonera"><button className="boton-taller" onClick={save}>{t('windows.save')}</button></div>
      <label className="campo-taller checklist-preflight">
        <span className="etq">{t('preflight.vault.checklist')}</span>
        <textarea rows={6} value={list ?? ''} disabled={list === null} spellCheck={false} placeholder={t('preflight.vault.placeholder')}
          onChange={ev => setList(ev.target.value)} onKeyDown={ev => { ev.stopPropagation(); if (ev.key === 'Escape') { ev.preventDefault(); goBack(); } else if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); saveList(); } }} />
        <span className="tenue">{t('preflight.vault.hint')}</span>
      </label>
      <div className="botonera"><button className="boton-taller" onClick={saveList} disabled={list === null}>{t('preflight.vault.save')}</button></div>
      {msg && <p className="aviso-consola">{msg}</p>}
      <Keys><kbd>Enter</kbd>{t('panels.nextOnTheLastOne')} <kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}

// Qué repos tienen sala: las de repo a la vista y las ocultas (state.ocultas), en orden alfabético; Enter cambia una
function RoomsView({ goBack }: { goBack: () => void }) {
  const rooms = live.use(e => e.state?.rooms ?? []);
  const hidden = live.use(e => e.state?.hidden ?? []);
  const [msg, setMsg] = useState('');
  const list: { id: string; name: string; path?: string; hidden: boolean }[] = [
    ...rooms.filter((s: any) => isRoomOfRepo(s.type) && s.id !== PLANNING_ROOM).map((s: any) => ({ id: s.id, name: s.name, path: s.path, hidden: false })),
    ...hidden.map((o: any) => ({ id: o.room.id, name: o.room.name, path: o.room.path, hidden: true })),
  ].sort(alphabeticalOrder);
  const change = async (k: number) => {
    const s = list[k]; if (!s) return;
    try { await client.action(s.hidden ? 'sala.mostrar' : 'sala.ocultar', { roomId: s.id }); SFX.toggle(); setMsg(''); } catch (err) { SFX.notAllowed(); setMsg((err as Error).message); }
  };
  const items: ItemMenu[] = list.map(s => ({ text: <>{s.hidden ? '☐' : '☑'} {s.name}</>, hint: s.path }));
  const [i, setI] = useMenu(items.length, change, undefined, goBack);
  return (
    <Device label={t('panels.vaultRooms')} width={54} onClose={goBack}>
      <p className="tenue">{t('panels.vaultRoomsIntro')}</p>
      {list.length ? <Options items={items} i={i} setI={setI} onChoose={change} /> : <p className="tenue">{t('panels.vaultRoomsNone')}</p>}
      {msg && <p className="aviso-consola">{msg}</p>}
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.toggle')} <kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}

function ViewSupervisor({ goBack }: { goBack: () => void }) {
  const sup = live.use(e => e.state?.supervisor ?? { character: 'Protagonist_B', accessories: [] });
  const jugador = live.use(e => e.state?.jugador);
  const outfits: string[] = jugador?.outfit ?? [];
  const items: (ItemMenu & { f: () => void })[] = [
    // el aspecto entero (humano o robot, cara, pelo, ropa, colores) se cambia en el probador de Chapa y Pintura
    { text: <>{t('panels.changeLookIn')} <b>{t('world.bodyShop')}</b></>, hint: t('panels.pFromAnywhere'), f: () => juego.set({ panel: 'chapa', panelData: { who: 'supervisor' } }) },
    ...outfits.filter(a => SHOP.some(x => x.id === a && x.tipo === 'accesorio')).map(a => ({ text: <>{sup.accessories?.includes(a) ? '☑' : '☐'} {tIs(SHOP.find(x => x.id === a)?.nombre ?? a)}</>, hint: t('panels.shopAccessory'), f: () => client.action('juego.equipar', { article: a, who: 'supervisor' }).then(() => SFX.toggle()).catch(() => SFX.notAllowed()) })),
  ];
  const [i, setI] = useMenu(items.length, k => items[k].f(), undefined, goBack);
  return (
    <Device label={t('panels.vaultOverseerSOutfit')} width={44} onClose={goBack}>
      <Options items={items} i={i} setI={setI} onChoose={k => items[k].f()} />
      {!outfits.length && <p className="tenue">{t('panels.accessoriesAreBoughtWithScrap')}</p>}
      <Keys><kbd>↑↓</kbd>{t('menu.select')} <kbd>Enter</kbd>{t('panels.putItOn')} <kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}

function ViewReset({ goBack }: { goBack: () => void }) {
  const [step, setStep] = useState(0);
  const items: ItemMenu[] = [{ text: t('panels.noGoBack') }, { text: step ? t('panels.yesReallyWipeTheShelter') : t('panels.resetTheShelter2'), danger: true }];
  const pick = async (k: number) => {
    if (k === 0) return goBack();
    if (!step) { setStep(1); return; }
    await client.action('reiniciarRefugio'); SFX.powerOff(); setTimeout(() => location.reload(), 600);
  };
  const [i, setI] = useMenu(2, pick, undefined, goBack);
  return (
    <Device label={t('panels.vaultReset')} width={44} pilot="error" onClose={goBack}>
      <p className="aviso-consola">{t('panels.allSessionsAreStoppedAnd')}</p>
      <p className="tenue">{t('panels.noFolderOrRepoIs')}</p>
      <Options items={items} i={i} setI={setI} onChoose={pick} />
    </Device>
  );
}

// ---------------------------------------------------------------- Slack, mando a distancia (server/slackBot.ts)
// Una app de Slack propia, creada desde este manifiesto (Socket Mode: sin URL pública): las peticiones de aprobación,
// para responderlas desde el móvil sin salir del refugio, y la lista de conversaciones para pasarlas a Remote Control.
// Solo lo justo: escribir y leer su propio mensaje directo; nada de canales
const SLACK_MANIFEST = JSON.stringify({
  display_information: { name: 'Refugio', description: t('windows.slackAppDescription') },
  features: { bot_user: { display_name: 'Refugio', always_online: false }, app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false } },
  oauth_config: { scopes: { bot: ['chat:write', 'im:history'] } },
  settings: { event_subscriptions: { bot_events: ['message.im'] }, interactivity: { is_enabled: true }, org_deploy_enabled: false, socket_mode_enabled: true, token_rotation_enabled: false },
}, null, 2);
export interface SlackRemoteState { connected: boolean; team?: string; bot?: string; paired: boolean; code?: string; approve: boolean }
function SlackRemoteView({ goBack }: { goBack: () => void }) {
  const [st, setSt] = useState<SlackRemoteState | null>(null);
  const [app, setApp] = useState('');
  const [bot, setBot] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const request = (action: string, d?: Record<string, unknown>) => {
    setBusy(true); setMsg(null);
    return client.action(action, d).then((r: any) => { setSt(r); SFX.tick(); return r; }).catch((e: Error) => { setMsg({ ok: false, text: e.message }); SFX.notAllowed(); }).finally(() => setBusy(false));
  };
  // mientras se espera el emparejado, se mira cada pocos segundos si ya ha llegado el código por mensaje directo
  useEffect(() => {
    client.action('slackRemote.estado').then((r: any) => setSt(r)).catch(() => {});
    const id = setInterval(() => client.action('slackRemote.estado').then((r: any) => setSt(r)).catch(() => {}), 3000);
    return () => clearInterval(id);
  }, []);
  const ready = !!app.trim() && !!bot.trim();
  const connect = () => { if (ready) request('slackRemote.conectar', { appToken: app, botToken: bot }).then(r => { if (r) { setApp(''); setBot(''); } }); };
  const copy = () => navigator.clipboard.writeText(SLACK_MANIFEST).then(() => { setMsg({ ok: true, text: t('panels.slackRemoteManifestCopied') }); SFX.tick(); }).catch(() => {});
  return (
    <Device label={t('panels.vaultNombre', { nombre: 'SLACK' })} width={62} onClose={goBack} pilot={st?.paired ? 'trabajando' : st?.connected ? 'esperando' : 'ociosa'}>
      <p className="voz">{t('panels.slackRemoteIntro')}</p>
      <p className="tenue">{t('panels.slackRemotePrivacy')}</p>
      {st && !st.connected && <>
        <ol className="pasos">
          <li>{t('panels.slackRemoteStep1')} <button className="boton-taller" onClick={copy}>{t('panels.slackRemoteCopyManifest')}</button></li>
          <li>{t('panels.slackRemoteStep2')}</li>
          <li>{t('panels.slackRemoteStep3')}</li>
        </ol>
        <label className="campo-taller activa">
          <span className="etq">{t('panels.slackRemoteAppToken')}<small> · {t('panels.toTheKeychain')}</small></span>
          <input type="password" value={app} spellCheck={false} autoComplete="off" autoFocus placeholder="xapp-…" onChange={e => setApp(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') connect(); }} />
        </label>
        <label className="campo-taller activa">
          <span className="etq">{t('panels.slackRemoteBotToken')}<small> · {t('panels.toTheKeychain')}</small></span>
          <input type="password" value={bot} spellCheck={false} autoComplete="off" placeholder="xoxb-…" onChange={e => setBot(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') connect(); }} />
        </label>
        <div className="botonera"><button className="boton-taller" disabled={busy || !ready} onClick={connect}>{t('panels.slackRemoteConnect')}</button></div>
      </>}
      {st?.connected && <>
        <p><b>{t('panels.status')}</b> {st.paired ? t('panels.slackRemotePairedWith', { bot: '@' + st.bot, team: st.team ?? '' }) : t('panels.slackRemoteWaitingPairing', { bot: '@' + st.bot, team: st.team ?? '' })}</p>
        {!st.paired && (st.code
          ? <p>{t('panels.slackRemoteSendCode', { bot: '@' + st.bot })} <b className="codigo-emparejar">{st.code}</b></p>
          : <p className="aviso-consola">{t('panels.slackRemoteCodeExpired')}</p>)}
        <div className="botonera">
          {st.paired && <button className="boton-taller" disabled={busy} onClick={() => request('slackRemote.aprobar', { si: !st.approve })}>{st.approve ? t('panels.slackRemoteApprovalsOn') : t('panels.slackRemoteApprovalsOff')}</button>}
          <button className="boton-taller" disabled={busy} onClick={() => request('slackRemote.emparejar')}>{st.paired ? t('panels.slackRemotePairAgain') : t('panels.slackRemoteNewCode')}</button>
          <button className="boton-taller" disabled={busy} onClick={() => request('slackRemote.desconectar')}>{t('panels.slackRemoteDisconnect')}</button>
        </div>
      </>}
      {msg && <p className={msg.ok ? '' : 'aviso-consola'}>{msg.text}</p>}
      <Keys><kbd>Esc</kbd>{t('menu.back')}</Keys>
    </Device>
  );
}
