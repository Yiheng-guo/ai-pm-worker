import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import JSZip from "jszip";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createAgentRouter } from "../server/agent-router.mjs";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const output = () => ({ answer: "仅隔离夹具输出", claims: [], requirements: [], actions: [], memoryUpdates: [], valueJudgment: "CANCELLED_GHOST_DECISION", raw: { output: "original-output", calls: [{ usage: { input_tokens: 123 } }] }, usage: { inputTokens: 123, outputTokens: 7, requestCount: 1, cost: null }, engine: { name: "isolated-fixture" } });
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "agent-lifecycle-")); await writeFile(join(dir, "README.md"), "测试背景资料，不是用户项目或真实模型记录。");
  const rows = new Map();
  const store = {
    async list(type) { return [...rows.values()].filter(r => r.type === type).map(r => structuredClone(r.value)); },
    async get(id, type) { const row = rows.get(type + ":" + id); if (options.beforeGet) await options.beforeGet(id, type); return row ? structuredClone(row.value) : null; },
    async put(type, value) { if (options.beforePut) await options.beforePut(type, value); rows.set(type + ":" + value.id, { type, value: structuredClone(value) }); return value; },
  };
  const agent = await createAgentRouter({ store, root: dir, cloud: false, settings: async () => ({ provider: "codex" }), runtimeStatus: async () => ({ installed: true }), runner: options.runner || (async () => output()) });
  const app = express(); app.use(express.json()); app.use(agent.router); const server = app.listen(0, "127.0.0.1"); await new Promise(r => server.once("listening", r)); const base = "http://127.0.0.1:" + server.address().port;
  const request = async (path, method = "GET", body) => { const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: res.status, data: await res.json() }; };
  const wait = async id => { for (let i = 0; i < 200; i++) { const { data } = await request("/runs/" + id); if (["cancelled", "completed", "failed"].includes(data.status) && !data.cancellationPending) return data; await new Promise(r => setTimeout(r, 5)); } throw new Error("fixture did not settle"); };
  t.after(async () => { agent.shutdown(); await new Promise(r => server.close(r)); await rm(dir, { recursive: true, force: true }); });
  const project = (await request("/projects", "POST", { name: "隔离项目", background: "只用于本地生命周期验证的背景资料。" })).data;
  return { store, request, wait, project, base };
}

test("取消后runner仍返回，保留已报告用量和原文但不发布result/decision；取消期间锁不提前释放", async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { runner: async () => { entered.resolve(); await release.promise; return output(); } });
  const start = await f.request("/runs", "POST", { projectId: f.project.id, kind: "recall", prompt: "取消前已进入模型夹具" }); await entered.promise;
  const cancelled = await f.request(`/runs/${start.data.id}/cancel`, "POST"); assert.equal(cancelled.status, 202); assert.equal(cancelled.data.status, "running"); assert.equal(cancelled.data.cancellationPending, true);
  assert.equal((await f.request(`/projects/${f.project.id}`, "PATCH", { goal: "取消未收尾不允许改背景" })).status, 409);
  release.resolve(); const final = await f.wait(start.data.id);
  assert.equal(final.status, "cancelled"); assert.equal(final.result, null); assert.equal(final.prototype, undefined); assert.equal(final.usage.inputTokens, 123); assert.equal(final.usage.requestCount, 1); assert.equal(final.usage.cost, null); assert.equal(final.raw.model.output, "original-output"); assert.equal(final.raw.returnedOutput.valueJudgment, "CANCELLED_GHOST_DECISION");
  assert.equal((await f.store.get(f.project.id, "research-project")).decisions.length, 0);
  const zip = await JSZip.loadAsync(await (await fetch(f.base + `/runs/${start.data.id}/export`)).arrayBuffer()); assert.equal(JSON.parse(await zip.file("usage.json").async("string")).inputTokens, 123); assert.equal(JSON.parse(await zip.file("run.json").async("string")).status, "cancelled");
  assert.equal((await f.request(`/projects/${f.project.id}`, "PATCH", { goal: "收尾之后可以修改" })).status, 200);
});

test("returned后读取项目暂停时接受取消，旧finally不反写running且无幽灵decision", async t => {
  const entered = deferred(), release = deferred(); let arm = false;
  const f = await fixture(t, { runner: async () => { arm = true; return output(); }, beforeGet: async (_, type) => { if (type === "research-project" && arm) { arm = false; entered.resolve(); await release.promise; } } });
  const run = (await f.request("/runs", "POST", { projectId: f.project.id, kind: "recall", prompt: "复现返回后项目读取暂停窗口" })).data; await entered.promise;
  assert.equal((await f.request(`/runs/${run.id}/cancel`, "POST")).status, 202); release.resolve(); const final = await f.wait(run.id);
  assert.equal(final.status, "cancelled"); assert.equal(final.result, null); assert.equal(final.usage.inputTokens, 123); assert.equal((await f.store.get(f.project.id, "research-project")).decisions.length, 0);
  assert.equal((await f.request(`/runs/${run.id}`)).data.status, "cancelled");
});

test("最终发布边界后cancel409，不给已接受取消的错觉；最终记录保存期间仍有锁", async t => {
  const entered = deferred(), release = deferred(); let arm = false;
  const f = await fixture(t, { runner: async () => { arm = true; return output(); }, beforePut: async (type, value) => { if (type === "research-project" && arm && value.decisions?.length) { arm = false; entered.resolve(); await release.promise; } } });
  const run = (await f.request("/runs", "POST", { projectId: f.project.id, kind: "recall", prompt: "进入最终发布边界测试" })).data; await entered.promise;
  const cancel = await f.request(`/runs/${run.id}/cancel`, "POST"); assert.equal(cancel.status, 409); assert.equal(cancel.data.code, "RUN_FINALIZING"); release.resolve();
  assert.equal((await f.wait(run.id)).status, "completed"); assert.equal((await f.store.get(f.project.id, "research-project")).decisions.length, 1);
});

test("待办原数组稳定键避免重复模型ID串项，指纹保护两窗口，不同待办并发不丢写，raw不变", async t => {
  const f = await fixture(t); const raw = { output: "exact original model text" };
  const saved = { id: "duplicate-actions", projectId: f.project.id, kind: "research", status: "completed", raw, sources: [], usage: {}, result: { actions: [{ id: "dup", title: "同标题", done: false }, { id: "dup", title: "同标题", done: false }, { id: "unique", title: "兼容项", done: false }] }, events: [] };
  await f.store.put("agent-run", saved);
  const items = (await f.request(`/runs/${saved.id}/action-items`)).data.items; assert.notEqual(items[0].key, items[1].key); assert.equal(items[1].index, 1); assert.equal(items[1].modelId, "dup");
  const changed = await f.request(`/runs/${saved.id}/action-items/${items[1].key}`, "PATCH", { expectedActionFingerprint: items[1].actionFingerprint, done: true, note: "第二条独立进展", dueDate: "2026-10-12" }); assert.equal(changed.status, 200);
  assert.equal(changed.data.result.actions[0].done, false); assert.equal(changed.data.result.actions[0].note, undefined); assert.equal(changed.data.result.actions[1].key, items[1].key); assert.notEqual(changed.data.result.actions[1].actionFingerprint, items[1].actionFingerprint);
  const stale = await f.request(`/runs/${saved.id}/action-items/${items[1].key}`, "PATCH", { expectedActionFingerprint: items[1].actionFingerprint, note: "旧窗口不应覆盖" }); assert.equal(stale.status, 409); assert.equal(stale.data.code, "ACTION_CHANGED");
  const current = (await f.request(`/runs/${saved.id}/action-items`)).data.items;
  const both = await Promise.all([0, 1].map(i => f.request(`/runs/${saved.id}/action-items/${current[i].key}`, "PATCH", { expectedActionFingerprint: current[i].actionFingerprint, note: "并发项" + i }))); assert.deepEqual(both.map(r => r.status), [200, 200]);
  const final = await f.store.get(saved.id, "agent-run"); assert.deepEqual(final.result.actions.slice(0, 2).map(a => a.note), ["并发项0", "并发项1"]); assert.deepEqual(final.raw, raw);
  assert.equal((await f.request(`/runs/${saved.id}/actions/dup`, "PATCH", { done: true })).status, 409); assert.equal((await f.request(`/runs/${saved.id}/actions/unique`, "PATCH", { done: true })).status, 200);
  await f.store.put("agent-run", { ...saved, id: "other-actions" }); assert.equal((await f.request(`/runs/other-actions/action-items/${items[0].key}`, "PATCH", { expectedActionFingerprint: items[0].actionFingerprint, done: true })).status, 404);
});

test("跨服务取消收回已完成上游trace/usage/version，仅披露未发布结果，不新调用模型", async t => {
  const entered = deferred(), release = deferred(); let creates = 0, cancelRequests = 0;
  const job = { id: "upstream-job", status: "completed", projectId: "remote-project", versionId: "remote-version", provider: "openai", usage: { inputTokens: 91, outputTokens: 17, requestCount: 1, cost: null }, modelTrace: { output: "saved upstream output" }, result: { code: "<html>upstream</html>" } };
  const remote = createServer(async (req, res) => { for await (const chunk of req) {} res.setHeader("Content-Type", "application/json"); const send = value => res.end(JSON.stringify(value));
    if (req.url === "/api/auth") return send({ authenticated: true });
    if (req.url === "/api/jobs" && req.method === "POST") { creates++; return send({ id: job.id }); }
    if (req.url === "/api/jobs/" + job.id + "/cancel") { cancelRequests++; res.statusCode = 409; return send({ error: "already publishing", code: "RUN_FINALIZING" }); }
    if (req.url === "/api/jobs/" + job.id) { entered.resolve(); await release.promise; return send(job); }
    res.statusCode = 404; send({ error: "unexpected route" });
  }); await new Promise(r => remote.listen(0, "127.0.0.1", r)); const previousUrl = process.env.FOUNDRY_URL; process.env.FOUNDRY_URL = "http://127.0.0.1:" + remote.address().port; t.after(async () => { release.resolve(); if (previousUrl === undefined) delete process.env.FOUNDRY_URL; else process.env.FOUNDRY_URL = previousUrl; await new Promise(r => remote.close(r)); });
  const f = await fixture(t); await f.store.put("agent-run", { id: "parent", projectId: f.project.id, kind: "research", status: "completed", sources: [], raw: { project: f.project }, result: { requirements: [{ id: "r", title: "待验证需求", description: "未知假设仍可探索", sourceIds: [], acceptance: [], basis: null }], claims: [], actions: [] }, events: [], createdAt: "2026-01-01" });
  const start = await f.request("/runs/parent/prototype", "POST", { requirementIndices: [0], prototypeMode: "new" }); assert.equal(start.status, 202); await entered.promise;
  assert.equal((await f.request(`/runs/${start.data.id}/cancel`, "POST")).status, 202); release.resolve(); const final = await f.wait(start.data.id);
  assert.equal(final.status, "cancelled"); assert.equal(final.result, null); assert.equal(final.prototype, undefined); assert.equal(final.usage.inputTokens, 91); assert.equal(final.raw.foundryReceipt.versionId, "remote-version"); assert.equal(final.cancellationRecovery.upstreamOutcome, "completed-after-cancel-request"); assert.equal(creates, 1); assert.equal(cancelRequests, 1);
  const compact = (await f.request("/bootstrap")).data.runs.find(r => r.id === start.data.id); assert.equal(compact.cancellationRecovery.versionId, "remote-version"); assert.equal(compact.raw, undefined);
});

test("上游取消收尾的新回执优先于旧error计量，returnedResult不因公开result为空丢失", async t => {
  let creates = 0, reads = 0;
  const remote = createServer(async (req, res) => { for await (const chunk of req) {} res.setHeader("Content-Type", "application/json"); const send = value => res.end(JSON.stringify(value));
    if (req.url === "/api/auth") return send({ authenticated: true });
    if (req.url === "/api/jobs" && req.method === "POST") { creates++; return send({ id: "cancelled-upstream" }); }
    if (req.url.endsWith("/cancel")) return send({ id: "cancelled-upstream", status: "running", cancellationPending: true });
    if (req.url === "/api/jobs/cancelled-upstream") { reads++; return send({ id: "cancelled-upstream", status: "cancelled", cancellationPending: reads === 1, result: null, returnedResult: reads > 1 ? { code: "<html>returned-but-not-published</html>" } : null, usage: { inputTokens: reads > 1 ? 73 : null, outputTokens: reads > 1 ? 9 : null, requestCount: 1, cost: null }, modelTrace: reads > 1 ? { output: "saved cancelled model output" } : null }); }
    res.statusCode = 404; send({ error: "unexpected" });
  }); await new Promise(r => remote.listen(0, "127.0.0.1", r)); const previousUrl = process.env.FOUNDRY_URL; process.env.FOUNDRY_URL = "http://127.0.0.1:" + remote.address().port; t.after(async () => { if (previousUrl === undefined) delete process.env.FOUNDRY_URL; else process.env.FOUNDRY_URL = previousUrl; await new Promise(r => remote.close(r)); });
  const f = await fixture(t); await f.store.put("agent-run", { id: "cancel-parent", projectId: f.project.id, kind: "research", status: "completed", sources: [], raw: { project: f.project }, result: { requirements: [{ id: "r", title: "探索需求", description: "验证上游取消计量", sourceIds: [], acceptance: [], basis: null }], claims: [], actions: [] }, events: [], createdAt: "2026-01-01" });
  const start = await f.request("/runs/cancel-parent/prototype", "POST", { requirementIndices: [0], prototypeMode: "new" }); assert.equal(start.status, 202); const final = await f.wait(start.data.id);
  assert.equal(final.result, null); assert.equal(final.prototype, undefined); assert.equal(final.usage.inputTokens, 73); assert.equal(final.raw.foundryReceipt.returnedResult.code, "<html>returned-but-not-published</html>"); assert.equal(final.raw.foundryReceipt.trace.output, "saved cancelled model output"); assert.equal(creates, 1); assert.equal(reads, 2);
});
