// Хук клиента: где он нужен, безопасная запись, скрипт из пакета. Без `vscode`: связь с окном и настройками живёт не здесь.
import fs from "node:fs";
import path from "node:path";
import { findTools, viewerDir, viewerRefusal, writeRefusal, type WriteResult } from "./project";
import type { PythonResolution } from "./python";

const SCRIPT = "hook.py";

/** `reason` только у ненайденного Python: остальное значит, что хук здесь не нужен, и говорить не о чем. */
export type HookCondition =
  | { met: true; python: string; claude: boolean; opencode: boolean }
  | { met: false; reason?: string };

function statOf(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}
const isDir = (p: string) => !!statOf(p)?.isDirectory();
const isFile = (p: string) => !!statOf(p)?.isFile();

/** Признак проекта на symphysis: строка в `openspec/config.yaml`, YAML разбирать незачем (F-75, F-98). */
function hasSymphysisSchema(root: string): boolean {
  try {
    return /^﻿?schema:[ \t]+symphysis[ \t]*$/m.test(fs.readFileSync(path.join(root, "openspec", "config.yaml"), "utf8"));
  } catch {
    return false;
  }
}

/** Настройка — абсолютный путь к каталогу установки: инструменты ищутся в нём как в проекте и в нём самом. */
const toolsPathHasTools = (toolsPath: string | undefined) =>
  !!toolsPath && path.isAbsolute(toolsPath) && (findTools(toolsPath) !== null || fs.existsSync(path.join(toolsPath, "journal.py")));

/** `.symphysis/tools/` ставит только symphysis. `tools/` и настройка на всю машину могут оказаться чужими, поэтому нужна схема (F-65, F-75, F-98). */
function hasTools(root: string, toolsPath: string | undefined): boolean {
  const found = findTools(root);
  if (found === path.join(root, ".symphysis", "tools")) return true;
  return (found !== null || toolsPathHasTools(toolsPath)) && hasSymphysisSchema(root);
}

/** Условие установки по папке: след клиента говорит отдельно про каждого (F-60). */
export function hookCondition(root: string, python: PythonResolution, toolsPath?: string): HookCondition {
  if (!isDir(path.join(root, "openspec")) || !hasTools(root, toolsPath)) return { met: false };
  const claude = isDir(path.join(root, ".claude"));
  const opencode = isDir(path.join(root, ".opencode")) || isFile(path.join(root, "opencode.json")) || isFile(path.join(root, "opencode.jsonc"));
  if (!claude && !opencode) return { met: false };
  if (!python.ok) return { met: false, reason: python.reason };
  return { met: true, python: python.path, claude, opencode };
}

/** Через временный файл: обрыв не оставит половину. `wx`: чужой файл или ссылка с именем временного не сработают. */
function replaceFile(file: string, data: string | Buffer): void {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, data, { flag: "wx" });
    fs.renameSync(temp, file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
      try {
        fs.unlinkSync(temp);
      } catch { /* временный файл не создан */ }
    }
    throw e;
  }
}

/** Запись при активации. Отказ и сбой идут значением с причиной. */
export function writeProjectFile(root: string, file: string, data: string | Buffer): WriteResult {
  const refusal = writeRefusal(root, file);
  if (refusal) return { ok: false, reason: refusal };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    replaceFile(file, data);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

function sameBytes(file: string, data: Buffer): boolean {
  try {
    return fs.readFileSync(file).equals(data);
  } catch {
    return false;
  }
}

/** Скрипт исполняется на каждом запросе, поэтому при активации сверяется с пакетным по байтам (F-31, F-63). Совпал — не пишется, время изменения прежнее. */
export function installHookScript(root: string, extensionPath: string): WriteResult {
  const refusal = viewerRefusal(root, SCRIPT);
  if (refusal) return { ok: false, reason: refusal };
  try {
    const packaged = fs.readFileSync(path.join(extensionPath, "hook", SCRIPT));
    const file = path.join(viewerDir(root), SCRIPT);
    if (!sameBytes(file, packaged)) replaceFile(file, packaged);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}
