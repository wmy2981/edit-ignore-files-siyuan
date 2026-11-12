// 编辑草稿。
//
// 宿主的插件设置面板没有给插件拦截关闭的入口（Setting 内部自己构造对话框，不透传
// beforeClose / mobileSheet 钩子），所以不再拦截关闭，而是把编辑内容实时写进草稿：
// 关掉面板也不会丢改动，重新打开还能接着改。
//
// 草稿只在本机有效：用 localStorage 存，不落盘、不参与数据同步、不产生内核请求。
import type { IgnoreFileName } from "./ignoreFiles";

export interface Draft {
    /** 用户最后编辑的正文 */
    text: string;
    /** 写下这份草稿时磁盘上的正文，用来判断草稿是否基于旧内容 */
    base: string;
    /** 写入时间（毫秒），只用于排查问题 */
    at: number;
}

export const ACTIVE_STORAGE_KEY = "edit-ignore-files/active";
const DRAFT_PREFIX = "edit-ignore-files/draft/";

export const draftKey = (name: IgnoreFileName) => `${DRAFT_PREFIX}${name}`;

export const serializeDraft = (text: string, base: string, at: number): string =>
    JSON.stringify({ text, base, at } satisfies Draft);

/** 解析草稿；格式不对（旧版本残留、被手工改坏）就当作没有草稿。 */
export const parseDraft = (raw: string | null | undefined): Draft | undefined => {
    if (!raw) {
        return undefined;
    }
    try {
        const value = JSON.parse(raw) as Partial<Draft> | null;
        if (!value || typeof value.text !== "string" || typeof value.base !== "string" ||
            typeof value.at !== "number") {
            return undefined;
        }
        return { text: value.text, base: value.base, at: value.at };
    } catch {
        return undefined;
    }
};

export interface InitialContent {
    /** 编辑器里应该显示的正文 */
    text: string;
    /** 正文来自草稿（磁盘上还没有这部分改动） */
    restored: boolean;
    /** 草稿基于的磁盘内容已经不是现在的磁盘内容：文件在别处被改过 */
    external: boolean;
}

/**
 * 打开文件时决定显示磁盘内容还是草稿。
 * 正文与磁盘一致时草稿没有意义，按磁盘内容显示，并把草稿清掉（调用方负责）。
 */
export const pickInitialContent = (diskText: string, draft: Draft | undefined): InitialContent => {
    if (!draft || draft.text === diskText) {
        return { text: diskText, restored: false, external: false };
    }
    return { text: draft.text, restored: true, external: draft.base !== diskText };
};
