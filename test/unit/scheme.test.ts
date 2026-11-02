// Разбор `scheme.md` и правила вкладки. Набор разбора общий с ядром: две реализации сверяются одними случаями.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hasNodes, inNode } from "../../src/shared/ops";
import { blocksNote, fitScale, isClick, MAX_SCALE, MIN_SCALE, nodeIdOf, nodeInScheme, parseScheme, zoomIn, zoomOut } from "../../src/shared/scheme";
import { noCoreReason, SYMPHYSIS } from "./fixture-project";
import { fork, payload } from "./helpers";

const opts = { skip: noCoreReason };

test("разбор совпадает с ядром по общему набору случаев", opts, () => {
  const cases = JSON.parse(fs.readFileSync(path.join(SYMPHYSIS, "tests", "fixtures", "scheme", "cases.json"), "utf8")) as { name: string; text: string; expect: unknown }[];
  assert.ok(cases.length >= 10);
  for (const c of cases) assert.deepEqual(parseScheme(c.text), c.expect, c.name);
});

test("версия mermaid совпадает с инсталлятором: один файл не должен рисоваться по-разному (F-53)", opts, () => {
  const own = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", "package.json"), "utf8")).devDependencies.mermaid;
  const core = JSON.parse(fs.readFileSync(path.join(SYMPHYSIS, "installer", "package.json"), "utf8")).devDependencies.mermaid;
  assert.equal(own, core);
  assert.match(own, /^\d+\.\d+\.\d+$/, "версия закреплена точно");
});

test("подпись про несколько блоков", () => {
  assert.equal(blocksNote(2), "в файле 2 блока, показан первый");
  assert.equal(blocksNote(5), "в файле 5 блоков, показан первый");
});

test("идентификатор узла: кириллица и дефис внутри, чужой элемент — нет", () => {
  assert.equal(nodeIdOf("scheme1-flowchart-A-0"), "A");
  assert.equal(nodeIdOf("scheme1-flowchart-узел1-12"), "узел1");
  assert.equal(nodeIdOf("scheme1-flowchart-a-b-3"), "a-b");
  assert.equal(nodeIdOf("flowchart-A-0"), null);
});

test("Регистр и кириллица: сравнение дословное, узел не найден (F-87)", () => {
  const text = "flowchart TD\n  узел1[подпись] --> B\n";
  assert.equal(nodeInScheme(text, "узел1"), true);
  assert.equal(nodeInScheme(text, "Узел1"), false);
  assert.equal(nodeInScheme(text, "узел"), false, "часть слова не считается");
  assert.equal(nodeInScheme(text, "B"), true);
});

test("Тест-страховка F-68: сдвиг 0 и 3 — клик, 4 — перетаскивание", () => {
  assert.equal(isClick(0, 0), true);
  assert.equal(isClick(3, -3), true);
  assert.equal(isClick(4, 0), false);
  assert.equal(isClick(0, -4), false);
});

test("Тест-страховка F-67: двадцать раз «−» не убирают рисунок, «+» его возвращает", () => {
  let scale = 1;
  for (let i = 0; i < 20; i++) scale = zoomOut(scale);
  assert.equal(scale, MIN_SCALE);
  const back = zoomIn(scale);
  assert.ok(back > scale);
  for (let i = 0; i < 40; i++) scale = zoomIn(scale);
  assert.equal(scale, MAX_SCALE);
});

test("«Вписать» на маленькой схеме: 100 %, не растягивает; большая уменьшается (F-69)", () => {
  assert.equal(fitScale(100, 100, 800, 600), 1);
  assert.equal(fitScale(1600, 300, 800, 600), 0.5);
  assert.equal(fitScale(300, 2400, 800, 600), 0.25);
});

test("Пустой список: запись ведёт себя как без поля, журнал не считается связанным со схемой (F-73, F-86)", () => {
  const none = payload([fork("F-01"), fork("F-02", { nodes: [] })]);
  assert.equal(hasNodes(none), false);
  assert.equal(inNode(none.records[1], "A"), false);
  const some = payload([fork("F-01", { nodes: ["A", "B"] })]);
  assert.equal(hasNodes(some), true);
  assert.equal(inNode(some.records[0], "B"), true);
  assert.equal(inNode(some.records[0], "b"), false);
});
