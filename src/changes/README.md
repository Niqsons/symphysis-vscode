---
name: changes
kind: доменный
dependencies:
  - repo: symphysis-vscode
    module: core
  - repo: symphysis-vscode
    module: journal
  - repo: symphysis-vscode
    module: protocol
---

# changes

Адресный переход из снимка может добавить архивный журнал через `JournalStore.include`. Он доступен по ключу просмотрщику и сохраняется при синхронизации. Перечень `list()` содержит активные изменения из источника каталога.

Изменения проекта в боковой панели: дерево изменений со счётчиками, оглавления журнала и атаки (`sidebar.ts`) и хранилище журналов — один запуск `view-json` на изменение (`store.ts`).

## Вложенные каталоги

- [test/](test/) — юнит-тесты модуля; `npm test` собирает их отсюда, в пакет они не идут
