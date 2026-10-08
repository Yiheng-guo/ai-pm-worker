import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import PersonalHome from "./PersonalHome";
import "./personal-demo.css";
const key = "yiban-public-personal-demo-v06";
const example = {
  goals: [
    {
      id: "goal-demo",
      text: "把分散的 AI 产品实践整理成可复用、可检查的作品（示例）",
      done: false,
    },
  ],
  routines: [],
  tasks: [
    {
      id: "task-demo",
      text: "结合我当前的项目，安排本周的验证工作。（示例委托）",
      kind: "research",
      status: "completed",
      runId: "demo",
      seen: false,
      createdAt: "2026-10-08T03:00:00Z",
      answer:
        "**示例交付，非模型实测结果**\n\n建议先写下一个长期目标，再选择一次研究委托。交付后可以进入结果收件箱，检查依据、需求草稿和后续行动。\n\n完整版本会保存真实运行记录；这个公开页面只演示交互，不访问你的私有项目、不执行模型或后台定时任务。",
      usage: { inputTokens: null, outputTokens: null, cost: null },
    },
  ],
};
let state = structuredClone(example);
try {
  const stored = JSON.parse(localStorage.getItem(key) || "null");
  if (
    stored &&
    Array.isArray(stored.tasks) &&
    Array.isArray(stored.goals) &&
    Array.isArray(stored.routines)
  )
    state = stored;
} catch {}
function save() {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {}
}
const project = {
  id: "public-example",
  name: "我的 AI 产品作品（公开示例）",
  memory: [{ id: "m1", text: "偏好带来源、承认未知的研究结论（示例）" }],
};
async function api(path: string, options: RequestInit = {}) {
  const body = options.body ? JSON.parse(String(options.body)) : {};
  const suffix = path.split("/public-example")[1] || "";
  if (!options.method || options.method === "GET")
    return structuredClone(state);
  if (suffix === "/messages") {
    const task = {
      id: crypto.randomUUID(),
      text: body.text,
      kind: body.kind,
      status: "completed",
      seen: false,
      createdAt: new Date().toISOString(),
      runId: "demo",
      answer:
        "**交互演示，未调用模型**\n\n你的委托已加入当前浏览器的演示记录。真实版本会读取项目与目标，交由 nanobot 执行，并记录结果、失败和提供方用量。\n\n请继续体验：打开结果收件箱 → 查看详情 → 标记已读。这里不会针对输入内容生成真实研究结论。",
      usage: { inputTokens: null, outputTokens: null, cost: null },
    };
    state.tasks.push(task);
    save();
    return task;
  }
  if (suffix === "/goals") {
    const goal = { id: crypto.randomUUID(), text: body.text, done: false };
    state.goals.push(goal);
    save();
    return goal;
  }
  if (suffix.startsWith("/goals/")) {
    const goal = state.goals.find((g) => g.id === suffix.split("/").pop())!;
    goal.done = body.done;
    save();
    return goal;
  }
  if (suffix === "/routines") {
    const routine = {
      ...body,
      id: crypto.randomUUID(),
      enabled: true,
      executions: 0,
      nextAt: new Date(Date.now() + body.intervalMinutes * 60000).toISOString(),
    };
    (state.routines as any[]).push(routine);
    save();
    return routine;
  }
  if (suffix.startsWith("/routines/")) {
    const routine = (state.routines as any[]).find(
      (r) => r.id === suffix.split("/").pop(),
    );
    routine.enabled = body.enabled;
    save();
    return routine;
  }
  if (suffix.startsWith("/tasks/")) {
    const task = state.tasks.find((t) => t.id === suffix.split("/").pop())!;
    task.seen = body.seen;
    save();
    return task;
  }
  throw new Error("此操作需要完整版本。");
}
function Demo() {
  const [detail, setDetail] = useState(false),
    [revision, setRevision] = useState(0);
  return (
    <>
      <div className="pd-bar">
        <strong>亦伴 · Personal Agent</strong>
        <a href="../demo/">原版六步实拍</a>
        <a href="https://github.com/Yiheng-guo/ai-pm-worker#readme">
          源码与本机启动
        </a>
      </div>
      <div className="pd-notice">
        公开交互演示 · 所有交付均为标注示例 ·
        不连接模型、私人数据或后台调度。输入只留在当前浏览器，请勿填写敏感资料。
        <button
          onClick={() => {
            state = structuredClone(example);
            save();
            setRevision((v) => v + 1);
          }}
        >
          重置示例
        </button>
      </div>
      <main className="pd-main">
        <PersonalHome
          key={revision}
          project={project}
          api={api}
          refresh={async () => {}}
          openRun={() => setDetail(true)}
          openProject={() => setDetail(true)}
          demo
        />
      </main>
      {detail && (
        <div className="pd-overlay">
          <section role="dialog" aria-modal="true" aria-label="示例详情">
            <h2>从委托到可检查的交付</h2>
            <p>这是公开示例，不是你的私人项目或真实评测。</p>
            <ol>
              <li>记录项目背景、长期目标和你确认的偏好。</li>
              <li>委托进入队列，由本机 nanobot 执行。</li>
              <li>研究保留来源正文、URL、时间与哈希。</li>
              <li>候选需求关联依据，人工复核后交给造物生成前端原型。</li>
              <li>待办与结果返回收件箱，失败和实际用量也保留。</li>
            </ol>
            <p>当前公开演示不执行以上模型与调度步骤。</p>
            <a href="../demo/">查看已有案例的真实页面实拍 →</a>
            <button autoFocus onClick={() => setDetail(false)}>
              返回我的亦伴
            </button>
          </section>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Demo />);
