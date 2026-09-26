import {
  createHmac,
  timingSafeEqual,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
export function equalSecret(a, b) {
  const aa = Buffer.from(a || ""),
    bb = Buffer.from(b || "");
  return aa.length === bb.length && aa.length > 0 && timingSafeEqual(aa, bb);
}
export function sessionValue(secret) {
  return createHmac("sha256", secret)
    .update("ai-pm-workspace-session-v1")
    .digest("hex");
}
export function authenticated(req) {
  const secret = process.env.WORKSPACE_PASSWORD;
  if (!process.env.VERCEL && !secret) return true;
  if (!secret) return false;
  const cookie = (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("pm_session="))
    ?.slice(11);
  return equalSecret(cookie, sessionValue(secret));
}
export function encryptKey(value) {
  if (!value) return "";
  const key = createHash("sha256")
    .update(process.env.WORKSPACE_PASSWORD || "")
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}
export function decryptKey(value) {
  if (!value) return "";
  try {
    const bytes = Buffer.from(value, "base64");
    const key = createHash("sha256")
      .update(process.env.WORKSPACE_PASSWORD || "")
      .digest();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      bytes.subarray(0, 12),
    );
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}
