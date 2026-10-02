import express from "express";
import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import JSZip from "jszip";
import { getRuntimeStatus, runNanobot } from "./nanobot-runtime.mjs";
import { discoverSources, fetchEvidence } from "./evidence.mjs";
import { prepareMemoryProject, requireMemoryRevision, replaceMemory, changeMemory, addMemory, restoreMemory, runtimeProject } from "./project-memory.mjs";
import { createClaimAudit, projectClaimAudit } from "./claim-audit.mjs";
import { buildPrototypeBrief, briefPreview, projectRequirementBasis, prototypeRequestSchema } from "./requirement-basis.mjs";

const now = () => new Date().toISOString();
const memorySchema = z.object({ id: z.string().min(1), text: z.string().min(1).max(2000), source: z.string().max(300).default("用户确认"), updatedAt: z.string().default(now) });
const projectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  background: z.string().trim().min(10).max(20000),
  goal: z.string().max(5000).default(""),
  constraints: z.string().max(5000).default(""),
  memory: z.array(memorySchema).max(30).default([]),
});
const revisionSchema = z.object({ expectedRevision: z.number().int().nonnegative(), confirm: z.literal(true), reason: z.string().max(2000).optional() });
const runSchema = z.object({
  projectId: z.string().min(1).max(100),
  prompt: z.string().trim().min(5).max(12000),
  kind: z.enum(["research", "prototype", "recall"]).default("research"),
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),
  sourceUrls: z.array(z.string().url().max(1500)).max(4).default([]),
  sourceIds: z.array(z.string().min(1).max(100)).max(4).default([]),
  parentRunId: z.string().max(100).optional(),
  requirementIndices: z.array(z.number().int().nonnegative()).min(1).max(30).optional(),
  expectedBriefFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  prototypeMode: z.enum(["new", "revise"]).optional(),
});
const safeId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const emptyUsage = () => ({ inputTokens: null, outputTokens: null, cachedTokens: null, cost: null, currency: null, note: "订阅调用不等于零成本；金额无法从 Token 直接换算。" });
const knownStatus = ["queued", "running"];
const readyStatus = ["completed", "failed", "cancelled"];

export async function createAgentRouter({ store, settings, root, cloud, runner = runNanobot, runtimeStatus = getRuntimeStatus, evidenceFetcher = fetchEvidence, sourceDiscoverer = discoverSources }) {
  const router = express.Router();
  const controllers = new Map();
  const projectLocks = new Set();
  const eventWrites = new Map();
  const actionWrites = new Map();
  const pendingKeys = new Map();
  const projectEdits = new Set();
  const foundryBase = process.env.FOUNDRY_URL || "http://127.0.0.1:4320";
  const foundry = new URL(foundryBase);
  if (!["127.0.0.1", "localhost"].includes(foundry.hostname) || foundry.protocol !== "http:")
    throw new Error("本机版本的造物服务必须绑定本地 HTTP 地址。");
  for (const run of await store.list("agent-run")) {
    if (knownStatus.includes(run.status)) {
      run.status = "failed"; run.error = "服务重启中断了任务，原始记录已保留。请重新提交。"; run.completedAt = now();
      await store.put("agent-run", run);
    }
  }
  if (!(await store.list("research-project")).length && !cloud) {
    const background = await readFile(join(root, "README.md"), "utf8");
    await store.put("research-project", {
      id: "yiban-personal-agent", name: "亦伴 · 个人产品助理",
      background: background.slice(0, 16000),
      goal: "帮助 AI 产品经理围绕已有项目连续完成竞品研究、价值判断、带证据的需求草稿，并用造物验证原型。",
      constraints: "单用户、本机优先；来源可追溯；研究结论需区分事实与推断；原型仅为前端，不能伪装成完整业务系统。",
      memory: [], decisions: [], createdAt: now(), updatedAt: now(),
    });
  }
  async function project(id) {
    const p = await store.get(id, "research-project");
    if (!p) throw Object.assign(new Error("项目不存在。"), { status: 404 });
    return prepareMemoryProject(p);
  }
  async function findRun(id) {
    const run = await store.get(id, "agent-run");
    if (!run) throw Object.assign(new Error("任务不存在。"), { status: 404 });
    return run;
  }
  const claimAudit = createClaimAudit({ store, getRun: findRun, isSaving: id => controllers.has(id) });
  async function preparePrototypeBrief(parent, currentProject, body) {
    const previous = body.prototypeMode === "new" || (body.prototypeMode === undefined && body.requirementIndices) ? null : (await store.list("agent-run")).filter(r => r.projectId === parent.projectId && r.kind === "prototype" && r.status === "completed" && r.prototype?.projectId).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0] || null;
    return buildPrototypeBrief({ parent, currentProject, body, previousPrototype: previous, audit: await claimAudit.forRun(parent) });
  }
  async function event(run, message) {
    run.stage = message;
    run.events.push({ at: now(), message });
    const write = (eventWrites.get(run.id) || Promise.resolve()).catch(() => {}).then(() => store.put("agent-run", run));
    eventWrites.set(run.id, write);
    await write;
  }
  async function status() {
    const config = await settings();
    const runtime = await runtimeStatus().catch(error => ({ installed: false, error: error.message }));
    let foundryAvailable = false;
    if (!cloud) try {
      const response = await fetch(foundryBase + "/api/health", { signal: AbortSignal.timeout(1200) });
      foundryAvailable = response.ok && (await response.json()).product === "factory";
    } catch {}
    return { ...runtime, provider: config.provider, model: config.model || (config.provider === "codex" ? "Codex 账号默认模型" : ""), foundryAvailable };
  }
  function compactRun({ raw, sources = [], prototype, ...run }) {
    return { ...run, sources: sources.map(({ raw, text, ...source }) => source), ...(prototype ? { prototype: { ...prototype, code: undefined, prd: undefined } } : {}), detailAvailable: true };
  }
  function compactEvaluation({ cases, raw, ...report }) { return { ...report, caseCount: cases?.length || 0, detailAvailable: true }; }
  router.get("/bootstrap", async (req, res) => {
    const config = await settings();
    const compact = req.query.full !== "1" && req.query.compact !== "0";
    const [projects, runs, evaluations, runtime, reviews] = await Promise.all([
      store.list("research-project"), store.list("agent-run"), store.list("evaluation"), status(), store.list("claim-review"),
    ]);
    const projectedRuns = runs.map(run => ({ ...run, claimAuditSummary: projectClaimAudit(run, reviews.filter(r => r.runId === run.id && r.projectId === run.projectId)).summary }));
    res.json({
      projects: projects.map(p => { const prepared = prepareMemoryProject(p); if (!compact) return prepared; const { memoryHistory, ...summary } = prepared; return summary; }), runs: compact ? projectedRuns.map(compactRun) : projectedRuns.map(({ raw, sources, ...run }) => ({ ...run, sources: (sources || []).map(({ raw, ...s }) => s) })),
      evaluations: compact ? evaluations.map(compactEvaluation) : evaluations, runtime, compact,
      settings: { provider: config.provider, baseUrl: config.baseUrl, model: config.model, hasApiKey: !!(config.apiKey || process.env.OPENAI_API_KEY), cloud },
    });
  });
  router.post("/projects", async (req, res) => {
    const input = projectSchema.parse(req.body);
    const p = replaceMemory({ ...input, memory: [], id: randomUUID(), decisions: [], createdAt: now(), updatedAt: now() }, input.memory);
    await store.put("research-project", p); res.status(201).json(p);
  });
  router.patch("/projects/:id", async (req, res) => {
    let p = await project(req.params.id);
    const change = projectSchema.partial().parse(req.body);
    if (projectLocks.has(p.id) || projectEdits.has(p.id)) return res.status(409).json({ error: "项目正在执行或修改。请完成或取消后再纠正项目记忆，避免上下文不一致。" });
    projectEdits.add(p.id);
    try {
      p = await project(req.params.id);
      if (change.memory) { requireMemoryRevision(p, req.body.expectedRevision); p = replaceMemory(p, change.memory); delete change.memory; }
      Object.assign(p, change, { updatedAt: now() });
      await store.put("research-project", p); res.json(p);
    } finally { projectEdits.delete(p.id); }
  });
  router.get("/projects/:id/memory", async (req, res) => { const p = await project(req.params.id); res.json({ memory: p.memory, history: p.memoryHistory, revision: p.memoryRevision }); });
  async function editMemory(req, res, apply) {
    let p = await project(req.params.id);
    if (projectLocks.has(p.id) || projectEdits.has(p.id)) throw Object.assign(new Error("项目正在执行或修改，请稍后再确认记忆。"), { status: 409 });
    projectEdits.add(p.id);
    try { p = await project(req.params.id); const input = apply.schema.parse(req.body); requireMemoryRevision(p, input.expectedRevision); p = apply.change(p, input); await store.put("research-project", p); res.json(p); }
    finally { projectEdits.delete(p.id); }
  }
  router.post("/projects/:id/memory", async (req, res) => editMemory(req, res, {
    schema: revisionSchema.extend({ text: z.string().trim().min(1).max(2000), source: z.string().max(300).default("用户确认") }), change: (p, input) => addMemory(p, input),
  }));
  router.patch("/projects/:id/memory/:memoryId", async (req, res) => editMemory(req, res, {
    schema: revisionSchema.extend({ text: z.string().trim().min(1).max(2000).optional(), source: z.string().max(300).optional(), active: z.literal(false).optional() }).refine(i => i.text !== undefined || i.source !== undefined || i.active === false), change: (p, input) => changeMemory(p, req.params.memoryId, input),
  }));
  router.post("/projects/:id/memory/:memoryId/restore", async (req, res) => editMemory(req, res, {
    schema: revisionSchema.extend({ revisionId: z.string().min(1).max(100) }), change: (p, input) => restoreMemory(p, req.params.memoryId, input.revisionId, input.reason),
  }));
  async function foundryRequest(path, options, signal, cookie = "") {
    const response = await fetch(foundryBase + "/api" + path, {
      ...options, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "造物服务请求失败。");
    return { data, response };
  }
  async function generatePrototype(run, parent, signal) {
    if (cloud) throw new Error("本机原型服务不能从云端直接调用。请使用本机工作台。");
    let cookie = "";
    const auth = await foundryRequest("/auth", {}, signal);
    if (!auth.data.authenticated) {
      if (!process.env.FOUNDRY_PASSWORD) throw new Error("造物需要访问口令，请在本机服务配置 FOUNDRY_PASSWORD。");
      const login = await foundryRequest("/login", { method: "POST", body: JSON.stringify({ password: process.env.FOUNDRY_PASSWORD }) }, signal);
      cookie = login.response.headers.get("set-cookie")?.split(";")[0] || "";
    }
    const config = await settings();
    if (config.provider === "openai") {
      const key = config.apiKey || process.env.OPENAI_API_KEY;
      if (!key) throw new Error("请先在设置中配置可用的 API Key。");
      await foundryRequest("/settings", { method: "PUT", body: JSON.stringify({ provider: "openai", baseUrl: config.baseUrl, model: config.model, apiKey: key }) }, signal, cookie);
    }
    const brief = run.raw.prototypeBrief;
    if (!brief?.prompt) throw new Error("此任务缺少生成前冻结的原型依据，请重新预览和提交。");
    const prompt = brief.prompt;
    const previous = brief.revisionTarget;
    const path = previous ? "/projects/" + previous.projectId + "/revise" : "/jobs";
    const created = await foundryRequest(path, { method: "POST", body: JSON.stringify({ title: run.raw.project.name + " · 需求验证原型", prompt, kind: "custom", provider: config.provider, documentIds: [], ...(previous ? { expectedVersionId: previous.versionId, expectedHtmlSha256: previous.htmlSha256 } : {}) }) }, signal, cookie);
    run.raw.foundryJobId = created.data.id;
    await event(run, previous ? "造物正在生成新版本，已有版本会保留" : "造物已接收需求，正在生成交互原型");
    let finished = false;
    try {
      const deadline = Date.now() + 650000;
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        const { data: job } = await foundryRequest("/jobs/" + created.data.id, {}, signal, cookie);
        if (job.status === "failed") throw Object.assign(new Error(job.error || "原型生成失败。"), { raw: { foundryJobId: job.id, model: job.modelTrace || null, errorCode: job.errorCode || null, inputBudget: job.inputBudget || null, inputValidation: job.inputValidation || null }, usage: job.usage });
        if (job.status === "cancelled") throw new Error("造物任务已取消。");
        if (job.status === "completed") {
          if (!job.result?.code || job.provider === "demo") throw new Error("造物返回的是演示模板，未完成真实原型生成。");
          const { data: p } = await foundryRequest("/projects/" + job.projectId, {}, signal, cookie);
          const v = job.versionId ? p.versions.find(v => v.id === job.versionId) : p.versions.at(-1);
          if (!v) throw Object.assign(new Error("造物指定的生成版本不可用，已保留结果，不能绑定其他版本。"), { raw: { foundryJobId: job.id, versionId: job.versionId, result: job.result, model: job.modelTrace || null }, usage: job.usage });
          run.prototype = { projectId: p.id, versionId: v.id, title: v.title, code: v.code, prd: v.prd, version: p.versions.indexOf(v) + 1, createdAt: v.createdAt, versionSelection: job.versionId ? "job-version-id" : "legacy-latest-unverified" };
          const claimIndices = new Set(brief.requirements.flatMap(r => r.bindings.claims.map(c => c.index)));
          run.result = { requirements: brief.selectedIndices.map(i => parent.result.requirements[i]), claims: (parent.result.claims || []).filter((_, i) => claimIndices.has(i)), actions: [], valueJudgment: "此原型用于探索选定需求；完整价值判断保存在原研究任务 " + parent.id, answer: "已将选定研究需求交给造物并保存原型版本。请在隔离预览中验证交互。", memoryUpdates: [] };
          run.sources = structuredClone(brief.sourceSnapshots);
          run.usage = job.usage || { ...emptyUsage(), note: "造物旧调用尚未提供计量，原型调用量未计入研究用量。" };
          run.raw.foundry = { jobId: job.id, projectId: p.id, versionId: v.id, provider: job.provider, trace: job.modelTrace || null };
          finished = true;
          return;
        }
        await new Promise((r, reject) => {
          const timer = setTimeout(() => { signal.removeEventListener("abort", abort); r(); }, 1500);
          const abort = () => { clearTimeout(timer); reject(new Error("任务已取消")); };
          signal.addEventListener("abort", abort, { once: true });
        });
      }
      throw new Error("原型生成超过时间上限。");
    } finally {
      if (!finished) try { await foundryRequest("/jobs/" + created.data.id + "/cancel", { method: "POST" }, null, cookie); } catch {}
    }
  }
  async function execute(run, controller) {
    const signal = controller.signal;
    try {
      run.status = "running"; await event(run, "已载入项目背景与当前确认的记忆");
      if (run.kind === "prototype") {
        const parent = await findRun(run.parentRunId);
        await generatePrototype(run, parent, signal);
      } else {
        if (run.kind === "research") {
          const urls = run.sourceIds.length && !run.sourceUrls.length ? [] : await sourceDiscoverer(run.prompt, run.sourceUrls, root, signal, message => { if (!signal.aborted) void event(run, message).catch(() => {}); });
          if (!urls.length && !run.sources.length) throw new Error("未找到可读取的来源。请补充竞品官网、GitHub 或官方文档链接。");
          const seenUrls = new Set(run.sources.map(source => normalizeUrl(source.url)));
          for (const url of urls) {
            const canonical = normalizeUrl(url);
            if (seenUrls.has(canonical)) continue;
            if (seenUrls.size >= 4) throw new Error("每次研究最多读取或复用 4 个不同来源，请减少来源后重试。");
            seenUrls.add(canonical);
            signal.throwIfAborted();
            await event(run, "正在读取证据：" + new URL(url).hostname);
            const source = await evidenceFetcher(url, signal);
            run.sources.push(source); await store.put("agent-run", run);
          }
          if (!run.sources.some(s => s.status === "fetched")) throw new Error("来源均未读取成功。失败原因已记录，请更换来源链接。");
        }
        signal.throwIfAborted();
        await event(run, "nanobot 正在结合项目背景形成判断与需求");
        const output = await runner({
          project: runtimeProject(run.raw.project), prompt: run.prompt,
          sources: run.sources.filter(s => s.status === "fetched").map(({ raw, ...source }) => source), history: run.raw.history,
          sessionId: run.sessionId, kind: run.kind, settings: await settings(), signal,
          onEvent: message => { if (!signal.aborted) void event(run, typeof message === "string" ? message : message?.message || JSON.stringify(message)).catch(() => {}); },
        });
        signal.throwIfAborted();
        run.result = {
          answer: output.answer, claims: output.claims || [], valueJudgment: output.valueJudgment || "",
          requirements: output.requirements || [], actions: (output.actions || []).map(a => ({ ...a, id: a.id || randomUUID(), done: false })),
          memoryUpdates: output.memoryUpdates || [],
        };
        run.raw.model = output.raw;
        run.engine = output.engine;
        run.usage = { ...emptyUsage(), ...output.usage };
        const sourceIds = new Set(run.sources.filter(s => s.status === "fetched").map(s => s.id));
        for (const item of [...run.result.claims, ...run.result.requirements, ...run.result.actions, ...run.result.memoryUpdates]) {
          if ((item.sourceIds || []).some(id => !sourceIds.has(id))) throw new Error("模型引用了不存在的证据ID，已保留原始输出，不能作为完成结果。");
        }
        const p = await project(run.projectId);
        p.decisions = [...(p.decisions || []), { id: randomUUID(), sourceRunId: run.id, text: run.result.valueJudgment, status: "proposal", createdAt: now() }].filter(d => d.text).slice(-30);
        p.updatedAt = now(); await store.put("research-project", p);
      }
      if (signal.aborted || run.status === "cancelled") return;
      run.status = "completed"; run.completedAt = now(); await event(run, "结果与原始记录已保存");
    } catch (error) {
      run.status = signal.aborted ? "cancelled" : "failed";
      run.error = signal.aborted ? "任务已取消，已有证据和记录已保留。" : error.message;
      if (error.raw) run.raw.failedModel = error.raw;
      if (error.usage) run.usage = error.usage;
      run.completedAt = now(); await event(run, run.error);
    } finally {
      try {
        await eventWrites.get(run.id)?.catch(() => {});
        await store.put("agent-run", run);
      } finally {
        controllers.delete(run.id); projectLocks.delete(run.projectId);
        eventWrites.delete(run.id);
      }
    }
  }
  function normalizeUrl(value) { const url = new URL(value); url.hash = ""; return url.href; }
  async function reusableSources(input) {
    if (input.sourceIds.length && input.kind !== "research") throw new Error("只有研究任务可以显式复用证据快照。");
    if (!input.sourceIds.length) return [];
    const all = await store.list("agent-run");
    const sources = [];
    const seen = new Set();
    const selectedHashes = new Map();
    const reusedAt = now();
    for (const id of [...new Set(input.sourceIds)]) {
      const valid = s => s.id === id && s.status === "fetched" && typeof s.text === "string" && s.text.length && typeof s.raw === "string" && /^[a-f0-9]{64}$/.test(s.sha256 || "") && createHash("sha256").update(s.raw).digest("hex") === s.sha256;
      const matches = all.filter(r => r.projectId === input.projectId && r.sources?.some(valid));
      if (!matches.length) throw Object.assign(new Error("只能复用本项目已读取成功的证据快照；来源不存在、读取失败或属于其他项目。"), { status: 400 });
      const original = matches.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))[0];
      const source = structuredClone(original.sources.find(valid));
      const canonical = normalizeUrl(source.url);
      if (seen.has(canonical)) {
        if (selectedHashes.get(canonical) !== source.sha256) throw new Error("同一地址的不同快照不能混用，请明确选择一个历史版本。");
        continue;
      }
      seen.add(canonical);
      selectedHashes.set(canonical, source.sha256);
      const originalRunId = source.reusedFrom?.originalRunId || original.id;
      source.reusedFrom = { runId: original.id, originalRunId, sourceId: source.id, fetchedAt: source.fetchedAt || null, sha256: source.sha256 || null };
      source.reusedAt = reusedAt;
      const age = source.fetchedAt ? (Date.parse(reusedAt) - Date.parse(source.fetchedAt)) / 1000 : NaN;
      source.ageAtReuseSeconds = Number.isFinite(age) ? Math.max(0, Math.floor(age)) : null;
      source.freshness = "saved-snapshot-not-refetched";
      sources.push(source);
    }
    for (const url of input.sourceUrls) {
      const canonical = normalizeUrl(url);
      if (selectedHashes.has(canonical)) throw new Error("同一地址不能同时复用快照和重新抓取，请选择一种读取方式。");
      seen.add(canonical);
    }
    if (seen.size > 4) throw new Error("每次研究最多读取或复用 4 个不同来源。");
    return sources;
  }
  async function start(body, req) {
    if (cloud) throw Object.assign(new Error("此版本需要本机 nanobot 常驻进程。云端旧文档工作台可继续使用。"), { status: 409 });
    const input = runSchema.parse(body);
    let p = await project(input.projectId);
    const key = req?.get("Idempotency-Key");
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    if (key) {
      if (key.length > 150) throw new Error("幂等键过长。");
      const prior = (await store.list("agent-run")).find(r => r.idempotencyKey === key);
      if (prior) {
        if (prior.requestHash !== requestHash) throw Object.assign(new Error("同一幂等键不能用于不同任务。"), { status: 409 });
        return prior;
      }
      if (pendingKeys.has(key)) throw Object.assign(new Error("同一幂等请求正在提交，请稍后查询；不会重复发起模型调用。"), { status: 409 });
    }
    if (projectLocks.has(p.id) || projectEdits.has(p.id) || controllers.size >= 2) throw Object.assign(new Error("已有任务执行或修改中，请完成或取消后继续。"), { status: 409 });
    const runId = randomUUID();
    const controller = new AbortController(); controllers.set(runId, controller); projectLocks.add(p.id);
    if (key) pendingKeys.set(key, requestHash);
    try {
      p = await project(input.projectId);
      let prototypeBrief;
      if (input.kind === "prototype") {
        const parent = await findRun(input.parentRunId);
        prototypeBrief = await preparePrototypeBrief(parent, p, { prompt: input.prompt, ...(input.requirementIndices ? { requirementIndices: input.requirementIndices } : {}), ...(input.prototypeMode ? { prototypeMode: input.prototypeMode } : {}), ...(input.expectedBriefFingerprint ? { expectedBriefFingerprint: input.expectedBriefFingerprint } : {}) });
      } else if (input.requirementIndices || input.expectedBriefFingerprint || input.prototypeMode) throw new Error("需求选择只适用于原型任务。");
      const config = await settings();
      if (!["codex", "openai"].includes(config.provider)) throw new Error("请先在设置中选择本机 Codex 或可用 API。研究助理不使用模板冒充真实结果。");
      const runtime = await runtimeStatus();
      if (!runtime.installed && input.kind !== "prototype") throw new Error("nanobot 运行环境未就绪，请执行 npm run agent:setup。");
      if (input.kind === "prototype") {
        const parent = await findRun(input.parentRunId);
        if (parent.projectId !== p.id || parent.status !== "completed" || !parent.result?.requirements?.length)
          throw new Error("请先完成本项目的研究需求，再生成原型。");
      }
      const sources = await reusableSources(input);
      const memoryKey = current => JSON.stringify((current?.memory || []).filter(m => !m.status || m.status === "active").map(m => [m.id, m.text, m.source || "用户确认"]).sort((a, b) => a[0].localeCompare(b[0])));
      const history = (await store.list("agent-run")).filter(r => r.projectId === p.id && r.status === "completed" && r.kind !== "prototype" && memoryKey(r.raw?.project) === memoryKey(p) && (!p.memoryUpdatedAt || r.createdAt >= p.memoryUpdatedAt)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-3)
        .map(r => ({ runId: r.id, prompt: r.prompt, result: { ...r.result, memoryUpdates: [] }, sessionId: r.sessionId, createdAt: r.createdAt, historical: true, memoryRevision: r.raw?.project?.memoryRevision ?? 0 }));
      const run = {
        ...input, id: runId, sessionId: input.sessionId || randomUUID().replaceAll("-", ""), status: "queued",
        stage: "排队中", events: [], sources, result: null, usage: emptyUsage(), error: null,
        createdAt: now(), parentRunId: input.parentRunId || null, idempotencyKey: key || null, requestHash,
        raw: { project: structuredClone(p), history, request: input, ...(prototypeBrief ? { prototypeBrief } : {}) },
      };
      await store.put("agent-run", run);
      void execute(run, controller);
      return run;
    } catch (error) { controllers.delete(runId); projectLocks.delete(p.id); throw error; }
    finally { if (key) pendingKeys.delete(key); }
  }
  router.post("/runs", async (req, res) => res.status(202).json(await start(req.body, req)));
  router.get("/runs/:id", async (req, res) => { const run = await findRun(req.params.id); res.json({ ...run, claimAudit: await claimAudit.forRun(run) }); });
  router.get("/runs/:id/claims", async (req, res) => res.json(await claimAudit.forRun(await findRun(req.params.id))));
  router.post("/runs/:id/claims/:key/review", async (req, res) => res.json(await claimAudit.review(req.params.id, req.params.key, req.body)));
  router.get("/runs/:id/requirements", async (req, res) => { const run = await findRun(req.params.id); res.json(projectRequirementBasis(run, await claimAudit.forRun(run))); });
  router.post("/runs/:id/prototype/brief-preview", async (req, res) => {
    const parent = await findRun(req.params.id);
    const input = prototypeRequestSchema.parse(req.body || {});
    const brief = await preparePrototypeBrief(parent, await project(parent.projectId), input);
    res.json(briefPreview(brief));
  });
  router.post("/projects/:id/recall", async (req, res) => res.status(202).json(await start({ ...req.body, projectId: req.params.id, kind: "recall" }, req)));
  router.post("/runs/:id/prototype", async (req, res) => {
    const parent = await findRun(req.params.id);
    const input = prototypeRequestSchema.parse(req.body || {});
    res.status(202).json(await start({ ...input, projectId: parent.projectId, kind: "prototype", parentRunId: parent.id }, req));
  });
  router.post("/runs/:id/cancel", async (req, res) => {
    const run = await findRun(req.params.id);
    if (readyStatus.includes(run.status)) return res.json(run);
    controllers.get(run.id)?.abort();
    run.status = "cancelled"; run.completedAt = now();
    await store.put("agent-run", run); res.json(run);
  });
  router.patch("/runs/:id/actions/:actionId", async (req, res) => {
    const validDate = value => { const date = new Date(value + "T00:00:00Z"); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; };
    const change = z.object({ done: z.boolean().optional(), note: z.string().max(4000).optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(validDate).nullable().optional() }).refine(i => Object.keys(i).length > 0).parse(req.body);
    const id = req.params.id;
    const write = (actionWrites.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
    const run = await findRun(id);
    if (controllers.has(id)) throw Object.assign(new Error("任务正在保存最终记录，请稍后再更新待办。"), { status: 409 });
    if (run.status !== "completed" || (run.kind && !["research", "recall"].includes(run.kind))) throw Object.assign(new Error("只能跟进已完成研究或回忆任务中的有效行动项。"), { status: 409 });
      const matches = run.result?.actions?.filter(a => a.id === req.params.actionId) || [];
      if (!matches.length) throw Object.assign(new Error("待办不存在。"), { status: 404 });
      if (matches.length !== 1) throw Object.assign(new Error("行动项 ID 重复，无法安全定位，请核对原始结果。"), { status: 409 });
      Object.assign(matches[0], change, { updatedAt: now() }); await store.put("agent-run", run); return run;
    });
    actionWrites.set(id, write);
    try { res.json(await write); } finally { if (actionWrites.get(id) === write) actionWrites.delete(id); }
  });
  router.get("/runs/:id/export", async (req, res) => {
    const run = await findRun(req.params.id);
    const zip = new JSZip();
    zip.file("run.json", JSON.stringify(run, null, 2));
    zip.file("result.md", run.result?.answer || run.error || "任务尚未完成");
    zip.file("usage.json", JSON.stringify(run.usage, null, 2));
    zip.file("events.json", JSON.stringify(run.events, null, 2));
    zip.file("claim-reviews.json", JSON.stringify(await claimAudit.forRun(run), null, 2));
    zip.file("requirements-basis.json", JSON.stringify(run.raw?.prototypeBrief?.requirements || projectRequirementBasis(run, await claimAudit.forRun(run)), null, 2));
    if (run.raw?.prototypeBrief) zip.file("prototype-brief.json", JSON.stringify(run.raw.prototypeBrief, null, 2));
    for (const source of run.sources) {
      zip.file("evidence/" + source.id + ".txt", source.raw || source.text);
      zip.file("evidence/" + source.id + ".extracted.txt", source.text || "");
      zip.file("evidence/" + source.id + ".json", JSON.stringify({ ...source, raw: undefined, text: undefined }, null, 2));
    }
    const recordPath = run.raw?.model?.recordPath || run.raw?.failedModel?.recordPath;
    const recordsRoot = resolve(root, ".runtime/records") + "/";
    if (typeof recordPath === "string" && resolve(recordPath).startsWith(recordsRoot) && recordPath.endsWith(".json")) {
      try {
        zip.file("model/record.json", await readFile(recordPath));
        const callsDir = recordPath.slice(0, -5);
        for (const entry of await readdir(callsDir, { withFileTypes: true })) {
          if (!entry.isDirectory() || !/^call-\d+$/.test(entry.name)) continue;
          for (const file of await readdir(join(callsDir, entry.name), { withFileTypes: true })) {
            if (file.isFile() && ["input.json", "prompt.txt", "schema.json", "call.json", "output.json"].includes(file.name))
              zip.file("model/" + entry.name + "/" + file.name, await readFile(join(callsDir, entry.name, file.name)));
          }
        }
      } catch (error) {
        zip.file("model/availability.json", JSON.stringify({ complete: false, error: error.code || "record-unavailable", note: "私有调用档案不可用，run.json仍保留已有输入、输出与事件。" }, null, 2));
      }
    }
    res.attachment("yiban-research-" + run.id.slice(0, 8) + ".zip").type("application/zip").send(await zip.generateAsync({ type: "nodebuffer" }));
  });
  router.get("/prototypes/:id/download", async (req, res) => {
    const run = await findRun(req.params.id);
    if (!run.prototype?.code) throw new Error("原型尚未生成。");
    const zip = new JSZip();
    zip.file("index.html", run.prototype.code);
    zip.file("PRD.md", run.prototype.prd);
    zip.file("manifest.json", JSON.stringify({ runId: run.id, parentRunId: run.parentRunId, version: run.prototype.version, sources: run.sources.map(({ id, url, sha256 }) => ({ id, url, sha256 })) }, null, 2));
    if (run.raw?.prototypeBrief) {
      zip.file("prototype-brief.json", JSON.stringify(run.raw.prototypeBrief, null, 2));
      if (run.raw.prototypeBrief.previousPrototypeSnapshot) zip.file("previous-version.html", run.raw.prototypeBrief.previousPrototypeSnapshot.code);
      zip.file("requirements-basis.json", JSON.stringify(run.raw.prototypeBrief.requirements, null, 2));
      zip.file("generation-claim-audit.json", JSON.stringify(run.raw.prototypeBrief.claimAuditSnapshot, null, 2));
      for (const source of run.raw.prototypeBrief.sourceSnapshots) { zip.file("evidence/" + source.id + ".extracted.txt", source.text || ""); zip.file("evidence/" + source.id + ".json", JSON.stringify({ ...source, text: undefined, raw: undefined }, null, 2)); }
      if (run.parentRunId) try { zip.file("current-research-claim-audit.json", JSON.stringify(await claimAudit.forRun(await findRun(run.parentRunId)), null, 2)); } catch {}
    } else zip.file("brief-availability.json", JSON.stringify({ available: false, note: "此历史版本未保存冻结依据，不能事后合成为真实生成输入。" }, null, 2));
    zip.file("README.md", "# " + run.prototype.title + "\n\n独立浏览器前端原型。打开 index.html 体验；业务数据为示例，不包含服务器、支付或真实AI功能。\n");
    res.attachment("yiban-prototype.zip").type("application/zip").send(await zip.generateAsync({ type: "nodebuffer" }));
  });
  router.get("/evaluations", async (_, res) => res.json(await store.list("evaluation")));
  router.get("/evaluations/:id", async (req, res) => {
    const report = await store.get(safeId.parse(req.params.id), "evaluation");
    if (!report) throw Object.assign(new Error("评测不存在。"), { status: 404 });
    res.json(report);
  });
  router.get("/evaluations/:id/export", async (req, res) => {
    const id = safeId.parse(req.params.id);
    const report = await store.get(id, "evaluation");
    if (!report) throw Object.assign(new Error("评测不存在。"), { status: 404 });
    const zip = new JSZip();
    zip.file("report.json", JSON.stringify(report, null, 2));
    const directory = resolve(root, "data/evaluations", id);
    async function include(dir, prefix = "") {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await include(path, prefix + entry.name + "/");
        else if (entry.isFile() && !/secret|token|credential/i.test(entry.name)) zip.file("raw/" + prefix + entry.name, await readFile(path));
      }
    }
    try { await include(directory); } catch (error) { if (error.code !== "ENOENT") throw error; }
    res.attachment("yiban-evaluation-" + id + ".zip").type("application/zip").send(await zip.generateAsync({ type: "nodebuffer" }));
  });
  router.use((error, req, res, next) => {
    res.status(error.status || 400).json({ error: error instanceof z.ZodError ? "输入格式不正确，请检查项目和任务内容。" : error.message || "请求失败。", ...(error.code ? { code: error.code } : {}), ...(error.actualChars !== undefined ? { actualChars: error.actualChars, maxChars: error.maxChars, selectedIndices: error.selectedIndices, unit: error.unit } : {}) });
  });
  return { router, shutdown() { for (const controller of controllers.values()) controller.abort(); } };
}
