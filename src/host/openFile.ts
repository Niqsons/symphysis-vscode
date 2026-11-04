// Открытие файла по ссылке: рядом с вкладкой, предпросмотром и без перевода фокуса; с `:строка` на этой строке (F-45).
// Вызывают панели, которые сами выбрали путь по карте или полю скиллов; здесь путь уже проверен.
import * as vscode from "vscode";

export async function openBeside(file: string, line: number | null): Promise<void> {
  const selection = line ? new vscode.Range(line - 1, 0, line - 1, 0) : undefined;
  await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file), { viewColumn: vscode.ViewColumn.Beside, preview: true, preserveFocus: true, selection });
}
