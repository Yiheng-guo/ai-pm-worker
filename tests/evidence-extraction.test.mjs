import { test } from "node:test";
import assert from "node:assert/strict";
import { extractEvidenceText } from "../server/evidence.mjs";

test("HTML 格式转换与正文长度截断分开：去标签不冒充截断，也不承诺读到动态内容", () => {
  const raw = "<nav>菜单</nav><p>官方声明 &amp; 可读文字。</p><script>动态内容</script>";
  const result = extractEvidenceText(raw, "text/html; charset=utf-8");
  assert.equal(result.text, "官方声明 & 可读文字。");
  assert.equal(result.truncated, false);
  assert.equal(result.extraction.transformed, true);
  assert.equal(result.extraction.rawChars, raw.length);
  assert.equal(result.extraction.extractedChars, result.text.length);
  assert.equal(result.extraction.providedChars, result.text.length);
  assert.equal(result.extraction.coverage, "captured-extracted-text-only");
  assert.match(result.extraction.note, /不代表动态网页内容全部/);
});

test("长度截断固定实际提供文本与 UTF16 长度，边界长度不误报、emoji 不被切成半字符", () => {
  const exact = extractEvidenceText("123456", "text/plain", 6);
  assert.equal(exact.truncated, false);
  const long = extractEvidenceText("1234567", "text/plain", 6);
  assert.equal(long.truncated, true); assert.equal(long.text, "123456");
  assert.equal(long.extraction.extractedChars, 7); assert.equal(long.extraction.providedChars, 6);
  const emoji = extractEvidenceText("12345😀结束", "text/plain", 6);
  assert.equal(emoji.text, "12345"); assert.equal(emoji.extraction.providedChars, 5);
  assert.equal(emoji.truncated, true); assert.equal(emoji.extraction.offsetUnit, "utf16-code-unit");
  assert.equal(extractEvidenceText("12345😀", "text/plain", 7).text, "12345😀");
});

test("非法 HTML 数字实体不能生成 Python 无法保存的孤立代理字符，原始文本仍留存", () => {
  const raw = "<p>&#55296; &#1114112; &#0; &#128512;</p>";
  const result = extractEvidenceText(raw, "text/html");
  assert.equal(result.text, "� � � 😀");
  assert.equal(result.text.isWellFormed(), true);
  assert.equal(result.extraction.rawChars, raw.length);
  assert.throws(() => extractEvidenceText(raw, "text/html", 0));
});
