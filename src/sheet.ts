// 移动端底部抽屉适配。
//
// 宿主的抽屉能力（bindBottomSheetDialog / bindBottomSheetDrag / mobileSheetLayout）只供内部业务使用，
// 插件拿到的 Dialog 在移动端仍是居中弹窗。这里复用宿主已经定义的抽屉样式类，让面板获得原生的
// 圆角、贴底与入场/退场过渡；抓手与拖拽手势按宿主的规则自行实现，不复制宿主代码：
// - 抓手拖动改高度，上限是可用视口高度，下限是 chrome + 120px；
// - 压到最低后继续下拉把面板整体下移，超过 min(120px, 下限 * 25%) 或速度大于 0.6px/ms 才关闭；
// - 只在本插件自己的面板上生效，无需判断是否最顶层（宿主 dialog 的遮罩已经挡住下层）。
import type {Dialog} from "siyuan";

const GRIP_HEIGHT = 16;
const MIN_DRAG_GAP = 120;

let sheetStylesSupported: boolean | undefined;

const hasSheetRule = (rules: CSSRuleList): boolean => {
    for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText.includes(".mobile-bottom-sheet")) {
            return true;
        }
        const nested = (rule as CSSGroupingRule).cssRules;
        if (nested && hasSheetRule(nested)) {
            return true;
        }
    }
    return false;
};

/**
 * 探测宿主是否定义了抽屉样式。样式只在 3.8.10-alpha.5 之后存在，旧版本上加类名不会有任何效果，
 * 因此探测一次并缓存，用于决定是否启用抓手与拖拽。
 */
export const hasHostBottomSheetStyles = (): boolean => {
    if (sheetStylesSupported !== undefined) {
        return sheetStylesSupported;
    }
    sheetStylesSupported = false;
    for (const styleSheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
            rules = styleSheet.cssRules;
        } catch {
            // 跨域样式表读不到规则，跳过
            continue;
        }
        if (hasSheetRule(rules)) {
            sheetStylesSupported = true;
            break;
        }
    }
    return sheetStylesSupported;
};

export interface SheetOptions {
    dialog: Dialog;
    /** 下拉关闭时调用，由调用方决定是否真正关闭（有未保存改动时会先确认） */
    requestClose: () => void;
}

export const bindMobileBottomSheet = (options: SheetOptions): (() => void) => {
    const element = options.dialog.element;
    const container = element.querySelector<HTMLElement>(".b3-dialog__container");
    const overlay = element.querySelector<HTMLElement>(".b3-dialog");
    if (!container || !overlay) {
        return () => undefined;
    }
    element.classList.add("mobile-bottom-sheet-dialog");
    container.classList.add("mobile-bottom-sheet");

    const grip = document.createElement("div");
    grip.className = "eds-grip";
    grip.setAttribute("aria-hidden", "true");
    container.prepend(grip);

    let dragging = false;
    let startY = 0;
    let startHeight = 0;
    let startTime = 0;
    let bounds = measure();

    function measure() {
        const style = getComputedStyle(overlay as HTMLElement);
        const available = Math.max(0, overlay!.clientHeight -
            (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0));
        const chrome = GRIP_HEIGHT +
            (container!.querySelector<HTMLElement>(".b3-dialog__header")?.offsetHeight || 0) +
            (container!.querySelector<HTMLElement>(".b3-dialog__action")?.offsetHeight || 0);
        const min = Math.min(container!.getBoundingClientRect().height, chrome + MIN_DRAG_GAP, available);
        return { available, min: Math.max(0, min) };
    }

    const isClosing = () => element.dataset.dialogClosing === "true";

    const onPointerDown = (event: PointerEvent) => {
        if (isClosing() || (event.pointerType === "mouse" && event.button !== 0)) {
            return;
        }
        // 键盘弹起或旋转会改变可用高度，每次起手重新测一次
        bounds = measure();
        dragging = true;
        startY = event.clientY;
        startHeight = container!.getBoundingClientRect().height;
        startTime = performance.now();
        // 手势期间必须临时关掉宿主过渡，否则位移会滞后 150ms；松手后立即清除。
        container!.style.transition = "none";
        container!.style.maxHeight = `${Math.round(bounds.available)}px`;
        grip.setPointerCapture(event.pointerId);
        event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
        if (!dragging) {
            return;
        }
        const desired = startHeight + (startY - event.clientY);
        const height = Math.min(bounds.available, Math.max(bounds.min, desired));
        container!.style.height = `${Math.round(height)}px`;
        // 已经压到最低仍然继续下拉：整块面板跟手下移，准备触发关闭
        const overshoot = Math.max(0, bounds.min - desired);
        container!.style.transform = overshoot > 0 ? `translateY(${Math.round(overshoot)}px)` : "";
        event.preventDefault();
    };

    const finish = (event: PointerEvent) => {
        if (!dragging) {
            return;
        }
        dragging = false;
        if (grip.hasPointerCapture(event.pointerId)) {
            grip.releasePointerCapture(event.pointerId);
        }
        const overshoot = Math.max(0, bounds.min - (startHeight + (startY - event.clientY)));
        const velocity = overshoot / Math.max(1, performance.now() - startTime);
        container!.style.transition = "";
        if (overshoot > Math.min(120, bounds.min * 0.25) || velocity > 0.6) {
            options.requestClose();
            // 关闭被拒绝时把面板放回原位
            window.setTimeout(() => {
                if (element.isConnected) {
                    container!.style.transform = "";
                }
            }, 0);
            return;
        }
        container!.style.transform = "";
    };

    grip.addEventListener("pointerdown", onPointerDown);
    grip.addEventListener("pointermove", onPointerMove);
    grip.addEventListener("pointerup", finish);
    grip.addEventListener("pointercancel", finish);

    return () => {
        grip.removeEventListener("pointerdown", onPointerDown);
        grip.removeEventListener("pointermove", onPointerMove);
        grip.removeEventListener("pointerup", finish);
        grip.removeEventListener("pointercancel", finish);
        grip.remove();
        container.classList.remove("mobile-bottom-sheet");
        element.classList.remove("mobile-bottom-sheet-dialog");
    };
};
