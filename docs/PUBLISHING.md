# 发布手册（dsh-skill-meter）

**一句话形态**：仓里这份就是发行件，洗过、带自检；发行只是把它 `npm publish` 出去。**不维护第二份** ——
两份内容一定会漂，而漂的那一份正是别人装到的那一份。

- 许可：MIT（见仓根 `LICENSE`，与 `package.json` 的 `license` 字段一致）。
- 发行件 = `package.json` 的 `files` 字段：`lib/`、`cordis.patch.yml`、`README.md`，加上 npm 自动带的 `package.json`。
  实测 **5 个文件 / 打包 18.7 kB / 解包 47.5 kB**。
- **「能不能公开」这条有闸**：`npm test` 的第一条就是 `test/no-local-paths.mjs`，扫的就是上面那几个文件，
  命中本机盘符路径 / 用户名 / 家目录 / 个人邮箱 / 凭据形状就红。私有仓可以脏，发行件不能脏。

## 0. 本机特有的一个坑（先看这条）

```bash
npm config get registry      # 本机是 https://registry.npmmirror.com
```

**npmmirror 是只读镜像，不能发。** 但**别改全局 registry**（平时装包还要靠它快），
只在发布相关的那几条命令上显式覆盖 `--registry=https://registry.npmjs.org`。

## 1. 顺序：先公开仓，再发 npm（建议）

| 顺序 | 后果 |
|---|---|
| 先公开仓 → 再发 npm | 两条链接（`repository`、npm 页面）同时有效，无死链 |
| 先发 npm → 仓仍私有 | npm 页面上的 `repository` 链接**一时点不开**，直到转公开那天 |

两者都不阻塞，但推荐前者。**在此之前，本机一切照旧**（`link:` 装本地目录，改源码即时生效）。

## 2. 发布步骤

```bash
# 前置：npmjs.com 账号 + 邮箱验证 + 2FA（恢复码存好；发布时会要 OTP）

# ① 登录（显式指官方源）
npm login --registry=https://registry.npmjs.org

# ② 审发行件 —— 唯一能拦住「发错东西」的一步，别省
npm test                        # 含脱敏自检
npm pack --dry-run              # 打出确切清单与体积

# ③ 发布（非 scoped 包默认 public）
npm publish --registry=https://registry.npmjs.org

# ④ 验证
npm view dsh-skill-meter version --registry=https://registry.npmjs.org
# 镜像侧（本机默认源）稍后也会同步到，届时这条不带 --registry 也能查到：
npm view dsh-skill-meter version
```

## 3. 装了之后在客户端里怎么用

```bash
dsh plugin --profile web add dsh-skill-meter
# 装完重启 dsh web（只有插件树需要重启；改 lib/client.js 只要刷新页面）
```

`dsh plugin add` 内部走 pnpm，按 profile 的 registry 解析包名，所以镜像同步之后同样装得上。

## 4. 不可撤，说清楚

- `npm unpublish` 只在**发布后 72 小时内、且没有别的包依赖它**时才可能成功；过了就只能 `npm deprecate`。
- 版本号只能往前走：发出去的是 0.2.3，下一个只能是 0.2.4 起（`npm version patch|minor`）。
- 所以第 ② 步（`npm test` + `pack --dry-run`）不是形式主义。

## 5. 想撤下来怎么办

```bash
npm deprecate dsh-skill-meter@0.2.3 "这个版本有已知问题，请用 x.y.z" \
  --registry=https://registry.npmjs.org
```

`deprecate` 会在 npm 页面与安装时告警，但**包还在**；要真正收回只能靠 `unpublish` 的 72 小时窗口。

## 6. 别忘了第二件事：better-sidebar 的推荐插件榜

发完 npm 之后，若还想出现在 `DSH-better-sidebar` 那个「添加 Tab 插件」弹窗的**推荐插件**列表里，
要往它仓里的 `src/client/plugins-tabs.ts` 加一条（另加 `locales.ts` 的 i18n 键）：

```ts
{
  id: 'dsh-skill-meter',                                    // = npm 包名
  name: () => t('pluginSkillMeterName'),
  url: '<公开可读的地址>',                                    // 文档说这里填 GitHub repo
  description: () => t('pluginSkillMeterDesc'),
  install: 'cd ~/.dsh && dsh plugin --profile web add dsh-skill-meter',
}
```

两个注意：① 该文件头写「加一条数据即上架」，数据完整性由 `tests/plugin-list.spec.ts` 守着；
② **`url` 若仓还是私有，只能填 npm 页面**（`https://www.npmjs.com/package/dsh-skill-meter`），
收不收得看维护者 —— 这也是「先公开仓」那条顺序建议的另一个理由。

另外还有一条独立的路：GitHub 的 topic `dsh-better-sidebar`（弹窗里那个「浏览更多插件」按钮就是搜它）。
那条**必须仓公开**，与 npm 无关。
