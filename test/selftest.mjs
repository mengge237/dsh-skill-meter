const M = await import('../lib/index.js')
const I = M.internals
console.log('skills 根:', I.SKILLS_ROOT)
console.log('会话根:', I.SESSIONS_ROOT)
const skills = I.listSkills()
console.log('清单条数:', skills.length)
console.log('frontmatter 目录名不一致:', skills.filter(s => s.dirMismatch).map(s => s.name + '<-' + s.dir))
const f = I.findTranscript('')
console.log('选中的存档:', f && f.replace(/\\/g, '/').split('/').slice(-3).join('/'))
const a = await I.analyze(f)
console.log('会话:', a.transcript, '| 轮次:', a.turns, '| 存档 MB:', (a.bytes / 1048576).toFixed(2))
console.log('已用:', a.used.map(u => u.name + 'x' + u.count + '(' + u.how.join('/') + ',首' + u.firstTurn + ')').join('  '))
console.log('catalog 条数:', a.catalog.length, '| 样例:', a.catalog.slice(0, 4).join(','))
const usedNames = new Set(a.used.map(u => u.name))
console.log('点亮:', usedNames.size, '/', skills.length)
console.log('点亮了但清单里没有(幽灵):', a.used.filter(u => !skills.some(s => s.name === u.name)).map(u => u.name))
console.log('清单里有但没点亮:', skills.filter(s => !usedNames.has(s.name)).map(s => s.name).join(', '))

// ---------------------------------------------------------------------------
// 回归：会话 id 的解析。这一条是 2026-09-10 那次「侧边栏整页 HTTP 400」的根因，
// 必须钉死 —— 侧边栏 props.scope.sessionId 给的是**带 session- 前缀的整 id**，
// 而目录名就是这条整 id。旧代码写成 p.includes('session-' + sessionId)，
// 前缀加了两遍，永远命中不了，于是每条真请求都掉进"没找到"分支。
// ---------------------------------------------------------------------------
import assert from 'node:assert/strict'

const path = f => f.replace(/\\/g, '/')
const dirIdOf = f => path(f).split('/').slice(-2)[0]
const uuidOf = id => id.replace(/^session-/, '')

assert.equal(I.decodeSegment('--E-A_Workspace--'), '--E-A_Workspace--', 'encodeSegment 的还原不该动普通字符')
assert.equal(I.decodeSegment('--E-NET~0020Program--'), '--E-NET Program--', '~XXXX 该还原回字符')

const newest = I.findTranscript('')
assert.ok(newest, '按 mtime 兜底那条路还该能用（手测 curl 不带 session 时走它）')
const dirId = dirIdOf(newest)
assert.ok(/^session-/.test(dirId), '当前宿主 mint 的会话目录名带 session- 前缀，实际: ' + dirId)

// 侧边栏真给的那条：整 id（带前缀）
assert.equal(I.findTranscript(dirId), newest, '带 session- 前缀的整 id 必须命中（这就是侧边栏发的）')
// 少了前缀也不该串到别的会话上去
assert.equal(I.findTranscript(uuidOf(dirId)), newest, '只给 uuid 那一半时也该命中同一条存档')
// 点了名却没有的，必须回 null（宁可页面说"没找到"，也不能拿别的会话顶上）
assert.equal(I.findTranscript('session-00000000-0000-4000-8000-000000000000'), null, '不存在的 id 必须回 null')
assert.equal(I.findTranscript('nope'), null, '不存在的裸 id 必须回 null')
// 带奇怪字符的 id 以前会掉进"取最新"的兜底里，等于静默串会话；现在必须回 null
assert.equal(I.findTranscript('a b/c'), null, '非法 id 不许回落到最新存档')
// 空串仍然按"手测"处理：取最新
assert.equal(I.findTranscript(''), newest)

console.log('会话 id 解析:', dirId, '->', I.findTranscript(dirId) === newest && I.findTranscript(uuidOf(dirId)) === newest ? '两种写法都命中' : '失败')
// ---------------------------------------------------------------------------
// 回归：视图配置的归一化。它是纯函数，所以这几条在 CI 上也钉得住 ——
// 不需要机器上真有一份 ~/.dsh/skill-view.json（那条路只保证「读不到 / 读坏了也不抛」）。
// 视图只决定侧边栏那张卡怎么摆，不许反过来影响「有哪些 skill」。
// ---------------------------------------------------------------------------
assert.deepEqual(I.normalizeView(null), [], '没有配置就是空，不该抛')
assert.deepEqual(I.normalizeView({ groups: 'nope' }), [], 'groups 不是数组时按空处理')
assert.deepEqual(I.normalizeView({ groups: [{ name: '', skills: ['a'] }, { skills: ['b'] }] }), [],
  '没有 name 的组要丢掉（页面拿 name 当选项值与 key，空名会互相撞）')
assert.deepEqual(I.normalizeView({ groups: [{ name: 'A', skills: ['x', 1, null, { n: 'y' }] }] }),
  [{ name: 'A', skills: ['x'] }], 'skills 里只留字符串，别的丢掉')
assert.deepEqual(I.normalizeView({ groups: [{ name: 'B' }] }), [{ name: 'B', skills: [] }],
  '没写 skills 的组是空组不是坏组（空组要能显示出来）')
assert.deepEqual(I.normalizeView({ groups: [{ name: 'A', skills: ['x'] }, { name: 'B', skills: ['x'] }] }),
  [{ name: 'A', skills: ['x'] }, { name: 'B', skills: ['x'] }], '组顺序照原样，别去重排')
assert.ok(Array.isArray(I.readView().groups), 'readView 永远给数组 —— 文件在不在都不许抛')
console.log('视图归一化: 6 条断言通过，本机 skill-view.json', I.readView().groups.length, '组')
console.log('数据层自检全过')

