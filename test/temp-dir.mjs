// Временные каталоги тестов снимаются при выходе процесса: иначе каждый прогон оставляет их в системном каталоге, а зелёный итог этого не показывает.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ATTEMPTS = 20;
const WAIT_MS = 500;
const made = new Set();

/** Обходом, а не `fs.rmSync`: в Node 24 на Windows он молча ничего не снимает, если в имени каталога кириллица. */
function removeTree(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) removeTree(full);
    else fs.unlinkSync(full);
  }
  fs.rmdirSync(dir);
}

/** Закрывшийся VS Code ещё держит файлы профиля, поэтому снятие повторяется. Не вышло — об этом сказано вслух: молчание и привело к горе каталогов. */
function removeWithRetries(dir) {
  let reason = "ошибки не было";
  for (let attempt = 0; attempt < ATTEMPTS && fs.existsSync(dir); attempt++) {
    if (attempt) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, WAIT_MS);
    try {
      removeTree(dir);
    } catch (e) {
      reason = e.message;
    }
  }
  if (fs.existsSync(dir)) console.error(`не снят временный каталог ${dir}: ${reason}`);
}

export function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.add(dir);
  return dir;
}

/** Каталог упавшего прогона нужен для разбора: профиль и журналы VS Code лежат в нём. */
export function keepTemp(dir) {
  made.delete(dir);
}

process.on("exit", () => {
  for (const dir of made) removeWithRetries(dir);
});
