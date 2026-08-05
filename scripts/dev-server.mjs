// ===== 本地免登录调试服务器 =====
// 用途：不开 Fastify、不连 Postgres、不发激活码，直接把主站跑起来看效果。
// 只在本机跑，绝对不要拿去当生产服务 —— 它把登录接口硬编码成永远通过。
//
// 原理：api-base.js 在 localhost 下 API_BASE 为空串，登录请求走相对路径，
// 于是全落到这台服务器上，被下面的 /api/auth/* 假接口接住。前端源码无需改动。
//
// 启动：./start   或   npm run start:local

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, normalize, extname, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = resolve(import.meta.dirname, '..')
const PORT = Number(process.env.PORT) || 4100
const HOST = '127.0.0.1'
const OPEN = process.env.NO_OPEN !== '1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
}

// verify.html 在源码里住 auth/，但 app-auth.js 跳的是根路径 —— 与 build:site 的拷贝行为保持一致
const ALIAS = { '/verify.html': '/auth/verify.html' }

// 数据看板：线上由 Cloudflare Pages Function 挂在 /auth202608，源码在 dashboard/
const DASH = '/auth202608'
// 看板要真数据，只能连真的 Fastify —— 上面那套假接口没有 /api/admin/*。
// 没配 ADMIN_TOKEN 就不转发，本文件"不连后端"的定位保持不变
const DASH_API = process.env.ADMIN_API_BASE || 'http://127.0.0.1:3100'
const DASH_TOKEN = process.env.ADMIN_TOKEN || ''

const DAY = 86400000

function json(res, code, body) {
  const buf = Buffer.from(JSON.stringify(body))
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store'
  })
  res.end(buf)
}

// 假登录态：字段名必须和真服务端的 /api/auth/me 一致，否则 app-auth.js 读不到
function fakeAuth() {
  return {
    authenticated: true,
    qq: '10000',
    sessionExpiresAt: Date.now() + 30 * DAY,
    offlinePassExpiresAt: Date.now() + 30 * DAY
  }
}

function handleApi(req, res, path) {
  if (path === '/api/auth/me') return json(res, 200, fakeAuth())
  if (path === '/api/auth/logout') return json(res, 200, { ok: true })
  // 其余登录接口（发码 / 校验）本地一律不该被调用，明确报错比装作成功好排查
  return json(res, 404, { error: 'dev_server_no_such_api', path })
}

async function serveFile(res, filePath) {
  const body = await readFile(filePath)
  res.writeHead(200, {
    'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length,
    // 调试期一律不缓存：省掉「改了代码看不到」的整类问题
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

// 看板的取数代理，对应线上的 functions/auth202608/api/[[path]].js。
// 本地不做密码校验：线上那道 Basic Auth 是给公网用的，本机没有公网
async function handleDashApi(req, res, path) {
  if (!DASH_TOKEN) {
    return json(res, 503, {
      error: 'not_configured',
      message: '本地看板需要 ADMIN_TOKEN，用 npm run start:dash 启动。'
    })
  }
  const search = new URL(req.url, `http://${HOST}`).search
  const target = DASH_API + '/api/admin/' + path.slice(DASH.length + 5) + search
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: { Authorization: 'Bearer ' + DASH_TOKEN },
      signal: AbortSignal.timeout(10000)
    })
    const body = Buffer.from(await upstream.arrayBuffer())
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store'
    })
    res.end(body)
  } catch (err) {
    json(res, 504, {
      error: 'upstream_unreachable',
      message: '连不上 ' + DASH_API + '，先起 npm run dev:server。',
      detail: String(err?.name ?? err)
    })
  }
}

const server = createServer(async (req, res) => {
  let path
  try {
    path = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname)
  } catch {
    return json(res, 400, { error: 'bad_url' })
  }

  // 必须排在 /api/ 判断之前：看板的接口路径里也带 /api/
  if (path.startsWith(DASH + '/api/')) return handleDashApi(req, res, path)
  // 线上 /auth202608/* 是 build:site 拷过去的 dashboard/*，本地直接改写前缀
  if (path === DASH || path === DASH + '/') path = '/dashboard/index.html'
  else if (path.startsWith(DASH + '/')) path = '/dashboard/' + path.slice(DASH.length + 1)

  if (path.startsWith('/api/')) return handleApi(req, res, path)

  if (path === '/' || path === '') path = '/index.html'
  if (ALIAS[path]) path = ALIAS[path]

  // 点开头的一律不发：.env / .git / .claude 都在项目根下，静态服务不该碰
  if (path.split('/').some((seg) => seg.startsWith('.'))) return json(res, 403, { error: 'forbidden' })

  // 目录穿越防护：normalize 之后必须还在 ROOT 里面
  const filePath = join(ROOT, normalize(path))
  if (!filePath.startsWith(ROOT)) return json(res, 403, { error: 'forbidden' })

  try {
    const info = await stat(filePath)
    await serveFile(res, info.isDirectory() ? join(filePath, 'index.html') : filePath)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end('404 ' + path)
  }
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  端口 ${PORT} 被占用了。换一个：PORT=4200 ./start\n`)
    process.exit(1)
  }
  throw err
})

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}/`
  console.log(`
  Qu Phone 免登录调试版
  ${url}

  登录接口已被假数据顶替，不需要激活码。Ctrl+C 停止。
`)
  if (OPEN && process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore' }).unref()
})
