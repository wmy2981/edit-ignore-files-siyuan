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

- `src/index.ts` — 插件入口。只做一件事：把 `new Setting()` 挂到宿主的 `plugin.setting` 上，注册唯一一个设置项（按钮），点击打开编辑器；`onunload` 关闭可能还开着的编辑器。
- `src/syncignore.ts` — 文件读写与轻量校验。读 `POST /api/file/getFile`（裸文本，失败是 HTTP 202 + JSON），写 `POST /api/file/putFile`（multipart）。**必须用裸 `fetch`**：`siyuan.fetchSyncPost` 会把响应当 JSON 解析，读文本文件时必然抛错。
- `src/editorDialog.ts` — 对话框本体：行号槽、折叠指导、校验提示、保存/关闭守卫。保存流程是「重读比对 → 冲突确认 → 写入 → 回读校验」。
- `src/sheet.ts` — 移动端底部抽屉。复用宿主已定义的抽屉样式类拿到原生外观与入场/退场过渡，抓手与拖拽手势自行实现（宿主 `bindBottomSheetDrag` 未导出，规则也禁止复制）。
- `src/index.scss` — 全部样式，颜色/圆角/间距只用 `--b3-*` 变量。类名 `.eds*` 与 `.eds-dialog` 都是本插件私有。

## manifest 约束

- `name` 与仓库名、安装目录名一致：`edit-syncignore-siyuan`。
- `minAppVersion` 为 `3.1.20`：`Dialog.containerClassName` 自 3.1.11 起提供，其余用到的 API 更早就有。
- 不发布内核插件，因此没有 `kernels` 字段。
- `disabledInPublish` 为 `true`。

## 已知限制

- `Dialog.beforeClose` 直到 3.8.9 才存在。旧版本上「未保存修改」的确认由插件自己拦截遮罩点击与 `Esc` 提供，移动端返回手势无法拦截。
- `data/.siyuan/syncignore` 的路径在 3.0.0 之后稳定，但插件没有任何内核专用接口可用，全部走原始文件 API；内核没有 syncignore 的读写 API。
- 移动端抽屉样式只在 3.8.10-alpha.5 及以上存在。插件用一次性样式表探测判断，探测不到就退回普通对话框（并因此不画抓手、不绑定拖拽）。
- `npm` 上 `siyuan` 类型包落后于宿主实现：`containerClassName`、`beforeClose`、`Setting.close` 都缺。只在 `src/editorDialog.ts` 里做了一处窄类型扩展，没有扩散成全局断言。
- `assets/preview.html` 是插件真实界面的 1:1 还原（DOM 与 `src/editorDialog.ts` 一致，样式取自思源 dialog/button 规则与本插件 SCSS）。改界面时要同步改它并重新渲染。

## 构建产物

`dist/` 与 `package.zip` 采用扁平布局：`plugin.json`、`index.js`、`index.css`、`icon.png`、`preview.png`、`i18n/en.json`、`i18n/zh-CN.json`、双语 README、`LICENSE`。产物不提交。
