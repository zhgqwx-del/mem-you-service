# Mem0远程PostgreSQL生产部署样例

本目录应复制到固定Mem0源码checkout的 `deploy.production/`，单独使用；不叠加开发Compose，也不自动启动本地PostgreSQL或dashboard。API源版本为 `f1791daa86d469249c9b002f62644d58a1eb96a0`、mem0ai 2.2.1，复用上级[Dockerfile](../Dockerfile)构建后，先发布并核对不可变镜像，再配置 `MEM0_IMAGE=registry/name@sha256:...`。不要将示例tag当作镜像digest。

完整步骤见[生产部署Handbook](../../../mem0-production-deployment.md)。

本样例只提供单API实例、单worker的部署起点，尚未经过构建、远程数据库连接或模型联调；不代表生产验收通过，也不提供多副本一致性。账号/配置及向量/payload在远程PostgreSQL，**history/messages仍为本地持久SQLite**，不能宣称全部数据已远程化。

## 目录与私密配置

```text
deploy.production/
  compose.yaml
  .env                     # 从本目录.env.example复制；仅Compose参数
  private/
    runtime.env            # 独立安全配置，权限0600；不随样例提供
    postgres-ca.pem        # 数据库供应方/DBA核对的CA链
  state/
    history/               # SQLite history.db及其伴随文件
    mem0/                  # MEM0_DIR，避免非root进程向~/.mem0写入失败
```

容器默认以 `10001:10001` 运行；两个state目录必须由该UID/GID可写，CA必须可读，父目录可遍历。可以改成主机选定的非root UID/GID，但必须同步所有权。不存在的绑定路径会报错，不让Docker自动创建root拥有的目录。

下列命令在全新 `deploy.production/` 目录中执行，在常规Linux Docker宿主上准备目录；已有配置或state时停止，不覆盖。若改用其他UID/GID或rootless Docker，先核对实际容器到宿主的身份映射，再相应调整所有权：

```sh
set -eu
umask 077
test ! -e .env
test ! -e private
test ! -e state
mkdir -p private state/history state/mem0
cp .env.example .env
chmod 700 private state/history state/mem0
sudo chown 10001:10001 state/history state/mem0
```

随后通过安全配置流程提供 `private/runtime.env`，设为部署操作者可读的0600。秘密生成与初始化见主手册。CA使用数据库供应方或DBA通过可信渠道提供的证书链，不含私钥；将下列来源路径替换为已核对文件，再复制，不从未经核对的端点自动下载并信任CA：

```sh
set -eu
MEM0_PG_CA_SOURCE=/absolute/path/to/verified-postgres-ca.pem
test -f "$MEM0_PG_CA_SOURCE"
test ! -e private/postgres-ca.pem
cp "$MEM0_PG_CA_SOURCE" private/postgres-ca.pem
chmod 644 private/postgres-ca.pem
```

填完非秘密 `.env` 后执行摘要及环境覆盖检查；它读取这份Compose参数文件，并检查已导出变量的名称，不读取或输出环境变量值、镜像值及 `private/runtime.env`。这不替代镜像来源、签名和实际digest核验。这里要求 `MEM0_IMAGE` 使用不带引号的单行值；若检查拒绝，使用干净部署shell取消相应Compose参数导出后再执行，不能跳过检查。

```sh
python3 - <<'PY'
import os
import re
from pathlib import Path

rows = {}
for line in Path('.env').read_text().splitlines():
    if line and not line.lstrip().startswith('#') and '=' in line:
        key, value = line.split('=', 1)
        if key.strip() in rows:
            raise SystemExit('配置项重复；先修正.env')
        rows[key.strip()] = value.strip()
# Compose的已导出变量优先于.env；拒绝部署shell里的同名覆盖。
reserved = {'COMPOSE_FILE', 'COMPOSE_ENV_FILES', 'COMPOSE_PROFILES', 'COMPOSE_PROJECT_NAME', 'COMPOSE_DISABLE_ENV_FILE'}
if (set(rows) | reserved).intersection(os.environ):
    raise SystemExit('存在已导出的Compose覆盖变量；在干净部署shell中取消相关导出后重新检查')
image = rows.get('MEM0_IMAGE', '')
if not re.fullmatch(r'[a-z0-9][a-z0-9._:/-]*@sha256:[0-9a-f]{64}', image):
    raise SystemExit('MEM0_IMAGE必须填写不可变镜像引用及64位小写sha256摘要')
print('PASS: 镜像引用的摘要形状符合要求；仍须核验来源与实际digest')
PY
```

Compose 插值时 shell 环境优先于 .env，检查与实际部署必须使用同一配置上下文；上述脚本因此拒绝同名导出及其他 Compose 配置覆盖。参见[Docker 官方插值说明](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)。

`.env`保存非秘密Compose参数；`private/runtime.env`至少需要以下项目，其值由安全渠道提供，不能把真实文件纳入Git、日志或聊天：

```dotenv
POSTGRES_HOST=postgres.example.invalid
POSTGRES_PORT=5432
POSTGRES_DB=mem0_vectors
APP_DB_NAME=mem0_app
POSTGRES_USER=mem0_service
POSTGRES_PASSWORD=
JWT_SECRET=
OPENAI_API_KEY=
ADMIN_API_KEY=
POSTGRES_COLLECTION_NAME=memories
MEM0_DEFAULT_LLM_MODEL=gpt-5-mini
MEM0_DEFAULT_EMBEDDER_MODEL=text-embedding-3-small
REQUEST_LOG_RETENTION_DAYS=30
```

保留 `ADMIN_API_KEY` 为空；初始化后经受控登录创建可撤销API key。数据库密码使用URL-safe随机值，避免固定源码手拼URL时发生解析错误。认证、真实模型key及数据库权限必须在启动前准备好；不要把上述空白配置当成可直接运行的凭证。

固定server默认APP DB和pgvector共用 `POSTGRES_HOST/PORT/USER/PASSWORD`，分别使用 `APP_DB_NAME` 和 `POSTGRES_DB`。远程数据库及相应角色、pgvector扩展和权限由DBA预先建立；本样例不执行官方Docker的本地建库init脚本。迁移角色需要相应DDL权限；stock server首次创建向量/实体collection也需要相应权限，不能未经验证就宣称运行角色只有行级读写权限。

## 迁移与启动顺序

在 `deploy.production/` 中，先完成私密文件和权限、镜像digest检查及远程数据库预置，然后执行：

```sh
docker compose config --quiet
docker compose --profile migration run --rm --no-deps migrate
docker compose up -d mem0
docker compose ps
```

校验和部署使用同一shell、同一.env与compose.yaml，期间不改变相关导出变量；每一条成功后才执行下一条。`migration` profile内的 `migrate` 服务只执行 `alembic upgrade head`，不发布端口、不调用模型；由单个受控操作者运行，不能与多个节点并发迁移。API的command覆盖镜像原CMD，仅启动单worker uvicorn，不自动迁移、不启用reload、不在启动时pip安装。

API只发布宿主 `127.0.0.1:18888`，由同机受控TLS网关转发。首次注册和创建key完成前，网关不得把公开注册接口开放给无关访问者。网关还需落实来源限制、限流及可信业务owner映射；本文件不配置TLS网关，也不把后台API key等同于多owner授权。

根文件系统只读；SQLite和Mem0运行目录单独持久化，`/tmp`为临时内存目录。备份需要同时覆盖远程两个数据库、本地history及必要配置，不能只备份远程向量。普通停机使用 `docker compose stop mem0`，不删除state目录。

## 数据库TLS与核验边界

API和迁移进程都显式收到 `PGSSLMODE=verify-full`、`PGSSLROOTCERT=/etc/mem0/postgres-ca.pem`；CA以只读文件绑定。固定源码的APP DB由SQLAlchemy调用psycopg，默认pgvector由psycopg/psycopg_pool连接；两条默认连接均没有在conninfo中显式覆盖sslmode，因而由底层libpq读取这些环境参数。见[APP连接代码][app-db]、[pgvector连接代码][vector-db]及[libpq环境参数][libpq-env]。

这说明配置传递路径，不表示本轮完成了TLS握手验证。必须使用证书匹配的数据库DNS主机名，在两个数据库中分别核对 `pg_stat_ssl` 当前连接及数据库版本；只核对APP DB不能证明向量连接也安全。若已有settings覆盖配置含不同host、connection_string或显式sslmode，其优先级可能改变实际行为，须先核对，不能假定环境强制覆盖显式conninfo。

Compose只检查 `MEM0_IMAGE`非空，完整 `@sha256:` digest形状及镜像来源需按主手册在部署前验证。`docker compose config --quiet`不会运行服务，但会读取配置及env_file；不要分享完整展开后的配置或 `docker inspect` 的环境段。

[app-db]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/server/db.py#L7
[vector-db]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/mem0/vector_stores/pgvector.py#L192
[libpq-env]: https://www.postgresql.org/docs/17/libpq-envars.html
