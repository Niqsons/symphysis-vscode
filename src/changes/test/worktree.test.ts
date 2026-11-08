// Подпись «проект · дерево»: правила проверяются на настоящем git во временных репозиториях (B-37).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { worktreeLabel, type RunGit } from "../worktree";
import { tempDir } from "../../../test/temp-dir.mjs";

const git = "git";
const run = (args: string[], cwd: string) => execFileSync(git, args, { cwd, encoding: "utf8" });

function repoWithWorktree(): { base: string; linked: string } {
  const base = path.join(tempDir("symphysis-дерево-"), "репо с пробелом");
  fs.mkdirSync(base, { recursive: true });
  run(["init", "-q"], base);
  run(["-c", "user.email=a@b", "-c", "user.name=t", "commit", "--allow-empty", "-m", "начало", "-q"], base);
  const linked = path.join(base, "..", "дерево-ветка");
  run(["worktree", "add", "-b", "ветка/имя", linked, "-q"], base);
  return { base, linked };
}

test("связанное дерево: «проект · ветка»", async () => {
  const { linked } = repoWithWorktree();
  assert.equal(await worktreeLabel(linked, git), "репо с пробелом · ветка/имя");
});

test("основное дерево без подписи", async () => {
  const { base } = repoWithWorktree();
  assert.equal(await worktreeLabel(base, git), null);
});

test("отделённый HEAD назван словами", async () => {
  const { linked } = repoWithWorktree();
  run(["checkout", "--detach", "-q"], linked);
  assert.equal(await worktreeLabel(linked, git), "репо с пробелом · отделённый HEAD");
});

test("каталог не в репозитории — подписи нет", async () => {
  const dir = tempDir("symphysis-нерепо-");
  assert.equal(await worktreeLabel(dir, git), null);
});

test("git отказал — подписи нет", async () => {
  const dir = tempDir("symphysis-без-git-");
  assert.equal(await worktreeLabel(dir, "нет-такого-git"), null);
});

test("отказ одного из чтений не роняет подпись: падающий запуск даёт null", async () => {
  const failing: RunGit = async () => ({ code: 1, stdout: "" });
  const { linked } = repoWithWorktree();
  assert.equal(await worktreeLabel(linked, git, failing), null);
});
