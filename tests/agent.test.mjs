import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../server/store.mjs";
import { createAgentRouter } from "../server/agent-router.mjs";
import { validateSourceUrl, forbiddenAddress } from "../server/evidence.mjs";
import JSZip from "jszip";

test("公开证据拒绝本机、保留地址和非 HTTPS", async () => {
  for (const url of ["http://github.com/x/y", "https://127.0.0.1/", "https://localhost/", "https://user:pass@example.com/"])
    await assert.rejects(validateSourceUrl(url));
  for (const ip of ["127.0.0.1", "10.2.3.4", "192.168.1.1", "169.254.1.1", "::1", "fc00::1"])
    assert.equal(forbiddenAddress(ip), true);
  assert.equal(forbiddenAddress("8.8.8.8"), false);
});

test("项目隔离、记忆纠正、云端边界与证据包", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yiban-agent-test-"));
  const store = await createStore(dir);
  const seen = [];
  const runner = async input => {
    seen.push(input);
    if (input.prompt.includes("等待取消"))
      await new Promise((resolve, reject) => input.signal.addEventListener("abort", () => reject(new Error("cancel")), { once: true }));
    return {
      answer: input.project.memory.map(x => x.text).join("；"),
      claims: [], requirements: [], actions: [], memoryUpdates: [],
      usage: { inputTokens: 17, outputTokens: 9, cost: null }, raw: { test: true }, engine: { name: "test-double" },
    };
  };
  const agent = await createAgentRouter({
    store, settings: async () => ({ provider: "codex" }), root: dir, cloud: true,
    runner, runtimeStatus: async () => ({ installed: true }),
  });
  // cloud mode prevents model execution, proving that an unavailable runtime cannot be disguised as success.
  const app = express(); app.use(express.json()); app.use("/api/agent", agent.router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api/agent";
  async function req(path, method = "GET", body) {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, data: await r.json() };
  }
  try {
    const p = (await req("/projects", "POST", { name: "项目甲", background: "这是甲项目的真实背景资料。", memory: [{ id: "m1", text: "团队两人", source: "用户确认" }] })).data;
    const q = (await req("/projects", "POST", { name: "项目乙", background: "这是乙项目的独立背景资料。" })).data;
    assert.notEqual(p.id, q.id);
    assert.equal(await store.get(p.id, "agent-run"), null);
    assert.equal((await req("/projects/" + p.id, "PATCH", { memory: [{ id: "m1", text: "团队一人", source: "用户纠正" }] })).status, 200);
    assert.equal((await req("/runs", "POST", { projectId: p.id, prompt: "请回忆当前项目的团队规模", kind: "recall" })).status, 409);
    assert.equal(seen.length, 0);
    const recordPath = join(dir, ".runtime/records/project/model-call.json");
    const callDir = join(dir, ".runtime/records/project/model-call/call-1");
    await mkdir(callDir, { recursive: true });
    await writeFile(recordPath, JSON.stringify({ status: "completed" }));
    await writeFile(join(callDir, "prompt.txt"), "可复现的已记录提示");
    await writeFile(join(callDir, ".env"), "DO_NOT_EXPORT");
    await store.put("agent-run", { id: "saved-run", projectId: p.id, status: "completed", result: { answer: "有依据的交付物", actions: [{ id: "a", title: "核实来源", done: false }] }, sources: [{ id: "s", raw: "源正文", text: "源正文", sha256: "hash", url: "https://example.com" }], events: [], usage: { inputTokens: 17, cost: null }, raw: { model: { recordPath } } });
    assert.equal((await req("/runs/saved-run/actions/a", "PATCH", { done: true })).data.result.actions[0].done, true);
    assert.equal((await req("/runs/saved-run/actions/missing", "PATCH", { done: true })).status, 404);
    const archive = await fetch(base + "/runs/saved-run/export");
    const zip = await JSZip.loadAsync(await archive.arrayBuffer());
    assert.equal(await zip.file("evidence/s.txt").async("string"), "源正文");
    assert.ok(zip.file("usage.json"));
    assert.equal(await zip.file("model/call-1/prompt.txt").async("string"), "可复现的已记录提示");
    assert.ok(zip.file("model/record.json"));
    assert.equal(zip.file("model/call-1/.env"), null);
    const saved = await store.get("saved-run", "agent-run");
    saved.raw.model.recordPath = join(dir, "outside.json");
    await writeFile(saved.raw.model.recordPath, "DO_NOT_EXPORT");
    await store.put("agent-run", saved);
    const outside = await JSZip.loadAsync(await (await fetch(base + "/runs/saved-run/export")).arrayBuffer());
    assert.equal(outside.file("model/record.json"), null);
    assert.equal((await req("/runs/" + q.id)).status, 404);
  } finally {
    agent.shutdown(); await new Promise(resolve => server.close(resolve)); store.close(); await rm(dir, { recursive: true, force: true });
  }
});

test("本机回忆使用纠正记忆、幂等提交不重复执行、取消保留记录", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yiban-local-test-"));
  await writeFile(join(dir, "README.md"), "已有项目的真实背景，足够建立初始档案。");
  const store = await createStore(dir);
  const seen = [];
  const agent = await createAgentRouter({
    store, settings: async () => ({ provider: "codex" }), root: dir, cloud: false,
    runtimeStatus: async () => ({ installed: true }),
    runner: async input => {
      seen.push(input);
      if (input.prompt.includes("等待取消"))
        await new Promise((resolve, reject) => input.signal.addEventListener("abort", () => reject(new Error("cancel")), { once: true }));
      return { answer: input.project.memory.map(m => m.text).join(""), claims: [], requirements: [], actions: [], memoryUpdates: [], usage: { inputTokens: 4, outputTokens: 2, cost: null }, raw: { measured: false }, engine: { name: "test-double" } };
    },
  });
  const app = express(); app.use(express.json()); app.use(agent.router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const request = async (path, method = "GET", body, key) => {
    const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  const wait = async id => {
    for (let i = 0; i < 40; i++) {
      const r = (await request("/runs/" + id)).data;
      if (!["queued", "running"].includes(r.status)) return r;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error("did not settle");
  };
  try {
    const p = (await request("/projects", "POST", { name: "独立项目", background: "这里是独立项目的背景资料。", memory: [{ id: "m1", text: "团队有两人", source: "用户纠正" }] })).data;
    const body = { projectId: p.id, kind: "recall", prompt: "请回忆这个项目的团队规模" };
    const created = (await request("/runs", "POST", body, "same-request")).data;
    const duplicate = (await request("/runs", "POST", body, "same-request")).data;
    assert.equal(duplicate.id, created.id);
    const completed = await wait(created.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.result.answer, "团队有两人");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].history.length, 0);
    assert.equal((await request("/runs", "POST", { ...body, prompt: "这是不同的任务内容" }, "same-request")).status, 409);
    const pending = (await request("/runs", "POST", { ...body, prompt: "等待取消的研究任务" })).data;
    assert.equal((await request("/projects/" + p.id, "PATCH", { background: "执行时更改上下文会被拒绝。" })).status, 409);
    await request("/runs/" + pending.id + "/cancel", "POST");
    const cancelled = await wait(pending.id);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.raw.project.id, p.id);
    assert.ok(cancelled.events.length);
  } finally {
    agent.shutdown(); await new Promise(resolve => server.close(resolve)); store.close(); await rm(dir, { recursive: true, force: true });
  }
});
