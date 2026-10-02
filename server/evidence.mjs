import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
const exec = promisify(execFile);
export function isUsableEvidence(source) {
  return ["fetched", "imported"].includes(source?.status) && (source.status !== "imported" || ["git-commit", "text-import"].includes(source.origin?.kind)) && typeof source.raw === "string" && typeof source.text === "string" && source.text.length > 0 && /^[a-f0-9]{64}$/.test(source.sha256 || "") && createHash("sha256").update(source.raw).digest("hex") === source.sha256 && (!source.textSha256 || createHash("sha256").update(source.text).digest("hex") === source.textSha256);
}
export function forbiddenAddress(address) {
  const a = address.toLowerCase();
  if (a.includes(":")) return !/^[23][0-9a-f]{3}:/.test(a);
  const n = a.split(".").map(Number);
  return n.length !== 4 || n[0] === 0 || n[0] === 10 || n[0] === 127 ||
    n[0] >= 224 || (n[0] === 169 && n[1] === 254) ||
    (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
    (n[0] === 192 && (n[1] === 168 || n[1] === 0)) ||
    (n[0] === 100 && n[1] >= 64 && n[1] <= 127) ||
    (n[0] === 198 && [18,19,51].includes(n[1])) ||
    (n[0] === 203 && n[1] === 0);
}
export async function validateSourceUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password ||
      (url.port && url.port !== "443") || isIP(url.hostname) ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname))
    throw new Error("证据地址必须是公开 HTTPS 页面，不能指向本机或内部网络。");
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(x => forbiddenAddress(x.address)))
    throw new Error("证据地址解析到内部或保留网络，已拒绝读取。");
  return { url, address: addresses[0] };
}
async function readPublic(raw, signal, depth = 0) {
  if (depth > 4) throw new Error("页面重定向次数过多。");
  const { url, address } = await validateSourceUrl(raw);
  const result = await new Promise((resolve, reject) => {
    const request = https.get(url, {
      signal,
      headers: { "User-Agent": "YibanResearch/1.0 (+source-grounded personal assistant)", Accept: "text/html,text/plain,application/json" },
      lookup: (_host, options, callback) => {
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, response => {
      if ([301,302,303,307,308].includes(response.statusCode)) {
        response.resume();
        resolve({ redirect: new URL(response.headers.location, url).href });
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error("页面返回 HTTP " + response.statusCode)); return; }
      const contentType = response.headers["content-type"] || "";
      if (!/text\/|json|xml/.test(contentType)) { response.resume(); reject(new Error("目前仅支持可读取的网页或文本证据。")); return; }
      let length = 0; const chunks = [];
      response.on("data", chunk => {
        length += chunk.length;
        if (length > 1500000) request.destroy(new Error("证据页面超过 1.5 MB，请提供更精简的页面。"));
        else chunks.push(chunk);
      });
      response.on("end", () => resolve({ raw: Buffer.concat(chunks).toString("utf8"), contentType, retrievalUrl: url.href }));
      response.on("error", reject);
    });
    request.setTimeout(20000, () => request.destroy(new Error("读取证据超时。")));
    request.on("error", reject);
  });
  return result.redirect ? readPublic(result.redirect, signal, depth + 1) : result;
}
function plainHtml(raw) {
  return raw.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "\uFFFD";
    })
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n\n").trim();
}
export function extractEvidenceText(raw, contentType, maxChars = 35000) {
  if (typeof raw !== "string" || !Number.isInteger(maxChars) || maxChars < 1) throw new Error("取证文本与长度上限无效。");
  const html = /html/i.test(contentType || "");
  const extracted = html ? plainHtml(raw) : raw;
  let text = extracted.slice(0, maxChars);
  // A JS character budget uses UTF16 units; never cut a surrogate pair.
  const last = text.charCodeAt(text.length - 1), next = extracted.charCodeAt(text.length);
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) text = text.slice(0, -1);
  return {
    text, truncated: text.length < extracted.length,
    extraction: { method: html ? "html-regex-v2" : "plain-text-v1", format: html ? "html-to-text" : "plain-text", rawChars: raw.length, extractedChars: extracted.length, providedChars: text.length, maxChars, offsetUnit: "utf16-code-unit", transformed: extracted !== raw, htmlMarkupRemoved: html, coverage: "captured-extracted-text-only", note: html ? "提取会移除部分标签、导航与脚本；未触发长度截断不代表动态网页内容全部被读取。" : "只反映捕获文本的长度覆盖，不证明来源可靠或时效。" },
  };
}
export async function fetchEvidence(url, signal) {
  const record = { id: randomUUID(), title: url, url, text: "", raw: "", sha256: "", fetchedAt: new Date().toISOString(), status: "failed" };
  try {
    let data;
    const github = new URL(url);
    const parts = github.pathname.split("/").filter(Boolean);
    if (github.hostname === "github.com" && parts.length === 2) {
      for (const branch of ["main","master"]) {
        try { data = await readPublic("https://raw.githubusercontent.com/" + parts.join("/") + "/" + branch + "/README.md", signal); break; } catch (error) { if (signal.aborted) throw error; }
      }
    }
    data ||= await readPublic(url, signal);
    record.raw = data.raw;
    Object.assign(record, extractEvidenceText(data.raw, data.contentType));
    if (record.text.length < 80) throw new Error("页面没有足够可读取的正文。");
    record.title = data.raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ||
      record.text.match(/^#\s+(.+)$/m)?.[1] || github.hostname + github.pathname;
    record.title = record.title.slice(0, 200);
    record.retrievalUrl = data.retrievalUrl;
    record.sha256 = createHash("sha256").update(record.raw).digest("hex");
    record.status = "fetched";
  } catch (error) { record.error = error.message; }
  return record;
}
const known = [
  [/hermes|harmas|harmes/i, "https://github.com/NousResearch/hermes-agent"],
  [/rowboat|robot/i, "https://github.com/rowboatlabs/rowboat"],
  [/nanobot|nano bot/i, "https://github.com/HKUDS/nanobot"],
  [/openclaw/i, "https://github.com/openclaw/openclaw"],
  [/letta/i, "https://github.com/letta-ai/letta-code"],
  [/khoj/i, "https://github.com/khoj-ai/khoj"],
];
export async function discoverSources(prompt, explicit, root, signal, onEvent) {
  const urls = [...explicit, ...(prompt.match(/https:\/\/[^\s<>，。；）)]+/g) || [])];
  if (!urls.length) urls.push(...known.filter(([pattern]) => pattern.test(prompt)).map(([,url]) => url));
  if (!urls.length) {
    onEvent("正在公开搜索相关产品与原始资料");
    const python = join(root, ".runtime/.venv/bin/python");
    try {
      if (!existsSync(python)) throw new Error("搜索运行环境尚未安装。");
      const { stdout } = await exec(python, [join(root, "runtime/search.py"), prompt.slice(0, 240)], { signal, timeout: 45000, maxBuffer: 40000 });
      const results = JSON.parse(stdout);
      urls.push(...results.map(x => x.url).filter(x => typeof x === "string" && x.startsWith("https://")));
    } catch (error) { onEvent("公开搜索未获得结果：" + (error.name === "AbortError" ? "已取消" : error.message.slice(0, 160))); }
  }
  return [...new Set(urls)].slice(0, 4);
}
