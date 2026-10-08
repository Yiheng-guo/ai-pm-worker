import { useEffect, useRef, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowUp, ArrowUpRight, Sparkles, X } from "lucide-react";
import "./personal.css";
type Usage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cost?: number | null;
};
type Task = {
  id: string;
  text: string;
  status: string;
  stage?: string;
  runId?: string;
  createdAt: string;
  answer?: string;
  error?: string;
  usage?: Usage;
  planningUsage?: Usage;
  sources?: { id: string; url: string; title: string }[];
  prototype?: { title: string; version: number };
};
type Space = {
  tasks: Task[];
  goals: { id: string; text: string; done: boolean }[];
  routines: {
    id: string;
    title: string;
    enabled: boolean;
    executions: number;
    maxExecutions: number;
    intervalMinutes: number;
  }[];
};
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
const final = (t: Task) =>
  ["completed", "failed", "cancelled"].includes(t.status);
const status: Record<string, string> = {
  queued: "已接下任务",
  planning: "正在理解任务",
  starting: "准备执行",
  running: "正在执行",
  completed: "已完成",
  failed: "未完成",
  cancelled: "已取消",
};
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
    [busy, setBusy] = useState(false),
    [text, setText] = useState(""),
    [context, setContext] = useState(false);
  const thread = useRef<HTMLDivElement>(null),
    follow = useRef(true);
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
  useEffect(() => {
    if (follow.current && thread.current)
      thread.current.scrollTop = thread.current.scrollHeight;
  }, [space]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !text.trim() || cloud) return;
    setBusy(true);
    setError("");
    try {
      await api(base + "/chat", {
        method: "POST",
        body: JSON.stringify({ text: text.trim() }),
      });
      setText("");
      follow.current = true;
      setSpace(await api(base));
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel(t: Task) {
    setBusy(true);
    setError("");
    try {
      await api(base + `/tasks/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ cancel: true }),
      });
      setSpace(await api(base));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const active = space?.tasks.filter((t) => !final(t)).length || 0;
  return (
    <div className="pa-home pa-chat-first">
      <header className="pa-head">
        <div>
          <span className="pa-kicker">YIBAN · YOUR PERSONAL AGENT</span>
          <h1>说你想做什么，剩下的交给亦伴。</h1>
          <p>{project.name} · 进展、结果和下一步，都在这段对话里。</p>
        </div>
        <button
          className="pa-context-toggle"
          aria-expanded={context}
          onClick={() => setContext(!context)}
        >
          {context ? "收起" : "背景与记录"}
        </button>
      </header>
      <div className={`pa-layout ${context ? "with-context" : ""}`}>
        <section className="pa-main" aria-label="与亦伴对话">
          <div className="pa-chat-status">
            <span className="pa-presence">
              <span />
              {demo
                ? "公开示例 · 不调用模型"
                : cloud
                  ? "需要本机服务"
                  : "本机运行"}
            </span>
            <span>
              {active ? `${active} 件事正在推进` : "准备好接下你的下一件事"}
            </span>
          </div>
          <div
            className="pa-thread"
            ref={thread}
            onScroll={() => {
              const el = thread.current;
              if (el)
                follow.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 70;
            }}
            aria-live="polite"
            aria-relevant="additions text"
          >
            {!space && !error && <p>正在接上你的对话…</p>}
            {space && !space.tasks.length && (
              <div className="pa-empty">
                <Sparkles size={30} />
                <h2>不必先设计工作流。</h2>
                <p>
                  直接告诉我任务。我会读取项目背景，选择已有能力；缺少关键信息时，再问你。
                </p>
                <div className="pa-examples">
                  <p>
                    “研究这个竞品，判断对我的项目有什么价值，写一份需求草稿。”
                  </p>
                  <p>“记住我的目标：把产品研究做成可检查的作品。”</p>
                  <p>“每天回顾一次项目进展，最多三次。”</p>
                </div>
              </div>
            )}
            {space?.tasks.slice(-50).map((t) => (
              <article className="pa-exchange" key={t.id}>
                <div className="pa-user">
                  <small>你</small>
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
                  {t.error ? (
                    <p className="pa-task-error">{t.error}</p>
                  ) : t.answer ? (
                    <ReactMarkdown>{t.answer}</ReactMarkdown>
                  ) : (
                    <p className="pa-muted">
                      {t.stage ||
                        (t.status === "queued"
                          ? "我接下了，正在准备下一步。"
                          : t.status === "cancelled"
                            ? "已取消这件事。"
                            : "正在处理，结果会回到这里。")}
                    </p>
                  )}
                  {!final(t) && t.answer && (
                    <p className="pa-muted">{t.stage || "正在推进…"}</p>
                  )}
                  {!!t.sources?.length && (
                    <details className="pa-inline-details">
                      <summary>依据 · {t.sources.length} 个来源</summary>
                      {t.sources.map((s) => (
                        <p key={s.id}>
                          <a href={s.url} target="_blank" rel="noreferrer">
                            {s.title || s.url}
                          </a>
                        </p>
                      ))}
                    </details>
                  )}
                  {t.prototype && (
                    <p>
                      已保存原型：{t.prototype.title} · 第 {t.prototype.version}{" "}
                      版
                    </p>
                  )}
                  {(t.usage || t.planningUsage || t.runId || !final(t)) && (
                    <details className="pa-inline-details">
                      <summary>执行记录{!final(t) ? "与取消" : ""}</summary>
                      {t.planningUsage && (
                        <p>
                          任务理解：输入 {t.planningUsage.inputTokens ?? "未知"}{" "}
                          / 输出 {t.planningUsage.outputTokens ?? "未知"} tokens
                          · 费用 {t.planningUsage.cost ?? "未报告"}
                        </p>
                      )}
                      {t.usage && (
                        <p>
                          任务执行：输入 {t.usage.inputTokens ?? "未知"} / 输出{" "}
                          {t.usage.outputTokens ?? "未知"} tokens · 费用{" "}
                          {t.usage.cost ?? "未报告"}
                        </p>
                      )}
                      {t.runId && (
                        <button onClick={() => openRun(t.runId!)}>
                          查看完整交付与原型 <ArrowUpRight size={14} />
                        </button>
                      )}
                      {!t.runId && !final(t) && (
                        <button disabled={busy} onClick={() => void cancel(t)}>
                          <X size={14} />
                          取消这件事
                        </button>
                      )}
                    </details>
                  )}
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
            <label htmlFor="pa-message">告诉亦伴</label>
            <textarea
              id="pa-message"
              value={text}
              maxLength={8000}
              onChange={(e) => setText(e.target.value)}
              placeholder="帮我做什么？也可以接着上一件事说。"
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div>
              <span>
                {busy ? "正在提交…" : "Enter 发送 · Shift + Enter 换行"}
              </span>
              <button
                disabled={busy || cloud || !text.trim()}
                type="submit"
                aria-label="发送给亦伴"
              >
                <ArrowUp size={20} />
              </button>
            </div>
          </form>
          <p className="pa-footnote">
            {demo
              ? "这是交互示例；真实研究与后台跟进需要本机版本。"
              : "研究与原型可调用；邮件、日历和电脑操作尚未接入。关闭页面可继续，关机或停服务后停止。"}
          </p>
        </section>
        {context && (
          <aside className="pa-side">
            <section className="pa-card">
              <h2>正在记住的方向</h2>
              {space?.goals
                .filter((g) => !g.done)
                .map((g) => (
                  <p className="pa-memory" key={g.id}>
                    {g.text}
                  </p>
                ))}
              <p>直接说“记住我的目标：…”即可添加。</p>
            </section>
            <section className="pa-card">
              <h2>正在跟进</h2>
              {space?.routines.map((r) => (
                <p key={r.id}>
                  {r.title}
                  <br />每 {r.intervalMinutes / 60} 小时 · {r.executions}/
                  {r.maxExecutions} 次 ·{" "}
                  {r.enabled ? "启用" : "暂停 / 达到上限"}
                </p>
              ))}
              <p>在对话里设置，或说“暂停全部跟进”。</p>
            </section>
            <section className="pa-card">
              <h2>项目背景与确认记忆</h2>
              {project.memory
                .filter((m) => !m.status || m.status === "active")
                .slice(0, 4)
                .map((m) => (
                  <p className="pa-memory" key={m.id}>
                    {m.text}
                  </p>
                ))}
              <button onClick={openProject}>
                查看、更正项目资料 <ArrowUpRight size={14} />
              </button>
            </section>
            <section className="pa-card">
              <h2>可用能力</h2>
              <p>
                {demo
                  ? "公开页面使用标注示例"
                  : runtime?.installed
                    ? "nanobot 已就绪"
                    : "nanobot 未就绪"}
              </p>
              <p>
                {runtime?.foundryAvailable
                  ? "造物已连接"
                  : "造物状态见本机设置"}
              </p>
              <p>
                定期跟进有次数上限，授权可在对话中撤回；新跟进先说明范围和消耗。
              </p>
            </section>
          </aside>
        )}
      </div>
    </div>
  );
}
