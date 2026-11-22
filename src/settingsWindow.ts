// 原生设置窗口（Setting 的 openInWindow）只在桌面端 Electron 里真正可用。
//
// 宿主的 openInWindow 分支靠 Electron 的 ipcRenderer 另开一个原生窗口，而这段实现整段写在
// 浏览器包的条件编译里（BROWSER 构建根本不生成它），所以在浏览器包里 open() 走进去什么也不做。
// 平板在移动端「桌面模式」下加载的正是桌面浏览器包：它的 UA 仍以 SiYuan/ 开头，宿主的
// getFrontend() 因此报 desktop，openInWindow 分支被选中，于是设置面板静默打不开。
//
// 桌面 UA 里带 Electron（宿主内核也按这一点识别桌面客户端），移动端与浏览器都没有。
// 拿不到 navigator 的环境按「不支持」处理，退回宿主的对话框。
export const canOpenSettingsWindow = (userAgent: string): boolean => userAgent.includes("Electron");
