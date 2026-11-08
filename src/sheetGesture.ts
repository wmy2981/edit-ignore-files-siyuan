// 移动端抽屉的手势计算，规则与宿主 mobileSheetGesture / bindBottomSheetDrag 一致。
// 这里全部是纯函数，便于单元测试；DOM 与事件绑定留在 sheet.ts。

/** 抽屉可以被拖到的最小高度里，除 chrome 之外还要留出的内容高度 */
export const MIN_SHEET_GAP = 120;
/** 普通抽屉（不处于展开态）的高度上限占完整视口的比例 */
export const STANDARD_RATIO = 0.56;

export interface SheetBounds {
    min: number;
    max: number;
}

export interface SheetGesture {
    height: number;
    min: number;
    max: number;
    offset: number;
    time: number;
    phaseStart?: number;
}

export interface SheetGestureResult {
    height: number;
    /** 已经压到下限之后继续下拉的距离，用来位移整块面板并淡出遮罩 */
    excess: number;
    close: boolean;
}

/**
 * 计算拖拽可用区间：下限先取「自然高度、chrome + 120、可用高度」的最小值，
 * 再按宿主的做法与「chrome、普通抽屉上限」的较大值取小——standardMax 小于 chrome + 120 时它会进一步收紧下限，
 * 不会把下限抬高。
 */
export const getSheetBounds = (natural: number, chrome: number, available: number, standardMax: number): SheetBounds => ({
    min: Math.min(Math.max(0, Math.min(natural, chrome + MIN_SHEET_GAP, available)), Math.max(chrome, standardMax)),
    max: Math.max(0, available),
});

/**
 * 普通抽屉的高度上限：可用高度与「完整视口 × 56%」取小。
 */
export const getStandardMaxHeight = (fullHeight: number, available: number) =>
    Math.min(Math.max(0, available), Math.max(0, fullHeight) * STANDARD_RATIO);

/**
 * 按本次下拉位移推进手势状态。向下 offset 为正，高度随之减小；
 * 压到下限后多出来的距离进 excess，松手时据此判断是否关闭。
 */
export const moveSheetGesture = (state: SheetGesture, offset: number, time: number): SheetGestureResult => {
    const requested = state.height - offset;
    const excess = Math.max(0, state.min - requested);
    if (!excess) {
        state.phaseStart = undefined;
    } else if (state.phaseStart === undefined) {
        // 记下越过下限的那一刻，速度只按 excess 期间的位移计算，避免整段拖拽稀释瞬时速度
        const boundary = state.height - state.min;
        const distance = offset - state.offset;
        const fraction = distance > 0 ? Math.max(0, Math.min(1, (boundary - state.offset) / distance)) : 1;
        state.phaseStart = state.time + (time - state.time) * fraction;
    }
    state.offset = offset;
    state.time = time;
    const speed = state.phaseStart === undefined || time <= state.phaseStart ? 0 : excess / (time - state.phaseStart);
    return {
        height: Math.max(state.min, Math.min(state.max, requested)),
        excess,
        close: excess > Math.min(120, state.min * .25) || (excess > 20 && speed > .6),
    };
};

/**
 * 松手后是否关闭：有抓手时由手势结果决定，否则按整块面板的下拉距离与速度判断。
 */
export const shouldCloseSheet = (result: SheetGestureResult | undefined, offset: number,
                                 duration: number, clientHeight: number) => result ? result.close :
    offset > Math.min(120, clientHeight * .25) || (offset > 20 && offset / Math.max(duration, 1) > .6);
