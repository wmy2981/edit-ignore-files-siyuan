# edit-syncignore-siyuan

思源插件：用带行号的编辑器编辑同步忽略列表 `data/.siyuan/syncignore`。

## 命令

```bash
npm ci             # 安装依赖（CI 使用 npm ci）
npm run typecheck  # tsc --noEmit
npm run build      # 生产构建，输出 dist/ 与 package.zip
npm run dev        # watch 构建，只写根目录 index.js/index.css/i18n/；验证时不要运行
npm run render:icon    # assets/icon.svg → assets/icon.png
npm run render:preview # assets/preview.html → assets/preview.png（需要 npx playwright install chromium）
```

## 模块

- `src/index.ts` — 插件入口。不创建 `Setting`，而是覆写原型的 `openSetting()`：宿主以「`plugin.setting` 存在或 `openSetting` 被覆写」判断插件有没有设置入口，所以点击插件列表里的「设置」会直接打开编辑器。必须是原型方法，写成实例属性会让旧版本判断失效。`onunload` 关闭可能还开着的编辑器。
- `src/syncignore.ts` — 文件读写与语法检查。读 `POST /api/file/getFile`（裸文本，失败是 HTTP 202 + JSON），写 `POST /api/file/putFile`（multipart）。**必须用裸 `fetch`**：`siyuan.fetchSyncPost` 会把响应当 JSON 解析，读文本文件时必然抛错。
- `src/editorDialog.ts` — 对话框本体：行号槽、折叠指导、语法错误列表、保存/关闭守卫。保存流程是「重读比对 → 冲突确认 → 写入 → 回读校验」。
- `src/sheet.ts` — 移动端底部抽屉，按宿主规则实现：类名（`mobile-bottom-sheet-dialog` / `mobile-sheet-layout` / `mobile-bottom-sheet` / `mobile-sheet-panel`）、抓手（`b3-menu__title--root`）、56% 上限与 `chrome + 120px` 下限、入场前的视口等待、拖拽阈值与 scrim 淡出、松手后 300ms 点击抑制。
- `src/index.scss` — 全部样式，颜色/圆角/间距只用 `--b3-*` 变量。类名 `.eds*` 与 `.eds-dialog` 都是本插件私有。

## manifest 约束

- `name` 与仓库名、安装目录名一致：`edit-syncignore-siyuan`。
- `minAppVersion` 为 `3.1.20`：`Dialog.containerClassName` 自 3.1.11 起提供，其余用到的 API 更早就有。
- 不发布内核插件，因此没有 `kernels` 字段。
- `disabledInPublish` 为 `true`。

## 已知限制与偏离

- **抽屉是自建实现**：宿主的 `bindBottomSheetDialog` / `bindBottomSheetDrag` / `mobileSheetLayout` 未导出给插件，`src/sheet.ts` 按同样的规则自行实现，以便动画与拖拽手感与宿主一致。这偏离了「不要复制宿主抽屉实现」的默认规则，属于本项目的明确选择；宿主改版后需要按源码重新核对。
- 抽屉未移植宿主的两处周边行为：一是 `keyboard--sheet-open` 状态类（宿主的 `keyboardSheetState` 用它给主题派生样式，插件加入会与宿主自己的 Set 打架），二是内容子树的 MutationObserver（插件内容在打开后只有语法提示行会变化，不需要重新布局）。
- 入场沿用宿主做法，会在手势/入场期间临时写内联 `transition` 并强制一次重排（`void sheet.offsetHeight`），这与「不接管动画时序」的默认规则相反，同样是刻意为之。
- `Dialog.beforeClose` 直到 3.8.9 才存在。旧版本上「未保存修改」的确认由插件自己拦截遮罩点击与 `Esc` 提供，移动端返回手势无法拦截。
- 内核没有 syncignore 的读写接口，全部走原始文件 API。
- 抽屉样式只在 3.8.10-alpha.5 及以上存在。插件用一次性样式表探测判断，探测不到就退回普通对话框（不画抓手、不绑定拖拽）。
- `npm` 上 `siyuan` 类型包落后于宿主实现：`containerClassName`、`beforeClose`、`Setting.close` 都缺。只在 `src/editorDialog.ts` 里做了一处窄类型扩展，没有扩散成全局断言。
- 语法检查只报「规则写法本身失效」的三类问题：反斜杠、只有 `!`、字符类未闭合。缺前导 `/`、重复行、行尾空白都不提示；规则是否命中文件由内核判定，插件不实现匹配引擎。
- `assets/preview.html` 是插件真实界面的 1:1 还原（DOM 与 `src/editorDialog.ts` 一致，样式取自思源 dialog/button 规则与本插件 SCSS）。改界面时要同步改它并重新渲染。

## 构建产物

`dist/` 与 `package.zip` 采用扁平布局：`plugin.json`、`index.js`、`index.css`、`icon.png`、`preview.png`、`i18n/en.json`、`i18n/zh-CN.json`、双语 README、`LICENSE`。产物不提交。
