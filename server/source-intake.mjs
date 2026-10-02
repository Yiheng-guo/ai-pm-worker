import express from "express";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { TextDecoder } from "node:util";
import { extractEvidenceText, isUsableEvidence } from "./evidence.mjs";

const exec = promisify(execFile);
const hash = value => createHash("sha256").update(value).digest("hex");
const fail = (message, status = 400, code = "SOURCE_IMPORT_INVALID") => Object.assign(new Error(message), { status, code });
const MAX_BYTES = 1500000;
const pathSchema = z.string().min(1).max(300).refine(path => !path.startsWith("/") && !/[\\\x00-\x1f\x7f]/.test(path) && path.split("/").every(p => p && p !== "." && p !== "..") && !path.includes(":"), "只接受文档相对路径。");
const validLabel = value => value.isWellFormed() && !value.includes("\0");
const base = { title: z.string().trim().max(200).refine(validLabel).optional() };
export const sourceImportSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("git-commit"), repoId: z.enum(["yiban", "foundry", "nanobot"]), relativePath: pathSchema }).strict(),
  z.object({ ...base, kind: z.literal("text-import"), text: z.string().min(80).max(MAX_BYTES), sourceLabel: z.string().trim().min(1).max(200).refine(validLabel) }).strict(),
]);

// The allowlist points at committed documentation, never arbitrary local paths.
export function sourceRepositories(root) {
  return { yiban: resolve(root), foundry: resolve(root, "../product-foundry"), nanobot: join(resolve(root), ".runtime/nanobot") };
}
function documentPath(path) {
  return /^(README(?:\.[a-zA-Z-]+)?\.(?:md|txt)|PRD\.(?:md|txt)|(?:docs|runtime)\/(?:[^/]+\/)*[^/]+\.(?:md|txt))$/i.test(path) && !/(^|[\/._-])(secrets?|credentials?|tokens?|keys?|passwords?|env)([\/._-]|$)/i.test(path);
}
async function git(repo, args, maxBuffer = 10000) {
  const gitEnvironment = { ...process.env };
  for (const key of Object.keys(gitEnvironment)) if (key.startsWith("GIT_")) delete gitEnvironment[key];
  Object.assign(gitEnvironment, { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" });
  try { return (await exec("git", ["--literal-pathspecs", "--no-replace-objects", "-c", "core.fsmonitor=false", "-C", repo, ...args], { timeout: 10000, maxBuffer, encoding: "buffer", env: gitEnvironment })).stdout; }
  catch { throw fail("指定仓库或已提交文档不可读取；没有读取其他本机文件。", 400, "SOURCE_REPOSITORY_UNAVAILABLE"); }
}
function publicReference(remote, commit, path) {
  // Credential-bearing remote strings are never persisted or returned.
  const match = remote.trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/);
  return match ? `https://github.com/${match[1]}/${match[2]}/blob/${commit}/${path.split("/").map(encodeURIComponent).join("/")}` : null;
}
export async function captureSource(input, { root, repositories, cloud = false } = {}) {
  input = sourceImportSchema.parse(input);
  let raw, origin, title = input.title;
  const capturedAt = new Date().toISOString();
  if (input.kind === "text-import") {
    raw = input.text;
    origin = { kind: "text-import", sourceLabel: input.sourceLabel, independentlyVerified: false, note: "提交者提供的文本；没有在线核验作者、出处或发布日期。" };
    title ||= input.sourceLabel;
  } else {
    if (cloud) throw fail("云端不允许读取本机仓库；请使用本机工作台或明确粘贴文本。", 403, "LOCAL_SOURCE_UNAVAILABLE");
    if (!documentPath(input.relativePath)) throw fail("只接受 README、PRD、docs/ 或 runtime/ 中已提交的 Markdown/文本说明，不读取配置、密钥、数据目录或任意路径。");
    const repo = (repositories || sourceRepositories(root))[input.repoId];
    if (!repo) throw fail("未知仓库。", 400);
    const commit = (await git(repo, ["rev-parse", "--verify", "HEAD^{commit}"])).toString().trim();
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw fail("仓库提交标识无效。");
    const entries = (await git(repo, ["ls-tree", "-z", commit, "--", input.relativePath])).toString().split("\0").filter(Boolean);
    const entry = entries.find(value => value.slice(value.indexOf("\t") + 1) === input.relativePath);
    const match = entry?.match(/^(100644|100755) blob ([a-f0-9]{40,64})\t/);
    if (!match) throw fail("仅允许此提交中的普通文档文件；未提交文件、符号链接、目录和子模块不可导入。");
    const blobOid = match[2];
    const size = Number((await git(repo, ["cat-file", "-s", blobOid])).toString().trim());
    if (!Number.isSafeInteger(size) || size < 80 || size > MAX_BYTES) throw fail("文档必须在 80 字节至 1.5 MB 之间；超限时没有读取正文。", 413, "SOURCE_IMPORT_SIZE");
    const bytes = await git(repo, ["cat-file", "blob", blobOid], MAX_BYTES + 1000);
    if (bytes.length !== size) throw fail("文档读取长度不一致。");
    try { raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw fail("文档不是有效 UTF8 文本。"); }
    let remote = "";
    try { remote = (await git(repo, ["config", "--get", "remote.origin.url"])).toString(); } catch {}
    origin = { kind: "git-commit", repoId: input.repoId, relativePath: input.relativePath, commit, blobOid, contentFrom: "git-object", committedContent: true, workingTreeHasChangesAtCapture: null, workingTreeInspection: "not-performed", ignoresWorkingTreeEdits: true, publicReference: publicReference(remote, commit, input.relativePath), publicReferenceVerified: false, note: "只读取这个固定提交的 Git 文档对象，不读取未提交修改，也未检查工作树是否有修改；导入不是在线 GitHub 抓取或最新状态核验。GitHub 参考地址按仓库远端构造，未确认此本机提交已推送或该地址可访问。" };
    title ||= `${input.repoId} · ${input.relativePath}`;
  }
  if (!raw.isWellFormed() || raw.includes("\0")) throw fail("仅接受不含 NUL 的有效 Unicode 文本。");
  const rawBytes = Buffer.byteLength(raw, "utf8");
  if (rawBytes > MAX_BYTES) throw fail("正文超过 1.5 MB UTF8 字节限制。", 413, "SOURCE_IMPORT_SIZE");
  const sha256 = hash(raw);
  const extracted = extractEvidenceText(raw, "text/plain");
  if (extracted.text.length < 80) throw fail("正文不足 80 个 UTF16 单位。");
  const fingerprint = hash(JSON.stringify({ title, sha256, textSha256: hash(extracted.text), kind: origin.kind, repoId: origin.repoId || null, relativePath: origin.relativePath || null, commit: origin.commit || null, blobOid: origin.blobOid || null, sourceLabel: origin.sourceLabel || null, publicReference: origin.publicReference || null, extraction: extracted.extraction }));
  return { id: randomUUID(), title, url: origin.publicReference || `local-evidence://${origin.kind}/${sha256}`, raw, text: extracted.text, sha256, textSha256: hash(extracted.text), rawBytes, status: "imported", fetchedAt: null, capturedAt, origin, extraction: extracted.extraction, truncated: extracted.truncated, importFingerprint: fingerprint };
}
export function compactImportedSource(source) {
  const { raw, text, ...summary } = source;
  return { ...summary, preview: (text || "").slice(0, 180), detailAvailable: true };
}
export function createSourceIntake({ store, root, cloud, getProject, repositories }) {
  const router = express.Router();
  const options = { root, cloud, ...(repositories ? { repositories } : {}) };
  router.get("/projects/:id/sources", async (req, res) => {
    await getProject(req.params.id);
    const sources = (await store.list("project-source")).filter(s => s.projectId === req.params.id);
    res.json({ projectId: req.params.id, sources: sources.map(compactImportedSource), repositoryOptions: cloud ? [] : [{ id: "yiban", label: "亦伴已提交文档" }, { id: "foundry", label: "造物已提交文档" }, { id: "nanobot", label: "本机 nanobot 已提交文档" }] });
  });
  router.get("/projects/:id/sources/:sourceId", async (req, res) => {
    await getProject(req.params.id);
    const source = await store.get(req.params.sourceId, "project-source");
    if (!source || source.projectId !== req.params.id) throw fail("项目来源不存在。", 404);
    res.json(source);
  });
  router.post("/projects/:id/sources/preview", async (req, res) => {
    await getProject(req.params.id);
    const source = await captureSource(req.body, options);
    res.json({ source, expectedImportFingerprint: source.importFingerprint, modelInvoked: false, persisted: false });
  });
  router.post("/projects/:id/sources", async (req, res) => {
    await getProject(req.params.id);
    const { confirm, expectedImportFingerprint, importerType = "user", importerLabel = "本机工作空间用户", ...body } = req.body || {};
    const confirmation = z.object({ confirm: z.literal(true), expectedImportFingerprint: z.string().regex(/^[a-f0-9]{64}$/), importerType: z.enum(["user", "agent-assisted", "implementation-fixture"]), importerLabel: z.string().trim().min(1).max(100).refine(validLabel) }).parse({ confirm, expectedImportFingerprint, importerType, importerLabel });
    const source = await captureSource(body, options);
    if (source.importFingerprint !== confirmation.expectedImportFingerprint) throw fail("文档内容、固定提交或导入设置已经变化，请重新预览再确认。", 409, "SOURCE_IMPORT_CHANGED");
    const item = { ...source, projectId: req.params.id, importedAt: new Date().toISOString(), createdAt: new Date().toISOString(), importedBy: { type: confirmation.importerType, label: confirmation.importerLabel } };
    await store.put("project-source", item);
    res.status(201).json(item);
  });
  return router;
}
export async function resolveImportedSource(store, projectId, id) {
  const source = await store.get(id, "project-source");
  return source?.projectId === projectId && isUsableEvidence(source) ? structuredClone(source) : null;
}
