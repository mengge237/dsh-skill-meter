// 发行件里不许出现本机路径 / 用户名 / 凭据形状。
//
// 「这份东西能不能公开」必须是闸，不能是记性 —— 而 README 是会跟着进 npm 包的，
// 所以它也算发行件：私有仓可以脏，发行件不能脏。
//
// 扫的范围严格等于 `npm pack` 真正打进去的那几个文件：package.json 的 `files` 字段，
// 加上 npm 无条件附送的 `package.json` 与 `LICENSE`；测试、docs、.github 都不进包，
// 不该被这条闸管（真扫全仓会把这个文件自己也扫进去）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

const RULES = [
  [/[A-Za-z]:[\\/]{1,2}(?:Users|S_Software|A_Workspace|Program Files)/i, '本机盘符路径'],
  [/\/c\/Users\//i, 'MSYS 形态的盘符路径'],
  [/\/home\/[A-Za-z0-9._-]+\//, 'POSIX 家目录'],
  [/\bLenovo\b/i, '本机用户名'],
  [/[A-Za-z0-9._%+-]+@(?:qq|gmail|outlook|hotmail|163|126|foxmail)\./i, '个人邮箱'],
  [/ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}/, '凭据形状'],
]

function walk(entry) {
  const abs = path.join(ROOT, entry)
  if (!fs.statSync(abs).isDirectory()) return [entry]
  return fs.readdirSync(abs, { withFileTypes: true })
    .flatMap((e) => walk(path.posix.join(entry, e.name)))
}

const files = [
  ...pkg.files.flatMap(walk),
  'package.json',                                        // npm 无条件带上
  ...fs.readdirSync(ROOT).filter((f) => /^LICEN[CS]E/i.test(f)),   // 同上
].sort()
assert.ok(files.length >= 6,
  '发行件数量不对（`npm pack --dry-run` 应至少 6 件）：' + files.join(', '))

const hits = []
for (const rel of files) {
  const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    for (const [re, what] of RULES) {
      if (re.test(line)) hits.push(rel + ':' + (i + 1) + ' [' + what + '] ' + line.trim().slice(0, 90))
    }
  })
}
assert.deepEqual(hits, [],
  '发行件里有不该公开的东西（`npm pack` 会原样带出去）：\n  ' + hits.join('\n  '))

console.log('脱敏自检通过：' + files.length + ' 个发行件 / ' + RULES.length + ' 条规则全无命中 —— ' + files.join(', '))
