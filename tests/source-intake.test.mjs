import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import express from "express";
import { captureSource, createSourceIntake, resolveImportedSource } from "../server/source-intake.mjs";
import { isUsableEvidence } from "../server/evidence.mjs";
import { validateQuote, claimFingerprint } from "../server/claim-audit.mjs";

const exec = promisify(execFile);
const text = "固定提交中用于验证项目来源导入的文档。".repeat(12);
async function fixture(t) {
  const repo = await mkdtemp(join(tmpdir(), "yiban-source-git-"));
  const git = args => exec("git", ["-C", repo, ...args]);
  await git(["init", "-q"]);
  await git(["config", "user.name", "Isolated Test"]); await git(["config", "user.email", "fixture@example.invalid"]);
  await writeFile(join(repo, "README.md"), text);
  await mkdir(join(repo, "docs")); await writeFile(join(repo, "docs/private.env.md"), text);
  await symlink("README.md", join(repo, "docs/link.md"));
  await git(["add", "."]); await git(["commit", "-qm", "isolated initial"]);
  t.after(() => rm(repo, { recursive: true, force: true }));
  return { repo, git, options: { root: repo, repositories: { yiban: repo, foundry: repo, nanobot: repo } } };
}
test("Git导入读取固定blob而非脏工作树，指纹稳定且不伪装在线抓取", async t => {
  const f = await fixture(t);
  const input = { kind: "git-commit", repoId: "yiban", relativePath: "README.md" };
  const first = await captureSource(input, f.options);
  await writeFile(join(f.repo, "README.md"), "未提交的资料，不应偷换已选择的提交快照。".repeat(12));
  const second = await captureSource(input, f.options);
  assert.equal(second.raw, text); assert.equal(second.status, "imported"); assert.equal(second.fetchedAt, null);
  assert.equal(second.origin.workingTreeHasChangesAtCapture, null); assert.equal(second.origin.workingTreeInspection, "not-performed"); assert.equal(second.origin.ignoresWorkingTreeEdits, true);
  assert.equal(second.importFingerprint, first.importFingerprint); assert.equal(second.origin.commit, first.origin.commit);
  assert.equal(isUsableEvidence(second), true);
  const run = { id: "r", sources: [second] }, claim = { text: "提交文档的声明", kind: "fact", sourceIds: [second.id] };
  const quote = validateQuote(run, claim, { sourceId: second.id, quote: "固定提交中用于验证项目来源导入的文档。" });
  assert.equal(quote.sourcePin.origin.kind, "git-commit"); assert.equal(quote.sourcePin.fetchedAt, null);
  const fingerprint = claimFingerprint(run, claim); second.origin.commit = "b".repeat(40);
  assert.notEqual(claimFingerprint(run, claim), fingerprint);
});
test("拒绝任意路径、pathspec、链接、密钥名称、未提交文件和云端本机读取", async t => {
  const f = await fixture(t);
  for (const relativePath of ["../README.md", "/etc/passwd", ":(glob)*", ".git/config", "docs/link.md", "docs/private.env.md", "docs/not-tracked.md"]) {
    await assert.rejects(captureSource({ kind: "git-commit", repoId: "yiban", relativePath }, f.options));
  }
  await assert.rejects(captureSource({ kind: "git-commit", repoId: "yiban", relativePath: "README.md" }, { ...f.options, cloud: true }), e => e.status === 403);
});
test("纯文本导入明确陈述来源，拒绝字节超限、无效Unicode和二进制文本", async () => {
  const s = await captureSource({ kind: "text-import", text, sourceLabel: "隔离提交者资料" });
  assert.equal(s.origin.independentlyVerified, false); assert.equal(s.origin.kind, "text-import"); assert.equal(s.fetchedAt, null);
  assert.equal(isUsableEvidence({ ...s, text: s.text + "篡改" }), false);
  for (const invalid of ["\uD800".repeat(100), "\0".repeat(100), "中".repeat(500001)]) {
    await assert.rejects(captureSource({ kind: "text-import", text: invalid, sourceLabel: "夹具" }));
  }
  for (const field of ["title", "sourceLabel"]) await assert.rejects(captureSource({ kind: "text-import", text, sourceLabel: "夹具", [field]: "\uD800" }));
});
test("导入预览不保存；确认固定指纹、项目隔离、提交变更409且未调用模型", async t => {
  const f = await fixture(t); const records = new Map();
  const store = { put: async (type, s) => { records.set(s.id, structuredClone(s)); }, list: async () => [...records.values()].map(s => structuredClone(s)), get: async id => records.get(id) || null };
  const app = express(); app.use(express.json());
  app.use(createSourceIntake({ store, ...f.options, getProject: async id => { if (!["p", "q"].includes(id)) throw Object.assign(new Error("不存在"), { status: 404 }); } }));
  app.use((e, _req, res, _next) => res.status(e.status || 400).json({ error: e.message, code: e.code }));
  const server = app.listen(0, "127.0.0.1"); await new Promise(r => server.once("listening", r));
  t.after(() => new Promise(r => server.close(r)));
  const api = async (path, body) => { const r = await fetch(`http://127.0.0.1:${server.address().port}` + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, data: await r.json() }; };
  const input = { kind: "git-commit", repoId: "yiban", relativePath: "README.md" };
  const preview = (await api("/projects/p/sources/preview", input)).data;
  assert.equal(preview.modelInvoked, false); assert.equal(preview.persisted, false); assert.equal(records.size, 0);
  const confirmation = { ...input, confirm: true, expectedImportFingerprint: preview.expectedImportFingerprint, importerType: "implementation-fixture", importerLabel: "隔离夹具" };
  const saved = await api("/projects/p/sources", confirmation); assert.equal(saved.status, 201);
  assert.equal((await api("/projects/p/sources")).data.sources[0].raw, undefined);
  assert.equal((await api(`/projects/q/sources/${saved.data.id}`)).status, 404);
  assert.equal(await resolveImportedSource(store, "q", saved.data.id), null);
  assert.equal((await resolveImportedSource(store, "p", saved.data.id)).raw, text);
  await writeFile(join(f.repo, "README.md"), text + "新提交"); await f.git(["add", "README.md"]); await f.git(["commit", "-qm", "new commit"]);
  assert.equal((await api("/projects/p/sources", confirmation)).status, 409); assert.equal(records.size, 1);
  assert.equal((await api("/projects/p/sources", { ...input, expectedImportFingerprint: preview.expectedImportFingerprint })).status, 400);
});
test("远端中凭据不进入元数据；固定GitHub提交引用不会变成在线读取记录", async t => {
  const f = await fixture(t);
  const input = { kind: "git-commit", repoId: "yiban", relativePath: "README.md" };
  await f.git(["remote", "add", "origin", "https://example-secret:fixture-password@github.com/owner/repo.git"]);
  const privateSource = await captureSource(input, f.options);
  assert.equal(privateSource.origin.publicReference, null); assert.equal(JSON.stringify(privateSource).includes("fixture-password"), false);
  await f.git(["remote", "set-url", "origin", "https://github.com/owner/repo.git"]);
  const publicSource = await captureSource(input, f.options);
  assert.match(publicSource.origin.publicReference, /github.com\/owner\/repo\/blob\/[a-f0-9]{40}\/README.md/);
  assert.equal(publicSource.status, "imported"); assert.equal(publicSource.retrievalUrl, undefined);
});
