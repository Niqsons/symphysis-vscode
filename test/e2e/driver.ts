// Водитель страницы для сквозных тестов: настоящие клики и ввод в настоящем DOM. Грузится только в ExtensionMode.Test,
// в .vsix не входит. Перехватывает acquireVsCodeApi: страница получает обычный api, водитель делит его с ней.
declare const acquireVsCodeApi: () => { postMessage(m: unknown): void };

const api = acquireVsCodeApi();
(globalThis as any).acquireVsCodeApi = () => api;

const violations: string[] = [];
document.addEventListener("securitypolicyviolation", (e) => violations.push(`${e.violatedDirective}: ${e.blockedURI}`));

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

function snapshot() {
  const prompt = document.querySelector<HTMLTextAreaElement>(".prompt-text");
  return {
    title: document.querySelector(".top h1")?.textContent ?? "",
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
  };
}

async function drive(m: any): Promise<unknown> {
  const card = m.id ? document.getElementById(m.id) : null;
  switch (m.action) {
    case "snapshot":
      return snapshot();
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
    case "openOnly": {
      document.querySelector<HTMLInputElement>(".toggle input")!.click();
      break;
    }
    case "followDependency": {
      card!.querySelector<HTMLAnchorElement>(`.chip a[href="#${m.dep}"]`)!.click();
      break;
    }
    case "text":
      return document.body.textContent ?? "";
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
