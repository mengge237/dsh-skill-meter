// dsh-skill-meter —— 设置侧栏的 skill 状态卡片
//
// 数据来源全部是本机磁盘，不依赖 dsh 内部服务，也不改任何上游代码：
//   1) 清单：~/.agents/skills/<name>/SKILL.md 的 frontmatter（name / description）
//   2) 使用：当前会话存档 ~/.dsh/sessions/<工作区>/<会话 id>/session.jsonl.zstd 里的
//        - {"type":"tool/call", "data":{"name":"skill","arguments":"{\"name\":\"x\"}"}}
//        - 用户直接 /名字 触发时注入的 <skill_content name="x">
//      zstd 用 Node 24 自带的 zlib.createZstdDecompress 解，无需第三方依赖
//   3) 会话内可见清单（可选交叉核对）：存档里 source.kind === "skill-catalog" 的持久记录
//
// UI 不在这里：本包是双面板包，浏览器侧在 lib/client.js（package.json 的 exports["./client"]），
// 由宿主的客户端模块图发给页面并注册成 dsh-better-sidebar 的侧边栏页面。改服务端这半个文件要重启 dsh web。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const SKILLS_ROOT = path.join(DSH_HOME, '..', '.agents', 'skills')
const SESSIONS_ROOT = path.join(DSH_HOME, 'sessions')
const name = 'dsh-skill-meter'

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
}

function send(res, code, body, headers) {
  res.writeHead(code, headers || JSON_HEADERS)
  res.end(body)
}

function readFrontmatter(file) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return null
  const out = { name: '', description: '' }
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s?(.*)$/.exec(line)
    if (!kv) continue
    if (kv[1] === 'name') out.name = kv[2].trim().replace(/^["']|["']$/g, '')
    else if (kv[1] === 'description' && !out.description) out.description = kv[2].trim()
  }
  if (!out.name) return null
  return out
}

function listSkills() {
  const out = []
  let dirs = []
  try {
    dirs = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })
  } catch {
    return out
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const fm = readFrontmatter(path.join(SKILLS_ROOT, d.name, 'SKILL.md'))
    if (!fm) continue
    out.push({ name: fm.name || d.name, dir: d.name, description: fm.description, dirMismatch: fm.name !== d.name })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

// 找会话存档：指定就用指定的，否则取最近改动的那份（就是当前正在跑的会话）
function findTranscript(sessionId) {
  if (!fs.existsSync(SESSIONS_ROOT)) return null
  const hits = []
  const walk = (dir, depth) => {
    if (depth > 2) return
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (e.name === 'session.jsonl.zstd') hits.push(p)
    }
  }
  walk(SESSIONS_ROOT, 0)
  if (!hits.length) return null
  if (sessionId && /^[A-Za-z0-9_-]+$/.test(sessionId)) {
    const exact = hits.find((p) => p.includes('session-' + sessionId))
    if (exact) return exact
    // 明确点了名就没找到这回事：静默回落到最新存档会把别的会话的数当成这个会话的数，
    // 而且页面上完全看不出串了。所以指名找不到就返回 null，由路由报错误。
    // 只有压根没传 session（手测 curl）才走下面按 mtime 挑最新的。
    return null
  }
  hits.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs
    } catch {
      return 0
    }
  })
  return hits[0]
}

const cache = { file: null, stat: '', data: null, at: 0 }

// 存档是追加式多帧 zstd：Node 的流式解压器遇到第二帧就报 Unknown frame descriptor，
// 所以按帧魔数切开逐帧解（最后一帧可能正在写，解不动就跳过，不影响已落盘部分）。
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function decompress(file) {
  const buf = fs.readFileSync(file)
  const parts = []
  let i = 0
  for (;;) {
    const j = buf.indexOf(ZSTD_MAGIC, i)
    if (j < 0) break
    let k = buf.indexOf(ZSTD_MAGIC, j + 4)
    if (k < 0) k = buf.length
    try {
      parts.push(zlib.zstdDecompressSync(buf.subarray(j, k)))
    } catch {}
    i = k
  }
  return Buffer.concat(parts).toString('utf8')
}

async function analyze(file) {
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    return { error: '存档读不到' }
  }
  const stamp = stat.mtimeMs + ':' + stat.size
  if (cache.file === file && cache.stat === stamp) return cache.data  // 存档没长就没必要再解一遍

  let text
  try {
    text = decompress(file)
  } catch (e) {
    return { error: '解压失败 ' + e.message }
  }
  const used = new Map()
  const catalog = new Set()
  let turns = 0
  for (const line of text.split('\n')) {
    if (!line) continue
    const cheap = line.indexOf('"skill"') > -1
    if (!cheap && line.indexOf('skill-catalog') === -1 && line.indexOf('<skill_content') === -1) continue
    let j
    try {
      j = JSON.parse(line)
    } catch {
      if (line.indexOf('<skill_content') > -1) {
        for (const m of line.matchAll(/<skill_content name="([^"]+)"/g)) bump(used, m[1], '直接触发', null)
      }
      continue
    }
    const d = j.data || {}
    if (typeof d.turn === 'number' && d.turn > turns) turns = d.turn
    if (j.type === 'tool/call' && d.name === 'skill') {
      let args = d.arguments
      if (typeof args === 'string') {
        try { args = JSON.parse(args) } catch { args = null }
      }
      if (args && args.name) bump(used, String(args.name), '模型加载', d.turn)
    }
    const src = d.source
    if (src && src.kind === 'skill-catalog' && Array.isArray(src.entries)) {
      for (const e of src.entries) if (e && typeof e.name === 'string') catalog.add(e.name)
    }
    for (const m of line.matchAll(/<skill_content name="([^"]+)"/g)) bump(used, m[1], '直接触发', d.turn)
  }
  const data = {
    transcript: path.basename(path.dirname(file)),
    file: path.basename(file),
    bytes: stat.size,
    mtime: new Date(stat.mtimeMs).toISOString(),
    turns,
    used: [...used.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count),
    catalog: [...catalog].sort(),
  }
  cache.file = file
  cache.stat = stamp
  cache.data = data
  cache.at = Date.now()
  return data
}

function bump(map, name, how, turn) {
  if (!name) return
  const cur = map.get(name) || { count: 0, how: [how], firstTurn: turn ?? null, lastTurn: turn ?? null }
  cur.count += 1
  if (!cur.how.includes(how)) cur.how.push(how)
  if (turn != null) {
    if (cur.firstTurn == null) cur.firstTurn = turn
    cur.lastTurn = turn
  }
  map.set(name, cur)
}

const inject = ['webServer']

function apply(ctx) {
  const disposers = []

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/' + name + '/data.json',
    async handler(req, res) {
      let url
      try {
        url = new URL(req.url, 'http://127.0.0.1')
      } catch {
        return send(res, 400, JSON.stringify({ error: 'bad url' }))
      }
      const wanted = url.searchParams.get('session') || ''
      const file = findTranscript(wanted)
      const skills = listSkills()
      if (!file) return send(res, 200, JSON.stringify({ error: '这个会话的存档没找到（不拿别的会话顶上），会话 id: ' + (query.session || '(空)'), skillsRoot: SKILLS_ROOT, sessionsRoot: SESSIONS_ROOT, skills }))
      const a = await analyze(file)
      const usedNames = new Set((a.used || []).map((u) => u.name))
      // 拼成 UI 直接能用的形状：点亮 = 本会话真被加载过
      const rows = skills.map((s) => {
        const u = (a.used || []).find((x) => x.name === s.name)
        return { ...s, lit: usedNames.has(s.name), count: u ? u.count : 0, how: u ? u.how : [], firstTurn: u ? u.firstTurn : null, lastTurn: u ? u.lastTurn : null }
      })
      const ghost = (a.used || []).filter((u) => !skills.some((s) => s.name === u.name))
      send(res, 200, JSON.stringify({
        ok: true,
        session: a.transcript,
        sessionFile: a.file,
        bytes: a.bytes,
        mtime: a.mtime,
        turns: a.turns,
        error: a.error,
        skills: rows,
        lit: rows.filter((r) => r.lit).length,
        total: rows.length,
        ghost: ghost.map((g) => ({ name: g.name, count: g.count, how: g.how })),
        catalogSeen: a.catalog,
        skillsRoot: SKILLS_ROOT,
        notInCatalog: rows.filter((r) => r.lit && a.catalog.length && !a.catalog.includes(r.name)).map((r) => r.name),
      }))
    },
  }))


  ctx.effect(() => () => {
    for (const d of disposers) {
      try { d() } catch {}
    }
  })
}

export { name, inject, apply }
// 便于不启动 dsh 就直接验数据层（自检脚本用）
export const internals = { listSkills, findTranscript, analyze, SKILLS_ROOT, SESSIONS_ROOT }
