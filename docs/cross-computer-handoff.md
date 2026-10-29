# 跨电脑开发交接说明

最近核对日期：2026-10-28（America/Los_Angeles）；本机上下文恢复、验证与未完项见第8节。初次交接记录使用2026-10-28（America/New_York），以下历史快照保留其适用时点。本文件记录交接状态与上手步骤，不新增业务/API合同。完整首次衔接指令见[可复制 Prompt](continuation-prompt.md)。

## 1 当前到底交付了什么

本仓库地址：<https://github.com/zhgqwx-del/mem-you-service>。

初次编写交接时，`main` 与本地 `origin/main` 均指向 `56733d1`，工作区干净。该提交是现有设计/调研基线；这是初次交接开始时的本地引用快照。交接文件随后在 `1e0f663` 中提交；本机最新核对见第8节。新电脑应核对实际分支、提交与远端同步状态，不固定退回旧提交。

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

下面位置与摘要来自初次交接时2026-10-28的只读核对，原电脑状态不代表当前电脑。没有读取真实 `.env`、导出聊天或复制外部文件。本机实际可用材料见第8节。

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

初次交接时原文件仍在原目录，未为其建立备份；本机核对未找到这两个原路径，未提供其他路径映射。需要保留的原始材料应通过你认可的文件传输/备份渠道另行保存；收到后校验SHA-256。macOS可用 `shasum -a 256 <文件路径>`，Linux可用 `sha256sum <文件路径>`，PowerShell可用 `Get-FileHash -Algorithm SHA256 <文件路径>`，按实际路径加引号。

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

## 8 2026-10-28 本机认知核查记录

本次需求：形成完整、准确且可追溯的项目认知，方便后续按需完善设计或开发；暂不启动开发。本节是当前文件与合同的核查摘要，不新增设计或通过结论。

### 8.1 当前仓库与实际交付

| 核对项 | 实际结果 |
|---|---|
| checkout | 当前工作目录为本仓库根目录；远程origin为 `https://github.com/zhgqwx-del/mem-you-service.git` |
| 分支与提交 | `main`；HEAD与本地 `origin/main` 同为 `1e0f663c9ba7d5dc24639782de5032298906a3c0`；最近两次提交为交接文件和V1.2设计/调研基线 |
| 同步边界 | 上述认知核查阶段未联网fetch/pull，不能据当时本地origin引用断言远端没有新提交；后续提交/推送按用户授权执行并核对实际结果 |
| 开始时工作区 | 干净，无未跟踪文件；不存在 `.local/context.md` |
| 文件实况 | Git管理25个文件：24个Markdown及 `.gitignore`；仓库工作文件仅根入口、docs和research，没有服务源码、manifest/锁文件、配置样例、Compose、迁移、运行脚本或测试/报告文件 |
| 实现及验收 | 仍为设计V1.2修订1，服务尚未实现；没有可恢复的本服务数据库或现成评测数据包，没有已执行的合同/集成/中文效果/容量/恢复验收 |
| 本轮变更 | 仅更新本文的历史时点说明及本节认知/验证/未完项；未启动工程、安装依赖或更改业务/API合同 |
| Git交付状态 | 用户后续已授权提交并推送本文；上述HEAD为核查起点，交付提交以包含本记录的Git历史为准，远端可拉取状态以实际推送结果为准 |

### 8.2 已恢复的认知与查证地图

已核读根规则、完整交接Prompt、两级入口、00–07分册及research八份；两份废止方案仅作历史背景和迁移对照。后续以相应合同细节为准，下面只记录容易影响判断的关系。

| 主题 | 当前认知 | 查证入口 |
|---|---|---|
| 产品目标 | 新短记录到来时，用有帮助的历史改善回应、工具参数或澄清，并允许不用历史、避免重复打扰；显式历史QA分数不能单独证明收益 | [整体入口](spec-v1/README.md)、[论文与评测研究](../research/papers-frontier-notes.md) |
| 职责 | 产品/Agent持有原输入和执行journal；RecordService管正式条目、产品时间线及精确统计；MemoryService管获授权镜像、记忆证据、召回及失效。一次输入、多项事件、多张卡有不同身份 | [00职责与不变量](spec-v1/00-boundaries-and-invariants.md)、[03调用时序](spec-v1/03-agent-sequences-and-recovery.md) |
| 身份与权威 | tenant/owner为授权空间，about entity为陈述对象；来源/group、正式条目、memory及其版本分开。user_reported、external_committed、agent_inferred依可信通道区分；确认、置信度、时间和语气另保留 | [01数据模型§2–5](spec-v1/01-data-model.md) |
| 写入与更正 | 用户输入/Agent笔记可sync+CAS；正式镜像统一注册ordered_import，202仅接收，连续应用才有applied。实时与补采复用origin及planned source/group；不以latest CAS、相似文本或新ID覆盖/去重。更正同时限制关联原输入的旧断言 | [02公共合同与来源§2–3](spec-v1/02-api-contract.md)、[06身份规则§3](spec-v1/06-history-ingestion-and-repair.md) |
| 记忆与人工保护 | 每条陈述保留精确版本支持及来源闭包；实际语义支持均required。显式remember/revise与自动派生共用coarse slot及schema通配guard，人工保护不免除源失效。首版同源同类多事件可保守给复合陈述或gap，正式业务事件仍各自保存 | 01§5/§7.3、06§7；[修订取舍](spec-v1/07-v1.2-review.md) |
| 召回 | owner授权范围内近期/中文词法/dense/实体与类型字段融合，允许空包；词法实验基线为jieba搜索模式+BM25，dense为BGE-M3 1024维归一化表示，具体revision待冻结。前台不增加LLM规划或reflect。empty、degraded、未追上与失败分开 | [04检索与降级§1](spec-v1/04-evaluation-and-acceptance.md) |
| 入模与一致性 | 每turn持久一次context决策；已确认且不依赖历史的路径可skip。当前输入不冒充历史。所有full正文读取，包括补查/分页结果，共用context/read_result依赖包；新step、依赖历史的工具执行、交付前在线validate全部仍在用的包，租约/通知不能替代 | 02§2.6/§6/§12、03§2–3 |
| 授权与隐私 | 首发整源授权；混合主体/领域原文权限不足且无安全投影时拒返。非破坏使用策略与erase分开；Memory erase不自动删业务台账。本地不可查询、物理清理、消费者清理分别回执；无bundle/离线full宿主也可能有清理责任 | 00§6–8、02§10–14 |
| 故障与恢复 | product commit、Outbox、Memory失效与consumer清理是跨系统流程。action fence逐项关闭，未知提交/付费结果先核对。erase/撤权先独立故障域ledger再本地gate；旧库恢复须先追平当前控制日志、授权、流及消费者门禁，不能让删除回退 | 03§3.3/§5–6、04§8 |
| 历史依据 | Demo用于需求溯源且含mock；Agent/框架/论文研究提供带日期和版本的机制依据，不代表本服务已具备能力。自有来源模型与统一合同为基线，Hindsight/Mem0为可选效果对照，第三方框架不是首发前置 | [Demo审计](../research/demo-product-audit.md)、[框架研究](../research/memory-frameworks-notes.md)、[定向研究](../research/targeted-gaps-notes.md) |

首发与阶段不能混同：

- **A首发**：HTTP核心及一个点滴full_lifecycle适配器，含可靠输入journal、接入后稳定origin/来源计划、同身份重送、基础派生/人工保护、有序业务镜像、更正、持续原聊天删除/撤权、消费者清理及旧备份恢复门禁；history关闭不豁免生命周期。
- **B可选**：仅已登记、有可信source plan的接入后会话，有界手工MySQL catch_up/backfill及可选的已有source修复。源当前性、完整分页、持续删除、预算、取消和恢复缺任一前置时，仅preview/隔离测试。
- **C后置**：接入前历史bootstrap、自动发现/巡检、context主动repair、重抽/巩固等；search/facts、MCP、更多适配器、自动摘要、图、精细投影、在线双代索引及P1也分别验收。完整API目录不等于首发清单。
- **D1–D4是A的交付顺序**：基础合同/来源 → 召回与记忆 → 失效与完整接入 → 真实质量、P0和恢复验收。D1或服务夹具通过都不等于A完成，未完成D3不能上线个人记忆。精确出口见04§9–10。

### 8.3 本机外部材料与影响

| 材料 | 本次核对 | 影响与边界 |
|---|---|---|
| agent-service | 原路径缺失，相邻 `../agent-service` 存在；HEAD为固定审计commit `5d38b2cd6307aab9c8dec2c475b1bebf886d8283`，该commit对象存在 | 已有限复核同版本源码，能补强接入边界认知；未执行集成或运行环境验证 |
| Agent工作区 | `AGENTS.md`、`README.md`、`docs/PROGRESS.md`、`docs/operations/chat-h5.md`四份文档有已有未提交修改；已保留 | 不能沿用原机“工作区干净”结论；文档中的本机运行/验收陈述未独立复核，也不构成本项目执行授权 |
| 原始demo与旧05设计 | 第5.2节两个原路径均缺失，未提供其他映射 | 可依仓库内审计与历史说明继续设计分析；本轮不能重验HTML交互、原文件完整性或SHA-256 |
| 研究源码快照/在线资料 | 本轮未重新取得或联网核验 | 继承有日期/版本的静态依据；具体选型时再复核固定版本。部分研究仅核在线文档（如LangGraph），不能一概称固定源码审计 |
| 数据、模型及预算 | 本仓库无运行数据、数据集、模型制品或实际预算配置；外部Agent私有环境未检查 | 不影响本次认知恢复；真实集成、效果、费用、容量及恢复验证尚未具备本轮证据 |

Agent源码有限复核范围为其固定commit的 `packages/core/src/hooks/{middleware,lifecycle-types}.ts`、`packages/core/src/session/host.ts`、`examples/record-assistant/reference.ts`：memory-injection仍只拼静态prefix/append；model middleware限制messages不变；reference声明为单进程synthetic fixture并在turn外读取业务记录。它们不等于动态MemoryAdapter、持久journal或完整生命周期接入。未重审整个Agent，也未读取其私有运行证据、配置或真实密钥。

### 8.4 实际执行的核查与结果

以下为本轮实际使用的只读命令入口；两个仓库均未reset、切分支、安装、启动或运行模型。

```sh
pwd
git status --short --branch
git rev-parse --show-toplevel HEAD origin/main
git log -5 --oneline --decorate
git ls-files --stage
rg --files -g '!node_modules' -g '!.git' -g '!dist' -g '!build' -g '!package-lock.json' -g '!pnpm-lock.yaml'
git -C ../agent-service status --short --branch
git -C ../agent-service rev-parse --show-toplevel HEAD
git -C ../agent-service cat-file -t 5d38b2cd6307aab9c8dec2c475b1bebf886d8283
git diff --check
```

另以临时内联Python 3标准库程序完成文件清点、Markdown文件链接目标检查、JSON解析及context示例hash核对；没有新增项目脚本或伪造服务测试命令。

| 验证 | 实际结果及范围 |
|---|---|
| 文件与实现清点 | 25个受管理文件均已定位；仓库可见工作文件未发现源码/依赖/迁移/数据/运行报告 |
| 相对文件链接 | 修改前24份Markdown中116个相对文件链接目标全部存在；修改后128个目标全部存在。此检查不验证标题锚点、外网可达性或技术内容正确性 |
| 原机绝对链接 | 49处绝对路径引用的原路径均不存在；属于已知来源定位线索，保留历史路径。Agent按本机映射及固定commit复核上述有限范围，不能把其余引用一概算作已重验 |
| 规格JSON | spec-v1的9份Markdown中共34个JSON代码块，全部可解析；均位于02 |
| context字节示例 | canonical_injection可解析，根键恰为purpose/items/gaps，三字段与响应同名字段一致；确切UTF-8字节SHA-256与bundle_hash一致 |
| 修改差异 | 提交前`git diff --check`通过；本轮本仓库改动仅本文，外部Agent四份原有文档修改保留 |
| 未执行 | JSON Schema/HTTP合同测试、数据库/真实Agent集成、模型或识别效果、付费调用、压测、备份恢复/擦除演练均未执行。文档检查不替代这些验收 |

### 8.5 未完项与下次接续

本次认知恢复已完成，未发现必须现在变更合同才能继续的阻断项；这不等于穷尽设计缺陷或证明方案运行可行。后续由具体需求决定范围：

1. **可以直接继续的分析**：按00–04及06适用条款复核特定产品场景、接口/状态机、接入或验收闭环；追溯取舍读05/07和对应研究。无需先恢复全部外部项目。
2. **首次开发时再冻结的工程选择**：首发能力manifest、运行时/包管理器/数据库与扩展版本、DDL/JSON Schema、检索模型revision及词典/tokenizer摘要、独立control ledger载体与确认策略、配置和实际资源。公共语义已定义，不把这些机械化或工程交付误列为全部业务合同待定。
3. **真实接入待交付**：Agent的动态MemoryAdapter、可靠journal/回执恢复、原生来源计划、生命周期Outbox/ACK、持久pending fence和消费者清理；RecordService及产品工具按独立职责对接。相邻Agent存在不代表这些已完成。
4. **真实验收待建立**：版本化合成/授权脱敏fixture、100个owner时间线与至少600测试turn目标、封存金标准、固定reader/embedding/硬件与具名预算；P0的12万来源/5读2写RPS、质量门槛及RPO/RTO都是未实测目标，P1另行扩展。
5. **按需补外部证据**：需要重验原型/旧设计时补原文件并校验摘要；需要选型时取得对应固定源码。它们缺失不阻塞当前仓库内的设计分析，不能据此宣称原材料或运行结果已复核。

本次停在文档认知与交接更新。下一次仍先检查实际HEAD、工作区和文件，再按用户明确的设计或开发需求推进。
