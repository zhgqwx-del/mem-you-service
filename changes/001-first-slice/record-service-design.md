# DIANDI-001 AC08 产品侧 RecordService 设计

用户已确认方案及实施范围。当前入口使用本地签名发行器验证实际产品授权。 [范围及基线](change.md#ac08-产品侧入口方案) · [实施方案](tasks.md#ac08-实施方案) · [验收计划](test-plan.md#ac08-产品侧验收与-ci)

## 服务职责

在本仓的 `apps/record-service` 建独立产品 API 和 Outbox 投递入口，采用 Node.js 24、TypeScript、PostgreSQL 17。独立进程配置、迁移和启动命令。隔离环境可共用 PostgreSQL 实例，RecordService 与 MemoryService 各用独立逻辑数据库、迁移和运行角色。角色仅访问自己职责所需的数据库对象，验收进程另有隔离环境的只读审计身份。

RecordService 对本人饮水的待补操作、正式条目、保存回执和 Outbox 负责。Mono 已通过的假服务保存语义是兼容基线。当前切片提供原文待补和已确认饮水提交两种入口行为。补量后转换、记录更正或删除、代理记录、共享权限和历史接入在相应切片处理。

## 可信身份与账号映射

1. 产品 HTTP 请求通过 Bearer 访问令牌认证。首段拟使用固定配置的发行方、RecordService 专用 audience 和允许的 RS256 验签公钥集合。仅按受信配置中的 `kid` 选择公钥，校验算法、签名、完整匹配的 `iss`、目标 `aud`、非空 `sub`、必填 `exp` 及存在时的 `nbf`。令牌内的密钥或密钥地址不参与信任选择。部署由服务配置受信发行方和公钥，验收由本地发行器生成当次密钥和两名测试账号的签名令牌，各走同一验证入口。
2. 用已验证的 `(issuer, subject)` 查产品账号映射。本切片每个身份只有一个有效映射，服务端从映射取得 `tenant_id`、`owner_id`、`self_subject_id` 和启用状态。令牌内的 tenant/owner 附加字段、客户端 headers、正文和模型参数均不用于派生业务身份。映射由受信配置或账号数据管理，HTTP 记录入口不接受自助映射变更。每次请求重新检查映射，写请求在业务事务内核对当前账号状态。
3. 产品用户令牌用于 RecordService。产品后端为工具代发时，从已验证的用户上下文取得身份，工具参数只带业务字段。Memory importer 和 evidence reader 使用部署侧配置的独立受限凭证。产品用户令牌不获得 Memory grant，工具和客户端得不到服务凭证。

## 业务授权和 HTTP 边界

首段为本人 `hydration`。创建待补、提交已确认饮水、查 operation 和查条目都按有效映射授予。所有持久查询、幂等比较和写入同时限制 tenant、owner、本人主体及适用领域，先限范围再读对象。查询与幂等重放同样执行当前授权。记录、回执和事件的 owner/主体来自服务端映射，外部请求不能设置 owner、tenant、目标对象 ID、授权或来源权威字段。

| 最小 HTTP 入口 | 允许的输入和结果 |
| --- | --- |
| `POST /v1/record-operations` | 声明 `pending_input` 或 `confirmed_drink`，使用 `Idempotency-Key` 作为客户端操作键。待补请求提供原文，正式请求提供已确认的饮水量、单位、发生时间及时区。新操作返回 201，同键同负载返回同一结果，异负载返回 409。 |
| `GET /v1/record-operations/{operation_id}` | 在当前授权范围按服务端操作 ID 查已提交回执或待补操作。 |
| `GET /v1/record-operations?client_operation_id=…` | 在当前授权范围按原客户端键查回操作，支持首次响应丢失后的只读恢复。 |
| `GET /v1/records/{record_id}` | 查询当前用户有权访问的正式饮水条目。 |

缺失或无效令牌返回 401。有效身份缺少启用映射或请求的动作不在授权内返回 403。已认证请求携带保留身份、目标条目或权威字段返回 400。外部请求的保留字段包括 `owner_id`、`tenant_id`、`about_entity_id`、`record_id`、`grant_id`、`authority_kind` 和身份覆盖 header。对象存在于他人范围与对象不存在使用相同的 404 错误码和公开正文，响应不披露 ID、版本、原文、计数或业务引用。审计只记安全事件码和请求标识。

幂等键隔离在 `(tenant, owner, client_operation_id)` 内。不同账号使用同一个客户端键只会产生各自的操作。保存正式条目、回执和有序 Outbox 在同一事务内完成。待补状态只保留原文与缺项，没有正式条目、成功回执或 Outbox。授权拒绝不能消耗正式事件序号。

## 与 Memory 的授权及数据边界

- RecordService 提交正式数据后由可信投递进程读取 Outbox，以受限 `trusted_importer` 身份调用 `POST /v1/sources:upsert`。投递进程根据已提交的记录构造 `ordered_import`、`external_record` 和 `external_committed`，复用 `stream_id`、序号、事件 ID、摘要及外部条目版本。流按所属 tenant/owner、产品 `system_id`、本人主体和 `hydration` 登记。隔离验收由受信测试装配登记现有 Memory grant 和流。
- Memory 独立根据凭证核对 owner、grant、主体、领域和注册流，持久接收与应用继续用 `accepted` 与 `applied` 区分。尚未应用或 Memory 离线均保留产品回执，按原事件重投。Memory 只持有它获准接收的来源镜像，例行产品查询从 RecordService 取得。
- AC08 的 evidence 读取用各自受限的服务端 reader grant，核对 A 可见 A 的来源，B 对 A 的来源及操作不可见。验收走实际 Memory HTTP 接口，产品凭证尝试直连、模型工具身份提升以及跨流 importer 请求均需要独立拒绝证据。 [职责合同](../../docs/spec-v1/00-boundaries-and-invariants.md#2-系统职责) · [Memory API 授权和来源写入合同](../../docs/spec-v1/02-api-contract.md)

## 启动和运行身份

从仓根安装锁文件依赖。先用 RecordService 数据库的迁移角色设置 `RECORD_DATABASE_URL`，执行 `pnpm run record:db:migrate`。它创建 `record_data` 及版本标记。由受信数据库操作员登记启用账号及其产品流，并在独立 Memory 库登记对应的授权和流。产品 `record_streams.last_sequence` 与 Memory 注册流的初始应用水位对齐。

| 入口 | 配置和数据库权限 |
| --- | --- |
| `pnpm run record:start` | `RECORD_DATABASE_URL` 用产品 API 角色。该角色读取账号、流、操作、条目、回执与迁移标记，写入操作、条目、回执和 Outbox，仅更新流序号。`RECORD_AUTH_CONFIG` 为含 `issuer`、`audience` 和 `keys` 的 JSON，`keys` 持有带 `kid` 的受信 RSA 公钥。默认监听 `127.0.0.1:8084`，可用 `RECORD_PORT` 覆盖。 |
| `pnpm run record:outbox` | `RECORD_DATABASE_URL` 用独立投递角色，仅可读 Outbox 和迁移标记，并更新 Outbox 的 `memory_operation_id`、`applied_at`。`RECORD_MEMORY_URL` 为 Memory 的 HTTPS origin 或验收用的回环 HTTP origin。`RECORD_IMPORTERS` 为含 `tenant_id`、`owner_id`、`stream_id`、`token` 的配置数组，由受保护的环境注入。 |

所有运行角色只连接各自数据库，并获得对应 schema 的 USAGE。账号、流登记和凭证置备使用受信操作员。两个启动入口均核对 PostgreSQL 17 和迁移摘要。 [独占环境和复跑入口](test-plan.md#ac08-产品侧验收与-ci)
