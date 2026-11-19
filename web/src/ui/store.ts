// Almacén mínimo de estado de interfaz (sin dependencias): suscripción + hook de React.
import { useRef, useSyncExternalStore } from 'react';

export class Store<T extends object> {
  private state: T; private listeners = new Set<() => void>();
  constructor(initial: T) { this.state = initial; }
  get = () => this.state;
  set = (partial: Partial<T> | ((e: T) => Partial<T>)) => {
    const p = typeof partial === 'function' ? partial(this.state) : partial;
    this.state = { ...this.state, ...p };
    for (const o of this.listeners) o();
  };
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  // el selector puede devolver objetos nuevos (filter, map): se recuerda el resultado mientras el estado no cambie
  use<R>(sel: (e: T) => R): R {
    const ref = useRef<{ e: T; r: R } | null>(null);
    return useSyncExternalStore(this.subscribe, () => {
      if (ref.current && ref.current.e === this.state) return ref.current.r;
      const r = sel(this.state); ref.current = { e: this.state, r }; return r;
    });
  }
}
