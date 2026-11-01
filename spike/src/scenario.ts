// Сценарий пробного запуска: четыре проверки и цикл свежести. Ошибка одной проверки не останавливает остальные.
import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import type { Page, Spike, resolvePython as ResolvePython, runPython as RunPython } from "./extension";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension("symphysis.symphysis-spike")!;
  const { spike, resolvePython, runPython } = (await ext.activate()) as { spike: Spike; resolvePython: typeof ResolvePython; runPython: typeof RunPython };
  const ws = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const tools = path.join(ws, ".symphysis", "tools");
  const change = path.join(ws, "openspec", "changes", "изменение-один");
  const journal = path.join(change, "decisions.json");
  const attack = path.join(change, "attack", "decisions.md");
  const results: any = { vscode: vscode.version, workspace: ws };
  const write = () => fs.writeFileSync(process.env.SPIKE_RESULTS!, JSON.stringify(results, null, 1), "utf8");

  const skip = (process.env.SPIKE_SKIP ?? "").split(",");
  const step = async (name: string, body: () => Promise<any>) => {
    if (skip.includes(name)) return;
    const t0 = Date.now();
    try { results[name] = await body(); } catch (e: any) { results[name] = { FAILED: String(e?.stack ?? e) }; }
    results[name].__seconds = Math.round((Date.now() - t0) / 100) / 10;
    write();
  };

  let python = "";
  let payload: any;

  await step("python", async () => {
    const found = resolvePython(process.env, [ws]);
    if (!found) throw new Error("python не найден");
    python = found.path;
    const out: any = { found };
    const journalPy = path.join(tools, "journal.py");

    const check = await runPython(python, [journalPy, "check", journal], ws);
    out.check = { code: check.code, ms: Math.round(check.ms), first: check.stdout.split(/\r?\n/)[0], cyrillicOk: check.stdout.includes("улик сверено") };

    const md = path.join(change, "decisions.md");
    const render = await runPython(python, [journalPy, "render-md", journal, "--out", md], ws);
    out.renderMd = { code: render.code, fileWritten: fs.existsSync(md), echoesCyrillicPath: render.stdout.includes("изменение-один") };

    const broken = path.join(change, "битый журнал.json");
    fs.writeFileSync(broken, '{"title":"т","source":"s.md"}', "utf8");
    const bad = await runPython(python, [journalPy, "check", broken], ws);
    out.broken = { code: bad.code, stderr: bad.stderr.trim().slice(0, 200) };
    fs.rmSync(broken);

    const noFlag = await runPython(python, [journalPy, "check", journal], ws, false);
    out.withoutUtf8Flag = { code: noFlag.code, cyrillicOk: noFlag.stdout.includes("улик сверено") };

    const proto = await runPython(python, [spike.protoScript, tools, journal, attack], ws);
    if (proto.code !== 0) throw new Error(`прообраз view-json: ${proto.stderr.slice(0, 400)}`);
    payload = JSON.parse(proto.stdout);
    const times: number[] = [proto.ms];
    for (let i = 0; i < 4; i++) times.push((await runPython(python, [spike.protoScript, tools, journal, attack], ws)).ms);
    out.viewJson = { medianMs: Math.round(median(times)), kb: Math.round(Buffer.byteLength(proto.stdout) / 1024), records: payload.records.length,
      evidence: payload.evidence, attackRows: payload.attacks[0]?.rows.length ?? 0, errors: payload.errors.length };

    // Подложенный python.exe в корне проекта: что запустит голое имя и что — найденный абсолютный путь.
    const planted = path.join(ws, "python.exe");
    fs.copyFileSync("C:\\Windows\\System32\\hostname.exe", planted);
    const bare = await new Promise<string>((res) => execFile("python", ["--version"], { cwd: ws, encoding: "utf8", windowsHide: true }, (e, so, se) => res(`${so}${se}${e && !so && !se ? String(e.message) : ""}`.trim())));
    const planted2 = resolvePython({ PATH: `${ws}${path.delimiter}.${path.delimiter}${process.env.PATH}` }, [ws]);
    fs.rmSync(planted);
    out.hijack = { bareNameRan: bare.slice(0, 80), bareNameHijacked: !/^Python /.test(bare), resolvedIgnoresWorkspace: planted2?.path === found.path };
    // То же в каталоге без кириллицы и через shell: где подмена срабатывает на самом деле.
    const ascii = path.join(process.env.SPIKE_WORK_ASCII!, "plain");
    fs.mkdirSync(ascii, { recursive: true });
    fs.copyFileSync("C:\\Windows\\System32\\hostname.exe", path.join(ascii, "python.exe"));
    const runIn = (cwd: string, shell: boolean) => new Promise<string>((res) =>
      execFile("python", ["--version"], { cwd, shell, encoding: "utf8", windowsHide: true }, (e, so, se) => res(`${so}${se}${e && !so && !se ? String(e.message) : ""}`.trim().slice(0, 80))));
    fs.copyFileSync("C:\\Windows\\System32\\hostname.exe", planted);
    out.hijack.variants = {
      asciiNoShell: await runIn(ascii, false), asciiShell: await runIn(ascii, true),
      cyrillicNoShell: await runIn(ws, false), cyrillicShell: await runIn(ws, true),
    };
    fs.rmSync(planted);
    fs.rmSync(ascii, { recursive: true });

    const empty = path.join(ws, "пустой");
    fs.mkdirSync(empty);
    out.notFound = { resolved: resolvePython({ PATH: empty }, [ws]) };
    fs.rmdirSync(empty);
    return out;
  });

  let viewer: Page | undefined;
  await step("ui", async () => {
    const opened = performance.now();
    viewer = await spike.open("viewer", "Журнал (проба)", vscode.ViewColumn.One);
    const panelOpenMs = Math.round(performance.now() - opened);
    const stress = (factor: number) => Array.from({ length: factor }, (_, k) =>
      payload.records.map((r: any) => (k === 0 ? r : { ...r, id: `${r.id}x${k}` }))).flat();
    const out: any = { panelOpenMs, dataKb: Math.round(JSON.stringify(payload.records).length / 1024) };
    for (const factor of [1, 5]) {
      const records = stress(factor);
      const loads: any[] = [];
      let bench: any;
      for (let i = 0; i < 5; i++) {
        await viewer.post({ type: "load", records, sentAt: Date.now() });
        loads.push(await viewer.bus.next("loaded"));
        if (i === 4) { await viewer.post({ type: "bench" }); bench = await viewer.bus.next("bench"); }
        await sleep(100);
      }
      out[`x${factor}`] = {
        cards: loads[0].cards, dom: loads[0].dom, heapMb: loads[4].heapMb, painted: loads.every((l) => l.painted),
        transferMs: median(loads.map((l) => l.transferMs)), commitMs: median(loads.map((l) => l.commit)), paintMs: median(loads.map((l) => l.paint)),
        firstLoad: { commit: loads[0].commit, paint: loads[0].paint }, bench,
      };
    }
    await viewer.post({ type: "load", records: stress(1), sentAt: Date.now() });
    await viewer.bus.next("loaded");
    return out;
  });

  await step("mermaid", async () => {
    const opened = performance.now();
    const scheme = await spike.open("scheme", "Схема (проба)", vscode.ViewColumn.Two);
    const panelOpenMs = Math.round(performance.now() - opened);
    const reopened = performance.now();
    const again2 = await spike.open("scheme", "Схема (проба) 2", vscode.ViewColumn.Two);
    const panelReopenMs = Math.round(performance.now() - reopened);
    again2.panel.dispose();
    const stageViolations: Record<string, any> = {};
    const render = async (label: string, text: string, bind = false) => {
      await scheme.post({ type: "render", label, text, bind, settle: 200 });
      const r = await scheme.bus.next("rendered", 30000);
      r.totalMs = +(r.totalMs - (r.ok ? 200 : 0)).toFixed(1);
      if (r.violations?.length) stageViolations[label] = r.violations;
      return r;
    };
    const NORMAL = `flowchart TD
  n1["Приём намерения"] --> n2{"Есть сценарий?"}
  n2 -- да --> n3["Схема из intent.md"]
  n2 -- нет --> n4["Вопрос человеку"]
  n4 --> n3
  n3 --> n5["Журнал решений"]
  n5 --> n6[("decisions.json")]
  n5 -.возврат.-> n2
  subgraph Плагин
    n7["Вкладка схемы"] --> n8["Карточки"]
  end
  n6 --> n7`;
    const out: any = { panelOpenMs, panelReopenMs };
    const first = await render("обычная", NORMAL);
    const again = await render("обычная", NORMAL);
    out.normal = { ...first, secondRenderMs: again.totalMs };

    await scheme.post({ type: "clickAll" });
    const clicked = await scheme.bus.next("clicked");
    const nodeClicks = scheme.bus.drain("nodeClick");
    out.clicks = { dispatched: clicked.count, received: nodeClicks.map((c: any) => c.id) };

    // Клик во вкладке схемы фильтрует карточки в другой вкладке — через расширение.
    const binding: Record<string, string[]> = { n5: payload.records.slice(0, 4).map((r: any) => r.id) };
    const sub = scheme.panel.webview.onDidReceiveMessage((m) => { if (m.type === "nodeClick" && binding[m.id]) void viewer!.post({ type: "filter", ids: binding[m.id] }); });
    await scheme.post({ type: "clickAll" });
    const filtered = await viewer!.bus.next("filtered", 10000);
    out.crossPanel = { expected: binding.n5, visible: filtered.visible, ms: filtered.ms, ok: JSON.stringify(binding.n5) === JSON.stringify(filtered.visible) };
    sub.dispose();
    await viewer!.post({ type: "filter", ids: null });
    await viewer!.bus.next("filtered", 10000);
    scheme.bus.drain("nodeClick");
    await scheme.bus.next("clicked");

    const cyr = await render("кириллица в идентификаторах", 'flowchart LR\n  узел1["Первый"] --> узел2["Второй"]');
    out.cyrillicIds = { ok: cyr.ok, nodes: cyr.nodes, rawIds: cyr.rawIds, error: cyr.error };

    const DANGER = `flowchart TD
  a["<img src=x onerror='window.__pwned=1'>Текст"] --> b["<b>жирный</b>"]
  c["<script>window.__pwned=2</script>С"] --> a
  d["<img src='https://example.invalid/beacon.png'>Метка"] --> a
  click a call pwn()
  click b href "javascript:window.__pwned=3"`;
    const strict = await render("опасная, strict", DANGER, true);
    await scheme.post({ type: "clickAll" });
    const strictClick = await scheme.bus.next("clicked");
    await scheme.post({ type: "mode", securityLevel: "loose" });
    await scheme.bus.next("moded");
    const loose = await render("опасная, loose (контроль)", DANGER, true);
    await scheme.post({ type: "clickAll" });
    const looseClick = await scheme.bus.next("clicked");
    await scheme.post({ type: "mode", securityLevel: "strict" });
    await scheme.bus.next("moded");
    const pick = (r: any, c: any) => ({ ok: r.ok, imgs: r.imgs, script: r.script, bold: r.bold, jsLinks: r.jsLinks, violations: r.violations, pwnedAfterClick: c.pwned, error: r.error });
    out.danger = { strict: pick(strict, strictClick), looseControl: pick(loose, looseClick) };
    scheme.bus.drain("nodeClick");

    const bad = await render("битая", "flowchart TD\n  a[Начало] --> b\n  b --> \n  c[[[");
    out.broken = { ok: bad.ok, error: bad.error };

    const seq = await render("последовательность", "sequenceDiagram\n  participant Ч as Человек\n  participant А as Агент\n  Ч->>А: intent.md\n  А-->>Ч: схема");
    out.sequence = { ok: seq.ok, flowNodes: seq.nodes?.length, actors: seq.actors, labels: seq.labels, error: seq.error };

    const big = ["flowchart TD", ...Array.from({ length: 59 }, (_, i) => `  n${i}["Шаг номер ${i}"] --> n${i + 1}["Шаг номер ${i + 1}"]`), ...Array.from({ length: 20 }, (_, i) => `  n${i * 2} --> n${59 - i}`)].join("\n");
    const large = await render("60 узлов", big);
    out.large = { ok: large.ok, nodes: large.nodes?.length, totalMs: large.totalMs, svgKb: large.svgKb };

    await scheme.post({ type: "report" });
    const report = await scheme.bus.next("report");
    out.csp = { stages: stageViolations, afterLast: report.violations };
    out.dark = report.dark;
    return out;
  });

  await step("saves", async () => {
    const file = path.join(change, "scheme.md");
    const uri = vscode.Uri.file(file);
    fs.writeFileSync(file, "# Схема\n\n```mermaid\nflowchart TD\n  a --> b\n```\n", "utf8");
    let log: string[] = [];
    const reasons: Record<number, string> = { 1: "Manual", 2: "AfterDelay", 3: "FocusOut" };
    const subs = [
      vscode.workspace.onWillSaveTextDocument((e) => { if (e.document.fileName === file) log.push(`willSave:${reasons[e.reason]}`); }),
      vscode.workspace.onDidSaveTextDocument((d) => { if (d.fileName === file) log.push("didSave"); }),
      vscode.workspace.onDidChangeTextDocument((e) => { if (e.document.fileName === file && e.contentChanges.length) log.push(e.document.isDirty ? "editorChange:dirty" : "editorChange:clean"); }),
    ];
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(change, "scheme.md"));
    subs.push(watcher, watcher.onDidChange(() => log.push("watcher")), watcher.onDidCreate(() => log.push("watcher:create")), watcher.onDidDelete(() => log.push("watcher:delete")));
    await sleep(1500);

    const cases: any = {};
    const measure = async (name: string, body: () => Promise<void>, wait = 2500) => {
      log = [];
      await body();
      await sleep(wait);
      cases[name] = [...log];
    };
    const type = async (ed: vscode.TextEditor, s: string) => { await ed.edit((b) => b.insert(new vscode.Position(0, 0), s)); };
    const opened = () => vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Three, preview: false });

    let ed = await opened();
    await measure("человек: правка и команда сохранения (как Ctrl+S)", async () => { await type(ed, "% ч\n"); await vscode.commands.executeCommand("workbench.action.files.save"); });
    await measure("агент CLI: запись на диск, файл открыт в редакторе", async () => { fs.writeFileSync(file, `${fs.readFileSync(file, "utf8")}\n% cli\n`, "utf8"); });
    await measure("другое расширение: workspace.fs.writeFile", async () => { await vscode.workspace.fs.writeFile(uri, Buffer.from(`${fs.readFileSync(file, "utf8")}\n% fs\n`, "utf8")); });
    await measure("другое расширение: правка и document.save()", async () => { ed = await opened(); await type(ed, "% расш\n"); await ed.document.save(); });
    await measure("принятие diff агента: WorkspaceEdit и document.save()", async () => {
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(0, 0), "% diff\n");
      await vscode.workspace.applyEdit(edit);
      const doc = await vscode.workspace.openTextDocument(uri);
      await doc.save();
    });
    await measure("Python-скрипт агента пишет файл", async () => {
      await runPython(python, ["-c", `open(r'''${file}''','a',encoding='utf-8').write('\\n% py\\n')`], ws);
    });
    await measure("атомарная запись: временный файл и переименование, файл открыт", async () => {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, `${fs.readFileSync(file, "utf8")}\n% atomic\n`, "utf8");
      fs.renameSync(tmp, file);
    });
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await sleep(300);
    await measure("файл закрыт: запись на диск", async () => { fs.writeFileSync(file, `${fs.readFileSync(file, "utf8")}\n% closed\n`, "utf8"); });
    await measure("файл закрыт: удаление и создание", async () => { const t = fs.readFileSync(file, "utf8"); fs.rmSync(file); await sleep(800); fs.writeFileSync(file, t, "utf8"); });

    const cfg = vscode.workspace.getConfiguration("files");
    await cfg.update("autoSaveDelay", 200, vscode.ConfigurationTarget.Global);
    await cfg.update("autoSave", "afterDelay", vscode.ConfigurationTarget.Global);
    ed = await opened();
    await measure("человек при автосохранении, 3 правки", async () => { for (const s of ["% 1\n", "% 2\n", "% 3\n"]) { await type(ed, s); await sleep(600); } });
    await cfg.update("autoSave", "off", vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    subs.forEach((s) => s.dispose());
    return { cases };
  });

  await step("freshness", async () => {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(change, "decisions.json"));
    const rounds: any[] = [];
    for (let i = 0; i < 5; i++) {
      const fired = new Promise<number>((res) => { const s = watcher.onDidChange(() => { s.dispose(); res(performance.now()); }); });
      const data = JSON.parse(fs.readFileSync(journal, "utf8"));
      const mark = `Правка номер ${i}: ${data.records[0].question.slice(0, 30)}`;
      data.records[0].question = mark;
      const t0 = performance.now();
      fs.writeFileSync(journal, JSON.stringify(data, null, 1), "utf8");
      const t1 = await fired;
      const proto = await runPython(python, [spike.protoScript, tools, journal, attack], ws);
      const next = JSON.parse(proto.stdout);
      const t2 = performance.now();
      await viewer!.post({ type: "update", records: next.records });
      const up = await viewer!.bus.next("updated", 10000);
      rounds.push({ watcherMs: Math.round(t1 - t0), pythonMs: Math.round(t2 - t1), uiMs: up.ms, totalMs: Math.round(performance.now() - t0), shown: up.first.includes(`Правка номер ${i}`) });
      await sleep(400);
    }
    watcher.dispose();
    return { rounds, totalMedianMs: median(rounds.map((r) => r.totalMs)), allShown: rounds.every((r) => r.shown) };
  });

  write();
}
