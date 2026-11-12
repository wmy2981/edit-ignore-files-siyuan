import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decideFileSwitch } from "../src/fileSwitch";

const base = {
    active: "syncignore" as const,
    loading: false,
    blocked: false,
};

// 未保存的改动留在草稿里，切换文件不再需要确认丢弃，只有「读取期间」这一个特例要处理。
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

    test("loads another file during loading", () => {
        assert.equal(decideFileSwitch("indexignore", { ...base, loading: true }), "load");
    });

    test("loads another file directly", () => {
        assert.equal(decideFileSwitch("indexignore", base), "load");
    });
});
