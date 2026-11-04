// Что сказать человеку, когда журнал показать нельзя или нельзя вносить, а справку нельзя посчитать.
import type { HelpFailure } from "../shared/protocol";

const INSTALL = "symphysis install --project . --force";

export function FailureText({ failure, openPythonSetting }: { failure: HelpFailure; openPythonSetting(): void }) {
  switch (failure.kind) {
    case "no-journal":
      return <>У этого изменения ещё нет <code>decisions.json</code>.</>;
    case "no-tools":
      return <>В проекте нет <code>.symphysis/tools/journal.py</code>. Поставь инструменты: <code>symphysis install --project .</code></>;
    case "tools-path":
      return <>Инструментов symphysis нет: {failure.reason}. Поправь настройку или поставь инструменты в проект: <code>symphysis install --project .</code></>;
    case "no-python":
      return (
        <>
          Python не найден: {failure.reason}.{failure.tried.length > 0 && <> Пробовал: <code>{failure.tried.join(", ")}</code>.</>}{" "}
          <button type="button" className="small" onClick={openPythonSetting}>Указать путь</button>
        </>
      );
    case "old-core":
      return <>В <code>{failure.tools}</code> старая версия инструментов symphysis: нет команды <code>view-json</code>. Обнови: <code>{INSTALL}</code></>;
    case "contract":
      return failure.need === "vsix"
        ? <>Инструменты symphysis в <code>{failure.root}</code> новее этого плагина: поставь новый .vsix.</>
        : <>Инструменты symphysis в <code>{failure.root}</code> старее этого плагина. Обнови их: <code>{INSTALL}</code></>;
    case "invalid-journal":
      return <>Журнал негоден. Ядро сообщает:<pre className="report-lines">{failure.text}</pre></>;
    case "timeout":
      return <>Python не ответил за отведённое время.</>;
    case "crash":
      return <>Ядро не отработало:<pre className="report-lines">{failure.text}</pre></>;
    case "unreadable":
      return <>Ответ <code>step_help.py</code> не прочитан. Проверь в терминале, из папки проекта: <code>{failure.command}</code></>;
    case "no-openspec":
      return <>В папке <code>{failure.root}</code> нет <code>openspec/</code>: справку считать не для чего.</>;
  }
}
