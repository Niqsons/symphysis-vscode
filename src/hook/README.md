---
name: hook
kind: доменный
dependencies:
  - repo: symphysis-vscode
    module: core
---

# hook

Хук агента: где он нужен, запись Claude Code и файл opencode, строки в `.git/info/exclude` (`hook.ts`, `hookGit.ts`), запуски по папкам рабочей области (`hookRunner.ts`) и скрипт хука `hook.py`. Сборка кладёт копию `hook.py` в `hook/hook.py` пакета — путь, по которому её читает код.

## Вложенные каталоги

- [test/](test/) — юнит-тесты модуля; `npm test` собирает их отсюда, в пакет они не идут
