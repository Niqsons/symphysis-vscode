---
name: search
kind: доменный
dependencies:
  - repo: symphysis-vscode
    module: changes
  - repo: symphysis-vscode
    module: journal
  - repo: symphysis-vscode
    module: protocol
  - repo: symphysis-vscode
    module: ui
---

# search

Поиск в боковой панели: фраза по журналу, атаке и черновику и запись по номеру (`search.ts`), вид на стороне VS Code (`searchView.ts`); страница — `page.tsx`, сборка кладёт её в `media/search.js`, — с `SearchApp.tsx` и `SearchResults.tsx`.

## Вложенные каталоги

- [test/](test/) — юнит-тесты модуля; `npm test` собирает их отсюда, в пакет они не идут
