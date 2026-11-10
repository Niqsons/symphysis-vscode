import { test } from "node:test";
import assert from "node:assert/strict";
import * as graph from "../graph";

const view = (name: string) => ({ view_format: 1, source: { kind: "live", change: "demo", preliminary: true },
  selection: { capability: name, requirement: null, module: null, linked_only: false },
  choices: { capabilities: [{ id: name, name }], requirements: [], modules: [] },
  text: "requirementDiagram\n", elements: { label: { id: name, name, kind: "req", at: "specs/a/spec.md:1" } },
  empty: false, unlinked: { scope: "change", items: [] }, diagnostics: [], incomplete: false });

test("req-graph принимает проверенный ответ и отвергает повреждённый", () => {
  assert.equal(typeof graph.parseGraphView, "function");
  assert.equal(graph.parseGraphView(view("a")).elements.label.id, "a");
  for (const value of [null, {}, { ...view("a"), view_format: 9 }, { ...view("a"), elements: [] },
    { ...view("a"), text: 17 }, { ...view("a"), unlinked: { scope: "change", items: [null] } }]) {
    assert.throws(() => graph.parseGraphView(value));
  }
});

test("req-graph поздний ответ A сохраняет уже принятый B", async () => {
  assert.equal(typeof graph.GraphSession, "function");
  const session = new graph.GraphSession();
  let finishA!: (value: any) => void;
  const pending = session.load(() => new Promise((resolve) => { finishA = resolve; }));
  await session.load(async () => view("b"));
  const revision = session.revision;
  session.rendered(revision);
  finishA(view("a"));
  await pending;
  assert.equal(session.current?.elements.label.id, "b");
  assert.equal(session.target(revision, "label")?.id, "b");
});

test("req-graph карта кликов активируется только после успешного текущего рисунка", async () => {
  const session = new graph.GraphSession();
  await session.load(async () => view("a"));
  const a = session.revision;
  assert.equal(session.target(a, "label"), null);
  session.rendered(a);
  assert.equal(session.target(a, "label")?.id, "a");
  await session.load(async () => view("b"));
  session.rendered(a);
  assert.equal(session.target(a, "label"), null);
  session.renderFailed(session.revision);
  assert.equal(session.target(session.revision, "label"), null);
  assert.equal(session.current, null);
});

test("req-graph сбой запроса очищает результат и отклоняет унаследованные ключи", async () => {
  const session = new graph.GraphSession();
  await session.load(async () => view("a"));
  session.rendered(session.revision);
  assert.equal(session.target(session.revision, "constructor"), null);
  assert.equal(session.target(session.revision, "__proto__"), null);
  await session.load(async () => { throw new Error("timeout"); });
  assert.equal(session.current, null);
  assert.equal(session.error, "timeout");
});

test("req-graph поздний отказ прежнего запроса не очищает текущий рисунок", async () => {
  const session = new graph.GraphSession();
  let failA!: (reason: Error) => void;
  const a = session.load(() => new Promise((_, reject) => { failA = reject; }));
  await session.load(async () => view("b"));
  failA(new Error("старый отказ"));
  await a;
  assert.equal(session.current?.elements.label.id, "b");
  assert.equal(session.error, null);
});

test("req-graph вписывает диаграмму даже ниже обычного минимального масштаба", () => {
  assert.equal(graph.graphFit(100000, 50000, 1000, 800), 0.01);
  assert.equal(graph.graphFit(1000, 500, 0, 800), 1);
});
