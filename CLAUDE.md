# edit-syncignore-siyuan

思源插件：用带行号的编辑器编辑同步忽略列表 `data/.siyuan/syncignore`。

## 命令

```bash
npm ci             # 安装依赖（CI 使用 npm ci）
npm run typecheck  # tsc --noEmit，只检查 src
npm test           # tsc -p tsconfig.test.json && node --test，输出到 test-dist/（已忽略）
npm run build      # 生产构建，输出 dist/ 与 package.zip
npm run verify:package # 核对 package.zip 的必需文件、扁平布局与图片体积
npm run dev        # watch 构建，只写根目录 index.js/index.css/i18n/；验证时不要运行
npm run render:icon    # assets/icon.svg → assets/icon.png
npm run render:preview # assets/preview.html → assets/preview.png（需要 npx playwright install chromium）
```

`npm test` 先用 `tsconfig.test.json` 把 `test/` 和被引用的 `src/` 模块编译成 CommonJS 到 `test-dist/`，再用 Node 内置测试运行器跑，不引入测试框架。测试只覆盖不依赖思源的纯逻辑；新增测试文件要同时加进 `package.json` 的 `test` 脚本（Node 20 不展开 glob，目录参数也不稳）。

## CI

`.github/workflows/ci.yml` 在 push `main`/`dev`、PR 与手动触发时运行：`npm ci` → 版本一致性 → `typecheck` → `test` → `build` → `npm run verify:package` → 上传 `package.zip` artifact。Node 固定 20。`.github/workflows/cd.yml` 只在 push `main` 与手动触发时按版本比较发 Release，发之前自己再跑一遍 `test` 与 `verify:package`，不依赖另一条 workflow 已经把关。产物校验只在 `scripts/verify-package.mjs` 一处，两条 workflow 共用同一份清单。

## 模块

- `src/index.ts` — 插件入口。不创建 `Setting`，而是覆写原型的 `openSetting()`：宿主以「`plugin.setting` 存在或 `openSetting` 被覆写」判断插件有没有设置入口，所以点击插件列表里的「设置」会直接打开编辑器。必须是原型方法，写成实例属性会让旧版本判断失效。实例自己带 `unloaded` 标志，禁用后宿主的旧引用调进来直接返回；`onunload` 关闭可能还开着的编辑器。
- `src/syncignore.ts` — 文件读写与语法检查。读 `POST /api/file/getFile`（裸文本，失败是 HTTP 202 + JSON，`code 404` 视为空文件），写 `POST /api/file/putFile`（multipart，只有应答 `code === 0` 才算成功）。**必须用裸 `fetch`**：`siyuan.fetchSyncPost` 会把响应当 JSON 解析，读文本文件时必然抛错。读到的正文去掉 BOM、行尾统一成 `\n`；写回一律不带 BOM。
- `src/editorDialog.ts` — 对话框本体：行号槽、折叠指导、BOM 提示、语法错误列表、保存/关闭守卫。保存流程是「重读比对 → 冲突确认 → 写入 → 回读校验」，保存期间文本框只读且不接受关闭（`saving`），`closed` 与 `disposed` 分开：前者表示已决定关闭、用来挡住每个 `await` 之后的写入，后者只管 DOM 是否已拆。`Esc` 用「本对话框是否 `window.siyuan.dialogs` 最后一个」判断，只有它最上层时才改道到自己的关闭流程，避免宿主的 `destroy()` 绕过未保存确认；`destroyCallback` 里还要对 `openedDialog` 做身份比较后释放，因为宿主发起的关闭不经过插件的关闭流程。
- `src/sheet.ts` — 移动端底部抽屉，按宿主规则实现：类名（`mobile-bottom-sheet-dialog` / `mobile-sheet-layout` / `mobile-bottom-sheet` / `mobile-sheet-panel`）、抓手（`b3-menu__title--root`）、56% 上限与 `chrome + 120px` 下限、完整视口取 `window.siyuan.mobile.size.<方向>.height1`、入场前的视口等待、拖拽阈值、松手后 300ms 点击抑制。对外只有 `freeze` / `relayout` / `dispose`。
- `src/sheetGesture.ts` — 抽屉手势的纯函数（可用区间、56% 上限、位移推进、松手关闭判定），与宿主 `mobileSheetGesture` 的公式一致，便于单元测试。
- `src/index.scss` — 全部样式，颜色/圆角/间距只用 `--b3-*` 变量。类名 `.eds*` 与 `.eds-dialog` 都是本插件私有。

## manifest 约束

- `name` 与仓库名、安装目录名一致：`edit-syncignore-siyuan`。
- `minAppVersion` 为 `3.1.20`：`Dialog.containerClassName` 自 3.1.11 起提供，其余用到的 API 更早就有。
- 不发布内核插件，因此没有 `kernels` 字段。
- `disabledInPublish` 为 `true`。

## 已知限制与偏离

- **抽屉是自建实现，明确违反 `MOBILE_FLICKER.md`**：该文件 §一.4（只用 `transform` 移出视口、不写 `visibility: hidden`、不读 `offsetHeight`）、§一.5（不接管动画时序、不写 `transition: none`）、§一.6 与 §四（不复制 `bindBottomSheetDialog`、不自行实现等待视口）都要求直接复用宿主实现，而 `src/sheet.ts` 全部自己做了。原因是宿主的 `bindBottomSheetDialog` / `bindBottomSheetDrag` / `mobileSheetLayout` / `sheetOpen` 都没有导出给插件，插件拿不到，只能按源码逐条对齐。维护者已确认保留当前实现；宿主改版后必须按源码重新核对，不能默认仍然一致。
- 抽屉另外两处刻意偏离 `MOBILE_FLICKER.md`：`scrim` 透明度不再自己写（宿主样式里 `mobile-bottom-sheet-dialog .b3-dialog__scrim` 是 `background-color: transparent`，写了也没有视觉效果）；面板高度固定取「可用高度与 56% 上限的较小值」，不像宿主那样用 `height: auto` 按内容自适应——编辑器需要一个稳定高度的输入区。
- 抽屉未移植宿主的两处周边行为：一是 `keyboard--sheet-open` 状态类（宿主的 `keyboardSheetState` 用它给主题派生样式，插件加入会与宿主自己的 Set 打架），二是内容子树的 MutationObserver（插件内容在打开后只有语法提示行会变化，重排由 `SheetHandle.relayout` 直接触发）。
- 入场沿用宿主做法，会在手势/入场期间临时写内联 `transition` 并强制一次重排（`void sheet.offsetHeight`），这与「不接管动画时序」的默认规则相反，同样是刻意为之。
- `Dialog.beforeClose` 直到 3.8.9 才存在。旧版本上「未保存修改」的确认由插件自己拦截遮罩点击与 `Esc` 提供，移动端返回手势无法拦截；3.8.9+ 上宿主 `destroy()` 会先问 `beforeClose`，干净关闭则完全走宿主销毁、插件不参与——所以 `destroyCallback` 里必须自己再释放一次模块级引用，否则宿主发起的关闭会让编辑器再也打不开。
- 内核没有 syncignore 的读写接口，全部走原始文件 API。文件不存在时 `getFile` 返回 HTTP 202 + `code 404`，插件当成空文件，不报错。
- 抽屉样式要 `mobile-sheet-layout` 与 `mobile-sheet-panel` 两组都在（自 3.8.10-alpha.5 起）。插件用一次性样式表探测判断，探测不到就退回普通对话框（不画抓手、不绑定拖拽）。`mobile-sheet-panel--compact` 直到 3.8.10-alpha.6 才有，缺它只影响极窄高度下的紧凑样式。
- `npm` 上 `siyuan` 类型包落后于宿主实现：`containerClassName`、`beforeClose`、`Setting.close` 都缺。只在 `src/editorDialog.ts` 里做了一处窄类型扩展，没有扩散成全局断言；`window.siyuan.mobile.size`、`window.siyuan.dialogs` 也各只在用到的模块里做了一处窄类型。
- 语法检查只报「内核会静默丢弃这条规则」的写法，规则全部由 `sabhiram/go-gitignore`（20210923 版）的转换加 RE2 实测确定：反斜杠转义非法（行尾反斜杠、不认识的字母、`\p` 没有合法类别名等）、`[` 未闭合、圆括号不成对、`+` 与 `{…}` 的重复写法非法、字符类里含 `*`（内核会把它替换成 `([^/]*)` 从而切断字符类）、字符类范围反了；另外只有 `!` 没有内容会取消前面全部规则，也报。`\!`、`\#`、`\*`、`a\b`、`\x41`、`\12`、`\p{L}`、`\Q…\E` 这些都能编译，不报。缺前导 `/`、重复行、行尾空白同样不提示。未覆盖：靠 Unicode 名称表的 `\p{Zzz}` 拼错、上界是多字符转义的字符类范围（如 `[z-\d]`）。`lintSyncIgnore` 与内核实测做过 112 条规则的逐条对照，误报为 0（`!` 那条是有意保留），未覆盖项才会漏报。
- 内核不剥 BOM，带 BOM 时第一条规则会失效。插件读时去掉 BOM 并在编辑器里提示一行，保存时不再写回 BOM——这会改动文件开头字节，是刻意的行为。
- `assets/preview.html` 是插件真实界面的 1:1 还原（DOM 与 `src/editorDialog.ts` 一致，样式取自思源 dialog/button 规则与本插件 SCSS），但不画隐藏节点：`.eds__lint` 占位保留在 DOM 里而不显示，关闭图标与八个缩放手柄不画。改界面时要同步改它并重新渲染。

## 构建产物

`dist/` 与 `package.zip` 采用扁平布局：`plugin.json`、`index.js`、`index.css`、`icon.png`、`preview.png`、`i18n/en.json`、`i18n/zh-CN.json`、双语 README、`LICENSE`。产物不提交。
