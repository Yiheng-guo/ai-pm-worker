# 亦伴 · AI PM Worker

面向 **AI 产品经理** 的办公 Worker。把需求和原始资料变成可评审的文档、可追溯的分析和可执行的行动项。

[打开线上工作空间](https://ai-pm-worker.vercel.app) · [开源调研与二开说明](docs/OPEN_SOURCE_RESEARCH.md) · [实际访谈分析样例](docs/examples/interview-analysis.md)

> 这是独立项目，拥有自己的服务、数据和部署。产品工厂位于另一个仓库 [Product Foundry](https://github.com/Yiheng-guo/product-foundry)，无需安装它即可使用 Worker。

## 可以做什么

- **PRD**：问题、用户、工作流、AI 行为边界、验收标准。
- **访谈洞察**：痛点、证据、候选需求、下一轮验证问题。
- **竞品研究**：基于你提供的资料比较产品，区分事实和假设。
- **AI 评测方案**：评分细则、测试用例、Bad Case 分类；不会伪造实测结果。
- **产品周报、会议决策记录**：整理材料与待办。
- 上传文字版 PDF、DOCX、Markdown、TXT、CSV、JSON。
- 任务执行记录、取消、重试、Markdown 导出、行动项勾选与结果归档。

## 本机运行

需要 Node.js 24（最低 22.13）。

```bash
git clone https://github.com/Yiheng-guo/ai-pm-worker.git
cd ai-pm-worker
npm ci
npm run build
npm start
```

打开 **http://127.0.0.1:4310**。开发模式为 `npm run dev`，前端地址 **http://127.0.0.1:4311**。

在「设置与模型」选择：

| 方式 | 用途 |
|---|---|
| 演示模式 | 返回明确标注的内置模板，不调用 AI，不分析材料。 |
| 本机 Codex | 需要安装 Codex CLI 并执行 `codex login`；使用本机登录账号的额度，任务只读运行。 |
| API 模型 | 填写 OpenAI Chat Completions 兼容接口地址、模型 ID、API Key。需支持 JSON 输出。 |

本地任务保存在 `data/workspace.sqlite`；该目录不进入 Git。API Key 默认只保存在进程内存，重启后重新填写；也可以用环境变量配置。模型 API 默认最长 4 分钟，Codex 本机调用最长 10 分钟。任务失败会保留输入。

```bash
OPENAI_API_KEY=... OPENAI_BASE_URL=https://api.openai.com/v1 OPENAI_MODEL=... npm start
```

不要将真实密钥写入版本库。环境变量用于配置，不代表模型可用性已自动验证。

## Vercel 部署

项目已包含 `api/index.mjs` 和 `vercel.json`。线上使用独立的 **private Vercel Blob** 保存资料、任务和设置。

```bash
vercel link
vercel blob create-store ai-pm-worker-private --access private --yes
vercel env add WORKSPACE_PASSWORD production --sensitive
vercel --prod
```

`WORKSPACE_PASSWORD` 使用足够长的随机口令。它既保护登录，也用于加密保存的模型密钥；更换口令后需重新输入模型密钥。`BLOB_READ_WRITE_TOKEN` 由连接私有存储时注入。口令、Blob token、API Key 都不能进入 Git。

线上不能调用用户电脑上的 Codex；请选择 API 模型。未配置时是演示模式。当前账号的 Vercel AI Gateway 测试要求绑定信用卡，未启用该服务。

## 实现与上游

React + TypeScript + Vite；Express + Zod；本地 SQLite / 线上 Vercel 私有 Blob；Mammoth + PDF Parse；标准 OpenAI 兼容 API / 本机 Codex。

改造了 LangChain OpenWork 的系统提示行为边界，并保留原始来源与 MIT 许可证；结构化产物 schema 借鉴并改造 E2B Fragments，保留 Apache-2.0 许可证。这是**模块级二开**，不是完整上游产品的换皮 fork。见 [NOTICE](NOTICE) 和 [调研记录](docs/OPEN_SOURCE_RESEARCH.md)。

## 验证

```bash
npm test
npm run build
```

测试覆盖登录保护、跨站拒绝、输入校验、中文文件读取、真实持久化、导出、行动项更新、API 失败处理、已删除资料校验和密钥加密。人工验收包含本机 Codex 真实访谈分析。

## 当前边界

单用户工作空间，无多人账号、定时调度和自动消息发送。资料最多 8 MB（Vercel 请求体限制下建议不超过 4 MB）、累计最多 65,000 字符；扫描 PDF 需要先 OCR。竞品分析没有内置全网搜索。AI 输出仍需产品经理复核。线上单页列表当前最多 500 条，适合个人原型工作空间，不是企业文档仓库。

源代码按 Apache-2.0 发布；第三方材料遵循各自许可证。

## 公开展示与私有工作空间

未登录可浏览工作台、模板和预置虚构示例，并下载示例。公开数据来自独立静态 fixture，不读取用户存储。私人资料、个人生成记录、模型配置、上传与生成操作仍需工作空间口令。点击“登录工作空间”进入私人工作区；取消登录可返回公开体验。
