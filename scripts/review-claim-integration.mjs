#!/usr/bin/env node
// Implementation-assisted source review, explicitly not an independent score.
import { writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const base = "http://127.0.0.1:4310/api/agent";
const directory = resolve("data/iterations/2026-10-02-v03/schema-repaired");
const { runId } = JSON.parse(await readFile(directory + "/integration-run-id.json", "utf8"));
const headers = { "Content-Type": "application/json", ...(process.env.DELIVERY_COOKIE ? { Cookie: process.env.DELIVERY_COOKIE } : {}) };
async function api(path, body) {
  const response = await fetch(base + path, { headers, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const original = (await api("/runs/" + runId)).data;
const originalDigest = createHash("sha256").update(JSON.stringify(original.raw.model)).digest("hex");
const audit = (await api("/runs/" + runId + "/claims")).data;
if (original.status !== "completed" || audit.claims.length !== 4 || audit.claims.some(c => c.review.revision !== 0)) throw new Error("This one-time reviewed attempt is already changed or unavailable; no write made.");
const notes = [
  "Codex 实施者核对已保存的官方仓库自述摘录及其上下文：该原句明确提及 agent-curated memory 和 periodic nudges。支持范围仅限页面公开声明，不证明实现行为、效果或当前版本；快照截断且未重新取证。",
  "Codex 实施者核对已保存原文：原句同时出现 FTS5 session search、LLM summarization 和 cross-session recall。支持范围仅限所选快照的官方机制声明，不证明召回准确、摘要忠实或当前版本。",
  "这是面向本项目的风险假设和研发价值判断；官方功能自述不能证明错误复用实际发生或新增审阅带来净收益。保留为待验证，需受控案例及审阅耗时对照。",
  "谨慎提醒有效，但‘缺少可比任务、真实错误记录、模型用量’表述过宽：本工作空间第一版已保存有限配对任务、失败和 provider 用量。那份报告未作为此次模型输入，不能据此声称不存在实测。仍不足以证明泛化质量或现金收益，应改为‘未取得证明本轮机制净收益的足够测量’。此标注使用本地已存在的评测记录作背景说明，未伪造公开引文。",
];
const requests = [];
for (const claim of audit.claims) {
  const body = { projectId: audit.projectId, expectedRevision: 0, expectedClaimFingerprint: claim.claimFingerprint, confirm: true, status: claim.index < 2 ? "supported" : "needs-verification", note: notes[claim.index], reviewerType: "agent-assisted", reviewerLabel: "Codex 源文复核", citations: claim.index < 2 ? claim.quoteChecks.map(c => ({ sourceId: c.sourceId, quote: c.quote, start: c.locator.start })) : [] };
  const response = await api(`/runs/${runId}/claims/${claim.key}/review`, body);
  requests.push({ claimKey: claim.key, body, status: response.status });
  if (response.status !== 200) throw new Error("Review write failed; previous successful entries remain preserved: " + response.status);
}
const stale = await api(`/runs/${runId}/claims/${audit.claims[0].key}/review`, requests[0].body);
if (stale.status !== 409) throw new Error("Stale revision unexpectedly accepted");
const current = (await api("/runs/" + runId)).data;
const unchanged = createHash("sha256").update(JSON.stringify(current.raw.model)).digest("hex") === originalDigest;
if (!unchanged) throw new Error("Original model audit unexpectedly changed");
const report = { at: new Date().toISOString(), runId, method: "actual-local-HTTP-not-browser", reviewerType: "agent-assisted", reviewerLabel: "Codex 源文复核", independentHumanEvaluation: false, semanticAccuracy: null, summary: current.claimAudit.summary, requestedCoverage: { officialDeclarations: "2/2", inference: "1/1", unknown: "1/1" }, suppliedLiteralMatches: "2/2", importantCaveat: notes[3], staleRevisionRejected: stale.status === 409, originalModelDigest: originalDigest, originalModelUnchanged: unchanged, requests, claimAudit: current.claimAudit };
await writeFile(directory + "/source-review.json", JSON.stringify(report, null, 2));
const response = await fetch(base + "/runs/" + runId + "/export", { headers });
if (!response.ok) throw new Error("Reviewed export failed");
await writeFile(directory + "/integration-reviewed-and-raw.zip", Buffer.from(await response.arrayBuffer()));
console.log(JSON.stringify({ runId, summary: report.summary, independentHumanEvaluation: false, staleRevisionRejected: true, originalModelUnchanged: unchanged }, null, 2));
