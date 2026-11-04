// Открытие файла по сообщению страницы: путь берётся только из карты последнего показанного вывода (F-44, F-54).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempDir } from "../temp-dir.mjs";
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

// Скиллы установки лежат на настоящем диске: проверка идёт по реальным путям, поэтому тесты берут настоящие файлы.
const tmp = () => tempDir("symphysis-установка с пробелом-");
const real = (p: string) => fs.realpathSync.native(p);
function skillFile(base: string, rel: string, text = "---\nname: x\n---\n"): string {
  const file = path.join(base, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  return file;
}
const install = (name: string, rel: string | null): { name: string; path: string | null; base: "install" | null } => ({ name, path: rel, base: rel ? "install" : null });

test("«Скилл в проекте»: путь скилла от корня проекта открывается через общую карту", () => {
  const links = { ".claude/skills/symphysis-proj/SKILL.md": ".claude/skills/symphysis-proj/SKILL.md" };
  assert.equal(resolveLink(links, ".claude/skills/symphysis-proj/SKILL.md", ROOT), path.join(ROOT, ".claude", "skills", "symphysis-proj", "SKILL.md"));
  const project = { name: "symphysis-proj", path: ".claude/skills/symphysis-proj/SKILL.md", base: "project" as const };
  assert.equal(resolveSkill([project], "symphysis-proj", ROOT), null, "проектный скилл не открывается как скилл установки");
});

test("«Скилл по настройке»: файл из каталога symphysis.toolsPath; заглушка открывается как есть", () => {
  const dir = tmp();
  skillFile(dir, "skills/symphysis-inst/SKILL.md");
  skillFile(dir, "skills/symphysis-stub/SKILL.md", "Заглушка: скилл в этой установке не развёрнут\n");
  const skills = [install("symphysis-inst", "skills/symphysis-inst/SKILL.md"), install("symphysis-stub", "skills/symphysis-stub/SKILL.md")];
  assert.equal(resolveSkill(skills, "symphysis-inst", dir), real(path.join(dir, "skills", "symphysis-inst", "SKILL.md")));
  assert.equal(resolveSkill(skills, "symphysis-stub", dir), real(path.join(dir, "skills", "symphysis-stub", "SKILL.md")));
});

test("скилл установки: имени нет в выводе, путь вышел из каталога, настройки или поля нет, файла нет — файл не открыт", () => {
  const dir = tmp(), outside = tmp();
  skillFile(dir, "skills/symphysis-inst/SKILL.md");
  skillFile(outside, "SKILL.md");
  const skills = [install("symphysis-inst", "skills/symphysis-inst/SKILL.md"), install("symphysis-lost", null), install("symphysis-escape", path.relative(dir, path.join(outside, "SKILL.md"))),
    install("symphysis-absent", "skills/symphysis-absent/SKILL.md"), install("symphysis-abs", path.join(outside, "SKILL.md"))];
  for (const name of ["symphysis-escape", "symphysis-lost", "symphysis-absent", "symphysis-abs", "нет такого", "constructor", "__proto__", "", 1, null, { a: 1 }]) assert.equal(resolveSkill(skills, name, dir), null, String(name));
  assert.equal(resolveSkill(skills, "symphysis-inst", undefined), null);
  assert.equal(resolveSkill(undefined, "symphysis-inst", dir), null);
});

test("скилл установки: junction внутри каталога на каталог снаружи файл не открывает", () => {
  const dir = tmp(), outside = tmp();
  skillFile(outside, "symphysis-leak/SKILL.md");
  fs.mkdirSync(path.join(dir, "skills"), { recursive: true });
  fs.symlinkSync(outside, path.join(dir, "skills", "linked"), "junction");
  assert.ok(fs.existsSync(path.join(dir, "skills", "linked", "symphysis-leak", "SKILL.md")), "junction не создалась");
  assert.equal(resolveSkill([install("symphysis-leak", "skills/linked/symphysis-leak/SKILL.md")], "symphysis-leak", dir), null);
});

test("скилл установки: каталог с именем `..x` внутри установки не принимают за выход наружу", () => {
  const dir = tmp();
  skillFile(dir, "..x/symphysis-dots/SKILL.md");
  assert.equal(resolveSkill([install("symphysis-dots", "..x/symphysis-dots/SKILL.md")], "symphysis-dots", dir), real(path.join(dir, "..x", "symphysis-dots", "SKILL.md")));
});
