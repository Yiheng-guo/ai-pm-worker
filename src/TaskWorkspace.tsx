import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  FileText,
  ListChecks,
  Loader2,
  MessageSquare,
  Pencil,
  RefreshCw,
} from "lucide-react";

export type TaskAction = {
  id: string;
  title: string;
  done: boolean;
  note?: string;
  dueDate?: string | null;
  sourceIds?: string[];
  requirementIndices?: number[];
  key?: string;
  index?: number;
  modelId?: string | null;
  actionFingerprint?: string;
};
export type ActionItem = TaskAction & {
  key: string;
  index: number;
  actionFingerprint: string;
};
type TaskRun = {
  id: string;
  projectId: string;
  kind: string;
  status: string;
  prompt: string;
  createdAt: string;
  cancellationPending?: boolean;
  result?: { actions?: TaskAction[]; requirements?: { title: string }[] };
};
type ItemsResponse = {
  runId: string;
  projectId: string;
  editable: boolean;
  items: ActionItem[];
};
type Request = (path: string, options?: RequestInit) => Promise<unknown>;
type Failure = Error & { status?: number; code?: string };
function isItem(action: TaskAction): action is ActionItem {
  return (
    typeof action.key === "string" &&
    /^[a-f0-9]{32}$/.test(action.key) &&
    typeof action.actionFingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(action.actionFingerprint) &&
    Number.isInteger(action.index) &&
    Number(action.index) >= 0
  );
}
function signature(run: TaskRun) {
  return JSON.stringify([run.status, run.result?.actions || []]);
}
function date(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  });
}

export default function TaskWorkspace({
  projectId,
  runs,
  filter,
  onFilter,
  request,
  onUpdated,
  sources,
  onResearch,
  onRequirement,
  onFollowUp,
  onNewResearch,
}: {
  projectId: string;
  runs: TaskRun[];
  filter: string;
  onFilter: (filter: string) => void;
  request: Request;
  onUpdated: (run: unknown) => void;
  sources: (runId: string, ids?: string[]) => ReactNode;
  onResearch: (runId: string) => void;
  onRequirement: (runId: string, index: number) => void;
  onFollowUp: (runId: string, action: ActionItem) => void;
  onNewResearch: () => void;
}) {
  const [cache, setCache] = useState<
    Record<string, { signature: string; data: ItemsResponse }>
  >({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reload, setReload] = useState(0);
  const [editingItems, setEditingItems] = useState<
    Record<string, { action: ActionItem; run: TaskRun }>
  >({});
  const eligible = runs.filter(
    (run) =>
      run.projectId === projectId &&
      run.status === "completed" &&
      !run.cancellationPending &&
      ["research", "recall"].includes(run.kind),
  );
  function dataFor(run: TaskRun): ItemsResponse | undefined {
    const cached = cache[run.id];
    if (cached?.signature === signature(run)) return cached.data;
    const actions = run.result?.actions || [];
    if (actions.every(isItem))
      return {
        runId: run.id,
        projectId: run.projectId,
        editable: true,
        items: actions as ActionItem[],
      };
  }
  const missing = eligible.filter((run) => !dataFor(run));
  const missingScope = JSON.stringify(
    missing.map((run) => [run.id, signature(run)]),
  );
  useEffect(() => {
    if (!missing.length) return;
    const controller = new AbortController();
    // Compatibility hydration is only needed when bootstrap lacks stable metadata.
    void Promise.allSettled(
      missing.map(async (run) => {
        const data = (await request(`/agent/runs/${run.id}/action-items`, {
          signal: controller.signal,
        })) as ItemsResponse;
        if (
          data.runId !== run.id ||
          data.projectId !== projectId ||
          !data.items.every(isItem)
        )
          throw new Error("待办定位信息不完整，请重新读取。");
        return { id: run.id, signature: signature(run), data };
      }),
    ).then((results) => {
      if (controller.signal.aborted) return;
      const nextCache: Record<
        string,
        { signature: string; data: ItemsResponse }
      > = {};
      const nextErrors: Record<string, string> = {};
      results.forEach((result, index) => {
        const id = missing[index].id;
        if (result.status === "fulfilled") {
          nextCache[id] = {
            signature: result.value.signature,
            data: result.value.data,
          };
          nextErrors[id] = "";
        } else nextErrors[id] = (result.reason as Error).message;
      });
      setCache((current) => ({ ...current, ...nextCache }));
      setErrors((current) => ({ ...current, ...nextErrors }));
    });
    return () => controller.abort();
  }, [projectId, missingScope, reload]);
  async function reloadItem(run: TaskRun, key: string) {
    const data = (await request(
      `/agent/runs/${run.id}/action-items`,
    )) as ItemsResponse;
    if (
      data.runId !== run.id ||
      data.projectId !== projectId ||
      !data.items.every(isItem)
    )
      throw new Error("最新待办与当前项目不一致，草稿已保留。");
    setCache((current) => ({
      ...current,
      [run.id]: { signature: signature(run), data },
    }));
    return data.items.find((item) => item.key === key) || null;
  }
  const items = eligible.flatMap((run) =>
    (dataFor(run)?.items || []).map((item) => ({
      ...item,
      run,
      editable: dataFor(run)?.editable !== false,
    })),
  );
  const displayedItems = [
    ...items,
    ...Object.entries(editingItems)
      .filter(
        ([key]) => !items.some((item) => `${item.run.id}:${item.key}` === key),
      )
      .map(([, saved]) => ({
        ...saved.action,
        run: saved.run,
        editable: false,
      })),
  ];
  const visible = displayedItems
    .filter(
      (item) =>
        !!editingItems[`${item.run.id}:${item.key}`] ||
        filter === "all" ||
        (filter === "done" ? item.done : !item.done),
    )
    .sort((a, b) =>
      (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31"),
    );
  async function update(
    run: TaskRun,
    item: ActionItem,
    change: { done?: boolean; note?: string; dueDate?: string | null },
    expectedActionFingerprint: string,
  ) {
    const updated = await request(
      `/agent/runs/${run.id}/action-items/${item.key}`,
      {
        method: "PATCH",
        body: JSON.stringify({ ...change, expectedActionFingerprint }),
      },
    );
    onUpdated(updated);
  }
  return (
    <>
      <div className="ag-task-summary">
        <div>
          <strong>
            {missing.length ? "—" : items.filter((item) => !item.done).length}
          </strong>
          <span>待跟进</span>
        </div>
        <div>
          <strong>
            {missing.length ? "—" : items.filter((item) => item.done).length}
          </strong>
          <span>已完成</span>
        </div>
        <div>
          <strong>{missing.length ? "—" : items.length}</strong>
          <span>总行动项</span>
        </div>
        <p>
          <Clock3 size={15} />
          日期用于整理跟进顺序。此版本不会自动提醒或执行。
        </p>
      </div>
      <div className="ag-filter-tabs">
        {[
          { id: "open", title: "待跟进" },
          { id: "done", title: "已完成" },
          { id: "all", title: "全部" },
        ].map((option) => (
          <button
            className={filter === option.id ? "active" : ""}
            key={option.id}
            onClick={() => onFilter(option.id)}
          >
            {option.title}
          </button>
        ))}
      </div>
      {missing.map((run) => (
        <div
          className={`ag-detail-notice ${errors[run.id] ? "error" : ""}`}
          key={run.id}
        >
          {errors[run.id] ? (
            <AlertCircle size={15} />
          ) : (
            <Loader2 size={15} className="ag-spin" />
          )}
          <span>
            {errors[run.id]
              ? `待办暂未读取：${errors[run.id]}`
              : "正在读取待办的稳定定位信息…"}
          </span>
          {errors[run.id] && (
            <button onClick={() => setReload((value) => value + 1)}>
              <RefreshCw size={12} />
              重试
            </button>
          )}
        </div>
      ))}
      {visible.length ? (
        <div className="ag-task-list">
          {visible.map((item) => (
            <TaskCard
              key={`${item.run.id}:${item.key}`}
              action={item}
              editable={item.editable}
              sources={sources(item.run.id, item.sourceIds)}
              onToggle={() =>
                update(
                  item.run,
                  item,
                  { done: !item.done },
                  item.actionFingerprint,
                )
              }
              onSave={(change, fingerprint) =>
                update(item.run, item, change, fingerprint)
              }
              onReload={() => reloadItem(item.run, item.key)}
              onResearch={() => onResearch(item.run.id)}
              onRequirement={(index) => onRequirement(item.run.id, index)}
              onFollowUp={() => onFollowUp(item.run.id, item)}
              onEditingChange={(editing) =>
                setEditingItems((current) => {
                  const key = `${item.run.id}:${item.key}`;
                  if (editing)
                    return {
                      ...current,
                      [key]: { action: item, run: item.run },
                    };
                  const next = { ...current };
                  delete next[key];
                  return next;
                })
              }
            />
          ))}
        </div>
      ) : (
        !missing.length && (
          <div className="ag-empty">
            <div className="ag-empty-icon">
              <ListChecks size={25} />
            </div>
            <h3>{items.length ? "这个列表已经清空" : "把下一步留在这里"}</h3>
            <p>
              {items.length
                ? "切换筛选可查看其他行动项。"
                : "研究完成后，验证、访谈和后续分析等行动项会自动归入项目待办。"}
            </p>
            <button className="ag-button light" onClick={onNewResearch}>
              回到研究
              <ArrowRight size={14} />
            </button>
          </div>
        )
      )}
    </>
  );
}

function TaskCard({
  action,
  editable,
  sources,
  onToggle,
  onSave,
  onReload,
  onResearch,
  onFollowUp,
  onRequirement,
  onEditingChange,
}: {
  action: ActionItem & { run: TaskRun };
  editable: boolean;
  sources: ReactNode;
  onToggle: () => Promise<void>;
  onSave: (
    change: { note: string; dueDate: string | null },
    fingerprint: string,
  ) => Promise<void>;
  onReload: () => Promise<ActionItem | null>;
  onResearch: () => void;
  onFollowUp: () => void;
  onRequirement: (index: number) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const dateInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false),
    [note, setNote] = useState(action.note || ""),
    [dueDate, setDueDate] = useState(action.dueDate || "");
  const [baseline, setBaseline] = useState<ActionItem | null>(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [conflict, setConflict] = useState(false),
    [latest, setLatest] = useState<ActionItem | null>(null),
    [checking, setChecking] = useState(false);
  const changedWhileEditing = !!(
    editing &&
    baseline &&
    baseline.actionFingerprint !== action.actionFingerprint
  );
  const pendingComparison = conflict || changedWhileEditing;
  const comparison = latest || (changedWhileEditing ? action : null);
  const overdue =
    !action.done &&
    !!action.dueDate &&
    action.dueDate <
      new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  const linked = Array.isArray(action.requirementIndices)
    ? [...new Set(action.requirementIndices)].filter(
        (index) =>
          Number.isInteger(index) &&
          index >= 0 &&
          index < (action.run.result?.requirements?.length || 0),
      )
    : [];
  const invalidLink =
    !!action.requirementIndices?.length &&
    linked.length !== action.requirementIndices.length;
  async function readLatest() {
    setChecking(true);
    try {
      const current = await onReload();
      setLatest(current);
      if (!current)
        setError("原行动项已不存在，草稿仍保留在编辑器中，请复制后处理。");
    } catch (e) {
      setError(`最新记录暂时无法读取，草稿已保留：${(e as Error).message}`);
    } finally {
      setChecking(false);
    }
  }
  async function save() {
    if (!baseline || pendingComparison) return;
    setSaving(true);
    setError("");
    try {
      await onSave(
        { note: note.trim(), dueDate: dateInput.current?.value || null },
        baseline.actionFingerprint,
      );
      setEditing(false);
      onEditingChange(false);
      setBaseline(null);
    } catch (e) {
      const failure = e as Failure;
      if (failure.status === 409 && failure.code === "ACTION_CHANGED") {
        setConflict(true);
        setError(
          "行动内容或跟进状态已更新。你的日期与备注草稿已保留，请核对最新记录后再保存。",
        );
        await readLatest();
      } else setError(failure.message);
    } finally {
      setSaving(false);
    }
  }
  async function toggle() {
    setSaving(true);
    setError("");
    try {
      await onToggle();
    } catch (e) {
      const failure = e as Failure;
      setError(
        failure.code === "ACTION_CHANGED"
          ? "待办已被更新，请核对最新状态后再操作。"
          : failure.message,
      );
      if (failure.code === "ACTION_CHANGED") await readLatest();
    } finally {
      setSaving(false);
    }
  }
  function openEditor() {
    setNote(action.note || "");
    setDueDate(action.dueDate || "");
    setBaseline({ ...action });
    setConflict(false);
    setLatest(null);
    setError("");
    setEditing(true);
    onEditingChange(true);
  }
  function closeEditor() {
    setEditing(false);
    onEditingChange(false);
  }
  return (
    <article className={`ag-task-card ${action.done ? "done" : ""}`}>
      <button
        className="ag-checkbox"
        disabled={saving || checking || editing || !editable}
        aria-label={
          action.done
            ? `将 ${action.title} 标记为未完成`
            : `完成 ${action.title}`
        }
        aria-pressed={action.done}
        onClick={() => void toggle()}
      >
        {saving && !editing ? (
          <Loader2 size={12} className="ag-spin" />
        ) : (
          action.done && <Check size={13} />
        )}
      </button>
      <div className="ag-task-body">
        <span className="ag-task-order">
          行动 {String(action.index + 1).padStart(2, "0")}
        </span>
        <h3>{action.title}</h3>
        {sources}
        {!!linked.length && (
          <div className="ag-task-requirements">
            <span>明确关联需求</span>
            {linked.map((index) => (
              <button key={index} onClick={() => onRequirement(index)}>
                <FileText size={12} />
                {index + 1}. {action.run.result?.requirements?.[index]?.title}
                <ArrowUpRight size={12} />
              </button>
            ))}
          </div>
        )}
        {invalidLink && (
          <p className="ag-task-link-warning">
            部分需求关联重复或无效，需要核对原始研究记录。
          </p>
        )}
        <div className="ag-task-metadata">
          <small>
            来自 {action.run.kind === "recall" ? "记忆回顾" : "竞品研究"} ·{" "}
            {date(action.run.createdAt)}
          </small>
          {action.dueDate && (
            <span className={overdue ? "overdue" : ""}>
              <Clock3 size={12} />
              {overdue ? "已过跟进日期 · " : "跟进 "}
              {action.dueDate}
            </span>
          )}
        </div>
        {!!action.note && !editing && (
          <p className="ag-task-note">{action.note}</p>
        )}
        <div className="ag-task-tools">
          <button
            className="ag-text-button"
            onClick={() => (editing ? closeEditor() : openEditor())}
            disabled={saving || checking || !editable}
          >
            <Pencil size={12} />
            {editing ? "收起编辑" : "日期与进展"}
          </button>
          <button className="ag-text-button" onClick={onResearch}>
            研究依据
            <ArrowUpRight size={12} />
          </button>
          <button className="ag-text-button" onClick={onFollowUp}>
            <MessageSquare size={12} />
            继续研究
            <ArrowRight size={12} />
          </button>
        </div>
        {editing && (
          <div className="ag-task-editor">
            <label>
              跟进日期
              <input
                ref={dateInput}
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                onBlur={(event) => setDueDate(event.currentTarget.value)}
                disabled={saving}
              />
            </label>
            <label>
              进展与补充信息
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="记录已做的验证、发现和下一步…"
                rows={3}
                maxLength={4000}
                disabled={saving}
              />
            </label>
            {pendingComparison && (
              <div className="ag-task-conflict">
                <div>
                  <AlertCircle size={14} />
                  <b>记录已变化，草稿保持不变</b>
                </div>
                {comparison ? (
                  <>
                    <p>最新行动：{comparison.title}</p>
                    <p>
                      最新状态：{comparison.done ? "已完成" : "待跟进"} · 日期：
                      {comparison.dueDate || "未设置"}
                    </p>
                    <p>最新备注：{comparison.note || "未填写"}</p>
                    <button
                      className="ag-button light small"
                      disabled={saving || checking}
                      onClick={() => {
                        setBaseline({ ...comparison });
                        setConflict(false);
                        setLatest(null);
                        setError("");
                      }}
                    >
                      已核对，保留草稿继续编辑
                    </button>
                  </>
                ) : (
                  <button
                    className="ag-text-button"
                    disabled={checking || saving}
                    onClick={() => void readLatest()}
                  >
                    {checking ? (
                      <Loader2 size={12} className="ag-spin" />
                    ) : (
                      <RefreshCw size={12} />
                    )}
                    读取最新记录
                  </button>
                )}
              </div>
            )}
            <div className="ag-task-editor-bottom">
              <small>手动记录日期，不会自动提醒或调用模型。</small>
              <button
                type="button"
                className="ag-button light small"
                onClick={closeEditor}
                disabled={saving}
              >
                取消
              </button>
              <button
                type="button"
                className="ag-button primary small"
                disabled={saving || checking || pendingComparison || !editable}
                onClick={() => void save()}
              >
                {saving ? (
                  <Loader2 size={13} className="ag-spin" />
                ) : (
                  <Check size={13} />
                )}
                保存跟进
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="ag-field-error ag-task-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
