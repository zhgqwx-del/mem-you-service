# Memory D1 首个来源写入与恢复切片任务

## 实施方案

用户已确认 Node.js 24、TypeScript、PostgreSQL 17 及 AC-MEM-001 至 007。已按 `stdd-delivery` 先写契约测试，再实现并复验。

| 顺序 | 计划工作 | 验收 |
| --- | --- | --- |
| 1 | 先写公共 HTTP 的合成契约测试，建立明确的失败观察点。准备隔离 PostgreSQL，冻结实际数据库版本、运行时和依赖锁文件。 | AC-MEM-001 至 007 的初始环境、夹具及预期。 |
| 2 | 建服务入口、显式迁移、统一 HTTP 信封和可信 grant。按权限测试 source、operation 和证据投影。 | AC-MEM-001、AC-MEM-007 |
| 3 | 实现同步来源的 CAS 与稳定回执，先跑通同输入、同身份恢复。 | AC-MEM-002、AC-MEM-005 的 sync 部分 |
| 4 | 从假 RecordService 读取 Outbox，在同一注册流内接受及应用。加状态查询、乱序/冲突阻断、晚到原输入关联及取证屏障。 | AC-MEM-003 至 AC-MEM-006 的适用部分 |
| 5 | 跑故障注入和重启恢复，保存实际退出状态、测试覆盖、受测版本与未验的完整 D1 合同。 | [验收计划](test-plan.md) |

改动落在本仓的 `src/`、`db/migrations/` 和 `test/contract/`。复用 Mono 内已验收的合成饮水事件与可信夹具。仓库已提供 `pnpm run db:migrate`、`pnpm run start`、`pnpm run test:contract` 和 `pnpm run typecheck`。详细事务、鉴权和数据对应见[技术设计](design.md)。

## 首段实施边界

1. 隔离 PostgreSQL 17.12 运行 HTTP 合同测试。版本和通过结果见[验收记录](verification.md)。
2. AC-MEM-001 至 007 是首个可运行交付边界。实际 RecordService、真实聊天接入和 D2/D3 延续现行合同。
3. 完整 D1 的 memory CAS、合同规定的样本次数和其他 C 项分别取证。

## AC08 实施方案

确认来源为 DIANDI-001 当前指令。用户已确认独立产品入口、运行栈及方案，并授权先写测试再实现。 [技术设计](record-service-design.md) · [验收计划](test-plan.md#ac08-产品侧验收与-ci)

| 顺序 | 工作 | 验收 |
| --- | --- | --- |
| 1 | 先写身份映射、本人授权的单元测试及真实 HTTP/PostgreSQL 双用户契约。使用本地签名发行器和隔离库，保留实现前失败。 | AC-RECORD-801 至 804 |
| 2 | 在 `apps/record-service` 增加独立 API、类型检查配置和产品库迁移。实现可信认证、服务端账号映射和按授权范围访问产品数据。 | AC-RECORD-801、802 |
| 3 | 实现待补与已确认提交、幂等回读、正式保存事务及 Outbox 投递。用既有 Memory 注册流和授权接口验证双侧拒绝。 | AC-RECORD-803、804 |
| 4 | 把类型检查、单元、HTTP 契约接入 PR 必需检查，验证负例失败会阻塞。运行 `mono-verify` 复跑既有保存、反馈和 Memory 相关场景，保存同一候选的证据。 | AC-RECORD-805、Mono AC08 |

基线为 `mono/DIANDI-001 / 496dac7183f15ab4858b1a94db091dafd27868d1` 加现有未提交 D1 实现。本机使用 Node 24.21.0、pnpm 12.5.1。RecordService 类型检查、单元和契约命令已接入 `record-service-ac08`。工作流和等效本地门禁已核对，远端 PR 运行及目标分支必需状态仍待发布阶段配置。 [实测记录](verification.md#ac08-recordservice-交付验收)

开稿前 `mono.py check` 仅报 AC08 待验。Mono 回执绑定两仓完整工作树，评审稿改动会使既有运行回执需要刷新。已跑结果保留，实施后用新候选更新回执。
