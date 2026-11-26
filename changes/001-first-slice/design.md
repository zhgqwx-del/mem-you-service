# Memory D1 首个来源写入与恢复切片设计

首段实施已验证。关联 [REQ-MEM-001 至 REQ-MEM-005](spec.md#需求)。现行 V1.2 修订 2 定义 HTTP 请求、回执、错误和生命周期。以下方案选定实现顺序、事务边界和验证范围。

## 运行栈与入口

使用 Node.js 24.21.0、pnpm 12.5.1、TypeScript 5.9.3、PostgreSQL 17.12、`pg` 8.22.0 和 Zod 3.25.76。依赖版本固定在锁文件，PostgreSQL 测试产物来源见[验收记录](verification.md)。PostgreSQL 作为 Memory 的持久化和验收数据库，事务、行锁和唯一约束直接用于跨进程重试。沿用 Node 工具链便于与现有假 RecordService 共用验收夹具。本地 HTTP 测试使用 Node 自带请求能力和已隔离的 PostgreSQL。 [仓库工程约定](../../docs/engineering.md) · [04 数据规模和环境](../../docs/spec-v1/04-evaluation-and-acceptance.md#7-性能-容量与费用验收)

| 落点 | 拟负责内容 |
| --- | --- |
| `src/main.ts`、`src/http.ts`、`src/protocol.ts` | 本地服务入口。HTTP 请求校验、按 UTF-8 限制请求体、统一响应信封、能力声明 |
| `src/auth.ts`、`src/db.ts` | 可信连接授权、策略代际、数据库事务、显式迁移命令 |
| `src/sources.ts`、`src/import.ts` | sync 的统一写入路径、操作回执、可靠 inbox、按连续序号应用 |
| `src/evidence.ts` | 同一授权快照下检查读屏障、当前版本、结构化字段投影 |
| `db/migrations/`、`test/contract/` | 初始表及约束、独立 schema、合成 grant/来源/Outbox 事件、通过公共 HTTP 的契约验收 |

## 公开入口与调用链

| HTTP 入口 | 首段行为 |
| --- | --- |
| `POST /v1/sources:upsert` | 合成非聊天用户输入使用 `user_input + sync`。假 RecordService 已提交的饮水快照使用 `external_record + ordered_import`。授权、幂等、稳定来源与内外版本按合同校验。 |
| `GET /v1/operations/{operation_id}` | 查同一已授权操作的最新可见 revision、状态和回执。按合同限制 `wait_ms` 和 `after_revision`，等待期间释放事务，返回前重核授权。 |
| `POST /v1/evidence:batchGet` | 按 source/version 精确查当前可见的饮水结构化字段。检查所有 `read_after` 条件并采用有界 deadline。隔离测试的可信取证响应按 02 声明其追踪状态。 |
| `GET /v1/capabilities` | 仅公示符合实际实现和已验证范围的能力及限额。原生聊天完整能力、full lifecycle、历史扫描、召回和消费者清理随各阶段启用。已定义但未启用的端点按合同返回 `422 UNSUPPORTED_CAPABILITY`。 |

调用链为假 RecordService 提交并查回产品回执 → 可信导入夹具读取同一 Outbox → Memory 验证并持久接收 → 执行器按原流应用 → 以原 operation 回读并做受限取证。业务提交可以离线完成。驱动 Memory 的进程停机期间，投递端保留原事件。

[HTTP 合同](../../docs/spec-v1/02-api-contract.md) · [产品提交与记忆回执](../../docs/spec-v1/00-boundaries-and-invariants.md#22-recordservice的outbox与完成阶段)

## 身份、投递和数据对应

- 在隔离 PostgreSQL 显式登记合成 tenant、owner、本人主体、领域 `hydration`、独立 adapter/importer 和只读验证者。授权来自服务认证和当前 grant。每个来源写入在事务中再次核对授权和策略代际，等待取证结束前重核。调用方 JSON 不可指定 tenant/owner/caller。原文或混合字段仅在完整标签与投影条件满足时才可披露，首段验收采用已确认饮水字段的结构化投影。
- importer 凭证绑定已注册的 system、owner 和 stream，仅接收权威方提交的事件。同步 adapter 通过合成可信来源证明声明 `user_reported`。正式镜像的 `external_committed` 由受信连接与已提交事件共同证明。测试凭证只在隔离环境注入，回执和验收日志记录摘要与身份引用。
- 桥接读取 [假 RecordService 的 Outbox 结构](../../../agent-service/examples/record-assistant/fixtures/record-fixtures.ts)。先以原 `payloadHash` 核对 Outbox 载荷，再按 02 转换成稳定 HTTP 请求。保留 product 的 `streamId/sequence/eventId`、`sourceId/sourceGroupId`、`externalRecordRef` 及已确认发生时间。饮水内容映射到既有 `hydration.beverage`，用十进制字符串、`ml` 和已确认白水，维持原时区。桥接冻结首次转换后的请求及幂等键，后续重用。Memory 对规范化后的 HTTP 载荷生成自己的冲突校验摘要，产品端仍以原摘要核对 Outbox。
- 原始输入与正式来源使用不同 `source_id`、共同 `source_group_id`。用 `input_evidence_refs` 表达可证明的关联，目标晚到时先写待验证关联，来源到达后按 owner/group、版本和字段范围确认。真实聊天输入仍遵循 06 的注册 origin、会话/原生 item、source 计划和来源门禁。首段的非聊天合成输入只验证基础来源协议，真实聊天 origin 接入另行验收。 [来源与外部条目绑定](../../docs/spec-v1/01-data-model.md#44-external_binding-与原输入证据关联只保留纠正所需映射) · [原生来源](../../docs/spec-v1/06-history-ingestion-and-repair.md#3-来源身份与实时去重)

## 持久化与事务

| 数据 | 键和原子边界 |
| --- | --- |
| grant 与来源注册 | 按 tenant/owner 与 grant 定位当前策略代际、允许的来源、流和投影。测试使用显式初始化的注册配置。 |
| source 当前头和修订 | 稳定 source 身份按授权空间唯一。每个 sync 的 caller revision 标识在该来源内唯一。首次创建、当前版本 CAS、不可变修订、授权依据、generation 与成功操作回执同事务提交。 |
| operation 与幂等记录 | key 唯一范围采用 HTTP 合同的 tenant/owner/grant/方法/规范路径。请求 hash、操作 ID 和原结果引用持久化，至少保留合同规定窗口。重送时重核当前 grant，复用原操作身份。写入令牌不透明、绑定当前授权投影和生效位置。 |
| external stream 与一个 inbox | 流、序号及事件 ID 保持唯一映射。接收事务提交 inbox 和 accepted 操作后才回执。apply 事务锁该流，只取 `applied_through_seq+1`，在同一事务内完成来源修订、外部稳定绑定、原输入关联、applied 操作和连续水位。 |
| 外部版本与取证关联 | 同一条目以授权空间、`system_id`、`record_id` 识别，绑定注册流。外部版本不透明，新顺序只取流序号。相同外部版本与等价来源快照的再次应用复用 source revision。冲突流持久隔离并保留最后连续水位。 |

取证用同一数据库快照核对当前投影、所有请求屏障和来源版本。缺 11 先到 12 时，已接收事件不能读成新版本。必需条件超时或不可达以协议错误终止。原操作保持可追踪，显示的是原写入证明及当前授权可见投影。

## 迁移、故障恢复与后续控制

- 初始 schema 显式迁移后由服务检查版本，导入执行器复用同一套事务。测试可在同一服务进程内调度执行器，由 PostgreSQL 保持可恢复的 inbox。重启后根据已注册水位继续处理，不依据内存队列或最高已见序号修复。
- 进程在事务前退出时重投同请求。已接收未应答时调用方同键重投或按原 operation 核对。应用应答丢失时仅恢复原结果。冲突保留原始证据并停止对应流，已提交来源与回执留在原库。
- 首段只验证 active 的合成条目、相同来源的重投、授权的 sync CAS 和受限取证。正式条目的更正、撤回、擦除和原生会话控制按现行合同分段交付。发现已知端点的未启用能力时返回合同错误。对已进入 inbox 的无可安全应用事件，保留状态供核对，连续水位不得跨过。
- D3 的控制账本按合同独立于来源库的恢复故障域。涉及受控消费者的正文读在控制水位或核验依据缺失时应阻断。首段隔离部署只声明其已实现、已验收的能力。 [恢复与隔离](../../docs/spec-v1/04-evaluation-and-acceptance.md#8-运维-保留期与恢复验收) · [D1–D4 出口](../../docs/spec-v1/04-evaluation-and-acceptance.md#9-交付顺序与责任)
