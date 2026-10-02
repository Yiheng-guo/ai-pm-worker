import { createHash } from "node:crypto";
import { z } from "zod";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (message, status, code) => Object.assign(new Error(message), { status, code });
export const actionKey = (runId, index) => hash(["action", runId, index]).slice(0, 32);
export function actionFingerprint(run, action, index) {
  // The key is identity; the fingerprint also guards edits from stale tabs.
  const { key, actionFingerprint, index: projectedIndex, modelId, ...content } = action;
  return hash({ runId: run.id, projectId: run.projectId, index, content });
}
export const actionEditable = run => run.status === "completed" && (!run.kind || ["research", "recall"].includes(run.kind));
export function projectActionItems(run) {
  return { runId: run.id, projectId: run.projectId, editable: actionEditable(run), items: (run.result?.actions || []).map((action, index) => ({ ...action, key: actionKey(run.id, index), index, modelId: action.id ?? null, actionFingerprint: actionFingerprint(run, action, index) })) };
}
export function projectRunActions(run) {
  return run.result ? { ...run, result: { ...run.result, actions: projectActionItems(run).items } } : run;
}
const validDate = value => { const date = new Date(value + "T00:00:00Z"); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; };
export const actionChangeSchema = z.object({ done: z.boolean().optional(), note: z.string().max(4000).optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(validDate).nullable().optional() }).strict().refine(i => Object.keys(i).length > 0);
export const stableActionChangeSchema = z.object({ done: z.boolean().optional(), note: z.string().max(4000).optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(validDate).nullable().optional(), expectedActionFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict().refine(i => i.done !== undefined || i.note !== undefined || i.dueDate !== undefined);
export function findActionByKey(run, key, expectedFingerprint) {
  const index = (run.result?.actions || []).findIndex((_, index) => actionKey(run.id, index) === key);
  if (index < 0) throw fail("当前任务的待办不存在。", 404, "ACTION_NOT_FOUND");
  const action = run.result.actions[index];
  if (actionFingerprint(run, action, index) !== expectedFingerprint) throw fail("待办内容或关联已变化，请核对当前版本后再修改。", 409, "ACTION_CHANGED");
  return action;
}
