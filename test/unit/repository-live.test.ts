// Живой тест структуры: проверка на настоящем дереве плагина (F-25). Правила и тесты на фикстурах — `test/repository-structure.ts`.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { checkRepository } from "../repository-structure";

test("структура репозитория плагина: README корня, README модулей `src/<модуль>/`, места модулей и копии файлов", () => {
  assert.deepEqual(checkRepository(path.resolve(__dirname, "..", "..")), []);
});
