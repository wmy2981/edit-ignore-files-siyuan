# edit-ignore-files-siyuan

思源插件：用一个带行号的编辑器编辑 `data/.siyuan/` 下的六个忽略文件。

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

`npm test` 先清空 `test-dist/`，再用 `tsconfig.test.json` 把 `test/` 和被引用的 `src/` 模块编译成 CommonJS 到 `test-dist/`，最后用 Node 内置测试运行器跑 `test-dist/test/*.test.js`。测试只覆盖不依赖思源的纯逻辑；新增 `test/*.test.ts` 会被自动纳入，不用改脚本（`node --test` 的 glob 要 Node 21+，CI 与 `engines` 都锁在 22 以上）。

## CI

`ci.yml`：push `main`/`dev`、PR、手动触发跑 `typecheck` → `test` → `build` → `verify:package`，上传产物。`cd.yml`：push `main` 与手动触发，版本升高才发 Release，发之前自己再跑 `test` 与 `verify:package`。产物清单只在 `scripts/verify-package.mjs` 一处。

## 模块

- `src/index.ts` — 插件入口。覆写原型的 `openSetting()` 让「设置」直接打开编辑器（宿主以「`openSetting` 是否被覆写」判断有无设置入口，写成实例属性会失效）。实例带 `unloaded` 标志，`onunload` 关闭编辑器。
- `src/ignoreFiles.ts` — 六个文件的清单：文件名、语法（gitignore / sql）、文案键（`i18nKey`）、显示顺序，以及每项的 `strict`（内核会拒绝整份文件）与 `minKernelVersion`（版本门槛）。`availableIgnoreFiles(kernelVersion)` 给出当前内核能编辑的文件。
- `src/kernelVersion.ts` — 版本号读取与比较。取 `window.siyuan.config.system.kernelVersion`；按 semver 比较（`3.8.11-alpha.10` 高于 `3.8.11-alpha.2`，正式版高于同号预发布版），解析不了的版本号一律视为「不支持」。
- `src/ignoreFile.ts` — 读写，两套通道：
    - 前五个文件：读 `POST /api/file/getFile`（裸文本；失败是 HTTP 202 + JSON，`code 404` 视为空文件），写 `POST /api/file/putFile`（multipart，只有应答 `code === 0` 才算成功）。
    - `assets-cleanup-ignore`：读 `POST /api/asset/getAssetCleanupIgnore`（返回 `{content, revision}`，文件不存在时正文为空、`revision` 为 `"missing"`），写 `POST /api/asset/setAssetCleanupIgnore`（JSON，带 `content` 与读取时拿到的 `expectedRevision`；版本不匹配返回 `code 409` 且**不覆盖**，规则校验失败返回 `code -1` 且不落盘）。
    - 两套都必须用裸 `fetch`：`siyuan.fetchSyncPost` 会把响应当 JSON 解析，读文本文件必然抛错。
- `src/lint.ts` — 按文件名分发检查器（语法 + `strict`），并把问题类型映射到文案 key。
- `src/lintGitignore.ts` — gitignore 语法检查（四个 gitignore 类文件）；`strict` 选项额外报 git 合并冲突残留标记。
- `src/lintSql.ts` — SQL 片段检查（searchignore / refsearchignore）。
- `src/editorDialog.ts` — 对话框：文件切换（列表按内核版本过滤）、行号槽、说明与折叠指导、BOM 提示、问题列表、保存与关闭守卫。保存流程「重读比对 → 冲突确认 → 写入 → 回读校验」；带 `revision` 的文件额外处理内核返回的 `409`（确认后按新版本号再写一次），期间文本框只读且拒绝关闭（`saving`）；读取目标文件期间同样只读（`loading`），读取完成前选回当前文件会取消这次切换。放弃修改的确认框是自建的（宿主 `confirm` 不能改按钮文案与样式），焦点放在对话框容器上，避免放弃按钮一出现就带上 `:focus` 底色；`closed`（已决定关闭）与 `disposed`（DOM 已拆）分开。
- `src/fileSwitch.ts` — 文件切换的纯决策：读取期间选回当前文件要取消读取，不能当成重复操作后让旧结果继续生效。
- `src/sheet.ts` / `src/sheetGesture.ts` — 移动端底部抽屉与它的纯函数手势计算。
- `src/index.scss` — 全部样式，只作用在 `.eds*` / `.eds-dialog` 私有类上。

## 六个文件与其内核行为

| 文件 | 语法 | 匹配基准 | 内核行为 |
| --- | --- | --- | --- |
| `syncignore` | gitignore | 相对 `data` | `sabhiram/go-gitignore` 编译，编译失败的行被静默丢弃；内核追加 `/.siyuan/conf.json`、用户指南、`/storage/view-state.json` 等内置规则 |
| `indexignore` | gitignore | `/<笔记本ID>/<文档路径>` | 命中则不写 `blocks`/`spans`/`refs` 等索引表；缓存只在内核重建索引时清 |
| `embeddingignore` | gitignore | `/<笔记本ID>/<文档路径>` | 命中则不参与向量索引；文件不存在时不加载 |
| `searchignore` | SQL | `blocks` 表 | 每行以 ` AND ` 拼到搜索查询后面，30 秒缓存 |
| `refsearchignore` | SQL | `refs` 表 | 每行以 ` AND ` 拼到 `SELECT DISTINCT content FROM refs`，30 秒缓存 |
| `assets-cleanup-ignore` | gitignore | `assets/...`（相对 `data`） | 命中的资源不进入未引用资源列表，也不被单个或批量清理；父目录一并保留。**整份规则先逐行校验再编译，任何一行编译不了就让清理直接报错中止**，不静默丢规则；冲突标记、单独的 `!`、非 UTF-8 / 含 NUL、超过 1 MiB 都会报错 |

- 同步与索引类忽略文件的内核把 `\r\n` 归一成 `\n`，但**不剥 BOM**：带 BOM 时第一行失效，所以插件读时去掉、保存时不写回，并在编辑器里提示。`assets-cleanup-ignore` 相反：内核先 `TrimPrefix("\ufeff")` 再编译，带 BOM 不影响规则，所以不提示，保存时同样不写回。
- `assets-cleanup-ignore` 的路径基准是 `data`（`assets/...`），内核把命中路径的父目录也一并保护；`.pdf` 资源还会连带保护 `<同名>.sya`。保护只作用于清理，不改变引用统计，也不阻止手动删除。
- SQL 类文件里 `#` 不是注释；内核只剔除第一个**完全为空**的行，首行只有空格或制表符时仍会拼出悬空的 `AND`，其余空行同样会（搜索直接报错）。

## 语法检查范围

- gitignore：只报内核无法编译这条规则的写法——非法反斜杠转义、`[` 未闭合、圆括号不成对、`+`/`{…}` 重复非法、字符类里的 `*`、反了的字符类范围、只有 `!`。`\!`、`\*`、`a\b`、`\x41`、`\12`、`\p{L}`、`\Q…\E` 都能编译，不报。与内核实测做过 112 条逐条对照，误报只有有意保留的孤立 `!`。文案只写「规则无法编译」：同步与索引类文件是静默丢这条规则，`assets-cleanup-ignore` 是整份文件报错，两边都成立。
- `assets-cleanup-ignore` 额外报合并冲突残留标记（`<<<<<<<`、`=======`、`>>>>>>>`，按原始行首判断，缩进过的拦不住，与内核一致），并在问题列表前加一行 `lintStrictNote` 说明「会直接报错中止」而不是丢规则。NUL 字符、非 UTF-8、超过 1 MiB 不预先检查，交给内核在保存时报错（保存失败会显示内核文案）。
- SQL：只报一定让语句报错的写法——空行（含首行只有空白字符）、行首 `#`、引号或括号不成对、分号、行首 `AND`/`OR` 或行尾悬空运算符。六类都在 SQLite 上实测过。
- 不覆盖：`\p{Zzz}` 这类靠 Unicode 名称表的拼写、上界是多字符转义的字符类范围、SQL 字段名是否存在。

## 已知限制与偏离

- **抽屉是自建实现，明确违反 `MOBILE_FLICKER.md`** §一.4/5/6 与 §四（宿主没有把 `bindBottomSheetDialog` / `bindBottomSheetDrag` / `mobileSheetLayout` / `sheetOpen` 导出给插件）。维护者已确认保留；宿主改版后必须按源码重新核对。
- 抽屉另两处刻意偏离：不写 `scrim` 透明度（宿主样式里该遮罩本来就是透明的）；面板高度固定取「可用高度与 56% 上限的较小值」，不按内容自适应。
- 未移植 `keyboard--sheet-open` 状态类与内容子树的 MutationObserver；重排由 `SheetHandle.relayout` 触发。入场仍会临时写内联 `transition` 并强制重排。
- `Dialog.beforeClose` 自 3.8.9 起才有。干净关闭完全走宿主销毁，所以 `destroyCallback` 里要对 `openedDialog` 做身份比较后释放，否则宿主发起的关闭会让编辑器再也打不开。
- 抽屉样式要 `mobile-sheet-layout` 与 `mobile-sheet-panel` 都在（3.8.10-alpha.5+）；探测不到就退回普通对话框。`mobile-sheet-panel--compact` 到 3.8.10-alpha.6 才有，缺它只影响极窄高度。
- `assets-cleanup-ignore` 需要内核 3.8.11-alpha.2 及以上（该版本才有文件与三个 `/api/asset/*AssetCleanupIgnore` 接口）。更早的版本不列这个文件，也不发起任何请求；拿不到或解析不了 `kernelVersion` 时按旧内核处理。`minAppVersion` 仍是 `3.1.20`，插件在旧版本照常编辑另外五个文件。
- `minAppVersion` 为 `3.1.20`（`Dialog.containerClassName` 自 3.1.11 起），不要为了这个文件抬高它。`name` 必须与目录名、仓库名一致；不发布内核插件，因此没有 `kernels`；`disabledInPublish` 为 `true`。
- `npm` 上 `siyuan` 类型包落后于宿主：`containerClassName`、`beforeClose`、`Setting.close` 都缺。只在用到处做窄类型，不做全局断言。
- 宿主 `.b3-label__text` 用 `!important` 把 `overflow` 锁成 `hidden`；`.eds__lint` 同时带这个类，必须同样用 `!important` 才能滚动。
- `assets/preview.html` 是真实界面的 1:1 还原（DOM 与 `src/editorDialog.ts` 一致，下拉框列出六个文件），但不画隐藏节点：`.eds__lint` 占位保留、语法提示行不显示，关闭图标与八个缩放手柄不画。改界面要同步改它并重新渲染。

## 构建产物

`dist/` 与 `package.zip` 扁平布局：`plugin.json`、`index.js`、`index.css`、`icon.png`、`preview.png`、`i18n/en.json`、`i18n/zh-CN.json`、双语 README、`LICENSE`。产物不提交。
