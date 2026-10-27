# 持久会话的记忆补充：Hermes 与 OpenClaw 核查

核查日期：2026-10-27（美国东部时间）。这是设计输入，不是开发合同；未运行两个项目。当前在线官方文档与现有固定源码分别标注，不能把 9 月源码当成 10 月实时版本。网络工具可以读取官方文档，但本机 Git 网络解析失败，未取得新的仓库 HEAD。

## 结论

**应补充从持久会话增量摄取、历史回填、漏处理修复和派生记忆重算的能力，但不能因此让 MemoryService 直接拥有或任意扫描产品 MySQL。** 持久聊天是证据源之一；摘要、模型回答、召回片段、工具提议与正式工具回执的权威不同。后台抽取不能把“建议记录”变成已提交业务记录，也不能绕过更正、删除和授权。

两个项目提供了相关模式，但名称和职责需要分开：

| 项目机制 | 实际输入与产物 | 触发与默认 | 对本服务的意义 |
|---|---|---|---|
| Hermes background review | 当前会话的消息快照，生成小容量 memory 或 skill 变更 | 按回合门槛触发的后台 fork；可关闭 | 在线回合后的补充抽取，不等于持久历史全库扫描 |
| Hermes session_search | SQLite 历史消息的 FTS5 检索 | Agent 按需调用 | 历史可检索与历史已抽取是两回事 |
| Hermes Curator | Agent 创建的 skill 库及使用统计 | 闲置检查；默认确定性维护，模型巩固需另开 | 程序性知识维护，不能当作个人事实后台抽取 |
| OpenClaw Dreaming | 短期信号、日记及符合准入条件的持久会话材料，经过候选阶段后晋升 | 当前官方文档默认启用，由 memory-core 管理周期任务 | 候选、巩固、证据门槛与审查轨迹可分离 |
| OpenClaw session-backfill | 保留的历史 transcript，按天分批处理 | 默认预览，显式 apply；可回滚生成物 | 历史回填是一条受控、可重跑的独立通道 |

未核实到 Hermes/OpenClaw 名为 **draw** 的内置历史聊天记忆机制，不据名称推断。Hermes 固定仓库的可选 `creative/dream-loop` 是视觉产品创作迭代技能，不能与记忆巩固混用。[固定 Dream Loop 说明](https://github.com/NousResearch/hermes-agent/blob/dcf72565c2766a4b8320478f5c0d3a7922d14e87/optional-skills/creative/dream-loop/SKILL.md)

## Hermes：已有后台学习，但持久补偿不能据此省略

固定源码：`NousResearch/hermes-agent@dcf72565c2766a4b8320478f5c0d3a7922d14e87`，2026-09-22。

- `agent_init.py` 内置 memory nudge 默认 10；`turn_context.py` 累计符合条件的用户回合；`turn_finalizer.py` 在成功交付、未中断且触发 memory/skill 复查时提交后台 review。它传入当前 `messages_snapshot`，没有在这条默认路径上自行扫描所有 `state.db` 历史。
- `background_review.py` 从主会话创建隔离 fork。同模型使用当前快照；不同模型走压缩 digest。执行侧工具白名单约束 memory/skill 和只读文件工具；skill-only 复查没有内置 memory 写权限。这种隔离值得借鉴，但线程仍为 best effort，不能提供 durable job 的重试和补偿保证。
- `memory_tool.py` 对无人值守的已有记忆替换/删除另设保护：这些操作需进入 pending，不能因为一般 write approval 关闭就静默执行。由“模型提出修正”到“确实发布修正”仍有独立提交边界。

固定来源：[初始化与默认值](https://github.com/NousResearch/hermes-agent/blob/dcf72565c2766a4b8320478f5c0d3a7922d14e87/agent/agent_init.py)、[回合门槛](https://github.com/NousResearch/hermes-agent/blob/dcf72565c2766a4b8320478f5c0d3a7922d14e87/agent/turn_context.py)、[交付后触发](https://github.com/NousResearch/hermes-agent/blob/dcf72565c2766a4b8320478f5c0d3a7922d14e87/agent/turn_finalizer.py)、[后台 fork](https://github.com/NousResearch/hermes-agent/blob/dcf72565c2766a4b8320478f5c0d3a7922d14e87/agent/background_review.py)、[写入保护](https://github.com/NousResearch/hermes-agent/blob/dcf72565c2766a4b8320478f5c0d3a7922d14e87/tools/memory_tool.py)。

当前官方文档还明确：`auxiliary.background_review.enabled: false` 可禁自动 review，手工 `/refine` 仍可用；managed local runtime 可把 review 延迟到闲置，队列在内存中，应用退出会丢未运行项。新消息可合并同会话待复查快照。这是降低竞争和成本的机制，并非离线消息摄取的可靠性设计。[当前持久记忆说明](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)

Curator 的当前官方定义专门针对 skill 库：默认启用，检查间隔 168 小时，至少闲置 2 小时；默认只做确定性的 stale/archive，`consolidate: false`；模型巩固需显式开启。它不自动永久删除 skill，也不负责从历史聊天抽用户健康事实。[当前 Curator 说明](https://hermes-agent.nousresearch.com/docs/user-guide/features/curator)

`session_search` 在固定源码中提供历史消息检索、围绕锚点滚动及最近会话浏览；这条路径能够让 Agent 找回遗漏历史，但不能推导出“所有历史都会被自动提炼”。外部 provider 可通过 turn/session/pre-compression 生命周期另做摄取，其行为依 provider 而异。[固定会话检索](https://github.com/NousResearch/hermes-agent/blob/dcf72565c2766a4b8320478f5c0d3a7922d14e87/tools/session_search_tool.py)、[固定 provider 协议](https://github.com/NousResearch/hermes-agent/blob/dcf72565c2766a4b8320478f5c0d3a7922d14e87/agent/memory_provider.py)

## OpenClaw：Dreaming 与历史回填确实覆盖持久会话

固定源码：`openclaw/openclaw@91f0839da752dd7411e23a235b99f38227d3b36d`，2026-09-22。

`dreaming-phases.ts` 的 `ingestSessionTranscriptSignals` 通过受控 corpus 枚举会话批次，把信号写入短期 recall store，并保存 ingestion checkpoint；与 daily-note 采集是不同路径。它处理有界窗口、来源及去重状态，不能概括为定时无限扫描全部历史。晋升候选另检查受信来源与 interactive session 类别；日记或被召回上下文不应重新充当独立证据。

固定来源：[会话摄取与 checkpoint](https://github.com/openclaw/openclaw/blob/91f0839da752dd7411e23a235b99f38227d3b36d/extensions/memory-core/src/dreaming-phases.ts)、[会话 ingestion](https://github.com/openclaw/openclaw/blob/91f0839da752dd7411e23a235b99f38227d3b36d/extensions/memory-core/src/session-ingestion.ts)、[候选准入](https://github.com/openclaw/openclaw/blob/91f0839da752dd7411e23a235b99f38227d3b36d/extensions/memory-core/src/dreaming-consolidation-candidates.ts)、[历史回填](https://github.com/openclaw/openclaw/blob/91f0839da752dd7411e23a235b99f38227d3b36d/extensions/memory-core/src/session-backfill.ts)。

当前 Dreaming 文档规定 Light → REM → Deep 顺序，只有 Deep 写 `MEMORY.md`；默认启用，但禁用 cron 时自动任务管理会暂停。会话自动摄取排除 cron、heartbeat、subagent、未知类型；晋升前重新读取活证据，已删或变更的旧 snippet 不应直接晋升。模型仅决定合并、添加与 supersede，写入器校验来源和预算，失败可回退。`DREAMS.md` 是人类审阅材料，不是新的晋升证据。[当前 Dreaming](https://docs.openclaw.ai/concepts/dreaming)

当前 CLI 的 `session-backfill` 默认预览保留的历史 transcript，`--apply` 将候选放入普通短期证据并写可回滚日记，**不会直接修改 `MEMORY.md`/`USER.md`**。日记历史回填 `rem-backfill` 则从日期 Markdown 文件出发，二者输入不同。回滚可撤销这些批次拥有的候选、日记和进度，不能拿回滚代替隐私删除。[当前 memory CLI](https://docs.openclaw.ai/cli/memory)

删除也有局限：当前 OpenClaw 会将 selected session IDs 标记 forgotten，后续自动摄取、历史回填和 transcript 重索引应跳过；但原 transcript、归档、导出与外部备份另需处理。具来源标记的生成物可以追删，旧的无来源改写与未知 paraphrase 无法可靠归因清除。准入策略变化本身也不会清掉已存在候选。[当前来源与删除边界](https://docs.openclaw.ai/concepts/memory-provenance)

## 可迁移到本项目的设计判断

1. 产品/Agent 的持久聊天库继续拥有会话及消息真相。专用 history adapter 以只读、按 owner 授权、有上限的分页/变更流交付稳定消息 ID、版本、角色、时间、删除和回执关系；MemoryService 不依赖某个 MySQL 表结构，也不持有通用 SQL 能力。
2. **在线增量、历史回填、对账修复、派生重算分开触发但复用写入语义。** 新增来源只摄取一次；模型/规则升级只生成新的派生版本，不能以换 source ID 的方式复制事实。回填按范围和预算进行，管理员/运维触发历史导入不等于取得用户数据授权。
3. 补偿链需要持久任务、lease、checkpoint、批次 manifest、输入 source-version closure、发布 CAS 与删除/撤权 gate。断线、进程退出、消息编辑、乱序删除和模型失败都能重试；一批处理“已完成”不能仅表示 LLM 调过。
4. 区分导入水位、抽取覆盖水位和查询索引水位，明确缺口。已有 read-after 或 visibility generation 不应承诺“上游所有聊天都已被抽取”；离线工作不阻塞普通记录成功回执。
5. 仅用户原话可形成 user-reported 证据；assistant 建议与总结仍为 agent-inferred。工具成功须由可信回执验证，权威业务事实依 RecordService 镜像。召回内容、摘要、系统提示和工具 schema 不可循环增信。
6. 从持久历史重建必须先经过当前删除/抑制与授权控制面；已删来源的全版本、重复导入别名、派生物和历史批次都要覆盖。否则“离线修复”会变成遗忘后复活数据的通道。

这些是结合本需求的设计推导，不是两个开源项目对多租户独立服务作出的保证。是否发布自动摘要、跨日 insight 或程序策略，仍受当前规格首发范围与相应验收约束。
