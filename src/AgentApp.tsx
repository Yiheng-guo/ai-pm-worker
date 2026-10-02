import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ClaimCitation } from "./ClaimReview";
import type { PrototypeBrief, PrototypeRequest } from "./RequirementsWorkspace";
import type { TaskAction } from "./TaskWorkspace";
import type { ImportedSource } from "./LocalSources";
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
  GitBranch,
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
const ClaimReview = lazy(() => import("./ClaimReview"));
const RequirementsWorkspace = lazy(() => import("./RequirementsWorkspace"));
const TaskWorkspace = lazy(() => import("./TaskWorkspace"));
const LocalSources = lazy(() => import("./LocalSources"));
const PrototypeBriefDetails = lazy(() =>
  import("./RequirementsWorkspace").then((module) => ({
    default: module.PrototypeBriefDetails,
  })),
);

type Page =
  | "overview"
  | "research"
  | "evidence"
  | "requirements"
  | "prototypes"
  | "tasks"
  | "evaluation"
  | "settings";
type Memory = {
  id: string;
  text: string;
  source?: string;
  updatedAt?: string;
  revisionId?: string;
  status?: "active";
};
type MemoryRevision = {
  revisionId: string;
  memoryId: string;
  text: string;
  source?: string;
  operation:
    "confirmed" | "corrected" | "deactivated" | "restored" | "imported";
  at: string;
  previousRevisionId?: string;
  reason?: string;
};
type Project = {
  id: string;
  name: string;
  background: string;
  goal: string;
  constraints: string;
  memory: Memory[];
  memoryRevision?: number;
  memoryHistory?: MemoryRevision[];
  decisions: (string | { text?: string; title?: string; at?: string })[];
  createdAt: string;
  updatedAt: string;
};
type Source = {
  id: string;
  title: string;
  url: string;
  text?: string;
  sha256: string;
  fetchedAt: string | null;
  status: string;
  preview?: string;
  reusedFrom?: {
    runId: string;
    sourceId: string;
    originalRunId?: string;
    fetchedAt: string;
    sha256: string;
  };
  reusedAt?: string;
  ageAtReuseSeconds?: number;
  truncated?: boolean;
  capturedAt?: string;
  origin?: ImportedSource["origin"];
  extraction?: {
    method?: string;
    format?: string;
    providedChars: number;
    extractedChars: number;
    offsetUnit?: string;
    transformed?: boolean;
    htmlMarkupRemoved?: boolean;
    note?: string;
  };
};
type Requirement = {
  id: string;
  title: string;
  description: string;
  sourceIds: string[];
  acceptance: string | string[];
};
type Action = TaskAction;
type CancellationRecovery = {
  upstreamOutcome?: string;
  note?: string;
  projectId?: string;
  versionId?: string;
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
    note?: string;
  };
  prototype?: {
    projectId: string;
    versionId: string;
    code: string;
    prd: string;
    title: string;
    versionSelection?: "job-version-id" | "legacy-latest-unverified";
  };
  error?: string;
  createdAt: string;
  completedAt?: string;
  updatedAt?: string;
  detailAvailable?: boolean;
  raw?: {
    prototypeBrief?: PrototypeBrief;
    foundryRecovery?: CancellationRecovery;
  };
  cancellationPending?: boolean;
  cancelRequestedAt?: string;
  cancellationRecovery?: CancellationRecovery;
};
type Evaluation = {
  id: string;
  title: string;
  createdAt: string;
  status: string;
  sampleSize?: number;
  caseCount?: number;
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
  detailAvailable?: boolean;
};
type Settings = {
  provider: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
};
type Boot = {
  compact?: boolean;
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
type QuoteLocation = {
  sourceKey: string;
  start: number;
  end: number;
  sha256: string;
  textSha256?: string;
};

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
  return (
    !!run &&
    (["queued", "running"].includes(run.status) || !!run.cancellationPending)
  );
}
function date(value?: string | null, short = false) {
  return value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        ...(short ? {} : { hour: "2-digit", minute: "2-digit" }),
        timeZone: "Asia/Shanghai",
      })
    : "—";
}
function age(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "时间未记录";
  const hours = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 3600000),
  );
  return hours < 1
    ? "不到 1 小时前"
    : hours < 24
      ? `${hours} 小时前`
      : `${Math.floor(hours / 24)} 天前`;
}
function sourceTimestamp(source: Source) {
  return source.status === "imported" || source.origin
    ? source.capturedAt || source.fetchedAt
    : source.fetchedAt;
}
function sourceProvenance(source: Source) {
  return source.origin?.kind === "git-commit"
    ? "固定提交文档"
    : source.origin?.kind === "text-import"
      ? "提交者文本"
      : "网页快照";
}
function runFingerprint(run?: Run) {
  if (!run) return "";
  return JSON.stringify([
    run.status,
    run.updatedAt,
    run.completedAt,
    run.stage,
    run.events?.length,
    run.result?.actions,
    run.cancellationPending,
    run.cancelRequestedAt,
    run.usage,
    run.sources?.map((s) => [s.id, s.sha256, s.status]),
  ]);
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
      {run.cancellationPending ? "正在取消" : labels[run.status]}
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
  const [requirementIndex, setRequirementIndex] = useState<number | null>(null);
  const activeProjectId = useRef(projectId);
  activeProjectId.current = projectId;
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
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [quoteLocation, setQuoteLocation] = useState<QuoteLocation | null>(
    null,
  );
  const [quoteValidation, setQuoteValidation] = useState<
    "none" | "loading" | "valid" | "invalid"
  >("none");
  const [runDetails, setRunDetails] = useState<
    Record<string, { fingerprint: string; run: Run }>
  >({});
  const [evaluationDetails, setEvaluationDetails] = useState<
    Record<string, { fingerprint: string; report: Evaluation }>
  >({});
  const [detailState, setDetailState] = useState({
    id: "",
    loading: false,
    error: "",
  });
  const [evaluationState, setEvaluationState] = useState({
    id: "",
    loading: false,
    error: "",
  });
  const [detailReload, setDetailReload] = useState(0);
  const [claimAuditRefresh, setClaimAuditRefresh] = useState(0);
  const [cancelStates, setCancelStates] = useState<
    Record<string, { loading: boolean; error: string }>
  >({});
  const [importedSources, setImportedSources] = useState<{
    projectId: string;
    sources: ImportedSource[];
  }>({ projectId: "", sources: [] });
  const [importedDetails, setImportedDetails] = useState<
    Record<string, ImportedSource>
  >({});
  const [importedListState, setImportedListState] = useState({
    projectId: "",
    loading: false,
    error: "",
  });
  const [importedDetailState, setImportedDetailState] = useState({
    key: "",
    loading: false,
    error: "",
  });
  const [importedReload, setImportedReload] = useState(0);
  const runMutationSequence = useRef(0),
    runMutationEpochs = useRef<Record<string, number>>({});
  const composer = useRef<HTMLTextAreaElement>(null),
    contentRef = useRef<HTMLElement>(null),
    quoteMark = useRef<HTMLElement>(null);
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
      throw Object.assign(new Error(data.error || "请求失败，请稍后重试"), {
        status: response.status,
        code: data.code,
        actualChars: data.actualChars,
        maxChars: data.maxChars,
        selectedIndices: data.selectedIndices,
      });
    }
    return data;
  }
  async function refresh(initial = false) {
    const startedAtEpoch = runMutationSequence.current;
    try {
      const data: Boot = await api("/agent/bootstrap");
      setBoot((current) => {
        const recent = (current?.runs || []).filter(
          (run) => (runMutationEpochs.current[run.id] || 0) > startedAtEpoch,
        );
        return recent.length
          ? {
              ...data,
              runs: [
                ...recent,
                ...data.runs.filter(
                  (run) => !recent.some((saved) => saved.id === run.id),
                ),
              ],
            }
          : data;
      });
      setLocked(false);
      setError("");
      if (initial) readHash(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  function mergeRun(run: Run) {
    if (!run?.id || !run.projectId) return;
    runMutationEpochs.current[run.id] = ++runMutationSequence.current;
    setBoot((current) =>
      current
        ? {
            ...current,
            runs: [run, ...current.runs.filter((item) => item.id !== run.id)],
          }
        : current,
    );
    setRunDetails((current) => ({
      ...current,
      [run.id]: { fingerprint: runFingerprint(run), run },
    }));
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
        .find((key) => key === hash.get("source")) ||
      (/^import:[a-zA-Z0-9_-]{1,100}$/.test(hash.get("source") || "")
        ? hash.get("source")!
        : "");
    setProjectId(selected);
    setPage(validPage);
    setRunId(nextRun);
    setSourceKey(nextSource);
    const nextRequirement = Number(hash.get("requirement"));
    setRequirementIndex(
      validPage === "requirements" &&
        hash.has("requirement") &&
        Number.isInteger(nextRequirement) &&
        nextRequirement >= 0 &&
        nextRequirement <
          (projectRuns.find((run) => run.id === nextRun)?.result?.requirements
            ?.length || 0)
        ? nextRequirement
        : null,
    );
    const start = Number(hash.get("quoteStart")),
      end = Number(hash.get("quoteEnd")),
      quoteSha = hash.get("quoteSha");
    setQuoteLocation(
      nextSource &&
        quoteSha &&
        hash.has("quoteStart") &&
        hash.has("quoteEnd") &&
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= 0 &&
        end > start
        ? {
            sourceKey: nextSource,
            start,
            end,
            sha256: quoteSha,
            textSha256: hash.get("quoteTextSha") || undefined,
          }
        : null,
    );
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
    if (page === "requirements" && requirementIndex !== null)
      h.set("requirement", String(requirementIndex));
    if (quoteLocation?.sourceKey === sourceKey) {
      h.set("quoteStart", String(quoteLocation.start));
      h.set("quoteEnd", String(quoteLocation.end));
      h.set("quoteSha", quoteLocation.sha256);
      if (quoteLocation.textSha256)
        h.set("quoteTextSha", quoteLocation.textSha256);
    }
    history.replaceState(
      null,
      "",
      `${location.pathname}${location.search}#${h.toString()}`,
    );
  }, [
    projectId,
    page,
    runId,
    sourceKey,
    quoteLocation,
    requirementIndex,
    !!boot,
  ]);
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
    setSelectedSourceIds([]);
    setSourceUrls("");
  }, [projectId]);
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
        .map((r) =>
          runDetails[r.id]?.fingerprint === runFingerprint(r)
            ? runDetails[r.id].run
            : r,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [boot?.runs, project?.id, runDetails],
  );
  const selectedRun =
    runId === "new"
      ? undefined
      : runs.find((r) => r.id === runId && r.kind !== "prototype") ||
        runs.find((r) => r.kind === "research" && r.status === "completed") ||
        runs.find((r) => r.kind !== "prototype");
  const sources = useMemo<SourceRef[]>(
    () => [
      ...(importedSources.projectId === project?.id
        ? importedSources.sources
        : []
      ).map((source) => {
        const detail = importedDetails[`${project!.id}:${source.id}`];
        return {
          ...(detail?.sha256 === source.sha256 ? detail : source),
          runId: "",
          key: `import:${source.id}`,
        };
      }),
      ...runs
        .filter((r) => r.kind !== "prototype")
        .flatMap((r) =>
          (r.sources || []).map((s) => ({
            ...s,
            runId: r.id,
            key: `${r.id}:${s.id}`,
          })),
        ),
    ],
    [runs, project?.id, importedSources, importedDetails],
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
  const selectedSource =
    sources.find((s) => s.key === sourceKey) ||
    (sourceKey.startsWith("import:") ? undefined : sources[0]);
  const needsImportedSources = page === "evidence" || page === "research";
  useEffect(() => {
    if (!project?.id || !needsImportedSources) return;
    const id = project.id;
    const controller = new AbortController();
    setImportedListState({ projectId: id, loading: true, error: "" });
    void api(`/agent/projects/${encodeURIComponent(id)}/sources`, {
      signal: controller.signal,
    })
      .then((data: { projectId: string; sources: ImportedSource[] }) => {
        if (controller.signal.aborted) return;
        if (data.projectId !== id)
          throw new Error("项目资料与当前项目不一致。");
        setImportedSources((current) => ({
          projectId: id,
          sources: [
            ...data.sources,
            ...(current.projectId === id
              ? current.sources.filter(
                  (source) =>
                    !data.sources.some((saved) => saved.id === source.id),
                )
              : []),
          ],
        }));
        setImportedListState({ projectId: id, loading: false, error: "" });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setImportedListState({
            projectId: id,
            loading: false,
            error: (e as Error).message,
          });
      });
    return () => controller.abort();
  }, [project?.id, needsImportedSources, importedReload]);
  useEffect(() => {
    if (
      page !== "evidence" ||
      !selectedSource ||
      selectedSource.runId ||
      typeof selectedSource.text === "string" ||
      !project?.id
    )
      return;
    const controller = new AbortController();
    const id = project.id,
      key = selectedSource.key,
      sourceId = selectedSource.id,
      expectedSha256 = selectedSource.sha256;
    setImportedDetailState({ key, loading: true, error: "" });
    void api(
      `/agent/projects/${encodeURIComponent(id)}/sources/${encodeURIComponent(sourceId)}`,
      { signal: controller.signal },
    )
      .then((source: ImportedSource) => {
        if (controller.signal.aborted) return;
        if (
          source.projectId !== id ||
          source.id !== sourceId ||
          source.sha256 !== expectedSha256
        )
          throw new Error("资料详情与当前选择不一致。");
        setImportedDetails((cache) => ({
          ...cache,
          [`${id}:${sourceId}`]: source,
        }));
        setImportedDetailState({ key, loading: false, error: "" });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setImportedDetailState({
            key,
            loading: false,
            error: (e as Error).message,
          });
      });
    return () => controller.abort();
  }, [
    page,
    project?.id,
    selectedSource?.key,
    selectedSource?.sha256,
    typeof selectedSource?.text,
    importedReload,
  ]);
  useEffect(() => {
    if (
      page !== "evidence" ||
      !quoteLocation ||
      quoteLocation.sourceKey !== selectedSource?.key
    ) {
      setQuoteValidation("none");
      return;
    }
    const source = selectedSource,
      location = quoteLocation;
    if (source.text === undefined) {
      setQuoteValidation("loading");
      return;
    }
    const text = source.text;
    const splitsSurrogate = (offset: number) =>
      offset > 0 &&
      offset < text.length &&
      /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
      /[\uDC00-\uDFFF]/.test(text[offset]);
    if (
      source.sha256 !== location.sha256 ||
      location.end > text.length ||
      splitsSurrogate(location.start) ||
      splitsSurrogate(location.end)
    ) {
      setQuoteValidation("invalid");
      return;
    }
    if (!location.textSha256) {
      setQuoteValidation("valid");
      return;
    }
    let cancelled = false;
    setQuoteValidation("loading");
    void crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(text))
      .then((digest) => {
        if (!cancelled) {
          const hash = Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
          setQuoteValidation(
            hash === location.textSha256 ? "valid" : "invalid",
          );
        }
      })
      .catch(() => {
        if (!cancelled) setQuoteValidation("invalid");
      });
    return () => {
      cancelled = true;
    };
  }, [
    page,
    selectedSource?.key,
    selectedSource?.sha256,
    selectedSource?.text,
    quoteLocation,
  ]);
  useEffect(() => {
    if (quoteValidation === "valid")
      quoteMark.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
  }, [quoteValidation, selectedSource?.key]);
  const evaluationSummary =
    boot?.evaluations.find((e) => e.id === evalId) || boot?.evaluations[0];
  const evaluationFingerprint = evaluationSummary
    ? JSON.stringify([
        evaluationSummary.status,
        evaluationSummary.metrics,
        evaluationSummary.caseCount,
        evaluationSummary.sampleSize,
        evaluationSummary.limitations,
      ])
    : "";
  const evaluation =
    evaluationSummary &&
    (evaluationDetails[evaluationSummary.id]?.fingerprint ===
    evaluationFingerprint
      ? evaluationDetails[evaluationSummary.id].report
      : evaluationSummary);
  const reusableSources = Array.from(
    new Map(
      sources
        .filter((s) => s.status !== "failed" && !!s.sha256)
        .map((s) => [s.id, s]),
    ).values(),
  );
  const detailRunId =
    page === "research"
      ? selectedRun?.id
      : page === "evidence"
        ? selectedSource?.runId
        : page === "prototypes"
          ? selectedPrototype?.id
          : undefined;
  const detailSummary = boot?.runs.find((r) => r.id === detailRunId);
  const detailFingerprint = runFingerprint(detailSummary);
  useEffect(() => {
    if (!detailRunId || !boot?.compact) {
      setDetailState({ id: "", loading: false, error: "" });
      return;
    }
    const id = detailRunId;
    if (runDetails[id]?.fingerprint === detailFingerprint) {
      setDetailState({ id, loading: false, error: "" });
      return;
    }
    const controller = new AbortController();
    setDetailState({ id, loading: true, error: "" });
    void api(`/agent/runs/${id}`, { signal: controller.signal })
      .then((run: Run) => {
        if (controller.signal.aborted) return;
        setRunDetails((cache) => ({
          ...cache,
          [id]: { fingerprint: detailFingerprint, run },
        }));
        setDetailState({ id, loading: false, error: "" });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setDetailState({ id, loading: false, error: (e as Error).message });
      });
    return () => controller.abort();
  }, [detailRunId, detailFingerprint, boot?.compact, detailReload]);
  useEffect(() => {
    if (
      page !== "evaluation" ||
      !evaluationSummary ||
      !boot?.compact ||
      evaluationDetails[evaluationSummary.id]?.fingerprint ===
        evaluationFingerprint
    )
      return;
    const id = evaluationSummary.id;
    const controller = new AbortController();
    setEvaluationState({ id, loading: true, error: "" });
    void api(`/agent/evaluations/${id}`, { signal: controller.signal })
      .then((report: Evaluation) => {
        if (controller.signal.aborted) return;
        setEvaluationDetails((cache) => ({
          ...cache,
          [id]: { fingerprint: evaluationFingerprint, report },
        }));
        setEvaluationState({ id, loading: false, error: "" });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setEvaluationState({
            id,
            loading: false,
            error: (e as Error).message,
          });
      });
    return () => controller.abort();
  }, [
    page,
    evaluationSummary?.id,
    evaluationFingerprint,
    boot?.compact,
    detailReload,
  ]);
  const activeRuns = runs.filter(isBusy),
    completeRuns = runs.filter((r) => r.status === "completed");
  const modelReady =
    boot?.settings.provider === "codex" ||
    (boot?.settings.provider === "openai" && boot.settings.hasApiKey);
  function navigate(next: Page, id?: string) {
    setPage(next);
    if (id !== undefined) setRunId(id);
    setRequirementIndex(null);
    setMobileNav(false);
    contentRef.current?.scrollTo({ top: 0 });
  }
  function chooseProject(id: string) {
    setProjectId(id);
    setRunId("");
    setSourceKey("");
    setProjectMenu(false);
    setSessionId(crypto.randomUUID());
    setSelectedSourceIds([]);
    setSourceUrls("");
    setQuoteLocation(null);
    setRequirementIndex(null);
  }
  function viewRequirement(from: Run, index: number) {
    if (
      from.projectId !== project?.id ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= (from.result?.requirements?.length || 0)
    )
      return;
    navigate("requirements", from.id);
    setRequirementIndex(index);
  }
  function seed(text: string, recall = false) {
    setPrompt(text);
    setRunId("new");
    setSelectedSourceIds([]);
    setSourceUrls("");
    navigate("research");
    if (recall) setShowSources(false);
    setTimeout(() => composer.current?.focus(), 100);
  }
  function viewSource(id: string, from: Run, citation?: ClaimCitation) {
    const source = from.sources?.find((s) => s.id === id);
    if (source) {
      setSourceKey(`${from.id}:${id}`);
      setQuoteLocation(
        citation?.matched && citation.locator && citation.sourcePin
          ? {
              sourceKey: `${from.id}:${id}`,
              start: citation.locator.start,
              end: citation.locator.end,
              sha256: citation.sourcePin.sha256,
              textSha256: citation.sourcePin.textSha256,
            }
          : null,
      );
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
  function rememberImported(source: ImportedSource) {
    if (!project || (source.projectId && source.projectId !== project.id))
      return;
    const id = project.id;
    setImportedSources((current) => ({
      projectId: id,
      sources: [
        source,
        ...(current.projectId === id
          ? current.sources.filter((item) => item.id !== source.id)
          : []),
      ],
    }));
    if (typeof source.text === "string")
      setImportedDetails((current) => ({
        ...current,
        [`${id}:${source.id}`]: source,
      }));
  }
  function openImported(source: ImportedSource) {
    rememberImported(source);
    setSourceKey(`import:${source.id}`);
    setQuoteLocation(null);
    navigate("evidence", "");
  }
  function researchImported(source: ImportedSource) {
    rememberImported(source);
    seed(
      `结合当前项目背景，研究已导入资料「${source.title}」中值得采用的机制与需求。请区分资料原文声明、产品价值推断和仍需验证的事项；固定提交文档或提交者文本不能代表当前网络现状。`,
    );
    setSelectedSourceIds([source.id]);
    setShowSources(true);
    setSessionId(crypto.randomUUID());
    setToast("项目资料已带入研究草稿，确认后才会调用模型。");
  }
  async function submit(kind: "research" | "recall" = "research") {
    if (!project || !prompt.trim() || submitting) return;
    if (prompt.trim().length < 5) {
      setToast("请至少输入 5 个字符，描述你的研究目标");
      return;
    }
    const urls = (kind === "research" ? sourceUrls : "")
      .split(/\n|,|，/)
      .map((v) => v.trim())
      .filter(Boolean);
    const existing =
      kind === "research"
        ? selectedSourceIds.filter((id) =>
            reusableSources.some((s) => s.id === id),
          )
        : [];
    if (kind === "research" && urls.length + existing.length > 4) {
      setToast("新链接与已存证据合计最多 4 条，请保留最重要的来源");
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
            sourceIds: existing,
          }),
        },
      );
      setBoot((b) =>
        b ? { ...b, runs: [run, ...b.runs.filter((r) => r.id !== run.id)] } : b,
      );
      setRunId(run.id);
      setPrompt("");
      setSourceUrls("");
      setSelectedSourceIds([]);
      setSessionId(run.sessionId || sessionId);
      navigate("research");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }
  async function cancel(run: Run) {
    if (run.cancellationPending || cancelStates[run.id]?.loading) return;
    setCancelStates((current) => ({
      ...current,
      [run.id]: { loading: true, error: "" },
    }));
    try {
      const canonical: Run = await api(`/agent/runs/${run.id}/cancel`, {
        method: "POST",
      });
      mergeRun(canonical);
      setToast(
        canonical.cancellationPending
          ? "取消请求已发送，等待执行停止和记录保存。"
          : canonical.status === "cancelled"
            ? "任务已取消，已保存的记录可以继续查看。"
            : "任务状态已更新，请查看最终记录。",
      );
    } catch (e) {
      const failure = e as Error & { code?: string };
      const message =
        failure.code === "RUN_FINALIZING"
          ? "任务正在保存最终记录，当前不可取消；请等待最终状态。"
          : failure.message;
      setCancelStates((current) => ({
        ...current,
        [run.id]: { loading: false, error: message },
      }));
      return;
    } finally {
      setCancelStates((current) => ({
        ...current,
        [run.id]: { loading: false, error: current[run.id]?.error || "" },
      }));
    }
  }
  async function generatePrototype(
    researchRunId: string,
    body: PrototypeRequest,
  ) {
    if (submitting) throw new Error("另一项制作正在提交，请稍后重试。");
    const run = runs.find((item) => item.id === researchRunId);
    if (
      !run ||
      run.projectId !== project?.id ||
      run.status !== "completed" ||
      run.kind === "prototype"
    )
      throw new Error("研究记录已变化，请重新选择当前项目的已完成研究。");
    setSubmitting(true);
    try {
      const next: Run = await api(`/agent/runs/${run.id}/prototype`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setBoot((b) => (b ? { ...b, runs: [next, ...b.runs] } : b));
      if (activeProjectId.current === run.projectId) {
        setRunId(next.id);
        navigate("prototypes");
      } else {
        setToast("原项目的制作任务已提交，可切回该项目查看记录。");
      }
    } finally {
      setSubmitting(false);
    }
  }
  function followUp(action: Action & { run: Run }) {
    seed(
      `跟进待办「${action.title}」。\n${action.note ? `已有进展：${action.note}\n` : ""}请结合项目当前背景和已有证据，判断这项行动的验证价值、缺失信息与下一步。旧证据代表抓取时的内容，涉及最新变化时请明确核实。`,
    );
    const ids = (
      action.sourceIds?.length
        ? action.sourceIds
        : action.run.sources.map((s) => s.id)
    )
      .filter((id) => reusableSources.some((s) => s.id === id))
      .slice(0, 4);
    setSelectedSourceIds(ids);
    setShowSources(ids.length > 0);
    setSessionId(crypto.randomUUID());
    setToast("已填入跟进问题和关联证据，确认后再开始研究");
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
      await api(`/agent/projects/${project.id}/memory`, {
        method: "POST",
        body: JSON.stringify({
          text: item.text.trim(),
          source:
            `用户确认 · 研究 ${run.id} · 证据 ${(item.sourceIds || []).join(", ")}`.slice(
              0,
              300,
            ),
          confirm: true,
          expectedRevision: project.memoryRevision ?? 0,
        }),
      });
      await refresh();
      setToast("已确认并保存到项目记忆，下一次研究会读取这条信息");
    } catch (e) {
      await refresh();
      setError((e as Error).message);
    } finally {
      setSavingMemory("");
    }
  }
  function runFooter(run: Run) {
    return (
      <>
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
        {(["failed", "cancelled"].includes(run.status) ||
          run.cancellationPending) &&
          run.usage?.note && <p className="ag-usage-note">{run.usage.note}</p>}
      </>
    );
  }
  function cancellationNotice(run: Run) {
    const recovery = run.cancellationRecovery || run.raw?.foundryRecovery;
    return recovery?.upstreamOutcome === "completed-after-cancel-request" ? (
      <div className="ag-cancellation-recovery">
        <AlertCircle size={15} />
        <div>
          <b>上游原型已保存，需要核对</b>
          <p>
            取消请求之后，造物仍完成了远端版本保存。主任务保持取消状态；已发生的调用量和恢复记录会保留，不会视为本次成功交付。
            {recovery.note}
          </p>
          <a href={`/api/agent/runs/${run.id}/export`}>
            查看上游版本与计量记录
            <ArrowUpRight size={12} />
          </a>
        </div>
      </div>
    ) : null;
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
  function detailNotice(state = detailState) {
    if (!state.loading && !state.error) return null;
    return (
      <div
        className={`ag-detail-notice ${state.error ? "error" : ""}`}
        role="status"
      >
        {state.loading ? (
          <Loader2 size={15} className="ag-spin" />
        ) : (
          <AlertCircle size={15} />
        )}
        <span>
          {state.loading
            ? "正在读取完整记录…"
            : `完整记录暂未载入：${state.error}`}
        </span>
        {state.error && (
          <button type="button" onClick={() => setDetailReload((v) => v + 1)}>
            重新读取
            <RefreshCw size={12} />
          </button>
        )}
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
              {run.cancellationPending
                ? "正在等待任务停止与记录保存"
                : run.kind === "prototype"
                  ? "造物正在制作原型"
                  : "亦伴正在推进研究"}
            </b>
            <small>{run.stage || "准备任务上下文"}</small>
          </div>
          <button
            className="ag-button ghost small"
            onClick={() => void cancel(run)}
            disabled={run.cancellationPending || cancelStates[run.id]?.loading}
          >
            {run.cancellationPending || cancelStates[run.id]?.loading ? (
              <Loader2 size={12} className="ag-spin" />
            ) : (
              <Square size={12} />
            )}
            {run.cancellationPending
              ? "正在取消"
              : cancelStates[run.id]?.loading
                ? "发送取消请求"
                : "取消任务"}
          </button>
        </div>
        {run.cancellationPending && (
          <p className="ag-cancel-pending-note">
            已在 {date(run.cancelRequestedAt)}{" "}
            请求取消。结束状态尚未确认，页面会继续更新日志和已记录用量。
          </p>
        )}
        {cancelStates[run.id]?.error && (
          <p className="ag-field-error ag-cancel-error" role="alert">
            {cancelStates[run.id].error}
          </p>
        )}
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
        {run.cancellationPending && runFooter(run)}
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
          <button onClick={() => navigate("requirements", run.id)}>
            <Box size={15} />
            选择需求交给造物
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
          <span className="ag-brand-version">05</span>
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
                            value={selectedRun?.id || "new"}
                            onChange={(e) => setRunId(e.target.value)}
                            aria-label="选择研究记录"
                          >
                            <option value="new">新的研究问题 · 尚未提交</option>
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
                        {detailNotice()}
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
                                  <details
                                    className="ag-claims"
                                    key={selectedRun.id}
                                    onToggle={(event) => {
                                      if (event.currentTarget.open)
                                        setClaimAuditRefresh(
                                          (value) => value + 1,
                                        );
                                    }}
                                  >
                                    <summary>
                                      核对关键事实与推断
                                      <span>
                                        {selectedRun.result.claims.length} 条
                                      </span>
                                      <ChevronDown size={14} />
                                    </summary>
                                    <Suspense
                                      fallback={
                                        <div className="ag-detail-notice">
                                          <Loader2
                                            size={14}
                                            className="ag-spin"
                                          />
                                          正在载入断言审阅工具…
                                        </div>
                                      }
                                    >
                                      <ClaimReview
                                        key={selectedRun.id}
                                        runId={selectedRun.id}
                                        projectId={selectedRun.projectId}
                                        sources={selectedRun.sources || []}
                                        originalClaims={
                                          selectedRun.result.claims
                                        }
                                        request={api}
                                        refreshKey={claimAuditRefresh}
                                        onSource={(id, citation) =>
                                          viewSource(id, selectedRun, citation)
                                        }
                                        onRecordsChanged={() => {
                                          setRunDetails((cache) => {
                                            const next = { ...cache };
                                            delete next[selectedRun.id];
                                            return next;
                                          });
                                          setDetailReload((value) => value + 1);
                                          void refresh();
                                        }}
                                      />
                                    </Suspense>
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
                                {selectedRun.status === "cancelled" &&
                                  !selectedRun.cancellationPending && (
                                    <div className="ag-note">
                                      <Square size={14} />
                                      任务已取消。已抓取的来源和过程记录可以继续查看。
                                    </div>
                                  )}
                                {cancellationNotice(selectedRun)}
                                {selectedRun.status === "completed" &&
                                  !detailState.loading &&
                                  !detailState.error &&
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
                          <div className="ag-source-composer">
                            <label className="ag-url-input">
                              <span>新抓取来源（与已有证据合计最多 4 条）</span>
                              <textarea
                                rows={2}
                                placeholder="https://github.com/…"
                                value={sourceUrls}
                                onChange={(e) => setSourceUrls(e.target.value)}
                              />
                            </label>
                            {!!reusableSources.length && (
                              <div className="ag-reuse-picker">
                                <div className="ag-side-heading">
                                  <h4>复用项目证据</h4>
                                  <span>{selectedSourceIds.length} 已选</span>
                                </div>
                                <p>
                                  读取已存原文与项目资料，不会重新访问网页。导入文本的出处需核对，历史网页的时效也需单独验证。
                                </p>
                                <div className="ag-reuse-list">
                                  {reusableSources.map((s) => (
                                    <label
                                      key={s.id}
                                      className={
                                        selectedSourceIds.includes(s.id)
                                          ? "selected"
                                          : ""
                                      }
                                    >
                                      <input
                                        type="checkbox"
                                        checked={selectedSourceIds.includes(
                                          s.id,
                                        )}
                                        onChange={(e) => {
                                          if (
                                            e.target.checked &&
                                            selectedSourceIds.length >= 4
                                          ) {
                                            setToast("每次最多选择 4 条证据");
                                            return;
                                          }
                                          setSelectedSourceIds((ids) =>
                                            e.target.checked
                                              ? [...ids, s.id]
                                              : ids.filter((id) => id !== s.id),
                                          );
                                        }}
                                      />
                                      <span>
                                        <b>{s.title || s.url}</b>
                                        <small>
                                          {s.origin || s.status === "imported"
                                            ? "本机导入"
                                            : "抓取"}{" "}
                                          {date(sourceTimestamp(s))} ·{" "}
                                          {age(sourceTimestamp(s))} ·{" "}
                                          {sourceProvenance(s)}
                                        </small>
                                        <small>
                                          SHA256 {s.sha256.slice(0, 12)} ·
                                          {s.runId
                                            ? `来自研究 ${s.runId.slice(0, 8)}`
                                            : s.origin?.kind === "git-commit"
                                              ? `提交 ${s.origin.commit?.slice(0, 12)}`
                                              : "项目资料"}
                                          {s.reusedFrom ? " · 曾被复用" : ""}
                                        </small>
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="ag-composer-bottom">
                          <div>
                            <button
                              type="button"
                              className={showSources ? "active" : ""}
                              onClick={() => setShowSources(!showSources)}
                            >
                              <Link2 size={15} />
                              选择来源
                              {(sourceUrls.trim() ||
                                selectedSourceIds.length > 0) && (
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
                    selectedSource?.key.startsWith("import:") ? (
                      <a
                        className="ag-button light"
                        href={`/api/agent/projects/${encodeURIComponent(project?.id || projectId)}/sources/${encodeURIComponent(selectedSource.id)}`}
                        download={`${(selectedSource.title || "项目资料").replace(/[\\/]/g, "-").slice(0, 70)}.json`}
                      >
                        <ArrowDownToLine size={14} />
                        导出资料存档
                      </a>
                    ) : (
                      selectedSource?.runId && (
                        <a
                          className="ag-button light"
                          href={`/api/agent/runs/${selectedSource.runId}/export`}
                        >
                          <ArrowDownToLine size={14} />
                          导出证据与记录
                        </a>
                      )
                    ),
                  )}
                  {project && (
                    <Suspense
                      fallback={
                        <div className="ag-detail-notice">
                          正在加载项目资料导入…
                        </div>
                      }
                    >
                      <LocalSources
                        key={project.id}
                        projectId={project.id}
                        onImported={rememberImported}
                        onOpen={openImported}
                        onResearch={researchImported}
                      />
                    </Suspense>
                  )}
                  {importedListState.projectId === project?.id &&
                    (importedListState.loading || importedListState.error) && (
                      <div
                        className={`ag-detail-notice ${importedListState.error ? "error" : ""}`}
                      >
                        {importedListState.loading ? (
                          <Loader2 size={14} className="ag-spin" />
                        ) : (
                          <AlertCircle size={14} />
                        )}
                        <span>
                          {importedListState.loading
                            ? "正在读取可引用的项目资料…"
                            : importedListState.error}
                        </span>
                        {importedListState.error && (
                          <button
                            onClick={() =>
                              setImportedReload((value) => value + 1)
                            }
                          >
                            重试
                          </button>
                        )}
                      </div>
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
                            onClick={() => {
                              setSourceKey(s.key);
                              setQuoteLocation(null);
                            }}
                          >
                            <div>
                              <span className="ag-source-domain">
                                <span>
                                  {s.origin
                                    ? "项"
                                    : domain(s.url).slice(0, 1).toUpperCase()}
                                </span>
                                {s.origin ? sourceProvenance(s) : domain(s.url)}
                              </span>
                              <span className={`ag-source-state ${s.status}`}>
                                {s.status === "failed"
                                  ? "读取失败"
                                  : s.status === "fetched" ||
                                      s.status === "success"
                                    ? "已存档"
                                    : s.status === "imported"
                                      ? "已导入"
                                      : s.status || "已记录"}
                              </span>
                            </div>
                            <b>{s.title || s.url}</b>
                            <p>
                              {s.text?.slice(0, 130) ||
                                s.preview ||
                                (s.status === "failed"
                                  ? "来源读取失败，查看执行记录了解原因。"
                                  : "已存原文，点击读取保存的证据正文。")}
                            </p>
                            <small>
                              {date(sourceTimestamp(s))}
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
                              onClick={() => {
                                if (selectedSource.runId)
                                  navigate("research", selectedSource.runId);
                                else {
                                  const source = importedSources.sources.find(
                                    (item) => item.id === selectedSource.id,
                                  );
                                  if (source) researchImported(source);
                                }
                              }}
                            >
                              {selectedSource.runId
                                ? "回到相关研究"
                                : "带入新的研究"}
                              <ArrowUpRight size={13} />
                            </button>
                          </div>
                          <h2>{selectedSource.title || "未命名来源"}</h2>
                          {/^https?:\/\//.test(selectedSource.url) ? (
                            <a
                              className="ag-source-url"
                              href={selectedSource.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {selectedSource.url}
                              <ExternalLink size={14} />
                            </a>
                          ) : (
                            <span className="ag-source-url">
                              本机项目资料 · {sourceProvenance(selectedSource)}
                            </span>
                          )}
                          <div className="ag-evidence-meta">
                            <span>
                              <Clock3 size={13} />
                              {selectedSource.origin ||
                              selectedSource.status === "imported"
                                ? "本机导入于"
                                : "抓取于"}{" "}
                              {date(sourceTimestamp(selectedSource))}
                            </span>
                            <span title={selectedSource.sha256 || "未记录摘要"}>
                              SHA256{" "}
                              {selectedSource.sha256?.slice(0, 12) || "未记录"}
                            </span>
                          </div>
                          <div className="ag-source-provenance">
                            <History size={15} />
                            <div>
                              <b>
                                {selectedSource.origin
                                  ? sourceProvenance(selectedSource)
                                  : selectedSource.reusedFrom
                                    ? "复用的历史证据"
                                    : "已保存的网页快照"}
                              </b>
                              <p>
                                {selectedSource.origin
                                  ? `本机导入距今 ${age(sourceTimestamp(selectedSource))}。${selectedSource.origin.note}`
                                  : `抓取距今 ${age(selectedSource.fetchedAt)}。保存的内容代表当时页面，不等于当前页面已重新验证。`}
                              </p>
                              {selectedSource.origin?.kind === "git-commit" && (
                                <p>
                                  固定提交 {selectedSource.origin.commit} ·{" "}
                                  {selectedSource.origin.relativePath}
                                  。未提交的工作区修改不在本资料中。
                                </p>
                              )}
                              {selectedSource.origin?.kind ===
                                "text-import" && (
                                <p>
                                  文本出处：
                                  {selectedSource.origin.sourceLabel ||
                                    "提交者提供"}
                                  。出处说明由提交者填写，未独立核验作者与真实性。
                                </p>
                              )}
                              {selectedSource.reusedFrom && (
                                <p>
                                  原始研究{" "}
                                  {selectedSource.reusedFrom.originalRunId ||
                                    selectedSource.reusedFrom.runId}{" "}
                                  · 复用于 {date(selectedSource.reusedAt)} ·
                                  摘要保留不变
                                </p>
                              )}
                              {selectedSource.extraction ? (
                                <p>
                                  已存提取正文{" "}
                                  {selectedSource.extraction.providedChars.toLocaleString()}{" "}
                                  /{" "}
                                  {selectedSource.extraction.extractedChars.toLocaleString()}{" "}
                                  字符位（UTF-16）
                                  {selectedSource.truncated
                                    ? "，受长度上限裁剪"
                                    : ""}
                                  {selectedSource.extraction.htmlMarkupRemoved
                                    ? "；HTML 标记已移除"
                                    : ""}
                                  。
                                  {selectedSource.extraction.note ||
                                    "提取正文不代表已覆盖来源的全部内容。"}
                                </p>
                              ) : selectedSource.truncated ? (
                                <p>
                                  旧版覆盖标记待核查：当时没有区分 HTML
                                  提取与正文裁剪，不能据此判断实际完整性。
                                </p>
                              ) : null}
                            </div>
                          </div>
                          {selectedSource.runId ? (
                            detailNotice()
                          ) : importedDetailState.key === selectedSource.key &&
                            (importedDetailState.loading ||
                              importedDetailState.error) ? (
                            <div
                              className={`ag-detail-notice ${importedDetailState.error ? "error" : ""}`}
                            >
                              <span>
                                {importedDetailState.loading
                                  ? "正在读取本次资料的已存正文…"
                                  : importedDetailState.error}
                              </span>
                              {importedDetailState.error && (
                                <button
                                  onClick={() =>
                                    setImportedReload((value) => value + 1)
                                  }
                                >
                                  重新读取
                                </button>
                              )}
                            </div>
                          ) : null}
                          {selectedSource.status === "failed" && (
                            <div className="ag-inline-error">
                              <AlertCircle size={17} />
                              <p>
                                该来源读取失败。它不能作为已验证事实的依据；请查看失败信息或更换来源。
                              </p>
                            </div>
                          )}
                          {quoteValidation !== "none" && (
                            <div
                              className={`ag-quote-location-note ${quoteValidation}`}
                            >
                              {quoteValidation === "loading" ? (
                                <Loader2 size={13} className="ag-spin" />
                              ) : quoteValidation === "valid" ? (
                                <CheckCircle2 size={13} />
                              ) : (
                                <AlertCircle size={13} />
                              )}
                              <span>
                                {quoteValidation === "loading"
                                  ? "正在核对摘录位置与证据摘要…"
                                  : quoteValidation === "valid"
                                    ? "已定位所引用的原文。高亮表示文字位置，不代表断言已被验证。"
                                    : "摘录位置与当前保存的证据不一致，未应用高亮。请重新核对引用。"}
                              </span>
                              <button
                                type="button"
                                onClick={() => setQuoteLocation(null)}
                              >
                                清除定位
                                <X size={12} />
                              </button>
                            </div>
                          )}
                          <div className="ag-original-text">
                            {quoteValidation === "valid" &&
                            quoteLocation &&
                            selectedSource.text ? (
                              <>
                                {selectedSource.text.slice(
                                  0,
                                  quoteLocation.start,
                                )}
                                <mark
                                  ref={quoteMark}
                                  className="ag-evidence-quote"
                                >
                                  {selectedSource.text.slice(
                                    quoteLocation.start,
                                    quoteLocation.end,
                                  )}
                                </mark>
                                {selectedSource.text.slice(quoteLocation.end)}
                              </>
                            ) : (
                              selectedSource.text ||
                              (detailState.loading
                                ? "原文正在载入…"
                                : detailState.error
                                  ? "完整证据尚未读取，请重试。"
                                  : "此来源没有可供查看的原文。")
                            )}
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
                    <Suspense
                      fallback={
                        <div className="ag-detail-notice">
                          <Loader2 size={15} className="ag-spin" />
                          正在加载需求工作区…
                        </div>
                      }
                    >
                      <RequirementsWorkspace
                        key={project?.id || projectId}
                        projectId={project?.id || projectId}
                        runs={runs.filter(
                          (run) =>
                            run.kind !== "prototype" &&
                            run.status === "completed" &&
                            !!run.result?.requirements?.length,
                        )}
                        runId={runId}
                        focusIndex={requirementIndex}
                        available={!!boot.runtime.foundryAvailable}
                        submitting={submitting}
                        request={api}
                        onChooseRun={(id) => navigate("requirements", id)}
                        onSource={(id, sourceId) => {
                          const from = runs.find((run) => run.id === id);
                          if (from) viewSource(sourceId, from);
                        }}
                        onResearch={(id) => navigate("research", id)}
                        onGenerate={generatePrototype}
                      />
                    </Suspense>
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
                        if (r) navigate("requirements", r.id);
                      }}
                    >
                      <Plus size={14} />
                      选择需求并制作
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
                      (r) =>
                        r.kind === "prototype" &&
                        !r.cancellationPending &&
                        ["failed", "cancelled"].includes(r.status),
                    )
                    .slice(0, 1)
                    .map((r) => (
                      <div className="ag-inline-error" key={r.id}>
                        <AlertCircle size={18} />
                        <div>
                          <b>
                            {r.status === "cancelled"
                              ? "原型制作已取消"
                              : "原型制作未完成"}
                          </b>
                          <p>
                            {r.status === "cancelled"
                              ? "执行已结束，已保存的调用量与过程记录会保留。"
                              : r.error || "查看完整记录以了解原因"}
                          </p>
                          {cancellationNotice(r)}
                          {runFooter(r)}
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
                          { id: "brief", icon: GitBranch, title: "冻结简报" },
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
                      {detailNotice()}
                      {!!selectedPrototype.prototype.code &&
                        selectedPrototype.prototype.versionSelection !==
                          "job-version-id" && (
                          <div className="ag-prototype-version-note">
                            <AlertCircle size={14} />
                            <p>
                              {selectedPrototype.prototype.versionSelection ===
                              "legacy-latest-unverified"
                                ? "旧造物记录未提供任务绑定的版本 ID，当前展示为当时查询的最新版本，归属尚未验证。"
                                : "旧版未保存精确的任务与原型版本绑定，版本归属尚未单独验证。"}
                            </p>
                          </div>
                        )}
                      {!selectedPrototype.prototype.code ? (
                        <div className="ag-prototype-loading">
                          <Box size={25} />
                          <p>
                            {detailState.error
                              ? "原型内容读取失败，请重试。"
                              : "正在读取这个版本的完整原型…"}
                          </p>
                        </div>
                      ) : prototypeTab === "brief" ? (
                        <div className="ag-prototype-brief-view">
                          {selectedPrototype.raw?.prototypeBrief ? (
                            <Suspense
                              fallback={
                                <div className="ag-detail-notice">
                                  正在加载冻结简报…
                                </div>
                              }
                            >
                              <PrototypeBriefDetails
                                brief={selectedPrototype.raw.prototypeBrief}
                                frozen
                              />
                            </Suspense>
                          ) : (
                            <div className="ag-legacy-brief">
                              <FileText size={23} />
                              <h3>旧版本未保存范围简报</h3>
                              <p>
                                这个原型保留了源码和制作记录；无法据此补写当时的需求选择、背景快照和审阅状态。
                              </p>
                            </div>
                          )}
                        </div>
                      ) : prototypeTab === "preview" ? (
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
                    "记录进展与跟进日期，让待办回到下一次研究。",
                  )}
                  <Suspense
                    fallback={
                      <div className="ag-detail-notice">
                        <Loader2 size={15} className="ag-spin" />
                        正在加载跟进工作区…
                      </div>
                    }
                  >
                    <TaskWorkspace
                      key={project?.id || projectId}
                      projectId={project?.id || projectId}
                      runs={runs}
                      filter={taskFilter}
                      onFilter={setTaskFilter}
                      request={api}
                      onUpdated={(value) => mergeRun(value as Run)}
                      sources={(id, ids) => {
                        const from = runs.find((run) => run.id === id);
                        return from ? sourceChips(ids, from) : null;
                      }}
                      onResearch={(id) => navigate("research", id)}
                      onRequirement={(id, index) => {
                        const from = runs.find((run) => run.id === id);
                        if (from) viewRequirement(from, index);
                      }}
                      onFollowUp={(id, action) => {
                        const from = runs.find((run) => run.id === id);
                        if (from)
                          followUp({
                            ...action,
                            id: action.id || action.modelId || "",
                            run: from,
                          });
                      }}
                      onNewResearch={() => navigate("research")}
                    />
                  </Suspense>
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
                      <div className="ag-note ag-evaluation-version">
                        <History size={15} />
                        <span>
                          {evaluation.id === "paired-2026-10-02"
                            ? "第一版历史实测 · 2026-10-02。以下成绩属于第一版；本轮改动尚未进行新的配对评测。"
                            : "按报告所记录的版本与样本解读结果，不能直接代表当前版本的效果。"}
                        </span>
                      </div>
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
                              evaluation.caseCount ??
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
                          <span>
                            {evaluation.cases?.length ??
                              evaluation.caseCount ??
                              evaluation.sampleSize ??
                              "—"}{" "}
                            个案例
                          </span>
                        </div>
                        {detailNotice(
                          evaluationState.id === evaluation.id
                            ? evaluationState
                            : { id: "", loading: false, error: "" },
                        )}
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
          request={api}
          onMemoryChanged={refresh}
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
            if (projectModal === "new") {
              setRunId("");
              setSourceKey("");
              setQuoteLocation(null);
              setSessionId(crypto.randomUUID());
            }
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

function MemoryManager({
  project,
  request,
  onChanged,
}: {
  project: Project;
  request: (path: string, options?: RequestInit) => Promise<unknown>;
  onChanged: () => Promise<void>;
}) {
  type MemoryData = {
    memory: Memory[];
    history: MemoryRevision[];
    revision: number;
  };
  type Draft = {
    operation: "add" | "correct" | "deactivate" | "restore";
    memoryId?: string;
    revisionId?: string;
    text: string;
    original?: string;
    reason: string;
    expectedRevision: number;
    confirmed: boolean;
    conflict?: boolean;
  };
  const [data, setData] = useState<MemoryData>({
    memory: project.memory,
    history: project.memoryHistory || [],
    revision: project.memoryRevision ?? 0,
  });
  const [view, setView] = useState("current"),
    [draft, setDraft] = useState<Draft | null>(null),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const base = `/agent/projects/${project.id}/memory`;
  async function load(signal?: AbortSignal) {
    const latest = (await request(base, { signal })) as MemoryData;
    if (!signal?.aborted) setData(latest);
    return latest;
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal)
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [project.id]);
  const operationLabels = {
    confirmed: "用户确认",
    corrected: "用户更正",
    deactivated: "停用",
    restored: "恢复版本",
    imported: "原有记忆导入",
  };
  const inactiveIds = [...new Set(data.history.map((h) => h.memoryId))].filter(
    (id) => !data.memory.some((m) => m.id === id),
  );
  const history = [...data.history].sort((a, b) => b.at.localeCompare(a.at));
  const shownHistory =
    view === "inactive"
      ? history.filter((h) => inactiveIds.includes(h.memoryId))
      : history;
  function start(
    next: Omit<Draft, "reason" | "expectedRevision" | "confirmed">,
  ) {
    setDraft({
      ...next,
      reason: "",
      expectedRevision: data.revision,
      confirmed: false,
    });
    setError("");
    setNotice("");
  }
  async function save() {
    if (!draft || !draft.confirmed || draft.conflict) return;
    setSaving(true);
    setError("");
    const body = {
      text: draft.text.trim(),
      source: "用户确认",
      reason: draft.reason.trim(),
      expectedRevision: draft.expectedRevision,
      confirm: true,
    };
    try {
      if (draft.operation === "add")
        await request(base, { method: "POST", body: JSON.stringify(body) });
      else if (draft.operation === "restore")
        await request(`${base}/${draft.memoryId}/restore`, {
          method: "POST",
          body: JSON.stringify({
            revisionId: draft.revisionId,
            reason: body.reason,
            confirm: true,
            expectedRevision: body.expectedRevision,
          }),
        });
      else
        await request(`${base}/${draft.memoryId}`, {
          method: "PATCH",
          body: JSON.stringify(
            draft.operation === "deactivate"
              ? {
                  active: false,
                  reason: body.reason,
                  confirm: true,
                  expectedRevision: body.expectedRevision,
                }
              : body,
          ),
        });
      await load();
      await onChanged();
      setDraft(null);
      setNotice("已保存。后续研究只会读取当前启用的版本。");
    } catch (e) {
      const failure = e as Error & { status?: number };
      if (failure.status === 409) {
        const latest = await load().catch(() => undefined);
        const changed = !!latest && latest.revision !== draft.expectedRevision;
        setDraft((current) =>
          current
            ? { ...current, confirmed: false, conflict: changed }
            : current,
        );
        setError(
          changed
            ? "项目记忆已在其他位置更新。你的草稿已保留，请重新核对当前版本再确认，系统没有覆盖它。"
            : `${failure.message} 草稿已保留，请稍后重新确认。`,
        );
      } else setError(failure.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="ag-memory-manager">
      <div className="ag-note">
        <Brain size={15} />
        <span>
          只有当前启用的记忆参与研究。更正与停用保留历史；恢复旧版本需要再次确认。
        </span>
      </div>
      <div className="ag-memory-toolbar">
        <div className="ag-filter-tabs">
          {[
            { id: "current", text: `当前 ${data.memory.length}` },
            { id: "history", text: `版本历史 ${data.history.length}` },
            { id: "inactive", text: `已停用 ${inactiveIds.length}` },
          ].map((item) => (
            <button
              type="button"
              key={item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => setView(item.id)}
            >
              {item.text}
            </button>
          ))}
        </div>
        <button
          className="ag-button light small"
          type="button"
          disabled={loading || saving || !!draft || data.memory.length >= 30}
          onClick={() => start({ operation: "add", text: "" })}
        >
          <Plus size={13} />
          添加记忆
        </button>
      </div>
      {loading && (
        <div className="ag-detail-notice">
          <Loader2 size={14} className="ag-spin" />
          正在读取记忆版本…
        </div>
      )}
      {notice && (
        <p className="ag-memory-notice" role="status">
          <CheckCircle2 size={14} />
          {notice}
        </p>
      )}
      {draft && (
        <section className="ag-memory-review" aria-label="确认记忆变更">
          <div className="ag-memory-review-title">
            <ShieldCheck size={16} />
            <h3>
              {draft.operation === "restore"
                ? "恢复前，请核对这个版本"
                : draft.operation === "deactivate"
                  ? "确认停用这条记忆"
                  : draft.operation === "correct"
                    ? "核对记忆更正"
                    : "确认新项目记忆"}
            </h3>
          </div>
          {draft.original && (
            <div className="ag-memory-before">
              <small>变更前 / 当前启用值</small>
              <p>{draft.original}</p>
            </div>
          )}
          {draft.operation === "add" || draft.operation === "correct" ? (
            <label>
              确认后的内容
              <textarea
                rows={3}
                maxLength={2000}
                value={draft.text}
                disabled={saving}
                onChange={(e) =>
                  setDraft({ ...draft, text: e.target.value, confirmed: false })
                }
              />
            </label>
          ) : (
            <div className="ag-memory-before">
              <small>
                {draft.operation === "restore"
                  ? "将恢复为当前值"
                  : "停用后不再参与新研究"}
              </small>
              <p>{draft.text}</p>
            </div>
          )}
          <label>
            变更说明（选填）
            <input
              maxLength={500}
              value={draft.reason}
              disabled={saving}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
              placeholder="例如：核实后人数已变更 / 旧方向暂不适用"
            />
          </label>
          <label className="ag-confirm-checkbox">
            <input
              type="checkbox"
              checked={draft.confirmed}
              disabled={saving || draft.conflict}
              onChange={(e) =>
                setDraft({ ...draft, confirmed: e.target.checked })
              }
            />
            <span>
              {draft.operation === "restore"
                ? "我已核对，确认这个历史版本仍适用，并将它设为当前记忆。"
                : draft.operation === "deactivate"
                  ? "我确认停用，后续研究不再使用这条记忆。"
                  : "我已核对内容，确认它可以作为项目记忆使用。"}
            </span>
          </label>
          {draft.conflict && (
            <button
              type="button"
              className="ag-button light small"
              disabled={saving}
              onClick={() =>
                setDraft({
                  ...draft,
                  expectedRevision: data.revision,
                  original: data.memory.find((m) => m.id === draft.memoryId)
                    ?.text,
                  confirmed: false,
                  conflict: false,
                })
              }
            >
              采用最新版本重新核对
              <RefreshCw size={13} />
            </button>
          )}
          <div className="ag-memory-review-actions">
            <small>当前记忆修订 {data.revision} · 不调用模型</small>
            <button
              type="button"
              className="ag-button light small"
              disabled={saving}
              onClick={() => {
                setDraft(null);
                setError("");
              }}
            >
              取消
            </button>
            <button
              type="button"
              className="ag-button primary small"
              disabled={
                saving ||
                !draft.confirmed ||
                draft.conflict ||
                !draft.text.trim()
              }
              onClick={() => void save()}
            >
              {saving ? (
                <Loader2 size={13} className="ag-spin" />
              ) : (
                <Check size={13} />
              )}
              {draft.operation === "restore"
                ? "确认恢复为当前记忆"
                : draft.operation === "deactivate"
                  ? "确认停用"
                  : "确认并保存"}
            </button>
          </div>
        </section>
      )}
      {error && (
        <div className="ag-error" role="alert">
          <AlertCircle size={15} />
          <span>{error}</span>
          {!draft && (
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void load()
                  .then(() => setError(""))
                  .catch((e) => setError((e as Error).message))
                  .finally(() => setLoading(false));
              }}
            >
              重试
            </button>
          )}
        </div>
      )}
      {view === "current" ? (
        <div className="ag-current-memories">
          {data.memory.length ? (
            data.memory.map((m) => (
              <article key={m.id}>
                <div>
                  <span className="ag-memory-active">
                    <CheckCircle2 size={12} />
                    当前启用
                  </span>
                  <small>
                    {date(m.updatedAt)} · {m.source || "用户记忆"}
                  </small>
                </div>
                <p>{m.text}</p>
                <div className="ag-memory-row-actions">
                  <small title={m.revisionId}>
                    版本 {m.revisionId?.slice(0, 8) || "待归档"}
                  </small>
                  <button
                    type="button"
                    disabled={!!draft || saving || loading}
                    onClick={() =>
                      start({
                        operation: "correct",
                        memoryId: m.id,
                        text: m.text,
                        original: m.text,
                      })
                    }
                  >
                    <Pencil size={12} />
                    更正
                  </button>
                  <button
                    type="button"
                    disabled={!!draft || saving || loading}
                    onClick={() =>
                      start({
                        operation: "deactivate",
                        memoryId: m.id,
                        text: m.text,
                      })
                    }
                  >
                    停用
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className="ag-muted">
              目前没有启用的项目记忆。已停用内容仍可从历史查看。
            </p>
          )}
        </div>
      ) : (
        <div className="ag-memory-history">
          {shownHistory.length ? (
            shownHistory.map((h) => {
              const current = data.memory.find((m) => m.id === h.memoryId);
              const isCurrent = current?.revisionId === h.revisionId;
              return (
                <article key={h.revisionId}>
                  <div>
                    <span className={`ag-history-operation ${h.operation}`}>
                      {operationLabels[h.operation]}
                    </span>
                    {isCurrent && (
                      <span className="ag-memory-active">当前版本</span>
                    )}
                    <time>{date(h.at)}</time>
                  </div>
                  <p>{h.text}</p>
                  {h.reason && (
                    <p className="ag-history-reason">说明：{h.reason}</p>
                  )}
                  <div className="ag-memory-row-actions">
                    <small title={h.revisionId}>
                      {h.source || "用户记忆"} · {h.revisionId.slice(0, 8)}
                    </small>
                    {!isCurrent && h.operation !== "deactivated" && (
                      <button
                        type="button"
                        disabled={!!draft || saving || loading}
                        onClick={() =>
                          start({
                            operation: "restore",
                            memoryId: h.memoryId,
                            revisionId: h.revisionId,
                            text: h.text,
                            original: current?.text,
                          })
                        }
                      >
                        <History size={12} />
                        核对并恢复此版本
                      </button>
                    )}
                  </div>
                </article>
              );
            })
          ) : (
            <p className="ag-muted">
              这里还没有{view === "inactive" ? "已停用记忆" : "版本历史"}。
            </p>
          )}
        </div>
      )}
      {!!project.decisions.length && (
        <details className="ag-decision-list">
          <summary>研究提出的项目决策（供参考）</summary>
          {project.decisions.map((d, i) => (
            <p key={i}>
              {typeof d === "string" ? d : d.text || d.title || "未命名决策"}
            </p>
          ))}
        </details>
      )}
    </div>
  );
}

function ProjectModal({
  mode,
  project,
  onClose,
  onSave,
  request,
  onMemoryChanged,
}: {
  mode: "new" | "edit";
  project?: Project;
  onClose: () => void;
  onSave: (data: unknown) => Promise<void>;
  request: (path: string, options?: RequestInit) => Promise<unknown>;
  onMemoryChanged: () => Promise<void>;
}) {
  const [name, setName] = useState(mode === "edit" ? project?.name || "" : ""),
    [background, setBackground] = useState(
      mode === "edit" ? project?.background || "" : "",
    ),
    [goal, setGoal] = useState(mode === "edit" ? project?.goal || "" : ""),
    [constraints, setConstraints] = useState(
      mode === "edit" ? project?.constraints || "" : "",
    ),
    [tab, setTab] = useState("background"),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    if (tab === "memory") return;
    setSaving(true);
    setError("");
    try {
      await onSave({
        name: name.trim(),
        background,
        goal,
        constraints,
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
              记忆与历史<span>{project?.memory.length || 0}</span>
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
              project && (
                <MemoryManager
                  key={project.id}
                  project={project}
                  request={request}
                  onChanged={onMemoryChanged}
                />
              )
            )}
            {error && (
              <div className="ag-error">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
          </div>
          <div className="ag-modal-footer">
            <span>
              {tab === "memory"
                ? "记忆操作分别确认并即时保存"
                : "保存不会自动调用模型"}
            </span>
            <button
              className="ag-button light"
              type="button"
              disabled={saving}
              onClick={onClose}
            >
              取消
            </button>
            {tab === "memory" ? (
              <button
                type="button"
                className="ag-button primary"
                onClick={onClose}
              >
                完成
                <Check size={15} />
              </button>
            ) : (
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
            )}
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
