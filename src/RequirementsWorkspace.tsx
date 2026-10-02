import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Box,
  CheckCircle2,
  FileText,
  GitBranch,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

type Warning = { code: string; message: string };
type Basis = {
  claimIndices: number[];
  projectFields: string[];
  memoryIds: string[];
  assumptions: string[];
  verification: string[];
};
type SourcePin = {
  id: string;
  title: string;
  url: string;
  sha256: string;
  textSha256?: string | null;
  fetchedAt: string;
  publishedAt?: string | null;
  truncated?: boolean;
  extraction?: {
    providedChars?: number;
    extractedChars?: number;
    coverage?: string;
    note?: string;
  } | null;
  reusedFrom?: unknown;
  reusedAt?: string | null;
};
type ReviewSnapshot = {
  revision: number;
  status: string;
  state: string;
  reviewerLabel?: string | null;
  reviewerType?: string | null;
};
export type RequirementNode = {
  key: string;
  index: number;
  modelId: string;
  title: string;
  description: string;
  sourceIds: string[];
  acceptance: string | string[];
  basis?: Basis | null;
  basisState: "legacy" | "explicit" | "invalid";
  bindings: {
    claims: {
      key: string;
      index: number;
      text: string;
      kind: string;
      claimFingerprint: string;
      reviewSnapshot: ReviewSnapshot;
      quoteChecks: { sourceId: string; matched: boolean; quote: string }[];
    }[];
    projectFields: { field: string; text: string; textSha256: string }[];
    memory: {
      id: string;
      text: string;
      source?: string;
      revisionId?: string | null;
      updatedAt?: string;
    }[];
    sources: SourcePin[];
  };
  warnings: Warning[];
};
export type ProjectSnapshot = {
  id: string;
  name: string;
  background: string;
  goal: string;
  constraints: string;
  memoryRevision: number;
  memory: {
    id: string;
    text: string;
    source?: string;
    revisionId?: string;
    updatedAt?: string;
  }[];
};
export type PrototypeBrief = {
  researchRunId: string;
  projectId: string;
  selectedIndices: number[];
  requirements: RequirementNode[];
  warnings: Warning[];
  contextDiff: { changedProjectFields: string[]; changedMemoryIds: string[] };
  currentProjectSnapshot: ProjectSnapshot;
  researchProjectSnapshot: ProjectSnapshot;
  modelInputChars: number;
  maxChars: number;
  unit: string;
  briefFingerprint: string;
  prototypeMode?: "new" | "revise";
  revisionTarget?: {
    runId: string;
    versionId: string;
    title?: string;
    htmlSha256: string;
    htmlChars: number;
  } | null;
  inputCoverage?: {
    background: {
      providedChars: number;
      fullChars: number;
      truncatedForPrompt: boolean;
    };
    sources: {
      id: string;
      providedChars: number;
      fullChars: number;
      truncatedForPrompt: boolean;
    }[];
    memory: { providedIds: string[]; omittedCount: number };
  };
};
type RequirementGraph = {
  runId: string;
  projectId: string;
  requirements: RequirementNode[];
  actions: {
    index: number;
    id: string;
    title: string;
    requirementIndices: number[];
    requirementKeys: string[];
    warnings: Warning[];
  }[];
  warnings: Warning[];
};
type ResearchRun = {
  id: string;
  projectId: string;
  prompt: string;
  createdAt: string;
};
export type PrototypeRequest = {
  prompt: string;
  requirementIndices: number[];
  expectedBriefFingerprint: string;
  prototypeMode: "new";
};
type RequestError = Error & {
  status?: number;
  code?: string;
  actualChars?: number;
  maxChars?: number;
};
const fieldLabels: Record<string, string> = {
  name: "项目名称",
  background: "项目背景",
  goal: "项目目标",
  constraints: "项目约束",
};
const reviewLabels: Record<string, string> = {
  unreviewed: "未审阅",
  supported: "标注支持",
  contradicted: "标注矛盾",
  "needs-verification": "待核实",
};
const defaultPrompt =
  "围绕所选需求制作可交互的前端原型，体现验收条件；未验证的假设保留为待验证事项。";
function date(value?: string | null) {
  if (!value) return "未记录";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? "日期未知"
    : parsed.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}
function Markdown({ text }: { text: string }) {
  return (
    <div className="ag-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
function Warnings({ warnings }: { warnings?: Warning[] }) {
  if (!warnings?.length) return null;
  return (
    <div className="ag-requirement-warnings">
      <AlertCircle size={14} />
      <div>
        {warnings.slice(0, 4).map((warning, i) => (
          <p key={`${warning.code}-${i}`}>{warning.message}</p>
        ))}
        {warnings.length > 4 && (
          <details>
            <summary>另有 {warnings.length - 4} 项风险</summary>
            {warnings.slice(4).map((warning, i) => (
              <p key={`${warning.code}-${i}`}>{warning.message}</p>
            ))}
          </details>
        )}
      </div>
    </div>
  );
}
function ContextSnapshot({
  snapshot,
  title,
}: {
  snapshot: ProjectSnapshot;
  title: string;
}) {
  return (
    <details className="ag-brief-context">
      <summary>
        {title} · {snapshot.name}
      </summary>
      <div>
        {["background", "goal", "constraints"].map((field) => (
          <section key={field}>
            <b>{fieldLabels[field]}</b>
            <p>
              {snapshot[field as "background" | "goal" | "constraints"] ||
                "未提供"}
            </p>
          </section>
        ))}
        <section>
          <b>已确认记忆 · 版本 {snapshot.memoryRevision ?? "未记录"}</b>
          {snapshot.memory?.length ? (
            snapshot.memory.map((item) => (
              <p key={item.id}>
                {item.text}
                <small>
                  {item.source || "用户确认"} · {date(item.updatedAt)}
                  {item.revisionId && ` · ${item.revisionId.slice(0, 8)}`}
                </small>
              </p>
            ))
          ) : (
            <p>此快照没有已确认记忆。</p>
          )}
        </section>
      </div>
    </details>
  );
}
export function PrototypeBriefDetails({
  brief,
  frozen = false,
}: {
  brief: PrototypeBrief;
  frozen?: boolean;
}) {
  const fields = brief.contextDiff?.changedProjectFields || [];
  const memory = brief.contextDiff?.changedMemoryIds || [];
  const auditClaims = Array.from(
    new Map(
      brief.requirements
        .flatMap((requirement) => requirement.bindings.claims)
        .map((claim) => [claim.key, claim]),
    ).values(),
  );
  return (
    <div className={`ag-scope-brief ${frozen ? "frozen" : ""}`}>
      <div className="ag-brief-title">
        <FileText size={17} />
        <div>
          <h3>{frozen ? "生成时冻结的范围简报" : "本次制作范围简报"}</h3>
          <p>
            {frozen
              ? "这里保留提交当时的需求、项目背景和审阅状态，后续修改不会覆盖此版本。"
              : "所选需求来自同一次研究；简报会随本次制作保存。预览不会调用模型。"}
          </p>
        </div>
      </div>
      <div className="ag-brief-scope">
        {brief.requirements.map((requirement) => (
          <div key={requirement.key}>
            <span>{String(requirement.index + 1).padStart(2, "0")}</span>
            <b>{requirement.title}</b>
            <small>
              {requirement.basisState === "legacy"
                ? "未建立论证链"
                : requirement.basisState === "invalid"
                  ? "论证引用异常"
                  : "已记录论证引用"}
            </small>
          </div>
        ))}
      </div>
      <p className="ag-brief-review-note">
        <Box size={13} />
        {brief.prototypeMode === "new"
          ? "制作模式：新探索原型，不继承已有原型界面。"
          : brief.prototypeMode === "revise"
            ? "制作模式：迭代已有原型，已有界面可能保留。"
            : "此记录未保存制作模式，无法确认是否继承了已有原型。"}
      </p>
      <Warnings warnings={brief.warnings} />
      <p className="ag-brief-review-note">
        <ShieldCheck size={13} />
        “标注支持”记录审阅者的判断，不保证事实正确；摘录字面匹配也不等于需求价值已被验证。
      </p>
      <p className="ag-brief-review-note">
        <BookOpen size={13} />
        简报使用明确标记的背景与来源摘录，并包含当前已确认记忆；历史论证另存研究时快照。下方完整项目快照用于核对和归档，不代表模型已通读全部内容。
      </p>
      {brief.inputCoverage && (
        <details className="ag-brief-coverage">
          <summary>查看简报提供的摘录与记忆范围</summary>
          <p>
            项目背景{" "}
            {brief.inputCoverage.background.providedChars.toLocaleString()} /{" "}
            {brief.inputCoverage.background.fullChars.toLocaleString()} 字符位
            {brief.inputCoverage.background.truncatedForPrompt
              ? " · 已取摘录"
              : ""}
            ；当前记忆 {brief.inputCoverage.memory.providedIds.length} 条
            {brief.inputCoverage.memory.omittedCount
              ? ` · 另有 ${brief.inputCoverage.memory.omittedCount} 条未提供`
              : ""}
            。
          </p>
          {brief.inputCoverage.sources.map((source) => (
            <p key={source.id}>
              {brief.requirements
                .flatMap((requirement) => requirement.bindings.sources)
                .find((pin) => pin.id === source.id)?.title || source.id}
              ：正文开头摘录 {source.providedChars.toLocaleString()} /{" "}
              {source.fullChars.toLocaleString()} 字符位
              {source.truncatedForPrompt ? " · 已取摘录" : ""}。
            </p>
          ))}
          <p>
            需求绑定的模型摘录与审阅引文另随简报传入，上述长度不代表所有引文的覆盖总量。
          </p>
        </details>
      )}
      <details className="ag-brief-audits">
        <summary>
          简报中的审阅标注快照 · {auditClaims.length} 条显式关联结论
        </summary>
        {auditClaims.length ? (
          auditClaims.map((claim) => (
            <article key={claim.key}>
              <div>
                <span>
                  {claim.kind === "fact"
                    ? "事实陈述"
                    : claim.kind === "inference"
                      ? "推断"
                      : "未知"}
                </span>
                <strong
                  className={`ag-basis-review ${claim.reviewSnapshot.state === "invalidated" ? "unreviewed" : claim.reviewSnapshot.status}`}
                >
                  {claim.reviewSnapshot.state === "invalidated"
                    ? "审阅已失效"
                    : reviewLabels[claim.reviewSnapshot.status] || "未审阅"}
                </strong>
                <small>版本 {claim.reviewSnapshot.revision}</small>
              </div>
              <p>{claim.text}</p>
              <small>
                {claim.reviewSnapshot.reviewerLabel || "尚无审阅标注"}
                {claim.reviewSnapshot.reviewerType === "agent-assisted"
                  ? " · Agent 协助"
                  : claim.reviewSnapshot.reviewerType ===
                      "implementation-fixture"
                    ? " · 实现测试"
                    : claim.reviewSnapshot.reviewerType === "user"
                      ? " · 工作空间用户"
                      : ""}
              </small>
            </article>
          ))
        ) : (
          <p>所选需求未显式关联主张审阅标注，不能从共同来源推定论证成立。</p>
        )}
      </details>
      {(fields.length > 0 || memory.length > 0) && (
        <div className="ag-context-diff">
          <b>项目背景在研究后发生过变化</b>
          <p>
            变化字段：
            {fields.map((field) => fieldLabels[field] || field).join("、") ||
              "无"}
            ；变化记忆：{memory.length}{" "}
            条。需求论证引用研究时的快照，制作使用下方的项目快照。
          </p>
        </div>
      )}
      {brief.currentProjectSnapshot && (
        <ContextSnapshot
          snapshot={brief.currentProjectSnapshot}
          title={frozen ? "生成时项目快照" : "本次制作使用的当前项目快照"}
        />
      )}
      {brief.researchProjectSnapshot && (
        <ContextSnapshot
          snapshot={brief.researchProjectSnapshot}
          title="原研究项目快照"
        />
      )}
      <div className="ag-brief-budget">
        <span>
          提交给造物的简报长度 <b>{brief.modelInputChars.toLocaleString()}</b> /{" "}
          {brief.maxChars.toLocaleString()} 字符位（UTF-16）
        </span>
        <span>造物另加基础指令；最终用量和费用情况见制作记录。</span>
      </div>
      <details className="ag-brief-fingerprint">
        <summary>简报校验与研究记录</summary>
        <code>{brief.briefFingerprint}</code>
        <p>
          研究记录 {brief.researchRunId} · 需求序号{" "}
          {brief.selectedIndices.map((index) => index + 1).join("、")}
        </p>
        {brief.revisionTarget && (
          <p>
            继承原型：{brief.revisionTarget.title || brief.revisionTarget.runId}{" "}
            · 版本 {brief.revisionTarget.versionId} · 原界面 SHA-256{" "}
            {brief.revisionTarget.htmlSha256} ·{" "}
            {brief.revisionTarget.htmlChars.toLocaleString()} 字符位。
          </p>
        )}
      </details>
    </div>
  );
}
function BasisDetails({
  requirement,
  onSource,
  onResearch,
}: {
  requirement: RequirementNode;
  onSource: (id: string) => void;
  onResearch: () => void;
}) {
  const bindings = requirement.bindings;
  return (
    <details className="ag-requirement-basis">
      <summary>
        <GitBranch size={14} />
        论证依据
        <span>
          {requirement.basisState === "legacy"
            ? "未建立论证链"
            : requirement.basisState === "invalid"
              ? "存在无效引用"
              : "已记录引用与假设"}
        </span>
      </summary>
      <div>
        {requirement.basisState === "legacy" && (
          <p className="ag-basis-empty">
            此旧记录没有结构化论证。来源引用不能自动说明这项需求值得做。
          </p>
        )}
        <Warnings warnings={requirement.warnings} />
        {!!bindings.claims.length && (
          <section>
            <h4>关联结论 · 当前审阅快照</h4>
            {bindings.claims.map((claim) => (
              <article className="ag-basis-claim" key={claim.key}>
                <div>
                  <span>
                    {claim.kind === "fact"
                      ? "事实陈述"
                      : claim.kind === "inference"
                        ? "推断"
                        : "未知"}
                  </span>
                  <strong
                    className={`ag-basis-review ${claim.reviewSnapshot.state === "invalidated" ? "unreviewed" : claim.reviewSnapshot.status}`}
                  >
                    {claim.reviewSnapshot.state === "invalidated"
                      ? "审阅已失效"
                      : reviewLabels[claim.reviewSnapshot.status] || "未审阅"}
                  </strong>
                </div>
                <p>{claim.text}</p>
                <small>
                  {claim.reviewSnapshot.reviewerLabel || "尚无审阅标注"}
                  {claim.reviewSnapshot.reviewerType === "agent-assisted"
                    ? " · Agent 协助"
                    : claim.reviewSnapshot.reviewerType ===
                        "implementation-fixture"
                      ? " · 实现测试"
                      : claim.reviewSnapshot.reviewerType === "user"
                        ? " · 工作空间用户"
                        : ""}{" "}
                  · 审阅版本 {claim.reviewSnapshot.revision}
                </small>
                <p className="ag-basis-literal">
                  模型摘录：
                  {claim.quoteChecks?.length
                    ? `${claim.quoteChecks.filter((check) => check.matched).length}/${claim.quoteChecks.length} 字面匹配；仍需判断语义`
                    : "未提供摘录"}
                </p>
                <button className="ag-text-button" onClick={onResearch}>
                  查看结论与审阅 <ArrowUpRight size={12} />
                </button>
              </article>
            ))}
            <p className="ag-basis-footnote">
              审阅是带署名的判断，不是独立事实保证；需求引用也不等于论证成立。
            </p>
          </section>
        )}
        {!!bindings.projectFields.length && (
          <section>
            <h4>研究时项目背景</h4>
            {bindings.projectFields.map((field) => (
              <div className="ag-basis-context" key={field.field}>
                <b>{fieldLabels[field.field] || field.field}</b>
                <p>{field.text || "未提供"}</p>
              </div>
            ))}
          </section>
        )}
        {!!bindings.memory.length && (
          <section>
            <h4>研究时已确认记忆</h4>
            {bindings.memory.map((item) => (
              <div className="ag-basis-context" key={item.id}>
                <p>{item.text}</p>
                <small>
                  {item.source || "用户确认"} · {date(item.updatedAt)} · 版本{" "}
                  {item.revisionId?.slice(0, 8) || "旧记录未保存"}
                </small>
              </div>
            ))}
          </section>
        )}
        {!!bindings.sources.length && (
          <section>
            <h4>保存的证据快照</h4>
            {bindings.sources.map((source) => (
              <div className="ag-basis-source" key={source.id}>
                <button onClick={() => onSource(source.id)}>
                  <BookOpen size={13} />
                  {source.title || source.url}
                  <ArrowUpRight size={12} />
                </button>
                <small>
                  抓取 {date(source.fetchedAt)} ·{" "}
                  {source.reusedFrom
                    ? "复用历史快照，未重新验证网络现状"
                    : "保存的抓取快照"}
                  {source.truncated
                    ? source.extraction
                      ? " · 提供的正文因长度上限被裁剪"
                      : " · 旧版覆盖标记待核查"
                    : ""}{" "}
                  · 发布日期
                  {source.publishedAt ? ` ${date(source.publishedAt)}` : "未知"}
                </small>
                <code title={source.sha256}>
                  原文 SHA-256 {source.sha256?.slice(0, 16) || "未记录"}…
                </code>
              </div>
            ))}
          </section>
        )}
        {!!requirement.basis?.assumptions?.length && (
          <section>
            <h4>尚未验证的价值假设</h4>
            <ul>
              {requirement.basis.assumptions.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>
        )}
        {!!requirement.basis?.verification?.length && (
          <section>
            <h4>如何验证论证</h4>
            <ul>
              {requirement.basis.verification.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>
        )}
        {requirement.basisState === "explicit" &&
          !bindings.claims.length &&
          !bindings.projectFields.length &&
          !bindings.memory.length &&
          !requirement.basis?.assumptions?.length && (
            <p className="ag-basis-empty">
              尚未提供可用的论证依据，需要补充价值假设和验证方式。
            </p>
          )}
      </div>
    </details>
  );
}

export default function RequirementsWorkspace({
  runs,
  runId,
  projectId,
  focusIndex,
  available,
  submitting,
  request,
  onChooseRun,
  onSource,
  onResearch,
  onGenerate,
}: {
  runs: ResearchRun[];
  runId: string;
  projectId: string;
  focusIndex: number | null;
  available: boolean;
  submitting: boolean;
  request: (path: string, options?: RequestInit) => Promise<unknown>;
  onChooseRun: (id: string) => void;
  onSource: (runId: string, sourceId: string) => void;
  onResearch: (runId: string) => void;
  onGenerate: (runId: string, body: PrototypeRequest) => Promise<void>;
}) {
  const run = runs.find((item) => item.id === runId) || runs[0];
  const [graphData, setGraph] = useState<RequirementGraph | null>(null);
  const graph =
    graphData?.runId === run?.id && graphData?.projectId === projectId
      ? graphData
      : null;
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<number[]>([]),
    [prompt, setPrompt] = useState(defaultPrompt);
  const [preview, setPreview] = useState<{
    scope: string;
    brief: PrototypeBrief;
  } | null>(null);
  const [preparing, setPreparing] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const scope = JSON.stringify([run?.id, selected, prompt]);
  const scopeRef = useRef(scope),
    sequence = useRef(0),
    previewController = useRef<AbortController | null>(null);
  const cards = useRef<Record<number, HTMLElement | null>>({}),
    briefElement = useRef<HTMLDivElement>(null);
  scopeRef.current = scope;
  useEffect(() => {
    setGraph(null);
    setLoading(true);
    setLoadError("");
    setSelected([]);
    setPreview(null);
    setConfirmed(false);
    setError("");
    previewController.current?.abort();
    sequence.current += 1;
    setPreparing(false);
    if (!run) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void request(`/agent/runs/${run.id}/requirements`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (controller.signal.aborted) return;
        const result = value as RequirementGraph;
        if (result.runId !== run.id || result.projectId !== projectId)
          throw new Error("需求记录与当前项目不一致，请重新读取。");
        setGraph(result);
        setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setLoadError((e as Error).message);
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      previewController.current?.abort();
      sequence.current += 1;
    };
  }, [run?.id, projectId, reload]);
  useEffect(() => {
    if (graph && focusIndex !== null)
      cards.current[focusIndex]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
  }, [graph, focusIndex]);
  function invalidate() {
    previewController.current?.abort();
    sequence.current += 1;
    setPreview(null);
    setConfirmed(false);
    setPreparing(false);
    setError("");
  }
  function select(next: number[]) {
    invalidate();
    scopeRef.current = JSON.stringify([run?.id, next, prompt]);
    setSelected(next);
  }
  function changePrompt(next: string) {
    invalidate();
    scopeRef.current = JSON.stringify([run?.id, selected, next]);
    setPrompt(next);
  }
  async function prepare(indices = selected) {
    if (!run || !indices.length || submitting) return;
    previewController.current?.abort();
    const controller = new AbortController();
    previewController.current = controller;
    const token = ++sequence.current,
      preparedScope = JSON.stringify([run.id, indices, prompt]);
    scopeRef.current = preparedScope;
    setSelected(indices);
    setPreview(null);
    setConfirmed(false);
    setPreparing(true);
    setError("");
    try {
      const brief = (await request(
        `/agent/runs/${run.id}/prototype/brief-preview`,
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            prompt,
            requirementIndices: indices,
            prototypeMode: "new",
          }),
        },
      )) as PrototypeBrief;
      if (
        controller.signal.aborted ||
        token !== sequence.current ||
        scopeRef.current !== preparedScope
      )
        return;
      if (
        brief.projectId !== projectId ||
        brief.researchRunId !== run.id ||
        JSON.stringify(brief.selectedIndices) !== JSON.stringify(indices) ||
        !brief.briefFingerprint ||
        brief.prototypeMode !== "new"
      )
        throw new Error("简报范围与所选需求不一致，请重新预览。");
      setPreview({ scope: preparedScope, brief });
      setTimeout(() => {
        if (token !== sequence.current || scopeRef.current !== preparedScope)
          return;
        briefElement.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 30);
    } catch (e) {
      if (!controller.signal.aborted && token === sequence.current) {
        const failure = e as RequestError;
        setError(
          failure.status === 413
            ? `范围超出输入上限：${failure.actualChars?.toLocaleString() || "当前输入"} / ${failure.maxChars?.toLocaleString() || "配置上限"} 字符位。减少所选需求或提示后重试；此次未调用模型。${failure.message}`
            : failure.message,
        );
      }
    } finally {
      if (token === sequence.current) setPreparing(false);
    }
  }
  async function create() {
    if (
      !run ||
      !preview ||
      preview.scope !== scopeRef.current ||
      !confirmed ||
      submitting
    )
      return;
    const submittedScope = preview.scope;
    setError("");
    try {
      await onGenerate(run.id, {
        prompt,
        requirementIndices: [...selected],
        expectedBriefFingerprint: preview.brief.briefFingerprint,
        prototypeMode: "new",
      });
    } catch (e) {
      if (submittedScope !== scopeRef.current) return;
      const failure = e as RequestError;
      if (
        failure.status === 409 &&
        failure.code === "PROTOTYPE_BRIEF_CHANGED"
      ) {
        setPreview(null);
        setConfirmed(false);
        setError(
          `背景、证据或审阅状态已变化。已保留需求选择与提示，请重新预览简报并确认。${failure.message}`,
        );
      } else
        setError(
          failure.status === 413
            ? `范围超过输入上限，本次未调用模型。${failure.message}`
            : failure.message,
        );
    }
  }
  const currentPreview = preview?.scope === scope ? preview.brief : null;
  return (
    <div className="ag-requirements-workspace">
      <div className="ag-requirement-run">
        <div>
          <label htmlFor="requirement-research-run">需求来源研究</label>
          <select
            id="requirement-research-run"
            value={run?.id || ""}
            disabled={submitting}
            onChange={(event) => onChooseRun(event.target.value)}
          >
            {runs.map((item) => (
              <option key={item.id} value={item.id}>
                {date(item.createdAt)} · {item.prompt.slice(0, 85)}
              </option>
            ))}
          </select>
        </div>
        <span>
          {graph?.requirements.length ?? "—"} 项需求 · 每次选择限于同一次研究
        </span>
      </div>
      {loading ? (
        <div className="ag-detail-notice">
          <Loader2 size={15} className="ag-spin" />
          正在读取需求论证与审阅状态…
        </div>
      ) : loadError ? (
        <div className="ag-detail-notice error">
          <AlertCircle size={15} />
          {loadError}
          <button onClick={() => setReload((value) => value + 1)}>
            <RefreshCw size={13} />
            重试
          </button>
        </div>
      ) : (
        graph && (
          <>
            <Warnings warnings={graph.warnings} />
            {selected.length > 0 && (
              <div className="ag-scope-toolbar">
                <span>
                  本次选择 {selected.length} 项 ·{" "}
                  {selected.map((index) => index + 1).join("、")}
                </span>
                <button
                  className="ag-button light small"
                  disabled={preparing || submitting}
                  onClick={() =>
                    currentPreview
                      ? briefElement.current?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        })
                      : void prepare()
                  }
                >
                  {preparing ? (
                    <Loader2 size={13} className="ag-spin" />
                  ) : (
                    <FileText size={13} />
                  )}
                  {currentPreview ? "查看范围简报" : "预览所选范围"}
                </button>
              </div>
            )}
            <div className="ag-requirement-list">
              {graph.requirements.map((requirement) => (
                <article
                  ref={(element) => {
                    cards.current[requirement.index] = element;
                  }}
                  className={`ag-requirement-card ${focusIndex === requirement.index ? "highlight" : ""}`}
                  key={requirement.key}
                >
                  <div className="ag-requirement-top">
                    <label className="ag-scope-checkbox">
                      <input
                        type="checkbox"
                        checked={selected.includes(requirement.index)}
                        disabled={submitting}
                        onChange={(event) =>
                          select(
                            event.target.checked
                              ? [...selected, requirement.index].sort(
                                  (a, b) => a - b,
                                )
                              : selected.filter(
                                  (index) => index !== requirement.index,
                                ),
                          )
                        }
                        aria-label={`选择需求 ${requirement.title}`}
                      />
                      <span className="ag-number">
                        {String(requirement.index + 1).padStart(2, "0")}
                      </span>
                    </label>
                    <span className="ag-draft-label">需求草稿</span>
                    <span
                      className={`ag-basis-state ${requirement.basisState}`}
                    >
                      {requirement.basisState === "legacy"
                        ? "未建立论证链"
                        : requirement.basisState === "invalid"
                          ? "论证引用异常"
                          : "已记录论证"}
                    </span>
                    <button
                      className="ag-text-button"
                      onClick={() => onResearch(graph.runId)}
                    >
                      研究依据
                      <ArrowUpRight size={13} />
                    </button>
                  </div>
                  <h2>{requirement.title}</h2>
                  <Markdown text={requirement.description} />
                  <BasisDetails
                    requirement={requirement}
                    onSource={(id) => onSource(graph.runId, id)}
                    onResearch={() => onResearch(graph.runId)}
                  />
                  <div className="ag-acceptance">
                    <b>
                      <CheckCircle2 size={15} />
                      验收与验证
                    </b>
                    {Array.isArray(requirement.acceptance) ? (
                      <ul>
                        {requirement.acceptance.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <Markdown
                        text={
                          requirement.acceptance ||
                          "尚未提供验收条件，需要进一步明确。"
                        }
                      />
                    )}
                  </div>
                  <div className="ag-requirement-footer">
                    <span>仅制作这一项：需求 {requirement.index + 1}</span>
                    <button
                      className="ag-button light small"
                      disabled={submitting || preparing}
                      onClick={() => void prepare([requirement.index])}
                    >
                      <Box size={14} />
                      预览这一项的制作范围
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <div className="ag-prototype-scope-editor" ref={briefElement}>
              <div className="ag-scope-heading">
                <Box size={19} />
                <div>
                  <h3>把明确的需求交给造物</h3>
                  <p>新建探索原型，不继承已有界面。先检查范围简报，再制作。</p>
                </div>
                <span>
                  已选 {selected.length} / {graph.requirements.length} 项
                </span>
              </div>
              <div className="ag-scope-selected">
                {selected.length ? (
                  selected.map((index) => (
                    <span key={index}>
                      {index + 1}.{" "}
                      {
                        graph.requirements.find(
                          (requirement) => requirement.index === index,
                        )?.title
                      }
                    </span>
                  ))
                ) : (
                  <p>在需求卡片上勾选本次制作范围，或点击单项预览。</p>
                )}
              </div>
              <label className="ag-scope-prompt">
                制作补充说明
                <textarea
                  rows={3}
                  value={prompt}
                  onChange={(event) => changePrompt(event.target.value)}
                  maxLength={10000}
                  disabled={submitting}
                />
              </label>
              <div className="ag-scope-prepare">
                <small>改变所选需求或说明后，需要重新预览。</small>
                <button
                  className="ag-button light"
                  disabled={!selected.length || preparing || submitting}
                  onClick={() => void prepare()}
                >
                  {preparing ? (
                    <Loader2 size={14} className="ag-spin" />
                  ) : (
                    <FileText size={14} />
                  )}
                  {preparing ? "正在读取范围简报" : "预览所选范围"}
                </button>
              </div>
              {error && (
                <div className="ag-inline-error">
                  <AlertCircle size={16} />
                  <p>{error}</p>
                </div>
              )}
              {currentPreview && (
                <>
                  <PrototypeBriefDetails brief={currentPreview} />
                  <label className="ag-confirm-checkbox ag-brief-confirm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={submitting}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    <span>
                      我已检查这 {currentPreview.selectedIndices.length}{" "}
                      项需求、背景快照与风险，确认按此简报制作。
                    </span>
                  </label>
                  <div className="ag-scope-submit">
                    <small>
                      {available
                        ? "确认后会调用造物模型，实际用量保留在制作记录。"
                        : "造物服务目前不可用，简报可以继续查看。"}
                    </small>
                    <button
                      className="ag-button primary"
                      disabled={!confirmed || submitting || !available}
                      onClick={() => void create()}
                    >
                      {submitting ? (
                        <Loader2 size={14} className="ag-spin" />
                      ) : (
                        <Box size={14} />
                      )}
                      按这份简报制作
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )
      )}
    </div>
  );
}
