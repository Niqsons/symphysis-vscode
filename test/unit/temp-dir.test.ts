// Тесты не оставляют каталогов в системном: иначе каждый прогон съедает диск, а зелёный итог этого не показывает.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { tempDir } from "../temp-dir.mjs";

const TEST_ROOT = path.resolve(__dirname, "..", "..", "test");
const helper = pathToFileURL(path.join(TEST_ROOT, "temp-dir.mjs")).href;

/** Отдельный процесс создаёт каталог с кириллицей в имени и файлом в глубине, печатает путь и выполняет `tail`. */
function child(tail: string): { status: number | null; dir: string; stderr: string } {
  const base = tempDir("symphysis-снятие-");
  const code = `
    import fs from "node:fs";
    import path from "node:path";
    import { keepTemp, tempDir } from ${JSON.stringify(helper)};
    const dir = tempDir("symphysis-проба кириллицы-");
    fs.mkdirSync(path.join(dir, "вложенный каталог"));
    fs.writeFileSync(path.join(dir, "вложенный каталог", "файл.json"), "{}");
    console.log(dir);
    ${tail}
  `;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", env: { ...process.env, TEMP: base, TMP: base, TMPDIR: base } });
  return { status: r.status, dir: r.stdout.trim().split("\n")[0], stderr: r.stderr };
}

test("каталог с кириллицей в имени снимается при выходе процесса", () => {
  const r = child("");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.dir, /symphysis-проба кириллицы-/);
  assert.equal(fs.existsSync(r.dir), false);
});

test("упавший процесс тоже снимает свой каталог", () => {
  const r = child('throw new Error("падение");');
  assert.equal(r.status, 1);
  assert.equal(fs.existsSync(r.dir), false);
});

test("каталог, оставленный для разбора, остаётся на месте", () => {
  const r = child("keepTemp(dir);");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(r.dir, "вложенный каталог", "файл.json")));
});

test("тесты создают каталоги только через tempDir", () => {
  const self = /(^|[\\/])temp-dir\.(mjs|test\.ts)$/;
  const sources = (fs.readdirSync(TEST_ROOT, { recursive: true }) as string[]).filter((f) => /\.(m?js|tsx?)$/.test(f) && !self.test(f));
  const direct = sources.filter((f) => /\bmkdtemp/.test(fs.readFileSync(path.join(TEST_ROOT, f), "utf8")));
  assert.deepEqual(direct, []);
});
