import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { lintGitignore } from "../src/lintGitignore";

// 用例全部对齐内核实际行为：sabhiram/go-gitignore 把正则编译失败的行静默丢弃，
// 因此这里只断言「这条规则会被内核跳过」，不断言风格建议。
describe("lintGitignore", () => {
    test("returns nothing for an empty file", () => {
        assert.deepEqual(lintGitignore(""), []);
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
        assert.deepEqual(lintGitignore(text), []);
    });

    test("does not report style suggestions", () => {
        // 缺前导斜杠、重复行、行尾空白都只是建议，一律不报
        const text = ["temp/**", "temp/**", "/assets/*.pdf ", ""].join("\n");
        assert.deepEqual(lintGitignore(text), []);
    });

    test("accepts escapes the kernel can compile", () => {
        // \! \# \] \[ \* \+ 都能编译，只是改变含义，不算失效
        const text = ["/a\\!b", "/a\\#b", "/a\\]b", "/a\\[b", "/a\\*b", "/a\\+b"].join("\n");
        assert.deepEqual(lintGitignore(text), []);
    });

    test("accepts a backslash that forms a valid regex escape", () => {
        // \b、\d、\s 是合法转义（词边界、数字、空白），规则本身仍会编译
        assert.deepEqual(lintGitignore("/a\\bb"), []);
        assert.deepEqual(lintGitignore("/a\\db"), []);
        assert.deepEqual(lintGitignore("/assets\\*.pdf"), []);
    });

    test("accepts hex, octal, unicode class and quoted escapes", () => {
        // 这些写法 RE2 都接受，不能报
        const text = ["/a\\x41b", "/a\\x{41}b", "/a\\12b", "/a\\123b", "/a\\0b",
            "/a\\p{L}b", "/a\\pLb", "/a\\Q*\\Eb", "/\\Q\\E", "/a\\Q[b", "/a\\Q(b"].join("\n");
        assert.deepEqual(lintGitignore(text), []);
    });

    test("reports an escape the kernel rejects", () => {
        // go-gitignore 只转义 . 和 ?，其余反斜杠原样进正则，非法转义会让整行失效
        assert.deepEqual(lintGitignore("/a\\yb"), [{ line: 1, kind: "invalidEscape" }]);
        assert.deepEqual(lintGitignore("/a\\cb"), [{ line: 1, kind: "invalidEscape" }]);
        assert.deepEqual(lintGitignore("/a\\1b"), [{ line: 1, kind: "invalidEscape" }]);
        assert.deepEqual(lintGitignore("/a\\8b"), [{ line: 1, kind: "invalidEscape" }]);
        assert.deepEqual(lintGitignore("/a\\xb"), [{ line: 1, kind: "invalidEscape" }]);
        assert.deepEqual(lintGitignore("/a\\pb"), [{ line: 1, kind: "invalidEscape" }]);
        assert.deepEqual(lintGitignore("/a\\中b"), [{ line: 1, kind: "invalidEscape" }]);
    });

    test("reports a trailing backslash", () => {
        // 行尾反斜杠会转义内核追加的右括号，整行编译失败
        assert.deepEqual(lintGitignore("/assets\\"), [{ line: 1, kind: "invalidEscape" }]);
    });

    test("reports a negation without a rule", () => {
        assert.deepEqual(lintGitignore("!"), [{ line: 1, kind: "emptyNegation" }]);
        assert.deepEqual(lintGitignore("!   "), [{ line: 1, kind: "emptyNegation" }]);
    });

    test("reports an unclosed character class", () => {
        assert.deepEqual(lintGitignore("/assets/[ab.pdf"), [{ line: 1, kind: "unclosedClass" }]);
        assert.deepEqual(lintGitignore("/assets/[ab].pdf"), []);
    });

    test("accepts a literal closing bracket without an opening one", () => {
        assert.deepEqual(lintGitignore("/assets/ab].pdf"), []);
        assert.deepEqual(lintGitignore("/assets/[]].pdf"), []);
    });

    test("reports unbalanced parentheses", () => {
        assert.deepEqual(lintGitignore("/assets/(ab"), [{ line: 1, kind: "unbalancedGroup" }]);
        assert.deepEqual(lintGitignore("/assets/ab)"), [{ line: 1, kind: "unbalancedGroup" }]);
        assert.deepEqual(lintGitignore("/assets/(ab)"), []);
        assert.deepEqual(lintGitignore("/assets/\\(ab"), []);
    });

    test("ignores parentheses inside a character class", () => {
        assert.deepEqual(lintGitignore("/assets/[(]ab"), []);
        assert.deepEqual(lintGitignore("/assets/[a(b]cd"), []);
    });

    test("reports a plus that cannot repeat anything", () => {
        assert.deepEqual(lintGitignore("/assets/a++b"), [{ line: 1, kind: "badRepetition" }]);
        assert.deepEqual(lintGitignore("/assets/(+a)"), [{ line: 1, kind: "badRepetition" }]);
        assert.deepEqual(lintGitignore("/a|+b"), [{ line: 1, kind: "badRepetition" }]);
        // 加号本身是合法量词，只有位置不对才失效
        assert.deepEqual(lintGitignore("/assets/a+b"), []);
        assert.deepEqual(lintGitignore("/assets/a\\+b"), []);
    });

    test("reports repeat counts RE2 refuses", () => {
        assert.deepEqual(lintGitignore("/a{2,1}b"), [{ line: 1, kind: "badRepetition" }]);
        assert.deepEqual(lintGitignore("/a{1001}b"), [{ line: 1, kind: "badRepetition" }]);
        assert.deepEqual(lintGitignore("/a{1,2}+b"), [{ line: 1, kind: "badRepetition" }]);
        assert.deepEqual(lintGitignore("/a{2}b"), []);
        assert.deepEqual(lintGitignore("/a{1,2}b"), []);
        assert.deepEqual(lintGitignore("/a{,2}b"), []);
        assert.deepEqual(lintGitignore("/a{b}"), []);
    });

    test("reports a star inside a character class", () => {
        // 内核把 * 换成 ([^/]*)，字符类会被切断，整条规则失效
        assert.deepEqual(lintGitignore("/a[*]b"), [{ line: 1, kind: "starInClass" }]);
        assert.deepEqual(lintGitignore("/a[a*b]c"), [{ line: 1, kind: "starInClass" }]);
        assert.deepEqual(lintGitignore("/a*b"), []);
    });

    test("reports a reversed character class range", () => {
        assert.deepEqual(lintGitignore("/[z-a]"), [{ line: 1, kind: "badClassRange" }]);
        assert.deepEqual(lintGitignore("/a[9-1]b"), [{ line: 1, kind: "badClassRange" }]);
        // 上界是单字符转义时按转义后的字符比较
        assert.deepEqual(lintGitignore("/a[z-\\]]b"), [{ line: 1, kind: "badClassRange" }]);
        assert.deepEqual(lintGitignore("/a[a-z]b"), []);
        assert.deepEqual(lintGitignore("/a[-z]b"), []);
        assert.deepEqual(lintGitignore("/a[z-]b"), []);
        // 多字符转义（\d、\x41）不做范围比较
        assert.deepEqual(lintGitignore("/a[z-\\d]b"), []);
    });

    test("ignores comments and blank lines", () => {
        const text = ["# a\\y", "", "   ", "/assets/*.pdf"].join("\n");
        assert.deepEqual(lintGitignore(text), []);
    });

    test("reports the real line numbers", () => {
        const text = ["# head", "", "/assets/", "/a\\yb", "!", "/x/[a"].join("\n");
        assert.deepEqual(lintGitignore(text), [
            { line: 4, kind: "invalidEscape" },
            { line: 5, kind: "emptyNegation" },
            { line: 6, kind: "unclosedClass" },
        ]);
    });

    test("checks negated rules as well", () => {
        assert.deepEqual(lintGitignore("!assets\\manual"), [{ line: 1, kind: "invalidEscape" }]);
        assert.deepEqual(lintGitignore("!assets/(manual"), [{ line: 1, kind: "unbalancedGroup" }]);
    });
});
