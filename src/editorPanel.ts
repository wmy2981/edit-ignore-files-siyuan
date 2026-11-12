// 设置面板里的忽略文件编辑器。
//
// 面板由宿主 Setting 承载：控件通过 createActionElement 交进去，保存/取消用宿主自带的按钮，
// 所以这里没有自己的对话框、抽屉和确认框。宿主没有给插件拦截关闭的入口，未保存内容改由
// 草稿兜底（见 draft.ts）：输入后防抖写草稿，关掉面板不会丢改动。
//
// 几条实现约束：
// - 控件会被宿主迁进独立设置窗口（Electron 桌面端的 openInWindow），所以只用元素引用与
//   element.ownerDocument，不碰 document / window 级查询和监听，也不自己弹对话框；
// - 保存失败时抛错：宿主会因此保留面板并给出提示，具体原因写进状态行；
// - 保存前重读磁盘比对，编辑期间文件被改过就先不写，状态行提示「再点保存将覆盖」。
import { availableIgnoreFiles, getIgnoreDefinition, getIgnoreSyntax } from "./ignoreFiles";
import type { IgnoreFileDefinition, IgnoreFileName } from "./ignoreFiles";
import { ACTIVE_STORAGE_KEY, draftKey, parseDraft, pickInitialContent, serializeDraft } from "./draft";
import type { Draft } from "./draft";
import { readIgnoreFile, writeIgnoreFile } from "./ignoreFile";
import { readKernelVersion } from "./kernelVersion";
import { decideFileSwitch } from "./fileSwitch";
import { LINT_KEYS, lintIgnore } from "./lint";
import type { LintIssue } from "./lint";
import { STATUS_TONES, statusDescribe } from "./status";
import type { EditorStatus } from "./status";

const LINT_DELAY = 150;
/** 输入停止后多久写草稿 */
const DRAFT_DELAY = 400;
/** 二次确认的等待时间，超时自动收回 */
const CONFIRM_TIMEOUT = 5000;
const GUIDE_ITEM_COUNT = 4;

export interface EditorPanel {
    /** 交给宿主 Setting item 的控件元素 */
    element: HTMLElement;
    /**
     * 保存当前文件。失败时抛出错误：宿主会保留面板并提示，具体原因同时显示在状态行。
     */
    save: () => Promise<void>;
    /** 面板关闭或插件卸载时调用，落掉最后一份草稿并释放定时器 */
    dispose: () => void;
}

export interface EditorPanelOptions {
    i18n: Record<string, string>;
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const format = (template: string, values: Record<string, string | number>) =>
    template.replace(/\{(\w+)\}/g, (_matched: string, key: string) => String(values[key] ?? ""));

export const createEditorPanel = (options: EditorPanelOptions): EditorPanel => {
    const i18n = options.i18n;
    const t = (key: string) => i18n[key] ?? "";
    // 版本门槛：旧内核不认识资源清理规则，列表里就不出现
    const files: readonly IgnoreFileDefinition[] = availableIgnoreFiles(readKernelVersion());

    const element = document.createElement("div");
    element.className = "eds";
    element.innerHTML = `<select class="b3-select eds__files" aria-label="${escapeHtml(t("itemTitle"))}"></select>
<div class="eds__desc b3-label__text"></div>
<details class="eds__guide">
    <summary></summary>
    <ul class="eds__guide-list"></ul>
</details>
<div class="eds__bar">
    <div class="eds__status" role="status" aria-live="polite"></div>
    <button class="b3-button b3-button--outline eds__reload" type="button"></button>
</div>
<div class="eds__notice" hidden></div>
<div class="eds__lint b3-label__text" aria-live="polite" hidden></div>
<div class="eds__editor">
    <div class="eds__gutter" aria-hidden="true"></div>
    <textarea class="eds__textarea" wrap="off" spellcheck="false"></textarea>
</div>`;

    const filesBox = element.querySelector<HTMLSelectElement>(".eds__files") as HTMLSelectElement;
    const descBox = element.querySelector<HTMLElement>(".eds__desc") as HTMLElement;
    const guideSummary = element.querySelector<HTMLElement>(".eds__guide > summary") as HTMLElement;
    const guideList = element.querySelector<HTMLElement>(".eds__guide-list") as HTMLElement;
    const statusBox = element.querySelector<HTMLElement>(".eds__status") as HTMLElement;
    const reloadButton = element.querySelector<HTMLButtonElement>(".eds__reload") as HTMLButtonElement;
    const notice = element.querySelector<HTMLElement>(".eds__notice") as HTMLElement;
    const lintBox = element.querySelector<HTMLElement>(".eds__lint") as HTMLElement;
    const gutter = element.querySelector<HTMLElement>(".eds__gutter") as HTMLElement;
    const textarea = element.querySelector<HTMLTextAreaElement>(".eds__textarea") as HTMLTextAreaElement;

    // 控件会被迁进独立设置窗口，存储一律取控件当前所属文档的；
    // 窗口正在关闭时 defaultView 可能已经为空，所以再退回创建时那份存储（同一来源，内容相同）
    const createdStorage = (() => {
        try {
            return element.ownerDocument.defaultView?.localStorage ?? undefined;
        } catch {
            return undefined;
        }
    })();
    const storage = (): Storage | undefined => {
        try {
            return element.ownerDocument.defaultView?.localStorage ?? createdStorage;
        } catch {
            // 隐私模式等拿不到 localStorage：草稿降级为不保存，编辑与保存照常
            return createdStorage;
        }
    };
    const readDraft = (name: IgnoreFileName): Draft | undefined => {
        try {
            return parseDraft(storage()?.getItem(draftKey(name)));
        } catch {
            return undefined;
        }
    };
    const saveDraft = (name: IgnoreFileName, text: string, base: string) => {
        try {
            storage()?.setItem(draftKey(name), serializeDraft(text, base, Date.now()));
        } catch {
            // 配额满或存储被禁用：不影响编辑，只是少了兜底
        }
    };
    const dropDraft = (name: IgnoreFileName) => {
        try {
            storage()?.removeItem(draftKey(name));
        } catch {
            // 同上
        }
    };
    const recallActive = (): IgnoreFileName => {
        try {
            const stored = storage()?.getItem(ACTIVE_STORAGE_KEY);
            return files.find(file => file.name === stored)?.name ?? files[0].name;
        } catch {
            return files[0].name;
        }
    };
    const rememberActive = (name: IgnoreFileName) => {
        try {
            storage()?.setItem(ACTIVE_STORAGE_KEY, name);
        } catch {
            // 记住上次文件只是顺手，失败可以忽略
        }
    };

    const describeIssue = (issue: LintIssue) => format(t(LINT_KEYS[issue.kind]), { line: issue.line });
    const renderGutter = (lineCount: number) => {
        const rows: string[] = [];
        for (let index = 1; index <= lineCount; index++) {
            rows.push(`<div>${index}</div>`);
        }
        return rows.join("");
    };

    /** syncignore → descSyncignore / guideSyncignore1；资源清理那一项的文件名带连字符，文案键另用 i18nKey */
    const fileKey = (name: IgnoreFileName, prefix: string, suffix = "") => {
        const key = getIgnoreDefinition(name)?.i18nKey ?? name;
        return `${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}${suffix}`;
    };

    let active: IgnoreFileName = recallActive();
    /** 当前文件最后一次确认过的磁盘正文：用来判断编辑期间文件是否被外部改动 */
    let baseline = "";
    let bom = false;
    let disposed = false;
    /** 读取或保存进行中：控件锁住，避免界面与磁盘内容错位 */
    let busy = false;
    /** 已经被提示过「文件被外部改动」，下一次保存直接覆盖 */
    let overwriteArmed = false;
    let lintTimer = 0;
    let draftTimer = 0;
    let confirmTimer = 0;
    let reloadArmed = false;
    let loadToken = 0;

    const syncScroll = () => {
        gutter.scrollTop = textarea.scrollTop;
    };

    const setStatus = (status: EditorStatus) => {
        const tone = STATUS_TONES[status.kind];
        statusBox.className = `eds__status eds__status--${tone}`;
        statusBox.textContent = statusDescribe(status, t);
    };

    const renderStatus = (status: EditorStatus): never => {
        setStatus(status);
        // 抛错让宿主的保存流程留在面板里，用户能看到状态行给的下一步
        throw new Error(`edit-ignore-files: ${status.kind}`);
    };

    const updateControls = () => {
        textarea.readOnly = busy;
        filesBox.disabled = busy;
        reloadButton.disabled = busy;
    };

    const renderFiles = () => {
        filesBox.innerHTML = files.map(({ name }) => `<option value="${name}">${name}</option>`).join("");
        filesBox.value = active;
    };

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
        // 资源清理规则的内核会先剥掉 BOM 再编译，带 BOM 不会让第一行失效，不用提示
        const warnBom = bom && getIgnoreDefinition(active)?.strict !== true;
        notice.hidden = !warnBom;
        notice.textContent = warnBom ? t("bomNotice") : "";
    };

    const renderLint = () => {
        const issues = disposed ? [] : lintIgnore(active, textarea.value);
        if (!issues.length) {
            lintBox.hidden = true;
            lintBox.textContent = "";
            return;
        }
        // 资源清理规则写错时内核不会跳过它，而是让清理直接报错中止，先把后果写在问题列表前面
        const note = getIgnoreDefinition(active)?.strict ? t("lintStrictNote") : "";
        lintBox.hidden = false;
        lintBox.innerHTML = (note ? `<div class="eds__lint-note">${escapeHtml(note)}</div>` : "") +
            issues.map((issue) => `<div>${escapeHtml(describeIssue(issue))}</div>`).join("");
    };

    const applyText = (text: string, withBom: boolean) => {
        textarea.value = text;
        gutter.innerHTML = renderGutter(text.split("\n").length);
        syncScroll();
        bom = withBom;
        overwriteArmed = false;
        renderNotice();
        renderLint();
    };

    /** 立刻把编辑器里的正文落到草稿；与磁盘一致时删掉草稿 */
    const flushDraft = () => {
        window.clearTimeout(draftTimer);
        draftTimer = 0;
        if (disposed) {
            return;
        }
        const text = textarea.value;
        if (text === baseline) {
            dropDraft(active);
            return;
        }
        saveDraft(active, text, baseline);
    };

    const scheduleDraft = () => {
        window.clearTimeout(draftTimer);
        draftTimer = window.setTimeout(() => {
            draftTimer = 0;
            flushDraft();
            if (!disposed && !busy) {
                setStatus({ kind: textarea.value === baseline ? "saved" : "draft" });
            }
        }, DRAFT_DELAY);
    };

    const setReloadArmed = (armed: boolean) => {
        reloadArmed = armed;
        window.clearTimeout(confirmTimer);
        confirmTimer = 0;
        reloadButton.classList.toggle("b3-button--remove", armed);
        reloadButton.classList.toggle("b3-button--outline", !armed);
        reloadButton.textContent = armed ? t("reloadConfirm") : t("reload");
        reloadButton.title = armed ? t("reloadConfirmHint") : t("reloadHint");
        if (armed) {
            confirmTimer = window.setTimeout(() => setReloadArmed(false), CONFIRM_TIMEOUT);
        }
    };

    /** 读取文件并显示；useDraft=false 时不恢复草稿，用于「重新读取」 */
    const load = async (name: IgnoreFileName, useDraft = true) => {
        // 连点两个文件时只认最后一次，避免先发后到的读盘结果覆盖界面
        const token = ++loadToken;
        busy = true;
        updateControls();
        const disk = await readIgnoreFile(name);
        if (disposed || token !== loadToken) {
            return;
        }
        busy = false;
        updateControls();
        if (!disk.ok) {
            // 读失败时保持原文件，下拉框也跟着回退
            setStatus({ kind: "readFailed", message: disk.message });
            renderFiles();
            return;
        }
        active = name;
        baseline = disk.snapshot.text;
        const initial = useDraft
            ? pickInitialContent(disk.snapshot.text, readDraft(name))
            : { text: disk.snapshot.text, restored: false, external: false };
        if (!initial.restored) {
            // 草稿与磁盘一致（或没有草稿、或这次不要草稿）：磁盘内容就是最新状态
            dropDraft(name);
        }
        applyText(initial.text, disk.snapshot.bom);
        renderFiles();
        renderGuide();
        setStatus(initial.restored ? { kind: initial.external ? "external" : "restored" } : { kind: "saved" });
        rememberActive(name);
    };

    /** 从磁盘重新读取当前文件：草稿与编辑器里的改动都丢弃，显示磁盘上的内容 */
    const reload = async () => {
        if (busy) {
            return;
        }
        // 先删草稿：否则重新读盘时又会把草稿当成「未保存的改动」恢复回来
        dropDraft(active);
        await load(active, false);
    };

    const onReloadClick = () => {
        if (busy) {
            return;
        }
        // 二次确认就地完成，不弹对话框：独立设置窗口里也能看见
        if (!reloadArmed) {
            setReloadArmed(true);
            return;
        }
        setReloadArmed(false);
        void reload();
    };

    const save = async (): Promise<void> => {
        const target = active;
        const text = textarea.value;
        // 先把当前内容落进草稿：保存失败时面板被宿主关掉也不会丢
        flushDraft();
        const disk = await readIgnoreFile(target);
        if (disposed) {
            return;
        }
        if (!disk.ok) {
            return renderStatus({ kind: "readFailed", message: disk.message });
        }
        if (!overwriteArmed && disk.snapshot.text !== baseline) {
            // 编辑期间文件被别处改过：这一次不写，让用户看清状态再决定
            overwriteArmed = true;
            return renderStatus({ kind: "external" });
        }
        const written = await writeIgnoreFile(target, text, disk.snapshot.revision);
        if (disposed) {
            return;
        }
        if (!written.ok) {
            if (written.conflict) {
                overwriteArmed = true;
                return renderStatus({ kind: "external" });
            }
            return renderStatus({ kind: "saveFailed", message: written.message });
        }
        const verify = await readIgnoreFile(target);
        if (disposed) {
            return;
        }
        if (!verify.ok) {
            return renderStatus({ kind: "readFailed", message: verify.message });
        }
        if (verify.snapshot.text !== text) {
            return renderStatus({ kind: "verifyFailed" });
        }
        // 成功：磁盘与编辑器一致，草稿不再需要
        baseline = text;
        bom = verify.snapshot.bom;
        overwriteArmed = false;
        dropDraft(target);
        setStatus({ kind: "saved" });
    };

    const onInput = () => {
        const lineCount = textarea.value.split("\n").length;
        if (gutter.childElementCount !== lineCount) {
            gutter.innerHTML = renderGutter(lineCount);
            syncScroll();
        }
        window.clearTimeout(lintTimer);
        lintTimer = window.setTimeout(() => {
            lintTimer = 0;
            if (!disposed) {
                renderLint();
            }
        }, LINT_DELAY);
        scheduleDraft();
    };

    const onFilesChange = () => {
        const picked = files.find(file => file.name === filesBox.value);
        if (!picked) {
            return;
        }
        const action = decideFileSwitch(picked.name, { active, loading: busy, blocked: busy });
        if (action === "restore") {
            filesBox.value = active;
            return;
        }
        if (action === "cancel") {
            // 选回当前文件等于取消还没完成的读取，旧结果由 token 丢弃
            loadToken += 1;
            busy = false;
            updateControls();
            filesBox.value = active;
            return;
        }
        flushDraft();
        void load(picked.name);
    };

    textarea.addEventListener("input", onInput);
    textarea.addEventListener("scroll", syncScroll);
    filesBox.addEventListener("change", onFilesChange);
    reloadButton.addEventListener("click", onReloadClick);
    setReloadArmed(false);
    renderFiles();
    renderGuide();
    updateControls();
    setStatus({ kind: "saved" });
    void load(active);

    return {
        element,
        save,
        dispose: () => {
            if (disposed) {
                return;
            }
            // 面板关闭前最后落一次草稿：输入法/防抖还没触发的内容也不会丢
            flushDraft();
            disposed = true;
            window.clearTimeout(lintTimer);
            window.clearTimeout(draftTimer);
            window.clearTimeout(confirmTimer);
            lintTimer = 0;
            draftTimer = 0;
            confirmTimer = 0;
            loadToken += 1;
        },
    };
};
