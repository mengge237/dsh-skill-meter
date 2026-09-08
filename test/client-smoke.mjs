// 不启动 dsh 也能验浏览器侧那半个文件：造宿主模块图 + 假 react + 假 betterSidebar。
// 查五件事：bundle 能求值；缺服务时只 warn 不抛；apply 注册出完整描述符；
// 没有 remote.skills 时退回磁盘清单（兜底态）；有 remote.skills 时清单走宿主、
// 用量仍走本包路由，并且"点亮了但不在清单里"这条只认真清单。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

let hooks = [], idx = 0, effects = []
const react = {
  // 子组件（Row）当函数直接展开，不然它的文本节点不会进树
  createElement: (type, props, ...kids) => (typeof type === 'function'
    ? type(Object.assign({}, props))
    : { type, props: props || {}, kids: kids.flat(9) }),
  useState: (init) => {
    const i = idx++
    if (!(i in hooks)) hooks[i] = typeof init === 'function' ? init() : init
    return [hooks[i], (v) => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v }]
  },
  useCallback: (fn) => fn,
  useEffect: (fn) => { effects.push(fn) },
}
let loaded = null
global.window = { __ModuleLoader__: { load: (o) => { loaded = o } } }
new Function('window', src)(global.window)
assert.equal(loaded && loaded.id, 'dsh-skill-meter', 'bundle 没按预期注册')

const MODULES = { react }
const mod = loaded.factory((id) => { assert.ok(MODULES[id], '宿主没提供模块: ' + id); return MODULES[id] })
// 清单要走宿主 Remote，就得在 inject 里点名，跟宿主 dsh-client-ui-skill 的写法一致
assert.deepEqual(mod.inject, ['betterSidebar', 'remote', 'remote.skills'])

const captureWarn = (fn) => {
  const got = [], w = console.warn
  console.warn = (m) => got.push(String(m))
  const out = fn()
  console.warn = w
  return { got, out }
}

// 1) 什么都没装：只 warn 侧边栏缺席，不抛，返回 no-op
const s1 = captureWarn(() => mod.apply({}))
assert.equal(typeof s1.out, 'function', '服务缺席时应返回 no-op disposer')
assert.equal(s1.got.length, 1, '侧边栏缺席时应正好 warn 一次，实际 ' + s1.got.length)
assert.ok(s1.got[0].includes('betterSidebar'), s1.got[0])

// 2) 只有侧边栏：能注册，但要另 warn 一次「没有 remote.skills」（这条不能静默）
let desc = null
const s2 = captureWarn(() => mod.apply({ betterSidebar: { registerTab: (d) => { desc = d; return () => {} } } }))
assert.ok(desc, 'registerTab 没被调用')
assert.equal(s2.got.length, 1, '缺 remote.skills 应 warn 一次，实际 ' + s2.got.length)
assert.ok(s2.got[0].includes('remote.skills'), s2.got[0])
for (const k of ['id', 'title', 'component', 'icon', 'badge']) assert.ok(desc[k] !== undefined, '描述符缺 ' + k)
assert.equal(desc.title(), 'Skill 用量')
assert.equal(desc.icon(16).type, 'svg')

// 磁盘那份数据（兜底态与官方态都拿它当用量）
const usage = {
  ok: true, turns: 7, lit: 3, total: 4, skillsRoot: '/x/.agents/skills', notInCatalog: ['brand-new-skill'],
  ghost: [{ name: 'old-name', count: 3, how: ['tool-call'] }],
  skills: [
    { name: 'dev-browser', description: '浏览器自动化', lit: true, count: 2, how: ['tool-call'], firstTurn: 2, lastTurn: 4 },
    { name: 'humanized-developer-reply', description: '写作口吻', lit: true, count: 1, how: ['slash'], firstTurn: 3, lastTurn: 3 },
    { name: 'tdd', description: '测试驱动', lit: false, count: 0, how: [], firstTurn: null, lastTurn: null },
    { name: 'brand-new-skill', description: '磁盘读到的新条目', lit: true, count: 1, how: ['tool-call'], firstTurn: 6, lastTurn: 6 },
  ],
}
let calls = 0
global.fetch = async () => { calls++; return { ok: true, json: async () => usage } }
const props = { scope: { sessionId: 'session-abc' }, visible: true, store: {}, tab: { id: 't', type: desc.id, title: 'Skill 用量' } }

// 假 react 的 hooks 是全局数组：reset 只在每个场景开头调一次，
// 第二次渲染必须留着 hooks，否则取回来的 data 会被抹掉（表现为列表空）。
const reset = () => { idx = 0; hooks = []; effects = [] }
const render = (component) => { idx = 0; return component(props) }
const runEffects = async () => {
  effects.forEach((f) => f())
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
}
const flatOf = (tree) => JSON.stringify(tree, (k, v) => (v && v.type === 'svg' ? '[svg]' : v))

// 3) 兜底态：没有 remote.skills，清单用服务端读磁盘那份
reset()
render(desc.component)
await runEffects()
const flatFallback = flatOf(render(desc.component))
assert.ok(calls >= 1, 'effect 里没去取数')
for (const want of ['Skill 用量', 'dev-browser', 'x2', '模型加载', '首次第 2 轮', '最近第 4 轮', '3 / 4 已点亮', 'old-name', 'brand-new-skill', '只看已点亮', '第 7 轮']) {
  assert.ok(flatFallback.includes(want), '兜底态渲染里找不到: ' + want)
}
assert.ok(flatFallback.includes('磁盘兜底'), '兜底态该标明清单来源')
assert.ok(!flatFallback.includes('取数失败'), '不该出现失败条')
assert.equal(desc.badge(), '3/4', '兜底态角标用服务端的读数')

// 4) 官方态：清单来自 remote.skills.list，描述与 whenToUse 都以宿主为准
const catalogSkills = [
  { name: 'dev-browser', description: '浏览器自动化（宿主口径）', whenToUse: '需要驱动本机页面时', modelInvocable: true },
  { name: 'humanized-developer-reply', description: '写作口吻', modelInvocable: false },
  { name: 'tdd', description: '测试驱动', modelInvocable: true },
  { name: 'retired-skill', description: '官方清单里还有它', modelInvocable: true },
]
let listReq = null
// 故意包一层 { value } ：RemoteResult 的形状两种都得吃
const remote = {
  skills: { list: async (req) => { listReq = req; return { value: { skills: catalogSkills } } } },
  $on: (ev) => { assert.equal(ev, 'skills/change'); return () => {} },
}
let descOfficial = null
const s4 = captureWarn(() => mod.apply({ betterSidebar: { registerTab: (d) => { descOfficial = d; return () => {} } }, remote }))
assert.equal(s4.got.length, 0, '官方清单可用时不该 warn：' + s4.got.join(' | '))

reset()
render(descOfficial.component)
await runEffects()
assert.deepEqual(listReq, { sessionId: 'session-abc' }, 'list 该按会话取')
const flatOfficial = flatOf(render(descOfficial.component))
assert.ok(flatOfficial.includes('官方 skills/list'), '该标明清单来自宿主 Remote')
assert.ok(!flatOfficial.includes('磁盘兜底'), '官方态不该出现兜底字样')
assert.ok(flatOfficial.includes('浏览器自动化（宿主口径）'), '描述应以宿主清单为准')
assert.ok(flatOfficial.includes('需要驱动本机页面时'), 'whenToUse 没挂上')
assert.ok(flatOfficial.includes('模型可调用') && flatOfficial.includes('仅 /'), 'modelInvocable 标记没渲染')
// 点亮数按官方清单内计数；brand-new-skill 在用量里有、官方清单没有 → 单独列出来，不静默吞
assert.ok(flatOfficial.includes('2 / 4 已点亮'), '官方态读数应为清单内 2/4')
assert.ok(flatOfficial.includes('brand-new-skill'), '点亮了但不在官方清单里的条目该列出来')
assert.ok(flatOfficial.includes('retired-skill'), '官方清单里的未点亮条目也该显示')
assert.equal(descOfficial.badge(), '2/4', '官方态角标按清单内点亮数')
console.log('client 冒烟通过：bundle 求值 / 缺服务各自 warn / 兜底态用磁盘清单 / 官方态走 remote.skills.list（含 whenToUse 与 modelInvocable），取数 ' + calls + ' 次')
