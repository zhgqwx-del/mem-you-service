# Memory D1 首个来源写入与恢复切片规格

本文件末尾的 AC08 产品侧补充定义 RecordService 自己的行为，引用既有 Memory 授权合同。

本规格范围已确认并通过本地隔离验收。现行 [Memory V1.2 修订 2](../../docs/spec-v1/README.md)提供权威字段、错误和生命周期语义。本切片使用合成的本人饮水来验证选中的 D1 子集。

## 需求

### REQ-MEM-001 可信调用与可见范围

由认证得到 tenant、owner、caller、grant 和当前策略代际，校验已登记的来源、动作、主体、领域和流。只在已认证且授权的来源连接上接受相应权威级别。无权观察的对象与不存在使用同一外部结果，版本、正文和存在性均按授权投影输出。 [02 §1.1](../../docs/spec-v1/02-api-contract.md#11-可信身份与调用者)

### REQ-MEM-002 同步来源与可重放操作

通过 `POST /v1/sources:upsert` 的 `user_input + sync` 接收获授权的合成用户输入。持久保存稳定 source/group、不可变修订、原确认标识以及当前头。新建使用 `expected_source_version=0`，首次版本为 1。重试使用同一个请求身份，同键异负载或同修订标识异内容返回合同规定的冲突，受控 CAS 更新后旧版本不作为当前证据。原操作回执可由 `GET /v1/operations/{operation_id}` 按原授权范围查回。 [02 §2.3](../../docs/spec-v1/02-api-contract.md#23-幂等与版本) · [来源镜像](../../docs/spec-v1/02-api-contract.md#3-来源镜像post-v1sourcesupsert)

### REQ-MEM-003 受信正式条目有序应用

假 RecordService 已提交的完整快照通过唯一注册流写 `external_record + ordered_import`。相同事件复用 `stream_id/stream_seq/event_id` 及载荷，得到同一个操作。inbox 持久接收后可返回 `202 accepted`。只有连续应用才得到 `applied`、`import_outcome=source_applied` 及可核对的来源版本。序号或事件身份冲突时持久隔离该流并保留连续水位。 [00 §2.2](../../docs/spec-v1/00-boundaries-and-invariants.md#22-recordservice的outbox与完成阶段) · [01 §7.2](../../docs/spec-v1/01-data-model.md#72-external_stream--external_delivery不拿最大值当完成水位)

### REQ-MEM-004 授权取证与连续读屏障

使用 `POST /v1/evidence:batchGet` 按明确的 source/version 查询授权的当前结构化投影，并核对全部指定的写入令牌、外部流屏障和所需来源。读不到连续水位时按合同返回 `503/504`，响应不携带旧正文。正式来源与原输入通过同一来源组、已验证的精确引用或可补齐的待验证引用关联。 [02 §2.4](../../docs/spec-v1/02-api-contract.md#24-写回执与新鲜度) · [精确取证](../../docs/spec-v1/02-api-contract.md#8-精确取证post-v1evidencebatchget)

### REQ-MEM-005 崩溃恢复与有限能力

重启服务和导入执行器后可找回原操作、inbox、连续水位及已应用修订。事务到达前、接收后响应前、应用事务前后均沿原身份恢复。能力发现如实声明已启用功能。本切片采用隔离合成数据和有限取证，独立控制账本和完整宿主消费门禁随相应阶段交付。 [操作查询](../../docs/spec-v1/02-api-contract.md#11-操作查询get-v1operationsoperation_id) · [04 §9](../../docs/spec-v1/04-evaluation-and-acceptance.md#9-交付顺序与责任)

## 验收场景

### AC-MEM-001 凭证、授权与可见性

关联 REQ-MEM-001。缺证、旧策略、跨 owner、跨领域、未注册流和伪造正式来源分别得到合同错误，无写入，响应中无未授权内容、版本或对象存在性。选测 C08、C09，关联 Mono AC08。

### AC-MEM-002 同步来源的写入、重送与 CAS

关联 REQ-MEM-002。写入本人输入后使用同键同负载重放，只形成一个首版。换负载、换修订正文或并发用同一个期望版本时按对应冲突拒绝。只有正确的期望版本成功推进头。选测 C01、C02，source CAS 与完整 D1 的 C03 memory CAS 分别取证。

### AC-MEM-003 正式条目接收、重投与应用

关联 REQ-MEM-003。用假 RecordService 的两笔饮水提交生成 seq 11 和 12。先送 12 并重放。查询到同一个 accepted 操作、连续水位仍为 10，且没有已应用来源。补 11 后依序应用到 12，按两个原操作查回来源回执。正式条目数仍由产品侧确认。选测 C04、C19，关联 Mono AC05、AC06。

### AC-MEM-004 缺序屏障及内容冲突

关联 REQ-MEM-003 和 REQ-MEM-004。缺 11 时通过 `through_seq=12` 查询，得到合同错误且无旧正文。独立故障用例提交同序号异内容或同事件换序号，返回冲突，重启后仍保留隔离状态，连续水位不越过冲突。选测 C04、C05、C19，关联 Mono AC06。

### AC-MEM-005 断线与进程重启

关联 REQ-MEM-002、REQ-MEM-003 和 REQ-MEM-005。分别在落库前、inbox 提交后响应前、应用提交后核对前注入断线或终止。原请求身份恢复出唯一操作和来源结果。产品抢先保存时仍可查到原回执，投递端继续使用同一 Outbox 事件。选测 C01、C04、C19 及 source 恢复，关联 Mono AC05、AC09。

### AC-MEM-006 同组来源与有效投影

关联 REQ-MEM-001 和 REQ-MEM-004。分别验证原输入先到和正式条目先到，已确认引用只在相同 owner/group 和有效修订内关联。待验证引用就绪前无正文，未授权和过期版本按合同处理。选测 C08、C10 和原断言关联，关联 Mono AC08。启用原生聊天能力所需的来源删除控制另按 06 及 D3 验证。

### AC-MEM-007 输入边界与能力发现

关联 REQ-MEM-001 和 REQ-MEM-005。检查未知字段、缺幂等键、超过字节限制、非法单位或时区。形状或 schema 失败时整次拒绝。能力发现只列已启用能力，访问已定义但未启用的能力使用合同错误。选测 C09、C10。

## AC08 产品侧补充

### REQ-RECORD-801 可信身份派生

产品侧验证受信用户访问令牌，用已验证身份查有效账号映射并派生 tenant、owner 和本人主体。请求参数和模型输出无法授予或扩大权限。

### REQ-RECORD-802 本人饮水业务授权

待补、操作、回执及条目都按照当前账号范围读写。跨用户和不存在的对象对调用方不可区分。越权请求不改动业务存储或 Outbox。

### REQ-RECORD-803 正式保存与 Memory grant

产品事务负责保存和 Outbox。只有服务端注册的有序导入身份可提交正式来源镜像。Memory 独立授权操作查询和证据投影。

### REQ-RECORD-804 自动化交付检查

对身份映射和授权规则运行单元测试，对两个账号运行真实 HTTP/PostgreSQL 契约及跨服务授权测试。CI 必跑检查绑定待合入版本及用例结果。

### AC-RECORD-801 令牌和映射

关联 REQ-RECORD-801，映射 Mono AC08。有效签名与启用映射成功。缺凭证、坏签名、错误 issuer 或 audience、过期和未生效凭证返回 401。已验签但账号未映射或停用返回 403。拒绝后无业务副作用。

### AC-RECORD-802 双用户查询隔离

关联 REQ-RECORD-801、REQ-RECORD-802，映射 Mono AC08。两人各自创建待补及正式记录，能查回各自原文、操作、回执和条目。用同租户对方的已知对象 ID 或原操作键查询，与查询不存在的对象返回同一 404。响应不透露正文、版本、引用或计数。

### AC-RECORD-803 越权提交与幂等隔离

关联 REQ-RECORD-802、REQ-RECORD-803，映射 Mono AC08，回归 AC03、AC04 和 AC09。B 的凭证冒带 A 的身份、对象 ID、grant 或正式来源声明时拒绝，产品条目、待补、回执、Outbox 及流序号均无变化。两人在各自权限范围使用同一个客户端键时有各自的结果，原键同负载重放不新增事件。

### AC-RECORD-804 跨服务授权

关联 REQ-RECORD-803，映射 Mono AC08，并复验 AC-MEM-001、AC-MEM-006 的适用边界。A 的正式提交事件由真实 RecordService 生成，通过登记流应用到 Memory。各侧凭证独立授权。B 不能读取 A 的来源或 Memory 操作，产品令牌直连、模型调用者声称正式来源和错 owner/流的导入均被拒绝，无新增来源或 inbox 事件。

### AC-RECORD-805 必跑检查

关联 REQ-RECORD-804。PR 候选的类型检查、单元测试和 HTTP 授权契约为必需检查。核心场景缺失、跳过或断言失败均使检查失败。交付证据包括 CI run、候选 SHA、独立的单元及 HTTP 结果和产品与 Memory 各自的拒绝证据。
