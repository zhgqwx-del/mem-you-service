# Memory D1 首个来源写入与恢复切片验收计划

本轮已按以下入口执行。覆盖 [AC-MEM-001 至 AC-MEM-007](spec.md#验收场景)，映射到现行 [04 的 C 项](../../docs/spec-v1/04-evaluation-and-acceptance.md#5-服务与接入合同验收矩阵)及 Mono 工单。仓内用例验证真实 Memory HTTP 及持久状态，Mono 贯通用例使用既有假 RecordService 的原 Outbox 事件。

## 夹具和运行条件

- 两名合成 owner，分别注册明确的本人主体与独立可信凭证。写入、导入和证据读的授权分别设置，负例加入窄域及旧策略代际。
- 产品注册流的已应用初始水位为 10。假 RecordService 生成两笔各自提交的饮水事件 seq 11 和 12。记录原产品回执、source/group、事件身份和转换后的稳定请求摘要。
- 使用独占的测试 PostgreSQL，按测试套件分隔 schema，显式迁移后启动本地 API。掉线及重启复用同一测试 schema。测试以准备完成屏障触发故障，避免固定 sleep 代替提交证明。
- 用合成已确认字段及固定时区，查询只收集和断言所需的身份、版本、状态及结构化投影。凭证和数据库连接串由测试环境注入。

## 用例与通过口径

| 场景 | 动作 | 断言与证据 | 对应合同 |
| --- | --- | --- | --- |
| AC-MEM-001 | 用缺省凭证、旧 epoch、错误 owner/主体/领域、非注册流和模型调用者请求写入或查操作和证据。 | 校验 `401/403/404/409` 的对应错误，无写入；与真不存在响应等价，不泄露他人正文、版本、外部 ID 或计数。 | 02 §1.1、§11，C08/C09，Mono AC08 |
| AC-MEM-002 | sync 新建 v1，重放原请求。用同键改内容及同 caller revision 换内容发起请求。再从现有头并发两笔 CAS。 | 重放同 operation、同首版。冲突有原约定错误；并发只有一个进入新当前版本，旧客户端不能回写。 | 02 §2.3、§3，C01/C02 的来源部分 |
| AC-MEM-003 | 导入 seq 12 两次并查回操作，随后送 seq 11。再重放 11 和 12 的原载荷。 | 缺序时 12 只有持久 accepted，水位为 10；无新 source version 或 write token。补齐后通过各自原 operation 返回 applied、`source_applied` 和对应唯一版本。 | 02 §2.4、§3、§11，C04/C19，Mono AC05/AC06 |
| AC-MEM-004 | 通过 `read_after` 要求 seq 12，而只应用到 10。另起用例发送同序号异摘要或同事件异序号，重启后再读。 | 读返回 `503/504` 且无旧正文、成功空结果或不相关记录；冲突返回 `409 IMPORT_EVENT_CONFLICT`，相应流隔离及连续水位在重启后可核对。 | 02 §2.4、§8，C04/C05/C19，Mono AC06 |
| AC-MEM-005 | 让 Memory 暂不可用，先读产品回执和待投递事件。分别在 sync 提交前后、inbox 提交后未返回、apply 事务前后中断服务，再重启重投。 | sync 成功最多产生一个修订。保存回执仍可查。已接收或已应用的事件保留唯一操作和来源结果，未知响应由原键和原 operation 恢复；inbox、水位及来源头一致。 | 02 §3、§11，C01/C04/C19 与 source 恢复，Mono AC05/AC09 |
| AC-MEM-006 | 分别让正式镜像或原输入先到，按同组合法引用关联；再试不同 owner/group、越域投影及旧修订。 | 两类来源用不同稳定 ID。待补关联不产生可读原输入，核验后引用准确。新版可查时旧修订返回相应状态，越权响应与不存在等价。 | 01 §4.4，02 §8，C08 与原断言关联，Mono AC08 |
| AC-MEM-007 | 发送超限请求、未知字段、缺幂等键、不合法单位/时区以及未启用端点请求；查看能力列表。 | HTTP 状态和错误信封符合 02，失败无部分写入，能力声明和实际接口一致。 | 02 §2、§15.1，C09/C10 |

## 命令入口

| 入口 | 执行用途 |
| --- | --- |
| `pnpm run db:migrate` | 迁移目标隔离测试库。命令输出迁移版本与结果。 |
| `pnpm run start` | 启动本地 Memory HTTP，实例读取已迁移库。 |
| `pnpm run test:contract` | 使用明确的测试数据库配置运行 `test/contract/`。测试包含公共 HTTP、故障注入和同库重启验证。 |
| `pnpm run typecheck` | 用锁定的 TypeScript 检查服务及契约测试。 |

单独运行迁移或服务时，设置 `MEMORY_DATABASE_URL` 和 `MEMORY_DB_SCHEMA`。HTTP 默认监听本机端口 `8083`，可用 `MEMORY_PORT` 覆盖。

契约测试从 `MEMORY_TEST_DATABASE_URL` 读取专用数据库连接，由测试分配独立 schema。默认从同工单的 `agent-service` 工作树读取假 RecordService。独立检出可用 `MEMORY_RECORD_FIXTURE` 指向该 TypeScript 文件。 [验收环境与证据](verification.md)

完整 D1 出口仍按原合同的 C01–C05、C08–C10、C19、§5.2 适用变体和 source 恢复承接，包含 C03 的 memory CAS 与合同定义的样本次数。首段证据记录所覆盖变体。 [D1 交付顺序](../../docs/spec-v1/04-evaluation-and-acceptance.md#9-交付顺序与责任)

## AC08 产品侧验收与 CI

使用两个同租户、不同 owner 和本人主体的合成账号 A、B。生成当次签名密钥并走正式验签代码，启动实际 RecordService 和 Memory HTTP 进程。PostgreSQL 17 隔离实例中分别迁移两个逻辑数据库并使用独立运行角色。测试通过受限审计角色比较前后持久状态。契约命令读取 `RECORD_TEST_DATABASE_URL`，要求为专用本地 PostgreSQL 17 的 `postgres` 库管理连接。夹具为每个测试创建并回收独立库与角色。 [实测记录](verification.md#ac08-recordservice-交付验收)

| 场景 | 单元测试 | HTTP 与持久状态断言 |
| --- | --- | --- |
| AC-RECORD-801 | 验签、issuer/audience/时间校验与固定公钥选择，账号映射命中、缺失、停用和单一映射。 | A、B 签名令牌成功。无效凭证或无映射的请求返回约定状态，未新增业务行。用账号停用前签发的令牌复测读写被拒。 |
| AC-RECORD-802 | 授权规则对不同 tenant、owner、本人主体和领域的匹配矩阵。 | 用真实请求创建两人的待补和正式条目。交换两人凭证，分别请求 operation ID、原客户端键和 record ID。对照随机不存在对象的 HTTP 状态、错误码和公开正文，只排除服务生成的请求标识。 |
| AC-RECORD-803 | 待补和正式输入鉴别、保留字段拒绝、幂等范围及负载比较。 | 用 B 尝试伪造 A 的身份、对象和 Memory 权威字段。比较前后记录、操作、回执、Outbox、序号及原事件身份。另让双方用相同客户端键各自成功，精确重放不重复提交。 |
| AC-RECORD-804 | 投递仅接受内部已提交事件，复用稳定身份。 | 由服务端投递本轮实际 Outbox，验证 A 的 Memory 证据可读，B 对同一证据和操作不可见。分别尝试产品令牌直连、模型 caller 伪造已提交来源及 B 导入凭证使用 A 的流，核对没有新增或改写来源、inbox、水位。 |
| AC-RECORD-805 | 校验必需场景在测试报告中的判定逻辑。 | PR 运行中验证必需场景全部执行。验证缺失、跳过、失败或未就绪的数据库、服务产生失败结果。 |

### 命令和必需状态检查

- 仓根提供 `pnpm run test:record:unit` 与 `pnpm run test:record:contract`，后者包含 RecordService 与 Memory 的双服务授权场景。现有 `pnpm run typecheck` 扩展覆盖应用和测试。三个命令必须能用本仓一次干净检出和锁文件复跑。新的 AC08 套件通过实际 RecordService 生成事件，不依赖兄弟仓的假 RecordService。既有 Memory 首段套件仍作为 Mono 回归复跑。
- GitHub Actions 工作流声明稳定名称 `record-service-ac08`，覆盖 PR 及目标分支推送。锁文件安装后依次运行类型检查、单元测试和隔离 PostgreSQL 17 的 HTTP 契约。使用本次生成的测试凭证。缺环境、零测试、必需场景缺失、skip/todo 或失败一律返回非零。报告保留候选 SHA、用例标识、结果计数及脱敏证据。 [工作流](../../.github/workflows/record-service-ac08.yml)
- 工作流完成后，由有权限的仓库负责人将该检查设为目标分支合入的必需状态检查，并核对测试失败的 PR 会被阻止、修复后检查通过。通过的 AC08 证据绑定产品入口、Memory 入口和实际候选。最终产品身份提供方接入或入口迁移时再次从该入口复跑。
