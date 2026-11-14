---
name: file-links
kind: доменный
dependencies:
  - repo: symphysis-vscode
    module: protocol
---

# file-links

Ссылки на файлы со страниц: разбор текста и карта `file_links` из вывода ядра, общее для хоста и страниц (`links.ts`); какой файл открывать по клику (`resolve.ts`); открытие рядом с вкладкой (`openFile.ts`).

## Вложенные каталоги

- [test/](test/) — юнит-тесты модуля; `npm test` собирает их отсюда, в пакет они не идут
