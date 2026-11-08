import { Plugin } from "siyuan";
import "./index.scss";
import { closeIgnoreEditor, openIgnoreEditor } from "./editorDialog";

export default class EditIgnoreFiles extends Plugin {
    declare i18n: Record<string, string>;
    private unloaded = false;

    /**
     * 覆写宿主的设置入口：点击插件列表里的「设置」直接打开编辑器，
     * 不再渲染只有一枚按钮的设置面板。宿主以「是否覆写 openSetting」判断有没有设置项，
     * 因此这里必须是原型方法而不是实例属性。
     */
    openSetting() {
        // 插件被禁用后宿主的旧引用仍可能调用进来
        if (this.unloaded) {
            return;
        }
        void openIgnoreEditor({ i18n: this.i18n });
    }

    onunload() {
        // 编辑器由插件持有，禁用或重载插件时一并关闭，避免监听器残留
        this.unloaded = true;
        closeIgnoreEditor();
    }
}
