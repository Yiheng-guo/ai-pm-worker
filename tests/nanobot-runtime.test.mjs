import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { getRuntimeStatus, runNanobot } from "../server/nanobot-runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("real nanobot plumbing: recovered stream, durable sessions, corrected memory, cancellation", async (t) => {
  const status = await getRuntimeStatus();
  if (!status.installed) return t.skip("Run bash runtime/setup.sh first");
  const id = randomUUID(), testDir = join(root, ".runtime", "tests", id);
  await mkdir(testDir, { recursive: true });
  const fake = join(testDir, "fake-codex");
  // This fixture replaces only the LLM. ContextBuilder/AgentLoop/Runner/session
  // persistence remain real; a separate live Codex smoke is recorded privately.
  await writeFile(fake, `#!/usr/bin/env python3
import json,sys,time,os
from pathlib import Path
if os.environ.get('CODEX_FIXTURE_EARLY_EXIT'):
 print('startup rejected unknown-fixture-feature; api_key=SHOULD_NEVER_BE_STORED https://user:PRIVATE_PASSWORD@example.com/v1?token=PRIVATE_QUERY',file=sys.stderr)
 print(json.dumps({'type':'turn.failed','error':{'message':'startup rejected unknown-fixture-feature; bearer SHOULD_NEVER_BE_STORED'}}))
 sys.exit(2)
text=sys.stdin.read()
args=sys.argv[1:]
assert '--disable' in args and 'shell_tool' in args and 'unified_exec' in args
outpath=Path(args[args.index('-o')+1])
outpath.with_suffix('.group.json').write_text(json.dumps({'sameGroup':os.getpgrp()==os.getpgid(os.getppid())}))
if 'CANCEL_TEST' in text: time.sleep(60)
if 'SLOW_BLOCKING_PROVIDER_TEST' in text: time.sleep(0.2)
if 'PROVIDER_FAIL_TEST' in text:
 print(json.dumps({'type':'turn.failed','error':{'message':'fixture failure'}}))
 sys.exit(1)
out={'answer':'测试运行完成','claims':[{'text':'可追溯的样例声明','sourceIds':['fixture'],'kind':'fact'}], 'valueJudgment':'测试', 'requirements':[], 'actions':[], 'memoryUpdates':[]}
if 'INVALID_SOURCE_TEST' in text: out['claims'][0]['sourceIds']=['does-not-exist']
if 'INVALID_SHAPE_TEST' in text: out['answer']=42
outpath.write_text(json.dumps(out,ensure_ascii=False))
print(json.dumps({'type':'error','message':'Reconnecting...'}))
print(json.dumps({'type':'turn.completed',**({} if 'UNREPORTED_USAGE_TEST' in text else {'usage':{'input_tokens':120,'cached_input_tokens':20,'output_tokens':12}})}))
`, { mode: 0o700 });
  const before = process.env.CODEX_BIN;
  process.env.CODEX_BIN = fake;
  const project = { id: `test-${id}`, name: "测试项目", background: "输入资料", goal: "测试", constraints: [], memory: ["用户确认 OLD_MEMORY"] };
  const input = { project, prompt: "验证运行契约", sources: [{ id: "fixture", title: "测试原文", url: "https://example.com", text: "样例声明" }], settings: { provider: "codex", apiKey: "SHOULD_NEVER_BE_STORED" }, sessionId: "persisted" };
  try {
    const first = await runNanobot(input);
    assert.equal(first.engine.name, "nanobot");
    assert.deepEqual(first.engine.toolNames, []);
    assert.equal(first.usage.inputTokens, 120);
    assert.equal(first.usage.cost, null);
    assert.equal(first.raw.session.previousMessageCount, 0);
    assert.equal(JSON.stringify(first.raw).includes("SHOULD_NEVER_BE_STORED"), false);
    const group = JSON.parse(await readFile(join(first.raw.recordPath.slice(0, -5), "call-1", "output.group.json"), "utf8"));
    assert.equal(group.sameGroup, true, "Codex must share bridge's cancellable process group");
    const second = await runNanobot({ ...input, project: { ...project, memory: ["用户纠正 NEW_MEMORY"] } });
    assert.ok(second.raw.session.previousMessageCount >= 2);
    const auditDir = second.raw.recordPath.slice(0, -5);
    const recorded = JSON.parse(await readFile(join(auditDir, "call-1", "input.json"), "utf8"));
    assert.ok(recorded.messages[0].content.includes("NEW_MEMORY"));
    assert.ok(!recorded.messages[0].content.includes("OLD_MEMORY"));
    const fresh = await runNanobot({ ...input, project: { ...project, memory: ["用户纠正 NEW_MEMORY"] }, sessionId: "fresh" });
    assert.equal(fresh.raw.session.previousMessageCount, 0);
    const controller = new AbortController();
    let called = false;
    await assert.rejects(runNanobot({ ...input, sessionId: "cancel", prompt: "CANCEL_TEST", signal: controller.signal,
      onEvent: e => { if (e.stage === "model") { called = true; setTimeout(() => controller.abort(), 150); } } }), error => {
      assert.equal(error.name, "AbortError");
      assert.ok(error.raw?.recordPath, "Cancelled input audit must be returned");
      return true;
    });
    assert.equal(called, true);
    await assert.rejects(runNanobot({ ...input, sessionId: "invalid", prompt: "INVALID_SOURCE_TEST" }), error => {
      assert.match(error.message, /不存在的证据/);
      assert.ok(error.raw.output.includes("does-not-exist"), "Invalid citations remain in raw audit");
      return true;
    });
    await assert.rejects(runNanobot({ ...input, sessionId: "provider-fail", prompt: "PROVIDER_FAIL_TEST" }), (error) => {
      assert.match(error.message, /真实模型调用失败.*fixture failure/);
      assert.equal(error.raw.calls.length, 1, "Terminal provider failure must not start hidden retry calls");
      assert.equal(error.usage.requestCount, 1);
      assert.equal(error.usage.reported, false);
      assert.equal(error.usage.inputTokens, null);
      return true;
    });
    process.env.CODEX_FIXTURE_EARLY_EXIT = "1";
    try {
      await assert.rejects(runNanobot({ ...input, sessionId: "early-exit", prompt: "大输入测试".repeat(2000) }), (error) => {
        assert.match(error.message, /unknown-fixture-feature/);
        assert.equal(error.raw.calls.length, 1);
        assert.equal(error.raw.calls[0].attempt, 1);
        assert.equal(error.raw.calls[0].exitCode, 2);
        assert.match(error.raw.calls[0].stderrSummary, /startup rejected unknown-fixture-feature/);
        const audit = JSON.stringify(error.raw);
        assert.equal(audit.includes("SHOULD_NEVER_BE_STORED"), false);
        assert.equal(audit.includes("PRIVATE_PASSWORD"), false);
        assert.equal(audit.includes("PRIVATE_QUERY"), false);
        assert.equal(error.usage.requestCount, 1);
        return true;
      });
    } finally { delete process.env.CODEX_FIXTURE_EARLY_EXIT; }
    const missing = await runNanobot({ ...input, sessionId: "unreported", prompt: "UNREPORTED_USAGE_TEST" });
    assert.equal(missing.usage.inputTokens, null, "Observer token estimates must not become reported usage");
    assert.equal(missing.usage.outputTokens, null);
    assert.equal(missing.usage.cachedTokens, null);
    assert.equal(missing.usage.reported, false);
    const oldIdle = process.env.NANOBOT_STREAM_IDLE_TIMEOUT_S;
    process.env.NANOBOT_STREAM_IDLE_TIMEOUT_S = "0.05";
    try {
      const delayed = await runNanobot({ ...input, sessionId: "delayed", prompt: "SLOW_BLOCKING_PROVIDER_TEST" });
      assert.equal(delayed.raw.calls.length, 1, "Blocking CLI must own its deadline, without nanobot stream-idle cancellation/retries");
      assert.equal(delayed.raw.calls[0].finishReason, "stop");
      assert.equal(delayed.usage.requestCount, 1);
    } finally {
      if (oldIdle === undefined) delete process.env.NANOBOT_STREAM_IDLE_TIMEOUT_S;
      else process.env.NANOBOT_STREAM_IDLE_TIMEOUT_S = oldIdle;
    }
    await assert.rejects(runNanobot({ ...input, sessionId: "shape", prompt: "INVALID_SHAPE_TEST" }), (error) => {
      assert.match(error.message, /结构校验.*answer.*valid string/);
      assert.ok(error.raw.output.includes('"answer": 42'));
      return true;
    });
  } finally {
    if (before === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = before;
    await rm(testDir, { recursive: true, force: true });
  }
});

test("unavailable Python runtime is a lazy status failure, not an application import failure", async () => {
  const output = await new Promise((resolveOutput, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", "import {getRuntimeStatus} from './server/nanobot-runtime.mjs'; console.log(JSON.stringify(await getRuntimeStatus()));"], {
      cwd: root, env: { ...process.env, NANOBOT_PYTHON: join(root, ".runtime", "does-not-exist") }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = ""; child.stdout.on("data", c => { stdout += c; });
    child.on("error", reject); child.on("close", code => code === 0 ? resolveOutput(stdout) : reject(new Error("Status fixture failed")));
  });
  const status = JSON.parse(output);
  assert.equal(status.installed, false);
  assert.match(status.message, /尚未安装/);
});
