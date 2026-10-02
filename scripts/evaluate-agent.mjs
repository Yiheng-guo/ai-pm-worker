#!/usr/bin/env node
/**
 * Real, bounded evaluation of Yiban's original worker and personal agent.
 * No model grader is used. Mechanical checks and source audits stay separate.
 */
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile, cp, access } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createStore } from "../server/store.mjs";
import { buildPrompt } from "../server/prompts.mjs";
import { jsonSchema, workerSchema, parseResult } from "../server/schemas.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
}
const baseUrl = option("--base-url", "http://127.0.0.1:4310").replace(/\/$/, "");
const dataDir = resolve(option("--data-dir", process.env.OFFICE_DATA_DIR || join(root, "data")));
const artifactDir = resolve(option("--artifact-dir", join(root, "data", "evaluations")));
const loadId = option("--report-id", "");
const reviewPath = option("--review", "");
const resumeRunId = option("--resume-run", "");
const evaluationId = option("--evaluation-id", "");
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let cookie = process.env.EVALUATION_COOKIE || "";
let activeBaseline = null;
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
  if (activeBaseline) activeBaseline.kill("SIGTERM");
  else process.exit(143);
});

async function api(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}: ${path}`);
  return value;
}

function parseUsage(raw) {
  const events = raw.split(/\r?\n/).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const turns = events.filter((event) => event.type === "turn.completed" && event.usage);
  if (!turns.length) return null;
  return turns.reduce((total, event) => {
    for (const [key, value] of Object.entries(event.usage)) {
      if (typeof value === "number") total[key] = (total[key] || 0) + value;
    }
    return total;
  }, {});
}

async function codexBaseline(prompt, folder) {
  await mkdir(folder, { recursive: true });
  const promptPath = join(folder, "prompt.txt");
  const schemaPath = join(folder, "schema.json");
  const resultPath = join(folder, "result.json");
  const eventPath = join(folder, "events.ndjson");
  const stderrPath = join(folder, "stderr.txt");
  await writeFile(promptPath, prompt);
  await writeFile(schemaPath, JSON.stringify(jsonSchema(workerSchema), null, 2));
  const startedAt = now();
  let stdout = "", stderr = "", exitCode = null;
  let pendingLine = "";
  await writeFile(eventPath, "");
  await writeFile(stderrPath, "");
  function retainLine(line) {
    if (!line.trim()) return;
    try { if (JSON.parse(line)?.item?.type === "reasoning") return; } catch {}
    appendFileSync(eventPath, line + "\n");
  }
  let error = null;
  try {
    await new Promise((resolveRun, reject) => {
      const codexArgs = [
        "exec", "--ignore-user-config", "--skip-git-repo-check", "--ephemeral",
        "--sandbox", "read-only", "--color", "never", "--json",
        "--output-schema", schemaPath, "-o", resultPath,
        "-c", 'web_search="disabled"', "--enable", "skip_host_skill_discovery",
      ];
      for (const feature of ["shell_tool", "unified_exec", "apps", "plugins", "hooks", "browser_use", "browser_use_external", "computer_use", "image_generation", "multi_agent", "memories", "skill_search", "code_mode_host"])
        codexArgs.push("--disable", feature);
      codexArgs.push("-");
      const child = spawn(process.env.CODEX_BIN || "codex", codexArgs,
        { cwd: folder, stdio: ["pipe", "pipe", "pipe"] });
      activeBaseline = child;
      writeFileSync(join(folder, "call-meta.json"), JSON.stringify({ status: "running", startedAt, pid: child.pid, cliArgs: codexArgs, reasonEventsRetained: false }, null, 2));
      child.stdout.on("data", (chunk) => {
        const text = chunk.toString(); stdout += text; pendingLine += text;
        const lines = pendingLine.split(/\r?\n/); pendingLine = lines.pop();
        for (const line of lines) retainLine(line);
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString().replace(/(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]+)/g, "[REDACTED]");
        writeFileSync(stderrPath, stderr);
      });
      const timer = setTimeout(() => child.kill("SIGTERM"), 600000);
      child.on("error", (failure) => { clearTimeout(timer); reject(failure); });
      child.on("close", (code) => {
        clearTimeout(timer); exitCode = code;
        if (pendingLine) { retainLine(pendingLine); pendingLine = ""; }
        activeBaseline = null;
        code === 0 ? resolveRun() : reject(new Error(`Codex exit ${code ?? "timeout"}`));
      });
      child.stdin.on("error", () => {});
      child.stdin.end(prompt);
    });
  } catch (failure) { error = failure.message; }
  await writeFile(stderrPath, stderr);
  await writeFile(join(folder, "call-meta.json"), JSON.stringify({ status: error ? "failed" : "completed", startedAt, finishedAt: now(), exitCode, rawUsage: parseUsage(stdout), error, intentionallyPaused: stopping, reasonEventsRetained: false }, null, 2));
  let result = null;
  if (!error) {
    try { result = parseResult(await readFile(resultPath, "utf8"), workerSchema); }
    catch (failure) { error = failure.message; }
  }
  return {
    status: error ? "failed" : "completed", startedAt, finishedAt: now(), exitCode,
    error, result, rawUsage: parseUsage(stdout), usage: parseUsage(stdout) ? {
      inputTokens: parseUsage(stdout).input_tokens ?? null,
      outputTokens: parseUsage(stdout).output_tokens ?? null,
      cachedTokens: parseUsage(stdout).cached_input_tokens ?? null,
      cost: null, reported: true,
    } : null, model: null,
    cost: { amount: null, currency: "CNY", reason: "Codex 订阅调用没有本任务独立账单；Token 不能直接换算为现金支出。" },
    elapsedMs: Date.now() - Date.parse(startedAt),
  };
}

async function waitRun(run, folder) {
  const deadline = Date.now() + 660000;
  let current = run;
  if (folder) await writeFile(join(folder, "agent-submitted.json"), JSON.stringify(run, null, 2));
  while (["queued", "running"].includes(current.status)) {
    if (Date.now() > deadline) {
      if (folder) await writeFile(join(folder, "driver-timeout.json"), JSON.stringify({ at: now(), lastKnownRun: current, note: "Evaluation driver timed out; original task was not resubmitted or overwritten." }, null, 2));
      return { ...current, status: "driver-timed-out", error: "Evaluation driver timed out; inspect original task before retrying." };
    }
    await sleep(1500);
    current = await api(`/api/agent/runs/${run.id}`);
  }
  return current;
}

async function saveAgent(run, folder) {
  await writeFile(join(folder, "agent.json"), JSON.stringify(run, null, 2));
  await writeFile(join(folder, "sources.json"), JSON.stringify(run.sources || [], null, 2));
  const recordPath = run.raw?.model?.recordPath || run.raw?.failedModel?.recordPath;
  if (recordPath) {
    try {
      await cp(recordPath, join(folder, "runtime-record.json"));
      await cp(recordPath.replace(/\.json$/, ""), join(folder, "runtime-calls"), { recursive: true });
    } catch (error) {
      await writeFile(join(folder, "runtime-copy-note.json"), JSON.stringify({ recordPath, error: error.message }, null, 2));
    }
  }
}

const tasks = [
  {
    id: "research-memory", title: "Hermes 机制研究与第一版价值判断",
    sourceUrls: ["https://github.com/NousResearch/hermes-agent"],
    prompt: "研究 Hermes Agent 公开仓库中的长期记忆与技能积累机制，判断亦伴是否值得在第一版引入这些能力。请区分官方声明、你的推断和仍未验证的效果，给出价值判断、至少两条可追溯的事实、三个有验收条件的优先需求以及下一步行动。不能把更新记忆或 Skills 表述为已证明的模型权重训练，不能编造实测结果。",
  },
  {
    id: "research-prd", title: "nanobot 项目记忆的证据需求草稿",
    sourceUrls: ["https://github.com/HKUDS/nanobot"],
    prompt: "结合 nanobot 官方仓库资料，为亦伴形成“可纠正的项目记忆”需求草稿。要求包括用户问题、记忆来源与证据、过时事实纠正、跨会话调用、明确的验收条件以及下一步行动。分析哪些底座能力可复用、哪些需要二开以及是否值得放进第一版；明确资料不足之处，避免把官方功能声明当作已验证的可靠性。",
  },
];

function facts(result) {
  if (!result) return "";
  return [result.markdown, result.answer, result.summary, JSON.stringify(result.claims || [])]
    .filter(Boolean).join("\n");
}

function mechanicalChecks(entry) {
  const sources = entry.agent.sources || [];
  const ids = new Set(sources.filter((source) => source.status === "fetched").map((source) => source.id));
  const claims = entry.agent.result?.claims || [];
  const references = claims.flatMap((claim) => claim.sourceIds || claim.evidenceIds || []);
  return {
    baselineExecuted: entry.baseline.status === "completed",
    agentExecuted: entry.agent.status === "completed",
    fetchedSourceCount: ids.size,
    structuredClaimCount: claims.length,
    referenceCount: references.length,
    validReferenceCount: references.filter((id) => ids.has(id)).length,
    referenceNote: "仅检查引用 ID 是否存在，不代表断言与原文一致，也不是事实正确率。",
    taskAcceptance: { baseline: null, agent: null, status: "pending-source-review" },
    factAudit: { baseline: null, agent: null, status: "pending-source-review" },
  };
}

function totalUsage(cases, side) {
  const usages = cases.flatMap((entry) => [entry[side], ...(entry.previousAttempts || []).map(attempt => attempt[side])]).map(attempt => attempt?.usage).filter(Boolean);
  if (!usages.length) return null;
  const value = {};
  for (const usage of usages) for (const [key, n] of Object.entries(usage))
    if (typeof n === "number") value[key] = (value[key] || 0) + n;
  return value;
}

function usageCoverage(cases, side) {
  return cases.flatMap((entry) => [entry[side], ...(entry.previousAttempts || []).map(attempt => attempt[side])]).filter(attempt => typeof attempt?.usage?.inputTokens === "number" && typeof attempt?.usage?.outputTokens === "number").length;
}

function attemptCount(cases, side) {
  return cases.flatMap(entry => [entry[side], ...(entry.previousAttempts || []).map(attempt => attempt[side])]).filter(Boolean).reduce((count, attempt) => count + (side === "agent" ? (attempt.usage?.requestCount || 1) : 1), 0);
}

function metrics(report) {
  const research = report.cases.filter((entry) => entry.kind === "research");
  const plannedResearch = report.sampleSize || research.length;
  const pendingResearch = Math.max(0, plannedResearch - research.length);
  const memoryCases = report.cases.filter((entry) => entry.kind === "recall");
  const accepted = (side) => {
    const values = research.map((entry) => entry.checks.taskAcceptance[side]);
    return !values.length || pendingResearch || values.some((value) => value === null) ? null : values.filter(Boolean).length;
  };
  const errorCount = (side) => {
    const values = research.map((entry) => entry.checks.factAudit[side]);
    return !values.length || pendingResearch || values.some((value) => !value) || !values.some(value => value.reviewed > 0) ? null : values.reduce((n, value) => n + (value.contradicted || 0), 0);
  };
  const reviewedCount = side => research.reduce((count, entry) => count + (entry.checks.factAudit[side]?.reviewed || 0), 0);
  return [
    { name: "研究任务首次执行完成", baseline: research.length ? research.filter(entry => (entry.previousAttempts?.[0]?.baseline || entry.baseline).status === "completed").length : null,
      agent: research.length ? research.filter(entry => (entry.previousAttempts?.[0]?.agent || entry.agent).status === "completed").length : null, unit: `/${plannedResearch} 个样本`,
      definition: "每个逻辑研究样本第一次实际执行的进程和输出状态；失败后补救不覆写首次结果。", note: `未完成基线也保留。${pendingResearch ? `另有 ${pendingResearch} 个预定配对待记录。` : ""}` },
    { name: "研究任务最终执行完成", baseline: research.length ? research.filter((entry) => entry.baseline.status === "completed").length : null,
      agent: research.length ? research.filter((entry) => entry.agent.status === "completed").length : null, unit: `/${plannedResearch} 个样本`,
      definition: "进程与结构化输出成功，不等于产品验收通过。", note: `小样本，不推断总体成功率。${pendingResearch ? `还有 ${pendingResearch} 个预定配对未完成记录。` : ""}` },
    { name: "研究任务验收通过", baseline: accepted("baseline"), agent: accepted("agent"), unit: `/${plannedResearch} 个样本`,
      definition: "按任务要求、来源支持、可用需求与行动项的固定标准进行来源对照复核。", note: "未审核时显示未测，不能以执行成功替代。" },
    { name: "已复核断言中的事实错误", baseline: errorCount("baseline"), agent: errorCount("agent"), unit: "条",
      definition: "仅计来源明确反驳的断言；无支持或无法核实单列，不计成正确。", note: `来源对照抽查 ${reviewedCount("baseline")} 条基线与 ${reviewedCount("agent")} 条Agent断言；缺产物无法审查，不代表全文无误。` },
    { name: "运行中的人工干预", baseline: report.cases.length ? report.cases.reduce((n, entry) => n + entry.baseline.interventions.length, 0) : null,
      agent: report.cases.length ? report.cases.reduce((n, entry) => n + entry.agent.interventions.length, 0) : null, unit: "次",
      definition: "实际重新提交、修正输出或运行失败后的人工操作。受控记忆更新与结果审查单独记录，不算补救干预。", note: "零次表示本次执行未补救，不代表无需人工复核。" },
    ...memoryCases.map(memory => ({ name: memory.id === "memory-initial" ? "跨会话初始记忆召回" : "跨会话纠正后记忆召回", baseline: memory.checks.memory.baseline,
      agent: memory.checks.memory.agent, unit: "/3 个受控事实",
      definition: "新请求不重述事实，检查保存后的当前范围、禁止自动发送、当前团队人数。", note: "独立能力测试；基线没有项目记忆，不与分析质量混为一谈。" })),
    ...[ ["inputTokens", "真实模型输入 Token"], ["cachedTokens", "真实模型缓存 Token"], ["outputTokens", "真实模型输出 Token"] ].map(([key, name]) => ({ name,
      baseline: totalUsage(report.cases, "baseline")?.[key] ?? null, agent: totalUsage(report.cases, "agent")?.[key] ?? null, unit: "Token",
      definition: "汇总正式首次与补救尝试及研究/记忆测试的已报告 usage；缓存与输入不能重复相加。", note: `基线计量覆盖 ${usageCoverage(report.cases, "baseline")}/${attemptCount(report.cases, "baseline")} 次尝试，Agent覆盖 ${usageCoverage(report.cases, "agent")}/${attemptCount(report.cases, "agent")}；缺失字段不当零，实际总消耗可能高于已报告值。` })),
    { name: "单任务现金成本", baseline: null, agent: null, unit: "CNY",
      definition: "需要实际 API 价格与模型路由或独立账单；本次使用订阅，未换算。", note: "运行机器、网络和维护成本也未计入。" },
  ];
}

function markdown(report) {
  const render = (value) => value === null || value === undefined ? "未测 / 不可换算" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `# ${report.title}\n\n时间：${report.createdAt}\n状态：${report.status}\n\n` +
    `本次 ${report.sampleSize} 个研究配对样本，另含受控跨会话记忆测试。结果仅适用于本次材料和运行条件。\n\n` +
    `| 指标 | 原版 Worker | Personal Agent | 定义与限制 |\n|---|---|---|---|\n` +
    report.metrics.map((metric) => `| ${metric.name} | ${render(metric.baseline)}${metric.baseline == null ? "" : " " + metric.unit} | ${render(metric.agent)}${metric.agent == null ? "" : " " + metric.unit} | ${metric.definition} ${metric.note} |`).join("\n") +
    `\n\n## 案例与原始记录\n\n` + report.cases.map((entry) =>
      `- ${entry.title}：基线 ${entry.baseline.status}，Agent ${entry.agent.status}；原始记录见 ${entry.id}/。` ).join("\n") +
    `\n\n## 运行与前置失败\n\n` + (report.orchestrationNotes || []).map((note) => `- ${note}`).join("\n") +
    `\n\n## 内容比较\n\n` + Object.values(report.reviewComparison || {}).join("\n\n") +
    (report.prototypeValidation ? `\n\n## 原型单独验收\n\n造物 v1 是真实模型生成；v2 是人工验收修正，不是第二次 AI 生成。原型不加入研究分母。v1 已报告输入 ${report.prototypeValidation.modelTokenUsage.inputTokens} Token，输出 ${report.prototypeValidation.modelTokenUsage.outputTokens} Token，缓存 ${report.prototypeValidation.modelTokenUsage.cachedTokens} Token。v2 未新增模型调用，人工成本未知。\n\n${report.prototypeValidation.checks.map(check => `- ${check.flow}：${({ passed: "已通过", unverified: "尚未确认", "manually-patched-await-root-confirmation": "已人工修改，待验证" })[check.status] || check.status}。${check.evidence}`).join("\n")}\n` : "") +
    `\n\n## 局限\n\n` + report.limitations.map((limitation) => `- ${limitation}`).join("\n") +
    `\n\n## 审查记录\n\n${report.review ? "审查内容、抽取断言和对应来源原文在 review.json。审查者为实现/验收人员，未做独立专家复核。" : "尚未进行来源对照审查。事实错误与任务验收不得解释为 0 或通过。"}\n`;
}

async function saveReport(report, folder) {
  report.metrics = metrics(report);
  report.invocationLedger = report.cases.flatMap(entry => [
    { caseId: entry.id, phase: "final", baseline: entry.baseline, agent: entry.agent },
    ...(entry.previousAttempts || []).map(attempt => ({ caseId: entry.id, phase: "initial-preserved", baseline: attempt.baseline, agent: attempt.agent })),
  ]).flatMap(attempt => ["baseline", "agent"].map(side => ({ caseId: attempt.caseId, phase: attempt.phase, side,
    status: attempt[side]?.status, localProcessAttempts: side === "agent" ? attempt[side]?.usage?.requestCount ?? null : 1,
    usage: attempt[side]?.usage ?? null, verifiedUsage: typeof attempt[side]?.usage?.inputTokens === "number", remoteCompletedOrBillableRequestCount: null,
    note: "CLI重连事件不等同独立计费请求；只确认本地进程尝试和提供方报告usage，不推断缺失用量。" })));
  report.rawFiles = ["report.json", "report.md", ...report.cases.flatMap((entry) =>
    [`${entry.id}/agent.json`, `${entry.id}/sources.json`, `${entry.id}/baseline/prompt.txt`, `${entry.id}/baseline/events.ndjson`, `${entry.id}/baseline/result.json`, `${entry.id}/runtime-record.json`, `${entry.id}/runtime-calls/`])];
  if (report.review) report.rawFiles.push("review.json");
  if (report.preflight) report.rawFiles.push("preflight-attempt/");
  if (report.prototypeValidation) report.rawFiles.push("prototype-validation/");
  report.rawFiles.push("recovery-validation/", "protocol-precheck.json");
  for (const entry of report.cases) if (entry.previousAttempts?.length) report.rawFiles.push(`${entry.id}/attempt-1/`);
  const availability = await Promise.all(report.rawFiles.map(async path => ({ path, available: await access(join(folder, path)).then(() => true).catch(() => false) })));
  report.rawAvailability = availability;
  report.rawFiles = availability.filter(item => item.available).map(item => item.path);
  report.missingRawFiles = availability.filter(item => !item.available).map(item => item.path);
  await writeFile(join(folder, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(folder, "report.md"), markdown(report));
  const store = await createStore(dataDir);
  try { await store.put("evaluation", report); } finally { store.close(); }
}

if (loadId) {
  if (!reviewPath) throw new Error("--report-id requires --review path/to/review.json");
  const folder = join(artifactDir, loadId);
  const report = JSON.parse(await readFile(join(folder, "report.json"), "utf8"));
  const review = JSON.parse(await readFile(resolve(reviewPath), "utf8"));
  for (const entry of report.cases.filter((entry) => entry.kind === "research")) {
    const item = review.cases?.find((candidate) => candidate.id === entry.id);
    if (!item) throw new Error(`Missing reviewed case ${entry.id}`);
    for (const side of ["baseline", "agent"]) {
      if (typeof item[side]?.accepted !== "boolean" || !Array.isArray(item[side]?.assertions))
        throw new Error(`Review requires acceptance and assertion ledger: ${entry.id}/${side}`);
      const assertions = item[side].assertions;
      const statuses = ["supported", "contradicted", "unsupported", "unverifiable"];
      if (assertions.some((assertion) => !statuses.includes(assertion.status) || !assertion.statement || !assertion.reason))
        throw new Error(`Invalid assertion ledger: ${entry.id}/${side}`);
      entry.checks.taskAcceptance[side] = item[side].accepted;
      entry.checks.factAudit[side] = Object.fromEntries(["reviewed", ...statuses].map((status) =>
        [status, status === "reviewed" ? assertions.length : assertions.filter((assertion) => assertion.status === status).length]));
    }
    entry.checks.taskAcceptance.status = "source-reviewed";
    entry.checks.factAudit.status = "source-reviewed";
  }
  for (const entry of report.cases.filter((entry) => entry.kind === "recall")) {
    const item = review.recalls?.find((candidate) => candidate.id === entry.id);
    if (!item) throw new Error(`Missing reviewed recall ${entry.id}`);
    for (const side of ["baseline", "agent"]) {
      if (!Array.isArray(item[side]?.facts) || item[side].facts.length !== 3 || item[side].facts.some(fact => typeof fact.correct !== "boolean" || !fact.reason))
        throw new Error(`Recall review requires three fact checks and reasons: ${entry.id}/${side}`);
      entry.checks.memory[side] = item[side].facts.filter(fact => fact.correct).length;
      entry.checks.memory[side + "Details"] = { facts: item[side].facts, method: "manual controlled-fixture comparison", oldValueInvalidated: item[side].oldValueInvalidated ?? null };
    }
    entry.checks.memory.oldValueInvalidationRequiresReview = false;
  }
  report.review = { reviewer: review.reviewer, reviewedAt: review.reviewedAt, method: "source-comparison", independentExpertReview: false };
  report.status = report.cases.every((entry) => entry.baseline.status === "completed" && entry.agent.status === "completed") ? "measured" : "partial";
  await writeFile(join(folder, "review.json"), JSON.stringify(review, null, 2));
  await saveReport(report, folder);
  console.log(JSON.stringify({ id: report.id, status: report.status, report: join(folder, "report.md") }));
  process.exit(0);
}

await api("/api/health");
if (process.env.EVALUATION_PASSWORD) {
  const response = await fetch(baseUrl + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: process.env.EVALUATION_PASSWORD }) });
  if (!response.ok) throw new Error("Evaluation login failed.");
  cookie = response.headers.get("set-cookie")?.split(";")[0] || "";
}
const resumedRun = resumeRunId ? await api(`/api/agent/runs/${resumeRunId}`) : null;
const id = evaluationId || randomUUID();
const folder = join(artifactDir, id);
await mkdir(folder, { recursive: true });
try { await cp(join(artifactDir, "protocol-precheck.json"), join(folder, "protocol-precheck.json")); } catch {}
const background = resumedRun?.raw?.project?.background || await readFile(join(root, "docs", "LEGACY_WORKER.md"), "utf8");
async function createEvaluationProject(name) {
  return api("/api/agent/projects", {
  name, background,
  goal: "评估已有产品能否形成有证据、可纠正项目记忆、可跟进的个人产品研究助理。",
  constraints: "仅验证研究与需求；不声称自动部署完整系统。输出公开声明、推断、未知，不能编造测量。",
  });
}
const project = resumedRun?.raw?.project || await createEvaluationProject("评测 · Hermes 研究");
const report = {
  id, title: "亦伴 Personal Agent · 真实配对评测", createdAt: now(), status: "partial", sampleSize: tasks.length,
  projectId: project.id, projectIds: [project.id], cases: [], metrics: [], rawFiles: [],
  conditions: { source: "Hermes Agent 与 nanobot 官方仓库页的本次实时抓取快照（每例一个官方仓库，非安装实测）", baseline: "原版 buildPrompt + workerSchema，直接 Codex CLI，仅提供资料分析", agent: "nanobot 运行时 + 项目背景 + 结构化证据、需求和行动", provider: "codex", tools: "两组均禁用CLI工具与宿主skills发现，固定供给来源；read-only之外再限制执行能力", order: "每对先 Agent 抓取资料，后基线使用同一份快照；未随机化", projectBackgroundFile: "docs/LEGACY_WORKER.md", fixedProjectBackground: background },
  orchestrationNotes: resumedRun ? ["首次Agent执行中，评测驱动重启以启用与Agent同等工具隔离。已提交Agent未取消或重提；基线尚未开始，不增加模型调用。"] : [],
  limitations: ["两个研究配对样本，不能泛化为总体成功率或商业效益。", "为固定证据，每对先跑 Agent 再跑基线；存在运行顺序、模型非确定性与系统提示差异。", "官方 README 是功能声明，不是产品效果实测；没有体验竞品完整安装。", "执行完成与引用 ID 有效性均不能替代任务验收或事实正确性。", "跨会话测试使用明确标记的受控设定，不把虚构测试事实当作用户真实背景。", "事实审查由实现/验收人员对照来源完成，未做独立专家复核。", "没有模型独立账单，订阅用量不换算现金成本。", "原型单独验收，不计入研究样本分母。"],
};
try {
  const preflight = join(artifactDir, "preflight-2026-10-02");
  await access(preflight);
  await cp(preflight, join(folder, "preflight-attempt"), { recursive: true });
  report.preflight = JSON.parse(await readFile(join(preflight, "attempt.json"), "utf8"));
  report.orchestrationNotes.push("前置模型传输失败和服务恢复独立保留在 preflight-attempt/；未覆写成成功，也未用于正式配对分析效果分母。模型开始事件为3，observer尝试为4，实际完成/计费数量与Token无法确认。");
} catch {}
try {
  await access(join(folder, "recovery-validation"));
  report.orchestrationNotes.push("recovery-validation/ 保留真实技术恢复验证；它复用了旧输入直接调用 Provider，未经过完整 AgentRunner，单列且不混入正式指标。正式首尝试随后仍发现 AgentRunner 的90秒超时，此路径已另修复并保留失败。");
} catch {}
await saveReport(report, folder);

for (const [index, task] of tasks.entries()) {
  console.log(`Starting ${task.id}`);
  const caseFolder = join(folder, task.id);
  await mkdir(caseFolder, { recursive: true });
  const caseProject = index === 0 ? project : await createEvaluationProject("评测 · nanobot 需求");
  if (index !== 0) report.projectIds.push(caseProject.id);
  const run = await waitRun(index === 0 && resumedRun ? resumedRun : await api("/api/agent/runs", { projectId: caseProject.id, kind: "research", prompt: task.prompt, sourceUrls: task.sourceUrls }), caseFolder);
  await saveAgent(run, caseFolder);
  const documents = [{ name: "亦伴项目背景（固定）", text: background }, ...(run.sources || []).filter((source) => source.status === "fetched").map((source) => ({ name: `${source.title} (${source.url}; SHA256 ${source.sha256})`, text: source.text }))];
  const baseline = await codexBaseline(buildPrompt("worker", { title: task.title, prompt: task.prompt, kind: "竞品研究" }, documents, null), join(caseFolder, "baseline"));
  baseline.interventions = [];
  const entry = { ...task, projectId: caseProject.id, kind: "research", baseline, agent: { ...run, interventions: [], elapsedMs: Date.parse(run.completedAt || now()) - Date.parse(run.startedAt || run.createdAt) }, checks: {} };
  try {
    const previous = JSON.parse(await readFile(join(caseFolder, "attempt-1", "attempt.json"), "utf8"));
    entry.previousAttempts = [previous];
    entry.agent.interventions = previous.agent.interventions.concat([{ type: "resubmit", at: run.createdAt, reason: "Runtime AgentRunner timeout fixed; exactly one declared replacement for this logical sample, preserving initial cancellation." }]);
    entry.baseline.interventions = previous.baseline.interventions.concat([{ type: "resubmit", at: baseline.startedAt, reason: "Initial baseline was stopped while evaluation paused; new baseline uses the replacement Agent's same source snapshot." }]);
    report.orchestrationNotes.push("Hermes 首正式尝试因上游90秒超时与隐式重试被取消；评测驱动暂停时开始的基线也被终止。两者原始尝试保留在 research-memory/attempt-1/；首次结果未改写，修复后各重提交一次。暂停与修复操作单列，模型实际完成/计费用量缺失仍为未知。");
  } catch {}
  entry.checks = mechanicalChecks(entry);
  report.cases.push(entry);
  await saveReport(report, folder);
  console.log(`Completed ${task.id}: baseline ${baseline.status}, agent ${run.status}`);
  if (stopping) process.exit(143);
}

// A controlled capability test, separately labelled from real research sources.
const memoryFacts = [
  "受控评测设定：第一版范围为研究到需求闭环，不包含自动公开部署。",
  "受控评测设定：不允许自动向第三方发送消息。",
  "受控评测设定：演示团队人数是 3 人。",
];
const memoryProject = await createEvaluationProject("评测 · 跨会话记忆纠错");
report.projectIds.push(memoryProject.id);
let current = memoryProject;
const memory = (current.memory || []).concat(memoryFacts.map((text) => ({ id: randomUUID(), text, source: "evaluation-fixture", updatedAt: now() })));
await api(`/api/agent/projects/${memoryProject.id}`, { memory }, "PATCH");
function memoryScore(result, expectedPeople) {
  const text = facts(result);
  const people = expectedPeople === 3 ? "3|三" : "2|两|二";
  const values = [ /研究.{0,8}需求|研究到需求/.test(text), /不允许|禁止|不能|不自动/.test(text) && /第三方|发送消息/.test(text), new RegExp("(?:当前|纠正|现为|人数|团队|更正)[^\\n]{0,24}(?:" + people + ")\\s*人").test(text) ];
  return { matched: values.filter(Boolean).length, checks: values, method: "controlled-fact text check; manually confirm in raw output" };
}
const recallPrompt = "请回忆本项目保存的受控评测设定：第一版范围是什么？是否允许自动向第三方发送消息？演示团队当前有几人？如有已作废旧值，请明确区分；不知情时请说不知道。";
for (const expectedPeople of [3, 2]) {
  const corrected = memory.map((item) => item.text.includes("演示团队人数") ? { ...item, text: "受控评测设定：演示团队人数已纠正为 2 人，旧值 3 人已作废。", updatedAt: now() } : item);
  if (expectedPeople === 2) await api(`/api/agent/projects/${memoryProject.id}`, { memory: corrected }, "PATCH");
  const recall = { id: expectedPeople === 3 ? "memory-initial" : "memory-correction", title: expectedPeople === 3 ? "跨会话初始记忆召回" : "跨会话记忆与过时事实纠正", prompt: recallPrompt };
  const recallFolder = join(folder, recall.id);
  await mkdir(recallFolder, { recursive: true });
  const recallRun = await waitRun(await api("/api/agent/runs", { projectId: memoryProject.id, kind: "recall", prompt: recall.prompt, sourceUrls: [] }), recallFolder);
  await saveAgent(recallRun, recallFolder);
  await writeFile(join(recallFolder, "memory-fixture.json"), JSON.stringify({ initial: memoryFacts, current: expectedPeople === 3 ? memory : corrected, expectedPeople, operations: expectedPeople === 3 ? 1 : 2, purpose: "controlled test, not user personal facts" }, null, 2));
  const recallBaseline = await codexBaseline(buildPrompt("worker", { title: recall.title, prompt: recall.prompt, kind: "项目回忆" }, [], null), join(recallFolder, "baseline"));
  recallBaseline.interventions = [];
  const recallEntry = { ...recall, projectId: memoryProject.id, kind: "recall", baseline: recallBaseline, agent: { ...recallRun, interventions: [] }, checks: { memory: { baseline: memoryScore(recallBaseline.result, expectedPeople).matched, agent: memoryScore(recallRun.result, expectedPeople).matched, baselineDetails: memoryScore(recallBaseline.result, expectedPeople), agentDetails: memoryScore(recallRun.result, expectedPeople), expectedPeople, oldValueInvalidationRequiresReview: expectedPeople === 2 }, taskAcceptance: { baseline: null, agent: null } } };
  report.cases.push(recallEntry);
  await saveReport(report, folder);
  console.log(`Completed ${recall.id}: baseline ${recallBaseline.status}, agent ${recallRun.status}`);
}
console.log(JSON.stringify({ id, status: report.status, projectId: project.id, report: join(folder, "report.md"), reviewRequired: true }));
