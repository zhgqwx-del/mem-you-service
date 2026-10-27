# 场景补充后的定向调研：观察式记忆、MemOS 与 EverOS

核实日期：2026-10-26（America/New_York）。范围限于能补充现有方案的三个对象；只读官方文档、固定源码，没有运行模型、服务或性能评测。本文的选型判断是针对生活记录产品的工程推论，不是厂商性能结论。原有七个 Agent 和五个框架的对比继续有效，不重复展开。

## 1. 先给结论

值得补上的不是更多“会记住用户”的项目，而是三个具体能力：**持续记录流如何变成可更新状态；前台必定拿到记忆、后台富化可以落后到什么程度；用户纠正后哪些旧结论必须立即停止生效。** 本轮发现的实现适合借鉴这些局部机制，均不能代替原始记录、测量/交易事件和业务状态的权威数据库。

| 对象与固定快照 | 本轮重点价值 | 对本产品 PoC 的优先级 |
|---|---|---|
| Mastra `5bb592a862869d529d8d6ca48772cd0e1863f224`；仓库 `@mastra/memory` 为 `1.39.1-alpha.2` | Observer/Reflector、摘要到原消息回查、会话上下文装配 | 机制对照；长会话确有成本/遗漏问题时再运行 |
| MemTensor/MemOS `adcb9f270c982f2b9ff8db9714792829d3bd6ab8`；Python `MemoryOS` 2.0.33，local plugin `2.0.16-beta.1` | 独立 API、异步摄取、定向反馈；Agent adapter 的强制预取 | 接入和纠错对照优先于再跑通用问答榜单 |
| EverMind-AI/EverOS `5b0979b1b7f3a0cbe235756ff098515ec490753e`；1.5.1 | episode/profile/foresight 分层、可重建索引、异步可见性契约 | 暂作设计参考；可编辑个人记忆页成为重点后再试 |

版本依据：[Mastra package](https://github.com/mastra-ai/mastra/blob/5bb592a862869d529d8d6ca48772cd0e1863f224/packages/memory/package.json)、[MemOS pyproject](https://github.com/MemTensor/MemOS/blob/adcb9f270c982f2b9ff8db9714792829d3bd6ab8/pyproject.toml)、[local plugin package](https://github.com/MemTensor/MemOS/blob/adcb9f270c982f2b9ff8db9714792829d3bd6ab8/apps/memos-local-plugin/package.json)、[EverOS pyproject](https://github.com/EverMind-AI/EverOS/blob/5b0979b1b7f3a0cbe235756ff098515ec490753e/pyproject.toml)。三者所述记忆模块为 Apache-2.0；Mastra 仓库 `ee/` 另有许可。不要把 main 中 alpha 版本号当成已发布稳定版本。

## 2. Mastra Observational Memory：适合上下文压缩，不能单独承担生活账本

**实现。** Observer 将原消息压成带时间、重要性和状态变化的观察日志；Reflector 在观察增长后再次归并。近期原消息与观察一起进入主 Agent，上下文接近阈值时再激活已在后台生成的观察。当前配置还支持把图片、PDF 等附件交给 Observer，具体受模型能力与 MIME 过滤控制；非文本输入能够到达模型，不等于已产出可验证的营养、体重或账单字段。[实现类型](https://github.com/mastra-ai/mastra/blob/5bb592a862869d529d8d6ca48772cd0e1863f224/packages/memory/src/processors/observational-memory/types.ts)、[Observer](https://github.com/mastra-ai/mastra/blob/5bb592a862869d529d8d6ca48772cd0e1863f224/packages/memory/src/processors/observational-memory/observer-agent.ts)。

**比“只有有损摘要”更完整。** 当前 `retrieval` 可为观察组保留回查原消息的指针，并注册 recall 工具；可选再建向量索引。跨线程连续性应采用 thread 观察加 retrieval 或 resource working memory；旧的 resource 共享观察 scope 已弃用。不能根据较早介绍把它写成“所有跨会话记忆都放一段全局摘要”。[retrieval 与 scope 契约](https://github.com/mastra-ai/mastra/blob/5bb592a862869d529d8d6ca48772cd0e1863f224/packages/memory/src/processors/observational-memory/types.ts#L1030)。

**状态和未完事项。** 提示词明确区分断言、问题、意图和替换旧状态，输出当前任务/建议后续回应；可关闭 `suggestedResponse`。本产品宜借鉴这些语义分类，关闭替 Agent 决定下一句的建议。用户“想下周开始运动”是意图，“已运动三次”是事件，“明早提醒我”才可能形成需调度的承诺；OM 的任务提示不是带完成、取消、到期、幂等执行的事项状态机。[continuation 配置与提示词](https://github.com/mastra-ai/mastra/blob/5bb592a862869d529d8d6ca48772cd0e1863f224/packages/memory/src/processors/observational-memory/observer-agent.ts)。

**PoC 边界。** 适合验证长会话压缩能否降低 token 而保住细节；不必为了每天几条短记录迁入 Mastra runtime。仍须自建每条记录的即时持久化、跨天关联、结构化数值、明确纠正、事件证据和删除传播。仓库维护者的架构说明还逐项讨论 buffered observation 激活/反思换代的并发覆盖风险，并区分已验证、源码推断与修复方向；这提示选定存储后要测多进程与重启，不能把后台 buffering 理解为天然可靠。本文未独立复现这些问题。[架构与已知问题](https://github.com/mastra-ai/mastra/blob/5bb592a862869d529d8d6ca48772cd0e1863f224/packages/memory/src/processors/observational-memory/ARCHITECTURE.md)。

## 3. MemOS：应区分 Python 记忆服务和同仓库 Agent 本地插件

**独立服务路线。** Python `/product/add` 接消息、纯输入项与 metadata，可异步返回 `task_id`；`/product/search` 按 readable cubes 召回，提供 fast/fine/mixture 等模式。消息模型支持 `chat_time`、tool 输入输出和多模态项。它比纯聊天摘要更适合包装独立服务，但“支持纯输入/多模态”仍不自动建立生活记录领域 schema。[add](https://github.com/MemTensor/MemOS/blob/adcb9f270c982f2b9ff8db9714792829d3bd6ab8/docs/en/open_source/open_source_api/core/add_memory.md)、[search](https://github.com/MemTensor/MemOS/blob/adcb9f270c982f2b9ff8db9714792829d3bd6ab8/docs/en/open_source/open_source_api/core/search_memory.md)、[请求模型](https://github.com/MemTensor/MemOS/blob/adcb9f270c982f2b9ff8db9714792829d3bd6ab8/src/memos/api/product_models.py)。

**纠错值得实测。** MemFeedback 可利用上一轮 `retrieved_memory_ids` 缩小更正范围；源码有归档旧节点、`covered_history`、来源合并与版本更新分支。最值得借鉴的是“把上一轮实际用了哪些记忆传回来”，而非只让用户再描述一次。它仍由模型定位、判断和执行多步变更；不能据文档中的 atomic 一词推断自有原始记录、统计表、画像、缓存和外部任务已处于同一事务。更正“一杯改成两杯”与“我现在改喝茶了”的领域差别仍须显式建模。[MemFeedback](https://github.com/MemTensor/MemOS/blob/adcb9f270c982f2b9ff8db9714792829d3bd6ab8/docs/en/open_source/modules/mem_feedback.md)、[更新实现](https://github.com/MemTensor/MemOS/blob/adcb9f270c982f2b9ff8db9714792829d3bd6ab8/src/memos/mem_feedback/feedback.py#L269)。

**接入机制尤其有参考价值。** local plugin 的 DeepSeek Harness adapter 对每个非空 direct-user turn 强制预取，logical turn 内去重；显式 search 补查与自动 recall 共享最长 3 秒的前台 deadline，失败可机械截断候选/返回空。capture、摘要、关系、embedding 放后台，下一轮不等待上一轮全队列。这已经证明“前台必取、工具补查、后台摄取”是一种可实现的 adapter 机制，而不是仅靠提示词要求 Agent 记得调用工具。[adapter 契约](https://github.com/MemTensor/MemOS/blob/adcb9f270c982f2b9ff8db9714792829d3bd6ab8/apps/memos-local-plugin/README.md)、[接入源码](https://github.com/MemTensor/MemOS/blob/adcb9f270c982f2b9ff8db9714792829d3bd6ab8/apps/memos-local-plugin/adapters/deepseek-harness/index.ts#L368)。

**取舍。** 接入规则值得直接作为本产品的对照；3 秒是该 adapter 的策略，不是本产品应照搬的延迟目标。local plugin 的 L1 trace/L2 policy/L3 world model/skill 重点是 Agent 行动经验与技能演化，不宜把用户每天的身体和情绪当作技能训练轨迹。首轮只验证 Python 服务的记录抽取/纠错和 adapter 新鲜度边界；不把整套自进化模块引入主链路。MemOS 与 MemT 1.0 是不同项目，本轮结论不受 MemT 特定推理栈约束。

## 4. EverMemOS 当前已转向 EverOS：参考事件/画像分层与一致性契约

官方 EverMemOS URL 在核实日重定向到 EverOS。当前 1.5.1 保留 MemCell 提取概念，但持久层是 Markdown 真源、SQLite 状态/队列、LanceDB 检索；不应把旧论文或旧部署栈直接当当前 main。[当前仓库](https://github.com/EverMind-AI/EverOS/tree/5b0979b1b7f3a0cbe235756ff098515ec490753e)、[流水线说明](https://github.com/EverMind-AI/EverOS/blob/5b0979b1b7f3a0cbe235756ff098515ec490753e/docs/how-memory-works.md)。

用户侧 episode、atomic fact、profile、foresight 与 Agent case/skill 分开；派生模型含 `parent_id` 等来源链接。非文本 content 通过 parser 取得 `parsed_content` 后进入文本抽取，未解析项会计数；因此附件状态必须显式传回业务，不能让一条空解析记录表现成“已完整理解”。foresight 带证据和时间窗，适合参考为“潜在后续话题”，并不构成已授权提醒或承诺。[模型](https://github.com/EverMind-AI/EverOS/blob/5b0979b1b7f3a0cbe235756ff098515ec490753e/src/everos/memory/models.py)、[多模态归一化](https://github.com/EverMind-AI/EverOS/blob/5b0979b1b7f3a0cbe235756ff098515ec490753e/src/everos/memory/extract/ingest/multimodal.py)。

它明确区分 `/add` 累积、`/flush` 提取落盘、后台派生和索引可搜索几个阶段；当前 API 文档说明持久化完成也不保证 search/get 立即可见，且内置服务无认证。这恰好说明外部服务必须返回处理阶段/版本，而不能只有 `success=true`。本产品需要自有鉴权、单条记录即时可见、纠正覆盖和结构化统计；本地 Markdown 真源对可读导出有价值，作为多人云服务核心存储则须另行验证。当前不增加第三个完整服务 PoC。[API 与一致性](https://github.com/EverMind-AI/EverOS/blob/5b0979b1b7f3a0cbe235756ff098515ec490753e/docs/api.md#eventual-consistency)。

## 5. 剩余研究应转为四组实验

1. **短记录与状态演化：** 同一中文时间线包含补记、重复发送、两次真实相同事件、更正、计划转完成、同名他人。比较候选引擎能否保住不同事件、区分“变化”与“记错”，并提供原记录 ID。以产品时间线逐轮回放，避免只做历史问答。
2. **即时可见与故障：** 连续两条“我不吃花生”→“帮我记这份零食”，以及“上一笔不是 80 是 18”→“今天花多少”。模拟后台积压、超时、重试和重启，检查前台能否用最近原文及更正覆盖避免旧结论继续生效；记录版本水位和 P95 延迟。
3. **多模态与结构化：** 同一张餐照/小票/体重截图的原图、OCR/ASR、用户改正和结构化字段应属于同一个来源链。比较准确率、置信度表达和缺字段处理；不把后续转写当新一次记录，也不把估算热量当用户确定陈述。
4. **有用且少打扰：** 对每次新记录标注“该用哪些历史/可以不用历史/是否应追问”。验证记忆是否改善回复或工具参数，是否误用过期背景，是否把潜在话题变成未经用户要求的提醒。先复用现有 Hindsight/Mem0/自建基线，只增加 MemOS 的接入/纠错对照；有长会话成本证据后再运行 OM 对照。

这四组实验能决定需要哪种现成引擎。继续增加一串框架名称，不能回答产品当前最关键的新鲜度、事件真实性和交互收益问题。
