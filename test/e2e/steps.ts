// Шаги сквозных сценариев: падение шага не останавливает остальные, результаты читает запускающий скрипт.
export const results: { name: string; ok: boolean; ms?: number; error?: string }[] = [];

export async function step(name: string, fn: () => Promise<void>) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Водитель страницы: действие уходит сообщением, ответ приходит через события страницы (`test/e2e/driver.ts`). */
export function driver(webview: () => { postMessage(m: unknown): Thenable<boolean> } | null, messages: { event(listener: (m: any) => unknown): unknown }) {
  let seq = 0;
  const pending = new Map<number, (m: any) => void>();
  messages.event((m: any) => {
    if (m.type === "driven") {
      pending.get(m.seq)?.(m);
      pending.delete(m.seq);
    }
  });
  return async (action: string, args: Record<string, unknown> = {}): Promise<any> => {
    const id = ++seq;
    const reply = new Promise<any>((resolve, reject) => {
      pending.set(id, resolve);
      setTimeout(() => reject(new Error(`водитель молчит: ${action}`)), 10000);
    });
    await webview()!.postMessage({ type: "drive", seq: id, action, ...args });
    const m = await reply;
    if (m.error) throw new Error(m.error);
    return m.result;
  };
}

export async function until<T>(what: string, fn: () => T | Promise<T>, ms = 15000): Promise<T> {
  const t0 = Date.now();
  let last: unknown;
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn();
      if (v) return v;
      last = v;
    } catch (e) {
      last = e;
    }
    await sleep(40);
  }
  throw new Error(`нет за ${ms} мс: ${what}; последнее: ${String(last)}`);
}
