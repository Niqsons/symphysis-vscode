// Листание справки живёт, пока показано то же изменение (ключ каталога, а не имя): решение вынесено из страницы в чистую функцию.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { HelpView } from "../../protocol/protocol";
import type { StepHelpOutput } from "../../protocol/types";
import { keepShown, type ShownState } from "../helpShown";

const output = (...ids: string[]) => ({ steps: ids.map((id) => ({ id })) } as unknown as StepHelpOutput);
const view = (key: string | null, out: StepHelpOutput | null): HelpView => ({
  panel: "help", key, name: key && key.split("/").pop()!, pluginVersion: "0.2.0", outcome: out ? { kind: "output", root: "D:/п", output: out } : null,
});
const at = (key: string | null, step: string | null, rules = false): ShownState => ({ key, shown: { step, rules } });

test("новый расчёт того же изменения: страница и правила остаются", () => {
  assert.deepEqual(keepShown(at("А/демо", "archive", true), view("А/демо", output("intent", "archive"))), at("А/демо", "archive", true));
});

test("ответа ещё нет: листание не трогается", () => {
  assert.deepEqual(keepShown(at("А/демо", "archive"), view("А/демо", null)), at("А/демо", "archive"));
});

test("другое изменение: возврат к текущему шагу", () => {
  assert.deepEqual(keepShown(at("А/демо", "archive", true), view("А/другое", output("intent", "archive"))), at("А/другое", null));
});

test("открытого шага больше нет: текущий, правила сохраняются", () => {
  assert.deepEqual(keepShown(at("А/демо", "archive", true), view("А/демо", output("intent", "specs"))), at("А/демо", null, true));
});

test("две папки с одноимённым изменением: имя то же, ключ разный, листание сброшено", () => {
  const next = keepShown(at("первая/openspec/changes/демо", "archive"), view("вторая/openspec/changes/демо", output("intent", "archive")));
  assert.deepEqual(next, at("вторая/openspec/changes/демо", null));
});

test("без изменения: ключ null остаётся тем же, листание живёт", () => {
  assert.deepEqual(keepShown(at(null, "archive"), view(null, output("intent", "archive"))), at(null, "archive"));
});
