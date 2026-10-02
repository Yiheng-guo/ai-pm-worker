// Save an implementation-reviewed HTML revision without a new model call.
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { createStore } from "../server/store.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [runId, htmlPath, changeNote] = process.argv.slice(2);
if (!runId || !htmlPath || !changeNote) throw new Error("用法：node scripts/review-prototype.mjs RUN_ID HTML_FILE 修正说明");
const code = await readFile(resolve(htmlPath), "utf8");
if (!/<html[\s>]/i.test(code) || code.length > 150000) throw new Error("需要完整 HTML 文件，最多 150,000 字符。");
const foundryRoot = resolve(process.env.FOUNDRY_DIR || join(root, "../product-foundry"));
const store = await createStore(process.env.OFFICE_DATA_DIR || join(root, "data/personal-agent"));
const foundry = await createStore(join(foundryRoot, "data/personal-agent"));
try {
  const original = await store.get(runId, "agent-run");
  if (original?.status !== "completed" || !original.prototype) throw new Error("必须选择已完成的原型。");
  if ((await store.list("agent-run")).some(r => r.projectId === original.projectId && ["queued", "running"].includes(r.status))) throw new Error("请先完成或取消本项目正在运行的任务。");
  const project = await foundry.get(original.prototype.projectId, "project");
  const previous = project?.versions?.find(v => v.id === original.prototype.versionId);
  if (!previous) throw new Error("造物中的原版不存在，不能伪造版本历史。");
  const at = new Date().toISOString();
  const version = { ...previous, id: randomUUID(), createdAt: at, code,
    title: previous.title.replace(/ · 验收修正版$/, "") + " · 验收修正版",
    provider: "manual", prompt: changeNote,
    commentary: "人工验收修正，未追加模型调用。" + changeNote,
    prd: previous.prd + "\n\n## 人工验收修正\n\n" + changeNote + "\n原始 AI 版本保留；本版没有新增模型调用，开发人力成本未计价。\n" };
  project.versions.push(version); project.updatedAt = at;
  await foundry.put("project", project);
  const revised = { ...original, id: randomUUID(), createdAt: at, completedAt: at,
    prompt: "人工验收修正：" + changeNote, status: "completed", stage: "验收修正版已保存，原版保留",
    idempotencyKey: undefined, requestHash: undefined, sessionId: randomUUID().replaceAll("-", ""),
    events: [{ at, message: "人工验收修正；未调用模型；保留上一版本。" }, { at, message: changeNote }],
    result: { ...original.result, answer: "已保存人工验收修正版。" + changeNote },
    engine: { name: "implementation-review", provider: "manual" },
    usage: { inputTokens: null, outputTokens: null, cachedTokens: null, requestCount: 0, reported: false, cost: null, currency: null, note: "人工验收修正没有追加模型调用；开发人力成本未计价。" },
    raw: { project: original.raw.project,
      ...(original.raw.prototypeBrief ? { prototypeBrief: structuredClone(original.raw.prototypeBrief) } : {}),
      revision: { method: "implementation-review", reviewerType: "agent-assisted", previousRunId: original.id,
      inheritedGenerationBrief: !!original.raw.prototypeBrief, generationBriefRole: "original-model-generation-input; not a new manual-revision model call",
      originalVersionId: previous.id, note: changeNote, htmlSha256: createHash("sha256").update(code).digest("hex") } },
    prototype: { ...original.prototype, title: version.title, code, prd: version.prd,
      versionId: version.id, version: project.versions.length, createdAt: at } };
  await store.put("agent-run", revised);
  console.log(JSON.stringify({ runId: revised.id, version: revised.prototype.version, provider: "manual", modelCalls: 0 }));
} finally { store.close(); foundry.close(); }
