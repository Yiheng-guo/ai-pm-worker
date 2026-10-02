import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { invokeNanobotProtocol } from "../server/nanobot-runtime.mjs";

async function protocolFixture(t, records) {
  const dir = await mkdtemp(join(tmpdir(), "nanobot-protocol-"));
  const path = join(dir, "fixture.mjs");
  await writeFile(path, `process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),5));\n${records.map(r => "process.stdout.write(" + JSON.stringify(JSON.stringify(r) + "\n") + ");").join("\n")}\nsetInterval(()=>{},1000);\n`);
  t.after(() => rm(dir, { recursive: true, force: true }));
  const controller = new AbortController();
  return invokeNanobotProtocol({}, { pythonExecutable: process.execPath, bridgePath: path, signal: controller.signal, onEvent: () => controller.abort() });
}
test("协议结果已到达但close前取消，returnedOutput/raw/usage完整保留且不虚报零成本", async t => {
  const result = { answer: "already returned", raw: { output: "unchanged", calls: [1] }, usage: { inputTokens: 123, requestCount: 1, cost: null }, engine: { name: "protocol-fixture" } };
  await assert.rejects(protocolFixture(t, [{ type: "result", result }, { type: "event", event: "abort now" }]), error => { assert.equal(error.name, "AbortError"); assert.deepEqual(error.returnedOutput, result); assert.deepEqual(error.raw, result.raw); assert.deepEqual(error.usage, result.usage); return true; });
});
test("未返回结果的取消仍保留运行时failure记录和已报告请求数", async t => {
  const failure = { type: "error", message: "cancelled upstream", raw: { output: "partial", calls: [1] }, usage: { inputTokens: null, requestCount: 1, cost: null } };
  await assert.rejects(protocolFixture(t, [failure, { type: "event", event: "abort now" }]), error => { assert.equal(error.returnedOutput, undefined); assert.deepEqual(error.raw, failure.raw); assert.deepEqual(error.usage, failure.usage); return true; });
});
test("没有任何用量回执时取消，不制造requestCount0或Token0", async t => {
  await assert.rejects(protocolFixture(t, [{ type: "event", event: "abort now" }]), error => { assert.equal(error.name, "AbortError"); assert.equal(error.usage, undefined); assert.equal(error.raw, undefined); return true; });
});
