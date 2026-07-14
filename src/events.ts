export class Emitter<Events extends Record<string, any>> {
  private map = new Map<keyof Events, Set<(payload: any) => void>>();

  on<K extends keyof Events>(type: K, cb: (payload: Events[K]) => void): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(cb);
    return () => set!.delete(cb);
  }

  off<K extends keyof Events>(type: K, cb: (payload: Events[K]) => void): void {
    this.map.get(type)?.delete(cb);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.map.get(type);
    if (set) for (const cb of set) cb(payload);
  }

  clear(): void {
    this.map.clear();
  }
}
