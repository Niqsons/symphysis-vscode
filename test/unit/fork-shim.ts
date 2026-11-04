// Шим форка для модульных тестов: ядро из `SYMPHYSIS_ROOT`, окружение шима идёт в процесс теста. Каждый файл тестов идёт в своём процессе.
import { SYMPHYSIS } from "./fixture-project";
import { installForkShim, type ForkReplies, type ForkShim } from "../fork-shim.mjs";

export { FORK_APPLY, forkStatus, forkStatusAll, python, type ForkReplies, type ForkShim } from "../fork-shim.mjs";

export function forkShim(dir: string, replies: ForkReplies): ForkShim {
  const shim = installForkShim(SYMPHYSIS, dir, replies);
  Object.assign(process.env, shim.env);
  return shim;
}
