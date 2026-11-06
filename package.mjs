// Упаковка `.vsix`: версия из package.json и короткий хеш коммита, при незакоммиченных правках ещё `.dirty` (F-30, F-84).
// Запись через `+`: только она заменяет прежнюю сборку при любом хеше. С `-` сравнение идёт по алфавиту, и сборка с меньшим хешем молча не ставится (F-121, F-123).
// В package.json хеш не пишется: файл после сборки не меняется.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repo = path.dirname(fileURLToPath(import.meta.url));
/** README пакета: корневой README.md описывает репозиторий, в `.vsix` идёт этот файл — vsce кладёт его как `extension/readme.md` (F-38). */
export const PACKAGE_README = "docs/package-readme.md";
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

export function buildVersion() {
  const { version } = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
  return `${version}+${git("rev-parse", "--short", "HEAD")}${git("status", "--porcelain") ? ".dirty" : ""}`;
}

/** Пакет этой версии в `out`; возвращает итог vsce. */
export function pack(version, out) {
  const flags = ["--no-update-package-json", "--no-dependencies", "--skip-license", "--allow-missing-repository", `--readme-path "${PACKAGE_README}"`];
  return spawnSync(`npx vsce package "${version}" ${flags.join(" ")} --out "${out}"`, { cwd: repo, shell: true, encoding: "utf8" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { name } = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
  const version = buildVersion();
  const out = path.join(repo, `${name}-${version}.vsix`);
  const r = pack(version, out);
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  if (r.status !== 0) process.exit(r.status ?? 1);
  console.log(`PACKED=${out}`);
}
