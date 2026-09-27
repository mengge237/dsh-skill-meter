// 服务端半边的端到端自检：拿假 ctx 把 /dsh-skill-meter/data.json 真跑一遍。
// 重点是 2026-09-21 加的那道信任栅栏与「响应里不再带跨域头」。
// 跑法：node test/routes.mjs（不启动 dsh、不碰 3080、不读真的 ~/.dsh）
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

// 必须在 import 插件之前设好 DSH_HOME：SESSIONS_ROOT / SKILLS_ROOT 是模块加载时算的。
process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsm-routes-'))

const mod = await import('../lib/index.js')

let passed = 0
async function ok(label, fn) {
  await fn()
  passed++
  console.log('  ok   ' + label)
}

function makeCtx() {
  const routes = new Map()
  const disposers = []
  return {
    routes,
    disposers,
    webServer: {
      register(route) {
        routes.set(route.path, route)
        const d = () => routes.delete(route.path)
        disposers.push(d)
        return d
      },
    },
    effect(fn) { const d = fn(); disposers.push(d); return d },
  }
}

// 默认带「本机页面同源」的头；headers: null = 一个头都不带
async function call(route, { headers } = {}) {
  const req = new Readable({ read() {} })
  req.method = 'GET'
  req.url = '/dsh-skill-meter/data.json?session=session-not-a-real-one'
  req.headers = headers === null ? {} : Object.assign(
    { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin' }, headers || {})
  let status = 0
  let raw = ''
  const res = {
    headers: null,
    writeHead(code, h) { status = code; this.headers = h || null; return this },
    end(text) { if (text) raw += text; return this },
  }
  await route.handler(req, res)
  let json = null
  try { json = raw ? JSON.parse(raw) : null } catch { json = { __unparsable: raw } }
  return { status, json, headers: res.headers, raw }
}

const ctx = makeCtx()
mod.apply(ctx)
const ROUTE = '/dsh-skill-meter/data.json'

await ok('路由注册上了，是 exact', () => {
  assert.ok(ctx.routes.has(ROUTE), ROUTE + ' 应该注册')
  assert.equal(ctx.routes.get(ROUTE).kind, 'exact')
})

await ok('同源请求照常 200，且响应不带 Access-Control-Allow-Origin', async () => {
  const got = await call(ctx.routes.get(ROUTE))
  assert.equal(got.status, 200)
  assert.equal(got.json.ok, false)
  assert.ok(Array.isArray(got.json.skills), '默认情况下清单照常返回（数组），页面才能照常渲染')
  assert.equal(got.json.lit, 0, '默认情况点亮数为 0')
  assert.equal(got.json.total, got.json.skills.length, 'total 要与清单长度一致')
  assert.equal(got.json.reason, 'no-archive', '假会话 id 该走「这个会话还没有存档」这条默认分支')
  assert.equal(got.json.error, undefined, '默认情况不许带 error —— 带了页面就会弹一条提示出来')
  assert.equal(got.headers['Access-Control-Allow-Origin'], undefined)
  assert.equal(got.headers['access-control-allow-origin'], undefined)
})

await ok('载荷里带 view，且它读不到时仍然是空数组（不许把路由搞成 500）', async () => {
  const got = await call(ctx.routes.get(ROUTE))
  assert.ok(got.json.view, '载荷该带 view 字段（侧边栏那张卡的分组与排序靠它）')
  assert.ok(Array.isArray(got.json.view.groups), 'view.groups 必须是数组 —— 文件不在/写坏了都算空')
  assert.equal(typeof got.json.view.file, 'string', 'view.file 该把真源路径告诉页面，方便排查')
})

await ok('跨站请求（cross-site + 外部 Origin）403', async () => {
  const got = await call(ctx.routes.get(ROUTE), {
    headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(got.status, 403)
  assert.equal(got.json.ok, false)
})

await ok('DNS 重绑定（Host 不是 loopback）403；没有 Host 也拒', async () => {
  assert.equal((await call(ctx.routes.get(ROUTE), { headers: { host: 'evil.example' } })).status, 403)
  assert.equal((await call(ctx.routes.get(ROUTE), { headers: null })).status, 403)
})

await ok('Origin 主机名与 Host 不一致时 403，一致时放行', async () => {
  assert.equal((await call(ctx.routes.get(ROUTE), { headers: { origin: 'http://127.0.0.1:3080' } })).status, 200)
  assert.equal((await call(ctx.routes.get(ROUTE), { headers: { origin: 'http://evil.example' } })).status, 403)
})

await ok('ctx.effect 收到的 disposer 能把路由摘掉', () => {
  const ctx2 = makeCtx()
  mod.apply(ctx2)
  assert.equal(ctx2.routes.size, 1)
  for (const d of ctx2.disposers) if (typeof d === 'function') d()
  assert.equal(ctx2.routes.size, 0)
})

console.log('\n' + passed + ' 项全过')
