// 编辑同步忽略文件的对话框：带行号的文本编辑器 + 折叠起来的编辑指导 + 轻量语法提示。
//
// 关闭与保存的约束：
// - 有未保存改动时，取消、点遮罩、按 Esc、拖动下拉都必须先确认；
// - 保存前重读文件比对，内核可能在我们编辑期间改写它（加载规则前会做外观隔离块清理）；
// - 保存后回读校验，确认落盘内容与编辑器一致。
import { Dialog, confirm, getFrontend, showMessage } from "siyuan";
import { bindMobileBottomSheet, hasHostBottomSheetStyles } from "./sheet";
import type { SheetHandle } from "./sheet";
import { lintSyncIgnore, readSyncIgnore, writeSyncIgnore } from "./syncignore";
import type { LintIssue, ReadResult } from "./syncignore";

const LINT_LIMIT = 5;
const LINT_DELAY = 150;

// 宿主随 npm 发布的类型声明落后于实际实现：containerClassName 自 3.1.11 起可用、
// beforeClose 自 3.8.9 起可用（更早的版本会忽略未知选项）。只在这里做窄类型扩展，
// 不扩散成全局类型断言。
type DialogOptions = ConstructorParameters<typeof Dialog>[0] & {
    containerClassName?: string;
    beforeClose?: () => boolean;
};

// 宿主把打开的对话框按顺序放在 window.siyuan.dialogs 里，Esc 关的是最后一个
type HostWindow = Window & { siyuan?: { dialogs?: { element: HTMLElement }[] } };

const LINT_KEYS: Record<LintIssue["kind"], string> = {
    emptyNegation: "lintEmptyNegation",
    invalidEscape: "lintInvalidEscape",
    unclosedClass: "lintUnclosedClass",
    unbalancedGroup: "lintUnbalancedGroup",
    badRepetition: "lintBadRepetition",
};

let openedDialog: Dialog | undefined;
let closeActiveEditor: (() => void) | undefined;
let opening = false;
// 插件卸载时自增，用来让正在读盘的打开流程作废
let generation = 0;

const isMobileFrontend = () => getFrontend().includes("mobile");

const isTopmostDialog = (element: HTMLElement) => {
    const dialogs = (window as HostWindow).siyuan?.dialogs;
    return !dialogs?.length || dialogs[dialogs.length - 1].element === element;
};

const format = (template: string, values: Record<string, string | number>) =>
    template.replace(/\{(\w+)\}/g, (_matched: string, key: string) => String(values[key] ?? ""));

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const askConfirm = (title: string, text: string) => new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
        if (settled) {
            return;
        }
        settled = true;
        resolve(value);
    };
    confirm(title, text, () => settle(true), () => settle(false));
});

const renderGutter = (lineCount: number) => {
    const rows: string[] = [];
    for (let index = 1; index <= lineCount; index++) {
        rows.push(`<div>${index}</div>`);
    }
    return rows.join("");
};

export interface OpenEditorOptions {
    i18n: Record<string, string>;
}

export const openSyncIgnoreEditor = async (options: OpenEditorOptions): Promise<void> => {
    const i18n = options.i18n;
    const t = (key: string) => i18n[key] ?? "";
    const describeIssue = (issue: LintIssue) => format(t(LINT_KEYS[issue.kind]), { line: issue.line });

    // 读取是异步的，用独立的标志位挡住连点造成的重复打开
    if (openedDialog || opening) {
        return;
    }
    opening = true;
    const current = generation;
    let read: ReadResult;
    try {
        read = await readSyncIgnore();
    } finally {
        // 读盘结束就放开标志，后面是同步创建对话框，不会重复打开
        opening = false;
    }
    // 读盘期间插件被卸载或重载
    if (current !== generation) {
        return;
    }
    if (!read.ok) {
        showMessage(format(t("readFailed"), { msg: read.message }), 6000, "error");
        return;
    }
    const initial = read.snapshot;
    const mobile = isMobileFrontend();
    let disposed = false;
    let allowed = false;
    let confirming = false;
    let lintTimer = 0;

    // 内核不剥 BOM，带 BOM 的文件第一条规则会失效；保存时统一不写回 BOM
    const notice = initial.bom ? `<div class="eds__notice">${escapeHtml(t("bomNotice"))}</div>` : "";
    const content = `<div class="b3-dialog__content eds">
    <details class="eds__guide">
        <summary>${escapeHtml(t("guideSummary"))}</summary>
        <ul class="eds__guide-list">
            <li>${escapeHtml(t("guideRule1"))}</li>
            <li>${escapeHtml(t("guideRule2"))}</li>
            <li>${escapeHtml(t("guideRule3"))}</li>
            <li>${escapeHtml(t("guideRule4"))}</li>
            <li>${escapeHtml(t("guideRule5"))}</li>
        </ul>
    </details>
    ${notice}
    <div class="eds__lint b3-label__text" hidden></div>
    <div class="eds__editor">
        <div class="eds__gutter" aria-hidden="true">${renderGutter(initial.text.split("\n").length)}</div>
        <textarea class="eds__textarea" wrap="off" spellcheck="false"
            placeholder="${escapeHtml(t("placeholder"))}"></textarea>
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${escapeHtml(t("cancel"))}</button>
    <div class="fn__space"></div>
    <button class="b3-button b3-button--text">${escapeHtml(t("save"))}</button>
</div>`;

    let disposeSheet: () => void = () => undefined;
    let sheetHandle: SheetHandle | undefined;

    const dialogOptions: DialogOptions = {
        title: t("dialogTitle"),
        content,
        width: mobile ? "100vw" : "720px",
        // 抽屉自己按可用视口算高度，旧版本没有抽屉样式时才用固定高度
        height: mobile && hasHostBottomSheetStyles() ? "auto" : "60vh",
        containerClassName: "eds-dialog",
        // 关闭入口统一由插件自己提供，桌面端本来就不显示这个图标
        hideCloseIcon: true,
        beforeClose: () => {
            if (allowed || !isDirty()) {
                allowed = true;
                sheetHandle?.freeze();
                return true;
            }
            void requestClose();
            return false;
        },
        destroyCallback: () => {
            disposed = true;
            window.clearTimeout(lintTimer);
            document.removeEventListener("keydown", onKeydown, true);
            dialog.element.removeEventListener("click", onScrimClick, true);
            disposeSheet();
        },
    };
    const dialog = new Dialog(dialogOptions as ConstructorParameters<typeof Dialog>[0]);

    const textarea = dialog.element.querySelector<HTMLTextAreaElement>(".eds__textarea") as HTMLTextAreaElement;
    const gutter = dialog.element.querySelector<HTMLElement>(".eds__gutter") as HTMLElement;
    const lintBox = dialog.element.querySelector<HTMLElement>(".eds__lint") as HTMLElement;
    const cancelButton = dialog.element.querySelector<HTMLButtonElement>(".b3-button--cancel") as HTMLButtonElement;
    const saveButton = dialog.element.querySelector<HTMLButtonElement>(".b3-button--text") as HTMLButtonElement;
    textarea.value = initial.text;

    const isDirty = () => textarea.value !== initial.text;

    // 关闭时先放开模块级引用，销毁动画期间的点击不会被过期的对话框挡住
    const disposeDialog = () => {
        openedDialog = undefined;
        closeActiveEditor = undefined;
        dialog.destroy();
    };

    const renderLint = () => {
        const issues = disposed ? [] : lintSyncIgnore(textarea.value);
        if (!issues.length) {
            lintBox.hidden = true;
            lintBox.textContent = "";
        } else {
            const lines = issues.slice(0, LINT_LIMIT).map(describeIssue);
            if (issues.length > LINT_LIMIT) {
                lines.push(format(t("lintMore"), { count: issues.length - LINT_LIMIT }));
            }
            lintBox.hidden = false;
            lintBox.innerHTML = lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("");
        }
        // 提示行的出现或消失改变了内容高度，让抽屉重新量一次
        sheetHandle?.relayout();
    };

    const syncScroll = () => {
        gutter.scrollTop = textarea.scrollTop;
    };

    const onInput = () => {
        const lineCount = textarea.value.split("\n").length;
        if (gutter.childElementCount !== lineCount) {
            gutter.innerHTML = renderGutter(lineCount);
            syncScroll();
        }
        window.clearTimeout(lintTimer);
        lintTimer = window.setTimeout(renderLint, LINT_DELAY);
    };

    const requestClose = async (): Promise<boolean> => {
        if (disposed) {
            return false;
        }
        if (allowed || !isDirty()) {
            allowed = true;
            sheetHandle?.freeze();
            disposeDialog();
            return true;
        }
        if (confirming) {
            return false;
        }
        confirming = true;
        const discard = await askConfirm(t("discardTitle"), t("discardText"));
        confirming = false;
        if (!discard || disposed) {
            return false;
        }
        allowed = true;
        sheetHandle?.freeze();
        disposeDialog();
        return true;
    };

    const onScrimClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        if (!target || !target.closest(".b3-dialog__scrim")) {
            return;
        }
        // 宿主的遮罩监听挂在遮罩元素上，这里在捕获阶段先接管
        event.preventDefault();
        event.stopPropagation();
        void requestClose();
    };

    const onKeydown = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) {
            return;
        }
        // 宿主的 Esc 会直接 destroy 最上层对话框，绕过未保存确认；这里改成走自己的关闭流程。
        // 上方还有别的对话框（比如宿主的确认框）时交给宿主处理。
        if (confirming || !isTopmostDialog(dialog.element)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        void requestClose();
    };

    const save = async () => {
        if (disposed) {
            return;
        }
        saveButton.disabled = true;
        // 保存期间锁住编辑，避免落盘内容与界面上看到的文本不一致
        textarea.readOnly = true;
        try {
            const text = textarea.value;
            const current = await readSyncIgnore();
            if (!current.ok) {
                showMessage(format(t("readFailed"), { msg: current.message }), 6000, "error");
                return;
            }
            if (current.snapshot.text !== initial.text) {
                const overwrite = await askConfirm(t("conflictTitle"), t("conflictText"));
                if (!overwrite || disposed) {
                    return;
                }
            }
            const written = await writeSyncIgnore(text);
            if (!written.ok) {
                showMessage(format(t("saveFailed"), { msg: written.message }), 6000, "error");
                return;
            }
            const verify = await readSyncIgnore();
            if (!verify.ok || verify.snapshot.text !== text) {
                showMessage(t("saveUnverified"), 6000, "error");
                return;
            }
            if (disposed) {
                return;
            }
            showMessage(t("saved"), 2000);
            allowed = true;
            disposeDialog();
        } finally {
            if (!disposed) {
                saveButton.disabled = false;
                textarea.readOnly = false;
            }
        }
    };

    cancelButton.addEventListener("click", () => {
        void requestClose();
    });
    saveButton.addEventListener("click", () => {
        void save();
    });
    textarea.addEventListener("input", onInput);
    textarea.addEventListener("scroll", syncScroll);
    document.addEventListener("keydown", onKeydown, true);
    dialog.element.addEventListener("click", onScrimClick, true);

    if (mobile && hasHostBottomSheetStyles()) {
        sheetHandle = bindMobileBottomSheet({ dialog, close: requestClose });
        disposeSheet = sheetHandle.dispose;
    }

    openedDialog = dialog;
    // 插件被禁用或重载时直接关闭，不再走“是否放弃修改”的确认
    closeActiveEditor = () => {
        allowed = true;
        sheetHandle?.freeze();
        disposeDialog();
    };
    renderLint();
};

/** 插件卸载时调用：关闭可能还开着的编辑器，避免监听器残留。 */
export const closeSyncIgnoreEditor = () => {
    // 让正在读盘的打开流程作废，避免卸载后弹出孤儿对话框
    generation += 1;
    closeActiveEditor?.();
};
