import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import PersonalHome from "./PersonalHome";
import "./personal-demo.css";
const key = "yiban-public-personal-demo-v07";
const example = {
  goals: [
    {
      id: "goal-demo",
      text: "把分散的 AI 产品实践整理成可复用、可检查的作品（示例）",
      done: false,
    },
  ],
  routines: [],
  tasks: [] as any[],
  pendingApproval: null as any,
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
  if (suffix === "/chat" || suffix === "/messages") {
    const text = body.text.trim();
    let answer =
      "**交互示例 · 未调用模型**\n\n真实版本会理解任务，自动选择研究或项目回顾，把进展和带来源的交付带回对话。这个公开页面只演示流程，不生成真实结论。";
    if (
      /^(确认跟进|确认|可以|好)[。！!]?$/i.test(text) &&
      state.pendingApproval
    ) {
      const p = state.pendingApproval;
      (state.routines as any[]).push({
        ...p,
        id: crypto.randomUUID(),
        enabled: true,
        executions: 0,
        nextAt: new Date(Date.now() + p.intervalMinutes * 60000).toISOString(),
      });
      state.pendingApproval = null;
      answer =
        "**交互示例 · 未启用真实调度**\n\n示例跟进已保存，可说“暂停全部跟进”。公开页面不会按时调用模型。";
    } else if (
      /^(取消跟进|取消|算了)[。！!]?$/i.test(text) &&
      state.pendingApproval
    ) {
      state.pendingApproval = null;
      answer = "已取消示例跟进设置。";
    } else {
      state.pendingApproval = null;
      if (/暂停.*(全部|所有).*跟进/.test(text)) {
        (state.routines as any[]).forEach((r) => (r.enabled = false));
        answer = "已暂停当前浏览器的全部示例跟进。没有真实后台任务。";
      } else if (/记住.*目标[：:]/.test(text)) {
        const goal = text.split(/[：:]/).slice(1).join("：").trim();
        if (goal)
          state.goals.push({
            id: crypto.randomUUID(),
            text: goal,
            done: false,
          });
        answer = "已把这条目标保存在当前浏览器的演示空间：" + goal;
      } else if (/每天|每周/.test(text) && /次/.test(text)) {
        const n = text.match(
          /(?:最多|共|总共|一共)\s*([1-9]|10|一|二|两|三|四|五|六|七|八|九|十)\s*次/,
        );
        if (n) {
          const chinese: Record<string, number> = {
            一: 1,
            二: 2,
            两: 2,
            三: 3,
            四: 4,
            五: 5,
            六: 6,
            七: 7,
            八: 8,
            九: 9,
            十: 10,
          };
          const times = Number(n[1]) || chinese[n[1]];
          state.pendingApproval = {
            title: text.slice(0, 80),
            prompt: text,
            intervalMinutes: /每周/.test(text) ? 10080 : 1440,
            maxExecutions: times,
          };
          answer = `**示例授权范围**\n\n每 ${state.pendingApproval.intervalMinutes / 60} 小时一次，最多 ${times} 次。真实版本需要本机服务持续运行，每次可能消耗模型额度。\n\n回复“确认跟进”保存示例，或“取消跟进”。`;
        } else
          answer = "示例跟进还需要执行上限，例如“每天回顾项目进展，最多三次”。";
      } else if (/邮件|日历|购买|部署/.test(text))
        answer =
          "这项执行能力尚未接入，当前不能代你完成。可以在真实版本里委托我整理草稿或计划。";
    }
    const task = {
      id: crypto.randomUUID(),
      text,
      kind: "chat",
      status: "completed",
      seen: false,
      createdAt: new Date().toISOString(),
      answer,
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
        <a href="../tutorial/">上一版操作视频</a>
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
