# edit-ignore-files-siyuan

思源插件：用一个带行号的编辑器编辑 `data/.siyuan/` 下的五个忽略文件。

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
- `src/ignoreFiles.ts` — 五个文件的清单：文件名、语法（gitignore / sql）、路径、显示顺序。
- `src/ignoreFile.ts` — 读写。读 `POST /api/file/getFile`（裸文本；失败是 HTTP 202 + JSON，`code 404` 视为空文件），写 `POST /api/file/putFile`（multipart，只有应答 `code === 0` 才算成功）。**必须用裸 `fetch`**：`siyuan.fetchSyncPost` 会把响应当 JSON 解析，读文本文件必然抛错。
- `src/lint.ts` — 按语法分发检查器，并把问题类型映射到文案 key。
- `src/lintGitignore.ts` — gitignore 语法检查（syncignore / indexignore / embeddingignore）。
- `src/lintSql.ts` — SQL 片段检查（searchignore / refsearchignore）。
- `src/editorDialog.ts` — 对话框：文件切换、行号槽、说明与折叠指导、BOM 提示、问题列表、保存与关闭守卫。保存流程「重读比对 → 冲突确认 → 写入 → 回读校验」，期间文本框只读且拒绝关闭（`saving`）；读取目标文件期间同样只读（`loading`），读取完成前选回当前文件会取消这次切换。放弃修改的确认框是自建的（宿主 `confirm` 不能改按钮文案与样式）；`closed`（已决定关闭）与 `disposed`（DOM 已拆）分开。
- `src/fileSwitch.ts` — 文件切换的纯决策：读取期间选回当前文件要取消读取，不能当成重复操作后让旧结果继续生效。
- `src/sheet.ts` / `src/sheetGesture.ts` — 移动端底部抽屉与它的纯函数手势计算。
- `src/index.scss` — 全部样式，只作用在 `.eds*` / `.eds-dialog` 私有类上。

## 五个文件与其内核行为

| 文件 | 语法 | 匹配基准 | 内核行为 |
| --- | --- | --- | --- |
| `syncignore` | gitignore | 相对 `data` | `sabhiram/go-gitignore` 编译，编译失败的行被静默丢弃；内核追加 `/.siyuan/conf.json`、用户指南、`/storage/view-state.json` 等内置规则 |
| `indexignore` | gitignore | `/<笔记本ID>/<文档路径>` | 命中则不写 `blocks`/`spans`/`refs` 等索引表；缓存只在内核重建索引时清 |
| `embeddingignore` | gitignore | `/<笔记本ID>/<文档路径>` | 命中则不参与向量索引；文件不存在时不加载 |
| `searchignore` | SQL | `blocks` 表 | 每行以 ` AND ` 拼到搜索查询后面，30 秒缓存 |
| `refsearchignore` | SQL | `refs` 表 | 每行以 ` AND ` 拼到 `SELECT DISTINCT content FROM refs`，30 秒缓存 |

- 内核把 `\r\n` 归一成 `\n`，但**不剥 BOM**：带 BOM 时第一行失效，所以插件读时去掉、保存时不写回，并在编辑器里提示。
- SQL 类文件里 `#` 不是注释；内核只剔除第一个**完全为空**的行，首行只有空格或制表符时仍会拼出悬空的 `AND`，其余空行同样会（搜索直接报错）。

## 语法检查范围

- gitignore：只报内核会丢规则的写法——非法反斜杠转义、`[` 未闭合、圆括号不成对、`+`/`{…}` 重复非法、字符类里的 `*`、反了的字符类范围、只有 `!`。`\!`、`\*`、`a\b`、`\x41`、`\12`、`\p{L}`、`\Q…\E` 都能编译，不报。与内核实测做过 112 条逐条对照，误报只有有意保留的孤立 `!`。
- SQL：只报一定让语句报错的写法——空行（含首行只有空白字符）、行首 `#`、引号或括号不成对、分号、行首 `AND`/`OR` 或行尾悬空运算符。六类都在 SQLite 上实测过。
- 不覆盖：`\p{Zzz}` 这类靠 Unicode 名称表的拼写、上界是多字符转义的字符类范围、SQL 字段名是否存在。

## 已知限制与偏离

- **抽屉是自建实现，明确违反 `MOBILE_FLICKER.md`** §一.4/5/6 与 §四（宿主没有把 `bindBottomSheetDialog` / `bindBottomSheetDrag` / `mobileSheetLayout` / `sheetOpen` 导出给插件）。维护者已确认保留；宿主改版后必须按源码重新核对。
- 抽屉另两处刻意偏离：不写 `scrim` 透明度（宿主样式里该遮罩本来就是透明的）；面板高度固定取「可用高度与 56% 上限的较小值」，不按内容自适应。
- 未移植 `keyboard--sheet-open` 状态类与内容子树的 MutationObserver；重排由 `SheetHandle.relayout` 触发。入场仍会临时写内联 `transition` 并强制重排。
- `Dialog.beforeClose` 自 3.8.9 起才有。干净关闭完全走宿主销毁，所以 `destroyCallback` 里要对 `openedDialog` 做身份比较后释放，否则宿主发起的关闭会让编辑器再也打不开。
- 抽屉样式要 `mobile-sheet-layout` 与 `mobile-sheet-panel` 都在（3.8.10-alpha.5+）；探测不到就退回普通对话框。`mobile-sheet-panel--compact` 到 3.8.10-alpha.6 才有，缺它只影响极窄高度。
- `minAppVersion` 为 `3.1.20`（`Dialog.containerClassName` 自 3.1.11 起）。`name` 必须与目录名、仓库名一致；不发布内核插件，因此没有 `kernels`；`disabledInPublish` 为 `true`。
- `npm` 上 `siyuan` 类型包落后于宿主：`containerClassName`、`beforeClose`、`Setting.close` 都缺。只在用到处做窄类型，不做全局断言。
- `assets/preview.html` 是真实界面的 1:1 还原（DOM 与 `src/editorDialog.ts` 一致），但不画隐藏节点：`.eds__lint` 占位保留、语法提示行不显示，关闭图标与八个缩放手柄不画。改界面要同步改它并重新渲染。

## 构建产物

`dist/` 与 `package.zip` 扁平布局：`plugin.json`、`index.js`、`index.css`、`icon.png`、`preview.png`、`i18n/en.json`、`i18n/zh-CN.json`、双语 README、`LICENSE`。产物不提交。
