// Данные журналов проекта. Один запуск Python на изменение; просьбы на его время склеиваются в один следующий;
// пока Python работает и при отказе, на экране остаётся прежнее (второй круг бывает до 2,2 с, причина не установлена).
import type { CoreFailure } from "../protocol/protocol";
import type { ViewPayload } from "../protocol/types";
import type { ViewResult } from "../core/core";
import type { ChangeRef } from "../core/project";

export interface ChangeState {
  ref: ChangeRef;
  payload: ViewPayload | null;
  failure: CoreFailure | null;
  loading: boolean;
}

export interface StoreDeps {
  list(): ChangeRef[];
  run(ref: ChangeRef): Promise<ViewResult>;
  onUpdate(key: string): void;
  concurrency: number;
}

interface Slot extends ChangeState {
  running: boolean;
  again: boolean;
}

export const keyOf = (ref: ChangeRef) => ref.dir;

export class JournalStore {
  private readonly slots = new Map<string, Slot>();
  private readonly queue: string[] = [];
  private active = 0;
  private readonly included = new Map<string, ChangeRef>();
  private listed = new Set<string>();

  constructor(private readonly deps: StoreDeps) {}

  list(): ChangeState[] {
    return [...this.slots.values()].filter((state) => this.listed.has(keyOf(state.ref)));
  }

  get(key: string): ChangeState | undefined {
    return this.slots.get(key);
  }

  /** Адресный переход из снимка может открыть журнал архивного изменения. */
  include(ref: ChangeRef): void {
    this.included.set(keyOf(ref), ref);
    this.sync();
  }

  /** Перечитывает перечень изменений: пропавшие уходят, новые появляются; атаки и наличие журнала — свежие. */
  sync(): void {
    const active = this.deps.list();
    this.listed = new Set(active.map(keyOf));
    const refs = [...this.included.values(), ...active];
    const keys = new Set(refs.map(keyOf));
    for (const key of this.slots.keys()) if (!keys.has(key)) this.slots.delete(key);
    for (const ref of refs) {
      const slot = this.slots.get(keyOf(ref));
      if (slot) slot.ref = ref;
      else this.slots.set(keyOf(ref), { ref, payload: null, failure: null, loading: false, running: false, again: false });
    }
  }

  refreshAll(): void {
    this.sync();
    for (const key of this.slots.keys()) this.refresh(key);
  }

  refresh(key: string): void {
    if (!this.slots.has(key)) this.sync();
    const slot = this.slots.get(key);
    if (!slot) return;
    slot.loading = true;
    if (slot.running) {
      slot.again = true;
      return;
    }
    if (!this.queue.includes(key)) this.queue.push(key);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.deps.concurrency && this.queue.length) {
      const key = this.queue.shift()!;
      const slot = this.slots.get(key);
      if (!slot) continue;
      this.active++;
      slot.running = true;
      void this.deps.run(slot.ref)
        .catch((e): ViewResult => ({ ok: false, failure: { kind: "crash", text: String(e) } }))
        .then((result) => this.finish(key, result));
    }
  }

  private finish(key: string, result: ViewResult): void {
    this.active--;
    const slot = this.slots.get(key);
    if (slot) {
      slot.running = false;
      if (result.ok) {
        slot.payload = result.payload;
        slot.failure = null;
      } else {
        slot.failure = result.failure;
      }
      slot.loading = slot.again;
      if (slot.again) {
        slot.again = false;
        this.queue.push(key);
      }
      this.deps.onUpdate(key);
    }
    this.pump();
  }
}
