import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import express from "express";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { createStore } from "../server/store.mjs";
import { createAgentRouter } from "../server/agent-router.mjs";
import { claimKey, claimFingerprint, projectClaimAudit, utf16Boundary, validateQuote } from "../server/claim-audit.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const savedSource = (id, text, raw = text) => ({ id, status: "fetched", text, raw, url: "https://example.com/" + id, retrievalUrl: "https://example.com/" + id, sha256: hash(raw), fetchedAt: "2026-10-02T00:00:00Z", truncated: text !== raw });
const claim = (text, sourceIds, citations = []) => ({ text, kind: "fact", sourceIds, citations });
const reviewBody = (run, current, extra = {}) => ({ projectId: run.projectId, expectedRevision: current.review.revision, expectedClaimFingerprint: current.claimFingerprint, confirm: true, status: "supported", note: "隔离实施夹具的标注，不是用户或独立专家评测。", reviewerType: "implementation-fixture", reviewerLabel: "隔离路由测试", citations: [{ sourceId: "official", quote: "Supports local inference." }], ...extra });

const adversarialRun = () => {
  const official = savedSource("official", "😀 Supports local inference. A team has three people. Repeat quote. Repeat quote.");
  const truncated = savedSource("truncated", "This is the captured first paragraph.", "This is the captured first paragraph. Hidden beyond extraction: fully verified security.");
  const oldPricing = savedSource("old-pricing", "2024-01: the plan costs $5.");
  const conflicting = savedSource("conflicting", "Local inference is no longer supported.");
  return { id: "adversarial-run", projectId: "test-project", kind: "research", status: "completed", sources: [official, truncated, oldPricing, conflicting], raw: { model: { output: "untouched-original-model-output" }, project: { memory: [{ text: "The project team has two people." }] } }, result: { claims: [
    claim("The official page declares local inference support.", ["official"], [{ sourceId: "official", quote: "Supports local inference." }]),
    claim("The official page says local inference is impossible.", ["official"], [{ sourceId: "official", quote: "Supports local inference." }]),
    claim("The product is certified secure.", ["official"], [{ sourceId: "official", quote: "Certified secure by independent audit." }]),
    claim("Security was fully verified.", ["truncated"], [{ sourceId: "truncated", quote: "fully verified security." }]),
    claim("Today's price is $5.", ["old-pricing"], [{ sourceId: "old-pricing", quote: "the plan costs $5." }]),
    claim("Local inference is supported without contradiction.", ["official", "conflicting"], [{ sourceId: "official", quote: "Supports local inference." }, { sourceId: "conflicting", quote: "Local inference is no longer supported." }]),
    claim("The project team has three people.", ["official"], [{ sourceId: "official", quote: "A team has three people." }]),
    { text: "The actual safety status is unknown.", kind: "unknown", sourceIds: [], citations: [] },
  ] }, events: [], usage: { cost: null } };
};

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "yiban-claim-audit-"));
  await writeFile(join(dir, "README.md"), "隔离测试背景资料；不计入真实模型评测或用户项目事实。");
  const store = await createStore(dir);
  const agent = await createAgentRouter({ store, root: dir, cloud: false, settings: async () => ({ provider: "codex" }), runtimeStatus: async () => ({ installed: true }) });
  const app = express(); app.use(express.json()); app.use(agent.router);
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const request = async (path, method = "GET", body) => { const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json() }; };
  t.after(async () => { agent.shutdown(); await new Promise(resolve => server.close(resolve)); store.close(); await rm(dir, { recursive: true, force: true }); });
  return { store, base, request };
}

test("固定八例对抗池：精确引文存在不自动变成语义支持，全部未审阅的质量未知", () => {
  const run = adversarialRun(); const original = structuredClone(run);
  const audit = projectClaimAudit(run);
  assert.equal(audit.claims.length, 8); assert.equal(audit.summary.reviewed, 0); assert.equal(audit.summary.unreviewed, 8); assert.equal(audit.summary.semanticQuality, "unknown");
  assert.deepEqual(audit.claims.map(c => c.quoteChecks.map(q => q.matched)), [[true], [true], [false], [false], [true], [true, true], [true], []]);
  assert.ok(audit.claims.every(c => c.review.status === "unreviewed"));
  assert.equal(audit.claims[4].quoteChecks[0].sourcePin.publishedAt, null); assert.equal(audit.claims[4].quoteChecks[0].sourcePin.publishedDateKnown, false);
  assert.equal(audit.claims[1].quoteChecks[0].validation, "literal-only"); assert.deepEqual(run, original);
  const mistakenRecord = { runId: run.id, projectId: run.projectId, claimKey: audit.claims[1].key, revision: 1, history: [{ claimFingerprint: audit.claims[1].claimFingerprint, status: "supported", note: "假设标注者作出错误判断", reviewerType: "implementation-fixture", citations: [audit.claims[1].quoteChecks[0]] }] };
  const mistakenAudit = projectClaimAudit(run, [mistakenRecord]);
  assert.equal(mistakenAudit.claims[1].review.status, "supported"); assert.equal(mistakenAudit.summary.semanticQuality, "unknown");
});

test("UTF16 定位固定原始来源，重复引文明确选择，拒绝拆开 Unicode 字符和错来源", () => {
  const run = adversarialRun(); const current = run.result.claims[0];
  const repeat = "Repeat quote."; const first = run.sources[0].text.indexOf(repeat); const second = run.sources[0].text.indexOf(repeat, first + 1);
  const matched = validateQuote(run, current, { sourceId: "official", quote: repeat, start: second });
  assert.equal(matched.locator.unit, "utf16-code-unit"); assert.equal(matched.locator.start, second); assert.equal(matched.locator.end, second + repeat.length); assert.equal(matched.locator.occurrenceCount, 2); assert.equal(matched.locator.occurrenceIndex, 2);
  assert.equal(matched.sourcePin.sha256, run.sources[0].sha256); assert.equal(matched.sourcePin.textSha256, hash(run.sources[0].text));
  assert.equal(utf16Boundary(run.sources[0].text, 1), false); assert.equal(utf16Boundary(run.sources[0].text, 2), true);
  assert.throws(() => validateQuote(run, current, { sourceId: "official", quote: "😀", start: 1 }));
  assert.throws(() => validateQuote(run, current, { sourceId: "official", quote: "\ud83d", start: 0 }));
  assert.throws(() => validateQuote(run, current, { sourceId: "official", quote: repeat, start: first + 1 }));
  assert.throws(() => validateQuote(run, current, { sourceId: "old-pricing", quote: "the plan costs $5." }));
  assert.throws(() => validateQuote(run, current, { sourceId: "official", quote: " " }));
});

test("真实 Pydantic 省略定位输出 start:null 按未指定定位处理，错误数值仍拒绝", () => {
  const run = adversarialRun();
  const current = run.result.claims[0];
  current.citations = [{ sourceId: "official", quote: "Supports local inference.", start: null }];
  const generated = projectClaimAudit(run).claims[0].quoteChecks[0];
  assert.equal(generated.matched, true); assert.equal(generated.locator.start, run.sources[0].text.indexOf("Supports local inference."));
  assert.equal(current.citations[0].start, null);
  for (const start of [-1, 1, 1.5, NaN, Infinity, "3"]) assert.throws(() => validateQuote(run, current, { ...current.citations[0], start }));
});

test("结论指纹稳定键与变化内容分开：模型引文、正文、SHA 与抓取时间变化都会使旧标注失效", () => {
  const run = adversarialRun(); const key = claimKey(run.id, 0); const before = claimFingerprint(run, run.result.claims[0]);
  const record = { runId: run.id, projectId: run.projectId, claimKey: key, revision: 1, history: [{ claimFingerprint: before, status: "supported", note: "旧判断", citations: [] }] };
  assert.equal(projectClaimAudit(run, [record]).claims[0].review.status, "supported");
  for (const mutate of [r => { r.result.claims[0].text += " edited"; }, r => { r.result.claims[0].citations[0].quote = "Repeat quote."; }, r => { r.sources[0].text += " extraction changed"; }, r => { r.sources[0].raw += " raw changed"; }, r => { r.sources[0].sha256 = "a".repeat(64); }, r => { r.sources[0].fetchedAt = "2026-10-03T00:00:00Z"; }, r => { r.sources[0].extraction = { method: "plain-text-v1", providedChars: r.sources[0].text.length }; }]) {
    const changed = structuredClone(run); mutate(changed);
    assert.equal(claimKey(changed.id, 0), key); assert.notEqual(claimFingerprint(changed, changed.result.claims[0]), before);
    const view = projectClaimAudit(changed, [record]); assert.equal(view.claims[0].review.state, "invalidated"); assert.equal(view.claims[0].review.status, "unreviewed"); assert.equal(view.claims[0].review.previousStatus, "supported"); assert.equal(view.summary.reviewed, 0); assert.equal(view.summary.invalidated, 1); assert.equal(view.claims[0].review.history.length, 1);
  }
});

test("人工状态存独立追加记录，原模型原文、原评测不变，详细导出保留定位与历史", async t => {
  const f = await fixture(t); const run = adversarialRun(); await f.store.put("agent-run", run);
  const evaluation = { id: "old-evaluation", metrics: { facts: "original-score" }, cases: [{ raw: "original-evaluation-raw" }] }; await f.store.put("evaluation", evaluation);
  const originalRun = structuredClone(await f.store.get(run.id, "agent-run"));
  let audit = (await f.request(`/runs/${run.id}/claims`)).data; const key = audit.claims[1].key;
  const posted = await f.request(`/runs/${run.id}/claims/${key}/review`, "POST", reviewBody(run, audit.claims[1], { status: "contradicted", reviewerType: "agent-assisted", reviewerLabel: "Codex 源文复核", note: "模型结论否认功能；页面原句明确声明支持，属于实施者复核。" }));
  assert.equal(posted.status, 200); assert.equal(posted.data.review.status, "contradicted"); assert.equal(posted.data.review.reviewerType, "agent-assisted"); assert.equal(posted.data.review.history[0].revision, 1);
  const firstEvent = structuredClone(posted.data.review.history[0]);
  const reset = await f.request(`/runs/${run.id}/claims/${key}/review`, "POST", reviewBody(run, posted.data, { status: "unreviewed", note: "撤回此工作空间标注", citations: [] }));
  assert.equal(reset.status, 200); assert.equal(reset.data.review.history.length, 2); assert.deepEqual(reset.data.review.history[0], firstEvent); assert.equal(reset.data.review.status, "unreviewed");
  assert.deepEqual(await f.store.get(run.id, "agent-run"), originalRun); assert.deepEqual(await f.store.get(evaluation.id, "evaluation"), evaluation);
  const detail = (await f.request(`/runs/${run.id}`)).data; assert.equal(detail.claimAudit.claims[1].review.history.length, 2); assert.equal(detail.raw.model.output, "untouched-original-model-output");
  const bootstrap = (await f.request("/bootstrap")).data.runs.find(r => r.id === run.id); assert.equal(bootstrap.claimAudit, undefined); assert.equal(bootstrap.claimAuditSummary.reviewed, 0);
  const zip = await JSZip.loadAsync(await (await fetch(f.base + `/runs/${run.id}/export`)).arrayBuffer());
  assert.deepEqual(JSON.parse(await zip.file("run.json").async("string")), originalRun);
  const exported = JSON.parse(await zip.file("claim-reviews.json").async("string")); assert.equal(exported.claims[1].review.history[0].citations[0].sourcePin.sha256, run.sources[0].sha256); assert.equal(exported.claims[1].review.history.length, 2);
});

test("拒绝跨项目、跨结论来源、错误引文和失效前提；未知结论可标待核实但不能无证据支持", async t => {
  const f = await fixture(t); const run = adversarialRun(); await f.store.put("agent-run", run);
  const current = (await f.request(`/runs/${run.id}/claims`)).data.claims[0]; const path = `/runs/${run.id}/claims/${current.key}/review`;
  const variants = [{ projectId: "wrong-project" }, { expectedClaimFingerprint: "a".repeat(64) }, { confirm: false }, { citations: [{ sourceId: "official", quote: "invented quotation" }] }, { citations: [{ sourceId: "old-pricing", quote: "the plan costs $5." }] }, { citations: [{ sourceId: "official", quote: "Supports local inference.", start: 1 }] }, { citations: [{ sourceId: "official", quote: "Supports local inference.", start: null }] }];
  for (const extra of variants) assert.notEqual((await f.request(path, "POST", reviewBody(run, current, extra))).status, 200);
  assert.equal((await f.store.list("claim-review")).length, 0);
  const unknown = (await f.request(`/runs/${run.id}/claims`)).data.claims[7];
  assert.equal((await f.request(`/runs/${run.id}/claims/${unknown.key}/review`, "POST", reviewBody(run, unknown, { citations: [] }))).status, 400);
  const needs = await f.request(`/runs/${run.id}/claims/${unknown.key}/review`, "POST", reviewBody(run, unknown, { status: "needs-verification", note: "没有捕获证据，需要另行验证。", citations: [] }));
  assert.equal(needs.status, 200); assert.equal(needs.data.review.status, "needs-verification");
  for (const kind of ["prototype", "research"]) {
    const bad = { ...run, id: "not-reviewable-" + kind, kind, status: kind === "prototype" ? "completed" : "failed" }; await f.store.put("agent-run", bad);
    assert.equal((await f.request(`/runs/${bad.id}/claims`)).data.reviewable, false);
    assert.equal((await f.request(`/runs/${bad.id}/claims/${claimKey(bad.id, 0)}/review`, "POST", reviewBody(bad, current))).status, 409);
  }
});

test("同结论并发审阅只能一个版本成功，不同结论不会丢写；原始快照篡改拒绝", async t => {
  const f = await fixture(t); const run = adversarialRun(); await f.store.put("agent-run", run);
  const claims = (await f.request(`/runs/${run.id}/claims`)).data.claims;
  const firstPath = `/runs/${run.id}/claims/${claims[0].key}/review`;
  const simultaneous = await Promise.all([f.request(firstPath, "POST", reviewBody(run, claims[0], { note: "第一次并发标注" })), f.request(firstPath, "POST", reviewBody(run, claims[0], { note: "旧页面并发标注" }))]);
  assert.deepEqual(simultaneous.map(r => r.status).sort(), [200, 409]);
  const one = simultaneous.find(r => r.status === 200).data;
  const secondPath = `/runs/${run.id}/claims/${claims[1].key}/review`;
  const different = await Promise.all([f.request(firstPath, "POST", reviewBody(run, one, { note: "保留第一条的新版本" })), f.request(secondPath, "POST", reviewBody(run, claims[1], { status: "contradicted", note: "不同结论独立版本" }))]);
  assert.deepEqual(different.map(r => r.status), [200, 200]);
  const audit = (await f.request(`/runs/${run.id}/claims`)).data; assert.equal(audit.claims[0].review.history.length, 2); assert.equal(audit.claims[1].review.history.length, 1); assert.equal(audit.summary.reviewed, 2);
  run.sources[0].raw += " source was corrupted"; await f.store.put("agent-run", run);
  const invalidated = (await f.request(`/runs/${run.id}/claims`)).data.claims[0]; assert.equal(invalidated.review.state, "invalidated");
  assert.equal((await f.request(firstPath, "POST", reviewBody(run, invalidated))).status, 400); assert.equal((await f.store.list("claim-review")).find(r => r.claimKey === one.key).revision, 2);
});

test("两个互相冲突来源可以同时钉住，审阅判断和用户确认记忆仍不由文字匹配推断", async t => {
  const f = await fixture(t); const run = adversarialRun(); await f.store.put("agent-run", run);
  const current = (await f.request(`/runs/${run.id}/claims`)).data.claims[5];
  const result = await f.request(`/runs/${run.id}/claims/${current.key}/review`, "POST", reviewBody(run, current, { status: "contradicted", note: "两个快照的官方声明相互冲突；标注者需要核对版本日期。", citations: [{ sourceId: "official", quote: "Supports local inference." }, { sourceId: "conflicting", quote: "Local inference is no longer supported." }] }));
  assert.equal(result.status, 200); assert.equal(result.data.review.citations.length, 2); assert.equal(result.data.review.semanticValidation, "manual-not-independent");
  const memoryConflict = (await f.request(`/runs/${run.id}/claims`)).data.claims[6]; assert.equal(memoryConflict.quoteChecks[0].matched, true); assert.equal(memoryConflict.review.status, "unreviewed");
});
