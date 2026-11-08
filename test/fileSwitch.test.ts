import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decideFileSwitch } from "../src/fileSwitch";

const base = {
    active: "syncignore" as const,
    loading: false,
    dirty: false,
    blocked: false,
};

describe("decideFileSwitch", () => {
    test("restores the select when a switch is blocked", () => {
        assert.equal(decideFileSwitch("indexignore", { ...base, blocked: true }), "restore");
    });

    test("restores the select when the current file is chosen again", () => {
        assert.equal(decideFileSwitch("syncignore", base), "restore");
    });

    test("cancels the pending read when the current file is chosen during loading", () => {
        // 读取期间 active 仍是旧文件，选回它表示取消这次切换
        assert.equal(decideFileSwitch("syncignore", { ...base, loading: true }), "cancel");
    });

    test("loads another file during loading without asking again", () => {
        assert.equal(decideFileSwitch("indexignore", { ...base, loading: true, dirty: true }), "load");
    });

    test("asks before discarding edits when not loading", () => {
        assert.equal(decideFileSwitch("indexignore", { ...base, dirty: true }), "confirm");
    });

    test("loads directly when there is nothing to lose", () => {
        assert.equal(decideFileSwitch("indexignore", base), "load");
    });
});
