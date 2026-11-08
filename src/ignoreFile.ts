// 忽略文件的读写。
//
// 内核没有提供这些文件的专用接口，只能走原始文件 API：
// - 读：POST /api/file/getFile，成功时返回裸文本，失败时返回 HTTP 202 + JSON 错误体；
// - 写：POST /api/file/putFile，multipart 表单，返回 {code, msg, data}。
// 插件 API 的 fetchSyncPost 会把响应体直接当 JSON 解析，读到文本文件时必然抛错，
// 因此这里直接用 fetch，请求同源、鉴权方式与宿主一致。
import { ignoreFilePath } from "./ignoreFiles";
import type { IgnoreFileName } from "./ignoreFiles";

export interface IgnoreFileSnapshot {
    /** 已经去掉 BOM、行尾统一为 \n 的正文。 */
    text: string;
    /** 原文件是否带 UTF-8 BOM。内核不剥 BOM，带 BOM 时第一条规则会失效，因此保存时一律不写回。 */
    bom: boolean;
}

export type ReadResult = { ok: true, snapshot: IgnoreFileSnapshot } | { ok: false, message: string };

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

export const readIgnoreFile = async (name: IgnoreFileName): Promise<ReadResult> => {
    let response: Response;
    try {
        response = await fetch("/api/file/getFile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: ignoreFilePath(name) }),
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

export const writeIgnoreFile = async (name: IgnoreFileName, text: string): Promise<WriteResult> => {
    const form = new FormData();
    form.append("path", ignoreFilePath(name));
    form.append("isDir", "false");
    form.append("file", new Blob([text], { type: "text/plain" }), name);
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
