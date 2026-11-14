# 文档状态与开发依据

更新日期：2026年11月13日。当前设计版本：V1.2 修订2，目录沿用`spec-v1`；2026-10-28已补充分层和研究诊断，并修正约束完整性、授权/有序消费及验收边界。2026-10-30增加概念、端到端时序及既有验收映射；2026-11-02按agent-service实际源码细化逻辑架构、Host/应用接入、来源及使用控制链、确定性路径与验收变体。沿用Memory API/schema、检索模型/RRF参数、数值SLO及A/B/C范围，仍无服务实现或真实集成验收。

2026-11-08新增[Anthropic Agent Memory设计评估](../research/anthropic-agent-memory-review.md)，随后按授权将写入策略可选对照、后台维护成本及摊销口径补入04，在06中明确定向派生复核属于C并同步既有验收变体。继续采用修订2，API、数据模型、首发A及现有数值门槛不变；未启用扩展不成为首发前置。

2026-11-09在[00§4.1.1](spec-v1/00-boundaries-and-invariants.md#411-各层的构建与维护机制)补各层筛选、构建、更新与维护机制及偏好示例，在[§4.5.1](spec-v1/00-boundaries-and-invariants.md#451-llm与prompt的职责)补LLM/prompt、dreaming职责和Anthropic分层对照。仅解释已有合同，不新增接口、数据对象、首发范围或已交付模板。

2026-11-10新增[Agent Memory七模块文章评估](../research/agent-memory-seven-modules-review.md)，对照用户提供的本机HTML及LangChain官方资料；随后按用户授权补[00§4.1.3分类/职责说明](spec-v1/00-boundaries-and-invariants.md#413-agent信息来源与记忆分类维度)、[§4.5.3反馈诊断](spec-v1/00-boundaries-and-invariants.md#453-反馈诊断与受控修订)，以及[04§5.5既有验收变体](spec-v1/04-evaluation-and-acceptance.md#55-记忆触发偏好与事件身份的固定变体)和[§6.3.1归因与修复报告](spec-v1/04-evaluation-and-acceptance.md#631-反馈诊断与修复报告)。API、数据模型、首发范围及数值门槛不变，尚未实现夹具或服务。

2026-11-13新增独立[Mem0专项调研](../research/mem0-focused-research.md)，按固定源码区分OSS、Platform、自托管REST和官方/社区Agent集成，给出部署、SDK/API、Pi、OpenCode V1/V2及DeepSeek Harness接入路径，并核对授权和删除边界。仅新增研究依据，现行合同、首发范围及实现状态不变。

**整体方案从[V1整体方案与开发入口](spec-v1/README.md)开始；核心使用00–04，持久聊天接入另执行06，不使用下面两份历史方案的接口草案。**

第一次人工阅读或准备会议介绍，直接看[新手阅读与会议分享](spec-v1/README.md#0-新手阅读与会议分享)：包含建议顺序、具体章节、案例与讲解时间，不需要先通读全部分册。

跨电脑或新会话接手见[开发交接说明](cross-computer-handoff.md)及[可复制的完整 Prompt](continuation-prompt.md)（2026-10-28新增）。两者记录上手与实现状态，不新增业务合同。

| 文档 | 状态 | 用法 |
|---|---|---|
| [整体方案与开发入口](spec-v1/README.md) | 当前 | 架构概览、首发切片、按职责选择开发文档 |
| [00 边界与架构](spec-v1/00-boundaries-and-invariants.md) | 当前合同 | 组件职责与部署、agent-service具体映射及三类链路、内部L0–L3分层、不变量及授权 |
| [01 数据模型](spec-v1/01-data-model.md) | 当前合同 | 来源、记忆、证据、版本、索引和删除 |
| [02 API合同](spec-v1/02-api-contract.md) | 当前合同 | 参数、权限、回执、错误及首发接口切片 |
| [03 Agent时序与恢复](spec-v1/03-agent-sequences-and-recovery.md) | 当前合同 | Host/记录应用的实际接入与缺口、端到端时序、状态机、失败恢复及消费者清理 |
| [04 评测与验收](spec-v1/04-evaluation-and-acceptance.md) | 当前合同 | 适用测试、效果门槛、P0/P1及交付出口 |
| [05 整体审查记录](spec-v1/05-review-notes.md) | V1.1历史决策说明 | 保留上轮审查来历，不是额外接口合同 |
| [06 持久聊天摄取与补偿](spec-v1/06-history-ingestion-and-repair.md) | 当前扩展合同 | 聊天Adapter、当前宿主来源/控制映射、在线/离线同源、回填/修复/重抽、删除与任务验收 |
| [07 V1.2整体审查记录](spec-v1/07-v1.2-review.md) | 当前决策说明 | 修订1/2闭环问题、首发裁剪和验证边界，不另定义接口 |
| [独立记忆服务技术与产品方案](独立记忆服务技术与产品方案.md) | 开发合同已废止，历史参考 | 保留早期研究推导、产品假设和原设计评审，不据此实现旧API/台账 |
| [点滴demo调用链与完备性补充](点滴demo调用链与完备性补充.md) | 开发合同已废止，历史参考 | 保留demo核对和早期缺口分析，“尚待冻结”等结论只对应当时 |

MemoryService主要依据01＋02＋04，Agent/MemoryAdapter依据02＋03＋04，产品前后端依据00＋03及04适用集成用例；所有模块共同遵守00。

点滴A的原生聊天身份及持续生命周期控制已在01–03定义，不随history开关后置。启用历史扫描/补偿时，History Adapter及worker另按06开发，遵守01/02来源与权限，并通过04及06的适用验收。05保留V1.1审查来历，07记录V1.2修订1/2；两份审查记录都不另立接口合同。

历史文档保留原文件名及历史正文，便于追溯并保持链接有效。后续设计变更只维护spec-v1的相关合同并同步验收；不把历史文档更新成第二份现行方案。`research/`同样属于带版本的研究依据，不是开发规范。

2026-10-28新增一手核对入口：[上下文退化与GRPO/Agentic RL](../research/papers-frontier-notes.md#11-2026-10-28-上下文退化与学习策略补核)、[Hy-Memory论文/模型/SDK与CMB](../research/targeted-gaps-notes.md#6-2026-10-28-hy-memory官方资料核对)、[Mem0/Letta/Graphiti/MemOS版本与能力边界](../research/memory-frameworks-notes.md#7-2026-10-28-四条锚点路线重新核对)。现行吸收集中在00§4.5、01§5.3、04§6.4及G14/G15；未执行论文复现或模型测试。
