import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolvePython, runPython } from "../python";
import { tempDir } from "../../../test/temp-dir.mjs";

const real = spawnSync("python", ["-c", "import sys;print(sys.executable)"], { encoding: "utf8" }).stdout.trim();
const realDir = path.dirname(real);
const exe = process.platform === "win32" ? "python.exe" : "python";
const tmp = () => tempDir("symphysis-python-");

test("находит python в PATH и отдаёт абсолютный путь и версию", () => {
  const r = resolvePython({ PATH: realDir }, []);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(path.isAbsolute(r.path));
    assert.match(r.version, /^Python 3\./);
  }
});

test("каталог рабочей области пропускается, даже если он в PATH", () => {
  const r = resolvePython({ PATH: realDir }, [realDir]);
  assert.equal(r.ok, false);
});

test("вложенный в рабочую область каталог тоже пропускается", () => {
  const r = resolvePython({ PATH: realDir }, [path.dirname(realDir)]);
  assert.equal(r.ok, false);
});

test("соседний каталог с тем же началом имени рабочей областью не считается", () => {
  const r = resolvePython({ PATH: realDir }, [realDir + "-другой"]);
  assert.equal(r.ok, true);
});

test("относительный каталог в PATH пропускается", () => {
  const before = process.cwd();
  process.chdir(realDir);
  try {
    assert.equal(resolvePython({ PATH: "." }, []).ok, false);
  } finally {
    process.chdir(before);
  }
});

test("неотвечающий файл пропускается, поиск идёт дальше и называет, что пробовал", () => {
  const dir = tmp();
  const fake = path.join(dir, exe);
  fs.writeFileSync(fake, "не исполняемый файл");
  const r = resolvePython({ PATH: [dir, realDir].join(path.delimiter) }, []);
  assert.equal(r.ok, true);
  const none = resolvePython({ PATH: dir }, []);
  assert.equal(none.ok, false);
  if (!none.ok) assert.deepEqual(none.tried, [fake]);
});

test("Path тоже читается: на Windows переменная бывает в таком написании", () => {
  assert.equal(resolvePython({ Path: realDir }, []).ok, true);
});

test("явный путь настройки: годный используется, относительный и негодный — отказ с причиной", () => {
  const good = resolvePython({ PATH: "" }, [], real);
  assert.equal(good.ok, true);
  const relative = resolvePython({ PATH: realDir }, [], "python");
  assert.equal(relative.ok, false);
  if (!relative.ok) assert.match(relative.reason, /абсолютный путь/);
  const missing = resolvePython({ PATH: realDir }, [], path.join(tmp(), exe));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.reason, /не отвечает/);
});

test("запуск: кириллица в пути, в аргументах и в выводе цела", async () => {
  const dir = path.join(tmp(), "каталог с пробелом");
  fs.mkdirSync(dir);
  const script = path.join(dir, "скрипт.py");
  fs.writeFileSync(script, "import sys\nprint('вывод', sys.argv[1])\nprint('ошибка', file=sys.stderr)\nsys.exit(3)\n", "utf8");
  const r = await runPython(real, [script, "аргумент"], dir);
  assert.equal(r.code, 3);
  assert.equal(r.stdout.trim(), "вывод аргумент");
  assert.equal(r.stderr.trim(), "ошибка");
  assert.equal(r.timedOut, false);
});

test("предел времени: процесс снимается, итог помечен", async () => {
  const dir = tmp();
  const script = path.join(dir, "s.py");
  fs.writeFileSync(script, "import time\ntime.sleep(30)\n");
  const r = await runPython(real, [script], dir, { timeoutMs: 300 });
  assert.equal(r.timedOut, true);
});

test("предел вывода: итог помечен, а не обрезан молча", async () => {
  const dir = tmp();
  const script = path.join(dir, "s.py");
  fs.writeFileSync(script, "print('x' * 5000)\n");
  const r = await runPython(real, [script], dir, { maxBuffer: 1000 });
  assert.equal(r.overflow, true);
});
