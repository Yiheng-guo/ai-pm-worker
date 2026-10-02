# 后续开发说明

当前实现保留两个服务，在亦伴上增加项目与研究层。这样可以继续使用造物现有的原型结构、迭代版本和导出，无需把两个数据库合并。用户从统一工作台操作，服务间请求只走本机地址。

```mermaid
flowchart LR
  UI[亦伴统一工作台] --> API[项目与研究 API]
  API --> DB[(项目 / 证据 / 需求 / 待办 / 评测)]
  API --> Fetch[公开 HTTPS 取证]
  API --> Bridge[nanobot Python 适配器]
  Bridge --> Model[本机 Codex / 兼容 API]
  API --> Foundry[造物服务]
  Foundry --> Proto[原型版本 / HTML / PRD]
  Proto --> UI
```

## 修改位置

| 功能 | 文件 | 约定 |
|---|---|---|
| 工作台与交互 | `src/AgentApp.tsx`、`src/agent.css` | 默认新入口；`/?legacy=1` 保留旧版 |
| 项目、任务与关联 | `server/agent-router.mjs` | 每个项目同时最多一个执行任务；提交支持幂等键 |
| 记忆变更 | `server/project-memory.mjs` | 当前有效记忆与追加历史分开；expectedRevision 防止旧页面覆盖 |
| 公开取证 | `server/evidence.mjs`、`runtime/search.py` | 搜索结果仅提供 URL，事实来自实际抓取正文 |
| 主张摘录与审阅 | `server/claim-audit.mjs`、`src/ClaimReview.tsx` | 摘录匹配是文字校验；审阅另存历史，不能当作客观准确率 |
| nanobot 运行 | `runtime/bridge.py`、`server/nanobot-runtime.mjs` | 固定上游版本；默认工具为空；调用原始记录私有保存 |
| 模型与计量 | 两个仓库的 `server/provider.mjs` | 保存最终输出与公开运行事件，过滤推理事件；缺用量为 null |
| 原型生成与版本 | 造物 `server/index.mjs`、`server/prompts.mjs` | 接收已存需求；输出独立 HTML 与 PRD |
| 评测 | `scripts/evaluate-agent.mjs` | 使用旧版提示与结构作基线；保存失败、补救、原文和复核记录 |

## API 入口

所有入口都继承工作空间的登录保护与跨站写入检查。下表省略 `/api/agent` 前缀。

| 入口 | 用途 |
|---|---|
| `GET /bootstrap` | 精简项目、运行、评测与运行状态；`?full=1` 兼容原响应 |
| `POST /projects`、`PATCH /projects/:id` | 建立项目、修改背景、确认或纠正记忆 |
| `GET /projects/:id/memory` | 当前记忆、版本与历史 |
| `POST /projects/:id/memory` | 明确确认新记忆，需 expectedRevision 与 confirm:true |
| `PATCH /projects/:id/memory/:memoryId` | 纠正或停用，需版本校验 |
| `POST /projects/:id/memory/:memoryId/restore` | 指定历史版本并重新确认，追加恢复记录 |
| `POST /runs` | 研究或回忆，返回任务后异步执行 |
| `POST /runs` 的 `sourceIds` | 仅显式复用本项目的 SHA256 验证快照；不重新抓取 |
| `GET /runs/:id`、`POST /runs/:id/cancel` | 状态、原始记录与取消 |
| `GET /runs/:id/claims` | 主张的原文匹配、定位、审阅状态与修订历史 |
| `POST /runs/:id/claims/:key/review` | 需 expectedRevision、expectedClaimFingerprint、confirm:true；支持或反驳需有效引文和理由 |
| `POST /runs/:id/prototype` | 从本项目的已完成研究需求生成原型 |
| `PATCH /runs/:id/actions/:actionId` | 串行保存完成状态、dueDate（YYYY-MM-DD/null）与 note |
| `GET /runs/:id/export` | 研究记录、模型调用与证据快照包 |
| `GET /prototypes/:id/download` | 原型源码、需求和来源清单 |
| `GET /evaluations/:id/export` | 评测及配对样本原始记录 |
| `GET /evaluations/:id` | 需要时载入完整评测案例 |

## 本机开发与复现

按主 README 安装并构建两个项目，再运行 `npm run agent:start`。前端源码修改后重新 `npm run build` 并刷新页面；服务端模块修改后需重新启动，正在执行的任务会被中断。先完成或取消任务，再重启。

`npm test` 使用隔离数据库与模型协议 fixture，不消耗真实额度。运行 `npm run agent:evaluate -- --data-dir data/personal-agent` 会真正调用模型，不能拿单元测试的 fixture 当评测成绩。

Node 依赖通过 `package-lock.json` 与 `npm ci` 复现。Python 上游提交固定，当前验证的间接依赖快照见 `runtime/requirements.lock.txt`；它是本机环境快照，不能替代其他平台的安装验证。模型路由、网络、运行顺序和输出随机性会影响重跑结果。

需要人工修正原型 HTML 时，可以执行 `node scripts/review-prototype.mjs RUN_ID HTML_FILE 修正说明`。它保留原版，分别在亦伴和造物保存新版本，明确标为 `manual`，不会发起模型调用。CLI 只用于本机验收；同项目正在执行任务时会拒绝写入。当前两个本机数据库没有跨库事务，写入出错后需检查两个版本记录再恢复。

## 后续优先级

1. 扩大固定任务池，加入矛盾证据、缺少来源和过时记忆；由独立审查者复核事实与需求可用性。
2. 在已实现的记忆变更历史与明确恢复上增加更细的来源核查；当前有效值优先，变更后隔离旧会话上下文。
3. 在已实现的主张摘录与审阅上补齐需求、行动及原型的依据链；引文只证明文字存在，审阅标签不作为独立效果评测。
4. 有真实 API 授权后验证 API 路线及提供商原始用量，再接入有来源的价格表与账单对照。
5. 需要常驻跟进时再部署执行层和调度；当前待办是可保存的行动列表。

没有引入自动技能晋升、任意 Shell、多人账号或自动公开发布。它们需要另外的效果评测、授权与运行设计，不能从这一版演示推出已经具备。

本机版本归档可在工作树保存后运行 `node scripts/package-delivery.mjs --output ../deliverables/版本目录 --iteration 迭代档案ID`。脚本只从干净的本机提交收集两个源码项目，另行打包指定的历史评测和迭代验收。它不会上传或发布 GitHub，也不会在源码 ZIP 中带入凭证、数据库或运行环境。
