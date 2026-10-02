# 亦伴 · 个人产品助理

懂项目背景的 AI 产品研究助理。用 nanobot 执行研究，连接造物验证原型，在一个工作台里查看项目背景、对话、证据、需求、原型、待办和真实评测。

[六步真实演示](docs/demo/README.md) · [公开演示与离线原型](docs/PUBLIC_DEMO.md) · [完整本机演示指南](docs/DEMO_GUIDE.md)

这是在原有亦伴和造物上的整合迭代：亦伴提供统一研究工作台，nanobot 执行受控研究，造物是独立原型服务。公开演示用于了解流程和体验示例原型，不连接你的私人工作空间，也不调用模型；完整研究能力按下方步骤在本机运行。

当前版本 **0.5.0**：取消任务保留已返回的模型输出与用量，明确最终保存边界；待办使用稳定定位和编辑冲突检查；项目资料可以通过预览与确认导入固定 Git 提交文档或明确提供的文本，并带入研究与原型依据。需求范围预览和依据冻结继续保留。见 [本轮迭代记录](docs/ITERATION_V05.md)。第一版历史实测保持独立，不当作本轮的新成绩。

## 你能完成什么

- 建立项目档案，保存目标、范围、约束和用户确认的项目记忆；可以纠正、停用和明确恢复，保留历史并检查修改版本冲突。
- 从公开 HTTPS 来源搜集资料，保存原始页面、提取正文、抓取时间和 SHA256。
- 结合项目背景形成竞品价值判断、带来源的需求草稿和验收条件；明确事实、推断和未知。
- 从需求进入造物，明确选择范围并查看背景／审阅／覆盖风险简报，生成隔离预览的前端原型，冻结依据并导出源码。
- 显式选用本项目已存证据，保留原抓取时间与哈希；旧快照不能充当重新核验的最新资料。
- 明确导入亦伴、造物与本机 nanobot 的固定提交说明文档，或提供项目文本。导入记录与网页抓取分开，不自动确认记忆；Git 模式不读取未提交修改。
- 逐条核查模型摘录、跳转原文定位，并保存支持、反驳或待核实的审阅理由；工作空间标注不等于独立准确率。
- 查看显式的判断—需求—行动依据链；旧结果没有论证时不猜测关联，共同网页也不能证明需求价值。
- 保存行动项完成状态、截止日期与备注，从待办继续研究；重复模型 ID 仍可按稳定键定位，两窗口修改冲突时保留草稿。候选记忆需确认后才能进入项目档案。
- 取消请求会进入保存过程，终态以记录为准；已经开始最终业务保存时明确拒绝取消，跨服务已有结果会在中断记录中披露。
- 查看旧版与新版的实测对比、调用消耗和失败记录，下载完整证据与运行包。

旧版文档 Worker 保留在 `/?legacy=1`，说明见 [原版文档](docs/LEGACY_WORKER.md)。

## 本机启动

需要 Node.js 24、Git、uv 和 Codex CLI。本机模型路线使用已登录的 Codex；需要先执行 `codex login`。nanobot 固定为 0.3.5、提交 `d0d0a44e57632c3d269e511339cff7ddb698e62e`，安装脚本用 uv 建立独立 Python 3.11 环境。

克隆两个仓库到同一个目录；已有源码包也可解压到同级目录：

```bash
git clone https://github.com/Yiheng-guo/ai-pm-worker.git
git clone https://github.com/Yiheng-guo/product-foundry.git
```

在它们所在的目录执行：

```bash
cd product-foundry
npm ci
npm run build
cd ../ai-pm-worker
npm ci
npm run agent:setup
npm run build
npm run agent:start
```

打开 **http://127.0.0.1:4310**。造物服务在 **http://127.0.0.1:4320**；启动脚本会同时启动两个服务。已有环境可双击 `启动亦伴.command`。造物可用 `FOUNDRY_DIR` 指定其他本机目录。

Personal Agent 改造随两个仓库的默认 `main` 分支提供。亦伴的开发分支为 `codex/yiban-personal-agent`，造物为 `codex/yiban-prototype-metering`；源码包也包含两个对应项目。首次安装不会自动恢复作者的私人数据库或历史运行记录。

## 模型、数据和边界

- 本机 Codex 登录已支持真实调用；API 路线提供代码接入，实际可用性需按服务商验证。模型变更对新任务生效。
- 新工作台的数据默认在 `data/personal-agent/workspace.sqlite`，与旧工作空间分开；nanobot 私有会话与审计在 `.runtime/`。二者均不进入 Git。
- 源码包含当前两个公开项目的 README 背景，不会自动扫描用户其他私人目录。分享运行包前检查项目资料。
- 证据正文作为不可信资料，不能授权命令或工具。研究模型的 Shell、浏览器、插件等执行工具被禁用，公开取证由有网络边界的外层服务完成。
- 模型建议的记忆只作为候选；事实引用ID会校验，但引用存在不代表内容已被核实。
- Token 记录来自真实返回，缺失值保留为空。Codex 订阅调用没有独立账单时，金额不能直接换算，也不显示为零成本。
- 交付的是单用户本机产品与浏览器前端原型；不承诺电脑关机后执行任务，也没有多人、支付或自动部署业务系统。
- 原有 Vercel 文档工作台仍可独立使用。Vercel 构建默认保留文档工作台入口；本机构建默认进入 Personal Agent。新的 nanobot 常驻执行层没有作为无服务器函数部署，云端版需单独配置运行环境和模型授权。GitHub Pages 只发布公开静态演示。

## 验证与交付

```bash
npm test
npm run build
npm run agent:evaluate -- --data-dir data/personal-agent
```

评测会实际调用模型并消耗账号额度，请阅读 [评测协议](docs/EVALUATION_PROTOCOL.md)。不同样本的运行完成、任务验收、事实抽查和记忆结果分别记录，不用一个成功演示推出普遍可靠性。

- [产品与架构说明](docs/PERSONAL_AGENT.md)
- [连续演示指南](docs/DEMO_GUIDE.md)
- [实测协议与指标定义](docs/EVALUATION_PROTOCOL.md)
- [运行层与限制](runtime/README.md)
- [后续开发说明](docs/DEVELOPMENT.md)

许可证 Apache-2.0；已有 OpenWork / E2B Fragments 及 nanobot 的许可与来源记录保留于 `NOTICE`、`third_party/`。Hermes 和 Rowboat 是机制与体验参考，没有捆绑它们的运行时。
