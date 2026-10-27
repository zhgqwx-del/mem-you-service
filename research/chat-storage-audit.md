# agent-service 持久聊天作为离线记忆来源的只读核查

核查日期：2026-10-27。被核查仓库：`/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service`，HEAD 为 `5d38b2cd6307aab9c8dec2c475b1bebf886d8283`；核查时 `git status --short` 无输出。本次只读源码与公开设计，没有连接 MySQL、读取运行私有配置、导出用户聊天、调用模型或修改该仓库。下列结论描述这个固定源码版本，不能据此声称运行实例已启用对应能力或生产验收通过。

本文是设计输入，不是 MemoryService 的新接口合同；具体实现依据 `docs/spec-v1/` 的当前规格。

## 1. 结论

可以把 agent-runner 的持久聊天作为离线补采和重新提取的来源，但需要由 Agent/产品侧的 **Chat History Adapter** 提供受授权的、带版本和删除控制的来源数据，不能让独立 MemoryService 自由扫描业务 MySQL。MemoryService 接收规范化来源并管理提取任务；原会话存储、身份授权、源删除事实和读取范围仍由上游负责。

已存在的可靠基础是：MySQL 模式、稳定 session/turn/item ID、每会话顺序事件、原始用户输入与有效输入分离、业务事务内提交、普通读取的生命周期过滤。尚未看到面向 MemoryService 的全量聊天增量导出/删除订阅合同。现有 SSE、工具 webhook、用户导出和 terminal outbox 各有用途，不能直接称为完整的离线记忆通道。

## 2. 存储与稳定身份

| 已核实事实 | 源码依据 | 对记忆接入的含义 |
|---|---|---|
| `cfg.STORE === "mysql"` 时创建 `MysqlSessionStore`，否则采用内存 store；普通启动只校验 schema | [main.ts:346](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/apps/agent-runner/src/main.ts:346) | 用户所说的 MySQL 有真实实现依据；本次未连接运行实例，不能从代码分支证明当前实例配置 |
| sessions 带 tenant/user、last_seq、archive/delete 时间；turns 带 turn_id、seq_start/seq_end、状态；items 带稳定 item_id、初始 seq、type、status、body | [0001_init.sql:28](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/store/migrations/0001_init.sql:28) | 身份应采用部署/源系统命名空间加 tenant/user/session/item；不能用正文相似度或时间戳生成事件身份 |
| events 主键为 `(session_id, seq)`；只存 milestone，流式 delta 不落此表 | [0001_init.sql:80](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/store/migrations/0001_init.sql:80) | 每会话事件序号可作提交顺序和增量检查点；没有全库全局 seq，不应将 session 列表游标当全局变更流 |
| CommitBatch 以 session fence 为写入准入，事件序号在事务中分配；允许 expectedLastSeq CAS | [types.ts:294](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/store/src/types.ts:294)、[store.ts:46203](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/store/src/mysql/store.ts:46203)、[store.ts:46453](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/store/src/mysql/store.ts:46453) | 提交后的来源具有明确顺序；离线消费只使用已提交事件/源快照，不读正在生成的模型分片 |
| items 可按原 item_id 更新 status/body/completed_at，初始 seq 不随更新前移 | [store.ts:62238](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/store/src/mysql/store.ts:62238)、[types.ts:402](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/store/src/types.ts:402) | `items.seq > cursor` 只能发现首次出现的条目，不能充当所有更改的完整 CDC；要消费 milestone revision 或由 Adapter 输出源修订 |

目前 `listSessions` 按 session ID 倒序分页，不是按 `updated_at_ms` 的可靠增量入口；是否有新 turn 要逐已登记会话追踪或由上游新增变化通知。证据：[store.ts:39438](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/store/src/mysql/store.ts:39438)。

在当前源码中没有发现普通逐消息编辑/删除 HTTP 路由，也没有 items 专用 `updated_at_ms`、`row_version` 或通用原始 userMessage 内容不可变合同。item preflight 固定 owner/session/turn/type，而不是固定正文；0053 的不可变触发器主要针对特定 failed agentMessage，不是所有用户原话。证据：[app.ts:1289](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/apps/agent-runner/src/app.ts:1289)、[store.ts:44202](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/store/src/mysql/store.ts:44202)、[0053_persisted_provider_failure_capture.sql:286](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/store/migrations/0053_persisted_provider_failure_capture.sql:286)。因此可以把“当前公开写入只追加原话”作为受版本约束的 Adapter 输入前提，但不能把数据库能力说成强制 append-only。后续支持消息编辑时必须新增修订协议。

## 3. 哪些正文可用

**用户原话是主要来源。** `UserMessageItem.content` 保存原始输入，`effectiveContent` 是服务端中间件处理后的另一个字段；skillContexts 是已解析的运行技能，不是用户事实。证据：[item.ts:83](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/protocol/src/item.ts:83)。新 turn 将 completed userMessage、turn/started、item/completed 与幂等收据一起持久化，用户消息先提交而 turn 仍可能后续失败；不能只在 completed turn 中寻找用户原话。证据：[host.ts:2644](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/core/src/session/host.ts:2644)、[host.ts:2733](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/core/src/session/host.ts:2733)。

进行中的 steer 也生成独立 completed userMessage，并与 turn/steered 一起提交；只扫每 turn 第一条用户消息会漏掉补充、更正或撤回。证据：[host.ts:3826](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/core/src/session/host.ts:3826)。

`agentMessage`、reasoning、toolCall.args、contextCompaction.summary、systemNotice、注入的 memory/skill 不能重新升级为用户事实。工具结果只有经过注册工具合同、调用和成功回执校验后，才可作为已提交外部记录的证据；“助手说保存成功”并不能证明产品记录成功。类型证据：[item.ts:92](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/protocol/src/item.ts:92)。

图像在用户消息内保存 opaque blobId；这不等于已经存在 OCR 文字。离线补采不能把模型历史描述当原始图像识别结果；多模态解析仍由上游产生有来源、版本和确认状态的文本/结构化输出，再进入记忆提取。

一个 owner 的会话也可能同时描述本人、两个宝宝或其他人。tenant/user 只确定授权空间，不能据此把所有消息的 about_entity 强制设为本人；混合主体应保留原来源、逐证据片段确定主体，无法确定时不自动发布实体事实。

## 4. 压缩和重建投影不能替代聊天归档

Host 常规推理读取 `projectFromSeq(session)` 后、最多 5000 个最新 items，再做摘要/工具结果裁剪，属于模型上下文投影。证据：[host.ts:2583](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/core/src/session/host.ts:2583)、[host.ts:4628](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/core/src/session/host.ts:4628)。离线历史扫描不能复用这个窗口作为全历史来源。

压缩操作追加 `contextCompaction` item、item/completed、session/compacted，并原子更新 lastCompactionSeq；该路径不删除旧用户 items。证据：[host.ts:4078](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/core/src/session/host.ts:4078)。因此可以在授权允许且原 items 尚保留时重新取原文，不必依赖失真的摘要。摘要可以作为“需回查哪一段”的线索，但不能无原文证据形成新的 authoritative fact。

## 5. 授权、归档与删除

- 普通 `getSession` 必须有端用户身份，tenant 匹配后还核对 userId；跨 owner 与不存在统一 404。[host.ts:1279](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/core/src/session/host.ts:1279)
- HTTP items 和 events 在读取前都经过上述 owner 检查。[app.ts:1894](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/apps/agent-runner/src/app.ts:1894)
- store 的普通 getSession/listItems 还过滤 deleted session、非 active tenant/user 和 erasure evidence。[store.ts:38417](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/store/src/mysql/store.ts:38417)、[store.ts:46976](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/store/src/mysql/store.ts:46976)
- `readEvents` 刻意是 raw 内部读，以便已建立的 SSE 流读到 terminal session/deleted；它没有独立 owner grant。[store.ts:46883](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/store/src/mysql/store.ts:46883)。不能将此内部方法或只读数据库凭据直接发给通用 MemoryService。
- archive 可逆、默认会话列表隐藏，但仍可读；是不是允许归档聊天参与记忆应由明确的导入策略决定，不能把 archive 当 erase。[04-data-lifecycle.md:38](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/docs/design/04-data-lifecycle.md:38)
- ordinary DELETE 在 session tombstone、terminal event、deletion generation 和 outbox 间原子提交；普通用户不可恢复。宽限期不是继续使用内容的授权，物理内容保留也不是可补采许可。[host.ts:1843](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/core/src/session/host.ts:1843)、[04-data-lifecycle.md:44](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/docs/design/04-data-lifecycle.md:44)

上游会话隐藏或删除后，离线任务必须处理与该来源有关的记忆失效/删除；不能仅在下一次提取时跳过新写。扫描开始时有权读取，也不代表任务晚些发布时仍有权使用。源删除、memory-only erase、grant 收缩都须在结果发布前再次核对；历史原文仍在 MySQL 中不授予自动重新导入权。

## 6. 已有可复用入口及缺口

| 入口 | 已有能力 | 不能推导出的保证 |
|---|---|---|
| `GET /v1/sessions/:id/items` | owner scoped、可按 turnId/afterSeq 有界读；原 items 可越过 compaction 水位读取 | 不是全局变化流；没有通用 item revision，也没有当前公开的 `(seq,itemId)` 完整分页游标。内部模型里的 newestFirst/5000 也不是离线完整性合同 |
| `GET /v1/sessions/:id/events` | 已授权会话按 seq 重放 durable milestone，连接存续期间可观察 deletion 并关闭 | 不是跨 owner/session 的 durable consumer；删除后不能新建普通订阅，所以只靠随时重连 SSE 不足以保证所有离线删除必达 |
| lifecycle outbox | 仅 `session.tombstoned` 可被普通 dispatcher claim；核验 terminal event 后发到 bus、再 ACK，支持重复投递 | 当前目的为 terminal event bus 重发；不是新的记忆 subscriber，原 dispatcher 已 ACK 的行不能当专属 MemoryService 消费进度 |
| tenant webhook | preToolUse/postToolUse，可选择当前 turn 原始用户文本、args、result，带持久 invocation/intent | 无工具的 turn 不会因此有全量历史推送；不是用户消息/更正/删除的完整 change feed |
| user data export | owner 白名单的 RR snapshot，按 session/turn/item/event 等生成 NDJSON；有 manifest、part hash、下载 lease 和 TTL | 需要 admin + user、能力开关和受限导出路径；它是数据导出功能，并非后台任意扫库授权或持续 CDC；导出后源权限变化仍需再次检查 |

依据：[types.ts:592](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/store/src/types.ts:592)、[outbox-dispatcher.ts:108](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/core/src/lifecycle/outbox-dispatcher.ts:108)、[lifecycle-outbox.ts:11](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/store/src/lifecycle-outbox.ts:11)、[tenant-webhooks.ts:11](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/store/src/tenant-webhooks.ts:11)、[app.ts:1548](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/apps/agent-runner/src/app.ts:1548)、[data-export.ts:12](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/store/src/data-export.ts:12)。

## 7. 建议的最小适配合同

这是需要新增的接入设计，并非宣称该 Agent 已实现。具体字段以 V1 规格新增章节为准。

1. **源系统身份和授权**：注册 Chat History Adapter，明确 tenant/owner 映射、源系统/部署身份、允许会话范围、保留窗口、归档策略、读取/推理目的以及变更和删除控制；MemoryService 不接管业务数据库连接或原会话写权限。
2. **稳定来源与去重**：同一用户消息无论在线、离线补采、失败重跑或重新提取，都映射同一 source identity；保留 sessionId/turnId/itemId 和内容片段位置。事件 seq 是源修订顺序证据，来源内容 digest 可辅助相同内容核对，不能以 digest 替代 owner 和稳定身份。
3. **增量和回查**：每会话以 durable event seq 为增量，先封存上游 `through_seq`，只推进连续已处理前缀；当前 item/body 回查须限定在所选快照或绑定 revision，不能把旧 event cursor 与不受界的新 body 混合。若 Adapter 无法提供这种快照，采取有界重新快照和去重，不伪称严格单次快照。
4. **初次历史补采**：明确 snapshot 上界和页 manifest；分页不能因相同 item seq 被截断，不能使用模型 `lastCompactionSeq`、最新 5000 条或默认隐藏 archive 的列表来宣称完整历史。新会话发现需要产品侧会话登记或周期完整核对；当前 session ID cursor 不具备变更发现语义。
5. **变更和删除通道**：删除/撤权至少一次可重试到 MemoryService 独立 ACK；每个消费者有自己的 checkpoint，不复用 Agent 既有 outbox dispatcher 的完成状态。旧历史重新扫描仍要经过 MemoryService 的 suppression/tombstone/control ledger，不能换新 source ID 复活。
6. **提取与修正边界**：只提取已接受的原始用户披露和注册的可信外部记录。指代、更正和时间不明时可保留 unresolved，不自动写正式产品记录。更换提取器只生成带同一来源版本的新派生结果，不能自动修改原聊天、覆盖新显式偏好或凭模型摘要授予 authority。
7. **运行约束**：补偿/回填是有界后台任务，按 owner 隔离、限速/预算、可暂停、可观察、可幂等恢复；读不到已删除/过期来源时报告 unavailable/gap，不无限重试，也不从备份、日志或模型摘要绕开删除。

最低可行接入可先由产品侧 Adapter 提供授权的有界快照，加逐源幂等写入和可靠删除回执。持续增量完善后再增加自动调度；不必先建设通用跨数据库 CDC 平台。若暂时没有独立删除补偿通道，不应把周期扫聊天任务开启为无人值守生产功能。

### 7.1 面向当前 MySQL Agent 的首个最小适配版本

无需等完整 CDC 建设完成，可以先使用上游已认证 API/受控数据访问层进行如下有界扫描：

1. 由产品侧登记有权限且启用历史汲取的 session；初次历史导入固定会话范围与上界。会话列表与 turn 列表均按 ID 分页，API 没有提供“最近变更”的完整游标；扫描预算耗尽必须记录未扫范围并续跑，不能标记历史已覆盖。
2. 扫描终态 turn 的 items，只摄取 `type=userMessage`、`status=completed` 的 `content`。当前真实终态为 `completed`、`interrupted`、`failed`，没有 `cancelled`；failed/interrupted turn 中用户已提交的原话同样可用。证据：[session.ts:53](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/packages/protocol/src/session.ts:53)、[app.ts:1462](/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service/apps/agent-runner/src/app.ts:1462)。等待 turn 终态是这个最小适配器的扫描简化，不改变在线已提交用户输入的事实身份或有效性。
3. 对发现的 inProgress turn 单独持久保留待核对集合，后续即使不在最近 N 条列表内仍继续只读核对其状态；固定窗口滚动和“已见最大 turnId”不能证明旧长跑 turn 已处理。终态 turn 需有界重扫/核对，不能无限重取全库。
4. 保存稳定 `session/item` 身份及原始 content fingerprint；在线和离线映射同一来源，重复扫描不重复提取。已见同 ID 正文突然变化时，首版拒绝自动覆盖、标记 `SOURCE_MUTATION_UNSUPPORTED` 并停止该来源的当前发布；不能把任意新哈希当作单调 external_version。支持合法更正需上游新的显式消息修订合同。
5. 每次扫描和发布前重新核上游 session/subject 的生命周期与 MemoryService 的 suppression/erase policy。当前删除控制单位是 session，其 terminal `session/deleted + deletionGeneration` 可定位此会话关联来源；没有普通逐 item tombstone 事件。上游新增单条删除后必须扩展适配协议。不能等待未启用的物理 session purge 才撤回记忆。
6. 删除、撤权和当前来源已被改写但无法解释时，停止该来源当前检索/派生发布；首版须有可靠的独立删除回执或保守的当前源可用性核验。只返回普通 GET 404 不足以区分删除、越权和暂时不可用，可将其视为“当前不可使用”而不伪造具体物理删除结论。

这个版本的保证是明确授权范围内的补采、幂等去重、检测不支持的原文变化和保守停止使用；**不是实时完整 CDC、全库一次性快照、原 MySQL 的物理删除或任意消息编辑支持**。所有自动调度、模型预算、源读取延迟和历史覆盖范围应在 job 回执中显式显示。
