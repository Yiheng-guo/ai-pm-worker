import { createHash, randomUUID } from "node:crypto";

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const timestamp = () => new Date().toISOString();

// Legacy memory[] is the active projection. Importing never rewrites old audit entries.
export function prepareMemoryProject(project) {
  const p = structuredClone(project);
  p.memoryRevision = Number.isInteger(p.memoryRevision) ? p.memoryRevision : 0;
  p.memoryHistory ||= [];
  p.memory = (p.memory || []).filter(m => !m.status || m.status === "active").map(m => {
    const at = m.updatedAt || p.updatedAt || p.createdAt || timestamp();
    const revisionId = m.revisionId || "legacy-" + createHash("sha256").update(JSON.stringify([p.id, m.id, m.text, at])).digest("hex").slice(0, 24);
    if (!p.memoryHistory.some(h => h.revisionId === revisionId)) p.memoryHistory.push({ revisionId, memoryId: m.id, text: m.text, source: m.source || "用户确认", operation: "imported", at, previousRevisionId: null, projectRevision: p.memoryRevision, reason: "兼容已有确认记忆；历史记录从此次导入开始。" });
    return { ...m, source: m.source || "用户确认", updatedAt: at, revisionId, status: "active" };
  });
  return p;
}

export function requireMemoryRevision(p, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision !== p.memoryRevision)
    throw fail("项目记忆已变更，请刷新后核对当前版本，再明确确认修改。", 409);
}

function append(p, memoryId, value, operation, reason) {
  const current = p.memory.find(m => m.id === memoryId);
  const previous = current?.revisionId || p.memoryHistory.filter(h => h.memoryId === memoryId).at(-1)?.revisionId || null;
  const at = timestamp();
  const entry = { revisionId: randomUUID(), memoryId, text: value.text, source: value.source || current?.source || "用户确认", operation, at, previousRevisionId: previous, projectRevision: p.memoryRevision + 1, reason: reason || "" };
  p.memoryHistory.push(entry);
  p.memory = p.memory.filter(m => m.id !== memoryId);
  if (operation !== "deactivated") p.memory.push({ id: memoryId, text: entry.text, source: entry.source, updatedAt: at, revisionId: entry.revisionId, status: "active" });
}

function finish(p, changed) {
  if (changed) { p.memoryRevision += 1; p.memoryUpdatedAt = timestamp(); p.updatedAt = p.memoryUpdatedAt; }
  return p;
}

export function replaceMemory(project, memories, reason = "用户确认项目档案中的当前记忆") {
  const p = prepareMemoryProject(project);
  if (new Set(memories.map(m => m.id)).size !== memories.length) throw fail("记忆 ID 不能重复。");
  let changed = false;
  for (const current of [...p.memory]) if (!memories.some(m => m.id === current.id)) { append(p, current.id, current, "deactivated", reason); changed = true; }
  for (const value of memories) {
    const current = p.memory.find(m => m.id === value.id);
    if (!current || current.text !== value.text || current.source !== value.source) { append(p, value.id, value, current ? "corrected" : "confirmed", reason); changed = true; }
  }
  return finish(p, changed);
}

export function changeMemory(project, memoryId, change) {
  const p = prepareMemoryProject(project);
  const current = p.memory.find(m => m.id === memoryId);
  if (!current) throw fail("当前有效记忆不存在。请从历史选择版本并明确恢复。", 404);
  const value = { ...current, ...(change.text !== undefined ? { text: change.text } : {}), ...(change.source !== undefined ? { source: change.source } : {}) };
  if (change.active === false) { append(p, memoryId, current, "deactivated", change.reason); return finish(p, true); }
  if (current.text === value.text && current.source === value.source) return p;
  append(p, memoryId, value, "corrected", change.reason);
  return finish(p, true);
}

export function addMemory(project, change) {
  const p = prepareMemoryProject(project);
  if (p.memory.length >= 30) throw fail("当前有效记忆最多 30 条，请先停用不再适用的记忆。");
  append(p, randomUUID(), change, "confirmed", change.reason);
  return finish(p, true);
}

export function restoreMemory(project, memoryId, revisionId, reason) {
  const p = prepareMemoryProject(project);
  const saved = p.memoryHistory.find(h => h.memoryId === memoryId && h.revisionId === revisionId);
  if (!saved) throw fail("记忆历史版本不存在。", 404);
  if (!p.memory.some(m => m.id === memoryId) && p.memory.length >= 30) throw fail("当前有效记忆最多 30 条。");
  append(p, memoryId, saved, "restored", reason || "用户重新确认并恢复历史内容");
  p.memoryHistory.at(-1).restoredFromRevisionId = revisionId;
  return finish(p, true);
}

export function runtimeProject(project) {
  const p = prepareMemoryProject(project);
  return { id: p.id, name: p.name, background: p.background, goal: p.goal || "", constraints: p.constraints || "", memory: p.memory, memoryRevision: p.memoryRevision };
}
