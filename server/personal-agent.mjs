import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const TYPE = "personal-space";
const final = new Set(["completed", "failed", "cancelled"]);
const messageSchema = z
  .object({
    text: z.string().trim().min(1).max(8000),
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
  planner,
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
  const planning = new Map();
  const recovery = (async () => {
    for (const space of await store.list(TYPE)) {
      let changed = false;
      for (const task of space.tasks || [])
        if (task.status === "planning") {
          task.status = "failed";
          task.error = "服务重启中断了任务理解，请重新发送；已有记录保留。";
          changed = true;
        }
      if (changed) await store.put(TYPE, space);
    }
  })();
  const timestamp = () => new Date(clock()).toISOString();
  async function load(projectId) {
    await recovery;
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
  const enqueue = (space, text, kind, routineId = null, control = false) => {
    if (
      !control &&
      space.tasks.filter((t) =>
        ["queued", "starting", "planning", "running"].includes(t.status),
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
      tasks: space.tasks.map(({ planningRaw, ...task }) => {
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
              prototype: run.prototype
                ? { title: run.prototype.title, version: run.prototype.version }
                : undefined,
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
  const planSchema = z
    .object({
      action: z.enum([
        "research",
        "recall",
        "goal",
        "routine",
        "pause",
        "resume",
        "status",
        "prototype",
        "clarify",
        "unsupported",
      ]),
      prompt: z.string().max(6000),
      targetId: z.string().nullable(),
      intervalMinutes: z.number().int().min(60).max(10080).nullable(),
      maxExecutions: z.number().int().min(1).max(10).nullable(),
      reply: z.string().min(1).max(2000),
    })
    .strict();
  function complete(task, answer) {
    task.status = "completed";
    task.answer = answer;
    task.finishedAt = timestamp();
  }
  function createRoutine(space, input) {
    if (space.routines.filter((r) => r.enabled).length >= 5)
      throw new Error("最多启用 5 个定期任务。");
    const routine = {
      ...routineSchema.parse(input),
      id: randomUUID(),
      enabled: true,
      executions: 0,
      nextAt: new Date(clock() + input.intervalMinutes * 60000).toISOString(),
      createdAt: timestamp(),
    };
    space.routines.push(routine);
    return routine;
  }
  function applyPlan(space, task, plan) {
    task.intent = plan.action;
    switch (plan.action) {
      case "research":
      case "recall":
        if (plan.prompt.trim().length < 5)
          return complete(task, "请补充你希望我完成的具体事情。");
        task.kind = plan.action;
        task.executionPrompt = plan.prompt;
        task.status = "queued";
        task.answer = plan.reply + "\n\n已进入执行队列，进展和结果会回到这里。";
        break;
      case "goal": {
        if (!/目标|记住|记下|记录|remember|goal/i.test(task.text))
          return complete(
            task,
            "你要把这句话保存为长期目标吗？请说“记住我的目标：…”。",
          );
        const text = plan.prompt.trim();
        if (text.length < 2 || text.length > 1000)
          return complete(task, "请给我一个不超过 1000 字的明确目标。");
        if (space.goals.some((g) => !g.done && g.text === text))
          return complete(task, "这个目标已经保存，不会重复添加。");
        if (space.goals.filter((g) => !g.done).length >= 20)
          throw new Error("最多保留 20 个未完成目标。");
        space.goals.push({
          id: randomUUID(),
          text,
          done: false,
          createdAt: timestamp(),
        });
        complete(task, "已保存长期目标：**" + text + "**。后续委托会读取它。");
        break;
      }
      case "routine": {
        if (
          !/每|定期|跟进|every|regular|follow.?up/i.test(
            task.authorizationText || task.text,
          )
        )
          return complete(
            task,
            "请明确你是否要启用定期研究，以及间隔和总次数。",
          );
        if (
          !plan.intervalMinutes ||
          !plan.maxExecutions ||
          plan.prompt.trim().length < 5
        ) {
          complete(
            task,
            "定期研究还需要" +
              (!plan.intervalMinutes ? "间隔（例如每天）" : "") +
              (!plan.maxExecutions ? "、最多执行次数（1–10 次）" : "") +
              "。告诉我这些参数，我再展示执行范围。不会默认无限调用。",
          );
          break;
        }
        const input = {
          title: plan.prompt.slice(0, 80),
          prompt: plan.prompt,
          intervalMinutes: plan.intervalMinutes,
          maxExecutions: plan.maxExecutions,
        };
        space.pendingApproval = {
          taskId: task.id,
          input,
          expiresAt: new Date(clock() + 600000).toISOString(),
        };
        complete(
          task,
          `我准备每 ${plan.intervalMinutes / 60} 小时执行一次，最多 ${plan.maxExecutions} 次：\n\n${plan.prompt}\n\n首次在一个间隔后执行；需要本机服务持续运行，每次可能消耗模型额度。回复“确认跟进”启用，或“取消跟进”放弃（10 分钟内有效）。`,
        );
        break;
      }
      case "pause":
      case "resume": {
        const verb = plan.action === "pause" ? "暂停" : "恢复";
        if (
          !(
            plan.action === "pause"
              ? /暂停|停止|别再|不要再|pause|stop/i
              : /恢复|继续|resume/i
          ).test(task.text)
        )
          return complete(task, `请明确说要${verb}哪个跟进。`);
        const matches =
          plan.targetId === "all" && /全部|所有|all/i.test(task.text)
            ? space.routines
            : space.routines.filter((r) => r.id === plan.targetId);
        if (!matches.length)
          return complete(task, "没有找到明确的跟进对象，请告诉我名称。");
        if (
          plan.action === "resume" &&
          matches.some((r) => r.executions >= r.maxExecutions)
        )
          return complete(
            task,
            "其中有跟进已达到授权次数上限，不能继续；请重新指定次数建立跟进。",
          );
        if (
          plan.action === "resume" &&
          space.routines.filter((r) => r.enabled || matches.includes(r))
            .length > 5
        )
          throw new Error("最多启用 5 个定期任务。");
        for (const r of matches) {
          r.enabled = plan.action === "resume";
          if (r.enabled)
            r.nextAt = new Date(
              clock() + r.intervalMinutes * 60000,
            ).toISOString();
        }
        complete(
          task,
          `已${verb} ${matches.length} 个跟进。` +
            (plan.action === "pause"
              ? "已排队或执行中的任务仍会继续；需要取消时在任务详情操作。"
              : "下次从当前时间起按间隔计时。"),
        );
        break;
      }
      case "status":
        complete(
          task,
          `当前有 ${space.goals.filter((g) => !g.done).length} 个长期目标、${space.routines.filter((r) => r.enabled).length} 个启用的跟进。\n\n` +
            space.goals
              .filter((g) => !g.done)
              .map((g) => "- 目标：" + g.text)
              .join("\n") +
            "\n" +
            space.routines
              .map(
                (r) =>
                  `- ${r.title}：${r.enabled ? "启用" : "暂停/已到上限"}，${r.executions}/${r.maxExecutions} 次`,
              )
              .join("\n"),
        );
        break;
      case "prototype":
        task.kind = "prototype";
        task.parentRunId = plan.targetId;
        task.executionPrompt =
          plan.prompt || "根据已有研究需求生成一个中文交互原型";
        task.status = "queued";
        task.answer =
          "正在检查已有研究需求，再交给造物生成原型；不会自动对外发布。";
        break;
      default:
        complete(task, plan.reply);
    }
  }
  mutation("/:projectId/chat", "post", async (space, req) => {
    const { text } = z
      .object({ text: z.string().trim().min(1).max(8000) })
      .strict()
      .parse(req.body);
    const direct =
      /^(?:请)?(?:帮我)?(?:记住|记录)(?:我的)?(?:长期)?目标[：:]/.test(text) ||
      /^(?:请)?暂停(?:全部|所有)(?:定期)?跟进[。！!]?$/i.test(text) ||
      (space.pendingApproval &&
        /^(确认跟进|确认|同意|可以|好|yes|取消跟进|取消|算了|no)[。！!]?$/i.test(
          text,
        ));
    const task = enqueue(space, text, "chat", null, direct);
    const goal = text.match(
      /^(?:请)?(?:帮我)?(?:记住|记录)(?:我的)?(?:长期)?目标[：:]\s*(.+)$/s,
    );
    if (goal) {
      delete space.pendingApproval;
      applyPlan(space, task, { action: "goal", prompt: goal[1] });
      return task;
    }
    if (/^(?:请)?暂停(?:全部|所有)(?:定期)?跟进[。！!]?$/i.test(text)) {
      delete space.pendingApproval;
      applyPlan(space, task, { action: "pause", targetId: "all" });
      return task;
    }
    if (
      /^(确认跟进|确认|同意|可以|好|yes)[。！!]?$/i.test(text) &&
      space.pendingApproval
    ) {
      const pending = space.pendingApproval;
      delete space.pendingApproval;
      if (Date.parse(pending.expiresAt) <= clock())
        complete(task, "这次跟进授权已过期，请重新告诉我执行范围。");
      else {
        const routine = createRoutine(space, pending.input);
        routine.kind = "chat";
        complete(
          task,
          "已启用跟进：每 " +
            pending.input.intervalMinutes / 60 +
            " 小时一次，最多 " +
            pending.input.maxExecutions +
            " 次。你可以随时说“暂停全部跟进”。",
        );
      }
    } else if (
      /^(取消跟进|取消|算了|no)[。！!]?$/i.test(text) &&
      space.pendingApproval
    ) {
      delete space.pendingApproval;
      complete(task, "已放弃本次跟进设置，没有新增定期调用。");
    } else {
      delete space.pendingApproval;
    }
    return task;
  });
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
      if (task.runId || !["queued", "planning"].includes(task.status))
        throw Object.assign(new Error("已开始执行，请在运行详情中取消。"), {
          status: 409,
        });
      planning.get(task.id)?.abort();
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
          enqueue(
            space,
            routine.prompt,
            routine.kind || "research",
            routine.id,
          );
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
        if (!task || space.tasks.some((t) => t.status === "planning")) continue;
        if (task.kind === "chat") {
          const previous = space.tasks
            .filter((t) => final.has(t.status))
            .at(-1);
          if (
            previous?.intent === "routine" &&
            /次|小时|每天|每周|每月|\d|[一二两三四五六七八九十]/.test(
              task.text,
            ) &&
            clock() - Date.parse(previous.createdAt) < 600000
          )
            task.authorizationText = previous.text + "\n" + task.text;
          task.status = "planning";
          task.stage = "正在理解你的任务";
          await save(space);
          const controller = new AbortController();
          planning.set(task.id, controller);
          const available = runs.filter(
            (r) =>
              r.projectId === space.projectId &&
              r.status === "completed" &&
              ["research", "recall"].includes(r.kind) &&
              r.result?.requirements?.length,
          );
          const context = {
            userMessage: task.text,
            goals: space.goals
              .map((g) => ({
                id: g.id,
                text: g.text.slice(0, 200),
                done: g.done,
              }))
              .slice(-20),
            routines: space.routines.slice(-20).map((r) => ({
              id: r.id,
              title: r.title,
              enabled: r.enabled,
              executions: r.executions,
              maxExecutions: r.maxExecutions,
            })),
            completedResearch: available.slice(-5).map((r) => ({
              id: r.id,
              prompt: r.userPrompt || r.prompt.slice(0, 300),
              requirements: r.result.requirements
                .slice(0, 5)
                .map((x) => x.title.slice(0, 100)),
            })),
            conversation: space.tasks
              .filter((t) => final.has(t.status))
              .slice(-4)
              .map((t) => ({
                user: t.text.slice(0, 1000),
                reply:
                  t.answer?.slice(0, 1000) ||
                  runs
                    .find((r) => r.id === t.runId)
                    ?.result?.answer?.slice(0, 1000) ||
                  "",
              })),
          };
          void (async () => {
            let output, failure;
            try {
              if (!planner) throw new Error("对话调度器未配置。");
              output = await planner({
                projectId: space.projectId,
                prompt: JSON.stringify(context),
                signal: controller.signal,
              });
            } catch (e) {
              failure = e;
            }
            await serial(async () => {
              const fresh = await load(space.projectId);
              const current = fresh.tasks.find((t) => t.id === task.id);
              if (!current) return;
              current.planningUsage = output?.usage || failure?.usage;
              current.planningRaw = output?.raw || failure?.raw;
              if (current.status !== "cancelled") {
                try {
                  if (failure) throw failure;
                  const plan = planSchema.parse(output.plan);
                  if (
                    current.routineId &&
                    !["research", "recall", "clarify", "unsupported"].includes(
                      plan.action,
                    )
                  )
                    throw new Error(
                      "定期授权仅限研究与回顾，不能新增目标、跟进或其他操作。",
                    );
                  if (
                    plan.action === "prototype" &&
                    !/原型|prototype/i.test(current.text)
                  )
                    throw new Error("请明确要求生成原型，并说明使用哪份需求。");
                  if (
                    plan.action === "prototype" &&
                    !available.some((r) => r.id === plan.targetId)
                  )
                    throw new Error(
                      "没有找到明确可用的研究需求，请先研究，或告诉我使用哪份需求。",
                    );
                  applyPlan(fresh, current, plan);
                } catch (e) {
                  current.status = "failed";
                  current.error = e.message;
                  current.finishedAt = timestamp();
                }
              }
              await save(fresh);
            });
          })()
            .catch((e) => console.error("Conversation planner:", e.message))
            .finally(() => planning.delete(task.id));
          continue;
        }
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
              version: "0.7.0",
              authority:
                "服务代码提供的当前能力声明，优先于旧项目背景的能力描述；不等于任务成功或效果证明",
              execution:
                "本机 Node 服务队列通过真实 nanobot 执行研究/记忆回顾，关闭页面仍可执行，关机或停服务停止",
              routines:
                "用户显式启用的有限次数定期研究，最小间隔60分钟，最多10次，暂停仅阻止后续排队，不会补跑漏掉的轮次",
              tools:
                "研究模型没有电脑操作工具，不能发送邮件、修改外部应用、购买或自动部署；用户在对话中明确要求原型时可依据已完成需求调用造物",
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
              ...(task.parentRunId
                ? { parentRunId: task.parentRunId, prototypeMode: "new" }
                : {}),
              prompt: `${task.executionPrompt || task.text}\n\n个人委托上下文（历史结论不能作为新的事实来源，目标不是已完成成果）：\n${context}`,
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
      for (const controller of planning.values()) controller.abort();
    },
  };
}
