import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Code2,
  Copy,
  ExternalLink,
  FileText,
  FlaskConical,
  FolderOpen,
  History,
  LayoutDashboard,
  Link2,
  ListChecks,
  Loader2,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  X,
  AlertCircle,
  Layers,
  Pencil,
  PanelLeftClose,
  RefreshCw,
  Compass,
  Brain,
  Box,
} from "lucide-react";
import "./agent.css";

type Page =
  | "overview"
  | "research"
  | "evidence"
  | "requirements"
  | "prototypes"
  | "tasks"
  | "evaluation"
  | "settings";
type Memory = { id: string; text: string; source?: string; updatedAt?: string };
type Project = {
  id: string;
  name: string;
  background: string;
  goal: string;
  constraints: string;
  memory: Memory[];
  decisions: (string | { text?: string; title?: string; at?: string })[];
  createdAt: string;
  updatedAt: string;
};
type Source = {
  id: string;
  title: string;
  url: string;
  text: string;
  sha256: string;
  fetchedAt: string;
  status: string;
};
type Requirement = {
  id: string;
  title: string;
  description: string;
  sourceIds: string[];
  acceptance: string | string[];
};
type Action = {
  id: string;
  title: string;
  done: boolean;
  sourceIds?: string[];
};
type Run = {
  id: string;
  projectId: string;
  parentRunId?: string;
  sessionId: string;
  kind: "research" | "prototype" | "recall";
  prompt: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage?: string;
  events: { at: string; message: string }[];
  sources: Source[];
  result?: {
    answer?: string;
    claims?: { text: string; sourceIds: string[]; kind: string }[];
    valueJudgment?: string;
    requirements?: Requirement[];
    actions?: Action[];
    memoryUpdates?: { text: string; sourceIds: string[] }[];
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    cost: number | null;
  };
  prototype?: {
    projectId: string;
    versionId: string;
    code: string;
    prd: string;
    title: string;
  };
  error?: string;
  createdAt: string;
  completedAt?: string;
};
type Evaluation = {
  id: string;
  title: string;
  createdAt: string;
  status: string;
  sampleSize?: number;
  cases?: {
    id: string;
    prompt: string;
    baseline?: unknown;
    agent?: unknown;
    checks?: unknown;
  }[];
  metrics?: {
    name: string;
    baseline: unknown;
    agent: unknown;
    unit?: string;
    definition?: string;
    note?: string;
  }[];
  limitations?: string[];
  rawFiles?: string[];
};
type Settings = {
  provider: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
};
type Boot = {
  projects: Project[];
  runs: Run[];
  evaluations: Evaluation[];
  runtime: {
    installed: boolean;
    version?: string;
    provider?: string;
    model?: string;
    foundryAvailable?: boolean;
  };
  settings: Settings;
};
type SourceRef = Source & { runId: string; key: string };

const pages: {
  id: Page;
  label: string;
  icon: typeof LayoutDashboard;
  section: string;
}[] = [
  {
    id: "overview",
    label: "项目总览",
    icon: LayoutDashboard,
    section: "工作空间",
  },
  {
    id: "research",
    label: "研究对话",
    icon: MessageSquare,
    section: "工作空间",
  },
  { id: "evidence", label: "证据库", icon: BookOpen, section: "交付与验证" },
  {
    id: "requirements",
    label: "需求草稿",
    icon: FileText,
    section: "交付与验证",
  },
  { id: "prototypes", label: "交互原型", icon: Box, section: "交付与验证" },
  { id: "tasks", label: "跟进待办", icon: ListChecks, section: "交付与验证" },
  {
    id: "evaluation",
    label: "真实评测",
    icon: FlaskConical,
    section: "交付与验证",
  },
];
const labels: Record<string, string> = {
  queued: "等待执行",
  running: "正在研究",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
};
const kindLabels: Record<string, string> = {
  research: "竞品研究",
  prototype: "原型制作",
  recall: "记忆回顾",
};
function isBusy(run?: Run) {
  return !!run && ["queued", "running"].includes(run.status);
}
function date(value?: string, short = false) {
  return value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        ...(short ? {} : { hour: "2-digit", minute: "2-digit" }),
        timeZone: "Asia/Shanghai",
      })
    : "—";
}
function metric(value: unknown) {
  if (value == null) return "未测量";
  if (typeof value === "number") return num(value);
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (v.amount == null && ("amount" in v || "cost" in v)) return "未计价";
    return (
      Object.entries(v)
        .filter(([, entry]) => typeof entry === "number")
        .map(([key, entry]) => `${key}: ${num(entry as number)}`)
        .join(" / ") || "见原始记录"
    );
  }
  return String(value);
}
function safePreview(code: string) {
  return (
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">` +
    code
  );
}
function num(value?: number) {
  return value == null
    ? "未记录"
    : new Intl.NumberFormat("zh-CN").format(value);
}
function domain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "未知来源";
  }
}
function initials(name: string) {
  return name.trim().slice(0, 1) || "项";
}
function Markdown({ text }: { text?: string }) {
  return (
    <div className="ag-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text || ""}</ReactMarkdown>
    </div>
  );
}
function Status({ run }: { run: Run }) {
  return (
    <span className={`ag-status ${run.status}`}>
      {isBusy(run) ? (
        <Loader2 size={12} className="ag-spin" />
      ) : run.status === "completed" ? (
        <CheckCircle2 size={12} />
      ) : run.status === "failed" ? (
        <AlertCircle size={12} />
      ) : (
        <Circle size={10} />
      )}
      {labels[run.status]}
    </span>
  );
}
function Empty({
  icon: Icon = Compass,
  title,
  description,
  children,
}: {
  icon?: typeof Compass;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="ag-empty">
      <div className="ag-empty-icon">
        <Icon size={25} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}

export default function AgentApp() {
  const [boot, setBoot] = useState<Boot | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [locked, setLocked] = useState(false);
  const [projectId, setProjectId] = useState(""),
    [page, setPage] = useState<Page>("overview"),
    [runId, setRunId] = useState(""),
    [sourceKey, setSourceKey] = useState("");
  const [projectModal, setProjectModal] = useState<"new" | "edit" | null>(null),
    [mobileNav, setMobileNav] = useState(false),
    [projectMenu, setProjectMenu] = useState(false);
  const [prompt, setPrompt] = useState(""),
    [sourceUrls, setSourceUrls] = useState(""),
    [showSources, setShowSources] = useState(false),
    [submitting, setSubmitting] = useState(false),
    [toast, setToast] = useState(""),
    [savingMemory, setSavingMemory] = useState("");
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID()),
    [taskFilter, setTaskFilter] = useState("open"),
    [prototypeTab, setPrototypeTab] = useState("preview"),
    [evalId, setEvalId] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null),
    contentRef = useRef<HTMLElement>(null);
  async function api(path: string, options: RequestInit = {}) {
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    const data = await response
      .json()
      .catch(() => ({ error: `服务返回异常（${response.status}）` }));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) setLocked(true);
      throw new Error(data.error || "请求失败，请稍后重试");
    }
    return data;
  }
  async function refresh(initial = false) {
    try {
      const data: Boot = await api("/agent/bootstrap");
      setBoot(data);
      setLocked(false);
      setError("");
      if (initial) readHash(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  function readHash(data: Boot) {
    const hash = new URLSearchParams(location.hash.slice(1));
    const complete = data.runs
      .filter(
        (r) =>
          r.kind === "research" &&
          r.status === "completed" &&
          data.projects.some((p) => p.id === r.projectId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const selected =
      data.projects.find((p) => p.id === hash.get("project"))?.id ||
      complete[0]?.projectId ||
      data.projects[0]?.id ||
      "";
    const nextPage = hash.get("page") as Page;
    const validPage = [...pages.map((v) => v.id), "settings"].includes(nextPage)
      ? nextPage
      : "overview";
    const projectRuns = data.runs.filter((r) => r.projectId === selected);
    const nextRun =
      projectRuns.find((r) => r.id === hash.get("run"))?.id ||
      (hash.get("run") === "new" && validPage === "research"
        ? "new"
        : complete.find((r) => r.projectId === selected)?.id || "");
    const nextSource =
      projectRuns
        .flatMap((r) => (r.sources || []).map((s) => `${r.id}:${s.id}`))
        .find((key) => key === hash.get("source")) || "";
    setProjectId(selected);
    setPage(validPage);
    setRunId(nextRun);
    setSourceKey(nextSource);
    setProjectMenu(false);
    setMobileNav(false);
    contentRef.current?.scrollTo({ top: 0 });
  }
  useEffect(() => {
    void refresh(true);
  }, []);
  useEffect(() => {
    if (!boot) return;
    const sync = () => readHash(boot);
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [boot]);
  useEffect(() => {
    if (!boot) return;
    const h = new URLSearchParams({ project: projectId, page });
    if (runId) h.set("run", runId);
    if (sourceKey) h.set("source", sourceKey);
    history.replaceState(
      null,
      "",
      `${location.pathname}${location.search}#${h.toString()}`,
    );
  }, [projectId, page, runId, sourceKey, !!boot]);
  useEffect(() => {
    if (!boot?.runs.some(isBusy)) return;
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [boot?.runs.some(isBusy)]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setProjectModal(null);
        setProjectMenu(false);
        setMobileNav(false);
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, []);
  const project =
    boot?.projects.find((p) => p.id === projectId) || boot?.projects[0];
  const runs = useMemo(
    () =>
      (boot?.runs || [])
        .filter((r) => r.projectId === project?.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [boot?.runs, project?.id],
  );
  const selectedRun =
    runId === "new"
      ? undefined
      : runs.find((r) => r.id === runId && r.kind !== "prototype") ||
        runs.find((r) => r.kind === "research" && r.status === "completed") ||
        runs.find((r) => r.kind !== "prototype");
  const sources = useMemo(
    () =>
      runs
        .filter((r) => r.kind !== "prototype")
        .flatMap((r) =>
          (r.sources || []).map((s) => ({
            ...s,
            runId: r.id,
            key: `${r.id}:${s.id}`,
          })),
        ),
    [runs],
  );
  const requirements = runs
    .filter((r) => r.kind !== "prototype" && r.status === "completed")
    .flatMap((r) =>
      (r.result?.requirements || []).map((q) => ({ ...q, run: r })),
    );
  const actions = runs
    .filter((r) => r.kind !== "prototype" && r.status === "completed")
    .flatMap((r) => (r.result?.actions || []).map((a) => ({ ...a, run: r })));
  const prototypes = runs.filter((r) => r.prototype);
  const selectedPrototype =
    prototypes.find((r) => r.id === runId) || prototypes[0];
  const selectedSource = sources.find((s) => s.key === sourceKey) || sources[0];
  const evaluation =
    boot?.evaluations.find((e) => e.id === evalId) || boot?.evaluations[0];
  const activeRuns = runs.filter(isBusy),
    completeRuns = runs.filter((r) => r.status === "completed");
  const modelReady =
    boot?.settings.provider === "codex" ||
    (boot?.settings.provider === "openai" && boot.settings.hasApiKey);
  function navigate(next: Page, id?: string) {
    setPage(next);
    if (id !== undefined) setRunId(id);
    setMobileNav(false);
    contentRef.current?.scrollTo({ top: 0 });
  }
  function chooseProject(id: string) {
    setProjectId(id);
    setRunId("");
    setSourceKey("");
    setProjectMenu(false);
    setSessionId(crypto.randomUUID());
  }
  function seed(text: string, recall = false) {
    setPrompt(text);
    setRunId("new");
    navigate("research");
    if (recall) setShowSources(false);
    setTimeout(() => composer.current?.focus(), 100);
  }
  function viewSource(id: string, from: Run) {
    const source = from.sources?.find((s) => s.id === id);
    if (source) {
      setSourceKey(`${from.id}:${id}`);
      navigate("evidence", from.id);
    } else setToast("这条引用尚未关联到已抓取的证据");
  }
  function sourceChips(ids: string[] | undefined, from: Run) {
    return (
      !!ids?.length && (
        <div className="ag-source-chips">
          {ids.map((id) => (
            <button key={id} onClick={() => viewSource(id, from)}>
              <Link2 size={12} />
              {from.sources?.find((s) => s.id === id)?.title || id}
              <ArrowUpRight size={11} />
            </button>
          ))}
        </div>
      )
    );
  }
  async function submit(kind: "research" | "recall" = "research") {
    if (!project || !prompt.trim() || submitting) return;
    if (prompt.trim().length < 5) {
      setToast("请至少输入 5 个字符，描述你的研究目标");
      return;
    }
    const urls = sourceUrls
      .split(/\n|,|，/)
      .map((v) => v.trim())
      .filter(Boolean);
    if (urls.length > 4) {
      setToast("每次研究最多指定 4 个参考来源，请保留最重要的链接");
      return;
    }
    if (
      urls.some((value) => {
        try {
          return !["http:", "https:"].includes(new URL(value).protocol);
        } catch {
          return true;
        }
      })
    ) {
      setToast("来源请填写完整的 HTTP 或 HTTPS 链接");
      return;
    }
    if (!modelReady) {
      navigate("settings");
      setToast("连接模型后即可开始真实研究");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const run: Run = await api(
        kind === "recall"
          ? `/agent/projects/${project.id}/recall`
          : "/agent/runs",
        {
          method: "POST",
          body: JSON.stringify({
            projectId: project.id,
            prompt: prompt.trim(),
            kind,
            sessionId,
            sourceUrls: urls,
          }),
        },
      );
      setBoot((b) =>
        b ? { ...b, runs: [run, ...b.runs.filter((r) => r.id !== run.id)] } : b,
      );
      setRunId(run.id);
      setPrompt("");
      setSourceUrls("");
      setSessionId(run.sessionId || sessionId);
      navigate("research");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }
  async function cancel(run: Run) {
    try {
      await api(`/agent/runs/${run.id}/cancel`, { method: "POST" });
      await refresh();
      setToast("已发送取消请求，已保存的证据和记录会保留");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function generatePrototype(run: Run) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const next: Run = await api(`/agent/runs/${run.id}/prototype`, {
        method: "POST",
      });
      setBoot((b) => (b ? { ...b, runs: [next, ...b.runs] } : b));
      setRunId(next.id);
      navigate("prototypes");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }
  async function toggleAction(action: Action & { run: Run }) {
    try {
      await api(`/agent/runs/${action.run.id}/actions/${action.id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: !action.done }),
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function confirmMemory(
    run: Run,
    item: { text: string; sourceIds: string[] },
    index: number,
  ) {
    if (!project || savingMemory) return;
    if (project.memory.some((m) => m.text.trim() === item.text.trim())) {
      setToast("这条记忆已经保存");
      return;
    }
    if (project.memory.length >= 30) {
      setToast("项目已有 30 条记忆，请先整理或移除过时内容");
      setProjectModal("edit");
      return;
    }
    if (!item.text.trim() || item.text.length > 2000) {
      setError("候选记忆内容为空或超出长度，请在项目记忆中手动整理");
      return;
    }
    setSavingMemory(`${run.id}:${index}`);
    try {
      await api(`/agent/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          memory: [
            ...project.memory,
            {
              id: crypto.randomUUID(),
              text: item.text.trim(),
              source:
                `用户确认 · 研究 ${run.id} · 证据 ${(item.sourceIds || []).join(", ")}`.slice(
                  0,
                  300,
                ),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      });
      await refresh();
      setToast("已确认并保存到项目记忆，下一次研究会读取这条信息");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingMemory("");
    }
  }
  function runFooter(run: Run) {
    return (
      <div className="ag-run-footer">
        <span>
          <Terminal size={13} />
          {num(run.usage?.inputTokens)} 输入 · {num(run.usage?.outputTokens)}{" "}
          输出 Token
        </span>
        <span>
          {run.usage?.cost == null ? "费用未计价" : `${run.usage.cost} 元`}
        </span>
        <a href={`/api/agent/runs/${run.id}/export`}>
          <ArrowDownToLine size={13} />
          导出原始记录
        </a>
      </div>
    );
  }

  if (loading)
    return (
      <div className="ag-app ag-start">
        <div className="ag-brand-mark">亦</div>
        <h2>亦伴</h2>
        <p>
          <Loader2 size={15} className="ag-spin" />
          正在载入你的工作空间
        </p>
      </div>
    );
  if (locked)
    return (
      <Login
        onLogin={async (password) => {
          await api("/login", {
            method: "POST",
            body: JSON.stringify({ password }),
          });
          await refresh(true);
        }}
      />
    );
  if (!boot)
    return (
      <div className="ag-app ag-start">
        <AlertCircle size={32} />
        <h2>工作空间暂时无法连接</h2>
        <p>{error}</p>
        <button
          className="ag-button primary"
          onClick={() => {
            setLoading(true);
            void refresh(true);
          }}
        >
          <RefreshCw size={15} />
          重新连接
        </button>
      </div>
    );

  function pageHeading(
    eyebrow: string,
    title: string,
    description: string,
    action?: React.ReactNode,
  ) {
    return (
      <div className="ag-page-heading">
        <div>
          <div className="ag-eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {action}
      </div>
    );
  }
  function taskProgress(run: Run) {
    return (
      <div className="ag-progress">
        <div className="ag-progress-head">
          <span className="ag-agent-avatar">
            <Sparkles size={15} />
          </span>
          <div>
            <b>
              {run.kind === "prototype"
                ? "造物正在制作原型"
                : "亦伴正在推进研究"}
            </b>
            <small>{run.stage || "准备任务上下文"}</small>
          </div>
          <button
            className="ag-button ghost small"
            onClick={() => void cancel(run)}
          >
            <Square size={12} />
            取消任务
          </button>
        </div>
        <div className="ag-progress-steps">
          {(run.events || []).slice(-6).map((event, i) => (
            <div key={`${event.at}-${i}`}>
              <span className="ag-event-dot" />
              <span>{event.message}</span>
              <time>{date(event.at)}</time>
            </div>
          ))}
          {!run.events?.length && <p>任务已提交，等待运行器开始执行。</p>}
        </div>
      </div>
    );
  }
  function runLinks(run: Run) {
    return (
      <div className="ag-result-links">
        <button
          onClick={() => {
            setSourceKey(
              run.sources?.[0] ? `${run.id}:${run.sources[0].id}` : "",
            );
            navigate("evidence", run.id);
          }}
        >
          <BookOpen size={15} />
          查看 {run.sources?.length || 0} 条证据
          <ArrowUpRight size={14} />
        </button>
        <button onClick={() => navigate("requirements", run.id)}>
          <FileText size={15} />
          需求草稿
          <ArrowUpRight size={14} />
        </button>
        {!!run.result?.requirements?.length && (
          <button
            onClick={() => void generatePrototype(run)}
            disabled={submitting || !boot!.runtime.foundryAvailable}
          >
            <Box size={15} />
            交给造物制作
            <ArrowRight size={14} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="ag-app">
      {mobileNav && (
        <div className="ag-nav-backdrop" onClick={() => setMobileNav(false)} />
      )}
      <aside className={`ag-sidebar ${mobileNav ? "open" : ""}`}>
        <a
          className="ag-brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <span className="ag-brand-mark">亦</span>
          <span>
            <b>亦伴</b>
            <small>PERSONAL PRODUCT AGENT</small>
          </span>
          <span className="ag-brand-version">01</span>
        </a>
        <div className="ag-project-select">
          <button
            className="ag-project-trigger"
            onClick={() => setProjectMenu(!projectMenu)}
          >
            <span className="ag-project-avatar">
              {initials(project?.name || "项目")}
            </span>
            <span>
              <small>当前项目</small>
              <b>{project?.name || "创建你的第一个项目"}</b>
            </span>
            <ChevronDown size={15} />
          </button>
          {projectMenu && (
            <div className="ag-project-menu">
              {boot.projects.map((p) => (
                <button key={p.id} onClick={() => chooseProject(p.id)}>
                  <span>{p.name}</span>
                  {p.id === project?.id && <Check size={15} />}
                </button>
              ))}
              <button
                onClick={() => {
                  setProjectModal("new");
                  setProjectMenu(false);
                }}
              >
                <Plus size={15} />
                新建项目
              </button>
            </div>
          )}
        </div>
        <button
          className="ag-new-research"
          onClick={() => {
            setRunId("");
            setSessionId(crypto.randomUUID());
            seed("");
          }}
        >
          <Plus size={16} />
          开始新的研究<span>↗</span>
        </button>
        <nav className="ag-nav">
          {["工作空间", "交付与验证"].map((section) => (
            <div key={section}>
              <div className="ag-nav-section">{section}</div>
              {pages
                .filter((v) => v.section === section)
                .map(({ id, label, icon: Icon }) => (
                  <button
                    className={page === id ? "active" : ""}
                    onClick={() => navigate(id)}
                    key={id}
                  >
                    <Icon size={18} />
                    <span>{label}</span>
                    {id === "tasks" &&
                      !!actions.filter((a) => !a.done).length && (
                        <span className="ag-nav-count">
                          {actions.filter((a) => !a.done).length}
                        </span>
                      )}
                    {id === "evidence" && !!sources.length && (
                      <span className="ag-nav-count">{sources.length}</span>
                    )}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="ag-recent">
          <div className="ag-nav-section">
            最近研究 <History size={12} />
          </div>
          {runs
            .filter((r) => r.kind !== "prototype")
            .slice(0, 3)
            .map((r) => (
              <button
                key={r.id}
                className={
                  selectedRun?.id === r.id && page === "research"
                    ? "active"
                    : ""
                }
                onClick={() => navigate("research", r.id)}
              >
                <span className={`ag-recent-dot ${r.status}`} />
                <span>{r.prompt}</span>
              </button>
            ))}
          {!runs.length && <p>你的研究记录会保存在这里</p>}
        </div>
        <div className="ag-sidebar-footer">
          <button
            className={`ag-settings-link ${page === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={17} />
            <span>模型与运行设置</span>
            <span className={`ag-online-dot ${modelReady ? "ready" : ""}`} />
          </button>
          <div className="ag-profile">
            <div>Y</div>
            <span>
              <b>我的个人工作空间</b>
              <small>研究有证据 · 决策有来由</small>
            </span>
            <ShieldCheck size={17} />
          </div>
        </div>
      </aside>
      <div className="ag-main-shell">
        <header className="ag-topbar">
          <div className="ag-breadcrumb">
            <button
              className="ag-mobile-menu"
              aria-label="打开导航"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={21} />
            </button>
            <FolderOpen size={15} />
            <span>{project?.name || "我的工作空间"}</span>
            <ChevronRight size={13} />
            <b>{pages.find((v) => v.id === page)?.label || "模型设置"}</b>
          </div>
          <div className="ag-topbar-right">
            <span className="ag-model-pill">
              <span className={`ag-online-dot ${modelReady ? "ready" : ""}`} />
              {boot.settings.provider === "codex"
                ? "本机 Codex"
                : boot.settings.provider === "openai"
                  ? boot.settings.model || "API 模型"
                  : "待连接模型"}
            </span>
            <button
              className="ag-icon-button"
              aria-label="编辑项目背景"
              title="编辑项目背景"
              onClick={() => setProjectModal(project ? "edit" : "new")}
            >
              <Pencil size={16} />
            </button>
          </div>
        </header>
        <main ref={contentRef} className={`ag-content ag-page-${page}`}>
          {error && (
            <div className="ag-error">
              <AlertCircle size={17} />
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="关闭错误">
                <X size={15} />
              </button>
            </div>
          )}
          {!project && page !== "settings" && page !== "evaluation" ? (
            <div className="ag-onboarding">
              {pageHeading(
                "YOUR FIRST WORKSPACE",
                "先给亦伴一点项目背景",
                "建立一个项目档案，研究、需求和原型从此有共同的上下文。",
              )}
              <Empty
                icon={FolderOpen}
                title="你的项目，从这里开始"
                description="写下目标用户、正在解决的问题和约束。亦伴会在每次研究中读取这些背景，你可以随时更正。"
              >
                <button
                  className="ag-button primary"
                  onClick={() => setProjectModal("new")}
                >
                  <Plus size={15} />
                  创建项目
                </button>
              </Empty>
            </div>
          ) : (
            <>
              {page === "overview" && project && (
                <>
                  <div className="ag-overview-heading">
                    <div>
                      <div className="ag-eyebrow">
                        YOUR PRODUCT, WITH CONTEXT
                      </div>
                      <h1>
                        把研究，推进成决策<span>。</span>
                      </h1>
                      <p>围绕 {project.name}，让每一条证据连接到下一步行动。</p>
                    </div>
                    <button
                      className="ag-button light"
                      onClick={() => setProjectModal("edit")}
                    >
                      <Pencil size={14} />
                      编辑项目背景
                    </button>
                  </div>
                  <section className="ag-hero">
                    <div className="ag-hero-art" aria-hidden="true">
                      <div className="ag-orbit one" />
                      <div className="ag-orbit two" />
                      <div className="ag-orbit three" />
                      <div className="ag-orbit-core">
                        <Sparkles size={25} />
                      </div>
                      <div className="ag-orbit-point p1">
                        <BookOpen size={16} />
                      </div>
                      <div className="ag-orbit-point p2">
                        <Box size={17} />
                      </div>
                      <div className="ag-orbit-point p3">
                        <FileText size={16} />
                      </div>
                    </div>
                    <div className="ag-hero-copy">
                      <span className="ag-hero-label">
                        <span />
                        懂你的项目，记得你的判断
                      </span>
                      <h2>
                        从一个问题开始，
                        <br />
                        到一个可验证的产品。
                      </h2>
                      <p>
                        查竞品、判断价值、写需求、做原型。
                        <br />
                        亦伴帮你把工作接起来，结论始终留有依据。
                      </p>
                      <button
                        className="ag-button hero"
                        onClick={() =>
                          seed(
                            `研究一个适合 ${project.name} 参考的新竞品，结合项目目标判断值得借鉴的能力，形成带证据的需求草稿和后续验证待办。`,
                          )
                        }
                      >
                        开始一次研究
                        <ArrowUpRight size={16} />
                      </button>
                    </div>
                  </section>
                  <div className="ag-stat-grid">
                    {[
                      {
                        label: "完成的研究",
                        value: completeRuns.filter(
                          (r) => r.kind !== "prototype",
                        ).length,
                        icon: MessageSquare,
                        detail: `${activeRuns.length} 个任务执行中`,
                        page: "research",
                      },
                      {
                        label: "已保存的证据",
                        value: sources.filter((s) => s.status !== "failed")
                          .length,
                        icon: BookOpen,
                        detail: "原文与来源可追溯",
                        page: "evidence",
                      },
                      {
                        label: "形成的需求",
                        value: requirements.length,
                        icon: FileText,
                        detail: `${prototypes.length} 个原型版本`,
                        page: "requirements",
                      },
                      {
                        label: "待跟进的行动",
                        value: actions.filter((a) => !a.done).length,
                        icon: ListChecks,
                        detail: `${actions.filter((a) => a.done).length} 项已完成`,
                        page: "tasks",
                      },
                    ].map((item) => (
                      <button
                        className="ag-stat-card"
                        key={item.label}
                        onClick={() => navigate(item.page as Page)}
                      >
                        <span className="ag-stat-label">
                          {item.label}
                          <item.icon size={17} />
                        </span>
                        <strong>
                          {item.value.toString().padStart(2, "0")}
                        </strong>
                        <span className="ag-stat-detail">
                          {item.detail}
                          <ArrowUpRight size={13} />
                        </span>
                      </button>
                    ))}
                  </div>
                  {!!activeRuns.length && (
                    <div className="ag-active-banner">
                      <Loader2 size={19} className="ag-spin" />
                      <div>
                        <b>{activeRuns[0].stage || "亦伴正在执行任务"}</b>
                        <span>{activeRuns[0].prompt}</span>
                      </div>
                      <button
                        onClick={() =>
                          navigate(
                            activeRuns[0].kind === "prototype"
                              ? "prototypes"
                              : "research",
                            activeRuns[0].id,
                          )
                        }
                      >
                        查看进度
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                  <div className="ag-overview-grid">
                    <section className="ag-panel">
                      <div className="ag-panel-heading">
                        <h2>
                          最近的工作<span>RECENT WORK</span>
                        </h2>
                        <button onClick={() => navigate("research")}>
                          查看全部
                          <ArrowRight size={14} />
                        </button>
                      </div>
                      {runs.length ? (
                        <div className="ag-work-list">
                          {runs.slice(0, 4).map((r) => (
                            <button
                              key={r.id}
                              onClick={() =>
                                navigate(
                                  r.kind === "prototype"
                                    ? "prototypes"
                                    : "research",
                                  r.id,
                                )
                              }
                            >
                              <span className={`ag-work-icon ${r.kind}`}>
                                {r.kind === "prototype" ? (
                                  <Box size={18} />
                                ) : r.kind === "recall" ? (
                                  <Brain size={18} />
                                ) : (
                                  <Compass size={18} />
                                )}
                              </span>
                              <span className="ag-work-copy">
                                <b>{r.prompt}</b>
                                <small>
                                  {kindLabels[r.kind]} · {date(r.createdAt)} ·{" "}
                                  {r.sources?.length || 0} 条证据
                                </small>
                              </span>
                              <Status run={r} />
                              <ChevronRight size={16} />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="ag-first-work">
                          <Compass size={27} />
                          <h3>还没有研究记录</h3>
                          <p>
                            试着让亦伴研究一个新竞品。
                            <br />
                            它会结合项目背景，留下判断与证据。
                          </p>
                          <button
                            onClick={() =>
                              seed(
                                `研究 ${project.name} 的一个新竞品，分析哪些能力值得借鉴。`,
                              )
                            }
                          >
                            创建第一条研究
                            <ArrowRight size={14} />
                          </button>
                        </div>
                      )}
                    </section>
                    <section className="ag-panel ag-project-context">
                      <div className="ag-panel-heading">
                        <h2>
                          亦伴眼中的项目<span>PROJECT CONTEXT</span>
                        </h2>
                        <button
                          onClick={() => setProjectModal("edit")}
                          aria-label="编辑项目"
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                      <div className="ag-context-body">
                        <span className="ag-context-label">当前目标</span>
                        <p>
                          {project.goal ||
                            "还未设置项目目标，补充后研究判断会更具体。"}
                        </p>
                        <span className="ag-context-label">已知背景</span>
                        <p className="ag-clamp-3">
                          {project.background ||
                            "添加目标用户、核心场景和当前进展。"}
                        </p>
                        <div className="ag-memory-summary">
                          <Brain size={16} />
                          <span>
                            已保存 <b>{project.memory?.length || 0}</b>{" "}
                            条项目记忆
                          </span>
                          <button onClick={() => setProjectModal("edit")}>
                            查看与更正
                            <ArrowUpRight size={12} />
                          </button>
                        </div>
                      </div>
                    </section>
                  </div>
                  <div className="ag-workflow">
                    <div>
                      <span className="ag-eyebrow">
                        ONE CONTINUOUS WORKFLOW
                      </span>
                      <h2>研究不止于一份报告</h2>
                    </div>
                    <div className="ag-workflow-steps">
                      {[
                        {
                          n: "01",
                          title: "获取证据",
                          subtitle: "搜索与原文存档",
                          icon: Search,
                          page: "evidence",
                        },
                        {
                          n: "02",
                          title: "做出判断",
                          subtitle: "结合背景分析价值",
                          icon: Compass,
                          page: "research",
                        },
                        {
                          n: "03",
                          title: "形成需求",
                          subtitle: "关联证据与验收条件",
                          icon: FileText,
                          page: "requirements",
                        },
                        {
                          n: "04",
                          title: "验证与跟进",
                          subtitle: "原型、待办与下一轮",
                          icon: Box,
                          page: "prototypes",
                        },
                      ].map((s) => (
                        <button
                          key={s.n}
                          onClick={() => navigate(s.page as Page)}
                        >
                          <small>{s.n}</small>
                          <s.icon size={19} />
                          <b>{s.title}</b>
                          <span>{s.subtitle}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {page === "research" && (
                <>
                  {pageHeading(
                    "RESEARCH WITH CONTEXT",
                    "研究工作台",
                    "提出问题，查看过程。让证据、项目背景和你的判断汇合在这里。",
                    <button
                      className="ag-button light"
                      onClick={() => {
                        setRunId("new");
                        setSessionId(crypto.randomUUID());
                        setPrompt("");
                        composer.current?.focus();
                        setToast("已开始新会话，项目背景与记忆仍会保留");
                      }}
                    >
                      <Plus size={14} />
                      新会话
                    </button>,
                  )}
                  <div className="ag-research-grid">
                    <div className="ag-research-main">
                      {!!runs.filter((r) => r.kind !== "prototype").length && (
                        <div className="ag-run-picker">
                          <History size={14} />
                          <select
                            value={selectedRun?.id || ""}
                            onChange={(e) => setRunId(e.target.value)}
                            aria-label="选择研究记录"
                          >
                            {runs
                              .filter((r) => r.kind !== "prototype")
                              .map((r) => (
                                <option key={r.id} value={r.id}>
                                  {date(r.createdAt)} · {r.prompt.slice(0, 70)}
                                </option>
                              ))}
                          </select>
                          <ChevronDown size={13} />
                        </div>
                      )}
                      <div className="ag-conversation">
                        {selectedRun ? (
                          <>
                            <div className="ag-user-message">
                              <span className="ag-user-avatar">我</span>
                              <div>
                                <div className="ag-message-meta">
                                  你的研究目标
                                  <time>{date(selectedRun.createdAt)}</time>
                                </div>
                                <p>{selectedRun.prompt}</p>
                              </div>
                            </div>
                            {isBusy(selectedRun) ? (
                              taskProgress(selectedRun)
                            ) : (
                              <div className="ag-agent-message">
                                <div className="ag-message-head">
                                  <span className="ag-agent-avatar">
                                    <Sparkles size={16} />
                                  </span>
                                  <b>亦伴</b>
                                  <span>项目研究助理</span>
                                  <Status run={selectedRun} />
                                </div>
                                {selectedRun.error && (
                                  <div className="ag-inline-error">
                                    <AlertCircle size={17} />
                                    <div>
                                      <b>这次任务没有完成</b>
                                      <p>{selectedRun.error}</p>
                                      <button
                                        onClick={() =>
                                          setPrompt(selectedRun.prompt)
                                        }
                                      >
                                        保留问题，重新尝试
                                        <RefreshCw size={13} />
                                      </button>
                                    </div>
                                  </div>
                                )}
                                {selectedRun.result?.answer && (
                                  <Markdown text={selectedRun.result.answer} />
                                )}{" "}
                                {!!selectedRun.result?.valueJudgment && (
                                  <div className="ag-judgment">
                                    <span>
                                      <Compass size={16} />
                                      结合项目的价值判断
                                    </span>
                                    <Markdown
                                      text={selectedRun.result.valueJudgment}
                                    />
                                  </div>
                                )}
                                {!!selectedRun.result?.claims?.length && (
                                  <details className="ag-claims">
                                    <summary>
                                      核对关键事实与推断
                                      <span>
                                        {selectedRun.result.claims.length} 条
                                      </span>
                                      <ChevronDown size={14} />
                                    </summary>
                                    <div>
                                      {selectedRun.result.claims.map(
                                        (claim, i) => (
                                          <article key={i}>
                                            <span
                                              className={`ag-claim-kind ${claim.kind}`}
                                            >
                                              {claim.kind === "fact"
                                                ? "事实"
                                                : claim.kind === "inference"
                                                  ? "推断"
                                                  : "待核实"}
                                            </span>
                                            <p>{claim.text}</p>
                                            {sourceChips(
                                              claim.sourceIds,
                                              selectedRun,
                                            )}
                                          </article>
                                        ),
                                      )}
                                    </div>
                                  </details>
                                )}
                                {!!selectedRun.result?.memoryUpdates
                                  ?.length && (
                                  <section className="ag-memory-candidates">
                                    <div className="ag-candidate-heading">
                                      <Brain size={16} />
                                      <div>
                                        <h3>待你确认的项目记忆</h3>
                                        <p>
                                          这些是研究提出的候选信息。确认后才会保存到项目，供后续任务使用。
                                        </p>
                                      </div>
                                    </div>
                                    {selectedRun.result.memoryUpdates.map(
                                      (item, index) => {
                                        const saved = project?.memory.some(
                                          (m) =>
                                            m.text.trim() === item.text.trim(),
                                        );
                                        return (
                                          <article key={index}>
                                            <p>{item.text}</p>
                                            {sourceChips(
                                              item.sourceIds,
                                              selectedRun,
                                            )}
                                            <button
                                              className={`ag-button ${saved ? "ghost" : "light"} small`}
                                              disabled={
                                                saved ||
                                                !!savingMemory ||
                                                !!activeRuns.length
                                              }
                                              onClick={() =>
                                                void confirmMemory(
                                                  selectedRun,
                                                  item,
                                                  index,
                                                )
                                              }
                                            >
                                              {savingMemory ===
                                              `${selectedRun.id}:${index}` ? (
                                                <Loader2
                                                  size={13}
                                                  className="ag-spin"
                                                />
                                              ) : (
                                                <Check size={13} />
                                              )}{" "}
                                              {saved
                                                ? "已保存到项目"
                                                : "确认保存到项目"}
                                            </button>
                                          </article>
                                        );
                                      },
                                    )}
                                  </section>
                                )}
                                {selectedRun.status === "cancelled" && (
                                  <div className="ag-note">
                                    <Square size={14} />
                                    任务已取消。已抓取的来源和过程记录可以继续查看。
                                  </div>
                                )}
                                {selectedRun.status === "completed" &&
                                  !selectedRun.result?.answer && (
                                    <p className="ag-muted">
                                      任务完成，尚未返回研究正文。可查看原始记录。
                                    </p>
                                  )}
                                {runLinks(selectedRun)}
                                {runFooter(selectedRun)}
                                <details className="ag-logs">
                                  <summary>
                                    <History size={13} />
                                    完整执行记录
                                    <ChevronDown size={13} />
                                  </summary>
                                  {selectedRun.events?.map((e, i) => (
                                    <div key={i}>
                                      <time>{date(e.at)}</time>
                                      <span>{e.message}</span>
                                    </div>
                                  ))}
                                </details>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="ag-research-welcome">
                            <span className="ag-welcome-symbol">
                              <Sparkles size={29} />
                            </span>
                            <span className="ag-eyebrow">
                              YOUR RESEARCH PARTNER
                            </span>
                            <h2>今天，我们推进哪一个问题？</h2>
                            <p>
                              亦伴会先理解项目背景，再查资料、做判断。
                              <br />
                              需要原型时，再交给造物继续推进。
                            </p>
                            <div className="ag-starter-prompts">
                              {[
                                {
                                  icon: Search,
                                  title: "研究一个新竞品",
                                  text: `为 ${project?.name} 寻找一个值得关注的新竞品，查证其核心能力，判断可借鉴的方向并生成需求草稿。`,
                                },
                                {
                                  icon: Compass,
                                  title: "判断一项能力的价值",
                                  text: `结合 ${project?.name} 的项目背景，分析长期记忆能力是否值得优先建设。请区分事实与推断，并列出验证任务。`,
                                },
                                {
                                  icon: Brain,
                                  title: "回顾项目背景与记忆",
                                  text: "回顾这个项目的目标、约束和已保存决策，指出哪些信息仍然缺失或需要更正。",
                                },
                              ].map((s) => (
                                <button
                                  key={s.title}
                                  onClick={() => seed(s.text)}
                                >
                                  <s.icon size={19} />
                                  <span>{s.title}</span>
                                  <ArrowUpRight size={14} />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <form
                        className="ag-composer"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void submit();
                        }}
                      >
                        <textarea
                          ref={composer}
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          placeholder="描述你想研究的问题，例如：Rowboat 的项目记忆有哪些值得亦伴借鉴的地方？"
                          aria-label="研究问题"
                          rows={3}
                          onKeyDown={(e) => {
                            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                              e.preventDefault();
                              void submit();
                            }
                          }}
                        />
                        {showSources && (
                          <label className="ag-url-input">
                            <span>
                              指定参考来源（选填，最多 4 条，每行一个 URL）
                            </span>
                            <textarea
                              rows={2}
                              placeholder="https://github.com/…"
                              value={sourceUrls}
                              onChange={(e) => setSourceUrls(e.target.value)}
                            />
                          </label>
                        )}
                        <div className="ag-composer-bottom">
                          <div>
                            <button
                              type="button"
                              className={showSources ? "active" : ""}
                              onClick={() => setShowSources(!showSources)}
                            >
                              <Link2 size={15} />
                              添加来源
                              {sourceUrls.trim() && (
                                <span className="ag-small-dot" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => void submit("recall")}
                              disabled={!prompt.trim() || submitting}
                            >
                              <Brain size={15} />
                              记忆回顾
                            </button>
                          </div>
                          <button
                            className="ag-send"
                            type="submit"
                            disabled={!prompt.trim() || submitting}
                          >
                            {submitting ? (
                              <Loader2 size={16} className="ag-spin" />
                            ) : (
                              <ArrowUp size={17} />
                            )}
                            <span>{modelReady ? "开始研究" : "连接模型"}</span>
                          </button>
                        </div>
                        <div className="ag-composer-note">
                          <ShieldCheck size={12} />
                          发送后才会调用模型。费用以实际用量记录为准。
                          <span>⌘ Enter</span>
                        </div>
                      </form>
                    </div>
                    <aside className="ag-research-context">
                      <div className="ag-context-header">
                        <Brain size={17} />
                        <h3>这次研究的上下文</h3>
                      </div>
                      <div className="ag-side-context">
                        <span className="ag-context-label">项目目标</span>
                        <p>{project?.goal || "尚未设置"}</p>
                        <span className="ag-context-label">项目约束</span>
                        <p>{project?.constraints || "尚未设置明确约束"}</p>
                        <button
                          className="ag-text-button"
                          onClick={() => setProjectModal("edit")}
                        >
                          补充项目背景
                          <Pencil size={12} />
                        </button>
                      </div>
                      <div className="ag-side-memory">
                        <div className="ag-side-heading">
                          <h4>项目记忆</h4>
                          <span>{project?.memory?.length || 0}</span>
                        </div>
                        {project?.memory?.length ? (
                          project.memory.slice(-5).map((m) => (
                            <div key={m.id}>
                              <span />
                              <p>{m.text}</p>
                            </div>
                          ))
                        ) : (
                          <p className="ag-muted">
                            研究中确认的项目事实与判断会保存在这里，供下一次会话继续使用。
                          </p>
                        )}
                        <button
                          className="ag-text-button"
                          onClick={() => setProjectModal("edit")}
                        >
                          查看 / 更正记忆
                          <ArrowUpRight size={12} />
                        </button>
                      </div>
                      <div className="ag-side-explainer">
                        <Link2 size={17} />
                        <b>每一个结论，都能回到来源</b>
                        <p>
                          事实、推断与待核实项分别记录。点击引用可查看原文与抓取时间。
                        </p>
                      </div>
                    </aside>
                  </div>
                </>
              )}
              {page === "evidence" && (
                <>
                  {pageHeading(
                    "TRACE EVERY CLAIM",
                    "证据库",
                    "保存来源与原文。回到证据，才能检验结论。",
                    selectedRun && (
                      <a
                        className="ag-button light"
                        href={`/api/agent/runs/${selectedRun.id}/export`}
                      >
                        <ArrowDownToLine size={14} />
                        导出证据与记录
                      </a>
                    ),
                  )}
                  {sources.length ? (
                    <div className="ag-evidence-grid">
                      <div className="ag-source-list">
                        <div className="ag-list-label">
                          {sources.length} 条已记录来源
                        </div>
                        {sources.map((s) => (
                          <button
                            key={s.key}
                            className={
                              selectedSource?.key === s.key ? "active" : ""
                            }
                            onClick={() => setSourceKey(s.key)}
                          >
                            <div>
                              <span className="ag-source-domain">
                                <span>
                                  {domain(s.url).slice(0, 1).toUpperCase()}
                                </span>
                                {domain(s.url)}
                              </span>
                              <span className={`ag-source-state ${s.status}`}>
                                {s.status === "failed"
                                  ? "读取失败"
                                  : s.status === "fetched" ||
                                      s.status === "success"
                                    ? "已存档"
                                    : s.status || "已记录"}
                              </span>
                            </div>
                            <b>{s.title || s.url}</b>
                            <p>
                              {s.text?.slice(0, 130) ||
                                "没有抓取到原文，请检查来源与执行记录。"}
                            </p>
                            <small>
                              {date(s.fetchedAt)}
                              <ChevronRight size={13} />
                            </small>
                          </button>
                        ))}
                      </div>
                      {selectedSource && (
                        <section className="ag-source-reader">
                          <div className="ag-reader-meta">
                            <span>来源原文</span>
                            <button
                              className="ag-text-button"
                              onClick={() =>
                                navigate("research", selectedSource.runId)
                              }
                            >
                              回到相关研究
                              <ArrowUpRight size={13} />
                            </button>
                          </div>
                          <h2>{selectedSource.title || "未命名来源"}</h2>
                          <a
                            className="ag-source-url"
                            href={selectedSource.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {selectedSource.url}
                            <ExternalLink size={14} />
                          </a>
                          <div className="ag-evidence-meta">
                            <span>
                              <Clock3 size={13} />
                              抓取于 {date(selectedSource.fetchedAt)}
                            </span>
                            <span title={selectedSource.sha256 || "未记录摘要"}>
                              SHA256{" "}
                              {selectedSource.sha256?.slice(0, 12) || "未记录"}
                            </span>
                          </div>
                          {selectedSource.status === "failed" && (
                            <div className="ag-inline-error">
                              <AlertCircle size={17} />
                              <p>
                                该来源读取失败。它不能作为已验证事实的依据；请查看失败信息或更换来源。
                              </p>
                            </div>
                          )}
                          <div className="ag-original-text">
                            {selectedSource.text ||
                              "此来源没有可供查看的原文。"}
                          </div>
                        </section>
                      )}
                    </div>
                  ) : (
                    <Empty
                      icon={BookOpen}
                      title="证据会在这里积累"
                      description="发起一次研究，或给亦伴指定来源链接。抓取到的原文、时间和摘要都会跟随研究保存。"
                    >
                      <button
                        className="ag-button primary"
                        onClick={() => navigate("research")}
                      >
                        <Search size={15} />
                        开始研究
                      </button>
                    </Empty>
                  )}
                </>
              )}
              {page === "requirements" && (
                <>
                  {pageHeading(
                    "FROM FINDINGS TO REQUIREMENTS",
                    "需求草稿",
                    "把值得做的判断写成需求，把验证条件一并留下。",
                  )}
                  {requirements.length ? (
                    <div className="ag-requirement-list">
                      {requirements.map((q, i) => (
                        <article
                          className={`ag-requirement-card ${q.run.id === runId ? "highlight" : ""}`}
                          key={`${q.run.id}-${q.id}`}
                        >
                          <div className="ag-requirement-top">
                            <span className="ag-number">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <span className="ag-draft-label">需求草稿</span>
                            <time>{date(q.run.createdAt)}</time>
                            <button
                              className="ag-text-button"
                              onClick={() => navigate("research", q.run.id)}
                            >
                              研究依据
                              <ArrowUpRight size={13} />
                            </button>
                          </div>
                          <h2>{q.title}</h2>
                          <Markdown text={q.description} />
                          {sourceChips(q.sourceIds, q.run)}
                          <div className="ag-acceptance">
                            <b>
                              <CheckCircle2 size={15} />
                              验收与验证
                            </b>
                            {Array.isArray(q.acceptance) ? (
                              <ul>
                                {q.acceptance.map((a, j) => (
                                  <li key={j}>{a}</li>
                                ))}
                              </ul>
                            ) : (
                              <Markdown
                                text={
                                  q.acceptance ||
                                  "尚未提供验收条件，需要进一步明确。"
                                }
                              />
                            )}
                          </div>
                          <div className="ag-requirement-footer">
                            <span>来自：{q.run.prompt.slice(0, 70)}</span>
                            <button
                              className="ag-button light small"
                              onClick={() => void generatePrototype(q.run)}
                              disabled={
                                submitting || !boot.runtime.foundryAvailable
                              }
                            >
                              {submitting ? (
                                <Loader2 size={14} className="ag-spin" />
                              ) : (
                                <Box size={14} />
                              )}
                              用造物验证交互
                              <ArrowRight size={13} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon={FileText}
                      title="下一份需求，先从证据开始"
                      description="完成竞品研究与价值判断后，亦伴会生成与来源关联的需求草稿、验收条件和跟进任务。"
                    >
                      <button
                        className="ag-button primary"
                        onClick={() =>
                          seed(
                            "结合项目目标，研究一个值得借鉴的竞品功能，形成带来源和验收条件的需求草稿。",
                          )
                        }
                      >
                        研究并形成需求
                        <ArrowRight size={15} />
                      </button>
                    </Empty>
                  )}
                </>
              )}
              {page === "prototypes" && (
                <>
                  {pageHeading(
                    "BUILD TO VALIDATE",
                    "交互原型",
                    "由造物接着做，把需求变成可体验、可迭代的前端原型。",
                    <button
                      className="ag-button light"
                      disabled={
                        !runs.some(
                          (r) =>
                            r.kind !== "prototype" &&
                            r.status === "completed" &&
                            r.result?.requirements?.length,
                        ) ||
                        submitting ||
                        !boot.runtime.foundryAvailable
                      }
                      onClick={() => {
                        const r = runs.find(
                          (r) =>
                            r.kind !== "prototype" &&
                            r.status === "completed" &&
                            r.result?.requirements?.length,
                        );
                        if (r) void generatePrototype(r);
                      }}
                    >
                      <Plus size={14} />
                      从最新需求制作
                    </button>,
                  )}
                  {runs
                    .filter((r) => r.kind === "prototype" && isBusy(r))
                    .map((r) => (
                      <div className="ag-prototype-progress" key={r.id}>
                        {taskProgress(r)}
                      </div>
                    ))}
                  {runs
                    .filter(
                      (r) => r.kind === "prototype" && r.status === "failed",
                    )
                    .slice(0, 1)
                    .map((r) => (
                      <div className="ag-inline-error" key={r.id}>
                        <AlertCircle size={18} />
                        <div>
                          <b>原型制作未完成</b>
                          <p>{r.error || "查看完整记录以了解原因"}</p>
                          <a href={`/api/agent/runs/${r.id}/export`}>
                            下载执行记录
                          </a>
                        </div>
                      </div>
                    ))}
                  {selectedPrototype?.prototype ? (
                    <div className="ag-prototype-workspace">
                      <div className="ag-prototype-toolbar">
                        <div>
                          <Box size={17} />
                          <b>
                            {selectedPrototype.prototype.title || "项目原型"}
                          </b>
                          <select
                            aria-label="原型版本"
                            value={selectedPrototype.id}
                            onChange={(e) => setRunId(e.target.value)}
                          >
                            {prototypes.map((r, i) => (
                              <option key={r.id} value={r.id}>
                                版本 {prototypes.length - i} ·{" "}
                                {date(r.createdAt)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <a
                          className="ag-button light small"
                          href={`/api/agent/prototypes/${selectedPrototype.id}/download`}
                        >
                          <ArrowDownToLine size={14} />
                          下载源码
                        </a>
                      </div>
                      <div className="ag-prototype-tabs">
                        {[
                          { id: "preview", icon: Compass, title: "交互预览" },
                          { id: "code", icon: Code2, title: "原型源码" },
                          { id: "prd", icon: FileText, title: "需求说明" },
                        ].map((v) => (
                          <button
                            key={v.id}
                            className={prototypeTab === v.id ? "active" : ""}
                            onClick={() => setPrototypeTab(v.id)}
                          >
                            <v.icon size={14} />
                            {v.title}
                          </button>
                        ))}
                        <span>
                          <ShieldCheck size={12} />
                          隔离预览
                        </span>
                      </div>
                      {prototypeTab === "preview" ? (
                        <div className="ag-preview-frame">
                          <div className="ag-preview-browser">
                            <span />
                            <span />
                            <span />
                            <div>造物 · 原型预览</div>
                            <RefreshCw size={13} />
                          </div>
                          <iframe
                            title={`${selectedPrototype.prototype.title}交互原型`}
                            key={selectedPrototype.id}
                            srcDoc={safePreview(
                              selectedPrototype.prototype.code,
                            )}
                            sandbox="allow-scripts allow-forms allow-downloads"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      ) : prototypeTab === "code" ? (
                        <pre className="ag-code-view">
                          {selectedPrototype.prototype.code}
                        </pre>
                      ) : (
                        <div className="ag-prd-view">
                          <Markdown text={selectedPrototype.prototype.prd} />
                        </div>
                      )}
                      <div className="ag-prototype-bottom">
                        <span>
                          用于验证界面与交互；业务后端能力需要另行实现。
                        </span>
                        <div className="ag-prototype-record-links">
                          {selectedPrototype.parentRunId && (
                            <button
                              onClick={() =>
                                navigate(
                                  "research",
                                  selectedPrototype.parentRunId,
                                )
                              }
                            >
                              查看关联研究
                              <ArrowUpRight size={12} />
                            </button>
                          )}
                          <button
                            onClick={() =>
                              navigate("tasks", selectedPrototype.parentRunId)
                            }
                          >
                            跟进任务
                            <ArrowUpRight size={12} />
                          </button>
                          <a
                            href={`/api/agent/runs/${selectedPrototype.id}/export`}
                          >
                            查看制作记录
                            <ArrowUpRight size={12} />
                          </a>
                        </div>
                      </div>
                      <div className="ag-feedback">
                        <MessageSquare size={18} />
                        <div>
                          <b>体验后，把反馈交回研究</b>
                          <p>记录发现的问题与判断，接着形成下一轮需求。</p>
                        </div>
                        <button
                          className="ag-button light"
                          onClick={() =>
                            seed(
                              `我体验了原型「${selectedPrototype.prototype!.title}」，希望继续迭代。请先结合需求和已有证据梳理验证点，我会补充具体反馈：`,
                            )
                          }
                        >
                          继续反馈
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    !runs.some((r) => r.kind === "prototype" && isBusy(r)) && (
                      <Empty
                        icon={Box}
                        title="让需求有一个可体验的版本"
                        description={
                          boot.runtime.foundryAvailable
                            ? "先完成研究与需求草稿，再交给造物生成前端原型。每次制作都会保留版本、源码和过程记录。"
                            : "造物服务目前不可用，请在模型与运行设置中检查连接。需求和研究仍可以正常推进。"
                        }
                      >
                        <button
                          className="ag-button primary"
                          onClick={() => navigate("requirements")}
                        >
                          查看需求草稿
                          <ArrowRight size={15} />
                        </button>
                      </Empty>
                    )
                  )}
                </>
              )}
              {page === "tasks" && (
                <>
                  {pageHeading(
                    "KEEP THE WORK MOVING",
                    "跟进待办",
                    "让研究结论变成下一步行动。勾选完成状态，保留任务与证据的关联。",
                  )}
                  <div className="ag-task-summary">
                    <div>
                      <strong>{actions.filter((a) => !a.done).length}</strong>
                      <span>待跟进</span>
                    </div>
                    <div>
                      <strong>{actions.filter((a) => a.done).length}</strong>
                      <span>已完成</span>
                    </div>
                    <div>
                      <strong>{actions.length}</strong>
                      <span>总行动项</span>
                    </div>
                    <p>
                      <Clock3 size={15} />
                      待办状态保存在项目里。定时自动执行需另行配置。
                    </p>
                  </div>
                  <div className="ag-filter-tabs">
                    {[
                      { id: "open", title: "待跟进" },
                      { id: "done", title: "已完成" },
                      { id: "all", title: "全部" },
                    ].map((f) => (
                      <button
                        className={taskFilter === f.id ? "active" : ""}
                        key={f.id}
                        onClick={() => setTaskFilter(f.id)}
                      >
                        {f.title}
                      </button>
                    ))}
                  </div>
                  {actions.filter(
                    (a) =>
                      taskFilter === "all" ||
                      (taskFilter === "done" ? a.done : !a.done),
                  ).length ? (
                    <div className="ag-task-list">
                      {actions
                        .filter(
                          (a) =>
                            taskFilter === "all" ||
                            (taskFilter === "done" ? a.done : !a.done),
                        )
                        .map((a) => (
                          <article
                            key={`${a.run.id}-${a.id}`}
                            className={a.done ? "done" : ""}
                          >
                            <button
                              className="ag-checkbox"
                              aria-label={
                                a.done
                                  ? `将 ${a.title} 标记为未完成`
                                  : `完成 ${a.title}`
                              }
                              aria-pressed={a.done}
                              onClick={() => void toggleAction(a)}
                            >
                              {a.done && <Check size={13} />}
                            </button>
                            <div>
                              <h3>{a.title}</h3>
                              {sourceChips(a.sourceIds, a.run)}
                              <small>
                                来自 {kindLabels[a.run.kind]} ·{" "}
                                {date(a.run.createdAt)}
                              </small>
                            </div>
                            <button
                              className="ag-text-button"
                              onClick={() => navigate("research", a.run.id)}
                            >
                              相关研究
                              <ArrowUpRight size={13} />
                            </button>
                          </article>
                        ))}
                    </div>
                  ) : (
                    <Empty
                      icon={ListChecks}
                      title={
                        actions.length ? "这个列表已经清空" : "把下一步留在这里"
                      }
                      description={
                        actions.length
                          ? "切换筛选可查看其他行动项。"
                          : "研究完成后，验证、访谈和后续分析等行动项会自动归入项目待办。"
                      }
                    >
                      <button
                        className="ag-button light"
                        onClick={() => navigate("research")}
                      >
                        回到研究
                        <ArrowRight size={14} />
                      </button>
                    </Empty>
                  )}
                </>
              )}
              {page === "evaluation" && (
                <>
                  {pageHeading(
                    "MEASURE, DON'T ASSUME",
                    "真实评测",
                    "把改造前后的效果放在同一个尺度上。保留结果，也保留不确定性。",
                    evaluation && (
                      <a
                        className="ag-button light"
                        href={`/api/agent/evaluations/${evaluation.id}/export`}
                      >
                        <ArrowDownToLine size={14} />
                        下载评测与原始记录
                      </a>
                    ),
                  )}
                  {evaluation ? (
                    <>
                      <div className="ag-evaluation-intro">
                        <div>
                          <span className="ag-eval-badge">
                            <FlaskConical size={13} />
                            {evaluation.status === "measured"
                              ? "已实测"
                              : "部分实测"}
                          </span>
                          <h2>{evaluation.title}</h2>
                          <p>
                            {date(evaluation.createdAt)} ·{" "}
                            {evaluation.sampleSize ??
                              evaluation.cases?.length ??
                              0}{" "}
                            个测试案例 · 单次结果不能代表长期稳定性
                          </p>
                        </div>
                        {boot.evaluations.length > 1 && (
                          <select
                            value={evaluation.id}
                            onChange={(e) => setEvalId(e.target.value)}
                            aria-label="选择评测"
                          >
                            {boot.evaluations.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.title}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      <div className="ag-metric-table-wrap">
                        <table className="ag-metric-table">
                          <thead>
                            <tr>
                              <th>评测指标</th>
                              <th>改造前 / 基线</th>
                              <th>亦伴 Agent</th>
                              <th>如何理解结果</th>
                            </tr>
                          </thead>
                          <tbody>
                            {evaluation.metrics?.map((m, i) => (
                              <tr key={i}>
                                <td>
                                  <b>{m.name}</b>
                                  <small>{m.definition}</small>
                                </td>
                                <td>
                                  {m.baseline == null ? (
                                    <span className="ag-unmeasured">
                                      未测量
                                    </span>
                                  ) : (
                                    <strong>
                                      {metric(m.baseline)}
                                      <small>{m.unit}</small>
                                    </strong>
                                  )}
                                </td>
                                <td>
                                  {m.agent == null ? (
                                    <span className="ag-unmeasured">
                                      未测量
                                    </span>
                                  ) : (
                                    <strong className="ag-agent-metric">
                                      {metric(m.agent)}
                                      <small>{m.unit}</small>
                                    </strong>
                                  )}
                                </td>
                                <td>
                                  {m.note || "请结合样本与原始记录判断。"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!!evaluation.limitations?.length && (
                        <div className="ag-eval-limits">
                          <AlertCircle size={18} />
                          <div>
                            <h3>本次评测的边界</h3>
                            <ul>
                              {evaluation.limitations.map((l, i) => (
                                <li key={i}>{l}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}
                      <div className="ag-panel ag-eval-cases">
                        <div className="ag-panel-heading">
                          <h2>
                            测试案例与原始结果<span>RAW RECORDS</span>
                          </h2>
                          <span>{evaluation.cases?.length || 0} 个案例</span>
                        </div>
                        {evaluation.cases?.map((c, i) => (
                          <details key={c.id}>
                            <summary>
                              <span className="ag-number">
                                {String(i + 1).padStart(2, "0")}
                              </span>
                              <b>{c.prompt}</b>
                              <ChevronDown size={15} />
                            </summary>
                            <div className="ag-case-results">
                              <div>
                                <h4>改造前 / 基线</h4>
                                <pre>
                                  {typeof c.baseline === "string"
                                    ? c.baseline
                                    : JSON.stringify(c.baseline, null, 2)}
                                </pre>
                              </div>
                              <div>
                                <h4>亦伴 Agent</h4>
                                <pre>
                                  {typeof c.agent === "string"
                                    ? c.agent
                                    : JSON.stringify(c.agent, null, 2)}
                                </pre>
                              </div>
                              {c.checks != null && (
                                <div className="ag-case-checks">
                                  <h4>核查记录</h4>
                                  <pre>
                                    {typeof c.checks === "string"
                                      ? c.checks
                                      : JSON.stringify(c.checks, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </details>
                        ))}
                      </div>
                    </>
                  ) : (
                    <Empty
                      icon={FlaskConical}
                      title="没有实测，就不填成绩"
                      description="真实评测会比较任务完成、事实错误、人工干预、跨会话记忆和调用消耗。测试案例、评判规则与原始输出会一并保留。"
                    >
                      <button
                        className="ag-button light"
                        onClick={() => navigate("research")}
                      >
                        先完成一次真实研究
                        <ArrowRight size={15} />
                      </button>
                    </Empty>
                  )}
                </>
              )}
              {page === "settings" && (
                <>
                  {pageHeading(
                    "MAKE IT YOURS",
                    "模型与运行设置",
                    "连接你选择的模型，了解任务在哪里执行、用量如何记录。",
                  )}
                  <SettingsForm
                    settings={boot.settings}
                    runtime={boot.runtime}
                    onSave={async (settings) => {
                      await api("/settings", {
                        method: "PUT",
                        body: JSON.stringify(settings),
                      });
                      await refresh();
                      setToast("模型设置已保存，对新任务生效");
                    }}
                  />
                  <div className="ag-runtime-grid">
                    <section className="ag-panel">
                      <div className="ag-panel-heading">
                        <h2>
                          Agent 底座<span>RUNTIME</span>
                        </h2>
                        <Terminal size={17} />
                      </div>
                      <div className="ag-runtime-body">
                        <b>nanobot</b>
                        <span
                          className={`ag-runtime-status ${boot.runtime.installed ? "ready" : ""}`}
                        >
                          {boot.runtime.installed ? "已安装" : "未检测到运行器"}
                        </span>
                        <p>
                          {boot.runtime.version
                            ? `运行版本 ${boot.runtime.version}`
                            : "版本信息未提供"}
                        </p>
                        <small>
                          项目背景、工具调用与研究任务由底座编排，原始记录保存在当前工作空间。
                        </small>
                      </div>
                    </section>
                    <section className="ag-panel">
                      <div className="ag-panel-heading">
                        <h2>
                          原型制作<span>FOUNDRY</span>
                        </h2>
                        <Box size={17} />
                      </div>
                      <div className="ag-runtime-body">
                        <b>造物</b>
                        <span
                          className={`ag-runtime-status ${boot.runtime.foundryAvailable ? "ready" : ""}`}
                        >
                          {boot.runtime.foundryAvailable
                            ? "可以调用"
                            : "暂不可用"}
                        </span>
                        <p>接收需求，生成前端原型并保留版本。</p>
                        <small>
                          原型以隔离 iframe 展示，可下载源码继续开发。
                        </small>
                      </div>
                    </section>
                  </div>
                  <a className="ag-legacy-link" href="/?legacy=1">
                    打开原版亦伴工作台
                    <ArrowUpRight size={14} />
                  </a>
                </>
              )}
            </>
          )}
          <footer className="ag-content-footer">
            <span>亦伴 · 你的个人产品研究助理</span>
            <span>基于 nanobot · 原型能力由造物提供</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="ag-toast" role="status">
          <CheckCircle2 size={16} />
          {toast}
          <button onClick={() => setToast("")} aria-label="关闭提示">
            <X size={14} />
          </button>
        </div>
      )}
      {projectModal && (
        <ProjectModal
          mode={projectModal}
          project={project}
          onClose={() => setProjectModal(null)}
          onSave={async (data) => {
            const p: Project = await api(
              projectModal === "new"
                ? "/agent/projects"
                : `/agent/projects/${project?.id}`,
              {
                method: projectModal === "new" ? "POST" : "PATCH",
                body: JSON.stringify(data),
              },
            );
            await refresh();
            setProjectId(p.id);
            setProjectModal(null);
            setToast(
              projectModal === "new"
                ? "项目已创建，可以开始研究了"
                : "项目背景与记忆已更新",
            );
          }}
        />
      )}
    </div>
  );
}

function ProjectModal({
  mode,
  project,
  onClose,
  onSave,
}: {
  mode: "new" | "edit";
  project?: Project;
  onClose: () => void;
  onSave: (data: unknown) => Promise<void>;
}) {
  const [name, setName] = useState(mode === "edit" ? project?.name || "" : ""),
    [background, setBackground] = useState(
      mode === "edit" ? project?.background || "" : "",
    ),
    [goal, setGoal] = useState(mode === "edit" ? project?.goal || "" : ""),
    [constraints, setConstraints] = useState(
      mode === "edit" ? project?.constraints || "" : "",
    ),
    [memory, setMemory] = useState(
      mode === "edit" ? project?.memory || [] : [],
    ),
    [tab, setTab] = useState("background"),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        name: name.trim(),
        background,
        goal,
        constraints,
        ...(mode === "edit"
          ? { memory: memory.filter((m) => m.text.trim()) }
          : {}),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div
      className="ag-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="ag-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ag-project-modal-title"
      >
        <div className="ag-modal-heading">
          <div>
            <span className="ag-eyebrow">PROJECT CONTEXT</span>
            <h2 id="ag-project-modal-title">
              {mode === "new" ? "建立一个新项目" : "项目背景与记忆"}
            </h2>
            <p>让亦伴理解你在做什么，以及什么对你重要。</p>
          </div>
          <button
            className="ag-icon-button"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭"
          >
            <X size={19} />
          </button>
        </div>
        {mode === "edit" && (
          <div className="ag-modal-tabs">
            <button
              className={tab === "background" ? "active" : ""}
              onClick={() => setTab("background")}
            >
              <FolderOpen size={15} />
              项目背景
            </button>
            <button
              className={tab === "memory" ? "active" : ""}
              onClick={() => setTab("memory")}
            >
              <Brain size={15} />
              记忆与更正<span>{memory.length}</span>
            </button>
          </div>
        )}
        <form onSubmit={save}>
          <div className="ag-modal-body">
            {tab === "background" ? (
              <>
                <label>
                  项目名称
                  <input
                    autoFocus
                    required
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如：亦伴 · 个人产品研究助理"
                  />
                </label>
                <label>
                  项目背景
                  <textarea
                    required
                    rows={4}
                    value={background}
                    onChange={(e) => setBackground(e.target.value)}
                    placeholder="目标用户是谁？解决什么问题？现有功能与进展是什么？"
                  />
                  <small>项目事实和你的假设都可以写下，请明确区分。</small>
                </label>
                <label>
                  当前目标
                  <textarea
                    rows={2}
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="这一阶段最希望验证或实现什么？"
                  />
                </label>
                <label>
                  约束与取舍
                  <textarea
                    rows={2}
                    value={constraints}
                    onChange={(e) => setConstraints(e.target.value)}
                    placeholder="例如：个人使用、优先本机运行、单任务成本预算、暂不接入团队协作。"
                  />
                </label>
              </>
            ) : (
              <>
                <div className="ag-note">
                  <Brain size={15} />
                  不准确的记忆请直接修改或移除。保存后，新任务会使用更新后的内容。
                </div>
                {memory.length ? (
                  memory.map((m, i) => (
                    <div className="ag-memory-edit" key={m.id}>
                      <div>
                        <span>记忆 {String(i + 1).padStart(2, "0")}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setMemory(memory.filter((v) => v.id !== m.id))
                          }
                          aria-label={`移除记忆 ${i + 1}`}
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <textarea
                        rows={3}
                        value={m.text}
                        onChange={(e) =>
                          setMemory(
                            memory.map((v) =>
                              v.id === m.id
                                ? {
                                    ...v,
                                    text: e.target.value,
                                    source: "用户更正",
                                    updatedAt: new Date().toISOString(),
                                  }
                                : v,
                            ),
                          )
                        }
                      />
                      <small>
                        {m.source || "研究记录"} · {date(m.updatedAt)}
                      </small>
                    </div>
                  ))
                ) : (
                  <p className="ag-muted">
                    还没有保存的项目记忆。你可以补充一个已确认的事实或决策。
                  </p>
                )}
                <button
                  type="button"
                  className="ag-button light"
                  onClick={() =>
                    setMemory([
                      ...memory,
                      {
                        id: crypto.randomUUID(),
                        text: "",
                        source: "用户补充",
                        updatedAt: new Date().toISOString(),
                      },
                    ])
                  }
                >
                  <Plus size={14} />
                  添加一条记忆
                </button>
                {!!project?.decisions?.length && (
                  <div className="ag-decision-list">
                    <h4>已记录的项目决策</h4>
                    {project.decisions.map((d, i) => (
                      <p key={i}>
                        {typeof d === "string"
                          ? d
                          : d.text || d.title || "未命名决策"}
                      </p>
                    ))}
                  </div>
                )}
              </>
            )}
            {error && (
              <div className="ag-error">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
          </div>
          <div className="ag-modal-footer">
            <span>保存不会自动调用模型</span>
            <button
              className="ag-button light"
              type="button"
              disabled={saving}
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="ag-button primary"
              disabled={saving || !name.trim()}
            >
              {saving ? (
                <Loader2 size={15} className="ag-spin" />
              ) : (
                <Check size={15} />
              )}
              保存{mode === "new" ? "项目" : "更改"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function SettingsForm({
  settings,
  runtime,
  onSave,
}: {
  settings: Settings;
  runtime: Boot["runtime"];
  onSave: (settings: Settings & { apiKey?: string }) => Promise<void>;
}) {
  const [provider, setProvider] = useState(
      settings.provider === "openai" ? "openai" : "codex",
    ),
    [baseUrl, setBaseUrl] = useState(
      settings.baseUrl || "https://api.openai.com/v1",
    ),
    [model, setModel] = useState(settings.model || ""),
    [apiKey, setApiKey] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="ag-settings-form ag-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError("");
        try {
          await onSave({
            ...settings,
            provider,
            baseUrl,
            model,
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          });
          setApiKey("");
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="ag-panel-heading">
        <h2>
          模型连接<span>MODEL CONNECTION</span>
        </h2>
      </div>
      <div className="ag-settings-body">
        <div className="ag-provider-options">
          {[
            {
              id: "codex",
              name: "本机 Codex",
              desc: "使用本机已登录的 Codex CLI",
              icon: Terminal,
            },
            {
              id: "openai",
              name: "API 模型",
              desc: "连接 OpenAI 兼容的模型接口",
              icon: Sparkles,
            },
          ].map((p) => (
            <label className={provider === p.id ? "active" : ""} key={p.id}>
              <input
                type="radio"
                name="ag-provider"
                value={p.id}
                checked={provider === p.id}
                onChange={() => setProvider(p.id)}
              />
              <p.icon size={21} />
              <span>
                <b>{p.name}</b>
                <small>{p.desc}</small>
              </span>
              <span className="ag-radio">{provider === p.id && <span />}</span>
            </label>
          ))}
        </div>
        {provider === "codex" ? (
          <div className="ag-setting-explanation">
            <Terminal size={20} />
            <div>
              <b>在你的电脑上运行</b>
              <p>
                服务需要在装有 Codex CLI 的本机启动，并已完成{" "}
                <code>codex login</code>。调用消耗账号额度；记录的 Token
                用量不等于实际账单。首次研究可能需要几分钟。
              </p>
              <p>项目背景和任务资料会交给你已授权的模型服务处理。</p>
            </div>
          </div>
        ) : (
          <div className="ag-api-fields">
            <label>
              接口地址
              <input
                required
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <label>
              模型名称
              <input
                required
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="填写服务商提供的模型 ID"
              />
            </label>
            <label>
              API Key
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  settings.hasApiKey
                    ? "已配置；留空保留当前密钥"
                    : "请输入 API Key"
                }
                required={!settings.hasApiKey}
              />
              <small>
                密钥不会返回浏览器。费用以提供商的实际账单为准，未配置价格时显示未计价。
              </small>
            </label>
          </div>
        )}
        {error && (
          <div className="ag-error">
            <AlertCircle size={16} />
            {error}
          </div>
        )}
      </div>
      <div className="ag-settings-footer">
        <span>新任务使用更新后的模型设置</span>
        <button className="ag-button primary" disabled={saving}>
          {saving ? (
            <Loader2 size={15} className="ag-spin" />
          ) : (
            <Check size={15} />
          )}
          保存设置
        </button>
      </div>
    </form>
  );
}
function Login({ onLogin }: { onLogin: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="ag-app ag-login">
      <div className="ag-login-card">
        <div className="ag-brand-mark">亦</div>
        <span className="ag-eyebrow">YOUR PERSONAL PRODUCT AGENT</span>
        <h1>回到你的工作空间</h1>
        <p>输入工作空间口令，继续你的研究与决策。</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setLoading(true);
            setError("");
            try {
              await onLogin(password);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setLoading(false);
            }
          }}
        >
          <label>
            工作空间口令
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入口令"
            />
          </label>
          {error && (
            <div className="ag-error">
              <AlertCircle size={15} />
              {error}
            </div>
          )}
          <button className="ag-button primary" disabled={loading}>
            {loading ? (
              <Loader2 size={16} className="ag-spin" />
            ) : (
              <ArrowRight size={16} />
            )}
            进入工作空间
          </button>
        </form>
        <span className="ag-login-note">
          <ShieldCheck size={13} />
          你的项目、证据与工作记录在这里
        </span>
      </div>
    </div>
  );
}
