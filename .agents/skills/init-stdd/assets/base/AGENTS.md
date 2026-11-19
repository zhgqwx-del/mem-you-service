# 项目协作说明

- 从 [项目入口](docs/stdd/project.md) 获取目标、角色导航和进行中的变更。阅读 [工程约定](docs/engineering.md) 及受影响的规范和测试。
- 先读受影响能力的现行规范。进行中的行为变更以 `changes/<id>/spec.md` 为评审稿，`specs/` 记录已交付的行为。未决业务判断标明受影响场景。已评审的预期有变化时，在 `change.md` 写明原因与场景 ID，交由相应负责人重新确认。
- 确认本次验收口径和实施方案后开始开发。方案记入 `tasks.md` 或关联的工单，复杂取舍可链接 `design.md`。Git 操作按[项目约定](docs/stdd/git-workflow.md)执行。
- 相关讨论和 ADR 在 `change.md` 统一链接。文档类型和已有目录的选择见[讨论与架构决策](docs/stdd/decisions-and-discussions.md)。
- 产品、设计、研发和测试用相同的 `REQ-*` 与 `AC-*` 交接。按仓库约定先跑定向验收，再跑适用的完整检查。准备 PR 时，在 `verification.md` 留下受测版本、命令与实际结果。
