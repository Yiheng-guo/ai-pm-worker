import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { projectClaimAudit, createClaimAudit } from "../server/claim-audit.mjs";
import { buildPrototypeBrief, projectRequirementBasis } from "../server/requirement-basis.mjs";
import { createAgentRouter } from "../server/agent-router.mjs";
import { createStore } from "../server/store.mjs";
const hash = text => createHash("sha256").update(text).digest("hex");
const basis = { claimIndices: [0], projectFields: ["goal"], memoryIds: ["team"], assumptions: ["需通过原型验证用户是否理解"], verification: ["测试原型的选择范围"] };
function data() {
  const project = { id: "p", name: "独立夹具项目", background: "用于独立验证路由的项目背景资料。", goal: "验证选定需求的交互", constraints: "示例数据，不能当真实服务", memory: [{ id: "team", text: "研究时团队三人", revisionId: "memory-old", status: "active" }], memoryRevision: 1 };
  const raw = "公开声明。此正文是测试夹具。";
  const source = { id: "s", url: "https://example.com/official", text: raw, raw, sha256: hash(raw), status: "fetched", fetchedAt: "2026-10-02T00:00:00Z" };
  const parent = { id: "research", projectId: project.id, kind: "research", status: "completed", prompt: "研究问题", sources: [source], events: [], usage: {}, raw: { project: structuredClone(project), model: { immutable: true } }, result: { answer: "原研究", claims: [{ text: "公开声明存在", kind: "fact", sourceIds: ["s"], citations: [] }], requirements: [
    { id: "dup", title: "同名需求", description: "ONLY_A", sourceIds: ["s"], acceptance: ["A"], basis: null },
    { id: "dup", title: "同名需求", description: "ONLY_B", sourceIds: ["s"], acceptance: ["B"], basis: structuredClone(basis) },
    { id: "different", title: "OTHER_C", description: "ONLY_C", sourceIds: [], acceptance: ["C"], basis: { claimIndices: [], projectFields: ["goal"], memoryIds: [], assumptions: ["独立产品假设"], verification: ["访谈"] } },
  ], actions: [{ id: "a", title: "验证B", sourceIds: ["s"], requirementIndices: [1] }] } };
  return { project, parent };
}

test("论证链只绑定显式同输出引用，旧需求不因同来源获得支持，空论证警告", () => {
  const { parent } = data(); const audit = projectClaimAudit(parent); const graph = projectRequirementBasis(parent, audit);
  assert.equal(graph.requirements[0].basisState, "legacy"); assert.equal(graph.requirements[0].bindings.claims.length, 0);
  assert.notEqual(graph.requirements[0].key, graph.requirements[1].key); assert.equal(graph.requirements[1].modelId, "dup");
  assert.equal(graph.requirements[1].bindings.claims[0].reviewSnapshot.status, "unreviewed"); assert.equal(graph.requirements[1].bindings.memory[0].text, "研究时团队三人");
  assert.deepEqual(graph.actions[0].requirementKeys, [graph.requirements[1].key]);
  parent.result.requirements[1].basis = { claimIndices: [], projectFields: [], memoryIds: [], assumptions: [], verification: [] };
  assert.ok(projectRequirementBasis(parent, audit).requirements[1].warnings.some(w => w.code === "EMPTY_EXPLICIT_BASIS"));
  parent.result.requirements[1].basis.claimIndices = [99];
  const invalid = projectRequirementBasis(parent, audit).requirements[1]; assert.equal(invalid.basisState, "invalid"); assert.equal(invalid.bindings.claims.length, 0);
  parent.result.requirements[1].basis = { ...basis, projectFields: ["goal", "goal"] }; assert.equal(projectRequirementBasis(parent, audit).requirements[1].basisState, "invalid");
});

test("稳定索引选B，不携带A/C需求；研究记忆与当前记忆漂移分离；时间不污染预览指纹", () => {
  const { parent, project } = data(); project.memory[0] = { ...project.memory[0], text: "当前团队两人", revisionId: "memory-new" }; project.memoryRevision = 2;
  const args = { parent, currentProject: project, audit: projectClaimAudit(parent), body: { requirementIndices: [1] } };
  const brief = buildPrototypeBrief(args); const another = buildPrototypeBrief(args);
  assert.deepEqual(brief.selectedIndices, [1]); assert.equal(brief.requirements.length, 1); assert.equal(brief.requirements[0].description, "ONLY_B");
  assert.equal(brief.prompt.includes("ONLY_A"), false); assert.equal(brief.prompt.includes("ONLY_C"), false);
  assert.equal(brief.requirements[0].bindings.memory[0].text, "研究时团队三人"); assert.equal(brief.currentProjectSnapshot.memory[0].text, "当前团队两人"); assert.deepEqual(brief.contextDiff.changedMemoryIds, ["team"]);
  assert.equal(brief.briefFingerprint, another.briefFingerprint); assert.equal(brief.modelInputSha256, hash(brief.prompt));
  project.memory.push({ id: "new-constraint", text: "新增约束不能因旧basis遗漏", revisionId: "new", status: "active" });
  const current = buildPrototypeBrief(args); assert.equal(current.modelInput.currentProject.memory.length, 2); assert.equal(current.inputCoverage.memory.omittedCount, 0);
  const frozen = JSON.stringify(brief); parent.sources[0].text = "后来修改的正文"; parent.result.claims[0].text = "后来修改的主张"; project.memory[0].text = "后来修改的记忆"; parent.result.requirements[1].basis.assumptions.push("生成之后的假设改动");
  assert.equal(JSON.stringify(brief), frozen);
});

test("子集默认新原型；旧模式兼容修订但版本目标及HTML摘要进入预览指纹", () => {
  const { project, parent } = data(); const previous = { id: "old-agent-prototype", projectId: project.id, prototype: { projectId: "foundry-old", versionId: "old-v1", version: 1, title: "旧A原型", code: "<html>ONLY_A_OLD</html>" } };
  const args = { parent, currentProject: project, previousPrototype: previous, audit: projectClaimAudit(parent) };
  assert.equal(buildPrototypeBrief({ ...args, body: { requirementIndices: [1] } }).prototypeMode, "new");
  const revision = buildPrototypeBrief({ ...args, body: {} }); assert.equal(revision.prototypeMode, "revise"); assert.equal(revision.revisionTarget.versionId, "old-v1");
  previous.prototype.code += "changed"; assert.throws(() => buildPrototypeBrief({ ...args, body: { prototypeMode: "revise", expectedBriefFingerprint: revision.briefFingerprint } }), error => error.status === 409);
  assert.throws(() => buildPrototypeBrief({ ...args, previousPrototype: null, body: { prototypeMode: "revise" } }));
});

test("选择语义明确，unknown或项目推导允许探索，完整字符预算包含追加要求", () => {
  const { parent, project } = data(); const args = { parent, currentProject: project, audit: projectClaimAudit(parent) };
  assert.equal(buildPrototypeBrief({ ...args, body: {} }).requirements.length, 3);
  for (const requirementIndices of [[], [1, 1], [-1], [3], ["1"]]) assert.throws(() => buildPrototypeBrief({ ...args, body: { requirementIndices } }));
  assert.equal(buildPrototypeBrief({ ...args, body: { requirementIndices: [2] } }).purpose, "exploration");
  parent.result.claims[0].kind = "unknown"; assert.equal(buildPrototypeBrief({ ...args, audit: projectClaimAudit(parent), body: { requirementIndices: [1] } }).requirements.length, 1);
  for (const fill of ["x", "中", "😀"]) {
    assert.throws(() => buildPrototypeBrief({ ...args, body: { requirementIndices: [1], prompt: fill.repeat(3000) }, maxChars: 1000 }), error => error.status === 413 && error.actualChars > error.maxChars && error.unit === "utf16-code-units");
  }
});

test("路由预算及过期预览拒绝发生在造物调用前，冻结导出保持生成时依据", async t => {
  const dir = await mkdtemp(join(tmpdir(), "basis-routes-")); await writeFile(join(dir, "README.md"), "只用于隔离路由测试的背景资料。" );
  const store = await createStore(dir); const { parent, project } = data(); await store.put("research-project", project); await store.put("agent-run", parent);
  await store.put("agent-run", { id: "older-prototype", projectId: project.id, kind: "prototype", status: "completed", createdAt: "2026-01-01", prototype: { projectId: "old-foundry", versionId: "old-v", code: "<html>ONLY_A_OLD</html>", title: "旧A", version: 1 }, sources: [], events: [], raw: {} });
  const received = []; const fake = express(); fake.use(express.json());
  fake.get("/api/auth", (_, res) => res.json({ authenticated: true })); fake.get("/api/health", (_, res) => res.json({ product: "factory" }));
  fake.post("/api/jobs", (req, res) => { received.push(req.body); res.json({ id: "fake-job" }); });
  fake.get("/api/jobs/fake-job", (_, res) => res.json({ id: "fake-job", status: "completed", provider: "codex", projectId: "fake-project", versionId: "v", result: { code: "<html>isolated fixture</html>" }, usage: { cost: null, requestCount: 0, note: "非模型测试夹具" } }));
  fake.get("/api/projects/fake-project", (_, res) => res.json({ id: "fake-project", versions: [{ id: "v", title: "选B的夹具", code: "<html>isolated fixture</html>", prd: "隔离原型夹具", createdAt: "2026-10-02" }, { id: "another-job-v2", title: "别人的后续版本", code: "<html>WRONG_OTHER_VERSION</html>", prd: "不同任务" }] }));
  const foundry = fake.listen(0, "127.0.0.1"); await new Promise(resolve => foundry.once("listening", resolve));
  const previousURL = process.env.FOUNDRY_URL; process.env.FOUNDRY_URL = "http://127.0.0.1:" + foundry.address().port;
  const agent = await createAgentRouter({ store, root: dir, cloud: false, settings: async () => ({ provider: "codex" }), runtimeStatus: async () => ({ installed: true }) });
  if (previousURL === undefined) delete process.env.FOUNDRY_URL; else process.env.FOUNDRY_URL = previousURL;
  const app = express(); app.use(express.json()); app.use(agent.router); const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const req = async (path, body) => { const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json() }; };
  t.after(async () => { agent.shutdown(); await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => foundry.close(resolve))]); store.close(); await rm(dir, { recursive: true, force: true }); });
  const preview = await req("/runs/research/prototype/brief-preview", { requirementIndices: [1] }); assert.equal(preview.status, 200);
  parent.result.requirements[1].description = "z".repeat(40000); await store.put("agent-run", parent);
  const large = await req("/runs/research/prototype", { requirementIndices: [1] }); assert.equal(large.status, 413); assert.equal(large.data.code, "PROTOTYPE_CONTEXT_TOO_LARGE"); assert.equal(received.length, 0);
  parent.result.requirements[1].description = "ONLY_B"; await store.put("agent-run", parent);
  project.goal = "提交前改了目标"; await store.put("research-project", project);
  const stale = await req("/runs/research/prototype", { requirementIndices: [1], expectedBriefFingerprint: preview.data.briefFingerprint }); assert.equal(stale.status, 409); assert.equal(received.length, 0);
  const fresh = await req("/runs/research/prototype/brief-preview", { requirementIndices: [1] });
  parent.sources[0].text += "改了提取正文"; await store.put("agent-run", parent); assert.equal((await req("/runs/research/prototype", { requirementIndices: [1], expectedBriefFingerprint: fresh.data.briefFingerprint })).status, 409); assert.equal(received.length, 0);
  parent.sources[0].text = parent.sources[0].raw; await store.put("agent-run", parent);
  const reviews = createClaimAudit({ store, getRun: id => store.get(id, "agent-run") }); const before = (await reviews.forRun(parent)).claims[0];
  await reviews.review(parent.id, before.key, { projectId: project.id, expectedRevision: 0, expectedClaimFingerprint: before.claimFingerprint, confirm: true, status: "supported", note: "隔离夹具标注，不代表独立审阅", reviewerType: "implementation-fixture", citations: [{ sourceId: "s", quote: "公开声明。" }] });
  assert.equal((await req("/runs/research/prototype", { requirementIndices: [1], expectedBriefFingerprint: fresh.data.briefFingerprint })).status, 409); assert.equal(received.length, 0);
  const reviewedPreview = await req("/runs/research/prototype/brief-preview", { requirementIndices: [1] });
  const started = await req("/runs/research/prototype", { requirementIndices: [1], expectedBriefFingerprint: reviewedPreview.data.briefFingerprint }); assert.equal(started.status, 202);
  let completed;
  for (let i = 0; i < 100; i++) { completed = (await req("/runs/" + started.data.id)).data; if (!["queued", "running"].includes(completed.status)) break; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.equal(completed.status, "completed"); assert.equal(received.length, 1); assert.equal(received[0].prompt, completed.raw.prototypeBrief.prompt); assert.equal(received[0].prompt.includes("ONLY_A"), false); assert.equal(received[0].prompt.includes("ONLY_C"), false);
  assert.equal(completed.raw.prototypeBrief.prototypeMode, "new"); assert.equal(completed.raw.prototypeBrief.revisionTarget, null);
  assert.equal(completed.prototype.versionId, "v"); assert.equal(completed.prototype.versionSelection, "job-version-id"); assert.equal(completed.prototype.version, 1); assert.equal(completed.prototype.code.includes("WRONG_OTHER_VERSION"), false);
  assert.equal(completed.result.requirements.length, 1); assert.equal(completed.result.requirements[0].description, "ONLY_B");
  const expected = JSON.stringify(completed.raw.prototypeBrief, null, 2);
  parent.result.requirements[1].description = "AFTER_GENERATION"; parent.sources[0].text = "AFTER_SOURCE"; await store.put("agent-run", parent);
  const zip = await JSZip.loadAsync(await (await fetch(base + "/prototypes/" + completed.id + "/download")).arrayBuffer());
  assert.equal(await zip.file("prototype-brief.json").async("string"), expected); assert.equal(JSON.parse(await zip.file("requirements-basis.json").async("string")).length, 1); assert.equal(await zip.file("evidence/s.extracted.txt").async("string"), "公开声明。此正文是测试夹具。");
});
