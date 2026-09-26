import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsonSchema, parseResult } from "./schemas.mjs";
export const CODEX_BIN = process.env.CODEX_BIN || "codex";
export async function runModel(provider, prompt, schema, settings, signal) {
  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY || settings.apiKey;
    if (!key) throw new Error("请在设置中填写 API Key，或选择已登录的 Codex。");
    if (!settings.model) throw new Error("请在设置中填写模型名称。");
    const url = new URL(
      settings.baseUrl.replace(/\/$/, "") + "/chat/completions",
    );
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    )
      throw new Error("模型地址必须使用 HTTPS，本地接口可用 HTTP。");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(240000)]),
    });
    if (!response.ok)
      throw new Error(
        `模型接口返回 HTTP ${response.status}，请检查模型名称、额度和接口地址。`,
      );
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (typeof raw !== "string") throw new Error("模型未返回文本内容。");
    return parseResult(raw, schema);
  }
  if (provider === "codex") {
    const dir = await mkdtemp(join(tmpdir(), "ai-pm-model-"));
    try {
      await writeFile(
        join(dir, "schema.json"),
        JSON.stringify(jsonSchema(schema)),
      );
      await new Promise((resolve, reject) => {
        const child = spawn(
          CODEX_BIN,
          [
            "exec",
            "--ignore-user-config",
            "--skip-git-repo-check",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--color",
            "never",
            "--output-schema",
            join(dir, "schema.json"),
            "-o",
            join(dir, "result.json"),
            "-",
          ],
          { cwd: dir, stdio: ["pipe", "pipe", "pipe"], signal },
        );
        let output = "";
        child.stdout.on("data", () => {});
        child.stderr.on("data", (chunk) => {
          output = (output + chunk.toString()).slice(-2000);
        });
        const timeout = setTimeout(() => child.kill("SIGTERM"), 600000);
        child.on("error", (e) => {
          clearTimeout(timeout);
          reject(
            new Error(
              e.name === "AbortError"
                ? "任务已取消"
                : "未能启动 Codex。请安装 Codex CLI 并运行 codex login。",
            ),
          );
        });
        child.on("close", (code) => {
          clearTimeout(timeout);
          if (code === 0) resolve();
          else
            reject(
              new Error(
                signal.aborted
                  ? "任务已取消"
                  : `Codex 生成失败（退出码 ${code ?? "timeout"}）。请检查登录状态与可用额度。`,
              ),
            );
        });
        child.stdin.on("error", () => {});
        child.stdin.end(prompt);
      });
      return parseResult(
        await readFile(join(dir, "result.json"), "utf8"),
        schema,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  throw new Error("未知模型提供方");
}
