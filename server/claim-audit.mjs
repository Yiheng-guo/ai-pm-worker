import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { isUsableEvidence } from "./evidence.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const reviewStatuses = ["unreviewed", "supported", "contradicted", "needs-verification"];
export const claimReviewSchema = z.object({
  projectId: z.string().min(1).max(100),
  expectedRevision: z.number().int().nonnegative(),
  expectedClaimFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  confirm: z.literal(true),
  status: z.enum(reviewStatuses),
  note: z.string().trim().max(4000).default(""),
  reviewerLabel: z.string().trim().min(1).max(100).default("本机工作空间用户"),
  reviewerType: z.enum(["user", "agent-assisted", "implementation-fixture"]).default("user"),
  citations: z.array(z.object({
    sourceId: z.string().min(1).max(100), quote: z.string().min(1).max(4000).refine(q => q.trim().length > 0), start: z.number().int().nonnegative().optional(),
  }).strict()).max(8).default([]),
}).strict().superRefine((input, context) => {
  if (input.status !== "unreviewed" && !input.note) context.addIssue({ code: "custom", path: ["note"], message: "请说明审阅判断的依据。" });
  if (["supported", "contradicted"].includes(input.status) && !input.citations.length) context.addIssue({ code: "custom", path: ["citations"], message: "支持或矛盾必须附原始快照中的引文。" });
});

export const reviewableRun = run => run.status === "completed" && ["research", "recall"].includes(run.kind);
export const claimKey = (runId, index) => hash(JSON.stringify([runId, index])).slice(0, 32);
const recordId = (runId, key) => "claim-review-" + hash(JSON.stringify([runId, key]));

function sourceFootprint(source) {
  if (!source) return null;
  return { id: source.id, url: source.url || null, sha256: source.sha256 || null, rawSha256: typeof source.raw === "string" ? hash(source.raw) : null, textSha256: typeof source.text === "string" ? hash(source.text) : null, fetchedAt: source.fetchedAt || null, status: source.status || null, truncated: !!source.truncated, reusedFrom: source.reusedFrom || null, reusedAt: source.reusedAt || null, ...(source.extraction ? { extraction: source.extraction } : {}), ...(source.origin ? { origin: source.origin, capturedAt: source.capturedAt || null } : {}) };
}
export function claimFingerprint(run, claim) {
  const ids = [...new Set(claim.sourceIds || [])].sort();
  const sources = ids.map(id => ({ id, matches: (run.sources || []).filter(s => s.id === id).map(sourceFootprint) }));
  return hash(JSON.stringify({ text: claim.text || "", kind: claim.kind || "", sourceIds: ids, citations: claim.citations || [], sources }));
}

export function utf16Boundary(text, position) {
  if (!Number.isInteger(position) || position < 0 || position > text.length) return false;
  const previous = text.charCodeAt(position - 1); const next = text.charCodeAt(position);
  return !(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff);
}
function wellFormed(text) {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) { const next = text.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

// Matching validates the literal captured excerpt only. It cannot infer entailment.
export function validateQuote(run, claim, citation) {
  const { sourceId, quote, start } = citation || {};
  // Pydantic model_dump emits an omitted optional offset as null. Generated
  // citations treat that as unspecified; manual requests still use strict Zod.
  const specifiedStart = start === null ? undefined : start;
  if (typeof sourceId !== "string" || !(claim.sourceIds || []).includes(sourceId)) throw fail("引文来源未关联当前结论，不能使用其他结论或其他项目的资料。" );
  const matches = (run.sources || []).filter(s => s.id === sourceId);
  if (matches.length !== 1) throw fail("当前任务的引文来源不存在或 ID 重复，无法安全定位。");
  const source = matches[0];
  if (!isUsableEvidence(source)) throw fail("来源原始快照或 SHA256 校验不可用，不能保存可追溯引文。");
  if (typeof source.text !== "string" || typeof quote !== "string" || !quote.trim().length || quote.length > 4000 || !wellFormed(quote)) throw fail("引文必须是有效文本，并且位于已保存的提取正文内。");
  const positions = [];
  for (let at = source.text.indexOf(quote); at >= 0; at = source.text.indexOf(quote, at + 1)) {
    if (utf16Boundary(source.text, at) && utf16Boundary(source.text, at + quote.length)) positions.push(at);
  }
  if (!positions.length) throw fail("引文不在已保存的提取正文中；截断之外的原文或改写内容不能当作精确引文。");
  if (specifiedStart !== undefined && (!utf16Boundary(source.text, specifiedStart) || !positions.includes(specifiedStart))) throw fail("引文定位与已保存正文不一致，或切开了 Unicode 字符。");
  const selected = specifiedStart === undefined ? positions[0] : specifiedStart;
  return {
    sourceId, quote, matched: true, validation: "literal-only",
    locator: { unit: "utf16-code-unit", start: selected, end: selected + quote.length, occurrenceCount: positions.length, occurrenceIndex: positions.indexOf(selected) + 1 },
    sourcePin: { url: source.url, retrievalUrl: source.retrievalUrl || source.url, sha256: source.sha256, textSha256: hash(source.text), fetchedAt: source.fetchedAt || null, publishedAt: null, publishedDateKnown: false, truncated: !!source.truncated, ...(source.extraction ? { extraction: source.extraction } : {}), ...(source.origin ? { origin: source.origin, capturedAt: source.capturedAt || null } : {}), reusedFrom: source.reusedFrom || null, reusedAt: source.reusedAt || null, ageAtReuseSeconds: source.ageAtReuseSeconds ?? null },
  };
}
function quoteChecks(run, claim) {
  return (Array.isArray(claim.citations) ? claim.citations : []).slice(0, 8).map(citation => {
    try { return validateQuote(run, claim, citation); }
    catch (error) { return { sourceId: citation?.sourceId ?? null, quote: citation?.quote ?? null, matched: false, validation: "literal-only", error: error.message }; }
  });
}

function viewClaim(run, claim, index, record) {
  const key = claimKey(run.id, index); const fingerprint = claimFingerprint(run, claim);
  const validRecord = record && record.runId === run.id && record.projectId === run.projectId && record.claimKey === key;
  const history = validRecord && Array.isArray(record.history) ? record.history : [];
  const latest = history.at(-1);
  const invalidated = !!latest && latest.claimFingerprint !== fingerprint;
  return {
    key, index, text: claim.text, kind: claim.kind, sourceIds: claim.sourceIds || [], claimFingerprint: fingerprint, quoteChecks: quoteChecks(run, claim),
    review: {
      revision: validRecord ? record.revision : 0, status: invalidated ? "unreviewed" : latest?.status || "unreviewed", state: invalidated ? "invalidated" : "current",
      note: invalidated ? "" : latest?.note || "", reviewerLabel: invalidated ? null : latest?.reviewerLabel || null, reviewerType: invalidated ? null : latest?.reviewerType || null,
      citations: invalidated ? [] : latest?.citations || [], history,
      ...(invalidated ? { previousStatus: latest.status, previousFingerprint: latest.claimFingerprint, invalidatedReason: "结论内容、模型引文或来源快照已变化，请重新确认当前版本。" } : {}),
      semanticValidation: "manual-not-independent",
    },
  };
}
export function projectClaimAudit(run, records = []) {
  const reviewable = reviewableRun(run);
  const indexed = new Map(records.filter(r => r.runId === run.id && r.projectId === run.projectId).map(r => [r.claimKey, r]));
  const claims = reviewable ? (run.result?.claims || []).map((claim, index) => viewClaim(run, claim, index, indexed.get(claimKey(run.id, index)))) : [];
  const summary = { total: claims.length, reviewed: 0, unreviewed: 0, supported: 0, contradicted: 0, needsVerification: 0, invalidated: 0, semanticQuality: "unknown" };
  for (const claim of claims) {
    summary[claim.review.status === "needs-verification" ? "needsVerification" : claim.review.status] += 1;
    if (claim.review.status !== "unreviewed") summary.reviewed += 1;
    if (claim.review.state === "invalidated") summary.invalidated += 1;
  }
  return { runId: run.id, projectId: run.projectId, reviewable, claims, summary, note: "引文匹配只验证文字存在。审阅状态是工作空间中的判断，不代表客观正确率或独立评测结论。" };
}

export function createClaimAudit({ store, getRun, isSaving = () => false }) {
  const writes = new Map();
  async function forRun(run) {
    const records = await Promise.all((run.result?.claims || []).map((_, index) => store.get(recordId(run.id, claimKey(run.id, index)), "claim-review")));
    return projectClaimAudit(run, records.filter(Boolean));
  }
  async function review(runId, key, body) {
    const input = claimReviewSchema.parse(body);
    const id = recordId(runId, key);
    const write = (writes.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
      const run = await getRun(runId);
      if (input.projectId !== run.projectId) throw fail("结论不属于当前项目。", 404);
      if (!reviewableRun(run) || isSaving(runId)) throw fail("只能审阅已完成并保存的研究或回忆结论。", 409);
      const index = (run.result?.claims || []).findIndex((_, i) => claimKey(run.id, i) === key);
      if (index < 0) throw fail("当前任务的结论不存在。", 404);
      const claim = run.result.claims[index]; const fingerprint = claimFingerprint(run, claim);
      if (input.expectedClaimFingerprint !== fingerprint) throw fail("结论或来源快照已变化，请刷新并核对当前内容后再审阅。", 409);
      const previous = await store.get(id, "claim-review");
      if (previous && (previous.runId !== runId || previous.projectId !== run.projectId || previous.claimKey !== key)) throw fail("审阅记录归属不一致。", 409);
      const revision = previous?.revision || 0;
      if (input.expectedRevision !== revision) throw fail("这条结论已有新的审阅，请刷新并核对后再确认。", 409);
      const citations = input.citations.map(citation => validateQuote(run, claim, citation));
      const createdAt = new Date().toISOString();
      const entry = { id: randomUUID(), revision: revision + 1, claimFingerprint: fingerprint, status: input.status, note: input.note, reviewerLabel: input.reviewerLabel, reviewerType: input.reviewerType, citations, createdAt, reviewType: input.reviewerType === "user" ? "manual" : input.reviewerType, judgmentScope: "local-workspace-user", semanticValidation: "manual-not-independent" };
      const saved = { id, runId, projectId: run.projectId, claimKey: key, claimIndex: index, revision: revision + 1, createdAt: previous?.createdAt || createdAt, updatedAt: createdAt, history: [...(previous?.history || []), entry] };
      await store.put("claim-review", saved);
      return viewClaim(run, claim, index, saved);
    });
    writes.set(id, write);
    try { return await write; } finally { if (writes.get(id) === write) writes.delete(id); }
  }
  return { forRun, review };
}
