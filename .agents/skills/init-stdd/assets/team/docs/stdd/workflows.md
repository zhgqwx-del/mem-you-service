# STDD 研发工作流

产品、设计、研发和测试先从[角色导航](roles.md)打开同一份变更。按当前工具调用技能，也可以让 Agent 直接读取表中链接的 `SKILL.md`。

{{SKILL_CALLS}}

## 使用顺序

从[项目入口](project.md)找到当前变更。先明确规格和验收场景，再在 `tasks.md` 写修改位置、关键取舍和验收方式。方案确认后进入测试与实现。复杂变更可单独写技术设计。

```mermaid
flowchart TD
    Init["项目已初始化<br/>从项目入口找到当前变更"]
    Start["stdd-start<br/>核对基线与分支，起草变更"]
    Diagnose["stdd-diagnose<br/>复现缺陷并形成回归场景"]
    Spec["起草规格、验收场景和简短实施方案"]
    Records["按项目约定记录讨论或 ADR<br/>从 change.md 链接"]
    Confirm{"规格和实施方案已确认？"}
    Delivery["stdd-delivery<br/>先写验收测试，再实现并复跑"]
    Report["stdd-test-report<br/>把实际结果写入 verification.md"]
    Review["stdd-review<br/>核对代码、规格和受测证据"]
    Wrap["stdd-wrap<br/>提交前检查、归档核对链接<br/>准备 PR 或交接"]
    Done["按项目流程合入或交接"]
    Release["stdd-release-notes<br/>按版本范围整理发布说明或迭代总结"]

    Init -->|继续已创建的首个变更| Spec
    Init -->|后续开新需求| Start
    Init -->|收到缺陷反馈| Diagnose
    Start --> Spec
    Diagnose -->|决定修复后| Spec
    Spec --> Confirm
    Spec -.->|多轮讨论或长期取舍| Records
    Records --> Confirm
    Confirm -->|已确认| Delivery
    Confirm -->|待确认或需调整| Spec
    Delivery --> Report
    Report -->|关键场景通过| Review
    Report -->|发现实现问题| Delivery
    Review -->|需要修正实现| Delivery
    Review -->|评审通过| Wrap
    Wrap --> Done
    Done -.->|准备发版或总结迭代时| Release
```

团队先开 PR 时，可以先用 `stdd-wrap` 准备草稿，再在 PR 中用 `stdd-review`。

## 技能速查

| 阶段 | 技能 | 工作产物 |
| --- | --- | --- |
| 开工 | [stdd-start](../../{{SKILLS_ROOT}}/stdd-start/SKILL.md) | 基线和分支、规格、简短实施方案、相关讨论和 ADR |
| 实现 | [stdd-delivery](../../{{SKILLS_ROOT}}/stdd-delivery/SKILL.md) | 按已确认方案和场景编写用例、实现并复跑 |
| 排查 | [stdd-diagnose](../../{{SKILLS_ROOT}}/stdd-diagnose/SKILL.md) | 用[诊断模板](templates/diagnosis.md)记录复现、影响范围及回归场景 |
| 验收 | [stdd-test-report](../../{{SKILLS_ROOT}}/stdd-test-report/SKILL.md) | 按场景记录自动、手工及待验结果 |
| 审查 | [stdd-review](../../{{SKILLS_ROOT}}/stdd-review/SKILL.md) | 对照规格、候选差异和受测证据的发现 |
| 收尾 | [stdd-wrap](../../{{SKILLS_ROOT}}/stdd-wrap/SKILL.md) | 提交前检查、归档链接、最终受测版本和按 [PR 模板](../../.github/pull_request_template.md)整理的草稿 |
| 版本 | [stdd-release-notes](../../{{SKILLS_ROOT}}/stdd-release-notes/SKILL.md) | 按[版本说明模板](templates/release.md)整理差异、影响、兼容及验收状态 |

## 脚本

从仓库根目录使用脚本。

```sh
python3 -B scripts/new_change.py 014-order-cancellation '订单取消' --roles
python3 -B scripts/check_traceability.py
python3 -B scripts/git_range.py --merge-base main HEAD
python3 -B scripts/git_range.py v1.0.0 v1.1.0
```

- `new_change.py` 创建变更、任务与验证文件。加 `--roles` 会同时生成[规格草稿](templates/spec.md)、[体验设计](templates/ux-design.md)和[验收计划](templates/test-plan.md)。复杂变更另加 `--design` 生成[技术设计](templates/design.md)。同名的在途或已归档变更会报错。
- `check_traceability.py` 检查 `specs/` 中现行规格的 `REQ` 和 `AC` 编号、重复 ID、未知引用和缺少验收场景的需求。实际测试覆盖和手工验收结果记入 `verification.md`。可在测试名里保留场景 ID，例如 `test_ac_ship_002_at_threshold`。使用自有规格格式时，可调整或替换追溯检查。
- `git_range.py` 读取本地 Git 引用和提交差异。审查分支用 `--merge-base` 查看分叉点到候选的文件变动。比较版本时传两个实际引用，文件差异取两端快照。

## 接入项目的测试与发布流程

在工程说明里记录项目实际的构建、测试和 CI 命令。运费教学模式可用 `make trace` 查规格引用，`make test-acceptance` 跑定向验收，`make check` 跑规格检查和全部测试。工具与脚本的命令需要随项目技术栈调整。团队需要发布、动态配置或多仓编排时，可针对实际接口、环境和权限补充独立技能并关联验收证据。

基线、远端同步与创建分支按[项目 Git 约定](git-workflow.md)执行。收尾时先完成约定的候选同步，再验证最终候选。rebase 和 squash 根据项目工作方式与任务授权选用。

需要单独讨论或记录长期决策时，按[讨论与架构决策](decisions-and-discussions.md)选择位置，在 `change.md` 关联讨论与 ADR，归档时核对双向链接。
