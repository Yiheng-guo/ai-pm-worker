import { publicBootstrap } from "./public-examples.mjs";
import express from "express";
import multer from "multer";
import JSZip from "jszip";
import mammoth from "mammoth";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createStore } from "./store.mjs";
import { requestSchema, workerSchema, fragmentSchema } from "./schemas.mjs";
import { buildPrompt } from "./prompts.mjs";
import { runModel } from "./provider.mjs";
import {
  workerTemplates,
  factoryTemplates,
  demoWorker,
  demoFactory,
} from "./templates.mjs";
import { waitUntil } from "@vercel/functions";
import {
  authenticated,
  equalSecret,
  sessionValue,
  encryptKey,
  decryptKey,
} from "./auth.mjs";
const cloud = !!process.env.VERCEL;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const product = JSON.parse(readFileSync(join(root, "product.json"), "utf8"));
const mode = product.id;
const port = Number(process.env.PORT || product.port);
const dataDir = resolve(process.env.OFFICE_DATA_DIR || join(root, "data"));
const store = await createStore(dataDir);
const app = express();
app.disable("x-powered-by");
const allowedHosts = new Set([
  `127.0.0.1:${port}`,
  `localhost:${port}`,
  `127.0.0.1:${product.devPort}`,
  `localhost:${product.devPort}`,
]);
app.use((req, res, next) => {
  if (!cloud && !allowedHosts.has(req.headers.host))
    return res.status(403).json({ error: "只接受本地工作台请求。" });
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (
        cloud
          ? new URL(origin).host !== req.headers.host
          : !allowedHosts.has(new URL(origin).host)
      )
        return res.status(403).json({ error: "不允许跨站请求。" });
    } catch {
      return res.status(403).json({ error: "无效来源。" });
    }
  }
  if (req.headers["sec-fetch-site"] === "cross-site")
    return res.status(403).json({ error: "不允许跨站请求。" });
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.path.startsWith("/api/"))
    res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});
app.use(express.json({ limit: "2mb" }));
app.get("/api/auth", async (req, res) =>
  res.json({ authenticated: authenticated(req), cloud, product }),
);
app.post("/api/login", async (req, res) => {
  if (!equalSecret(req.body.password, process.env.WORKSPACE_PASSWORD))
    return res.status(401).json({ error: "访问口令不正确。" });
  res.setHeader(
    "Set-Cookie",
    `pm_session=${sessionValue(process.env.WORKSPACE_PASSWORD)}; HttpOnly; ${cloud ? "Secure; " : ""}SameSite=Strict; Path=/; Max-Age=604800`,
  );
  res.json({ ok: true });
});
app.post("/api/logout", (_, res) => {
  res.setHeader(
    "Set-Cookie",
    "pm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
  );
  res.json({ ok: true });
});
app.get("/api/public/bootstrap", (_, res) =>
  res.json(publicBootstrap(product, cloud)),
);
app.get("/api/public/jobs/:id/download", (req, res) => {
  const job = publicBootstrap(product, cloud).jobs.find(
    (j) => j.id === req.params.id,
  );
  if (!job?.result.markdown)
    return res.status(404).json({ error: "公开示例不存在。" });
  res.attachment("public-example.md").send(job.result.markdown);
});
app.get("/api/public/projects/:id/download", async (req, res) => {
  const project = publicBootstrap(product, cloud).projects.find(
    (p) => p.id === req.params.id,
  );
  const version = project?.versions.find(
    (v) => !req.query.version || v.id === req.query.version,
  );
  if (!version) return res.status(404).json({ error: "公开示例不存在。" });
  const zip = new JSZip();
  zip.file("index.html", version.code);
  zip.file("PRD.md", version.prd);
  res
    .attachment("public-example.zip")
    .send(await zip.generateAsync({ type: "nodebuffer" }));
});
app.use("/api", (req, res, next) => {
  if (req.path === "/health") return next();
  if (!authenticated(req))
    return res.status(401).json({ error: "请先使用访问口令进入工作空间。" });
  next();
});
let apiKey = "";
const controllers = new Map();
const settingsDefaults = {
  id: "settings",
  provider: "demo",
  baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  model: process.env.OPENAI_MODEL || "",
};
async function settings() {
  const saved = await store.get("settings");
  return {
    ...settingsDefaults,
    ...saved,
    apiKey: cloud ? decryptKey(saved?.encryptedApiKey) : apiKey,
  };
}
async function safeSettings() {
  const s = await settings();
  const hasApiKey = !!(s.apiKey || process.env.OPENAI_API_KEY);
  delete s.apiKey;
  delete s.encryptedApiKey;
  return { ...s, hasApiKey, cloud };
}
async function event(job, message) {
  job.events.push({ at: new Date().toISOString(), message });
  await store.put("job", job);
}
if (!cloud)
  for (const job of await store.list("job"))
    if (["running", "queued"].includes(job.status)) {
      job.status = "failed";
      job.error = "服务重启中断了任务，请重试。";
      await store.put("job", job);
    }
app.get("/api/health", (_, res) =>
  res.json({ ok: true, product: mode, version: "0.1.0" }),
);
app.get("/api/bootstrap", async (_, res) => {
  const [config, jobs, documents, projects] = await Promise.all([
    safeSettings(),
    store.list("job"),
    store.list("document"),
    store.list("project"),
  ]);
  res.json({
    product,
    access: "private",
    settings: config,
    templates: mode === "worker" ? workerTemplates : factoryTemplates,
    jobs,
    documents: documents.map(({ text, ...d }) => d),
    projects,
  });
});
app.get("/api/jobs/:id", async (req, res) => {
  const job = await store.get(req.params.id, "job");
  if (!job || !job.status)
    return res.status(404).json({ error: "任务不存在。" });
  res.json(job);
});
app.put("/api/settings", async (req, res) => {
  const parsed = z
    .object({
      provider: z.enum(["demo", "codex", "openai"]),
      baseUrl: z.string().url().max(500),
      model: z.string().max(120),
      apiKey: z.string().max(1000).optional(),
    })
    .parse(req.body);
  const old = await store.get("settings");
  let encryptedApiKey = old?.encryptedApiKey || "";
  if (parsed.apiKey !== undefined) {
    if (cloud) encryptedApiKey = encryptKey(parsed.apiKey);
    else apiKey = parsed.apiKey;
  }
  if (cloud && parsed.provider === "codex")
    return res
      .status(400)
      .json({ error: "线上请使用 API 模型。Codex 仅支持本机运行。" });
  delete parsed.apiKey;
  await store.put("settings", { id: "settings", ...parsed, encryptedApiKey });
  res.json(await safeSettings());
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});
app.post("/api/documents", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "请选择资料文件。" });
  let name = Buffer.from(req.file.originalname, "latin1").toString("utf8");
  if (name.includes("�")) name = req.file.originalname;
  let text = "";
  if (/\.(txt|md|csv|json)$/i.test(name))
    text = req.file.buffer.toString("utf8");
  else if (/\.docx$/i.test(name))
    text = (await mammoth.extractRawText({ buffer: req.file.buffer })).value;
  else if (/\.pdf$/i.test(name)) {
    const canvas = await import("@napi-rs/canvas");
    globalThis.DOMMatrix ||= canvas.DOMMatrix;
    globalThis.ImageData ||= canvas.ImageData;
    globalThis.Path2D ||= canvas.Path2D;
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(req.file.buffer) });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else
    return res
      .status(400)
      .json({ error: "支持 TXT、Markdown、CSV、JSON、DOCX 和文字版 PDF。" });
  if (!text.trim())
    return res
      .status(400)
      .json({ error: "未读取到文字。扫描版 PDF 请先进行 OCR。" });
  if (text.length > 65000)
    return res
      .status(400)
      .json({ error: "材料超过 65,000 字符，请拆分后上传。" });
  const doc = {
    id: randomUUID(),
    name,
    text,
    chars: text.length,
    createdAt: new Date().toISOString(),
  };
  await store.put("document", doc);
  const { text: _, ...meta } = doc;
  res.status(201).json(meta);
});
app.delete("/api/documents/:id", async (req, res) => {
  const d = await store.get(req.params.id, "document");
  if (!d?.text) return res.status(404).json({ error: "资料不存在。" });
  await store.delete(d.id, "document");
  res.json({ ok: true });
});
async function createJob(body, projectId = null) {
  const input = requestSchema.parse(body);
  const docs = await Promise.all(
    input.documentIds.map((id) => store.get(id, "document")),
  );
  if (docs.some((d) => !d?.text))
    throw new Error("所选资料已删除，请重新选择。");
  if (docs.reduce((n, d) => n + d.text.length, 0) > 65000)
    throw new Error("所选资料总量超过 65,000 字符，请分批处理。");
  if (controllers.size >= 2)
    throw new Error("当前有两个任务在执行，请等待完成后再提交。");
  const config = await settings();
  const provider = input.provider || config.provider;
  if (cloud && provider === "codex")
    throw new Error("线上版本无法调用本机 Codex，请选择 API 模型。");
  const job = {
    ...input,
    id: randomUUID(),
    mode,
    provider,
    projectId,
    status: "queued",
    createdAt: new Date().toISOString(),
    events: [],
    result: null,
    error: null,
  };
  await store.put("job", job);
  const controller = new AbortController();
  controllers.set(job.id, controller);
  const execute = async () => {
    try {
      if (controller.signal.aborted) return;
      job.status = "running";
      await event(job, "任务已创建，正在整理输入");
      await event(
        job,
        `已载入 ${docs.length} 份资料；${provider === "demo" ? "使用演示模板，未调用 AI" : provider === "codex" ? "正在调用本机 Codex" : "正在请求模型接口"}`,
      );
      const previous = projectId ? await store.get(projectId, "project") : null;
      if (projectId && !previous?.versions) throw new Error("项目不存在。");
      const result =
        provider === "demo"
          ? mode === "worker"
            ? demoWorker(job, docs)
            : demoFactory(job)
          : await runModel(
              provider,
              buildPrompt(mode, job, docs, previous?.versions.at(-1)),
              mode === "worker" ? workerSchema : fragmentSchema,
              config,
              controller.signal,
            );
      if (
        controller.signal.aborted ||
        (await store.get(job.id, "job"))?.status === "cancelled"
      )
        return;
      if (mode === "factory" && !/<html[\s>]/i.test(result.code))
        throw new Error("模型没有返回完整 HTML 应用，请重试。");
      job.result = result;
      if (mode === "factory") {
        const project = previous || {
          id: randomUUID(),
          title: result.title,
          description: result.description,
          kind: job.kind,
          createdAt: job.createdAt,
          versions: [],
        };
        project.versions.push({
          ...result,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          prompt: job.prompt,
          provider,
        });
        project.updatedAt = new Date().toISOString();
        project.title = result.title;
        project.description = result.description;
        await store.put("project", project);
        job.projectId = project.id;
      }
      job.status = "completed";
      job.completedAt = new Date().toISOString();
      await event(job, "交付物已校验并保存");
    } catch (e) {
      if (!controller.signal.aborted) {
        job.status = "failed";
        job.error =
          e instanceof z.ZodError
            ? "模型返回格式不符合要求，请重试。"
            : e.message;
        await event(job, "任务未完成，已保留输入，可重试");
      }
    } finally {
      controllers.delete(job.id);
    }
  };
  const execution = execute();
  if (cloud) waitUntil(execution);
  return job;
}
app.post("/api/jobs", async (req, res) =>
  res.status(202).json(await createJob(req.body)),
);
app.post("/api/jobs/:id/cancel", async (req, res) => {
  const job = await store.get(req.params.id, "job");
  if (!job?.status) return res.status(404).json({ error: "任务不存在。" });
  if (!["queued", "running"].includes(job.status))
    return res.status(409).json({ error: "任务已结束。" });
  controllers.get(job.id)?.abort();
  job.status = "cancelled";
  await event(job, "任务已取消");
  res.json(job);
});
app.post("/api/jobs/:id/retry", async (req, res) => {
  const job = await store.get(req.params.id, "job");
  if (!job?.status) return res.status(404).json({ error: "任务不存在。" });
  if (["queued", "running"].includes(job.status))
    return res.status(409).json({ error: "任务仍在执行。" });
  res
    .status(202)
    .json(
      await createJob(
        { ...job, provider: (await settings()).provider },
        job.projectId && job.status !== "completed" ? job.projectId : null,
      ),
    );
});
app.patch("/api/jobs/:id/actions/:index", async (req, res) => {
  const job = await store.get(req.params.id, "job");
  const index = Number(req.params.index);
  if (!job?.result?.actions?.[index])
    return res.status(404).json({ error: "行动项不存在。" });
  const { done } = z.object({ done: z.boolean() }).parse(req.body);
  job.result.actions[index].done = done;
  await store.put("job", job);
  res.json(job);
});
app.get("/api/jobs/:id/download", async (req, res) => {
  const job = await store.get(req.params.id, "job");
  if (!job?.result?.markdown)
    return res.status(404).json({ error: "文档尚未生成。" });
  res
    .attachment("deliverable.md")
    .type("text/markdown; charset=utf-8")
    .send(job.result.markdown);
});
app.get("/api/projects/:id", async (req, res) => {
  const p = await store.get(req.params.id, "project");
  if (!p?.versions) return res.status(404).json({ error: "项目不存在。" });
  res.json(p);
});
app.post("/api/projects/:id/revise", async (req, res) => {
  if (mode !== "factory")
    return res.status(404).json({ error: "此项目不提供产品工厂功能。" });
  const p = await store.get(req.params.id, "project");
  if (!p?.versions) return res.status(404).json({ error: "项目不存在。" });
  res
    .status(202)
    .json(await createJob({ ...req.body, title: p.title, kind: p.kind }, p.id));
});
app.get("/api/projects/:id/download", async (req, res) => {
  const p = await store.get(req.params.id, "project");
  if (!p?.versions) return res.status(404).json({ error: "项目不存在。" });
  const v = req.query.version
    ? p.versions.find((v) => v.id === req.query.version)
    : p.versions.at(-1);
  if (!v) return res.status(404).json({ error: "版本不存在。" });
  const zip = new JSZip();
  zip.file("index.html", v.code);
  zip.file("PRD.md", v.prd);
  zip.file(
    "README.md",
    `# ${v.title}\n\n${v.description}\n\n## 运行\n\n使用 Python 3 在本目录执行：\n\n\`\`\`sh\npython3 -m http.server 8080 --bind 127.0.0.1\n\`\`\`\n\n打开 http://127.0.0.1:8080 。也可以直接打开 index.html（部分浏览器限制本地存储）。\n\n## 交付范围\n\n这是独立浏览器原型。模型来源：${v.provider}。没有服务器数据库、账号体系、多人协作或自动部署。示例数据不是业务数据。使用前检查交互与生成代码。\n`,
  );
  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        title: v.title,
        version: v.id,
        createdAt: v.createdAt,
        provider: v.provider,
        files: ["index.html", "PRD.md", "README.md"],
      },
      null,
      2,
    ),
  );
  res
    .attachment("product-source.zip")
    .type("application/zip")
    .send(await zip.generateAsync({ type: "nodebuffer" }));
});
if (!cloud && existsSync(join(root, "dist"))) {
  app.use(express.static(join(root, "dist")));
  app.get("/{*splat}", async (req, res) => {
    if (req.path.startsWith("/api/"))
      return res.status(404).json({ error: "接口不存在。" });
    res.sendFile(join(root, "dist/index.html"));
  });
}
app.use((error, req, res, next) => {
  const message =
    error instanceof z.ZodError
      ? "输入格式不正确，请检查必填项。"
      : error.code === "LIMIT_FILE_SIZE"
        ? "文件不能超过 8 MB。"
        : error.message || "请求失败。";
  res.status(400).json({ error: message });
});
export default app;
if (!cloud) {
  const server = app.listen(port, "127.0.0.1", () =>
    console.log(`${product.name} → http://127.0.0.1:${port}`),
  );
  function shutdown() {
    for (const c of controllers.values()) c.abort();
    server.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
