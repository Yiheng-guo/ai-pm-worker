# 亦伴的 nanobot 运行桥接

固定上游：HKUDS/nanobot `d0d0a44e57632c3d269e511339cff7ddb698e62e`，版本 0.3.5。验证环境：Python 3.11.16、macOS arm64、Codex CLI 0.159.2（2026-10-02）。

```sh
bash runtime/setup.sh
node --test tests/nanobot-runtime.test.mjs
```

安装只 fetch 固定 commit；拒绝错误 origin 或 dirty 的运行源码。`requirements.lock.txt` 是本机已验证的 97 项间接依赖快照，editable 绝对路径已替换为固定 Git 提交。它不是跨平台依赖解析锁；普通 setup 仍由上游 pyproject 解析依赖。需要复现本机依赖时，在已创建的 venv 使用 `uv pip sync --python .runtime/.venv/bin/python runtime/requirements.lock.txt`；先保留既有环境。不要把未验证的平台称为验证成功。

## 执行与边界

Node 通过 JSONL 调用 Python。Python 使用真实 nanobot AgentLoop/AgentRunner/ContextBuilder/SessionManager，限制一轮研究、不注册任何工具，项目记忆来自用户已确认的事实。模型候选记忆必须由用户审核，运行时不直接把候选记忆写成事实。

0.2 使用当前有效记忆的投影，审计历史不进入当前模型上下文。会话键包含 memoryRevision，记忆变更后使用新会话上下文，旧会话文件保留；未变更时仍会持续会话。Node 也排除修订前的历史结果，防止旧值从历史再次进入；需要沿用旧资料时应显式选择证据并描述本轮任务。复用证据携带原抓取时间和 reusedFrom/reusedAt，模型规则明确它不是本次重新取证。

0.3 的 claims 支持可选 `citations`：sourceId、连续原文 quote 和可选的 UTF16 start。桥接保留模型候选摘录；Node 的 `claim-audit.mjs` 单独验证 SHA 与字面位置，错误摘录仍可追溯。工作空间审阅不修改模型原文，也不由摘录匹配自动决定语义真假。旧结果没有 citations 时继续兼容，显示没有提供摘录。

0.4 的需求可带 `basis`（主张数组索引、项目字段、有效记忆 ID、假设、验证方法），行动用 `requirementIndices` 指向本次需求数组。桥接拒绝越界、重复和无效当前记忆关联，保留原始无效输出而不重试。旧输出的 basis 为 null、行动关联为空时不猜测论证。数组索引从 0 开始，不依赖模型重复的 R1/A1 标签。

生成用 provider schema 与历史解析不同：严格新 schema 所有对象属性均 required，默认数组需要明确为空，nullable 字段需要明确 null；Pydantic 历史解析继续接受缺省字段。fixture 通过独立 JSON Schema 验证器检查两种边界。

本机 Codex 通过现有登录调用；不读取用户 config，禁用 shell、网页搜索、MCP apps、plugins、hooks、computer use 等，设置 read-only sandbox。检索在 Node 的公共证据工具完成，不把网页中的指令执行。每个 Codex prompt 保存在 `.runtime/records/.../call-N/prompt.txt`（0600），以普通文件作为 stdin；stdout/stderr 独立消费，避免大管道 BrokenPipe 隐藏真正诊断。首次 attempt 先存 pending `call.json`，异常也会补齐退出码和脱敏诊断。

Codex 的网络重连可能输出 `error` 事件；后续 turn.completed、非空输出与 exit 0 才确认成功。AgentRunner 无论界面是否流式，都调用 chat_stream_with_retry。桥接覆盖默认 chat_stream 回退，避免上游 90 秒 stream-idle wait_for 提前取消阻塞 CLI 并生成可重试 TimeoutError；CLI 的总期限为 600 秒。适配器终态失败会禁止 nanobot 再隐式启动相同调用，重试由用户主动发起。取消会终止本次 Python/Codex 进程组并保留已有记录。

## 记录与计量

`.runtime` 与 `data` 是本机私有数据，不能直接提交到公开仓库。记录包含项目上下文、用户目标、来源、最终输出和允许保存的 provider 事件；排除 reasoning 与工具 payload。API Key 不写输入记录，凭证、Bearer 与 URL 密码/query 从诊断移除。

`usage.requestCount` 是实际进入适配器的调用次数（包含失败），Codex 内部网络重连可从 events 另行查看。Token 只采用 provider wire 数据；上游 observer 的估算不会显示成 reported。缺失数据为 null，缓存未报告也为 null。cost/currency 为 null；订阅额度不转换成美元账单。错误输出保留原文，同时返回字段路径、无效证据 ID 或脱敏 provider 原因。

## 验证证据

`tests/nanobot-runtime.test.mjs` 验证真实 nanobot plumbing，LLM 使用 fixture：持久会话、记忆纠正、取消、进程组、提前退出、失败不重跑、凭证脱敏、缺失 Token、结构错误与无效引用。还把上游 stream-idle 设置为 0.05 秒，验证一个耗时 0.2 秒的阻塞模型仍仅调用一次，证明未继承上游错误的 90 秒空闲期限。

单独一次真实长输入恢复验证位于 `data/evaluations/recovery-validation-2026-10-02`，不是正式评测样本。该调用经历网络超时与 os error 51，重连后完成；旧失败调用的 stderr 已被旧代码丢弃，旧提前退出原因无法追溯确定。

CLI JSONL 与输出 schema 行为参考 [OpenAI 官方非交互模式文档](https://learn.chatgpt.com/docs/non-interactive-mode)。
