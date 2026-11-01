// Сквозной сценарий в настоящем VS Code: боковая панель, страница, настоящий Python и настоящее ядро, путь с кириллицей и пробелами.
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

interface Api {
  store: { list(): any[]; get(key: string): any };
  viewer: { messages: vscode.EventEmitter<any>; webview: vscode.Webview | null; currentKey: string | null };
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

  let seq = 0;
  const pending = new Map<number, (m: any) => void>();
  api.viewer.messages.event((m: any) => {
    if (m.type === "driven") {
      pending.get(m.seq)?.(m);
      pending.delete(m.seq);
    }
  });
  const drive = async (action: string, args: Record<string, unknown> = {}): Promise<any> => {
    const id = ++seq;
    const reply = new Promise<any>((resolve, reject) => {
      pending.set(id, resolve);
      setTimeout(() => reject(new Error(`водитель молчит: ${action}`)), 10000);
    });
    await api.viewer.webview!.postMessage({ type: "drive", seq: id, action, ...args });
    const m = await reply;
    if (m.error) throw new Error(m.error);
    return m.result;
  };
  const snap = () => drive("snapshot");

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
    await drive("openOnly");
    const filtered = await snap();
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
