# Mem0 自托管服务部署 Handbook

适用日期：2026-11-13。目标：在一台开发机或独立实验主机上部署Mem0 OSS REST服务，供自己的后端调用，并能检查启动、认证、存储、检索和停机备份。

**Mem0 OSS采用Apache-2.0许可证，可以自行部署成HTTP服务。** 不需要Mem0 Platform账号；本手册主线使用自建PostgreSQL、SQLite和dashboard，抽取与embedding默认调用OpenAI API。自托管存储与模型推理是否本地，是两个独立选择。[许可证][license]、[官方自托管入口][setup]。

本手册附带部署模板和手动检查脚本，固定Mem0源码commit为 `f1791daa86d469249c9b002f62644d58a1eb96a0`、Python包2.2.1。它是可供执行的实验指南，模板尚未经过镜像构建或真实模型联调；本仓库的MemoryService合同和实现状态不因此改变。完成部署后，继续阅读 [agent-service接入Handbook](mem0-agent-service-integration.md)。

## 1 部署完成后得到什么

```text
可信App后端或agent-service适配层
               │ HTTP + X-API-Key
               ▼
      Mem0 FastAPI 127.0.0.1:18888
          │                  │
   PostgreSQL + pgvector   SQLite history/messages
          │
   mem0_app账号与配置库

浏览器 → Dashboard 127.0.0.1:13000
Mem0 → 配置的抽取模型与embedding服务
```

| 组件 | 本手册配置 | 数据及用途 |
|---|---|---|
| API | 宿主18888映射容器8000，只绑定loopback | `/memories`、`/search`、`/docs` |
| dashboard | 宿主13000映射容器3000，只绑定loopback | 首次设置、账号、API key和记忆管理 |
| PostgreSQL 17与pgvector | 无宿主端口 | postgres库保存记忆payload/向量；mem0_app保存账号、配置和日志 |
| SQLite | `deploy.handbook/state/history` | history及供抽取参考的近期messages |
| 模型 | 默认gpt-5-mini与text-embedding-3-small | 需要独立供应方凭证及预算 |

Mem0 OSS不是“把所有聊天完整可靠保存”的业务台账；默认add会抽取记忆，精确记录和统计仍由业务后端负责。服务API key只完成后台账户认证，不自动隔离业务用户；原始端口应由可信后端持有和访问。[固定server源码][server]、[研究中的边界说明](../../research/mem0-focused-research.md#6-自托管的授权可靠性与擦除边界)。

## 2 准备环境和版本

需要Git、Docker Engine或Docker Desktop、Docker Compose插件，以及宿主Python 3.10以上用于检查脚本。Docker构建会下载基础镜像和依赖；默认模型调用可能收费。先准备独立实验目录、空闲18888/13000端口和可持久保存的数据位置。

本手册不操作已有agent-service的MySQL、Redis、OWNER、模型配置或运行进程。不要把已有Mem0卷升级、跨PostgreSQL主版本迁移混入首次安装。

在本仓库根目录记录样例位置，然后clone到一个尚不存在的新目录；下面路径可按机器调整：

```sh
export MEM0_HANDBOOK_EXAMPLES="$(pwd)/docs/handbooks/examples/mem0"
export MEM0_LAB_ROOT="$HOME/ai-workspace/mem0-selfhost-lab"
git clone https://github.com/mem0ai/mem0.git "$MEM0_LAB_ROOT"
git -C "$MEM0_LAB_ROOT" checkout f1791daa86d469249c9b002f62644d58a1eb96a0
git -C "$MEM0_LAB_ROOT" rev-parse HEAD
git -C "$MEM0_LAB_ROOT" status --short
```

若目标目录已经存在，先检查它的版本和数据，不覆盖旧环境。预期HEAD是上述完整commit，首次clone工作区干净。[固定源码][source]。

## 3 复制独立部署模板

官方开发Compose会启动时重装未固定版本的mem0ai、挂载源码并启用reload。本手册使用一份**独立完整Compose**：从固定源码构建API，运行时不再pip安装，不叠加官方Compose，也不发布数据库端口。[官方开发配置][upstream-compose]。

在上一步的shell中执行：

```sh
mkdir -p "$MEM0_LAB_ROOT/deploy.handbook"
cp "$MEM0_HANDBOOK_EXAMPLES/Dockerfile" "$MEM0_LAB_ROOT/deploy.handbook/"
cp "$MEM0_HANDBOOK_EXAMPLES/compose.yaml" "$MEM0_LAB_ROOT/deploy.handbook/"
cp "$MEM0_HANDBOOK_EXAMPLES/.env.example" "$MEM0_LAB_ROOT/deploy.handbook/"
cp "$MEM0_HANDBOOK_EXAMPLES/mem0-smoke.py" "$MEM0_LAB_ROOT/deploy.handbook/"
cp "$MEM0_HANDBOOK_EXAMPLES/dockerignore.example" "$MEM0_LAB_ROOT/.dockerignore"
cd "$MEM0_LAB_ROOT/deploy.handbook"
```

样例原件：[Dockerfile](examples/mem0/Dockerfile)、[Compose](examples/mem0/compose.yaml)、[环境变量样例](examples/mem0/.env.example)、[构建上下文排除项](examples/mem0/dockerignore.example)、[检查脚本](examples/mem0/mem0-smoke.py)。这里只针对全新clone复制 `.dockerignore`；已有自定义规则时需人工合并。

`.dockerignore`只控制镜像构建，不控制Git。为这个新Mem0 checkout增加本地忽略规则，并用不存在的占位路径核对，不读取任何秘密文件：

```sh
cat >> ../.git/info/exclude <<'EOF'
/deploy.handbook/private/
/deploy.handbook/state/
/deploy.handbook/backups/
EOF
git -C .. check-ignore deploy.handbook/private/probe.key deploy.handbook/state/probe.db deploy.handbook/backups/probe.dump
```

API镜像只复制明确的代码文件，不复制 `.env`、私有key、history或备份。Dockerfile会确认安装的mem0ai为2.2.1，并保存 `pip freeze`。基础镜像tag和传递依赖仍未全部锁定；需要可重现发布时，还应锁镜像digest、全部依赖及构建产物，不能把源码commit等同于完整运行环境锁定。

首次启动前，在新实验目录内由宿主创建受保护的SQLite数据目录，避免依赖Docker自动创建bind目录的默认权限：

```sh
umask 077
mkdir -p state/history
chmod 700 state state/history
```

## 4 私下配置环境变量

下列本地命令创建权限0600的 `.env`，生成数据库密码和JWT秘密，**不把这些值打印出来**。在 `deploy.handbook` 目录执行一次；已存在 `.env` 时会停止：

```sh
python3 - <<'PY'
import os
from pathlib import Path
import secrets

text = Path(".env.example").read_text()
text = text.replace("POSTGRES_PASSWORD=\n", "POSTGRES_PASSWORD=" + secrets.token_hex(24) + "\n", 1)
text = text.replace("JWT_SECRET=\n", "JWT_SECRET=" + secrets.token_urlsafe(48) + "\n", 1)
fd = os.open(".env", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as handle:
    handle.write(text)
print("Created private .env; set the model provider key locally before starting.")
PY
```

然后用本地安全编辑方式填写 `OPENAI_API_KEY`，不要把真实 `.env`、key或完整展开配置粘进聊天、Git或公共日志。

| 配置 | 本手册要求 |
|---|---|
| POSTGRES_PASSWORD | 必填；使用生成的URL-safe值，避免固定源码手拼URL时被特殊字符破坏 |
| JWT_SECRET | 必填；即使设置ADMIN_API_KEY也不能省略 |
| OPENAI_API_KEY | 主线默认抽取与embedding都用它；这不是Mem0 Platform key |
| AUTH_DISABLED | 保持false，模板也显式固定为false |
| ADMIN_API_KEY | 首次部署保持空，使用浏览器创建的可撤销key |
| MEM0_COMPOSE_PROJECT | 默认mem0-handbook；必须与其他实例区分，并在后续运维时保持一致 |
| APP_DB_NAME及POSTGRES_DB | 模板固定mem0_app与postgres，与官方初始化脚本一致 |
| MEM0_TELEMETRY | 模板固定false |

使用干净的实验shell，避免继承其他项目的同名Compose变量。模板为API和PostgreSQL显式使用相同的密码插值，防止一端取宿主环境、另一端取文件而不一致；后续操作保持相同的私有配置与环境来源。

启动前检查端口占用和配置语法：

```sh
lsof -iTCP:18888 -sTCP:LISTEN
lsof -iTCP:13000 -sTCP:LISTEN
docker compose version
docker compose config --quiet
```

`lsof` 没有输出通常表示该检查未发现监听进程；仍需结合命令是否可用判断。`config --quiet`只验证配置，不启动服务。不要改成把完整 `docker compose config` 输出发出来，其中可能展开秘密。

## 5 构建启动和首次设置

```sh
docker compose build mem0 dashboard
docker compose up -d
docker compose ps
```

API启动时执行Alembic迁移，然后运行单worker uvicorn；无reload和启动时pip安装。第一次PostgreSQL空卷初始化会创建mem0_app。旧卷不会重跑init脚本，因此本手册只用于全新实例。

分别检查：

```sh
curl --fail-with-body http://127.0.0.1:18888/auth/setup-status
curl --fail-with-body http://127.0.0.1:13000/api/health
docker compose exec -T postgres pg_isready -U postgres -d postgres
```

首次API应返回 `needsSetup:true`。打开 [本机dashboard](http://127.0.0.1:13000)，注册管理员；模型配置保留已由环境提供的默认项，不在页面再次填写真实key。生成标记为agent-service实验用途的API key并安全保存；Use Case页选择Skip，Quick Test页先不要点Run Test，可直接前往 `/dashboard/requests` 或 `/dashboard/api-keys`。

模板在API和dashboard两个容器中均设置相同的DASHBOARD_URL：前者用于CORS，后者决定refresh cookie的Secure策略。本机HTTP示例使用http；以后切HTTPS时要同时更新对应URL和cookie条件，不能只改API侧配置。[dashboard刷新路由][refresh-cookie]。

向导中的Generate instructions会调用LLM，Run Test会用setup-test这个owner执行默认infer:true写入，涉及抽取、embedding和持久数据。需要使用这些按钮时，先计入独立模型预算；本手册主线将它们与初始化分开。[向导源码][wizard]。

首次注册者成为管理员，所以应在仍只绑定loopback时完成初始化。创建后setup状态变为false；完整key只显示一次。

本例不使用 `make bootstrap`：官方seed会把管理员密码和key打印到终端，重复执行也不是无副作用的恢复操作。丢失key时通过登录后新建并撤销旧key处理；不要通过删除数据卷修复认证。

登录、key与Mem0业务owner是不同身份。管理员创建的key仍继承管理员能力，key标签不会将它限制到某个业务user_id。后续接入必须经过可信业务适配层。[认证和key实现][auth]、[key路由][keys]。

用不回显的输入保存API key到本地文件，供后面的脚本读取：

```sh
python3 - <<'PY'
import getpass
import os
from pathlib import Path

Path("private").mkdir(mode=0o700, exist_ok=True)
key = getpass.getpass("Paste the self-hosted Mem0 API key: ").strip()
if not key or "\n" in key or "\r" in key:
    raise SystemExit("Invalid key input")
fd = os.open("private/agent-service-mem0.key", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as handle:
    handle.write(key + "\n")
print("Saved private key file.")
PY
```

## 6 分开验证认证 CRUD和抽取

先运行只读检查，不调用抽取或embedding：

```sh
python3 mem0-smoke.py --key-file private/agent-service-mem0.key
```

它检查setup完成、无key访问被401拒绝、有效key能读取一个空的合成scope。健康检查通过只说明相关HTTP/账号数据库路径可达，不证明模型可用。

准备好独立embedding预算后，再运行合成CRUD。每次使用一个新的receipt文件；脚本不自动重试写请求：

```sh
mkdir -p private/receipts
python3 mem0-smoke.py \
  --key-file private/agent-service-mem0.key \
  --write --receipt-file private/receipts/smoke-001.json
```

脚本按顺序执行raw add、get、search、update、delete和history检查。`infer:false` 仍调用embedding，因此这一步有模型依赖和可能费用；它不验证LLM抽取。删除后按ID获取在固定实现中是 **200和JSON null**，history仍保存DELETE及旧文本，脚本会明确提示未证明物理擦除。

receipt只记录合成owner、memory ID和阶段，以原子替换更新，便于手工核对，不提供完整事务outbox保证。若写入超时，保留它并只读核对对应owner；不要重跑同一次操作、换receipt或批量删除来掩盖未知结果。脚本不会清理失败中途可能产生的数据，也不会调用全库reset。

要验证真实抽取，再经受控客户端发送一条合成的 `infer:true` 消息，如“实验项目使用PostgreSQL，我偏好简洁中文回复”，检查提取结果和后续搜索。空候选、抽取失败和正确记忆要分别记录；CRUD脚本通过不能代替此项。

CRUD脚本正常完成时已删除测试对象；持久化验证应另外保留一条独立合成记忆。在 `/docs` 中用自托管API key完成Authorize，经 `POST /memories` 写入以下新实验owner（重复试验时更换编号），保存返回id：

```json
{
  "user_id": "handbook:persistence-001",
  "infer": false,
  "messages": [{"role": "user", "content": "仅供重启持久化检查的合成记忆。"}]
}
```

确认按ID读取的user_id和正文后，停写并执行 `docker compose stop`、`docker compose up -d`。再次按原ID获取并核对内容，不重发add。核对通过后只删除该ID；history残留边界仍适用。此实验同样会调用embedding，单列预算和结果。

## 7 保存运行版本和日常操作

```sh
docker image inspect mem0-handbook-api:f1791daa --format '{{.Id}}'
docker compose exec -T mem0 python -c 'from importlib.metadata import version; print(version("mem0ai"))'
docker compose exec -T mem0 cat /opt/mem0-build-freeze.txt > mem0-build-freeze.txt
```

另记录源码commit、基础镜像及PostgreSQL镜像digest、实际模型名称、collection和维度、Compose project及数据目录。上述freeze与版本命令不会输出配置key。

| 操作 | 命令或动作 |
|---|---|
| 查看状态 | `docker compose ps` |
| 诊断日志 | 本机检查 `docker compose logs --tail 100 mem0`；先脱敏再分享 |
| 停止服务保留数据 | `docker compose stop` |
| 恢复已有实例 | 同目录、同.env和project执行 `docker compose up -d` |
| 配置变更后重建API容器 | 受控停写后 `docker compose up -d --force-recreate mem0`；再验证配置和CRUD |
| 日志保留清理 | `docker compose exec -T -e PYTHONPATH=/app mem0 python scripts/prune_request_logs.py`；先确认私有环境中的保留天数 |

普通停机和修复不要执行 `docker compose down -v`、`make clean` 或 `/reset`。它们具有删除范围，与保留数据的停止不同。首次模型调用失败时，不通过无上限重启或写重试增加未知费用。

## 8 更换模型或完全本地运行

**主线首次启动默认固定OpenAI provider。** 仅设置Anthropic、Google或DeepSeek key不会自动切换provider；`MEM0_DEFAULT_*` 只改变模型名。当前server白名单的LLM为openai/anthropic/gemini，embedding为openai/gemini。[默认配置和校验][server]。

若希望更换provider，先在独立实验分支中完成以下步骤，再构建新镜像：

1. 核对目标provider依赖和Python SDK配置，安装所需依赖。
2. 对DeepSeek/Ollama等扩展server白名单，并将首次启动的DEFAULT_CONFIG改为目标provider；不要依赖先用无效OpenAI配置启动后再改。
3. embedding独立配置。完全本地需要同时提供本地LLM、本地embedding和持久化存储；容器内localhost指容器自身。
4. 改embedding模型或维度时使用新collection，显式匹配 `embedding_model_dims` 并重建；隔离实验也用新的history路径。
5. 配置key优先由容器安全环境解析，不把真实key提交到 `/configure` body；该接口会持久保存覆盖配置。切provider还需检查递归merge残留的api_key，不能把GET中的脱敏占位符回写。
6. 受控重启、核对持久配置和实际调用，再分别验证embedding与抽取。

这条路线需要派生配置/镜像开发；当前附带模板只实现默认OpenAI配置入口，未提供已经联调的Ollama部署包。[provider配置](../../research/mem0-focused-research.md#44-模型和存储替换)。

## 9 备份恢复和跨机器访问

备份前停止App写入及所有其它写入者，停API和dashboard，保留PostgreSQL运行。示例是手动停写备份，不是在线一致性备份：

```sh
(
  set -eu
  umask 077
  mkdir -p backups
  mkdir backups/manual-001
  docker compose stop --timeout 60 mem0 dashboard
  docker compose exec -T postgres pg_dump -U postgres -d postgres -Fc > backups/manual-001/postgres.dump.partial
  mv backups/manual-001/postgres.dump.partial backups/manual-001/postgres.dump
  docker compose exec -T postgres pg_dump -U postgres -d mem0_app -Fc > backups/manual-001/mem0_app.dump.partial
  mv backups/manual-001/mem0_app.dump.partial backups/manual-001/mem0_app.dump
  tar -czf backups/manual-001/history.tar.gz.partial -C state history
  mv backups/manual-001/history.tar.gz.partial backups/manual-001/history.tar.gz
  python3 -c 'from pathlib import Path; Path("backups/manual-001/EXPORTS_COMPLETED").touch(exist_ok=False)'
)
```

该命令拒绝复用已有manual-001目录，任一步失败立即停止；下次使用新的目录名。EXPORTS_COMPLETED仅表示导出命令完成，不等于恢复演练通过。备份包含敏感数据，放到受控加密存储。另经独立安全渠道保管 `.env`、原始API key和模型配置；数据库只有key hash，不能从备份恢复明文key。备份期间保持停写；完成摘要和文件完整性核对后，再恢复原实例。

恢复应在**隔离的新实例**、相同PostgreSQL/pgvector版本下进行：准备空库及相同角色，停API，恢复两个数据库与完整history目录，恢复安全配置，先执行只读检查，再经批准的合成数据检查验证。恢复旧备份前要补齐源删除/撤权控制和宿主门禁，不能直接把旧内容重新开放召回。此手册不提供覆盖现有生产库的一键恢复命令。

若agent-service在同一宿主机运行，调用 `http://127.0.0.1:18888`。若在其它容器或另一台主机，需显式设计共享私有网络或HTTPS网关：保持数据库不发布，限制API来源，完成认证与可信owner映射。不要把本例loopback地址照搬到另一容器，也不要为方便访问直接改成公网无约束监听。浏览器API URL、dashboard内部 `http://mem0:8000` 和业务后端URL分别配置。

## 10 常见问题和完成标准

| 现象 | 核对和处理 |
|---|---|
| API不能启动 | 检查JWT_SECRET、URL-safe数据库密码、postgres/mem0_app、模型key和镜像构建结果 |
| 显示healthy但add/search失败 | 健康检查不调用模型；核供应方、余额、网络和embedding配置 |
| 401 | 核本机自托管key、X-API-Key、撤销状态；不要混用Platform key或同时发送旧Bearer JWT |
| 422或参数未生效 | 检查OSS路径无/v1/尾斜杠、snake_case、filters；未知字段可能被忽略 |
| 重启后配置不像.env | 检查mem0_app.settings持久覆盖；不要把脱敏配置整包回写 |
| 改模型后检索异常 | 检查向量空间、维度和collection；新embedding重建到新collection |
| 删除后history还有文本 | 当前实现的预期边界，不能把delete回执解释为完整隐私擦除 |
| 同机可连、Agent容器不可连 | 检查网络拓扑；localhost属于发起请求的进程/容器 |

部署实验完成标准：确认固定引擎版本、持久卷与history目录；无凭证被拒、有效key可用；独立预算下CRUD及抽取分别验证；重启后合成记忆可读；了解数据备份、API key撤销和删除残留范围。完整生产授权、容量、可用性和擦除还需另行验收。

[license]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/LICENSE
[setup]: https://docs.mem0.ai/open-source/setup
[source]: https://github.com/mem0ai/mem0/tree/f1791daa86d469249c9b002f62644d58a1eb96a0
[server]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/server/main.py
[upstream-compose]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/server/docker-compose.yaml
[auth]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/server/auth.py
[keys]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/server/routers/api_keys.py
[wizard]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/server/dashboard/src/app/setup/page.tsx
[refresh-cookie]: https://github.com/mem0ai/mem0/blob/f1791daa86d469249c9b002f62644d58a1eb96a0/server/dashboard/src/app/api/auth/refresh/route.ts
