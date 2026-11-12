// 忽略文件的读写。
//
// 两类读写方式：
// - 前五个文件内核没有专用接口，只能走原始文件 API：读 POST /api/file/getFile（成功时返回裸文本，
//   失败时返回 HTTP 202 + JSON 错误体），写 POST /api/file/putFile（multipart 表单）。
// - assets-cleanup-ignore 有专用接口：读 POST /api/asset/getAssetCleanupIgnore、写
//   POST /api/asset/setAssetCleanupIgnore。写入要带上读取时拿到的 revision，内核发现文件被别人改过
//   就返回 code 409 且不覆盖；内容也会先经过内核同一套规则校验，写错的规则不会落盘。
// 两类都用裸 fetch：插件 API 的 fetchSyncPost 会把响应体直接当 JSON 解析，读文本文件时必然抛错，
// 请求同源、鉴权方式与宿主一致。
import { ASSET_CLEANUP_FILE, ignoreFilePath } from "./ignoreFiles";
import type { IgnoreFileName } from "./ignoreFiles";

export interface IgnoreFileSnapshot {
    /** 已经去掉 BOM、行尾统一为 \n 的正文。 */
    text: string;
    /** 原文件是否带 UTF-8 BOM。同步类忽略文件的内核不剥 BOM，带 BOM 时第一条规则会失效，因此保存时一律不写回。 */
    bom: boolean;
    /** 不透明版本号，只有 assets-cleanup-ignore 有：写回时必须原样带上，否则内核判定冲突。 */
    revision?: string;
}

export type ReadResult = { ok: true, snapshot: IgnoreFileSnapshot } | { ok: false, message: string };

export interface WriteResult {
    ok: boolean;
    message: string;
    /** 内核判定忽略文件在读取之后又被改过，需要重读后再写（code 409）。 */
    conflict?: boolean;
}

/** 内核统一应答体：code 为 0 表示成功，msg 是错误文案，data 是可选载荷。 */
interface KernelReply<T> {
    code?: number;
    msg?: string;
    data?: T;
}

interface AssetCleanupIgnoreData {
    content?: string;
    revision?: string;
}

const normalize = (raw: string) => raw.replace(/\r\n?/g, "\n");

/** 读取失败时响应体是 JSON；解析不出来就退回状态码。 */
const readReply = async <T>(response: Response): Promise<KernelReply<T> | undefined> => {
    try {
        return await response.json() as KernelReply<T>;
    } catch {
        return undefined;
    }
};

const statusMessage = (response: Response) => `${response.status} ${response.statusText}`;

type PostResult<T> = { ok: true, response: Response, reply: KernelReply<T> | undefined } | { ok: false, message: string };

const postJson = async <T>(path: string, body: unknown): Promise<PostResult<T>> => {
    try {
        const response = await fetch(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        return { ok: true, response, reply: await readReply<T>(response) };
    } catch (error) {
        // 网络层失败时响应体都没有，调用方按失败处理
        return { ok: false, message: String(error) };
    }
};

const snapshotOf = (raw: string, revision?: string): IgnoreFileSnapshot => {
    const bom = raw.charCodeAt(0) === 0xFEFF;
    const snapshot: IgnoreFileSnapshot = { text: normalize(bom ? raw.slice(1) : raw), bom };
    // 只有走专用接口的文件才有版本号，其它文件不带这个字段
    if (revision !== undefined) {
        snapshot.revision = revision;
    }
    return snapshot;
};

const readTextIgnoreFile = async (name: IgnoreFileName): Promise<ReadResult> => {
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
        const body = await readReply<unknown>(response);
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
        return { ok: false, message: statusMessage(response) };
    }
    return { ok: true, snapshot: snapshotOf(await response.text()) };
};

const readAssetCleanupIgnore = async (): Promise<ReadResult> => {
    const result = await postJson<AssetCleanupIgnoreData>("/api/asset/getAssetCleanupIgnore", {});
    if (!result.ok) {
        return { ok: false, message: result.message };
    }
    const { response, reply: body } = result;
    if (!response.ok || body?.code !== 0) {
        return { ok: false, message: body?.msg || statusMessage(response) };
    }
    // 文件不存在时内核返回空正文与 revision "missing"；读失败走的是上面的错误分支，不会被当成空文件
    const data = body.data ?? {};
    return { ok: true, snapshot: snapshotOf(data.content ?? "", String(data.revision ?? "")) };
};

const writeTextIgnoreFile = async (name: IgnoreFileName, text: string): Promise<WriteResult> => {
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
    const body = await readReply<unknown>(response);
    // 只认 code 为 0 的 JSON 应答；拿不到 JSON 或状态码异常都算失败
    if (!response.ok || body?.code !== 0) {
        return { ok: false, message: body?.msg || statusMessage(response) };
    }
    return { ok: true, message: "" };
};

const writeAssetCleanupIgnore = async (text: string, revision: string): Promise<WriteResult> => {
    const result = await postJson<AssetCleanupIgnoreData>("/api/asset/setAssetCleanupIgnore", {
        content: text,
        expectedRevision: revision,
    });
    if (!result.ok) {
        return { ok: false, message: result.message };
    }
    const { response, reply: body } = result;
    if (body?.code === 409) {
        // 内核保留了别人的改动，空着手回去重读一次再让用户决定
        return { ok: false, conflict: true, message: body.msg || statusMessage(response) };
    }
    if (!response.ok || body?.code !== 0) {
        return { ok: false, message: body?.msg || statusMessage(response) };
    }
    return { ok: true, message: "" };
};

export const readIgnoreFile = async (name: IgnoreFileName): Promise<ReadResult> =>
    name === ASSET_CLEANUP_FILE ? readAssetCleanupIgnore() : readTextIgnoreFile(name);

/**
 * 写入忽略文件。revision 只有 assets-cleanup-ignore 需要，取最近一次读取或写入拿到的值；
 * 其它文件内核没有并发校验，靠调用方重读比对。
 */
export const writeIgnoreFile = async (name: IgnoreFileName, text: string, revision?: string): Promise<WriteResult> =>
    name === ASSET_CLEANUP_FILE ? writeAssetCleanupIgnore(text, revision ?? "") : writeTextIgnoreFile(name, text);
