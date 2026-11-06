// Сборка юнит-тестов (F-23, F-62): тест модуля лежит в `src/<модуль>/test/`, `npm test` собирает его в `out/test/` и запускает.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(__dirname, "..", "..");
const testNames = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.test\.tsx?$/.test(f)).map((f) => f.replace(/\.tsx?$/, "")) : []);

test("«Юнит-тест модуля плагина собирается»: каждый тест из `src/<модуль>/test/` и `test/unit/` собран в `out/test/`, лишних нет", () => {
  const modules = fs.readdirSync(path.join(REPO, "src"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const inModules = modules.flatMap((m) => testNames(path.join(REPO, "src", m, "test")));
  assert.ok(inModules.length > 0, "в каталогах модулей нет ни одного теста");
  const sources = [...testNames(path.join(REPO, "test", "unit")), ...inModules].sort();
  const built = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js")).map((f) => f.replace(/\.js$/, "")).sort();
  assert.deepEqual(built, sources);
});

test("«Юнит-тест модуля плагина собирается»: `npm test` запускает всё, что собрано в `out/test/`", () => {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
  assert.match(scripts.test, /node build\.mjs --unit && node --test "out\/test\/\*\.test\.js"/);
});
