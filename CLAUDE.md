# edit-ignore-files-siyuan

思源插件：在思源自己的插件设置面板里编辑 `data/.siyuan/` 下的六个忽略文件。

## 命令

```bash
npm ci             # 安装依赖（CI 使用 npm ci）
npm run typecheck  # tsc --noEmit，只检查 src
npm test           # 清空 test-dist/ → tsc -p tsconfig.test.json → node --test（输出到 test-dist/，已忽略）
npm run build      # 生产构建，输出 dist/ 与 package.zip
npm run verify:package # 核对 package.zip 的必需文件、扁平布局与图片体积
npm run dev        # watch 构建，只写根目录 index.js/index.css/i18n/；验证时不要运行
npm run render:icon    # assets/icon.svg → assets/icon.png
npm run render:preview # assets/preview.html → assets/preview.png（需要 npx playwright install chromium）
```

`npm test` 先清空 `test-dist/`，再用 `tsconfig.test.json` 把 `test/` 和被引用的 `src/` 模块编译成 CommonJS 到 `test-dist/`，最后用 Node 内置测试运行器跑 `test-dist/test/*.test.js`。测试只覆盖不依赖思源的纯逻辑（版本比较、门槛过滤、草稿、状态、语法检查、两套文件读写通道、文案键完整性）；新增 `test/*.test.ts` 会被自动纳入，不用改脚本（`node --test` 的 glob 要 Node 21+，CI 与 `engines` 都锁在 22 以上）。

## CI

`ci.yml`：push `main`/`dev`、PR、手动触发跑 `typecheck` → `test` → `build` → `verify:package`，上传产物。`cd.yml`：push `main` 与手动触发，版本升高才发 Release，发之前自己再跑 `test` 与 `verify:package`。产物清单只在 `scripts/verify-package.mjs` 一处。

## 模块

- `src/index.ts` — 插件入口。`onload` 里注册官方设置面板：`new Setting({openInWindow, confirmCallback, destroyCallback})` 加一个 `direction: "row"` 的条目，`createActionElement` 在每次打开时新建面板。`confirmCallback` 调面板的 `save()`，失败会抛错让宿主保留面板；`destroyCallback` 释放面板。`openSetting()` 仍覆写，但只调 `settings.open(displayName)`：旧宿主可能只认「是否覆写 openSetting」判断设置入口，新宿主认 `plugin.setting`，两条路都通。`onunload` 关闭面板与设置。
- `src/editorPanel.ts` — 面板控件与读盘、草稿、保存、状态。文件切换、行号槽、语法指导、BOM 提示、问题列表、状态行 + 「重新读取」都在这里。保存流程「落草稿 → 重读比对 → 冲突则只提示 → 写入 → 回读校验」。
- `src/draft.ts` — 草稿：`localStorage` 里每个文件一条 `{text, base, at}`，以及「打开时用磁盘内容还是草稿」的纯决策 `pickInitialContent`。
- `src/status.ts` — 状态模型：7 种状态 → 文案键与色调（`success` / `info` / `warning` / `error` 对应 `--b3-card-*-color`）。
- `src/ignoreFiles.ts` — 六个文件的清单：文件名、语法（gitignore / sql）、文案键（`i18nKey`）、显示顺序，以及 `strict`（内核会拒绝整份文件）与 `minKernelVersion`（版本门槛）。`availableIgnoreFiles(kernelVersion)` 给出当前内核能编辑的文件。
- `src/ignoreFile.ts` — 读写，两套通道：
    - 前五个文件：读 `POST /api/file/getFile`（裸文本；失败是 HTTP 202 + JSON，`code 404` 视为空文件），写 `POST /api/file/putFile`（multipart，只有应答 `code === 0` 才算成功）。
    - `assets-cleanup-ignore`：读 `POST /api/asset/getAssetCleanupIgnore`（返回 `{content, revision}`，文件不存在时正文为空、`revision` 为 `"missing"`），写 `POST /api/asset/setAssetCleanupIgnore`（JSON，带 `content` 与读取时拿到的 `expectedRevision`；版本不匹配返回 `code 409` 且**不覆盖**，规则校验失败返回 `code -1` 且不落盘）。
    - 两套都必须用裸 `fetch`：`siyuan.fetchSyncPost` 会把响应当 JSON 解析，读文本文件必然抛错。
- `src/kernelVersion.ts` — 版本号读取与比较。取 `window.siyuan.config.system.kernelVersion`；按 semver 比较（`3.8.11-alpha.10` 高于 `3.8.11-alpha.2`，正式版高于同号预发布版），解析不了的版本号一律视为「不支持」。
- `src/lint.ts` — 按文件名分发检查器（语法 + `strict`），并把问题类型映射到文案 key。
- `src/lintGitignore.ts` — gitignore 语法检查（四个 gitignore 类文件）；`strict` 选项额外报 git 合并冲突残留标记。
- `src/lintSql.ts` — SQL 片段检查（searchignore / refsearchignore）。
- `src/fileSwitch.ts` — 文件切换的纯决策：读取期间选回当前文件要取消读取，不能当成重复操作后让旧结果继续生效。
- `src/index.scss` — 只描述面板里的自有控件（`.eds*`）。

旧的 `editorDialog.ts`、`sheet.ts`、`sheetGesture.ts`（自建对话框与移动端抽屉）已删除：面板与抽屉都交给宿主的设置界面。

## 设置面板：宿主给的能力与约束

- 入口：宿主 `hasPluginSetting()` 认 `plugin.setting`（或覆写过的 `openSetting`）；集市里的齿轮调 `plugin.openSetting()`，默认实现就是 `setting.open(displayName)`。
- 条目渲染：每个 item 一行 `.b3-label.config-item`，`title` 渲染成 `.config-name`；`direction: "row"` 时控件被塞进 `.fn__block` 并补上 `fn__block` 类；只有控件本身是 `INPUT`/`TEXTAREA` 才会被 `dialog.bindInput` 接管（我们的根节点是 `div`，Enter 仍然是换行）。
- 高度：`.b3-dialog__content` 是 `flex: 1; overflow: auto; padding: 16px`，高度由对话框自身（桌面独立设置窗口 100%、移动端抽屉 80vh）确定，所以编辑器**跟着窗口/抽屉变**：`index.scss` 把 `height: 100%` 与纵向 flex 一路传到 `.eds__editor`（`flex: 1`），只有 `min-height` 兜底（桌面 200px、窄屏 160px），放不下时由内容区滚动。必须是 `height: 100%` 而不是 `min-height: 100%`：高度随内容走时，行号槽的行数会把编辑器的最小高度顶回内容高度。
- 关闭：`Setting` 内部自己构造 `MobileDialog`，不透传 `beforeClose` / `mobileSheet.beforeClose`，插件拦不住关闭 → 未保存内容靠草稿兜底，不再弹「放弃修改」确认框。
- 保存按钮：`confirmCallback` 由宿主底部「保存」触发，宿主用 `runPending` 包起来（保存期间锁编辑）；它的返回值不影响关闭（宿主恒 `return true`），**只有抛错能留在面板里**（宿主同时弹一句「保存失败，请重试」），所以保存失败一律抛错，具体原因写进状态行。
- 独立窗口：`openInWindow: true`，桌面 Electron 用原生设置窗口打开（思源 3.8.7+，更早的宿主忽略该选项）。控件会被 `adoptNode` 迁进设置窗口，因此**只用元素引用与 `element.ownerDocument`**：不查 `document`、不挂 `document`/`window` 级监听、不用 `window.siyuan.dialogs` 判断最上层；存储也取 `element.ownerDocument.defaultView?.localStorage`。

## 六个文件与其内核行为

| 文件 | 语法 | 匹配基准 | 内核行为 |
| --- | --- | --- | --- |
| `syncignore` | gitignore | 相对 `data` | `sabhiram/go-gitignore` 编译，编译失败的行被静默丢弃；内核追加 `/.siyuan/conf.json`、用户指南、`/storage/view-state.json` 等内置规则 |
| `indexignore` | gitignore | `/<笔记本ID>/<文档路径>` | 命中则不写 `blocks`/`spans`/`refs` 等索引表；缓存只在内核重建索引时清 |
| `embeddingignore` | gitignore | `/<笔记本ID>/<文档路径>` | 命中则不参与向量索引；文件不存在时不加载 |
| `searchignore` | SQL | `blocks` 表 | 每行以 ` AND ` 拼到搜索查询后面，30 秒缓存 |
| `refsearchignore` | SQL | `refs` 表 | 每行以 ` AND ` 拼到 `SELECT DISTINCT content FROM refs`，30 秒缓存 |
| `assets-cleanup-ignore` | gitignore | `assets/...`（相对 `data`） | 命中的资源不进入未引用资源列表，也不被单个或批量清理；父目录一并保留。**整份规则先逐行校验再编译，任何一行编译不了就让清理直接报错中止**，不静默丢规则；冲突标记、单独的 `!`、非 UTF-8 / 含 NUL、超过 1 MiB 都会报错 |

- 同步与索引类忽略文件的内核把 `\r\n` 归一成 `\n`，但**不剥 BOM**：带 BOM 时第一行失效，所以插件读时去掉、保存时不写回，并在面板里提示。`assets-cleanup-ignore` 相反：内核先 `TrimPrefix("\ufeff")` 再编译，带 BOM 不影响规则，所以不提示，保存时同样不写回。
- `assets-cleanup-ignore` 的路径基准是 `data`（`assets/...`），内核把命中路径的父目录也一并保护；`.pdf` 资源还会连带保护 `<同名>.sya`。保护只作用于清理，不改变引用统计，也不阻止手动删除。
- SQL 类文件里 `#` 不是注释；内核只剔除第一个**完全为空**的行，首行只有空格或制表符时仍会拼出悬空的 `AND`，其余空行同样会（搜索直接报错）。

## 草稿与状态

- 输入停止 400ms 后把正文写进草稿；正文与磁盘一致时删掉草稿；面板 `dispose` 前再落一次，输入法尚未触发的事件也不会丢。
- 打开文件时：有草稿且与磁盘不同 → 显示草稿，状态 `restored`；草稿基于的磁盘内容已经不是现在的磁盘内容 → 状态 `external`（提示保存会覆盖）。
- 保存时重读比对：编辑期间被外部改过 → 这次不写，状态 `external`，再点保存才覆盖；`assets-cleanup-ignore` 的 `409` 同样走这条路。
- 「重新读取本地」是从**磁盘**重读并丢弃草稿（不是恢复草稿），用内联二次确认（按钮变红，5 秒后自动收回），**不弹对话框**：独立设置窗口里 `new Dialog` 会弹到主窗口，用户看不到。
- 状态行是唯一反馈，也不用 `showMessage`（同上：会显示在主窗口）。

## 语法检查范围

- gitignore：只报内核无法编译这条规则的写法——非法反斜杠转义、`[` 未闭合、圆括号不成对、`+`/`{…}` 重复非法、字符类里的 `*`、反了的字符类范围、只有 `!`。`\!`、`\*`、`a\b`、`\x41`、`\12`、`\p{L}`、`\Q…\E` 都能编译，不报。与内核实测做过 112 条逐条对照，误报只有有意保留的孤立 `!`。文案只写「规则无法编译」：同步与索引类文件是静默丢这条规则，`assets-cleanup-ignore` 是整份文件报错，两边都成立。
- `assets-cleanup-ignore` 额外报合并冲突残留标记（`<<<<<<<`、`=======`、`>>>>>>>`，按原始行首判断，缩进过的拦不住，与内核一致），并在问题列表前加一行 `lintStrictNote` 说明「会直接报错中止」而不是丢规则。NUL 字符、非 UTF-8、超过 1 MiB 不预先检查，交给内核在保存时报错。
- SQL：只报一定让语句报错的写法——空行（含首行只有空白字符）、行首 `#`、引号或括号不成对、分号、行首 `AND`/`OR` 或行尾悬空运算符。六类都在 SQLite 上实测过。
- 不覆盖：`\p{Zzz}` 这类靠 Unicode 名称表的拼写、上界是多字符转义的字符类范围、SQL 字段名是否存在。

## 已知限制与偏离

- 面板与移动端抽屉都用宿主的（`Setting` + `MobileDialog`），不再自建，`MOBILE_FLICKER.md` 的相关偏离随之消失。
- 宿主没有给插件拦截关闭的钩子，所以「关掉面板」不会询问未保存改动，只保证草稿不丢；想丢弃草稿必须点「重新读取本地」。
- `openInWindow` 需要思源 3.8.7+；更早的桌面宿主忽略该选项，退回普通对话框。浏览器与移动端始终是对话框 / 底部抽屉。
- `assets-cleanup-ignore` 需要内核 3.8.11-alpha.2 及以上。更早的版本不列这个文件，也不发起任何请求；拿不到或解析不了 `kernelVersion` 时按旧内核处理。`minAppVersion` 仍是 `3.1.20`，旧版本照常编辑另外五个文件。
- `minAppVersion` 为 `3.1.20`。`name` 必须与目录名、仓库名一致；不发布内核插件，因此没有 `kernels`；`disabledInPublish` 为 `true`。
- `npm` 上 `siyuan` 类型包落后于宿主：`Setting.dialog` / `Setting.close` / `openInWindow` 都缺，`index.ts` 里做窄类型补充；不再需要 `containerClassName` / `beforeClose`。
- 编辑器高度依赖宿主把高度传下来：`.b3-dialog__content` 高度不确定时（旧宿主或换了布局），编辑器退到 `min-height` 的兜底值而不是撑满，功能不受影响；移动端键盘弹出后抽屉不会变矮，编辑区可能压在键盘后面，靠宿主的 `scrollInputIntoView` 把光标滚进可视区。
- 宿主的条目行 `.b3-label` 有 `padding: 16px 24px`，叠加内容区的 16px 后留白是重构前的两倍（移动端尤其明显），所以 `index.scss` 用 `:has()` 只处理**包含本插件控件的那一行**：清零它的 `padding`，并把它与 `.fn__block` 变成撑满内容区的纵向 flex 容器（顺带把高度传给编辑器）。用 `:has()` 而不是给 `.eds` 加负外边距：负外边距会让块比滚动容器更宽，左移右不齐。不支持 `:has()` 的旧宿主会退回宿主的 24px，只是略宽。
- `assets/preview.html` 与 `assets/preview.png` 仍是旧版自建对话框的还原，与现在由宿主承载的设置面板不一致（这次改动先撤回了预览图，待重画）。重画时按 `src/editorPanel.ts` 的 DOM 与宿主 Setting 的条目行来，再跑 `npm run render:preview`。

## 构建产物

`dist/` 与 `package.zip` 扁平布局：`plugin.json`、`index.js`、`index.css`、`icon.png`、`preview.png`、`i18n/en.json`、`i18n/zh-CN.json`、双语 README、`LICENSE`。产物不提交。
