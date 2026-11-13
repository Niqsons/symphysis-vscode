// Упаковка `.vsix`: версия из package.json и короткий хеш коммита, при незакоммиченных правках ещё `.dirty` (F-30, F-84).
// Запись через `+`: только она заменяет прежнюю сборку при любом хеше. С `-` сравнение идёт по алфавиту, и сборка с меньшим хешем молча не ставится (F-121, F-123).
// В package.json хеш не пишется: файл после сборки не меняется.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkWorktreePath } from "./test/worktree-paths.mjs";

export const repo = path.dirname(fileURLToPath(import.meta.url));
/** README пакета: корневой README.md описывает репозиторий, в `.vsix` идёт этот файл — vsce кладёт его как `extension/readme.md` (F-38). */
export const PACKAGE_README = "docs/package-readme.md";
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const BASE_VERSION = "(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)";

export function buildVersion() {
  const { version } = JSON.parse(fs.readFileSync(checkWorktreePath(repo, "package.json", { required: true }), "utf8"));
  if (typeof version !== "string" || !new RegExp(`^${BASE_VERSION}$`).test(version))
    throw new Error("В package.json ожидается версия MAJOR.MINOR.PATCH");
  return `${version}+${git("rev-parse", "--short", "HEAD")}${git("status", "--porcelain") ? ".dirty" : ""}`;
}

/** Пакет этой версии в `out`; возвращает итог vsce. */
export function pack(version, out) {
  if (!new RegExp(`^${BASE_VERSION}\\+[a-z0-9]+(?:\\.dirty)?$`).test(version))
    throw new Error("Некорректная версия VSIX");
  const cli = checkWorktreePath(repo, "node_modules/@vscode/vsce/vsce", { required: true });
  checkWorktreePath(repo, PACKAGE_README, { required: true });
  const output = checkWorktreePath(path.dirname(out), path.basename(out));
  const flags = ["--no-update-package-json", "--no-dependencies", "--skip-license", "--allow-missing-repository",
    "--readme-path", PACKAGE_README, "--out", output];
  return spawnSync(process.execPath, [cli, "package", version, ...flags], { cwd: repo, encoding: "utf8" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { name } = JSON.parse(fs.readFileSync(checkWorktreePath(repo, "package.json", { required: true }), "utf8"));
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*$/i.test(name))
    throw new Error("Некорректное имя расширения в package.json");
  const version = buildVersion();
  const filename = `${name}-${version}.vsix`;
  const out = checkWorktreePath(repo, filename);
  const r = pack(version, out);
  if (r.error) throw r.error;
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  if (r.status !== 0) process.exit(r.status ?? 1);
  console.log(`PACKED=${out}`);
}
