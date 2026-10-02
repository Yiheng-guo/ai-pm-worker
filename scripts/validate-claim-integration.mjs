#!/usr/bin/env node
// One genuine integration attempt, explicitly reusing a historical snapshot.
// This is not a paired quality benchmark and never retries failed model calls.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
const base = "http://127.0.0.1:4310/api/agent";
const args = process.argv.slice(2);
const attemptName = args[args.indexOf("--attempt") + 1] || "initial";
if (!/^[a-zA-Z0-9_-]{1,60}$/.test(attemptName)) throw new Error("Invalid attempt archive name");
const directory = resolve("data/iterations/2026-10-02-v03/" + attemptName);
if (existsSync(directory + "/integration-input.json")) throw new Error("Attempt archive already exists; use a fresh --attempt name. No model call made.");
await mkdir(directory, { recursive: true });
const headers = { "Content-Type": "application/json", ...(process.env.DELIVERY_COOKIE ? { Cookie: process.env.DELIVERY_COOKIE } : {}) };
async function api(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.error || "request failed"}`);
  return body;
}
const original = await api("/runs/da34a542-c196-4a08-8a31-8a9065fc173d");
const source = original.sources.find(s => s.id === "f7f00e8b-f7f0-41c2-85c2-0f3f2233c918");
if (!source || source.status !== "fetched") throw new Error("Historical source unavailable; no model call made.");
const input = {
  projectId: original.projectId, kind: "research", sourceIds: [source.id], sourceUrls: [],
  parentRunId: original.id, sessionId: "claim-review-v03-" + randomUUID().replaceAll("-", ""),
  prompt: "继续这个项目的 Hermes 机制研究，使用本次明确选择的历史快照，不能说已重新联网或核验了当前版本。当前研发任务提供的背景是：亦伴已经实现可纠正项目记忆、显式复用快照、需求与造物原型关联、可保存日期备注的待办，正在新增逐条主张的原文摘录与审阅记录。这些是任务背景，不是 Hermes 官方资料证明的事实。请给出恰好四条 claims：两条 Hermes 官方公开功能声明（fact，限定为仓库自述，各附一条本次 source.text 里逐字连续的原文 citations，不翻译或拼接）；一条适用于本项目的风险或机制判断（inference）；一条尚无实际测量依据的未知（unknown，明确不能证明研究质量或成本收益）。在 answer 和 valueJudgment 中结合既有项目判断下一步价值，给出三条可验证的需求草稿和对应跟进行动。不要编造用户团队规模、价格、性能、准确率或已完成人工审查，不生成自动执行或外发行为。所有结论必须区分官方声明、你的判断和未知；旧快照与正文截断的限制要明确。",
};
const attempt = { startedAt: new Date().toISOString(), kind: "single-real-integration", pairedBenchmark: false, automaticRetries: 0, attemptName, implementationRepair: attemptName !== "initial", input, sourceBefore: { id: source.id, sha256: source.sha256, fetchedAt: source.fetchedAt, truncated: source.truncated }, idempotencyKey: "v03-claim-integration-" + randomUUID() };
await writeFile(directory + "/integration-input.json", JSON.stringify(attempt, null, 2));
const started = await api("/runs", { method: "POST", headers: { "Idempotency-Key": attempt.idempotencyKey }, body: JSON.stringify(input) });
await writeFile(directory + "/integration-run-id.json", JSON.stringify({ runId: started.id, projectId: started.projectId, createdAt: started.createdAt }, null, 2));
console.log(JSON.stringify({ runId: started.id, status: started.status }));
let previousStage = "";
for (;;) {
  const run = await api("/runs/" + started.id);
  if (run.stage !== previousStage) { console.log(JSON.stringify({ status: run.status, stage: run.stage })); previousStage = run.stage; }
  if (!["running", "queued"].includes(run.status)) {
    await writeFile(directory + "/integration-run.json", JSON.stringify(run, null, 2));
    const checks = run.claimAudit?.claims.flatMap(claim => claim.quoteChecks) || [];
    const report = {
      runId: run.id, status: run.status, error: run.error, completedAt: run.completedAt,
      scope: "One follow-up validates the real wiring only; it is not a before/after quality estimate.",
      requested: { officialDeclarations: 2, inference: 1, unknown: 1 },
      actual: { claims: run.result?.claims.length || 0, fact: run.result?.claims.filter(c => c.kind === "fact").length || 0, inference: run.result?.claims.filter(c => c.kind === "inference").length || 0, unknown: run.result?.claims.filter(c => c.kind === "unknown").length || 0, suppliedQuotes: checks.length, literalMatches: checks.filter(c => c.matched).length, missingFactQuotes: run.claimAudit?.claims.filter(c => c.kind === "fact" && !c.quoteChecks.length).length || 0 },
      semanticQuality: "unknown-until-review; workspace review is not independent evaluation",
      usage: run.usage, automaticRetries: 0,
      evidenceReused: run.sources.map(s => ({ id: s.id, sha256: s.sha256, fetchedAt: s.fetchedAt, reusedFrom: s.reusedFrom, reusedAt: s.reusedAt, ageAtReuseSeconds: s.ageAtReuseSeconds, truncated: s.truncated })),
      events: run.events, limitations: ["Historical saved, possibly incomplete source; no live refetch", "Official statements, no competitor execution", "Subscription tokens cannot establish cash cost"],
    };
    await writeFile(directory + "/integration-report.json", JSON.stringify(report, null, 2));
    const response = await fetch(base + "/runs/" + run.id + "/export", { headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error("Run preserved, but export failed: " + response.status);
    await writeFile(directory + "/integration-research-and-raw.zip", Buffer.from(await response.arrayBuffer()));
    console.log(JSON.stringify(report, null, 2));
    if (run.status !== "completed") process.exitCode = 1;
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
