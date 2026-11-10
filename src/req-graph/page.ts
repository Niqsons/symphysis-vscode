import { graphFit, type GraphSelection, type GraphView } from "./graph";
import { isClick, zoomIn, zoomOut } from "../scheme/scheme";

declare const acquireVsCodeApi: () => { postMessage(value: unknown): void };
declare const mermaid: { initialize(config: Record<string, unknown>): void; render(id: string, text: string): Promise<{ svg: string }> };
const api = acquireVsCodeApi();
const root = document.getElementById("root")!;
root.innerHTML = `<div class="graph-page">
  <div class="graph-bar"><strong>Граф требований</strong><button id="graph-refresh">Обновить</button><span id="graph-status"></span></div>
  <div class="graph-filters"><label>Capability <select data-field="capability"></select></label><label>Требование <select data-field="requirement"></select></label><label>Модуль <select data-field="module"></select></label><label><input id="graph-linked" type="checkbox">Только со связями</label></div>
  <div id="graph-error" role="alert"></div><div id="graph-diagnostics"></div>
  <div class="graph-body"><section class="graph-drawing"><div class="graph-bar"><button data-zoom="out" aria-label="Уменьшить">−</button><button data-zoom="in" aria-label="Увеличить">+</button><button data-zoom="fit">Вписать</button></div><div id="graph-empty"></div><div id="graph-stage"><div id="graph-canvas"></div></div></section>
  <aside><h3 id="graph-scope"></h3><ul id="graph-unlinked"></ul><pre id="graph-object"></pre></aside></div></div>`;
const element = (id: string) => document.getElementById(id)!;
const canvas = element("graph-canvas");
const stage = element("graph-stage");
let drawSequence = 0;
let currentRevision = 0;
let shownRevision = 0;
let scale = 1, x = 0, y = 0;
let down: { x: number; y: number; left: number; top: number } | null = null;
let dragged = false;

function place(): void { canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`; }
function fit(): void {
  const svg = canvas.querySelector("svg");
  if (!svg || stage.clientWidth <= 0 || stage.clientHeight <= 0) return;
  const box = svg.viewBox.baseVal;
  scale = graphFit(box.width, box.height, stage.clientWidth, stage.clientHeight);
  x = (stage.clientWidth - box.width * scale) / 2;
  y = (stage.clientHeight - box.height * scale) / 2;
  place();
}

function filters(view: GraphView, selection: GraphSelection): void {
  for (const field of ["capability", "requirement", "module"] as const) {
    const select = root.querySelector<HTMLSelectElement>(`select[data-field="${field}"]`)!;
    const choices = view.choices[field === "capability" ? "capabilities" : field === "requirement" ? "requirements" : "modules"];
    select.replaceChildren(new Option("Выбрать…", ""), ...choices.map((choice) => new Option(
      field === "requirement" ? `${choice.capability} / ${choice.name}` : field === "module" ? choice.id : choice.name, choice.id)));
    if (selection[field] && !choices.some((choice) => choice.id === selection[field])) select.add(new Option(`${selection[field]} — недоступно`, selection[field]!));
    select.value = selection[field] ?? "";
  }
}

async function show(m: { revision: number; view: GraphView | null; selection: GraphSelection; source: { snapshot?: string; change: string }; loading: boolean; error: string | null }): Promise<void> {
  const sequence = ++drawSequence;
  currentRevision = m.revision;
  shownRevision = 0;
  canvas.replaceChildren();
  element("graph-error").textContent = m.error ?? "";
  element("graph-empty").textContent = m.loading ? "Загрузка…" : "";
  (element("graph-linked") as HTMLInputElement).checked = m.selection.linked_only;
  element("graph-refresh").hidden = !!m.source.snapshot;
  element("graph-status").textContent = m.source.snapshot
    ? `Снимок — ${m.source.snapshot} · переходы открывают текущее содержимое рабочих файлов`
    : `Живой граф — ${m.source.change}`;
  if (!m.view) {
    element("graph-diagnostics").replaceChildren();
    element("graph-unlinked").replaceChildren();
    element("graph-object").textContent = "";
    return;
  }
  const view = m.view;
  filters(view, m.selection);
  if (view.source.preliminary) element("graph-status").append(" · предварительный");
  element("graph-diagnostics").replaceChildren(...view.diagnostics.map((issue) => {
    const row = document.createElement("div"); row.className = "note";
    row.textContent = `${issue.kind} ${issue.at} — ${issue.reason}`;
    return row;
  }));
  element("graph-scope").textContent = `Без найденных связей · ${view.unlinked.scope === "change" ? "всё изменение" : "выбранная часть"}`;
  element("graph-unlinked").replaceChildren(...view.unlinked.items.map((item) => {
    const li = document.createElement("li"); const button = document.createElement("button");
    button.textContent = `${item.capability ? item.capability + ' / ' : ''}${item.name} · ${item.id}`;
    button.onclick = () => {
      element("graph-object").textContent = `${item.id}\n${item.name}\n${item.at}`;
      if (shownRevision === m.revision) api.postMessage({ type: "graphInspect", revision: shownRevision, id: item.id });
    };
    li.append(button); return li;
  }));
  if (!view.text) {
    element("graph-empty").textContent = view.empty ? "Пустая выборка" : "Выбери часть графа";
    shownRevision = m.revision;
    api.postMessage({ type: "graphRendered", revision: m.revision });
    return;
  }
  try {
    const svgId = `reqGraph${sequence}`;
    const { svg } = await mermaid.render(svgId, view.text);
    if (sequence !== drawSequence || currentRevision !== m.revision) return;
    canvas.innerHTML = svg;
    const drawing = canvas.querySelector("svg")!;
    drawing.style.maxWidth = "none";
    drawing.style.width = `${drawing.viewBox.baseVal.width}px`;
    drawing.style.height = `${drawing.viewBox.baseVal.height}px`;
    for (const node of canvas.querySelectorAll<SVGElement>("g.node")) {
      const key = node.id.slice(`${svgId}-`.length);
      if (!Object.hasOwn(view.elements, key)) continue;
      const open = () => { if (!dragged && shownRevision === m.revision) api.postMessage({ type: "graphNode", key, revision: shownRevision }); };
      node.setAttribute("tabindex", "0"); node.setAttribute("role", "button");
      node.setAttribute("aria-label", view.elements[key].name);
      node.addEventListener("click", open);
      node.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); dragged = false; open(); } });
    }
    element("graph-empty").textContent = "";
    shownRevision = m.revision;
    api.postMessage({ type: "graphRendered", revision: m.revision });
    fit();
  } catch {
    if (sequence !== drawSequence) return;
    canvas.replaceChildren();
    shownRevision = 0;
    element("graph-error").textContent = "Mermaid не смог отрисовать выбранную часть графа";
    api.postMessage({ type: "graphRenderFailed", revision: m.revision });
  }
}

for (const select of root.querySelectorAll<HTMLSelectElement>("select[data-field]")) {
  select.onchange = () => api.postMessage({ type: "graphChoose", field: select.dataset.field, value: select.value });
}
(element("graph-linked") as HTMLInputElement).onchange = (event) => api.postMessage({ type: "graphLinked", value: (event.target as HTMLInputElement).checked });
element("graph-refresh").onclick = () => api.postMessage({ type: "graphRefresh" });
for (const button of root.querySelectorAll<HTMLButtonElement>("button[data-zoom]")) {
  button.onclick = () => { if (button.dataset.zoom === "fit") fit(); else { scale = button.dataset.zoom === "in" ? zoomIn(scale) : zoomOut(scale); place(); } };
}
stage.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  dragged = false;
  down = { x: event.clientX, y: event.clientY, left: x, top: y };
});
window.addEventListener("pointermove", (event) => {
  if (!down) return;
  const dx = event.clientX - down.x, dy = event.clientY - down.y;
  if (!isClick(dx, dy)) dragged = true;
  if (dragged) { x = down.left + dx; y = down.top + dy; place(); }
});
window.addEventListener("pointerup", () => { down = null; });
new ResizeObserver(() => fit()).observe(stage);
window.addEventListener("message", (event) => { if (event.data?.type === "graph") void show(event.data); });
mermaid.initialize({ startOnLoad: false, securityLevel: "strict", maxTextSize: 50000 });
api.postMessage({ type: "graphReady" });
