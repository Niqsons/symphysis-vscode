// README пакета: отдельный файл `docs/package-readme.md`, упаковка передаёт его vsce, корневой README.md описывает репозиторий и в пакет не идёт (F-38).
// Описание хука в README пакета проходит проверку, отказ называет, чего нет и что лишнее.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertReadme, readmeForeign, readmeMissing, readReadme } from "../package-readme";
import { tempDir } from "../temp-dir.mjs";

const REPO = path.resolve(__dirname, "..", "..");
const PACKAGE_README = path.join(REPO, "docs", "package-readme.md");

test("«Описание в пакете»: README пакета называет записи, настройку и ручную уборку", () => {
  assert.deepEqual(readmeMissing(readReadme(PACKAGE_README)), []);
});

test("«Пакет несёт README пакета»: в README пакета нет frontmatter модуля и строк о каталогах репозитория", () => {
  assert.deepEqual(readmeForeign(fs.readFileSync(PACKAGE_README, "utf8")), []);
});

test("«Пакет несёт README пакета»: упаковка передаёт vsce файл README пакета, корневой README.md в пакет не идёт", () => {
  const packaging = fs.readFileSync(path.join(REPO, "package.mjs"), "utf8");
  assert.match(packaging, /export const PACKAGE_README = "docs\/package-readme\.md";/);
  assert.match(packaging, /`--readme-path "\$\{PACKAGE_README\}"`/);
  const ignore = fs.readFileSync(path.join(REPO, ".vscodeignore"), "utf8").split(/\r?\n/);
  // С `!README.md` корневой README и README по флагу сталкиваются в `extension/readme.md`, и пакет не собирается (research/F-32).
  assert.ok(!ignore.some((line) => /^!\s*readme\.md$/i.test(line.trim())), ".vscodeignore пропускает корневой README.md в пакет");
});

test("«Описания нет»: текст без строк даёт отказ с названием недостающего", () => {
  assert.throws(() => assertReadme("# Symphysis\n\nПросто текст."), (e: Error) => /symphysis\.hook\.enabled/.test(e.message) && /\.git\/info\/exclude/.test(e.message));
});

test("«Описания нет»: одной недостающей строки хватает для отказа, названа только она", () => {
  const full = fs.readFileSync(PACKAGE_README, "utf8");
  const without = full.replaceAll("symphysis.hook.enabled", "настройка");
  assert.deepEqual(readmeMissing(without), ["настройка symphysis.hook.enabled"]);
});

test("«Описания нет»: файла нет — отказ называет файл", () => {
  const dir = tempDir("symphysis-readme-");
  const file = path.join(dir, "каталог с пробелом", "README.md");
  assert.equal(readReadme(file), null);
  assert.throws(() => assertReadme(readReadme(file)), /файла README\.md/);
});

test("«Лишнее в README пакета»: frontmatter модуля и строка о каталоге репозитория — отказ с названием", () => {
  const full = fs.readFileSync(PACKAGE_README, "utf8");
  assert.throws(() => assertReadme(`---\nname: plugin\nkind: доменный\n---\n${full}`), /лишнее: frontmatter/);
  assert.throws(() => assertReadme(`${full}\n- [src/](src/) — контур разработки: исходники\n`), /лишнее: строка о каталоге/);
  assert.deepEqual(readmeForeign("- [ссылка](docs/) — модуль упомянут в тексте\nтекст\n---\nвнутри\n"), []);
});
