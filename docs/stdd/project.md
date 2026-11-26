# 独立记忆服务 MemoryService 项目协作

## 项目目标

为点滴记录 Agent 及其他获授权的 Agent 提供有来源、有版本、可撤回的记忆、来源镜像、召回和取证。正式记录、产品时间线和精确统计由产品后端负责。

唯一现行合同为 [V1.2 修订2](../spec-v1/README.md)。00–04 是核心合同，06 的原生身份和生命周期共享细则适用于首发 A。启用历史扫描与任务控制时再应用 06 的扩展要求。首发 A/B/C 范围和 D1–D4 交付顺序以合同为准。

## 首个实施切片

[首个变更草案](../../changes/001-first-slice/change.md)已选定 D1「合同与基础来源」的首个子集，覆盖来源写入、回执、有序导入及恢复。[独立 HTTP 契约验收](../../changes/001-first-slice/verification.md)已在隔离 PostgreSQL 上通过。 [交付顺序与责任](../spec-v1/04-evaluation-and-acceptance.md#9-交付顺序与责任) · [开发交接说明](../cross-computer-handoff.md)

## 角色入口

| 角色 | 打开当前变更 |
| --- | --- |
| 产品 | [目标、范围和决策](../../changes/001-first-slice/change.md) · [需求与场景](../../changes/001-first-slice/spec.md) |
| 设计 | [体验设计](../../changes/001-first-slice/ux-design.md) |
| 研发 | [实施方案与任务](../../changes/001-first-slice/tasks.md) |
| 测试 | [验收计划](../../changes/001-first-slice/test-plan.md) · [验收记录](../../changes/001-first-slice/verification.md) |

长期分工见[角色导航](roles.md)，执行顺序见[研发工作流](workflows.md)，合同与验收记录方式见[工程约定](../engineering.md)。
