// 编辑忽略文件的对话框：文件切换 + 带行号的文本编辑器 + 按语法折叠的编辑说明 + 轻量语法提示。
//
// 关闭与保存的约束：
// - 有未保存改动时，切换文件、取消、点遮罩、按 Esc、拖动下拉都必须先确认；
// - 保存前重读文件比对，内核可能在我们编辑期间改写它（加载规则前会做外观隔离块清理）；
// - 保存后回读校验，确认落盘内容与编辑器一致。
import { Dialog, getFrontend, showMessage } from "siyuan";
import { DEFAULT_IGNORE_FILE, IGNORE_FILES, getIgnoreSyntax, isIgnoreFileName } from "./ignoreFiles";
import type { IgnoreFileName } from "./ignoreFiles";
import { readIgnoreFile, writeIgnoreFile } from "./ignoreFile";
import type { ReadResult } from "./ignoreFile";
import { LINT_KEYS, lintIgnore } from "./lint";
import type { LintIssue } from "./lint";
import { decideFileSwitch } from "./fileSwitch";
import { bindMobileBottomSheet, hasHostBottomSheetStyles } from "./sheet";
import type { SheetHandle } from "./sheet";

const LINT_DELAY = 150;
const GUIDE_ITEM_COUNT = 4;
/** 上次编辑的文件，下次打开直接回到它 */
const ACTIVE_STORAGE_KEY = "edit-ignore-files/active";

// 宿主随 npm 发布的类型声明落后于实际实现：containerClassName 自 3.1.11 起可用、
// beforeClose 自 3.8.9 起可用（更早的版本会忽略未知选项）。只在这里做窄类型扩展，
// 不扩散成全局类型断言。
type DialogOptions = ConstructorParameters<typeof Dialog>[0] & {
    containerClassName?: string;
    beforeClose?: () => boolean;
};

// 宿主把打开的对话框按顺序放在 window.siyuan.dialogs 里，Esc 关的是最后一个
type HostWindow = Window & { siyuan?: { dialogs?: { element: HTMLElement }[] } };

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

/** syncignore → descSyncignore / guideSyncignore1 */
const fileKey = (name: IgnoreFileName, prefix: string, suffix = "") =>
    `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}${suffix}`;

const recallActive = (): IgnoreFileName => {
    try {
        const stored = window.localStorage.getItem(ACTIVE_STORAGE_KEY);
        return isIgnoreFileName(stored) ? stored : DEFAULT_IGNORE_FILE;
    } catch {
        return DEFAULT_IGNORE_FILE;
    }
};

const rememberActive = (name: IgnoreFileName) => {
    try {
        window.localStorage.setItem(ACTIVE_STORAGE_KEY, name);
    } catch {
        // 隐私模式等拿不到 localStorage 时忽略，不影响编辑
    }
};

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

export const openIgnoreEditor = async (options: OpenEditorOptions): Promise<void> => {
    const i18n = options.i18n;
    const t = (key: string) => i18n[key] ?? "";
    const describeIssue = (issue: LintIssue) => format(t(LINT_KEYS[issue.kind]), { line: issue.line });

    // 读取是异步的，用独立的标志位挡住连点造成的重复打开
    if (openedDialog || opening) {
        return;
    }
    opening = true;
    const current = generation;
    const initialName = recallActive();
    let read: ReadResult;
    try {
        read = await readIgnoreFile(initialName);
    } catch (error) {
        showMessage(format(t("readFailed"), { msg: String(error) }), 6000, "error");
        return;
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
    const mobile = isMobileFrontend();
    // disposed 表示 DOM 已拆，closed 表示已经决定关闭（含销毁动画期间）
    let disposed = false;
    let closed = false;
    let allowed = false;
    let confirming = false;
    let saving = false;
    let switching = false;
    // 正在读取目标文件：文本框只读，避免读取结果覆盖刚输入的内容
    let loading = false;
    // 自建确认框，插件卸载或对话框被宿主关闭时要一起收掉
    let confirmDialog: Dialog | undefined;
    let lintTimer = 0;
    let loadToken = 0;

    let active = initialName;
    // 当前文件最后一次读入的正文，用作「是否有改动」和「保存前是否被别人改过」的基准
    let baseline = read.snapshot.text;
    let bom = read.snapshot.bom;

    const content = `<div class="b3-dialog__content eds">
    <select class="b3-select eds__files" aria-label="${escapeHtml(t("dialogTitle"))}"></select>
    <div class="eds__desc b3-label__text"></div>
    <details class="eds__guide">
        <summary></summary>
        <ul class="eds__guide-list"></ul>
    </details>
    <div class="eds__notice" hidden></div>
    <div class="eds__lint b3-label__text" hidden></div>
    <div class="eds__editor">
        <div class="eds__gutter" aria-hidden="true">${renderGutter(baseline.split("\n").length)}</div>
        <textarea class="eds__textarea" wrap="off" spellcheck="false"></textarea>
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
            if (allowed) {
                sheetHandle?.freeze();
                return true;
            }
            if (!saving && !isDirty()) {
                allowed = true;
                sheetHandle?.freeze();
                return true;
            }
            void requestClose();
            return false;
        },
        destroyCallback: () => {
            disposed = true;
            closed = true;
            confirmDialog?.destroy();
            // 宿主发起的关闭（移动端返回手势、旧版本上的宿主 Esc）不经过 disposeDialog，
            // 这里必须自己放开模块级引用，否则编辑器再也打不开
            if (openedDialog === dialog) {
                openedDialog = undefined;
                closeActiveEditor = undefined;
            }
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
    const notice = dialog.element.querySelector<HTMLElement>(".eds__notice") as HTMLElement;
    const descBox = dialog.element.querySelector<HTMLElement>(".eds__desc") as HTMLElement;
    const filesBox = dialog.element.querySelector<HTMLSelectElement>(".eds__files") as HTMLSelectElement;
    const guideSummary = dialog.element.querySelector<HTMLElement>(".eds__guide > summary") as HTMLElement;
    const guideList = dialog.element.querySelector<HTMLElement>(".eds__guide-list") as HTMLElement;
    const cancelButton = dialog.element.querySelector<HTMLButtonElement>(".b3-button--cancel") as HTMLButtonElement;
    const saveButton = dialog.element.querySelector<HTMLButtonElement>(".b3-button--text") as HTMLButtonElement;
    textarea.value = baseline;

    // 读取期间文本框只读，且旧内容已经确认放弃，不参与关闭判断
    const isDirty = () => !loading && textarea.value !== baseline;

    // 读取与保存期间锁住编辑和保存，避免落盘内容或读取结果与界面上看到的不一致
    const updateControls = () => {
        const locked = saving || loading;
        textarea.readOnly = locked;
        saveButton.disabled = locked;
    };

    // 关闭时先放开模块级引用，销毁动画期间的点击不会被过期的对话框挡住
    const disposeDialog = () => {
        closed = true;
        openedDialog = undefined;
        closeActiveEditor = undefined;
        dialog.destroy();
    };

    const renderFiles = () => {
        filesBox.innerHTML = IGNORE_FILES.map(({ name }) => `<option value="${name}">${name}</option>`).join("");
        filesBox.value = active;
    };

    // 说明与指导都按当前文件的语法来，切换文件时整块替换
    const renderGuide = () => {
        descBox.textContent = t(fileKey(active, "desc"));
        guideSummary.textContent = t("guideSummary");
        const items: string[] = [];
        for (let index = 1; index <= GUIDE_ITEM_COUNT; index++) {
            const text = t(fileKey(active, "guide", String(index)));
            if (text) {
                items.push(`<li>${escapeHtml(text)}</li>`);
            }
        }
        guideList.innerHTML = items.join("");
        textarea.placeholder = t(getIgnoreSyntax(active) === "sql" ? "placeholderSql" : "placeholderGitignore");
    };

    const renderNotice = () => {
        notice.hidden = !bom;
        notice.textContent = bom ? t("bomNotice") : "";
    };

    const renderLint = () => {
        const issues = disposed ? [] : lintIgnore(getIgnoreSyntax(active), textarea.value);
        if (!issues.length) {
            lintBox.hidden = true;
            lintBox.textContent = "";
        } else {
            // 全部列出来，由提示区自己滚动，不再截断成「还有 N 处」
            lintBox.hidden = false;
            lintBox.innerHTML = issues.map((issue) => `<div>${escapeHtml(describeIssue(issue))}</div>`).join("");
        }
        // 提示行的出现或消失改变了内容高度，让抽屉重新量一次
        sheetHandle?.relayout();
    };

    const refresh = () => {
        renderFiles();
        renderGuide();
        renderNotice();
        renderLint();
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

    // 宿主 confirm 的按钮文案和样式都改不了；放弃修改要用红框按钮，所以自己建确认框
    const askConfirm = (options: { title: string; text: string; confirmText: string; danger?: boolean }) =>
        new Promise<boolean>((resolve) => {
            let settled = false;
            let removeKeydown: () => void = () => undefined;
            const settle = (value: boolean) => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve(value);
            };
            const dialog = new Dialog({
                title: options.title,
                content: `<div class="b3-dialog__content">
    <div class="ft__breakword">${escapeHtml(options.text)}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${escapeHtml(t("cancel"))}</button>
    <div class="fn__space"></div>
    <button class="b3-button ${options.danger ? "b3-button--remove" : "b3-button--text"}">${escapeHtml(options.confirmText)}</button>
</div>`,
                width: mobile ? "92vw" : "520px",
                containerClassName: "eds-confirm",
                destroyCallback: () => {
                    removeKeydown();
                    if (confirmDialog === dialog) {
                        confirmDialog = undefined;
                    }
                    settle(false);
                },
            } as DialogOptions as ConstructorParameters<typeof Dialog>[0]);
            const buttons = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-dialog__action .b3-button");
            buttons[0].addEventListener("click", () => {
                settle(false);
                dialog.destroy();
            });
            buttons[1].addEventListener("click", () => {
                settle(true);
                dialog.destroy();
            });
            // 宿主只给内置确认框处理 Esc，自建的这个要自己收口；上方还有别的对话框时交给宿主
            const onKeydown = (event: KeyboardEvent) => {
                if (event.key !== "Escape" || event.isComposing || event.keyCode === 229 ||
                    !isTopmostDialog(dialog.element)) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                settle(false);
                dialog.destroy();
            };
            document.addEventListener("keydown", onKeydown, true);
            removeKeydown = () => document.removeEventListener("keydown", onKeydown, true);
            confirmDialog = dialog;
            // 焦点放在容器上，避免按钮一出现就带上 :focus 的底色；旧版宿主不会自己聚焦
            (dialog.element.querySelector(".b3-dialog__container") as HTMLElement).focus({ preventScroll: true });
        });

    const load = async (name: IgnoreFileName) => {
        // 连点两个文件时只认最后一次，避免先发后到的读盘结果覆盖界面
        const token = ++loadToken;
        loading = true;
        updateControls();
        const next = await readIgnoreFile(name);
        if (closed || token !== loadToken) {
            return;
        }
        loading = false;
        updateControls();
        if (!next.ok) {
            showMessage(format(t("readFailed"), { msg: next.message }), 6000, "error");
            // 读失败时保持原文件，下拉框也跟着回退
            renderFiles();
            return;
        }
        active = name;
        baseline = next.snapshot.text;
        bom = next.snapshot.bom;
        textarea.value = baseline;
        gutter.innerHTML = renderGutter(baseline.split("\n").length);
        syncScroll();
        refresh();
        rememberActive(name);
    };

    const switchTo = async (name: IgnoreFileName) => {
        // 下拉框已经被用户改过，任何一次中止都要把它选回当前文件
        const restore = () => {
            filesBox.value = active;
        };
        const action = decideFileSwitch(name, {
            active,
            loading,
            dirty: isDirty(),
            blocked: closed || saving || switching,
        });
        if (action === "restore") {
            restore();
            return;
        }
        if (action === "cancel") {
            // 选回当前文件等于取消还没完成的读取，旧结果由 token 丢弃
            loadToken += 1;
            loading = false;
            updateControls();
            restore();
            return;
        }
        if (action === "confirm") {
            switching = true;
            const discard = await askConfirm({
                title: t("discardTitle"),
                text: t("switchText"),
                confirmText: t("discard"),
                danger: true,
            });
            switching = false;
            if (!discard || closed) {
                restore();
                return;
            }
        }
        await load(name);
    };

    const requestClose = async (): Promise<boolean> => {
        // 保存期间不接受关闭：写入已经开始，关上界面只会让落盘内容与用户看到的不一致
        if (closed || saving) {
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
        const discard = await askConfirm({
            title: t("discardTitle"),
            text: t("discardText"),
            confirmText: t("discard"),
            danger: true,
        });
        confirming = false;
        if (!discard || closed) {
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
        // 上方还有别的对话框（比如放弃修改的确认框）时交给它自己处理。
        if (confirming || !isTopmostDialog(dialog.element)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        void requestClose();
    };

    const save = async () => {
        if (closed || saving || loading) {
            return;
        }
        saving = true;
        // 保存期间锁住编辑，避免落盘内容与界面上看到的文本不一致
        updateControls();
        try {
            const text = textarea.value;
            const target = active;
            const current = await readIgnoreFile(target);
            // 每个 await 之后都要重新确认对话框还在，否则会往已经关闭的会话里写文件
            if (closed) {
                return;
            }
            if (!current.ok) {
                showMessage(format(t("readFailed"), { msg: current.message }), 6000, "error");
                return;
            }
            if (current.snapshot.text !== baseline) {
                const overwrite = await askConfirm({
                    title: t("conflictTitle"),
                    text: t("conflictText"),
                    confirmText: t("confirm"),
                });
                if (!overwrite || closed) {
                    return;
                }
            }
            const written = await writeIgnoreFile(target, text);
            if (closed) {
                return;
            }
            if (!written.ok) {
                showMessage(format(t("saveFailed"), { msg: written.message }), 6000, "error");
                return;
            }
            const verify = await readIgnoreFile(target);
            if (closed) {
                return;
            }
            if (!verify.ok || verify.snapshot.text !== text) {
                showMessage(t("saveUnverified"), 6000, "error");
                return;
            }
            showMessage(t("saved"), 2000);
            allowed = true;
            disposeDialog();
        } finally {
            saving = false;
            if (!disposed) {
                updateControls();
            }
        }
    };

    filesBox.addEventListener("change", () => {
        if (!isIgnoreFileName(filesBox.value)) {
            return;
        }
        void switchTo(filesBox.value);
    });
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
        confirmDialog?.destroy();
        disposeDialog();
    };
    rememberActive(active);
    refresh();
};

/** 插件卸载时调用：关闭可能还开着的编辑器，避免监听器残留。 */
export const closeIgnoreEditor = () => {
    // 让正在读盘的打开流程作废，避免卸载后弹出孤儿对话框
    generation += 1;
    closeActiveEditor?.();
};
