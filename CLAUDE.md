# edit-syncignore-siyuan

思源插件：用带行号的编辑器编辑同步忽略列表 `data/.siyuan/syncignore`。

## 命令

```bash
npm ci             # 安装依赖（CI 使用 npm ci）
npm run typecheck  # tsc --noEmit，只检查 src
npm test           # tsc -p tsconfig.test.json && node --test，输出到 test-dist/（已忽略）
npm run build      # 生产构建，输出 dist/ 与 package.zip
npm run dev        # watch 构建，只写根目录 index.js/index.css/i18n/；验证时不要运行
npm run render:icon    # assets/icon.svg → assets/icon.png
npm run render:preview # assets/preview.html → assets/preview.png（需要 npx playwright install chromium）
```

`npm test` 先用 `tsconfig.test.json` 把 `test/` 和被引用的 `src/` 模块编译成 CommonJS 到 `test-dist/`，再用 Node 内置测试运行器跑，不引入测试框架。测试只覆盖不依赖思源的纯逻辑；新增测试文件要同时加进 `package.json` 的 `test` 脚本（Node 20 不展开 glob，目录参数也不稳）。

## CI

`.github/workflows/ci.yml` 在 push `main`/`dev`、PR 与手动触发时运行：`npm ci` → 版本一致性 → `typecheck` → `test` → `build` → 用 `unzip -Z1` 核对 `package.zip` 必需文件 → 上传 `package.zip` artifact。Node 固定 20。`.github/workflows/cd.yml` 只在 push `main` 时按版本比较发 Release。

## 模块

- `src/index.ts` — 插件入口。不创建 `Setting`，而是覆写原型的 `openSetting()`：宿主以「`plugin.setting` 存在或 `openSetting` 被覆写」判断插件有没有设置入口，所以点击插件列表里的「设置」会直接打开编辑器。必须是原型方法，写成实例属性会让旧版本判断失效。实例自己带 `unloaded` 标志，禁用后宿主的旧引用调进来直接返回；`onunload` 关闭可能还开着的编辑器。
- `src/syncignore.ts` — 文件读写与语法检查。读 `POST /api/file/getFile`（裸文本，失败是 HTTP 202 + JSON，`code 404` 视为空文件），写 `POST /api/file/putFile`（multipart，只有应答 `code === 0` 才算成功）。**必须用裸 `fetch`**：`siyuan.fetchSyncPost` 会把响应当 JSON 解析，读文本文件时必然抛错。读到的正文去掉 BOM、行尾统一成 `\n`；写回一律不带 BOM。
- `src/editorDialog.ts` — 对话框本体：行号槽、折叠指导、BOM 提示、语法错误列表、保存/关闭守卫。保存流程是「重读比对 → 冲突确认 → 写入 → 回读校验」，保存期间文本框只读。`Esc` 用「本对话框是否 `window.siyuan.dialogs` 最后一个」判断，只有它最上层时才改道到自己的关闭流程，避免宿主的 `destroy()` 绕过未保存确认。
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
- `Dialog.beforeClose` 直到 3.8.9 才存在。旧版本上「未保存修改」的确认由插件自己拦截遮罩点击与 `Esc` 提供，移动端返回手势无法拦截。
- 内核没有 syncignore 的读写接口，全部走原始文件 API。文件不存在时 `getFile` 返回 HTTP 202 + `code 404`，插件当成空文件，不报错。
- 抽屉样式要 `mobile-sheet-layout` 与 `mobile-sheet-panel` 两组都在（自 3.8.10-alpha.5 起）。插件用一次性样式表探测判断，探测不到就退回普通对话框（不画抓手、不绑定拖拽）。`mobile-sheet-panel--compact` 直到 3.8.10-alpha.6 才有，缺它只影响极窄高度下的紧凑样式。
- `npm` 上 `siyuan` 类型包落后于宿主实现：`containerClassName`、`beforeClose`、`Setting.close` 都缺。只在 `src/editorDialog.ts` 里做了一处窄类型扩展，没有扩散成全局断言；`window.siyuan.mobile.size`、`window.siyuan.dialogs` 也各只在用到的模块里做了一处窄类型。
- 语法检查只报「内核会静默丢弃这条规则」的写法，取值全部按 `sabhiram/go-gitignore`（20210923 版）与 RE2 实测确定：反斜杠转义无效（含行尾反斜杠）、`[` 未闭合、圆括号不成对、`+` 位置不对；另外只有 `!` 没有内容会取消前面全部规则，也报。缺前导 `/`、重复行、行尾空白，以及 `\!`、`\#`、`\*`、`a\b` 这类能编译但含义不对的写法都不提示。规则是否命中文件由内核判定，插件不实现匹配引擎。
- 内核不剥 BOM，带 BOM 时第一条规则会失效。插件读时去掉 BOM 并在编辑器里提示一行，保存时不再写回 BOM——这会改动文件开头字节，是刻意的行为。
- `assets/preview.html` 是插件真实界面的 1:1 还原（DOM 与 `src/editorDialog.ts` 一致，样式取自思源 dialog/button 规则与本插件 SCSS）。改界面时要同步改它并重新渲染。

## 构建产物

`dist/` 与 `package.zip` 采用扁平布局：`plugin.json`、`index.js`、`index.css`、`icon.png`、`preview.png`、`i18n/en.json`、`i18n/zh-CN.json`、双语 README、`LICENSE`。产物不提交。
