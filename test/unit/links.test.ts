// Открытие файла по сообщению страницы: путь берётся только из карты последнего показанного вывода (F-44, F-54).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { lineOf, resolveLink, resolveSkill } from "../../src/host/links";
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

const INSTALL = path.resolve("каталог установки");
const SKILLS = [
  { name: "symphysis-proj", path: ".claude/skills/symphysis-proj/SKILL.md", base: "project" as const },
  { name: "symphysis-inst", path: "skills/symphysis-inst/SKILL.md", base: "install" as const },
  { name: "symphysis-stub", path: "skills/symphysis-stub/SKILL.md", base: "install" as const },
  { name: "symphysis-lost", path: null, base: null },
  { name: "symphysis-escape", path: "../чужое/SKILL.md", base: "install" as const },
];

test("«Скилл в проекте»: путь скилла от корня проекта открывается через общую карту", () => {
  const links = { ".claude/skills/symphysis-proj/SKILL.md": ".claude/skills/symphysis-proj/SKILL.md" };
  assert.equal(resolveLink(links, SKILLS[0].path, ROOT), path.join(ROOT, ".claude", "skills", "symphysis-proj", "SKILL.md"));
  assert.equal(resolveSkill(SKILLS, "symphysis-proj", INSTALL), null, "проектный скилл не открывается как скилл установки");
});

test("«Скилл по настройке»: файл из каталога symphysis.toolsPath; заглушка открывается как есть", () => {
  assert.equal(resolveSkill(SKILLS, "symphysis-inst", INSTALL), path.join(INSTALL, "skills", "symphysis-inst", "SKILL.md"));
  assert.equal(resolveSkill(SKILLS, "symphysis-stub", INSTALL), path.join(INSTALL, "skills", "symphysis-stub", "SKILL.md"));
});

test("скилл установки: имени нет в выводе, путь вышел из каталога, настройки или поля нет — файл не открыт", () => {
  for (const name of ["symphysis-escape", "symphysis-lost", "нет такого", "constructor", "__proto__", "", 1, null, { a: 1 }]) assert.equal(resolveSkill(SKILLS, name, INSTALL), null, String(name));
  assert.equal(resolveSkill(SKILLS, "symphysis-inst", undefined), null);
  assert.equal(resolveSkill(undefined, "symphysis-inst", INSTALL), null);
  assert.equal(resolveSkill([{ name: "symphysis-abs", path: path.resolve("чужое", "SKILL.md"), base: "install" }], "symphysis-abs", INSTALL), null);
});
