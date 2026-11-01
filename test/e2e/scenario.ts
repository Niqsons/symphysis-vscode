// Сквозной сценарий в настоящем VS Code: боковая панель, страница, настоящий Python и настоящее ядро, путь с кириллицей и пробелами.
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { emptyDraft } from "../../src/shared/logic";
import { search } from "../../src/shared/search";

interface Api {
  store: { list(): any[]; get(key: string): any };
  viewer: { messages: vscode.EventEmitter<any>; webview: vscode.Webview | null; currentKey: string | null; findWidget: boolean };
  changes: { getTreeItem(state: any): vscode.TreeItem };
  toc: { getTreeItem(rec: any): vscode.TreeItem };
  attackToc: { getChildren(node?: any): any[]; getTreeItem(node: any): vscode.TreeItem; message(): string | undefined };
  search: { messages: vscode.EventEmitter<any>; webview: vscode.Webview | null };
}

const results: { name: string; ok: boolean; ms?: number; error?: string }[] = [];
const measures: Record<string, unknown> = {};

async function step(name: string, fn: () => Promise<void>) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(what: string, fn: () => T | Promise<T>, ms = 15000): Promise<T> {
  const t0 = Date.now();
  let last: unknown;
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn();
      if (v) return v;
      last = v;
    } catch (e) {
      last = e;
    }
    await sleep(40);
  }
  throw new Error(`нет за ${ms} мс: ${what}; последнее: ${String(last)}`);
}

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

  await step("антипод: F-03.B при выбранном F-02.A заблокирован, журнал не тронут", async () => {
    await drive("choose", { id: "F-03", letter: "B" });
    const html = await drive("cardHtml", { id: "F-03" });
    assert.match(html, /антипод уже выбран: F-02\.A/);
    const s = await snap();
    assert.ok(!/F-03: B/.test(s.prompt));
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
