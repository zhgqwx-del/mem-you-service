# Mem0 功能部署与 Agent 集成专项调研

核查日期：2026-11-13（America/Los_Angeles）。面向希望给自研 Agent、Pi、OpenCode 和 DeepSeek Harness 增加跨会话记忆的研发人员。

**Mem0 适合把对话中的偏好、背景、项目决策和可复用经验提取出来，再按问题召回。** 开源 SDK、自托管 REST 服务和托管 Platform 提供了不同的运行方式；Pi、OpenCode 和 DeepSeek Harness 已有 Mem0 官方插件，但宿主版本兼容和是否支持自托管必须分别检查。对于本仓库的个人记录服务，Mem0 更适合作为可替换的抽取与召回实现或实验对照；接入后仍需承担来源、业务身份、授权、更正、完整擦除和宿主副本清理。

本文独立介绍 Mem0，并在第11节讨论与本项目的关系。它是带版本的研究依据，不修改 [V1.2 修订2现行合同](../docs/spec-v1/README.md)，也不表示已部署或完成真实 Agent 集成。部署和调用代码是供后续实验使用的示例；本轮只做官方资料与固定源码的静态核查。

按需阅读：[版本与能力](#2-版本与产品边界)、[工作机制](#3-工作机制与能力限制)、[部署](#4-部署方式与资源要求)、[API使用](#5-api-与日常使用)、[自研Agent](#7-接入自研-agent)、[Pi](#8-pi-agent-集成)、[OpenCode](#9-opencode-集成)、[DeepSeek Harness](#10-deepseek-harness-集成)、[本项目取舍](#11-与本项目的关系)。

## 1 结论与选择路径

| 使用目标 | 建议入口 | 需要自行承担的工作 |
|---|---|---|
| 先体验跨会话偏好记忆 | Mem0 Platform SDK 或官方远程 MCP | 账号、数据范围、调用预算和 Agent 使用策略 |
| Python 自研 Agent 且需要控制存储与模型 | `mem0ai` 的 `Memory` / `AsyncMemory` | 模型、embedding、持久化、服务化和运维 |
| 多语言或多个 Agent 共用自托管记忆 | 官方 `server/` REST，外加可信业务网关 | 强制身份范围、接口适配、可靠写入及删除传播 |
| Pi coding agent | 官方 `@mem0/pi-agent-plugin` 连接Platform | 自托管OSS需定制扩展，另确定用户及项目范围 |
| OpenCode V1 | 核对官方 `@mem0/opencode-plugin` 与宿主版本 | 插件安装和 Platform 凭证；自托管另做适配 |
| OpenCode V2 | 优先使用 V2 MCP 配置连接 Mem0 远程 MCP | 认证和工具使用策略；自动召回与采集另行接入 |
| DeepSeek Harness v0.1 | Mem0官方 `@mem0/deepseek-plugin` 预览插件 | 连接Platform，按匹配的旧宿主版本验证 |
| DeepSeek Harness v0.2 | MCP工具桥接，或审查后的社区插件 | 官方预览插件另核时序兼容；工具授权、scope和自动读写hooks |
| 个人记录产品的完整 MemoryService | 保持本项目合同，按需引入 Mem0 投影 | 原始证据、精确记录、CAS、失效屏障和消费者清理 |

这些路径中，“模型能调用记忆工具”“每轮自动注入记忆”“每轮自动采集”“源删除后完整撤回”是四种不同能力。接入 MCP 通常首先解决第一种，不能据此推定其余能力已经交付。

## 2 版本与产品边界

### 2.1 固定核查版本

Mem0 官方仓库固定为 [`f1791daa86d469249c9b002f62644d58a1eb96a0`][mem0-tree]，提交时间为2026-11-06。该 checkout 中 Python `mem0ai` 为 **2.2.1**，要求 Python `>=3.10,<4.0`；Node `mem0ai` 为 **3.3.1**；Pi 插件为 **0.3.2**，OpenCode 插件为 **0.4.1**，Mem0官方DeepSeek插件为 **0.3.2**。版本分别取自各包 manifest，不能把 Python、Node 和插件的版本号互相替代。[Python manifest][pyproject]、[Node manifest][node-package]、[Pi manifest][pi-package]、[OpenCode manifest][oc-package]、[DeepSeek插件manifest][dsh-official-package]。

在线文档按本次访问时点使用，可能与上述 commit 的包发布节奏不同。旧研究 [memory-frameworks-notes](memory-frameworks-notes.md) 保留其2026-10-26及10-28快照；本报告不覆盖旧版本结论。

### 2.2 不同名称对应什么

| 名称 | 实际含义 | 是否代表数据在本地 |
|---|---|---|
| Mem0 OSS | Apache-2.0 开源记忆引擎，可嵌入应用 | 取决于模型、存储和遥测配置 |
| Mem0 自托管 server | 仓库 `server/` 中的 FastAPI、数据库和 dashboard | 数据库存储可自建；默认模型仍调用外部 API |
| Mem0 Platform | Mem0 运营的托管服务 | 记忆保存在其账号及服务中 |
| Mem0 官方远程 MCP | `https://mcp.mem0.ai/mcp`，连接 Platform | 不是本地 OSS 服务 |
| Agent 插件 | 给具体宿主增加 hooks、工具和提示的集成层 | 由插件后端模式决定 |
| Mem0 skill | 指导 coding agent 如何开发 Mem0 集成的说明 | 安装 skill 本身不会启用运行时记忆 |
| 旧 OpenMemory MCP 与 dashboard | 早期独立使用入口，已归档且不再积极维护 | 不宜作为新部署的默认起点 |

开源许可覆盖仓库代码，不意味着 Platform 的全部产品功能都能按原样自建。新的自托管入口应从 [OSS 概览][oss-overview] 和 [`server/README.md`][server-readme] 开始；旧 OpenMemory 的状态另见[官方迁移说明][openmemory-status]。

### 2.3 OSS 与 Platform 能力对照

| 能力 | 当前 OSS | Platform |
|---|---|---|
| add/search/get/get_all/update/delete/history | 支持，具体参数按 SDK 和 REST 区分 | 支持托管 API，参数和返回流程需按 Platform 文档 |
| 用户 Agent run 范围与 metadata filter | 支持；属于查询及组织机制 | 支持，并有服务端组织和项目结构 |
| 自定义抽取指引与逐次 prompt | 支持；效果仍由抽取模型决定 | 支持相应托管配置 |
| embedding、向量库、抽取模型选择 | 自行配置与运行 | 按托管产品配置及套餐提供 |
| 实体感知检索 | 提取实体并对候选加分 | 有托管实体及 Graph Memory 能力 |
| Graph Memory | 当前 OSS 没有图记忆；不能沿用旧 Neo4j 教程 | 平台能力，套餐条件另查 |
| 时间推理 | 可保存普通 metadata；`timestamp` / `reference_date` 专用参数不支持 | 提供专门时间能力 |
| 到期日 | 支持 `expiration_date`，主要影响查询可见性 | 支持相应到期配置 |
| Decay 与 Dream 记忆巩固 | 不是当前 OSS 内建能力 | 平台能力，按当前产品条件使用 |
| dashboard 与 API key | 新版 OSS server 已有 | 平台提供托管管理界面 |
| 多模态与 reranker | 有接口和配置，取决于具体 provider | 由托管能力及套餐决定 |

依据为[官方对照][platform-vs-oss]及固定源码。官方对照页仍把 OSS dashboard 写为 “Not included”，与新版 `server/` 实现不一致；此项以已存在的 server、dashboard 和鉴权代码为准。类似地，仓库概述和部分旧示例仍出现 graph/Neo4j 字样，不能替代当前配置及调用路径核查。

## 3 工作机制与能力限制

### 3.1 写入怎样形成记忆

当前 Python OSS 的默认 `add(infer=True)` 主路径如下。[固定写入源码][core-add]、[抽取提示源码][prompts]。

1. 根据 `user_id`、`agent_id`、`run_id` 建立范围，读取该范围最近10条消息。
2. 对新输入做 embedding，在相同身份范围找最多10条已有记忆作为抽取上下文。
3. 调用 LLM，把偏好、背景、决策或计划等提成候选事实。
4. 去重、生成 embedding、批量插入记忆，并维护 history、实体索引和近期消息缓存。

**当前自动抽取采用 ADD-only 追加策略。** “我搬到上海了”可以新增记忆；不能据此认定旧的“住在北京”会被自动正确替换。确定的更正和删除应调用显式 `update` / `delete`，并由应用明确目标。早期论文中的 ADD/UPDATE/DELETE/NOOP 机制、旧博客的配置项以及源码中尚未更新的 docstring，均不能用来推断当前默认行为。[机制文档][how-it-works]、[当前执行路径][core-add]。

返回 `{"results": []}` 可以表示没有提取出值得保存的事实；当前代码也有抽取结果解析失败后退成空候选的分支。应用不能把“HTTP成功但没有候选”直接解释成“用户原文已完整可靠保存”。`infer=False` 会把非 system 消息作为原文记忆写入，仍需要 embedding 和存储；它不提供本项目的来源版本、消息身份、幂等及生命周期合同。

### 3.2 记忆实际存在哪里

对固定 Python OSS 而言，记忆正文和 metadata 随向量库 payload 保存；`get(memory_id)` 从向量库取数据。SQLite 主要保存 **history** 和 **messages**，不是一套独立、完整的业务事实主库；实体信息保存在另一 collection。官方通用架构图中的“SQL 是 facts 的 source of truth”不能原样套到这一 OSS 实现。[get与实体初始化][core-memory]、[SQLite 表及消息缓存][storage]。

因此备份和迁移至少要覆盖：向量库及其 payload、实体 collection、SQLite history/messages、自托管账号/配置数据库，以及各组件版本。只复制一个 `history.db` 或只复制 embedding 都不能完整恢复实例。

### 3.3 检索能做什么

OSS 支持语义相似度、过滤、可选 reranker，以及关键词和实体相关信号。固定 Python 实现的 hybrid 过程主要对语义召回候选再加分，不能将其理解为“BM25和dense各自独立召回后取并集”。一个完全没有进入语义候选的精确词命中，不会因此自动获救。[search实现][core-search]。

中文效果取决于抽取模型、embedding、候选规模、过滤、分词和 reranker。可选 NLP 路径使用的 spaCy 模型是 `en_core_web_sm`；不能依据英文实体和 lemma 演示，推定中文药名、人物称谓和短记录已经被可靠处理。[NLP模型配置][spacy]。

语义召回适合“这个用户通常怎样”“上次项目为什么这样选”。“上月总支出多少”“所有体重记录平均值”应由完整结构化数据计算，不能从 top-k 记忆推算。

### 3.4 身份范围和时间语义

| 字段或机制 | 可以表达什么 | 不能直接替代什么 |
|---|---|---|
| `user_id` | 某个记忆所有者或业务命名空间 | HTTP调用者真实身份和授权 |
| `agent_id` | Agent 相关记忆范围 | 多 Agent 自动共享协议 |
| `run_id` | 某次运行或会话范围 | 来源消息ID或幂等key |
| `metadata` | 项目、分类、来源等附加标签 | 可信权限证明、唯一约束和自动删除传播 |
| `created_at/updated_at` | 存储及修改时间 | 用户陈述的发生时间和事实有效区间 |
| `expiration_date` | 到期后默认不参与部分列表和搜索 | 物理擦除；按ID获取仍可能返回 |
| `history` | 某条memory的增改删记录 | 原始消息全集或完整证据图 |

同时指定多个身份通常构成 AND 范围。给每个 session 都填不同 `run_id` 并在后续搜索也要求它，会阻止跨会话召回；给每个 Agent 填不同 `agent_id` 再严格过滤它，也不会自然共享用户记忆。应用应先设计共享范围，再决定写入和读取哪些字段。

尤其要注意：固定 Python 写入阶段的旧记忆查找和近期消息 scope 主要按上述三个身份字段建立，**不会因为 metadata 中写了不同 `project_id` 就自动隔离抽取上下文**。项目敏感信息需要在身份 scope、collection 或实例层明确隔离，不能仅依赖查询时加一个项目标签。[scope构建及上下文查找][core-scope]。

## 4 部署方式与资源要求

### 4.1 四种运行方式

| 方式 | 组成 | 适用情形 |
|---|---|---|
| Python 进程内 OSS | Memory + LLM + embedding + 向量库 + SQLite | 最容易核对机制的本地实验 |
| Node 进程内 OSS | `mem0ai/oss` + 相应provider | Node应用；需特别配置持久化 |
| 自托管 REST | FastAPI + pgvector/PostgreSQL + SQLite + dashboard | 多 Agent、多语言共享后端 |
| Platform | 托管 API / MCP | 希望减少基础设施运维 |

Python `Memory()` 默认使用 OpenAI `gpt-5-mini`、`text-embedding-3-small` 的1536维向量、本地 Qdrant 路径 `/tmp/qdrant`、SQLite `~/.mem0/history.db`，默认没有 reranker。Node OSS 默认向量 provider 是 **`memory` 内存库**，history 默认是本地 `memory.db`；因此“有 SQLite 文件”不代表 Node 默认记忆正文和向量已经持久化。[Python quickstart][python-quickstart]、[Node默认配置][node-defaults]。

本地部署不必然要求GPU：使用外部模型API时主要运行应用和数据库。完全离线时，需要本机或内网提供抽取模型、embedding及可选reranker，资源取决于模型和并发。官方开发栈不提供可直接外推的生产CPU/RAM或中文延迟保证，应按自己的模型、数据量及SLO测量。

### 4.2 Python OSS 最小实验

以下在**新建实验目录**执行，要求Python 3.10以上。凭证由安全环境注入；示例会调用外部模型和embedding API，属于后续实验步骤，本轮未执行。

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install 'mem0ai==2.2.1'
```

下面的 `Memory` 配置显式把数据放到实验目录，避免依赖临时目录。模型、provider及维度取自固定配置接口。[Qdrant配置][qdrant-config]、[抽取和embedding配置][oss-config]。

```python
from pathlib import Path
from mem0 import Memory

Path("data").mkdir(exist_ok=True)
memory = Memory.from_config({
    "llm": {"provider": "openai", "config": {"model": "gpt-5-mini"}},
    "embedder": {
        "provider": "openai",
        "config": {"model": "text-embedding-3-small"},
    },
    "vector_store": {
        "provider": "qdrant",
        "config": {
            "collection_name": "mem0_lab",
            "path": "data/qdrant",
            "embedding_model_dims": 1536,
            "on_disk": True,
        },
    },
    "history_db_path": "data/history.db",
    "custom_instructions": (
        "保存用户明确表达的长期偏好和项目决策。"
        "区分用户陈述、计划和助手建议，不推断未确认事实。"
    ),
})

owner = "lab:demo-user:memory-project"
created = memory.add(
    [{"role": "user", "content": "这个项目使用PostgreSQL，我喜欢简洁的中文解释。"}],
    user_id=owner,
    metadata={"source": "synthetic-demo", "source_message_id": "message-001"},
)
found = memory.search(
    "这个项目的数据库和沟通偏好是什么？",
    filters={"user_id": owner},
    top_k=5,
)
print(created)
print(found)
```

应分别检查候选是否正确、搜索结果是否有用，以及新进程重开后是否仍可检索。`source_message_id` 在这里是应用附带的标签，**不构成SDK的去重或幂等保证**。后续真正冻结实验环境还应锁定传递依赖、模型revision及数据集，而不只锁顶层包版本。

### 4.3 自托管 REST 与 dashboard

官方 `server/` 的开发入口如下。Docker Engine或Docker Desktop、Compose、make需先准备；在新clone中执行，不在本仓库中直接运行这些命令。[server安装说明][server-readme]、[Makefile][server-make]。

```sh
git clone https://github.com/mem0ai/mem0.git mem0-lab
cd mem0-lab
git checkout f1791daa86d469249c9b002f62644d58a1eb96a0
cd server
cp .env.example .env
# 私下配置 .env：至少 POSTGRES_PASSWORD、JWT_SECRET 和所选模型凭证。
# 保持 AUTH_DISABLED=false；缺少 JWT_SECRET 时服务会拒绝启动。
make up
```

随后打开 `http://localhost:3000`，通过首次设置向导创建管理员、配置用例和API key。API为 `http://localhost:8888`，Swagger为 `/docs`。另有 `make bootstrap` 无浏览器入口，可创建管理员和key；它不等于已经做过一次真实add/search验证，也不会经过浏览器的用例指引步骤。

Compose启动的是API、dashboard和 `pgvector/pgvector:pg17`；PostgreSQL持久卷保存向量及管理数据，`server/history`保存SQLite。`POSTGRES_PASSWORD`在当前Compose中是必填。默认端口还包括数据库映射 `8432`。[Compose源码][server-compose]。

**固定Git commit仍不足以固定这个开发栈的实际引擎。** 当前Compose启动命令会无版本号重装 `mem0ai`，随后跑Alembic和带 `--reload` 的uvicorn；Dockerfile也残留旧graph extra。正式对照实验需派生固定镜像或wheel、锁定依赖和镜像digest，并移除动态安装及开发reload。应记录运行容器中实际安装的引擎版本，不能仅记录clone的commit。[Compose启动命令][server-compose]、[Dockerfile][server-dockerfile]。

`make clean` 会删除Compose卷；它不适合作为登录或bootstrap失败时的默认修复。应保留初始凭据，按官方管理员密码恢复流程处理。

### 4.4 模型和存储替换

Python SDK可配置OpenAI、DeepSeek、Ollama等抽取模型，以及独立embedding provider；向量库可选择Qdrant、pgvector等。provider支持并不表示每个SDK、REST服务和插件都带齐相同依赖。[组件配置][oss-config]、[provider工厂][factories]。

自托管server有自己的 bundled provider白名单；当前LLM限于 `openai/anthropic/gemini`，embedding限于 `openai/gemini`。“SDK支持某provider”不等于通过dashboard或 `/configure` 就一定能启用；其他provider需扩展依赖及白名单并重建。完全本地方案可以采用Ollama抽取模型、Ollama embedding和本地向量库；更换embedding模型或维度时应使用新collection并重建，不能让新旧向量空间混用。[server校验代码][server-main]。

OSS默认包含可关闭的遥测配置，`MEM0_TELEMETRY=false` 可用于不需要遥测的实验环境。插件可能有独立开关。是否完全离线还取决于模型、向量库、包下载及插件后端，不能只检查这个环境变量。[核心遥测配置][telemetry]。

## 5 API 与日常使用

### 5.1 不同SDK的接口差异

| 调用面 | 创建入口 | 搜索范围和数量 | 注意点 |
|---|---|---|---|
| Python OSS | `from mem0 import Memory` | `filters={"user_id": ...}`, `top_k=5` | `search(user_id=...)` 顶层写法被拒绝 |
| Python异步OSS | `from mem0 import AsyncMemory` | 同上，使用 `await` | 非阻塞调用不等于可靠后台任务队列 |
| Node OSS | `import { Memory } from "mem0ai/oss"` | filter内为 `user_id`；选项按Node类型 | add使用 `userId`，勿机械照抄Python |
| Platform SDK | Python `MemoryClient`；Node `import MemoryClient from "mem0ai"` | 按Platform版本和类型定义 | 不能仅换host就视为兼容OSS REST |
| 官方OSS REST | `POST /memories` | `POST /search` 的 `filters`、`top_k` | 无 `/v1` 前缀；API key header为 `X-API-Key` |

依据为[Python方法签名][core-add]、[Python search][core-search]、[Node OSS入口][node-oss]和[server路由][server-main]。使用在线示例前应先辨清它针对的是Platform还是OSS，尤其避免把Platform的过滤语法、异步回执或时间参数传给OSS。

### 5.2 REST 调用示例

完成上面的server设置，并通过安全环境配置 `MEM0_OSS_KEY` 后，后续可用合成数据验证：

```sh
curl --fail-with-body http://localhost:8888/memories \
  -H "X-API-Key: ${MEM0_OSS_KEY}" \
  -H 'Content-Type: application/json' \
  --data '{"user_id":"lab:demo-user:project-a","messages":[{"role":"user","content":"我偏好简洁的中文解释。"}],"metadata":{"source":"synthetic-demo"}}'

curl --fail-with-body http://localhost:8888/search \
  -H "X-API-Key: ${MEM0_OSS_KEY}" \
  -H 'Content-Type: application/json' \
  --data '{"query":"用户喜欢什么沟通方式？","filters":{"user_id":"lab:demo-user:project-a"},"top_k":5}'
```

写入成功、没有抽取候选、检索为空和依赖服务失败应分别呈现。凭证仅由宿主使用，浏览器和模型不应自由选择业务用户scope。

### 5.3 Platform SDK的基本调用

选择托管服务时，先在Platform取得API key，再使用同一Python包的 `MemoryClient`。以下会向Mem0 Platform发送合成文本，模型及存储由托管配置决定；不使用第4节的本地Qdrant配置。[官方Platform quickstart][platform-quickstart]。

```python
import os
from mem0 import MemoryClient

client = MemoryClient(api_key=os.environ["MEM0_API_KEY"])
receipt = client.add(
    [{"role": "user", "content": "项目A采用PostgreSQL。"}],
    user_id="lab:demo-user",
    app_id="project-a",
)
print(receipt)
# 根据实际写入回执确认就绪；异步接收不等于已经可检索。
found = client.search(
    "项目A采用什么数据库？",
    filters={"user_id": "lab:demo-user", "app_id": "project-a"},
)
print(found)
```

Platform的异步事件状态、批量任务和webhooks需按对应API处理；不要把托管回执语义套用到同步OSS库，反之亦然。

### 5.4 显式更正与删除

Python OSS支持 `update(memory_id, text="新的明确内容")`、`delete(memory_id)`、`history(memory_id)` 和按身份的 `delete_all(...)`。应用应先通过授权范围找候选，再核对用户到底是在纠正旧事实、报告新状态，还是增加一次独立事件，不能按文本相近程度直接覆盖。

例如“今天又喝水500ml”应是第二次事件；“刚才那条应是300ml”才涉及指定原事件的更正。Memory ID由Mem0生成，业务原始消息、正式记录和派生memory可能一对多；要长期支持更正与删除，应用必须维护映射及实际支持关系。

到期不等于删除。当前 `expiration_date` 按UTC日期处理，过期后搜索/列表默认隐藏，但按ID读取及历史副本另有行为。单条删除会把旧正文写入DELETE history，近期messages也不会因此一并清除；有隐私擦除要求时必须按第6节设计完整流程。[到期及删除源码][core-delete]、[历史与messages表][storage]。

## 6 自托管的授权可靠性与擦除边界

### 6.1 API key 与业务隔离

新版server有登录、管理员、可撤销API key和请求审计，默认开启鉴权。但固定源码中，`verify_auth`认证的是dashboard用户；普通add/search/get/update/delete路由没有自动将该身份绑定到memory的 `user_id`，而是接受调用参数或memory ID。因此**不同用户各拿一把key，并不能直接构成租户级数据隔离**。[鉴权源码][server-auth]、[记忆路由][server-main]。

供多个业务用户使用时，应由可信后端完成：认证调用者、映射获授权memory scope、覆盖用户可控身份字段，并在按ID的get/update/delete/history前验证对象归属。还要防止用户通过OR过滤扩大范围。管理入口、原始server端口和数据库应限制在可信网络；不能只在前端隐藏用户ID。

### 6.2 重试并发与可见性

metadata中的消息ID、文本去重和一次HTTP成功，都不等于持久幂等journal。向量写入、SQLite history/messages和实体维护是分步操作；应用还需要面对模型返回未知、部分写入、重试重复、并发更正和索引可见性。[写入路径][core-add]、[更新及删除路径][core-delete]。

用于实验可以记录每次写入结果并人工检查；用于正式服务则应增加稳定operation身份、持久队列、结果核对、并发保护及明确的记忆就绪状态。`AsyncMemory`解决Python事件循环中的等待方式，不自动提供进程崩溃后的可靠重试。

### 6.3 删除需要覆盖的副本

| 位置 | 固定实现或常见接入行为 | 需要补齐的处理 |
|---|---|---|
| 向量记忆payload | `delete`删除主记忆对象 | 对应来源的全部派生memory定位 |
| SQLite history | DELETE记录保留旧memory正文 | 依据保留/擦除政策处理历史 |
| SQLite messages | 每scope最近10条，供以后抽取参考 | 源删除后清理或阻止继续用于抽取 |
| 实体collection | 删除时尝试解除关联，清理可非致命失败 | 可验证的清理与修复 |
| 插件和Agent会话 | 自动注入、工具结果、摘要可形成副本 | 清理持久历史、缓存和后续模型上下文 |
| 日志及备份 | 与SDK删除分属不同系统 | 保留政策、删除控制及恢复门禁 |

这些是根据固定OSS路径得出的工程边界，不是对托管Platform擦除协议的推定。对于“忘记某信息”的承诺，必须区分停止召回、删除当前记忆、物理擦除和Agent已消费副本清理。[SQLite实现][storage]、[删除实现][core-delete]。

## 7 接入自研 Agent

### 7.1 推荐编排位置

自研Agent最有控制力的方式，是由宿主实现MemoryAdapter：在首个模型请求前按当前任务召回，在可信输入持久保存后写回，并给模型提供按需补查工具。Mem0不要求替换主Agent模型或整个runtime；同一个Mem0后端可服务不同Agent，但共享范围要显式设计。

| 时点 | 适配层工作 | 需要保留的状态 |
|---|---|---|
| 收到输入 | 持久保存原消息，解析认证身份、owner和项目 | 稳定消息/operation身份 |
| 模型调用前 | 决定是否需要历史，限定scope搜索、筛选和裁剪 | 实际使用的memory ID及来源映射 |
| 工具调用中 | 提供受控search/get/remember工具 | 工具补查也登记依赖 |
| 本轮完成后 | 从可信输入/已确认结果形成写入任务 | 重试身份和写入结果 |
| 更正删除时 | 定位来源及派生记忆，撤回并清理宿主副本 | 控制事件和各阶段回执 |

召回结果应作为带来源的外部资料装配，不能让它升级为系统指令。自动采集时也应区分用户原话、助手建议和工具确认结果；模型生成“用户应该少喝咖啡”不能自动写成“用户已经戒咖啡”。

### 7.2 TypeScript 宿主的REST适配示意

下面函数针对官方OSS REST，可放在自研Node宿主的可信服务端。`memoryOwner`必须由认证及授权层生成；函数只负责传输，不实现本项目的证据、可靠队列或删除协议。

```javascript
async function searchMem0({ baseUrl, apiKey, memoryOwner, query }) {
  const response = await fetch(`${baseUrl}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify({
      query,
      filters: { user_id: memoryOwner },
      top_k: 8,
    }),
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) {
    throw new Error(`Mem0 search failed: ${response.status}`);
  }
  const body = await response.json();
  if (!Array.isArray(body.results)) {
    throw new Error("Unexpected Mem0 search response");
  }
  return body.results;
}
```

宿主拿到结果后还需做当前授权核验、相关性筛选、token预算和来源包装。超时应呈现为可观测的记忆不可用状态；只有允许降级的任务才能继续，不能把失败伪装成“没有历史”。

### 7.3 工具接入与自动接入的取舍

工具型MCP最容易跨宿主迁移，但是否调用受模型策略影响。hook自动召回能稳定提供背景，也可能注入无关或过期内容；自动采集能减少漏记，同时会增加费用和错误记忆。实际可采用“宿主按需召回＋模型补查＋受控后台写入”的组合，写入前先保存原输入。

官方自托管server是REST服务，不能把其URL直接填成MCP端点。需要自建MCP桥时，应在桥内调用OSS SDK或REST，并绑定获授权身份、限制工具范围；这个桥与官方Platform远程MCP是两条不同路径。

跨Agent共享建议至少区分用户通用偏好与项目记忆。一个用户的多个项目可以分开scope；允许共享的偏好可显式复制或通过单独获授权范围读取。不能只把所有Agent配置成同一个默认字符串就声称实现了可靠共享和权限隔离。

## 8 Pi Agent 集成

### 8.1 官方插件的使用方式

这里的Pi指coding agent，当前官方仓库为 `earendil-works/pi`，旧 `badlogic/pi-mono` 已重定向。Mem0固定插件使用 `@earendil-works/pi-coding-agent`，开发依赖对应Pi **v0.79.0**。安装前应核对宿主版本和Node要求，不能混用老包名及不同代扩展接口。[Pi插件manifest][pi-package]、[Pi扩展文档][pi-extensions]。

Mem0提供的官方安装入口为：

```sh
pi install npm:@mem0/pi-agent-plugin
```

通过安全环境提供 `MEM0_API_KEY` 和稳定的 `MEM0_USER_ID`，从目标项目启动Pi。以下可放在用户级 `~/.pi/agent/mem0-config.json`；关闭自动采集是初次试用建议，插件实际默认自动采集和注入均开启。

```json
{
  "userId": "stable-developer-id",
  "autoCapture": false,
  "contextInjection": true,
  "defaultScope": "project",
  "searchThreshold": 0.3
}
```

先用 `/mem0-status` 检查状态，再用 `/mem0-remember` 保存一条合成偏好，换新会话用 `/mem0-search` 检索，最后通过 `/mem0-forget` 验证删除入口。安装命令本身未固定npm发布版本；复现上述研究时应另锁插件包及宿主版本。[固定README][pi-readme]。

### 8.2 自动召回与采集实际如何触发

| 扩展点 | 固定插件行为 |
|---|---|
| `session_start` | 解析用户、项目和session身份 |
| `before_agent_start` | 搜索项目记忆，将记忆策略和结果追加到本轮system prompt |
| `agent_end` | 启用自动采集时，提取user和assistant文本、脱敏并调用add |
| `mem0_memory`工具 | 提供search/add/get_all/update/delete/delete_all |
| `/mem0-*`命令 | 显式记忆、搜索、范围切换、删除及状态检查 |

共享召回器有2秒等待和约4,000字符上下文上限，并按memory ID减少会话内重复注入；失败和超时可以返回空上下文。它是尽力增强，不是可靠记忆交付协议。自动采集包含助手文本，需要检查建议、推断和用户已确认事实会不会混淆。[插件入口][pi-entry]、[采集实现][pi-capture]、[共享lifecycle][plugin-lifecycle]。

项目 `app_id` 默认取Git根目录basename，同名但不同remote的仓库可能碰撞；session `run_id` 取session文件路径hash，跨设备不天然稳定。项目、session和global是插件范围约定，不能直接当安全租户边界。自动采集固定使用项目scope，不带顶层run_id；显式session查询不必然包含仅在metadata记录session的项目记忆。[Pi scoping][pi-scoping]、[共享scope规则][plugin-scopes]。

### 8.3 Pi接自托管OSS的路径

**当前官方插件直接构造Platform的 `MemoryClient({apiKey})`，没有可填入OSS server URL的配置。** 自建Mem0后直接给这个插件换一个地址，不是已交付的接法。[客户端构造][pi-entry]。

若要求自托管，可按Pi官方扩展API新建薄适配：用 `pi.registerTool()` 注册受控记忆工具；在 `before_agent_start` 或 `context` 装配召回数据；在 `agent_end` 将获授权、已持久的输入交给可靠写入队列，调用第5节REST或Node OSS。此路径需要开发和联调。删除时还要清理已注入会话及派生摘要；服务端delete不会替Pi撤回这些副本。[Pi官方扩展机制][pi-extensions]。

## 9 OpenCode 集成

### 9.1 官方插件存在但仍使用V1接口

Mem0的 `@mem0/opencode-plugin` 固定版本为0.4.1，依赖 `@opencode-ai/plugin ^1.0.162`，入口仍是返回hooks对象的async factory。当前OpenCode V2改用 `@opencode/plugin` 与 `Plugin.define({id, setup})`；官方迁移文档明确V1实现不能在V2直接运行。因此**不能把Mem0官方插件的安装说明直接用于当前V2并宣称兼容**。[固定插件入口][oc-source]、[OpenCode V2迁移规则][oc-migration]。

Mem0仓库 [issue 7602][oc-issue] 另报告OpenCode v2.0.26下插件安装成功但未加载。这里的兼容性判断来自插件结构和宿主迁移合同，并有issue佐证；本轮没有实机复现。

### 9.2 仍使用V1时怎样接入

核对V1宿主支持的插件配置后，可按官方README添加包，并提供安全环境中的 `MEM0_API_KEY`、稳定的 `MEM0_USER_ID`，需要时用 `MEM0_APP_ID` 明确项目ID。V1配置的基本形态为：

```json
{
  "plugin": ["@mem0/opencode-plugin"]
}
```

插件提供10个SDK记忆工具、7个技能，并通过聊天、工具前后、消息变换和compaction hooks进行检索及记忆管理，默认连接Platform。固定源码中的自动采集是**每第三个符合条件的用户prompt**后台add，不是完整聊天录制；compaction写入的session state主要是项目、分支和计数等信息，不能称为完整任务总结。[固定README][oc-readme]、[自动采集及压缩代码][oc-source]。

OpenCode项目ID默认优先由remote的owner/repo生成，与Pi按目录basename的算法不同。即使使用同一Mem0账号和user ID，两个插件也不会自动共享完全相同的项目范围；跨宿主共享需统一app映射。固定插件没有OSS server地址配置，自托管需另做插件或MCP桥。

### 9.3 OpenCode V2优先用MCP工具

以下采用当前V2的 `mcp.servers` 结构和Mem0远程MCP地址；凭证由环境展开，不写入配置。它连接Platform，示例为两边官方接口的组合，未实际连接验证。[V2 MCP配置][oc-mcp]、[Mem0 MCP认证][mem0-mcp]。

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "mem0": {
        "type": "remote",
        "url": "https://mcp.mem0.ai/mcp",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer {env:MEM0_API_KEY}"
        }
      }
    }
  }
}
```

重启后用 `opencode mcp list` 检查连接及工具；也可去掉API key header和 `oauth:false`，使用宿主支持的浏览器授权。不要照搬Mem0旧集成页的 `mcp.mem0` 配置到V2。[当前OpenCode MCP机制][oc-mcp]。

MCP能提供add/search/get/update/delete等工具，具体以连接后发现的schema为准；它不会自动复现插件的逐轮召回、自动采集及压缩hooks。若需要V2自动化，应迁移插件：prompt hook处理输入，context hook在模型前装配，compaction hook处理压缩；可靠写入应基于持久消息身份，不能把准入前prompt hook当作已经保存的事件。[V2迁移说明][oc-migration]。

### 9.4 范围和删除的共同限制

Pi和OpenCode插件的按ID操作不能笼统认为会再次完整核验项目归属。Pi的 `/mem0-forget` UI确认，也不表示模型工具的每个delete分支具有同样弹窗。使用者应审查实际权限和工具开放范围。两个插件均没有交付本项目的业务outbox、来源版本屏障和宿主副本清理协议。[Pi工具][pi-tools]、[OpenCode工具及hooks][oc-source]。

## 10 DeepSeek Harness 集成

### 10.1 官方宿主与MCP接入

这里指官方 `deepseek-ai/deepseek-harness`，不是泛指使用DeepSeek模型的Agent。本轮固定为 [`39163dd30f703a79079e2d2446545cff3c453738`][dsh-tree]，CLI manifest为 **0.2.2-rc.3**。官方记忆指南提供Memorix、Reference Memory和Engram等默认关闭的例子；Mem0不是已核得的内置后端。[官方MCP记忆指南][dsh-memory]。

DSH有stdio和Streamable HTTP MCP桥。可据此接Mem0官方远程MCP，得到模型可调用的记忆工具。以下overlay使用当前版本的运行时credential模板；需先在所用profile中提供credentials provider和安全的 `MEM0_API_KEY`。这是组合配置方案，尚未联调。[DSH MCP配置与凭证][dsh-mcp]、[Mem0远程MCP][mem0-mcp]。

```yaml
- insert:
    - id: memory-mem0
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: mem0
        transport: streamable-http
        url: https://mcp.mem0.ai/mcp
        expandTemplates: true
        headers:
          Authorization: 'Bearer ${credential:MEM0_API_KEY}'
```

将overlay保存到本地文件后，可按官方模式运行 `dsh web --patch /absolute/path/mem0.cordis.yml`。此处 `/absolute/path` 是待替换路径；不同profile及旧版DSH需分别核对。工具出现后还需验证真实调用与范围；接入MCP不会自动增加逐轮召回或完成后采集。

### 10.2 Mem0官方DeepSeek插件

Mem0官方仓库提供原生Cordis插件 **`@mem0/deepseek-plugin`**，固定manifest为0.3.2。其README仍写0.3.0，并明确标为developer preview、跟踪DSH v0.1；开发依赖固定的Harness能力包为 `0.1.1-rc.2`。因此应将它作为一条独立的官方集成路径，同时单独核验与本报告DSH `0.2.2-rc.3` 的兼容性。[官方插件说明][dsh-official-readme]、[manifest][dsh-official-package]。

| 能力或配置 | 固定官方插件实现 |
|---|---|
| 自动召回 | `system-prompt/assemble`读取会话中最近的真实用户输入，搜索top 5并追加上下文 |
| 自动采集 | 监听 `session/event`，正常completed的turn/end后异步add用户及助手文本 |
| 显式工具 | `search_memory` 和 `add_memory` |
| 默认开关 | autoRecall和autoCapture均为true，自动路径失败放行 |
| 身份范围 | userId必填，自动读写仅用该userId，不挂项目或run；跨用户覆盖默认关闭 |
| 后端 | Platform；`host`只覆盖Platform专有或on-prem地址，不支持OSS REST |

显式工具可带agentId/runId，限制该次工具的范围；它们不会自动把用户级采集改成项目或session级采集。自动写入采用进程内异步promise，没有本项目的持久outbox或删除副本清理协议。[官方插件源码][dsh-official-source]。

以下是官方“构建打包后安装到独立旧版profile”的实验路径，需在已固定的Mem0源码中执行，并预先安全提供 `MEM0_API_KEY`。打包产物以实际 `pnpm pack` 输出为准；不能照抄README中旧0.3.0文件名。此示例不表示已验证新版DSH兼容。

```sh
cd integrations/deepseek-plugin
pnpm install --frozen-lockfile
pnpm build
mkdir -p /tmp/mem0-deepseek-plugin
pnpm pack --pack-destination /tmp/mem0-deepseek-plugin
DSH_HOME=/tmp/mem0-dsh-dev pnpm dlx @deepseek-ai/dsh@0.1.1-rc.2 \
  plugin --profile headless add /tmp/mem0-deepseek-plugin/mem0-deepseek-plugin-0.3.2.tgz
```

随后按 [`cordis.example.yml`][dsh-official-config] 填入已安装插件的路径和稳定userId，使用同一DSH_HOME及对应profile加载。它不需要把Platform key写进YAML；省略apiKey时读取环境变量。

对本次固定DSH v0.2源码，还存在具体的召回时序风险：Agent在当前用户消息追加到会话前先装配system prompt，而官方插件仅从 `deriveMessages()` 取用户输入，没有承接 `agent/inbox/claimed` 的当前输入。因此首个模型请求可能找不到本轮query，或按上一轮输入召回；这属于源码时序判断，尚未实机复现。使用新版宿主前应修正或验证该路径，不能仅凭peer依赖为 `*` 判断兼容。[当前Agent循环][dsh-agent-loop]、[官方插件召回代码][dsh-official-source]。

### 10.3 已有社区自动化插件

`light-cheng/DSH-Mem0` 是可参考的第三方实现，**不是DeepSeek或Mem0官方集成**。本轮固定commit为 [`21afebc0f7fbecf788a2c7aad3423c0128622e47`][dsh-plugin-tree]，插件版本0.3.1，MIT，要求Node `>=22`、DSH `>=0.2.1-rc.5 <0.3.0`。上述DSH版本落在其声明范围内，但仍需运行验证。[manifest][dsh-plugin-package]。

| 机制 | 固定社区插件实现 |
|---|---|
| 后端 | Platform、自托管REST、本地Python OSS sidecar三种模式 |
| 自动召回 | `agent/inbox/claimed`取得真实用户输入，结合 `system-prompt/assemble`等上下文机制注入 |
| 自动采集 | `session/event`遇到正常completed的turn/end后，后台提取该轮用户文本和最终助手回复 |
| 显式工具 | mem0_add/search/get/update/delete/status及profile工具 |
| 附加管理 | summary、预算、hygiene和GUI；这些属于插件能力 |

它默认召回top 5、等待5秒，失败或超时放行；后台队列为内存态，满时可能跳过，不能代替可靠journal。召回主要按userId过滤，agentId附写入不自动产生项目隔离。自动采集还会截断输入，试验时应检查遗漏。[lifecycle源码][dsh-plugin-lifecycle]、[默认配置][dsh-plugin-config]。

后续可clone固定commit，再通过实际运行profile执行 `dsh plugin --profile desktop add link:/absolute/path/DSH-Mem0`，在设置页显式选 `backend: platform`、`server` 或 `oss`。不要依赖 `auto` 来确认数据流向：环境中存在 `MEM0_API_KEY` 时它会优先选择Platform。“本地sidecar”也不保证LLM和embedding都在本地。[安装说明][dsh-plugin-readme]、[后端选择][dsh-plugin-config]。

另有 `orangeshinee/dsh-mem0` 偏自托管REST工具型实现，包名也叫 `dsh-mem0`，不能仅凭名字认为两者相同。本轮对此仅做在线源码浏览、未固定commit，保留为[后续线索][dsh-other]。

### 10.4 自研DSH适配与DeepSeek模型的区别

若自行开发DSH适配器，应优先用官方注册的context provider交付动态事实；直接改 `system-prompt/assemble` 是更强的装配干预点，需要保留其他插件贡献。以真实、已持久的用户事件为写入来源，并把删除传播到profile、召回缓存和会话投影。社区实现可以参考，不能据其存在宣称完整生命周期已经实现。[DSH上下文机制][dsh-context]。

Mem0另有 `llm.provider="deepseek"`，默认使用 `deepseek-chat` 并读取 `DEEPSEEK_API_KEY`。把第4.2节的LLM配置替换成下面这一项，表示**用DeepSeek做Mem0抽取模型**；embedding仍需独立配置，也不会给DSH自动装上记忆。若经自托管REST配置DeepSeek，还需按第4.4节扩展server白名单。[DeepSeek provider源码][deepseek-provider]。

```python
deepseek_llm_config = {
    "provider": "deepseek",
    "config": {"model": "deepseek-chat"},
}
```

## 11 与本项目的关系

本项目需要的是有稳定来源、版本、授权、可撤回证据和消费控制的独立MemoryService。Mem0能帮助实现其中的抽取和召回，但简单包一层HTTP不能自然满足完整合同。[00边界与架构](../docs/spec-v1/00-boundaries-and-invariants.md)、[03宿主接入与时序](../docs/spec-v1/03-agent-sequences-and-recovery.md)。

| 本项目职责 | Mem0可承担的部分 | 仍需我方实现 |
|---|---|---|
| L0来源及来源镜像 | `infer=False`可存原文，metadata可挂外部ID | 稳定origin、精确版本、授权、来源完整性及有序镜像 |
| L1记忆候选与修订 | 抽取、显式update/delete、history | 多证据支持、CAS、slot保护、事实权威与事件/状态语义 |
| L2检索 | embedding、filter、reranker和实体加分 | 当前中文混合检索基线、完整必要约束、来源直检及预算对照 |
| L3受控交付 | 返回候选列表 | bundle及依赖闭包、在线validate、失效门禁及宿主清理 |
| 业务正式记录 | 可保存记录的描述性投影 | RecordService正式回执、完整时间线和精确统计 |
| 生命周期恢复 | 单对象增改删能力 | 独立删除控制、持续源撤权、物理/消费者清理及恢复防复活 |

对于现有 `agent-service`，本仓 [03§2.2](../docs/spec-v1/03-agent-sequences-and-recovery.md#22-当前-agent-service-的落点与新增工作) 保留了固定commit下的Host接入核查：静态memory-injection不是动态MemoryAdapter，普通middleware也不能随意改写messages。本次没有重新审计该外仓的新HEAD；若以后接入Mem0，先核对实际Host版本，再按受控证据区、来源依赖及失效接口实现，不能照Pi插件钩子名机械移植。

可选择的实验顺序是：先让Mem0对合成数据形成独立投影，与本项目基线比较；再决定使用SDK内部组件还是REST后端。来源、正式记录和生命周期控制仍由现行合同负责。暂不因本次研究更换整体架构或新增首发依赖。

## 12 中文实验与选型验收建议

以下是后续PoC建议，不是本轮已执行的测试，也不另设本项目发布门槛。[现行04评测合同](../docs/spec-v1/04-evaluation-and-acceptance.md)仍是本项目验收依据。

| 场景 | 合成输入或操作 | 观察指标 |
|---|---|---|
| 偏好与状态变化 | 简洁回复→项目内详细解释→恢复通用偏好 | scope正确、旧状态不污染、当轮要求优先 |
| 原话与助手建议 | 用户担心失眠；助手建议减少咖啡 | 不误写成确诊或已执行行为 |
| 独立事件与更正 | 两次500ml饮水；只把其中一次改300ml | 不误合并，能定位正确来源 |
| 主体与中文实体 | 我、妈妈、宝宝；简称、昵称、同名 | 不串主体，不依赖英文NER效果推定 |
| 时间 | 补记昨天、跨时区、长期与临时偏好 | 区分存储时间和事件时间 |
| 短输入触发 | “又疼了”“比昨天好些” | 找到有用背景，允许澄清或不用历史 |
| 项目和用户隔离 | 两用户同名项目；同用户不同项目 | 读取、抽取上下文及写回均不串范围 |
| 跨会话与持久化 | 关闭进程、换session、重启服务 | Node内存默认项不会被误认为持久 |
| 重试与并发 | 写入超时重送；两次同时更正 | 重复率、未知状态、可恢复性 |
| 删除及恢复 | 删来源后再抽取、重开会话、恢复备份 | history/messages/宿主副本不使删除内容复活 |
| Agent端行为 | 自动召回、工具补查、自动采集分别开关 | 实际触发率、错误注入率和费用 |

应固定输入集、主Agent模型、抽取模型、embedding、reranker、provider和宿主版本，分别报告写入质量、召回收益、错误历史污染、延迟、成本和删除完成范围。论文与官网benchmark用于了解机制和题型，不能替代中文个人记录、完整生命周期或真实宿主集成验证。[Mem0原始论文][paper]、[官方benchmark仓库][benchmarks]。

## 13 成本运维与采用建议

OSS没有按调用收取的开源许可证费用，但抽取模型、embedding、可选reranker、数据库、日志和运维仍有成本。一次 `add` 可能读取上下文、调用抽取模型并产生多条embedding；不应按“一条消息等于一次API调用”估算。近似口径为：**写入抽取＋输入及候选embedding＋检索embedding＋reranker＋存储运维＋宿主增加的上下文token**，并计入失败与重试。

截至本次访问，Platform定价页采用Free与Custom结构；免费层在初始体验期与自带LLM key后有不同额度，超额可按使用量并设置月度上限。Graph、Dream、用户profile等高级能力与合同条款需另核具体计划，不能沿用旧博客的套餐价格。[当前定价页][pricing]。

对普通聊天助手或coding agent，Mem0的接入成本较低，适合先验证偏好、项目背景与决策记忆的收益。对多租户产品及本项目，应把身份网关、来源映射、更正与擦除、可靠重试和宿主清理纳入实施范围，再判断使用现成Mem0是否仍能节省总成本。

## 14 一手资料与核查边界

主要证据为Mem0、Pi、OpenCode和DeepSeek Harness官方资料及固定源码；社区DSH插件仅用于说明可选集成，不作为官方能力证明。源码链接固定commit，在线文档和定价可能继续变化。

本轮已检查实际checkout与交接、官方在线资料、公开源码和示例接口。未安装SDK、启动Docker栈、注册Platform账号、读取真实凭证、调用模型或复现benchmark；中文效果、插件实机兼容、费用和完整擦除仍需按上述实验验证。静态核查结果及文档检查命令另记于[跨电脑交接](../docs/cross-computer-handoff.md)。

[mem0-tree]: https://github.com/mem0ai/mem0/tree/f1791daa86d469249c9b002f62644d58a1eb96a0
[pyproject]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/pyproject.toml
[node-package]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/mem0-ts/package.json
[pi-package]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/integrations/pi-agent-plugin/package.json
[oc-package]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/integrations/opencode-plugin/package.json
[oss-overview]: https://docs.mem0.ai/open-source/overview
[platform-vs-oss]: https://docs.mem0.ai/platform/platform-vs-oss
[how-it-works]: https://docs.mem0.ai/core-concepts/how-it-works
[oss-config]: https://docs.mem0.ai/open-source/configuration
[python-quickstart]: https://docs.mem0.ai/open-source/python-quickstart
[platform-quickstart]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/docs/platform/quickstart.mdx
[core-memory]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/mem0/memory/main.py
[core-add]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/mem0/memory/main.py#L760
[core-search]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/mem0/memory/main.py#L1393
[core-scope]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/mem0/memory/main.py#L314
[core-delete]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/mem0/memory/main.py#L1830
[storage]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/mem0/memory/storage.py
[prompts]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/mem0/configs/prompts.py
[spacy]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/mem0/utils/spacy_models.py
[qdrant-config]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/mem0/configs/vector_stores/qdrant.py
[factories]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/mem0/utils/factory.py
[node-defaults]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/mem0-ts/src/oss/src/config/defaults.ts
[node-oss]: https://github.com/mem0ai/mem0/tree/f1791daa86d469249c9b002f62644d58a1eb96a0/mem0-ts/src/oss
[server-readme]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/server/README.md
[server-compose]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/server/docker-compose.yaml
[server-dockerfile]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/server/dev.Dockerfile
[server-make]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/server/Makefile
[server-main]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/server/main.py
[server-auth]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/server/auth.py
[telemetry]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/mem0/memory/telemetry.py
[openmemory-status]: https://github.com/mem0ai/openmemory/blob/main/openmemory-archive/README.md
[pi-readme]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/integrations/pi-agent-plugin/README.md
[pi-entry]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/integrations/pi-agent-plugin/src/entry.ts
[pi-capture]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/integrations/pi-agent-plugin/src/capture/index.ts
[pi-scoping]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/integrations/pi-agent-plugin/src/memory/scoping.ts
[pi-tools]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/integrations/pi-agent-plugin/src/memory/tools.ts
[pi-extensions]: https://github.com/earendil-works/pi/blob/v0.79.0/packages/coding-agent/docs/extensions.md
[plugin-lifecycle]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/integrations/agent-plugin-core/typescript/src/lifecycle.ts
[plugin-scopes]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/integrations/agent-plugin-core/typescript/src/scoping.ts
[oc-readme]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/integrations/opencode-plugin/README.md
[oc-source]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/integrations/opencode-plugin/opencode-mem0.ts
[oc-migration]: https://opencode.ai/docs/build/plugins/migrate-v1
[oc-mcp]: https://opencode.ai/docs/mcp-servers/
[oc-issue]: https://github.com/mem0ai/mem0/issues/7602
[mem0-mcp]: https://docs.mem0.ai/platform/mem0-mcp
[dsh-tree]: https://github.com/deepseek-ai/deepseek-harness/tree/39163dd30f703a79079e2d2446545cff3c453738
[dsh-memory]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/docs/user/guide/mcp-memory.md
[dsh-mcp]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/mcp/mcp-client/README.md
[dsh-context]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/core/system-prompt/README.md
[dsh-agent-loop]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/core/agent-loop/src/agent.ts
[dsh-official-package]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/integrations/deepseek-plugin/package.json
[dsh-official-readme]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/integrations/deepseek-plugin/README.md
[dsh-official-source]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/integrations/deepseek-plugin/src/index.ts
[dsh-official-config]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/integrations/deepseek-plugin/cordis.example.yml
[dsh-plugin-tree]: https://github.com/light-cheng/DSH-Mem0/tree/21afebc0f7fbecf788a2c7aad3423c0128622e47
[dsh-plugin-package]: https://github.com/light-cheng/DSH-Mem0/blob/21afebc0f7fbecf788a2c7aad3423c0128622e47/package.json
[dsh-plugin-readme]: https://github.com/light-cheng/DSH-Mem0/blob/21afebc0f7fbecf788a2c7aad3423c0128622e47/README.md
[dsh-plugin-lifecycle]: https://github.com/light-cheng/DSH-Mem0/blob/21afebc0f7fbecf788a2c7aad3423c0128622e47/lib/memory-lifecycle.js
[dsh-plugin-config]: https://github.com/light-cheng/DSH-Mem0/blob/21afebc0f7fbecf788a2c7aad3423c0128622e47/lib/config.js
[dsh-other]: https://github.com/orangeshinee/dsh-mem0/blob/main/README.en.md
[deepseek-provider]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/mem0/llms/deepseek.py
[pricing]: https://mem0.ai/pricing
[paper]: https://arxiv.org/abs/2504.19413
[benchmarks]: https://github.com/mem0ai/memory-benchmarks
