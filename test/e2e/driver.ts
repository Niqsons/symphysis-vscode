// Водитель страницы для сквозных тестов: настоящие клики и ввод в настоящем DOM. Грузится только в ExtensionMode.Test,
// в .vsix не входит. Перехватывает acquireVsCodeApi: страница получает обычный api, водитель делит его с ней.
declare const acquireVsCodeApi: () => { postMessage(m: unknown): void };

const api = acquireVsCodeApi();
(globalThis as any).acquireVsCodeApi = () => api;

const violations: string[] = [];
document.addEventListener("securitypolicyviolation", (e) => violations.push(`${e.violatedDirective}: ${e.blockedURI}`));

// Сколько раз хост прислал новые данные журнала: каждый раз перерисовываются все карточки.
let journalMessages = 0;
window.addEventListener("message", (ev) => {
  if (ev.data?.type === "journal") journalMessages++;
});

const setValue = (el: HTMLTextAreaElement | HTMLInputElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

const buttonByText = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text);

const settle = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));

/** Насколько содержимое шире области прокрутки и какой элемент виноват: первый, вылезший за правый край. */
function overflowX() {
  const main = document.querySelector("main");
  if (!main) return { px: 0, culprit: "" };
  const right = main.getBoundingClientRect().left + main.clientWidth;
  const culprit = [...main.querySelectorAll<HTMLElement>("*")].find((el) => el.getBoundingClientRect().right > right + 1);
  return { px: main.scrollWidth - main.clientWidth, culprit: culprit ? `${culprit.tagName}.${culprit.className}: ${(culprit.textContent ?? "").slice(0, 60)}` : "" };
}

function attackRow(claim: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>(".attackrow")].find((r) => r.querySelector("h3")?.textContent?.includes(claim));
  if (!row) throw new Error(`нет строки атаки «${claim}»`);
  return row;
}

function snapshot() {
  const prompt = document.querySelector<HTMLTextAreaElement>(".prompt-text");
  return {
    title: document.querySelector(".top h1")?.textContent ?? "",
    nodeFilter: document.querySelector(".nodefilter b")?.textContent ?? null,
    empty: document.querySelector("main .empty")?.textContent ?? null,
    mode: document.querySelector(".modes .active")?.textContent ?? "",
    returnPanel: !!document.querySelector(".return"),
    inputsInMain: document.querySelectorAll("main textarea, main input, main button, main select").length,
    stats: document.querySelector(".stats")?.textContent ?? "",
    cards: [...document.querySelectorAll<HTMLElement>("article.card")].map((c) => c.id),
    prompt: prompt?.value ?? null,
    report: document.querySelector(".report")?.textContent ?? null,
    notes: [...document.querySelectorAll<HTMLElement>("main > .note")].map((n) => n.textContent ?? ""),
    applyDisabled: buttonByText(document, "Внести")?.disabled ?? null,
    signalColor: getComputedStyle(document.documentElement).getPropertyValue("--sym-signal").trim(),
    violations: [...violations],
    scrollTop: document.querySelector("main")?.scrollTop ?? 0,
    overflowX: overflowX(),
    journalMessages,
  };
}

/** Страница поиска в боковой панели. */
function searchSnapshot() {
  const results = document.querySelector<HTMLElement>(".search-results");
  return {
    query: document.querySelector<HTMLInputElement>(".search > input")?.value ?? null,
    scope: document.querySelector(".search-scope b")?.textContent ?? null,
    scopeLine: document.querySelector(".search-scope")?.textContent ?? "",
    hits: [...document.querySelectorAll<HTMLElement>(".hit")].map((h) => ({
      label: h.querySelector(".hit-label")?.textContent ?? "", field: h.querySelector(".hit-field")?.textContent ?? "", mark: h.querySelector("mark")?.textContent ?? "",
    })),
    deps: [...document.querySelectorAll<HTMLElement>(".dep .hit-label")].map((l) => l.textContent ?? ""),
    text: results?.textContent ?? "",
    violations: [...violations],
    overflowPx: results ? results.scrollWidth - results.clientWidth : 0,
  };
}

/** Вкладка схемы. */
function schemeSnapshot() {
  const canvas = document.querySelector<HTMLElement>("#canvas");
  const stage = document.querySelector<HTMLElement>("#stage");
  const source = document.querySelector<HTMLElement>("#source");
  const svg = canvas?.querySelector("svg") ?? null;
  const nodes = svg ? [...svg.querySelectorAll<SVGGElement>("g.node")] : [];
  let topVisible: boolean | null = null;
  if (nodes.length && stage) {
    const box = (n: Element) => n.getBoundingClientRect();
    const top = nodes.reduce((a, b) => (box(b).top < box(a).top ? b : a));
    const t = box(top), s = box(stage);
    topVisible = t.left >= s.left && t.right <= s.right && t.top >= s.top && t.bottom <= s.bottom;
  }
  return {
    state: stage?.dataset.state ?? "",
    panel: document.querySelector(".panel-switch .active")?.textContent ?? "",
    plates: [...document.querySelectorAll<HTMLElement>("#plates .note")].map((n) => n.textContent ?? ""),
    openButton: !!buttonByText(document, "Открыть scheme.md"),
    source: source && !source.hidden ? source.textContent : null,
    hasSvg: !!svg,
    nodes: nodes.map((n) => n.id),
    scale: Number(canvas?.dataset.scale),
    x: Number(canvas?.dataset.x),
    y: Number(canvas?.dataset.y),
    topVisible,
    onclick: svg ? svg.querySelectorAll("[onclick]").length : 0,
    jsLinks: svg ? [...svg.querySelectorAll("a")].filter((a) => /javascript:/i.test(a.getAttribute("href") ?? a.getAttribute("xlink:href") ?? "")).length : 0,
    violations: [...violations],
    stageWidth: stage?.clientWidth ?? 0,
  };
}

/** Страница справки на той же вкладке. */
function helpSnapshot() {
  const body = document.querySelector<HTMLElement>(".help-body");
  return {
    isHelp: !!body,
    panel: document.querySelector(".panel-switch .active")?.textContent ?? "",
    name: document.querySelector(".scheme-name")?.textContent ?? "",
    current: document.querySelector(".help-current")?.textContent ?? null,
    steps: [...document.querySelectorAll<HTMLElement>(".help-steps li")].map((l) => l.textContent ?? ""),
    currentInList: document.querySelector('.help-steps [aria-current="step"]')?.textContent ?? null,
    page: document.querySelector(".help-page")?.getAttribute("data-step") ?? null,
    rules: !!document.querySelector(".help-page[data-rules]"),
    versions: document.querySelector(".help-versions")?.textContent ?? null,
    nextDisabled: [...document.querySelectorAll<HTMLButtonElement>(".help-nav button")].find((b) => b.textContent === "следующий")?.disabled ?? null,
    choices: [...document.querySelectorAll<HTMLButtonElement>(".help-choices button")].map((b) => b.textContent ?? ""),
    note: document.querySelector(".help-body .note")?.textContent ?? null,
    text: body?.textContent ?? "",
    violations: [...violations],
  };
}

/** Настоящие события указателя: нажатие, сдвиг, отпускание над узлом или над пустым местом. */
function press(target: Element, dx: number, dy: number) {
  const r = target.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const fire = (type: string, cx: number, cy: number) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: cx, clientY: cy, pointerId: 1, button: 0 }));
  fire("pointerdown", x, y);
  if (dx || dy) fire("pointermove", x + dx, y + dy);
  fire("pointerup", x + dx, y + dy);
}

async function drive(m: any): Promise<unknown> {
  const card = m.id ? document.getElementById(m.id) : null;
  switch (m.action) {
    case "snapshot":
      return snapshot();
    case "schemeSnapshot":
      return schemeSnapshot();
    case "helpSnapshot":
      return helpSnapshot();
    case "panelSwitch": {
      // Ответ без ожидания: хост заменит страницу, и позже отвечать будет некому.
      const b = buttonByText(document.querySelector(".panel-switch")!, m.text);
      if (!b) throw new Error(`нет положения «${m.text}»`);
      b.click();
      return null;
    }
    case "post":
      // Страница может прислать что угодно: хост не должен этому верить.
      api.postMessage(m.message);
      return null;
    case "helpClick": {
      // Кнопка справки по тексту: шаг в списке, «предыдущий», «следующий», «Как готовить intent.md?».
      const b = [...document.querySelectorAll<HTMLButtonElement>(".help-body button, .scheme-bar button")].find((x) => x.textContent === m.text);
      if (!b) throw new Error(`нет кнопки «${m.text}»`);
      b.click();
      await settle();
      return helpSnapshot();
    }
    case "helpLinks":
      return [...document.querySelectorAll<HTMLElement>(".help-page [data-file-link]")].map((x) => x.dataset.fileLink);
    case "helpFileLink": {
      // Настоящий клик по ссылке на файл шага.
      const links = [...document.querySelectorAll<HTMLElement>(".help-page [data-file-link]")];
      const link = m.key ? links.find((x) => x.dataset.fileLink === m.key) : links[0];
      if (!link) throw new Error(`нет ссылки на файл шага ${m.key ?? ""}`);
      link.click();
      await settle();
      return { key: link.dataset.fileLink, links: links.map((x) => x.dataset.fileLink) };
    }
    case "helpChoose": {
      const b = [...document.querySelectorAll<HTMLButtonElement>(".help-choices button")].find((x) => x.textContent === m.text);
      if (!b) throw new Error(`нет строки «${m.text}»`);
      b.click();
      await settle();
      return helpSnapshot();
    }
    case "schemeNode": {
      const node = [...document.querySelectorAll("#canvas g.node")].find((n) => n.id.includes(`-${m.id}-`));
      if (!node) throw new Error(`нет узла ${m.id}`);
      press(node, m.dx ?? 0, m.dy ?? 0);
      await settle();
      return schemeSnapshot();
    }
    case "schemeDrag": {
      press(document.querySelector("#stage")!, m.dx, m.dy);
      await settle();
      return schemeSnapshot();
    }
    case "schemeClickText": {
      const button = buttonByText(document, m.text);
      if (!button) throw new Error(`нет кнопки «${m.text}»`);
      for (let i = 0; i < (m.times ?? 1); i++) button.click();
      // Кнопка, что открывает файл поверх вкладки, скрывает страницу: скрытая страница кадров не получает, ответа не было бы.
      if (!m.hides) await settle();
      return schemeSnapshot();
    }
    case "link": {
      const b = card!.querySelector<HTMLElement>(`[data-file-link="${m.key}"]`);
      if (!b) throw new Error(`нет ссылки ${m.key} в ${m.id}`);
      b.click();
      break;
    }
    case "checkedLetter":
      // Выбор живёт в свойстве радиокнопки, в атрибуте `checked` его нет.
      return card!.querySelector<HTMLInputElement>("input[type=radio]:checked")?.value ?? null;
    case "cardHtml":
      return card?.outerHTML ?? null;
    case "choose": {
      card!.querySelector<HTMLInputElement>(`input[type=radio][value="${m.letter}"]`)!.click();
      break;
    }
    case "word": {
      setValue(card!.querySelector<HTMLTextAreaElement>("textarea")!, m.text);
      break;
    }
    case "park": {
      const details = card!.querySelector("details.park")!;
      (details as HTMLDetailsElement).open = true;
      setValue(details.querySelector<HTMLInputElement>('input[type="text"]')!, m.text);
      const select = details.querySelector("select")!;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, m.addressee);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await settle();
      buttonByText(details, "припарковать")!.click();
      break;
    }
    case "click": {
      const scope = card ?? document;
      const b = buttonByText(scope, m.text);
      if (!b) throw new Error(`нет кнопки «${m.text}»`);
      b.click();
      break;
    }
    case "filter": {
      const b = [...document.querySelectorAll<HTMLButtonElement>(".recordfilter button")].find((x) => x.textContent?.startsWith(m.name));
      if (!b) throw new Error(`нет фильтра ${m.name}`);
      b.click();
      break;
    }
    case "segLook": {
      // Заметно ли выбранное: настоящий вычисленный цвет заливки, а не класс; и где переключатель стоит при прокрутке.
      const seg = document.querySelector<HTMLElement>(m.selector);
      if (!seg) throw new Error(`нет переключателя ${m.selector}`);
      const active = seg.querySelector<HTMLButtonElement>("button.active")!;
      const other = seg.querySelector<HTMLButtonElement>("button:not(.active)")!;
      return {
        active: active.textContent, pressed: active.getAttribute("aria-pressed"),
        activeBg: getComputedStyle(active).backgroundColor, otherBg: getComputedStyle(other).backgroundColor,
        inMain: !!seg.closest("main"), top: seg.getBoundingClientRect().top,
      };
    }
    case "scrollMain": {
      document.querySelector("main")!.scrollTop = m.top;
      break;
    }
    case "searchSnapshot":
      return searchSnapshot();
    case "searchType": {
      const input = document.querySelector<HTMLInputElement>(".search > input")!;
      const t0 = performance.now();
      setValue(input, m.text);
      const results = document.querySelector(".search-results")!;
      while (results.getAttribute("data-query") !== m.text) {
        if (performance.now() - t0 > 5000) throw new Error(`нет ответа на запрос «${m.text}»`);
        await new Promise((r) => setTimeout(r, 10));
      }
      await settle();
      return { ...searchSnapshot(), ms: Math.round(performance.now() - t0) };
    }
    case "searchOpen": {
      const b = [...document.querySelectorAll<HTMLButtonElement>(".hit, .dep")].find((x) => x.querySelector(".hit-label")?.textContent === m.label);
      if (!b) throw new Error(`нет попадания ${m.label}`);
      b.click();
      return searchSnapshot();
    }
    case "followDependency": {
      card!.querySelector<HTMLAnchorElement>(`.chip a[href="#${m.dep}"]`)!.click();
      break;
    }
    case "text":
      return document.querySelector("main")?.textContent ?? "";
    case "mode": {
      const b = [...document.querySelectorAll<HTMLButtonElement>(".modes button")].find((x) => x.textContent?.startsWith(m.name));
      if (!b) throw new Error(`нет режима ${m.name}`);
      b.click();
      break;
    }
    case "lens": {
      const b = [...document.querySelectorAll<HTMLButtonElement>(".lensfilter button")].find((x) => x.textContent?.startsWith(m.name));
      if (!b) throw new Error(`нет линзы ${m.name}`);
      b.click();
      break;
    }
    case "attackRows":
      return [...document.querySelectorAll(".attackrow h3")].map((h) => h.textContent ?? "");
    case "measureMode": {
      // Переключение режима: от клика до готового DOM и отрисовки.
      const b = [...document.querySelectorAll<HTMLButtonElement>(".modes button")].find((x) => x.textContent?.startsWith(m.name))!;
      const t0 = performance.now();
      b.click();
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      return { ms: Math.round(performance.now() - t0), snapshot: snapshot() };
    }
    case "measureDispute": {
      const area = document.querySelector<HTMLTextAreaElement>(".attackrow textarea")!;
      const samples: number[] = [];
      for (let i = 1; i <= 30; i++) {
        const t0 = performance.now();
        setValue(area, "слово".repeat(i).slice(0, i));
        await Promise.resolve();
        samples.push(performance.now() - t0);
      }
      setValue(area, "");
      samples.sort((a, b) => a - b);
      return { medianMs: samples[15], maxMs: samples[29] };
    }
    case "attackDispute": {
      setValue(attackRow(m.claim).querySelector("textarea")!, m.text);
      break;
    }
    case "attackRowHtml":
      return attackRow(m.claim).outerHTML;
    case "followRow": {
      attackRow(m.claim).querySelector<HTMLAnchorElement>(".card-head a")!.click();
      break;
    }
    case "dragPrompt": {
      const handle = document.querySelector<HTMLElement>(".return-handle");
      if (!handle) throw new Error("нет ручки панели");
      const y = handle.getBoundingClientRect().top;
      const fire = (type: string, clientY: number) => handle.dispatchEvent(new PointerEvent(type, { bubbles: true, clientY, pointerId: 1 }));
      fire("pointerdown", y);
      fire("pointermove", y + m.delta / 2);
      fire("pointermove", y + m.delta);
      fire("pointerup", y + m.delta);
      break;
    }
    case "resetPrompt": {
      document.querySelector(".return-handle")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      break;
    }
    case "promptSize": {
      const area = document.querySelector<HTMLTextAreaElement>(".prompt-text");
      return { height: area?.offsetHeight ?? null, mainHeight: document.querySelector("main")!.clientHeight, handle: !!document.querySelector(".return-handle") };
    }
    case "cardVisible": {
      const main = document.querySelector("main")!.getBoundingClientRect();
      const r = card!.getBoundingClientRect();
      await settle();
      return { top: r.top - main.top, inView: r.top >= main.top - 2 && r.top < main.bottom };
    }
    case "measure": {
      // Символ в поле слова: от события до готового DOM, как в пробном запуске.
      const area = card!.querySelector<HTMLTextAreaElement>("textarea")!;
      const samples: number[] = [];
      for (let i = 1; i <= 30; i++) {
        const t0 = performance.now();
        setValue(area, "слово".repeat(i).slice(0, i));
        await Promise.resolve();
        samples.push(performance.now() - t0);
      }
      setValue(area, "");
      samples.sort((a, b) => a - b);
      return { medianMs: samples[15], maxMs: samples[29] };
    }
    default:
      throw new Error(`неизвестное действие ${m.action}`);
  }
  await settle();
  return snapshot();
}

window.addEventListener("message", (ev) => {
  const m = ev.data;
  if (m?.type !== "drive") return;
  drive(m).then((result) => api.postMessage({ type: "driven", seq: m.seq, result }), (e) => api.postMessage({ type: "driven", seq: m.seq, error: String(e) }));
});
