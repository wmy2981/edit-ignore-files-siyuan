import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { readSyncIgnore, writeSyncIgnore } from "../src/syncignore";

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

describe("readSyncIgnore", () => {
    test("normalises CRLF and keeps the file body", async () => {
        stubFetch(() => response(200, "/assets/*.pdf\r\n!assets/manual/*.pdf\r\n"));
        const result = await readSyncIgnore();
        assert.equal(result.ok, true);
        assert.deepEqual(result.ok && result.snapshot, {
            text: "/assets/*.pdf\n!assets/manual/*.pdf\n",
            bom: false,
        });
        assert.equal(calls[0].url, "/api/file/getFile");
        assert.equal(calls[0].init?.method, "POST");
        assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { path: "data/.siyuan/syncignore" });
    });

    test("strips a UTF-8 BOM and remembers it for the write back", async () => {
        stubFetch(() => response(200, "\uFEFF/assets/"));
        const result = await readSyncIgnore();
        assert.equal(result.ok, true);
        assert.deepEqual(result.ok && result.snapshot, { text: "/assets/", bom: true });
    });

    test("treats HTTP 202 as a failure and surfaces the kernel message", async () => {
        stubFetch(() => response(202, JSON.stringify({ code: -1, msg: "path does not exist" })));
        const result = await readSyncIgnore();
        assert.deepEqual(result, { ok: false, message: "path does not exist" });
    });

    test("falls back to the status code when the failure body is not JSON", async () => {
        stubFetch(() => response(202, "not json"));
        const result = await readSyncIgnore();
        assert.deepEqual(result, { ok: false, message: "HTTP 202" });
    });

    test("reports other HTTP errors", async () => {
        stubFetch(() => response(404, "", "Not Found"));
        const result = await readSyncIgnore();
        assert.deepEqual(result, { ok: false, message: "404 Not Found" });
    });

    test("reports a network failure instead of throwing", async () => {
        globalThis.fetch = (async () => {
            throw new Error("offline");
        }) as unknown as typeof fetch;
        const result = await readSyncIgnore();
        assert.deepEqual(result, { ok: false, message: "Error: offline" });
    });
});

describe("writeSyncIgnore", () => {
    test("posts the body as multipart form data with the fixed path", async () => {
        stubFetch(() => response(200, JSON.stringify({ code: 0, msg: "", data: null })));
        const result = await writeSyncIgnore("/assets/", false);
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

    test("writes the BOM back when the file had one", async () => {
        stubFetch(() => response(200, JSON.stringify({ code: 0 })));
        await writeSyncIgnore("/assets/", true);
        const file = (calls[0].init?.body as FormData).get("file") as File;
        // Blob.text() 会在解码时吃掉 BOM，这里直接看字节
        const bytes = new Uint8Array(await file.arrayBuffer());
        assert.deepEqual(Array.from(bytes.slice(0, 3)), [0xEF, 0xBB, 0xBF]);
        assert.equal(new TextDecoder().decode(bytes.slice(3)), "/assets/");
    });

    test("surfaces a kernel error code", async () => {
        stubFetch(() => response(200, JSON.stringify({ code: -1, msg: "refuse to write" })));
        const result = await writeSyncIgnore("/assets/", false);
        assert.deepEqual(result, { ok: false, message: "refuse to write" });
    });

    test("reports an HTTP failure without a JSON body", async () => {
        stubFetch(() => response(500, "<html>boom</html>", "Internal Server Error"));
        const result = await writeSyncIgnore("/assets/", false);
        assert.deepEqual(result, { ok: false, message: "500 Internal Server Error" });
    });

    test("reports a network failure instead of throwing", async () => {
        globalThis.fetch = (async () => {
            throw new Error("offline");
        }) as unknown as typeof fetch;
        const result = await writeSyncIgnore("/assets/", false);
        assert.deepEqual(result, { ok: false, message: "Error: offline" });
    });
});
