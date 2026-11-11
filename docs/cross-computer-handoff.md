# 跨电脑开发交接说明

最近核对日期：2026-11-10（America/Los_Angeles）；初次上下文恢复见第8节，分层与原设计复核见第9节，Agent路径见第10节，外部研究核对见第11节，整体审查与修订2见第12节，概念/时序阅读补充见第13节，agent-service宿主接入评估与未完项见第14节，人工阅读/会议导航见第15节，前次Git交付见第16节，Anthropic研究评估见第17节，04/06补充见第18节，分层机制与LLM职责说明见第19节，Anthropic整体复核与Git交付见第20节，七模块文章评估见第21节，三项优化补充与检查见第22节，本次Git交付见第23节。初次交接记录使用2026-10-28（America/New_York），以下历史快照保留其适用时点。本文件记录交接状态与上手步骤，不新增业务/API合同。完整首次衔接指令见[可复制 Prompt](continuation-prompt.md)。

## 1 当前到底交付了什么

本仓库地址：<https://github.com/zhgqwx-del/mem-you-service>。

初次编写交接时，`main` 与本地 `origin/main` 均指向 `56733d1`，工作区干净。该提交是现有设计/调研基线；这是初次交接开始时的本地引用快照。交接文件随后在 `1e0f663` 中提交，首次本机认知恢复在 `b093074` 中提交；后续设计及路径核对见第9–10节。新电脑应核对实际分支、提交与远端同步状态，不固定退回旧提交。

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

下面位置与摘要来自初次交接时2026-10-28的只读核对，原电脑状态不代表当前电脑。没有读取真实 `.env`、导出聊天或复制外部文件。本机Agent核对见第8节，最新旧设计原文复核见第9节。

### 5.1 现有Agent项目：优先定位本机checkout

- 仓库：<https://github.com/zhgqwx-del/agent-service>，访问权限在新电脑单独配置。
- 已审计commit：`5d38b2cd6307aab9c8dec2c475b1bebf886d8283`。
- 原电脑位置：`/Users/zhangguoqiang/ai-workspace/claude-workspace/meetyou/agent-service`。
- 核对时为 `main`，HEAD与审计commit一致，工作区干净；未联网核对远端是否有更新。
- 证据入口：[聊天存储审计](../research/chat-storage-audit.md)。

2026-10-28本机映射已确认：仓库根为 `/Users/zhangguoqiang/ai-workspace/codex-workspace/agent-service`；宿主为其 `apps/agent-runner`，运行内核为 `packages/core`。本机HEAD及已有修改见第10节，不沿用原机工作区快照；非敏感路径已保存到被忽略的`.local/context.md`。

需要源码集成时，先核对本机映射的checkout；尚未准备时才在自选父目录另行clone。取得之后先核对HEAD：

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

初次交接时原文件仍在原目录，未为其建立备份；本机初次认知核查未找到这两个原路径。后续按用户指引找到桌面RTF，抽出的旧设计纯文与上表摘要一致，详见第9节；demo原文件仍未恢复。需要保留的原始材料应通过你认可的文件传输/备份渠道另行保存；收到后校验SHA-256。macOS可用 `shasum -a 256 <文件路径>`，Linux可用 `sha256sum <文件路径>`，PowerShell可用 `Get-FileHash -Algorithm SHA256 <文件路径>`，按实际路径加引号。

### 5.3 开源研究快照：按需重新取得

`research/`中部分源码曾放在 `/private/tmp/mem-you-memory-*` 或原电脑的本地快照目录。这些位置不是可持久依赖；需要复核时按研究文档中官方仓库和固定commit重新取得。无需在新电脑装齐七个Agent或全部记忆框架，不以最新main自动替代旧版本证据。

### 5.4 可选的本地路径映射

在新电脑建立 `.local/context.md`，例如下面内容；它仅记录路径和非敏感状态，不需要执行或source：

```text
MEM_YOU_ROOT: <本仓库绝对路径>
AGENT_SERVICE_ROOT: <另一个仓库绝对路径；未准备则写缺失>
AGENT_RUNNER_ROOT: <Agent仓库/apps/agent-runner>
AGENT_RUNTIME_CORE_ROOT: <Agent仓库/packages/core>
AGENT_SERVICE_HEAD: <实际git rev-parse HEAD结果>
DEMO_HTML: <HTML路径；可缺失>
LEGACY_DESIGN_MD: <旧设计路径；可缺失>
LEGACY_DESIGN_RTF: <同内容RTF路径；可缺失，提取后校验文本摘要>
LOCAL_SERVICE_STATE: <尚无实现 / 已建立本地开发环境>
```

这些是交接字段名，当前不是应用已经支持的环境变量。不要把密码、token、真实连接串填进去。

## 6 环境与数据什么时候需要补齐

| 当前任务 | 需要准备什么 | 缺失时可以做什么 |
|---|---|---|
| 继续设计分析 | 本仓库、Git、编辑器/开发助手 | 无需数据库或模型key |
| 从零实现服务D1 | 依据当前合同建立工程，冻结运行时/包管理器/数据库版本；补依赖锁、迁移、无密钥配置样例和启动/测试说明 | 先完成本地确定性合同测试和受控依赖 |
| 现有Agent源码集成 | 定位本机checkout或另拉agent-service，读其自身AGENTS/README及实际manifest，按新版本核对审计 | 缺项目时可开发明确标记的接口夹具；不能宣称真实集成完成 |
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

## 9 2026-10-28 分层澄清与旧设计整体复核

用户本轮先要求分析并按需补清MemoryService分层，再要求整体查看桌面《记忆层设计》、按需参考。范围为设计文档；未启动服务开发。

### 9.1 核查起点与原文证据

- 起点为 `main` / HEAD `b093074ccebf6d50bd3d7f0dd0a84d1431ec7a76`，当时本地 `origin/main`相同、工作区干净；本轮未fetch/pull，不声明远端当前状态。
- 已找到 `/Users/zhangguoqiang/Desktop/记忆层设计.rtf`（89822字节），SHA-256为 `54a3e16cb1754740b1ef5b8a515948cb67b98fbc9980db7dedaff7526a346538`。以textutil转换临时纯文后完整核读680行、43951字节，文本SHA-256为 `cf19f654ee744faf2924161659a9ddddb1ab95f331a7e21c972012ce0b66963f`，与第5.2节旧05设计一致；这更新了第8节当时“旧设计原件未复核”的状态。
- 原RTF未修改或复制进Git；临时文本不是持久依赖。可用 `textutil -convert txt -output <临时文本路径> <RTF路径>` 转换，再执行 `shasum -a 256 <临时文本路径>` 核对。旧稿价格、配额、模型效果、论文分数和微基准未联网核验或复测，没有取得旧会话运行证据。
- 仅定位用户指定的桌面文件，未读取真实密钥、运行数据或外部Agent私有环境。demo原件仍缺，其他开源快照本轮未重新取得。

### 9.2 实际设计增量

| 文档 | 本轮变更 |
|---|---|
| spec-v1/00 | 新增§4.1–4.4：L0来源、L1记忆、L2检索、L3受控交付；原文可直接召回/取证，摘要与小型画像同属受证据约束的内容；横向授权/失效与宿主epoch边界 |
| spec-v1/README、docs/README | 补入口与状态说明，指向唯一分层定义 |
| spec-v1/01 | §3对象映射、§9.3检索通道/融合/筛选/交付与阶段耗时诊断，不新增公共debug或正文日志 |
| spec-v1/03 | 明确画像不规定进入不可变system前缀，宿主contextEpoch不替代Memory版本、bundle校验与清理 |
| spec-v1/04 | §5.1复用既有验收映射；新增G13少历史场景；§6.3通道消融、时间错误与富化收益诊断；补实际速率限额、排队与积压归因 |
| research/completeness-audit | 新增§5记录原文来源、已吸收内容、有限补充和不沿用的旧假设；§1–4继续标明历史快照 |

分层澄清不改变V1.2修订1的公共API/schema、检索模型/维度与参数、A/B/C范围、数值发布门槛或D1–D4顺序。正式统计仍归产品，自动episode摘要和历史自动化仍按能力后置；未照搬旧情绪/声学量表、周期画像、256维blob或固定记录条数门槛。

### 9.3 实际验证与接续

- 实际执行 `git status --short --branch`、`git rev-parse HEAD`、`git diff --stat`、`git diff --check`；使用textutil转换及SHA-256核对原设计，以临时Python 3程序检查仓库内相对文件/标题链接、JSON解析与canonical_injection摘要。
- 静态核查通过：24份Markdown中137个仓库内相对文件链接及6个标题锚点有效；34个JSON示例均可解析且与本轮起点逐字相同，context示例的UTF-8 hash及内容一致。既有16条B不变量、34条C/A及15条H验收主矩阵行未修改，分层映射复用其ID，另新增G13；02/06全文、01 schema注册表与04检索基线保持不变。内部Mermaid图未做可视渲染验收。
- 两轮只读交叉审查已核对分层/能力范围及验收关系，并修正“摘要支持typed值”的反向表述为“摘要依赖已失效依据”；逻辑失效的本地保证起点明确为本服务applied。
- 服务仍无实现；未执行HTTP/JSON Schema测试、数据库/真实Agent集成、真实模型、消融实验、中文效果、容量或恢复演练。新增诊断与用例是待执行要求，不是通过报告。
- 本节设计复核结束时8份已有文档有修改，尚未提交、推送；后续路径补充见第10节。此前提交推送授权已用于 `b093074` 的认知交接包，本轮尚无新的提交/推送操作。

下一步由用户决定具体设计问题或开发切片。首次实现仍需冻结工程版本、schema/迁移、release manifest与控制日志载体，交付动态Adapter、产品工具及相应夹具/验收；本轮没有扩大这些实现授权。

## 10 2026-10-28 Agent Runtime本机路径确认

用户明确本机通用Agent/Agent Runtime参考为`codex-workspace/agent-service`中的agent-runner。本次重新只读核对后，将其作为当前机器映射；原机绝对路径继续保留为历史审计线索。

| 定位项 | 本机实际位置/状态 |
|---|---|
| Agent仓库根 | `/Users/zhangguoqiang/ai-workspace/codex-workspace/agent-service` |
| 运行宿主 | `apps/agent-runner`；`src/main.ts`的startRunner装配SessionHost、存储、provider、工具、引擎及HTTP服务 |
| 运行内核 | `packages/core`；会话、turn、模型/工具循环主要由`src/session/host.ts`等承载 |
| 固定版本 | HEAD为`5d38b2cd6307aab9c8dec2c475b1bebf886d8283`，与既有审计一致 |
| 已有工作区修改 | 仍为`AGENTS.md`、`README.md`、`docs/PROGRESS.md`、`docs/operations/chat-h5.md`四份文档；未修改外部仓库 |
| 本地保存 | 已建立`.local/context.md`，含仓库/runner/core、RTF及缺失demo等非敏感映射；`.gitignore`的`.local/`规则覆盖该文件，不随Git迁移 |

“通用记录型Agent”是应用角色，使用上述宿主和内核处理记录理解、工具及记忆编排；路径确认不表示MemoryAdapter、业务工具或点滴full_lifecycle接入已实现。当前入口查阅指向本机映射，历史快照不批量改写旧路径或旧行号。

同步调整完整衔接Prompt为优先读取本机映射，并在03§2.2补宿主/内核定位。实际核对了外仓HEAD、工作区和入口符号；本地映射忽略规则、所指目录/文件和文档差异静态检查通过，未启动或测试外部服务。本节路径确认结束时9份受管理文档修改及被忽略的本地映射尚未提交；后续资料补核见第11节，服务实现状态不变。

## 11 2026-10-28 上下文、Hy-Memory与锚点路线补核

本轮用户提供Context Rot、前史敏感性、Hy-Memory系列、Mem0/Letta/Zep/Graphiti/MemOS及GRPO/Agentic RL资料，授权进一步核对并按需完善设计。开始时main/HEAD仍为`b093074ccebf6d50bd3d7f0dd0a84d1431ec7a76`，已有第9–10节的9份未提交文档修改；本轮继承这些修改，没有reset、覆盖或启动开发。

### 11.1 一手证据与限定

- Chroma官方报告是2025-07-14，作者为Kelly Hong、Anton Troynikov、Jeff Huber；`2506.00069` v1为2025-05-29。受控上下文实验不提供本服务通用安全token阈值，极值下降也不能当百分点或产品故障率。
- Hy-Memory固定仓库为`988667cd876fb80bee6d618482f78a2fe426402c`、SDK 2.0.8；模型卡revision为`64a460a94d5498b7316fb02395c72d01c47a7347`。有限核对固定源码/指南及论文；CMB读相关章节并渲染首页，未验证数据包完整发布。论文一有Findings of EMNLP 2026正式条目，CMB仅核得官方自述投ICLR2027；SDK已有request_id/结果查询和快照，不能写成完全无幂等/恢复，也不能直接等同本项目完整生命周期合同。
- 四条路线重新核对commit：Mem0 `26cdefb46600c0fa5953c4b5ee5003c125539fc4`；Graphiti `72b5c59c06607e09ea855be61b6ff5a3446fc951`；Letta Code `85851b8a8cfd8efdbb6130aec555cb6e3c1e7c08`；MemOS `adcb9f270c982f2b9ff8db9714792829d3bd6ab8`。Letta提交UTC为10-29、LA为10-28；未改写旧快照。论文、OSS、托管能力分别记录，Zep旧94.8/93.4比较含跨论文引用条件，不外推本项目。
- GRPO核对DeepSeekMath、官方TRL及交互轨迹资料，不将“省掉critic”理解为训练无成本或必然稳定。用户两个中文文章标题无链接/原文，尚不能唯一定位；不声称已读。Zep根站URL经浏览工具不可达，已用官方help、仓库与原始论文完成相关边界核对。
- 浏览与固定源码读取仅为研究。外部模型权重未下载，未安装SDK/框架、登录托管服务、收集真实用户训练轨迹、调用模型或复现benchmark。临时下载不构成持久依赖；正式原文链接、版本与局限分别保存在三份research笔记中。

### 11.2 实际吸收与未扩大范围

1. 00§4.5明确可靠写入/失效控制与后台派生的分工，writer只提候选，reader/retriever分开；高级认知归纳不新增服务层号，派生压缩不损坏来源完整性。
2. 01§5.3补更正、真实状态变化、独立事件的轨迹语义，不新增链表API、强制图或任意旧版本回溯。
3. 04新增G14/G15及§6.4：干扰/长度/位置、总上下文与Memory预算区分、历史污染/失效、oracle诊断组和固定reader的writer专项对照；选固定代表变体，不引入全排列矩阵或新的分数门槛。
4. research/papers-frontier-notes§11、targeted-gaps-notes§6、memory-frameworks-notes§7保存一手核对；根README与docs索引同步入口。

公共API/schema、BGE-M3/BM25/RRF基线、预算上限、数值发布目标、A/B/C及D1–D4保持不变。未新增Hy-Memory依赖、全量金字塔、自动心理/跨域意图推断、主动提醒或RL训练；候选对照由后续明确需求及预算决定。

### 11.3 验证、状态与接续

实际执行 `git status --short --branch`、`git rev-parse HEAD`、`git diff --stat`、`git diff --check`及临时Python 3静态程序。结果：24份Markdown中143个相对文件链接、12个标题锚点及围栏检查通过；34个JSON示例与起点逐字相同且可解析，context内容/hash一致。既有16条B不变量、34条C/A及15条H主矩阵、02/06全文、01 schema注册表及04检索基线保持不变；G13/G14/G15已定义但未执行。`.local/context.md`仍被忽略。三路只读审查后补明Zep比较模型、用户显式计划与推断意图区别、旧revision读取限制；未生成运行通过报告。

当前仍只有文档。真实中文效果、writer消融、上下文曲线、费用/容量、故障及恢复均未执行；13份受管理文档累计修改及被忽略的`.local/context.md`仍在本地，未提交/推送。后续实际实现需先冻结工程、模型/词典/策略与数据manifest，建立受控夹具并按D1–D4交付；不能把此次研究或论文分数当成生产验收。

## 12 2026-10-28整体补审与V1.2修订2

本轮需求是再次整体review方案，按需补充完善，继续不启动开发。开始时checkout为main，HEAD及本地origin/main为`b093074ccebf6d50bd3d7f0dd0a84d1431ec7a76`，已有第9–11节13份文档修改；继承并保留，未reset。第11节“API未变、02/06全文未变”是本轮前的历史核查结果，不能用于描述修订2。

### 12.1 结论与实际修订

整体边界、L0–L3逻辑分层和A/B/C、D1–D4切片可继续作为实施基线；尚不具备上线或效果结论。主审与三路只读复核发现反例后，已直接修订00–04及06，决策归纳见07§5–6：

1. 必要约束独立完整核验，不受6项一般偏好/160普通候选cap裁掉；超token/item/字节限返回422，不可核验503/504，不借safe partial漏约束。
2. 已擦除镜像的合法后续有序事件以policy_suppressed安全消费，applied回执增加import_outcome；不物化正文/新修订，但仍执行旧raw主张失效及blocked origin门禁，推进连续水位且不阻无关流。原操作结果重放不换latest。
3. 控制面grant允许显式枚举最多32域，单对象及显式查询filter仍8；省略过滤不截前8，owner操作须全目标授权。窄域/窄主体首读前核完整标签证明，未知正文只向owner_space且当前全域授权者交付或拒返。
4. 产品本地业务/event/seq/Outbox须原子或等价可恢复，回滚不留无法解释的序号孔洞；跨系统仍为saga。
5. facts实际排序键按time_basis；date有效期须唯一可靠来源时区，否则要求带偏移timestamp；valid_at仅筛当前可用头，不回放被替代旧修订。heartbeat失租/断档须discard并reset；大范围resolved_targets保留有界selector，不截断实际执行。
6. P0/P1区分90%/5%/5%池流量与实际冷首读，另做100次缓存冷启动阶段；模型、RRF、预算及SLO数值不变。04§5.2将修订反例纳入既有C/A及D阶段；主矩阵未增另一套编号。

本轮累计16份受管理文档修改，包括原13份及02、06、07；AGENTS.md与外部Agent仓库未改，不新增运行依赖、接口端点或首发功能。入口和完整衔接Prompt同步修订2。正文细则以分册为准，此处不是第二份合同。

### 12.2 实际验证与Git状态

实际执行`git status --short`、`git rev-parse HEAD`、`git diff --stat`、`git diff --numstat`、`git diff --check`、`git check-ignore -v .local/context.md`及临时Python 3静态程序，结果：

- 仓库24份Markdown的144个相对文件链接、13个标题锚点、围栏检查通过；49个历史绝对路径链接按交接约定不当作本机有效路径验收。
- 全仓35个JSON围栏可解析；本次相对起点仅heartbeat.required_action改为discard_all_bundles_and_reset，其余示例逐字不变，canonical_injection与SHA-256及顶层purpose/items/gaps相同。第11节的34个计数有遗漏，本轮按全仓统计更正为35。
- 16条B、34条C/A及15条H主矩阵ID保持一致；公共schema注册表、04§1.1模型/索引规则、RRF及预算数值未变。P0 20×5、P1 1×100均为100个计划冷启动样本，只核算了计划，未执行压测。
- 当前合同入口及00–04/06版本头均为修订2；`.local/context.md`仍被忽略。外部Agent HEAD仍为`5d38b2cd6307aab9c8dec2c475b1bebf886d8283`，仍只有原4份文档修改，本轮未改外仓。
- 第一轮基线对照脚本因`git ls-files`默认转义中文路径而未跑完；改用`git ls-files -z`后完整重跑通过。没有将失败程序的局部检查当作完整通过。

当前仍无服务源码、依赖清单、迁移、自动化测试或运行报告；C/A/H与04§5.2、真实模型/效果、性能和恢复均未执行。本节随累计16份文档变更形成交付快照，沿用用户此前允许提交和推送的授权；包含本节的Git提交是追溯入口，实际提交及远端同步结果需以Git命令核对，不在文件里硬编码包含自身的commit。

### 12.3 未完项与后续入口

- 按D1先冻结工程/数据库/依赖、ledger故障域及读侧核验、产品工具与Outbox映射、paid invocation/重试映射、能力和评测manifest；然后才进入实现。本次无代码开发。
- D3失效/full消费者和D4真实中文效果、P0/费用及恢复报告全部待执行；D1/D2完成不代表可上线。高级摘要、接入前历史bootstrap、自动巡检/巩固、图或RL继续按明确需求后置。
- demo HTML仍缺，无法重放原界面；两个中文RL文章无原文/链接，无法唯一核验。已定位RTF和固定Agent版本足够支持本轮合同审查，缺失材料不阻塞已完成部分。路径采用`.local/context.md`，其余固定来源及限定见第9–11节。

## 13 2026-10-30 概念说明与端到端时序阅读补充

本轮需求是将聊天中的概念解释和常见场景写入、读取、更新时序补入现行文档，不开发代码。起点为main／`e560a91457d7fa35beb99aa2e1c5d1e98afa3b00`，工作区干净；未fetch/pull，不据本地origin断言远端当前状态。

### 13.1 完成范围与实现状态

- [00§2.1–2.3及§3.2](spec-v1/00-boundaries-and-invariants.md#21-组件位置与部署含义)：BFF、组件位置与部署、RecordService Outbox、source_group/source/memory、picker、两路来源镜像，以及“外部承担”和demo证据边界。
- [03§4](spec-v1/03-agent-sequences-and-recovery.md#4-代表调用时序)：增加场景导航、接口职责和共同门禁说明；§4.7以通用回复偏好、§4.8以饮水记录分别串联写入、后续读取和更新。每案例拆成三个连续小图，沿用同一来源/记录身份，包含补查依赖、有序事件、旧证据失效、清理和pending分支。保留原§4.1–4.6及两张既有时序图。
- [整体入口](spec-v1/README.md)与[文档状态索引](README.md)增加阅读指引；[04§5.3](spec-v1/04-evaluation-and-acceptance.md#53-常见场景时序的验收映射)只将图中场景对应到既有用例，不改固定金标准或另加验收编号。
- 继续采用V1.2修订2；没有改API、schema、数值限额、A/B/C范围或恢复保证。仍无服务源码、依赖清单、迁移、自动化测试及运行报告，未修改外部Agent项目、安装依赖或调用真实模型。原HTML未重新核对，demo说明依据已保存审计。

### 13.2 实际验证与交付状态

实际执行`git status --short --branch`、`git rev-parse HEAD`、`git log -3 --oneline`、`git diff --stat`、`git diff --numstat`、`git diff --check`，以及临时Python 3标准库检查和本机Mermaid解析：

- 24份Markdown的164个相对链接、21个标题锚点及围栏检查通过；49处历史原机绝对路径按既有约定不当作本机有效链接。35个JSON示例可解析且与HEAD逐字相同，含原context内容/hash示例。
- 01、02、06全文未改；16条B、34条C/A、15条H主矩阵逐行未改，00/03的既有Mermaid代码块保持。只有说明、导航、示例图及既有验收映射增加。
- 本地Obsidian内置Mermaid 11.13.0只读提取到临时目录，用`node /private/tmp/mem-you-mermaid-kk_vm19i/parse-markdown.cjs docs/spec-v1/03-agent-sequences-and-recovery.md`实际解析03全部8张时序图（2张既有、6张新增阶段图），均通过。该脚本和解析器为本机临时验证材料，不是仓库交付依赖；本次未执行视觉渲染，不据此宣称全仓Mermaid已验证。
- 主审及独立只读复核后，补齐目标核对工具前的bundle校验，并将过长的完整图拆成连续阶段；未执行服务合同/集成测试、模型效果、压测或恢复演练，文档检查不代替运行验收。

首次阅读补充结束时，累计6份文档修改仅在本地，尚未提交或推送。用户随后明确授权检查后提交并推送；提交前独立只读审查未发现阻止提交的问题，链接/锚点、JSON、既有矩阵及8张时序图语法复核均通过，并执行`git fetch origin main`核对远端进度。本节随这6份文档形成交付提交，实际提交及远端同步结果以Git命令核对，不在文件内硬编码包含自身的commit。本轮未新增可运行服务或演示实例。

### 13.3 未完项与接续

此次阅读补充已完成。若继续完善文档，先核对实际HEAD及工作区，再按具体问题定位00–04/06；若用户后续要求开发，仍从04的D1工程与基础合同开始，D3完整生命周期、D4中文效果/P0/恢复验收均待执行。新的图示不构成自动启动实现、历史扫描或真实付费调用的授权。

## 14 2026-11-02 agent-service宿主接入评估与设计细化

本轮用户指定本机agent-service作为通用记录Agent运行时，要求评估完善逻辑架构、依赖和流程的价值与必要性。范围为源码只读核查及本仓设计调整；未启动服务开发。

### 14.1 基线、证据及完成范围

- 本仓起点为干净`main / b1b4d35`；外仓为`/Users/zhangguoqiang/ai-workspace/codex-workspace/agent-service`，干净`main / ca24972f6094bbf48658e60113d19112290e2544`。未fetch/pull，不据本地origin引用断言远端状态。
- 已核外仓AGENTS、README、PROGRESS当前/相关末节、架构及业务任务/上下文设计，并定向查SessionHost、context、hooks、engine接口、runner装配/读取、记录助手参考、原生item、MySQL分页及生命周期dispatcher。相对旧`5d38b2c`的增量仅9份文档，源码没有因此新增Memory能力。未访问.env、私有配置或.local-run验收原件，未修改外仓。
- 00新增§4.6具体架构图及业务/来源/使用三类链路；03§2.2明确MemoryAdapter与Host通用门禁分工、历史/水合/摘要前失效、递归依赖与交付/重放；§3.1补产品operation/Runtime身份、创建unknown及回执语义。
- 06§6.1补原始content/原生身份、受保护导出与独立源控制ACK；04§5.4/§9把实际宿主缺口映射到既有验收及D阶段；07§7记录必要性和取舍，两级入口及衔接Prompt同步。三路独立只读审查后修正源码时序、原生ID持久就绪条件、picker保存与后续反馈的阶段边界及迁移文件路径。
- 继续采用V1.2修订2；01/02、公共schema/JSON、检索基线和SLO、B/C/A/H主矩阵及A/B/C范围不变。只细化宿主/消费者责任，不声明Runtime规划协议已交付，也不把B扫描、子任务、长期workflow或完整M3/M4/P2列为A新前置。

### 14.2 实际验证与Git状态

实际执行两仓`git status --short --branch`、`git rev-parse HEAD`、`git log`及外仓固定commit间`git diff --stat`，本仓`git diff --stat/--numstat/--check`；另以临时Python标准库脚本检查受管理Markdown、链接/锚点、JSON、主矩阵及旧图保留。结果如下：

- 24份Markdown的176个仓库内相对链接、32个标题锚点及围栏检查通过；46处历史绝对路径引用按交接约定排除。35个JSON示例与HEAD逐字相同且均可解析；01/02全文未改，16条B、22条C、12条A及15条H主矩阵逐行保持，既有Mermaid代码块保留。
- 本机Obsidian附带Mermaid 11.13.0的临时VM解析器先通过03的8张时序图，解析flowchart时因缺少DOMPurify DOM环境失败（addHook/sanitize），没有当作图语法通过。改用临时独立、禁止网络请求的Playwright/Chrome页面后，00、03和整体README的全部12张图解析通过；新增00§4.6架构图实际渲染并查看，缩短重叠标签后复核。首次沙箱内Chrome启动SIGABRT；经自动审查允许的临时浏览器执行后完成，没有访问现有浏览器profile或项目服务。
- 实际命令入口为`python3 /private/tmp/mem-you-runtime-static-check.py`及`node /private/tmp/mem-you-runtime-browser-qa.cjs docs/spec-v1/00-boundaries-and-invariants.md docs/spec-v1/03-agent-sequences-and-recovery.md docs/spec-v1/README.md`。临时脚本、Mermaid和架构PNG仅是本机静态验证材料，不是服务依赖或跨电脑交付物。
- 收口时本仓9份受管理Markdown有修改，尚未提交/推送；外仓HEAD仍为上述ca24972f且工作区干净。MemoryService仍无源码/依赖/迁移/运行报告；未执行HTTP合同、数据库、真实Agent集成、模型/费用、性能或恢复验收。图文核查不代替这些验收。

### 14.3 未完项与接续

1. 后续若授权开发，D1先冻结工程/迁移、产品持久journal与主体/权限映射、Host通用来源/依赖接口及runner装配边界。MemoryService仍无源码、依赖清单、迁移或运行报告，不虚构启动命令。
2. D2需要动态证据及实际使用校验；无模型picker需Host可信非模型输入接收/确定性执行接入，不能用普通turn或stream=false替代。原生item持久就绪前可靠排队，正式记录/记忆/分析分别恢复。
3. D3完成历史/工具/assistant/压缩及交付重放副本的失效闭包、持续源控制和反向consumer清理及各自ACK；外仓现有静态memory、工具observer、SSE和dispatcher complete均不能代替这些能力。
4. session创建unknown当前保留pending并停止自动重建；精确自动恢复仍需Runtime创建收据/只读核对的后续协议。B完整来源导出、子任务依赖按启用范围另验；真实质量、费用/P0及恢复报告仍待D4。

本次不修改/启动外部运行时、不新增真实模型调用或生产配置，不提交或推送。下一轮先核对实际工作区，再按明确需求推进。

## 15 2026-11-02 人工阅读与会议分享导航

用户询问新手快速阅读入口及会议介绍应展示哪些文档。继承第14节的9份未提交修改，本轮只补阅读导航：在spec-v1/README新增§0，列出约20–30分钟阅读路线、15分钟会议选段、案例替换及背景/协作资料用途；根README与docs/README增加直达入口。不另建第二份方案或演示稿，不改业务/API合同、模型、指标、图或验收用例。

导航经独立只读复核，建议阅读时间合计26分钟、会议合计15分钟，章节/案例及A/B/C边界准确。实际执行`python3 /private/tmp/mem-you-runtime-static-check.py`、`git diff --check`、`git diff --stat`及标题定位：24份Markdown中190个相对链接、43个标题锚点及围栏检查通过；35个JSON示例、01/02全文、B/C/A/H主矩阵和既有Mermaid与HEAD保持一致。此次没有新图，未重复运行浏览器渲染或任何服务/模型测试。

累计10份受管理Markdown修改仍未提交/推送；服务实现与后续接入未完项保持第14节。后续人工阅读直接从spec-v1/README§0开始，开发仍以相关合同及D1–D4为准。

## 16 2026-11-02 全部文档复核与Git交付

用户随后明确授权检查第14–15节累计10份文档修改，无问题后提交并推送。第14–15节的“未提交/不推送”为当时快照，后继交付以本节和实际Git历史为准。本轮没有扩大到服务实现或外部项目修改。

- 主审及三路独立只读复核覆盖全部diff：架构/Host流程、来源控制与验收映射、入口/阅读导航及交接状态，未发现阻止提交的问题。固定源码证据仍为agent-service的ca24972f；不将其后续未提交设计吸收进本次方案。
- 重新执行`python3 /private/tmp/mem-you-runtime-static-check.py`及`git diff --check`：24份Markdown的190个相对链接、43个标题锚点、围栏通过；35个JSON示例与HEAD相同，01/02、16条B/22条C/12条A/15条H主矩阵及旧图保持。架构与时序图的解析/渲染证据见第14节，本轮未修改图。没有运行服务、真实模型或集成验收。
- 实际执行`git fetch origin main`及`git rev-list --left-right --count HEAD...origin/main`，提交前本仓HEAD与origin/main均为b1b4d35、分叉计数0/0；随后按本次授权提交这10份Markdown并正常推送，不强推。包含本节的提交由Git历史定位，远端同步结果以实际命令核对，不在文件中硬编码自身commit。
- 外仓本次复核时HEAD仍为ca24972f，但工作区已由其他工作产生5份已跟踪文档修改及新增`docs/design/11-source-context-invalidation.md`；不是第14节起点的干净状态。本轮未读取/吸收这些新设计，也未修改、提交或推送外仓。

交付内容仍仅为设计与阅读指引；实现/真实验收未完项保持第14.3节。后续从spec-v1/README§0人工阅读，开发按现行合同和D1–D4继续。

## 17 2026-11-08 Anthropic Agent Memory调研评估

用户要求阅读Anthropic于2026-11-06发布的记忆文章，评估对当前方案/流程的参考价值及调整必要性。起点为干净`main / ca0999ccf580cac9e4f7f545b14e764fdd086a42`；未fetch/pull，不据本地origin判断远端当前状态。

- 新增[专项评估](../research/anthropic-agent-memory-review.md)，同步根README与docs索引。原文、Dreams文档、dynamic workflow cookbook及knowledge-wiki固定版本共同核对；wiki固定commit为`4a4224bdf0e9cfb3332167b69c90457403813625`，不混用目录页旧缓存方案与当前README。三路独立只读核对覆盖合同、流程/评测及配套版本；外部agent-service未重新审计或修改。
- 结论：现行L0–L3、来源直检、快慢路径、CAS/slot、人工保护和生命周期合同保持。值得细化的候选为writer提示/显著性对照、C阶段定向派生复核、后台维护的体积/复用/摊销报告；未将它们写成新增首发义务。原话只证明陈述，不升级客观/医学事实；Agent执行经验和operation状态不混入用户事实。
- 本轮只改研究、入口与交接4份Markdown，`docs/spec-v1/`全部保持HEAD内容，设计仍为V1.2修订2，API/schema、模型/预算/SLO、验收矩阵及A/B/C不变。没有服务源码、依赖、迁移或运行报告；未安装SDK、运行示例、调用付费模型或生产服务。
- 实际执行`git status --short --branch`、`git rev-parse HEAD`、`git diff --check`、`git diff --numstat`、`git diff --quiet HEAD -- docs/spec-v1`及`python3 /private/tmp/mem-you-anthropic-static-check.py`。25份Markdown的202个相对文件链接、51个标题锚点、围栏及35个JSON解析通过；JSON示例与HEAD逐字相同，46处历史绝对链接按既有约定排除。临时检查器初版误删标题中的下划线造成锚点误报，修正后完整重跑通过；脚本属于本机临时验证材料，不是服务或交付依赖。

上述4份文件留在本地，未提交/推送。研究结论不代表合同、模型效果或集成验收通过。后续实施仍按D1–D4；若以后采纳候选实验或启用C，届时同步相关合同与适用验收，不从本文自动启用历史扫描、全库dreaming或真实模型调用。第14.3节的实现未完项保持。

## 18 2026-11-08 写入评测与维护成本方案补充

用户随后授权将写入策略评测、后台维护成本补入04，在06中明确定向派生复核属于C，保持API、数据模型、首发A范围和数值门槛不变，并整体检查。起点仍为`main / ca0999ccf580cac9e4f7f545b14e764fdd086a42`，继承第17节4份本地文档修改；未fetch/pull或覆盖已有内容。

- [04§6.4.1](spec-v1/04-evaluation-and-acceptance.md#641-写入策略的可选对照)增加基础抽取、任务用途指引、候选选择空间的可选对照，固定控制变量、禁止未来信息/封存测试泄漏，分别报告候选、服务拦截和发布后错误。§7.3.1补历史存量、建设/维护/读取/清理、失败及零复用产物、未决费用和摊销口径；费用未决不声称完整总成本或确定已摊销。
- [06§7.3](spec-v1/06-history-ingestion-and-repair.md#73-定向派生复核c扩展)将定向复核明确为C的既有reextract/巩固策略，沿用来源/人工保护/发布/取消/删除门禁，04§10同步C2固定变体。不新增mode、repair_kind、端点或对象；未启用定向复核不影响其他已声明重抽pipeline，A的可靠重试、明确更正和失效不后置。
- 同步整体入口、docs索引、根README与research的后续采纳状态；继续采用V1.2修订2。00–03及05/07全文不变，04检索/抽取基线、效果/容量/时间门槛、原交付顺序及06控制API/持久对象不变，A/B切片逐行保持。
- 主审及三路独立只读检查覆盖评测、费用、C边界和跨册一致性。实际执行`git diff --check`、`git diff --stat/--numstat`及`python3 /private/tmp/mem-you-anthropic-design-check.py`：25份Markdown的216个相对文件链接、64个标题锚点、围栏及35个JSON解析通过；JSON示例与HEAD逐字相同，16张Mermaid与本轮起点相同。16条B、15条G、22条C、12条A及15条H主矩阵逐行未改；46处历史绝对链接按既有约定排除。临时Python标准库检查器另对上述受保护文件/章节及A/B切片做逐字对照，不是运行测试或交付依赖。

当前累计7份Markdown修改留在本地，未提交/推送；01/02及外部agent-service未改。仍无服务源码、依赖、迁移或运行报告，未执行服务/模型效果、付费调用、性能或恢复验收。下一步实施仍按D1–D4；新增可选评测及C规则只在适用时执行，不自动开启扩展。第17节“仅研究、合同未改”是此前快照，本节为后继状态。

## 19 2026-11-09 分层构建与LLM职责阅读补充

用户授权将四层构建/更新/维护、Anthropic形态与L0–L3的对应、LLM/prompt/dreaming职责补入方案，保持API、数据模型及首发范围不变。起点仍为`main / ca0999ccf580cac9e4f7f545b14e764fdd086a42`，继承第18节7份本地修改，未fetch/pull、reset或覆盖已有补充。

- [00§4.1.1–4.1.2](spec-v1/00-boundaries-and-invariants.md#411-各层的构建与维护机制)补各层准入/派生/检索/交付及维护表，用长期回复偏好变化串联新来源、记忆修订、索引刷新与旧包/Host清理；不回改旧原话，不扩大MySQL不可变原消息能力。
- [00§4.5.1–4.5.2](spec-v1/00-boundaries-and-invariants.md#451-llm与prompt的职责)区分LLM语义候选、embedding、程序发布/失效与主Agent职责；Anthropic的wiki正文对应L1可选内容，索引/导航涉及L2，注入由harness执行。Dreaming是后台方式，定向复核/巩固仍属C，A基础抽取/重试/更正不后置，摘要按独立能力启用；明确实际prompt和有用性实现尚未交付。
- 同步两级阅读入口及research后续说明。本轮只修改上述00、spec-v1/README、docs/README、research和交接5份；01–07与本轮起点逐字相同，00除日期说明及上述新增小节外全文相同。API/schema、模型/RRF/预算、数值门槛、A/B/C及验收主矩阵不变，未新增图或模板。
- 主审及两路独立只读复核未发现阻止交付的问题。实际执行`git status --short --branch`、`git rev-parse HEAD`、`git diff --check`、`git diff --stat/--numstat`及`python3 /private/tmp/mem-you-layer-explanation-check.py`：25份Markdown的227个相对文件链接、74个标题锚点、围栏及35个JSON解析通过，JSON与HEAD逐字相同；16张Mermaid及16条B、15条G、22条C、12条A、15条H主矩阵与本轮起点相同。46处历史绝对链接按既有约定排除。临时Python标准库检查器另验证受保护分册全文及00只增解释，不是服务测试或交付依赖。

当前累计8份Markdown修改留在本地，未提交/推送；服务仍无源码、依赖、迁移或运行验收，外部agent-service未读取或修改。此次仅作阅读说明，未调用真实模型或付费服务；下一步实施仍按D1–D4和实际启用能力执行。第18节7份本地修改及其逐字不变范围属于当时快照，以本节为后继状态。

## 20 2026-11-09 Anthropic全部文档复核与Git交付

用户明确授权整体检查第17–19节累计8份文档，无问题后提交并推送。起点仍为`main / ca0999ccf580cac9e4f7f545b14e764fdd086a42`，工作区仅有这8份修改；本轮不扩大到服务实现或外部项目。

- 主审及三路独立只读复核覆盖00分层/LLM、04评测/费用、06的C边界、research一手证据与入口/交接状态，未发现阻止提交的问题。提交前将企业语料53%/61%/48%明确为评分标准达成情况，并将偏好示例写为明确的长期变化；不改实验数字或来源版本。
- 以ca0999为统一基线执行`python3 /private/tmp/mem-you-anthropic-precommit-check.py`、`git diff --check`及暂存后的`git diff --cached --check`。25份Markdown的227个相对文件链接、74个标题锚点、围栏及35个JSON解析通过，JSON示例与基线逐字相同；16张Mermaid与基线相同。16条B、15条G、22条C、12条A及15条H主矩阵逐行不变，46处历史绝对链接按既有约定排除。该统一检查器替代只适用于先前阶段的“00未改”断言，属于本机临时验证材料，不是服务依赖。
- 01/02/03及05/07全文与基线相同；00仅新增解释；04的检索/抽取基线、效果/容量/时间目标、交付顺序及06的控制API/持久对象、A/B切片均保持。继续采用V1.2修订2，不新增接口、数据模型、首发功能或数值门槛。
- 实际执行`git fetch origin main`及`git rev-list --left-right --count HEAD...origin/main`，提交前HEAD与origin/main均为ca0999、分叉计数0/0。Git交付范围限定这8份Markdown，按本次授权提交并正常推送，不强推；含本节的提交及远端同步结果由Git历史和实际命令核对，不在文件内预写包含自身的commit。

第17–19节“未提交/推送”均是对应阶段快照，后继交付以本节及实际Git结果为准。交付仍仅为研究、方案细化与阅读指引；无服务实现、真实模型、合同/集成、性能或恢复验收，未读取密钥或改动外部agent-service。后续开发仍按现行合同及D1–D4推进。

## 21 2026-11-10 Agent Memory七模块文章评估

本轮用户要求阅读桌面Memory技术调研目录中的七模块文章，评估对当前方案及流程的参考价值与调整必要性。起点为`main / 400a911`，工作区干净；未fetch/pull，不据本地引用断言远端当前状态。

- 新增[研究评估](../research/agent-memory-seven-modules-review.md)，同步根README与docs索引。以Python标准库解析本机HTML的`js_content`并核对大小/SHA-256，完整核读正文；正文3张图为远程懒加载且未能读取，不宣称核验图中文字。原HTML未修改或复制进Git，临时纯文不作为持久依赖。
- 对照00–04及06，另核读LangChain官方Memory overview、LangGraph Persistence和2026-06-24工程文章。主审及两路只读分析均认为主要内容已覆盖；值得保留的是分类/职责说明、少量夹具及反馈诊断建议。三路信息源不等于服务内部检索通道，显著性筛选不决定可靠来源保存，执行经验不自动升级为用户事实或系统指令。
- 本轮仅研究、入口与交接4份Markdown变更；`docs/spec-v1/`全文不变，设计继续为V1.2修订2，API/schema、模型/预算/SLO、A/B/C和验收门槛不变。没有开启历史扫描、定向复核、训练或自动学习，也未调用真实模型、付费/生产服务或修改外部agent-service。

- 实际执行`git status --short`、`git diff --check/--stat`、`git diff --quiet HEAD -- docs/spec-v1`和`python3 /private/tmp/mem-you-seven-modules-check.py`。26份Markdown的245个相对文件链接、88个标题锚点、围栏及35个JSON解析通过；既有JSON/Mermaid围栏与HEAD逐字相同，46处历史绝对链接按既有约定排除，本机原HTML摘要复核通过。首次静态检查发现研究报告的两个章节锚点写错，已修正并完整重跑；临时检查器不是服务或交付依赖。报告交叉复核另澄清原生身份晚到不阻塞确定性正式提交，以及原文可直接召回、不以writer为前置。

上述4份文档留在本地，未提交或推送。仍无服务源码、依赖、迁移或运行报告；真实中文效果、合同/集成、成本/容量及恢复验收未执行。候选夹具、诊断与说明优化尚未成为新合同或实现；后续若采纳，按其实际范围同步相关合同及适用验收，实施仍沿现行D1–D4。

## 22 2026-11-10 分类说明 固定变体与反馈诊断补充

用户授权将第21节研究中的三项小幅优化补入现有方案和验收，要求保持API、数据模型和首发范围不变，暂不开发服务，完成后整体检查。起点仍为`main / 400a911`，继承第21节4份本地文档变更，未fetch/pull或覆盖已有内容。

- [00§4.1.3](spec-v1/00-boundaries-and-invariants.md#413-agent信息来源与记忆分类维度)增加Agent三类信息来源、责任方及分类维度表，区分宿主编排与Memory内部检索；不新增知识库、memory_kind或独立组件。[§4.5.3](spec-v1/00-boundaries-and-invariants.md#453-反馈诊断与受控修订)明确诊断后选择提示/策略/工具/代码/夹具修复，反馈不自动升级用户事实或程序指令。
- [04§5.5](spec-v1/04-evaluation-and-acceptance.md#55-记忆触发偏好与事件身份的固定变体)增加五组既有验收变体：无关键词但有适用必要约束、临时/长期偏好变化、重复当轮反馈、同slot人工保护、独立饮水与指定更正。复用C/A/G/W/H的适用ID，不要求跨来源自动合并偏好，不改变原W时间线。[§6.3.1](spec-v1/04-evaluation-and-acceptance.md#631-反馈诊断与修复报告)补六类诊断及最小报告口径，不新增公共日志字段、全量Trace或真实轨迹采集义务。
- 同步spec-v1入口、docs索引、根README和研究采纳状态，累计7份Markdown本地变更；继续采用V1.2修订2。01/02/03及05/06/07全文不变，API/schema、A/B/C、检索/抽取基线、预算/SLO、数值门槛和验收主矩阵均保持。仅新增说明与既有用例的细化，尚无夹具、诊断报告或服务实现。

- 主审及两路只读交叉审查未发现阻断项；按复核建议明确“反馈形成用户新披露”的语境，可信外部回执仍走既有镜像路径。实际执行`git status --short`、`git diff --stat`、`git diff --numstat`、`git diff --check`和`python3 /private/tmp/mem-you-seven-modules-design-check.py`：26份Markdown的264个相对文件链接、106个标题锚点、围栏及35个JSON解析通过；16张Mermaid与本轮起点逐字相同，46处历史绝对链接按既有约定排除。逐字保护检查确认01/02/03/05/06/07全文不变；00/04移除本轮日期说明及四个新增小节后与起点全文相同，87条既有B/G/C/A/H/W主矩阵行保持。spec-v1入口的发布切片及后续章节亦与起点相同。临时标准库检查器为本机静态验证材料，不是交付依赖或服务测试。

上述7份文档仍在本地，未提交或推送；没有新增源码、依赖、迁移或运行报告。本次未调用真实模型、付费/生产服务或修改外部agent-service，真实中文质量、合同/集成、成本/容量及恢复验收均未执行。第21节“合同未改、建议未采纳”是首次研究快照，本节为后继文档状态。后续仍按现行D1–D4建立实现与实际验收，不自动开启C或学习任务。

## 23 2026-11-10 七模块研究与方案验收文档Git交付

用户明确授权将本次调研及方案、验收修改一起提交并推送GitHub。起点为`main / 400a911`，工作区仅有第21–22节的7份Markdown变更。实际执行`git fetch origin main`与`git rev-list --left-right --count HEAD...origin/main`，提交前分叉计数为0/0，远端基线与本地一致。

- 提交范围限定根README、docs索引、本文、spec-v1入口、00、04及七模块研究评估；原HTML、临时检查器、忽略的本地映射和外部项目不纳入提交。交付继续为V1.2修订2文档补充，不新增服务实现。
- 提交前重跑`python3 /private/tmp/mem-you-seven-modules-design-check.py`、`git diff --check`及暂存后的`git diff --cached --check`；26份Markdown的264个相对链接、106个标题锚点、围栏及35个JSON解析通过，16张Mermaid和87条原验收主矩阵行与本轮起点相同。01/02/03/05/06/07全文保持，00/04原有内容逐字保持；API、数据模型、首发范围、算法及数值门槛不变。独立只读复核未发现提交阻断项。
- 本节随上述7份文档按用户授权提交并正常推送`main`，不强推。包含本节的提交与远端同步结果以Git历史及实际命令核对，不在文件内预写包含自身的commit。

第21–22节“未提交/推送”均为当时快照，本节为后继Git交付记录。夹具、诊断报告、服务实现及真实验收仍待按D1–D4交付；本次未调用真实模型、付费/生产服务或修改外部agent-service。
