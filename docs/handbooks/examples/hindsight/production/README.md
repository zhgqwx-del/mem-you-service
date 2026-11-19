# Hindsight远程中间件与独立worker生产部署样例

本目录是[生产环境部署Handbook](../../../hindsight-production-deployment.md)的候选配置，复制到独立部署目录使用。基线为Hindsight固定源码 `b92ceb180e349a456d2b5454575067b6ff0f6306`、API-slim 1.2.1；尚未构建镜像、展开真实Compose配置、连接数据库或调用模型，不代表生产或多实例验收通过。

主线采用**远程PostgreSQL 17＋pgvector＋PGroonga，远程LLM及独立TEI embedding/reranker，API与worker分离**。本Compose不启动本地数据库、Redis、队列、模型或Control Plane，也没有运行期build。任务协调使用共享PostgreSQL；模型、数据库和网关须在本样例之外准备。

## 1 文件及服务

| 文件 | 用法 |
|---|---|
| [compose.yaml](compose.yaml) | 单主机1 API＋1 worker起点，另有显式scale服务及独占迁移profile |
| [.env.example](.env.example) | 非秘密Compose参数，复制为`.env`并填镜像digest、路径、端口和worker ID |
| [runtime.env.example](runtime.env.example) | 复制为`private/runtime.env`，由安全流程填服务凭证及实际远程端点 |
| [migration.env.example](migration.env.example) | 复制为`private/migration.env`，独占迁移连接；不运行API |

```text
deploy.production/
  compose.yaml
  .env.example
  .env
  runtime.env.example
  migration.env.example
  private/
    runtime.env
    migration.env
    postgres-ca.pem
    postgres.pgpass
    migration.pgpass
```

默认启动`api-1`和`worker-1`。`api-2`、`worker-2`属于`scale` profile，`migrate`仅属于`migration` profile；均无`container_name`。API每容器一个进程，loopback端口分别为18889/18890；worker的8889只在容器网络内用于健康及指标，不发布宿主端口。负载均衡器在本文件之外配置。

每个worker都要有**全局唯一且稳定**的ID。不要直接使用`--scale worker-1=2`，也不要把另一台主机的`.env`原样复制后启动同名worker ID。示例采用显式worker-1/worker-2；扩到多主机时还需更换主机级project、ID和网关后端地址。单机多进程不能证明主机故障高可用。

候选模板的worker使用`restart: "no"`，由受控流程核对遗留任务和未知付费结果后显式启动；API保留`unless-stopped`。外部编排器也应遵守同一重启准入，不能重新加无条件自动拉起。关闭容器自动重启仍不阻止运行中重试、正常关闭回交或其它worker领取；严格的unknown付费隔离需要额外消费门禁，不由此模板提供。

## 2 镜像与目录准备

在受控构建环境按主手册从固定源码的`docker/standalone/Dockerfile --target api-only`构建，设置`INCLUDE_LOCAL_MODELS=false`及`PRELOAD_ML_MODELS=false`，测试后发布不可变镜像。四个runtime服务和迁移使用同一个已审查`registry/name@sha256:...`。不将源码commit形式的tag当作digest，也不在生产主机启动时pip/npm安装。

API-only镜像的PATH含`/app/api/.venv/bin`。本模板直接指定`hindsight-api`、`hindsight-worker`和`hindsight-admin`命令，替换原镜像`/app/start-all.sh`默认CMD；不运行Control Plane。固定镜像内用户为UID/GID 1000，根文件系统只读，仅`/tmp`使用临时内存目录。本主线没有本地模型权重或业务state卷。

从本仓库根目录开始，将模板复制到一个**尚不存在**的独立部署目录；先替换目标路径。拒绝复用已有目录，避免覆盖原实例配置：

```sh
export HINDSIGHT_PRODUCTION_TEMPLATE_ROOT="$(pwd)/docs/handbooks/examples/hindsight/production"
export HINDSIGHT_PRODUCTION_DEPLOY_ROOT="$HOME/ai-workspace/hindsight-deploy.production"
(
set -eu
test -f "$HINDSIGHT_PRODUCTION_TEMPLATE_ROOT/compose.yaml"
mkdir "$HINDSIGHT_PRODUCTION_DEPLOY_ROOT"
for HINDSIGHT_PRODUCTION_FILE in compose.yaml .env.example runtime.env.example migration.env.example README.md; do
  cp "$HINDSIGHT_PRODUCTION_TEMPLATE_ROOT/$HINDSIGHT_PRODUCTION_FILE" "$HINDSIGHT_PRODUCTION_DEPLOY_ROOT/$HINDSIGHT_PRODUCTION_FILE"
done
)
```

上一步成功后，进入该目录核对文件，再创建私密配置。已有`.env`或`private/`时停止检查，不覆盖：

```sh
(
set -eu
cd "$HINDSIGHT_PRODUCTION_DEPLOY_ROOT" &&
umask 077 &&
test ! -e .env &&
test ! -e private &&
cp .env.example .env &&
mkdir private &&
chmod 700 private &&
cp runtime.env.example private/runtime.env &&
cp migration.env.example private/migration.env &&
chmod 600 .env private/runtime.env private/migration.env
) && cd "$HINDSIGHT_PRODUCTION_DEPLOY_ROOT"
```

真实key、passfile和CA通过部署系统或独立安全渠道提供，不在命令行参数、Git、聊天或公开日志中填写。环境文件采用Docker dotenv格式，包含`$`等插值字符的秘密用单引号字面值并私下核对解析；不要用shell `source`读取。DBA预建数据库、扩展及专用schema。原版运行时可能懒建/重建索引，因此主线使用专用非superuser schema/table owner `hindsight_service`；独占迁移通过相同owner执行。迁移文件独立不代表已经实现纯DML运行角色分离，另一个DDL角色需要额外验证ownership及运行期DDL能力。

在常规rootful Linux Docker主机上，两个passfile应为**0600、UID/GID 1000:1000**，CA链可用0644。先由操作者安全创建文件，再按实际身份映射设置权限；rootless Docker、user namespace或其它UID需另核映射。本模板不自动chown未知目录。bind设置`create_host_path:false`，路径不存在时拒绝启动，不让Docker自动生成空目录。

`postgres.pgpass`和`migration.pgpass`均按下列格式匹配实际数据库DNS、端口、库名及role；此处是格式说明，不含可用密码：

```text
pg-primary.example.invalid:5432:hindsight_prod:hindsight_service:<privately-provided-password>
```

字段内的冒号与反斜线须按[PostgreSQL passfile规则](https://www.postgresql.org/docs/17/libpq-pgpass.html)转义。两个宿主文件分别用于runtime和迁移，但容器内都挂到`/etc/hindsight/postgres.pgpass`。passfile不会因为API共享key存在而免除数据库认证。

部署目录若位于源码checkout内，应先将`.env`、`private/`及备份路径加入该checkout的本地Git忽略，并从所有构建上下文排除。这里的生产主机不执行build；若以后重建镜像，也不能把此目录发送到上游源码构建上下文。

## 3 远程数据库与TLS

样例DSN**不含密码**，显式携带：

```text
postgresql://hindsight_service@pg-primary.example.invalid:5432/hindsight_prod?sslmode=verify-full&sslrootcert=/etc/hindsight/postgres-ca.pem&passfile=/etc/hindsight/postgres.pgpass
```

使用与证书SAN匹配的数据库DNS名；CA来自DBA或数据库供应方核对的可信链，不能以`sslmode=require`替代主机名和证书校验。

Hindsight的运行池把DSN传给asyncpg；迁移将同一URL规范化后交SQLAlchemy/psycopg2，迁移流程还会使用asyncpg连接。因此将`sslmode`、`sslrootcert`和`passfile`写入DSN，避免仅凭libpq的`PGSSL*`环境变量推论所有连接都经过TLS校验。这是配置传递依据，**本轮没有完成TLS握手或负例实测**。[运行池][pg-pool]、[URL规范化][db-url]、[迁移连接][migration-code]、[asyncpg参数](https://magicstack.github.io/asyncpg/current/api/index.html#asyncpg.connect)。

固定worker启动代码会打印完整`database_url`。本样例的密码放在passfile而非DSN，日志里仍会出现数据库主机/用户名等连接元数据；禁止把密码、token或签名URL放入DSN。若组织要求连连接元数据也不得落日志，需先修正上游日志或使用经验证的采集脱敏。该模板不是日志隐私改造。[worker启动日志][worker-log]。

本模板不启用read replica或连接池代理。`HINDSIGHT_API_READ_DATABASE_URL`显式为空；迁移直连主库，不走transaction-pooling端点。以后接PgBouncer、只读副本或多地域数据库，先验证会话设置、advisory lock、DDL、延迟和一致性；不能直接将生产DSN换成任意pooler地址。

## 4 模型与启动费用

runtime样例指定`tei` embedding和reranker，分别访问两个已部署的远程HTTPS端点；embedding服务须提供BGE-M3的1024维dense结果，迁移的`HINDSIGHT_EMBEDDING_DIMENSION=1024`与它对应。reranker端点要运行兼容的中文cross-encoder。主手册负责模型revision、tokenizer、归一化/距离和实际接口验收；本文件不部署TEI，也不声称任意模型都能用同一端点。

TEI embedder会调用`GET /info`并在初始化时真实`POST /embed`探测维度，reranker用`GET /info`及工作时的`POST /rerank`。因此即便设置`SKIP_LLM_VERIFICATION=true`，API/worker启动仍会使用远程embedding资源；此开关只跳过默认生成式LLM连接验证，不能理解为“启动完全无模型调用”。[TEI embedding][tei-embedding]、[TEI reranker][tei-reranker]。

固定TEI客户端没有任意Bearer key或客户端证书配置项；这里的主线要求可信TLS及私网/访问控制，仅允许部署节点访问。若端点要求额外Bearer/mTLS，须先部署经过核验的可信代理或开发适配，不增加虚构的`TEI_API_KEY`环境名。私有CA还需为Python/aiohttp准备正确且包含所有所需根证书的信任链，不能关闭证书校验。

首次使用先保持observations/自动巩固关闭；环境默认不保证覆盖已有bank持久配置，也不会取消数据库里已经排队的任务。启动worker前核原任务、预算和bank生效配置。运行时样例的operation保留30天仅为候选运维策略，过期后`not_found`不能证明未执行；记录和删除要求、外部journal恢复期应在发布前统一冻结。关闭LLM trace也不会清理既有trace或operation payload。

## 5 参数核对与启动顺序

先填`.env`非秘密参数，此文件只接受样例中的单行`NAME=value`和注释，不接受`export`前缀等额外语法；私有runtime/migration文件仍按Docker dotenv格式提供。以下是**全新安装检查**：读取Compose参数和文件元数据，并通过Docker只读查询拒绝已有同名project容器或网络；不读取passfile、运行期环境文件或CA内容，不回显值。新目录不证明数据库为空，DBA仍须确认本次目标库及schema。已有实例升级/恢复应使用原配置及主手册的停写、备份流程，不能换project绕过检查。检查之后的Compose操作应使用同一shell、同一目录和同一配置；不要在中间改变导出变量。

```sh
python3 - <<'PY'
import os
from pathlib import Path
import re
import stat
import subprocess

rows = {}
for raw_line in Path('.env').read_text().splitlines():
    line = raw_line.strip()
    if not line or line.startswith('#'):
        continue
    entry = re.fullmatch(r'([A-Z][A-Z0-9_]*)=(.*)', line)
    if entry is None:
        raise SystemExit('Use plain single-line NAME=value entries in the non-secret .env file')
    key, value = entry.groups()
    if key in rows:
        raise SystemExit('Duplicate Compose key')
    rows[key] = value.strip()
reserved = {'COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'COMPOSE_ENV_FILES',
            'COMPOSE_DISABLE_ENV_FILE', 'COMPOSE_PROFILES'}
if reserved.intersection(rows):
    raise SystemExit('Remove Compose control keys from the .env file before proceeding')
if (set(rows) | reserved).intersection(os.environ):
    raise SystemExit('Remove inherited Compose configuration names before proceeding')
if not re.fullmatch(r'[a-z0-9][a-z0-9._:/-]*@sha256:[0-9a-f]{64}', rows.get('HINDSIGHT_IMAGE', '')):
    raise SystemExit('Set one approved immutable image digest')
if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', rows.get('HINDSIGHT_COMPOSE_PROJECT', '')):
    raise SystemExit('Set one valid project name')
if not re.fullmatch(r'[a-z_][a-z0-9_]{0,62}', rows.get('HINDSIGHT_DB_SCHEMA', '')):
    raise SystemExit('Set one reviewed schema name')
if rows.get('HINDSIGHT_EMBEDDING_DIMENSION') != '1024':
    raise SystemExit('This example expects the reviewed 1024-dimensional embedding')
ids = [rows.get(key, '') for key in ('HINDSIGHT_WORKER_1_ID', 'HINDSIGHT_WORKER_2_ID')]
if len(set(ids)) != 2 or any(not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,62}', value) for value in ids):
    raise SystemExit('Set two different, globally unique stable worker IDs')
ports = [rows.get(key, '') for key in ('HINDSIGHT_API_1_PORT', 'HINDSIGHT_API_2_PORT')]
if len(set(ports)) != 2 or any(not value.isdigit() or not 1024 <= int(value) <= 65535 for value in ports):
    raise SystemExit('Set two distinct unprivileged local API ports')
for key in ('HINDSIGHT_RUNTIME_ENV_FILE', 'HINDSIGHT_MIGRATION_ENV_FILE'):
    path = Path(rows.get(key, ''))
    if not path.is_file() or stat.S_IMODE(path.stat().st_mode) != 0o600:
        raise SystemExit('Provide protected 0600 runtime and migration env files')
for key in ('HINDSIGHT_PG_PASSFILE', 'HINDSIGHT_MIGRATION_PASSFILE'):
    path = Path(rows.get(key, ''))
    if not path.is_file() or stat.S_IMODE(path.stat().st_mode) != 0o600 or path.stat().st_uid != 1000:
        raise SystemExit('Provide UID-1000-owned 0600 passfiles for rootful Linux Docker')
if not Path(rows.get('HINDSIGHT_PG_CA_FILE', '')).is_file():
    raise SystemExit('Provide the verified readable PostgreSQL CA file')
project_filter = 'label=com.docker.compose.project=' + rows['HINDSIGHT_COMPOSE_PROJECT']
for args in (['docker', 'ps', '-aq', '--filter', project_filter],
             ['docker', 'network', 'ls', '-q', '--filter', project_filter]):
    result = subprocess.run(args, text=True, capture_output=True)
    if result.returncode != 0:
        raise SystemExit('Docker resource query failed; stop and inspect privately')
    if result.stdout.strip():
        raise SystemExit('Existing project resources found; inspect the original deployment')
print('New-install parameters, file metadata and project checks passed; no secret values printed.')
PY
```

该检查同时拒绝`.env`及宿主环境中的上述Compose控制变量，防止后续改用未核验的配置文件、project或profile。[Compose变量来源](https://docs.docker.com/compose/how-tos/environment-variables/envvars/)。它不验证镜像来源、数据库权限、跨主机worker ID是否重复，或真实TLS/模型接口；这些仍须按主手册验收。

先由单个受控操作者独占运行迁移，确认成功后才进入API/worker阶段；不要多节点并发迁移：

```sh
(
set -eu
docker compose config --quiet
docker compose --profile migration run --rm --no-deps migrate
)
```

`migrate`使用`private/migration.env`及migration passfile，显式`--schema`和`--embedding-dimension`，不创建MemoryEngine或调用模型。它覆盖tenant扩展为空，仅用于不启动HTTP的单schemaCLI；基线builtin tenant没有额外业务表。接自定义tenant/validator时，须重新核对迁移provision路径及扩展一致性，不能照用此简化。

通过网络、TLS、权限、迁移和TEI验收后，按已核定预算启动API，再启动worker：

```sh
(
set -eu
docker compose up -d --wait api-1
docker compose up -d --wait worker-1
docker compose ps
)
```

健康端点只检查进程/数据库等就绪情况，不发起新的生成式LLM请求；进程初始化时的TEI探测和worker执行既有任务另计。API内置worker被关闭，独立`hindsight-worker`仍会执行任务；不能因同一环境中`WORKER_ENABLED=false`就认为worker CLI也停用了。

## 6 多实例与运维边界

完成单API/worker验证后，可显式启动第二对实例：

```sh
(
set -eu
docker compose --profile scale up -d --wait api-1 api-2 worker-1 worker-2
docker compose ps
)
```

仍须在可信TLS网关登记两个loopback后端并配置超时、限流和REST路由白名单；本例关闭MCP，不将stateful MCP会话自动分发到不同API。跨主机时loopback端口不互通，应改成受保护的私网监听/网关或编排服务发现，再逐项核验访问限制；不直接开放应用公网端口。

worker槽位示例总数2，并显式将默认的2个consolidation保留槽改为0，给retain等任务留出共享池；开启归纳后应重新测量公平性和预算，不能只降低总槽数而保留默认预留。每进程主连接池示例min=1、max=10，两个API加两个worker理论主池上限40，另外保留admin/迁移、监控和其它连接余量；这不是压测得出的容量建议。LLM、embedding和reranker并发限制同样是进程内配置，副本数增加会增加总压力，需按远程服务配额和真实积压调整。

worker减少、替换和崩溃恢复遵循主手册：先停止接新流量及相关旧进程，确认不会迟到执行，并在再次启动worker或释放processing之前核对未决模型结果。稳定ID重启会自动回收自己的遗留任务，不能先启动再等人工核对；结果仍未知时保持隔离，按受控恢复处理。不要把相同ID的两个进程同时运行，或将decommission命令当作免费、无副作用的只读诊断。网关、数据库高可用、凭证轮换、集中日志/指标、全局费用限额、依赖失效和删除/恢复门禁不由此Compose自动完成。

[pg-pool]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-api-slim/hindsight_api/engine/db/postgresql.py#L353
[db-url]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-api-slim/hindsight_api/db_url.py#L28
[migration-code]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-api-slim/hindsight_api/admin/cli.py#L565
[worker-log]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-api-slim/hindsight_api/worker/main.py#L373
[tei-embedding]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-api-slim/hindsight_api/engine/embeddings.py#L928
[tei-reranker]: https://github.com/vectorize-io/hindsight/blob/b92ceb180e349a456d2b5454575067b6ff0f6306/hindsight-api-slim/hindsight_api/engine/cross_encoder.py#L520
