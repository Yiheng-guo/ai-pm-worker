#!/usr/bin/env node
// Package a clean, reviewable local release. No credentials or databases enter
// the source archive; the selected historical report remains explicitly dated.
import { readFile, writeFile, mkdir, readdir, lstat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function option(name, fallback = "") {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(name + " 缺少值");
  return args[i + 1];
}
const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
const output = resolve(option("--output", join(root, "../deliverables/yiban-personal-agent-v" + version)));
const foundry = resolve(process.env.FOUNDRY_DIR || join(root, "../product-foundry"));
const reportId = option("--evaluation", "paired-2026-10-02");
const iterationId = option("--iteration");
const notesPath = resolve(option("--notes", join(root, "docs/ITERATION_V02.md")));
for (const id of [reportId, iterationId].filter(Boolean))
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("档案 ID 格式不正确");
const base = option("--base-url", "http://127.0.0.1:4310");
const local = new URL(base);
if (!["127.0.0.1", "localhost"].includes(local.hostname) || local.protocol !== "http:")
  throw new Error("交付打包只读取本机服务");

await mkdir(output, { recursive: true });
const source = new JSZip();
const commits = {};
for (const [name, directory] of [["ai-pm-worker", root], ["product-foundry", foundry]]) {
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: directory, encoding: "utf8" }).trim();
  if (dirty) throw new Error(name + " 尚有未归档变更，请先检查并保存本机提交");
  commits[name] = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: directory }).toString().split("\0").filter(Boolean);
  for (const file of files) {
    if (/(^|\/)(node_modules|data|\.runtime|\.git|dist)(\/|$)/.test(file) || /(^|\/)\.env(\.|$)/.test(file) && !file.endsWith(".env.example"))
      throw new Error("源码中存在不应打包的路径：" + file);
    const path = join(directory, file);
    const stat = await lstat(path);
    if (!stat.isFile()) throw new Error("源码路径不是普通文件：" + file);
    source.file(name + "/" + file, await readFile(path), { unixPermissions: stat.mode });
  }
}
source.file("SOURCE_VERSION.json", JSON.stringify({ version, commits, published: false, nanobotCommit: "d0d0a44e57632c3d269e511339cff7ddb698e62e" }, null, 2));
source.file("开始开发.md", "# 亦伴 Personal Agent " + version + "\n\n两个项目保持同级目录，按 ai-pm-worker/README.md 安装与启动。源码不含凭证、数据库或运行环境；新电脑首次启动是新的工作空间，历史真实记录在单独的档案包中。本机原仓库保留 Git 历史，此 ZIP 不含 .git。\n");
await writeFile(join(output, "personal-agent-source.zip"), await source.generateAsync({ type: "nodebuffer", compression: "DEFLATE", platform: "UNIX" }));

const headers = process.env.DELIVERY_COOKIE ? { Cookie: process.env.DELIVERY_COOKIE } : {};
async function exported(route, filename) {
  const response = await fetch(base.replace(/\/$/, "") + "/api/agent" + route, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("读取本机导出失败：" + route + " HTTP " + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  const zip = await JSZip.loadAsync(bytes);
  if (!Object.values(zip.files).some(file => !file.dir)) throw new Error("本机导出为空：" + route);
  await writeFile(join(output, filename), bytes);
}
await exported("/evaluations/" + reportId + "/export", "historical-evaluation-and-raw.zip");
await writeFile(join(output, "第一版历史评测.md"), await readFile(join(root, "data/evaluations", reportId, "report.md")));
if (iterationId) {
  const archive = new JSZip();
  const directory = join(root, "data/iterations", iterationId);
  async function include(dir, prefix = "") {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, item.name), name = prefix + item.name;
      if (item.isSymbolicLink()) throw new Error("迭代档案不能包含符号链接");
      if (item.isDirectory()) await include(path, name + "/");
      else if (item.isFile()) {
        if (/secret|credential|\.env/i.test(item.name)) throw new Error("迭代档案疑似包含凭证路径：" + name);
        archive.file(name, await readFile(path));
      }
    }
  }
  await include(directory);
  await writeFile(join(output, "iteration-acceptance.zip"), await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}
await writeFile(join(output, "迭代说明.md"), await readFile(notesPath));
const manifest = { releaseId: randomUUID(), version, generatedAt: new Date().toISOString(), commits, published: false, historicalEvaluationId: reportId, iterationId: iterationId || null, files: [] };
for (const name of (await readdir(output)).sort()) {
  if (name === "manifest.json") continue;
  const path = join(output, name);
  if (!(await lstat(path)).isFile()) continue;
  const bytes = await readFile(path);
  manifest.files.push({ name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
const bundle = new JSZip();
for (const name of (await readdir(output)).sort())
  if ((await lstat(join(output, name))).isFile()) bundle.file("yiban-personal-agent-v" + version + "/" + name, await readFile(join(output, name)));
const bundlePath = output + ".zip";
await writeFile(bundlePath, await bundle.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
console.log(JSON.stringify({ version, output, bundlePath, commits, fileCount: manifest.files.length }, null, 2));
