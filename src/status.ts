// 编辑器状态行。
//
// 面板不再弹确认框，所有需要用户知道的结果都用这一行说明：是否已保存、草稿是否已保留、
// 磁盘是否被外部改动、保存为什么失败。色调决定文字颜色，取值对齐思源的 --b3-card-*-color。

export type EditorStatusKind = "saved" | "draft" | "restored" | "external" | "saveFailed" |
    "readFailed" | "verifyFailed";

/** success / info / warning / error 对应 --b3-card-success/info/warning/error-color */
type StatusTone = "success" | "info" | "warning" | "error";

export interface EditorStatus {
    kind: EditorStatusKind;
    /** 失败原因，只有 *Failed 状态用到 */
    message?: string;
}

export const STATUS_TONES: Record<EditorStatusKind, StatusTone> = {
    saved: "success",
    draft: "warning",
    restored: "info",
    external: "warning",
    saveFailed: "error",
    readFailed: "error",
    verifyFailed: "error",
};

export const STATUS_KEYS: Record<EditorStatusKind, string> = {
    saved: "statusSaved",
    draft: "statusDraft",
    restored: "statusRestored",
    external: "statusExternal",
    saveFailed: "statusSaveFailed",
    readFailed: "statusReadFailed",
    verifyFailed: "statusVerifyFailed",
};

/** 把状态渲染成一行文案；失败类状态会把具体原因填进 {msg}。 */
export const statusDescribe = (status: EditorStatus, t: (key: string) => string): string => {
    const template = t(STATUS_KEYS[status.kind]);
    return status.message === undefined ? template : template.replace("{msg}", status.message);
};
