# 持久聊天摄取与记忆补偿

版本：设计V1.2 修订2，2026年10月28日。本文是启用持久聊天连接器时的开发合同，与00–04共同使用；不是已经实现的功能。05及07是审查记录，不承担接口定义。

**持久聊天是可按需重新取证的来源库；记忆是其有版本、有使用限制的派生结果。** 应支持从聊天补采遗漏来源、抽取漏记内容及重算自动记忆，但不把每条聊天都变成事实，也不靠每日全库“做梦”代替可靠的摄取和补偿。

## 1 边界与依据

| 组件 | 职责 |
|---|---|
| Agent/产品持久聊天库 | 保存真实session/turn/item、原角色、内容、状态、生命周期与授权；仍拥有聊天真相 |
| Chat History Adapter | 产品/Agent侧只读来源适配器，提供受授权、有界、可核对的消息与删除控制；知道MySQL或其他聊天格式 |
| MemoryService及其worker | 管理摄取任务、来源身份绑定、幂等/版本、派生发布与失效；只通过注册Adapter取资料，不自由连接业务库或执行SQL |
| 主Agent | 继续处理当前输入与业务工具；可由可信宿主排队补偿，不等待整段历史抽取后才回复 |

Adapter是逻辑边界，可在agent-service同一部署内实现受保护模块，不要求增加独立微服务。MemoryService可部署专用worker调用注册Adapter；DB连接与源表知识留在Adapter一侧，不通过共享业务表集成。连接器地址/凭证引用由控制面注册，任务参数和模型都不能传任意URL、SQL、库名或密钥。

固定源码核查见[聊天存储审计](../../research/chat-storage-audit.md)：agent-service提供MySQL分支和sessions/turns/items/events；userMessage.content与effectiveContent分开，压缩不会自动删掉原items。**当前没有可直接复用的完整聊天记忆feed**；items.seq不随body更新，不能当全量CDC。报告描述源码，不证明运行实例配置或数据库状态。

Hermes/OpenClaw的机制及版本边界见[专项研究](../../research/offline-memory-mechanisms.md)。借鉴持久证据、后台候选和发布前复核；不继承其本地文件、技能管理或best-effort线程作为本服务可靠性承诺。

## 2 四类后台任务

| mode | 触发 | 处理范围 | 不做什么 |
|---|---|---|---|
| catch_up | 在线来源upsert未完成、turn终态提示、注册会话巡检 | 已授权会话中尚未接受的稳定用户消息；已接受来源直接复用 | 不重跑已成功产品工具，不补造正式记录 |
| backfill | 用户启用历史记忆/明确选定历史，或受其授权的运维请求 | 固定会话/时间范围的保留历史，先预览再应用 | 不默认全库扫描、不读取已删除/未授权归档 |
| repair | 来源/派生缺口、任务失败、覆盖对账、受控缺口提示 | missing_source、missing_derivation、stale_projection三类 | 检索正常为空本身不代表漏处理，不因此无限补扫 |
| reextract | extractor/schema/prompt升级、确认自动抽取错误 | 已接受的精确source版本，必要时先核源当前性 | 不换source ID，不重写原聊天，不覆盖用户显式修订 |

“巩固/反思”是可选的派生策略，基于已接受的有来源材料运行，可生成候选关联或summary。它不新增第五条任意写入通道；自动summary仍按首发扩展能力管理，不能因取名dream就跳过来源和预算校验。

基础失败补采复用已有可靠重试队列，是full接入的数据写入责任之一。历史发现、批量backfill及自动reextract按capabilities单独启用；未安装合格连接器时保持unsupported，不假称历史已经全部记住。

### 2.1 首发与后置的唯一切片

| 切片 | 必须交付 | 明确不要求 |
|---|---|---|
| A 首发 | 可靠输入journal及source plan、接入后稳定origin、同身份实时失败重送、已计划/已摄取会话持续删除/撤权控制、基础派生重试/人工保护、业务更正/删除/恢复及P0 | 不依赖history:run、MySQL全历史扫描、自动巡检或新调度平台 |
| B 可选手工MySQL接入 | 只处理已登记且已有source plan的接入后会话；有界catch_up/backfill及已有source的missing_derivation/stale_projection修复；预览、续跑/取消、预算、当前性及持续原删除控制 | 不自动发现新会话，不承诺接入前历史、任意原文编辑或全库CDC |
| C 后置 | 接入前历史bootstrap、自动发现/巡检、context主动repair、pipeline reextract/巩固、精细证据单元槽、多源汇总、可变消息修订 | 单独声明支持的mode/repair_kind并增量验收，不能从支持一个mode推定全部支持 |

下面列四种mode是完整协议目录，首发不要求全部实现。A的可靠重送由journal驱动，不需要给模型或运维开放history API。B的生产可召回导入必须持续跟随原删除/撤权；没有该能力时只允许preview或隔离试验，手工执行不构成例外。验收按04的能力适用矩阵执行。

## 3 来源身份与实时去重

### 3.1 同一原消息只形成同一来源

新增可信摄取字段`origin_ref={source_system_id,conversation_id,item_id,origin_revision}`，本版仅用于已注册聊天来源user_input的sync写入：

| 字段 | 类型与约束 |
|---|---|
| source_system_id | ID，绑定注册部署/源系统命名空间，不能由模型自由声明 |
| conversation_id | ID，源会话的稳定ID，不是MemoryService的consumer session ID |
| item_id | ID，原用户消息稳定ID；steer补充消息具有独立item ID |
| origin_revision | 正整数Version，连接器按其已注册修订合同确认；首个MySQL Adapter只支持1及原文fingerprint不变 |

稳定唯一键为`(tenant,owner,source_system_id,conversation_id,item_id)`，不含revision、run ID、pipeline或正文hash。服务将其绑定已有source_id/source_group_id；实时、补采、回填和重抽必须复用绑定。聊天origin不是external_record_ref，不能因此成为external_committed。一次用户原消息及其多条正式回执继续按原source_group关联。

启用补采前，在线MemoryAdapter必须携带同一origin_ref，或已安装可核对的旧source/group别名映射。无法证明旧live source与聊天item身份相同的范围，先报告identity_unresolved，不按文本相似度自动合并，也不批量新建重复源。不能在尚无runtime item ID时随便构造一个ID；可先可靠排队，ID就绪后绑定。

即使live upsert从未applied，也不能在扫描侧随机另建source/group。可信宿主在可靠输入journal中预先保存planned source_id/source_group_id及其runtime origin关联；如果正式回执先镜像，external_record同流事件可携带`input_origin_binding={origin_ref,source_id}`，source_group取事件外层，用于预约这一原计划绑定。预约不创建用户事实，只保证后到原消息命中已建立的组/片段更正门禁。同origin已有不同计划绑定则409 ORIGIN_BINDING_CONFLICT并对账，不能任选一份。

origin_binding状态reserved/materialized/blocked分别表示身份已预约、来源已接受、已被当前门禁阻断。ORIGIN_ALREADY_BOUND可指预约，回canonical source_version=null及binding_state=reserved；连接器在同一计划身份创建源，不能认为null表示可另建组。没有可靠journal或映射时identity_unresolved并留gap，宁可暂不补入，不以近似文本猜测。

来源已绑定其他source ID时，sources:upsert返回409 ORIGIN_ALREADY_BOUND，并在当前权限允许时给canonical source/group/version。连接器只读核对并复用已有回执，不再创建另一份来源；不把这个已知身份冲突当成未知写入换key重试。不可见绑定仍统一404，不泄漏他人ID。

### 3.1.1 create-only补采算法

首个生产补采版本的写入身份注册为create_only_chat_ingest：仅能创建尚未materialized的原消息，不能以最新expected_source_version更新已存在正文或确认字段。planned source/group、规范化输入及其hash、first_write key/caller_revision_key（或可靠重建引用）必须先持久到宿主journal；实时重送使用相同计划，不以扫描结果重新猜原请求。

服务对origin唯一根串行处理并核scope gate：未存在时按已核对source plan在同一事务绑定并创建source；reserved时只允许物化原计划source/group。已有materialized来源则只读核当前生命周期、原修订和fingerprint，符合时记already_present，不再upsert或覆盖较新的metadata。source已撤回、擦除、隔离或原修订不符时不能作为可用already_present，不以“去重成功”解除门禁。

live与补采同时创建时，失败方遇VERSION_CONFLICT/ORIGIN_ALREADY_BOUND后只读解析origin和当前源，确认同一计划及原文再复用；不得把latest source_version填回旧payload重写。已存在来源只补缺失的派生作业。登记为create-only的调用者由服务拒绝普通替换写，不能仅依赖worker自觉。普通用户更正与可信元数据修订仍走独立授权、CAS及明确新依据，不归补采重试。

### 3.1.2 接入前历史

控制面记录source_system身份接入边界及source plan覆盖范围，判断依据是可信journal/预约清单，不仅是消息时间戳。接入前且无journal计划的旧消息不能走普通B导入；先返回identity_unresolved/gap。后置bootstrap须固定历史清单，核对已有Memory来源、正式镜像关联和更正/删除门禁，再持久创建唯一origin计划；没有旧来源的证明也由受控清单提供，不能按近似正文或随机新组推定。该bootstrap未声明支持时，对相应旧范围保持不支持，不宣称历史已覆盖。

### 3.2 原修订与Memory修订分开

origin_revision属于原消息，source_version仍由MemoryService分配。对可变聊天源，连接器必须提供受信单调修订及发布前当前性核验，旧origin_revision不能拿最新expected_source_version覆盖新正文。服务拒绝409 STALE_ORIGIN_REVISION；同原修订异原文fingerprint返回409 ORIGIN_REVISION_CONFLICT并隔离。source CAS仍独立执行，不能把上游版本直接当source_version。

没有原生修订合同的适配器不得用hash或updated_at自行宣称更高修订。首个MySQL Adapter按“稳定userMessage原话append-only”接入：首次记录fingerprint，重扫同ID同原文复用；同ID原文变化即SOURCE_MUTATION_UNSUPPORTED，先停止该来源当前使用并失效相关派生，再等待权威对账。它支持检测和阻断，**不声称支持任意消息编辑**。今后启用可变消息须注册新适配器合同并通过修订竞态验收。

源适配器对同一origin的读取/发布串行化或提供等价有版本快照；临发布重新核对当前原文和生命周期。不能把早先缓存页在另一次源更新之后重新编号为“最新”。原系统新变化尚未通知/核验时仍遵守B16的保证起点，不承诺跨库原子性。

首版fingerprint按适配器冻结的原文投影算法生成（原text部件顺序、换行及媒体引用处理规则写入contract_revision），实时与离线必须相同；不能对effectiveContent、展示摘要或不同Unicode规范化文本取hash后声称是同一原文。算法升级先对账身份，不自动把投影差异当用户改话。

原始content指纹只用于完整性，不是匿名化；recorded_at保留原接收时间，imported_at/verified_at另存。新的模型或任务不改变事件发生时间，不把十年前原话写成今天发生。

## 4 什么可以抽取

| 原材料 | 默认处理 |
|---|---|
| completed的真实userMessage.content | 有可信用户消息证明后为user_reported；仍保留问句、否定、第三方、愿望和不确定性 |
| 上游ASR/OCR文本及确认版本 | 按原有candidate/explicit_user和媒体合同处理，不从音频/图片引用自行运行识别 |
| assistant、reasoning、systemNotice、技能/记忆注入、compaction摘要 | 默认ingestible=false，不成为新的用户事实 |
| tool args、工具建议、助手“已保存” | 不构成产品成功证据 |
| 可校验的正式工具回执 | 交既有RecordService连接器按同一有序流镜像，不另由聊天扫描晋升committed |

允许读取同一授权会话中有界相邻消息解释“还是昨天那个”“对，改100”等指代，但旁文不是独立事实证据。确需旁文才能解释的用户确认，须保留对应上下文依赖与原确认来源；无法回溯时只生成unresolved/candidate，不用assistant自述补齐事实。被召回内容、自动摘要和已生成记忆不得反过来充当新的独立用户披露。

一个owner不代表所有消息都关于self。未知/混合主体可保留原来源，fact_evidence须解析到明确对象；窄grant不能拿整段会话跨域/跨宝宝推断。首发无法可靠安全投影时按整源权限拒返，不因离线任务扩大权限。

首个Adapter只接受≤16KiB的可摄取文本（与sources限额一致）。超限或只有未识别媒体的消息记录quarantined/gap并继续其他独立项，不截断后伪称完整。稳定分段属于后续适配能力，不能临时生成随机多份source。

## 5 Adapter读取与覆盖合同

这是需要新增的宿主接口，不宣称现有agent-runner HTTP已实现。可用内部RPC/受保护HTTP；不向模型暴露。A只需要原生身份及read_control/ack_control生命周期子集，B才增加扫描/取证方法；控制消息及回执字段统一见02§3.1。

| 操作 | 必需输入/输出语义 |
|---|---|
| open_scan | 输入绑定owner、授权scope及模式；输出scan_id、contract_revision、opaque snapshot/cutoff、覆盖类型snapshot或bounded_reconciliation、生命周期检查点 |
| read_page | scan_id＋opaque cursor＋limit（默认100，1–200）；输出稳定消息身份、角色/状态、原content及指纹、原记录时刻、session/turn引用、当前生命周期证明、next_cursor/has_more |
| verify_current | origin refs（最多32）＋原修订/指纹；输出current/changed/deleted/not_visible/unavailable及权威控制位置，不回传无权限正文 |
| read_control | 独立消费者checkpoint，至少一次交付源删除/撤权及scope控制事件；返回有序或可核对幂等事件及当前checkpoint |
| ack_control | 只有Memory本地失效applied后确认该控制事件；游标不能在失效前推进 |

配置声明必须包括：源身份与owner映射、角色allowlist、archive策略、保留边界、分页完备性、修订模型append_only/monotonic_revision、删除单位session/message、控制事件重放/ACK及当前性可验证方法。默认不扫归档；明确backfill授权后才可纳入仍保留且可访问的归档。archive不是erase，compaction不是新事实。

Adapter不能提供一致性快照时只能标bounded_reconciliation并披露已覆盖会话/终态turn与待核对集合，不能说全库snapshot_complete。分页须有稳定不漏项的完整游标或冻结manifest；不能只用一个非唯一seq分页，亦不能以最新5000条/最近N个turn代表全部历史。

**三种进度分开：** discovery/scan cursor是上游范围发现位置；source_applied是本服务已接受或有持久排除结论的位置；derivation coverage/index状态是抽取及检索可用程度。扫描完不表示已提炼，模型调用完不表示结果已发布。

聊天游标不是RecordService的external_barrier。聊天source以sync应用并产生现有write_token；需要读到某条已接受消息可用required_sources。想确认“到某次聊天扫描为止全部已处理”，应看history run覆盖回执，不伪造业务stream seq。

游标仅在该页每项已applied、已存在、被现行策略持久排除或已进入可定位的quarantine清单后推进；存在quarantine时整run不能标无缺口complete。抽取失败不退回已接受的source进度，另留derivation job修复。毒项不得无记录跳过，亦不无限卡住无关会话。

## 6 当前MySQL Adapter的最小版本

1. 从已登记且获授权的session开始；会话自动发现须产品登记或完整有界核对，不把listSessions的ID分页称为最近变更feed。
2. 按turn分页核对，首版扫描终态`completed/interrupted/failed`中的completed userMessage.content，包含同turn的steer消息；这只是离线简化，不改变在线原消息已提交的身份。
3. 发现inProgress时持久加入pending_turns，后续即使已不在最近列表仍核对至终态；不能前移max turn ID便忘掉旧长跑turn。
4. 重扫已见终态消息时核fingerprint和生命周期；不依赖items.seq发现body变化，不读取effectiveContent或projectFromSeq后模型窗口。无法安全分页时由宿主新增受保护导出投影，或缩小到可证明完整的单turn范围；终态本身不证明其items已读完整，超限仍报gap，不在Memory自由执行SQL补洞。
5. 当前删除单位为session；terminal session/deleted及deletionGeneration要进入独立Memory订阅/ACK，不能复用已被另一dispatcher ACK的outbox游标。尚无单条消息删除合同就声明unsupported。
6. 凡历史来源进入生产可召回存储，手工与自动都先具备可靠持续删除/撤权控制或等价门禁。只在抽取时检查不足以撤掉既有记忆；断流则暂停相关范围读取/发布直至对账。尚不具备时只能preview或隔离试验，不能先手工导入再长期不跟删除。

普通GET 404不能区分源删除、越权与暂时不可见：先标source_unavailable并停止使用，不声称已物理擦除；权威删除/撤权控制再决定清理。原生session删除是普通用户不可恢复的终态，收到其权威回执后按上游删除执行来源失效与erase，不等物理purge或宽限期结束。正式业务条目是否删除仍由产品工具决定。

## 7 记忆补偿与发布规则

### 7.1 发布自动结果

复用derivation_job及slot，不新增“离线记忆库”。作业绑定精确source版本、origin指纹、适配器/策略/模型/schema修订、当前授权及erase代际；发布前再次核源当前性和本地所有门禁。来源不可验证、deleted、historical_only或grant收缩时不发布，用superseded/blocked等已有状态及原因解释。

同slot同输入版本的重复运行只产生一个当前结果。pipeline升级生成可追溯自动修订，不复制来源，不调用records.*。原事实确实变化时先有新的可信来源/修订；模型“觉得应该改”只能提候选，不能改写用户原话或正式条目。

### 7.1.1 显式记忆与自动抽取共用槽

首发coarse slot固定为(owner,source_lineage,memory_kind,schema_key,about_entity)，source_lineage为稳定source ID，纯text的schema_key归memory.statement；槽不含memory_id、source_version、模型、pipeline、输出数组序号或正文hash。显式remember与自动发布核同一槽及同一事务门禁。有多个支持源时显式写保护所有相关槽，不因换source组合绕开。

显式写另设(source_lineage,kind,subject)的schema通配保护，避免live纯text与离线typed投影在不同schema重复。已有该保护范围的当前条目且不是同一身份重试时，新增remember返回409 MEMORY_SLOT_CONFLICT及有权引用，复用或revise既有条目；不靠模型文本相似度合并。manual先到则auto为manual_override，auto先到则manual新建被拒并可修订该头；并发只能一方先发布。

首发不为单条raw原话的多个同schema/主体事件建立通用匹配系统：保留完整source，可用一条忠实复合statement或明确gap；不按模型数组顺序造新事件ID。产品多事件仍由RecordService分别保存，正式镜像各有稳定外部身份。细粒度evidence_unit与跨来源consolidation后置；无source的agent_note仍按会话出处和现有身份管理，不宣称通用语义去重。

作业同时固定slot的预期头版本及目标pipeline代次；新策略已发布后，旧pipeline的晚到完成不能重新读取最新memory_version再覆盖，必须superseded或显式重排到当前策略。

服务内部持久`write_policy=auto_managed/user_managed`：自动抽取条目默认auto_managed，用户显式记忆及显式修订为user_managed；用户修订会保护对应自动slot。后台重抽只可CAS发布auto_managed头，不能覆盖或另起同slot重复记忆绕过user_managed。冲突记录manual_override，保留为待处理差异；恢复自动管理须新的明确受控决定，不因换pipeline解除。该字段由服务赋值，模型无权限修改。

user_managed只保护内容不被自动改写，不能阻止source更正、historical_only、erase或撤权使其失效。普通remember/revise请求默认user_managed；只有内部受控派生job可创建auto_managed，模型不能自报后台作业来绕过保护。

### 7.2 按需修复

| 缺口 | 修法 |
|---|---|
| missing_source：在线镜像失败或历史未补采 | 按稳定origin重新取当前原文，检查原授权/删除后upsert同一source |
| missing_derivation：源已在，worker失败/漏排 | 重排同source/version和逻辑slot，不再扫描全部聊天 |
| stale_projection：已发布字段/索引与当前source不一致 | 先阻止旧版本返回，再重建对应表示；不让后台“修复”维持旧值可见 |

context主动排队repair属于C扩展，首发不要求；未启用时只披露真实覆盖gap，由可靠重送或受控手工任务处理。启用后也不在前台同步扫MySQL/运行补偿LLM，不承诺本轮即修好，正常empty不自动触发。不同请求可去重排队提示，但独立run不自动共享/累加预算或扩大范围；只有同owner、同授权绑定和相同规范scope/pipeline/预算上下文才可共用既有作业，并分列归因。

## 8 任务控制与状态

### 8.1 端点

新增可选控制API `POST /v1/history:run`，权限history.run；backfill还需history.backfill，reextract还需history.reextract。仅trusted_adapter/operator/control_plane使用，普通model_tool无此能力；operator身份不取代owner授权。必须Idempotency-Key，仍执行02全部认证/错误/限额合同。

按capabilities.history.supported_modes及repair_kinds校验；只启用B时不接受reextract、自动触发repair或接入前bootstrap，即使enum形状合法也返回422 UNSUPPORTED_CAPABILITY。API目录不是全部mode开关。

| 字段 | 类型/默认/限制 |
|---|---|
| connector_id | ID，必填，已注册、当前授权匹配 |
| mode | catch_up/backfill/repair/reextract，必填 |
| scope | 恰好一种：`{conversation_ids:ID[]}`（1–32）或`{source_ids:ID[]}`（1–32，仅reextract或repair的missing_derivation/stale_projection）；missing_source用conversation范围。可加time_range限制原recorded_at，沿用02 TimeRange，缺省为所选范围保留窗口；不接受全库SQL/任意URL |
| repair_kind | missing_source/missing_derivation/stale_projection；仅repair必填，其他模式禁止 |
| preview | boolean；backfill/reextract默认true，catch_up/repair默认false。preview不调用LLM、不写来源/记忆/业务数据，只产有权限的范围/缺口及费用估算元信息 |
| pipeline_id | ID；reextract必填、已注册允许列表；其他模式可省略用当前发布策略，不接受模型/prompt任意文本 |
| resume_from_run_id | 可选ID；只对已停下且有续扫位置的同connector/mode/scope/pipeline/preview任务使用，须匹配父任务固定scope/cutoff并重核当前授权；不允许借续跑扩大范围 |
| max_messages | 默认200，1–1000；达到上限保存续扫位置，不能标已全覆盖 |
| max_run_seconds | 默认60，1–600；后台执行窗口，不是HTTP等待deadline；耗尽回执给continuation_required |
| llm_budget | 可省略；`{max_calls:integer,max_input_tokens:integer,max_output_tokens:integer}`，分别0–100、0–100000、0–20000，均必填；缺省或任一为0时本run禁LLM；实际取请求与部署/owner剩余额度的较小值 |

scope组合、unknown字段或模式字段错误400/422；已知未启用能力422 UNSUPPORTED_CAPABILITY；源不可变合同冲突409/422具体code；限流429。不返回任何原聊天正文，避免另开无追踪读取通路。

worker在内部摄取命令/派生job记录history_run_id及预算归因，所有本run新触发的子任务都继承授权与额度门禁，不能靠普通upsert自动排worker绕开run预算。llm_budget只约束生成/抽取/摘要调用，0时可接受原来源及确定性表示，相关生成任务标blocked/budget_not_configured；embedding使用发布配置中明确的模型/token额度并归因本run，缺配置也不调用，不能假设免费。已由其他live请求合法创建的既有job仍按原预算执行，run分列reused_existing_job，不能算本次免费产出或重复收费。

返回202 `{operation_id,history_run_id,status:"accepted",mode,preview}`；查询复用GET /v1/operations/{operation_id}，operation_kind=history_run。preview响应仅持久预览结果，不生成可隐式执行的令牌；应用需preview=false的新请求/新幂等key，并重新校验当前授权与源，预览不冻结数据访问权。

续跑采用resume_from_run_id和新的幂等key，继承服务保存的已应用页/待核对turn；同一checkpoint只允许一个持久lease推进。上游scan/cursor已过期返回409 HISTORY_CHECKPOINT_EXPIRED，不拼接为完整快照；重新授权开启有界重扫，沿origin去重。run ID变化不能解除已有derivation job的unknown_paid_call，父/子run均引用同一未决调用待核对。

`POST /v1/history-runs/{history_run_id}:cancel`权限history.run、同owner/范围，空body，须Idempotency-Key。返回200的`{operation_id,history_run_id,cancel_requested:true,status}`，status仍为running或cancelled，不新增cancel_requested这个operation枚举；已终态时返回实际status及already_terminal=true。启用history:run必须配套取消。

取消事务持久cancel_requested并推进run_epoch，是后续新action准入的线性化点。新页读取、首次source应用、新收费dispatch和新派生发布都在准入时核run取消状态、run_epoch及lease_epoch；失去租约的旧worker不得发新动作。run_owned子job继承这些条件，已有的reused_live_job不归该run取消、不能被误杀。取消前已准入/已发动作可能完成，须以journal核对；已接受来源和已发布记忆不回滚，取消后晚到owned结果不自动发布。200取消请求不证明无在飞；停止owned新准入并核对在飞完成或明确unknown后可转cancelled，未知费用/外部请求仍单列未决阶段，不能伪称已回收。

run结果元数据至少有：scan_id/contract_revision、scope_hash/cutoff、scan_coverage、source_stage/derivation_stage、scanned/applied/already_present/excluded/quarantined/failed/unknown_paid_calls数量、continuation_required、last_checkpoint_ref、pending_turn_count、job refs、预算消耗及stop_reason。counts只在当前授权scope披露，checkpoint不含原文/凭证。operation可按当前grant查询，不借preview或job访问其他用户。

GET operation把这些扩展字段放在history_progress对象，内部执行状态另放history_state（下节枚举），不改变顶层公共status；来源及派生阶段分别not_started/running/complete/partial/blocked，数量均非负整数，job refs最多32个，更多仅给有权总数及操作查询引用。checkpoint_ref是opaque string、最大2048字节，不提供原聊天正文。

### 8.2 持久对象与状态

逻辑对象可与既有任务表共用，不要求独立队列平台：

| 对象 | 必需字段 |
|---|---|
| history_connector | 注册身份、授权scope/合同修订、source_system接入边界及source plan覆盖引用、create-only写策略、读取凭证引用、immutable/revision模型、原生命周期门禁、持续删除ACK、启用状态 |
| history_run | operation/run ID、mode、preview、授权快照、固定scope/cutoff、预算、cancel_requested、run_epoch/lease_epoch、lease/attempt、阶段、计数、续扫与终止原因 |
| run动作/子job关联 | 稳定action/invocation及request hash、准入epoch与时刻、dispatch/attempt/回执及未知费用、预算归因、run_owned或reused_live_job关系；复用既有journal/job表，不另建通用编排平台 |
| history_checkpoint | connector/owner/scan范围、opaque cursor、已应用页manifest、pending_turns、独立control ACK；扫描与派生水位分开 |
| origin_binding | 稳定origin→planned source/group、reserved/materialized/blocked、原修订/指纹、授权代次/旧绑定审计、发现/核验时刻及防重导抑制；不保存第二份完整聊天 |
| origin_scope_gate | (tenant,owner,source_system_id,conversation_id)稳定范围、控制generation及operation、active/unavailable/deleted、已应用控制位置；换connector不改变拒收身份，删除覆盖未来才到达的未知item |

内部状态：queued→scanning→applying→deriving→completed；preview跳过写入/deriving。暂时依赖失败到retry_wait，权限/删除/当前性不可验证到blocked，毒项quarantined并使run completed_with_gaps，致命配置错误failed，用户取消cancelled。公共operation仍沿用accepted/running/completed/failed/cancelled，不把扫描进度包装成Memory全部applied。source_stage与derivation_stage各自not_started/running/complete/partial/blocked，preview均not_started。

窗口/条数用尽而尚有下一页时可结束本run，但必须continuation_required=true、覆盖partial；后续受控run从服务保存的checkpoint续扫并重核权限。pending_turns未收敛也保留partial。不允许只因本批请求结束就标history_complete。已接受source但派生还在队列时run保持deriving；可显式结束为completed_with_gaps且报告queued jobs，不能说记忆已发布。

仅已证明幂等的本地写/只读分页可有界重试。所有付费调用（含embedding、抽取、摘要）先持久稳定invocation/attempt、dispatch状态和预算预留；超时未知先查provider，无法核对则unknown_paid_call，不因换run/接管自动重发。可证明安全的重试也逐attempt计费，不承诺provider计费exactly-once。重启先对账source/slot、页manifest、run/lease epoch和在飞调用；取消或旧lease不得绕过准入。

## 9 删除与防复活

所有模式在读取、source接受和派生发布前检查当前grant、原source/session生命周期、Memory control ledger、source/group及origin抑制。已执行erase覆盖全部旧版本、别名及历史批次；新run/新source ID/新pipeline不能恢复。owner历史erase后，旧聊天即使从未导入也属于历史backfill，默认阻断，不能以新扫描时间当新用户披露。

上游聊天删除先传播失效并独立ACK，不能等下一次抽取才跳过；Adapter控制通道断档时暂停相应源读取/发布并对账。没有持续删除/撤权控制的连接器不得把手工或自动导入开放为生产可召回能力。

权威session删除先按`(tenant,owner,source_system_id,conversation_id)`持久记录control_generation及终态拒收门禁，并使已有关联来源/依赖失效；换connector或重置扫描不改变该稳定拒收键，所有origin首次绑定、sync和派生发布均核同一串行门禁。即使某item从未被导入、旧扫描页此前verify_current成功，删除applied后才到的首次upsert也必须拒绝，不能只枚举当时已有origin_binding。独立控制日志记录该scope，恢复旧备份先重放；控制ACK必须在scope gate与本地失效可核对后。未可判定的源暂时不可用用unavailable保守门禁，不伪造terminal删除。

memory-only erase不删MySQL原聊天/RecordService；源session删除精确清除其origin对应的user_input来源及依赖，不按共享source_group整组erase正式业务镜像。独立RecordService源仍有效时，其镜像继续按有序流应用；input_origin_binding可记录blocked元关联/审计，不能物化已删聊天或解除门禁，也不能仅因关联被删而隔离整个业务event、卡住流。其他真实身份/内容冲突仍按原合同隔离。业务条目本身删除需自己的权威事件；产品原聊天仍保留时full宿主继续执行恢复抑制。

若被Memory-only erase的正是该正式来源，后续合法有序更新沿01/02的policy_suppressed消费：无正文、无新来源修订，但在可核对控制依据及连续顺序下推进barrier。此结果与“聊天关联被删但业务镜像仍可用”分开报告；history worker不能借其判定来源已存在可读，也不能解除原抑制。

显式重新授权历史导入是独立受控流程，绑定新的授权决定、具体旧范围及策略代次，并记录覆盖的抑制例外；普通history:run(preview=false)或operator重试不构成重新授权。不修改原deleted source的生命周期，必要的新来源身份仍保留旧origin审计关联，由特权流程创建新授权代次，默认路径无复活能力。

本版不提供普通调用者解除origin抑制的API；受控再授权若后续启用，须保留稳定origin唯一根及旧绑定审计链，由特权迁移创建新授权代次/当前绑定，不能并行创建第二个同键来源或清空旧拒收凭据。原系统终态删除的聊天不属于可重新授权读取的保留历史。

取消/回滚某次backfill与隐私erase分开：默认只取消后续工作，不删已经接收的用户证据；若要撤销该批自动派生，需要按批次拥有的slot/版本做受控回退，不能删除其他run或用户已修订结果。首版不提供自动批次回滚；隐私删除使用既有forget。

## 10 验收与交付

| ID | 注入/场景 | 必须结果 |
|---|---|---|
| H01 | live＋补采＋回填同一item，含不同拟source ID | 只一个origin绑定和一份当前来源；不按文本去掉真实第二条同文消息 |
| H02 | source应用后worker退出、页ACK前断线、重复终态提示 | 续checkpoint、不重复创建来源或发布；不因接管/换run重发未知收费请求。安全重试逐次计费，毒项可定位且覆盖非complete |
| H03 | 同ID原文变化、旧扫描页在新变化后发布 | MySQL首版阻断不支持变更；可变Adapter拒旧修订，不以latest CAS覆盖新头 |
| H04 | interrupted/failed turn、steer及长跑inProgress后来终态 | 原用户消息可补采；steer不漏；旧长跑仍在pending集合，不只扫最近N条 |
| H05 | assistant声称已记、tool args、compaction摘要重复出现 | 不升级为用户/committed事实，不新增正式记录或累计；原文缺失就报gap |
| H06 | 跨owner/宝宝/域；扫描后授权撤销 | 来源范围与输出不越权；当前性失效不发布；不通过preview/计数泄漏 |
| H07 | 上游session删除、Memory erase、owner erase后重扫；旧页verify成功但删除先applied、item后首次到达 | conversation scope gate阻止未知item迟到绑定；已有记忆失效，旧源/未导入旧历史/旧job均不复活，不等物理purge |
| H08 | pipeline升级与用户显式修订并发 | auto slot CAS且保护user_managed头；只重建可管理派生，不复制来源、不调用records |
| H09 | context发现真实覆盖缺口，离线任务耗时/费用未知 | 前台有界返回gap/operation，后台受预算且未知费用不重调；正常empty不触发无限扫描 |
| H10 | 预览后删除、超max_messages/时间窗、取消/控制feed断档 | 应用重新校验；覆盖partial可续；取消不回滚成功部分；断档门禁阻止旧数据使用 |
| H11 | live源失败，正式饮水回执先镜像并更正300→100，旧原话随后首次补采 | 复用journal/input_origin_binding预约的原source/group；旧300主张受门禁，不能新组逃逸；无法证明身份则gap |
| H12 | live remember与自动抽取先后互换及并发；纯text和typed跨schema | 共享coarse slot及通配人工保护，冲突复用/revise或manual_override，不另造当前重复记忆；同源多事件不按数组序号合并 |
| H13 | 聊天session先删，独立有效业务回执后到 | 聊天origin拒收，业务镜像仍applied，input关联blocked不阻流，不整组擦除独立业务证据 |
| H14 | 取消后子job排队、旧lease恢复、embedding响应丢失 | owned新准入被拒、reused live job不误杀、在飞/未知单列，不承诺provider只收一次费 |
| H15 | live/补采并发首次创建，live后续metadata已更正 | 失败方只读解析并复用；create-only不latest-CAS重写旧payload，未materialized预约可恢复，blocked不伪称成功 |

按§2.1实施A→可选B→C。共享安全门禁与按mode的H项以04§10为准，未启用mode测试unsupported，不用为手工B实现全部H扩展。后续自动巡检可从60秒周期评估，但首发无此要求，周期也不代表全历史处理SLO。

H项是启用本能力的额外门禁，00–04适用核心测试仍须通过。报告新增来源滞后、待核对turn数、扫描覆盖、派生成功/隔离/未知调用、删除控制滞后及费用；不能以“后台运行了”证明完整性或效果。
