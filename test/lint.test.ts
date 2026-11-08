import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { lintSyncIgnore } from "../src/syncignore";

// 用例全部对齐内核实际行为：sabhiram/go-gitignore 把正则编译失败的行静默丢弃，
// 因此这里只断言「这条规则会被内核跳过」，不断言风格建议。
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

    test("does not report style suggestions", () => {
        // 缺前导斜杠、重复行、行尾空白都只是建议，一律不报
        const text = ["temp/**", "temp/**", "/assets/*.pdf ", ""].join("\n");
        assert.deepEqual(lintSyncIgnore(text), []);
    });

    test("accepts escapes the kernel can compile", () => {
        // \! \# \] \[ \* \+ 与 \p{L} 都能编译，只是改变含义，不算失效
        const text = ["/a\\!b", "/a\\#b", "/a\\]b", "/a\\[b", "/a\\*b", "/a\\+b", "/a\\p{L}"].join("\n");
        assert.deepEqual(lintSyncIgnore(text), []);
    });

    test("accepts a backslash that forms a valid regex escape", () => {
        // \b、\d、\s 之类是合法转义（词边界、数字、空白），规则本身仍会编译
        assert.deepEqual(lintSyncIgnore("/a\\bb"), []);
        assert.deepEqual(lintSyncIgnore("/a\\db"), []);
        assert.deepEqual(lintSyncIgnore("/assets\\*.pdf"), []);
    });

    test("reports an escape the kernel rejects", () => {
        // go-gitignore 只转义 . 和 ?，其余反斜杠原样进正则，非法转义会让整行失效
        assert.deepEqual(lintSyncIgnore("/a\\yb"), [{ line: 1, kind: "invalidEscape" }]);
        assert.deepEqual(lintSyncIgnore("/a\\cb"), [{ line: 1, kind: "invalidEscape" }]);
        assert.deepEqual(lintSyncIgnore("/a\\1b"), [{ line: 1, kind: "invalidEscape" }]);
        assert.deepEqual(lintSyncIgnore("/a\\中b"), [{ line: 1, kind: "invalidEscape" }]);
    });

    test("reports a trailing backslash", () => {
        // 行尾反斜杠会转义内核追加的右括号，整行编译失败
        assert.deepEqual(lintSyncIgnore("/assets\\"), [{ line: 1, kind: "invalidEscape" }]);
    });

    test("reports a negation without a rule", () => {
        assert.deepEqual(lintSyncIgnore("!"), [{ line: 1, kind: "emptyNegation" }]);
        assert.deepEqual(lintSyncIgnore("!   "), [{ line: 1, kind: "emptyNegation" }]);
    });

    test("reports an unclosed character class", () => {
        assert.deepEqual(lintSyncIgnore("/assets/[ab.pdf"), [{ line: 1, kind: "unclosedClass" }]);
        assert.deepEqual(lintSyncIgnore("/assets/[ab].pdf"), []);
    });

    test("accepts a literal closing bracket without an opening one", () => {
        assert.deepEqual(lintSyncIgnore("/assets/ab].pdf"), []);
        assert.deepEqual(lintSyncIgnore("/assets/[]].pdf"), []);
    });

    test("reports unbalanced parentheses", () => {
        assert.deepEqual(lintSyncIgnore("/assets/(ab"), [{ line: 1, kind: "unbalancedGroup" }]);
        assert.deepEqual(lintSyncIgnore("/assets/ab)"), [{ line: 1, kind: "unbalancedGroup" }]);
        assert.deepEqual(lintSyncIgnore("/assets/(ab)"), []);
        assert.deepEqual(lintSyncIgnore("/assets/\\(ab"), []);
    });

    test("ignores parentheses inside a character class", () => {
        assert.deepEqual(lintSyncIgnore("/assets/[(]ab"), []);
        assert.deepEqual(lintSyncIgnore("/assets/[a(b]cd"), []);
    });

    test("reports a plus that cannot repeat anything", () => {
        assert.deepEqual(lintSyncIgnore("/assets/a++b"), [{ line: 1, kind: "badRepetition" }]);
        assert.deepEqual(lintSyncIgnore("/assets/(+a)"), [{ line: 1, kind: "badRepetition" }]);
        assert.deepEqual(lintSyncIgnore("/a|+b"), [{ line: 1, kind: "badRepetition" }]);
        // 加号本身是合法量词，只有位置不对才失效
        assert.deepEqual(lintSyncIgnore("/assets/a+b"), []);
        assert.deepEqual(lintSyncIgnore("/assets/a\\+b"), []);
    });

    test("ignores comments and blank lines", () => {
        const text = ["# a\\y", "", "   ", "/assets/*.pdf"].join("\n");
        assert.deepEqual(lintSyncIgnore(text), []);
    });

    test("reports the real line numbers", () => {
        const text = ["# head", "", "/assets/", "/a\\yb", "!", "/x/[a"].join("\n");
        assert.deepEqual(lintSyncIgnore(text), [
            { line: 4, kind: "invalidEscape" },
            { line: 5, kind: "emptyNegation" },
            { line: 6, kind: "unclosedClass" },
        ]);
    });

    test("checks negated rules as well", () => {
        assert.deepEqual(lintSyncIgnore("!assets\\manual"), [{ line: 1, kind: "invalidEscape" }]);
        assert.deepEqual(lintSyncIgnore("!assets/(manual"), [{ line: 1, kind: "unbalancedGroup" }]);
    });
});
