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
const plan = (action, extra = {}) => ({
  action,
  prompt: "回顾项目进展并总结下一步",
  targetId: null,
  intervalMinutes: null,
  maxExecutions: null,
  reply: "我理解了这项委托。",
  ...extra,
});
async function planned(t, plans) {
  const inputs = [];
  const f = await fixture(t, {
    planner: async (input) => {
      inputs.push(JSON.parse(input.prompt));
      return {
        plan: plans.shift(),
        usage: { inputTokens: 7, outputTokens: 3, cost: null },
        raw: { recordPath: "private-record", input: "private-prompt" },
      };
    },
  });
  const chat = async (text) => {
    const task = (await f.request("/chat", "POST", { text })).data;
    await f.tick();
    for (let i = 0; i < 30; i++) {
      const latest = (await f.request()).data.tasks.find(
        (x) => x.id === task.id,
      );
      if (latest.status !== "planning") return latest;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("Planner did not finish");
  };
  return { ...f, chat, inputs };
}
test("自然语言自动路由回顾，任务理解和执行分别计量，私人提示不泄露", async (t) => {
  const f = await planned(t, [plan("recall")]);
  const task = await f.chat("结合我的项目，安排本周工作");
  assert.equal(task.kind, "recall");
  assert.equal(task.status, "queued");
  assert.equal(task.planningUsage.cost, null);
  assert.equal(task.planningRaw, undefined);
  await f.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].kind, "recall");
});
test("对话保存目标、跟进需范围授权，确认不新增理解调用，暂停立即生效", async (t) => {
  const f = await planned(t, [
    plan("goal", { prompt: "沉淀可检查的产品作品" }),
    plan("routine", { intervalMinutes: 1440, maxExecutions: 3 }),
    plan("pause", { targetId: "all" }),
  ]);
  await f.chat("帮我把沉淀可检查的产品作品记为长期目标");
  assert.equal((await f.request()).data.goals.length, 1);
  const proposed = await f.chat("每天回顾项目进展，最多三次");
  assert.match(proposed.answer, /确认跟进/);
  assert.equal((await f.request()).data.routines.length, 0);
  const confirmed = await f.chat("确认跟进");
  assert.match(confirmed.answer, /已启用/);
  assert.equal(f.inputs.length, 2);
  const routine = (await f.request()).data.routines[0];
  assert.equal(routine.maxExecutions, 3);
  assert.equal(routine.kind, "chat");
  await f.chat("把所有跟进都暂停");
  assert.equal((await f.request()).data.routines[0].enabled, false);
  f.advance(86400000);
  await f.tick();
  assert.equal(f.calls.length, 0);
});
test("不完整跟进追问，补充次数沿用上文，过期授权和无关消息不启用", async (t) => {
  const f = await planned(t, [
    plan("routine", { intervalMinutes: 1440 }),
    plan("routine", { intervalMinutes: 1440, maxExecutions: 2 }),
  ]);
  assert.match((await f.chat("每天跟进项目进展")).answer, /次数/);
  assert.match((await f.chat("最多两次")).answer, /确认跟进/);
  f.advance(600001);
  assert.match((await f.chat("确认跟进")).answer, /过期/);
  assert.equal((await f.request()).data.routines.length, 0);
});
test("模型伪造目标授权、跨项目原型ID、非法参数都不能触发写入或执行", async (t) => {
  const f = await planned(t, [
    plan("goal"),
    plan("prototype", { targetId: "other-project" }),
    plan("routine", { intervalMinutes: 1, maxExecutions: 999 }),
    plan("unsupported", { reply: "邮件服务尚未接入。" }),
  ]);
  await f.chat("帮我总结这个产品");
  assert.equal((await f.request()).data.goals.length, 0);
  assert.equal((await f.chat("做一个原型")).status, "failed");
  assert.equal((await f.chat("每天跟进一次，最多999次")).status, "failed");
  assert.match((await f.chat("替我发邮件")).answer, /尚未接入/);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request()).data.routines.length, 0);
});
test("理解期间可读取、可取消；迟到的模型结果不能再保存目标", async (t) => {
  let finish;
  const f = await fixture(t, {
    planner: () => new Promise((r) => (finish = r)),
  });
  const task = (
    await f.request("/chat", "POST", { text: "请把测试取消记为我的目标" })
  ).data;
  await f.tick();
  assert.equal((await f.request()).data.tasks[0].status, "planning");
  await f.request(`/tasks/${task.id}`, "PATCH", { cancel: true });
  finish({
    plan: plan("goal", { prompt: "测试取消" }),
    usage: { inputTokens: 9, cost: null },
  });
  await new Promise((r) => setTimeout(r, 15));
  const saved = (await f.request()).data;
  assert.equal(saved.tasks[0].status, "cancelled");
  assert.equal(saved.goals.length, 0);
  assert.equal(saved.tasks[0].planningUsage.inputTokens, 9);
});
test("原型请求关联已有本项目需求，进入真实造物路径且不会重新研究", async (t) => {
  const f = await planned(t, [
    plan("prototype", {
      targetId: "parent",
      prompt: "基于这一份需求生成交互原型",
    }),
  ]);
  await f.store.put("agent-run", {
    id: "parent",
    projectId: "p",
    kind: "research",
    status: "completed",
    prompt: "研究产品",
    result: { requirements: [{ title: "需求" }] },
  });
  const task = await f.chat("根据已有需求生成一个原型");
  assert.equal(task.kind, "prototype");
  await f.tick();
  assert.equal(f.calls[0].kind, "prototype");
  assert.equal(f.calls[0].parentRunId, "parent");
  assert.equal(f.calls[0].prototypeMode, "new");
});

test("明确目标和全量暂停直接执行，不消费理解模型", async (t) => {
  let count = 0;
  const f = await fixture(t, {
    planner: async () => {
      count++;
      throw new Error("不应调用");
    },
  });
  const goal = await f.request("/chat", "POST", {
    text: "记住我的目标：沉淀产品作品",
  });
  assert.equal(goal.data.status, "completed");
  assert.equal((await f.request()).data.goals[0].text, "沉淀产品作品");
  const r = (
    await f.request("/routines", "POST", {
      title: "回顾",
      prompt: "回顾项目进展",
      intervalMinutes: 60,
      maxExecutions: 2,
    })
  ).data;
  const paused = await f.request("/chat", "POST", { text: "暂停全部跟进" });
  assert.equal(paused.data.status, "completed");
  assert.equal(
    (await f.request()).data.routines.find((x) => x.id === r.id).enabled,
    false,
  );
  await f.tick();
  assert.equal(count, 0);
  assert.equal(f.calls.length, 0);
});

test("待执行队列满仍可暂停跟进，无关目标消息撤销待确认授权", async (t) => {
  const f = await planned(t, [
    plan("routine", { intervalMinutes: 1440, maxExecutions: 2 }),
  ]);
  await f.chat("每天回顾项目进展，最多两次");
  assert.ok((await f.request()).data.pendingApproval);
  await f.request("/chat", "POST", { text: "记住我的目标：验证完整作品" });
  assert.equal((await f.request()).data.pendingApproval, undefined);
  await f.request("/routines", "POST", {
    title: "跟进",
    prompt: "回顾项目背景",
    intervalMinutes: 60,
    maxExecutions: 2,
  });
  for (let i = 0; i < 10; i++)
    await f.request("/messages", "POST", { text: "排队研究编号" + i });
  assert.equal(
    (await f.request("/messages", "POST", { text: "队列已满的委托" })).status,
    409,
  );
  assert.equal(
    (await f.request("/chat", "POST", { text: "暂停全部跟进" })).status,
    200,
  );
  assert.equal((await f.request()).data.routines[0].enabled, false);
});
