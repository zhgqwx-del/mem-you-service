# 独立记忆服务 V1：API 与 Agent 接入合同

版本：设计 V1.2 修订2，2026年10月28日整体审查修订。

状态：开发与验收基线设计，尚未实现。日期：2026-10-28（America/Los_Angeles）。本文中的“必须”是拟实现合同；JSON 是协议样例，不代表当前已有接口。边界见 [00](00-boundaries-and-invariants.md)，对象定义见 [01](01-data-model.md)，运行时与恢复见 [03](03-agent-sequences-and-recovery.md)，验收见 [04](04-evaluation-and-acceptance.md)。

## 1 服务边界与接入原则

MemoryService 接收有版本的来源镜像，管理记忆及其证据、纠正、删除与个性化使用策略，向 Agent 返回可验证的上下文和结构化事实投影。它不执行正式生活记录的提交，不提供产品账本、图表总量、时间线、日历或共享页面。`records.*` 成功回执才证明业务条目已保存；`memory.remember` 成功只证明本服务记忆写入。两者不能共享“已保存”的模糊文案。

HTTP 是唯一语义基准，MCP、Hook、SDK 和插件必须复用它的授权、幂等、版本和失效语义，不能各自实现一套更宽松的存储规则。每个 Agent 可接入不同能力等级，不能因“装有 MCP”就宣称它支持强制预取、撤回上下文或可靠的后台摄取。

持久聊天的按需补采/回填/修复/重抽合同见[06](06-history-ingestion-and-repair.md)。它通过宿主侧注册History Adapter取证，复用本文source和派生规则；MemoryService不直接扫描产品MySQL。未启用时不承诺历史覆盖，聊天cursor不得冒充RecordService external_barrier。

首发切片固定如下，不要求同时交付完整目录所有能力：

| 切片 | 必需合同 |
|---|---|
| Memory核心 | sources:upsert、remember、revise、context:prepare、evidence:batchGet、forget、operations、bundles:validate、capabilities，以及受保护的access:apply控制入口 |
| 点滴完整适配 | 上述核心＋changes及consumer register/ack/heartbeat/reset；这些控制入口只面向可信运行时，不暴露给模型或前端 |
| 在线可靠摄取 | 可靠journal及接入后原消息origin/source plan、同身份重送、基础派生去重；不依赖history:run或MySQL扫描 |
| 扩展能力 | search、facts:query、MCP包装可分别后置。首发补查可先用prepare及精确evidence；启用search/facts时必须通过§2.6的相同追踪验收，不另造较弱通路 |

capabilities只列实际启用feature；未列能力视为false，调用已定义但未启用端点返回422 UNSUPPORTED_CAPABILITY。自动摘要、精细片段授权及在线双代迁移为可选实现，不能成为来源摄取、基础召回或删除恢复的前置条件。API章节是完整合同目录；发布清单选择其中闭合切片，而非任意省略其安全依赖。

### 1.1 可信身份与调用者

| 项目 | V1 合同 |
|---|---|
| 认证 | HTTPS/TLS；服务端受保护凭证或宿主代理注入的短期委托凭证。生产禁止把长期凭证放入浏览器、模型提示词或工具参数 |
| 授权上下文 | 认证得到 `tenant_id`、`owner_subject_id`、`agent_id`、`caller_type`、`grant_id`、`policy_epoch`；调用方不能用请求 JSON 覆盖这些值 |
| `grant_id` | 服务端授权记录 ID；绑定所有者、Agent、主体、领域、允许动作、原文/字段投影、有效时间和授权版本。即使请求带合法 ID 也须重新校验 |
| `policy_epoch` | 服务端当前授权代际；可信适配器可携带期望值，但不能降低它。旧代际请求返回 `409 POLICY_EPOCH_STALE`；grant 已撤销返回 `403 GRANT_REVOKED` |
| 调用者类型 | `trusted_adapter`：Agent 内可信宿主；`trusted_importer`：注册的来源流；`model_tool`：模型可调用的受限工具；`control_plane`：授权/连接管理方；`operator`：受限运维身份。服务端根据凭证确定，JSON 不可声明 |
| 主体限制 | `about_entity_id` 仅缩小 grant 已授权集合；不存在或不可访问对象统一返回 `404 NOT_FOUND_OR_NOT_VISIBLE`，不能选择另一个用户成为 owner |
| 权威性 | `external_committed` 只能来自经注册来源连接验证的提交证明；`user_reported` 需要可信原始用户输入证明；模型自主总结只能是 `agent_inferred`。`authority_kind` 不是让模型选择的升级开关 |
| 凭证隔离 | 模型工具不显示凭证、grant、namespace、tenant、owner、authority 参数；宿主代理注入授权上下文。服务不会根据文本“我是管理员”扩大权限 |
| 请求内容 | 历史来源、检索片段、模型写入内容均为不可信数据，不能获得系统指令权限 |

`external_record_ref` 是来源定位符，不是可任意请求的 URL，也不是提交证明。V1 不接受任意回调 URL、任意 SQL、任意远程媒体抓取地址或客户端自定义 namespace。

可信HTTP适配器可带 `X-Expected-Policy-Epoch`（非负safe integer的十进制header值）要求当前授权代际匹配；该header只做并发检查，不授予权限，模型不可控制。tenant/owner/grant从验证后的委托上下文取得。默认上游证明方案是注册受信身份与system/owner/stream绑定，在受保护通道上校验external ref、event_id/seq和完整payload hash；用户输入证明绑定真实消息身份、内容hash与接收者空间。自报source_attestation字符串不能通过验证，服务不追踪任意外部验证URL。接入其他产品时必须显式登记信任连接，不能只填写system_id便伪装已提交来源。

## 2 通用类型、限额与报文

### 2.1 字段约束

以下规则对所有端点生效；端点表中只写差异。未定义字段一律 `400 UNKNOWN_FIELD`，`null` 仅在明确允许时使用，空串不等于缺省。所有字符串按 UTF-8 计字节，所有数组拒绝重复标识。

| 类型/字段族 | 类型与约束 |
|---|---|
| `ID` | string，1–128 字节，`[A-Za-z0-9][A-Za-z0-9._:-]*`；大小写敏感，不包含个人可读敏感内容 |
| `Version` / `Seq` | JSON integer，1–9007199254740991；CAS 中 `0` 仅表示新建；不得用浮点或数字字符串 |
| 时间点 | RFC 3339 string，含偏移，毫秒精度最多3位；服务生成的server_time/created_at等系统时间输出UTC。来源occurred/recorded输入时间可保留原偏移，并另存IANA timezone（最大64字节），不据UTC格式丢掉来源时区 |
| `Occurred` | `{occurred_from?:timestamp或date,occurred_to?:timestamp或date,time_precision:enum,timezone:string,original_expression?:string,anchor_at?:timestamp,basis?:enum}`；precision=`unknown/day/minute/second/interval`。basis闭枚举=`user_explicit/client_selected/external_record/relative_resolved/inferred`，缺省inferred；服务仍校验source attestation，basis自报不能升级authority/confirmation或把推断变成已确认。day使用YYYY-MM-DD，不补00:00；unknown两个边界均空；interval半开且至少一侧已知；original_expression≤512字节；01给完整语义 |
| `TimeRange` | `{from,to}`，左右可省略但不能同时缺失；半开区间 `[from,to)`，两者都有时必须from<to。查询缺to取本次snapshot.server_time，缺from取to前366天，实际边界在响应coverage中回显；显式查询窗最大366天，超出须分窗。grant的valid_time_range是授权约束，开放边界不按查询默认值截短 |
| `Domain` | 注册schema的领域枚举，如health.weight、food、hydration、finance.expense、mood、personal.preference；显式查询筛选及单source/memory的domains最多8项，控制面grant可显式枚举1–32项。未知枚举422 SCHEMA_VALUE_INVALID；省略查询筛选不暗中截掉完整授权集 |
| `Decimal` | 十进制定点字符串，最长 32 字节，禁止 NaN/Infinity；数值范围与单位由对应领域 schema 限制，不允许二进制浮点金额 |
| 文本 | 单个 source 内容的 `text` 与结构化内容序列化合计最大 16 KiB；普通 query/cue 最大 4 KiB；reason 最大 512 字节；memory 文本最大 4 KiB |
| 批量 | 批量写入最多 32 项，整请求最大 256 KiB；V1 单项写 API 不自动接受数组。`evidence:batchGet` 最多 32 项；批量操作另有逐项限制 |
| HTTP request body | 单项端点最大64KiB；批量端点最大256KiB。超过返回`413 PAYLOAD_TOO_LARGE`，不部分接收 |
| HTTP response body | 最大256KiB；分页端点可在limit以内提前截页并给next_cursor，禁止截断一个JSON行或隐去未返回页。单段search snippet≤1024字节并标truncated；精确证据读取另见batchGet |
| 结构化对象 | 必须带服务注册的 `schema_id` 和 `schema_version`；`data` 只接收该 schema 定义字段；每对象最多 64 字段、嵌套最多 4 层。新增领域需版本化注册，不能写任意 JSON blob |
| cursor / token | 不透明 string，最长 2048 字节，禁止解析或拼接；绑定授权投影、过滤条件和过期时间；不可跨 grant 使用 |
| 页面 | `limit` 默认 20、1–100，端点另有更小上限；请求下一页必须保留全部过滤条件并带 cursor，否则 `400 CURSOR_QUERY_MISMATCH` |

所有成功响应必填 `api_version`（enum="v1"）、`request_id`（ID）、`server_time`（timestamp）；为简洁，部分后续示例省略这三项。各响应数组不超过对应请求的limit/批量上限；未知响应枚举不能被客户端当成功默认值。失败使用同一错误信封：

```json
{
  "api_version": "v1",
  "request_id": "req_001",
  "server_time": "2026-10-27T00:00:00.000Z",
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "目标版本已变化，请重新读取后决定。",
    "retryable": false,
    "details": {"current_version": 3},
    "operation_id": "mop_001"
  }
}
```

`details` 只含调用方已获授权的信息；无访问权时不返回 current_version、源路径、隐藏命中量。`retryable=true` 表示允许按恢复规则重试，不表示可以换幂等键重复写。429/503 可附 `Retry-After`；调用方必须加抖动和有界重试。

### 2.2 通用 HTTP 错误

| HTTP | domain code | 语义 |
|---|---|---|
| 400 | `INVALID_ARGUMENT`、`UNKNOWN_FIELD`、`CURSOR_QUERY_MISMATCH`、`IDEMPOTENCY_KEY_REQUIRED` | 形状、字段或协议参数错误 |
| 401 | `UNAUTHENTICATED` | 凭证缺失、失效或不能验证 |
| 403 | `GRANT_REVOKED`、`ACTION_NOT_ALLOWED`、`AUTHORITY_ESCALATION_DENIED` | grant 已撤销或动作/权威等级不允许 |
| 404 | `NOT_FOUND_OR_NOT_VISIBLE` | 对象不存在或未授权，不区分二者 |
| 409 | `VERSION_CONFLICT`、`IDEMPOTENCY_PAYLOAD_MISMATCH`、`SOURCE_REVISION_CONFLICT`、`POLICY_EPOCH_STALE`、`IMPORT_EVENT_CONFLICT`、`CURSOR_GAP`、`CONSUMER_CONTEXT_REQUIRED`、`CONSUMER_RESET_REQUIRED` | 并发、身份重用、授权代际、受控读取绑定或消费序列冲突 |
| 410 | `BUNDLE_EXPIRED`、`CURSOR_EXPIRED`、`SOURCE_TOMBSTONED`、`MEMORY_TOMBSTONED`、`IDEMPOTENCY_WINDOW_EXPIRED` | 已知对象或身份已结束生命周期，不允许自动新建复活 |
| 413 | `PAYLOAD_TOO_LARGE` | 字节或批量大小超过合同 |
| 422 | `SCHEMA_VALUE_INVALID`、`UNSUPPORTED_TIMEZONE`、`INVALID_EVIDENCE_RELATION`、`UNSUPPORTED_CAPABILITY` | 字段有合法形状但语义不合法 |
| 429 | `RATE_LIMITED`、`BUDGET_EXCEEDED` | 请求速率、并发或租户预算不足 |
| 503 | `SERVICE_UNAVAILABLE`、`FRESHNESS_UNAVAILABLE`、`IMPORT_STREAM_BLOCKED`、`PLANNED_CHANNEL_UNAVAILABLE` | 依赖/服务不可用，无法安全满足新鲜度，或严格通道策略不可满足 |
| 504 | `DEADLINE_EXCEEDED`、`FRESHNESS_TIMEOUT` | deadline 内未完成；不等于无历史或未保存 |

端点下列出专属错误；所有端点同时继承上表中的认证、授权、限额、未知字段和服务错误。

### 2.3 幂等与版本

所有业务mutation及消费者控制 `POST` 必须带 `Idempotency-Key` header：ID语法，最长128字节，在 `(tenant,owner,grant,HTTP method+canonical path,key)` 内唯一。`context:prepare` 也必须携带，以固定turn内的上下文包。检索 `search`、`facts:query`、`evidence:batchGet`、`bundles:validate` 不要求此header；其受控读取依赖登记不属于再次执行业务动作，网络重试可产生另一个受控结果句柄，两者都纳入清理。重复检索不保证同一快照。

幂等结果与请求规范化哈希保留至少 30 天。同 key 同 payload 返回同 operation 与结果；同 key 换输入返回 `409 IDEMPOTENCY_PAYLOAD_MISMATCH`。30 天后不保证原响应可重放，必须按稳定 source/memory ID 或 operation 核对；不得只换 key 盲写。source/memory tombstone 和调用者 revision 唯一性不因幂等缓存过期自动失效。

写成功的 canonical revision 由服务分配：首次版本 1，实际内容修订后 +1；无变化重放不加版本、不加 mutation。同步更新必须 `expected_source_version` / `expected_memory_version`；新建为 0。409 不能由 SDK 自动改用 latest 重试，须读当前对象并重新确认语义。更正与状态变化必须显式区分，不能一律覆盖历史。

`caller_revision_key` 只标识可信同步来源的一次稳定外部修订；ordered import 使用 `external_record_ref.external_version`，两者不同时传。相同 caller revision/external version 但内容不同返回冲突，不生成新来源。

### 2.4 写回执与新鲜度

已应用写回执结构：

```json
{
  "operation_id": "mop_017",
  "status": "applied",
  "source_id": "src_input_17",
  "source_version": 2,
  "memory_id": null,
  "memory_version": null,
  "write_token": "wt_opaque_17",
  "visibility_generation": 43,
  "derivation_status": "queued",
  "business_record_status": "not_asserted"
}
```

`write_token` 是本服务对已应用变更的读屏障，绑定owner和授权可见范围，TTL为30天；不是mutation_seq字符串，也不能替代产品Records的提交证明。过期返回 `410 WRITE_TOKEN_EXPIRED`，调用方按稳定实体和required_sources核对当前版本后取得新的读条件，不重新执行已applied写。内部序号不作为跨系统水位使用。accepted回执没有canonical version或write_token，不得显示为“记忆已可读”。

读取可带：

```json
{
  "read_after": {
    "write_token": "wt_opaque_17",
    "external_barriers": [{"stream_id": "records_user_stream", "through_seq": 105}],
    "required_sources": [{"source_id": "src_input_17", "source_version": 2}]
  }
}
```

三项均可省略；出现时全部必须满足。external barriers 最多 8 个、required sources 最多 32 个。它们只能引用 grant 已授权的注册流或来源。`required_sources` 表示“至少已知道该版本及后续失效”，不是要求返回被后续删除的旧版本。达到 barrier 后仍须使用当前有效版本，不能强行读取旧数据。

服务可用即时有效性覆盖满足原文/事实读取，不要求所有向量索引完成；必须明确某检索通道落后。纠正、删除和撤权必须先排除旧版本，再降级检索，禁止为满足 deadline 返回旧值。无法安全满足返回 `503 FRESHNESS_UNAVAILABLE` 或 `504 FRESHNESS_TIMEOUT`，不返回 `mode=empty`。

跨系统保证始于本服务收到并应用变更。产品已更正但 Outbox 尚未到达时，本服务不会凭空知道；full adapter 必须带外部 barrier，或因宿主 pending-mutation fence 暂停受影响历史。要求“所有 Agent 在产品删除后立即停止使用”的产品，必须实现同步失效/宿主 fence，再异步传播；仅依赖 Outbox 的接入只具有有界最终一致性。

### 2.5 时间筛选的回显与响应元数据

context/search/facts响应必填coverage.time_basis（occurred/recorded_at）、coverage.snapshot_at（timestamp）、coverage.resolved_time_range（请求未筛时间时null，否则完整from/to）。所有缺省时间边界按该snapshot_at一次解析，cursor后续页沿用，不能每页向前滚动。memory的recorded_at按01：取当前revision全部required来源的recorded_at最小值，无来源的agent_note取真实session lineage接收时刻；不是known_from或抽取/摘要生成时间。

这些字段回显的是检索窗口，不放宽grant：授权时间始终按事实发生/有效时间检查，不能通过time_basis=recorded_at读到授权窗外的旧事实。source/memory引用必须包含各自版本；原文仅在源和grant允许的投影中返回。响应的diagnostics不得夹带被过滤候选、隐藏原文或跨域计数。

### 2.6 所有记忆正文读取的用途与失效追踪

`context:prepare`、search、evidence和facts不能有一条绕过用途限制或消费者追踪的正文通路。search/evidence/facts共用下面请求字段；表中明确仅适用search/evidence的字段不得用于facts，后文端点表无需重复展开结构：

| 字段 | 类型 | 合同 |
|---|---|---|
| `purpose` | context同名闭枚举 | 默认respond_to_record；可信宿主从真实本轮意图确定。answer_history只用于用户明确历史查询，不因模型把该字段改成answer_history就允许绕过exclude_personalization或historical_only；MCP代理从宿主状态补齐 |
| `include_historical_assertions` | boolean | 默认false，仅search/evidence允许；true必须purpose=answer_history且可信宿主确认用户明确要看原话或更正/撤回历史。模型可见schema隐藏此字段，model_tool不能自行开启；普通“昨天实际喝多少”仍排除旧主张。facts/context禁止该字段 |
| `consumer_context` | `{consumer_id:ID,session_id:ID,turn_id:ID}` | full_lifecycle读取必填且与认证Agent、登记session绑定；由可信代理注入，模型不可选择。控制面将full接入凭证绑定为必须追踪，缺少时409 CONSUMER_CONTEXT_REQUIRED；不允许同一full宿主省略该字段后偷偷走tool-only通路 |

full模式的每个成功正文响应（包括每一页、逐项成功的batch）附`usage_bundle={bundle_id,bundle_hash,expires_at,bundle_kind:"read_result"}`。服务在发送正文前原子登记全部实际交付的来源/记忆精确版本、用途、consumer/session/turn及失效代际；登记失败就不返回正文。`bundle_id`及5分钟TTL、validate、changes、ack/reset、离线清理责任与context包使用同一机制，不再建设第二套状态机。

read_result的`bundle_hash`是服务对冻结结果快照的`sha256:`摘要，客户端作为不透明回执保存；它不等于context的canonical_injection字节校验，也不要求客户端重新序列化结果。context包仍按§6对确切字符串校验。宿主将实际使用的所有usage_bundle登记进工具历史/摘要/反馈依赖；新模型step、依赖历史的工具执行与交付前在线validate全部仍在上下文中的包。超过validate的32项上限时分批验证，全部通过后才可准入；任一失败均先清理，不能只验证最新一包。

tool_only_best_effort可不传consumer_context，此时响应不附usage_bundle并标`tracking_status="uncontrolled"`；不得拿它冒充full接入清理完成。full响应标`tracking_status="registered"`。分页后cursor即使仍有效，已下发页的包也受失效和清理规则约束。无正文的错误不登记新包。只返回ID也可能泄漏敏感信息，仍按同样授权规则处理。

与外部当前条目关联的原输入断言被更正/撤回后，其historical_only片段不参与当前context、facts或后台重新发布。只有用户明确要求查看原话或更正/撤回历史、可信宿主设置include_historical_assertions=true时，才可在现行权限与用途策略允许下经search/evidence读取仍保留的原文，必带assertion_status="historical_only"及当前替代引用/不可用标记。一般answer_history查询仍排除旧主张；这不是读取已擦除正文或过时source revision的例外，V1不增加任意时光回溯API。

## 3 来源镜像：`POST /v1/sources:upsert`

权限：`source.write`，仅 `trusted_adapter` / `trusted_importer`。模型工具无此动作。请求单个 source；需要批处理时上层逐项持久 operation，不把 V1 包装成隐式事务批量。

| 字段 | 类型 | 必填/默认/上限 |
|---|---|---|
| `source_id` | ID | 必填；调用方预先生成并永久复用；同一来源不因重试换 ID |
| `mode` | enum `sync` / `ordered_import` | 默认sync供user_input/agent_note；external_record必须显式ordered_import且走唯一注册条目流。V1禁止sync直接替换外部镜像头，避免直达新版本被积压旧事件回退 |
| `expected_source_version` | integer ≥0 | sync 必填；ordered_import 禁止传，由连续流应用器在数据库中执行版本比较 |
| `caller_revision_key` | ID | sync 必填；同 source 内唯一；ordered_import 禁止 |
| `origin_ref` | `{source_system_id:ID,conversation_id:ID,item_id:ID,origin_revision:Version}` | 仅注册聊天user_input＋sync可用；点滴A的接入后实时路径已必须提供，不能以history关闭豁免。其他非聊天来源可省略；启用补采后复用同一绑定或已核对别名。定义及身份/修订规则见06§3；模型不可传，assistant/compaction不得借此伪造用户出处 |
| `about_entity_id` | ID或null | 必填；null仅未知/混合主体，不等于本人或wildcard。未知主体原文默认仅owner宽授权可读；窄主体grant只能得到已安全拆分的字段投影 |
| `source_group_id` | ID | 必填；同一次用户输入及其多条业务映射使用共同 ID，不能用于跨来源事实去重 |
| `source_kind` | enum `user_input` / `external_record` / `agent_note` | 必填 |
| `lifecycle` | enum `active` / `retracted` | 默认active；deleted只能forget。retracted退出当前证据，不等于物理删除 |
| `revision_intent` | enum `replace` / `authoritative_reconcile` | 默认replace；仅可信权威连接可reconcile；已retracted改回active必须新权威出处版本和CAS/连续事件证明，旧重试不能重新激活 |
| `authority_kind` | enum `user_reported` / `external_committed` / `agent_inferred` | 必填；服务根据身份、来源注册和证明校验，非法升级拒绝 |
| `content.text` | string | active时与structured至少一项；与结构化内容合计≤16KiB；retracted可省略整个content且不回填旧正文 |
| `content.structured` | `{schema_id:ID,schema_version:Version,data:object}` | 可选；服务注册 schema；data 不允许未定义字段 |
| `source_metadata` | SchemaObject | 可选，仅允许source.input_metadata/version1，完整字段见01§6.2；与content.structured并列，可保留OCR/ASR/picker确认候选和授权媒体引用；最大8KiB，不能只传媒体触发识别，不进入memory/facts正文索引；confirmation自报不替代真实消息证明 |
| `domains` | Domain[] | 必填，1–8；请求标签不证明全源域/主体标注完整，也不得降低服务/可信上游标签。首次向窄域/窄主体读取者交付原文/片段前须核对绑定本来源版本的完整标注或同步策略证明；未知则按00§6.1拒返或仅向owner_space且全部当前注册域已授权者交付，不等异步抽取补标签后再追溯 |
| `recorded_at` / `timezone` | timestamp / IANA string | recorded_at可省略、默认服务接收时间并返回basis=service_received；timezone必填。提供上游recorded_at时未来/补记合法性由来源schema校验 |
| `occurred` | Occurred | 可选；外部正式条目镜像应忠实携带上游已确认发生时间；未知不拿recorded_at代替 |
| `external_record_ref` | `{system_id:ID,record_id:ID,external_version:string}` | source_kind 为 external_record 或 mode 为 ordered_import 时必填；external_version 1–128 字节、opaque |
| `input_evidence_refs` | `{source_id:ID,source_version:Version,span?:{start:integer,end:integer},field_paths?:string[]}[]` | 仅external_record的可信事件可选，最多8项；span与field_paths至多一种，均省略表示整源。span为Unicode code point半开范围、0≤start<end；field_paths最多16个已注册字段路径，各≤128字节。引用须同owner/group，并有动作权限。用于原断言与外部条目的证据关联，不传candidate状态；未带可靠精确关联时使用下述保守门禁 |
| `input_origin_binding` | `{origin_ref:OriginRef,source_id:ID}` | 仅可信external_record ordered_import可选；预约原输入的planned source，group取事件外层。用于live源未成功、正式回执先到时保留同origin→原group门禁，不生成用户事实；与已有计划冲突409 ORIGIN_BINDING_CONFLICT。不是本external_record的稳定身份 |
| `upstream_change` | `{stream_id:ID,stream_seq:Seq,event_id:ID}` | ordered_import 必填；sync 禁止。流身份必须匹配认证 importer |
| `source_attestation` | opaque string | user_reported/external_committed 必须由可信宿主提供或由认证连接隐式证明；最长 2048，模型不可生成/看见；不得进入检索文本 |

sync 原子完成来源 revision、有效性代际、最小事实覆盖/旧依赖失效与任务 Outbox，返回 `200 applied`。新建使用 source_version 1。后续派生失败不撤销已应用来源。ordered_import 先持久 inbox：未满足连续顺序返回 `202 accepted`、operation_id 与 `waiting_for_predecessor`；worker按连续流处理，source_applied实际新建/变更时分配版本，policy_suppressed无来源版本。重复 event_id 同 hash 回同 operation；同序号不同事件或内容返回冲突。不能取已见最大 seq 当连续水位。

外部commit/correction的快速通知只加速投递同一个Outbox事件（同stream/seq/event_id/payload），并可等待其连续应用；不能另发sync写头或跳过前序。external_version不透明、不按字符串排序。跨产品提交与本服务门禁仍是saga，不因走同步网络调用而成为一个事务。

ordered_import的applied回执及operation必填`import_outcome=source_applied|policy_suppressed`；accepted时省略。source_applied返回该事件实际应用或复用的source/version，是原操作回执，不保证当前仍可读；重放不得改用latest或返回失效正文，仍核当前授权。policy_suppressed仅适用于已验证事件命中可核对本地erase/owner历史抑制：同事务记录无正文消费与控制依据、推进连续水位，不生成source_version或派生，result_refs=[]，不返回旧正文。可返回write_token，但它仅证明事件按策略安全处理，不能据此取回被删来源。入站已知应抑制时不持久正文；缺序仍202等待，身份/同版本异hash/权限或控制证明异常仍拒绝或隔离，不能借抑制跳过。普通sync复活仍返回SOURCE_TOMBSTONED；合法有序事件不因此永久堵住无关后续事件。

policy_suppressed仍核最小外部版本/hash与受信关联，执行下段及01§4.4的累计原断言失效/blocked origin门禁；只擦除镜像、未擦除raw时，后来的更正仍限制旧raw主张为historical_only，不能因丢弃新正文而继续发布旧值。只持久最小控制关联，不解除erase或重建新镜像。

外部条目更正/撤回/删除应用时，同事务失效旧镜像及input_evidence_refs所指原断言，后者标historical_only而非改写原话。旧原输入worker即使晚完成也不得重新发布被替代主张。若无可靠片段映射，对同source_group、受影响主体/domain的原始断言保守限制当前使用并给gap，不能整组误删另一顿饭或另一宝宝。原输入尚未到达时先保存按稳定source/group定位的门禁，后到输入仍必须命中；不能因摄取先后顺序漏掉替代关系。完整规则见01。

聊天origin唯一键不含run/pipeline/revision。相同origin已绑定其他source/group时409 ORIGIN_ALREADY_BOUND；details只在当前权限允许时给canonical source_id/source_group_id/source_version/binding_state，预约未落源时source_version=null且binding_state=reserved。客户端复用该计划，不新建另一组。旧origin_revision返回409 STALE_ORIGIN_REVISION，同原修订异指纹409 ORIGIN_REVISION_CONFLICT；不可变适配器检测同ID原文改变409 SOURCE_MUTATION_UNSUPPORTED并阻断当前使用。服务核会话级origin_scope_gate，已删除会话的未知迟到item也拒收；ordinary sync不得解除此门禁。

补采连接的注册写入策略固定为`create_only_chat_ingest`，这是服务端连接权限，不是请求可写字段：只允许user_input＋sync、expected_source_version=0及已核对的接入后source plan。登记此策略的调用者请求替换现有source时返回403 SOURCE_WRITE_POLICY_DENIED。未绑定origin的首次创建、或reserved计划的首次物化，与来源首revision同事务完成；已有materialized来源只读核对原修订/指纹和当前门禁后复用，不更改正文、主体、确认状态或其他输入metadata。VERSION_CONFLICT/ORIGIN_ALREADY_BOUND后仅解析canonical身份并复用有权回执，不把latest source_version填入旧payload重试；已撤回/擦除/隔离不算可用already_present。普通用户更正与可信metadata修订使用独立授权及CAS。history worker的already_present是任务逐项结果，不新增一个绕过sources合同的公开upsert模式，详见06§3.1.1。

conversation门禁只约束原聊天user_input lineage及依赖。独立有效external_record晚到时仍正常应用其有序事件；若附带input_origin_binding已被聊天删除阻断，仅保存blocked关联及原断言门禁，不物化原话、不整组erase业务证据，也不因这一阻断毒化业务流。真正的身份计划冲突仍隔离对账，不借此静默改绑。

```json
{
  "source_id": "src_input_17",
  "mode": "sync",
  "expected_source_version": 0,
  "caller_revision_key": "turn_17_input_r1",
  "about_entity_id": "entity_self",
  "source_group_id": "input_group_17",
  "source_kind": "user_input",
  "authority_kind": "user_reported",
  "content": {"text": "午饭面条，喝了300ml水"},
  "domains": ["food", "hydration"],
  "recorded_at": "2026-10-26T12:10:00-04:00",
  "timezone": "America/New_York",
  "source_attestation": "sa_opaque_17"
}
```

```json
{
  "operation_id": "mop_017",
  "status": "applied",
  "source_id": "src_input_17",
  "source_version": 1,
  "write_token": "wt_opaque_17",
  "visibility_generation": 43,
  "derivation_status": "queued",
  "business_record_status": "not_asserted"
}
```

专属错误：`409 VERSION_CONFLICT / SOURCE_REVISION_CONFLICT / IMPORT_EVENT_CONFLICT / EXTERNAL_BINDING_CONFLICT`；`410 SOURCE_TOMBSTONED`；`422 INVALID_EVIDENCE_RELATION`；`403 AUTHORITY_ESCALATION_DENIED / SOURCE_WRITE_POLICY_DENIED`。同一外部稳定条目不能换source_id复制镜像。超时后按operation或稳定source ID核对，不能把未收回响应当未应用。删除来源不能用upsert复活，需另行明确重新记录并生成新来源身份。

### 3.1 原聊天生命周期控制：A/B共用

点滴A即须从宿主可靠journal/现有生命周期Outbox向Memory独立订阅传播已摄取及已计划conversation的删除/撤权；history能力关闭不关闭这条通路。可只实现06 Adapter的read_control/ack_control，不实现扫描方法或history API。控制面注册可信连接、owner映射及有界订阅范围，Memory按注册通道读取；不向模型开放控制消息或允许任意回调URL。

| 控制项 | 必须语义 |
|---|---|
| 事件 | control_event_id:ID、source_system_id:ID、conversation_id:ID、control_kind=deleted/access_revoked、control_generation:Version、opaque control_position及可信上游证明；owner从认证映射获取。generation按同conversation权威递增，ID/载荷稳定重放；不包含原聊天正文 |
| 交付 | 独立Memory checkpoint至少一次投递，不挪用产品另一个dispatcher的ACK。已计划但无source的会话也在订阅范围；门禁覆盖迟到未知item，不能只枚举当前source |
| 应用 | 两类均先持久独立control ledger，再提交本地gate及失效；deleted沿既有erase流水线清理原聊天lineage及required派生，access_revoked立即失效相关访问/派生并按授权保留策略清理，不冒充物理擦除。scope身份见01§4.5，业务镜像独立；无法完整列出受影响planned group时，沿§13既有full_revalidation_required/reset完成full消费者保守抑制和清理。即使尚无source/origin/group，仍在同一本地事务登记重叠scope的full清理责任并耐久发布full_revalidation_required及reset_required=true，不能因affected ID为空漏发事件 |
| 确认 | 返回/记录control_event_id、control_generation、operation_id及local_enforced。只有独立ledger与本地gate可核对applied后才ack_control推进；不是等物理清理/所有consumer完成才ACK。重复事件核对既有operation，不回退generation |
| 断档/恢复 | 控制流失联或当前位置不可核对则相关scope不可用于记忆读取/发布，先补控制再恢复。旧备份恢复先重放最新scope gate；普通live重送、history run及换connector不能解除删除/撤权。重新授权须独立受控核验，deleted终态不恢复原聊天身份 |

这条上游生命周期通路与Memory向Agent发changes的消费者清理是两个方向，分别持久checkpoint。B16的一致性保证起点仍是Memory控制applied或宿主已立fence，不宣称产品删除与Memory跨库原子完成。

## 4 追加记忆：`POST /v1/memories:remember`

权限：`memory.write`。可信 adapter 可提交有来源的记忆候选。`model_tool` 默认只能写agent_note出处下的 `derived_insight / unresolved_item`，authority为agent_inferred；如宿主给出本轮server-attested user source，允许写schema限定的 `fact_evidence / explicit_preference / explicit_constraint` 候选，但不能生成external_committed。观测/断言等细类由注册schema表达。记忆中的事件/观测是检索投影，不参与产品正式总量。

普通remember/revise由服务标write_policy=user_managed，显式修订同时保护原自动slot；仅内部受控派生可auto_managed。客户端无此可写字段，后台重抽不得覆盖人工头，但来源更正/erase/撤权仍优先使其失效（01/06）。

有source的显式写与自动派生共用01§7.3的coarse slot，纯文本schema_key为memory.statement；人工写还登记(source_lineage,kind,subject)的schema通配保护，防live纯文本与离线typed结果重复。创建/修订与全部支持槽保护同事务。任一受保护范围已有另一当前auto/manual头且非同一稳定身份重放时，remember返回409 MEMORY_SLOT_CONFLICT；有权details返回current_memory_refs（精确memory_id/version，最多8项，更多给conflicts_truncated=true），调用者复用或显式revise既有头，不能换ID规避。范围内存在不可披露冲突时统一404 NOT_FOUND_OR_NOT_VISIBLE。首次同源同类多事件保留一条忠实复合陈述或给gap，不用数组序号/文本相似度合并；独立业务事件仍由不同external_record source保留。不要求额外公开slot参数，也不承诺跨来源语义去重。

| 字段 | 类型 | 必填/默认/上限 |
|---|---|---|
| `memory_id` | ID | 必填，调用方稳定生成；存在时须同幂等身份，否则409 |
| `expected_memory_version` | integer | 必填且只能 0；更新使用 revise |
| `about_entity_id` | ID或null | 必填；fact_evidence必须非null；仅注册space_scope的偏好/约束等schema允许null。null不适用于未知主体生活事实 |
| `source_group_id` | ID | 必填；可信宿主分配，不能跨获授权主体拼接证据 |
| `memory_kind` | enum | `fact_evidence / explicit_preference / explicit_constraint / derived_insight / episode_summary / unresolved_item`；必填 |
| `authority_kind` | enum | 必填，服务校验；MCP 从可见 schema 隐藏此字段 |
| `content` | `{text?:string,structured?:SchemaObject}` | 至少一项；合计 ≤4 KiB，typed memory 必须 structured |
| `domains` | Domain[] | 必填，1–8；须被所有支持来源的可读投影允许 |
| `source_refs` | `{source_id:ID,source_version:Version,field_paths?:string[]}[]` | 必填，通常1–8；每个field_paths最多16条、路径≤128字节且在注册schema中；agent_inferred的derived_insight/unresolved_item可空但需宿主会话出处 |
| `session_ref` | `{session_id:ID,turn_id:ID}` | 允许无source_refs的推断/事项必填；服务登记agent_note出处，不能将会话内容伪装成用户陈述 |
| `occurred` | Occurred | 可选；发生时间，未知可空；不能把recorded_at当作occurred |
| `valid_from` / `valid_to` | timestamp或date | 可选；to排他。date仅在required来源闭包有唯一可靠已保存时区时接受，按本地日界归一并保存所用时区；无来源/未知/跨时区须传含偏移timestamp，歧义返回422 SCHEMA_VALUE_INVALID。详见01§2.3 |
| `expires_at` | timestamp | 可选；仅按schema允许的过期策略，不能默认将长期约束按相关性过期 |

服务校验来源有效性、版本和投影；稳定身份重放及受保护slot用于阻止同源重复发布，不将不同来源的两次相似饮水/喂奶事件合并。返回 `200 applied`，含 memory_version=1、write_token、支持来源与 `projection_status=provisional` 或 `supported`。来源替换后 memory 会失效或重建，不能永远引用旧 revision。

```json
{
  "memory_id": "mem_preference_3",
  "expected_memory_version": 0,
  "about_entity_id": "entity_self",
  "source_group_id": "input_group_3",
  "memory_kind": "explicit_preference",
  "authority_kind": "user_reported",
  "content": {
    "structured": {"schema_id": "personal.reply_preference", "schema_version": 1,
      "data": {"reply_length": "brief"}}
  },
  "domains": ["personal.preference"],
  "source_refs": [{"source_id": "src_preference_3", "source_version": 1}]
}
```

```json
{
  "operation_id": "mop_020",
  "status": "applied",
  "memory_id": "mem_preference_3",
  "memory_version": 1,
  "authority_kind": "user_reported",
  "projection_status": "supported",
  "write_token": "wt_opaque_20",
  "business_record_status": "not_asserted"
}
```

专属错误：`409 VERSION_CONFLICT`（ID已存在或来源不是当前有效版本）、`409 MEMORY_SLOT_CONFLICT`；`410 MEMORY_TOMBSTONED`；`422 INVALID_EVIDENCE_RELATION / SCHEMA_VALUE_INVALID`；`403 AUTHORITY_ESCALATION_DENIED`。在模型未确认真实用户原话时只可保存推断/事项笔记或不保存，不能通过工具默认值变成生活事实。

## 5 纠正记忆：`POST /v1/memories/{memory_id}:revise`

权限：`memory.revise`；同 remember 的 caller 限制。只更正本服务记忆，不修改正式业务记录。若真实产品条目有误，Agent 必须先调用产品更正工具并镜像该提交，再基于新来源修订派生记忆。

| 字段 | 类型 | 必填/默认/上限 |
|---|---|---|
| path `memory_id` | ID | 必填 |
| `expected_memory_version` | Version | 必填，CAS |
| `revision_kind` | enum `correction` / `state_change` / `retraction` | 必填；correction修正同一事实；state_change保留旧有效区间用于受控审计/来源解释，valid_at不回放被替代旧头；retraction退出当前使用但不同于隐私物理删除 |
| `replacement` | `{content,domains,source_refs,about_entity_id?,occurred?,valid_from?,valid_to?,expires_at?}` | correction/state_change必填；复用remember字段完整替换，不用任意JSON Patch；retraction禁止。memory_kind不能改变；about_entity_id省略=保持，显式改主体仅见下述受控纠正 |
| `supporting_source_refs` | SourceRef[] | 必填，1–8；证明本次修订依据，新值不能仅靠旧事实来源 |
| `reason_code` | enum `user_correction` / `source_revision` / `state_changed` / `unsupported_inference` | 必填；自由reason文本可选≤512字节 |

原子提交版本 +1、旧 revision退出当前有效视图、依赖失效和任务；返回 `200 applied`。不得先让旧值与新值同时可见，异步任务不能覆盖较新版本。state_change有效期相接或重叠冲突按schema处理，禁止服务猜测边界。

state_change不提供完整结构化历史状态视图：facts.valid_at只筛当前可用修订，先前真实状态可对仍有效且获授权的原来源取证；空投影不代表当时无偏好。replacement中的date有效期同§4及01§2.3，服务不从服务器时区猜生效点。

correction/state_change在同一事务核对旧、新全部支持slot及schema通配guard，保留旧槽保护。新范围已有另一memory的当前头时返回409 MEMORY_SLOT_CONFLICT，沿用§4的引用限额及不可见处理；不自动合并、抢占或把两个memory迁到同一槽。调用者须解析目标并明确复用/修订已有头。

主体纠正只允许trusted_adapter在revision_kind=correction时提交replacement.about_entity_id；新旧主体均须可读写、具有新可信更正来源、通过CAS，并在一个事务中失效旧/新主体视图与消费者依赖。fact_evidence新主体不得为null；模型默认工具schema不暴露此字段。若引用external_committed条目仍指向旧主体，必须先由records工具更正并镜像新出处，再纠正memory，不能仅改记忆掩盖产品中的错宝宝记录。

```json
{
  "expected_memory_version": 1,
  "revision_kind": "correction",
  "replacement": {
    "content": {"structured": {"schema_id": "health.weight", "schema_version": 1,
      "data": {"value": "72.4", "unit": "kg", "measurement_method": "user_reported"}}},
    "domains": ["health.weight"],
    "source_refs": [{"source_id": "src_correction_18", "source_version": 1}]
  },
  "supporting_source_refs": [{"source_id": "src_correction_18", "source_version": 1}],
  "reason_code": "user_correction"
}
```

```json
{
  "operation_id": "mop_021",
  "status": "applied",
  "memory_id": "mem_weight_17",
  "memory_version": 2,
  "lifecycle": "active",
  "write_token": "wt_opaque_21",
  "invalidated_memory_versions": [1],
  "business_record_status": "not_asserted"
}
```

专属错误：`409 VERSION_CONFLICT / MEMORY_SLOT_CONFLICT`；`404 NOT_FOUND_OR_NOT_VISIBLE`；`410 MEMORY_TOMBSTONED`；`422 INVALID_EVIDENCE_RELATION`。版本冲突响应只给获授权的当前版本，不自动合并数值。重放原revision幂等结果也须应用当前失效检查，不能由重放回执使旧记忆重新有效。

## 6 上下文准备：`POST /v1/context:prepare`

权限：`context.read`。full adapter在需要模型理解或历史的首个模型请求前确定性调用；已确认且不依赖历史的picker/纯产品指标路径可持久记录deterministic_no_history跳过检索（见03）。模型补查可以调用，但不因提供工具而保证首轮预取。此端点要求 `Idempotency-Key`。`current_input` 是线索，不自动成为存储来源，也不能作为证明自身的历史证据。prepare时登记consumer与bundle依赖；full宿主首次注入前还必须validate并原子确认绑定，防准备和注入之间已撤权。

| 字段 | 类型 | 必填/默认/上限 |
|---|---|---|
| `turn_ref` | `{session_id:ID,turn_id:ID}` | 必填；宿主固定执行来源；用户输入/任务改变由宿主创建新turn/steer身份，不以prepare刷新重做原任务 |
| `preparation_revision` | Version | 默认1，由adapter持久分配；同turn内bundle过期/失效、提交后补查均递增并使用新key；同turn+此revision唯一绑定一个payload与bundle |
| `consumer_id` | ID | full_lifecycle必填，须匹配turn_ref.session_id与认证Agent；tool-only可省略，此时不承诺已登记宿主清理能力 |
| `purpose` | enum `respond_to_record` / `answer_history` / `resolve_reference` / `assist_correction` | 必填；影响召回及个性化策略，不改变grant |
| `about_entity_id` | ID | 必填 |
| `current_input` | `{text?:string,source_id?:ID,source_group_id?:ID}` | 必填且text/source_id至少一项；text≤4KiB。提供的source/group默认及强制从历史候选排除；模型不能取消排除 |
| `domains` | Domain[] | 可选，显式筛选最多8；缺省作用于grant允许且本purpose相关的全部注册域（可超过8），不能静默只取前8；显式空数组非法 |
| `time_range` | TimeRange | 可选；仅约束历史候选，不推断缺测日期 |
| `time_basis` | enum `occurred` / `recorded_at` | 默认occurred；occurred按发生区间重叠，未知时间排除并返回gap；recorded_at按01定义的接收/记录时间，不代表发生时间 |
| `read_after` | ReadAfter | 可选，见2.4；宿主有pending外部mutation时必须设置或停止受影响读 |
| `token_budget` | integer | 默认1200，范围128–4000；含事实、引用和元数据的注入内容，不含HTTP诊断字段 |
| `tokenizer_id` | string | 可选，服务支持列表中ID，≤64字节；未提供/未知模型时使用保守估算，返回 `budget_accounting=estimate` |
| `max_items` | integer | 默认8，范围1–20；依赖信息不算单独记忆条目 |
| `deadline_ms` | integer | 默认1800，范围100–3000；服务处理deadline，网络与宿主编排另计 |
| `degrade_policy` | enum `allow_safe_partial` / `require_planned_channels` | 默认allow_safe_partial；允许缺通道不允许旧版本、撤权或未满足read_after |

计划通道由服务的固定查询策略按已发布release manifest、purpose及当前授权范围确定，不能由模型临时要求增加/移除以绕过严格模式。wire通道名称闭枚举为 `recent / lexical / vector / structured / profile_open_items`；未获权限或对当前purpose不适用的通道不进入计划，也不出现在missing_channels。

本次授权/用途内的必要约束先独立核对完整性，不受普通候选top-k/6项偏好或160候选cap静默截断。约束及最低元数据无法装入token_budget、max_items或32KiB时返回422 TOKEN_BUDGET_TOO_SMALL，details.limit_kind为token_budget/max_items/content_bytes，不发布可用bundle；约束适用性/当前性无法核验时返回503 FRESHNESS_UNAVAILABLE，到deadline为504 FRESHNESS_TIMEOUT，即使allow_safe_partial也不能丢约束后交付正文。

`require_planned_channels`要求本次所有计划通道完成。已知某计划通道不可用时返回 `503 PLANNED_CHANNEL_UNAVAILABLE`，error.details必填 `missing_channels`（1–5项、不重复的上述通道名）；未能在deadline前完成则返回 `504 DEADLINE_EXCEEDED`，details同样列明未完成通道。两者均不返回历史正文、canonical_injection或可用bundle。授权/read_after/失效检查失败仍优先使用各自错误，不借通道错误掩盖一致性缺口。

只有 `allow_safe_partial`可在缺计划通道时返回degraded；前提是全部授权、read_after和失效检查满足，并能在deadline内组装安全响应，freshness明确缺失通道。服务到deadline仍无法交付时返回504，不能超时后发布degraded正文；所有计划通道正常完成且无适用证据才允许empty。此规则同时适用于继承degrade_policy的search端点。

响应的 `canonical_injection` 为必填string，无缺省，最大32KiB，是可解析JSON字符串，根对象恰好为 `{purpose,items,gaps}` 并与顶层同名字段完全相等；不能附隐藏字段、额外instructions或系统权限。token预算覆盖整串。`bundle_hash` 必填，为该string UTF-8字节的SHA-256，格式 `sha256:` 加64个小写十六进制字符。串中保留source refs、authority、时间精度与usage限制；来源文本中可能出现的指令仍只是证据数据。适配器只能原样注入受控数据通道，不据items重排或重新拼接，也不把它提升为系统指令。HTTP诊断、hash自身和宿主wrapper不进入hash。未知tokenizer时同时满足字节上限并返回estimate，不能承诺精确模型token数。服务应安全裁剪非必要条目；若必需的限制/证据元数据仍无法放入指定预算，返回 `422 TOKEN_BUDGET_TOO_SMALL`，不能静默丢掉限制后声称完整。

成功 `200` 返回一个固定bundle，5分钟后过期；同key不重跑排序或加入新记忆。授权撤回、来源删除/纠正、显式个性化排除优先于幂等重放：原bundle受影响时不能重放其旧内容，返回 `409 BUNDLE_INVALIDATED`，适配器保留turn_ref，将preparation_revision递增并用新key重新prepare。过期返回 `410 BUNDLE_EXPIRED`，同样新revision/新key，不可同key改变输入。每次重放均执行当前grant与依赖有效性检查。新prepare只准备上下文，不意味着重新执行已经提交或结果未知的业务工具。

`result_status=empty` 只表示本次配置的检索已完成且没有应交付的证据，不表示用户从未记录。超时或索引不可用只可返回 `degraded` 并带明确缺口，或失败；不伪装empty。服务返回结构化gap code，不替主Agent生成追问或诊断。

```json
{
  "turn_ref": {"session_id": "sess_1", "turn_id": "turn_18"},
  "preparation_revision": 1,
  "consumer_id": "consumer_a1",
  "purpose": "respond_to_record",
  "about_entity_id": "entity_self",
  "current_input": {"text": "今天72.4", "source_id": "src_input_18", "source_group_id": "input_group_18"},
  "domains": ["health.weight"],
  "read_after": {"external_barriers": [{"stream_id": "records_user_stream", "through_seq": 105}]},
  "token_budget": 1200,
  "max_items": 8,
  "deadline_ms": 1800
}
```

```json
{
  "bundle_id": "bun_018",
  "bundle_kind": "context",
  "bundle_hash": "sha256:783dd31e6a2b89dc6378d3a7b2df8fa206635b8ff6cbdf3841f9221cc256b8fb",
  "canonical_injection": "{\"purpose\":\"respond_to_record\",\"items\":[{\"memory_id\":\"mem_weight_15\",\"memory_version\":1,\"memory_kind\":\"fact_evidence\",\"authority_kind\":\"external_committed\",\"content\":{\"text\":\"上次明确记录的体重为72.8 kg\"},\"source_refs\":[{\"source_id\":\"src_record_15\",\"source_version\":1}],\"selection_reason\":\"unit_reference\",\"usage\":\"disambiguation_only\",\"occurred\":{\"occurred_from\":\"2026-10-25T08:00:00-04:00\",\"time_precision\":\"minute\",\"timezone\":\"America/New_York\"}}],\"gaps\":[{\"code\":\"unit_not_explicit_in_current_input\"}]}",
  "result_status": "ready",
  "expires_at": "2026-10-27T00:05:00.000Z",
  "purpose": "respond_to_record",
  "items": [
    {
      "memory_id": "mem_weight_15",
      "memory_version": 1,
      "memory_kind": "fact_evidence",
      "authority_kind": "external_committed",
      "content": {
        "text": "上次明确记录的体重为72.8 kg"
      },
      "source_refs": [
        {
          "source_id": "src_record_15",
          "source_version": 1
        }
      ],
      "selection_reason": "unit_reference",
      "usage": "disambiguation_only",
      "occurred": {
        "occurred_from": "2026-10-25T08:00:00-04:00",
        "time_precision": "minute",
        "timezone": "America/New_York"
      }
    }
  ],
  "gaps": [
    {
      "code": "unit_not_explicit_in_current_input"
    }
  ],
  "snapshot": {
    "policy_epoch": 7,
    "visibility_generation": 43,
    "dependencies": [
      {
        "kind": "source",
        "id": "src_record_15",
        "version": 1
      }
    ],
    "external_barriers_satisfied": [
      {
        "stream_id": "records_user_stream",
        "through_seq": 105
      }
    ]
  },
  "freshness": {
    "read_after_satisfied": true,
    "channels": {
      "lexical": "current",
      "vector": "current"
    }
  },
  "budget": {
    "requested_tokens": 1200,
    "used_tokens": 212,
    "budget_accounting": "estimate",
    "truncated": false
  },
  "next_actions": [],
  "coverage": {
    "time_basis": "occurred",
    "snapshot_at": "2026-10-27T00:00:00.000Z",
    "resolved_time_range": null
  }
}
```

依赖表必须同时覆盖source、memory、派生摘要及其lineage代际、grant policy epoch和使用策略代际。不能只追踪展示条目ID，让摘要中隐含的被删来源继续留存。`selection_reason` 是可解释枚举，相关性分不能称为事实可信概率。示例的单位参照只是消歧线索，是否足以保存72.4 kg由Agent/业务字段校验确定。上例的hash与所示canonical_injection的确切UTF-8字节匹配；服务不能把hash替换成从其他序列化表示计算的摘要。

专属错误：`409 BUNDLE_INVALIDATED / POLICY_EPOCH_STALE / PREPARATION_REVISION_CONFLICT`、`410 BUNDLE_EXPIRED`、`422 TOKEN_BUDGET_TOO_SMALL`、`503 FRESHNESS_UNAVAILABLE / PLANNED_CHANNEL_UNAVAILABLE`、`504 FRESHNESS_TIMEOUT / DEADLINE_EXCEEDED`。`allow_safe_partial`也不得绕过授权、删除屏障或业务更正屏障。

## 7 证据搜索：`POST /v1/search`

权限：`memory.search`，trusted adapter 与受限model tool可用。搜索是相关性候选检索，不承诺穷尽历史，不提供记录总数或产品趋势。可返回来源/记忆命中，但片段一律经过字段投影；整段混合原文无法安全拆分时不返回原文。

| 字段 | 类型 | 必填/默认/上限 |
|---|---|---|
| `query` | string | 必填，1–4KiB；不能为SQL或任意查询DSL |
| `about_entity_id` | ID | 必填 |
| `domains` / `time_range` | Domain[] / TimeRange | 可选，继承通用限制 |
| `time_basis` | enum `occurred` / `recorded_at` | 默认occurred；区间重叠/未知排除与context一致，未知发生时间不悄用recorded_at补入 |
| `memory_kinds` | enum[] | 可选，最多6项，值同remember |
| `authority_kinds` | enum[] | 可选，最多3项，仅缩小范围 |
| `exclude_source_ids` / `exclude_source_group_ids` | ID[] | 可选，各最多32项；宿主强制附加本轮source/group排除 |
| `read_after` | ReadAfter | 可选 |
| `limit` | integer | 默认8，1–20 |
| `cursor` | opaque string | 可选，10分钟有效，绑定查询与snapshot；修订/删除仍在每页重新过滤 |
| `deadline_ms` | integer | 默认1800，100–3000 |
| `degrade_policy` | enum | 同context，默认allow_safe_partial |
| `purpose` / `consumer_context` | 公共读取字段 | 见§2.6；full补查正文同样登记usage_bundle，不因它是工具结果而豁免 |

```json
{
  "query": "上次喝的补剂叫什么",
  "purpose": "answer_history",
  "consumer_context": {"consumer_id":"consumer_a1","session_id":"sess_1","turn_id":"turn_18"},
  "about_entity_id": "entity_self",
  "domains": ["health.supplement"],
  "limit": 5,
  "deadline_ms": 1800
}
```

```json
{
  "result_status": "ready",
  "tracking_status": "registered",
  "usage_bundle": {"bundle_id":"bun_read_019","bundle_hash":"sha256:1d4d2b0c0a3cfa78c66d16228516a852ec8e739d835bba019a67db5d475701db","expires_at":"2026-10-27T00:05:00.000Z","bundle_kind":"read_result"},
  "hits": [
    {
      "evidence_ref": {
        "kind": "source",
        "id": "src_supplement_4",
        "version": 1
      },
      "source_group_id": "input_group_4",
      "about_entity_id": "entity_self",
      "snippet": "今天记录了维生素D",
      "authority_kind": "user_reported",
      "matched_fields": [
        "text"
      ],
      "relevance_rank": 1
    }
  ],
  "next_cursor": null,
  "coverage": {
    "exhaustive": false,
    "meaning": "ranked_candidates_only",
    "time_basis": "occurred",
    "snapshot_at": "2026-10-27T00:00:00.000Z",
    "resolved_time_range": null
  },
  "freshness": {
    "read_after_satisfied": true,
    "channels": {
      "lexical": "current",
      "vector": "current"
    }
  }
}
```

专属错误：`410 CURSOR_EXPIRED`、`400 CURSOR_QUERY_MISMATCH`、`503 FRESHNESS_UNAVAILABLE / PLANNED_CHANNEL_UNAVAILABLE`、`504 FRESHNESS_TIMEOUT / DEADLINE_EXCEEDED`。若需要“最近所有补剂名/去重列表”，Agent调用产品recent-items工具或使用受控facts分页投影；不能把上述top5当成全部历史。

## 8 精确取证：`POST /v1/evidence:batchGet`

权限：`evidence.read`；原文另需 `source.raw.read`。允许模型按搜索返回的引用补查，不允许通过猜测ID绕过授权。V1普通读只返回当前有效、可披露的证据revision；不返回已擦除或过时revision。原来源仍保留但其某断言被外部条目更正时，只有§2.6明确历史用途可以带historical_only标签查看原话；这不构成任意旧版本审计接口。

| 字段 | 类型 | 必填/默认/上限 |
|---|---|---|
| `refs` | `{kind:"source"\|"memory",id:ID,version?:Version}[]` | 必填，1–32；指定version若已失效不会回退旧值 |
| `projection` | enum `safe_excerpt` / `structured` / `raw` | 默认safe_excerpt；raw需独立权限；服务可能裁剪或拒绝单项 |
| `purpose` / `consumer_context` | 公共读取字段 | 见§2.6；full逐项成功结果全部计入同一usage_bundle依赖 |
| `read_after` | ReadAfter | 可选 |
| `deadline_ms` | integer | 默认1800，100–3000 |

成功 `200` 逐项结果，顺序与refs一致；不存在与未授权统一单项 `NOT_FOUND_OR_NOT_VISIBLE`，不透露版本。已获授权但所指定版本过时返回 `STALE_REFERENCE`，给当前可见引用，正文不返回旧值；若已删除，则统一不可用。批量任一未知形状或超过体积整批拒绝，不做部分解析。响应最大256KiB，超出时单项 `CONTENT_TOO_LARGE`，不偷偷截断精确原文；safe_excerpt可以截断但须 `truncated=true`。

```json
{"refs":[{"kind":"source","id":"src_record_15","version":1}],"projection":"structured"}
```

```json
{
  "results": [{"ref":{"kind":"source","id":"src_record_15","version":1},
    "status":"ok", "content":{"structured":{"schema_id":"health.weight","schema_version":1,
      "data":{"value":"72.8","unit":"kg","measurement_method":"user_reported"}}},
    "authority_kind":"external_committed", "truncated":false}],
  "tracking_status":"uncontrolled",
  "freshness":{"read_after_satisfied":true}
}
```

专属错误：整批 `503 FRESHNESS_UNAVAILABLE / 504 FRESHNESS_TIMEOUT`；单项 `STALE_REFERENCE / NOT_FOUND_OR_NOT_VISIBLE / PROJECTION_NOT_ALLOWED / CONTENT_TOO_LARGE`。单项失败不能转换成“该用户没有记录”。

## 9 结构化事实过滤：`POST /v1/facts:query`

权限：`facts.read`。返回本服务当前有效的有来源事实投影行，适合明确时间/主体/字段的Agent取证；不提供 `sum/count/avg/group_by`，不生成产品图表、日历或账本。产品正式总量走 `records.metrics.*` 等业务工具。事实投影行即使来自external_committed也不宣称已覆盖所有正式记录。context/search按occurred过滤时，对未知发生时间排除返回 `unknown_occurrence_time_excluded` gap，不解释为没有相关历史。

| 字段 | 类型 | 必填/默认/上限 |
|---|---|---|
| `schema_id` / `schema_version` | ID / Version | 必填，服务注册领域schema |
| `about_entity_id` | ID | 必填 |
| `time_range` | TimeRange | 必填；最大366天/页查询窗；不替代valid_at |
| `time_basis` | enum `occurred` / `recorded_at` | 默认occurred；occurred按发生区间重叠，未知发生时间不命中；recorded_at按01定义的来源接收/记录时间筛选 |
| `filters` | `{field:string,op:enum,value:scalar\|scalar[]}[]` | 可选，最多8条；field为schema允许字段，≤128字节；op=`eq/in/lt/lte/gt/gte`；in最多20值，不支持任意表达式/跨表连接 |
| `fields` | string[] | 必填，1–16项，schema与grant允许投影；ID/版本/来源引用始终附带；允许的发生时间meta字段为occurred_from/occurred_to/time_precision/timezone，以及仅明确point记录可非null的派生occurred_at；day/unknown禁止补00:00 |
| `authority_kinds` | enum[] | 默认仅user_reported和external_committed；agent_inferred需显式请求且grant允许 |
| `valid_at` | timestamp | 可选，只对当前可用修订的有效区间过滤，不恢复state_change替代的旧头；空投影不证明当时无该状态，V1无known_at/任意旧revision读取API |
| `order_by` | enum `occurred_at_asc` / `occurred_at_desc` | 缺省occurred_at_desc；枚举名称保留，实际只选择升降方向，排序键由time_basis决定。occurred用已知发生下界、recorded_at用来源记录时间；同键memory_id升序，未知发生下界末尾；cursor保持同一规则 |
| `limit` / `cursor` | integer / opaque | 默认20，1–100；cursor十分钟有效，绑定查询与snapshot |
| `read_after` / `deadline_ms` | ReadAfter / integer | 可选 / 默认1800、100–3000 |
| `purpose` / `consumer_context` | 公共读取字段 | 见§2.6；每页单独usage_bundle，facts不返回historical_only旧主张 |

```json
{
  "schema_id":"health.weight","schema_version":1,"about_entity_id":"entity_self",
  "time_range":{"from":"2026-10-01T00:00:00-04:00","to":"2026-11-01T00:00:00-04:00"},
  "fields":["value","unit","occurred_at"],"limit":20
}
```

```json
{
  "rows": [
    {
      "memory_id": "mem_weight_15",
      "memory_version": 1,
      "values": {
        "value": "72.8",
        "unit": "kg",
        "occurred_at": "2026-10-25T08:00:00-04:00"
      },
      "authority_kind": "external_committed",
      "projection_status": "supported",
      "source_refs": [
        {
          "source_id": "src_record_15",
          "source_version": 1
        }
      ],
      "external_record_ref": {
        "system_id": "records",
        "record_id": "rec_15",
        "external_version": "r1"
      }
    }
  ],
  "tracking_status": "uncontrolled",
  "next_cursor": null,
  "coverage": {
    "scope": "memory_fact_projection",
    "exhaustive_within_projection": true,
    "upstream_complete": false,
    "pending_projection_count": 1,
    "unknown_time_projection_count": 0,
    "time_basis": "occurred",
    "snapshot_at": "2026-10-27T00:00:00.000Z",
    "resolved_time_range": {
      "from": "2026-10-01T00:00:00-04:00",
      "to": "2026-11-01T00:00:00-04:00"
    }
  },
  "freshness": {
    "read_after_satisfied": true
  }
}
```

`exhaustive_within_projection=true` 只在遍历到最后一页后成立；本页非尾页必须false。即使分页读完，projection仍可能缺少尚未抽取的字段或未接入的来源；待处理数量只披露当前grant投影范围。unknown发生时间的事实不命中有界time_range，coverage必填非负integer `unknown_time_projection_count` 表示当前授权范围内因时间未知无法归窗的行数，不能将它们当本窗零记录。cursor跨页遇来源失效需要重新校验/跳过或返回snapshot invalidated，不得把旧页与新页拼成“完整当前数据”。

专属错误：`422 SCHEMA_VALUE_INVALID`（包括非法字段、操作符、跨领域聚合）；`410 CURSOR_EXPIRED`；`409 SNAPSHOT_INVALIDATED`；`503 FRESHNESS_UNAVAILABLE / 504 FRESHNESS_TIMEOUT`。模型如自行计算示例平均值，必须说明是投影行样本；不能包装成产品正式指标。

## 10 遗忘与个性化策略：`POST /v1/forget`

权限：`memory.policy.write` 对应两种非破坏策略；`memory.erase` 对应erase。模型默认只可调用非破坏模式，erase不在默认MCP工具集中。可信adapter对明确授权的删除请求执行目标解析与授权检查，无须再人为加一次产品未要求的审批；含糊指代不能猜目标。此API不删除产品正式条目，产品删除必须走records工具并镜像变更。

| 字段 | 类型 | 必填/默认/上限 |
|---|---|---|
| `action` | enum `apply` / `clear_policy` | 默认apply；clear_policy仅撤销非破坏策略，不能恢复erase |
| `mode` | enum `suppress_proactive` / `exclude_personalization` / `erase` | apply必填；clear_policy禁止 |
| `targets` | 见下述联合类型 | apply必填且恰好一种目标；最多32个ID；不接受任意语义query作为删除条件 |
| `policy_id` / `expected_policy_version` | ID / Version | clear_policy必填；apply禁止 |
| `reason_code` | enum `user_requested` / `upstream_deleted` / `retention_expired` | 必填；后两者仅可信后台角色可用 |
| `upstream_change` | StreamChange | 来源删除流可选；importer必填且按连续流执行；与普通用户请求不混用 |

targets只允许：`{source_ids:[...]}`、`{source_group_ids:[...]}`、`{memory_ids:[...]}`、`{owner_scope:true}`。owner_scope需要覆盖全owner的独立权限，部分grant不能借其扩大删除。memory_ids用于两种非破坏策略时解析成支持来源lineage并返回resolved_targets；对erase禁止memory_ids，以免只删派生条目后原文再次抽取。adapter须先取证解析再提交明确source/group范围。

source_group只是关联键，不自动授权操作所有组成员。服务展开targets后逐个检查动作权限；若包含未授权成员则整次拒绝，不部分执行，不回显隐藏成员或数量。不能让健康域Agent通过一个混合输入组删除财务记忆；需由具备完整目标权限的可信适配器处理。

`resolved_targets`是有界范围说明，不承诺完整来源清单：结构仍用上述selector，ID数组最多32。source/group/owner请求可回显原selector；memory_ids的非破坏策略在operation内固定解析得到的canonical lineage，回执可仍回显memory_ids，后续不按变化后的memory头重新解析。仅当完整展开结果不超过32时，允许像下例返回全部source_ids；超过32就保留原group/owner/memory selector，不给截断样本或同步精确总数。实际执行/持续门禁始终覆盖完整的已授权范围，不因响应上限截断；operation查询同规则，回显仍须当前授权，不能借进度查询披露隐藏成员。

erase无用户wire版本CAS：它针对明确稳定来源/group身份及全部版本，以独立ledger intent为隐私命令线性化点；内部owner/target gate用锁/CAS串行化。intent前后并发普通更正仍落入被删lineage，不因请求见到旧version而漏删。owner_scope表示清除该intent快照的历史，保持空间可继续使用；新真实用户输入须有可信宿主接收证明并进入新代际。历史backfill默认拒绝，需明确再授权的受控导入，不能靠更高stream_seq、改source_id或伪称新输入绕过旧历史抑制。清除可逆policy和普通内容编辑继续使用各自expected version CAS。

三种模式语义：

- `suppress_proactive`：不主动把目标当成反馈/洞察；明确历史查询仍可引用，必要消歧可以私下使用，但不得绕过用户可见的“不要再提”设置。
- `exclude_personalization`：目标及其派生不进入个性化准备、画像和主动关联；用户明确查询该历史时可直接取证，标注direct_reference_only。若用户要“任何方式都不要再使用”，应erase或撤回相应访问授权。
- `erase`：本服务立即停止对外使用目标，清除来源镜像、记忆、索引、摘要依赖与缓存；本地清理和消费者清理分别跟踪。外部Records仍可能保留，返回明确边界。来源及external record身份留下最小防复活tombstone，旧任务/旧import不得重建；合法重新导入必须经显式新授权、全新来源身份和受控流程，普通upsert无复活能力。

非破坏规则绑定规范化来源lineage与稳定外部来源身份，而非只绑定当前memory_id；重抽生成新ID不能逃过策略。纯agent note无source时绑定其session lineage。规则版本由服务分配，撤销规则使用CAS并令已准备bundle失效。

```json
{"mode":"erase","targets":{"source_group_ids":["input_group_17"]},"reason_code":"user_requested"}
```

```json
{
  "operation_id":"mop_erase_17","status":"applied","write_token":"wt_erase_17",
  "resolved_targets":{"source_ids":["src_input_17","src_record_17a","src_record_17b"]},
  "local_enforced":true,
  "purge_status":"running",
  "consumer_cleanup":{"status":"pending","required_consumers":2,"acknowledged_consumers":0},
  "external_business_data_deleted":false,
  "scope_statement":"仅本记忆服务及已注册消费者；外部正式记录须由产品工具删除"
}
```

erase在返回200 applied前必须先把删除intent持久到独立于主库恢复的control/erase ledger，再把主库失效gate/tombstone与操作回执应用完成，且两者可按同一operation核对；local_enforced保证后续读不再使用目标。ledger先成功而主库失败时intent保留pending、保守阻止相应数据，不承诺全回滚、不发applied token；返回503及可查询operation，恢复按ledger重放gate。物理清理与consumer ack异步；乱序删除事件返回202 accepted，不承诺local_enforced，受影响读取须等barrier或被宿主fence阻止。非破坏策略仍由主库事务原子应用。

`local_enforced`不等于所有Agent已忘记。required_consumers包含受影响bundle/工具结果持有者，以及按订阅范围可能持有产品原消息的full_lifecycle消费者，即便从未prepare或lease已过期；不能因没有bundle、离线或过期从分母移除。只有可校验的clear/reset/session_terminated回执及持久自动重注入抑制可解除对应责任。operation不能把未注册工具宿主、已发出的文本或不可控模型提供商缓存算作已清除；不可控范围单列unverified，不阻塞所声明可控范围完成。

专属错误：`422 AMBIGUOUS_ERASE_TARGET`（erase使用memory_ids/语义范围）、`409 VERSION_CONFLICT`（清除策略CAS）、`403 ACTION_NOT_ALLOWED`、`503 SERVICE_UNAVAILABLE`。删除确认结果未知时按同一key/operation恢复；不能因响应丢失将未清理状态伪装成功。

## 11 操作查询：`GET /v1/operations/{operation_id}`

权限：`operation.read`，且与原操作同owner、可见授权投影；受限模型只可见自身会话允许的operation。无request body；path operation_id为ID。查询参数 `wait_ms` 默认0，0–10000，用于有界等待状态变化；`after_revision` 可选Version，wait只在revision变大或超时返回，不是消费者长轮询的替代。

操作分离“请求接收/应用/派生/物理删除/消费者”进度。`accepted` 只证明inbox持久化，`applied`证明本地canonical变更/门禁生效，或有序导入已按policy_suppressed安全消费，须结合import_outcome判断是否产生可读来源；`completed`含该操作要求的后台步骤完成。普通remember不等待所有消费者。需要消费者清理的erase只有所声明强能力消费者全部ack后才能显示consumer_cleanup.complete。

请求示例：`GET /v1/operations/mop_erase_17?wait_ms=1000&after_revision=2`。

```json
{
  "operation_id":"mop_erase_17","revision":3,"operation_kind":"erase",
  "status":"applied","local_enforced":true,"write_token":"wt_erase_17",
  "stages":{"canonical":"applied","purge":"completed","consumer_cleanup":"pending"},
  "consumer_cleanup":{"required_consumers":2,"acknowledged_consumers":1,
    "uncontrolled_consumers_present":true},
  "retry":{"safe_action":"poll","retry_after_ms":1000},
  "expires_at":"2026-11-26T00:00:00.000Z"
}
```

operation记录至少30天可查询，之后返回410或404（视可见性），不能依赖它代替永久实体身份；stable source/memory定位和tombstone仍阻止重复/复活。operation可能是 `accepted / running / applied / completed / failed / cancelled`，失败含可重试code和已应用阶段。只要canonical已applied，后续派生失败就不能返回“写入未发生”。专属错误：`404 NOT_FOUND_OR_NOT_VISIBLE`；`410 OPERATION_EXPIRED`。GET超时不是写失败。

## 12 Bundle复核：`POST /v1/bundles:validate`

权限：`context.read`；不需要幂等header。对context与read_result两种包，在每个新模型step、依赖历史的工具执行、基于历史的最终交付前在线调用；恢复会话需先满足reset/授权门禁。V1不允许仅凭有效租约、尚未收到变更的长轮询或token剩余时间替代在线校验。服务在valid响应前原子登记/校验bundle→consumer→session依赖；不匹配返回409，不能让另一个session用validate偷偷接管旧bundle。未来降低往返须另有版本化一致性证明和验收，不属于本版优化。

| 字段 | 类型 | 必填/默认/上限 |
|---|---|---|
| `bundle_ids` | ID[] | 必填，1–32；可混合context/read_result，须为当前grant建立；更多仍在上下文中的包分批全验，不漏掉旧工具结果 |
| `consumer_id` | ID | full adapter必填；tool-only可省略 |
| `read_after` | ReadAfter | 可选，验证与当前外部屏障同时满足 |
| `deadline_ms` | integer | 默认800，100–3000 |

```json
{"bundle_ids":["bun_018"],"consumer_id":"consumer_a1","deadline_ms":800}
```

```json
{
  "results":[{"bundle_id":"bun_018","status":"invalidated",
    "reason_codes":["source_revised"],"requires_context_reset":true,
    "replacement_action":"prepare_new_bundle"}],
  "checked_at":"2026-10-27T00:01:00.000Z","policy_epoch":7,
  "consumer_state":"REVALIDATION_REQUIRED"
}
```

单项status=`valid / invalidated / expired / unavailable`。valid附expires_at和当前visibility_generation；valid不延长原5分钟TTL。失效包不得返回旧内容以便“比较”；由证据API按新授权取证。未知与未授权统一 unavailable；expired只是本包过期，不代表其全部来源删除。专属错误：整批 `503 FRESHNESS_UNAVAILABLE` / `504 FRESHNESS_TIMEOUT`；schema错误整批400。任何非valid都不能继续注入旧包，服务不可达不能默认valid。

## 13 变更流：`GET /v1/changes`

权限：`changes.read`；只面向注册可信consumer，模型不直接订阅。cursor仅包含该consumer/grant投影序列，不能据序号推算其他用户更新量。V1采用可重连拉取，不接收任意callback URL。

撤权后的清理认证使用独立service-client身份加预登记consumer绑定的cleanup-only权限，而非继续用已撤销grant旧token读取。该通道只允许读取本consumer已登记清理责任范围内的source/group控制元信息、旧bundle失效/代际及发送ack/reset/termination回执；覆盖无bundle原消息责任，不含正文、未曾授权的新范围信息或新读取权。普通数据请求始终拒绝。可信宿主service-client身份失效时由控制面处置未确认消费者，不能伪造已清理回执。

| 查询参数 | 类型 | 必填/默认/上限 |
|---|---|---|
| `consumer_id` | ID | 必填，与凭证/会话绑定 |
| `cursor` | opaque string | 首次使用consumer注册回执的initial_cursor，后续必填；不能从任意数字跳转 |
| `limit` | integer | 默认100，1–200 |
| `wait_ms` | integer | 默认0，0–25000；长轮询超时正常返回空changes和相同/新cursor，不表示数据丢失 |

请求示例：`GET /v1/changes?consumer_id=consumer_a1&cursor=cur_opaque_1&limit=100&wait_ms=1000`。

```json
{
  "changes":[{"change_seq":18,"event_type":"source_revised",
    "affected_sources":[{"source_id":"src_record_15","source_version":2}],
    "affected_memories":[{"memory_id":"mem_weight_15","memory_version":1}],
    "visibility_generation":44,"policy_epoch":7,
    "bundle_ids":["bun_018"],"requires_context_reset":true}],
  "next_cursor":"cur_opaque_18","delivered_through_seq":18,
  "has_more":false,"lease_expires_at":"2026-10-27T00:02:00.000Z"
}
```

event_type包含 `source_revised / source_erased / memory_revised / memory_retracted / policy_changed / grant_revoked / full_revalidation_required`。撤权后仍允许用受限清理通道读取不含原文的失效信封，禁止继续读取数据；否则无法完成清理ack。changes最多保留30天，cursor间隙/过期返回 `409 CURSOR_GAP` / `410 CURSOR_EXPIRED`，consumer转REVALIDATION_REQUIRED，必须清除全部旧bundle、重新校验并从服务给的reset cursor继续。服务不得默默跳过丢失段。

full注册同时订阅其grant的owner/entity/domain范围。source/group擦除、原断言替代和撤权不能只按已取得bundle筛选通知：宿主可能只持产品原始用户消息（例如picker跳过检索）。服务向范围重叠的full消费者发送受权限投影的控制事件，并保守纳入清理责任；宿主将source/group定位到原消息、工具结果、压缩摘要及反馈，持久抑制自动重新注入，再按既有reset receipt回执。没有本地副本时也要持久该抑制并确认处理，不能从未取得bundle推定无责任。tool-only和未登记宿主仍明确unverified；这里不授权读取隐藏原文或产品账本。

事件正文遵守256KiB上限；affected_sources/affected_memories/bundle_ids各最多64项，并可带affected_source_group_ids（ID[]，最多64项、不重复，缺省[]）用于未镜像输入的稳定组抑制。需要更大范围时发送full_revalidation_required及reset_required=true（可选布尔，缺省false），不静默裁剪后当完整列表。接收者全清/reset，服务按已登记责任关闭旧依赖；不得要求客户端猜出未列ID。

大范围reset未列完整目标时，宿主还须持久保存本次订阅scope与其产品输入journal的恢复边界，保守禁止该范围内reset前既有消息自动重建入模；新实例同样查共享抑制目录。只有可证明未受限制的旧输入才可恢复，未知旧行默认阻断。后续真实新输入可以正常处理，不能把旧输入重导伪称新输入。该保守重置可暂时丢失未受影响上下文，但不会把未知目标漏掉；精细恢复是后续优化。控制信封只涉及接收者已授权范围，不披露其他用户/主体数量。

消费水位是连续完成前缀：收到18但未完成17不得ack18。重复change安全重放，不再传来源原文。源失效先本地BLOCK，再清理上下文/缓存，后ack；禁止先ack再异步删。

## 14 消费者登记、租约与清理回执

### 14.1 `POST /v1/consumers:register`

权限：`consumer.manage`，可信adapter/control-plane；模型不可注册或自报自己具备强保证。需Idempotency-Key。一次session/runtime实例一个consumer，永久离线后的新实例重新登记。

| 字段 | 类型 | 必填/默认/上限 |
|---|---|---|
| `consumer_id` | ID | 必填、稳定；重启沿用需证明原会话绑定 |
| `agent_id` / `session_id` | ID / ID | 必填；agent_id须等于认证身份 |
| `capability_profile` | enum `full_lifecycle` / `tool_only_best_effort` | 必填，由注册允许清单校验 |
| `capabilities` | enum[] | 必填，最多8；可选值 `before_turn / before_model_step / before_response / clear_context / invalidate_cache / change_ack / reliable_ingest / persist_tool_receipts` |
| `lease_seconds` | integer | 默认120，30–300；full_lifecycle必须续约，不能无限有效 |
| `protocol_versions` | `{memory_api:string[],mcp?:string[]}` | 必填；memory_api必填，mcp仅MCP接入填写，各1–8项、各≤32字节；不能把两个协议混作一个版本 |

```json
{
  "consumer_id":"consumer_a1","agent_id":"agent_recording","session_id":"sess_1",
  "capability_profile":"full_lifecycle",
  "capabilities":["before_turn","before_model_step","before_response","clear_context","invalidate_cache","change_ack","reliable_ingest","persist_tool_receipts"],
  "lease_seconds":120,"protocol_versions":{"memory_api":["v1"],"mcp":["2026-07-28"]}
}
```

```json
{"consumer_id":"consumer_a1","state":"ACTIVE","initial_cursor":"cur_opaque_0",
 "last_acked_change_seq":0,"lease_expires_at":"2026-10-27T00:02:00.000Z"}
```

200登记完成；冲突409 `CONSUMER_BINDING_CONFLICT`；能力不足422 `UNSUPPORTED_CAPABILITY`。full_lifecycle最小必须before_turn、before_model_step、before_response、clear_context、invalidate_cache、change_ack、persist_tool_receipts；reliable_ingest可独立连接在产品importer而非此运行时，但必须声明数据写入责任所在。订阅范围由当前/曾获授权且仍有清理责任的grant目录派生，不能用注册请求扩大；其清理责任覆盖范围内可能持有的原消息，不仅是已生成的bundle。

### 14.2 `POST /v1/consumers/{consumer_id}:ack`

权限：`consumer.ack`，仅对应consumer受信宿主；需Idempotency-Key。不能以工具annotation或模型文本“已清理”为证明。

| 字段 | 类型 | 必填/默认/上限 |
|---|---|---|
| path consumer_id | ID | 必填，与凭证绑定 |
| `through_seq` | integer ≥0 | 必填；已连续执行到的change_seq，不得超过已deliver水位；不得倒退 |
| `cleared_bundle_ids` | ID[] | 必填，可空；最多64；必须包含该段要求清除的受影响活跃包 |
| `context_reset_receipt` | `{host_session_revision:Version,reset_at:timestamp,method:enum}` | 有requires_context_reset时必填；method=`discard_and_rebuild` / `session_terminated`；记录宿主动作而非模型确认 |
| `lease_seconds` | integer | 可选续约，30–300；默认保留原租约，不自动续期 |

```json
{"through_seq":18,"cleared_bundle_ids":["bun_018"],
 "context_reset_receipt":{"host_session_revision":3,"reset_at":"2026-10-27T00:01:02.000Z","method":"discard_and_rebuild"},
 "lease_seconds":120}
```

```json
{"consumer_id":"consumer_a1","state":"ACTIVE","last_acked_change_seq":18,
 "lease_expires_at":"2026-10-27T00:03:02.000Z","revoked_bundle_ids":["bun_018"]}
```

200回执持久化；`409 ACK_GAP / ACK_AHEAD_OF_DELIVERY / CONTEXT_RESET_REQUIRED` 拒绝越过缺口；`403 CONSUMER_BINDING_MISMATCH` 拒绝其他宿主ack。ack只恢复consumer可用性，不恢复revoked bundle。grant已撤销的consumer最终转DETACHED，即使清理成功也不得继续读记忆。

一次失效或累计待清包超过64、事件要求全量重验，或宿主选择全量丢弃时，不得截短cleared_bundle_ids后ack。服务返回`409 CONSUMER_RESET_REQUIRED`，details含短期reset_token，使用§14.4全量清理握手；无需枚举所有包。reset token绑定该consumer已知的全部未决控制位置和旧依赖基点；清理期间新变化仍须在reset提交时复核，未覆盖的新变化保持BLOCKED/重新reset，不能越过它们。无bundle但持原消息的处理可以提交空cleared_bundle_ids及实际reset receipt，前提是已写持久抑制。

### 14.3 `POST /v1/consumers/{consumer_id}:heartbeat`

权限：`consumer.heartbeat`；需Idempotency-Key。path ID同上。body仅 `lease_seconds`（integer，默认120，30–300）与 `host_session_revision`（Version，必填）。200返回consumer当前state、last_acked_change_seq、lease_expires_at；不会自动确认变更，不会把REVALIDATION_REQUIRED/BLOCKED改成ACTIVE。

```json
{"lease_seconds":120,"host_session_revision":3}
```

```json
{"consumer_id":"consumer_a1","state":"REVALIDATION_REQUIRED","last_acked_change_seq":18,
 "lease_expires_at":"2026-10-27T00:05:00.000Z","required_action":"discard_all_bundles_and_reset"}
```

租约过期/游标断档返回200当前不可用状态或409 `CONSUMER_REVALIDATION_REQUIRED`，宿主必须停止旧上下文使用。恢复时discard全部旧包、确认重置、从服务reset cursor重新消费再ack；单纯heartbeat不算恢复。tool_only_best_effort可以不续约，但永不列入强消费者清理完成保证；其存在必须在erase/revoke操作里明示。

### 14.4 `POST /v1/consumers/{consumer_id}:reset`

权限：`consumer.ack`，只允许对应可信宿主；需Idempotency-Key。用于租约过期、changes断档、超过64包或full_revalidation_required后的全量清理，不是跳过未清变更的便捷ack。`CURSOR_GAP / CURSOR_EXPIRED / CONSUMER_REVALIDATION_REQUIRED / CONSUMER_RESET_REQUIRED`的授权错误信封给一个最长5分钟、绑定consumer/grant与当前重置基点的 `reset_token`；若token过期先重新获取consumer状态/changes错误以取得新token。

| 字段 | 类型 | 必填/默认/上限 |
|---|---|---|
| path consumer_id | ID | 必填，与凭证绑定 |
| `reset_token` | opaque string | 必填，≤2048字节，服务签发、不可由宿主推断seq自造 |
| `discarded_all_bundles` | boolean | 必填且必须true；声明已清两类包、工具结果、压缩摘要、反馈和磁盘上下文；对受影响source/group原消息也已持久抑制自动重注入。只清动态注入块不满足此声明 |
| `context_reset_receipt` | ResetReceipt | 必填，结构同ack；只能discard_and_rebuild或session_terminated |
| `lease_seconds` | integer | 默认120，30–300 |

```json
{"reset_token":"reset_opaque_21","discarded_all_bundles":true,
 "context_reset_receipt":{"host_session_revision":4,"reset_at":"2026-10-27T00:06:00.000Z","method":"discard_and_rebuild"},
 "lease_seconds":120}
```

```json
{"consumer_id":"consumer_a1","state":"ACTIVE","initial_cursor":"cur_reset_21",
 "last_acked_change_seq":21,"lease_expires_at":"2026-10-27T00:08:00.000Z",
 "active_bundle_ids":[]}
```

服务原子撤销该consumer全部旧bundle绑定、记录全量清理回执，给出新的连续消费基点。新基点前的丢失段由“全部丢弃旧上下文”覆盖，并非证明宿主逐条读过事件。之后任何历史使用必须重新prepare/validate。grant已撤销返回DETACHED且只允许结束清理，不恢复读取。专属错误：`410 RESET_TOKEN_EXPIRED`、`409 RESET_CONTEXT_NOT_CLEARED`、`403 CONSUMER_BINDING_MISMATCH`。宿主不能执行clear_context时禁止发送成功reset，持续BLOCKED或关闭session。

memory-only erase不物理删除产品输入journal或正式记录。full宿主的自动会话重建、旧operation/SSE重放及压缩都必须查其共享持久抑制目录；不能在reset后从产品原消息自动把同段内容灌回模型。用户以后明确要求访问仍保留的产品历史属于另一次已授权用途，须重新校验并说明数据仍存在于产品侧；不能把那次主动披露包装成“记忆删除已撤销”。宿主不能实现该映射/抑制时不得通过full清理验收。

## 15 能力发现与授权控制面

### 15.1 `GET /v1/capabilities`

权限：部署级 `service.discover`，允许已认证adapter在建立owner委托前调用；无request body、无query参数。不返回任何tenant数据、注册用户、源数量或其他Agent。200响应是服务自身能力，不能证明某宿主已实现它们。

```json
{
  "memory_api_versions":["v1"],
  "mcp":{"transports":["streamable_http"],"endpoint":"/mcp",
    "protocol_revisions":["2026-07-28"],"stdio_bridge_supported":true},
  "features":["source_mirror","remember","revise","context_prepare","controlled_read_results","hybrid_search",
    "evidence_batch_get","fact_projection","forget","bundle_validate","changes","consumer_ack","chat_origin_binding"],
  "history":{"supported_modes":[],"repair_kinds":[],"automatic_discovery":false,
    "context_repair":false,"pre_registration_bootstrap":false,"mutable_origins":false},
  "limits":{"source_content_bytes":16384,"batch_items":32,"batch_body_bytes":262144,
    "context_default_deadline_ms":1800,"context_max_deadline_ms":3000,
    "context_default_token_budget":1200,"context_max_token_budget":4000,
    "context_default_max_items":8,"context_max_items":20,"bundle_ttl_seconds":300},
  "tokenizers":["registered_tokenizer_v1"],
  "consumer_profiles":["full_lifecycle","tool_only_best_effort"]
}
```

错误：通用401/429/503；拒绝未知query/body字段400。上例是启用扩展的能力示例，不是首发必需集合；未启用MCP时endpoint=null、transports=[]、protocol_revisions=[]、stdio_bridge_supported=false，未列feature即false。MCP修订由实际部署声明，不要求所有现存Agent支持同一修订。接入器记录所选协议和不支持能力，不能静默降级后维持强保证标签。

`chat_origin_binding`表示实时路径支持注册origin、source plan及scope gate，不表示支持历史扫描。history对象的完整字段与默认如下，未声明对象等于全部关闭；它只公布部署能力，不披露owner或已登记会话：

| 字段 | 类型/缺省及约束 |
|---|---|
| supported_modes | catch_up/backfill/repair/reextract的子集，缺省[]；空数组时history:run不可用；非空必须配套cancel及06的安全依赖 |
| repair_kinds | missing_source/missing_derivation/stale_projection的子集，缺省[]；supported_modes含repair则至少一项，不含repair时必须空；调用未声明kind返回UNSUPPORTED_CAPABILITY |
| automatic_discovery | boolean，缺省false；会话发现/周期巡检的部署能力，不因catch_up自动启用 |
| context_repair | boolean，缺省false；允许宿主按真实覆盖缺口触发受预算修复，仍要求对应mode/kind已启用 |
| pre_registration_bootstrap | boolean，缺省false；接入前无source plan历史的受控身份核对/计划能力，不是豁免去重或删除的开关 |
| mutable_origins | boolean，缺省false；已实现可变消息原修订合同；false时仍必须检测原文异常变化并阻断 |

A的supported_modes/repair_kinds为空；可选B可声明catch_up/backfill，按需加repair及missing_derivation/stale_projection，四个boolean仍为false。features与history必须一致：有catch_up/backfill才列chat_history_ingest，有backfill列history_backfill，有repair列history_repair，有reextract列memory_reextract。控制面另外保存每个连接的身份接入边界、计划覆盖和实际授权范围，不能用部署支持推定某owner的接入前历史可导入。

### 15.2 `POST /v1/access:apply`

权限：控制面 `access.manage`，仅认证issuer绑定的授权管理服务；模型、普通adapter、importer无此权限。认证系统可使用外部标准授权服务器，MemoryService仍必须保存durable grant catalog，并在读、重放、bundle validate及写提交时检查live status与current epoch，不能只信尚未过期的旧token claim。

| 字段 | 类型 | 必填/默认/上限 |
|---|---|---|
| `grant_id` | ID | 必填；请求认证issuer须有该tenant/owner的授权管理权，不能仅凭ID创建任意授权 |
| `expected_policy_epoch` | integer ≥0 | 必填；0仅新建；后续CAS，不允许直接指定新epoch |
| `status` | enum `active` / `revoked` | 必填；revoked不允许用同ID自动重新激活，新授权另建grant |
| `grant_snapshot` | object | active必填，revoked禁止；完整替换，不接受任意partial patch |
| `.agent_id` | ID | 必填，绑定受委托Agent |
| `.entity_scope` | enum `selected_entities` / `owner_space` | 默认selected_entities；owner_space须issuer具有显式owner宽授权签发权，否则403 |
| `.about_entity_ids` | ID[] | selected_entities必填，1–16；owner_space禁止，且不接受`*`，null主体并不因selected_entities而获得全文读取权 |
| `.domains` | Domain[] | 必填，1–32，显式枚举已注册域；完整owner授权须覆盖实际目标全部领域。新增注册域不自动扩大旧grant；查询/单来源的8项限制不用于grant目录 |
| `.actions` | enum[] | 必填，1–32，动作必须来自服务声明的注册action集合 |
| `.projection` | `{raw_source:boolean,field_paths:string[]}` | 必填，raw_source默认false、最多64注册字段路径；不允许仅用raw_source=true跨域读取混合原文 |
| `.valid_time_range` | TimeRange | 可选，限制可读事实时间；不填只表示未施加时间限制，不解除其他范围 |
| `.expires_at` | timestamp | 必填，未来时间；不允许无期限委托令牌；最长授权期限由租户策略进一步限制 |
| `.registered_consumer_profiles` | enum[] | 必填，1–2，值为full_lifecycle/tool_only_best_effort，避免宿主自报强能力 |

```json
{
  "grant_id":"grant_recording_1","expected_policy_epoch":7,"status":"active",
  "grant_snapshot":{"agent_id":"agent_recording","about_entity_ids":["entity_self"],
    "domains":["health.weight","food","hydration"],
    "actions":["context.read","memory.search","evidence.read","facts.read"],
    "projection":{"raw_source":false,"field_paths":["health.weight.value","health.weight.unit"]},
    "expires_at":"2026-11-26T00:00:00.000Z","registered_consumer_profiles":["full_lifecycle"]}
}
```

```json
{
  "operation_id":"mop_access_8","grant_id":"grant_recording_1","policy_epoch":8,
  "status":"active","local_enforced":true,
  "consumer_cleanup":{"status":"pending"},"write_token":"wt_access_8"
}
```

新建/扩权在主库授权事务成功后生效。撤权/缩窄在返回200 applied前必须完成独立control ledger的durable intent与主库live grant gate、cache/bundle失效代际、变更Outbox，两侧可用同一operation核对。ledger成功而主库失败时保留pending并保守阻止旧授权，返回503及operation_id等待恢复，不声称全部回滚；恢复旧数据库前必须先重放独立ledger，不能让备份中的active grant复活。

旧grant token在之后读取被拒，已登记宿主凭独立service-client cleanup-only身份继续ack/reset。外部产品撤销授权但尚未调用此接口时不具备跨系统即时保证，必须使用同步撤权流程或宿主fence。专属错误 `409 POLICY_EPOCH_STALE / GRANT_ID_REUSE_DENIED`、`403 ISSUER_BINDING_MISMATCH`、`422 GRANT_SNAPSHOT_INVALID`。删除grant不可只清内存缓存，服务重启必须仍然拒绝旧授权。grant.valid_time_range始终按事实发生/有效时间约束，不随caller选择recorded_at而改变，防止借补记时间绕过授权窗口。

### 15.3 控制面初始化清单

V1不建设通用授权/连接器管理产品，部署时必须形成可审计初始化清单：issuer ID/公钥与tenant-owner绑定；grant签发方；registered stream的stream_id、system_id、起始seq、owner绑定、允许事件类型、导入凭证；领域schema/版本/字段投影；Agent允许的caller type、action、consumer能力；删除保留期与防复活tombstone策略。任何动态修改必须走受鉴权控制面并产出配置revision，模型无修改入口。未注册流不能通过sources请求临时创建。

## 16 MCP、Hook、插件与通用Agent协议

### 16.1 MCP适配

远程MCP暴露 `/mcp` 的Streamable HTTP；本地stdio是薄桥，将环境提供的受保护凭证送至HTTPS后端，不在提示词或参数中泄漏。实现按官方协议修订声明兼容矩阵，参考 [MCP 2026-07-28 transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)、[authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) 与 [tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)。不把旧握手顺序当作所有宿主的唯一模式。

远程HTTP授权按MCP规范对resource/audience、token及授权服务器执行校验；服务内部受信API凭证是独立渠道，不能宣称它替代面向任意第三方MCP客户端的标准授权流程。stdio桥接的本地凭证由宿主/环境管理。tool annotations仅是提示，不构成访问授权或用户确认依据。

| MCP工具 | HTTP映射 | 模型可见参数与结果约束 |
|---|---|---|
| `memory.prepare_context` | context:prepare | purpose、当前cue、选定主体、预算；session/turn/preparation_revision/read_after由代理补齐；full adapter优先内部预取，此工具用于兼容或补查 |
| `memory.search` | search | query、时间/领域筛选、limit；授权范围只能缩小 |
| `memory.get_evidence` | evidence:batchGet | 允许的evidence refs和projection；raw无权限则拒绝，不自动扩大 |
| `memory.query_facts` | facts:query | 注册schema的过滤/字段；不能传SQL、聚合表达式或任意join |
| `memory.remember` | memories:remember | 内容、kind、可见来源引用；稳定ID/幂等key由工具宿主从tool_call_id派生并持久化；authority/凭证隐藏 |
| `memory.revise` | memories/{id}:revise | 目标引用、期望version、revision_kind及替代内容；不能更正正式产品记录 |
| `memory.set_usage_policy` | forget非破坏模式 | 明确target refs及mode；来源lineage解析由可信代理完成；默认无erase |

MCP工具输入schema必须是对应HTTP schema的受限投影，不能暴露tenant、owner、grant、凭证、namespace、source_attestation、authority_kind、consumer_context、上游水位声明、消费者ack或control-plane接口。代理从真实本轮意图补purpose和身份；模型建议的query不授权改变用途限制。full工具代理保留usage_bundle并登记工具历史依赖；如果宿主无法提供，则声明tool_only或禁用相应能力，不能把字段交给模型自由填写。

工具成功返回 `structuredContent` 的同一业务JSON，并在协议需要时提供对应可读content。业务失败使用工具结果 `isError=true` 与结构化error.code；传输/协议错误和业务错误分开。可读文本不得说“记录成功”而结构化结果只是accepted。HTTP 200里有逐项失败时MCP结果须保留每项status，不能吞掉失败；`remember`文本明确“记忆写入完成，未提交产品条目”。

### 16.2 Hook/插件生命周期

| 生命周期钩子 | 必须执行的动作 | 失败行为 |
|---|---|---|
| `onSessionStart` | discover能力、建立授权、登记consumer、恢复操作与工具回执，记录实际能力等级 | 无强生命周期能力则声明tool_only_best_effort |
| `beforeTurn` | 接收稳定turn/operation身份，检查pending mutation fence；需要历史/模型理解时prepare，确定性无历史路径持久skip | 检索不可用可进入不使用历史的安全路径；不得伪称没有历史 |
| `beforeModelStep` | 检查租约、消费失效、validate待注入bundle；已失效历史从模型上下文清除并重建 | 无法安全清除则终止/重建session；不得仅加一句“忽略上面的旧值”就声称遗忘完成 |
| `afterToolResult` | 先持久工具回执；records提交回执交产品outbox/可信镜像；需要本次历史时携带barrier刷新prepare | 不重复执行records工具来补一次模型回复 |
| `beforeResponse` | 对使用历史的回应再次验证bundle/权限；产品保存文案只取records回执 | 失效则重生成或去掉相关历史；与记录提交状态分别返回 |
| `onMemoryChange` | 先BLOCK受影响包，清缓存/会话，按连续seq ack | ack失败持久重试，不恢复被撤回包 |
| `onSessionResume` | 租约/游标/授权复核，重建上下文，不盲复用磁盘中的旧prompt | 租约到期转REVALIDATION_REQUIRED |

保存助手完整回复、分析卡片、检索结果或当前上下文，不属于默认记忆摄取。可显式写agent_note但保留agent_inferred与来源，不把模型转述重复算作用户证据。其他Agent可完全不接产品Records：它仍可记忆笔记并搜索，但其成功回执只具有MemoryService语义。

### 16.3 两类接入验收

`full_lifecycle` 是宿主保证：每轮context决策及需要时首轮预取、step前有效性门、工具回执持久化、明确写入责任、全部记忆读取追踪、变更消费、原消息抑制及清理ack；适合本通用记录Agent。HTTP+Hook/插件/SDK可实现；同时提供MCP补查不改变该等级。

`tool_only_best_effort` 只保证每次工具调用的服务端授权/版本正确；不保证模型每轮查记忆、不保证所有用户输入被摄取、不保证撤销已经注入的prompt、不保证外部Agent本地磁盘清理。文档/产品必须显示此差异。此等级可以正常读写被授权记忆，但不能纳入“所有消费者已忘记”的强验收结果。

## 18 持久聊天任务控制扩展

启用本扩展时实现`POST /v1/history:run`及`POST /v1/history-runs/{history_run_id}:cancel`，字段、权限、默认值、模式约束和回执以[06§8](06-history-ingestion-and-repair.md)为权威定义，不在本册复制第二份参数表。两者遵守本文Idempotency-Key、授权、JSON字节限制和错误信封；GET operations支持operation_kind=history_run和分阶段覆盖/预算进度，不返回原聊天正文。

capabilities按§15.1分别声明实际mode、repair_kind及自动化能力，不支持的合法enum仍返回422 UNSUPPORTED_CAPABILITY。history:run必须配套取消、可靠原删除控制及当前性门禁；手工生产导入同样持续跟随源删除，不能只启用抽取脚本就声明此扩展完整。A首发不要求这些控制端点；B只针对有可信计划的接入后会话，不自动附带接入前bootstrap、自动巡检或reextract。控制动作history.run/history.backfill/history.reextract仅授予可信宿主/受控运维，不在默认MCP模型工具中暴露；管理员操作身份也不能替代owner数据授权。

扩展错误包含409 ORIGIN_ALREADY_BOUND/ORIGIN_BINDING_CONFLICT/STALE_ORIGIN_REVISION/ORIGIN_REVISION_CONFLICT/SOURCE_MUTATION_UNSUPPORTED；不可见绑定仍统一404。run中的identity_unresolved、budget_not_configured、source_unavailable、continuation_required等属于可查询阶段/缺口，不伪装成已完成历史覆盖。调用未启用扩展返回422 UNSUPPORTED_CAPABILITY。

取消回执只证明cancel_requested持久化，run/lease epoch拦截后续owned动作；在飞动作可能完成，不能回滚已接收来源或误杀复用live job。收费调用覆盖embedding/抽取/摘要，先记invocation/attempt及预算，未知执行结果不得因续跑自动重发；不承诺provider计费exactly-once。状态及恢复以03§5.2.1、06§8为准。

## 17 开发阶段的合同文件交付

本文件给出V1可开发协议，不要求本轮编写实现。开发开工时将上述已明确字段转成版本化JSON Schema/请求响应样例，按01的冻结注册表落成首批领域schema，生成客户端类型；这是机械化交付，不是重新决定公共语义。保持本合同为语义基准，不能把生成schema替代权限、版本、失效和恢复测试。

接口验收至少包括：未知字段/字节上限；model authority升级拒绝；跨主体与混合原文投影；同key同hash/不同hash；30天后稳定身份重试；source/memory CAS；乱序import连续水位；read_after未满足；更正后旧搜索/事实/摘要排除；prepare固定bundle与撤回优先；MCP结构化业务错误；cursor断档；消费者先清理后ack；grant撤销重启后仍有效；产品Records保存成功而Memory失败可恢复。具体用例与阈值见 [04](04-evaluation-and-acceptance.md)。
