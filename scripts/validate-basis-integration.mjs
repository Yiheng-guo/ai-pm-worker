#!/usr/bin/env node
// Explicit, non-retrying real integration. Run research first, inspect it, then
// choose a single requirement with --prototype RUN_ID --index N.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
const args = process.argv.slice(2);
const option = (name, fallback = "") => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const parentRunId = option("--prototype");
const attempt = option("--attempt", parentRunId ? "prototype-single" : "research");
if (!/^[a-zA-Z0-9_-]{1,60}$/.test(attempt)) throw new Error("Invalid attempt name");
const iteration = option("--iteration", "2026-10-02-v04");
if (!/^2026-10-02-v\d{2}$/.test(iteration)) throw new Error("Invalid iteration name");
const importedSourceIds = option("--source-ids").split(",").filter(Boolean);
const directory = resolve("data/iterations/" + iteration + "/" + attempt);
if (existsSync(directory + "/input.json")) throw new Error("Attempt already archived; use a fresh name. No call made.");
await mkdir(directory, { recursive: true });
const base = "http://127.0.0.1:4310/api/agent";
const headers = { "Content-Type": "application/json", ...(process.env.DELIVERY_COOKIE ? { Cookie: process.env.DELIVERY_COOKIE } : {}) };
async function api(path, body, extra = {}) {
  const response = await fetch(base + path, { headers: { ...headers, ...extra }, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}: ${result.error || "failed"}`), { status: response.status, response: result });
  return result;
}
const bootstrap = await api("/bootstrap");
const project = bootstrap.projects.find(p => p.id === "yiban-personal-agent");
if (!project) throw new Error("User project unavailable");
let input, route = "/runs", preview = null;
if (parentRunId) {
  const index = Number(option("--index", "0"));
  if (!Number.isInteger(index) || index < 0) throw new Error("Invalid requirement index");
  const parent = await api("/runs/" + parentRunId);
  if (parent.projectId !== project.id || parent.status !== "completed") throw new Error("Select a completed research in the user's project");
  input = { requirementIndices: [index], prototypeMode: "new", prompt: "只验证本次选中的需求，做一个可点击中文前端原型。请在界面注明示例数据和待验证假设，展示需求编号、研究ID及来源引用，支持查看依据/风险、作出本地复核状态、保存备注和导出；模拟操作明确标为本地示例，不能伪装后台、真实AI或已发生的提醒。其他未选需求不做成产品模块。不使用外部资源、网络或iframe。优先把主要流程和手机布局做完整，不以装饰代替功能。" };
  preview = await api(`/runs/${parentRunId}/prototype/brief-preview`, input);
  if (!preview.briefFingerprint) throw new Error("Preview fingerprint missing; no model call made");
  input.expectedBriefFingerprint = preview.briefFingerprint;
  route = `/runs/${parentRunId}/prototype`;
  await writeFile(directory + "/preview.json", JSON.stringify(preview, null, 2));
} else {
  input = {
    projectId: project.id, kind: "research", sessionId: "basis-" + iteration + "-" + randomUUID().replaceAll("-", ""),
    sourceUrls: importedSourceIds.length ? [] : [option("--source-url", "https://raw.githubusercontent.com/HKUDS/nanobot/d0d0a44e57632c3d269e511339cff7ddb698e62e/README.md")], sourceIds: importedSourceIds,
    prompt: "围绕当前亦伴和造物的实际项目背景，研究所提供固定 nanobot 提交的 README 机制参考。它不是最新版状态核验。请给出恰好4条 claims：2条仓库官方公开声明 fact，各附本次正文连续逐字原文 citations；1条结合本项目的研发价值/成本风险判断 inference；1条对本轮机制净收益仍缺少证明的 unknown。背景里已有有限实测和失败记录，不得扩大成没有任何实测。不要给未核实的人数、价格、性能、star数或准确率。针对既有能力的下一步缺口提出恰好2条 requirements：一条优先验证项目记忆/背景变化如何影响已有需求与原型的复核，一条验证研究质量和人工审阅成本；不要把已存在功能当作从零建设。每条 basis 都明确本次0-based claimIndices、projectFields、当前确认memoryIds（有必要才引用），以及价值假设 assumptions 和验证方法 verification。来源只证明公开机制声明，不能直接证明需求价值。给出恰好2条 actions，分别关联需求0和1的 requirementIndices，done=false。answer与valueJudgment清楚说明采用或不采用的理由、边界和下一步，不自动执行或外发。",
  };
}
const idempotencyKey = "v04-integration-" + randomUUID();
await writeFile(directory + "/input.json", JSON.stringify({ at: new Date().toISOString(), input, idempotencyKey, parentRunId: parentRunId || null, automaticRetries: 0, pairedEvaluation: false, prototypePreviewReviewedBy: parentRunId ? "Codex implementation agent" : null }, null, 2));
const started = await api(route, input, { "Idempotency-Key": idempotencyKey });
await writeFile(directory + "/run-id.json", JSON.stringify({ runId: started.id, projectId: started.projectId, kind: started.kind }, null, 2));
console.log(JSON.stringify({ runId: started.id, status: started.status, kind: started.kind }));
let previousStage = "";
for (;;) {
  const run = await api("/runs/" + started.id);
  if (run.stage !== previousStage) { console.log(JSON.stringify({ status: run.status, stage: run.stage })); previousStage = run.stage; }
  if (!["queued", "running"].includes(run.status)) {
    await writeFile(directory + "/run.json", JSON.stringify(run, null, 2));
    const graph = run.kind !== "prototype" && run.status === "completed" ? await api(`/runs/${run.id}/requirements`) : null;
    if (graph) await writeFile(directory + "/requirements-basis.json", JSON.stringify(graph, null, 2));
    const report = { at: new Date().toISOString(), runId: run.id, status: run.status, kind: run.kind, error: run.error, scope: "Real wiring validation; not a paired quality benchmark", automaticRetries: 0, usage: run.usage, sourcePins: run.sources.map(({ id, url, sha256, fetchedAt, extraction, truncated }) => ({ id, url, sha256, fetchedAt, extraction, truncated })), claims: run.result?.claims.length ?? null, requirements: graph?.requirements.map(r => ({ index: r.index, basisState: r.basisState, claimIndices: r.basis?.claimIndices || [], memoryIds: r.basis?.memoryIds || [], warnings: r.warnings })) || null, actionLinks: graph?.actions.map(a => ({ index: a.index, requirementIndices: a.requirementIndices })) || null, prototype: run.raw?.prototypeBrief ? { selectedIndices: run.raw.prototypeBrief.selectedIndices, briefFingerprint: run.raw.prototypeBrief.briefFingerprint, modelInputSha256: run.raw.prototypeBrief.modelInputSha256, mode: run.raw.prototypeBrief.prototypeMode, exactRequestInputChars: run.raw.prototypeBrief.modelInputChars, independentActualBrowserAcceptance: false } : null, independentHumanEvaluation: false, cashCost: null };
    await writeFile(directory + "/report.json", JSON.stringify(report, null, 2));
    for (const [path, name] of [[`/runs/${run.id}/export`, "research-and-raw.zip"], ...(run.prototype ? [[`/prototypes/${run.id}/download`, "prototype-with-basis.zip"]] : [])]) {
      const response = await fetch(base + path, { headers, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error("Export failed after preserved run: " + response.status);
      await writeFile(directory + "/" + name, Buffer.from(await response.arrayBuffer()));
    }
    console.log(JSON.stringify(report, null, 2));
    if (run.status !== "completed") process.exitCode = 1;
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
