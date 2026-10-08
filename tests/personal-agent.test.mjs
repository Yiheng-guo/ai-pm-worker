import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createPersonalAgent } from "../server/personal-agent.mjs";
async function fixture(t, overrides = {}) {
  const rows = new Map();
  let now = Date.parse("2026-10-08T00:00:00Z");
  const calls = [];
  const store = {
    async get(id, type) {
      return structuredClone(rows.get(type + id) || null);
    },
    async put(type, row) {
      rows.set(type + row.id, structuredClone(row));
      return row;
    },
    async list(type) {
      return [...rows.entries()]
        .filter(([k]) => k.startsWith(type))
        .map(([, v]) => structuredClone(v));
    },
  };
  const start = async (body, req) => {
    calls.push(body);
    const run = {
      id: "run" + calls.length,
      ...body,
      status: "running",
      idempotencyKey: req.get("Idempotency-Key"),
    };
    await store.put("agent-run", run);
    return run;
  };
  const options = {
    store,
    project: async (id) => {
      if (id !== "p")
        throw Object.assign(new Error("missing"), { status: 404 });
    },
    start,
    clock: () => now,
    intervalMs: 100000,
    ...overrides,
  };
  const agent = createPersonalAgent(options);
  const app = express();
  app.use(express.json());
  app.use(agent.router);
  app.use((e, req, res, next) =>
    res.status(e.status || 400).json({ error: e.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    agent.shutdown();
    await new Promise((r) => server.close(r));
  });
  const request = async (path = "", method = "GET", body) => {
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/p${path}`,
      {
        method,
        headers: { "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    return { status: res.status, data: await res.json() };
  };
  return {
    request,
    store,
    calls,
    tick: agent.tick,
    advance: (ms) => (now += ms),
    stop: agent.shutdown,
  };
}
test("委托与目标持久化，跨读取保留，上下文不超长，真实调用只发起一次", async (t) => {
  const f = await fixture(t);
  await f.request("/goals", "POST", { text: "完成真实可检查的作品" });
  const task = (
    await f.request("/messages", "POST", {
      text: "请回顾已经确认的项目背景",
      kind: "recall",
    })
  ).data;
  assert.equal((await f.request()).data.tasks[0].id, task.id);
  await Promise.all([f.tick(), f.tick()]);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].prompt, /完成真实可检查的作品/);
  const run = (await f.store.list("agent-run"))[0];
  run.status = "completed";
  run.result = { answer: "实际执行器返回的结果" };
  run.usage = { inputTokens: 19, cost: null };
  await f.store.put("agent-run", run);
  const result = (await f.request()).data.tasks[0];
  assert.equal(result.answer, "实际执行器返回的结果");
  assert.equal(result.usage.cost, null);
  await f.request(`/tasks/${task.id}`, "PATCH", { seen: true });
  assert.equal((await f.request()).data.tasks[0].seen, true);
});
test("定期授权有限次，未完成不叠加，断线不补跑，暂停不误取消已有任务", async (t) => {
  const f = await fixture(t);
  const r = (
    await f.request("/routines", "POST", {
      title: "周度检查",
      prompt: "检查项目的待办进展",
      intervalMinutes: 60,
      maxExecutions: 2,
    })
  ).data;
  await f.tick();
  assert.equal(f.calls.length, 0);
  f.advance(3600000);
  await f.tick();
  assert.equal(f.calls.length, 1);
  f.advance(3600000 * 20);
  await f.tick();
  assert.equal(f.calls.length, 1);
  const run = (await f.store.list("agent-run"))[0];
  run.status = "completed";
  await f.store.put("agent-run", run);
  await f.tick();
  assert.equal(f.calls.length, 2);
  const saved = (await f.request()).data.routines[0];
  assert.equal(saved.executions, 2);
  assert.equal(saved.enabled, false);
  assert.equal(
    (await f.request(`/routines/${r.id}`, "PATCH", { enabled: true })).status,
    400,
  );
  f.advance(3600000 * 20);
  await f.tick();
  assert.equal(f.calls.length, 2);
});
test("排队取消不会调用模型，繁忙重试不会把失败伪装成功", async (t) => {
  const f = await fixture(t, {
    start: async () => {
      throw Object.assign(new Error("已有任务执行或修改中"), { status: 409 });
    },
  });
  const a = (await f.request("/messages", "POST", { text: "一条可取消的委托" }))
    .data;
  await f.request(`/tasks/${a.id}`, "PATCH", { cancel: true });
  await f.tick();
  assert.equal((await f.request()).data.tasks[0].status, "cancelled");
  await f.request("/messages", "POST", { text: "等前一个任务完成再执行" });
  await f.tick();
  assert.equal((await f.request()).data.tasks[1].status, "queued");
});
test("永久失败可见，越权字段和静态云端执行被拒绝", async (t) => {
  const f = await fixture(t, {
    start: async () => {
      throw new Error("授权未就绪");
    },
  });
  await f.request("/messages", "POST", { text: "执行一次真实模型委托" });
  await f.tick();
  assert.equal((await f.request()).data.tasks[0].error, "授权未就绪");
  assert.equal(
    (
      await f.request("/messages", "POST", {
        text: "不要隐式执行外部写入",
        sendEmail: true,
      })
    ).status,
    400,
  );
  const cloud = await fixture(t, { cloud: true });
  assert.equal(
    (await cloud.request("/messages", "POST", { text: "静态托管不能执行模型" }))
      .status,
    409,
  );
});
test("消息并发不丢写，旧进程starting通过幂等键找回已有运行", async (t) => {
  const f = await fixture(t);
  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      f.request("/messages", "POST", { text: "并发委托编号" + i }),
    ),
  );
  assert.equal((await f.request()).data.tasks.length, 5);
  await f.tick();
  const space = (await f.store.list("personal-space"))[0];
  space.tasks[0].status = "starting";
  space.tasks[0].runId = null;
  await f.store.put("personal-space", space);
  await f.tick();
  assert.equal(f.calls.length, 2);
  assert.equal((await f.request()).data.tasks[0].runId, "run1");
});
test("满额目标和长历史仍满足运行器提示长度，能力声明不继承旧背景", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 20; i++)
    await f.request("/goals", "POST", { text: String(i) + "目标".repeat(490) });
  for (let i = 0; i < 2; i++) {
    await f.request("/messages", "POST", { text: "历史".repeat(4000) });
    await f.tick();
    const run = (await f.store.list("agent-run")).at(-1);
    run.status = "completed";
    run.result = { answer: "旧内容".repeat(3000) };
    await f.store.put("agent-run", run);
  }
  await f.request("/messages", "POST", { text: "新任务".repeat(2666) });
  await f.tick();
  const prompt = f.calls.at(-1).prompt;
  assert.ok(prompt.length <= 12000, String(prompt.length));
  assert.match(prompt, /currentServiceCapabilities/);
  assert.match(prompt, /有限次数/);
});
test("完成时间固定，空闲轮询不把已结束委托写成新的完成时间", async (t) => {
  const f = await fixture(t);
  await f.request("/messages", "POST", { text: "验证固定的完成时间" });
  await f.tick();
  const run = (await f.store.list("agent-run"))[0];
  run.status = "completed";
  run.completedAt = "2026-10-08T00:01:00Z";
  await f.store.put("agent-run", run);
  await f.tick();
  const before = (await f.store.list("personal-space"))[0];
  f.advance(3600000);
  await f.tick();
  const after = (await f.store.list("personal-space"))[0];
  assert.equal(after.tasks[0].finishedAt, run.completedAt);
  assert.deepEqual(after, before);
});
