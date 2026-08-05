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

const server = createServer(async (req, res) => {
  let path
  try {
    path = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname)
  } catch {
    return json(res, 400, { error: 'bad_url' })
  }

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
