import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { createStore } from "../server/store.mjs";
import { createAgentRouter } from "../server/agent-router.mjs";

const output = input => ({ answer: input.project.memory.map(m => m.text).join("；") || "暂无当前确认记忆", claims: [], requirements: [], actions: [{ id: "follow", title: "核实候选需求", sourceIds: input.sources.map(s => s.id) }], memoryUpdates: [], raw: { fixture: true }, engine: { name: "isolated-route-fixture" }, usage: { inputTokens: 4, outputTokens: 2, cost: null } });
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "yiban-iteration-"));
  await writeFile(join(dir, "README.md"), "隔离测试的项目背景资料，不构成真实用户背景或模型评测。");
  const store = await createStore(dir);
  const agent = await createAgentRouter({ store: options.storeDecorator ? options.storeDecorator(store) : store, root: dir, cloud: false, settings: async () => ({ provider: "codex" }), runtimeStatus: async () => ({ installed: true }), runner: async input => output(input), sourceDiscoverer: async (_, urls) => urls, ...options });
  const app = express(); app.use(express.json()); app.use(agent.router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const request = async (path, method = "GET", body, key) => {
    const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  const wait = async id => {
    for (let n = 0; n < 100; n++) {
      const { data: run } = await request("/runs/" + id);
      if (!["queued", "running"].includes(run.status)) return run;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("isolated stub did not settle");
  };
  const project = async (memory = []) => (await request("/projects", "POST", { name: "隔离测试项目", background: "只用于验证本地路由的独立背景资料。", memory })).data;
  t.after(async () => { agent.shutdown(); await new Promise(resolve => server.close(resolve)); store.close(); await rm(dir, { recursive: true, force: true }); });
  return { store, base, request, wait, project };
}

test("记忆修订保留审计，旧值和历史不进入当前模型上下文，恢复必须确认并匹配版本", async t => {
  const seen = [];
  const f = await fixture(t, { runner: async input => { seen.push(input); return output(input); } });
  let p = await f.project([{ id: "team", text: "团队三人", source: "隔离测试确认" }]);
  const original = structuredClone(p.memoryHistory[0]);
  const recall = async () => { const r = await f.request("/runs", "POST", { projectId: p.id, kind: "recall", sessionId: "same-session", prompt: "回忆当前的团队人数" }); assert.equal(r.status, 202); return f.wait(r.data.id); };
  await recall();
  p = (await f.request(`/projects/${p.id}/memory/team`, "PATCH", { text: "团队两人", confirm: true, expectedRevision: p.memoryRevision, reason: "纠正测试人数" })).data;
  assert.deepEqual(p.memoryHistory[0], original);
  const oldLength = p.memoryHistory.length;
  assert.equal((await f.request(`/projects/${p.id}/memory/team`, "PATCH", { text: "并发旧页面覆盖", confirm: true, expectedRevision: p.memoryRevision - 1 })).status, 409);
  assert.equal((await f.request(`/projects/${p.id}/memory`)).data.history.length, oldLength);
  const corrected = await recall();
  assert.equal(corrected.result.answer, "团队两人");
  assert.equal(seen[1].history.length, 0);
  assert.equal(JSON.stringify(seen[1]).includes("团队三人"), false);
  assert.equal("memoryHistory" in seen[1].project, false);
  assert.ok(corrected.raw.project.memoryHistory.some(h => h.text === "团队三人"));
  assert.equal(seen[1].project.memoryRevision, p.memoryRevision);
  p = (await f.request(`/projects/${p.id}/memory/team`, "PATCH", { active: false, confirm: true, expectedRevision: p.memoryRevision })).data;
  assert.equal(p.memory.length, 0);
  const inactive = await recall(); assert.equal(inactive.result.answer, "暂无当前确认记忆");
  assert.equal(JSON.stringify(seen[2]).includes("团队两人"), false);
  assert.equal((await f.request(`/projects/${p.id}/memory/team/restore`, "POST", { revisionId: original.revisionId, expectedRevision: p.memoryRevision })).status, 400);
  p = (await f.request(`/projects/${p.id}/memory/team/restore`, "POST", { revisionId: original.revisionId, confirm: true, expectedRevision: p.memoryRevision })).data;
  assert.equal(p.memory[0].text, "团队三人");
  assert.equal(p.memoryHistory.at(-1).operation, "restored");
  assert.equal(p.memoryHistory.at(-1).restoredFromRevisionId, original.revisionId);
  assert.deepEqual(p.memoryHistory[0], original);
});

test("旧 memory 数组按当前记忆兼容导入；新增去重、恢复跨条目拒绝", async t => {
  const f = await fixture(t);
  await f.store.put("research-project", { id: "legacy", name: "旧档案", background: "旧项目的背景资料。", memory: [{ id: "m", text: "旧档案确认的事实", source: "确认", updatedAt: "2026-01-01T00:00:00Z" }], createdAt: "2026-01-01T00:00:00Z" });
  const first = (await f.request("/projects/legacy/memory")).data;
  const second = (await f.request("/projects/legacy/memory")).data;
  assert.deepEqual(first, second); assert.equal(first.revision, 0); assert.equal(first.history[0].operation, "imported");
  const add = await f.request("/projects/legacy/memory", "POST", { text: "另一条人工确认事实", confirm: true, expectedRevision: 0 });
  assert.equal(add.status, 200); assert.equal(add.data.memory.length, 2);
  assert.equal((await f.request("/projects/legacy/memory/not-this-id/restore", "POST", { revisionId: first.history[0].revisionId, confirm: true, expectedRevision: 1 })).status, 404);
  assert.equal((await f.request("/projects/legacy", "PATCH", { memory: [{ id: "same", text: "第一条" }, { id: "same", text: "第二条" }], expectedRevision: 1 })).status, 400);
});

test("同项目显式复用完整快照不重抓，保留来源年龄和原始导出，默认不隐式复用", async t => {
  let fetches = 0; const seen = [];
  const f = await fixture(t, { runner: async input => { seen.push(input); return output(input); }, evidenceFetcher: async () => { fetches++; throw new Error("selected snapshots must not fetch"); } });
  const p = await f.project(); const q = await f.project();
  const raw = "公开资料原始快照正文，隔离测试用。";
  const source = { id: "snapshot", url: "https://example.com/official", title: "原始官方页", status: "fetched", text: raw, raw, fetchedAt: "2026-01-01T00:00:00Z", sha256: createHash("sha256").update(raw).digest("hex") };
  await f.store.put("agent-run", { id: "origin", projectId: p.id, kind: "research", status: "failed", sources: [source, { ...source, id: "duplicate" }], result: null, raw: {}, createdAt: "2026-01-01T00:00:00Z", usage: {}, events: [] });
  await f.store.put("agent-run", { id: "foreign-origin", projectId: q.id, status: "completed", sources: [{ ...source, id: "foreign" }], raw: {}, createdAt: "2026-01-01T00:00:00Z" });
  const body = { projectId: p.id, prompt: "结合所选的历史快照形成新的研究", sourceIds: [source.id, source.id, "duplicate"], sourceUrls: [] };
  const started = await f.request("/runs", "POST", body); assert.equal(started.status, 202);
  const run = await f.wait(started.data.id); assert.equal(run.status, "completed");
  assert.equal(fetches, 0); assert.equal(run.sources.length, 1); assert.equal(seen[0].sources[0].text, raw);
  assert.equal(run.sources[0].sha256, source.sha256); assert.equal(run.sources[0].fetchedAt, source.fetchedAt);
  assert.equal(run.sources[0].reusedFrom.originalRunId, "origin"); assert.ok(run.sources[0].ageAtReuseSeconds > 0);
  const zip = await JSZip.loadAsync(await (await fetch(f.base + "/runs/" + run.id + "/export")).arrayBuffer());
  assert.equal(await zip.file("evidence/snapshot.txt").async("string"), raw);
  assert.equal(JSON.parse(await zip.file("evidence/snapshot.json").async("string")).reusedFrom.originalRunId, "origin");
  assert.equal((await f.request("/runs", "POST", { ...body, sourceUrls: [source.url] })).status, 400);
  const newerRaw = raw + "新版本";
  await f.store.put("agent-run", { id: "newer-origin", projectId: p.id, status: "completed", sources: [{ ...source, id: "new-snapshot", text: newerRaw, raw: newerRaw, sha256: createHash("sha256").update(newerRaw).digest("hex") }], raw: {}, createdAt: "2026-02-01T00:00:00Z" });
  assert.equal((await f.request("/runs", "POST", { ...body, sourceIds: [source.id, "new-snapshot"] })).status, 400);
  for (const sourceIds of [["foreign"], ["unknown"]]) assert.equal((await f.request("/runs", "POST", { ...body, sourceIds, sourceUrls: [] })).status, 400);
  const implicit = await f.request("/runs", "POST", { projectId: p.id, prompt: "不选择来源时不要自动使用保存的快照" });
  assert.equal((await f.wait(implicit.data.id)).status, "failed"); assert.equal(seen.length, 1);
  const replay = await f.request("/runs", "POST", { ...body, sourceIds: [source.id], sourceUrls: [] });
  assert.equal((await f.wait(replay.data.id)).sources[0].reusedFrom.originalRunId, "origin");
});

test("篡改或缺原始正文的来源不能伪装成可追溯快照", async t => {
  const f = await fixture(t); const p = await f.project();
  await f.store.put("agent-run", { id: "corrupt", projectId: p.id, sources: [{ id: "bad", status: "fetched", text: "正文", raw: "被替换的正文", sha256: "a".repeat(64), url: "https://example.com/official" }], status: "completed", raw: {} });
  assert.equal((await f.request("/runs", "POST", { projectId: p.id, prompt: "复用已保存的原始证据", sourceIds: ["bad"] })).status, 400);
});

test("明确导入的项目资料通过实际研究路由进入模型上下文而不抓网页，来源隔离和ZIP保留", async t => {
  let fetches = 0; const seen = [];
  const f = await fixture(t, { runner: async input => { seen.push(input); return output(input); }, evidenceFetcher: async () => { fetches++; throw new Error("local import must not fetch"); } });
  const p = await f.project(), q = await f.project();
  const input = { kind: "text-import", sourceLabel: "隔离项目资料，非官方核验", text: "明确导入用于验证真实研究路由的本机文本，没有网络验证，也不自动成为确认记忆。".repeat(4) };
  const preview = await f.request(`/projects/${p.id}/sources/preview`, "POST", input);
  assert.equal(preview.status, 200); assert.equal((await f.store.list("project-source")).length, 0);
  const saved = await f.request(`/projects/${p.id}/sources`, "POST", { ...input, confirm: true, expectedImportFingerprint: preview.data.expectedImportFingerprint, importerType: "implementation-fixture", importerLabel: "隔离验收夹具" });
  assert.equal(saved.status, 201); assert.equal(saved.data.fetchedAt, null);
  const body = { projectId: p.id, kind: "research", prompt: "只使用本次明确选入的本机资料形成判断", sourceIds: [saved.data.id], sourceUrls: [] };
  const start = await f.request("/runs", "POST", body); assert.equal(start.status, 202);
  const run = await f.wait(start.data.id); assert.equal(run.status, "completed"); assert.equal(fetches, 0);
  assert.equal(seen[0].sources[0].origin.kind, "text-import"); assert.equal(seen[0].sources[0].status, "imported"); assert.equal(seen[0].sources[0].text, input.text);
  assert.equal((await f.request(`/projects/${p.id}/memory`)).data.memory.length, 0);
  assert.equal((await f.request("/runs", "POST", { ...body, projectId: q.id })).status, 400);
  const zip = await JSZip.loadAsync(await (await fetch(f.base + "/runs/" + run.id + "/export")).arrayBuffer());
  const pin = JSON.parse(await zip.file(`evidence/${saved.data.id}.json`).async("string"));
  assert.equal(pin.origin.kind, "text-import"); assert.equal(pin.fetchedAt, null); assert.equal(pin.importedBy.type, "implementation-fixture");
});

test("行动项支持日期备注、拒绝无效日期、失败任务和重复 ID", async t => {
  const f = await fixture(t); const p = await f.project();
  const s = await f.request("/runs", "POST", { projectId: p.id, kind: "recall", prompt: "形成一个待人工验证的行动项" });
  const run = await f.wait(s.data.id); const path = `/runs/${run.id}/actions/follow`;
  const updated = await f.request(path, "PATCH", { note: "访谈后补充证据链接", dueDate: "2026-10-09" });
  assert.equal(updated.status, 200); assert.equal(updated.data.result.actions[0].done, false); assert.equal(updated.data.result.actions[0].dueDate, "2026-10-09");
  assert.equal((await f.request(path, "PATCH", { dueDate: "2026-02-31" })).status, 400);
  assert.equal((await f.request(path, "PATCH", { done: true, dueDate: null })).data.result.actions[0].dueDate, null);
  const mutations = await Promise.all([f.request(path, "PATCH", { note: "并发保存的备注" }), f.request(path, "PATCH", { done: false })]);
  assert.deepEqual(mutations.map(m => m.status), [200, 200]);
  const current = (await f.request("/runs/" + run.id)).data.result.actions[0]; assert.equal(current.note, "并发保存的备注"); assert.equal(current.done, false);
  run.status = "failed"; await f.store.put("agent-run", run); assert.equal((await f.request(path, "PATCH", { done: true })).status, 409);
  run.status = "completed"; run.result.actions.push({ ...run.result.actions[0] }); await f.store.put("agent-run", run); assert.equal((await f.request(path, "PATCH", { note: "不能猜测编辑哪一条" })).status, 409);
});

test("精简启动响应不含大正文，任务、评测详情和兼容入口完整保留", async t => {
  const f = await fixture(t); const p = await f.project();
  await f.store.put("agent-run", { id: "detail", projectId: p.id, kind: "prototype", status: "completed", result: { answer: "结果" }, raw: { hidden: "raw-model" }, sources: [{ id: "s", raw: "raw-html", text: "long-body", url: "https://example.com" }], prototype: { code: "<html>prototype</html>", prd: "full-prd", version: 1 }, events: [] });
  await f.store.put("evaluation", { id: "existing-report", title: "保留既有评测", cases: [{ raw: "raw-report", result: "unchanged" }], metrics: { measured: false } });
  const compact = (await f.request("/bootstrap?compact=1")).data;
  assert.equal(compact.compact, true); assert.equal(compact.runs[0].sources[0].text, undefined); assert.equal(compact.runs[0].sources[0].raw, undefined); assert.equal(compact.runs[0].prototype.code, undefined); assert.equal(compact.evaluations[0].cases, undefined);
  assert.equal((await f.request("/bootstrap")).data.compact, true);
  assert.equal(compact.projects.find(item => item.id === p.id).memoryHistory, undefined);
  const detail = (await f.request("/runs/detail")).data;
  assert.equal(detail.sources[0].text, "long-body"); assert.equal(detail.raw.hidden, "raw-model"); assert.equal(detail.prototype.code, "<html>prototype</html>");
  assert.equal((await f.request("/evaluations/existing-report")).data.cases[0].raw, "raw-report");
  const compatible = (await f.request("/bootstrap?full=1")).data;
  assert.equal(compatible.compact, false); assert.equal(compatible.runs[0].sources[0].text, "long-body"); assert.equal(compatible.runs[0].prototype.code, "<html>prototype</html>"); assert.equal(compatible.evaluations[0].cases[0].raw, "raw-report");
});

test("并发预检保留项目锁和全局调用上限，重复幂等请求不触发第二次调用", async t => {
  const releases = []; let calls = 0;
  const f = await fixture(t, { settings: async () => { await new Promise(resolve => setTimeout(resolve, 15)); return { provider: "codex" }; }, runner: async input => { calls++; await new Promise(resolve => releases.push(resolve)); return output(input); } });
  const p = await f.project(); const q = await f.project(); const r = await f.project();
  const body = id => ({ projectId: id, kind: "recall", prompt: "等待隔离测试解除调用阻塞" });
  const same = await Promise.all([f.request("/runs", "POST", body(p.id), "same-concurrent"), f.request("/runs", "POST", body(p.id), "same-concurrent")]);
  assert.deepEqual(same.map(x => x.status).sort(), [202, 409]);
  const other = await Promise.all([f.request("/runs", "POST", body(q.id)), f.request("/runs", "POST", body(r.id))]);
  assert.deepEqual(other.map(x => x.status).sort(), [202, 409]);
  assert.equal((await f.request(`/projects/${p.id}/memory`, "POST", { text: "执行时的上下文修改", confirm: true, expectedRevision: p.memoryRevision })).status, 409);
  for (let n = 0; calls < 2 && n < 50; n++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls, 2); for (const release of releases) release();
  for (const response of [...same, ...other].filter(x => x.status === 202)) assert.equal((await f.wait(response.data.id)).status, "completed");
  assert.equal((await f.request("/runs", "POST", body(p.id), "same-concurrent")).data.id, same.find(x => x.status === 202).data.id);
  assert.equal(calls, 2);
});

test("幂等预检等待期间修改记忆，获得任务锁后重新读取当前版本", async t => {
  let holdNextList = false; let entered; let release;
  const blocked = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const seen = [];
  const f = await fixture(t, { storeDecorator: store => ({ ...store, list: async type => { if (type === "agent-run" && holdNextList) { holdNextList = false; entered(); await gate; } return store.list(type); } }), runner: async input => { seen.push(input); return output(input); } });
  const p = await f.project([{ id: "team", text: "竞态前旧团队人数", source: "测试" }]);
  holdNextList = true;
  const pending = f.request("/runs", "POST", { projectId: p.id, kind: "recall", prompt: "预检后只使用当前确认记忆" }, "awaiting-preflight");
  await blocked;
  assert.equal((await f.request(`/projects/${p.id}/memory/team`, "PATCH", { text: "竞态后最新团队人数", confirm: true, expectedRevision: p.memoryRevision })).status, 200);
  release(); const run = await pending; assert.equal(run.status, 202);
  assert.equal((await f.wait(run.data.id)).result.answer, "竞态后最新团队人数");
  assert.equal(JSON.stringify(seen[0]).includes("竞态前旧团队人数"), false);
});

test("最终档案保存期间保持任务名额，拒绝会被末次写入覆盖的待办修改", async t => {
  let completedWrites = 0; let entered; let release;
  const blocked = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { storeDecorator: store => ({ ...store, put: async (type, item) => {
    if (type === "agent-run" && item.status === "completed" && ++completedWrites === 2) { entered(); await gate; }
    return store.put(type, item);
  } }) });
  const p = await f.project();
  const submitted = await f.request("/runs", "POST", { projectId: p.id, kind: "recall", prompt: "形成行动项并保留最终写入阶段" });
  await blocked;
  try {
    assert.equal((await f.request(`/runs/${submitted.data.id}/actions/follow`, "PATCH", { note: "不应被未完成的末次保存覆盖" })).status, 409);
    assert.equal((await f.request(`/projects/${p.id}/memory`, "POST", { text: "必须等待上下文真正结束", confirm: true, expectedRevision: p.memoryRevision })).status, 409);
  } finally { release(); }
  await f.wait(submitted.data.id);
  assert.equal((await f.request(`/runs/${submitted.data.id}/actions/follow`, "PATCH", { note: "任务保存结束后可以跟进" })).status, 200);
  assert.equal((await f.request("/runs/" + submitted.data.id)).data.result.actions[0].note, "任务保存结束后可以跟进");
});
