import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const TYPE = "personal-space";
const final = new Set(["completed", "failed", "cancelled"]);
const messageSchema = z
  .object({
    text: z.string().trim().min(5).max(8000),
    kind: z.enum(["research", "recall"]).default("research"),
  })
  .strict();
const routineSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    prompt: z.string().trim().min(5).max(6000),
    intervalMinutes: z.number().int().min(60).max(10080),
    maxExecutions: z.number().int().min(1).max(10),
  })
  .strict();

// All state transitions share one process-local serial writer. Scheduling is intentionally
// single-process; a deployment with multiple replicas needs a distributed lease.
export function createPersonalAgent({
  store,
  project,
  start,
  cloud,
  clock = () => Date.now(),
  intervalMs = 2000,
}) {
  const router = express.Router();
  let tail = Promise.resolve(),
    stopped = false;
  const serial = (fn) => {
    const work = tail.then(fn);
    tail = work.catch(() => {});
    return work;
  };
  const timestamp = () => new Date(clock()).toISOString();
  async function load(projectId) {
    await project(projectId);
    return (
      (await store.get(`personal-${projectId}`, TYPE)) || {
        id: `personal-${projectId}`,
        projectId,
        sessionId: randomUUID(),
        goals: [],
        tasks: [],
        routines: [],
        createdAt: timestamp(),
      }
    );
  }
  const save = (space) => store.put(TYPE, { ...space, updatedAt: timestamp() });
  const enqueue = (space, text, kind, routineId = null) => {
    if (
      space.tasks.filter((t) =>
        ["queued", "starting", "running"].includes(t.status),
      ).length >= 10
    )
      throw Object.assign(
        new Error("待执行委托已达到 10 条，请先处理或取消。"),
        { status: 409 },
      );
    const task = {
      id: randomUUID(),
      text,
      kind,
      routineId,
      status: "queued",
      createdAt: timestamp(),
      runId: null,
      seen: false,
    };
    space.tasks.push(task);
    return task;
  };
  async function hydrate(space) {
    const runs = await store.list("agent-run");
    return {
      ...space,
      tasks: space.tasks.map((task) => {
        const run = runs.find(
          (r) =>
            r.id === task.runId || r.idempotencyKey === `personal-${task.id}`,
        );
        return run
          ? {
              ...task,
              runId: run.id,
              status: run.status,
              stage: run.stage,
              answer: run.result?.answer || "",
              error: run.error,
              usage: run.usage,
              sources: (run.sources || []).map((s) => ({
                id: s.id,
                url: s.url,
                title: s.title,
              })),
            }
          : task;
      }),
      capabilities: {
        execution: cloud ? "unavailable" : "local-server",
        cloudAlwaysOn: false,
        externalWrites: false,
        memoryRequiresConfirmation: true,
      },
    };
  }
  router.get("/:projectId", async (req, res) =>
    res.json(await hydrate(await load(req.params.projectId))),
  );
  function mutation(path, method, handler) {
    router[method](path, async (req, res) => {
      if (cloud)
        throw Object.assign(
          new Error("个人委托需要运行本机服务，静态演示不执行任务。"),
          { status: 409 },
        );
      res.json(
        await serial(async () => {
          const space = await load(req.params.projectId);
          const result = await handler(space, req);
          await save(space);
          return result;
        }),
      );
    });
  }
  mutation("/:projectId/messages", "post", async (space, req) => {
    const input = messageSchema.parse(req.body);
    return enqueue(space, input.text, input.kind);
  });
  mutation("/:projectId/goals", "post", async (space, req) => {
    const { text } = z
      .object({ text: z.string().trim().min(2).max(1000) })
      .strict()
      .parse(req.body);
    if (space.goals.filter((g) => !g.done).length >= 20)
      throw new Error("最多保留 20 个未完成目标。");
    const goal = {
      id: randomUUID(),
      text,
      done: false,
      createdAt: timestamp(),
    };
    space.goals.push(goal);
    return goal;
  });
  mutation("/:projectId/goals/:id", "patch", async (space, req) => {
    const { done } = z.object({ done: z.boolean() }).strict().parse(req.body);
    const goal = space.goals.find((g) => g.id === req.params.id);
    if (!goal) throw Object.assign(new Error("目标不存在。"), { status: 404 });
    goal.done = done;
    return goal;
  });
  mutation("/:projectId/routines", "post", async (space, req) => {
    const input = routineSchema.parse(req.body);
    if (space.routines.filter((r) => r.enabled).length >= 5)
      throw new Error("最多启用 5 个定期任务。");
    const routine = {
      ...input,
      id: randomUUID(),
      enabled: true,
      executions: 0,
      nextAt: new Date(clock() + input.intervalMinutes * 60000).toISOString(),
      createdAt: timestamp(),
    };
    space.routines.push(routine);
    return routine;
  });
  mutation("/:projectId/routines/:id", "patch", async (space, req) => {
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(req.body);
    const routine = space.routines.find((r) => r.id === req.params.id);
    if (!routine)
      throw Object.assign(new Error("定期任务不存在。"), { status: 404 });
    if (enabled && routine.executions >= routine.maxExecutions)
      throw new Error("已到达执行上限，请重新创建任务并授权次数。");
    if (
      enabled &&
      !routine.enabled &&
      space.routines.filter((r) => r.enabled).length >= 5
    )
      throw new Error("最多启用 5 个定期任务。");
    routine.enabled = enabled;
    if (enabled)
      routine.nextAt = new Date(
        clock() + routine.intervalMinutes * 60000,
      ).toISOString();
    return routine;
  });
  mutation("/:projectId/tasks/:id", "patch", async (space, req) => {
    const input = z
      .object({
        seen: z.boolean().optional(),
        cancel: z.literal(true).optional(),
      })
      .strict()
      .parse(req.body);
    const task = space.tasks.find((t) => t.id === req.params.id);
    if (!task) throw Object.assign(new Error("委托不存在。"), { status: 404 });
    if (input.cancel) {
      if (task.runId || task.status !== "queued")
        throw Object.assign(new Error("已开始执行，请在运行详情中取消。"), {
          status: 409,
        });
      task.status = "cancelled";
      task.finishedAt = timestamp();
    }
    if (input.seen !== undefined) task.seen = input.seen;
    return task;
  });
  async function tick() {
    if (stopped || cloud) return;
    return serial(async () => {
      for (const old of await store.list(TYPE)) {
        if (stopped) return;
        const space = await load(old.projectId);
        const before = JSON.stringify(space);
        const runs = await store.list("agent-run");
        for (const task of space.tasks) {
          const run = runs.find(
            (r) =>
              r.id === task.runId || r.idempotencyKey === `personal-${task.id}`,
          );
          if (run) {
            task.runId = run.id;
            task.status = run.status;
            if (final.has(run.status))
              task.finishedAt =
                run.completedAt || task.finishedAt || timestamp();
          }
        }
        for (const routine of space.routines) {
          if (
            !routine.enabled ||
            routine.executions >= routine.maxExecutions ||
            Date.parse(routine.nextAt) > clock()
          )
            continue;
          if (
            space.tasks.some(
              (t) => t.routineId === routine.id && !final.has(t.status),
            )
          )
            continue;
          if (space.tasks.filter((t) => !final.has(t.status)).length >= 10)
            continue;
          enqueue(space, routine.prompt, "research", routine.id);
          routine.executions++;
          routine.nextAt = new Date(
            clock() + routine.intervalMinutes * 60000,
          ).toISOString();
          if (routine.executions >= routine.maxExecutions)
            routine.enabled = false;
        }
        // Persist changes before model calls without rewriting idle spaces on every tick.
        if (JSON.stringify(space) !== before) await save(space);
        const task = space.tasks.find(
          (t) => t.status === "queued" || t.status === "starting",
        );
        if (!task) continue;
        task.status = "starting";
        await save(space);
        try {
          const recent = space.tasks
            .filter((t) => t.runId && final.has(t.status))
            .slice(-3)
            .map((t) => {
              const run = runs.find((r) => r.id === t.runId);
              return {
                user: t.text.slice(0, 200),
                status: t.status,
                answer: run?.result?.answer?.slice(0, 400) || "",
                runId: t.runId,
              };
            });
          const context = JSON.stringify({
            currentServiceCapabilities: {
              version: "0.6.0",
              authority:
                "服务代码提供的当前能力声明，优先于旧项目背景的能力描述；不等于任务成功或效果证明",
              execution:
                "本机 Node 服务队列通过真实 nanobot 执行研究/记忆回顾，关闭页面仍可执行，关机或停服务停止",
              routines:
                "用户显式启用的有限次数定期研究，最小间隔60分钟，最多10次，暂停仅阻止后续排队，不会补跑漏掉的轮次",
              tools:
                "研究模型没有电脑操作工具，不能发送邮件、修改外部应用、购买或自动部署；原型需在详情中显式调用造物",
              memory: "读取当前项目的用户确认记忆；候选记忆不会自动写入",
              cost: "只记录提供方实际报告的用量，未知现金费用不能换算成零",
            },
            contextLimits:
              "目标为每条前40字，最近两次委托及交付为截断摘要；完整内容保存在个人空间和运行详情",
            confirmedGoals: space.goals
              .filter((g) => !g.done)
              .map((g) => g.text.slice(0, 40)),
            recentConversation: recent.slice(-2),
          });
          const run = await start(
            {
              projectId: space.projectId,
              kind: task.kind,
              sessionId: space.sessionId,
              prompt: `${task.text}\n\n个人委托上下文（历史结论不能作为新的事实来源，目标不是已完成成果）：\n${context}`,
            },
            {
              get: (name) =>
                name === "Idempotency-Key" ? `personal-${task.id}` : undefined,
            },
            task.text,
          );
          task.runId = run.id;
          task.status = run.status;
        } catch (error) {
          if (error.status === 409 && /已有任务|幂等请求/.test(error.message))
            task.status = "queued";
          else {
            task.status = "failed";
            task.error = error.message;
            task.finishedAt = timestamp();
          }
        }
        await save(space);
      }
    });
  }
  const timer = setInterval(() => {
    void tick().catch((error) =>
      console.error("Personal queue:", error.message),
    );
  }, intervalMs);
  timer.unref();
  return {
    router,
    tick,
    shutdown() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
