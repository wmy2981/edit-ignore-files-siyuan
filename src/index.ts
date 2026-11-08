import { Plugin, Setting } from "siyuan";
import "./index.scss";
import { closeSyncIgnoreEditor, openSyncIgnoreEditor } from "./editorDialog";

export default class EditSyncIgnore extends Plugin {
    declare i18n: Record<string, string>;

    async onload() {
        // 宿主通过 plugin.setting 提供设置入口，并在卸载时自行关闭它
        this.setting = new Setting({});
        this.setting.addItem({
            title: this.i18n.settingTitle,
            description: this.i18n.settingDescription,
            createActionElement: () => {
                const button = document.createElement("button");
                button.className = "b3-button b3-button--outline";
                button.textContent = this.i18n.openButton;
                button.addEventListener("click", () => {
                    void openSyncIgnoreEditor({ i18n: this.i18n });
                });
                return button;
            },
        });
    }

    onunload() {
        // 编辑器对话框由插件持有，禁用或重载插件时一并关闭，避免监听器残留
        closeSyncIgnoreEditor();
    }
}
