import { useEffect, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  Clock3,
  Inbox,
  Pause,
  Play,
  Plus,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import "./personal.css";

type Task = {
  id: string;
  text: string;
  kind: string;
  status: string;
  runId?: string;
  seen: boolean;
  createdAt: string;
  answer?: string;
  error?: string;
  usage?: { inputTokens?: number; outputTokens?: number; cost?: number | null };
  sources?: { id: string; url: string; title: string }[];
};
type Goal = { id: string; text: string; done: boolean };
type Routine = {
  id: string;
  title: string;
  prompt: string;
  enabled: boolean;
  executions: number;
  maxExecutions: number;
  intervalMinutes: number;
  nextAt: string;
};
type Space = { tasks: Task[]; goals: Goal[]; routines: Routine[] };
type Props = {
  project: {
    id: string;
    name: string;
    memory: { id: string; text: string; status?: string }[];
  };
  api: (path: string, options?: RequestInit) => Promise<any>;
  openRun: (id: string) => void;
  openProject: () => void;
  refresh: () => Promise<void>;
  runtime?: { installed?: boolean; foundryAvailable?: boolean };
  cloud?: boolean;
  demo?: boolean;
};
const status: Record<string, string> = {
  queued: "等待执行",
  starting: "正在启动",
  running: "处理中",
  completed: "已交付",
  failed: "执行失败",
  cancelled: "已取消",
};
const finished = (t: Task) =>
  ["completed", "failed", "cancelled"].includes(t.status);
const date = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export default function PersonalHome({
  project,
  api,
  openRun,
  openProject,
  refresh,
  runtime,
  cloud,
  demo,
}: Props) {
  const [space, setSpace] = useState<Space | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [text, setText] = useState(""),
    [mode, setMode] = useState<"research" | "recall">("research"),
    [tab, setTab] = useState<"conversation" | "inbox">("conversation");
  const [goal, setGoal] = useState(""),
    [routineForm, setRoutineForm] = useState(false),
    [title, setTitle] = useState(""),
    [routinePrompt, setRoutinePrompt] = useState(""),
    [hours, setHours] = useState(24),
    [limit, setLimit] = useState(3);
  const base = `/agent/personal/${encodeURIComponent(project.id)}`;
  useEffect(() => {
    let alive = true;
    setSpace(null);
    setError("");
    const load = async () => {
      try {
        const next = await api(base);
        if (alive) setSpace(next);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [project.id]);
  async function mutate(path: string, method: string, body: unknown) {
    setError("");
    setBusy(true);
    try {
      const result = await api(base + path, {
        method,
        body: JSON.stringify(body),
      });
      setSpace(await api(base));
      void refresh();
      return result;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || text.trim().length < 5) return;
    try {
      await mutate("/messages", "POST", { text, kind: mode });
      setText("");
      setTab("conversation");
    } catch {}
  }
  const unread = space?.tasks.filter((t) => finished(t) && !t.seen) || [];
  const tasks = tab === "inbox" ? unread : space?.tasks.slice(-30) || [];
  const active = space?.tasks.filter((t) => !finished(t)).length || 0;
  return (
    <div className="pa-home">
      <header className="pa-head">
        <div>
          <span className="pa-kicker">YIBAN · PERSONAL AGENT</span>
          <h1>把想做的事，交给亦伴。</h1>
          <p>记住你的方向，接着上一次对话，把进展带回来。</p>
        </div>
        <span className="pa-presence">
          <span />
          {demo ? "公开交互演示" : cloud ? "需要本机服务" : "本机服务在线"}
          <small>{demo ? "示例数据 · 不调用模型" : "关机后停止执行"}</small>
        </span>
      </header>
      <div className="pa-layout">
        <section className="pa-main">
          <div className="pa-context">
            <Sparkles size={18} />
            <div>
              <strong>正在陪你推进：{project.name}</strong>
              <p>
                委托会读取当前项目、已确认记忆、未完成目标摘要与最近两次交付摘要。
              </p>
            </div>
            <button onClick={openProject}>
              查看背景
              <ArrowUpRight size={16} />
            </button>
          </div>
          <div className="pa-tabs">
            <button
              className={tab === "conversation" ? "selected" : ""}
              onClick={() => setTab("conversation")}
            >
              持续对话
            </button>
            <button
              className={tab === "inbox" ? "selected" : ""}
              onClick={() => setTab("inbox")}
            >
              <Inbox size={16} />
              结果收件箱 <b>{unread.length}</b>
            </button>
            <span>
              {active ? `${active} 条委托处理中` : "没有执行中的委托"}
            </span>
          </div>
          <div className="pa-thread" aria-live="polite">
            {!space && !error && <p>正在读取你的个人空间…</p>}
            {space && !tasks.length && (
              <div className="pa-empty">
                <Sparkles size={30} />
                <h2>
                  {tab === "inbox" ? "所有结果都已看过" : "从一件具体的事开始"}
                </h2>
                <p>
                  {tab === "inbox"
                    ? "完成或失败的任务都会留在这里，等待你检查。"
                    : "不必整理表格。告诉亦伴要做什么，结果、依据和后续动作会留在同一条委托里。"}
                </p>
                {tab === "conversation" && (
                  <div className="pa-suggestions">
                    {[
                      "根据项目背景，帮我安排本周三个最值得推进的任务。",
                      "回顾我的项目目标和已确认偏好，指出还缺哪些关键信息。",
                      "研究 Grok Bot 的持续委托机制，判断我的产品是否值得引入。",
                    ].map((v, i) => (
                      <button
                        key={v}
                        onClick={() => {
                          setText(v);
                          setMode(i === 1 ? "recall" : "research");
                        }}
                      >
                        {v}
                        <ArrowUpRight size={16} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {tasks.map((t) => (
              <article className="pa-exchange" key={t.id}>
                <div className="pa-user">
                  <small>你 · {date(t.createdAt)}</small>
                  <p>{t.text}</p>
                </div>
                <div className="pa-reply">
                  <div className="pa-reply-head">
                    <span className="pa-avatar">亦</span>
                    <strong>亦伴</strong>
                    <span className={`pa-state ${t.status}`}>
                      {status[t.status] || t.status}
                    </span>
                  </div>
                  {t.answer ? (
                    <ReactMarkdown>{t.answer}</ReactMarkdown>
                  ) : (
                    <p className="pa-muted">
                      {t.error ||
                        (t.status === "queued"
                          ? "委托已保存。即使关闭页面，本机服务仍会尝试执行。"
                          : t.status === "cancelled"
                            ? "这条委托已取消。"
                            : "正在执行，结果和失败记录都会保留。")}
                    </p>
                  )}
                  <div className="pa-receipt">
                    {t.usage && (
                      <span>
                        输入 {t.usage.inputTokens ?? "未知"} / 输出{" "}
                        {t.usage.outputTokens ?? "未知"} tokens · 费用{" "}
                        {t.usage.cost == null ? "未报告" : t.usage.cost}
                      </span>
                    )}
                    {t.runId && (
                      <button onClick={() => openRun(t.runId!)}>
                        结果、证据与取消入口
                        <ArrowUpRight size={14} />
                      </button>
                    )}
                    {!t.runId && t.status === "queued" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void mutate(`/tasks/${t.id}`, "PATCH", {
                            cancel: true,
                          }).catch(() => {})
                        }
                      >
                        <X size={14} />
                        取消排队
                      </button>
                    )}
                    {finished(t) && !t.seen && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void mutate(`/tasks/${t.id}`, "PATCH", {
                            seen: true,
                          }).catch(() => {})
                        }
                      >
                        <Check size={14} />
                        标记已读
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {error && (
            <div className="pa-error" role="alert">
              {error}
            </div>
          )}
          <form className="pa-composer" onSubmit={submit}>
            <label htmlFor="pa-message">新的委托</label>
            <textarea
              id="pa-message"
              value={text}
              maxLength={8000}
              onChange={(e) => setText(e.target.value)}
              placeholder="例如：结合易办的项目背景，判断这个新方向值不值得做，并给我一个带依据的行动计划。"
            />
            <div>
              <select
                aria-label="执行方式"
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="research">研究与规划</option>
                <option value="recall">回顾项目与记忆</option>
              </select>
              <span>先保存，再执行 · 不自动对外发布</span>
              <button
                disabled={busy || cloud || text.trim().length < 5}
                type="submit"
              >
                <ArrowUp size={18} />
                交给亦伴
              </button>
            </div>
          </form>
        </section>
        <aside className="pa-side">
          <section className="pa-card">
            <h2>
              <Target size={18} />
              我的长期目标
            </h2>
            <p>你明确写下的方向，会进入后续委托上下文。</p>
            {space?.goals.map((g) => (
              <label className={`pa-goal ${g.done ? "done" : ""}`} key={g.id}>
                <input
                  type="checkbox"
                  checked={g.done}
                  disabled={busy}
                  onChange={() =>
                    void mutate(`/goals/${g.id}`, "PATCH", {
                      done: !g.done,
                    }).catch(() => {})
                  }
                />
                <span>{g.text}</span>
              </label>
            ))}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await mutate("/goals", "POST", { text: goal });
                  setGoal("");
                } catch {}
              }}
            >
              <input
                aria-label="新的长期目标"
                placeholder="添加一个要持续推进的目标"
                maxLength={1000}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
              <button
                aria-label="添加目标"
                disabled={busy || cloud || goal.trim().length < 2}
              >
                <Plus size={18} />
              </button>
            </form>
          </section>
          <section className="pa-card">
            <h2>
              <Clock3 size={18} />
              定期跟进
            </h2>
            <p>
              {demo
                ? "这里仅演示设置与暂停，不会按时调用模型。完整版本需要本机服务持续运行。"
                : "只在本机服务运行时执行；恢复服务后不补跑漏掉的轮次。暂停不会取消已排队的任务。"}
            </p>
            {space?.routines.map((r) => (
              <div className="pa-routine" key={r.id}>
                <strong>{r.title}</strong>
                <span>
                  {r.executions}/{r.maxExecutions} 次 · 每{" "}
                  {r.intervalMinutes / 60} 小时
                </span>
                <small>
                  {r.enabled
                    ? `下次 ${date(r.nextAt)}`
                    : r.executions >= r.maxExecutions
                      ? "已到次数上限"
                      : "已暂停"}
                </small>
                <button
                  aria-label={r.enabled ? `暂停${r.title}` : `恢复${r.title}`}
                  disabled={
                    busy || (!r.enabled && r.executions >= r.maxExecutions)
                  }
                  onClick={() =>
                    void mutate(`/routines/${r.id}`, "PATCH", {
                      enabled: !r.enabled,
                    }).catch(() => {})
                  }
                >
                  {r.enabled ? <Pause size={14} /> : <Play size={14} />}
                </button>
              </div>
            ))}
            <button
              className="pa-add"
              onClick={() => setRoutineForm(!routineForm)}
            >
              <Plus size={15} />
              {routineForm ? "收起" : "设置有限次跟进"}
            </button>
            {routineForm && (
              <form
                className="pa-routine-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await mutate("/routines", "POST", {
                      title,
                      prompt: routinePrompt,
                      intervalMinutes: hours * 60,
                      maxExecutions: limit,
                    });
                    setRoutineForm(false);
                    setTitle("");
                    setRoutinePrompt("");
                  } catch {}
                }}
              >
                <input
                  aria-label="跟进名称"
                  placeholder="跟进名称"
                  value={title}
                  maxLength={100}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <textarea
                  aria-label="跟进任务"
                  placeholder="每次要研究或检查什么？"
                  value={routinePrompt}
                  maxLength={6000}
                  onChange={(e) => setRoutinePrompt(e.target.value)}
                />
                <label>
                  间隔小时
                  <input
                    type="number"
                    min={1}
                    max={168}
                    step={1}
                    value={hours}
                    onChange={(e) => setHours(Number(e.target.value))}
                  />
                </label>
                <label>
                  最多执行次数
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                  />
                </label>
                <small>
                  授权仅限研究，不包含发送消息、购买或修改外部应用。每次可能产生模型调用，现金成本由提供方账单确定。
                </small>
                <button
                  disabled={
                    busy ||
                    cloud ||
                    !title.trim() ||
                    routinePrompt.trim().length < 5
                  }
                >
                  确认并启用
                </button>
              </form>
            )}
          </section>
          <section className="pa-card">
            <h2>
              <Sparkles size={18} />
              记住了什么
            </h2>
            {project.memory
              .filter((m) => !m.status || m.status === "active")
              .slice(0, 4)
              .map((m) => (
                <p className="pa-memory" key={m.id}>
                  {m.text}
                </p>
              ))}
            {!project.memory.filter((m) => !m.status || m.status === "active")
              .length && <p>还没有确认记忆。模型建议不会自动成为你的偏好。</p>}
            <button className="pa-add" onClick={openProject}>
              查看、确认与更正
              <ArrowUpRight size={14} />
            </button>
          </section>
          <section className="pa-card pa-tools">
            <h2>亦伴现在能调用</h2>
            <p>
              <i className={runtime?.installed ? "on" : ""} />
              {runtime?.installed
                ? "nanobot 研究执行器已安装"
                : "nanobot 尚未就绪"}
            </p>
            <p>
              <i className={runtime?.foundryAvailable ? "on" : ""} />
              {runtime?.foundryAvailable
                ? "造物原型服务已连接"
                : "造物原型服务未连接"}
            </p>
            <p>
              <i />
              邮件、日历与电脑操作尚未接入
            </p>
            <small>
              亦伴目前是一名懂你项目的个人工作助理。没有全天候云电脑，也没有读取私人账户的隐式权限。
            </small>
          </section>
        </aside>
      </div>
    </div>
  );
}
