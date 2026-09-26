import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { equalSecret, encryptKey, decryptKey } from "../server/auth.mjs";
import { createStore } from "../server/store.mjs";
import {
  workerSchema,
  fragmentSchema,
  parseResult,
} from "../server/schemas.mjs";
const product = JSON.parse(
  readFileSync(new URL("../product.json", import.meta.url), "utf8"),
);
const port = product.id === "worker" ? 4430 : 4440;
const base = `http://127.0.0.1:${port}`;
let child,
  dir,
  cookie = "",
  docId,
  job;
const secret = "integration-test-only-password";
async function request(path, options = {}) {
  return fetch(base + "/api" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      ...options.headers,
    },
  });
}
async function json(path, method = "GET", data) {
  const r = await request(path, {
    method,
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  return { status: r.status, data: await r.json() };
}
async function waitJob(id) {
  for (let i = 0; i < 80; i++) {
    const r = await json("/jobs/" + id);
    if (!["queued", "running"].includes(r.data.status)) return r.data;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Task did not finish");
}
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "pm-test-"));
  child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      VERCEL: "",
      PORT: String(port),
      OFFICE_DATA_DIR: dir,
      WORKSPACE_PASSWORD: secret,
    },
    stdio: "pipe",
  });
  let logs = "";
  child.stderr.on("data", (b) => (logs += b.toString()));
  child.stdout.on("data", (b) => (logs += b.toString()));
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Server did not start: " + logs);
});
after(async () => {
  child?.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 200));
  await rm(dir, { recursive: true, force: true });
});
test("workspace rejects anonymous reads and incorrect login", async () => {
  assert.equal((await json("/bootstrap")).status, 401);
  assert.equal(
    (await json("/login", "POST", { password: "incorrect" })).status,
    401,
  );
  const r = await request("/login", {
    method: "POST",
    body: JSON.stringify({ password: secret }),
  });
  assert.equal(r.status, 200);
  cookie = r.headers.get("set-cookie").split(";")[0];
  assert.match(r.headers.get("set-cookie"), /HttpOnly/);
  const b = await json("/bootstrap");
  assert.equal(b.status, 200);
  assert.equal(b.data.product.id, product.id);
  assert.equal(b.data.jobs.length, 0);
});
test("rejects cross-site mutation", async () => {
  const r = await request("/jobs", {
    method: "POST",
    headers: { Origin: "https://untrusted.example" },
    body: "{}",
  });
  assert.equal(r.status, 403);
});
test("rejects invalid task before creating a record", async () => {
  assert.equal(
    (await json("/jobs", "POST", { title: "", prompt: "a", kind: "prd" }))
      .status,
    400,
  );
  assert.equal((await json("/bootstrap")).data.jobs.length, 0);
});
test("reads UTF-8 source material and rejects unsupported types", async () => {
  const form = new FormData();
  form.append(
    "file",
    new Blob(["用户 A：我希望找到每条洞察对应的原话。"], {
      type: "text/plain",
    }),
    "访谈.md",
  );
  const r = await fetch(base + "/api/documents", {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  assert.equal(r.status, 201);
  const d = await r.json();
  assert.equal(d.name, "访谈.md");
  assert.ok(d.chars > 10);
  docId = d.id;
  const bad = new FormData();
  bad.append("file", new Blob(["bad"]), "bad.exe");
  assert.equal(
    (
      await fetch(base + "/api/documents", {
        method: "POST",
        headers: { Cookie: cookie },
        body: bad,
      })
    ).status,
    400,
  );
});
test("completes a task and persists a source-labelled artifact", async () => {
  const r = await json("/jobs", "POST", {
    title: "验收任务",
    prompt: "整理用户访谈并产出一个可使用的结果。",
    kind: product.id === "worker" ? "interview" : "roadmap",
    documentIds: [docId],
    provider: "demo",
  });
  assert.equal(r.status, 202);
  job = await waitJob(r.data.id);
  assert.equal(job.status, "completed");
  assert.equal(job.provider, "demo");
  assert.ok(job.events.length >= 3);
  if (product.id === "worker") {
    assert.match(job.result.markdown, /演示模式/);
    assert.match(job.result.markdown, /访谈.md/);
  } else {
    assert.match(job.result.code, /<html/);
    assert.ok(job.projectId);
  }
  assert.equal((await json("/bootstrap")).data.jobs[0].id, job.id);
});
test("exports the real artifact and updates actions or versions", async () => {
  if (product.id === "worker") {
    const r = await request(`/jobs/${job.id}/download`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /验收任务/);
    const a = await json(`/jobs/${job.id}/actions/0`, "PATCH", { done: true });
    assert.equal(a.data.result.actions[0].done, true);
    assert.equal(
      (await json(`/jobs/${job.id}`)).data.result.actions[0].done,
      true,
    );
  } else {
    const before = (await json(`/projects/${job.projectId}`)).data;
    assert.equal(before.versions.length, 1);
    const r = await json(`/projects/${job.projectId}/revise`, "POST", {
      prompt: "新增一个更清晰的说明文字",
      documentIds: [],
    });
    assert.equal(r.status, 202);
    assert.equal((await waitJob(r.data.id)).status, "completed");
    const after = (await json(`/projects/${job.projectId}`)).data;
    assert.equal(after.versions.length, 2);
    assert.equal(after.versions[0].id, before.versions[0].id);
    const download = await request(
      `/projects/${job.projectId}/download?version=${before.versions[0].id}`,
    );
    assert.equal(download.status, 200);
    const zip = await JSZip.loadAsync(await download.arrayBuffer());
    assert.ok(zip.file("index.html"));
    assert.match(await zip.file("index.html").async("text"), /验收任务/);
    assert.ok(zip.file("PRD.md"));
    assert.ok(zip.file("README.md"));
  }
});
test("fails truthfully when API credentials are absent", async () => {
  const r = await json("/jobs", "POST", {
    title: "API 故障测试",
    prompt: "创建一份产品评测方案。",
    kind: "evaluation",
    provider: "openai",
  });
  assert.equal(r.status, 202);
  const failed = await waitJob(r.data.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.result, null);
  assert.match(failed.error, /API Key/);
});
test("deleting a source prevents silent use of missing material", async () => {
  assert.equal((await json("/documents/" + docId, "DELETE")).status, 200);
  assert.equal(
    (
      await json("/jobs", "POST", {
        title: "失效引用",
        prompt: "分析已经删除的访谈资料。",
        kind: "interview",
        documentIds: [docId],
      })
    ).status,
    400,
  );
});
test("private store persists across instances", async () => {
  const path = join(dir, "persistence");
  const a = await createStore(path);
  await a.put("job", { id: "persist", status: "completed" });
  a.close();
  const b = await createStore(path);
  assert.equal((await b.get("persist", "job")).status, "completed");
  b.close();
});
test("encrypted keys roundtrip without exposing plaintext", () => {
  process.env.WORKSPACE_PASSWORD = secret;
  const encrypted = encryptKey("sk-test-secret");
  assert.ok(!encrypted.includes("sk-test-secret"));
  assert.equal(decryptKey(encrypted), "sk-test-secret");
  process.env.WORKSPACE_PASSWORD = "other";
  assert.equal(decryptKey(encrypted), "");
  assert.equal(equalSecret("", ""), false);
});
test("model JSON validation rejects incomplete artifacts", () => {
  assert.throws(() => parseResult('{"title":"missing"}', workerSchema));
  assert.throws(() => parseResult('{"title":"missing"}', fragmentSchema));
});

test("extracts text from PDF in the deployed-compatible parser", async () => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([
      readFileSync(new URL("./fixtures/material.pdf", import.meta.url)),
    ]),
    "material.pdf",
  );
  const r = await fetch(base + "/api/documents", {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  assert.equal(r.status, 201);
  const result = await r.json();
  assert.ok(result.chars > 20);
});

test("public fixtures never expose private state and private actions still require login", async () => {
  const anon = async (path, method = "GET") =>
    fetch(base + "/api" + path, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(method === "GET" ? {} : { body: "{}" }),
    });
  const response = await anon("/public/bootstrap");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const publicData = await response.json();
  assert.equal(publicData.access, "public");
  assert.deepEqual(publicData.documents, []);
  assert.equal(publicData.settings.baseUrl, "");
  assert.equal(publicData.settings.model, "");
  assert.equal(publicData.settings.hasApiKey, false);
  assert.ok(
    publicData.jobs.every(
      (j) => j.id.startsWith("public-") && j.documentIds.length === 0,
    ),
  );
  const privateData = (await json("/bootstrap")).data;
  assert.equal(privateData.access, "private");
  for (const item of [
    ...privateData.jobs,
    ...privateData.documents,
    ...privateData.projects,
  ])
    assert.ok(!JSON.stringify(publicData).includes(item.id));
  for (const [path, method] of [
    ["/bootstrap", "GET"],
    ["/jobs/" + job.id, "GET"],
    ["/jobs/" + job.id + "/download", "GET"],
    ["/jobs", "POST"],
    ["/settings", "PUT"],
    ["/documents", "POST"],
    ["/documents/" + docId, "DELETE"],
    ["/jobs/" + job.id + "/retry", "POST"],
    ["/jobs/" + job.id + "/actions/0", "PATCH"],
    ["/projects/private/download", "GET"],
    ["/projects/private/revise", "POST"],
  ])
    assert.equal((await anon(path, method)).status, 401, path);
  assert.equal(
    (await anon("/public/jobs/" + job.id + "/download")).status,
    404,
  );
  assert.equal((await anon("/public/projects/private/download")).status, 404);
  const path =
    product.id === "worker"
      ? "/public/jobs/public-worker/download"
      : "/public/projects/public-factory-project/download?version=public-version";
  const download = await anon(path);
  assert.equal(download.status, 200);
  if (product.id === "factory") {
    const zip = await JSZip.loadAsync(await download.arrayBuffer());
    assert.ok(zip.file("index.html"));
    assert.ok(zip.file("PRD.md"));
    assert.equal(
      (
        await anon(
          "/public/projects/public-factory-project/download?version=private",
        )
      ).status,
      404,
    );
  } else assert.match(await download.text(), /公开示例/);
  assert.deepEqual(await (await anon("/public/bootstrap")).json(), publicData);
  const logout = await request("/logout", { method: "POST" });
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await anon("/bootstrap")).status, 401);
  assert.equal((await anon("/public/bootstrap")).status, 200);
});
