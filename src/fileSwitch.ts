// 文件切换的决策。
//
// 下拉框在读取期间仍然可用，所以「选回当前文件」必须能取消还没完成的读取：
// 此时 active 还是旧文件，不能把它当成重复操作后让旧读取继续生效。
import type { IgnoreFileName } from "./ignoreFiles";

/** restore：把下拉框选回当前文件；cancel：取消进行中的读取；confirm：先确认放弃修改；load：开始读取 */
export type FileSwitchAction = "restore" | "cancel" | "confirm" | "load";

export interface FileSwitchState {
    /** 当前已经显示在编辑器里的文件 */
    active: IgnoreFileName;
    /** 有读取正在进行 */
    loading: boolean;
    /** 编辑器里的内容与基准不同 */
    dirty: boolean;
    /** 已关闭、正在保存或正在确认 */
    blocked: boolean;
}

export const decideFileSwitch = (name: IgnoreFileName, state: FileSwitchState): FileSwitchAction => {
    if (state.blocked) {
        return "restore";
    }
    if (name === state.active) {
        return state.loading ? "cancel" : "restore";
    }
    // 读取期间不提示放弃修改：内容还没被覆盖，旧读取的结果也会被丢弃
    return state.dirty && !state.loading ? "confirm" : "load";
};
