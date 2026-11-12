import { Plugin, Setting } from "siyuan";
import "./index.scss";
import { createEditorPanel } from "./editorPanel";
import type { EditorPanel } from "./editorPanel";

// 宿主的 npm 类型包落后于实现：Setting 的 dialog / close / openInWindow 都还没有，
// 这里只做窄类型补充，不扩散成全局断言。
type SettingOptions = NonNullable<ConstructorParameters<typeof Setting>[0]> & {
    /** 桌面端用独立原生窗口打开插件设置（思源 3.8.7+；更早的宿主忽略这个选项） */
    openInWindow?: boolean;
};
type HostSetting = Setting & {
    dialog?: { element: HTMLElement };
    close: () => void;
};

export default class EditIgnoreFiles extends Plugin {
    declare i18n: Record<string, string>;
    // 基类的 setting 是 Setting（宿主靠它判断有没有设置入口），这里并存一份补过类型的引用
    private settings?: HostSetting;
    private panel?: EditorPanel;

    async onload() {
        // 设置面板与底部「取消 / 保存」都由宿主 Settings API 渲染：这里只注册条目，
        // 控件、保存回调与销毁回调交出去，不自己建对话框。
        const setting = new Setting({
            // 控件必须自己创建：要在每次打开时重新读盘、恢复草稿
            openInWindow: true,
            confirmCallback: () => this.panel?.save(),
            destroyCallback: () => {
                this.panel?.dispose();
                this.panel = undefined;
            },
        } as SettingOptions as ConstructorParameters<typeof Setting>[0]) as HostSetting;
        setting.addItem({
            title: this.i18n.itemTitle,
            direction: "row",
            createActionElement: () => {
                // 上一次面板已被宿主销毁时兜底释放，避免定时器叠加
                this.panel?.dispose();
                this.panel = createEditorPanel({ i18n: this.i18n });
                return this.panel.element;
            },
        });
        this.setting = setting;
        this.settings = setting;
    }

    /**
     * 打开设置。内容全部交给官方 Setting API（setting.open 就是宿主默认实现做的事），
     * 之所以保留这个覆写，是为了兼容把「是否覆写 openSetting」当作设置入口判定的旧版本宿主；
     * 新版本宿主也认 plugin.setting，两条路都通。
     */
    override openSetting() {
        if (!this.settings) {
            return;
        }
        this.settings.open(this.displayName || this.name);
    }

    onunload() {
        // 设置面板由宿主持有，禁用或重载插件时一起关掉，避免控件留在独立窗口里
        this.panel?.dispose();
        this.panel = undefined;
        this.settings?.close();
        this.settings = undefined;
    }
}
