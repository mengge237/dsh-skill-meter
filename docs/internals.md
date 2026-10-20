# 实现细节与实测读数（README 放不下的部分）

## 数据层实测（本机，2026-09-07）

```
$ node test/selftest.mjs
skills 根: <用户主目录>\.agents\skills        清单条数: 18      frontmatter 目录名不一致: []
选中的存档: .../session-2aaa36ff-.../session.jsonl.zstd   轮次: 13   存档 2.94MB
已用: humanized-developer-reply x3(模型加载,首2)  dsh-plugin-dev x2(模型加载,首2)
      dev-browser x1(模型加载,首2)  steampp-network-accel x1(模型加载,首3)
catalog 条数: 14（会话开始时看到的快照）          点亮: 4 / 18      幽灵: []
```

四个点亮数与用 python `zstandard` 独立解析同一份存档的结果一致。自检脚本不启动 dsh、不联网、只读。
