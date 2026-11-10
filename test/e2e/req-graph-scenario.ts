import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { driver, results, sleep, step, until } from "./steps";

export async function run(): Promise<void> {
  if (process.env.SYMPHYSIS_GRAPH_UNTRUSTED === "1") {
    await step("req-graph сохраняет блокировку расширения в Restricted Mode", async () => {
      assert.equal(vscode.workspace.isTrusted, false);
      const ext = vscode.extensions.all.find((item) => item.packageJSON.name === "symphysis-vscode")!;
      assert.equal(ext.isActive, false);
      assert.equal(await ext.activate(), undefined);
    });
    fs.writeFileSync(process.env.SYMPHYSIS_E2E_RESULTS!, JSON.stringify({ tests: results, measures: {} }, null, 1));
    assert.ok(results.every((result) => result.ok));
    return;
  }
  await step("Mermaid requirementDiagram связывает сокращённые подписи с исходными id", async () => {
    const core = process.env.SYMPHYSIS_ROOT!;
    const code = ["import sys,json", "from pathlib import Path", "root=Path(sys.argv[1])",
      "sys.path[:0]=[str(p) for p in root.iterdir() if p.is_dir()]", "import trace_graph",
      "common='Общее ' + chr(34) + 'имя' + chr(34) + ' <b>разметка</b> &amp; &quot; &#60; ' + 'длинное ' * 12",
      "nodes=[dict(id='req:a/first',kind='req',name=common,at='specs/a/spec.md:4',capability='a',section='ADDED'),dict(id='req:b/second',kind='req',name=common,at='specs/b/spec.md:9',capability='b',section='ADDED'),dict(id='rec:F-22',kind='rec',name=common,at='decisions.json:12',number=22)]",
      "print(json.dumps(trace_graph.render_view(nodes,[]),ensure_ascii=False))"].join("\n");
    const view = JSON.parse(execFileSync("python", ["-X", "utf8", "-c", code, core], { encoding: "utf8" }));
    const ext = vscode.extensions.all.find((item) => item.packageJSON.name === "symphysis-vscode")!;
    const media = vscode.Uri.joinPath(ext.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel("reqGraphProbe", "Req-graph render", vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [media] });
    try {
      const result = new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("requirementDiagram не ответил за 20 секунд")), 20000);
        panel.webview.onDidReceiveMessage((message) => { clearTimeout(timer); resolve(message); });
      });
      const nonce = crypto.randomBytes(16).toString("base64");
      const mermaid = panel.webview.asWebviewUri(vscode.Uri.joinPath(media, "mermaid.min.js"));
      const input = JSON.stringify(view).replace(/</g, "\\u003c");
      panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:"></head><body><div id="drawing"></div><script nonce="${nonce}" src="${mermaid}"></script><script nonce="${nonce}">
        const api=acquireVsCodeApi(); const view=${input};
        (async()=>{try {
          mermaid.initialize({startOnLoad:false,securityLevel:'strict'});
          const {svg}=await mermaid.render('reqProbe',view.text);
          const drawing=document.getElementById('drawing'); drawing.innerHTML=svg;
          const clicked=[]; const ids=[];
          for(const node of drawing.querySelectorAll('g.node')) {
            const key=node.getAttribute('id').slice('reqProbe-'.length);
            if(!Object.hasOwn(view.elements,key)) continue;
            ids.push(key); node.addEventListener('click',()=>clicked.push(view.elements[key].id));
            node.firstElementChild.dispatchEvent(new MouseEvent('click',{bubbles:true}));
          }
          api.postMessage({ids,clicked,nodes:[...drawing.querySelectorAll('g')].filter(n=>n.id).map(n=>({id:n.id,cls:n.getAttribute('class')}))});
        }catch(error){api.postMessage({error:String(error)})}})();
      </script></body></html>`;
      const observed = await result;
      assert.equal(observed.error, undefined);
      assert.deepEqual(observed.clicked, ["req:a/first", "req:b/second", "rec:F-22"], JSON.stringify(observed));
      assert.equal(new Set(observed.ids).size, 3);
    } finally {
      panel.dispose();
    }
  });
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const base = path.join(root, "openspec/changes/demo");
  fs.mkdirSync(path.join(base, "specs/a"), { recursive: true });
  fs.writeFileSync(path.join(base, ".openspec.yaml"), "schema: symphysis\n");
  fs.writeFileSync(path.join(base, "proposal.md"), "### New Capabilities\n- `a`: demo\n");
  fs.writeFileSync(path.join(base, "specs/a/spec.md"), "## ADDED Requirements\n### Requirement: R\nSHALL. (F-02)\n#### Scenario: S\n- **WHEN** a\n- **THEN** b\n### Requirement: Alone\nSHALL.\n");
  const ext = vscode.extensions.all.find((item) => item.packageJSON.name === "symphysis-vscode")!;
  fs.copyFileSync(path.join(process.env.SYMPHYSIS_GRAPH_FIXTURES!, "decisions.json"), path.join(base, "decisions.json"));
  const api = await ext.activate() as any;
  let graphRevision = 0;
  api.graph.messages.event((message: any) => { if (message.type === "graphRendered") graphRevision = message.revision; });
  await step("req-graph открывается отдельной вкладкой и ждёт выбора части", async () => {
    await vscode.commands.executeCommand("symphysis.openGraph", base);
    assert.ok(api.graph?.webview);
    const drive = driver(() => api.graph.webview, api.graph.messages);
    const shown = await until("перечни графа", async () => {
      const value = await drive("graphSnapshot");
      return value.requirements.length === 2 ? value : null;
    });
    assert.equal(shown.nodes.length, 0);
    assert.match(shown.status, /предварительный/);
    await drive("graphChoose", { field: "requirement", value: "req:a/R" });
    const graph = await until("рисунок требования", async () => {
      const value = await drive("graphSnapshot");
      return value.nodes.length >= 3 ? value : null;
    });
    assert.ok(graph.nodes.some((id: string) => id.includes("REQ_")));
    assert.equal(graph.error, "");
  });
  await step("req-graph переключатель скрывает только изолированный выбранный узел", async () => {
    const drive = driver(() => api.graph.webview, api.graph.messages);
    await drive("graphChoose", { field: "requirement", value: "req:a/Alone" });
    await until("одинокое требование", async () => (await drive("graphSnapshot")).nodes.length === 1);
    await drive("graphToggle");
    const empty = await until("пустая часть", async () => {
      const value = await drive("graphSnapshot");
      return value.empty ? value : null;
    });
    assert.equal(empty.nodes.length, 0);
    assert.equal(empty.requirement, "req:a/Alone");
    await drive("graphToggle");
    await until("изолированный узел снова виден", async () => (await drive("graphSnapshot")).nodes.length === 1);
  });
  await step("req-graph открывает журнал источника и дожидается его карточек", async () => {
    const drive = driver(() => api.graph.webview, api.graph.messages);
    await drive("graphChoose", { field: "requirement", value: "req:a/R" });
    await until("узлы требования", async () => (await drive("graphSnapshot")).nodes.length >= 3);
    await drive("graphNode", { prefix: "-REC_2 " });
    await until("журнал источника", () => api.viewer.currentKey === base);
    const journal = driver(() => api.viewer.webview, api.viewer.messages);
    await until("нужная карточка показана", async () => (await journal("cardVisible", { id: "F-02" })).inView);
    assert.equal((await drive("graphSnapshot")).requirement, "req:a/R");
  });
  await step("req-graph открывает исходное требование на его строке", async () => {
    const drive = driver(() => api.graph.webview, api.graph.messages);
    await drive("graphNode", { prefix: "-REQ_1 " });
    const editor = await until("исходный файл", () => vscode.window.visibleTextEditors.find((item) => item.document.uri.fsPath === path.join(base, "specs/a/spec.md")));
    assert.ok(editor);
    await until("редактор на строке требования", () => editor.selection.start.line === 1);
    assert.equal(editor.selection.start.line, 1);
  });
  await step("req-graph принимает новый выбор пока предыдущий запрос выполняется", async () => {
    const drive = driver(() => api.graph.webview, api.graph.messages);
    await drive("graphBurst", { values: ["req:a/R", "req:a/Alone"] });
    await until("последний выбор", async () => {
      const shown = await drive("graphSnapshot");
      return shown.requirement === "req:a/Alone" && shown.nodes.length === 1;
    });
  });
  await step("req-graph обновляет связи по изменённым specs", async () => {
    const drive = driver(() => api.graph.webview, api.graph.messages);
    await drive("graphChoose", { field: "requirement", value: "req:a/R" });
    await until("исходная запись", async () => (await drive("graphSnapshot")).nodes.some((id: string) => id.includes("-REC_2 ")));
    const file = path.join(base, "specs/a/spec.md");
    const original = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, original.replace("(F-02)", "(F-03)"));
    await drive("post", { message: { type: "graphRefresh" } });
    await until("новая связь", async () => (await drive("graphSnapshot")).nodes.some((id: string) => id.includes("-REC_3 ")));
    fs.writeFileSync(file, original);
    await drive("post", { message: { type: "graphRefresh" } });
    await until("исходная связь восстановлена", async () => (await drive("graphSnapshot")).nodes.some((id: string) => id.includes("-REC_2 ")));
  });
  const archived = path.join(root, "openspec/changes/archive/2026-demo");
  const snapshot = path.join(archived, "graph/req-graph.json");
  await step("req-graph открывает архивный снимок и повторно фокусирует его вкладку", async () => {
    fs.mkdirSync(path.dirname(snapshot), { recursive: true });
    fs.copyFileSync(path.join(base, "decisions.json"), path.join(archived, "decisions.json"));
    fs.mkdirSync(path.join(archived, "specs/a"), { recursive: true });
    fs.copyFileSync(path.join(base, "specs/a/spec.md"), path.join(archived, "specs/a/spec.md"));
    const raw = execFileSync("python", ["-X", "utf8", path.join(root, ".symphysis/tools/trace_graph.py"), "build", "demo"], { cwd: root });
    fs.writeFileSync(snapshot, raw);
    await vscode.commands.executeCommand("symphysis.openGraphSnapshot", vscode.Uri.file(snapshot));
    const drive = driver(() => api.graph.webview, api.graph.messages);
    await until("выбор снимка", async () => (await drive("graphSnapshot")).requirements.length === 2);
    await drive("graphChoose", { field: "requirement", value: "req:a/R" });
    await until("рисунок снимка", async () => (await drive("graphSnapshot")).nodes.length >= 3);
    const previous = api.graph.webview;
    const count = vscode.window.tabGroups.all.flatMap((group) => group.tabs).length;
    await vscode.commands.executeCommand("symphysis.openGraphSnapshot", vscode.Uri.file(snapshot));
    assert.equal(api.graph.webview, previous);
    assert.equal(vscode.window.tabGroups.all.flatMap((group) => group.tabs).length, count);
    assert.equal((await drive("graphSnapshot")).requirement, "req:a/R");
    assert.match((await drive("graphSnapshot")).status, /Снимок/);
  });
  await step("req-graph переходит из снимка в его архивный журнал", async () => {
    const drive = driver(() => api.graph.webview, api.graph.messages);
    await drive("graphNode", { prefix: "-REC_2 " });
    await until("журнал архива", () => api.viewer.currentKey === archived);
    const journal = driver(() => api.viewer.webview, api.viewer.messages);
    await until("карточка журнала архива", async () => (await journal("cardVisible", { id: "F-02" })).inView);
  });
  await step("req-graph из архивного журнала повторно открывает его снимок", async () => {
    const previous = api.graph.webview;
    await vscode.commands.executeCommand("symphysis.openGraph");
    const actual = api.graph.webview;
    await vscode.commands.executeCommand("symphysis.openGraphSnapshot", vscode.Uri.file(snapshot));
    assert.equal(actual, previous);
    assert.ok(!api.store.list().some((state: any) => state.ref.dir === archived));
  });
  await step("req-graph масштаб, перемещение и вписывание меняют положение рисунка", async () => {
    const drive = driver(() => api.graph.webview, api.graph.messages);
    const fitted = (await drive("graphSnapshot")).transform;
    const zoomed = (await drive("graphZoom", { zoom: "in" })).transform;
    assert.notEqual(zoomed, fitted);
    assert.notEqual((await drive("graphDrag", { dx: 80, dy: 50 })).transform, zoomed);
    assert.equal((await drive("graphZoom", { zoom: "fit" })).transform, fitted);
  });
  await step("req-graph переход из снимка обозначает текущее содержимое рабочего файла", async () => {
    const file = path.join(archived, "specs/a/spec.md");
    fs.writeFileSync(file, "Текущее содержимое\nизменённая строка\n");
    const drive = driver(() => api.graph.webview, api.graph.messages);
    await drive("graphNode", { prefix: "-REQ_1 " });
    await until("текущий файл", () => vscode.window.visibleTextEditors.some((editor) => editor.document.uri.fsPath === file
      && editor.document.getText().startsWith("Текущее содержимое") && editor.selection.start.line === 1));
    assert.match((await drive("graphSnapshot")).status, /текущее содержимое/);
  });
  await step("req-graph ошибка Mermaid очищает прежний SVG и отключает старую карту", async () => {
    const drive = driver(() => api.graph.webview, api.graph.messages);
    const view = JSON.parse(execFileSync("python", ["-X", "utf8", path.join(root, ".symphysis/tools/trace_graph.py"),
      "view", "2026-demo", "--snapshot", snapshot, "--requirement", "req:a/R"], { cwd: root, encoding: "utf8" }));
    const revision = graphRevision;
    const oldKey = Object.keys(view.elements).find((key) => view.elements[key].id === "req:a/R")!;
    const editor = vscode.window.visibleTextEditors.find((item) => item.document.uri.fsPath === path.join(archived, "specs/a/spec.md"))!;
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await api.graph.webview.postMessage({ type: "graph", revision, view: { ...view, text: "requirementDiagram\nthis is invalid" },
      source: { root, change: "2026-demo", snapshot }, selection: view.selection, loading: false, error: null });
    await until("ошибка рендера", async () => (await drive("graphSnapshot")).error.includes("Mermaid"));
    assert.equal((await drive("graphSnapshot")).nodes.length, 0);
    await drive("post", { message: { type: "graphNode", revision, key: oldKey } });
    await sleep(150);
    assert.equal(editor.selection.start.line, 0);
  });
  await step("req-graph безопасно показывает опасные подписи и блокирует внешнюю картинку", async () => {
    const raw = JSON.parse(fs.readFileSync(snapshot, "utf8"));
    const hostileNames = ['<img src="https://example.org/graph-test.png" onerror="alert(1)">',
      '[action](command:workbench.action.closeWindow)', '[run](javascript:alert(1))',
      '![image](https://example.org/graph-test.png)', '%%{init: {"securityLevel":"loose"}}%% #lt;script#gt;',
      '&lt;img src="https://example.org/graph-test.png" onerror="alert(1)"&gt;'];
    hostileNames.forEach((name, index) => raw.nodes.push({ id: `req:a/hostile${index}`, kind: "req", name,
      capability: "a", section: "ADDED", at: "specs/a/spec.md:2" }));
    const hostile = path.join(path.dirname(snapshot), "hostile.json");
    fs.writeFileSync(hostile, JSON.stringify(raw));
    await vscode.commands.executeCommand("symphysis.openGraphSnapshot", vscode.Uri.file(hostile));
    const drive = driver(() => api.graph.webview, api.graph.messages);
    await until("перечень опасного снимка", async () => (await drive("graphSnapshot")).requirements.length === hostileNames.length + 2);
    await drive("graphChoose", { field: "capability", value: "a" });
    await until("очищенный рисунок", async () => (await drive("graphSnapshot")).nodes.length >= 3);
    assert.equal((await drive("graphSnapshot")).unsafe, 0);
    assert.deepEqual((await drive("graphSnapshot")).violations, []);
    await drive("graphProbeResource");
    await until("CSP блокирует картинку", async () => (await drive("graphSnapshot")).violations.some((line: string) => line.includes("img-src") && line.includes("example.org")));
  });
  await step("req-graph читает выбранный снимок из произвольного каталога с пробелами", async () => {
    const file = path.join(root, "каталог с пробелами/req-graph.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(snapshot, file);
    await vscode.commands.executeCommand("symphysis.openGraphSnapshot", vscode.Uri.file(file));
    const drive = driver(() => api.graph.webview, api.graph.messages);
    const shown = await until("ответ выбранного файла", async () => {
      const value = await drive("graphSnapshot");
      return value.requirements.length === 2 || value.error ? value : null;
    });
    assert.equal(shown.error, "");
    assert.equal(shown.requirements.length, 2);
  });
  await step("req-graph фильтрует модуль по capability и различает одинаковые имена списка", async () => {
    const data = JSON.parse(fs.readFileSync(snapshot, "utf8"));
    data.nodes.push({ id: "cap:b", kind: "cap", name: "b", at: "specs/b/spec.md:1" },
      { id: "req:b/R", kind: "req", name: "R", capability: "b", section: "ADDED", at: "specs/b/spec.md:2" });
    for (const [repo, name] of [["one", "trace"], ["two", "trace"], ["one", "empty"]]) {
      data.nodes.push({ id: `module:${repo}/${name}`, kind: "module", name, repo, at: `${repo}/README.md:1` });
    }
    data.edges = data.edges.filter((edge: any) => edge.type !== "traces");
    data.edges.push({ from: "cap:b", to: "req:b/R", type: "contains" },
      { from: "module:one/trace", to: "req:a/R", type: "implements" },
      { from: "module:one/trace", to: "req:b/R", type: "implements" },
      { from: "module:two/trace", to: "req:a/R", type: "implements" });
    const file = path.join(path.dirname(snapshot), "modules.json");
    fs.writeFileSync(file, JSON.stringify(data));
    await vscode.commands.executeCommand("symphysis.openGraphSnapshot", vscode.Uri.file(file));
    const drive = driver(() => api.graph.webview, api.graph.messages);
    await until("модули в выборе", async () => (await drive("graphSnapshot")).modules.length === 3);
    await drive("graphChoose", { field: "module", value: "one/trace" });
    await until("требования двух capability", async () => (await drive("graphSnapshot")).nodes.filter((id: string) => id.includes("-REQ_")).length === 2);
    await drive("graphChoose", { field: "capability", value: "a" });
    await until("пересечение с capability", async () => (await drive("graphSnapshot")).nodes.filter((id: string) => id.includes("-REQ_")).length === 1);
    const shown = await drive("graphSnapshot");
    assert.ok(shown.unlinked.some((label: string) => label.includes("a / R · req:a/R")));
    assert.ok(shown.unlinked.some((label: string) => label.includes("b / R · req:b/R")));
    assert.match((await drive("graphInspect", { id: "req:b/R" })).object, /^req:b\/R/);
    await drive("graphChoose", { field: "module", value: "one/empty" });
    await until("известный пустой модуль", async () => (await drive("graphSnapshot")).empty);
    assert.match((await drive("graphInspect", { id: "rec:F-01" })).object, /^rec:F-01/);
  });
  fs.mkdirSync(path.dirname(process.env.SYMPHYSIS_E2E_RESULTS!), { recursive: true });
  fs.writeFileSync(process.env.SYMPHYSIS_E2E_RESULTS!, JSON.stringify({ tests: results, measures: {} }, null, 1));
  assert.ok(results.every((result) => result.ok));
}
