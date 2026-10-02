import { createHash } from "node:crypto";
import { z } from "zod";
import { isUsableEvidence } from "./evidence.mjs";

const hash = text => createHash("sha256").update(text).digest("hex");
const warn = (code, message) => ({ code, message });
const fields = ["background", "goal", "constraints"];
export const DEFAULT_PROTOTYPE_PROMPT = "将本次候选需求做成可验证的交互原型。";
export const prototypeRequestSchema = z.object({ prompt: z.string().trim().min(5).max(12000).default(DEFAULT_PROTOTYPE_PROMPT), requirementIndices: z.array(z.number().int().nonnegative()).min(1).max(30).optional(), prototypeMode: z.enum(["new", "revise"]).optional(), expectedBriefFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
export const requirementKey = (runId, index) => hash(JSON.stringify(["requirement", runId, index])).slice(0, 32);
const fail = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const activeMemory = p => (p?.memory || []).filter(m => !m.status || m.status === "active");
const snapshot = p => ({ id: p?.id || null, name: p?.name || "", background: p?.background || "", goal: p?.goal || "", constraints: p?.constraints || "", memory: activeMemory(p).map(m => ({ id: m.id, text: m.text, source: m.source || "用户确认", revisionId: m.revisionId || null, status: "active" })), memoryRevision: p?.memoryRevision ?? 0 });
function sourcePin(source) {
  return { id: source.id, title: source.title || "", url: source.url, retrievalUrl: source.retrievalUrl || source.url, sha256: source.sha256 || null, rawSha256: typeof source.raw === "string" ? hash(source.raw) : null, textSha256: typeof source.text === "string" ? hash(source.text) : null, fetchedAt: source.fetchedAt || null, capturedAt: source.capturedAt || null, origin: source.origin || null, publishedAt: null, publishedDateKnown: false, truncated: !!source.truncated, extraction: source.extraction || null, reusedFrom: source.reusedFrom || null, reusedAt: source.reusedAt || null, ageAtReuseSeconds: source.ageAtReuseSeconds ?? null, snapshotIntegrity: isUsableEvidence(source) };
}
const indexArray = (value, size) => Array.isArray(value) && value.every(i => Number.isInteger(i) && i >= 0 && i < size) && new Set(value).size === value.length;

export function projectRequirementBasis(run, audit) {
  const claims = audit?.claims || [];
  const researchProject = snapshot(run.raw?.project);
  const all = run.result?.requirements || [];
  const requirements = all.map((requirement, index) => {
    const warnings = []; const basis = requirement.basis ?? null;
    const bindings = { claims: [], projectFields: [], memory: [], sources: [] };
    for (const id of [...new Set(requirement.sourceIds || [])]) {
      const source = (run.sources || []).find(s => s.id === id);
      if (!source) warnings.push(warn("INVALID_SOURCE_REFERENCE", "需求引用的来源不存在。"));
      else bindings.sources.push(sourcePin(source));
    }
    if (!basis) warnings.push(warn("LEGACY_UNLINKED_BASIS", "旧需求尚未建立显式论证链；共同来源不等于主张已支持需求。"));
    else {
      const validShape = indexArray(basis.claimIndices, claims.length) && Array.isArray(basis.projectFields) && basis.projectFields.every(f => fields.includes(f)) && new Set(basis.projectFields).size === basis.projectFields.length && Array.isArray(basis.memoryIds) && basis.memoryIds.every(id => typeof id === "string") && new Set(basis.memoryIds).size === basis.memoryIds.length && Array.isArray(basis.assumptions) && basis.assumptions.every(x => typeof x === "string") && Array.isArray(basis.verification) && basis.verification.every(x => typeof x === "string");
      if (!validShape) warnings.push(warn("INVALID_BASIS_REFERENCE", "论证字段或主张索引无效；未绑定不存在的依据。"));
      else {
        for (const i of basis.claimIndices) {
          const c = claims[i];
          bindings.claims.push({ key: c.key, index: c.index, text: c.text, kind: c.kind, claimFingerprint: c.claimFingerprint, reviewSnapshot: { revision: c.review.revision, status: c.review.status, state: c.review.state, reviewerLabel: c.review.reviewerLabel, reviewerType: c.review.reviewerType }, quoteChecks: c.quoteChecks, citations: c.review.citations });
          if (c.kind !== "fact" || c.review.status !== "supported") warnings.push(warn("UNVERIFIED_CLAIM", "所引主张仍含推断、未知或未确认的标注，原型只能作为探索假设。"));
          if (c.review.status === "supported") warnings.push(warn("DECLARED_REVIEW_NOT_TRUTH", "支持是标注者的判断，不能作为客观事实或独立评测担保。"));
        }
        for (const field of [...new Set(basis.projectFields)]) bindings.projectFields.push({ field, text: researchProject[field], textSha256: hash(researchProject[field]) });
        for (const id of [...new Set(basis.memoryIds)]) {
          const memory = researchProject.memory.find(m => m.id === id);
          if (!memory) warnings.push(warn("INVALID_MEMORY_REFERENCE", "所引记忆不在研究时有效记忆中。"));
          else bindings.memory.push({ id: memory.id, text: memory.text, source: memory.source || "", revisionId: memory.revisionId || null, updatedAt: memory.updatedAt || null });
        }
        if (![basis.claimIndices, basis.projectFields, basis.memoryIds, basis.assumptions, basis.verification].some(a => a.length)) warnings.push(warn("EMPTY_EXPLICIT_BASIS", "论证对象为空，不能视为需求已获得依据。"));
      }
    }
    for (const pin of bindings.sources) {
      if (!pin.snapshotIntegrity) warnings.push(warn("SOURCE_INTEGRITY_UNAVAILABLE", "来源快照校验不完整，不能假称证据可靠。"));
      if (pin.truncated) warnings.push(pin.extraction ? warn("SOURCE_TRUNCATED", "来源提取正文被截断，引用不代表覆盖完整内容。") : warn("SOURCE_TRUNCATION_UNCERTAIN", "旧快照的截断标记未区分 HTML 转换与正文上限截断，完整性需核对。"));
      if (pin.reusedAt) warnings.push(warn("REUSED_SOURCE_SNAPSHOT", "来源是保存的历史快照，未在本次重新读取。"));
      warnings.push(pin.origin ? warn("LOCAL_IMPORT_NOT_ONLINE_VERIFICATION", "来源为明确导入的本地提交或提交者文本，没有在线核验最新状态；导入时间不是发布日期。") : warn("PUBLISHED_DATE_UNKNOWN", "来源抓取时间不是发布日期，现状或价格仍需重新核实。"));
    }
    return { key: requirementKey(run.id, index), index, modelId: requirement.id, title: requirement.title, description: requirement.description, sourceIds: requirement.sourceIds || [], acceptance: requirement.acceptance || [], basis, basisState: !basis ? "legacy" : warnings.some(w => w.code.startsWith("INVALID_")) ? "invalid" : "explicit", bindings, warnings };
  });
  const actions = (run.result?.actions || []).map((action, index) => {
    const indices = action.requirementIndices || []; const valid = indexArray(indices, all.length);
    return { ...action, index, requirementIndices: indices, requirementKeys: valid ? indices.map(i => requirementKey(run.id, i)) : [], warnings: valid ? indices.length ? [] : [warn("ACTION_UNLINKED", "此行动尚未显式关联需求。")]: [warn("INVALID_REQUIREMENT_REFERENCE", "行动引用的需求索引无效。") ] };
  });
  return { runId: run.id, projectId: run.projectId, requirements, actions, warnings: [] };
}

function excerpt(text, max = 1200) {
  let end = Math.min(text.length, max);
  if (end > 0 && /[\ud800-\udbff]/.test(text[end - 1]) && /[\udc00-\udfff]/.test(text[end] || "")) end--;
  return { text: text.slice(0, end), start: 0, end, fullChars: text.length, truncatedForPrompt: end < text.length, unit: "utf16-code-units" };
}
function modelRequirement(requirement) {
  // Keep complete audit/source pins in the frozen archive. The model receives
  // each source pin once in modelInput.sources, referenced by sourceId from
  // literal quotes; repeating the same metadata does not add evidence.
  const citation = ({ sourcePin, ...quote }) => quote;
  return { ...requirement, warnings: [...new Map(requirement.warnings.map(w => [JSON.stringify(w), w])).values()], bindings: {
    ...requirement.bindings,
    projectFields: requirement.bindings.projectFields.map(f => ({ field: f.field, textSha256: f.textSha256, excerpt: excerpt(f.text) })),
    sources: requirement.bindings.sources.map(s => ({ id: s.id, snapshotIntegrity: s.snapshotIntegrity })),
    claims: requirement.bindings.claims.map(c => ({ ...c, quoteChecks: c.quoteChecks.map(citation), citations: c.citations.map(citation) })),
  } };
}
export function buildPrototypeBrief({ parent, currentProject, audit, body, previousPrototype = null, maxChars = Number(process.env.YIBAN_PROTOTYPE_BRIEF_MAX_CHARS || 29000) }) {
  const input = prototypeRequestSchema.parse(body || {});
  if (parent.status !== "completed" || !["research", "recall"].includes(parent.kind) || !parent.result?.requirements?.length) throw fail("请先完成本项目的研究需求，再生成原型。");
  if (parent.projectId !== currentProject.id) throw fail("原型需求不属于当前项目。", 404);
  const indices = input.requirementIndices || parent.result.requirements.map((_, i) => i);
  const prototypeMode = input.prototypeMode || (input.requirementIndices ? "new" : previousPrototype ? "revise" : "new");
  if (prototypeMode === "revise" && (!previousPrototype?.prototype?.code || previousPrototype.projectId !== parent.projectId)) throw fail("本项目没有可明确绑定的旧原型，请选择新探索原型。");
  const revisionTarget = prototypeMode === "revise" ? { runId: previousPrototype.id, projectId: previousPrototype.prototype.projectId, versionId: previousPrototype.prototype.versionId, version: previousPrototype.prototype.version, title: previousPrototype.prototype.title, htmlSha256: hash(previousPrototype.prototype.code), htmlChars: previousPrototype.prototype.code.length } : null;
  if (!indexArray(indices, parent.result.requirements.length)) throw fail("需求选择包含重复、越界或无效索引。");
  const graph = projectRequirementBasis(parent, audit); const requirements = structuredClone(indices.map(i => graph.requirements[i]));
  const currentProjectSnapshot = snapshot(currentProject); const researchProjectSnapshot = snapshot(parent.raw?.project);
  const memoryIds = new Set([...currentProjectSnapshot.memory, ...researchProjectSnapshot.memory].map(m => m.id));
  const contextDiff = { changedProjectFields: ["name", ...fields].filter(f => currentProjectSnapshot[f] !== researchProjectSnapshot[f]), changedMemoryIds: [...memoryIds].filter(id => JSON.stringify(currentProjectSnapshot.memory.find(m => m.id === id) || null) !== JSON.stringify(researchProjectSnapshot.memory.find(m => m.id === id) || null)) };
  const warnings = requirements.flatMap(r => r.warnings);
  if (contextDiff.changedProjectFields.length || contextDiff.changedMemoryIds.length) warnings.push(warn("PROJECT_CONTEXT_CHANGED", "当前项目背景或记忆已变化；研究时依据与当前事实必须分开。"));
  if (revisionTarget) warnings.push(warn("REVISION_RETAINS_PRIOR_FEATURES", "此次将修改明确绑定的旧原型，旧功能可能保留；不等同于只制作选定需求的新原型。"));
  const referenced = new Set(requirements.flatMap(r => [...r.sourceIds, ...r.bindings.claims.flatMap(c => parent.result.claims?.[c.index]?.sourceIds || [])]));
  const sourceSnapshots = structuredClone((parent.sources || []).filter(s => referenced.has(s.id)));
  const currentMemory = currentProjectSnapshot.memory;
  if (currentProjectSnapshot.background.length > 1200) warnings.push(warn("CURRENT_CONTEXT_EXCERPTED", "当前背景只传入明确标记的摘录；完整背景仅归档，不能声称模型已读全部背景。"));
  const modelInput = {
    purpose: "exploration", prototypeMode, revisionTarget, instruction: "需求是候选方案。unknown、未审阅和矛盾内容是待验证假设；支持标注不是事实担保。当前项目上下文优先，研究时背景仅作历史依据。", researchRunId: parent.id,
    currentProject: { id: currentProjectSnapshot.id, name: currentProjectSnapshot.name, backgroundExcerpt: excerpt(currentProjectSnapshot.background), goal: currentProjectSnapshot.goal, constraints: currentProjectSnapshot.constraints, memory: currentMemory, omittedMemoryCount: currentProjectSnapshot.memory.length - currentMemory.length, memoryRevision: currentProjectSnapshot.memoryRevision },
    contextDiff, selectedIndices: indices, requirements: requirements.map(modelRequirement), sourcePinsPlacement: "Each sourceId resolves to the single complete pin in sources; quotation text and locator are retained in requirement bindings.",
    sources: sourceSnapshots.map(s => ({ ...sourcePin(s), capturedExcerpt: excerpt(s.text || "", 1200), note: "完整提取正文保存在档案；模型这里只看到明确标记的摘录和需求绑定引文，不能声称通读全部来源。" })), warnings: [...new Map(warnings.map(w => [JSON.stringify(w), w])).values()],
  };
  const prompt = "根据以下已保存的研究需求制作一个可交互的中文前端原型。必须标明示例数据，保留所选需求索引、来源ID和研究任务关联。不得伪造真实AI或后端。保留待验证假设及资料限制，不宣称审阅等于事实。\n" + JSON.stringify(modelInput) + "\n追加要求：" + input.prompt;
  if (!Number.isInteger(maxChars) || maxChars < 1000) throw fail("原型输入预算配置无效。", 500);
  if (prompt.length > maxChars) throw fail("原型输入超过字符预算，请减少需求或压缩背景后重试。", 413, { code: "PROTOTYPE_CONTEXT_TOO_LARGE", actualChars: prompt.length, maxChars, selectedIndices: indices, unit: "utf16-code-units" });
  const briefFingerprint = hash(JSON.stringify({ researchRunId: parent.id, selectedIndices: indices, prototypeMode, revisionTarget, currentProjectSnapshot, researchProjectSnapshot, requirements, sourcePins: sourceSnapshots.map(sourcePin), modelInput, additionalPrompt: input.prompt }));
  if (input.expectedBriefFingerprint && input.expectedBriefFingerprint !== briefFingerprint) throw fail("原型依据或选择已变化，请重新预览并确认当前范围。", 409, { code: "PROTOTYPE_BRIEF_CHANGED" });
  const inputCoverage = { background: { providedChars: modelInput.currentProject.backgroundExcerpt.text.length, fullChars: currentProjectSnapshot.background.length, truncatedForPrompt: modelInput.currentProject.backgroundExcerpt.truncatedForPrompt }, sources: modelInput.sources.map(s => ({ id: s.id, providedChars: s.capturedExcerpt.text.length, fullChars: s.capturedExcerpt.fullChars, truncatedForPrompt: s.capturedExcerpt.truncatedForPrompt })), memory: { providedIds: currentMemory.map(m => m.id), omittedCount: 0 } };
  return { schemaVersion: 1, createdAt: new Date().toISOString(), researchRunId: parent.id, projectId: parent.projectId, selectedIndices: indices, prototypeMode, revisionTarget, previousPrototypeSnapshot: revisionTarget ? structuredClone(previousPrototype.prototype) : null, requirements, currentProjectSnapshot, researchProjectSnapshot, contextDiff, warnings, sourceSnapshots, claimAuditSnapshot: requirements.flatMap(r => r.bindings.claims), purpose: "exploration", modelInput, inputCoverage, prompt, modelInputSha256: hash(prompt), modelInputChars: prompt.length, maxChars, unit: "utf16-code-units", briefFingerprint };
}
export function briefPreview(brief) {
  const { sourceSnapshots, modelInput, prompt, claimAuditSnapshot, previousPrototypeSnapshot, createdAt, ...preview } = brief;
  return preview;
}
