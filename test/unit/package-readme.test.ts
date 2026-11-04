// Описание хука в пакете: README.md репозитория проходит проверку, отказ называет, чего нет.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertReadme, readmeMissing, readReadme } from "../package-readme";
import { tempDir } from "../temp-dir.mjs";

const REPO_README = path.resolve(__dirname, "..", "..", "README.md");

test("«Описание в пакете»: README.md репозитория называет записи, настройку и ручную уборку", () => {
  assert.deepEqual(readmeMissing(readReadme(REPO_README)), []);
});

test("«Описание в пакете»: README.md не исключён из пакета и лежит рядом с package.json", () => {
  const ignore = fs.readFileSync(path.resolve(__dirname, "..", "..", ".vscodeignore"), "utf8").split(/\r?\n/);
  assert.ok(ignore.includes("!README.md"), ".vscodeignore не пропускает README.md");
});

test("«Описания нет»: текст без строк даёт отказ с названием недостающего", () => {
  assert.throws(() => assertReadme("# Symphysis\n\nПросто текст."), (e: Error) => /symphysis\.hook\.enabled/.test(e.message) && /\.git\/info\/exclude/.test(e.message));
});

test("«Описания нет»: одной недостающей строки хватает для отказа, названа только она", () => {
  const full = fs.readFileSync(REPO_README, "utf8");
  const without = full.replaceAll("symphysis.hook.enabled", "настройка");
  assert.deepEqual(readmeMissing(without), ["настройка symphysis.hook.enabled"]);
});

test("«Описания нет»: файла нет — отказ называет файл", () => {
  const dir = tempDir("symphysis-readme-");
  const file = path.join(dir, "каталог с пробелом", "README.md");
  assert.equal(readReadme(file), null);
  assert.throws(() => assertReadme(readReadme(file)), /файла README\.md/);
});
