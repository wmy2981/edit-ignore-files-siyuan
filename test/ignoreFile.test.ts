import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { readIgnoreFile, writeIgnoreFile } from "../src/ignoreFile";

type FakeResponse = {
    status: number;
    statusText?: string;
    ok: boolean;
    text: () => Promise<string>;
    json: () => Promise<unknown>;
};

const response = (status: number, body: string, statusText = ""): FakeResponse => ({
    status,
    statusText,
    ok: status >= 200 && status < 300,
    text: async () => body,
    json: async () => JSON.parse(body),
});

const calls: { url: string, init?: RequestInit }[] = [];

const stubFetch = (handler: () => FakeResponse | Promise<FakeResponse>) => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return await handler();
    }) as unknown as typeof fetch;
};

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
    calls.length = 0;
});

describe("readIgnoreFile", () => {
    test("normalises CRLF and keeps the file body", async () => {
        stubFetch(() => response(200, "/assets/*.pdf\r\n!assets/manual/*.pdf\r\n"));
        const result = await readIgnoreFile("syncignore");
        assert.equal(result.ok, true);
        assert.deepEqual(result.ok && result.snapshot, {
            text: "/assets/*.pdf\n!assets/manual/*.pdf\n",
            bom: false,
        });
        assert.equal(calls[0].url, "/api/file/getFile");
        assert.equal(calls[0].init?.method, "POST");
        assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { path: "data/.siyuan/syncignore" });
    });

    test("strips a UTF-8 BOM from the body and flags it", async () => {
        stubFetch(() => response(200, "\uFEFF/assets/"));
        const result = await readIgnoreFile("syncignore");
        assert.equal(result.ok, true);
        assert.deepEqual(result.ok && result.snapshot, { text: "/assets/", bom: true });
    });

    test("treats a missing file as empty content", async () => {
        // 用户没建过忽略列表时，内核返回 202 + code 404
        stubFetch(() => response(202, JSON.stringify({ code: 404, msg: "not found" })));
        const result = await readIgnoreFile("syncignore");
        assert.deepEqual(result, { ok: true, snapshot: { text: "", bom: false } });
    });

    test("treats other HTTP 202 bodies as failures", async () => {
        stubFetch(() => response(202, JSON.stringify({ code: -1, msg: "path does not exist" })));
        const result = await readIgnoreFile("syncignore");
        assert.deepEqual(result, { ok: false, message: "path does not exist" });
    });

    test("falls back to the status code when the failure body is not JSON", async () => {
        stubFetch(() => response(202, "not json"));
        const result = await readIgnoreFile("syncignore");
        assert.deepEqual(result, { ok: false, message: "HTTP 202" });
    });

    test("falls back to the kernel code when it has no message", async () => {
        stubFetch(() => response(202, JSON.stringify({ code: 500 })));
        const result = await readIgnoreFile("syncignore");
        assert.deepEqual(result, { ok: false, message: "code 500" });
    });

    test("reports other HTTP errors", async () => {
        stubFetch(() => response(404, "", "Not Found"));
        const result = await readIgnoreFile("syncignore");
        assert.deepEqual(result, { ok: false, message: "404 Not Found" });
    });

    test("reports a network failure instead of throwing", async () => {
        globalThis.fetch = (async () => {
            throw new Error("offline");
        }) as unknown as typeof fetch;
        const result = await readIgnoreFile("syncignore");
        assert.deepEqual(result, { ok: false, message: "Error: offline" });
    });

    test("reads the path of the requested file", async () => {
        stubFetch(() => response(200, "type != 'l'"));
        const result = await readIgnoreFile("searchignore");
        assert.deepEqual(result, { ok: true, snapshot: { text: "type != 'l'", bom: false } });
        assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { path: "data/.siyuan/searchignore" });
    });
});

describe("writeIgnoreFile", () => {
    test("posts the body as multipart form data with the fixed path", async () => {
        stubFetch(() => response(200, JSON.stringify({ code: 0, msg: "", data: null })));
        const result = await writeIgnoreFile("syncignore", "/assets/");
        assert.deepEqual(result, { ok: true, message: "" });
        assert.equal(calls[0].url, "/api/file/putFile");
        assert.equal(calls[0].init?.method, "POST");
        const form = calls[0].init?.body as FormData;
        assert.equal(form.get("path"), "data/.siyuan/syncignore");
        assert.equal(form.get("isDir"), "false");
        const file = form.get("file") as File;
        assert.equal(file.name, "syncignore");
        assert.equal(await file.text(), "/assets/");
    });

    test("never writes a BOM, because the kernel does not strip it", async () => {
        stubFetch(() => response(200, JSON.stringify({ code: 0 })));
        await writeIgnoreFile("syncignore", "/assets/");
        const file = (calls[0].init?.body as FormData).get("file") as File;
        // Blob.text() 会在解码时吃掉 BOM，这里直接看字节
        const bytes = new Uint8Array(await file.arrayBuffer());
        assert.notDeepEqual(Array.from(bytes.slice(0, 3)), [0xEF, 0xBB, 0xBF]);
        assert.equal(bytes[0], "/".charCodeAt(0));
    });

    test("surfaces a kernel error code", async () => {
        stubFetch(() => response(200, JSON.stringify({ code: -1, msg: "refuse to write" })));
        const result = await writeIgnoreFile("syncignore", "/assets/");
        assert.deepEqual(result, { ok: false, message: "refuse to write" });
    });

    test("requires code 0 in the response body", async () => {
        // HTTP 200 但应答不是内核的成功体，不能当成写入成功
        stubFetch(() => response(200, "ok", "OK"));
        const result = await writeIgnoreFile("syncignore", "/assets/");
        assert.deepEqual(result, { ok: false, message: "200 OK" });
    });

    test("requires code 0, not just a successful status", async () => {
        stubFetch(() => response(200, JSON.stringify({ msg: "no code" })));
        const result = await writeIgnoreFile("syncignore", "/assets/");
        assert.deepEqual(result, { ok: false, message: "no code" });
    });

    test("reports an HTTP failure without a JSON body", async () => {
        stubFetch(() => response(500, "<html>boom</html>", "Internal Server Error"));
        const result = await writeIgnoreFile("syncignore", "/assets/");
        assert.deepEqual(result, { ok: false, message: "500 Internal Server Error" });
    });

    test("reports a network failure instead of throwing", async () => {
        globalThis.fetch = (async () => {
            throw new Error("offline");
        }) as unknown as typeof fetch;
        const result = await writeIgnoreFile("syncignore", "/assets/");
        assert.deepEqual(result, { ok: false, message: "Error: offline" });
    });

    test("writes to the path and file name of the requested file", async () => {
        stubFetch(() => response(200, JSON.stringify({ code: 0 })));
        await writeIgnoreFile("refsearchignore", "content != 'TODO'");
        const form = calls[0].init?.body as FormData;
        assert.equal(form.get("path"), "data/.siyuan/refsearchignore");
        const file = form.get("file") as File;
        assert.equal(file.name, "refsearchignore");
        assert.equal(await file.text(), "content != 'TODO'");
    });
});

// assets-cleanup-ignore 走内核的专用接口：读回来带 version（revision），写入要原样回传，
// 内容也会先被内核校验，所以这里和上面五个文件的原始文件 API 用例分开。
describe("readIgnoreFile for assets-cleanup-ignore", () => {
    test("uses the asset cleanup API and keeps the revision", async () => {
        stubFetch(() => response(200, JSON.stringify({
            code: 0,
            msg: "",
            data: { content: "/assets/example.png\r\n", revision: "9f2c" },
        })));
        const result = await readIgnoreFile("assets-cleanup-ignore");
        assert.deepEqual(result, { ok: true, snapshot: { text: "/assets/example.png\n", bom: false, revision: "9f2c" } });
        assert.equal(calls[0].url, "/api/asset/getAssetCleanupIgnore");
        assert.equal(calls[0].init?.method, "POST");
        assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {});
    });

    test("strips a UTF-8 BOM and flags it", async () => {
        stubFetch(() => response(200, JSON.stringify({
            code: 0,
            data: { content: "\uFEFF/assets/", revision: "aa" },
        })));
        const result = await readIgnoreFile("assets-cleanup-ignore");
        assert.deepEqual(result, { ok: true, snapshot: { text: "/assets/", bom: true, revision: "aa" } });
    });

    test("keeps the missing revision for a file that does not exist yet", async () => {
        // 文件不存在时内核给空正文与 revision "missing"，保存时把它原样回传即可创建
        stubFetch(() => response(200, JSON.stringify({ code: 0, data: { content: "", revision: "missing" } })));
        const result = await readIgnoreFile("assets-cleanup-ignore");
        assert.deepEqual(result, { ok: true, snapshot: { text: "", bom: false, revision: "missing" } });
    });

    test("reports a kernel error instead of treating it as an empty file", async () => {
        // 读失败（不是不存在）不能让用户以为规则是空的
        stubFetch(() => response(200, JSON.stringify({ code: -1, msg: "must be a regular file" })));
        const result = await readIgnoreFile("assets-cleanup-ignore");
        assert.deepEqual(result, { ok: false, message: "must be a regular file" });
    });

    test("reports an HTTP failure without a JSON body", async () => {
        stubFetch(() => response(500, "<html>boom</html>", "Internal Server Error"));
        const result = await readIgnoreFile("assets-cleanup-ignore");
        assert.deepEqual(result, { ok: false, message: "500 Internal Server Error" });
    });

    test("reports a network failure instead of throwing", async () => {
        globalThis.fetch = (async () => {
            throw new Error("offline");
        }) as unknown as typeof fetch;
        const result = await readIgnoreFile("assets-cleanup-ignore");
        assert.deepEqual(result, { ok: false, message: "Error: offline" });
    });
});

describe("writeIgnoreFile for assets-cleanup-ignore", () => {
    test("posts the content with the expected revision", async () => {
        stubFetch(() => response(200, JSON.stringify({ code: 0, data: { content: "/assets/", revision: "bb" } })));
        const result = await writeIgnoreFile("assets-cleanup-ignore", "/assets/", "aa");
        assert.deepEqual(result, { ok: true, message: "" });
        assert.equal(calls[0].url, "/api/asset/setAssetCleanupIgnore");
        assert.equal(calls[0].init?.method, "POST");
        assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { content: "/assets/", expectedRevision: "aa" });
    });

    test("flags code 409 as a conflict so the editor can re-read", async () => {
        stubFetch(() => response(200, JSON.stringify({ code: 409, msg: "changed; reload before saving" })));
        const result = await writeIgnoreFile("assets-cleanup-ignore", "/assets/", "aa");
        assert.deepEqual(result, { ok: false, conflict: true, message: "changed; reload before saving" });
    });

    test("surfaces the kernel validation message", async () => {
        // 内核会先校验规则，写错的规则不会落盘
        stubFetch(() => response(200, JSON.stringify({ code: -1, msg: "invalid asset cleanup ignore rule at line 2" })));
        const result = await writeIgnoreFile("assets-cleanup-ignore", "/a\\yb", "aa");
        assert.deepEqual(result, { ok: false, message: "invalid asset cleanup ignore rule at line 2" });
    });

    test("requires code 0 in the response body", async () => {
        stubFetch(() => response(200, "ok", "OK"));
        const result = await writeIgnoreFile("assets-cleanup-ignore", "/assets/", "aa");
        assert.deepEqual(result, { ok: false, message: "200 OK" });
    });

    test("reports a network failure instead of throwing", async () => {
        globalThis.fetch = (async () => {
            throw new Error("offline");
        }) as unknown as typeof fetch;
        const result = await writeIgnoreFile("assets-cleanup-ignore", "/assets/", "aa");
        assert.deepEqual(result, { ok: false, message: "Error: offline" });
    });
});
