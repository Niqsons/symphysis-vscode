// Вкладка схемы: mermaid в строгом режиме, клик вешаем сами — по идентификатору узла в готовом рисунке.
declare const mermaid: any;
declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();
const box = document.getElementById("scheme")!;
const dark = document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast");

const violations: any[] = [];
window.addEventListener("securitypolicyviolation", (e) => violations.push({ directive: e.violatedDirective, blocked: e.blockedURI }));

function init(securityLevel: string) { mermaid.initialize({ startOnLoad: false, securityLevel, theme: dark ? "dark" : "default" }); }
init("strict");

(window as any).pwn = () => { (window as any).__pwned = "call"; };

const nodeId = (g: Element) => /flowchart-(.+)-\d+$/.exec(g.id)?.[1] ?? null;
box.addEventListener("click", (e) => {
  const g = (e.target as Element).closest("g.node");
  if (g) vscode.postMessage({ type: "nodeClick", id: nodeId(g), rawId: g.id });
});

let counter = 0;
async function render(m: any) {
  (window as any).__pwned = undefined;
  box.innerHTML = "";
  const t0 = performance.now();
  try {
    await mermaid.parse(m.text);
    const parsed = performance.now() - t0;
    const { svg, bindFunctions } = await mermaid.render(`scheme${++counter}`, m.text);
    box.innerHTML = svg;
    if (m.bind) bindFunctions?.(box);
    const nodes = [...box.querySelectorAll("g.node")];
    if (m.settle) await new Promise((r) => setTimeout(r, m.settle));
    vscode.postMessage({
      imgs: [...box.querySelectorAll("img")].map((i) => i.outerHTML.slice(0, 200)), violations: violations.splice(0),
      type: "rendered", label: m.label, ok: true, parseMs: +parsed.toFixed(1), totalMs: +(performance.now() - t0).toFixed(1),
      nodes: nodes.map(nodeId), rawIds: nodes.slice(0, 3).map((g) => g.id), svgKb: Math.round(svg.length / 1024),
      img: box.querySelectorAll("img").length, script: box.querySelectorAll("script").length,
      bold: box.querySelectorAll("b").length, jsLinks: [...box.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? a.getAttribute("xlink:href")),
      actors: box.querySelectorAll(".actor, [class*=actor]").length, labels: (box.textContent ?? "").replace(/\s+/g, " ").slice(0, 160),
    });
  } catch (err: any) {
    vscode.postMessage({ type: "rendered", label: m.label, ok: false, error: String(err?.message ?? err).slice(0, 400) });
  }
}

window.addEventListener("message", async (ev) => {
  const m = ev.data;
  if (m.type === "render") await render(m);
  else if (m.type === "mode") { init(m.securityLevel); vscode.postMessage({ type: "moded" }); }
  else if (m.type === "clickAll") {
    // Клик по внутреннему элементу узла всплывает так же, как настоящий клик мышью.
    const nodes = [...box.querySelectorAll("g.node")];
    for (const g of nodes) (g.querySelector("foreignObject *, text, rect, path") ?? g).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 50));
    vscode.postMessage({ type: "clicked", count: nodes.length, pwned: (window as any).__pwned ?? null });
  } else if (m.type === "report") {
    vscode.postMessage({ type: "report", violations, dark, hasMermaid: typeof mermaid !== "undefined", pwned: (window as any).__pwned ?? null });
  }
});
vscode.postMessage({ type: "ready" });
