# Memory D1 首个来源写入与恢复切片验收记录

## 接入前基线

2026-11-18 的本地基线为 `main / 6f8ced0663bdf50db608b3a45cbe79ab3259eb00`，含已有未提交的交接文档修改与 `.agents/skills/init-stdd/`。核对了 `git status --short --branch`、`git rev-parse HEAD` 和仓库文件。独立服务尚无源码、依赖清单、迁移、启动入口或可执行的合同测试。 [开发交接说明](../../docs/cross-computer-handoff.md#1-当前到底交付了什么)

## 2026-11-25 规格阶段核对

- 本轮基线 `mono/DIANDI-001 / 496dac7183f15ab4858b1a94db091dafd27868d1`。开工工作树干净，与本地缓存的 `origin/main` 同 SHA。未刷新远端。
- 执行 `git diff --check`。使用 Python 本地检查变更内链接、标题、5 个需求和 7 个场景在规格及测试计划之间的一致性，检查通过。
- 执行 `python3 -B scripts/check_traceability.py`，退出 0，现行脚手架格式扫描为 0 specs、0 requirements、0 scenarios。七个首段场景目前位于在途变更，按上项单独核对。
- 本机 Node 24.21.0、pnpm 12.5.1。未发现 `psql`、`pg_ctl`、`initdb` 或容器 CLI。隔离 PostgreSQL 的提供方式和实际版本随实施环境登记。

## 实施验收

用户已确认 Node.js 24、TypeScript、PostgreSQL 17 及 AC-MEM-001 至 007。使用独立 Memory HTTP 进程、本机 Unix socket PostgreSQL 和现有假 RecordService 的合成 Outbox。当前基线 `496dac7183f15ab4858b1a94db091dafd27868d1`，候选为 `mono/DIANDI-001` 未提交工作树。

| 场景 | 实际结果 |
| --- | --- |
| AC-MEM-001 | 通过。核对无凭证、撤权、过时代际、主体/领域/流权限和伪造权威。跨 owner/窄域的响应与不存在等价。 |
| AC-MEM-002 | 通过。精确重放复用操作及版本，跨授权重放无原令牌，竞争 CAS 只有一个写入。 |
| AC-MEM-003 | 通过。seq 12 耐久接收后重启，保持水位 10。补齐 11 后应用到 12，等价快照新事件复用原修订。 |
| AC-MEM-004 | 通过。缺序读拒绝旧正文。同序号异内容及同事件换序号均隔离原流，重启后保持隔离。 |
| AC-MEM-005 | 通过。对 sync 提交前后、inbox 提交后、apply 提交前后分别终止子进程，原回执和事件可从同库恢复。 |
| AC-MEM-006 | 通过。原输入与正式镜像两种到达顺序均验证同组精确关联。权限及旧版本投影按合同处理。 |
| AC-MEM-007 | 通过。字段、UTF-8 字节、幂等键、单位、时区和能力声明均按 HTTP 契约断言。 |

### 执行记录

- 先写契约测试再运行，缺少服务模块时退出 1，Mono 回执为 `run-e1377b2e4fc3.json`。
- `pnpm run test:contract` 最终退出 0，16 项通过，含七个顶层场景及九个子用例。 `pnpm run typecheck` 退出 0。
- 启动冒烟以独占 schema 调用迁移入口两次，再启动 HTTP CLI。无凭证返回 401，SIGTERM 后正常退出。
- 运行环境为 Node 24.21.0、pnpm 12.5.1、PostgreSQL 17.12、`pg` 8.22.0、TypeScript 5.9.3。测试用 PostgreSQL 来自已固定的 ARM64 二进制包，仅使用私有 Unix socket。 [二进制包](https://www.npmjs.com/package/@embedded-postgres/darwin-arm64/v/17.12.0-beta.19)
- 源码、迁移、锁文件、测试和 TypeScript 配置的组合摘要为 `d73a6ad1247106870bd58c89941c2c3b0fe832875a97f4499abb36b04bc24971`。摘要算法为按路径排序的 `sha256sum` 文本行及末尾换行再取 SHA-256。Mono 回执另绑定完整工作树和共同规格。
- 首段证据覆盖所列合成 HTTP 场景。完整 D1 的 memory CAS、全合同样本次数、真实产品授权入口与后续生命周期仍待各自阶段验收。

## AC08 RecordService 交付验收

用户已确认产品侧实施方案。本地复跑使用候选工作树 `mono/DIANDI-001`，基线 `496dac7183f15ab4858b1a94db091dafd27868d1`，Node 24.21.0、pnpm 12.5.1、JOSE 6.2.12、隔离 PostgreSQL 17.12。本地发行器在每个测试生成签名密钥，两个账号经实际 HTTP 验签。独立 RecordService、Outbox 投递和 Memory 都使用实际可启动入口和分开的数据库角色。

| 场景 | 实际结果 |
| --- | --- |
| AC-RECORD-801 | 单元和 HTTP 通过。签名、issuer、audience、时效和可信密钥选择均受约束。停用映射立即影响后续请求，已签发令牌无法继续使用。 |
| AC-RECORD-802 | 单元和 HTTP 通过。各自能查操作、原文、回执及条目，重启后仍可查。跨用户查询与不存在的公开错误等价。产品 API 数据库角色无法连接 Memory 库。 |
| AC-RECORD-803 | 单元和 HTTP 通过。伪造字段被拒绝，记录、操作、回执、Outbox 和序号无变化。并发同键复用原结果，不同用户同键各自提交。无注册流时事务回滚。 |
| AC-RECORD-804 | 双服务 HTTP 通过。产品令牌直连、model caller 和跨流导入分别被拒绝，Memory 状态不变。真实产品 Outbox 经已登记的凭证导入。B 无法查到 A 的 operation 和来源，Memory 停机时产品保存及回读继续有效，恢复后应用原事件。 |
| AC-RECORD-805 | 单元测试和本地门禁通过。工作流结构静态核对通过。缺少数据库配置时契约门禁退出 1。远端 CI、分支保护及失败 PR 的阻断仍待发布候选后验证。 |

实现前因 RecordService 模块缺失退出 1，Mono 回执 `run-dbf44444dd18.json`。门禁缺环境负例为 `run-244143be3422.json`。最终候选的类型、单元、契约及原有回归以 Mono 受测版本记录为准。此轮的产品侧验收使用本地签名发行器，最终产品身份提供方接入后需从该入口复跑。
