# 编辑忽略文件

**中文** · [English](README.md)

在带行号的编辑器里编辑思源 `data/.siyuan/` 下的各类忽略文件，不用手改文件。

## 支持的文件

| 文件 | 作用 | 语法 |
| --- | --- | --- |
| `syncignore` | 同步与快照包含哪些文件 | gitignore，路径相对 `data` |
| `indexignore` | 哪些文档不进索引（搜索、反链、大纲） | gitignore，路径带笔记本 ID |
| `embeddingignore` | 哪些文档不做 AI 向量索引 | gitignore，路径带笔记本 ID |
| `searchignore` | 搜索结果排除哪些块（`blocks` 表） | 每行一段 SQL 条件 |
| `refsearchignore` | 哪些引用文本不做虚拟引用候选（`refs` 表） | 每行一段 SQL 条件 |

## 用法

1. 打开 `设置 → 集市 → 已下载 → 编辑忽略文件`，点该项的「设置」，编辑器直接打开。
2. 顶部按钮切换文件，改完点保存。上次编辑的文件会被记住。

## 语法

- gitignore 类：每行一条规则，`#` 注释、`!` 取反、`*` 与 `**` 通配，如 `/assets/*.pdf`、`**/temp/**`。`indexignore` 与 `embeddingignore` 要带笔记本 ID，如 `/20210808180117-6v0mkx5/temp/**`。
- SQL 类：每行一条条件，如 `type != 'l'`。内核用 ` AND ` 拼到查询后面，所以不能用 `#` 注释、末尾别留空行、引号和括号要成对。

## 说明

- 只报会让规则失效或查询报错的写法，不做风格建议，也不阻断保存。
- 生效时机：`syncignore` 下次同步，`indexignore` 重建索引后，`embeddingignore` 向量索引重算时，两个 SQL 文件 30 秒内被重读。
- 文件带 UTF-8 BOM 时保存会去掉并提示：内核不剥 BOM，会把 BOM 当成第一行的一部分使其失效。
- 移动端抽屉需要思源 3.8.10-alpha.5 及以上，更早的版本是普通居中对话框。
- 只读写这五个文件。

## 集市趋势图表

![Bazaar stats graph](https://siyuan-bazaar-stats-graph.sr1.cc.cd/api/chart/wmy2981/edit-ignore-files-siyuan?metrics=downloads,rating,ratings&range=all&area=true&lang=zh)

## 开发

```bash
npm ci              # 安装依赖
npm run typecheck   # 类型检查
npm test            # 单元测试（不依赖思源实例）
npm run build       # 生产构建，输出 dist/ 与 package.zip
npm run verify:package # 核对 package.zip 的内容
npm run dev         # watch 构建
npm run render:icon    # assets/icon.svg → assets/icon.png
npm run render:preview # assets/preview.html → assets/preview.png
```

## 许可证

[MIT](LICENSE)
