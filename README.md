# 亦伴 · 个人产品助理

懂项目背景的 AI 产品研究助理。用 nanobot 执行研究，连接造物验证原型，在一个工作台里查看项目背景、对话、证据、需求、原型、待办和真实评测。

当前版本 **0.3.0**：加入逐条主张的原文摘录、定位校验和审阅修订历史，保留 0.2 的记忆版本、证据复用与跟进能力。见 [本轮迭代记录](docs/ITERATION_V03.md)。摘录匹配和审阅判断分别展示；第一版历史实测保持独立，不当作本轮的新成绩。

## 你能完成什么

- 建立项目档案，保存目标、范围、约束和用户确认的项目记忆；可以纠正、停用和明确恢复，保留历史并检查修改版本冲突。
- 从公开 HTTPS 来源搜集资料，保存原始页面、提取正文、抓取时间和 SHA256。
- 结合项目背景形成竞品价值判断、带来源的需求草稿和验收条件；明确事实、推断和未知。
- 从需求进入造物，生成隔离预览的前端原型，保留版本并导出源码。
- 显式选用本项目已存证据，保留原抓取时间与哈希；旧快照不能充当重新核验的最新资料。
- 逐条核查模型摘录、跳转原文定位，并保存支持、反驳或待核实的审阅理由；工作空间标注不等于独立准确率。
- 保存行动项完成状态、截止日期与备注，从待办继续研究；候选记忆需确认后才能进入项目档案。
- 查看旧版与新版的实测对比、调用消耗和失败记录，下载完整证据与运行包。

旧版文档 Worker 保留在 `/?legacy=1`，说明见 [原版文档](docs/LEGACY_WORKER.md)。

## 本机启动

需要 Node.js 24、Git、uv 和 Codex CLI。本机模型路线使用已登录的 Codex；需要先执行 `codex login`。nanobot 固定为 0.3.5、提交 `d0d0a44e57632c3d269e511339cff7ddb698e62e`，安装脚本用 uv 建立独立 Python 3.11 环境。

解压交付的源码包，确保 `ai-pm-worker` 与 `product-foundry` 位于同一个目录，然后执行：

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

本机开发分支为 `codex/yiban-personal-agent`；造物计量改造分支为 `codex/yiban-prototype-metering`。源码包内含两个对应项目。公开仓库原版不包含本次改造，不能仅通过克隆默认分支获得这次交付。

## 模型、数据和边界

- 本机 Codex 登录已支持真实调用；API 路线提供代码接入，实际可用性需按服务商验证。模型变更对新任务生效。
- 新工作台的数据默认在 `data/personal-agent/workspace.sqlite`，与旧工作空间分开；nanobot 私有会话与审计在 `.runtime/`。二者均不进入 Git。
- 源码包含当前两个公开项目的 README 背景，不会自动扫描用户其他私人目录。分享运行包前检查项目资料。
- 证据正文作为不可信资料，不能授权命令或工具。研究模型的 Shell、浏览器、插件等执行工具被禁用，公开取证由有网络边界的外层服务完成。
- 模型建议的记忆只作为候选；事实引用ID会校验，但引用存在不代表内容已被核实。
- Token 记录来自真实返回，缺失值保留为空。Codex 订阅调用没有独立账单时，金额不能直接换算，也不显示为零成本。
- 交付的是单用户本机产品与浏览器前端原型；不承诺电脑关机后执行任务，也没有多人、支付或自动部署业务系统。
- 原有 Vercel 文档工作台仍可独立使用。新的 nanobot 常驻执行层没有作为无服务器函数部署；云端版需单独配置运行环境和模型授权。

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
