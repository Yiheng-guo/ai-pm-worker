import {
  workerTemplates,
  factoryTemplates,
  demoWorker,
  demoFactory,
} from "./templates.mjs";
// Public fixtures are deliberately independent of storage and model configuration.
export function publicBootstrap(product, cloud) {
  const factory = product.id === "factory";
  const createdAt = "2026-09-01T08:00:00.000Z";
  const job = {
    id: "public-" + product.id,
    title: factory
      ? "公开示例 · AI 产品需求看板"
      : "公开示例 · AI 助手需求评审",
    prompt: factory
      ? "为 AI 产品经理提供一个可交互的需求看板，管理优先级和交付状态。所有记录均为虚构示例。"
      : "评审一个虚构的团队知识助手：明确用户场景、引用溯源、评估标准与待验证假设。所有内容仅供演示。",
    kind: factory ? "roadmap" : "brief",
    status: "completed",
    provider: "public",
    createdAt,
    events: [
      { at: createdAt, message: "预置公开示例，未调用模型，不包含私人资料。" },
    ],
    error: null,
    documentIds: [],
    projectId: factory ? "public-factory-project" : null,
  };
  job.result = factory ? demoFactory(job) : demoWorker(job, []);
  const projects = factory
    ? [
        {
          id: job.projectId,
          title: job.title,
          description: job.result.description,
          kind: job.kind,
          createdAt,
          updatedAt: createdAt,
          versions: [
            {
              id: "public-version",
              ...job.result,
              createdAt,
              prompt: job.prompt,
              provider: "public",
            },
          ],
        },
      ]
    : [];
  return {
    access: "public",
    product,
    settings: {
      provider: "public",
      baseUrl: "",
      model: "",
      hasApiKey: false,
      cloud,
    },
    templates: factory ? factoryTemplates : workerTemplates,
    jobs: [job],
    documents: [],
    projects,
  };
}
