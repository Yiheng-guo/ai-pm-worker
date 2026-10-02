import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  History,
  Link2,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";

export type ClaimCitation = {
  sourceId: string;
  quote: string;
  matched: boolean;
  validation: "literal-only";
  locator?: {
    unit: "utf16-code-unit";
    start: number;
    end: number;
    occurrenceCount: number;
    occurrenceIndex: number;
  };
  sourcePin?: {
    url: string;
    retrievalUrl?: string;
    sha256: string;
    textSha256: string;
    fetchedAt: string;
    publishedAt: null;
    publishedDateKnown: false;
    truncated?: boolean;
    extraction?: {
      providedChars?: number;
      extractedChars?: number;
      coverage?: string;
    };
    reusedFrom?: { runId?: string; originalRunId?: string } | null;
    reusedAt?: string | null;
  };
  error?: string;
};
export type ReviewSource = {
  id: string;
  title: string;
  url: string;
  text?: string;
  sha256: string;
  fetchedAt: string;
  status: string;
};
type ReviewStatus =
  "unreviewed" | "supported" | "contradicted" | "needs-verification";
type ReviewerType = "user" | "agent-assisted";
type RecordedReviewerType = ReviewerType | "implementation-fixture";
type AuditEvent = {
  id: string;
  revision: number;
  status: ReviewStatus;
  note: string;
  reviewerLabel: string;
  reviewerType?: RecordedReviewerType;
  citations: ClaimCitation[];
  createdAt: string;
  judgmentScope: string;
  semanticValidation: string;
};
type AuditClaim = {
  key: string;
  index: number;
  text: string;
  kind: string;
  sourceIds: string[];
  claimFingerprint: string;
  quoteChecks: ClaimCitation[];
  review: {
    revision: number;
    status: ReviewStatus;
    state: "current" | "invalidated";
    previousStatus?: ReviewStatus;
    note?: string;
    reviewerLabel?: string;
    reviewerType?: RecordedReviewerType | null;
    citations: ClaimCitation[];
    history: AuditEvent[];
  };
};
type AuditData = {
  runId: string;
  projectId: string;
  reviewable: boolean;
  claims: AuditClaim[];
  summary: {
    total: number;
    unreviewed: number;
    supported: number;
    contradicted: number;
    needsVerification: number;
    invalidated: number;
  };
};
type CitationDraft = { sourceId: string; quote: string; start?: number };
type ReviewDraft = {
  key: string;
  expectedRevision: number;
  expectedClaimFingerprint: string;
  status: ReviewStatus;
  note: string;
  reviewerLabel: string;
  reviewerType: ReviewerType;
  citations: CitationDraft[];
  confirmed: boolean;
  conflict?: boolean;
};
const statusLabels: Record<ReviewStatus, string> = {
  unreviewed: "未审阅",
  supported: "来源支持",
  contradicted: "来源反驳",
  "needs-verification": "待进一步核实",
};
function reviewerKind(value?: RecordedReviewerType | null) {
  return value === "agent-assisted"
    ? "AI 辅助审阅"
    : value === "implementation-fixture"
      ? "实现验收示例"
      : value === "user"
        ? "用户审阅"
        : "审阅方式未记录";
}
function time(value?: string) {
  return value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Shanghai",
      })
    : "时间未记录";
}
function occurrences(text: string, quote: string) {
  if (!quote) return [];
  const matches: number[] = [];
  let offset = 0;
  while (matches.length < 30) {
    const index = text.indexOf(quote, offset);
    if (index < 0) break;
    matches.push(index);
    offset = index + 1;
  }
  return matches;
}
function excerptWindows(text: string, query: string) {
  if (query.trim().length < 2) return [];
  const needle = query.trim();
  const matcher = new RegExp(
    needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "giu",
  );
  const windows: { start: number; quote: string }[] = [];
  while (windows.length < 5) {
    const match = matcher.exec(text);
    if (!match) break;
    const index = match.index;
    let start = Math.max(0, index - 60),
      end = Math.min(text.length, index + Math.max(needle.length, 130));
    if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start])) start--;
    if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end])) end++;
    const lineStart = text.lastIndexOf("\n", index);
    if (lineStart >= start && index - lineStart < 80) start = lineStart + 1;
    const lineEnd = text.indexOf("\n", index + needle.length);
    if (lineEnd > index && lineEnd < end && lineEnd - start > needle.length)
      end = lineEnd;
    windows.push({ start, quote: text.slice(start, end) });
  }
  return windows;
}

export default function ClaimReview({
  runId,
  projectId,
  sources,
  originalClaims,
  request,
  refreshKey,
  onSource,
  onRecordsChanged,
}: {
  runId: string;
  projectId: string;
  sources: ReviewSource[];
  originalClaims: { text: string; kind: string; sourceIds: string[] }[];
  request: (path: string, options?: RequestInit) => Promise<unknown>;
  refreshKey: number;
  onSource: (sourceId: string, citation?: ClaimCitation) => void;
  onRecordsChanged: () => void;
}) {
  const [data, setData] = useState<AuditData | null>(null),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<ReviewDraft | null>(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    void request(`/agent/runs/${runId}/claims`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result as AuditData);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setLoadError((e as Error).message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [runId, projectId, reload, refreshKey]);
  const claims =
    (data?.claims.length ? data.claims : undefined) ||
    originalClaims.map((claim, index) => ({
      ...claim,
      key: String(index),
      index,
      claimFingerprint: "",
      quoteChecks: [],
      review: {
        revision: 0,
        status: "unreviewed" as const,
        state: "current" as const,
        citations: [],
        history: [],
      },
    }));
  const sourceMap = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources],
  );
  function begin(claim: AuditClaim) {
    setDraft({
      key: claim.key,
      expectedRevision: claim.review.revision,
      expectedClaimFingerprint: claim.claimFingerprint,
      status: claim.review.status,
      note: claim.review.note || "",
      reviewerLabel: claim.review.reviewerLabel || "我的审阅",
      reviewerType:
        claim.review.reviewerType === "agent-assisted"
          ? "agent-assisted"
          : "user",
      citations:
        claim.review.state === "current"
          ? claim.review.citations.map((citation) => ({
              sourceId: citation.sourceId,
              quote: citation.quote,
              start: citation.locator?.start,
            }))
          : [],
      confirmed: false,
    });
    setError("");
    setNotice("");
  }
  function update(change: Partial<ReviewDraft>) {
    setDraft((value) =>
      value
        ? { ...value, ...change, confirmed: change.confirmed ?? false }
        : value,
    );
  }
  async function save(claim: AuditClaim) {
    if (!draft || !draft.confirmed || draft.conflict) return;
    setSaving(true);
    setError("");
    try {
      await request(`/agent/runs/${runId}/claims/${claim.key}/review`, {
        method: "POST",
        body: JSON.stringify({
          projectId,
          expectedRevision: draft.expectedRevision,
          expectedClaimFingerprint: draft.expectedClaimFingerprint,
          confirm: true,
          status: draft.status,
          note: draft.note.trim(),
          reviewerLabel: draft.reviewerLabel.trim(),
          reviewerType: draft.reviewerType,
          citations:
            draft.status === "unreviewed"
              ? []
              : draft.citations.map((citation) => ({
                  sourceId: citation.sourceId,
                  quote: citation.quote,
                  ...(citation.start === undefined
                    ? {}
                    : { start: citation.start }),
                })),
        }),
      });
      const latest = (await request(
        `/agent/runs/${runId}/claims`,
      )) as AuditData;
      setData(latest);
      setDraft(null);
      setNotice("审阅标注已保存。原始模型结论与输出保持不变。");
      onRecordsChanged();
    } catch (e) {
      const failure = e as Error & { status?: number };
      if (failure.status === 409) {
        const latest = (await request(`/agent/runs/${runId}/claims`).catch(
          () => undefined,
        )) as AuditData | undefined;
        if (latest) setData(latest);
        const latestClaim = latest?.claims.find(
          (entry) => entry.key === claim.key,
        );
        const changed =
          !latestClaim ||
          latestClaim.review.revision !== draft.expectedRevision ||
          latestClaim.claimFingerprint !== draft.expectedClaimFingerprint;
        setDraft((value) =>
          value ? { ...value, conflict: changed, confirmed: false } : value,
        );
        setError(
          changed
            ? "断言、证据或审阅版本已经变化。草稿已保留，请读取最新记录并重新核对，系统没有覆盖已有标注。"
            : `${failure.message} 草稿已保留，请稍后重新确认。`,
        );
        onRecordsChanged();
      } else setError(failure.message);
    } finally {
      setSaving(false);
    }
  }
  function citationView(
    citation: ClaimCitation,
    index: number,
    historical = false,
  ) {
    const source = sourceMap.get(citation.sourceId);
    return (
      <div className="ag-audit-citation" key={`${citation.sourceId}-${index}`}>
        <div>
          <span className={citation.matched ? "matched" : "unmatched"}>
            {citation.matched ? (
              <CheckCircle2 size={11} />
            ) : (
              <AlertCircle size={11} />
            )}
            {citation.matched ? "原文字面匹配" : "摘录未匹配"}
          </span>
          <small>{source?.title || citation.sourceId}</small>
        </div>
        <blockquote>{citation.quote}</blockquote>
        {!!citation.error && <p className="ag-audit-hint">{citation.error}</p>}
        {citation.sourcePin && (
          <div className="ag-audit-pin">
            <span>
              抓取 {time(citation.sourcePin.fetchedAt)} · 网页发布日期未知
            </span>
            <span title={citation.sourcePin.sha256}>
              SHA256 {citation.sourcePin.sha256.slice(0, 12)}
            </span>
          </div>
        )}
        {(citation.sourcePin?.truncated || citation.sourcePin?.reusedFrom) && (
          <p className="ag-audit-capture-warning">
            {citation.sourcePin.truncated
              ? citation.sourcePin.extraction
                ? "提供的提取正文因长度上限被裁剪，摘录不代表覆盖全部正文。"
                : "旧存档带有覆盖范围标记，可能涉及 HTML 提取或正文裁剪，实际覆盖范围需要核对。"
              : ""}
            {citation.sourcePin.reusedFrom
              ? `历史证据复用${citation.sourcePin.reusedAt ? `于 ${time(citation.sourcePin.reusedAt)}` : ""}，未重新验证当前网页。`
              : ""}
          </p>
        )}
        {source && (
          <button
            type="button"
            className="ag-text-button"
            onClick={() =>
              onSource(
                citation.sourceId,
                citation.matched && !historical ? citation : undefined,
              )
            }
          >
            <BookOpen size={12} />
            {citation.matched && !historical
              ? "查看已存原文中的位置"
              : "查看已存来源"}
            <ArrowUpRight size={12} />
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="ag-claim-review">
      <div className="ag-audit-intro">
        <ShieldCheck size={16} />
        <div>
          <b>断言与证据，分别核对</b>
          <p>
            摘录精确匹配只说明原文出现过这段文字。是否支持断言，需要结合上下文审阅；标注不代表独立专家结论。
          </p>
        </div>
      </div>
      {loading && (
        <div className="ag-detail-notice">
          <Loader2 size={14} className="ag-spin" />
          正在读取断言与审阅记录…
        </div>
      )}
      {loadError && (
        <div className="ag-detail-notice error">
          <AlertCircle size={14} />
          <span>审阅记录未载入：{loadError}</span>
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            重试
          </button>
        </div>
      )}
      {data?.reviewable && (
        <div className="ag-audit-summary">
          <span>
            <b>{data.summary.unreviewed}</b> 未审阅
          </span>
          <span>
            <b>{data.summary.supported}</b> 来源支持
          </span>
          <span>
            <b>{data.summary.contradicted}</b> 来源反驳
          </span>
          <span>
            <b>{data.summary.needsVerification}</b> 待核实
          </span>
          {data.summary.invalidated > 0 && (
            <span className="invalidated">
              <b>{data.summary.invalidated}</b> 旧标注失效
            </span>
          )}
        </div>
      )}
      {notice && (
        <p className="ag-audit-notice" role="status">
          <CheckCircle2 size={13} />
          {notice}
        </p>
      )}
      {claims.map((claim) => {
        const editing = draft?.key === claim.key;
        const usableSources = claim.sourceIds
          .map((id) => sourceMap.get(id))
          .filter(
            (source): source is ReviewSource =>
              !!source &&
              source.status !== "failed" &&
              typeof source.text === "string" &&
              source.text.length > 0,
          );
        const validCitations =
          !!draft?.citations.length &&
          draft.citations.every((citation) => {
            const source = usableSources.find(
              (entry) => entry.id === citation.sourceId,
            );
            if (!source || !citation.quote.trim()) return false;
            const positions = occurrences(source.text || "", citation.quote);
            return (
              positions.length === 1 ||
              (citation.start !== undefined &&
                positions.includes(citation.start))
            );
          });
        const canSave =
          !!draft &&
          draft.confirmed &&
          !draft.conflict &&
          !!draft.reviewerLabel.trim() &&
          (draft.status !== "unreviewed" ||
            claim.review.status !== "unreviewed" ||
            claim.review.state === "invalidated") &&
          (draft.status === "unreviewed" || !!draft.note.trim()) &&
          (!["supported", "contradicted"].includes(draft.status) ||
            validCitations) &&
          (draft.status === "unreviewed" ||
            !draft.citations.length ||
            validCitations);
        return (
          <article className="ag-audit-claim" key={claim.key}>
            <div className="ag-audit-claim-top">
              <span className="ag-audit-index">
                {String(claim.index + 1).padStart(2, "0")}
              </span>
              <span className={`ag-claim-kind ${claim.kind}`}>
                {claim.kind === "fact"
                  ? "事实"
                  : claim.kind === "inference"
                    ? "推断"
                    : "待核实"}
              </span>
              <span
                className={`ag-audit-status ${claim.review.state === "invalidated" ? "invalidated" : claim.review.status}`}
              >
                {!data
                  ? "审阅状态未载入"
                  : !data.reviewable
                    ? "任务未完成 · 暂不可审阅"
                    : claim.review.state === "invalidated"
                      ? "旧标注已失效"
                      : statusLabels[claim.review.status]}
              </span>
            </div>
            <p className="ag-audit-original">{claim.text}</p>
            {!!claim.sourceIds.length && (
              <div className="ag-source-chips">
                {claim.sourceIds.map((id) => (
                  <button
                    type="button"
                    key={id}
                    disabled={!sourceMap.has(id)}
                    onClick={() => onSource(id)}
                  >
                    <Link2 size={11} />
                    {sourceMap.get(id)?.title || id}
                    <ArrowUpRight size={11} />
                  </button>
                ))}
              </div>
            )}
            <details className="ag-audit-generated">
              <summary>
                <BookOpen size={12} />
                生成时的证据摘录
                <span>
                  {claim.quoteChecks?.length
                    ? `${claim.quoteChecks.filter((citation) => citation.matched).length}/${claim.quoteChecks.length} 字面匹配`
                    : "未提供摘录"}
                </span>
                <ChevronDown size={12} />
              </summary>
              {claim.quoteChecks?.length ? (
                claim.quoteChecks.map((citation, index) =>
                  citationView(citation, index),
                )
              ) : (
                <p className="ag-audit-hint">
                  这次原始输出只提供来源引用，没有逐字摘录。它尚未完成摘录核验；不会补写历史分数。
                </p>
              )}
            </details>
            {claim.review.status !== "unreviewed" ||
            claim.review.state === "invalidated" ? (
              <div className="ag-audit-current">
                <div>
                  <History size={12} />
                  <b>审阅标注</b>
                  <span>
                    {reviewerKind(claim.review.reviewerType)} ·{" "}
                    {claim.review.reviewerLabel || "未记录审阅者"}
                  </span>
                </div>
                {claim.review.state === "invalidated" && (
                  <p className="ag-audit-invalidated">
                    断言或所依赖的证据发生变化，之前的「
                    {statusLabels[claim.review.previousStatus || "unreviewed"]}
                    」标注不再作为当前结论。
                  </p>
                )}
                <p>{claim.review.note}</p>
                {claim.review.state === "current" &&
                  claim.review.citations?.map((citation, index) =>
                    citationView(citation, index),
                  )}
              </div>
            ) : null}
            <div className="ag-audit-tools">
              <button
                type="button"
                className="ag-text-button"
                disabled={!data?.reviewable || loading || saving || !!draft}
                onClick={() => begin(claim)}
              >
                <ShieldCheck size={12} />
                {claim.review.status === "unreviewed"
                  ? "添加审阅标注"
                  : "重新核对与标注"}
              </button>
              {!!claim.review.history.length && (
                <details className="ag-audit-history">
                  <summary>
                    <History size={12} />
                    版本历史 {claim.review.history.length}
                    <ChevronDown size={11} />
                  </summary>
                  {[...claim.review.history].reverse().map((event) => (
                    <section key={event.id}>
                      <div>
                        <span className={`ag-audit-status ${event.status}`}>
                          {statusLabels[event.status]}
                        </span>
                        <time>
                          {time(event.createdAt)} · 修订 {event.revision}
                        </time>
                      </div>
                      <p>{event.note || "标注已重置"}</p>
                      <small>
                        {reviewerKind(event.reviewerType)} ·{" "}
                        {event.reviewerLabel}
                      </small>
                      {event.citations?.map((citation, index) =>
                        citationView(citation, index, true),
                      )}
                    </section>
                  ))}
                </details>
              )}
            </div>
            {editing && draft && (
              <section
                className="ag-audit-editor"
                aria-label={`审阅断言 ${claim.index + 1}`}
              >
                <h4>
                  <ShieldCheck size={15} />
                  核对断言与摘录
                </h4>
                <div className="ag-audit-editor-fields">
                  <label>
                    审阅结论
                    <select
                      value={draft.status}
                      disabled={saving}
                      onChange={(e) =>
                        update({ status: e.target.value as ReviewStatus })
                      }
                    >
                      {(Object.keys(statusLabels) as ReviewStatus[]).map(
                        (status) => (
                          <option key={status} value={status}>
                            {statusLabels[status]}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    审阅方式
                    <select
                      value={draft.reviewerType}
                      disabled={saving}
                      onChange={(e) =>
                        update({ reviewerType: e.target.value as ReviewerType })
                      }
                    >
                      <option value="user">我的审阅</option>
                      <option value="agent-assisted">AI 辅助审阅</option>
                    </select>
                  </label>
                  <label>
                    审阅者标注
                    <input
                      maxLength={100}
                      value={draft.reviewerLabel}
                      disabled={saving}
                      onChange={(e) =>
                        update({ reviewerLabel: e.target.value })
                      }
                    />
                  </label>
                </div>
                <label>
                  依据与不确定性
                  <textarea
                    rows={3}
                    maxLength={4000}
                    value={draft.note}
                    disabled={saving}
                    onChange={(e) => update({ note: e.target.value })}
                    placeholder="这段原文如何支持或反驳断言？是否只是官方声明？还有什么没有核实？"
                  />
                </label>
                {draft.status !== "unreviewed" && (
                  <div className="ag-audit-quote-editor">
                    <div>
                      <b>固定到已存证据的原文摘录</b>
                      <span>支持或反驳结论至少需要 1 段</span>
                    </div>
                    {draft.citations.map((citation, index) => (
                      <QuoteEditor
                        key={index}
                        index={index}
                        citation={citation}
                        sources={usableSources}
                        disabled={saving}
                        onChange={(next) =>
                          update({
                            citations: draft.citations.map((item, position) =>
                              position === index ? next : item,
                            ),
                          })
                        }
                        onRemove={() =>
                          update({
                            citations: draft.citations.filter(
                              (_, position) => position !== index,
                            ),
                          })
                        }
                        onSource={onSource}
                      />
                    ))}
                    <button
                      type="button"
                      className="ag-button light small"
                      disabled={
                        saving ||
                        !usableSources.length ||
                        draft.citations.length >= 8
                      }
                      onClick={() =>
                        update({
                          citations: [
                            ...draft.citations,
                            { sourceId: usableSources[0].id, quote: "" },
                          ],
                        })
                      }
                    >
                      <Plus size={12} />
                      添加原文摘录
                    </button>
                    {!usableSources.length && (
                      <p className="ag-audit-hint">
                        此断言尚无可读取的关联原文。可先标为「待进一步核实」，并说明缺失证据。
                      </p>
                    )}
                  </div>
                )}
                <label className="ag-confirm-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.confirmed}
                    disabled={saving || draft.conflict}
                    onChange={(e) => update({ confirmed: e.target.checked })}
                  />
                  <span>
                    {draft.status === "unreviewed"
                      ? "确认重置当前审阅标注，保留已有历史与原始模型输出。"
                      : "我已核对断言、引用和上下文，确认按所选审阅方式保存此标注。字面匹配不代表语义已自动验证。"}
                  </span>
                </label>
                {draft.conflict && (
                  <button
                    type="button"
                    className="ag-button light small"
                    disabled={saving}
                    onClick={() =>
                      update({
                        expectedRevision: claim.review.revision,
                        expectedClaimFingerprint: claim.claimFingerprint,
                        conflict: false,
                        confirmed: false,
                      })
                    }
                  >
                    使用最新记录重新核对
                    <History size={12} />
                  </button>
                )}
                {error && (
                  <p className="ag-field-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="ag-audit-editor-bottom">
                  <small>修订 {claim.review.revision} · 原始断言保持不变</small>
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
                    disabled={saving || !canSave}
                    onClick={() => void save(claim)}
                  >
                    {saving ? (
                      <Loader2 size={13} className="ag-spin" />
                    ) : (
                      <Check size={13} />
                    )}
                    确认保存标注
                  </button>
                </div>
              </section>
            )}
          </article>
        );
      })}
    </div>
  );
}

function QuoteEditor({
  index,
  citation,
  sources,
  disabled,
  onChange,
  onRemove,
  onSource,
}: {
  index: number;
  citation: CitationDraft;
  sources: ReviewSource[];
  disabled: boolean;
  onChange: (citation: CitationDraft) => void;
  onRemove: () => void;
  onSource: (sourceId: string, citation?: ClaimCitation) => void;
}) {
  const [query, setQuery] = useState(""),
    [copied, setCopied] = useState(false),
    [manualCopy, setManualCopy] = useState(false);
  const quoteInput = useRef<HTMLTextAreaElement>(null);
  const source = sources.find((entry) => entry.id === citation.sourceId);
  const positions = occurrences(source?.text || "", citation.quote);
  const located =
    positions.length === 1 ||
    (citation.start !== undefined && positions.includes(citation.start));
  const matches = excerptWindows(source?.text || "", query);
  return (
    <div className="ag-quote-editor">
      <div className="ag-quote-editor-head">
        <span>摘录 {index + 1}</span>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`移除摘录 ${index + 1}`}
        >
          <X size={13} />
        </button>
      </div>
      <label>
        关联证据
        <select
          value={citation.sourceId}
          disabled={disabled}
          onChange={(e) => {
            onChange({ sourceId: e.target.value, quote: "" });
            setQuery("");
          }}
        >
          {sources.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.title || entry.url}
            </option>
          ))}
        </select>
      </label>
      {source && (
        <div className="ag-audit-pin">
          <span>抓取 {time(source.fetchedAt)}</span>
          <span title={source.sha256}>SHA256 {source.sha256.slice(0, 12)}</span>
          <button type="button" onClick={() => onSource(source.id)}>
            查看原文
            <ArrowUpRight size={11} />
          </button>
        </div>
      )}
      <label>
        逐字摘录
        <textarea
          ref={quoteInput}
          rows={3}
          maxLength={4000}
          value={citation.quote}
          disabled={disabled}
          onChange={(e) => {
            onChange({ sourceId: citation.sourceId, quote: e.target.value });
            setCopied(false);
            setManualCopy(false);
          }}
          placeholder="从已保存原文复制，不添加省略号或改写。"
        />
      </label>
      {citation.quote && (
        <div className={`ag-quote-match ${located ? "matched" : "unmatched"}`}>
          {located ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
          <span>
            {located
              ? "文字出现在已存原文中；是否支持断言仍需审阅。"
              : positions.length
                ? `这段文字在原文出现 ${positions.length} 次，请选择具体位置。`
                : "这段摘录没有在所选原文中逐字匹配，请核对。"}
          </span>
          {located && (
            <button
              type="button"
              onClick={() => {
                const manual = () => {
                  quoteInput.current?.focus();
                  quoteInput.current?.select();
                  setCopied(false);
                  setManualCopy(true);
                };
                if (!navigator.clipboard?.writeText) {
                  manual();
                  return;
                }
                void navigator.clipboard
                  .writeText(citation.quote)
                  .then(() => {
                    setCopied(true);
                    setManualCopy(false);
                  })
                  .catch(manual);
              }}
            >
              <Copy size={12} />
              {copied
                ? "已复制"
                : manualCopy
                  ? "已全选，可手动复制"
                  : "复制摘录"}
            </button>
          )}
        </div>
      )}
      {positions.length > 1 && (
        <div className="ag-quote-occurrences">
          {positions.map((start, position) => (
            <button
              type="button"
              key={start}
              disabled={disabled}
              className={citation.start === start ? "selected" : ""}
              onClick={() => onChange({ ...citation, start })}
            >
              位置 {position + 1} · #{start}
            </button>
          ))}
        </div>
      )}
      <details className="ag-quote-search">
        <summary>
          <Search size={12} />
          在已存原文中查找
          <ChevronDown size={11} />
        </summary>
        <label>
          查找关键词
          <input
            value={query}
            disabled={disabled}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="至少 2 个字符，如 memory / 记忆"
          />
        </label>
        {matches.map((match) => (
          <div key={match.start}>
            <p>{match.quote}</p>
            <button
              type="button"
              className="ag-text-button"
              disabled={disabled || match.quote.length > 4000}
              onClick={() =>
                onChange({
                  sourceId: citation.sourceId,
                  quote: match.quote,
                  start: match.start,
                })
              }
            >
              使用这段原文
              <Plus size={11} />
            </button>
          </div>
        ))}
        {query.trim().length >= 2 && !matches.length && (
          <p className="ag-audit-hint">
            没有找到这个关键词。请换词或查看原文。
          </p>
        )}
      </details>
    </div>
  );
}
