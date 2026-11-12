import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { STATUS_KEYS, STATUS_TONES, statusDescribe } from "../src/status";
import type { EditorStatusKind } from "../src/status";

const KINDS = Object.keys(STATUS_KEYS) as EditorStatusKind[];

describe("status", () => {
    test("gives every status a tone and a text key", () => {
        for (const kind of KINDS) {
            assert.equal(typeof STATUS_TONES[kind], "string", kind);
            assert.equal(typeof STATUS_KEYS[kind], "string", kind);
        }
    });

    test("uses a distinct key per status", () => {
        assert.equal(new Set(Object.values(STATUS_KEYS)).size, KINDS.length);
    });

    test("tells success, pending work and failures apart by tone", () => {
        assert.equal(STATUS_TONES.saved, "success");
        assert.equal(STATUS_TONES.draft, "warning");
        assert.equal(STATUS_TONES.external, "warning");
        for (const kind of ["saveFailed", "readFailed", "verifyFailed"] as const) {
            assert.equal(STATUS_TONES[kind], "error", kind);
        }
    });

    test("fills the reason into the failure text", () => {
        const t = (key: string) => ({ statusSaveFailed: "保存失败：{msg}", statusSaved: "已保存" }[key] ?? "");
        assert.equal(statusDescribe({ kind: "saveFailed", message: "code 409" }, t), "保存失败：code 409");
    });

    test("leaves the text alone when there is no reason", () => {
        const t = (key: string) => (key === "statusSaved" ? "已保存" : "");
        assert.equal(statusDescribe({ kind: "saved" }, t), "已保存");
    });
});
