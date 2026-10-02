import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const python = process.env.NANOBOT_PYTHON || join(root, ".runtime", ".venv", "bin", "python");
const bridge = join(root, "runtime", "bridge.py");
export const NANOBOT_COMMIT = "d0d0a44e57632c3d269e511339cff7ddb698e62e";
const projectTurns = new Map();

function diagnostic(value, payload) {
  let text = String(value || "");
  const secrets = [payload?.settings?.apiKey, ...Object.entries(process.env)
    .filter(([key]) => /API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|PASSWORD|SECRET/i.test(key))
    .map(([, secret]) => secret)].filter(Boolean);
  for (const secret of secrets) text = text.split(secret).join("[REDACTED]");
  return text.replace(/\bsk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(bearer\s+)[^\s"'<>]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)["']?\s*[=:]\s*["']?)[^\s,;"'<>]+/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s"'<>]+/g, (value) => {
      try { const url = new URL(value); return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}${url.search ? "?[REDACTED]" : ""}`; }
      catch { return "[REDACTED URL]"; }
    }).slice(-2000);
}

export async function invokeNanobotProtocol(payload, { signal, onEvent, status = false, pythonExecutable = python, bridgePath = bridge } = {}) {
  if (signal?.aborted) throw Object.assign(new Error("任务已取消"), { name: "AbortError" });
  try { await access(pythonExecutable, constants.X_OK); }
  catch { throw new Error("nanobot 运行环境尚未安装，请运行 bash runtime/setup.sh。"); }
  return new Promise((resolveResult, reject) => {
    const child = spawn(pythonExecutable, [bridgePath, ...(status ? ["--status"] : [])], {
      cwd: root, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32",
      env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1", NANOBOT_BRIDGE_ROOT: root },
    });
    let buffer = "", stderr = "", lastResult, failure, settled = false, cancelled = false, timedOut = false, killTimer;
    const kill = () => {
      try { process.platform === "win32" ? child.kill("SIGTERM") : process.kill(-child.pid, "SIGTERM"); }
      catch { /* Process may already have exited. */ }
      killTimer ||= setTimeout(() => {
        try { process.platform === "win32" ? child.kill("SIGKILL") : process.kill(-child.pid, "SIGKILL"); }
        catch { /* Process already closed. */ }
      }, 4000);
      killTimer.unref();
    };
    const abort = () => { cancelled = true; kill(); };
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; kill(); }, status ? 20000 : 620000);
    timer.unref();
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolveResult(value);
    };
    const consume = (line) => {
      if (!line.trim()) return;
      try {
        const record = JSON.parse(line);
        if (record.type === "event") {
          // Callbacks cannot alter the child protocol or cause an unhandled rejection.
          try { Promise.resolve(onEvent?.(record.event)).catch(() => {}); } catch { /* UI observer */ }
        } else if (record.type === "result") lastResult = record.result;
        else if (record.type === "error") failure = record;
        else if (status) lastResult = record;
      } catch { failure = { message: "nanobot 运行时返回了无效协议数据。" }; }
    };
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 4 * 1024 * 1024) { failure = { message: "nanobot 输出超过限制。" }; kill(); }
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
    });
    // Keep a bounded, in-memory diagnostic for crashes before the safe protocol
    // starts. Only the redacted summary can leave this process.
    child.stderr.on("data", (chunk) => { if (stderr.length < 65536) stderr += chunk.toString(); });
    child.on("error", (error) => finish(new Error(`无法启动 nanobot Python 运行时：${diagnostic(error.message, payload)}`)));
    child.on("close", (code) => {
      consume(buffer);
      const receipt = { raw: lastResult?.raw || failure?.raw, usage: lastResult?.usage || failure?.usage, ...(lastResult ? { returnedOutput: lastResult } : {}) };
      if (cancelled) return finish(Object.assign(new Error("任务已取消"), { name: "AbortError", ...receipt }));
      if (timedOut) return finish(Object.assign(new Error("nanobot 运行超时；原始输入已保存在私有运行记录。"), receipt));
      if (failure || code !== 0 || !lastResult) {
        const detail = diagnostic(failure?.message || stderr, payload);
        const error = new Error(detail || `nanobot 运行失败（进程退出码 ${code}）。请检查本机 Codex 登录或模型设置。`);
        if (failure?.raw) error.raw = failure.raw;
        if (failure?.usage) error.usage = failure.usage;
        return finish(error);
      }
      finish(null, lastResult);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(status ? "" : JSON.stringify(payload));
  });
}

export async function getRuntimeStatus() {
  try { return await invokeNanobotProtocol(null, { status: true }); }
  catch (error) { return { installed: false, name: "nanobot", version: null, commit: NANOBOT_COMMIT, message: error.message }; }
}

export async function runNanobot({ project, prompt, sources = [], history = [], sessionId, kind = "research", settings = {}, signal, onEvent }) {
  if (!project?.id || !project?.name || typeof prompt !== "string" || !prompt.trim())
    throw new Error("项目 ID、项目名称和任务目标不能为空。");
  if (!["research", "recall"].includes(kind)) throw new Error("不支持的研究任务类型。");
  if (settings.provider === "demo") throw new Error("研究 Agent 需要真实模型；演示模板不能冒充 nanobot 结果。");
  const input = { project, prompt, sources, history, sessionId: sessionId || "default", kind,
    settings: { provider: settings.provider || "codex", model: settings.model || "", baseUrl: settings.baseUrl || "", ...(settings.apiKey ? { apiKey: settings.apiKey } : {}) } };
  // One project turn at a time prevents concurrent Python processes from
  // overwriting the same session or racing a user correction of project memory.
  const previous = projectTurns.get(project.id) || Promise.resolve();
  const execution = previous.catch(() => {}).then(() => invokeNanobotProtocol(input, { signal, onEvent }));
  projectTurns.set(project.id, execution);
  try { return await execution; }
  finally { if (projectTurns.get(project.id) === execution) projectTurns.delete(project.id); }
}
