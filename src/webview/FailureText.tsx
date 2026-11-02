// Что сказать человеку, когда журнал показать нельзя или нельзя вносить.
import type { CoreFailure } from "../shared/protocol";

const INSTALL = "symphysis install --project . --force";

export function FailureText({ failure, openPythonSetting }: { failure: CoreFailure; openPythonSetting(): void }) {
  switch (failure.kind) {
    case "no-journal":
      return <>У этого изменения ещё нет <code>decisions.json</code>.</>;
    case "no-tools":
      return <>В проекте нет <code>.symphysis/tools/journal.py</code>. Поставь инструменты: <code>symphysis install --project .</code></>;
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
  }
}
