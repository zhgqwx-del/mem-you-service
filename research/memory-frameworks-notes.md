# 开源 Agent 记忆框架调研：针对中文个人生活记录服务

核实日期：2026-10-26（America/New_York）。本笔记区分论文、当前开源实现、商业托管能力；仓库均下载到 `/private/tmp/mem-you-memory-*` 进行静态代码核实，没有运行 benchmark，没有部署服务，没有修改用户的其他项目。以下“建议/判断”是针对本项目的工程推论，不是厂商性能结论。

## 1. 最重要的结论

这个产品的核心应是**用户的可追溯生活事件库，加上为 Agent 提供上下文的记忆投影**。不能把“抽出一些值得记住的事实，再做向量检索”直接当作完整服务。体重、支出、饮食和心情首先是按时间发生的多条事件；长期偏好、身体背景、阶段性状态是从事件派生的不同对象。一次记录不够“重要”也必须保存，否则服务失去记录产品的价值。

建议借鉴的组合是：LangGraph 的会话状态与跨会话数据分离；LangMem 的结构化 schema 和可组合抽取；Graphiti 的事件溯源与双时间关系；Hindsight 的多路检索、证据支持的观察与主题缓存；Letta 的少量常驻记忆和可读文件投影。**不是把所有框架拼进技术栈**，而是在自有事件模型和 HTTP API 上挑选少量可替换实现。

若要快速比较现成服务，Hindsight 是值得做完整 PoC 的候选，Mem0 是轻量记忆 API 的对照，Graphiti 是关系和时间演进较复杂时的可选引擎。Letta 更适合参考 Agent 如何消费与整理记忆，LangMem 更适合当内部库。依据是接口与数据模型的匹配，不依据任何厂商 benchmark 排名。

## 2. 版本快照与两个容易误判的变化

| 对象 | 本次核实的当前源码 | 版本/日期 | 开源许可与范围 |
|---|---|---|---|
| Mem0 OSS | [26cdefb](https://github.com/mem0ai/mem0/tree/26cdefb46600c0fa5953c4b5ee5003c125539fc4) | `mem0ai` 2.2.1；2026-10-26 | Apache-2.0；库与自托管 server 均在仓库，Cloud 并非完全同能力 |
| Graphiti | [2b5db9e](https://github.com/getzep/graphiti/tree/2b5db9e139b2627c3ba18ff55f9181569b0d8224) | `graphiti-core` 0.31.2；2026-10-26 | Apache-2.0；图引擎与 MCP server 可自托管 |
| Hindsight | [5a672f0](https://github.com/vectorize-io/hindsight/tree/5a672f0cdb89f4a3b841770cce2036a5b28b799d) | `hindsight-api-slim` 1.1.0；2026-10-26 | MIT；API、worker、控制界面、SDK/集成在仓库；不把 Cloud 企业功能自动算进 OSS |
| LangMem | [48e3c11](https://github.com/langchain-ai/langmem/tree/48e3c11f5bb527282c7d5339c6a87a0b35abccfc) | 0.0.30；2026-10-02 | MIT；Python 库，自建持久化与服务包装 |
| Letta 历史仓库 | [8816d3a](https://github.com/letta-ai/letta/tree/8816d3a8516893bfdc0fa14bfb1235226012e295) | 2026-10-18 | 当前 main 仅保留迁移入口，退休 V1 server 在 `archive` 分支 |
| 当前 Letta Code | [b995585](https://github.com/letta-ai/letta-code/tree/b995585d42313c9ddb8873986de05e01a595d52a) | `@letta-ai/letta-code` 0.34.25；UTC 2026-10-27，纽约 10-26 | Apache-2.0；Agent harness / App Server / MemFS；Cloud 服务边界另查 |

版本与许可依据：[Mem0 pyproject](https://github.com/mem0ai/mem0/blob/26cdefb46600c0fa5953c4b5ee5003c125539fc4/pyproject.toml)、[Graphiti pyproject](https://github.com/getzep/graphiti/blob/2b5db9e139b2627c3ba18ff55f9181569b0d8224/pyproject.toml)、[Hindsight pyproject](https://github.com/vectorize-io/hindsight/blob/5a672f0cdb89f4a3b841770cce2036a5b28b799d/hindsight-api-slim/pyproject.toml)、[LangMem pyproject](https://github.com/langchain-ai/langmem/blob/48e3c11f5bb527282c7d5339c6a87a0b35abccfc/pyproject.toml) 与 [LICENSE](https://github.com/langchain-ai/langmem/blob/48e3c11f5bb527282c7d5339c6a87a0b35abccfc/LICENSE)、[Letta 迁移 README](https://github.com/letta-ai/letta/blob/8816d3a8516893bfdc0fa14bfb1235226012e295/README.md)、[Letta Code package.json](https://github.com/letta-ai/letta-code/blob/b995585d42313c9ddb8873986de05e01a595d52a/package.json)。LangGraph 开源库是 [MIT](https://github.com/langchain-ai/langgraph/blob/main/LICENSE)，本次核实在线文档，未固定 LangGraph 源码版本。

两个变化必须写进正式选型记录：

1. **Mem0 2025 论文不等于当前 OSS。** 论文描述的抽取、更新与 graph 增强方案仍有参考价值；当前 2.2.1 主写入路径已是 ADD-only 抽取。不能拿旧文中的 ADD / UPDATE / DELETE / NOOP 流程、Graph Memory 或 Cloud 时间能力，直接宣称当前 OSS 默认具备。[2025-04-28 论文](https://arxiv.org/abs/2504.19413)、[当前 `_add_to_vector_store`](https://github.com/mem0ai/mem0/blob/26cdefb46600c0fa5953c4b5ee5003c125539fc4/mem0/memory/main.py#L881)。
2. **MemGPT、Letta V1 和当前 Letta Code 应分开。** MemGPT 是虚拟上下文管理的论文；V1 使用 memory blocks、recall/archival；当前 Letta 主线已转向 Git 支持的 MemFS。旧文档仍能打开但标记为 legacy。[MemGPT 论文 v2，2024-02-12](https://arxiv.org/abs/2310.08560v2)、[V1 memory blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks)、[当前 MemFS](https://docs.letta.com/concepts/memfs)。

## 3. 系统逐项分析

### 3.1 MemGPT / Letta：由 Agent 管理上下文，而非独立生活数据库

**原理与架构。** MemGPT 的贡献是让 LLM 通过工具在有限上下文与外部存储之间搬运信息，并用控制流机制连续执行管理操作。V1 的 core blocks 常驻 prompt，archival memory 在外部检索，完整消息历史另存。它解决“模型当前看见什么、怎样自己找回更多”的问题。[论文](https://arxiv.org/abs/2310.08560v2)、[V1 context hierarchy](https://docs.letta.com/v1-sdk/memory/context-hierarchy)、[V1 archival memory](https://docs.letta.com/v1-sdk/memory/archival-memory)。

**当前实现。** Letta Code 使用 MemFS：每个 Agent 有 Git 记忆仓库，文件通常为带 YAML 元信息的 Markdown；root files 每轮进 system prompt，有 `MEMORY.md` 索引的深层目录按需读取。默认没有向量/语义索引；可通过 MemFS Search mod 与 QMD 加入。消息历史搜索与 MemFS 搜索分开，本地和 Cloud 能力也有区别。[MemFS 文档](https://docs.letta.com/concepts/memfs)、[文件投影源码](https://github.com/letta-ai/letta-code/blob/b995585d42313c9ddb8873986de05e01a595d52a/src/agent/memory-filesystem.ts)、[prompt 构造](https://github.com/letta-ai/letta-code/blob/b995585d42313c9ddb8873986de05e01a595d52a/src/agent/prompts/memory_filesystem.mdx)。

**写入、反思、冲突与溯源。** 前台 Agent 可更新持久知识；Dreaming 用后台 subagent 整理近期对话，按步数或上下文压缩触发。Git commit 提供版本记录，后台 worktree 支持并发整理；它解决文本版本与合并，并不自动提供“这个健康结论由哪一条用户原话支持”的事件级证据模型。[Memory & dreaming](https://docs.letta.com/configuration/memory)、[worktree 实现](https://github.com/letta-ai/letta-code/blob/b995585d42313c9ddb8873986de05e01a595d52a/src/agent/memory-worktree.ts)、[冲突修复](https://github.com/letta-ai/letta-code/blob/b995585d42313c9ddb8873986de05e01a595d52a/src/agent/memory-conflict-repair.ts)。

**本项目取舍。** 借鉴“少量稳定背景常驻，细节按需拉取”和用户可编辑的记忆页；把它作为自有数据库生成的 profile/topic 投影较合适。不要把每天体重、每笔账单都交给 Agent 自由改写 Markdown，也不要把 Git 文本冲突当作事实冲突的解决机制。主服务不应要求调用方迁入 Letta runtime。

### 3.2 Mem0：轻量独立记忆层，但必须按当前 OSS 边界评估

**写入。** 当前 `Memory.add` 可接文本/消息列表，按 user/agent/run scope 隔离；`infer=False` 原文入库，默认则取最近消息和相关旧记忆后做一次 LLM 抽取。主路径按 hash 去重、批量 embedding/写向量库、写 SQLite history、做实体与记忆关联、保存消息。提示词提倡语义去重、保留新事件与实体上下文，且区分用户陈述和助手建议来源。[主路径 L760–1225](https://github.com/mem0ai/mem0/blob/26cdefb46600c0fa5953c4b5ee5003c125539fc4/mem0/memory/main.py#L760)、[抽取 prompt](https://github.com/mem0ai/mem0/blob/26cdefb46600c0fa5953c4b5ee5003c125539fc4/mem0/configs/prompts.py#L464)。

**冲突与溯源。** 自动写入是 additive，不应描述成自动覆盖所有旧冲突；显式 update/delete API 和 history 仍在。history 保存旧/新文本、操作、时间等，messages 表另存会话内容，但不是一个自动建立 source span 的不可变生活事件账本。代码中的抽取 prompt 会产出 `linked_memory_ids`；本次核实的持久化主路径没有直接把该字段保存为 memory-to-memory 关系，实际 entity store 的同名字段是实体到记忆 ID 的链接。不能仅凭 prompt 认定跨记忆关系已闭环。[history/messages schema](https://github.com/mem0ai/mem0/blob/26cdefb46600c0fa5953c4b5ee5003c125539fc4/mem0/memory/storage.py#L102)、[实际持久化与实体关联](https://github.com/mem0ai/mem0/blob/26cdefb46600c0fa5953c4b5ee5003c125539fc4/mem0/memory/main.py#L1010)。

**检索。** 当前有语义候选、关键词分数、实体加权，可选 reranker。需注意 `_search_vector_store` 的最终候选集合来自语义召回，关键词/实体主要参与候选打分，因此不能把它等同于四路独立召回取并集。部分 store 不支持关键词搜索会退化。[检索源码](https://github.com/mem0ai/mem0/blob/26cdefb46600c0fa5953c4b5ee5003c125539fc4/mem0/memory/main.py#L1642)。

**时间与中文。** OSS 的 `add(timestamp=...)` 和 `search(reference_date=...)` 明确报错，Cloud 才支持这两个时间参数；`expiration_date` 可用。抽取 prompt 有 observation date，但 OSS 主调用没有传入业务观察时间，默认落到当前 UTC 日期。对补记“昨天”、回填历史数据，必须自行传递并解析发生时间，不可只靠这个默认值。增强 NLP 当前加载英文 `en_core_web_sm`，中文应单独评测分词/实体与 embedding，不能把“LLM 能写中文”当成中文检索已经验证。[参数检查](https://github.com/mem0ai/mem0/blob/26cdefb46600c0fa5953c4b5ee5003c125539fc4/mem0/memory/main.py#L760)、[日期默认](https://github.com/mem0ai/mem0/blob/26cdefb46600c0fa5953c4b5ee5003c125539fc4/mem0/configs/prompts.py#L1007)、[NLP loader](https://github.com/mem0ai/mem0/blob/26cdefb46600c0fa5953c4b5ee5003c125539fc4/mem0/utils/spacy_models.py)。

**耦合与部署。** `add/search/update/delete/history` 很适合外部服务包装；库、自托管 server 与 Cloud 有分层，当前 MemoryConfig 没有 graph_store 字段，主 `add/search` 也没有历史 Graph Memory 路径。官方 README 对自托管的高级功能有范围区别，不能把 Cloud API 文档当成 OSS 清单。[MemoryConfig](https://github.com/mem0ai/mem0/blob/26cdefb46600c0fa5953c4b5ee5003c125539fc4/mem0/configs/base.py)、[官方部署分类](https://github.com/mem0ai/mem0/blob/26cdefb46600c0fa5953c4b5ee5003c125539fc4/README.md#L120)。

**本项目取舍。** 适合作为记忆抽取和语义检索 PoC，或给自有记录库加一个事实投影。不直接作为体重/账务权威存储；不要在“事实是否值得记住”的 LLM 筛选之后才保存原记录。对中文补记、重复记录、来源关系与请求失败后的重试幂等必须自建契约。

### 3.3 LangChain / LangGraph / LangMem：框架原语和可组合抽取，而非现成记忆 SaaS

**LangGraph 的两个底座。** Checkpointer 保存一个 thread 的 graph state，承担继续会话、恢复、工具执行状态；Store 保存跨 thread 的任意 JSON 数据，按 `namespace + key` 组织，可加 metadata filter 和 embedding search。Store 的 `created_at/updated_at` 是存储元数据，不自动成为业务上的发生时间、有效区间或事实版本。[Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)、[Long-term memory](https://docs.langchain.com/oss/python/langchain/long-term-memory)、[Stores 源文档](https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/stores.mdx)。

**LangMem 的增量价值。** 可以为 semantic/profile/episode 定义 Pydantic schema，以 `create_memory_manager` 分析新消息与已有记忆；底层使用 trustcall 结构化抽取/patch，插入、更新和删除可分别开关（删除默认关闭）。核心 manager 可独立使用，自行负责存储；`MemoryStoreManager` 则搜索候选、合并、把更新写回 LangGraph Store。[抽取 API 和实现](https://github.com/langchain-ai/langmem/blob/48e3c11f5bb527282c7d5339c6a87a0b35abccfc/src/langmem/knowledge/extraction.py#L217)、[结构化用户 profile 指南](https://github.com/langchain-ai/langmem/blob/48e3c11f5bb527282c7d5339c6a87a0b35abccfc/docs/docs/guides/manage_user_profile.md)。

**反思与 Agent 集成。** 可以给 Agent 提供 manage/search 工具，在前台决定何时记忆；也可后台 consolidation。LangMem 还包含基于反馈修改 prompt 的 procedural memory 能力。针对生活记录，建议只用可控 schema 抽取和后台归纳，不让个人日志自动改变 Agent 的系统规则或领域风险策略。[概念指南](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)、[Memory tools 源码](https://github.com/langchain-ai/langmem/blob/48e3c11f5bb527282c7d5339c6a87a0b35abccfc/src/langmem/knowledge/tools.py)、[后台执行器](https://github.com/langchain-ai/langmem/blob/48e3c11f5bb527282c7d5339c6a87a0b35abccfc/src/langmem/reflection.py)。

**本项目取舍。** 很适合作为抽取实现库，尤其能把“健康状态”“支出”“体重测量”拆成不同 schema。但溯源、时区、同一事实的演化、权限、删除传播、精确统计和独立服务 API 都由应用负责。命名空间是数据组织机制，HTTP 层仍需把认证身份绑定到 tenant/user，不能把用户传入任意 namespace 当成授权。旧式 Buffer/Summary/VectorStore conversation memory 更接近上下文装配方案，不能代替跨 Agent 的业务记忆服务。

### 3.4 Graphiti / Zep：增量时间知识图谱，时间关系和溯源值得借鉴

**数据模型。** Episode 保存原始 text/message/JSON 及来源；entity 节点保存实体；entity edge 以 `fact` 表达关系并保留相关 episode IDs。边包含 `created_at/expired_at`（系统时间）与 `valid_at/invalid_at`（事实有效时间），当前还有 `reference_time`；不会只以一条 `updated_at` 表示所有时间含义。[Episode 模型](https://github.com/getzep/graphiti/blob/2b5db9e139b2627c3ba18ff55f9181569b0d8224/graphiti_core/nodes.py#L318)、[EntityEdge](https://github.com/getzep/graphiti/blob/2b5db9e139b2627c3ba18ff55f9181569b0d8224/graphiti_core/edges.py#L263)、[Zep 论文，2025-01-20](https://arxiv.org/abs/2501.13956)。

**写入与冲突。** `add_episode` 取近期上下文、LLM 抽实体/关系、实体解析、边去重与日期解析、判断矛盾，旧边通过有效区间/过期时间失效而非简单抹去；原 episode 默认保留。需要注意这是模型判断关系冲突，不是已证明业务正确的规则引擎。当前 bulk 也处理日期与失效，旧文章中 bulk 的能力限制不能直接套到本快照。[写入](https://github.com/getzep/graphiti/blob/2b5db9e139b2627c3ba18ff55f9181569b0d8224/graphiti_core/graphiti.py#L1334)、[bulk](https://github.com/getzep/graphiti/blob/2b5db9e139b2627c3ba18ff55f9181569b0d8224/graphiti_core/graphiti.py#L1588)、[矛盾解析与失效](https://github.com/getzep/graphiti/blob/2b5db9e139b2627c3ba18ff55f9181569b0d8224/graphiti_core/utils/maintenance/edge_operations.py#L719)。

**检索与归纳。** 混合向量、全文和图遍历，可选 RRF、MMR、中心节点距离和 cross-encoder 等重排；有 episode/entity/edge/community 不同检索范围，community 可做群组摘要。不要笼统宣称“查询绝不调用 LLM”：RRF 路径可不需要，但当前 cross_encoder 默认客户端是 OpenAIRerankerClient，是否调用模型取决于具体 recipe 与客户端。[search recipes](https://github.com/getzep/graphiti/blob/2b5db9e139b2627c3ba18ff55f9181569b0d8224/graphiti_core/search/search_config_recipes.py)、[构造器](https://github.com/getzep/graphiti/blob/2b5db9e139b2627c3ba18ff55f9181569b0d8224/graphiti_core/graphiti.py#L212)。

**开源与服务边界。** Graphiti 是 Apache-2.0 引擎，数据库与 LLM/embedding 后端可替换，可通过 MCP/自包装 API 服务多个 Agent。Zep Cloud 则有额外用户/线程管理、上下文装配、治理、专有模型等；当前 `getzep/zep` 是例子和集成仓库，不是完整产品源码，旧 Community Edition 已弃用。需要自托管开源引擎时选 Graphiti；不要据 Zep 仓库的许可认定 Cloud 产品可完整自建。[官方对比](https://help.getzep.com/zep-vs-graphiti)、[当前 Zep 仓库说明](https://github.com/getzep/zep)、[自托管 FAQ](https://help.getzep.com/faq)。

**本项目取舍。** “我最近换药了”“开始避免乳制品”“母亲有糖尿病”“同一症状与某次旅行的关系”适合考虑图关系；“每天体重”和“所有支出求和”不值得先变成图才能查。把测量事件误建成单一 `user — weight → 70` 再不断失效，虽保留历史也会让统计、单位和纠错更复杂。图应是可重建索引，保留专用测量/交易事件表。

### 3.5 Hindsight：证据、归纳与检索服务分层较完整，值得实测

**核心接口与视角。** 独立服务暴露 retain / recall / reflect，可经 SDK、REST、MCP 接入任意 Agent。当前模型区分 world、experience、observation、mental model。要特别留意：`experience` 是 bank 所属 Agent 的亲历行为；用户说“我头痛”应成为关于用户的 world fact，不是 Agent 自己头痛。需在 context 标明 speaker。[Retain 文档源文件](https://github.com/vectorize-io/hindsight/blob/5a672f0cdb89f4a3b841770cce2036a5b28b799d/hindsight-docs/docs/developer/retain.md)、[论文，2025-12-14](https://arxiv.org/abs/2512.12818)。

**写入与数据模型。** Retain 抽取相对完整的叙事情境、实体、时间与联系，再正规化与索引。`Document.original_text` 保留输入，`MemoryUnit` 关联 document，抽取结果保留 chunk/content 索引；事实明确区分 `occurred_start/end` 和 `mentioned_at`。这些比单纯存一条被摘要过的字符串更贴近补记、跨会话理解和可解释检索。[SQLAlchemy 模型](https://github.com/vectorize-io/hindsight/blob/5a672f0cdb89f4a3b841770cce2036a5b28b799d/hindsight-api-slim/hindsight_api/models.py#L104)、[抽取与 chunk 类型](https://github.com/vectorize-io/hindsight/blob/5a672f0cdb89f4a3b841770cce2036a5b28b799d/hindsight-api-slim/hindsight_api/engine/retain/types.py#L207)。

**检索。** Semantic、keyword、graph、temporal 多路召回，融合与 rerank 后按 token budget 输出；时间窗口内还能按时间段分散候选，避免整年查询只捞最密集的几天。中文不是只能依赖英文全文索引：当前文档列出 PGroonga 以及 `pg_search` 的 `jieba`、`chinese_compatible`、`ngram` 等可配置 tokenizer；native 后端是 PostgreSQL TF-IDF，而不是真 BM25。需要实测中文短记录与中文日期解析。[Recall 文档](https://hindsight.vectorize.io/developer/retrieval)、[多路召回代码](https://github.com/vectorize-io/hindsight/blob/5a672f0cdb89f4a3b841770cce2036a5b28b799d/hindsight-api-slim/hindsight_api/engine/search/retrieval.py)。

**归纳与推理。** Observations 从多条 facts 后台整合，保留支持事实、引用和 proof count，随新证据修订；mental model 是预定义主题问题的持久答案，可后台刷新、快速读取。Reflect 则是主动收集证据的推理循环，依次利用 mental models、observations、raw facts，返回引用。归纳刷新有延迟，不能把缓存当作当前记录已可见的保证。[Observations](https://hindsight.vectorize.io/developer/observations)、[Mental models 源文档](https://github.com/vectorize-io/hindsight/blob/5a672f0cdb89f4a3b841770cce2036a5b28b799d/hindsight-docs/docs/developer/mental-models.mdx)、[Reflect](https://hindsight.vectorize.io/developer/reflect)。

**存储与部署。** 主 OSS 存储为 PostgreSQL + pgvector，全文、JSONB、关系与图遍历集中在一个数据库，API/worker 可自托管。按用户建立 bank 是自然映射；外层仍须可信地绑定身份与 bank，不能让 Agent 自选任意 bank。官方声称原语言保留适用于 facts、entities 和 reflect，但这不是中文准确率的实测结果。[Storage](https://hindsight.vectorize.io/developer/storage)、[Multilingual](https://hindsight.vectorize.io/developer/multilingual)、[源码](https://github.com/vectorize-io/hindsight/tree/5a672f0cdb89f4a3b841770cce2036a5b28b799d)。

**本项目取舍。** 最值得借鉴的是“事实/原文、支持证据、归纳、按问题读记忆”分层。主请求应取 recall 风格的证据包，让调用 Agent 处理回复、工具与反问；不必每次新日志都在 memory service 内跑 reflect 再由外层 Agent 重做一遍推理。健康领域不能把多次同现就当因果，支出统计和体重趋势仍走结构化查询。人称、中文实体合并和归纳把暂态情绪变成人格标签，是 PoC 应优先检查的误差。

## 4. 面向此场景的能力对照

下表“需自建”不是产品缺陷，而是它原本不承诺承担完整生活记录系统。

| 维度 | Letta 当前 MemFS | Mem0 当前 OSS | LangGraph + LangMem | Graphiti | Hindsight |
|---|---|---|---|---|---|
| 主要定位 | Stateful Agent 的可编辑记忆文件 | 事实抽取与检索层 | 持久化原语 + 抽取库 | 时间知识图谱引擎 | retain/recall/reflect 服务 |
| 跨任意 Agent | 需外层适配，核心仍绑 Agent runtime | 容易包装 API | 核心可独立，服务自行包装 | 引擎/MCP，可包装 API | SDK/REST/MCP |
| 原始记录溯源 | Git/会话历史，事件证据另建 | history/messages，source span 另建 | schema 与存储自行定义 | 原 episode 与 edge→episode | document/chunk/fact 与观察证据 |
| 业务时间 | 文件中自定义 | timestamp/reference_date 为 Cloud 限定，OSS 需补 | schema 自定义 | 边有效时间 + 系统时间 | occurred 时间范围 + mentioned_at |
| 自动长期归纳 | Dreaming | 当前主路径 additive extraction | 可组合后台 manager | 实体/群组摘要 | observations、mental models |
| 精确 sum/avg/count | 需自建 | 需自建 | 需自建 | 需领域数据与查询 | 需领域数据与查询 |
| 中文主要风险 | 文件内容可中文，检索依工具 | 默认增强 NLP 英文模型 | 取决于 schema/LLM/embed/store | 实体解析、全文 analyzer、日期 | 实体解析、全文 backend、日期 |
| 我方较合适用途 | 可读 profile/topic 投影 | 轻量 PoC 对照/记忆投影 | 自建服务内部抽取模块 | 可选关系与时间索引 | 完整记忆服务 PoC 对照 |

## 5. 可以落到方案中的设计要求

以下是基于上面机制与生活记录约束作出的工程建议。

1. **原记录先落库。** 服务入口接收 `record_id/idempotency_key、user_id、source_agent、message_id、role、content、recorded_at、user_timezone`。写入持久化成功即算“已记录”；抽取/embedding/归纳异步完成。短消息是否值得形成长期画像，不影响原记录保存。
2. **事件与状态分开。** 今天 70.2 kg、明天 70.5 kg 是两次观测；“昨天报错了，应是 70.0”是 correction/supersedes；“不再吃肉”是偏好状态变更；“打算减到 65”是目标。不能对这些都用 UPDATE/DELETE 的同一套模型提示词。
3. **原话、抽取事实、推断三层。** 每条派生项带 `source_record_ids/source_spans、extractor_version、as_of、confidence/status`，区分用户明确说、Agent 建议、模型归纳。健康和财务的推断不能回写成用户确认事实。
4. **时间可不确定。** 分开 recorded/mentioned 时间、occurred interval、valid interval 和系统处理时间；保存原始时间表达、解析锚点、时区与精度。补记“上周三”“昨天晚上”不能靠服务器当前日期解析；没有说日期时不要伪造精确时分秒。
5. **检索至少两条通路。** 新短记录先做相关历史/最近事件/当前状态检索；精确数值与时间统计走受控 SQL 或领域 query API。低频关系推理再加图，不要求一开始图数据库。候选结果做合并、去重、重排和预算裁剪。
6. **返回证据包。** HTTP 主接口返回 profile 快照、相关原事件、当前事实、冲突/未决信息、可选聚合和来源 ID；把“要回复、要调用什么工具、要不要追问”留给 Agent。Reflect 可是按需能力，不是每次短记录的必经环节。
7. **派生内容可重建。** 原文和结构化确认事件为权威数据，向量/图/观察/主题摘要均可按版本重建；删除或纠错必须能传播到所有索引与主题摘要。缓存返回 `as_of/source_watermark`，新记录尚未归纳时用原事件补齐。
8. **Agent 适配只做薄层。** 统一 REST/SDK 为核心，MCP tools 与 hooks/plugins 复用同一身份和幂等机制。Hook 在输入/工具输出时调用不会比 API 多出另一套数据真相；调用侧 timeout 不得导致用户重试后记两次。

## 6. PoC 的公平验证方式

推荐先比较“自有事件库 + SQL/全文/向量基线”“Mem0 OSS 投影”“Hindsight 服务”；只有关系问题显著影响体验才增 Graphiti。全部使用同一模型、同一中文数据和同一预算，测试写入失败与异步可见性，不只测对历史的问答分数。

| 测试组 | 示例 | 应验证什么 |
|---|---|---|
| 极短与指代 | “还是疼”“比昨天好多了”“又吃了那个” | 能从近邻事件解指代，无法确定时保留未决，不强造事实 |
| 连续数值 | 每天体重、同日早晚两次、kg/斤混合 | 不把正常变化视作矛盾；单位转换；聚合全量而非 top-k |
| 补记与跨时区 | 周一补记“上周五晚饭”；旅行后本地“今天” | 记录时间、发生时间、用户日界正确 |
| 显式纠错 | “不是 520，是 52；那笔算昨天” | 修改正确事件，保留来源；索引/聚合/摘要同步更新 |
| 事实/愿望/建议 | “想少喝咖啡”“医生说可考虑…”“Agent 推荐…” | 不误写成已实行习惯或确诊结论 |
| 跨域关联 | 晚咖啡、睡眠、心情、加班 | 召回相关上下文但不把相关性宣称为因果 |
| 中文实体 | 妈妈/母亲、昵称、同名朋友、中英文药名 | 正确归并，允许修复，不把不同人强行合并 |
| 忘记与隔离 | 删除一条敏感记录；不同 Agent 同用户/不同用户 | 派生删除传播、身份隔离、共享边界和来源可解释 |
| 统计与缺测 | 最近 30 天平均/最大、没有记录的日期 | SQL 精确结果、样本数、覆盖区间；不把未记录当零 |
| 低延迟与重试 | LLM 抽取超时、重复 webhook、异步 backlog | 原始记录不丢、幂等、退化可用、`as_of` 明确 |

应该记录的指标包括：原始保存完整率、字段抽取准确率、关键证据 recall@budget、错误历史污染率、时间归一正确率、纠错与删除传播、数值聚合正确率、p50/p95 延迟、每条写入与每次检索成本。LongMemEval/LoCoMo 的厂商成绩可以了解其测试题型，不能替代这些中文生活记录验收。
