// Страница поиска в боковой панели: поле и результаты. Считает хост: журнал и черновик у него, страница их не держит.
import { useEffect, useRef, useState } from "react";
import type { SearchHostMessage, SearchOutcome, SearchPageMessage } from "../shared/protocol";
import { applyColors } from "./colors";
import { SearchResults } from "./SearchResults";

declare const acquireVsCodeApi: () => { postMessage(m: SearchPageMessage): void };
const vscode = acquireVsCodeApi();
const post = (m: SearchPageMessage) => vscode.postMessage(m);

const QUERY_DELAY_MS = 120;

export function SearchApp() {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SearchOutcome>({ kind: "empty" });
  /** На какой запрос показан результат: пока человек печатает, ответ на прежний запрос не показывается. */
  const [answered, setAnswered] = useState<string | null>(null);
  const queryRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onMessage = (ev: MessageEvent<SearchHostMessage>) => {
      const m = ev.data;
      if (m.type !== "searchState") return;
      applyColors(m.colors);
      setScope(m.scope);
      // Вид открыт заново: запрос живёт у хоста, поле его показывает.
      if (queryRef.current === null) {
        queryRef.current = m.query;
        setQuery(m.query);
      }
      if (m.query !== queryRef.current) return;
      setOutcome(m.outcome);
      setAnswered(m.query);
    };
    window.addEventListener("message", onMessage);
    post({ type: "searchReady" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const type = (text: string) => {
    queryRef.current = text;
    setQuery(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => post({ type: "searchQuery", query: text }), QUERY_DELAY_MS);
  };

  return (
    <div className="search">
      <input type="text" value={query} placeholder="фраза или номер: F-07, 7" aria-label="Поиск в журнале" onChange={(e) => type(e.target.value)} />
      <div className="search-scope">{scope ? <>в журнале <b>{scope}</b></> : "журнал не открыт — выбери изменение в списке выше"}</div>
      <div className="search-results view" data-query={answered ?? ""}>
        {scope && <SearchResults outcome={outcome} onOpen={(target) => post({ type: "searchOpen", target })} />}
      </div>
    </div>
  );
}
