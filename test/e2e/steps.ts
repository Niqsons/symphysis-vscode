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
