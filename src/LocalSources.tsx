import { useEffect, useRef, useState } from "react";
import { FilePlus2, Loader2, Check, RefreshCw } from "lucide-react";
import "./source-intake.css";

export type ImportedSource = {
  id: string; projectId?: string; title: string; url: string; status: "imported";
  text?: string; raw?: string; preview?: string; sha256: string; textSha256: string;
  fetchedAt: null; capturedAt: string; importedAt?: string; rawBytes: number;
  extraction: { providedChars: number; extractedChars: number }; truncated: boolean;
  origin: { kind: "git-commit" | "text-import"; repoId?: string; relativePath?: string; commit?: string; ignoresWorkingTreeEdits?: boolean; workingTreeHasChangesAtCapture?: boolean | null; workingTreeInspection?: string; sourceLabel?: string; note: string };
};
type Preview = { source: ImportedSource; expectedImportFingerprint: string };
async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/agent" + path, { signal, ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || "来源操作失败"), { status: response.status });
  return data;
}
export default function LocalSources({ projectId, onImported, onOpen, onResearch }: { projectId: string; onImported: (source: ImportedSource) => void; onOpen: (source: ImportedSource) => void; onResearch: (source: ImportedSource) => void }) {
  const [sources, setSources] = useState<ImportedSource[]>([]);
  const [repos, setRepos] = useState<{ id: string; label: string }[]>([]);
  const [open, setOpen] = useState(false), [kind, setKind] = useState("git-commit"), [repoId, setRepoId] = useState("yiban"), [path, setPath] = useState("README.md"), [title, setTitle] = useState(""), [label, setLabel] = useState("项目资料"), [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [importerType, setImporterType] = useState("user");
  const epoch = useRef(0), operation = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); epoch.current++; operation.current?.abort();
    setPreview(null); setConfirmed(false); setSources([]); setError(""); setBusy(false);
    request<{ sources: ImportedSource[]; repositoryOptions: { id: string; label: string }[] }>(`/projects/${encodeURIComponent(projectId)}/sources`, undefined, controller.signal).then(data => { if (!controller.signal.aborted) { setSources(data.sources); setRepos(data.repositoryOptions); if (!data.repositoryOptions.length) setKind("text-import"); } }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => { controller.abort(); operation.current?.abort(); epoch.current++; };
  }, [projectId]);
  const change = (update: () => void) => { update(); epoch.current++; operation.current?.abort(); setBusy(false); setPreview(null); setConfirmed(false); setError(""); };
  const body = () => kind === "git-commit" ? { kind, repoId, relativePath: path.trim(), ...(title.trim() ? { title: title.trim() } : {}) } : { kind, text, sourceLabel: label.trim(), ...(title.trim() ? { title: title.trim() } : {}) };
  async function inspect() {
    const generation = ++epoch.current; const controller = new AbortController(); operation.current?.abort(); operation.current = controller;
    setBusy(true); setError(""); setPreview(null); setConfirmed(false);
    try { const data = await request<Preview>(`/projects/${encodeURIComponent(projectId)}/sources/preview`, body(), controller.signal); if (epoch.current === generation) setPreview(data); }
    catch (e) { if (epoch.current === generation && !controller.signal.aborted) setError((e as Error).message); }
    finally { if (epoch.current === generation) setBusy(false); }
  }
  async function save() {
    if (!preview || !confirmed || busy) return;
    const generation = ++epoch.current; const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError("");
    try { const source = await request<ImportedSource>(`/projects/${encodeURIComponent(projectId)}/sources`, { ...body(), confirm: true, expectedImportFingerprint: preview.expectedImportFingerprint, importerType, importerLabel: importerType === "agent-assisted" ? "AI辅助导入" : importerType === "implementation-fixture" ? "实现验收示例" : "本机工作空间用户" }, controller.signal); if (epoch.current === generation) { setSources(previous => [source, ...previous]); setPreview(null); setConfirmed(false); onImported(source); } }
    catch (e) { if (epoch.current === generation && !controller.signal.aborted) { setError((e as Error).message); setPreview(null); setConfirmed(false); } }
    finally { if (epoch.current === generation) setBusy(false); }
  }
  return <section className="ag-source-intake">
    <div className="ag-source-intake-header"><div><h2>项目资料</h2><p>导入固定提交文档或明确提供的文本，作为可引用的资料。不会自动写入确认记忆。</p></div><button type="button" onClick={() => setOpen(!open)} aria-expanded={open}><FilePlus2 size={16} />{open ? "收起导入" : "导入项目资料"}</button></div>
    {error && <p role="alert" className="ag-source-intake-error">{error}</p>}
    {open && <div className="ag-source-intake-form">
      <label>导入方式<select value={kind} disabled={busy} onChange={e => change(() => setKind(e.target.value))}>{repos.length > 0 && <option value="git-commit">本机仓库的固定提交文档</option>}<option value="text-import">我提供的文本</option></select></label>
      {kind === "git-commit" ? <><label>仓库<select value={repoId} disabled={busy} onChange={e => change(() => setRepoId(e.target.value))}>{repos.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label><label>文档相对路径<input value={path} disabled={busy} onChange={e => change(() => setPath(e.target.value))} placeholder="README.md 或 docs/项目说明.md" /></label><p>读取当前 HEAD 的文档对象，保留固定提交；未提交修改不会导入。不会扫描目录或读取配置、密钥文件。</p></> : <><label>文本出处说明<input value={label} disabled={busy} onChange={e => change(() => setLabel(e.target.value))} /></label><label>资料正文<textarea value={text} disabled={busy} onChange={e => change(() => setText(e.target.value))} rows={6} placeholder="粘贴你授权使用的项目资料（至少80个字符）" /></label><p>文本出处由提交者说明，尚未独立核验作者或真实性。</p></>}
      <label>标题（可选）<input value={title} disabled={busy} onChange={e => change(() => setTitle(e.target.value))} maxLength={200} /></label>
      <label>本次导入操作方式<select value={importerType} disabled={busy} onChange={e => { setImporterType(e.target.value); setConfirmed(false); }}><option value="user">用户本人导入</option><option value="agent-assisted">AI辅助导入</option><option value="implementation-fixture">实现验收示例</option></select></label>
      <button type="button" disabled={busy} onClick={() => void inspect()}>{busy ? <Loader2 size={16} /> : <RefreshCw size={16} />}预览本次资料</button>
      {preview && <div className="ag-source-intake-preview"><h3>{preview.source.title}</h3><p>{preview.source.origin.note}</p>{preview.source.origin.commit && <p>固定提交 <code>{preview.source.origin.commit}</code> · {preview.source.origin.workingTreeHasChangesAtCapture == null ? "未检查工作树；未提交修改不在此次导入中" : `历史导入记录：此时仓库${preview.source.origin.workingTreeHasChangesAtCapture ? "有" : "无"}已跟踪文件的未提交修改`}</p>}<p>原始 {preview.source.rawBytes.toLocaleString()} 字节 · 提供正文 {preview.source.extraction.providedChars.toLocaleString()} / {preview.source.extraction.extractedChars.toLocaleString()} UTF16单位 · SHA256 <code>{preview.source.sha256}</code></p>{preview.source.truncated && <p>正文已按上限截断，原始文本将完整保存。引文只能使用提供的正文。</p>}<pre>{preview.source.text}</pre><label className="ag-source-intake-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />我已查看范围和来源说明，确认保存到本项目；这不等于核实结论或确认记忆。</label><button type="button" disabled={busy || !confirmed} onClick={() => void save()}><Check size={16} />确认保存项目资料</button></div>}
    </div>}
    {!!sources.length && <div className="ag-source-intake-list">{sources.map(s => <article key={s.id}><div><strong>{s.title}</strong><p>{s.origin.kind === "git-commit" ? `固定提交 ${s.origin.commit?.slice(0, 12)} · ${s.origin.relativePath}` : `提交者文本 · ${s.origin.sourceLabel}`} · 本机导入</p></div><button type="button" onClick={() => onOpen(s)}>查看资料</button><button type="button" onClick={() => onResearch(s)}>带入研究</button></article>)}</div>}
  </section>;
}
