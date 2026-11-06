import { test } from "node:test";
import assert from "node:assert/strict";
import type { ViewResult } from "../../src/core/core";
import type { ChangeRef } from "../../src/core/project";
import { JournalStore } from "../../src/changes/store";
import { payload } from "./helpers";

const ref = (name: string): ChangeRef => ({ root: "R", name, dir: `R/${name}`, journal: `R/${name}/decisions.json`, hasJournal: true, attacks: [] });
const ok = (title: string): ViewResult => ({ ok: true, payload: payload([], { title }) });
const bad: ViewResult = { ok: false, failure: { kind: "invalid-journal", text: "битый" } };

/** Запуски висят, пока тест не отпустит: видно, сколько идёт одновременно и в каком порядке. */
function harness(refs: ChangeRef[]) {
  const runs: { name: string; release: (r: ViewResult) => void }[] = [];
  const updates: string[] = [];
  const store = new JournalStore({
    list: () => refs,
    run: (r) => new Promise((resolve) => runs.push({ name: r.name, release: resolve })),
    onUpdate: (key) => updates.push(key),
    concurrency: 2,
  });
  return { store, runs, updates };
}
const tick = () => new Promise((r) => setImmediate(r));

test("за одно изменение идёт один запуск; просьбы на его время склеиваются в один следующий", async () => {
  const { store, runs } = harness([ref("a")]);
  store.refresh("R/a");
  store.refresh("R/a");
  store.refresh("R/a");
  assert.equal(runs.length, 1);
  runs[0].release(ok("первый"));
  await tick();
  assert.equal(runs.length, 2);
  runs[1].release(ok("второй"));
  await tick();
  assert.equal(runs.length, 2);
  assert.equal(store.get("R/a")?.payload?.title, "второй");
});

test("предел одновременных запусков: остальные ждут очереди", async () => {
  const { store, runs } = harness([ref("a"), ref("b"), ref("c")]);
  store.refreshAll();
  assert.deepEqual(runs.map((r) => r.name), ["a", "b"]);
  runs[0].release(ok("a"));
  await tick();
  assert.deepEqual(runs.map((r) => r.name), ["a", "b", "c"]);
});

test("отказ оставляет прежние данные и называет себя", async () => {
  const { store, runs } = harness([ref("a")]);
  store.refresh("R/a");
  runs[0].release(ok("годный"));
  await tick();
  store.refresh("R/a");
  runs[1].release(bad);
  await tick();
  const s = store.get("R/a")!;
  assert.equal(s.payload?.title, "годный");
  assert.equal(s.failure?.kind, "invalid-journal");
});

test("удачный запуск снимает прежний отказ", async () => {
  const { store, runs } = harness([ref("a")]);
  store.refresh("R/a");
  runs[0].release(bad);
  await tick();
  store.refresh("R/a");
  runs[1].release(ok("годный"));
  await tick();
  assert.equal(store.get("R/a")?.failure, null);
});

test("пока идёт запуск, прежние данные на месте и есть пометка", async () => {
  const { store, runs } = harness([ref("a")]);
  store.refresh("R/a");
  assert.equal(store.get("R/a")?.loading, true);
  runs[0].release(ok("годный"));
  await tick();
  store.refresh("R/a");
  const s = store.get("R/a")!;
  assert.equal(s.loading, true);
  assert.equal(s.payload?.title, "годный");
});

test("уведомление о каждом завершённом запуске", async () => {
  const { store, runs, updates } = harness([ref("a")]);
  store.refresh("R/a");
  runs[0].release(ok("годный"));
  await tick();
  assert.equal(updates.filter((k) => k === "R/a").length >= 1, true);
});

test("перечень изменений обновляется: пропавшее уходит, новое появляется", async () => {
  const refs = [ref("a"), ref("b")];
  const { store } = harness(refs);
  store.refreshAll();
  refs.splice(0, 1, ref("c"));
  store.refreshAll();
  assert.deepEqual(store.list().map((s) => s.ref.name).sort(), ["b", "c"]);
});

test("отказ из-за исключения в запуске не вешает очередь", async () => {
  const store = new JournalStore({
    list: () => [ref("a")],
    run: async () => { throw new Error("сломалось"); },
    onUpdate: () => {},
    concurrency: 1,
  });
  store.refresh("R/a");
  await tick();
  const s = store.get("R/a")!;
  assert.equal(s.loading, false);
  assert.equal(s.failure?.kind, "crash");
});
