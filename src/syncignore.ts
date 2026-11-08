// 同步忽略文件的读写与轻量校验。
//
// 内核没有提供该文件的专用接口，只能走原始文件 API：
// - 读：POST /api/file/getFile，成功时返回裸文本，失败时返回 HTTP 202 + JSON 错误体；
// - 写：POST /api/file/putFile，multipart 表单，返回 {code, msg, data}。
// 插件 API 的 fetchSyncPost 会把响应体直接当 JSON 解析，读到文本文件时必然抛错，
// 因此这里直接用 fetch，请求同源、鉴权方式与宿主一致。

export const SYNC_IGNORE_PATH = "data/.siyuan/syncignore";

export interface SyncIgnoreSnapshot {
    /** 已经去掉 BOM、行尾统一为 \n 的正文。 */
    text: string;
    /** 原文件是否带 UTF-8 BOM，写回时保持原样。 */
    bom: boolean;
}

export type ReadResult = { ok: true, snapshot: SyncIgnoreSnapshot } | { ok: false, message: string };

export interface WriteResult {
    ok: boolean;
    message: string;
}

const normalize = (raw: string) => raw.replace(/\r\n?/g, "\n");

const describeFailure = async (response: Response) => {
    try {
        const body = await response.json() as { code?: number, msg?: string };
        return body.msg || `code ${String(body.code)}`;
    } catch {
        return response.statusText || `HTTP ${response.status}`;
    }
};

export const readSyncIgnore = async (): Promise<ReadResult> => {
    let response: Response;
    try {
        response = await fetch("/api/file/getFile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: SYNC_IGNORE_PATH }),
        });
    } catch (error) {
        return { ok: false, message: String(error) };
    }
    // 202 表示文件没有正常读取，此时响应体是 JSON 而不是文件内容。
    if (response.status === 202) {
        return { ok: false, message: await describeFailure(response) };
    }
    if (!response.ok) {
        return { ok: false, message: `${response.status} ${response.statusText}` };
    }
    const raw = await response.text();
    const bom = raw.charCodeAt(0) === 0xFEFF;
    return { ok: true, snapshot: { text: normalize(bom ? raw.slice(1) : raw), bom } };
};

export const writeSyncIgnore = async (text: string, bom: boolean): Promise<WriteResult> => {
    const form = new FormData();
    form.append("path", SYNC_IGNORE_PATH);
    form.append("isDir", "false");
    form.append("file", new Blob([(bom ? "\uFEFF" : "") + text], { type: "text/plain" }), "syncignore");
    let response: Response;
    try {
        response = await fetch("/api/file/putFile", { method: "POST", body: form });
    } catch (error) {
        return { ok: false, message: String(error) };
    }
    let body: { code?: number, msg?: string } = {};
    try {
        body = await response.json();
    } catch {
        // 非 JSON 响应交给下面的状态码判断
    }
    if (!response.ok || (typeof body.code === "number" && body.code !== 0)) {
        return { ok: false, message: body.msg || `${response.status} ${response.statusText}` };
    }
    return { ok: true, message: "" };
};

export type LintKind = "backslash" | "emptyNegation" | "unclosedClass";

export interface LintIssue {
    /** 1 起始的行号 */
    line: number;
    kind: LintKind;
}

/**
 * 只报会让规则写法本身失效的语法问题，不做风格建议（缺前导斜杠、重复行、行尾空白之类一律不提示）。
 * 规则是否真的命中文件由内核在同步时判定，这里不重复实现匹配引擎。
 */
export const lintSyncIgnore = (text: string): LintIssue[] => {
    const issues: LintIssue[] = [];
    text.split("\n").forEach((raw, index) => {
        const line = index + 1;
        const rule = raw.trimEnd();
        if (!rule || rule.startsWith("#")) {
            return;
        }
        // 取反规则的前缀不参与路径判断
        const path = rule.startsWith("!") ? rule.slice(1) : rule;
        if (!path.trim()) {
            issues.push({ line, kind: "emptyNegation" });
            return;
        }
        // 内核按 / 分隔的数据相对路径匹配，反斜杠永远命中不到任何文件
        if (path.includes("\\")) {
            issues.push({ line, kind: "backslash" });
        }
        const opened = (path.match(/\[/g) || []).length;
        const closed = (path.match(/\]/g) || []).length;
        if (opened !== closed) {
            issues.push({ line, kind: "unclosedClass" });
        }
    });
    return issues;
};
