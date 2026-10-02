import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const foundry = resolve(process.env.FOUNDRY_DIR || join(root, "../product-foundry"));
if (!existsSync(join(root, ".runtime/.venv/bin/python"))) {
  console.error("请先在亦伴目录执行 npm run agent:setup，安装固定版本的 nanobot。");
  process.exit(1);
}
if (!existsSync(join(foundry, "server/index.mjs"))) {
  console.error("未找到造物。请把 product-foundry 放在亦伴旁边，或配置 FOUNDRY_DIR。");
  process.exit(1);
}
if (!existsSync(join(root, "dist/index.html"))) {
  console.error("请先执行 npm run build。");
  process.exit(1);
}
const children = [];
let stopping = false;
function launch(directory, env) {
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: directory, env: { ...process.env, VERCEL: "", ...env }, stdio: "inherit",
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error("服务退出：" + directory + "（" + (code ?? signal) + "）");
      stop(code || 1);
    }
  });
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 3500).unref();
}
launch(foundry, { PORT: "4320", OFFICE_DATA_DIR: join(foundry, "data/personal-agent"), DEFAULT_PROVIDER: process.env.DEFAULT_PROVIDER || "codex" });
launch(root, { PORT: "4310", OFFICE_DATA_DIR: process.env.OFFICE_DATA_DIR || join(root, "data/personal-agent"), DEFAULT_PROVIDER: process.env.DEFAULT_PROVIDER || "codex", FOUNDRY_PASSWORD: process.env.FOUNDRY_PASSWORD || process.env.WORKSPACE_PASSWORD || "" });
console.log("亦伴统一工作台：http://127.0.0.1:4310");
console.log("原型服务：http://127.0.0.1:4320；Ctrl+C 可同时停止两个服务。");
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
