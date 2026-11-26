# Memory D1 首个来源写入与恢复切片

- 仓内变更 `001-first-slice`，Mono 工单 `DIANDI-001`
- 状态 首段已实现并通过隔离验收，待提交
- 需求负责人 待登记
- 开发分支 `mono/DIANDI-001`
- 开发基线 本地 `main` 的 `496dac7183f15ab4858b1a94db091dafd27868d1`，与缓存的 `origin/main` 同 SHA
- 拟合入目标 `origin/main`。本次未刷新远端，准备提交或 PR 时按 [Git 约定](../../docs/stdd/git-workflow.md)核对目标、同步并复验。

## 目标

用合成的本人饮水记录启动独立 Memory HTTP 服务。可信来源写入能按相同身份找回回执。已正式提交的产品条目经假 RecordService 的 Outbox 有序导入，可以观察接收、连续应用和重启恢复。

## 范围与决策

用户已确认先完成保存与按需反馈，再推进 Memory D1，并已确认 Node.js 24、TypeScript、PostgreSQL 17 及七条首段验收，按测试先行实施。首段覆盖可信授权、原输入 sync、正式条目 ordered_import、操作查询、连续读屏障和受限的精确取证。正式账本和保存回执继续由产品侧负责。首段用假 RecordService 和合成来源验证。

采用 Node.js 24、TypeScript 和 PostgreSQL 17。首段仅接入隔离测试数据，启用能力按当前实现发布。真实产品接入、记忆 CAS 和完整 D1 出口分别跟踪，D2 的召回和 D3 的失效按原合同交付。详见[规格](spec.md)和[技术设计](design.md)。

## 关联讨论与 ADR

- 采用 Memory V1.2 修订 2 的现行合同，首段从 [04 的 D1 出口](../../docs/spec-v1/04-evaluation-and-acceptance.md#9-交付顺序与责任)选取场景。
- 宿主仍按 [00 的职责分工](../../docs/spec-v1/00-boundaries-and-invariants.md#2-系统职责)和 [03 的调用时序](../../docs/spec-v1/03-agent-sequences-and-recovery.md#22-当前-agent-service-的落点与新增工作)接入。原生会话身份和实际使用门禁随相应阶段验证。
- 运行栈和首段验收范围已由用户确认。独立控制账本的后续接入边界见[实施方案](tasks.md)。

## AC08 产品侧入口方案

用户确认在本工单现有工作树为独立 `apps/record-service` 做方案，运行栈沿用 Node.js 24、TypeScript 和 PostgreSQL 17。该应用承担点滴首个饮水场景的产品侧可信身份、账号映射、正式记录及业务授权。Memory 继续持有来源镜像并独立执行 grant。 [产品服务边界](../../docs/spec-v1/00-boundaries-and-invariants.md#2-系统职责)

用户已确认方案并授权 `stdd-delivery`。产品侧 AC08 已在隔离环境实测，候选继续留在本文记录的任务分支和基线。RecordService 使用本地签名发行器及独立 PostgreSQL 角色，配合实际 Memory HTTP 验证双侧拒绝。最终产品身份提供方与部署归属留待后续。 [RecordService 技术设计](record-service-design.md) · [实测记录](verification.md#ac08-recordservice-交付验收)

## 角色入口

[规格与场景](spec.md) · [调用方状态](ux-design.md) · [实施方案](tasks.md) · [验收计划](test-plan.md) · [验收记录](verification.md) · [RecordService 技术设计](record-service-design.md)
