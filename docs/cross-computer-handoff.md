# 跨电脑开发交接说明

核对日期：2026-10-28（America/New_York）。本文件记录交接状态与上手步骤，不新增业务/API合同。完整首次衔接指令见[可复制 Prompt](continuation-prompt.md)。

## 1 当前到底交付了什么

本仓库地址：<https://github.com/zhgqwx-del/mem-you-service>。

本次开始检查时，`main` 与本地 `origin/main` 均指向 `56733d1`，工作区干净。该提交是现有设计/调研基线；这是交接开始时的本地引用快照。本轮新增的交接文件随Git版本分发；新电脑应核对实际分支、提交与远端同步状态，不固定退回这个提交。

| 内容 | 交接时的真实状态 |
|---|---|
| 当前设计 | V1.2 修订1，2026-10-27整体审查修订 |
| 服务实现 | 尚未开始；没有服务源码、包管理清单/锁文件、Compose、数据库迁移或运行脚本 |
| 本仓库运行数据 | 未发现服务数据库、聊天导出、模型文件或可恢复的运行数据；不代表原电脑其他项目没有数据 |
| 验收 | 已定义合同与目标；尚未执行合同测试、集成、真实模型、压测或恢复演练 |
| 已保存的项目上下文 | `docs/spec-v1/`、文档状态索引、审查记录及 `research/` |
| 本轮交接补充 | 根目录 `AGENTS.md`、本文、完整衔接Prompt及入口链接 |

**因此现在换电脑不需要先恢复一个记忆服务数据库。安装Git、拉取仓库并打开项目，即可继续设计分析；真正开始实现时再建立可重现环境。** 不应尝试运行本仓库尚不存在的 `npm install`、迁移或启动命令。

## 2 新电脑首次上手

在有Git及仓库访问权限的终端执行；下面命令适用于常见终端，目录可自行选择：

```sh
git clone https://github.com/zhgqwx-del/mem-you-service.git
cd mem-you-service
git status --short --branch
git log -5 --oneline
```

如果已经有checkout，先检查未提交修改与分支；确认本地工作已保存后再按需 `git pull --ff-only`。不要为“衔接”执行硬重置或覆盖工作区。

随后：

1. 在Codex中打开这份本地仓库，确保工作目录是仓库根目录。
2. 把[完整Prompt](continuation-prompt.md)中代码块内容粘贴到新聊天，填写末尾的本次需求与可选路径。
3. 没有具体开发任务时，使用默认的“环境与上下文核查”；它应给出可开始的工作和实际缺口。
4. 有具体任务时直接填写，例如“实现D1基础来源合同”或“分析某个设计是否闭环”。不必先恢复全部参考项目。

## 3 用仓库承接项目记忆

项目必需的规则和结论应随Git保存。Codex会读取项目 `AGENTS.md`；本地memories属于另一个本地状态层，不能把它当作跨电脑的唯一交接依据。见[OpenAI Docs：AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)与[Memories](https://learn.chatgpt.com/docs/customization/memories)。

| 信息 | 保存位置/处理方式 |
|---|---|
| 每次必须遵守的项目规则 | 根目录 `AGENTS.md`，保持简短 |
| 业务边界、协议、状态机及验收 | `docs/spec-v1/`，唯一现行合同 |
| 为什么作出取舍 | 05/07审查记录及带版本的 `research/` |
| 当前做到哪里、如何运行、尚缺什么 | 本交接说明；后续实现时及时更新 |
| 本次准备做什么 | 新聊天Prompt的“本次需求” |
| 新电脑本地路径 | 可选 `.local/context.md`，被Git忽略 |
| 密钥、账号授权、私有数据 | 通过独立安全渠道恢复，不放入Prompt或Git |

Prompt能引导新会话恢复已保存的事实，不能恢复未记录的口头决定、未提交代码、未同步聊天或原电脑上的文件。不需要把整个 `~/.codex` 目录复制进项目；其中的配置、登录状态、插件和本地记忆也不属于本仓库。

## 4 按什么顺序恢复设计上下文

先读根 `AGENTS.md`、本文、[文档状态索引](README.md)和[整体开发入口](spec-v1/README.md)，再读[00边界与不变量](spec-v1/00-boundaries-and-invariants.md)。按本次任务继续：

| 工作 | 重点文档 |
|---|---|
| MemoryService | 01数据模型、02 API、04验收 |
| Agent / MemoryAdapter | 02 API、03时序/恢复、04验收 |
| 产品后端 / RecordService | 00、03及04的适用集成用例 |
| 聊天补采与补偿 | 01、02、06及04的能力验收映射 |
| 追溯首发裁剪 | 07审查记录；05属于上一轮决策说明 |
| 复核特定框架/产品 | 再按需阅读相应 `research/`，核对固定源码版本 |

需要保留的关键取舍如下，精确定义仍查现行合同：

- 正式记录、时间线和精确统计由产品后端负责；MemoryService提供有来源、有版本、可撤回的记忆与证据。模型说“已保存”不等于正式回执。
- 首发A是HTTP核心加一个点滴 `full_lifecycle` 适配器；可靠输入journal、稳定原生身份、同身份重送、持续删除/撤权及恢复都在A范围。关闭history不免除生命周期义务。
- B是可选的有界手工MySQL补采/部分修复；C包含自动发现/巡检/重抽等。MCP、search/facts、自动摘要、图及P1容量分别后置，不是A的隐含前置。
- owner与陈述对象、用户报告与正式事实/推断、各类时间分开；不猜单位、主体或更正目标。首发整源授权，混合域原文权限不足则拒返。
- 实时与补采共用稳定origin及原计划source/group；CAS、人工slot保护、有序屏障及失效门禁不可用文本相似去重替代。
- 所有入模记忆，包括工具补查结果，都需要依赖追踪。逻辑失效、物理清理、消费者清理分别回执；恢复旧备份前先恢复独立删除/撤权控制。
- 未知业务执行结果或付费模型结果先核对，不通过换key/换run盲目重调。未支持能力明确 `unsupported`。
- 设计中的准确率、延迟、容量和RPO/RTO均是待验证目标。服务单测、假模型通过不等于完整接入、真实中文效果或生产验收通过。

## 5 哪些外部材料不会随本仓库迁移

下面位置与摘要在2026-10-28只读核对。没有读取真实 `.env`、导出聊天或复制外部文件。

### 5.1 现有Agent项目：实际集成时另拉

- 仓库：<https://github.com/zhgqwx-del/agent-service>，访问权限在新电脑单独配置。
- 已审计commit：`5d38b2cd6307aab9c8dec2c475b1bebf886d8283`。
- 原电脑位置：`/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service`。
- 核对时为 `main`，HEAD与审计commit一致，工作区干净；未联网核对远端是否有更新。
- 证据入口：[聊天存储审计](../research/chat-storage-audit.md)。

需要源码集成时，在自选父目录另行clone；取得之后先核对HEAD：

```sh
git clone https://github.com/zhgqwx-del/agent-service.git
git -C agent-service rev-parse HEAD
git -C agent-service status --short --branch
git -C agent-service cat-file -t 5d38b2cd6307aab9c8dec2c475b1bebf886d8283
```

不要求工作项目永远停留在旧commit。版本不同应重新核对适用源码；如需复现旧审计，可在不影响当前工作的独立checkout/worktree检查固定commit。现有 `memory-injection` 只是静态prefix/append，并未交付动态MemoryAdapter。

旧文档中的绝对链接映射到新项目根目录，再按相对路径和符号定位，例如 `packages/core/src/hooks/middleware.ts`、`packages/core/src/session/host.ts`、`examples/record-assistant/reference.ts`。旧行号只对应旧版本，不能机械沿用。

只有实际运行该Agent项目时，才需要下面这组环境。以下来自上述固定commit的只读核查，未执行安装或启动；未来以该项目实际版本的说明为准：

| 项目 | 已确认入口/要求 |
|---|---|
| Node与包管理器 | `.node-version`为 `24.21.0`，`package.json`固定 `pnpm@12.5.1`；有 `pnpm-lock.yaml`，安装入口为 `pnpm install --frozen-lockfile` |
| 基础设施 | MySQL 8、经验证的Redis、持久Blob目录；`deploy/local/compose.yaml`提供 `mysql:8.0`、`redis:8`，MinIO属于可选S3测试 |
| 首次初始化 | 先读 `docs/operations/schema-bootstrap.md`、`development-and-ci-guide.md`、`local-and-deployment.md`，完成独立metadata、最小权限、authority及first-admin准备 |
| 配置样例 | `deploy/local/examples/runner.env.json`、`router.env.json`、`schema.env.example`、`first-admin.env.example`；根 `.env.example`不足以直接启动当前受限MySQL runtime |
| 验证入口 | `pnpm typecheck`、`pnpm build`；`pnpm test:record-assistant-reference`为transport double测试；`pnpm test:record-assistant-reference-mysql`需显式独占测试MySQL/Redis，使用FakeVendor |
| 启动入口 | `pnpm dev:runner` / `pnpm dev:router`存在，但必须先完成上述初始化和配置；普通启动只校验schema，不自动建库/迁移/授权 |

新电脑不能把面向原机已登记OWNER的 `pnpm experience:up` 当成通用安装步骤。数据库、Redis、Blob目录/命名空间、互联token、模型及加密密钥均需在新电脑按样例私下配置；本交接未复制这些值，也没有验证目标电脑的运行环境。

若要延续Agent已有会话，还需按该项目恢复方案迁移数据库、Blob与所需解密密钥，并核对协调命名空间等状态；创建全新开发实例与恢复原有数据是不同任务。本轮未核查原项目数据量、备份或恢复可用性，不能声称已有会话已经可跨电脑恢复。

### 5.2 原始demo和旧设计：可选参考材料

| 材料 | 原电脑位置 | 字节数 | SHA-256 |
|---|---|---:|---|
| 点滴demo HTML | `/Users/zhangguoqiang/Desktop/美柚产品和研发/点滴demo-1014.html` | 23128969 | `36afca26be359006cb40c3e25c9d4317a0582d7b5fec46f209730f7824fb314b` |
| 旧记忆层设计 | `/Users/zhangguoqiang/Desktop/meetyou/agent-runtime-方案/05-记忆层设计.md` | 43951 | `cf19f654ee744faf2924161659a9ddddb1ab95f331a7e21c972012ce0b66963f` |

只有复核产品原型或历史推导才需要另行传输这些文件。普通设计分析和独立服务开发可先用已保存的审计结论，缺原文件时明确“未重新核对原始材料”。demo含演示/mock数据，不是真实聊天导出或正式评测金标准。

原文件目前仍在原目录，本轮未为其建立备份。需要保留的原始材料应通过你认可的文件传输/备份渠道另行保存；收到后校验SHA-256。macOS可用 `shasum -a 256 <文件路径>`，Linux可用 `sha256sum <文件路径>`，PowerShell可用 `Get-FileHash -Algorithm SHA256 <文件路径>`，按实际路径加引号。

### 5.3 开源研究快照：按需重新取得

`research/`中部分源码曾放在 `/private/tmp/mem-you-memory-*` 或原电脑的本地快照目录。这些位置不是可持久依赖；需要复核时按研究文档中官方仓库和固定commit重新取得。无需在新电脑装齐七个Agent或全部记忆框架，不以最新main自动替代旧版本证据。

### 5.4 可选的本地路径映射

在新电脑建立 `.local/context.md`，例如下面内容；它仅记录路径和非敏感状态，不需要执行或source：

```text
MEM_YOU_ROOT: <本仓库绝对路径>
AGENT_SERVICE_ROOT: <另一个仓库绝对路径；未准备则写缺失>
AGENT_SERVICE_HEAD: <实际git rev-parse HEAD结果>
DEMO_HTML: <HTML路径；可缺失>
LEGACY_DESIGN_MD: <旧设计路径；可缺失>
LOCAL_SERVICE_STATE: <尚无实现 / 已建立本地开发环境>
```

这些是交接字段名，当前不是应用已经支持的环境变量。不要把密码、token、真实连接串填进去。

## 6 环境与数据什么时候需要补齐

| 当前任务 | 需要准备什么 | 缺失时可以做什么 |
|---|---|---|
| 继续设计分析 | 本仓库、Git、编辑器/开发助手 | 无需数据库或模型key |
| 从零实现服务D1 | 依据当前合同建立工程，冻结运行时/包管理器/数据库版本；补依赖锁、迁移、无密钥配置样例和启动/测试说明 | 先完成本地确定性合同测试和受控依赖 |
| 现有Agent源码集成 | 另拉agent-service，读其自身AGENTS/README及实际manifest，按新版本核对审计 | 缺项目时可开发明确标记的接口夹具；不能宣称真实集成完成 |
| 聊天补采B | 获授权开发MySQL、Adapter与生命周期控制能力、脱敏样本及任务预算 | 做preview/隔离测试；不能绕过稳定身份/分页/删除前置 |
| 中文效果或容量验收D4 | 版本化数据集/金标准、真实模型及预算、固定硬件和结果报告 | 先设计或运行已具备条件的确定性用例；缺项明确记录 |

本服务设计基线为API/worker、PostgreSQL与可重建检索视图，队列可先用同库任务表。04定义的词法基线是jieba搜索模式与BM25，dense对照是BGE-M3 1024维归一化dense表示；它们是待落地、需固定版本的基线，不是本机已经安装的依赖。运行时与精确工具版本要在首个实现中确定，不应凭交接文档虚构。

当前没有需要从本仓库恢复的真实数据库。实现测试可从04的固定场景建立合成/授权脱敏fixture，明确其性质；不能把文档中的100条时间线、600测试turn或12万容量语料目标说成已有数据集。

以后出现运行数据时，换机交接必须同时补齐数据库版本/扩展与迁移、配置键及安全配置渠道、数据导出/恢复方法、数据摘要、fixture生成方法和实际验证记录。需要延续既有数据时，来源/版本、journal/回执、授权/删除控制日志及恢复门禁必须协调恢复；向量/摘要等派生可按合同重建，但不能只恢复旧主库导致已删除内容复活。

## 7 每次结束时留下什么

只记录实际完成的工作，至少包括：当前分支/提交和未提交修改、变更范围、实现/未实现能力、运行环境与命令、执行的验证和结果、外部数据/模型版本、阻塞项及可接续步骤。命令应来自实际项目文件并区分已运行和仅建议。修改设计时同步相关合同和验收，不另建第二份现行方案。

跨电脑前，把要带走的代码、文档、锁文件、配置样例和可公开fixture提交并推送；仅本地保存不会出现在新电脑。敏感配置、原始文件和运行数据按上面的独立渠道准备。返回原电脑时同样先检查两边分支和未提交修改，再同步。

当前接续入口为04的D1–D4。D1建立基础合同与来源，用假RecordService和稳定operation夹具验证；D2召回与记忆；D3失效与完整接入；D4真实质量与P0容量。用户下一条具体需求决定本次推进哪一段；本说明不自动授权一次实现全部阶段。
