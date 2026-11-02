// Сквозной сценарий в настоящем VS Code: боковая панель, страница, настоящий Python и настоящее ядро, путь с кириллицей и пробелами.
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import * as crypto from "node:crypto";
import { emptyDraft } from "../../src/shared/logic";
import { search } from "../../src/shared/search";
import { results, sleep, step, until } from "./steps";

interface Api {
  store: { list(): any[]; get(key: string): any; sync(): void };
  viewer: { messages: vscode.EventEmitter<any>; webview: vscode.Webview | null; currentKey: string | null; findWidget: boolean; restore(panel: vscode.WebviewPanel): void };
  scheme: { messages: vscode.EventEmitter<any>; webview: vscode.Webview | null; restore(panel: vscode.WebviewPanel): void };
  changes: { getTreeItem(state: any): vscode.TreeItem };
  toc: { getTreeItem(rec: any): vscode.TreeItem };
  attackToc: { getChildren(node?: any): any[]; getTreeItem(node: any): vscode.TreeItem; message(): string | undefined };
  search: { messages: vscode.EventEmitter<any>; webview: vscode.Webview | null };
}

const measures: Record<string, unknown> = {};

export async function run(): Promise<void> {
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const changesDir = path.join(root, "openspec", "changes");
  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === "symphysis-vscode")!;
  const t0 = Date.now();
  const api = (await ext.activate()) as Api;
  const key = (name: string) => path.join(changesDir, name);
  const one = key("изменение-один");
  const journal = path.join(one, "decisions.json");

  const driver = (webview: () => vscode.Webview | null, messages: vscode.EventEmitter<any>) => {
    let seq = 0;
    const pending = new Map<number, (m: any) => void>();
    messages.event((m: any) => {
      if (m.type === "driven") {
        pending.get(m.seq)?.(m);
        pending.delete(m.seq);
      }
    });
    return async (action: string, args: Record<string, unknown> = {}): Promise<any> => {
      const id = ++seq;
      const reply = new Promise<any>((resolve, reject) => {
        pending.set(id, resolve);
        setTimeout(() => reject(new Error(`водитель молчит: ${action}`)), 10000);
      });
      await webview()!.postMessage({ type: "drive", seq: id, action, ...args });
      const m = await reply;
      if (m.error) throw new Error(m.error);
      return m.result;
    };
  };
  const drive = driver(() => api.viewer.webview, api.viewer.messages);
  const searchDrive = driver(() => api.search.webview, api.search.messages);
  const snap = () => drive("snapshot");
  const treeItem = (node: any) => api.attackToc.getTreeItem(node);
  const clickTree = (node: any) => {
    const c = treeItem(node).command!;
    return vscode.commands.executeCommand(c.command, ...(c.arguments ?? []));
  };

  await step("перечень изменений: без archive, с кириллицей, журнал без файла назван", async () => {
    const names = await until<string[] | null>("перечень", () => {
      const list = api.store.list();
      return list.length >= 3 && list.every((s: any) => !s.loading) ? list.map((s: any) => s.ref.name) : null;
    }) as string[];
    assert.ok(names.includes("изменение-один"));
    assert.ok(names.includes("без-журнала"));
    assert.ok(!names.includes("archive"));
    assert.equal(api.store.get(key("без-журнала")).failure.kind, "no-journal");
    assert.equal(api.store.get(one).payload.records.length, 4);
    measures.firstListMs = Date.now() - t0;
  });

  await step("открытие: карточки на месте, CSP без нарушений", async () => {
    const t1 = Date.now();
    await vscode.commands.executeCommand("symphysis.openChange", one);
    const s = await until("карточки", async () => {
      if (!api.viewer.webview) return null;
      const r = await drive("snapshot").catch(() => null);
      return r?.cards.length === 4 ? r : null;
    });
    measures.openMs = Date.now() - t1;
    assert.deepEqual(s.cards, ["F-01", "F-02", "F-03", "F-04"]);
    assert.match(s.title, /изменение-один/);
    assert.match(s.stats, /развилок 3/);
    assert.deepEqual(s.violations, []);
    assert.equal(s.applyDisabled, true);
    assert.match(s.prompt, /нового нет/);
  });

  await step("улики сверены: сигнальная и побочная на своих местах", async () => {
    const html = await drive("cardHtml", { id: "F-02" });
    assert.match(html, /class="signal"[^>]*>не найдено: цитаты нет дословно/);
    assert.match(html, /class="muted"[^>]*>сверено/);
    assert.match(html, /маловероятно: браузера в VS Code нет/);
    assert.match(html, /отступление от F-01/);
  });

  await step("выбор и слово: промпт обновляется, черновик ложится в файл", async () => {
    await drive("choose", { id: "F-02", letter: "A" });
    const s = await drive("word", { id: "F-02", text: "файлы рядом" });
    assert.match(s.prompt, /- F-02: A — «файлы рядом»/);
    assert.equal(s.applyDisabled, false);
    const draftFile = path.join(root, ".symphysis", "viewer", "изменение-один.json");
    await until("файл черновика", () => fs.existsSync(draftFile) && JSON.parse(fs.readFileSync(draftFile, "utf8")).decisions["F-02"]?.word === "файлы рядом");
    assert.equal(fs.readFileSync(path.join(root, ".symphysis", "viewer", ".gitignore"), "utf8"), "*\n");
  });

  await step("антипод: F-03.B при выбранном F-02.A проходит, пара видна у обоих, в промпте обе строки", async () => {
    await drive("choose", { id: "F-03", letter: "B" });
    assert.match(await drive("cardHtml", { id: "F-03" }), /антипод уже выбран: F-02\.A/);
    assert.match(await drive("cardHtml", { id: "F-02" }), /антипод уже выбран: F-03\.B/);
    const s = await snap();
    assert.match(s.prompt, /- F-02: A/);
    assert.match(s.prompt, /- F-03: B/);
    await drive("choose", { id: "F-03", letter: "A" });
  });

  await step("журнал изменён снаружи: карточка обновляется без кнопки, черновик цел, уведомление названо", async () => {
    const data = JSON.parse(fs.readFileSync(journal, "utf8"));
    data.records.push({ ...data.records[3], id: "F-05", question: "Новая развилка от агента", depends_on: [], outcome: null });
    const t1 = Date.now();
    fs.writeFileSync(journal, JSON.stringify(data, null, 1), "utf8");
    const s = await until("новая карточка", async () => {
      const r = await snap();
      return r.cards.includes("F-05") ? r : null;
    });
    measures.freshnessMs = Date.now() - t1;
    assert.match(s.notes.join(" "), /новые записи: F-05/);
    assert.match(s.prompt, /- F-02: A — «файлы рядом»/);
  });

  await step("негодный журнал: сигнал с текстом ядра, прежние карточки на месте, «Внести» закрыто", async () => {
    const good = fs.readFileSync(journal, "utf8");
    fs.writeFileSync(journal, '{"title": "обрыв', "utf8");
    const s = await until("отказ", async () => {
      const r = await snap();
      return r.notes.some((n: string) => n.includes("Журнал негоден")) ? r : null;
    });
    assert.ok(s.cards.includes("F-02"));
    assert.equal(s.applyDisabled, true);
    fs.writeFileSync(journal, good, "utf8");
    await until("восстановление", async () => {
      const r = await snap();
      return !r.notes.some((n: string) => n.includes("Журнал негоден")) && r.applyDisabled === false;
    });
  });

  await step("«Внести»: ответ в answers/, журнал изменён настоящим apply, производные собраны, черновик очищен", async () => {
    const s = await drive("click", { text: "Внести" });
    assert.ok(s.prompt.includes("F-02"));
    const after = await until("отчёт", async () => {
      const r = await snap();
      return r.report && !/Вношу/.test(r.report) ? r : null;
    }, 20000);
    assert.match(after.report, /\[ok\] F-02: решено A/);
    const files = fs.readdirSync(path.join(one, "answers"));
    assert.equal(files.length, 1);
    assert.match(fs.readFileSync(path.join(one, "answers", files[0]), "utf8"), /- F-02: A — «файлы рядом»/);
    assert.equal(JSON.parse(fs.readFileSync(journal, "utf8")).records[1].decision.option, "A");
    assert.ok(fs.existsSync(path.join(one, "decisions.md")));
    assert.ok(fs.existsSync(path.join(one, "decisions.html")));
    const clean = await until("очистка черновика", async () => {
      const r = await snap();
      return /нового нет/.test(r.prompt) ? r : null;
    });
    assert.equal(clean.applyDisabled, true);
    assert.match(clean.stats, /решено 2/);
  });

  await step("своё внесение не называется обновлением снаружи", async () => {
    await sleep(600);
    const s = await snap();
    assert.equal(s.notes.filter((n: string) => n.includes("обновлён снаружи") && !n.includes("F-05")).length, 0);
  });

  await step("отказ apply: журнал не тронут, запись названа, файла ответа не прибавилось", async () => {
    // Вариант, которого нет в журнале, появляется, если агент убрал вариант после того, как человек его выбрал.
    await drive("choose", { id: "F-04", letter: "B" });
    await until("черновик F-04", async () => /F-04: B/.test((await snap()).prompt));
    const data = JSON.parse(fs.readFileSync(journal, "utf8"));
    data.records[3].options = data.records[3].options.filter((o: any) => o.letter !== "B");
    fs.writeFileSync(journal, JSON.stringify(data, null, 1), "utf8");
    // Клик раньше, чем страница успела перечитать: сверка хеша останавливает внесение, файла ответа нет.
    const answersBefore = fs.readdirSync(path.join(one, "answers")).length;
    await drive("click", { text: "Внести" });
    const stale = await until("отчёт об устаревшем показе", async () => {
      const x = await snap();
      return x.report && /изменён после показа/.test(x.report) ? x : null;
    });
    assert.match(stale.report, /Ничего не внесено/);
    assert.equal(fs.readdirSync(path.join(one, "answers")).length, answersBefore);
    await until("перечитано", async () => !/value="B"/.test(await drive("cardHtml", { id: "F-04" })));
    const before = fs.readFileSync(journal);
    await drive("click", { text: "Внести" });
    let seen: unknown = null;
    const r = await until("отчёт об отказе", async () => {
      const x = await snap();
      seen = { report: x.report, prompt: x.prompt, disabled: x.applyDisabled };
      return x.report && /отказал/.test(x.report) ? x : null;
    }, 8000).catch((e) => { throw new Error(`${e.message}; страница: ${JSON.stringify(seen)}`); });
    assert.match(r.report, /F-04: варианта B нет/);
    assert.ok(before.equals(fs.readFileSync(journal)));
    assert.equal(fs.readdirSync(path.join(one, "answers")).length, 1);
    await drive("click", { id: "F-04", text: "снять выбор B" });
  });

  await step("цвета: настройка уровня сразу попадает в страницу", async () => {
    await vscode.workspace.getConfiguration("symphysis.colors").update("signal", "#123456", vscode.ConfigurationTarget.Global);
    await until("новый цвет", async () => (await snap()).signalColor === "#123456");
    await vscode.workspace.getConfiguration("symphysis.colors").update("signal", undefined, vscode.ConfigurationTarget.Global);
    await until("цвет по умолчанию", async () => (await snap()).signalColor.toLowerCase() === "#ff5555");
  });

  await step("оглавление: переход к записи прокручивает к ней и снимает фильтр", async () => {
    const filtered = await drive("filter", { name: "открытые" });
    assert.ok(!filtered.cards.includes("F-01"));
    await vscode.commands.executeCommand("symphysis.revealRecord", "F-01");
    await until("карточка видна", async () => (await drive("cardVisible", { id: "F-01" })).inView);
    const s = await snap();
    assert.ok(s.cards.includes("F-01"));
  });

  await step("ссылка зависимости переводит к записи", async () => {
    await until("F-04 в начале", async () => {
      await vscode.commands.executeCommand("symphysis.revealRecord", "F-04");
      return (await drive("cardVisible", { id: "F-04" })).inView;
    });
    await drive("followDependency", { id: "F-04", dep: "F-02" });
    await until("F-02 видна", async () => (await drive("cardVisible", { id: "F-02" })).inView);
  });

  await step("«Скопировать» кладёт промпт в буфер обмена", async () => {
    await drive("word", { id: "F-04", text: "для буфера" });
    await drive("click", { text: "Скопировать" });
    await until("буфер", async () => /F-04: без выбора — «для буфера»/.test(await vscode.env.clipboard.readText()));
  });

  await step("«Сбросить» после подтверждения убирает черновик и файл", async () => {
    const draftFile = path.join(root, ".symphysis", "viewer", "изменение-один.json");
    await until("черновик на диске", () => fs.existsSync(draftFile) && fs.readFileSync(draftFile, "utf8").includes("для буфера"));
    const original = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = async () => "Сбросить";
    try {
      await drive("click", { text: "Сбросить" });
      const s = await until("пустой промпт", async () => {
        const r = await snap();
        return /нового нет/.test(r.prompt) ? r : null;
      });
      assert.equal(s.applyDisabled, true);
      assert.equal(fs.existsSync(draftFile), false);
    } finally {
      (vscode.window as any).showWarningMessage = original;
    }
  });

  await step("настройка проекта не подменяет интерпретатор, подложенный python.exe не запускается", async () => {
    const c = vscode.workspace.getConfiguration("symphysis");
    assert.equal(c.get("python"), "");
    assert.ok(fs.existsSync(path.join(root, "python.exe")));
    assert.ok(api.store.get(one).payload);
  });

  await step("Python не найден: страница называет причину, журнал остаётся", async () => {
    await vscode.workspace.getConfiguration("symphysis").update("python", path.join(root, "нет-такого.exe"), vscode.ConfigurationTarget.Global);
    const s = await until("отказ", async () => {
      const r = await snap();
      return r.notes.some((n: string) => n.includes("Python не найден")) ? r : null;
    });
    assert.ok(s.cards.includes("F-02"));
    assert.equal(s.applyDisabled, true);
    await vscode.workspace.getConfiguration("symphysis").update("python", undefined, vscode.ConfigurationTarget.Global);
    await until("восстановление", async () => !(await snap()).notes.some((n: string) => n.includes("Python не найден")));
  });

  await step("старое ядро без view-json: страница просит обновить, после обновления работает сама", async () => {
    const script = path.join(root, ".symphysis", "tools", "journal.py");
    const good = fs.readFileSync(script);
    fs.writeFileSync(script, "import argparse\nap = argparse.ArgumentParser(prog='journal')\nsub = ap.add_subparsers(dest='cmd', required=True)\nsub.add_parser('check')\nap.parse_args()\n", "utf8");
    try {
      await until("просьба обновить", async () => (await snap()).notes.some((n: string) => n.includes("старая версия инструментов")));
    } finally {
      fs.writeFileSync(script, good);
    }
    await until("восстановление", async () => !(await snap()).notes.some((n: string) => n.includes("старая версия инструментов")));
  });

  await step("номер контракта: ядро новее — просьба про .vsix, прежние данные на экране, «Внести» закрыта, черновик цел; ядро обновили — всё открыто", async () => {
    const render = path.join(root, ".symphysis", "tools", "journal_render.py");
    const script = path.join(root, ".symphysis", "tools", "journal.py");
    const draftFile = path.join(root, ".symphysis", "viewer", "изменение-один.json");
    const good = fs.readFileSync(render);
    await drive("word", { id: "F-02", text: "слово на время проверки номера" });
    await until("файл черновика", () => fs.existsSync(draftFile) && JSON.parse(fs.readFileSync(draftFile, "utf8")).decisions["F-02"]?.word);
    const before = fs.readFileSync(draftFile);
    const shown = (await snap()).cards;
    const notice = /поставь новый \.vsix/;
    fs.writeFileSync(render, good.toString("utf8").replace(/^CONTRACT = 1\r?$/m, "CONTRACT = 99"));
    fs.writeFileSync(script, fs.readFileSync(script));
    try {
      const s = await until("просьба про .vsix", async () => { const r = await snap(); return r.notes.some((n: string) => notice.test(n)) ? r : null; });
      assert.equal(s.applyDisabled, true);
      assert.deepEqual(s.cards, shown);
      assert.ok(fs.readFileSync(draftFile).equals(before), "черновик изменился");
    } finally {
      fs.writeFileSync(render, good);
      fs.writeFileSync(script, fs.readFileSync(script));
    }
    const s = await until("восстановление", async () => { const r = await snap(); return r.notes.some((n: string) => notice.test(n)) ? null : r; });
    assert.equal(s.applyDisabled, false);
    assert.ok(fs.readFileSync(draftFile).equals(before), "черновик изменился");
    await drive("word", { id: "F-02", text: "" });
  });

  await step("панель возврата: низкая по умолчанию, тянется вверх, высота запоминается, двойной клик возвращает", async () => {
    const low = await drive("promptSize");
    assert.ok(low.height < 200, `по умолчанию ${low.height}`);
    await drive("dragPrompt", { delta: -150 });
    const tall = await until("выросла", async () => {
      const r = await drive("promptSize");
      return r.height >= low.height + 140 ? r : null;
    }, 3000);
    assert.ok(tall.mainHeight < low.mainHeight, "карточки должны уступить место");
    await vscode.commands.executeCommand("symphysis.openChange", key("изменение-два"));
    await until("другой журнал", async () => /изменение-два/.test((await snap()).title));
    await vscode.commands.executeCommand("symphysis.openChange", one);
    await until("свой журнал", async () => /изменение-один/.test((await snap()).title));
    assert.equal((await drive("promptSize")).height, tall.height);
    await drive("dragPrompt", { delta: -5000 });
    const top = await until("упёрлась", async () => {
      const r = await drive("promptSize");
      return r.height > tall.height ? r : null;
    }, 3000);
    assert.ok(top.mainHeight >= 0 && (await snap()).title.includes("изменение-один"));
    await drive("resetPrompt");
    await until("вернулась", async () => (await drive("promptSize")).height === low.height, 3000);
    assert.deepEqual((await snap()).violations, []);
  });

  await step("фильтр снят переходом — и это запомнено: другой журнал открывается без фильтра", async () => {
    const stored = await until("снято", async () => {
      await vscode.commands.executeCommand("symphysis.openChange", one);
      const r = await snap();
      return r.cards.includes("F-01") ? r : null;
    });
    assert.ok(stored.cards.length >= 4);
  });

  await step("второе изменение: свой журнал, свой черновик", async () => {
    await vscode.commands.executeCommand("symphysis.openChange", key("изменение-два"));
    const s = await until("второй журнал", async () => {
      const r = await snap();
      return /изменение-два/.test(r.title) && r.cards.length === 4 ? r : null;
    });
    assert.match(s.prompt, /нового нет/);
    assert.equal(fs.existsSync(path.join(key("изменение-два"), "answers")), false);
  });

  await step("изменение без журнала: честная строка вместо карточек", async () => {
    await vscode.commands.executeCommand("symphysis.openChange", key("без-журнала"));
    const s = await until("строка", async () => {
      const r = await snap();
      return /без-журнала/.test(r.title) ? r : null;
    });
    assert.equal(s.cards.length, 0);
    assert.match(s.notes.join(" "), /ещё нет decisions\.json/);
  });

  const attacked = key("с-атакой");
  const attackedJournal = path.join(attacked, "decisions.json");

  await step("проверка: только чтение, панели возврата нет, разделы и «куда уйдёт» на месте, вердикт устарел — сигнал", async () => {
    await vscode.commands.executeCommand("symphysis.openChange", attacked);
    await until("журнал с атакой", async () => {
      const r = await snap();
      return /с-атакой/.test(r.title) && r.cards.length === 4;
    });
    const s = await drive("mode", { name: "проверка" });
    assert.equal(s.mode, "проверка");
    assert.equal(s.returnPanel, false);
    assert.equal(s.inputsInMain, 0);
    const text = await drive("text");
    for (const part of ["Решено — по дате решения · 1", "Открытые развилки — с рекомендацией · 2", "Пробы — с исходом · 1", "Факты — улики и спор · 1",
      "→ design.md › Decisions", "→ design.md › Open Questions", "→ design.md › Context", "вердикт устарел: журнал изменён после атаки", "атака: gaps_found", "круг 1 закончен"]) {
      assert.ok(text.includes(part), `нет «${part}»`);
    }
    assert.deepEqual(s.violations, []);
  });

  await step("оглавление в «проверке» ведёт к записи этого режима, режим не меняется", async () => {
    await vscode.commands.executeCommand("symphysis.revealRecord", "F-03");
    await until("запись видна", async () => (await drive("cardVisible", { id: "F-03" })).inView);
    assert.equal((await snap()).mode, "проверка");
  });

  await step("атака: счётчики, группы, вне списка, понижения, битый файл назван; журнал виден", async () => {
    const s = await drive("mode", { name: "атака" });
    assert.match(s.mode, /атака · 5/);
    assert.equal(s.returnPanel, true);
    const text = await drive("text");
    for (const part of ["блокеров 3 · предупреждений 1 · справок 1", "вне списка — слуг не из закрытого списка", "понижение без причины", "понижено: решено человеком в F-03",
      "линза «выдуманная» вне списка", "Файл атаки не разобран", "status: gaps_found", "вердикт устарел"]) {
      assert.ok(text.includes(part), `нет «${part}»`);
    }
    assert.equal((await drive("attackRows")).length, 5);
    const html = await drive("attackRowHtml", { claim: "Мелочь с" });
    assert.ok(html.includes("<code>кодом</code>"));
  });

  await step("фильтр по линзе прячет строки, но не счётчики тяжести, и запоминается", async () => {
    await drive("lens", { name: "coverage" });
    assert.deepEqual(await drive("attackRows"), ["Хранение решено без улики"]);
    assert.ok((await drive("text")).includes("блокеров 3 · предупреждений 1 · справок 1"));
    await vscode.commands.executeCommand("symphysis.openChange", one);
    await until("другой журнал", async () => /изменение-один/.test((await snap()).title));
    await vscode.commands.executeCommand("symphysis.openChange", attacked);
    await until("обратно", async () => /с-атакой/.test((await snap()).title));
    const after = await snap();
    assert.match(after.mode, /атака/);
    assert.deepEqual(await drive("attackRows"), ["Хранение решено без улики"]);
    await drive("lens", { name: "все" });
    assert.equal((await drive("attackRows")).length, 5);
  });

  await step("ответ к открытой записи — замечание; ссылка ведёт в «решения»; после выбора — слово к решению", async () => {
    const s = await drive("attackDispute", { claim: "Хранение решено", text: "хранить в проекте" });
    assert.match(s.prompt, /Замечания к схеме: F-02: хранить в проекте/);
    assert.ok((await drive("attackRowHtml", { claim: "Хранение решено" })).includes("запись не решена"));
    await drive("followRow", { claim: "Хранение решено" });
    await until("режим решений", async () => /решения/.test((await snap()).mode));
    await until("карточка видна", async () => (await drive("cardVisible", { id: "F-02" })).inView);
    const chose = await drive("choose", { id: "F-02", letter: "A" });
    assert.match(chose.prompt, /- F-02: A — «хранить в проекте»/);
    assert.ok(!/Замечания к схеме/.test(chose.prompt));
  });

  await step("два разных ответа к одному решению — конфликт: слова нет, «Внести» закрыто; один убран — снова можно", async () => {
    await drive("mode", { name: "атака" });
    const s = await drive("attackDispute", { claim: "Вторая претензия", text: "другой ответ" });
    assert.match(s.prompt, /конфликт ответов к F-02/);
    assert.ok(!/- F-02: A — «хранить/.test(s.prompt));
    assert.equal(s.applyDisabled, true);
    assert.ok((await drive("attackRowHtml", { claim: "Вторая претензия" })).includes("конфликт ответов к одному решению"));
    const fixed = await drive("attackDispute", { claim: "Вторая претензия", text: "" });
    assert.match(fixed.prompt, /- F-02: A — «хранить в проекте»/);
    assert.equal(fixed.applyDisabled, false);
  });

  await step("«Внести» из «атаки»: слово и спор в журнале, строки атаки не тронуты, очистка забирает внесённое", async () => {
    const before = fs.readFileSync(path.join(attacked, "attack", "decisions.md"));
    await drive("attackDispute", { claim: "Мелочь без причины", text: "опора есть, вот она" });
    await drive("click", { text: "Внести" });
    const r = await until("отчёт", async () => {
      const x = await snap();
      return x.report && !/Вношу/.test(x.report) ? x : null;
    }, 20000);
    assert.match(r.report, /\[ok\] F-02: решено A/);
    const journalData = JSON.parse(fs.readFileSync(attackedJournal, "utf8"));
    assert.equal(journalData.records[1].decision.word, "хранить в проекте");
    assert.ok(journalData.notes.some((n: any) => n.text.includes("опора есть, вот она")));
    assert.ok(before.equals(fs.readFileSync(path.join(attacked, "attack", "decisions.md"))));
    // Битый файл атаки: журнал внесён, decisions.md собран, страницы нет — и отчёт это называет, а не молчит.
    assert.ok(fs.existsSync(path.join(attacked, "decisions.md")));
    assert.equal(fs.existsSync(path.join(attacked, "decisions.html")), false);
    assert.match(r.report, /производные файлы собраны не все/);
    const clean = await until("очистка", async () => {
      const x = await snap();
      return /нового нет/.test(x.prompt) ? x : null;
    });
    assert.equal(clean.applyDisabled, true);
    assert.ok(!(await drive("attackRowHtml", { claim: "Хранение решено" })).includes("хранить в проекте</textarea>"));
    assert.equal((await drive("attackRows")).length, 5);
  });

  await step("боковая панель называет статус атаки, устаревший вердикт и битый файл", async () => {
    const state = api.store.get(attacked);
    const description = String(api.changes.getTreeItem(state).description);
    assert.match(description, /decisions: gaps_found, устарел/);
    assert.match(description, /artifacts: битый файл/);
  });

  await step("новая строка атаки на диске появляется без кнопки", async () => {
    const file = path.join(attacked, "attack", "decisions.md");
    fs.appendFileSync(file, "| Новая строка от агента | F-04, question | coverage | инвариант | справка | есть | правка цели |\n", "utf8");
    await until("новая строка", async () => (await drive("attackRows")).some((c: string) => c.includes("Новая строка от агента")));
    assert.match((await snap()).mode, /атака · 6/);
  });

  await step("прокрутка у каждого режима своя: вернулся — карточки там же", async () => {
    await drive("mode", { name: "решения" });
    await vscode.commands.executeCommand("symphysis.revealRecord", "F-04");
    await until("F-04 видна", async () => (await drive("cardVisible", { id: "F-04" })).inView);
    const before = (await snap()).scrollTop;
    assert.ok(before > 0);
    await drive("mode", { name: "атака" });
    await drive("mode", { name: "решения" });
    assert.equal((await snap()).scrollTop, before);
  });

  await step("Ctrl+F: вкладка открыта с окном поиска VS Code", async () => {
    assert.equal(api.viewer.findWidget, true);
  });

  await step("выбранный режим и линза залиты цветом; фильтр в шапке и не уезжает с прокруткой", async () => {
    await drive("mode", { name: "атака" });
    for (const selector of [".modes", ".lensfilter"]) {
      const look = await drive("segLook", { selector });
      assert.equal(look.pressed, "true", selector);
      assert.notEqual(look.activeBg, look.otherBg, selector);
      assert.equal(look.inMain, false, selector);
    }
    assert.match((await drive("segLook", { selector: ".modes" })).active, /атака/);
    await drive("lens", { name: "coverage" });
    assert.match((await drive("segLook", { selector: ".lensfilter" })).active, /^coverage/);
    await drive("lens", { name: "все" });
    const before = (await drive("segLook", { selector: ".lensfilter" })).top;
    const scrolled = await drive("scrollMain", { top: 100000 });
    assert.ok(scrolled.scrollTop > 0, "страница должна прокручиваться");
    assert.equal((await drive("segLook", { selector: ".lensfilter" })).top, before);
  });

  await step("фильтр «решения»: развилки, открытые, факты; выбранный заметен; переход к скрытой записи снимает фильтр", async () => {
    await vscode.commands.executeCommand("symphysis.openChange", key("изменение-два"));
    await until("другой журнал", async () => /изменение-два/.test((await snap()).title));
    await drive("mode", { name: "решения" });
    assert.deepEqual((await drive("filter", { name: "развилки" })).cards, ["F-02", "F-03", "F-04"]);
    assert.deepEqual((await drive("filter", { name: "открытые" })).cards, ["F-02", "F-04"]);
    assert.deepEqual((await drive("filter", { name: "факты" })).cards, ["F-01"]);
    const look = await drive("segLook", { selector: ".recordfilter" });
    assert.match(look.active, /^факты · 1/);
    assert.notEqual(look.activeBg, look.otherBg);
    assert.equal(look.inMain, false);
    await vscode.commands.executeCommand("symphysis.revealRecord", "F-02");
    await until("запись видна", async () => (await drive("cardVisible", { id: "F-02" })).inView);
    assert.match((await drive("segLook", { selector: ".recordfilter" })).active, /^все · 4/);
  });

  await step("оглавление атаки: файл → линза → строка, тяжесть названа, битый файл виден; без атаки сказано почему", async () => {
    assert.match(api.attackToc.message() ?? "", /Атаки ещё нет/);
    assert.deepEqual(api.attackToc.getChildren(), []);
    await vscode.commands.executeCommand("symphysis.openChange", attacked);
    await until("журнал с атакой", async () => /с-атакой/.test((await snap()).title));
    assert.equal(api.attackToc.message(), undefined);
    const files = api.attackToc.getChildren();
    const file = files.find((f) => treeItem(f).label === "decisions.md");
    assert.match(String(treeItem(file).description), /gaps_found · устарел · блокеров 3 · предупреждений 1/);
    const broken = files.find((f) => treeItem(f).label === "artifacts.md");
    assert.match(String(treeItem(broken).description), /битый файл/);
    assert.deepEqual(api.attackToc.getChildren(broken), []);
    const lenses = api.attackToc.getChildren(file);
    assert.deepEqual(lenses.map((l) => treeItem(l).label), ["context-compliance", "claim-authority", "coverage", "вне списка"]);
    const rows = api.attackToc.getChildren(lenses[1]);
    assert.deepEqual(rows.map((r) => treeItem(r).label), ["F-03, question", "F-03, question"]);
    assert.match(String(treeItem(rows[1]).description), /Мелочь с кодом/);
  });

  await step("переход из оглавления атаки: режим становится «атакой», фильтр снимается, только если прятал цель", async () => {
    const file = api.attackToc.getChildren().find((f) => treeItem(f).label === "decisions.md");
    const [, authority, coverage] = api.attackToc.getChildren(file);
    const authorityRow = api.attackToc.getChildren(authority)[0];
    await drive("mode", { name: "решения" });
    await clickTree(authorityRow);
    await until("строка видна", async () => (await drive("cardVisible", { id: authorityRow.anchor })).inView);
    assert.match((await snap()).mode, /атака/);
    await drive("lens", { name: "coverage" });
    await clickTree(api.attackToc.getChildren(coverage)[0]);
    await until("своя линза", async () => (await drive("cardVisible", { id: api.attackToc.getChildren(coverage)[0].anchor })).inView);
    assert.match((await drive("segLook", { selector: ".lensfilter" })).active, /^coverage/);
    await clickTree(authorityRow);
    await until("чужая линза", async () => (await drive("cardVisible", { id: authorityRow.anchor })).inView);
    assert.match((await drive("segLook", { selector: ".lensfilter" })).active, /^все/);
    await clickTree(authority);
    await until("группа линзы", async () => (await drive("cardVisible", { id: authority.anchor })).inView);
    await clickTree(file);
    await until("файл", async () => (await drive("cardVisible", { id: file.anchor })).inView);
  });

  await step("поиск: фраза находит запись и строку атаки независимо от режима; переход ведёт к цели", async () => {
    await vscode.commands.executeCommand("symphysis.search.focus");
    await until("страница поиска", async () => api.search.webview && (await searchDrive("searchSnapshot").catch(() => null))?.scope === "с-атакой");
    const found = await searchDrive("searchType", { text: "ЧЕРНОВИКИ" });
    assert.deepEqual(found.hits.map((h: any) => [h.label, h.field, h.mark]), [["F-02", "вопрос", "черновики"]]);
    assert.deepEqual(found.violations, []);
    await drive("mode", { name: "атака" });
    await searchDrive("searchOpen", { label: "F-02" });
    await until("карточка", async () => /решения/.test((await snap()).mode) && (await drive("cardVisible", { id: "F-02" })).inView);
    const attackHit = await searchDrive("searchType", { text: "Хранение решено" });
    assert.deepEqual(attackHit.hits.map((h: any) => h.label), ["decisions.md · F-02, decision"]);
    assert.ok(attackHit.text.includes("Атака · 1"));
    await searchDrive("searchOpen", { label: "decisions.md · F-02, decision" });
    await until("строка атаки", async () => /атака/.test((await snap()).mode));
    assert.deepEqual((await drive("attackRows")).filter((c: string) => c.includes("Хранение решено")).length, 1);
    const nothing = await searchDrive("searchType", { text: "такого точно нет" });
    assert.ok(nothing.text.includes("Ничего не найдено"));
  });

  await step("поиск по номеру: запись и зависимости; русская раскладка; номера нет — сказано; ссылка ведёт к записи", async () => {
    const n = await searchDrive("searchType", { text: "а-02" });
    assert.deepEqual(n.hits[0].label, "F-02");
    assert.deepEqual(n.deps, ["F-01", "F-04"]);
    assert.ok(n.text.includes("Зависит от · 1") && n.text.includes("От неё зависят · 1"));
    const far = await searchDrive("searchType", { text: "4" });
    assert.deepEqual(far.deps, ["F-02", "F-01"]);
    assert.ok(far.text.includes("по цепочке ещё · 1"));
    const missing = await searchDrive("searchType", { text: "F-99" });
    assert.ok(missing.text.includes("Записи F-99 нет"));
    await searchDrive("searchType", { text: "2" });
    await searchDrive("searchOpen", { label: "F-01" });
    await until("запись по ссылке", async () => /решения/.test((await snap()).mode) && (await drive("cardVisible", { id: "F-01" })).inView);
  });

  await step("поиск следит за журналом и черновиком сам; заметка раскрывается переходом", async () => {
    assert.equal((await searchDrive("searchType", { text: "заметка снаружи" })).hits.length, 0);
    const data = JSON.parse(fs.readFileSync(attackedJournal, "utf8"));
    data.notes.push({ date: "2026-11-01", text: "заметка снаружи" });
    fs.writeFileSync(attackedJournal, JSON.stringify(data, null, 1), "utf8");
    await until("новая заметка", async () => (await searchDrive("searchSnapshot")).hits.some((h: any) => h.label === "заметки"));
    await searchDrive("searchOpen", { label: "заметки" });
    await until("заметки раскрыты", async () => /<details[^>]*open/.test((await drive("cardHtml", { id: "journal-notes" })) ?? ""));
    await drive("word", { id: "F-04", text: "несохранённое слово" });
    const typed = await searchDrive("searchType", { text: "несохраненное" });
    await until("черновик найден", async () => (await searchDrive("searchSnapshot")).hits.some((h: any) => h.label === "F-04" && h.field === "в черновике: слово"), 3000)
      .catch((e) => { throw new Error(`${e.message}; было: ${JSON.stringify(typed.hits)}`); });
    await drive("word", { id: "F-04", text: "" });
    await until("слова нет", async () => (await searchDrive("searchSnapshot")).hits.length === 0);
  });

  await step("черновик у каждого журнала свой: после переключения оглавление и поиск видят черновик открытого журнала, а не прежнего", async () => {
    const two = key("изменение-два");
    const iconOf = (state: string) => {
      const rec = api.store.get(state).payload.records.find((r: any) => r.id === "F-04");
      return (api.toc.getTreeItem(rec).iconPath as vscode.ThemeIcon).id;
    };
    await vscode.commands.executeCommand("symphysis.openChange", two);
    await until("второй журнал", async () => /изменение-два/.test((await snap()).title));
    await drive("mode", { name: "решения" });
    await drive("choose", { id: "F-04", letter: "B" });
    await drive("word", { id: "F-04", text: "слово второго журнала" });
    const draftFile = path.join(root, ".symphysis", "viewer", "изменение-два.json");
    await until("черновик на диске", () => fs.existsSync(draftFile) && fs.readFileSync(draftFile, "utf8").includes("слово второго журнала"));
    assert.equal(iconOf(two), "pass");
    await vscode.commands.executeCommand("symphysis.openChange", attacked);
    await until("журнал с атакой", async () => /с-атакой/.test((await snap()).title));
    assert.equal(iconOf(attacked), "circle-large-outline", "оглавление рисует метку по чужому черновику");
    assert.equal((await searchDrive("searchType", { text: "слово второго" })).hits.length, 0);
    await vscode.commands.executeCommand("symphysis.openChange", two);
    await until("снова второй", async () => /изменение-два/.test((await snap()).title));
    await until("поиск видит черновик без правок", async () => (await searchDrive("searchSnapshot")).hits.some((h: any) => h.label === "F-04"), 3000);
    assert.equal(iconOf(two), "pass", "оглавление потеряло свой черновик");
    await drive("word", { id: "F-04", text: "" });
    await drive("click", { id: "F-04", text: "снять выбор B" });
    await vscode.commands.executeCommand("symphysis.openChange", attacked);
    await until("обратно", async () => /с-атакой/.test((await snap()).title));
  });

  await step("вкладка закрыта: поиск и оглавление атаки говорят, что журнал не открыт; открыта снова — запрос на месте", async () => {
    await searchDrive("searchType", { text: "черновики" });
    const tab = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.input instanceof vscode.TabInputWebview && t.label.startsWith("Журнал"));
    await vscode.window.tabGroups.close(tab!);
    const closed = await until("журнал не открыт", async () => {
      const r = await searchDrive("searchSnapshot");
      return r.scope === null ? r : null;
    });
    assert.match(closed.scopeLine, /журнал не открыт/);
    assert.equal(api.attackToc.message(), "Журнал не открыт.");
    await vscode.commands.executeCommand("symphysis.openChange", attacked);
    await until("журнал на месте", async () => /с-атакой/.test((await snap().catch(() => ({ title: "" }))).title));
    const back = await until("поиск снова", async () => {
      const r = await searchDrive("searchSnapshot");
      return r.scope === "с-атакой" && r.hits.length === 1 ? r : null;
    });
    assert.equal(back.query, "черновики");
    assert.deepEqual(back.violations, []);
  });

  if (fs.existsSync(path.join(key("большой-журнал"), "decisions.json"))) {
    await step("большой настоящий журнал: все записи, символ в поле слова быстрый", async () => {
      await vscode.commands.executeCommand("symphysis.openChange", key("большой-журнал"));
      const s = await until("большой журнал", async () => {
        const r = await snap();
        return /большой-журнал/.test(r.title) && r.cards.length > 10 ? r : null;
      }, 20000);
      const total = JSON.parse(fs.readFileSync(path.join(key("большой-журнал"), "decisions.json"), "utf8")).records.length;
      assert.equal(s.cards.length, total);
      const firstFork = JSON.parse(fs.readFileSync(path.join(key("большой-журнал"), "decisions.json"), "utf8")).records.find((r: any) => r.kind === "развилка").id;
      measures.bigKeystroke = await drive("measure", { id: firstFork });
      assert.deepEqual(s.violations, []);
      assert.equal(s.overflowX.px, 0, `вбок вылезает: ${s.overflowX.culprit}`);
      const check = await drive("measureMode", { name: "проверка" });
      measures.bigCheckMs = check.ms;
      assert.equal(check.snapshot.overflowX.px, 0, `«проверка», вбок вылезает: ${check.snapshot.overflowX.culprit}`);
      assert.deepEqual(check.snapshot.violations, []);
      assert.equal(check.snapshot.inputsInMain, 0);
      const attackFiles = api.store.get(key("большой-журнал")).payload.attacks;
      const realRows = attackFiles.reduce((n: number, a: any) => n + (a.rows?.length ?? 0), 0);
      assert.ok(realRows > 0, "у настоящего журнала должны быть строки атаки");
      const att = await drive("measureMode", { name: "атака" });
      measures.bigAttackMs = att.ms;
      measures.bigAttackRows = realRows;
      assert.equal(att.snapshot.overflowX.px, 0, `«атака», вбок вылезает: ${att.snapshot.overflowX.culprit}`);
      assert.deepEqual(att.snapshot.violations, []);
      assert.equal((await drive("attackRows")).length, realRows);
      measures.bigDisputeKeystroke = await drive("measureDispute");
      const outline = api.attackToc.getChildren().flatMap((f) => api.attackToc.getChildren(f).flatMap((l) => api.attackToc.getChildren(l)));
      assert.equal(outline.length, realRows, "оглавление атаки показывает все строки");
      await clickTree(outline[outline.length - 1]);
      await until("последняя строка", async () => (await drive("cardVisible", { id: outline[outline.length - 1].anchor })).inView);
      // Поиск на настоящем журнале: счёт на хосте и весь путь от символа в поле до показа, вместе с задержкой ввода.
      const payload = api.store.get(key("большой-журнал")).payload;
      const samples = Array.from({ length: 30 }, () => {
        const t1 = performance.now();
        search(payload, emptyDraft(), "журнал");
        return performance.now() - t1;
      }).sort((a, b) => a - b);
      measures.bigSearch = { medianMs: samples[15], maxMs: samples[29] };
      const wide = await searchDrive("searchType", { text: "журнал" });
      measures.bigSearchHits = wide.hits.length;
      measures.bigSearchRoundTripMs = wide.ms;
      assert.ok(wide.hits.length > 10);
      assert.equal(wide.overflowPx, 0, "поиск не должен вылезать вбок");
      assert.deepEqual(wide.violations, []);
      const number = await searchDrive("searchType", { text: "6" });
      assert.equal(number.overflowPx, 0, "карточка записи не должна вылезать вбок");
      await drive("mode", { name: "решения" });
    });
  }

  // --- вкладка схемы ----------------------------------------------------------------------------------------------
  const schemeDrive = driver(() => api.scheme.webview, api.scheme.messages);
  const schemeSnap = () => schemeDrive("schemeSnapshot");
  const schemeTabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => /^Схема/.test(t.label));
  const withScheme = key("со-схемой");
  const schemePath = path.join(withScheme, "scheme.md");
  const schemeSource = fs.readFileSync(schemePath, "utf8");
  const schemeState = (state: string) => until(`схема: ${state}`, async () => {
    const r = await schemeDrive("schemeSnapshot").catch(() => null);
    return r?.state === state ? r : null;
  });
  const openJournal = async (name: string) => {
    await vscode.commands.executeCommand("symphysis.openChange", key(name));
    await until(`журнал ${name}`, async () => { const r = await snap(); return r.title.includes(name) && r.cards.length ? r : null; });
  };

  await step("вкладка схемы сама не открывается", async () => {
    await openJournal("со-схемой");
    assert.equal(api.scheme.webview, null);
    assert.equal(schemeTabs().length, 0);
  });

  await step("кнопка «схема»: вкладка рядом, рисунок, CSP без нарушений", async () => {
    await drive("click", { text: "схема" });
    await until("вкладка", () => api.scheme.webview);
    const s = await schemeState("svg");
    assert.equal(schemeTabs()[0].label, "Схема: со-схемой");
    assert.equal(s.nodes.length, 5);
    assert.deepEqual(s.violations, []);
    assert.equal(s.scale, 1);
    assert.notEqual(vscode.window.tabGroups.all.length, 1, "вкладка стоит рядом, а не поверх просмотрщика");
  });

  await step("повторное нажатие: вторая вкладка не появляется, открытая получает фокус", async () => {
    await drive("click", { text: "схема" });
    await until("фокус", () => /^Схема/.test(vscode.window.tabGroups.activeTabGroup.activeTab?.label ?? ""));
    assert.equal(schemeTabs().length, 1);
  });

  await step("перетаскивание двигает схему и не трогает фильтр; сдвиг на 3 пикселя — клик, на 4 — перетаскивание (F-68)", async () => {
    const before = await schemeSnap();
    const moved = await schemeDrive("schemeDrag", { dx: -40, dy: 25 });
    assert.equal(moved.x, before.x - 40);
    assert.equal(moved.y, before.y + 25);
    assert.equal((await snap()).nodeFilter, null);
    await schemeDrive("schemeNode", { id: "A", dx: 4, dy: 0 });
    assert.equal((await snap()).nodeFilter, null);
    await schemeDrive("schemeNode", { id: "A", dx: 3, dy: 0 });
    await until("условие A", async () => (await snap()).nodeFilter === "A");
    await schemeDrive("schemeNode", { id: "A" });
    await until("условие снято", async () => (await snap()).nodeFilter === null);
  });

  await step("клик по узлу из другого режима: «решения», «показать» прежнее, условие в шапке; повторный клик снимает", async () => {
    await drive("mode", { name: "атака" });
    await drive("filter", { name: "открытые" }).catch(() => undefined);
    await schemeDrive("schemeNode", { id: "A" });
    const s = await until("условие", async () => { const r = await snap(); return r.nodeFilter === "A" ? r : null; });
    assert.match(s.mode, /решения/);
    assert.deepEqual(s.cards.filter((c: string) => c !== "F-01"), s.cards.filter((c: string) => c === "F-02"), "только записи узла A");
    await schemeDrive("schemeNode", { id: "A" });
    await until("условие снято", async () => (await snap()).nodeFilter === null);
  });

  await step("условие не прячет открытые: шапка считает по всему журналу и говорит, сколько скрыто (F-104)", async () => {
    await schemeDrive("schemeNode", { id: "B" });
    const s = await until("условие B", async () => { const r = await snap(); return r.nodeFilter === "B" ? r : null; });
    assert.match(s.stats, /открыто \d+/);
    assert.match(s.stats, /из них скрыто условием \d+/);
    await schemeDrive("schemeNode", { id: "B" });
    await until("снято", async () => (await snap()).nodeFilter === null);
  });

  await step("узел без записей: сказано, что записей нет; одинаковые подписи различаются (F-72)", async () => {
    await schemeDrive("schemeNode", { id: "D" });
    const d = await until("условие D", async () => { const r = await snap(); return r.nodeFilter === "D" ? r : null; });
    assert.match(d.empty, /У узла D записей нет/);
    await schemeDrive("schemeNode", { id: "C" });
    await until("условие C", async () => (await snap()).nodeFilter === "C");
    await schemeDrive("schemeNode", { id: "C" });
    await until("снято", async () => (await snap()).nodeFilter === null);
  });

  await step("узел с кириллицей находит запись; узла нет в схеме — запись на месте с подсказкой, регистр важен (F-06, F-87)", async () => {
    await schemeDrive("schemeNode", { id: "узел1" });
    await until("условие узел1", async () => { const r = await snap(); return r.nodeFilter === "узел1" && r.cards.includes("F-03") ? r : null; });
    await schemeDrive("schemeNode", { id: "узел1" });
    await until("снято", async () => (await snap()).nodeFilter === null);
    assert.match(await drive("cardHtml", { id: "F-04" }), /узел не найден: Узел1/);
    assert.doesNotMatch(await drive("cardHtml", { id: "F-03" }), /узел не найден/);
  });

  await step("переход к записи, скрытой условием: условие снято, запись показана (F-75)", async () => {
    await schemeDrive("schemeNode", { id: "A" });
    await until("условие A", async () => (await snap()).nodeFilter === "A");
    await vscode.commands.executeCommand("symphysis.revealRecord", "F-04");
    const s = await until("запись показана", async () => { const r = await snap(); return r.cards.includes("F-04") ? r : null; });
    assert.equal(s.nodeFilter, null);
  });

  await step("журнал сменился: вкладка следует за ним; журнал без nodes: клик говорит об этом, условие не ставится (F-64, F-73)", async () => {
    await openJournal("схема-без-узлов");
    const s = await until("схема другого журнала", async () => { const r = await schemeSnap(); return r.nodes.some((n: string) => n.includes("-P-")) ? r : null; });
    assert.equal(s.state, "svg");
    assert.equal(schemeTabs()[0].label, "Схема: схема-без-узлов");
    await schemeDrive("schemeNode", { id: "P" });
    const v = await until("сообщение", async () => { const r = await snap(); return r.notes.some((n: string) => n.includes("не связаны со схемой")) ? r : null; });
    assert.equal(v.nodeFilter, null);
    await openJournal("со-схемой");
    await until("схема первого журнала", async () => (await schemeSnap()).nodes.some((n: string) => n.includes("-A-")));
  });

  await step("клик при закрытом просмотрщике: просмотрщик открывается с этим журналом и условием (F-63)", async () => {
    const tab = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => /^Журнал/.test(t.label))!;
    await vscode.window.tabGroups.close(tab);
    await until("просмотрщик закрыт", () => api.viewer.webview === null);
    await schemeDrive("schemeNode", { id: "A" });
    const s = await until("условие", async () => {
      if (!api.viewer.webview) return null;
      const r = await drive("snapshot").catch(() => null);
      return r?.nodeFilter === "A" ? r : null;
    });
    assert.match(s.title, /со-схемой/);
    assert.ok((await schemeSnap()).hasSvg, "рисунок виден");
    const groups = vscode.window.tabGroups.all;
    assert.ok(groups.some((g) => /^Журнал/.test(g.activeTab?.label ?? "")) && groups.some((g) => /^Схема/.test(g.activeTab?.label ?? "")), "просмотрщик и схема видны рядом");
    await schemeDrive("schemeNode", { id: "A" });
    await until("снято", async () => (await snap()).nodeFilter === null);
  });

  // --- возврат вкладок после перезагрузки окна (F-125). Саму перезагрузку держит `npm run e2e:reload`, здесь — что плагин делает с возвращённой вкладкой --------
  const tabsOfType = (type: string) => vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith(type));
  const closeTabOf = async (type: string, closed: () => boolean) => {
    await vscode.window.tabGroups.close(tabsOfType(type)[0]);
    await until("вкладка закрыта", closed);
  };
  /** Вкладка, про которую плагин не знает: такой её оставляет перезагрузка, пока VS Code её не поднял. */
  const foreignPanel = async (type: string, column: vscode.ViewColumn) => {
    const before = tabsOfType(type).length;
    const panel = vscode.window.createWebviewPanel(type, "вернувшаяся", { viewColumn: column, preserveFocus: true }, {});
    // Настоящая спящая вкладка есть с начала работы окна, а эта дойдёт до `tabGroups` не сразу.
    await until("вкладка появилась", () => tabsOfType(type).length > before);
    return panel;
  };
  const gone = (panel: vscode.WebviewPanel) => {
    let closed = false;
    panel.onDidDispose(() => { closed = true; });
    return () => until("вкладка закрыта", () => closed);
  };

  await step("спящая вкладка журнала: выбор изменения заменяет её в той же группе, второй нет (F-125)", async () => {
    await closeTabOf("symphysis.viewer", () => api.viewer.webview === null);
    const asleep = await foreignPanel("symphysis.viewer", vscode.ViewColumn.One);
    const column = asleep.viewColumn;
    const replaced = gone(asleep);
    await openJournal("со-схемой");
    await replaced();
    assert.equal(tabsOfType("symphysis.viewer").length, 1);
    assert.equal(tabsOfType("symphysis.viewer")[0].group.viewColumn, column);
  });

  await step("спящая вкладка схемы: кнопка заменяет её в той же группе, второй нет (F-125)", async () => {
    await closeTabOf("symphysis.scheme", () => api.scheme.webview === null);
    const asleep = await foreignPanel("symphysis.scheme", vscode.ViewColumn.Two);
    const column = asleep.viewColumn;
    const replaced = gone(asleep);
    await vscode.commands.executeCommand("symphysis.openScheme", withScheme);
    await replaced();
    assert.equal(tabsOfType("symphysis.scheme").length, 1);
    assert.equal(tabsOfType("symphysis.scheme")[0].group.viewColumn, column);
    await schemeState("svg");
  });

  await step("возвращённая вкладка журнала показывает то же изменение, боковая панель его знает (F-125)", async () => {
    await closeTabOf("symphysis.viewer", () => api.viewer.webview === null);
    api.viewer.restore(await foreignPanel("symphysis.viewer", vscode.ViewColumn.One));
    const s = await until("журнал вернулся", async () => { const r = await snap().catch(() => null); return r?.title.includes("со-схемой") && r.cards.length ? r : null; });
    assert.ok(s.cards.length > 0);
    assert.equal(api.viewer.currentKey, withScheme);
    assert.equal(tabsOfType("symphysis.viewer").length, 1);
  });

  await step("возвращённая вкладка схемы рисует файл того же изменения (F-125)", async () => {
    await closeTabOf("symphysis.scheme", () => api.scheme.webview === null);
    api.scheme.restore(await foreignPanel("symphysis.scheme", vscode.ViewColumn.Two));
    const s = await schemeState("svg");
    assert.equal(s.scale, 1);
    await until("подпись вкладки", () => schemeTabs()[0]?.label === "Схема: со-схемой");
  });

  await step("схема, проспавшая смену журнала, просыпается с журналом просмотрщика (F-64, F-125)", async () => {
    await closeTabOf("symphysis.scheme", () => api.scheme.webview === null);
    await openJournal("схема-без-узлов");
    api.scheme.restore(await foreignPanel("symphysis.scheme", vscode.ViewColumn.Two));
    await until("подпись вкладки", () => schemeTabs()[0]?.label === "Схема: схема-без-узлов");
    await openJournal("со-схемой");
    await until("схема первого журнала", () => schemeTabs()[0]?.label === "Схема: со-схемой");
  });

  await step("при открытой вкладке вернувшаяся закрывается: одна на окно (F-125)", async () => {
    const extra = await foreignPanel("symphysis.viewer", vscode.ViewColumn.One);
    const closed = gone(extra);
    const shown = api.viewer.webview;
    api.viewer.restore(extra);
    await closed();
    assert.equal(api.viewer.webview, shown);
    await until("вкладка одна", () => tabsOfType("symphysis.viewer").length === 1);
  });

  await step("изменения больше нет: вернувшиеся вкладки закрываются, журнал и схема открываются заново (F-125)", async () => {
    const vanishing = key("исчезнет");
    fs.mkdirSync(vanishing, { recursive: true });
    fs.copyFileSync(path.join(withScheme, "decisions.json"), path.join(vanishing, "decisions.json"));
    api.store.sync();
    await openJournal("исчезнет");
    await vscode.commands.executeCommand("symphysis.openScheme", vanishing);
    await until("схема исчезающего", () => schemeTabs()[0]?.label === "Схема: исчезнет");
    await closeTabOf("symphysis.viewer", () => api.viewer.webview === null);
    await closeTabOf("symphysis.scheme", () => api.scheme.webview === null);
    fs.rmSync(vanishing, { recursive: true, force: true });
    api.store.sync();
    const journalTab = await foreignPanel("symphysis.viewer", vscode.ViewColumn.One);
    const schemeTab = await foreignPanel("symphysis.scheme", vscode.ViewColumn.Two);
    const closed = [gone(journalTab), gone(schemeTab)];
    api.viewer.restore(journalTab);
    api.scheme.restore(schemeTab);
    for (const wait of closed) await wait();
    assert.equal(api.viewer.webview, null);
    assert.equal(api.scheme.webview, null);
    await openJournal("со-схемой");
    await vscode.commands.executeCommand("symphysis.openScheme", withScheme);
    await schemeState("svg");
  });

  await step("широкая схема открывается в натуральном размере, верхний узел виден; «вписать» уменьшает, маленькая не растягивается (F-35, F-69)", async () => {
    await openJournal("широкая-схема");
    const big = await until("широкая", async () => { const r = await schemeSnap(); return r.nodes.length === 20 ? r : null; });
    assert.equal(big.scale, 1);
    assert.equal(big.topVisible, true);
    const fit = await schemeDrive("schemeClickText", { text: "вписать" });
    assert.ok(fit.scale < 1, `масштаб ${fit.scale}`);
    await openJournal("схема-без-узлов");
    await until("маленькая", async () => (await schemeSnap()).nodes.length === 2);
    const small = await schemeDrive("schemeClickText", { text: "вписать" });
    assert.equal(small.scale, 1);
    await openJournal("со-схемой");
    await until("схема первого журнала", async () => (await schemeSnap()).nodes.length === 5);
  });

  await step("«−» двадцать раз: рисунок на месте, «+» возвращает (F-67)", async () => {
    const out = await schemeDrive("schemeClickText", { text: "−", times: 20 });
    assert.ok(out.hasSvg && out.scale >= 0.1, `масштаб ${out.scale}`);
    const back = await schemeDrive("schemeClickText", { text: "+", times: 3 });
    assert.ok(back.scale > out.scale);
  });

  await step("правка сохранена: рисунок обновляется сам; на середине — прежний рисунок, плашка с верной строкой и кнопкой (F-28)", async () => {
    fs.writeFileSync(schemePath, "```mermaid\nflowchart TD\n  A --> B\n  B --> Новый\n```\n", "utf8");
    const fresh = await until("новый узел", async () => { const r = await schemeSnap(); return r.nodes.some((n: string) => n.includes("-Новый-")) ? r : null; });
    assert.equal(fresh.state, "svg");
    fs.writeFileSync(schemePath, "# Заголовок\n\nтекст\n\n```mermaid\nflowchart TD\n  A[незакрытая --> B\n  B --> C\n```\n", "utf8");
    const broken = await until("плашка", async () => { const r = await schemeSnap(); return r.plates.length ? r : null; });
    assert.ok(broken.hasSvg, "прежний рисунок остаётся");
    assert.equal(broken.state, "svg");
    assert.match(broken.plates[0], /строка 7 в scheme\.md/);
    assert.equal(broken.openButton, true);
    await schemeDrive("schemeClickText", { text: "Открыть scheme.md" });
    await until("файл открыт", () => vscode.window.visibleTextEditors.some((e) => e.document.fileName.endsWith("scheme.md")));
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });

  await step("файл удалён: рисунок убран, плашка «Схема не создана»; файл без схемы: своя плашка; битый при первом показе: ошибка и текст (F-05, F-60, F-70)", async () => {
    fs.rmSync(schemePath);
    const gone = await schemeState("missing");
    assert.equal(gone.hasSvg, false);
    assert.match(gone.plates[0], /Схема не создана/);
    fs.writeFileSync(schemePath, "# Только текст\n", "utf8");
    const empty = await schemeState("empty");
    assert.match(empty.plates[0], /В scheme\.md нет схемы/);
    assert.equal(empty.openButton, true);
    fs.writeFileSync(schemePath, "```mermaid\nflowchart TD\n  A[незакрытая --> B\n```\n", "utf8");
    const text = await schemeState("text");
    assert.match(text.source, /незакрытая/);
    assert.match(text.plates[0], /строка 3 в scheme\.md/);
  });

  await step("два блока: первый и плашка; BOM и CRLF: рисунок и верная строка (F-59, F-61)", async () => {
    fs.writeFileSync(schemePath, "```mermaid\nflowchart TD\n  A --> B\n```\n\n```mermaid\nflowchart TD\n  C --> D --> E\n```\n", "utf8");
    const two = await until("два блока", async () => { const r = await schemeSnap(); return r.state === "svg" && r.nodes.length === 2 ? r : null; });
    assert.match(two.plates[0], /в файле 2 блока, показан первый/);
    fs.writeFileSync(schemePath, "﻿# С\r\n\r\n```mermaid\r\nflowchart TD\r\n  X --> Y --> Z\r\n```\r\n", "utf8");
    await until("CRLF", async () => { const r = await schemeSnap(); return r.state === "svg" && r.nodes.length === 3 ? r : null; });
    fs.writeFileSync(schemePath, "﻿# С\r\n\r\n```mermaid\r\nflowchart TD\r\n  A[незакрытая --> B\r\n```\r\n", "utf8");
    const line = await until("строка", async () => { const r = await schemeSnap(); return r.plates.length ? r : null; });
    assert.match(line.plates[0], /строка 5 в scheme\.md/);
  });

  await step("опасная подпись: функция по клику не вызывается, ссылка снята, загрузка картинки заблокирована; другой вид диаграммы без клик-фильтра", async () => {
    fs.writeFileSync(schemePath, "```mermaid\nflowchart TD\n  A[\"<img src='http://127.0.0.1:9/pixel.png'>\"] --> B\n  click A call boom()\n  click B href \"javascript:boom()\"\n```\n", "utf8");
    const evil = await until("подпись", async () => { const r = await schemeSnap(); return r.state === "svg" && r.nodes.length === 2 ? r : null; });
    assert.equal(evil.onclick, 0);
    assert.equal(evil.jsLinks, 0);
    fs.writeFileSync(schemePath, "```mermaid\nsequenceDiagram\n  Alice->>Bob: привет\n```\n", "utf8");
    const seq = await until("последовательность", async () => { const r = await schemeSnap(); return r.state === "svg" && r.nodes.length === 0 ? r : null; });
    assert.equal(seq.hasSvg, true);
    fs.writeFileSync(schemePath, schemeSource, "utf8");
    await until("схема вернулась", async () => (await schemeSnap()).nodes.length === 5);
  });

  await step("вкладка не пишет в scheme.md: хеш до и после клика, масштаба и перетаскивания (F-103)", async () => {
    const hash = () => crypto.createHash("sha256").update(fs.readFileSync(schemePath)).digest("hex");
    const before = hash();
    await schemeDrive("schemeNode", { id: "A" });
    await schemeDrive("schemeClickText", { text: "+" });
    await schemeDrive("schemeDrag", { dx: 15, dy: 15 });
    await schemeDrive("schemeNode", { id: "A" });
    await sleep(200);
    assert.equal(hash(), before);
  });

  fs.writeFileSync(process.env.SYMPHYSIS_E2E_RESULTS!, JSON.stringify({ tests: results, measures }, null, 1), "utf8");

  // Пауза для снимка окна: журнал с открытой развилкой, выбором и словом.
  const pause = Number(process.env.SYMPHYSIS_E2E_PAUSE_MS || 0);
  if (pause) {
    const theme = process.env.SYMPHYSIS_E2E_THEME;
    if (theme) await vscode.workspace.getConfiguration("workbench").update("colorTheme", theme, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand("workbench.view.extension.symphysis");
    const show = process.env.SYMPHYSIS_E2E_SHOW;
    if (show) {
      await vscode.commands.executeCommand("symphysis.openChange", key(show));
      await sleep(800);
      if (process.env.SYMPHYSIS_E2E_MODE) await drive("mode", { name: process.env.SYMPHYSIS_E2E_MODE });
      if (process.env.SYMPHYSIS_E2E_NODE) {
        await vscode.commands.executeCommand("symphysis.openScheme", key(show));
        await until("рисунок", async () => (await schemeDrive("schemeSnapshot").catch(() => null))?.state === "svg");
        await schemeDrive("schemeNode", { id: process.env.SYMPHYSIS_E2E_NODE });
      }
      if (process.env.SYMPHYSIS_E2E_LENS) await drive("lens", { name: process.env.SYMPHYSIS_E2E_LENS });
      if (process.env.SYMPHYSIS_E2E_FILTER) await drive("filter", { name: process.env.SYMPHYSIS_E2E_FILTER });
      if (process.env.SYMPHYSIS_E2E_SEARCH) {
        await vscode.commands.executeCommand("symphysis.search.focus");
        await until("страница поиска", async () => api.search.webview && (await searchDrive("searchSnapshot").catch(() => null))?.scope === show);
        await searchDrive("searchType", { text: process.env.SYMPHYSIS_E2E_SEARCH });
      }
      if (process.env.SYMPHYSIS_E2E_FIND) {
        await vscode.commands.executeCommand("symphysis.revealRecord", "F-02");
        await vscode.commands.executeCommand("editor.action.webvieweditor.showFind");
      }
    } else {
      await vscode.commands.executeCommand("symphysis.openChange", key("изменение-два"));
      await sleep(600);
      await drive("choose", { id: "F-03", letter: "B" });
      await drive("word", { id: "F-03", text: "передумал: расширение пишет само" });
      await drive("park", { id: "F-03", text: "Сколько весит черновик", addressee: "материалы" });
      await vscode.commands.executeCommand("symphysis.revealRecord", "F-02");
      if (process.env.SYMPHYSIS_E2E_STRETCH) await drive("dragPrompt", { delta: -200 });
    }
    await sleep(pause);
  }
}
