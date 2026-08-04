# Qu Phone 登录服务端

## 目录

登录系统的前端三件套单独放在 `auth/`，不跟主站的 `js/` `css/` 混在一起：

```
auth/
├── verify.html     # 唯一公开页，服务端把它挂到 /verify.html
├── verify.css      # 自带设计变量与全局重置（未登录时 base.css 会 401）
├── verify.js       # 领码 / 登录页脚本
└── app-auth.js     # 主应用登录态检查，index.html 里排在 store.js 之前
```

服务端在 `server/src/`，本地配置在 `.env.development`「已 gitignore」。

## 端口

| 服务 | 端口 | 说明 |
|---|---|---|
| Fastify | 3100 | 3000 被本机 NapCat 容器占着，所以挪开了 |
| PostgreSQL | 5433 | 映射到容器内 5432，避开本机可能已有的 5432 |
| NapCat WebUI | 6099 | 容器自带 |

## 启动

一共三个服务，各起各的。`npm run dev:server` **只起 Fastify**，不管 NapCat 和 Postgres：

| 服务 | 启动方式 | 平时要不要管 |
|---|---|---|
| PostgreSQL | `docker compose -f deploy/docker-compose.dev.yml up -d` | 不用，容器会自动起 |
| NapCat | 已是常驻容器，见下面的 NapCat 一节 | 不用，但重启后要扫码 |
| Fastify | `npm run dev:server` | 每次开发都要手动起 |

第一次跑：

```bash
docker compose -f deploy/docker-compose.dev.yml up -d
npm install
npm run dev:server
```

之后每次只要：

```bash
npm run dev:server
```

然后只能从 `http://localhost:3100/verify.html` 打开。不要用 `file://` 或另起一个静态服务器 ——
那样测不到 Cookie、服务端静态拦截和同源行为。

## 两种模式

`.env.development` 里的 `AUTH_MODE`：

- `napcat`：走真实机器人。需要 NapCat 已扫码登录，且配好反向 WebSocket（见下）。
- `mock`：没有机器人也能跑通全流程，用脚本顶替群消息：

  ```bash
  npm run mock:group-message -- --qq 1234567890 --group 489957947 --message "/SIGNUP QwQ-XXXXXX"
  ```

  脚本调的是 `napcat.ts` 里那个 `handleGroupMessage()`，和真消息同一个入口，
  所以 QQ 匹配、授权群校验、两码上限、累计发码统计全都照常生效。
  `NODE_ENV=production` 时 `AUTH_MODE=mock` 会让服务直接拒绝启动。

## NapCat

NapCat 是**独立的 Docker 容器**，跟 `npm run dev:server` 没关系 —— 那条命令只起 Fastify。
容器已经建好了，重启策略是 `unless-stopped`，Docker 一起来它就自己起，平时不用手动启动。

### 关键信息

| 项 | 值 |
|---|---|
| 容器名 | `napcat` |
| 镜像 | `mlikiowa/napcat-docker:latest` |
| 机器人 QQ | `2245383816` |
| WebUI | `http://127.0.0.1:6099` |
| WebUI token | `23bf38bcf0b3`「在 `~/napcat-data/config/webui.json`」 |
| 数据目录 | `~/napcat-data/{qq,config,plugins}` |
| 占用端口 | 127.0.0.1 的 3000、3001、6099 |

### 日常命令

```bash
docker ps --filter name=napcat          # 看是不是在跑
docker start napcat                     # 起「一般不需要，会自动起」
docker stop napcat                      # 停
docker restart napcat                   # 重启，会掉登录，见下
docker logs napcat --tail 40            # 看日志 / 看扫码二维码
```

### 扫码登录

**`docker restart` 之后 NapCat 会掉登录，停在扫码界面。** 这时候 `/health` 的 `botOnline`
是 false，服务端会拒绝发新的激活码（发出去也没人能验证）。

两种扫法，都要用 2245383816 这个号扫：

1. WebUI：打开 `http://127.0.0.1:6099`，token 填 `23bf38bcf0b3`，页面上有实时二维码。
2. 终端：`docker logs napcat --tail 40`，二维码直接画在日志里。二维码有效期只有一两分钟，
   过期了日志会刷出新的一张。

想免掉每次重启都扫，在 WebUI 设置里把 `autoLoginAccount` 填成 `2245383816`。

### 反向 WebSocket

已经写进 `~/napcat-data/config/onebot11_2245383816.json` 的 `network.websocketClients`
（改之前的原文件备份在同目录 `onebot11_2245383816.json.bak.20260804145023`）：

```json
{
  "name": "quphone",
  "enable": true,
  "url": "ws://host.docker.internal:3100/api/napcat/onebot",
  "messagePostFormat": "array",
  "reportSelfMessage": false,
  "reconnectInterval": 5000,
  "token": "<.env.development 里的 NAPCAT_ACCESS_TOKEN，两边必须一模一样>",
  "debug": false,
  "heartInterval": 30000
}
```

两个容易踩的点：

- **地址必须是 `host.docker.internal`**，不能写 `localhost` 或 `127.0.0.1` —— 那指的是容器自己，
  连不到宿主机上的 Fastify。
- **token 两边要一致**。对不上的话服务端会以 `4401 unauthorized` 关掉连接，
  日志里是「napcat: 拒绝一个 access_token 不匹配的 WS 连接」。改了 `.env.development` 的
  `NAPCAT_ACCESS_TOKEN` 就得同步改这个 JSON，然后两边都重启。

方向是 NapCat 主动连过来，所以不用给它开任何公网端口，Fastify 只暴露一个升级端点。

### 确认连上了

```bash
curl -s http://localhost:3100/health
```

`botOnline: true` 才算真的可用。它是 OneBot `get_status` 返回 `online=true` 且 `good!==false`
的结果，不是「WS 连着就算」—— NapCat 进程活着但 QQ 掉线时 WS 照样连着，那种状态下发码没有意义。

连上的瞬间服务端会自动拉一次全量群成员，并把群名回填到 `allowed_groups.name`，
登录页的授权群卡片就会从光秃秃的群号变成真实群名。想手动再同步一次：

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3100/api/admin/napcat/sync
```

### 容器万一没了怎么重建

数据都在 `~/napcat-data`，容器删了重建不会丢登录态和配置：

```bash
docker run -d --name napcat --restart unless-stopped \
  -e NAPCAT_UID=$(id -u) -e NAPCAT_GID=$(id -g) -e TZ=Asia/Shanghai \
  -p 127.0.0.1:3000-3001:3000-3001 -p 127.0.0.1:6099:6099 \
  -v ~/napcat-data/qq:/app/.config/QQ \
  -v ~/napcat-data/config:/app/napcat/config \
  -v ~/napcat-data/plugins:/app/napcat/plugins \
  mlikiowa/napcat-docker:latest
```

端口都绑在 `127.0.0.1` 上，不要去掉这个前缀 —— WebUI 和 OneBot 端口不能暴露到公网。

## 授权群

`.env.development` 的 `ALLOWED_QQ_GROUPS`，逗号分隔。它是唯一来源：
列进去的入库并启用，从里面删掉的会被置为 `enabled=false`（不删行，成员记录还引用着它）。
改完要重启服务端。

## 管理接口

都要 `Authorization: Bearer <ADMIN_TOKEN>`：

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3100/api/admin/overview
curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3100/api/admin/users/<QQ>
curl -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
     -d '{"status":"banned"}' http://localhost:3100/api/admin/users/<QQ>/status
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3100/api/admin/napcat/sync
```
