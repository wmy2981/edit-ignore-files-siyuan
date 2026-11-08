import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { lintSyncIgnore } from "../src/syncignore";

describe("lintSyncIgnore", () => {
    test("returns nothing for an empty file", () => {
        assert.deepEqual(lintSyncIgnore(""), []);
    });

    test("accepts comments, plain rules and negated rules", () => {
        const text = [
            "# 说明",
            "/assets/",
            "/assets/*.pdf",
            "**/temp/**",
            "!assets/manual/*.pdf",
            "",
        ].join("\n");
        assert.deepEqual(lintSyncIgnore(text), []);
    });

    test("does not report style suggestions any more", () => {
        // 缺前导斜杠、重复行、行尾空白都只是建议，现在一律不报
        const text = ["temp/**", "temp/**", "/assets/*.pdf ", ""].join("\n");
        assert.deepEqual(lintSyncIgnore(text), []);
    });

    test("reports a backslash because the matcher only uses /", () => {
        assert.deepEqual(lintSyncIgnore("/assets\\*.pdf"), [{ line: 1, kind: "backslash" }]);
    });

    test("reports a negation without a rule", () => {
        assert.deepEqual(lintSyncIgnore("!"), [{ line: 1, kind: "emptyNegation" }]);
        assert.deepEqual(lintSyncIgnore("!   "), [{ line: 1, kind: "emptyNegation" }]);
    });

    test("reports an unclosed character class", () => {
        assert.deepEqual(lintSyncIgnore("/assets/[ab.pdf"), [{ line: 1, kind: "unclosedClass" }]);
        assert.deepEqual(lintSyncIgnore("/assets/[ab].pdf"), []);
    });

    test("ignores comments and blank lines", () => {
        const text = ["# a\\b", "", "   ", "/assets/*.pdf"].join("\n");
        assert.deepEqual(lintSyncIgnore(text), []);
    });

    test("reports the real line numbers", () => {
        const text = ["# head", "", "/assets/", "a\\b", "!", "/x/[a"].join("\n");
        assert.deepEqual(lintSyncIgnore(text), [
            { line: 4, kind: "backslash" },
            { line: 5, kind: "emptyNegation" },
            { line: 6, kind: "unclosedClass" },
        ]);
    });

    test("checks negated rules for backslashes too", () => {
        assert.deepEqual(lintSyncIgnore("!assets\\manual"), [{ line: 1, kind: "backslash" }]);
    });
});
