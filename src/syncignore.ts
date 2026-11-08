// 同步忽略文件的读写与语法检查。
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
    /** 原文件是否带 UTF-8 BOM。内核不剥 BOM，带 BOM 时第一条规则会失效，因此保存时一律不写回。 */
    bom: boolean;
}

export type ReadResult = { ok: true, snapshot: SyncIgnoreSnapshot } | { ok: false, message: string };

export interface WriteResult {
    ok: boolean;
    message: string;
}

const normalize = (raw: string) => raw.replace(/\r\n?/g, "\n");

/** 读取失败时响应体是 JSON；解析不出来就退回状态码。 */
const readFailureBody = async (response: Response) => {
    try {
        return await response.json() as { code?: number, msg?: string };
    } catch {
        return undefined;
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
        const body = await readFailureBody(response);
        // 文件不存在是正常状态：没有自定义忽略规则，等同于空文件
        if (body?.code === 404) {
            return { ok: true, snapshot: { text: "", bom: false } };
        }
        return {
            ok: false,
            message: body?.msg || (body?.code === undefined ? `HTTP ${response.status}` : `code ${body.code}`),
        };
    }
    if (!response.ok) {
        return { ok: false, message: `${response.status} ${response.statusText}` };
    }
    const raw = await response.text();
    const bom = raw.charCodeAt(0) === 0xFEFF;
    return { ok: true, snapshot: { text: normalize(bom ? raw.slice(1) : raw), bom } };
};

export const writeSyncIgnore = async (text: string): Promise<WriteResult> => {
    const form = new FormData();
    form.append("path", SYNC_IGNORE_PATH);
    form.append("isDir", "false");
    form.append("file", new Blob([text], { type: "text/plain" }), "syncignore");
    let response: Response;
    try {
        response = await fetch("/api/file/putFile", { method: "POST", body: form });
    } catch (error) {
        return { ok: false, message: String(error) };
    }
    const body = await readFailureBody(response);
    // 只认 code 为 0 的 JSON 应答；拿不到 JSON 或状态码异常都算失败
    if (!response.ok || body?.code !== 0) {
        return { ok: false, message: body?.msg || `${response.status} ${response.statusText}` };
    }
    return { ok: true, message: "" };
};

export type LintKind = "emptyNegation" | "invalidEscape" | "unclosedClass" | "unbalancedGroup" | "badRepetition";

export interface LintIssue {
    /** 1 起始的行号 */
    line: number;
    kind: LintKind;
}

// 内核用 sabhiram/go-gitignore 把每条规则转成正则再编译，编译失败的规则会被静默丢弃。
// 转换时只有 `*` 变成 `([^/]*)`、`.` 和 `?` 被转义，其余字符原样进正则，
// 所以下面这些写法会让整条规则失效（取值来自 20210923 版源码与 RE2 实测）：
// - `\` 后面是 RE2 不接受的字符（非 ASCII 以外的标点都合法，字母只认 abdfnrstvwzABDQSW，
//   1-9 与其它字母都不合法），或者 `\` 在行尾；
// - `[` 没有闭合；
// - 圆括号不成对；
// - `+` 紧跟在 `+`、`(`、`|` 后面。
// 反过来 `\!`、`\#`、`\]`、`\*`、`a\b`（这个词边界）都能编译，只改变含义而不失效，不报。
const ESCAPE_LETTERS = "abdfnrstvwzABDQSW";

const isAllowedEscape = (char: string, after: string | undefined) => {
    // \p{L} / \pL 这类 Unicode 类只有带上类名时才有效
    if ((char === "p" || char === "P") && after !== undefined && /[A-Za-z{]/.test(after)) {
        return true;
    }
    if (char.charCodeAt(0) >= 0x80) {
        return false;
    }
    if (/[A-Za-z]/.test(char)) {
        return ESCAPE_LETTERS.includes(char);
    }
    return !/[1-9]/.test(char);
};

/** 返回这一行会让内核丢掉规则的写法，没有则返回 null。 */
const lintRule = (rule: string): LintKind | null => {
    let openGroup = 0;
    let inClass = false;
    // 字符类里已读的内容长度，用来识别 `[ ]]` 这种紧跟开头的字面 `]`
    let classLength = 0;
    // 上一个未转义字符，用来判断 `+` 前面是不是无法重复的位置
    let previous = "";
    for (let index = 0; index < rule.length; index++) {
        const char = rule[index];
        if (char === "\\") {
            const escaped = rule[index + 1];
            if (escaped === undefined || !isAllowedEscape(escaped, rule[index + 2])) {
                return "invalidEscape";
            }
            // 被转义的字符不再参与括号、字符类和重复的判断
            index++;
            previous = "";
            classLength++;
            continue;
        }
        if (inClass) {
            if (char !== "]") {
                classLength++;
            } else if (classLength === 0) {
                classLength++;
            } else {
                inClass = false;
            }
            continue;
        }
        if (char === "[") {
            inClass = true;
            classLength = 0;
            previous = "";
        } else if (char === "(") {
            openGroup++;
            previous = char;
        } else if (char === ")") {
            if (!openGroup) {
                return "unbalancedGroup";
            }
            openGroup--;
            previous = char;
        } else if (char === "+") {
            if (previous === "(" || previous === "|" || rule[index + 1] === "+") {
                return "badRepetition";
            }
            previous = char;
        } else {
            previous = char;
        }
    }
    if (inClass) {
        return "unclosedClass";
    }
    return openGroup ? "unbalancedGroup" : null;
};

/**
 * 只报「内核会静默丢弃这条规则」的写法，不做风格建议（缺前导斜杠、重复行、行尾空白一律不提示）。
 * 规则是否真的命中文件由内核在同步时判定，这里不实现匹配引擎。
 */
export const lintSyncIgnore = (text: string): LintIssue[] => {
    const issues: LintIssue[] = [];
    text.split("\n").forEach((raw, index) => {
        // 与内核一致：整行以 # 开头就是注释，这个判断在去掉首尾空格之前
        if (raw.startsWith("#")) {
            return;
        }
        const rule = raw.trim();
        if (!rule) {
            return;
        }
        // 取反规则的前缀不参与判断
        const kind = rule === "!" ? "emptyNegation" : lintRule(rule.startsWith("!") ? rule.slice(1) : rule);
        if (kind) {
            issues.push({ line: index + 1, kind });
        }
    });
    return issues;
};
