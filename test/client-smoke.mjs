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
// 组件在 visible 时开了一个 20s 轮询。测试里绝不能放真定时器：它会一直挂住 Node 的
// 事件循环，脚本跑完也不退出 —— 表现就是 npm test 报 exit 1 而输出一切正常，看不出原因。
// 换成可数的假定时器，顺带把"visible 才开轮询、卸载要清掉"这两条也钉住。
let timers = [], cleared = [], cleanups = []
global.setInterval = (fn, ms) => { const id = { fn, ms }; timers.push(id); return id }
global.clearInterval = (id) => { cleared.push(id) }
const unmount = () => { const cs = cleanups; cleanups = []; cs.forEach((c) => c()) }

// 侧边栏给的 scope.sessionId 是**带 session- 前缀的整 id**（宿主 mint 的就是这条，
// 会话目录名也是这条）。这里按真形状取，免得再出现"测试里是 uuid、线上是整 id"的错位。
const SESSION = 'session-11111111-2222-4333-8444-555555555555'

let calls = 0
global.fetch = async () => { calls++; return { ok: true, json: async () => usage } }
const props = { scope: { sessionId: SESSION }, visible: true, store: {}, tab: { id: 't', type: desc.id, title: 'Skill 用量' } }

// 假 react 的 hooks 是全局数组：reset 只在每个场景开头调一次，
// 第二次渲染必须留着 hooks，否则取回来的 data 会被抹掉（表现为列表空）。
const reset = () => { idx = 0; hooks = []; effects = []; timers = []; cleared = []; cleanups = [] }
const render = (component) => { idx = 0; return component(props) }
const runEffects = async () => {
  cleanups = effects.map((f) => f()).filter((c) => typeof c === 'function')
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
// visible 时该只开一个 20s 轮询；卸载要把定时器清掉，否则页面切走了还在打路由
assert.equal(timers.length, 1, 'visible 时该只开一个轮询定时器，实际 ' + timers.length)
assert.equal(timers[0].ms, 20000, '轮询间隔应为 20s')
unmount()
assert.equal(cleared.length, timers.length, '卸载该把轮询定时器清掉')

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
assert.deepEqual(listReq, { sessionId: SESSION }, 'list 该按会话取')
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

// 5) 服务端 ok:false 且 reason=no-archive（这个会话还没有存档）—— **默认情况，一条提示都不许出**。
//    历史：这条分支原来抛过 ReferenceError，宿主回空 body 400，页面只剩红条；
//    后来改成回一句人话，但「还没有存档」对新会话来说是常态，每条会话都弹一条就成了噪音。
//    现在的契约：默认情况静默（服务端不带 error 字段），只有真故障（解压失败等）才吭声。
//    探针用两条横幅的底色 —— 渲染树里有那个颜色就说明横幅出来了。
const RED = 'rgba(248,81,73'
const YELLOW = 'rgba(210,153,33'
const noUsage = {
  ok: false,
  reason: 'no-archive',
  session: 'session-11111111-2222-4333-8444-555555555555',
  skills: usage.skills.map((s) => Object.assign({}, s, { lit: false, count: 0, how: [], firstTurn: null, lastTurn: null })),
  lit: 0, total: 4, ghost: [], catalogSeen: [], notInCatalog: [],
}
global.fetch = async () => ({ ok: true, json: async () => noUsage })
reset()
render(descOfficial.component)
await runEffects()
const flatNoUsage = flatOf(render(descOfficial.component))
assert.ok(!flatNoUsage.includes(RED), '默认情况不许出红条')
assert.ok(!flatNoUsage.includes(YELLOW), '默认情况不许出提示条（这条就是用户要求的「不要写这个提示」）')
assert.ok(flatNoUsage.includes('官方 skills/list'), '取不到用量不影响清单来源标记')
assert.ok(flatNoUsage.includes('retired-skill'), '官方清单条目照常渲染')
assert.ok(flatNoUsage.includes('0 / 4 已点亮'), '取不到用量时读数应为 0/4')
assert.equal(descOfficial.badge(), '0/4', '取不到用量时角标应为 0/4')

// 5b) 真故障（服务端在 ok:true 里带回 error，例如解压失败）—— 这条必须吭声，而且只报那一句，
//     不许再拖一句「清单照常显示，只是…」的解释尾巴。
const realErr = Object.assign({}, usage, { error: '解压失败 Unexpected end of file' })
global.fetch = async () => ({ ok: true, json: async () => realErr })
reset()
render(descOfficial.component)
await runEffects()
const flatRealErr = flatOf(render(descOfficial.component))
assert.ok(flatRealErr.includes(YELLOW), '真故障该出提示条')
assert.ok(flatRealErr.includes('解压失败 Unexpected end of file'), '该原样带出服务端给的错')
assert.ok(!flatRealErr.includes('清单照常显示'), '不许再拖解释尾巴（那是「有 ai 味」的那种话）')
assert.ok(flatRealErr.includes('retired-skill'), '出提示不影响清单渲染')

// 6) 视图：分组与顺序都来自服务端载荷里的 view（服务端现读 ~/.dsh/skill-view.json）。
//    它只改「怎么摆」，不改「有哪些」—— 所以下面既钉顺序，也钉「没有 view 时必须回到原样」。
const tree6 = (payload) => {
  global.fetch = async () => ({ ok: true, json: async () => payload })
  reset()
  render(descOfficial.component)
  return runEffects().then(() => render(descOfficial.component))
}
const viewPayload = Object.assign({}, usage, {
  view: {
    file: '/x/.dsh/skill-view.json',
    groups: [
      { name: '测试', skills: ['tdd'] },
      { name: '浏览器与写作', skills: ['dev-browser', 'humanized-developer-reply'] },
    ],
  },
})
// 假 createElement 把子节点放在 kids 上（不是 props.children），遍历得按这个形状走
const findType = (tree, type) => {
  if (!tree || typeof tree !== 'object') return null
  if (tree.type === type) return tree
  for (const k of (tree.kids || [])) {
    const hit = findType(k, type)
    if (hit) return hit
  }
  return null
}
const treeV = await tree6(viewPayload)
const flatView = flatOf(treeV)
assert.ok(flatView.indexOf('"tdd"') < flatView.indexOf('"dev-browser"'),
  '组内顺序该按 skill-view.json，不是宿主给的次序')
assert.ok(flatView.indexOf('"dev-browser"') < flatView.indexOf('"retired-skill"'),
  '没进任何组的条目该沉到底，不该插进配置好的顺序里')
assert.ok(flatView.includes('全部分组（4）'), '该长出下拉框，且默认项带总数')
assert.ok(flatView.includes('测试（1）') && flatView.includes('浏览器与写作（2）'), '每个组该带自己的件数')
assert.ok(flatView.includes('（未归组）（1）'), '没被任何组收进去的那一件该有兜底桶')

const sel = findType(treeV, 'select')
assert.ok(sel, '没找到下拉框')
sel.props.onChange({ target: { value: '测试' } })
const flatPicked = flatOf(render(descOfficial.component))
assert.ok(flatPicked.includes('"tdd"'), '选中「测试」该留着 tdd')
assert.ok(!flatPicked.includes('"dev-browser"'), '选中「测试」不该再显示别的组')
assert.ok(flatPicked.includes('全部分组（4）'), '筛选后下拉框本身还在')

// 7) 载荷里没有 view（服务端太老，或 ~/.dsh/skill-view.json 不在 / 写坏了）：
//    必须回到原样，不许长出一个空下拉框 —— 这一条是「文件不在也不能把页面搞坏」的钉子。
const treeNoView = await tree6(usage)
const flatNoView = flatOf(treeNoView)
assert.ok(!flatNoView.includes('全部分组'), '没有视图配置时不该出现下拉框')
assert.ok(!flatNoView.includes('（未归组）'), '没有视图配置时不该出现兜底桶')
assert.ok(flatNoView.includes('"dev-browser"'), '没有视图配置时清单照常渲染')

console.log('client 冒烟通过：bundle 求值 / 缺服务各自 warn / 兜底态用磁盘清单 / 官方态走 remote.skills.list（含 whenToUse 与 modelInvocable）/ 这个会话还没存档时一条提示都不出且清单照常渲染 / 真故障才出提示且不拖解释尾巴 / 视图分组与顺序按 skill-view.json，无配置时回原样')
