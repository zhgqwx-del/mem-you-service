# 记录型 Agent 独立记忆服务：七个 Agent / Harness 的源码研究

研究日期：2026-10-26（美国东部时间）。这份笔记是官方文档与固定版本源码审阅，不是运行测试，也没有复现项目宣传的 benchmark。文中“已实现”表示所列快照中存在对应代码或清楚的官方文档说明，不表示已经验证生产可用性。

## 1. 范围、版本与一个重要区分

需要把四类经常都叫作 memory 的东西拆开：

1. **工作上下文**：当前会话消息、工具结果、压缩摘要，目标是让一项任务继续执行。
2. **情景/事实记忆**：以前发生的事情、用户偏好、个人资料、项目事实，目标是跨会话取回证据。
3. **程序性记忆**：技能、工具使用经验、操作流程，目标是下次更好地做类似工作。
4. **任务/未来状态**：目标、下一步、待办、条件触发的意图，目标是维护明确的执行状态。

会话恢复和压缩做得很好，并不自动意味着具备适合身体、心情、体重、饮食、财务记录的长期事实系统。相反，真正的独立服务需要同时回答“这条记录如何可靠保存”“这次应召回什么”“结论依据哪几条原始记录”“用户纠正后哪些派生结果需要重算”。

| 项目 | 核实身份 / 审阅版本 | 核心记忆形态 | 与本需求最相关的借鉴 |
|---|---|---|---|
| OpenCode | `anomalyco/opencode`；本地旧 remote 为 `sst/opencode`；`fe3f3a41f79ad292cc3c7c629567385a20ec5130`，2026-09-21 | 指令文件、技能、持久会话、摘要压缩 | 会话压缩与独立事实服务应分开；提供插件/MCP 接入 |
| OpenClaw | `openclaw/openclaw`；`91f0839da752dd7411e23a235b99f38227d3b36d`，2026-09-22 | Markdown 记忆、SQLite 混合索引、来源标记、后台巩固、条件意图 | 记忆分层、写入来源、后台巩固、快慢召回通道 |
| Hermes Agent | `NousResearch/hermes-agent`；`dcf72565c2766a4b8320478f5c0d3a7922d14e87`，2026-09-22 | 小容量常驻记忆、FTS5 历史、技能、可插拔外部记忆 | Provider 生命周期非常接近独立记忆服务适配层 |
| DeepSeek Harness | **确认为** `deepseek-ai/deepseek-harness`；`ddefc45fbc7f8e46dd73185e68295696d1297887`，2026-09-17 | 事件溯源会话、可替换压缩能力、外部 MCP 记忆 | 不把领域记忆耦合进 Agent 主循环；可靠事件与上下文投影 |
| Codex | 本地 `openai/codex` 快照 `f4389de2790a98e75f3e45ed3f05a0f4f88e90ca`，2026-09-22；官方文档在线核对 | 后台逐会话抽取 + 全局巩固 + 分级文件读取 | 异步两阶段记忆、任务租约、证据和删除传播 |
| Harness² | `google-research/harness2`；下载快照 `1cfe254e8d25b15f37048c3730134686abe60335`，2026-10-13 | 按领域保存 adopted harness 和证据支持的经验 | 将事实记忆与 Agent 改进经验分开；经验必须有适用条件和证据 |
| OpenHarness | `HKUDS/OpenHarness`；下载快照 `9b2efd795c6aa09f88b0c257d269a9e518da6ae7`，2026-06-04 | Markdown 文件库、启发式召回、可选抽取、会话检查点 | 一条记忆一个对象、生命周期元数据、可观测的轻量起步 |

**版本漂移**：在线文档访问于 2026-10-26，本地五个参考库是 9 月快照。OpenCode 当前 v2 文档的保留尾部默认值已为 15,000 tokens，固定源码为 8,000；当前 Hermes 文档用 `patch` 描述更新动作，固定源码使用 `replace`。以下将固定源码行为与当前文档新增能力分开陈述。不能把这份研究当成七个项目的实时能力清单。

## 2. OpenCode：首先是上下文工程，不宜直接充当个人记忆数据库

### 架构与读写

固定版本同时包含旧的 `packages/opencode` 和重构中的 `packages/core` 路径。需要明确看的是哪条运行路径，不能混合不同版本的默认值。

- **持久指令**：启动时发现全局与项目的 `AGENTS.md` 等文件，合并配置的 `instructions`；读取文件时还会发现目录附近的指令，并跟踪已加载文件防止重复注入。这是持久行为规则，不能等同于自动学习的用户记忆。
- **会话存储**：消息/事件和工具结果被保存，支持继续会话；`packages/core/src/session/sql.ts` 定义其 SQL 投影。历史“仍然存在”和“新请求会主动找到相关历史”是两项能力。
- **会话压缩**：固定版本 `compaction.ts` 估算 system/messages/tools 的大小，接近 `context - max(output, buffer)` 后运行摘要；默认 buffer 20k、保留最近 8k、摘要输出上限 4096。模板保存 Objective、Important Details、Work State、Next Move、Relevant Files；连续压缩会合并旧摘要，最近对话优先于旧摘要中的冲突信息。
- **技能**：发现 `SKILL.md`，先暴露元数据，调用技能工具后读取正文。这是程序性知识的按需加载。

当前官方 v2 文档又说明：压缩可手动请求并合并重复请求；可指定摘要模型；实验性后台压缩会提前计算摘要；支持的 OpenAI Responses 模型可用原生压缩。原生压缩 checkpoint 绑定 provider/model，其可移植性与普通文本记忆不同。[当前压缩说明](https://dev.opencode.ai/v2/docs/compaction/)

### 适用与限制

对于记录型产品，它更像需要被接入的 Agent 客户端。Reviewed memory paths 中没有发现面向用户跨域记录的独立事实索引、时间区间查询、单位规范化或财务统计语义；这不意味着插件生态不存在这些功能。压缩摘要对“继续完成工作”很合理，但不能成为“用户上个月到底记录了哪些体重”的唯一证据。不可将压缩中对冲突的“新说法覆盖旧说法”直接用于历史健康/交易数据：上周 70kg 与今天 71kg 是两个观察，不是矛盾事实。

关键源码：

- [固定版本摘要、触发与保留逻辑](https://github.com/anomalyco/opencode/blob/fe3f3a41f79ad292cc3c7c629567385a20ec5130/packages/core/src/session/compaction.ts)
- [固定版本指令发现与去重](https://github.com/anomalyco/opencode/blob/fe3f3a41f79ad292cc3c7c629567385a20ec5130/packages/opencode/src/session/instruction.ts)
- [固定版本技能发现](https://github.com/anomalyco/opencode/blob/fe3f3a41f79ad292cc3c7c629567385a20ec5130/packages/core/src/skill/discovery.ts)

## 3. OpenClaw：最接近完整个人助手记忆架构的参考之一

### 分层存储

固定版本已经远超过“一个 MEMORY.md 加向量检索”：

- `USER.md`：稳定偏好、沟通方式、关系和用户模型；更改时标记 superseded，避免两个互斥偏好同时活跃。
- `MEMORY.md`：精炼的长期非画像事实、决定和摘要；按预算进入上下文。
- `memory/YYYY-MM-DD.md`：情景材料、日记和工作观察，主要用于检索；特定 `/new`、`/reset` 路径会带入今天/昨天的 dated notes。
- `DREAMS.md`：后台处理与晋升的可审阅记录，不作为日常提示词原料。
- SQLite：既提供 FTS5/BM25 与向量检索索引，也承载结构化的来源、短期候选和条件意图等状态。不要把整个系统简单描述成“只有 Markdown，没有其他状态”。

文件按块索引，内置引擎默认 chunk 约 400 tokens、overlap 80；向量可使用可选的 sqlite-vec，也有其他计算路径。混合检索按 chunk identity 合并 keyword/vector，再处理时间衰减、重要性、项目相关性和可配置的 MMR。源码保留组件分数作为诊断信息。时间衰减/排序不应被理解为删除历史事实。[内置引擎官方说明](https://docs.openclaw.ai/concepts/memory-builtin)

### 写入与后台巩固

正常交互可写日记；压缩之前进行私有 housekeeping turn，保存未落盘的上下文；会话结束的 transcript 也可进入可摄取证据。后台 dreaming 从短期候选评分，经来源、回忆频次、query diversity 等确定性条件后，才让模型做 merge/supersede/dedupe 等语言判断，并留下审阅记录。用户直接要求保存也有相应写入路径。

来源不是让模型在文本里自报：SQLite 元数据区分 `owner`、`agent`、`untrusted`、`system`，记录 session kind、时间和 lineage。cron/heartbeat/subagent 的脚手架噪声与已召回内容被排除出部分晋升路径；声明为网络来源的工具结果会 taint 后续衍生文本。官方同时明确边界：只对参与声明机制的工具生效，拥有本地文件写权限的进程仍在工作区信任边界内。这是有条件的防护机制，不是“解决了 memory poisoning”。[官方架构与边界](https://docs.openclaw.ai/concepts/memory-architecture)

### 读取与未来意图

普通回合用廉价通道：预算化 bootstrap、显式 `memory_search`/`memory_get`、强 trigger 匹配后的少量 curated entries 注入。需要回忆过去且廉价通道没有强命中时，可升级到 active-memory 子 Agent 深检索。时间提醒交给 cron；事件条件意图保存在 SQLite，以 keyword/embedding、scope、expiry、cooldown、fire budget 和明确状态机匹配，不期待模型从很长的 Markdown 里自行想起承诺。

### 对本需求的价值与不能照搬的地方

最值得借鉴的是**来源伴随事实、原始情景材料与精选画像分层、巩固异步执行、每轮召回有预算、条件意图不只写成自然语言**。需要改造的是数据模型：日志服务必须保留每次身体/财务观察，不能用 curated preference 的 supersede 规则覆盖时间序列；中文简短记录召回和精确日期/数值检索也需要独立评测。其架构高度嵌入工作区、插件、网关、cron、Agent 权限系统，直接搬出成为多租户服务的成本不小。

关键源码：

- [固定版本混合检索与排序](https://github.com/openclaw/openclaw/blob/91f0839da752dd7411e23a235b99f38227d3b36d/extensions/memory-core/src/memory/hybrid.ts)
- [固定版本后台巩固](https://github.com/openclaw/openclaw/blob/91f0839da752dd7411e23a235b99f38227d3b36d/extensions/memory-core/src/dreaming-consolidation.ts)
- [固定版本来源、层级与读写架构文档](https://github.com/openclaw/openclaw/blob/91f0839da752dd7411e23a235b99f38227d3b36d/docs/concepts/memory-architecture.md)

## 4. Hermes Agent：小常驻核心 + 历史搜索 + 可插拔 Provider

### 内置记忆

两个 store 默认只有 `MEMORY.md` 2200 characters 和 `USER.md` 1375 characters，以 `§` 分隔条目。会话开始一次读取，冻结成 system prompt snapshot，保护 prefix cache；本回合写入立即落盘，工具结果显示 live state，但其他已启动会话不会自动刷新 system snapshot。`add/replace/remove`、批量变更、唯一子串定位、容量校验、文件锁和 atomic write 均有实现；超限不会自动挤掉旧条目，而是让 Agent 整理后重试。

这是一种**小容量精选工作记忆**，不是全部人生数据仓库。源码有 memory nudge（默认每 10 个用户回合）、后台复查/curator 相关入口，压缩前也有 provider checkpoint 生命周期。当前文档强调：模型只说“记住了”不等于工具实际写入成功；write approval staging、profile scope、frozen snapshot 都可能影响实际可见性。[官方持久记忆说明](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)

### 历史与程序性记忆

所有会话另存 SQLite，`session_search` 用 FTS5 检索，提供发现、围绕 message anchor 滚动、浏览最近会话等不同形状；当前源码还按 lineage 去重，减少压缩摘要挤满命中的问题。它不是默认语义向量库，不能把其 FTS 检索描述成 embeddings 检索。技能库与 `skill_manage` 是程序性记忆，保存能重复执行的工作流，容量和触发方式独立于两份小 Markdown。

### 外部记忆抽象：很值得直接借鉴

`MemoryProvider` 暴露 `initialize`、静态 `system_prompt_block`、`prefetch(query, session_id)`、`queue_prefetch`、`sync_turn`、`get_tool_schemas`、`handle_tool_call`、`on_session_end`、`on_pre_compress`、`on_memory_write` 等生命周期。初始化携带 profile/home、platform、agent/user/session identity；MemoryManager 保留 builtin，最多再接一个 external provider，控制 schema 冲突与膨胀，并隔离 provider 的多数异常。自动同步、预取和 shutdown drain 有明确的线程/超时边界。

对独立服务，这比仅提供 `add/search` 更完整：服务可提供 turn 开始前的预算化 context，turn 结束后的增量摄取，压缩前的 durable checkpoint，显式工具搜索和纠错。官方 provider 指南概括这一可插拔层，但具体是否同步查询、写入周期、是否做推理取决于 provider。例如 Honcho 有 base context、dialectic supplement、可选当前 query 同步召回；不能将它们泛称为所有 Hermes 内置能力。[Provider 官方指南](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers)

### 风险和适配建议

默认异步预取具有“快，但可能不是这次 query 的最新结果”的权衡；关键记录回复可以要求当前 query 的短超时同步上下文。冻结画像对高频连续记录的用户很可能过时，独立服务应提供版本号与小型 per-turn delta。Profile 隔离是本地助手模型，不能直接替代线上 tenant/user/agent 授权隔离。MemoryManager 某些注入提示将召回视为较权威参考；本服务应明确标记 evidence、inference、uncertain 和不可信外部内容，不能仅靠包裹标签提升可信度。

关键源码：

- [固定版本 MemoryProvider 协议](https://github.com/NousResearch/hermes-agent/blob/dcf72565c2766a4b8320478f5c0d3a7922d14e87/agent/memory_provider.py)
- [固定版本 MemoryManager 调度和隔离](https://github.com/NousResearch/hermes-agent/blob/dcf72565c2766a4b8320478f5c0d3a7922d14e87/agent/memory_manager.py)
- [固定版本冻结快照、锁与容量管理](https://github.com/NousResearch/hermes-agent/blob/dcf72565c2766a4b8320478f5c0d3a7922d14e87/tools/memory_tool_store.py)
- [固定版本会话历史检索](https://github.com/NousResearch/hermes-agent/blob/dcf72565c2766a4b8320478f5c0d3a7922d14e87/tools/session_search_tool.py)

## 5. DeepSeek Harness：扩展点清晰，长期记忆明确交给插件

身份已通过官方 `deepseek-ai/deepseek-harness` 仓库核实，不是泛指“让 DeepSeek 模型运行在某个 harness 中”。它采用 Cordis 插件架构，记忆应通过可组合能力接入。

### 会话与压缩的可靠性设计

`Session` 是 typed append-only event log。LLM 可见 history 是从日志导出的 surface，不另存一份可能失配的 history；持久化 backend 是另一个能力 seam。压缩记录 `compaction/start`、`compaction/summary`、`compaction/end`，同时以带身份的 user message surface replacement 替换指定范围。原始历史事件保留，可重放、归因和检查未闭合事务。

压缩 seam 有 `compactIfNeeded`（pressure / context-overflow）、`compactNow`、`compactRegion`，后端拥有阈值、保留范围和摘要逻辑；支持独立的 deterministic tool-result pruning，并在选择区间时维护 tool call/result pairing。锁覆盖整个操作，先写 start 后写 end，避免半途崩溃被误认为已完成。这里维护的是**当前任务的上下文投影**，不是长期个人事实。

### 外部记忆接入

官方指南直接提供三种默认关闭的第三方 Memory MCP 示例：Memorix、MCP Reference Memory、Engram。DSH 负责启动 stdio 子进程或连接 Streamable HTTP、发现工具、暴露命名空间；安装、数据库、模型、embedding、身份选择、迁移归供应方。未开启 overlay 时这些记忆 server 不在默认组合内。Reference Memory 是实体/关系/observation 图配合子串检索，指南明确没有 embeddings、自动摘要、冲突处理和遗忘策略。[官方 MCP 记忆接入指南](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/docs/user/guide/mcp-memory.md)

这种边界很适合本项目：独立服务自管 personal-data 语义，适配层只负责身份映射、预取/摄取 hooks 和工具暴露。但工具可调用不保证模型每次会调用，故“新记录到来前自动 context API”与“显式 search 工具”应同时提供。只有 MCP 通用工具时，需要适配 prompt 或 hook 才能保证关键读取时机。

关键源码/设计文档：

- [固定版本 Session 事件与投影](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/docs/subsystems/session.md)
- [固定版本 Compaction seam](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/compaction/compaction/src/index.ts)
- [固定版本 MCP 工具桥接源码](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/mcp/mcp-client/src/index.ts)

## 6. Codex：确有独立本地长期记忆，两阶段流水线值得借鉴

Codex 部分先检索并打开了 official OpenAI documentation，再看本地固定源码；按 OpenAI Docs skill 的来源限制，外链只给 OpenAI 官方文档，不将社区解读当产品事实。官方明确区分 AGENTS.md、memories、skills、MCP；本地 Codex memories 与 ChatGPT web memory 是不同存储/控制面。当前官方文档说明本地 memories 默认关闭，需要启用。[官方 customization 说明](https://learn.chatgpt.com/docs/customization/overview)、[官方 memories 默认与启用说明](https://learn.chatgpt.com/docs/customization/memories)

### 写入流水线（固定源码证据）

本地 `codex-rs/memories/README.md`、`write/src/start.rs`、`write/src/phase1.rs`、`write/src/phase2.rs` 显示：符合条件的 root session 启动后异步运行；排除 ephemeral/subagent、无 state DB 等情况；有额度门槛。

1. **Phase 1**：从 state DB claim 一批符合来源、年龄和 idle 条件的 rollout；逐会话并行抽取 `raw_memory`、`rollout_summary`、slug；生成字段做 secrets redaction；结果保存 DB；lease 避免重复处理，失败有 backoff。
2. **Phase 2**：全局 lease 串行巩固；按使用次数、近期使用等选择有限输入，刷新 `raw_memories.md` 和 `rollout_summaries/`，基于受控 Git baseline 生成差异；有变化才启动内部 consolidation agent，更新 `MEMORY.md`、`memory_summary.md`、可复用 `skills/`。删除输入也进入差异，prompt 要求移除或改写失去证据支持的派生条目。受限运行环境关闭网络并限制本地写入。

这与“每次聊天结束立即自动总结”不同；文档说明要等待 idle，并提供 generate/use 两个开关及外部上下文准入设置。[官方本地 memories](https://learn.chatgpt.com/docs/customization/memories)

### 读取流水线与边界

本地 `codex-rs/ext/memories/src/prompts.rs`、`templates/memories/read_path.md` 显示：先注入紧凑 summary 和读取规则，再由 Agent 按关键词定位 MEMORY、相关 skill/rollout summary，必要时追原始 rollout 证据。审阅路径属于文件式分级读取，不能据此声称它使用向量数据库。

AGENTS.md 属于始终应遵守的项目规则；压缩维持当前任务；memories 保存以往工作的可复用信息；skills 保存流程。对记录服务值得借鉴的是抽取/巩固分离、幂等任务、证据链与删除传播；不宜照搬启动时触发、按 coding rollout 批处理的 freshness。用户刚记下体重、下一条就问趋势时，服务应具有 read-your-writes 保证。官方配置中的闲置时长、输入上限、未使用保留窗口均说明它是受预算约束的后台系统。[官方配置项](https://learn.chatgpt.com/docs/config-file/config-reference)

复查关键本地源码文件（以上表 commit 为准）：`codex-rs/memories/write/src/start.rs`、`codex-rs/memories/write/src/phase1.rs`、`codex-rs/memories/write/src/phase2.rs`、`codex-rs/ext/memories/templates/memories/read_path.md`。这些实现细节不应被扩展成所有 Codex 客户端、所有账号当前默认开启的承诺。

## 7. Harness²：优化 Agent 的记忆，不是记录用户生活的记忆

### 身份与两层递归

官方项目是 Google Research 的 `harness2`，README 对应论文 arXiv:2610.14224，并明确不是受官方支持的 Google 产品。模型权重固定：task-level 通过 Propose–Probe–Compose 在同一任务上对比 harness 候选；harnessing-level 将采纳的 harness 与有证据的 lesson 留给后续同领域任务。[官方仓库](https://github.com/google-research/harness2)

八类可编辑组件包括 system prompt、guardrails、memory、tool guidance、subagents、skills、scripts、plugins。OpenCode substrate 中的 `LongTermMEMORY.md` 是 always-on domain facts，而 skills 按需读、scripts 按需执行、plugin 在 tool loop 中运行。这一“memory component”与下述跨任务 library 要分开。

### 经验写入与读取

`Library` 按 run/mode/domain 保存完整 adopted harness tree、`EXPERIENCE.md` 和生成的 `INDEX.md`。每条可迁移经验需要 `cue`、`lesson`、`evidence`，还可记录 edits/confidence；缺少必需字段不写入。采纳之后的 reflection 读取 task-local 的修改和执行证据再提炼；不是单看模型最终回答“成功了”就晋升经验。Library 在写入前检查 grader verdict 泄漏。

读取是**按领域路径隔离 + Agent 浏览索引/文件**：context builder 把同领域以前任务的库复制进 `context/library`，prompt 让 improver 先看 INDEX 再打开相关条目。没有在审阅路径中发现 embedding/BM25 自动召回；完整 tree 被携带，不只是 summary。domain 内任务顺序执行、只看先前记录；不同 domain 可并行；run/mode/seed 等控制实验隔离。

### 对本需求的实际启发

适合服务的“经验层”：例如“用户发来两段混合的饮食和支出信息时，先拆记录再分别校验单位”，但这属于程序策略，需要跨用户隔离与离线验证。它不应存为某个用户的生活事实，更不应让“以前推理过的模式”冒充“今天确实发生了的事件”。原型的多次 rollout/probe 成本也不适合作为每条简短记录的同步写入路径。

关键源码：

- [固定版本分域经验库与字段要求](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/library.py)
- [固定版本证据 context 构建](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/context.py)
- [固定版本采纳后反思](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/selection.py)

## 8. OpenHarness：结构化 Markdown 对象 + 轻量检索，注意默认值与规模边界

### 持久对象与状态

主库用项目绝对路径 SHA-1 的前 12 位建立目录，`MEMORY.md` 是索引，事实是各自的 Markdown 文件。schema 包含 id、type、scope、description、category、importance、source、signature、created/updated、ttl_days、disabled、supersedes、tags；还有 agent/user/project/local 与 team 相关的独立文件路径约定。类型至少包括 user、feedback、project、reference。

`add_memory_entry` 在文件锁内按内容+类型等 signature 找 exact duplicate，原子写文件并更新索引；相同标题但不同正文可生成另一个编号文件。删除是 disabled 的软删，并从索引去掉；scanner 默认过滤 disabled/expired。字段存在不等于全自动冲突推理已实现：自动抽取调用通用 add 路径，概念级同义去重或时态冲突仍主要依赖模型判断，不能宣称是完备的事实版本图。

### 检索与写入触发

`find_relevant_memories` 扫描最近最多 100 个文件的 metadata 和约 300 字符 body preview，使用 ASCII 长词/汉字 token 的字面重合；metadata 权重 2、body 权重 1，加 importance、使用频次和 recency。可选 selector 对 shortlist 或 manifest 再排，但默认函数本身是启发式，不是语义向量检索。prompt 构建注入 MEMORY 索引与少量 relevant memories，并更新使用记录。

`auto_extract_enabled` **默认 false**。开启后，回合结束从最近 12 条消息和现存 manifest 请求无工具 JSON 抽取，默认最多 3 个候选；若判断当前可见消息已经写过 memory 则跳过。`auto_dream_enabled` 也默认 false。不要把这些可选函数被调用等同于开箱即用的自动学习。

另有 `session-memory/<project>/<session>.md`，默认开启：把 goal、next step、verified work、artifacts、近期消息确定性编成最多约 12k characters 的检查点，跨 compaction 注入。这是**任务连续性状态**，与 durable personal fact store 是两层。

### 对本需求的价值与局限

“一条记忆一个可管理对象 + 元数据 + 索引”和可选抽取很适合低规模原型；但是最近 100 个文件候选、300 字符 preview 与单字汉字重合在大量中文生活记录下会漏召回或误召回。路径 hash 隔离也不等于服务的多用户权限隔离。写入 source 目前在通用 add 路径标记为 manual，即使上层由自动抽取调用，因此不能仅凭这个字段建立强可信来源结论。建议借鉴 schema/lifecycle，用数据库索引与显式 source_event_id、observed_at、trust class 替换文件扫描限制。

关键源码：

- [固定版本写入、exact duplicate 与软删除](https://github.com/HKUDS/OpenHarness/blob/9b2efd795c6aa09f88b0c257d269a9e518da6ae7/src/openharness/memory/manager.py)
- [固定版本启发式检索](https://github.com/HKUDS/OpenHarness/blob/9b2efd795c6aa09f88b0c257d269a9e518da6ae7/src/openharness/memory/search.py)
- [固定版本自动抽取](https://github.com/HKUDS/OpenHarness/blob/9b2efd795c6aa09f88b0c257d269a9e518da6ae7/src/openharness/services/memory_extract/__init__.py)
- [固定版本会话检查点](https://github.com/HKUDS/OpenHarness/blob/9b2efd795c6aa09f88b0c257d269a9e518da6ae7/src/openharness/services/session_memory/__init__.py)
- [固定版本默认开关](https://github.com/HKUDS/OpenHarness/blob/9b2efd795c6aa09f88b0c257d269a9e518da6ae7/src/openharness/config/settings.py)

## 9. 面向独立记录记忆服务的合成建议

这些是跨项目源码审阅后的设计判断，并非上述项目声称或已经证明的结论。

### 9.1 最值得组合的模式

| 本服务需要解决的事 | 可借鉴模式 | 必须增加的领域能力 |
|---|---|---|
| 短记录先可靠保存 | DSH append-only 原事件；OpenHarness atomic object | 幂等键、recorded/observed 时间、时区、原文/附件、写入回执 |
| 当前回合立刻得到有用上下文 | Hermes prefetch + 工具双入口 | read-your-writes、query 当前性、超时与 token budget |
| 长期信息不无限挤满 prompt | Hermes 小核心；Codex summary→detail；OpenClaw curated/episodic 分层 | 每条证据可定位、按本次意图选择少量背景 |
| 偏好更改与健康记录增加 | OpenClaw supersession；OpenHarness TTL/disabled | fact 更新和 observation 新增采用不同语义；保留历史 |
| 自动画像与归纳 | Codex 两阶段；OpenClaw dreaming | 异步物化视图、版本/重算状态、置信度、来源和删除传播 |
| 提醒/未来行为 | OpenClaw 结构化 prospective memory | scheduler/intent 状态机、取消与完成明确落库 |
| 能力持续变好 | Hermes skills；Harness² cue/lesson/evidence | 与个人事实分库、离线评测、适用范围、禁止跨用户泄漏 |
| 接任意 Agent | DSH MCP；Hermes Provider 生命周期 | REST/SDK + MCP，hook 只做适配，不把所有控制权交给 prompt |

### 9.2 应避免的直接复制

- 不要把“过了几回合模型愿不愿调用 memory 工具”作为数据记录成功条件。用户记录应有确定性的 ingestion 和 durable receipt。
- 不要把“长期记忆摘要”当健康/饮食/财务的唯一真相；摘要和画像都是可重建派生物，原记录独立保留。
- 不要把“最新值覆盖旧值”泛化到所有领域。稳定偏好可以 supersede，体重、情绪、支出是带时间观察；纠错则要引用被修正记录。
- 不要只靠 embedding。今天、昨天、上周、金额、单位、某药名、某笔交易要走结构化/keyword 过滤；“最近总是很累”才主要需要语义候选。
- 不要每条记录都运行完整反思 Agent 或深度推理召回。快路径先接受、归一化和轻量 context；复杂回忆与归纳走有上限的慢路径。
- 不要将外部文本经记忆保存后直接升级成系统指令。source trust、inference status 与 action authority 应独立编码。
- 不要把对 memory 主表的删除当作彻底遗忘。需要跟踪 summary/profile/embedding/cache/skill-like derived artifact 的来源与撤回；Codex diff cleanup 和 OpenClaw lineage 是可参考的起点。

### 9.3 推荐的 Agent 接入最小协议

不要求所有宿主都实现同一 memory 生命周期；独立服务应同时暴露三个层次：

1. **确定性写入**：`ingest(record, idempotency_key, user_id, session_id, observed_at, source)` 返回 record id 和持久化状态，Agent 依据真实回执回复。
2. **当前回合上下文**：`context(query_or_new_record, budgets, domains, as_of)` 返回 core facts、相关原始记录、近期聚合和待澄清点；每项带证据 id、时间、作用范围与 freshness。hook 在推理前调用，超时可降级，不能把另一条 query 的晚到结果混进来。
3. **显式深查询与管理工具**：`search/read/query_series/correct/forget`，支持 Agent 在当前上下文不足时进一步获取证据；MCP 是包装层。

写后异步抽取画像、主题摘要与生活模式；更新可见后推进 `memory_version`。若当前回复需要刚写入的数据，直接读原始记录或等待限定 materialization watermark。事实服务输出上下文和候选解释，最终回复、反问和工具行动仍由宿主 Agent 负责。

建议将事实记忆服务作为基础设施，Agent-specific adapters 只处理 identity、turn hooks、tool schema 和 prompt fencing。这样可同时服务 agent-runner、Hermes/OpenClaw 及其他 Agent，而不会把某一个 harness 的会话格式、文件夹或技能规则变成核心数据模型。
