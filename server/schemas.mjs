import { z } from "zod";
// Product artifacts adapted from E2B Fragments lib/schema.ts (Apache-2.0).
// We use a bounded, dependency-free web artifact instead of executing install commands.
export const fragmentSchema = z
  .object({
    title: z.string().min(1).max(100),
    description: z.string().min(1).max(1000),
    commentary: z.string().max(4000),
    code: z.string().min(100).max(150000),
    prd: z.string().min(20).max(30000),
  })
  .strict();
export const workerSchema = z
  .object({
    title: z.string().min(1).max(100),
    summary: z.string().min(1).max(2000),
    markdown: z.string().min(30).max(60000),
    actions: z
      .array(
        z
          .object({
            title: z.string().min(1).max(300),
            owner: z.string().max(100),
            priority: z.enum(["high", "medium", "low"]),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export const requestSchema = z.object({
  title: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(5).max(30000),
  kind: z.string().max(50),
  documentIds: z.array(z.string().uuid()).max(8).default([]),
  provider: z.enum(["demo", "codex", "openai"]).optional(),
});
export function parseResult(raw, schema) {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  return schema.parse(JSON.parse(cleaned));
}
export function jsonSchema(schema) {
  // Keep output shape explicit for Codex, where every property must be required.
  const props =
    schema === workerSchema
      ? {
          title: { type: "string" },
          summary: { type: "string" },
          markdown: { type: "string" },
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                owner: { type: "string" },
                priority: { type: "string", enum: ["high", "medium", "low"] },
              },
              required: ["title", "owner", "priority"],
              additionalProperties: false,
            },
          },
        }
      : {
          title: { type: "string" },
          description: { type: "string" },
          commentary: { type: "string" },
          code: { type: "string" },
          prd: { type: "string" },
        };
  return {
    type: "object",
    properties: props,
    required: Object.keys(props),
    additionalProperties: false,
  };
}
