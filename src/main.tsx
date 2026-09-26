import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowUp,
  Plus,
  Search,
  LayoutDashboard,
  FolderOpen,
  FileText,
  Settings,
  ChevronsUpDown,
  ChevronLeft,
  Check,
  CheckCircle2,
  Clock3,
  Loader2,
  X,
  Paperclip,
  Download,
  Trash2,
  RotateCcw,
  Square,
  Code2,
  Eye,
  History,
  BookOpen,
  PanelLeftClose,
  Menu,
  FlaskConical,
  MessagesSquare,
  ScanSearch,
  CalendarDays,
  ListChecks,
  Lightbulb,
  Layers,
  Box,
  ExternalLink,
  Copy,
  AlertCircle,
  ChevronDown,
  Sparkles,
  Terminal,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./style.css";
type Template = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  tag?: string;
};
type Doc = { id: string; name: string; chars: number; createdAt: string };
type Action = {
  title: string;
  owner: string;
  priority: string;
  done?: boolean;
};
type Result = {
  title: string;
  summary?: string;
  markdown?: string;
  actions?: Action[];
  code?: string;
  prd?: string;
  description?: string;
};
type Job = {
  id: string;
  title: string;
  prompt: string;
  kind: string;
  status: string;
  provider: string;
  createdAt: string;
  events: { at: string; message: string }[];
  result: Result | null;
  error: string | null;
  projectId: string | null;
  documentIds: string[];
};
type Version = {
  id: string;
  title: string;
  description: string;
  code: string;
  prd: string;
  createdAt: string;
  prompt: string;
  provider: string;
};
type Project = {
  id: string;
  title: string;
  description: string;
  kind: string;
  createdAt: string;
  updatedAt: string;
  versions: Version[];
};
type Config = {
  cloud?: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
};
type Boot = {
  access: "public" | "private";
  product: { id: string; name: string; repo: string };
  settings: Config;
  templates: Template[];
  jobs: Job[];
  documents: Doc[];
  projects: Project[];
};
const icons = [
  FileText,
  ScanSearch,
  MessagesSquare,
  FlaskConical,
  CalendarDays,
  ListChecks,
];
async function api(url: string, options: RequestInit = {}) {
  const response = await fetch("/api" + url, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error || "请求失败"), {
      status: response.status,
    });
  return data;
}
function time(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function providerLabel(p: string) {
  return p === "public"
    ? "公开示例"
    : p === "codex"
      ? "Codex"
      : p === "openai"
        ? "API 模型"
        : "演示模式";
}
function statusLabel(s: string) {
  return (
    (
      {
        queued: "排队中",
        running: "执行中",
        completed: "已完成",
        failed: "未完成",
        cancelled: "已取消",
      } as Record<string, string>
    )[s] || s
  );
}
function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
function App() {
  const [locked, setLocked] = useState<{ name: string; id: string } | null>(
    null,
  );
  const [boot, setBoot] = useState<Boot | null>(null),
    [fatal, setFatal] = useState(""),
    [page, setPage] = useState("home"),
    [selectedJob, setSelectedJob] = useState<Job | null>(null),
    [project, setProject] = useState<Project | null>(null),
    [prompt, setPrompt] = useState(""),
    [title, setTitle] = useState(""),
    [kind, setKind] = useState(""),
    [selectedDocs, setSelectedDocs] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [query, setQuery] = useState(""),
    [sidebar, setSidebar] = useState(false),
    [projectTab, setProjectTab] = useState("preview"),
    [versionId, setVersionId] = useState(""),
    [revision, setRevision] = useState(""),
    [attachOpen, setAttachOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const factory = boot?.product.id === "factory";
  const isPublic = boot?.access === "public";
  const [loginDestination, setLoginDestination] = useState("home");
  function login(destination = "home") {
    if (boot) {
      setLoginDestination(destination);
      setLocked(boot.product);
    }
  }
  async function refresh() {
    try {
      const auth = await api("/auth");
      const data = await api(
        auth.authenticated ? "/bootstrap" : "/public/bootstrap",
      );
      if (!auth.authenticated) {
        setSelectedJob(null);
        setProject(null);
        setSelectedDocs([]);
        setPage("home");
      }
      setBoot(data);
      setFatal("");
      return data as Boot;
    } catch (e) {
      setFatal((e as Error).message);
      return null;
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const running = boot?.jobs.some((j) =>
    ["running", "queued"].includes(j.status),
  );
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const data = await refresh();
      if (!data) return;
      setSelectedJob((old) =>
        old ? data.jobs.find((j) => j.id === old.id) || old : null,
      );
      setProject((old) =>
        old ? data.projects.find((p) => p.id === old.id) || old : null,
      );
    }, 2000);
    return () => clearInterval(timer);
  }, [running]);
  function navigate(next: string) {
    if (isPublic && ["documents", "settings"].includes(next)) {
      login(next);
      return;
    }
    setPage(next);
    setSelectedJob(null);
    setProject(null);
    setQuery("");
    setSidebar(false);
  }
  async function act(fn: () => Promise<void>) {
    if (isPublic) {
      login();
      return;
    }
    try {
      setBusy(true);
      await fn();
    } catch (e) {
      if ((e as Error & { status?: number }).status === 401) {
        await refresh();
        setLocked(boot!.product);
      }
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (prompt.trim().length < 5)
      return setToast("请至少输入 5 个字符，描述你的任务。");
    await act(async () => {
      const job = await api("/jobs", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim() || prompt.trim().slice(0, 32),
          prompt,
          kind: kind || (factory ? "custom" : "brief"),
          documentIds: selectedDocs,
        }),
      });
      await refresh();
      setSelectedJob(job);
      setPage("jobs");
      setPrompt("");
      setTitle("");
      setSelectedDocs([]);
    });
  }
  function useTemplate(t: Template) {
    navigate("home");
    setPrompt(t.prompt);
    setTitle(t.title);
    setKind(t.id);
    setTimeout(() => composerRef.current?.focus(), 50);
  }
  async function upload(file?: File) {
    if (!file) return;
    await act(async () => {
      const form = new FormData();
      form.append("file", file);
      const doc = await api("/documents", { method: "POST", body: form });
      await refresh();
      setSelectedDocs((old) => [...old, doc.id]);
      setToast(`已读取 ${doc.name}`);
    });
    if (fileRef.current) fileRef.current.value = "";
  }
  function openProject(p: Project) {
    setProject(p);
    setSelectedJob(null);
    setPage("projects");
    setVersionId(p.versions.at(-1)?.id || "");
    setProjectTab("preview");
    setRevision("");
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("已复制");
    } catch {
      setToast("浏览器未允许剪贴板访问，请手动复制。");
    }
  }
  if (locked)
    return (
      <LoginScreen
        product={locked}
        onCancel={() => setLocked(null)}
        onLogin={async () => {
          const data = await refresh();
          if (!data || data.access !== "private")
            throw new Error("登录状态未就绪，请重试。");
          setSelectedJob(null);
          setProject(null);
          setSelectedDocs([]);
          setPage(loginDestination);
          setLocked(null);
        }}
      />
    );
  if (!boot)
    return (
      <div className="loading-screen">
        <div className="brand-symbol">亦</div>
        {fatal ? (
          <>
            <h2>服务尚未连接</h2>
            <p>{fatal}</p>
            <button className="primary" onClick={() => refresh()}>
              重新连接
            </button>
          </>
        ) : (
          <>
            <Loader2 className="spin" />
            <p>正在打开你的工作空间…</p>
          </>
        )}
      </div>
    );
  const completed = boot.jobs.filter((j) => j.status === "completed");
  const activeVersion =
    project?.versions.find((v) => v.id === versionId) ||
    project?.versions.at(-1);
  const nav = factory
    ? [
        ["home", "工作台", LayoutDashboard],
        ["projects", isPublic ? "产品示例" : "我的产品", Box],
        ["jobs", isPublic ? "生成示例" : "生成记录", History],
        ["templates", "模板库", Layers],
      ]
    : [
        ["home", "工作台", LayoutDashboard],
        ["jobs", isPublic ? "任务示例" : "任务中心", ListChecks],
        ["documents", "资料库", FolderOpen],
        ["artifacts", "交付物", FileText],
      ];
  const pageTitle = selectedJob
    ? "任务详情"
    : project
      ? "产品工作室"
      : (
          {
            home: "工作台",
            jobs: factory ? "生成记录" : "任务中心",
            projects: "我的产品",
            templates: "模板库",
            documents: "资料库",
            artifacts: "交付物",
            settings: "设置",
          } as Record<string, string>
        )[page];
  return (
    <div className={`app ${factory ? "factory" : "worker"}`}>
      <input
        type="file"
        accept=".txt,.md,.csv,.json,.docx,.pdf"
        hidden
        ref={fileRef}
        onChange={(e) => upload(e.target.files?.[0])}
      />
      {sidebar && (
        <button
          className="sidebar-backdrop"
          aria-label="关闭导航"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <button className="brand" onClick={() => navigate("home")}>
          <span className="brand-symbol">
            {factory ? <Layers size={23} /> : "亦"}
          </span>
          <span>
            <b>{factory ? "造物" : "亦伴"}</b>
            <small>{factory ? "PRODUCT FOUNDRY" : "AI PM WORKER"}</small>
          </span>
        </button>
        <div className="workspace">
          <span className="workspace-avatar">Y</span>
          <div>
            {isPublic ? "公开体验空间" : "我的工作空间"}
            <small>AI 产品经理</small>
          </div>
          <ChevronsUpDown size={14} />
        </div>
        <button
          className="new-task"
          onClick={() => {
            navigate("home");
            setPrompt("");
            setTitle("");
            setTimeout(() => composerRef.current?.focus(), 50);
          }}
        >
          <Plus size={17} />
          {factory ? "创造新产品" : "新建任务"}
          <span>↗</span>
        </button>
        <div className="nav-label">工作空间</div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              key={id as string}
              className={page === id ? "active" : ""}
              onClick={() => navigate(id as string)}
            >
              {React.createElement(Icon as typeof Box, { size: 18 })}
              <span>{label as string}</span>
              {id === "jobs" && boot.jobs.length > 0 && (
                <i>{boot.jobs.length}</i>
              )}
              {id === "projects" && boot.projects.length > 0 && (
                <i>{boot.projects.length}</i>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-dot" />
          <b>{factory ? "想法，值得被做出来。" : "专注需要你判断的事。"}</b>
          <p>
            {factory
              ? "从需求到原型，让每次探索都有一个可以试用的结果。"
              : "把整理和初稿交给 AI，把洞察和决策留给自己。"}
          </p>
        </div>
        <div className="sidebar-bottom">
          <button
            className={page === "settings" ? "active" : ""}
            onClick={() => navigate("settings")}
          >
            <Settings size={18} />
            设置与模型
            <span
              className={`connection ${boot.settings.provider === "demo" ? "demo" : ""}`}
            />
          </button>
          <a
            href={`https://github.com/Yiheng-guo/${boot.product.repo}`}
            target="_blank"
            rel="noreferrer"
          >
            <Code2 size={18} />
            项目仓库
            <ArrowUpRight size={14} />
          </a>
          <div className="profile">
            <span>Y</span>
            <div>
              {isPublic ? "访客" : "Yiheng"}
              <small>
                {isPublic
                  ? "固定示例 · 无需登录"
                  : `个人工作空间 · ${boot.settings.cloud ? "私有云存储" : "本地存储"}`}
              </small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              aria-label="打开导航"
              onClick={() => setSidebar(true)}
            >
              <Menu size={19} />
            </button>
            <span className="breadcrumb">
              {isPublic ? "公开体验空间" : "我的工作空间"}
            </span>
            <span className="slash">/</span>
            <b>{pageTitle}</b>
          </div>
          <div>
            <button
              className="provider-chip"
              onClick={() => navigate("settings")}
            >
              <span
                className={`tiny-dot ${boot.settings.provider === "demo" ? "amber" : ""}`}
              />
              {providerLabel(boot.settings.provider)}
              <ChevronDown size={12} />
            </button>
            {isPublic ? (
              <button className="primary small-button" onClick={() => login()}>
                登录工作空间
              </button>
            ) : (
              <span className="top-avatar">Y</span>
            )}
          </div>
        </header>
        <main className={project ? "content studio-content" : "content"}>
          {isPublic && (
            <div className="public-notice" role="note">
              <b>公开体验</b>
              <span>
                以下均为虚构示例。可浏览界面、查看交付物和试用原型；私人资料、模型设置与生成操作需登录。
              </span>
            </div>
          )}
          {fatal && (
            <div className="error-banner">
              <AlertCircle size={17} />
              {fatal}
              <button onClick={() => refresh()}>重连</button>
            </div>
          )}
          {page === "home" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <div className="eyebrow">
                    <span />
                    {factory
                      ? "IDEAS INTO PRODUCTS"
                      : "YOUR AI PRODUCT PARTNER"}
                  </div>
                  <h1>
                    {factory ? (
                      <>
                        让下一个好想法，
                        <br />
                        成为一个<span>能用的产品。</span>
                      </>
                    ) : (
                      <>
                        把琐碎交给 AI，
                        <br />把<span>判断留给你。</span>
                      </>
                    )}
                  </h1>
                  <p>
                    {factory
                      ? "从一句需求出发，生成、预览、迭代。你的产品，自己掌握。"
                      : "研究、整理、写作与评测。一个懂 AI 产品经理的办公伙伴。"}
                  </p>
                </div>
                <div
                  className={`hero-art ${factory ? "blueprint" : "orbit"}`}
                  aria-hidden="true"
                >
                  {factory ? (
                    <>
                      <div className="blueprint-grid" />
                      <div className="mini-window">
                        <div>
                          <i />
                          <i />
                          <i />
                        </div>
                        <section>
                          <span />
                          <span />
                          <span />
                        </section>
                        <footer>
                          <b />
                          <b />
                          <b />
                        </footer>
                      </div>
                      <div className="art-label">
                        <CheckCircle2 size={14} />
                        想法 → 可交互原型
                      </div>
                      <div className="floating-cube">
                        <Box size={36} strokeWidth={1.3} />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="orbit-ring r1" />
                      <div className="orbit-ring r2" />
                      <div className="orbit-center">亦</div>
                      <div className="orbit-card card-a">
                        <FileText size={20} />
                        <span>交付，井然有序</span>
                        <Check size={15} />
                      </div>
                      <div className="orbit-card card-b">
                        <Lightbulb size={19} />
                        <span>留出思考的空间</span>
                      </div>
                      <span className="orbit-dot od1" />
                      <span className="orbit-dot od2" />
                    </>
                  )}
                </div>
              </section>
              <form className="composer" onSubmit={submit}>
                <div className="composer-heading">
                  <Sparkles size={18} />
                  <b>
                    {factory
                      ? "你想做一个什么产品？"
                      : "今天，有什么想交给我？"}
                  </b>
                  {title && (
                    <button
                      type="button"
                      className="selected-template"
                      onClick={() => {
                        setTitle("");
                        setKind("");
                      }}
                    >
                      {title}
                      <X size={12} />
                    </button>
                  )}
                </div>
                <textarea
                  ref={composerRef}
                  aria-label={factory ? "产品需求" : "任务需求"}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={
                    factory
                      ? "例如：做一个 AI 模型评测台，支持录入测试用例、记录评分、筛选 Bad Case，并导出结果…"
                      : "例如：根据用户访谈记录，提炼核心痛点，整理需求优先级，并输出一份可以评审的产品方案…"
                  }
                  maxLength={30000}
                />
                {selectedDocs.length > 0 && (
                  <div className="attached-files">
                    {selectedDocs.map((id) => (
                      <span key={id}>
                        <FileText size={12} />
                        {boot.documents.find((d) => d.id === id)?.name}
                        <button
                          type="button"
                          aria-label="取消选择资料"
                          onClick={() =>
                            setSelectedDocs((old) =>
                              old.filter((x) => x !== id),
                            )
                          }
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="composer-footer">
                  <div className="attach-wrap">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        isPublic
                          ? login("documents")
                          : setAttachOpen(!attachOpen)
                      }
                    >
                      <Paperclip size={16} />
                      添加资料
                    </button>
                    {attachOpen && (
                      <div className="attach-popover">
                        <button
                          type="button"
                          onClick={() => {
                            fileRef.current?.click();
                            setAttachOpen(false);
                          }}
                        >
                          <Plus size={15} />
                          上传新资料
                        </button>
                        {boot.documents.map((d) => (
                          <button
                            type="button"
                            key={d.id}
                            onClick={() => {
                              setSelectedDocs((old) =>
                                old.includes(d.id)
                                  ? old.filter((x) => x !== d.id)
                                  : [...old, d.id],
                              );
                              setAttachOpen(false);
                            }}
                          >
                            <FileText size={14} />
                            {d.name}
                            {selectedDocs.includes(d.id) && <Check size={13} />}
                          </button>
                        ))}
                        <small>TXT / MD / CSV / DOCX / PDF · 8 MB</small>
                      </div>
                    )}
                    <span className="composer-hint">
                      {factory
                        ? "交互原型 · 独立源码"
                        : "资料有依据，交付可追溯"}
                    </span>
                  </div>
                  <button
                    className="primary submit"
                    disabled={busy || prompt.trim().length < 5}
                  >
                    {busy ? (
                      <Loader2 className="spin" size={16} />
                    ) : (
                      <ArrowUp size={17} />
                    )}
                    <span>
                      {isPublic
                        ? "登录后生成"
                        : factory
                          ? "开始创造"
                          : "开始任务"}
                    </span>
                  </button>
                </div>
              </form>
              <section className="template-section">
                <div className="section-heading">
                  <div>
                    <h2>
                      {factory ? "从一个成熟的场景开始" : "常用工作，快人一步"}
                    </h2>
                    <p>
                      {factory
                        ? "为 AI 产品经理准备的产品起点"
                        : "选一个工作流，带上你的材料，即可开始"}
                    </p>
                  </div>
                  <span className="quiet-label">
                    {factory ? "STARTER TEMPLATES" : "WORKFLOWS"}
                  </span>
                </div>
                <div className={`template-grid ${factory ? "four" : ""}`}>
                  {boot.templates.map((t, i) => {
                    const Icon = icons[i % icons.length];
                    return (
                      <button
                        className="template-card"
                        key={t.id}
                        onClick={() => useTemplate(t)}
                      >
                        <span className={`template-icon tone-${i % 4}`}>
                          <Icon size={20} strokeWidth={1.6} />
                        </span>
                        <div>
                          <h3>{t.title}</h3>
                          <p>{t.description}</p>
                        </div>
                        <ArrowUpRight className="template-arrow" size={16} />
                      </button>
                    );
                  })}
                </div>
              </section>
              <section className="recent-section">
                <div className="section-heading">
                  <div>
                    <h2>{factory ? "最近的创造" : "最近的任务"}</h2>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate(factory ? "projects" : "jobs")}
                  >
                    查看全部
                    <ArrowRight size={14} />
                  </button>
                </div>
                {factory ? (
                  boot.projects.length ? (
                    <div className="project-grid">
                      {boot.projects.slice(0, 3).map((p) => (
                        <ProjectCard
                          key={p.id}
                          project={p}
                          onOpen={() => openProject(p)}
                        />
                      ))}
                    </div>
                  ) : (
                    <Empty
                      compact
                      icon={Box}
                      title="你的第一个产品，从这里诞生"
                      text="描述一个想法，或选择上方的模板。生成后会保存在这里。"
                    />
                  )
                ) : boot.jobs.length ? (
                  <div className="job-list">
                    {boot.jobs.slice(0, 4).map((j) => (
                      <JobRow
                        key={j.id}
                        job={j}
                        onClick={() => {
                          setSelectedJob(j);
                          setPage("jobs");
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <Empty
                    compact
                    icon={FileText}
                    title="留给下一份好交付"
                    text="创建第一个任务后，过程与结果都会保存在这里。"
                  />
                )}
              </section>
              <div className="home-footnote">
                <span className="tiny-dot" />
                {isPublic
                  ? "公开示例空间"
                  : boot.settings.cloud
                    ? "私有云工作空间"
                    : "本地工作空间"}
                <span>·</span>模型按你的选择连接<span>·</span>产出由你掌握
              </div>
            </>
          )}
          {page === "jobs" && !selectedJob && (
            <>
              <PageHeading
                eyebrow={factory ? "GENERATION HISTORY" : "TASK CENTER"}
                title={factory ? "每次创造，都有迹可循" : "把工作推进到交付"}
                description="查看任务进展、处理异常，随时回到已有成果。"
              />
              <div className="stats-row">
                <Stat value={boot.jobs.length} label="全部任务" />
                <Stat value={completed.length} label="已交付" />
                <Stat
                  value={
                    boot.jobs.filter((j) =>
                      ["queued", "running"].includes(j.status),
                    ).length
                  }
                  label="正在执行"
                />
              </div>
              <SearchBox
                value={query}
                set={setQuery}
                placeholder="搜索任务名称…"
              />
              {boot.jobs.filter((j) => j.title.includes(query)).length ? (
                <div className="job-list full">
                  {boot.jobs
                    .filter((j) => j.title.includes(query))
                    .map((j) => (
                      <JobRow
                        key={j.id}
                        job={j}
                        onClick={() => setSelectedJob(j)}
                      />
                    ))}
                </div>
              ) : (
                <Empty
                  icon={ListChecks}
                  title={query ? "没有匹配的任务" : "还没有任务"}
                  text="从工作台开始创建，所有任务会保留在这里。"
                  action={() => navigate("home")}
                  actionLabel="新建任务"
                />
              )}
            </>
          )}
          {selectedJob && (
            <>
              <button
                className="back-button"
                onClick={() => setSelectedJob(null)}
              >
                <ChevronLeft size={15} />
                返回任务列表
              </button>
              <div className="detail-heading">
                <div>
                  <div className="eyebrow">
                    {providerLabel(selectedJob.provider)} ·{" "}
                    {time(selectedJob.createdAt)}
                  </div>
                  <h1>{selectedJob.title}</h1>
                </div>
                <span className={`status ${selectedJob.status}`}>
                  {["running", "queued"].includes(selectedJob.status) && (
                    <Loader2 className="spin" size={13} />
                  )}{" "}
                  {statusLabel(selectedJob.status)}
                </span>
              </div>
              <div className="detail-grid">
                <aside className="task-context">
                  <h3>任务需求</h3>
                  <p>{selectedJob.prompt}</p>
                  <h3>执行记录</h3>
                  <div className="timeline">
                    {selectedJob.events.map((event, i) => (
                      <div key={i}>
                        <span className="timeline-dot" />
                        <small>{time(event.at)}</small>
                        <p>{event.message}</p>
                      </div>
                    ))}
                  </div>
                  {["running", "queued"].includes(selectedJob.status) ? (
                    <button
                      className="secondary"
                      onClick={() =>
                        act(async () => {
                          const j = await api(
                            `/jobs/${selectedJob.id}/cancel`,
                            { method: "POST" },
                          );
                          setSelectedJob(j);
                          await refresh();
                        })
                      }
                    >
                      <Square size={14} />
                      取消任务
                    </button>
                  ) : (
                    <button
                      className="secondary"
                      onClick={() =>
                        act(async () => {
                          const j = await api(`/jobs/${selectedJob.id}/retry`, {
                            method: "POST",
                          });
                          await refresh();
                          setSelectedJob(j);
                        })
                      }
                      disabled={busy}
                    >
                      <RotateCcw size={14} />
                      使用当前模型重做
                    </button>
                  )}
                </aside>
                <section className="deliverable">
                  {selectedJob.error && (
                    <div className="error-banner">
                      <AlertCircle size={18} />
                      {selectedJob.error}
                    </div>
                  )}
                  {selectedJob.result?.markdown ? (
                    <>
                      <div className="deliverable-toolbar">
                        <span>
                          <FileText size={16} />
                          文档交付物
                        </span>
                        <div>
                          <button
                            className="icon-button"
                            aria-label="复制文档"
                            onClick={() => copy(selectedJob.result!.markdown!)}
                          >
                            <Copy size={16} />
                          </button>
                          <a
                            className="secondary small-button"
                            href={`/api/${isPublic ? "public/" : ""}jobs/${selectedJob.id}/download`}
                            download
                          >
                            <Download size={14} />
                            下载 Markdown
                          </a>
                        </div>
                      </div>
                      <Markdown text={selectedJob.result.markdown} />
                      {!!selectedJob.result.actions?.length && (
                        <div className="action-items">
                          <h3>下一步行动</h3>
                          {selectedJob.result.actions.map((a, i) => (
                            <label key={i} className={a.done ? "done" : ""}>
                              <input
                                type="checkbox"
                                disabled={isPublic}
                                checked={!!a.done}
                                onChange={() =>
                                  act(async () => {
                                    setSelectedJob(
                                      await api(
                                        `/jobs/${selectedJob.id}/actions/${i}`,
                                        {
                                          method: "PATCH",
                                          body: JSON.stringify({
                                            done: !a.done,
                                          }),
                                        },
                                      ),
                                    );
                                    await refresh();
                                  })
                                }
                              />
                              <span>
                                {a.title}
                                <small>
                                  {a.owner} ·{" "}
                                  {
                                    (
                                      {
                                        high: "高",
                                        medium: "中",
                                        low: "低",
                                      } as Record<string, string>
                                    )[a.priority]
                                  }
                                  优先级
                                </small>
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </>
                  ) : selectedJob.projectId &&
                    selectedJob.status === "completed" ? (
                    <div className="completed-product">
                      <span className="success-orb">
                        <CheckCircle2 size={34} />
                      </span>
                      <h2>产品已生成</h2>
                      <p>{selectedJob.result?.description}</p>
                      <button
                        className="primary"
                        onClick={() => {
                          const p = boot.projects.find(
                            (p) => p.id === selectedJob.projectId,
                          );
                          if (p) openProject(p);
                        }}
                      >
                        进入产品工作室
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="generation-state">
                      {["running", "queued"].includes(selectedJob.status) ? (
                        <>
                          <div className="thinking-orb">
                            <Sparkles size={30} />
                          </div>
                          <h2>
                            {factory
                              ? "正在把想法变成产品"
                              : "正在完成你的任务"}
                          </h2>
                          <p>
                            模型正在生成完整交付物，通常需要 1–4 分钟。
                            <br />
                            你可以切换页面，任务会继续执行。
                          </p>
                          <div className="thinking-bars">
                            <i />
                            <i />
                            <i />
                          </div>
                        </>
                      ) : (
                        <>
                          <AlertCircle size={35} />
                          <h2>{statusLabel(selectedJob.status)}</h2>
                          <p>你的输入已保留，可以修改模型设置后重试。</p>
                        </>
                      )}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
          {page === "documents" && (
            <>
              <PageHeading
                eyebrow="KNOWLEDGE INPUTS"
                title="让每一次判断，有据可依"
                description="上传原始材料，在任务中选择引用。支持文字版 PDF、DOCX、Markdown、TXT、CSV 和 JSON。"
              />
              <div
                className="upload-zone"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") fileRef.current?.click();
                }}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  upload(e.dataTransfer.files[0]);
                }}
              >
                <span className="upload-icon">
                  <Plus size={24} />
                </span>
                <h3>{busy ? "正在读取资料…" : "拖入资料，或点击上传"}</h3>
                <p>单文件最多 8 MB · 每份材料最多 65,000 字符</p>
              </div>
              <SearchBox
                value={query}
                set={setQuery}
                placeholder="搜索资料名称…"
              />
              <div className="document-list">
                {boot.documents
                  .filter((d) =>
                    d.name.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((d) => (
                    <div key={d.id}>
                      <span className="file-icon">
                        <FileText size={21} />
                      </span>
                      <div>
                        <b>{d.name}</b>
                        <small>
                          {d.chars.toLocaleString()} 字符 · {time(d.createdAt)}
                        </small>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => {
                          setSelectedDocs([d.id]);
                          navigate("home");
                        }}
                      >
                        用于新任务
                        <ArrowUpRight size={14} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`删除 ${d.name}`}
                        onClick={() =>
                          act(async () => {
                            await api(`/documents/${d.id}`, {
                              method: "DELETE",
                            });
                            setSelectedDocs((old) =>
                              old.filter((x) => x !== d.id),
                            );
                            await refresh();
                            setToast("资料已删除");
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
              </div>
              {!boot.documents.length && (
                <Empty
                  compact
                  icon={FolderOpen}
                  title="资料库还是空的"
                  text="访谈记录、需求说明、会议纪要，都是很好的起点。"
                />
              )}
            </>
          )}
          {page === "artifacts" && (
            <>
              <PageHeading
                eyebrow="DELIVERABLES"
                title="好工作，留下好成果"
                description="任务产出的文档与行动项，集中归档、随时复用。"
              />
              <SearchBox
                value={query}
                set={setQuery}
                placeholder="搜索交付物…"
              />
              {completed.filter((j) => j.title.includes(query)).length ? (
                <div className="artifact-grid">
                  {completed
                    .filter((j) => j.title.includes(query))
                    .map((j) => (
                      <button
                        key={j.id}
                        onClick={() => {
                          setSelectedJob(j);
                          setPage("jobs");
                        }}
                      >
                        <span className="artifact-icon">
                          <FileText size={24} />
                        </span>
                        <span className="quiet-label">MARKDOWN</span>
                        <h3>{j.result?.title || j.title}</h3>
                        <p>{j.result?.summary}</p>
                        <footer>
                          <span>{time(j.createdAt)}</span>
                          <ArrowUpRight size={16} />
                        </footer>
                      </button>
                    ))}
                </div>
              ) : (
                <Empty
                  icon={FileText}
                  title="第一份交付物，正在路上"
                  text="完成任务后，文档会自动归档到这里。"
                  action={() => navigate("home")}
                  actionLabel="开始一个任务"
                />
              )}
            </>
          )}
          {page === "projects" && !project && (
            <>
              <PageHeading
                eyebrow="YOUR PRODUCTS"
                title="你的产品，从想法到版本"
                description="每次迭代保留独立版本。预览效果，查看源码，下载继续开发。"
              />
              <SearchBox value={query} set={setQuery} placeholder="搜索产品…" />
              {boot.projects.filter((p) => p.title.includes(query)).length ? (
                <div className="project-grid">
                  {boot.projects
                    .filter((p) => p.title.includes(query))
                    .map((p) => (
                      <ProjectCard
                        key={p.id}
                        project={p}
                        onOpen={() => openProject(p)}
                      />
                    ))}
                </div>
              ) : (
                <Empty
                  icon={Box}
                  title="准备好创造第一个产品了吗？"
                  text="从一个真实问题出发，把它变成可试用的原型。"
                  action={() => navigate("home")}
                  actionLabel="创造产品"
                />
              )}
            </>
          )}
          {page === "templates" && (
            <>
              <PageHeading
                eyebrow="STARTER LIBRARY"
                title="从经过思考的场景出发"
                description="模板提供完整需求起点；你可以在生成前修改任何细节。"
              />
              <div className="large-template-grid">
                {boot.templates.map((t, i) => {
                  const Icon = icons[i];
                  return (
                    <button key={t.id} onClick={() => useTemplate(t)}>
                      <div className={`template-visual visual-${i}`}>
                        <Icon size={42} strokeWidth={1} />
                        <div className="visual-lines">
                          <i />
                          <i />
                          <i />
                        </div>
                      </div>
                      <span className="template-tag">{t.tag}</span>
                      <h2>{t.title}</h2>
                      <p>{t.description}</p>
                      <footer>
                        使用这个模板
                        <ArrowUpRight size={17} />
                      </footer>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {project && activeVersion && (
            <>
              <div className="studio-heading">
                <button
                  className="back-button"
                  onClick={() => setProject(null)}
                >
                  <ChevronLeft size={15} />
                  产品库
                </button>
                <h2>{project.title}</h2>
                <select
                  aria-label="选择产品版本"
                  value={activeVersion.id}
                  onChange={(e) => setVersionId(e.target.value)}
                >
                  {[...project.versions].reverse().map((v, i) => (
                    <option key={v.id} value={v.id}>
                      v{project.versions.length - i} · {time(v.createdAt)}
                    </option>
                  ))}
                </select>
                <a
                  className="primary small-button"
                  href={`/api/${isPublic ? "public/" : ""}projects/${project.id}/download?version=${activeVersion.id}`}
                  download
                >
                  <Download size={15} />
                  下载源码
                </a>
              </div>
              <div className="studio-grid">
                <aside className="studio-side">
                  <div className="eyebrow">PRODUCT BRIEF</div>
                  <h3>从想法到这个版本</h3>
                  <p>{activeVersion.prompt}</p>
                  <div className="version-meta">
                    <span>
                      <CheckCircle2 size={14} />
                      版本已保存
                    </span>
                    <span>{providerLabel(activeVersion.provider)}</span>
                  </div>
                  <div className="studio-divider" />
                  <h3>继续打磨</h3>
                  <p className="muted">
                    描述要修改的部分，会生成新版本并保留当前版本。
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      act(async () => {
                        const job = await api(
                          `/projects/${project.id}/revise`,
                          {
                            method: "POST",
                            body: JSON.stringify({
                              prompt: revision,
                              documentIds: [],
                            }),
                          },
                        );
                        await refresh();
                        setSelectedJob(job);
                        setProject(null);
                        setPage("jobs");
                        setRevision("");
                      });
                    }}
                  >
                    <textarea
                      aria-label="迭代需求"
                      placeholder="例如：增加按负责人筛选，并把统计卡改成完成率…"
                      value={revision}
                      onChange={(e) => setRevision(e.target.value)}
                      maxLength={30000}
                    />
                    <button
                      className="primary"
                      disabled={busy || revision.trim().length < 5}
                    >
                      生成新版本
                      <ArrowUp size={15} />
                    </button>
                  </form>
                  <div className="studio-tip">
                    <Lightbulb size={17} />
                    <p>
                      当前交付是浏览器原型。预览中的业务数据仅在当前页面有效；下载源码后可继续接入数据库和模型服务。
                    </p>
                  </div>
                </aside>
                <section className="studio-stage">
                  <div className="stage-toolbar">
                    <div className="stage-tabs">
                      {[
                        ["preview", "预览", Eye],
                        ["code", "源码", Code2],
                        ["prd", "产品说明", FileText],
                      ].map(([id, label, Icon]) => (
                        <button
                          key={id as string}
                          className={projectTab === id ? "active" : ""}
                          onClick={() => setProjectTab(id as string)}
                        >
                          {React.createElement(Icon as typeof Eye, {
                            size: 14,
                          })}
                          {label as string}
                        </button>
                      ))}
                    </div>
                    <button
                      className="icon-button"
                      aria-label="复制当前源码"
                      onClick={() => copy(activeVersion.code)}
                    >
                      <Copy size={15} />
                    </button>
                  </div>
                  {projectTab === "preview" ? (
                    <iframe
                      key={activeVersion.id}
                      title={`${project.title}交互预览`}
                      sandbox="allow-scripts allow-forms allow-downloads"
                      referrerPolicy="no-referrer"
                      srcDoc={safePreview(activeVersion.code)}
                    />
                  ) : projectTab === "code" ? (
                    <pre className="source-code">
                      <code>{activeVersion.code}</code>
                    </pre>
                  ) : (
                    <div className="prd-view">
                      <Markdown text={activeVersion.prd} />
                    </div>
                  )}
                  <div className="stage-footer">
                    <span className="tiny-dot" />
                    隔离预览环境
                    <span>
                      {activeVersion.provider === "demo"
                        ? "内置演示模板"
                        : isPublic
                          ? "预置示例原型"
                          : "AI 生成原型"}{" "}
                      · 请验证业务逻辑
                    </span>
                  </div>
                </section>
              </div>
            </>
          )}
          {page === "settings" && (
            <SettingsPanel
              config={boot.settings}
              onSave={async (data) => {
                await api("/settings", {
                  method: "PUT",
                  body: JSON.stringify(data),
                });
                await refresh();
                setToast("设置已保存");
              }}
              factory={!!factory}
            />
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <AlertCircle size={17} />
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function safePreview(code: string) {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
  return csp + code;
}
function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{String(value).padStart(2, "0")}</strong>
    </div>
  );
}
function SearchBox({
  value,
  set,
  placeholder,
}: {
  value: string;
  set: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="search-box">
      <Search size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
}
function Empty({
  icon: Icon,
  title,
  text,
  compact,
  action,
  actionLabel,
}: {
  icon: typeof Box;
  title: string;
  text: string;
  compact?: boolean;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className={`empty-state ${compact ? "compact" : ""}`}>
      <span className="empty-icon">
        <Icon size={25} strokeWidth={1.4} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="secondary" onClick={action}>
          <Plus size={15} />
          {actionLabel}
        </button>
      )}
    </div>
  );
}
function JobRow({ job, onClick }: { job: Job; onClick: () => void }) {
  return (
    <button className="job-row" onClick={onClick}>
      <span className="job-icon">
        {job.status === "completed" ? (
          <FileText size={19} />
        ) : ["running", "queued"].includes(job.status) ? (
          <Loader2 className="spin" size={19} />
        ) : (
          <Clock3 size={19} />
        )}
      </span>
      <div>
        <b>{job.title}</b>
        <small>
          {providerLabel(job.provider)} · {time(job.createdAt)}
        </small>
      </div>
      <span className={`status ${job.status}`}>{statusLabel(job.status)}</span>
      <ArrowUpRight size={16} />
    </button>
  );
}
function ProjectCard({
  project,
  onOpen,
}: {
  project: Project;
  onOpen: () => void;
}) {
  return (
    <button className="project-card" onClick={onOpen}>
      <div className="project-thumb">
        <div className="thumb-toolbar">
          <span />
          <i />
        </div>
        <div className="thumb-stats">
          <i />
          <i />
          <i />
        </div>
        <div className="thumb-columns">
          <span>
            <i />
            <i />
          </span>
          <span>
            <i />
          </span>
          <span>
            <i />
            <i />
          </span>
        </div>
        <span className="project-version">v{project.versions.length}</span>
      </div>
      <div className="project-card-content">
        <h3>
          {project.title}
          <ArrowUpRight size={16} />
        </h3>
        <p>{project.description}</p>
        <footer>
          <span className="tiny-dot" />
          已保存<span>{time(project.updatedAt)}</span>
        </footer>
      </div>
    </button>
  );
}
function SettingsPanel({
  config,
  onSave,
  factory,
}: {
  config: Config;
  onSave: (data: Config & { apiKey?: string }) => Promise<void>;
  factory: boolean;
}) {
  const [provider, setProvider] = useState(config.provider),
    [baseUrl, setBaseUrl] = useState(config.baseUrl),
    [model, setModel] = useState(config.model),
    [key, setKey] = useState(""),
    [keyChanged, setKeyChanged] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <PageHeading
        eyebrow="MAKE IT YOURS"
        title="用你信任的模型工作"
        description="选择运行方式。任务资料只会发送给你选定的模型服务。"
      />
      <form
        className="settings-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError("");
          try {
            await onSave({
              ...config,
              provider,
              baseUrl,
              model,
              ...(keyChanged ? { apiKey: key } : {}),
            });
            setKey("");
            setKeyChanged(false);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <h3>模型连接</h3>
        <div className="provider-options">
          {[
            ["demo", "演示模式", "使用内置示例，不调用 AI", Eye],
            ["codex", "本机 Codex", "使用本机已登录的 Codex CLI", Terminal],
            ["openai", "API 模型", "连接 OpenAI 兼容的模型服务", Sparkles],
          ]
            .filter(([id]) => !config.cloud || id !== "codex")
            .map(([id, label, description, Icon]) => (
              <label
                key={id as string}
                className={provider === id ? "selected" : ""}
              >
                <input
                  type="radio"
                  name="provider"
                  value={id as string}
                  checked={provider === id}
                  onChange={() => setProvider(id as string)}
                />
                {React.createElement(Icon as typeof Eye, { size: 20 })}
                <span>
                  <b>{label as string}</b>
                  <small>{description as string}</small>
                </span>
                {provider === id && <CheckCircle2 size={17} />}
              </label>
            ))}
        </div>
        {provider === "codex" && (
          <div className="setting-explanation">
            <Terminal size={21} />
            <div>
              <b>准备好 Codex，即可开始</b>
              <p>
                需要本机已安装 Codex CLI，并运行 <code>codex login</code>{" "}
                完成登录。任务以只读沙盒调用模型，使用账号对应的额度。首次生成可能需要几分钟。
              </p>
            </div>
          </div>
        )}
        {provider === "demo" && (
          <div className="setting-explanation">
            <Eye size={21} />
            <div>
              <b>先熟悉完整工作流程</b>
              <p>
                演示模式返回内置模板，不会理解自由输入或真实分析资料。切换 Codex
                或 API 后才能获得按需求生成的结果。
              </p>
            </div>
          </div>
        )}
        {provider === "openai" && (
          <div className="api-fields">
            <label>
              接口地址
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                required
              />
            </label>
            <label>
              模型名称
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="填写服务商提供的模型 ID"
                required
              />
            </label>
            <label>
              API Key
              <input
                type="password"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setKeyChanged(true);
                }}
                autoComplete="off"
                placeholder={
                  config.hasApiKey ? "已配置；留空保留现有密钥" : "输入 API Key"
                }
              />
            </label>
            <small>
              {config.cloud
                ? "密钥加密保存在私有云存储中，不会返回浏览器；清空输入并保存可删除密钥。"
                : "密钥仅保存在当前服务进程内存中，重启后需重新输入；也可使用环境变量 OPENAI_API_KEY。"}
            </small>
          </div>
        )}
        {error && <div className="error-banner">{error}</div>}
        <div className="settings-footer">
          <span>模型变更对新任务生效</span>
          <button className="primary" disabled={saving}>
            {saving ? (
              <Loader2 className="spin" size={15} />
            ) : (
              <Check size={15} />
            )}
            保存设置
          </button>
        </div>
      </form>
      <div className="settings-note">
        <h3>关于这个工作空间</h3>
        <p>{factory ? "造物 Product Foundry" : "亦伴 AI PM Worker"} · v0.1.0</p>
        <p>
          {config.cloud
            ? "单用户私有工作空间。任务、资料和版本保存在 Vercel 私有 Blob 存储中，使用访问口令保护。"
            : "单用户、本地运行。任务记录和交付物保存在项目的 data 目录。"}
          不包含多人团队账号与企业权限管理。
        </p>
        {config.cloud && (
          <button
            className="secondary logout"
            type="button"
            onClick={async () => {
              await api("/logout", { method: "POST" });
              location.reload();
            }}
          >
            退出工作空间
          </button>
        )}
      </div>
    </>
  );
}
function LoginScreen({
  product,
  onLogin,
  onCancel,
}: {
  product: { name: string; id: string };
  onLogin: () => Promise<void>;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div
      className={`login-screen ${product.id === "factory" ? "factory" : "worker"}`}
    >
      <div className="login-decoration" />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("/login", {
              method: "POST",
              body: JSON.stringify({ password }),
            });
            await onLogin();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="brand-symbol">
          {product.id === "factory" ? <Layers size={25} /> : "亦"}
        </div>
        <div className="eyebrow">YOUR PRIVATE WORKSPACE</div>
        <h1>{product.name}</h1>
        <p>
          {product.id === "factory"
            ? "让下一个好想法，成为一个能用的产品。"
            : "把琐碎交给 AI，把判断留给你。"}
        </p>
        <label>
          工作空间访问口令
          <input
            type="password"
            autoComplete="current-password"
            placeholder="输入你的访问口令"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <button className="primary" disabled={busy}>
          {busy ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <ArrowRight size={16} />
          )}
          进入工作空间
        </button>
        <small>私人资料、模型配置与生成操作需要登录。</small>
        <button type="button" className="secondary" onClick={onCancel}>
          返回公开体验
        </button>
      </form>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
