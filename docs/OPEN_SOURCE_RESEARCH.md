# 开源调研与二开边界

调研日期：2026-09-26。项目目标：为 AI 产品经理交付两个独立产品——办公 Worker 与产品工厂。二者独立部署、独立存储、独立仓库，不依赖彼此运行。

| 项目 | 直接来源 | 核查结果与选择 |
|---|---|---|
| LangChain OpenWork | https://github.com/langchain-ai/openwork | MIT。桌面代理、规划与文件工具的参考。本项目改造其系统提示的任务管理、主动执行和行为边界，去除直接操作用户文件/任意 Shell 的办公默认行为。 |
| E2B Fragments | https://github.com/e2b-dev/fragments | Apache-2.0。采用结构化 fragment 产物接口思路，改造 schema 为完整 HTML + PRD + 说明。去除 E2B 托管沙盒和动态安装依赖的必需项。 |
| Bolt.diy | https://github.com/stackblitz-labs/bolt.diy | MIT。完整应用生成能力较强，但本轮需要更轻的独立运行与可下载产物，未复制其代码。 |
| Dyad | https://github.com/dyad-sh/dyad | README 区分 Apache-2.0 开源部分与 src/pro 的 FSL 许可部分。本轮未复制其代码。 |
| Vercel Chatbot | https://github.com/vercel/chatbot | Apache-2.0。通用聊天模板需要进一步改成任务与交付物中心，本轮未复制其代码。 |

## 实际采用的上游快照

- E2B Fragments：`cc07f43736855f42191de7ac011350cef6752342`，`lib/schema.ts`。原始文件与 LICENSE 保存在 `third_party/fragments/`；改造实现在 `server/schemas.mjs`。
- LangChain OpenWork：`af1e795469871886690c8dcf5421b5cd18ceefec`，`src/main/agent/system-prompt.ts`。原始文件与 LICENSE 保存在 `third_party/openwork/`；改造实现在 `server/prompts.mjs`。

这是模块级二次开发，不是 OpenWork/E2B Fragments 的完整 fork，也不声称复用了它们的完整代理运行时。新的中文界面、任务引擎、材料提取、本地/私有云存储、访问保护、版本管理和导出由本项目实现。生产版本没有依赖 E2B 账号。

## 两个产品的职责

### 亦伴 AI PM Worker

输入产品经理任务和原始材料，生成有边界说明的 PRD、访谈洞察、竞品研究框架、评测方案、周报、会议决策记录，并提取可勾选行动项。无实时搜索工具；“竞品研究”仅依据上传的资料，缺少资料时给研究框架，不假装完成全网调研。

### 造物 Product Foundry

输入产品需求，生成独立浏览器原型、产品说明与源码包；可以预览、继续通过自然语言迭代、查看历史版本和下载。交付范围是 HTML/CSS/JavaScript 前端原型，不声称自动提供用户系统、服务端数据库或生产级多人协作。

## 部署依据

- Vercel 私有 Blob：https://vercel.com/docs/vercel-blob/private-storage
- Vercel Functions 后台任务生命周期：https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package
- Vercel Functions 时限：https://vercel.com/docs/functions/configuring-functions/duration

## 模型接入实测

本机 Codex 已登录，Worker 真实访谈分析调用通过。线上可填写 OpenAI 兼容接口。调研中测试 Vercel AI Gateway 返回 HTTP 403 `customer_verification_required`，要求账号先添加信用卡；项目没有为用户开通付费服务或绑定支付方式。线上未配置 API 时使用明确标识的演示模式。
