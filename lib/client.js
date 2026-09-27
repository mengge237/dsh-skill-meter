// dsh-skill-meter —— 浏览器侧：把「Skill 用量」注册成 dsh-better-sidebar 的一个侧边栏页面
//
// 形态与宿主一致：走 ctx.betterSidebar.registerTab，设置页「侧边卡片」里自动出现这张卡的
// 开关，右侧栏里是真正的用量页面；不再往 index.html 塞脚本，也不往设置面板里挂外来卡片。
// 侧边栏本身按会话隔离，正好对应"本会话用过哪些 skill"。
//
// 数据分两路，各自走各自该走的门：
//   清单 —— 宿主官方 Remote `skills/list`（ctx.remote.skills.list({ sessionId })，
//           session-addressed、cold-readable，不加载 skill 正文）。这条路是活的：
//           改 SKILL.md 不用重启 dsh web，描述与 whenToUse、modelInvocable 都是宿主算好的。
//   用量 —— 本包的 /dsh-skill-meter/data.json（服务端读会话存档）。宿主没给"本会话用过哪些"
//           的接口，这条只能自己取，所以它保留；拿不到官方清单时才退回用服务端那份磁盘清单。
//
// 本文件是宿主客户端模块图里的一个 bundle（package.json 的 exports["./client"]），
// 里面的 require 拿到的是宿主提供的 react，不是 node_modules。
// 这个文件由路由每次请求现读磁盘：改样式与逻辑只要刷新页面，不用重启。
window.__ModuleLoader__.load({
  id: 'dsh-skill-meter',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')
    const h = react.createElement
    // 'remote' 与 'remote.skills' 一起注入，跟宿主 dsh-client-ui-skill 的写法保持一致
    const inject = ['betterSidebar', 'remote', 'remote.skills']
    const TAB_ID = 'dsh-skill-meter:usage'
    const ROUTE = '/dsh-skill-meter/data.json'
    const ONLY_LIT_KEY = 'dsh-skill-meter:only-lit'
    const GROUP_KEY = 'dsh-skill-meter:group'
    // 视图分组里「没被任何组收进去」那一桶。它不是用户建的组，是兜底，故名带括号。
    const UNGROUPED = '（未归组）'

    // tab 条上的角标在注册时就得能给值，而数据是页面里拉回来的，
    // 所以缓存最近一次拉到的点亮数；没拉过就不显示角标。
    let badge = null

    const MUTED = { color: 'inherit', opacity: 0.55 }
    const HAIR = 'rgba(127,127,127,0.28)'
    const LIT = '#3fb950'
    const TAG = '#58a6ff'

    function fmtHow (list) {
      if (!list || !list.length) return ''
      const set = new Set(list)
      const parts = []
      if (set.has('tool-call')) parts.push('模型加载')
      if (set.has('slash')) parts.push('直接触发')
      return parts.length ? parts.join(' / ') : list.join(',')
    }

    // 官方清单在前、用量在后，按名字拼成行。
    // catalog 为 null 表示没拿到官方清单（老宿主或 Remote 没挂上），那时退回服务端那份磁盘清单。
    function buildRows (catalog, data) {
      const used = {}
      const diskRows = (data && data.skills) || []
      for (const r of diskRows) used[r.name] = r
      if (!catalog) {
        // 兜底态下没有官方清单，"点亮了但清单里没有"只能问服务端（它两边都读过）
        const missing = (data && data.notInCatalog) || []
        return {
          rows: diskRows,
          source: '磁盘兜底',
          extra: diskRows.filter(function (r) { return r.lit && missing.indexOf(r.name) >= 0 }),
        }
      }
      const rows = []
      const seen = {}
      for (const c of catalog) {
        const u = used[c.name]
        seen[c.name] = true
        rows.push({
          name: c.name,
          description: c.description || (u && u.description) || '',
          whenToUse: c.whenToUse || '',
          modelInvocable: !!c.modelInvocable,
          lit: !!(u && u.lit),
          count: (u && u.count) || 0,
          how: (u && u.how) || [],
          firstTurn: u && u.firstTurn,
          lastTurn: u && u.lastTurn,
        })
      }
      // 点亮过但官方清单里没有的（改名、删了、或只是本会话快照不一致）单独列出来，别静默吞掉
      const extra = diskRows.filter(function (r) { return r.lit && !seen[r.name] })
      return { rows: rows, source: '官方 skills/list', extra: extra }
    }

    function Row (props) {
      const s = props.skill
      return h('div', {
        key: s.name,
        style: {
          padding: '7px 10px 7px 11px',
          borderBottom: '1px solid ' + HAIR,
          borderLeft: s.lit ? '2px solid ' + LIT : '2px solid transparent',
          background: s.lit ? 'rgba(127,127,127,0.07)' : 'transparent',
          opacity: s.lit ? 1 : 0.5,
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', {
            title: s.lit ? '本会话加载过 ' + s.count + ' 次' : '本会话未使用',
            style: {
              width: 8, height: 8, borderRadius: 8, flex: '0 0 auto',
              background: s.lit ? LIT : 'transparent',
              border: '1px solid ' + (s.lit ? LIT : HAIR),
            },
          }),
          h('span', {
            style: {
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5,
              fontWeight: s.lit ? 600 : 400, flex: '0 1 auto',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            },
          }, s.name),
          typeof s.modelInvocable === 'boolean' ? h('span', {
            title: s.modelInvocable ? '同一个名字也会广告给模型，模型可自己加载' : '只有你打 /名字 才会加载',
            style: {
              fontSize: 10, padding: '1px 5px', borderRadius: 4, flex: '0 0 auto',
              border: '1px solid ' + (s.modelInvocable ? TAG : HAIR),
              color: s.modelInvocable ? TAG : 'inherit', opacity: s.modelInvocable ? 1 : 0.55,
            },
          }, s.modelInvocable ? '模型可调用' : '仅 /') : null,
          h('span', { style: { flex: '1 1 auto' } }),
          s.lit ? h('span', {
            style: { fontSize: 11, padding: '1px 6px', borderRadius: 8, background: 'rgba(63,185,80,0.16)', color: LIT, flex: '0 0 auto' },
          }, 'x' + s.count) : null),
        s.description ? h('div', {
          title: s.whenToUse ? s.description + '\n\n' + s.whenToUse : s.description,
          style: Object.assign({ fontSize: 11.5, marginTop: 3, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }, MUTED),
        }, s.description) : null,
        s.lit ? h('div', { style: Object.assign({ fontSize: 11, marginTop: 2 }, MUTED) },
          fmtHow(s.how) + (s.firstTurn ? '，首次第 ' + s.firstTurn + ' 轮' : '')
          + (s.lastTurn && s.lastTurn !== s.firstTurn ? '，最近第 ' + s.lastTurn + ' 轮' : '')) : null,
      )
    }

    function View (props) {
      const sessionId = props.scope && props.scope.sessionId ? props.scope.sessionId : ''
      const remoteSkills = props.remoteSkills
      const [data, setData] = react.useState(null)
      const [catalog, setCatalog] = react.useState(null)
      const [error, setError] = react.useState('')
      const [notice, setNotice] = react.useState('')
      const [busy, setBusy] = react.useState(false)
      const [group, setGroup] = react.useState(function () {
        try { return localStorage.getItem(GROUP_KEY) || 'all' } catch (e) { return 'all' }
      })
      const [onlyLit, setOnlyLit] = react.useState(function () {
        try { return localStorage.getItem(ONLY_LIT_KEY) === '1' } catch (e) { return false }
      })

      // 官方清单。拿不到就返回 null 让页面退回磁盘兜底，不弹错误 —— 这不是用户的错。
      const loadCatalog = react.useCallback(function () {
        if (!remoteSkills || typeof remoteSkills.list !== 'function' || !sessionId) return Promise.resolve(null)
        return Promise.resolve()
          .then(function () { return remoteSkills.list({ sessionId: sessionId }) })
          .then(function (res) {
            const v = (res && res.value) ? res.value : res
            const list = v && v.skills
            setCatalog(Array.isArray(list) ? list : null)
            return null
          })
          .catch(function () { setCatalog(null); return null })
      }, [remoteSkills, sessionId])

      const load = react.useCallback(function () {
        setBusy(true)
        loadCatalog()
        const url = ROUTE + '?session=' + encodeURIComponent(sessionId) + '&t=' + Date.now()
        fetch(url, { credentials: 'same-origin' })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j } }) })
          .then(function (res) {
            const j = res.j || {}
            // 两种"没数"要分开：HTTP/网络层挂了才值得怀疑"服务端改了没重启"（红条）；
            // 服务端 ok:false 只是这个会话的存档没找到，官方清单照旧渲染（黄条）。
            setError(res.ok ? '' : 'HTTP ' + res.status)
            setNotice(res.ok && j.error ? String(j.error) : '')
            setData(res.ok ? j : null)
          })
          .catch(function (e) { setError(String((e && e.message) || e)); setNotice('') })
          .then(function () { setBusy(false) })
      }, [sessionId, loadCatalog])

      react.useEffect(function () {
        load()
        if (!props.visible) return
        const timer = setInterval(load, 20000)
        return function () { clearInterval(timer) }
      }, [load, props.visible])

      // 宿主在清单变了时会发 skills/change；订得上就不必等轮询
      react.useEffect(function () {
        const remote = props.remote
        if (!remote || typeof remote.$on !== 'function') return
        let off = null
        try {
          off = remote.$on('skills/change', function () { loadCatalog() })
        } catch (e) { return }
        return function () { try { if (typeof off === 'function') off() } catch (e) {} }
      }, [props.remote, loadCatalog])

      const built = buildRows(catalog, data)
      const rows = built.rows
      const litCount = rows.filter(function (r) { return r.lit }).length
      if (data && typeof data.lit === 'number' && typeof data.total === 'number' && !catalog) {
        badge = data.lit + '/' + data.total
      } else if (catalog) {
        badge = litCount + '/' + rows.length
      }
      // 视图：分组名与组内顺序都来自服务端每次请求现读的 ~/.dsh/skill-view.json。
      // 它只决定「怎么摆」，不决定「有哪些」—— 清单永远以宿主 skills/list 为准。
      const view = (data && data.view && Array.isArray(data.view.groups)) ? data.view.groups : []
      const groupOf = {}
      const rank = {}
      let seenInView = 0
      for (const g of view) {
        for (const s of g.skills) {
          if (groupOf[s] === undefined) { groupOf[s] = g.name; rank[s] = seenInView++ }
        }
      }
      // 进了配置的按配置顺序排，没进的保持宿主给的相对次序沉到底（decorate-sort，不赌 sort 的稳定性）
      const ordered = rows
        .map(function (r, i) { return { r: r, i: i, k: rank[r.name] === undefined ? -1 : rank[r.name] } })
        .sort(function (a, b) {
          if (a.k === -1 && b.k === -1) return a.i - b.i
          if (a.k === -1) return 1
          if (b.k === -1) return -1
          return a.k - b.k
        })
        .map(function (x) { return x.r })
      const ungroupedCount = ordered.filter(function (r) { return groupOf[r.name] === undefined }).length
      const shown = ordered.filter(function (r) {
        if (onlyLit && !r.lit) return false
        if (group === 'all') return true
        if (group === UNGROUPED) return groupOf[r.name] === undefined
        return groupOf[r.name] === group
      })

      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontSize: 13 } },
        h('div', {
          style: {
            flex: '0 0 auto', padding: '7px 10px', borderBottom: '1px solid ' + HAIR,
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          },
        },
          h('span', { style: { fontWeight: 600 } }, 'Skill 用量'),
          h('span', { style: MUTED }, litCount + ' / ' + rows.length + ' 已点亮'),
          h('span', {
            title: built.source === '官方 skills/list'
              ? '清单来自宿主 Remote skills/list（改 SKILL.md 不用重启）'
              : '没拿到宿主 Remote 清单，退回读本机 ~/.agents/skills（这种要重启才更新）',
            style: {
              fontSize: 10, padding: '1px 5px', borderRadius: 4,
              border: '1px solid ' + (built.source === '官方 skills/list' ? LIT : HAIR),
              color: built.source === '官方 skills/list' ? LIT : 'inherit', opacity: 0.8,
            },
          }, built.source),
          h('span', { style: Object.assign({ flex: '1 1 auto' }, MUTED) },
            data && data.turns ? '第 ' + data.turns + ' 轮' : '',
            data && data.session ? '，会话 ' + String(data.session).replace('session-', '').slice(0, 8) : ''),
          data && data.sessionFile ? h('span', { style: MUTED, title: data.sessionFile }, data.sessionFile.indexOf('zstd') >= 0 ? '存档 zstd' : '存档 jsonl') : null,
          view.length ? h('select', {
            value: group, title: '分组来自 ~/.dsh/skill-view.json（改完存盘、刷新页面即生效，不用重启）',
            onChange: function (e) {
              const v = e.target.value
              setGroup(v)
              try { localStorage.setItem(GROUP_KEY, v) } catch (err) {}
            },
            style: {
              fontSize: 11.5, padding: '1px 4px', borderRadius: 6, maxWidth: 150,
              border: '1px solid ' + HAIR, background: 'transparent', color: 'inherit',
            },
          },
            h('option', { value: 'all' }, '全部分组（' + rows.length + '）'),
            view.map(function (g) {
              const c = ordered.filter(function (r) { return groupOf[r.name] === g.name }).length
              return h('option', { key: g.name, value: g.name }, g.name + '（' + c + '）')
            }),
            ungroupedCount ? h('option', { value: UNGROUPED }, UNGROUPED + '（' + ungroupedCount + '）') : null,
          ) : null,
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, cursor: 'pointer' } },
            h('input', {
              type: 'checkbox', checked: onlyLit,
              onChange: function (e) {
                const v = e.target.checked
                setOnlyLit(v)
                try { localStorage.setItem(ONLY_LIT_KEY, v ? '1' : '0') } catch (err) {}
              },
            }), '只看已点亮'),
          h('button', {
            onClick: load, disabled: busy,
            style: {
              fontSize: 11.5, padding: '2px 9px', borderRadius: 6, cursor: busy ? 'default' : 'pointer',
              border: '1px solid ' + HAIR, background: 'transparent', color: 'inherit', opacity: busy ? 0.5 : 1,
            },
          }, busy ? '刷新中' : '刷新')),
        error ? h('div', {
          style: { padding: '6px 10px', fontSize: 11.5, background: 'rgba(248,81,73,0.14)', borderBottom: '1px solid ' + HAIR },
        }, '用量取数失败：' + error + '（改过服务端那半个文件而没重启 dsh web 就是这个）') : null,
        notice ? h('div', {
          style: { padding: '6px 10px', fontSize: 11.5, background: 'rgba(210,153,34,0.14)', borderBottom: '1px solid ' + HAIR },
        }, notice + '。清单照常显示，只是这个会话的点亮数暂时拿不到。') : null,
        built.extra.length ? h('div', {
          style: { padding: '6px 10px', fontSize: 11.5, background: 'rgba(210,153,34,0.14)', borderBottom: '1px solid ' + HAIR },
        }, '本会话点亮过、但不在宿主当前清单里：' + built.extra.map(function (r) { return r.name }).join('、')) : null,
        h('div', { style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto' } },
          shown.length ? shown.map(function (s) { return h(Row, { key: s.name, skill: s }) })
            : h('div', { style: Object.assign({ padding: 12 }, MUTED) },
                group !== 'all' ? '「' + group + '」这一组没有可显示的行（另有 ' + rows.length + ' 件在别的组）。'
                  : onlyLit ? '本会话还没有点亮任何 skill。' : '清单为空（宿主没给，磁盘也没读到）')),
        data && data.ghost && data.ghost.length ? h('div', {
          style: { flex: '0 0 auto', borderTop: '1px solid ' + HAIR, padding: '6px 10px', fontSize: 11.5 },
        },
          h('div', { style: MUTED }, '存档里用到、本机清单里没有（改名或已删）'),
          data.ghost.map(function (g) {
            return h('div', { key: g.name, style: { fontFamily: 'ui-monospace, monospace' } }, g.name + ' x' + g.count)
          })) : null)
    }

    function apply (ctx) {
      const svc = ctx.betterSidebar || (typeof ctx.get === 'function' ? ctx.get('betterSidebar') : null)
      if (!svc || typeof svc.registerTab !== 'function') {
        console.warn('[dsh-skill-meter] 没拿到 betterSidebar 服务，侧边栏页面不挂载（路由 /dsh-skill-meter/data.json 仍然可用）')
        return function () {}
      }
      const remote = ctx.remote || (typeof ctx.get === 'function' ? ctx.get('remote') : null)
      const remoteSkills = (remote && remote.skills) || (typeof ctx.get === 'function' ? ctx.get('remote.skills') : null)
      // 调试把手：在浏览器控制台里能直接 __dshSkillMeterDebug.remoteSkills.list({ sessionId })
      // 看宿主到底给了什么清单（页面刷新才有新值，别在生产上依赖它）。
      // 这段原先排在 const remoteSkills 前面，const 的 TDZ 让取值当场抛 ReferenceError，
      // 又被外层 try/catch 吞掉 —— 于是这个把手从来没存在过，还一声不吭。
      try {
        window.__dshSkillMeterDebug = { remote: remote, remoteSkills: remoteSkills }
      } catch (e) {}
      if (!remoteSkills) {
        console.warn('[dsh-skill-meter] 没有 remote.skills，清单退回磁盘读取（宿主版本太老，或 Remote 还没挂上）')
      }
      return svc.registerTab({
        id: TAB_ID,
        title: function () { return 'Skill 用量' },
        order: 46,
        single: true,
        icon: function (size) {
          return h('svg', {
            width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
            stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round',
          },
            h('path', { d: 'M2.4 13.2h2.2M7 13.2V7.4M11.6 13.2V4.2' }),
            h('path', { d: 'M2 14.8h12', opacity: 0.35 }))
        },
        badge: function () { return badge },
        component: function (props) {
          return h(View, Object.assign({}, props, { remote: remote, remoteSkills: remoteSkills }))
        },
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
