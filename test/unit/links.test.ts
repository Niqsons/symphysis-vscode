// Открытие файла по сообщению страницы: путь берётся только из карты последнего показанного вывода (F-44, F-54).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { lineOf, resolveLink } from "../../src/host/links";
import { linkOf, splitLink } from "../../src/shared/links";

const ROOT = path.resolve("проект с пробелом");
const A = { "док ументы/файл один.md": "док ументы/файл один.md", "vscode/a.ts": "../symphysis-vscode/src/a.ts", "логотип.png": "media/логотип.png" };
const B = { "другой.md": "другой.md" };

test("ключ из карты даёт путь от корня проекта, в том числе вверх от него", () => {
  assert.equal(resolveLink(A, "док ументы/файл один.md", ROOT), path.join(ROOT, "док ументы", "файл один.md"));
  assert.equal(resolveLink(A, "vscode/a.ts", ROOT), path.resolve(ROOT, "..", "symphysis-vscode", "src", "a.ts"));
});

test("«Ключ не из карты»: путь наружу и произвольный путь файла не открывают", () => {
  for (const key of ["../../секрет.txt", "нет.md", "C:/Windows/win.ini", "", "док ументы/файл один.md:2"]) assert.equal(resolveLink(A, key, ROOT), null, key);
  for (const key of [1, null, undefined, { a: 1 }, ["док ументы/файл один.md"]]) assert.equal(resolveLink(A, key, ROOT), null);
});

test("«Журнал сменился»: ключ только из карты А при показе Б файла не открывает", () => {
  assert.equal(resolveLink(B, "док ументы/файл один.md", ROOT), null);
  assert.ok(resolveLink(B, "другой.md", ROOT));
});

test("ключи `constructor` и `__proto__` и `toString` файла не открывают, даже если карта есть", () => {
  for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.equal(resolveLink(A, key, ROOT), null, key);
    assert.equal(linkOf(A, key), null, key);
  }
});

test("карты нет (старое ядро) или корня нет: открывать нечего", () => {
  assert.equal(resolveLink(undefined, "a.md", ROOT), null);
  assert.equal(resolveLink(null, "a.md", ROOT), null);
  assert.equal(resolveLink(A, "логотип.png", undefined), null);
});

test("ссылка на PNG разбирается как любая: открытие идёт через vscode.open, не как текст", () => {
  assert.equal(resolveLink(A, "логотип.png", ROOT), path.join(ROOT, "media", "логотип.png"));
});

test("хвост :строка отделяется тем же правилом, что у ядра; диапазон берёт первую строку", () => {
  assert.deepEqual(splitLink("a.md:2"), { key: "a.md", line: 2 });
  assert.deepEqual(splitLink("a.md:2-5"), { key: "a.md", line: 2 });
  assert.deepEqual(splitLink("a.md"), { key: "a.md", line: null });
  assert.deepEqual(splitLink("a.md:0"), { key: "a.md", line: null });
  assert.deepEqual(splitLink("a:b.md"), { key: "a:b.md", line: null });
  assert.deepEqual(linkOf({ "a.md": "a.md" }, "a.md:2-5"), { key: "a.md", line: 2 });
});

test("номер строки из сообщения: только целое от 1", () => {
  assert.equal(lineOf(3), 3);
  for (const v of [0, -1, 1.5, "2", null, undefined, NaN]) assert.equal(lineOf(v), null);
});
