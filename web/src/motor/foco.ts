// Primer plano: el juego solo pinta (y anima el refugio) cuando su ventana tiene el foco del sistema y la página es
// visible. Fuera de eso, el motor para su bucle, la interfaz deja de animarse y a Spotify se le
// pregunta cada 4 s (ui/Discoteca.tsx);
// lo que hace Claude y las terminales no depende de esto. En Electron lo dice el proceso principal (foco de la ventana):
// que el foco esté dentro de un navegador del refugio (un <webview>) no cuenta como salir del juego. Fuera de Electron
// (desarrollo en el navegador) se pregunta al documento.

// null: todavía no ha llegado el aviso de Electron, se pregunta al documento
let withFocusOfWindow: boolean | null = null;

export function isInFirstMap(visible: boolean, windowWithFocus: boolean | null, docWithFocus: boolean): boolean {
  return visible && (windowWithFocus ?? docWithFocus);
}

export function firstMapNow(): boolean {
  return isInFirstMap(document.visibilityState === 'visible', withFocusOfWindow, document.hasFocus());
}

// Avisa en cada cambio (y una vez al empezar). Pone la clase «en-segundo-plano» en la página, que para las animaciones CSS.
export function watchFirstMap(alCambiar: (activo: boolean) => void) {
  let ultimo: boolean | null = null;
  const mirar = () => {
    const activo = firstMapNow();
    document.documentElement.classList.toggle('en-segundo-plano', !activo);
    if (activo === ultimo) return;
    ultimo = activo;
    alCambiar(activo);
  };
  // el foco pasa a un <webview> antes de que el documento lo registre: se mira en el turno siguiente
  addEventListener('focus', () => setTimeout(mirar));
  addEventListener('blur', () => setTimeout(mirar));
  document.addEventListener('visibilitychange', mirar);
  (window as any).shelterVentana?.onChangeFocus?.((con: boolean) => { withFocusOfWindow = con; mirar(); });
  mirar();
}
