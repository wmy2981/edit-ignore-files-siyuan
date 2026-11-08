// 移动端底部抽屉。
//
// 宿主的抽屉能力（bindBottomSheetDialog / bindBottomSheetDrag / mobileSheetLayout）只供内部业务使用，
// 没有导出给插件，所以这里按宿主的同一套规则实现：类名、抓手、布局高度、入场时序、拖拽手势与阈值
// 全部对齐思源原生抽屉，确保观感和手感一致。
//   - 抓手：宿主样式 `.b3-menu__title--root` 画的 32×4 短横；
//   - 布局：上限为完整视口高度的 56%，下限为 chrome + 120px，拖高后上限放宽到可用高度；
//   - 入场：先移到视口外并隐藏，等键盘/视口稳定后再展开，不在动画期间改变内容；
//   - 拖拽：整块面板都能起手（输入框、按钮等除外），只有从抓手起手才改高度，其余是下拉位移；
//   - 关闭：excess 超过 min(120px, 下限 × 25%)，或下拉超过 20px 且速度大于 0.6px/ms。
//
// 注意：自建抽屉与 MOBILE_FLICKER.md §一.4 / §一.5 / §一.6 与 §四「不要复制宿主抽屉」的规则相反，
// 属于本项目的刻意选择（宿主没有导出这些能力），理由与偏离清单见 CLAUDE.md「已知限制与偏离」。
import type {Dialog} from "siyuan";
import { getSheetBounds, getStandardMaxHeight, moveSheetGesture, shouldCloseSheet } from "./sheetGesture";
import type { SheetGesture } from "./sheetGesture";

const GRIP_CLASS = "b3-menu__title b3-menu__title--root";
// 与宿主一致：可交互元素和拖拽元素上的手势不归抽屉处理
const EXCLUDE_SELECTOR = 'input, textarea, select, button, [contenteditable="true"], .protyle, ' +
    '.block__icon, .b3-dialog__close, [draggable="true"]';
const CROSS_AXIS_TOLERANCE = 4;

type MobileSize = { isLandscape?: boolean, portrait?: { height1?: number }, landscape?: { height1?: number } };
type HostWindow = Window & {
    siyuan?: {
        config?: { system?: { container?: string } },
        mobile?: { size?: MobileSize },
    }
};

// App 内的可视视口由原生层负责，只有浏览器才需要读 visualViewport
const isMobileApp = () => {
    const container = (window as HostWindow).siyuan?.config?.system?.container;
    return container === "android" || container === "ios" || container === "harmony";
};

// 与宿主 orientation.ts 一致：优先看 screen.orientation，退化时用不受软键盘影响的屏幕尺寸
const isLandscape = () => {
    const type = window.screen.orientation?.type;
    if (type?.startsWith("landscape")) {
        return true;
    }
    if (type?.startsWith("portrait")) {
        return false;
    }
    return window.screen.width > window.screen.height;
};

// 完整视口高度取宿主按横竖屏记录的高度，键盘压缩后的 innerHeight 不能覆盖它
const getFullHeight = () => {
    const size = (window as HostWindow).siyuan?.mobile?.size;
    const direction = isLandscape() ? size?.landscape : size?.portrait;
    return Math.max(window.innerHeight, direction?.height1 || 0);
};

const viewportBounds = () => {
    if (!isMobileApp() && window.visualViewport) {
        const top = Math.max(0, Math.min(window.innerHeight, window.visualViewport.offsetTop));
        return {
            top,
            bottom: Math.max(top, Math.min(window.innerHeight,
                window.visualViewport.offsetTop + window.visualViewport.height)),
        };
    }
    return { top: 0, bottom: window.innerHeight };
};

// 键盘收起后等待布局稳定再展开，最多等 1s（兼容浮动键盘与窗口尺寸变化）
const waitForSheetViewport = (options: {
    height: () => number,
    fullHeight: number,
    open: () => void,
}) => {
    const start = performance.now();
    const waitForKeyboard = options.fullHeight - options.height() > 100;
    let frame = 0;
    let cancelled = false;
    let restoredAt: number | undefined;
    const check = () => {
        if (cancelled) {
            return;
        }
        const now = performance.now();
        if (options.height() >= options.fullHeight - 2) {
            restoredAt ??= now;
        } else {
            restoredAt = undefined;
        }
        if (!waitForKeyboard || (restoredAt !== undefined && now - restoredAt >= 32) || now - start >= 1000) {
            options.open();
            return;
        }
        frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
    };
};

let sheetStylesSupported: boolean | undefined;

// 宿主抽屉样式里，布局层给遮罩留安全区、面板层让正文撑满，两个缺一不可
const SHEET_SELECTORS = [".mobile-sheet-layout", ".mobile-sheet-panel"];

const hasSheetRule = (rules: CSSRuleList, selector: string): boolean => {
    for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText.includes(selector)) {
            return true;
        }
        const nested = (rule as CSSGroupingRule).cssRules;
        if (nested && hasSheetRule(nested, selector)) {
            return true;
        }
    }
    return false;
};

/**
 * 探测宿主是否定义了抽屉样式。这两组样式自 3.8.10-alpha.5 起齐全，探测不到就退回普通对话框。
 */
export const hasHostBottomSheetStyles = (): boolean => {
    if (sheetStylesSupported !== undefined) {
        return sheetStylesSupported;
    }
    const sheets: CSSRuleList[] = [];
    for (const styleSheet of Array.from(document.styleSheets)) {
        try {
            sheets.push(styleSheet.cssRules);
        } catch {
            // 跨域样式表读不到规则，跳过
        }
    }
    sheetStylesSupported = SHEET_SELECTORS.every(selector => sheets.some(rules => hasSheetRule(rules, selector)));
    return sheetStylesSupported;
};

export interface SheetOptions {
    dialog: Dialog;
    /** 下拉关闭：返回是否真的关闭了（有未保存改动时会先确认） */
    close: () => Promise<boolean>;
}

export interface SheetHandle {
    /** 关闭前冻结当前高度，让退出位移从已绘制的位置滑出 */
    freeze: () => void;
    /** 内容高度变化后重新布局，保留用户已经拖好的高度 */
    relayout: () => void;
    dispose: () => void;
}

export const bindMobileBottomSheet = (options: SheetOptions): SheetHandle => {
    const element = options.dialog.element;
    const overlay = element.querySelector<HTMLElement>(".b3-dialog");
    const sheet = element.querySelector<HTMLElement>(".b3-dialog__container");
    if (!overlay || !sheet) {
        return { freeze: () => undefined, relayout: () => undefined, dispose: () => undefined };
    }
    const toolbar = document.getElementById("keyboardToolbar");

    element.classList.add("mobile-bottom-sheet-dialog");
    overlay.classList.add("mobile-sheet-layout");
    sheet.classList.add("mobile-bottom-sheet", "mobile-sheet-panel");
    // 抽屉不参与通用对话框的移动、缩放和关闭图标；关闭由插件自己的按钮与手势负责
    sheet.querySelector(".b3-dialog__close")?.remove();
    sheet.querySelector(".b3-dialog__header")?.classList.remove("resize__move");
    sheet.querySelectorAll(":scope > .resize__rd, :scope > .resize__ld, :scope > .resize__lt, " +
        ":scope > .resize__rt, :scope > .resize__r, :scope > .resize__d, :scope > .resize__t, :scope > .resize__l")
        .forEach(handle => handle.remove());
    const grip = document.createElement("div");
    grip.className = GRIP_CLASS;
    grip.setAttribute("aria-hidden", "true");
    sheet.prepend(grip);

    let disposed = false;
    let frozen = false;
    let preferred: number | undefined;
    let available = 0;
    let cancelOpen: (() => void) | undefined;
    let opening = false;
    let closeObserver: MutationObserver | undefined;
    let layoutObserver: MutationObserver | undefined;
    let frameObserver: ResizeObserver | undefined;

    const isClosing = () => element.dataset.dialogClosing === "true";
    const standardMax = () => getStandardMaxHeight(getFullHeight(), available);

    // 测量自然高度时临时展开滚动区，测量后恢复原有滚动位置
    const getBounds = () => {
        const positions = [sheet, ...Array.from(sheet.querySelectorAll<HTMLElement>("*"))]
            .filter(node => node.scrollTop !== 0 || node.scrollLeft !== 0)
            .map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }));
        const height = sheet.style.height;
        const maxHeight = sheet.style.maxHeight;
        const body = sheet.querySelector<HTMLElement>(":scope > .b3-dialog__body");
        const flex = body?.style.flex;
        sheet.style.height = "auto";
        sheet.style.maxHeight = "none";
        if (body) {
            body.style.flex = "none";
        }
        const natural = sheet.getBoundingClientRect().height;
        const footer = body?.querySelector<HTMLElement>(":scope > .b3-dialog__action");
        const chrome = Math.max(0, natural - (body?.getBoundingClientRect().height || 0)) +
            (footer?.getBoundingClientRect().height || 0);
        if (body && flex !== undefined) {
            body.style.flex = flex;
        }
        sheet.style.height = height;
        sheet.style.maxHeight = maxHeight;
        positions.forEach(({ node, top, left }) => {
            node.scrollTop = top;
            node.scrollLeft = left;
        });
        return getSheetBounds(natural, chrome, available, standardMax());
    };

    const resize = () => {
        if (disposed || !overlay.isConnected) {
            return;
        }
        const viewport = viewportBounds();
        const bottom = toolbar && !toolbar.classList.contains("fn__none") ?
            Math.min(viewport.bottom, toolbar.getBoundingClientRect().top) : viewport.bottom;
        overlay.style.top = `${viewport.top}px`;
        // 整个视口可用时直接贴住布局底边，避免整数高度截断后露出背景
        const fullViewport = bottom === window.innerHeight;
        overlay.style.bottom = fullViewport ? "0px" : "auto";
        overlay.style.height = fullViewport ? "auto" : `${Math.max(0, bottom - viewport.top)}px`;
        if (frozen) {
            return;
        }
        const style = getComputedStyle(overlay);
        // 安全区只由这一层 padding 占位
        available = Math.max(0, bottom - viewport.top -
            (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0));
        sheet.classList.toggle("mobile-sheet-panel--compact", available <= 160);
        const target = preferred === undefined ? standardMax() :
            Math.max(getBounds().min, Math.min(preferred, available));
        sheet.style.maxHeight = `${preferred === undefined ? standardMax() : available}px`;
        sheet.style.height = `${Math.max(0, target)}px`;
    };

    const setPreferredHeight = (height: number) => {
        preferred = height;
        resize();
    };

    const freeze = () => {
        if (frozen || disposed) {
            return;
        }
        const height = `${sheet.getBoundingClientRect().height}px`;
        sheet.style.height = height;
        sheet.style.maxHeight = height;
        frozen = true;
    };

    const changeGesture = (state: SheetGesture, offset: number) => moveSheetGesture(state, offset, performance.now());

    // ---- 入场：与宿主一致，先移出视口并隐藏，视口稳定后再展开 ----
    sheet.style.transition = "none";
    sheet.style.transform = "translateY(100%)";
    sheet.style.visibility = "hidden";
    const updateOpen = () => {
        if (!element.classList.contains("b3-dialog--open")) {
            if (isClosing()) {
                freeze();
                // 退出样式接管拖动位移，保留从当前绘制位置向下滑出的过渡
                sheet.style.transition = "";
                sheet.style.transform = "";
            }
            cancelOpen?.();
            return;
        }
        if (opening) {
            return;
        }
        opening = true;
        cancelOpen = waitForSheetViewport({
            height: () => Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight),
            fullHeight: getFullHeight(),
            open: () => {
                if (!element.isConnected || !element.classList.contains("b3-dialog--open")) {
                    return;
                }
                resize();
                sheet.style.visibility = "";
                void sheet.offsetHeight;
                sheet.style.transition = "";
                void sheet.offsetHeight;
                sheet.style.transform = "";
            },
        });
    };
    closeObserver = new MutationObserver(updateOpen);
    closeObserver.observe(element, { attributes: true, attributeFilter: ["class"] });
    updateOpen();

    // ---- 拖拽：从抓手起手改高度，其余起手是下拉位移 ----
    let start: { x: number, y: number, time: number, id: number } | undefined;
    let gesture: SheetGesture | undefined;
    let dragging = false;
    let closing = false;
    let suppressClickUntil = 0;

    const clearGesture = () => {
        start = undefined;
        gesture = undefined;
        dragging = false;
    };
    const exitOwnsVisuals = () => {
        if (!disposed && !closing && !isClosing()) {
            return false;
        }
        clearGesture();
        return true;
    };
    const reset = () => {
        sheet.style.transition = "";
        sheet.style.transform = "";
        clearGesture();
    };
    const findTouch = (touches: TouchList) => Array.from(touches).find(touch => touch.identifier === start?.id);

    const onTouchStart = (event: TouchEvent) => {
        if (closing || disposed || isClosing()) {
            return;
        }
        reset();
        const target = event.target as HTMLElement;
        if (event.touches.length !== 1 || target.closest(EXCLUDE_SELECTOR)) {
            return;
        }
        // 内层滚动区域已经开始滚动时，手势归滚动
        for (let parent: HTMLElement | null = target; parent && parent !== sheet; parent = parent.parentElement) {
            if (parent.scrollHeight > parent.clientHeight + 1 && parent.scrollTop > 0 &&
                ["auto", "scroll", "overlay"].includes(getComputedStyle(parent).overflowY)) {
                return;
            }
        }
        const touch = event.touches[0];
        start = { x: touch.clientX, y: touch.clientY, time: performance.now(), id: touch.identifier };
        if (grip.contains(target)) {
            const height = sheet.getBoundingClientRect().height;
            const bounds = getBounds();
            gesture = { height, ...bounds, min: Math.min(bounds.min, height), offset: 0, time: start.time };
        }
    };

    const onTouchMove = (event: TouchEvent) => {
        if (exitOwnsVisuals() || !start) {
            return;
        }
        const touch = findTouch(event.touches);
        if (event.touches.length !== 1 || !touch) {
            onTouchCancel();
            return;
        }
        const offset = touch.clientY - start.y;
        if (Math.abs(touch.clientX - start.x) > Math.abs(offset)) {
            onTouchCancel();
            return;
        }
        if (!dragging && Math.abs(offset) < CROSS_AXIS_TOLERANCE) {
            return;
        }
        // 没有抓手时只能下拉，上滑留给内容
        if (!gesture && offset <= 0) {
            onTouchCancel();
            return;
        }
        dragging = true;
        sheet.style.transition = "none";
        const result = gesture ? changeGesture(gesture, offset) : undefined;
        if (result) {
            setPreferredHeight(result.height);
        }
        if (exitOwnsVisuals()) {
            return;
        }
        const excess = result ? result.excess : Math.max(0, offset);
        sheet.style.transform = `translateY(${excess}px)`;
        if (event.cancelable) {
            event.preventDefault();
        }
    };

    const onTouchEnd = (event: TouchEvent) => {
        if (exitOwnsVisuals() || !start) {
            return;
        }
        const touch = findTouch(event.changedTouches);
        if (!touch) {
            return;
        }
        if (!dragging) {
            reset();
            return;
        }
        const offset = touch.clientY - start.y;
        const result = gesture ? changeGesture(gesture, offset) : undefined;
        if (result) {
            setPreferredHeight(result.height);
        }
        if (exitOwnsVisuals()) {
            return;
        }
        const duration = Math.max(performance.now() - start.time, 1);
        const shouldClose = shouldCloseSheet(result, offset, duration, sheet.clientHeight);
        // 拖动结束后抑制随后的点击，避免松手即触发按钮
        suppressClickUntil = performance.now() + 300;
        void sheet.offsetHeight;
        sheet.style.transition = "";
        clearGesture();
        if (!shouldClose) {
            reset();
            return;
        }
        closing = true;
        void options.close().then((closed) => {
            if (disposed || closed || isClosing() || !sheet.isConnected) {
                return;
            }
            closing = false;
            reset();
        }).catch(() => {
            if (!disposed && !isClosing()) {
                closing = false;
                reset();
            }
        });
    };

    function onTouchCancel() {
        if (exitOwnsVisuals() || !start) {
            return;
        }
        if (dragging) {
            suppressClickUntil = performance.now() + 300;
        }
        reset();
    }

    const onClick = (event: MouseEvent) => {
        if (performance.now() < suppressClickUntil) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };

    // 视口、方向或工具栏高度变化时取消进行中的手势并重新布局
    const onViewportChange = () => {
        onTouchCancel();
        resize();
    };

    sheet.addEventListener("touchstart", onTouchStart, { passive: true });
    sheet.addEventListener("touchmove", onTouchMove, { passive: false });
    sheet.addEventListener("touchend", onTouchEnd);
    sheet.addEventListener("touchcancel", onTouchCancel);
    sheet.addEventListener("click", onClick, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);
    window.visualViewport?.addEventListener("resize", onViewportChange);
    window.visualViewport?.addEventListener("scroll", onViewportChange);
    window.screen.orientation?.addEventListener?.("change", onViewportChange);
    frameObserver = typeof ResizeObserver === "undefined" ? undefined :
        new ResizeObserver(onViewportChange);
    if (toolbar) {
        frameObserver?.observe(toolbar);
    }
    layoutObserver = new MutationObserver(onViewportChange);
    if (toolbar) {
        layoutObserver.observe(toolbar, { attributes: true, attributeFilter: ["class", "style"] });
    }

    resize();

    return {
        freeze,
        relayout: resize,
        dispose: () => {
            if (disposed) {
                return;
            }
            disposed = true;
            cancelOpen?.();
            closeObserver?.disconnect();
            layoutObserver?.disconnect();
            frameObserver?.disconnect();
            sheet.removeEventListener("touchstart", onTouchStart);
            sheet.removeEventListener("touchmove", onTouchMove);
            sheet.removeEventListener("touchend", onTouchEnd);
            sheet.removeEventListener("touchcancel", onTouchCancel);
            sheet.removeEventListener("click", onClick, true);
            window.removeEventListener("resize", onViewportChange);
            window.removeEventListener("orientationchange", onViewportChange);
            window.visualViewport?.removeEventListener("resize", onViewportChange);
            window.visualViewport?.removeEventListener("scroll", onViewportChange);
            window.screen.orientation?.removeEventListener?.("change", onViewportChange);
            grip.remove();
            sheet.classList.remove("mobile-bottom-sheet", "mobile-sheet-panel");
            overlay.classList.remove("mobile-sheet-layout");
            element.classList.remove("mobile-bottom-sheet-dialog");
        },
    };
};
