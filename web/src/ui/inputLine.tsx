// La línea de entrada del intercomunicador, ampliada: adjuntos y dictado.
// - Adjuntos: pegar (también una captura del portapapeles), arrastrar o elegir con 📎 (⌘U). Se suben al refugio al
//   momento (acción «subir») y esperan en una bandeja con su miniatura hasta enviar; las imágenes le llegan al
//   habitante dentro del mensaje (server/attachments.ts) y el resto, por su ruta.
// - Dictado: 🎙 o ⌘D empieza a escuchar; Espacio (o ⌘D otra vez) termina. ⌥Espacio no: en muchos Macs es
//   Spotlight. Lo transcrito aparece en vivo donde estaba el cursor y queda para revisarlo; Enter lo envía (termina de
//   transcribir antes) y Esc lo descarta. La transcripción la hace el dictado de macOS en el propio Mac
//   (server/voice.ts): sin red, sin cuentas y sin coste.
import { useEffect, useRef, useState } from 'react';
import type { Attachment } from '@shared/protocol';
import { client, live, addNotice } from '../net/client';
import { SFX } from '../audio/sound';
import { MAC } from './windows';
import { t } from '@shared/language';

// ---------------------------------------------------------------- adjuntos
export interface AttachmentLocal { id: string; name: string; image: boolean; path?: string; view?: string; error?: string }
const views = new Map<string, string>();   // ruta en el refugio → miniatura ya vista (la del archivo subido o la pedida)
let nAttachment = 0;
const IS_IMAGE = /\.(png|jpe?g|gif|webp|heic|heif|tiff?|bmp)$/i;

export function uploadFiles(files: FileList | File[] | null | undefined, add: (a: AttachmentLocal) => void, change: (id: string, c: Partial<AttachmentLocal>) => void) {
  for (const f of Array.from(files ?? [])) {
    const id = 'a' + (++nAttachment);
    const image = f.type.startsWith('image/') || IS_IMAGE.test(f.name);
    // las capturas pegadas llegan como «image.png»: mejor un nombre que diga qué es y cuándo
    const name = /^image\.(png|jpe?g|gif|webp|tiff?)$/i.test(f.name) ? `captura-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.${f.name.split('.').pop()}` : f.name || 'archive';
    const view = image && /^image\/(png|jpeg|gif|webp|bmp)$/.test(f.type) ? URL.createObjectURL(f) : undefined;
    add({ id, name, image, view });
    if (f.size > 20 * 1024 * 1024) { change(id, { error: t('windows.over20Mb') }); SFX.notAllowed(); continue; }
    new Promise<string>((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => ko(r.error); r.readAsDataURL(f); })
      .then(data => client.action<string>('upload', { name, data }, 120_000))
      .then(path => { if (view) views.set(path, view); change(id, { path }); })
      .catch(e => { change(id, { error: (e as Error).message || t('windows.couldNotUpload') }); SFX.error(); });
  }
}

export function chooseFiles(onChoose: (f: FileList) => void) {
  const i = document.createElement('input');
  i.type = 'file'; i.multiple = true;
  i.onchange = () => { if (i.files?.length) onChoose(i.files); };
  i.click();
}

export const uploading = (l?: AttachmentLocal[]) => !!l?.some(a => !a.path && !a.error);
export const listsPaths = (l?: AttachmentLocal[]) => (l ?? []).filter(a => a.path).map(a => a.path!);

// los que esperan a salir con el mensaje
export function AttachmentsTray({ list, remove }: { list?: AttachmentLocal[]; remove: (id: string) => void }) {
  if (!list?.length) return null;
  return (
    <div className="bandeja-adjuntos">
      {list.map(a => (
        <span key={a.id} className={'adjunto' + (a.error ? ' failed' : !a.path ? ' subiendo' : '')} title={a.error ? `${a.name}: ${a.error}` : a.path ? a.name : `${a.name} · ${t('windows.uploading')}`}>
          {a.view ? <img src={a.view} alt="" /> : <span className="icono-adjunto" aria-hidden>{a.image ? '▣' : '▤'}</span>}
          <span className="nombre-adjunto">{a.name}</span>
          {a.error ? <span className="estado-adjunto">⚠</span> : !a.path ? <span className="estado-adjunto girando">◐</span> : null}
          <button onMouseDown={e => e.preventDefault()} onClick={() => remove(a.id)} title={t('windows.remove')}>×</button>
        </span>
      ))}
    </div>
  );
}

// los que ya se mandaron, en el cuaderno: miniatura (pedida al refugio la primera vez) y, con un clic, en su app
export function SentAttachments({ list }: { list: Attachment[] }) {
  return <div className="bandeja-adjuntos enviados">{list.map(a => <SentAttachment key={a.path} a={a} />)}</div>;
}
function SentAttachment({ a }: { a: Attachment }) {
  const [view, setView] = useState(views.get(a.path));
  useEffect(() => { if (a.image && !view) client.action<string>('attachment.thumbnail', { path: a.path }).then(v => { views.set(a.path, v); setView(v); }).catch(() => {}); }, [a.path]);
  const open = () => { client.action('attachment.open', { path: a.path }).catch(e => { SFX.notAllowed(); addNotice('warning', (e as Error).message); }); SFX.click(); };
  return (
    <button className={'adjunto' + (view ? ' con-vista' : '')} onClick={open} title={`${a.name} · ${t('windows.open')}`}>
      {view ? <img src={view} alt={a.name} /> : <span className="icono-adjunto" aria-hidden>{a.image ? '▣' : '▤'}</span>}
      {!view && <span className="nombre-adjunto">{a.name}</span>}
    </button>
  );
}

// ---------------------------------------------------------------- dictado
// el idioma en que se habla (Opciones, O): por defecto, español de España; los que admite el dictado de macOS
export const DICTATION_LANGUAGES = [
  { value: 'es-ES', text: 'Español (España)' }, { value: 'es-MX', text: 'Español (México)' }, { value: 'en-US', text: 'English (US)' },
  { value: 'en-GB', text: 'English (UK)' }, { value: 'fr-FR', text: 'Français' }, { value: 'de-DE', text: 'Deutsch' },
  { value: 'it-IT', text: 'Italiano' }, { value: 'pt-PT', text: 'Português (Portugal)' }, { value: 'pt-BR', text: 'Português (Brasil)' },
];
const LANGUAGE_KEY = 'refugio.dictado.idioma';
export function dictationLanguage() { try { const v = localStorage.getItem(LANGUAGE_KEY); if (v && DICTATION_LANGUAGES.some(x => x.value === v)) return v; } catch {} return 'es-ES'; }
export function setLanguageDictation(v: string) { try { localStorage.setItem(LANGUAGE_KEY, v); } catch {} }

export type DictationState = 'off' | 'listening' | 'transcribing';

// une lo dictado con lo que había a cada lado del cursor, con un espacio donde haga falta
function union(before: string, said: string, after: string) {
  if (!said) return before + after;
  const a = before && !/\s$/.test(before) ? before + ' ' : before;
  const d = after && !/^[\s.,;:!?)]/.test(after) ? ' ' + after : after;
  return a + said + d;
}

interface Dictating {
  id: string; before: string; after: string; original: string; said: string; send: boolean;
  stop?: () => void; submit?: () => void; remove?: () => void;
  deadline?: number; endOnOpen?: boolean;
}

export function useDictation({ area, text, setText, onSend }: { area: React.RefObject<HTMLTextAreaElement | null>; text: string; setText: (t: string) => void; onSend: (t: string) => void }) {
  const [state, setState] = useState<DictationState>('off');
  const [level, setLevel] = useState(0);
  const [notice, setNotice] = useState('');
  const r = useRef<Dictating | null>(null);
  const textRef = useRef(text); textRef.current = text;
  const fns = useRef({ setText, onSend }); fns.current = { setText, onSend };

  const finish = (final: string | null) => {
    const x = r.current; if (!x) return;
    x.stop?.(); x.remove?.(); clearTimeout(x.deadline); r.current = null;
    setState('off'); setLevel(0);
    if (final === null) { fns.current.setText(x.original); return; }
    const t = union(x.before, final, x.after);
    fns.current.setText(t);
    const cursor = union(x.before, final, '').length;
    requestAnimationFrame(() => { const el = area.current; if (el) { el.focus(); el.setSelectionRange(cursor, cursor); } });
    if (x.send) fns.current.onSend(t);
  };

  const start = async () => {
    if (r.current) return;
    setNotice('');
    const el = area.current, tx = textRef.current;
    const start = el?.selectionStart ?? tx.length, end = el?.selectionEnd ?? tx.length;
    const x: Dictating = { id: 'voice' + Date.now().toString(36), before: tx.slice(0, start), after: tx.slice(end), original: tx, said: '', send: false };
    r.current = x;
    setState('listening'); SFX.toggle();
    x.remove = client.listen(m => {
      if (m.t !== 'voice' || m.id !== x.id || r.current !== x) return;
      if (m.state === 'partial') { x.said = m.text ?? ''; fns.current.setText(union(x.before, x.said, x.after)); }
      else if (m.state === 'final') finish(m.text ?? x.said);
      else if (m.state === 'error') { setNotice(m.text || t('windows.dictationFailed')); SFX.error(); finish(x.said || null); }
    });
    const WITHOUT_PERMISSION = t('windows.noMicrophonePermissionGrantIt');
    // en la app, el permiso de macOS lo pide Electron (la primera vez sale el aviso del sistema)
    const permission = await (window as any).shelterVentana?.askMicrophone?.().catch(() => true);
    if (permission === false) { setNotice(WITHOUT_PERMISSION); SFX.error(); finish(null); return; }
    if (r.current !== x) return;
    let flow: MediaStream;
    try { flow = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) {
      setNotice((e as Error).name === 'NotAllowedError' ? WITHOUT_PERMISSION : t('windows.cannotOpenTheMicrophoneError', { error: (e as Error).message }));
      SFX.error(); finish(null); return;
    }
    if (r.current !== x) { flow.getTracks().forEach(t => t.stop()); return; }
    client.send({ t: 'voiceStart', id: x.id, language: dictationLanguage() });
    // a 16 kHz (el contexto remuestrea el micrófono), en trozos de ~0,25 s de PCM de 16 bits
    const ctx = new AudioContext({ sampleRate: 16000 });
    const source = ctx.createMediaStreamSource(flow);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    let pend: Int16Array[] = [], n = 0;
    const send = () => {
      if (!n) return;
      const all = new Int16Array(n); let o = 0; for (const p of pend) { all.set(p, o); o += p.length; }
      pend = []; n = 0;
      const b = new Uint8Array(all.buffer); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      client.send({ t: 'voiceAudio', id: x.id, data: btoa(s) });
    };
    proc.onaudioprocess = ev => {
      const f = ev.inputBuffer.getChannelData(0);
      const m = new Int16Array(f.length); let e = 0;
      for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); m[i] = v * 0x7fff; e += v * v; }
      pend.push(m); n += m.length;
      setLevel(Math.min(1, Math.sqrt(e / f.length) * 6));
      if (n >= 4000) send();
    };
    source.connect(proc); proc.connect(ctx.destination);
    x.submit = send;
    x.stop = () => { proc.onaudioprocess = null; try { source.disconnect(); proc.disconnect(); } catch {} flow.getTracks().forEach(t => t.stop()); ctx.close().catch(() => {}); x.stop = undefined; };
    // se soltó la tecla antes de que se abriera el micrófono (la primera vez macOS pide permiso): no hay nada que oír
    if (x.endOnOpen) cancel();
  };

  // se acabó de hablar: se cierra el micrófono y se espera el texto definitivo
  const finishDictation = (send = false) => {
    const x = r.current; if (!x) return;
    x.send = x.send || send;
    if (!x.stop) { if (!x.submit) x.endOnOpen = true; return; }   // aún abriendo el micrófono, o ya transcribiendo
    x.submit?.(); x.stop();
    client.send({ t: 'voiceEnd', id: x.id });
    setState('transcribing'); setLevel(0); SFX.click();
    x.deadline = window.setTimeout(() => { if (r.current === x) finish(x.said); }, 15_000);
  };
  const cancel = () => { const x = r.current; if (!x) return; client.send({ t: 'voiceCancel', id: x.id }); finish(null); SFX.close(); };
  const toggle = () => (r.current ? (state === 'listening' ? finishDictation() : undefined) : start());
  // al irse (minimizar, cambiar de pestaña) no queda nada escuchando
  useEffect(() => () => { const x = r.current; if (x) { client.send({ t: 'voiceCancel', id: x.id }); x.stop?.(); x.remove?.(); r.current = null; } }, []);

  // teclas, desde la caja de texto: ⌘D empieza (y termina); mientras se dicta, Espacio termina, Enter termina y envía y
  // Esc descarta
  const key = (e: React.KeyboardEvent): boolean => {
    if (dictateShortcut(e)) {
      e.preventDefault();
      if (e.repeat) return true;
      if (!r.current) start(); else if (state === 'listening') finishDictation();
      return true;
    }
    if (!r.current) return false;
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return true; }
    if (e.code === 'Space' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); if (!e.repeat && state === 'listening') finishDictation(); return true; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishDictation(true); return true; }
    if ((e.metaKey || e.ctrlKey) && /^[cvaxz]$/i.test(e.key)) return false;
    if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') e.preventDefault();   // mientras se dicta, el texto lo pone la voz
    return true;
  };
  return { state, level, notice, setNotice, toggle, finish: finishDictation, cancel, key, active: state !== 'off' };
}

export const dictateShortcut = (e: React.KeyboardEvent) => (MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyD';
export const attachShortcut = (e: React.KeyboardEvent) => (MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyU';

// 📎 y 🎙, a la derecha de la caja de texto, cada uno con su tecla a la vista (todo se maneja con el teclado); mientras
// se escucha, la del micrófono es la que termina
export function InputButtons({ attach, dictation }: { attach: () => void; dictation: ReturnType<typeof useDictation> }) {
  const title = dictation.state === 'listening' ? t('windows.stopDictatingSpaceOrAtajo', { shortcut: `${MAC ? '⌘' : 'Ctrl+'}D` }) : dictation.state === 'transcribing' ? t('windows.transcribing') : t('windows.dictateAtajoSpaceStops', { shortcut: `${MAC ? '⌘' : 'Ctrl+'}D` });
  return (
    <span className="botones-entrada">
      <button className="boton-entrada" onMouseDown={e => e.preventDefault()} onClick={attach} title={t('windows.attachFilesOrImagesAtajo', { shortcut: `${MAC ? '⌘' : 'Ctrl+'}U` })} aria-label={t('windows.attach')}>
        <svg viewBox="0 0 24 24" aria-hidden><path d="M20 11.5l-8.2 8.2a5 5 0 01-7.1-7.1l8.6-8.6a3.4 3.4 0 014.8 4.8l-8.6 8.6a1.7 1.7 0 01-2.4-2.4l7.9-7.9" /></svg>
        <kbd>{MAC ? '⌘U' : 'Ctrl+U'}</kbd>
      </button>
      <button className={'boton-entrada microfono ' + dictation.state} onMouseDown={e => e.preventDefault()} onClick={dictation.toggle} title={title} aria-label={t('windows.dictate')} disabled={dictation.state === 'transcribing'}>
        <svg viewBox="0 0 24 24" aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21M8.5 21h7" /></svg>
        <kbd>{dictation.state === 'listening' ? t('windows.space') : MAC ? '⌘D' : 'Ctrl+D'}</kbd>
      </button>
    </span>
  );
}

// la tira de debajo de la caja mientras se dicta (y el aviso si algo falla)
export function DictationStrip({ dictation }: { dictation: ReturnType<typeof useDictation> }) {
  if (!dictation.active) return dictation.notice ? <p className="notice-console notice-dictado" onClick={() => dictation.setNotice('')}>{dictation.notice}</p> : null;
  const barras = 8, full = Math.round(dictation.level * barras);
  return (
    <div className={'tira-dictado ' + dictation.state}>
      <span className="piloto-voz" aria-hidden />
      <b>{dictation.state === 'listening' ? t('windows.listening') : t('windows.transcribing2')}</b>
      {dictation.state === 'listening' && <span className="vumetro" aria-hidden>{Array.from({ length: barras }, (_, i) => <i key={i} className={i < full ? 'on' : ''} />)}</span>}
      <span className="dim"><kbd>{t('windows.space')}</kbd> {t('windows.finish')} <kbd>Enter</kbd> {t('windows.send')} <kbd>Esc</kbd> {t('windows.discard')}</span>
    </div>
  );
}
