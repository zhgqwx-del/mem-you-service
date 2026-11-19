# Hindsight开源自部署Handbook

适用日期：2026-11-18。目标是在独立实验目录准备一套可由可信后端调用的Hindsight自托管服务，写清构建、配置、认证、中文检索、合成数据检查和备份步骤。**以下命令是后续操作指南，本轮没有安装依赖、构建镜像、启动服务或调用模型。**

本手册固定Hindsight源码 [`b92ceb180e349a456d2b5454575067b6ff0f6306`](https://github.com/vectorize-io/hindsight/tree/b92ceb180e349a456d2b5454575067b6ff0f6306)、API-slim 1.2.1，软件采用MIT许可证。API、worker、Control Plane及SDK可自托管，不需要Hindsight Cloud账号；抽取模型的供应方凭证和费用另行准备。Cloud的托管运维、账号及企业能力不自动成为本部署的一部分。[版本][package]、[许可证][license]。

主线为**固定源码构建API与Control Plane，独立PostgreSQL 17＋pgvector＋PGroonga，中文本地embedding和reranker，抽取调用远程OpenAI模型**。这是一套单机实验模板，尚未经过Docker构建或真实联调。接入自研宿主见[agent-service接入Handbook](hindsight-agent-service-integration.md)；架构理念与现行方案取舍见[专项研究](../../research/hindsight-design-review.md)。

远程数据库、API/worker分离及多实例运维见[生产环境部署Handbook](hindsight-production-deployment.md)。本页本地数据库、内置worker及固定实验project不直接作为生产集群配置。

## 1 部署组成与数据归属

```text
可信后端 → HTTP + Bearer自托管key → 127.0.0.1:18889
                                      │
                      Hindsight API + 内置worker
                          │           │             │
                    PostgreSQL   本地BGE-M3/重排   远程抽取模型
                    pgvector      模型cache卷       独立供应方key
                    PGroonga

本机浏览器 → 127.0.0.1:19999 → Control Plane → 同容器API
```

| 对象 | 本手册配置及含义 |
|---|---|
| API与内置worker | 一个standalone容器，宿主18889映射容器8888，75秒退出宽限，稳定worker ID |
| Control Plane | 同容器运行，宿主19999映射9999；是管理界面，不是产品用户登录系统 |
| PostgreSQL | 独立容器，仅内部网络；命名卷`pg_data`保存schema、来源文档、事实、观察、配置及任务等 |
| 模型 | 抽取模型示例为`gpt-5-mini`；本地embedding为`BAAI/bge-m3`，reranker为`hindsight-ai/hs-rerank-1` |
| 文件 | 固定`native`存储，文件API先关闭；不额外挂S3，也不把模型cache误当业务数据备份 |
| 观察归纳 | 模板先关闭observations及自动consolidation；后续按bank单独启用和计费 |

Hindsight的bank组织一个记忆空间，`retain/recall/reflect`分别负责摄取、证据召回和推理生成。正式记录、精确统计和业务提交回执仍归产品后端；这套部署不提供本项目完整Memory API、删除控制账本或Host清理能力。[服务组成][services]、[研究边界](../../research/hindsight-design-review.md#5-接入和生命周期需要逐项核验)。

## 2 选择部署路线及准备条件

| 路线 | 适用范围 | 本手册处理 |
|---|---|---|
| 官方单容器＋pg0 | 最快体验、英文小实验 | 只作替代；pg0不含本例中文词法所需PGroonga扩展，不作为主线 |
| 固定源码＋独立PGroonga数据库 | 本项目中文短记录实验 | 下文完整步骤和模板 |
| slim镜像＋外部embedding/reranker | 已有受控模型服务 | 可替代；需另配provider和网络，不能保留`local`却删除本地ML依赖 |
| 分离API/worker或远程生产数据库 | 独立扩容、正式运维 | 见[生产手册](hindsight-production-deployment.md)及其待验收边界；Kubernetes编排另行设计，本例不是HA部署包 |

需要Git、Docker Engine或Docker Desktop、Compose插件、Python 3、curl，以及18889/19999空闲端口。构建会下载基础镜像和依赖；首次启动还会下载BGE-M3与reranker权重。中文模型比默认英文小模型占用更多内存和磁盘，应给实验机留出数GB模型空间及足够运行内存，实际峰值和延迟另测，不照抄默认英文模型的硬件估值。[安装与镜像][installation]、[中文配置][multilingual]。

主线使用CPU，显式将本地模型并发设为1以限制实验资源。完全本地运行还需另部署LLM并配置受支持的provider/base URL；自托管记忆存储不意味着抽取模型也已本地化。容器里的localhost指当前容器，不是另一个模型容器或宿主机。

## 3 固定源码并复制模板

从本仓库根目录开始，使用尚不存在的新实验目录；已有目录、数据库卷或自定义构建配置应先检查，不能直接覆盖：

```sh
export HINDSIGHT_HANDBOOK_EXAMPLES="$(pwd)/docs/handbooks/examples/hindsight"
export HINDSIGHT_LAB_ROOT="$HOME/ai-workspace/hindsight-selfhost-lab"
if [ -e "$HINDSIGHT_LAB_ROOT" ] || [ -L "$HINDSIGHT_LAB_ROOT" ]; then
  printf '%s\n' '目标路径已存在；停止并检查，不覆盖已有checkout。' >&2
  false
else
  git clone https://github.com/vectorize-io/hindsight.git "$HINDSIGHT_LAB_ROOT" &&
  git -C "$HINDSIGHT_LAB_ROOT" checkout b92ceb180e349a456d2b5454575067b6ff0f6306 &&
  git -C "$HINDSIGHT_LAB_ROOT" rev-parse HEAD &&
  git -C "$HINDSIGHT_LAB_ROOT" status --short &&
  mkdir "$HINDSIGHT_LAB_ROOT/deploy.handbook" &&
  cp "$HINDSIGHT_HANDBOOK_EXAMPLES/compose.yaml" "$HINDSIGHT_LAB_ROOT/deploy.handbook/" &&
  cp "$HINDSIGHT_HANDBOOK_EXAMPLES/Dockerfile" "$HINDSIGHT_LAB_ROOT/deploy.handbook/" &&
  cp "$HINDSIGHT_HANDBOOK_EXAMPLES/init-extensions.sql" "$HINDSIGHT_LAB_ROOT/deploy.handbook/" &&
  cp "$HINDSIGHT_HANDBOOK_EXAMPLES/.env.example" "$HINDSIGHT_LAB_ROOT/deploy.handbook/" &&
  cp "$HINDSIGHT_HANDBOOK_EXAMPLES/.dockerignore" "$HINDSIGHT_LAB_ROOT/deploy.handbook/" &&
  cd "$HINDSIGHT_LAB_ROOT/deploy.handbook"
fi
```

样例原件：[Compose](examples/hindsight/compose.yaml)、[薄包装Dockerfile](examples/hindsight/Dockerfile)、[环境样例](examples/hindsight/.env.example)、[数据库扩展初始化](examples/hindsight/init-extensions.sql)、[包装构建排除项](examples/hindsight/.dockerignore)。包装层只创建与上游UID 1000匹配的模型cache目录，核心服务代码不在本仓重写。

先增加本地Git忽略和源码构建排除项，再创建真实配置。上游根`.dockerignore`没有完整排除本手册的私有目录，不能仅靠Dockerfile显式COPY推论秘密不会被发送到构建上下文：

```sh
cat >> ../.git/info/exclude <<'EOF'
/deploy.handbook/.env
/deploy.handbook/private/
/deploy.handbook/backups/
EOF
cat >> ../.dockerignore <<'EOF'

# Local handbook deployment must never enter the upstream source build context.
/deploy.handbook/
.env
**/.env
EOF
git -C .. check-ignore deploy.handbook/.env deploy.handbook/private/probe.key deploy.handbook/backups/probe.dump
```

源码构建保留上游排除规则并追加上述项；包装镜像使用`deploy.handbook/.dockerignore`仅允许Dockerfile进入自己的构建上下文。本文不把真实配置或运行数据复制回本项目。

## 4 创建私有配置

模板的`POSTGRES_USER/DB`固定为`hindsight_lab`。空卷启动时它是PostgreSQL初始化超级用户，便于安装扩展和实验迁移；这是单机实验取舍，生产应区分扩展/迁移角色与最小权限运行角色。数据库不发布宿主端口。

下列命令仅在新实验目录执行一次：创建0600的`.env`和curl认证配置，随机生成数据库密码及自托管key，不回显值。输入的模型key只保存到本地私有配置；本例限制为常见OpenAI key字符集以避免dotenv转义歧义，不将任意文本拼进配置。

```sh
python3 - <<'PY'
import getpass
import os
from pathlib import Path
import re
import secrets

if Path(".env").exists() or Path("private").exists():
    raise SystemExit("Existing private configuration found; inspect it instead of overwriting.")
provider_key = getpass.getpass("OpenAI model provider API key: ").strip()
if not re.fullmatch(r"[A-Za-z0-9._~-]+", provider_key):
    raise SystemExit("Empty or unsupported key characters; use a secure deployment mechanism for this provider.")
api_key = secrets.token_hex(32)
values = {
    "HINDSIGHT_DB_PASSWORD": secrets.token_hex(24),
    "HINDSIGHT_API_TENANT_API_KEY": api_key,
    "HINDSIGHT_API_LLM_API_KEY": provider_key,
}
text = Path(".env.example").read_text()
for name, value in values.items():
    needle = name + "=\n"
    if text.count(needle) != 1:
        raise SystemExit("Unexpected environment template")
    text = text.replace(needle, name + "=" + value + "\n", 1)
fd = os.open(".env", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as handle:
    handle.write(text)
Path("private").mkdir(mode=0o700)
fd = os.open("private/curl.conf", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as handle:
    handle.write('header = "Authorization: Bearer ' + api_key + '"\n')
Path("private/receipts").mkdir(mode=0o700)
print("Private configuration created; no key values printed.")
PY
```

三种key不要混用：`HINDSIGHT_API_LLM_API_KEY`属于模型供应方；`HINDSIGHT_API_TENANT_API_KEY`是本地API共享凭证；Hindsight Cloud key不因部署OSS而必需。模板给Control Plane配置相同的本地key，通过服务端Bearer头访问API。[内置认证][tenant]、[Control Plane客户端][cp-client]。

| 配置项 | 本手册值及核对点 |
|---|---|
| DATABASE_URL / SCHEMA | 连接同Compose的`db`与`public`；密码为URL-safe随机hex |
| VECTOR_EXTENSION / TEXT_SEARCH_EXTENSION | `pgvector` / `pgroonga`，匹配独立PG镜像和初始化SQL |
| TENANT_EXTENSION | `hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension`；不保留默认无认证扩展 |
| CP_DATAPLANE_API_URL / API_KEY | 同容器`http://127.0.0.1:8888`及相同自托管key |
| EMBEDDINGS_PROVIDER / LOCAL_MODEL | `local` / `BAAI/bge-m3`；不要把默认英文模型当完整中文方案 |
| RERANKER_PROVIDER / LOCAL_MODEL | `local` / `hindsight-ai/hs-rerank-1`，该模型列有中文支持 |
| WORKER_ENABLED / WORKER_ID | `true` / 稳定`hindsight-handbook-1`；复制实例时必须另定协调身份 |
| SKIP_LLM_VERIFICATION | `true`；跳过默认启动时的真实LLM连接探测，付费验证另行执行 |
| MCP_ENABLED_TOOLS | `recall`；只限制MCP工具面，不影响下文REST retain，也不代替业务授权 |
| ENABLE_OBSERVATIONS / ENABLE_AUTO_CONSOLIDATION | 模板都为false；先验证原始事实流程，再显式开启额外归纳 |

Compose的宿主环境会覆盖`.env`插值；下一节会拒绝本例同名环境及Compose控制变量，只报告变量名。出现拒绝时，在干净shell中继续或移除相应导出值，不打印密钥。容器不挂载`.env`，由Compose注入环境；Hindsight CLI自身会搜索`.env`且以文件覆盖环境，不能向容器工作目录另挂一份旧配置。可按bank覆盖的字段还存在global→tenant→bank解析顺序；改环境后，旧bank覆盖不一定消失。embedding/provider等静态服务项不能当作任意bank独立配置。[配置加载][config]、[配置说明][configuration]。

## 5 构建启动与无模型检查

在`deploy.handbook`目录执行。**新目录不等于新数据库**：Compose按project命名容器和卷，默认project跨目录仍是同一个`hindsight-handbook`。首次安装先拒绝已有同project容器或数据卷；需要另一次实验时，将私有`.env`中的`HINDSIGHT_COMPOSE_PROJECT`改为新的合法名称。已有实例使用原目录和原配置按第9节恢复，不用新密码重建同名project。

下面的独立子shell按顺序检查、构建和启动，任一步失败即停；不要将其放入会忽略`set -e`的外层条件或失败后继续执行`up`。源码构建保留`INCLUDE_LOCAL_MODELS=true`，`PRELOAD_ML_MODELS=false`避免构建阶段下载默认英文权重：

```sh
(
set -eu
docker compose version
python3 - <<'PY'
import os
from pathlib import Path
import re
import subprocess

names = {
    line.split("=", 1)[0]
    for line in Path(".env.example").read_text().splitlines()
    if line and not line.startswith("#") and "=" in line
}
names.update({"COMPOSE_FILE", "COMPOSE_PROJECT_NAME", "COMPOSE_ENV_FILES",
              "COMPOSE_DISABLE_ENV_FILE", "COMPOSE_PROFILES"})
overrides = sorted(names.intersection(os.environ))
if overrides:
    raise SystemExit("Remove inherited configuration names: " + ", ".join(overrides))
project_lines = [
    line.split("=", 1)[1]
    for line in Path(".env").read_text().splitlines()
    if line.startswith("HINDSIGHT_COMPOSE_PROJECT=")
]
if len(project_lines) != 1 or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", project_lines[0]):
    raise SystemExit("Set one unquoted, valid HINDSIGHT_COMPOSE_PROJECT in the private .env")
project = project_lines[0]
subprocess.run(["docker", "info"], stdout=subprocess.DEVNULL, check=True)
containers = subprocess.check_output(
    ["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=" + project],
    text=True,
).strip()
volumes = set(subprocess.check_output(
    ["docker", "volume", "ls", "--format", "{{.Name}}"], text=True,
).splitlines())
if containers or any(project + "_" + suffix in volumes for suffix in ("pg_data", "model_cache")):
    raise SystemExit("Existing project containers or volumes found; use the original configuration or a new project.")
print("Fresh project and configuration checks passed; no secret values printed.")
PY
docker compose config --quiet
docker build --file ../docker/standalone/Dockerfile \
  --target standalone \
  --build-arg INCLUDE_LOCAL_MODELS=true \
  --build-arg PRELOAD_ML_MODELS=false \
  --tag hindsight-handbook-source:b92ceb1 ..
docker compose build db hindsight
docker compose up -d
docker compose ps
)
```

源码构建使用上游`uv.lock`与`package-lock.json`。基础镜像tag、系统包仓库和模型revision仍未全部按digest冻结，不能据固定Git宣称完整运行环境可重现；正式发布还需记录镜像ID、依赖和实际权重revision。[上游Dockerfile][dockerfile]、[PGroonga镜像][pg-dockerfile]。

空数据库卷会执行`init-extensions.sql`；已有卷不会自动重跑。单API实例默认在启动时迁移schema，并使用本地embedder报告的维度。本例BGE-M3是1024维，与默认英文模型的384维不同，不能把已有384维数据卷直接换模型后继续写。首次模型加载可能较慢，检查cache下载、可用内存和日志，不用反复重启掩盖问题。

```sh
curl --fail-with-body http://127.0.0.1:18889/health/live
curl --fail-with-body http://127.0.0.1:18889/health/ready
docker compose exec -T db pg_isready -U hindsight_lab -d hindsight_lab
docker compose exec -T db psql -U hindsight_lab -d hindsight_lab -c "SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'pgroonga');"
curl --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:18889/v1/default/banks
curl --fail-with-body --config private/curl.conf http://127.0.0.1:18889/v1/default/banks
```

无key的bank列表预期401，有效key可以读取；health存活/就绪检查不验证LLM能力。打开[本机Control Plane](http://127.0.0.1:19999)，只检查bank列表；它持有共享后台key，loopback管理界面不等于对外多租户授权。先不要使用界面的retain/recall/reflect或LLM health按钮。[健康与认证路径][http]。

模型cache位于独立命名卷，包装层为其建立UID 1000目录。首次启动会联网取公共模型权重；本例显式跳过默认LLM启动探测，并关闭观察归纳。在全新空库、没有外部写入的条件下，基础启动/健康/认证检查不主动调用收费抽取接口。若复用旧库，worker仍可能执行其已有付费任务，不能套用这个前提。后面的retain、reflect、LLM health和归纳另涉及模型请求。[启动探测实现][startup]。未来启用专用worker时，应将API内置worker关闭，并让worker使用相同数据库、配置与模型；不能仅复制API而忽略稳定worker身份和任务恢复。[服务与worker][services]。

## 6 创建合成bank并核对生效配置

下文只用合成空间`handbook-agent-service-001`，与agent-service接入手册一致。每次独立新实验换bank名；恢复未知结果时保留原身份。PUT是创建或更新，不是create-only，因此先确认这个bank不存在，已有实验数据则停止并选择新名称。

```sh
export HINDSIGHT_URL=http://127.0.0.1:18889
export HINDSIGHT_BANK=handbook-agent-service-001
curl --silent --config private/curl.conf \
  --output private/receipts/bank-before.json --write-out '%{http_code}\n' \
  "$HINDSIGHT_URL/v1/default/banks/$HINDSIGHT_BANK/stats"
```

只在确认404且目标确为新实验空间后创建：

```sh
curl --fail-with-body --config private/curl.conf --request PUT \
  --header 'Content-Type: application/json' \
  --data '{"name":"Handbook synthetic owner","retain_mission":"仅保留合成用户明确表达的信息，不把助手建议写成用户事实。","enable_observations":false}' \
  "$HINDSIGHT_URL/v1/default/banks/$HINDSIGHT_BANK"
curl --fail-with-body --config private/curl.conf \
  "$HINDSIGHT_URL/v1/default/banks/$HINDSIGHT_BANK/config" \
  --output private/receipts/bank-config.json
```

在本地核对resolved配置中的归纳开关及retain mission，配置输出不直接粘贴到公共日志。创建报文支持`enable_observations`，而`enable_auto_consolidation`在此处继承模板的全局false；需要bank级覆盖时使用后文的`PATCH /config`，不能给创建报文塞入未支持字段。bank名由可信后端选择；共享key可以操作同schema中其他bank，命名和tags不能自动成为业务授权。[bank与配置API][http]。

## 7 显式预算下验证retain与recall

本节会调用抽取模型、本地embedding及可能的检索模型。先确认模型供应方、预算和网络，再创建一次性请求文件；它将caller UUID、原正文和document身份在发请求前保存，避免超时后丢失操作身份。

```sh
(
set -eu
python3 - <<'PY'
import json
import os
import uuid

request = {
    "async": True,
    "operation_id": str(uuid.uuid4()),
    "items": [{
        "document_id": "handbook-doc-001",
        "content": "合成用户表示：以后请使用简洁的中文回复。",
        "context": "只有合成用户在发言；这不是助手自己的偏好。",
        "timestamp": "2026-11-18T09:00:00-08:00",
        "tags": ["scope:handbook"],
        "metadata": {"fixture": "handbook-001"},
    }],
}
fd = os.open("private/retain-001.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as handle:
    json.dump(request, handle, ensure_ascii=False, indent=2)
print("Saved synthetic request and stable UUID before sending.")
PY
curl --fail-with-body --max-time 300 --config private/curl.conf \
  --header 'Content-Type: application/json' \
  --data-binary @private/retain-001.json \
  --output private/receipts/retain-001.json \
  "$HINDSIGHT_URL/v1/default/banks/$HINDSIGHT_BANK/memories"
)
```

请求创建失败则本段不发送；已有请求或不完整文件先核查，不能直接重跑发送段。发送成功或响应未知时，只按原请求文件中的UUID执行以下只读核对，不再次retain：

```sh
(
set -eu
HINDSIGHT_OPERATION_ID="$(python3 -c 'import json; print(json.load(open("private/retain-001.json"))["operation_id"])')"
curl --fail-with-body --config private/curl.conf \
  "$HINDSIGHT_URL/v1/default/banks/$HINDSIGHT_BANK/operations/$HINDSIGHT_OPERATION_ID"
)
```

`operation_id`必须为UUID，仅`async:true`生效。保存返回及后续status，必要时查看该bank的operations列表和子任务。`pending/processing`继续只读核对；`failed/cancelled`核查原因及已完成部分；`not_found`不证明从未执行，可能存在未知结果或已清理的终态历史。不要把超时当失败并换UUID重写，也不要对未知付费结果无条件调用retry。当前operation重放不比较完整body hash，客户端必须保留同一请求；它不是本项目完整幂等、源版本及屏障合同。[retain请求与操作ID][http]、[operation重放][replay]。

worker自身可能按配置重试失败任务；保留operation不表示供应方恰好计费一次。实验应同时核对任务attempt、错误和模型账单，明确哪些失败可安全恢复，不用“换一个UUID再试”掩盖未决费用。[异步操作与重试][operations]。

确认原操作completed并检查写入结果后，再召回：

```sh
curl --fail-with-body --config private/curl.conf \
  --header 'Content-Type: application/json' \
  --data '{"query":"这个合成用户希望怎样回复？","types":["world"],"budget":"low","max_tokens":1200,"tags":["scope:handbook"],"tags_match":"all_strict","include":{"chunks":{"max_tokens":1200}}}' \
  "$HINDSIGHT_URL/v1/default/banks/$HINDSIGHT_BANK/memories/recall" \
  --output private/receipts/recall-001.json
curl --fail-with-body --config private/curl.conf \
  "$HINDSIGHT_URL/v1/default/banks/$HINDSIGHT_BANK/documents/handbook-doc-001" \
  --output private/receipts/document-001.json
```

核对提取文字、world归属、document及原始片段，而不只看HTTP 200。召回可以为空，模型可能抽错；不要据一次合成样例宣称中文效果通过。`types`、`include`及返回结构以固定OpenAPI/schema为准。时间窗若以后通过`temporal_window`传入，只影响时间召回臂的排名，不是全部结果的硬过滤；严格时间查询还需可信适配层执行本项目时间合同。[recall请求模型][http]、[检索设计][retrieval]。

相同`document_id`的默认replace会删除旧内容并重处理，append则拼接后重处理；它们不是按文本相似判断“同一杯水”的业务身份机制。需要测替换时，使用另一个明确的合成文档及独立operation，并保存预期版本/请求；不要在持久化检查之前覆盖本例文档。

## 8 单独启用归纳及检查删除

只有基础摄取/召回已核对后，再为该合成bank启用observations，观察额外后台任务和费用。PATCH配置会持久保存bank覆盖，受`HINDSIGHT_API_ENABLE_BANK_CONFIG_API`控制；模板使用默认开启值：

```sh
curl --fail-with-body --config private/curl.conf --request PATCH \
  --header 'Content-Type: application/json' \
  --data '{"updates":{"enable_observations":true,"enable_auto_consolidation":true}}' \
  "$HINDSIGHT_URL/v1/default/banks/$HINDSIGHT_BANK/config"
curl --fail-with-body --config private/curl.conf --request POST \
  --header 'Content-Type: application/json' --data '{}' \
  "$HINDSIGHT_URL/v1/default/banks/$HINDSIGHT_BANK/consolidate"
curl --fail-with-body --config private/curl.conf \
  "$HINDSIGHT_URL/v1/default/banks/$HINDSIGHT_BANK/operations?limit=20"
```

记录归纳任务结果后，可用`types:["observation"]`及相同scope召回并检查支持事实。`reflect`会再运行检索/生成循环，mental models/pages的生成与刷新也有额外模型成本，均应另列实验，不把它们混入基础recall时延或费用。

需要验证重启持久化时，在仍保留本例文档期间停写，执行`docker compose stop`及`docker compose up -d`，再按原document及operation ID只读核对；不重发retain。确认后，只删除这个合成文档：

```sh
curl --fail-with-body --config private/curl.conf --request DELETE \
  "$HINDSIGHT_URL/v1/default/banks/$HINDSIGHT_BANK/documents/handbook-doc-001"
curl --silent --config private/curl.conf \
  --output private/receipts/document-after-delete.json --write-out '%{http_code}\n' \
  "$HINDSIGHT_URL/v1/default/banks/$HINDSIGHT_BANK/documents/handbook-doc-001"
```

删除后document读取预期404，再用原查询核对残留并检查operations。来源/观察删除、幸存支持重排队与自动主题刷新是不同阶段；自动主题刷新有best effort和配置边界，手动文档不一定自动处理。删除回执和一次空召回不能证明异步任务payload、LLM trace、Host历史、缓存及旧备份均已清理。默认operation终态历史没有TTL上限，原请求payload也应列入保留/擦除核查，不能将文档404当作请求副本已擦除。正式删除/撤权接入仍需本项目独立控制与消费者协议。[删除实现][delete]、[后续主题刷新][refresh]、[任务保留策略][operations]。

## 9 运维记录与备份恢复

| 操作 | 本例命令或核对 |
|---|---|
| 状态 | `docker compose ps` |
| 日志 | 本地检查`docker compose logs --tail 100 hindsight`，脱敏后分享，不输出展开配置 |
| 停机保留卷 | `docker compose stop --timeout 75` |
| 恢复同一实例 | 同目录、同`.env`和project执行`docker compose up -d` |
| 核引擎版本 | `docker compose exec -T hindsight python -c 'from importlib.metadata import version; print(version("hindsight-api-slim"))'` |
| 记录镜像 | `docker image inspect hindsight-handbook:b92ceb1 --format '{{.Id}}'` |

另记录源码commit、PostgreSQL/扩展版本、镜像digest、实际模型名称及权重revision、embedding维度、CPU/GPU、project名、所有bank覆盖和模型费用。模型cache可重下，当前授权/删除控制与来源数据不可用cache替代。模板`native`文件存储在数据库；未来切S3或其它外部存储后，备份范围必须增加相应对象及配置。

单实例实验可以手动停写备份：先停止App及其它写入者，再停Hindsight容器（包括内部worker），保留数据库。下列命令拒绝重用目录，并在导出失败时停止；`EXPORT_COMPLETED`只代表命令完成，不是恢复演练证明。

```sh
(
  set -eu
  umask 077
  mkdir -p backups
  mkdir backups/manual-001
  docker compose stop --timeout 75 hindsight
  docker compose exec -T db pg_dump -U hindsight_lab -d hindsight_lab -Fc > backups/manual-001/database.dump.partial
  mv backups/manual-001/database.dump.partial backups/manual-001/database.dump
  python3 -c 'from pathlib import Path; Path("backups/manual-001/EXPORT_COMPLETED").touch(exist_ok=False)'
)
```

备份含来源、模型产物、配置、任务及可能的日志，按受控敏感数据保存。另由独立安全渠道保管`.env`、curl凭证及模型配置，不把密钥放进Git或公开备份目录。

恢复先做**独立project、仅数据库的封闭演练**。仍在原部署目录使用相同数据库镜像和初始化脚本，显式换成从未使用的project名；下列程序先确认Docker可访问，再拒绝与已有同名卷重合：

```sh
export HINDSIGHT_RESTORE_PROJECT=hindsight-handbook-restore-001
(
set -eu
python3 - "$HINDSIGHT_RESTORE_PROJECT" <<'PY'
import re
import subprocess
import sys

project = sys.argv[1]
if not re.fullmatch(r"hindsight-handbook-restore-[a-z0-9-]+", project):
    raise SystemExit("Use a new restore-only project name")
subprocess.run(["docker", "info"], stdout=subprocess.DEVNULL, check=True)
names = set(subprocess.check_output(["docker", "volume", "ls", "--format", "{{.Name}}"], text=True).splitlines())
if any(project + "_" + suffix in names for suffix in ("pg_data", "model_cache")):
    raise SystemExit("Restore project volume already exists; choose a new isolated project.")
print("No pre-existing volume found for the restore project.")
PY
docker compose --project-name "$HINDSIGHT_RESTORE_PROJECT" up -d --wait db
docker compose --project-name "$HINDSIGHT_RESTORE_PROJECT" ps
)
```

确认这里只有新的db容器，原实验卷和API未被改动，再向**新project数据库**恢复。`--clean --if-exists`只允许用于此处已确认全新的隔离数据库，不能替换成原project或远程连接串；它用于清理新空库的预建扩展/schema对象，避免与dump定义冲突。任一命令失败即保持API关闭并核查原因。

```sh
(
set -eu
docker compose --project-name "$HINDSIGHT_RESTORE_PROJECT" exec -T db \
  pg_restore --exit-on-error --no-owner --clean --if-exists \
  -U hindsight_lab -d hindsight_lab < backups/manual-001/database.dump
docker compose --project-name "$HINDSIGHT_RESTORE_PROJECT" exec -T db \
  psql -U hindsight_lab -d hindsight_lab \
  -c "SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'pgroonga');"
)
```

此时仍处于数据库恢复核验阶段，**不要执行整个project的`up`或启动Hindsight服务**。备份里的pending/processing任务、归纳及自动维护可能随内置worker恢复并调用模型；`SKIP_LLM_VERIFICATION`只关闭启动探测，不会取消这些任务。先核数据摘要、原operation状态、预算、当前源删除/撤权控制，以及应禁止重新交付的内容。准备另一个受控配置和不冲突端口，明确API与worker是否允许执行后，再安排封闭HTTP/合成样例验收。模型cache不是权威数据，也不能证明删除控制已恢复；不能直接将旧备份重新挂到Agent召回通道。

升级时先记录现有运行构建、停写备份并在副本演练。上游主线默认启动迁移；正式环境可改为独占迁移步骤，真实管理命令是`hindsight-admin run-db-migration`，必要时显式指定`--embedding-dimension`。改变embedding模型/维度、词法后端或数据库主版本都需要迁移/重建及回退边界；不是改一个环境变量即可安全复用原数据。[迁移命令][migration]。

不要把`docker compose down -v`作为普通重启；不要用删除卷、重复retain或换operation ID修复未知结果。需要跨机访问时先设计私有网络/HTTPS网关、可信owner映射及scope；本例loopback URL不能直接供另一容器或另一台主机使用，也不应直接改成公网监听。

## 10 完成标准与待验证项

本轮只完成文档和静态核查。后续部署完成应至少留存：固定构建与配置摘要、扩展与迁移结果、无key拒绝/有key读取、合成retain与recall结果、重启持久化、明确删除残留、停写备份和隔离恢复证据。服务可启动、健康检查、一个成功样例分别证明不同范围，不代表完整中文质量、容量或本项目full_lifecycle验收。

| 现象 | 排查方向 |
|---|---|
| 初次启动迟迟不ready | 模型权重下载、cache权限、内存、数据库扩展/迁移；不反复触发新写入 |
| 中文相关性差 | 是否确用BGE-M3、PGroonga及适当reader；不要只确认模型能输出中文 |
| API正常但UI报401 | CP_DATAPLANE_API_KEY是否与自托管key一致；CP内部API URL是否正确 |
| 健康正常但retain失败 | 模型供应方、网络、key、配额和请求结果；health不做付费模型验证 |
| operation查不到 | 先核bank/原UUID、终态保留策略及未知结果；not_found不等于未执行 |
| 配置看似没变化 | 宿主Compose环境、CLI发现的`.env`、bank持久覆盖及静态/可覆写字段 |
| 重启后任务不恢复 | 稳定worker ID、退出宽限及原任务状态；必要时研究admin恢复命令，不盲重入队 |

[package]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-api-slim/pyproject.toml
[license]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/LICENSE
[services]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-docs/docs/developer/services.md
[installation]: https://hindsight.vectorize.io/developer/installation
[multilingual]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-docs/docs/developer/multilingual.mdx
[tenant]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-api-slim/hindsight_api/extensions/builtin/tenant.py#L43
[cp-client]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-control-plane/src/lib/hindsight-client.ts#L15
[config]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-api-slim/hindsight_api/config.py#L28
[configuration]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-docs/docs/developer/configuration.mdx
[dockerfile]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/docker/standalone/Dockerfile
[pg-dockerfile]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/docker/docker-compose/pgroonga/Dockerfile
[http]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-api-slim/hindsight_api/api/http.py
[replay]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-api-slim/hindsight_api/engine/memory_engine.py#L23642
[retrieval]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-docs/docs/developer/retrieval.md
[delete]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-api-slim/hindsight_api/engine/memory_engine.py#L11616
[refresh]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-api-slim/hindsight_api/engine/memory_engine.py#L21643
[migration]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-api-slim/hindsight_api/admin/cli.py#L640
[startup]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-api-slim/hindsight_api/engine/memory_engine.py#L6432
[operations]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-docs/docs/developer/api/operations.mdx
