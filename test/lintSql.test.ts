import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { lintSql } from "../src/lintSql";

// 用例对齐内核实际行为：searchignore / refsearchignore 的每一行会被 " AND " 拼到查询后面，
// 下面这些写法拼出来的语句都在 SQLite 上实测报错，因此必须提示。
describe("lintSql", () => {
    test("accepts plain conditions", () => {
        const text = [
            "type != 'l'",
            "box != '20210808180117-6v0mkx5'",
            "box != 'a' AND type != 'd'",
            "(type != 'l' OR type != 'i')",
            "content LIKE '%todo%'",
            "length > 100",
        ].join("\n");
        assert.deepEqual(lintSql(text), []);
    });

    test("accepts an empty file and a leading blank line", () => {
        assert.deepEqual(lintSql(""), []);
        // 内核只剔除第一个空元素，第一行留空是安全的
        assert.deepEqual(lintSql("\ntype != 'l'"), []);
    });

    test("accepts a hash inside a string", () => {
        assert.deepEqual(lintSql("content != '#tag'"), []);
    });

    test("reports the blank line a trailing newline creates", () => {
        // 末尾换行会多出一个空元素，拼出悬空的 AND
        assert.deepEqual(lintSql("type != 'l'\n"), [{ line: 2, kind: "emptyLine" }]);
        assert.deepEqual(lintSql("type != 'l'\n\n"), [
            { line: 2, kind: "emptyLine" },
            { line: 3, kind: "emptyLine" },
        ]);
    });

    test("reports an interior blank line and whitespace-only lines", () => {
        assert.deepEqual(lintSql("type != 'l'\n\ntype != 'd'"), [{ line: 2, kind: "emptyLine" }]);
        assert.deepEqual(lintSql("type != 'l'\n   \ntype != 'd'"), [{ line: 2, kind: "emptyLine" }]);
    });

    test("reports a line that starts with #", () => {
        assert.deepEqual(lintSql("# 说明"), [{ line: 1, kind: "commentLine" }]);
        assert.deepEqual(lintSql("  # 说明"), [{ line: 1, kind: "commentLine" }]);
    });

    test("reports an unpaired single quote", () => {
        assert.deepEqual(lintSql("content != 'a"), [{ line: 1, kind: "unbalancedQuote" }]);
        assert.deepEqual(lintSql("content != 'a''b'"), []);
    });

    test("reports unbalanced parentheses", () => {
        assert.deepEqual(lintSql("(type != 'l'"), [{ line: 1, kind: "unbalancedParen" }]);
        assert.deepEqual(lintSql("type != 'l')"), [{ line: 1, kind: "unbalancedParen" }]);
        assert.deepEqual(lintSql("(type != 'l')"), []);
        // 引号里的括号不参与判断
        assert.deepEqual(lintSql("content != '(unclosed'"), []);
    });

    test("reports a semicolon outside a string", () => {
        assert.deepEqual(lintSql("type != 'l'; DROP TABLE blocks"), [{ line: 1, kind: "statementSeparator" }]);
        assert.deepEqual(lintSql("content != 'a;b'"), []);
    });

    test("reports a dangling operator", () => {
        assert.deepEqual(lintSql("AND type != 'l'"), [{ line: 1, kind: "danglingOperator" }]);
        assert.deepEqual(lintSql("OR type != 'l'"), [{ line: 1, kind: "danglingOperator" }]);
        assert.deepEqual(lintSql("type != 'l' OR"), [{ line: 1, kind: "danglingOperator" }]);
        assert.deepEqual(lintSql("type !="), [{ line: 1, kind: "danglingOperator" }]);
        assert.deepEqual(lintSql("content NOT"), [{ line: 1, kind: "danglingOperator" }]);
        // 值里带关键字的字符串不算悬空
        assert.deepEqual(lintSql("content != 'AND'"), []);
        assert.deepEqual(lintSql("content NOT LIKE '%a%'"), []);
    });

    test("reports the real line numbers", () => {
        const text = ["type != 'l'", "# note", "(box != 'a'", "type != 'd'"].join("\n");
        assert.deepEqual(lintSql(text), [
            { line: 2, kind: "commentLine" },
            { line: 3, kind: "unbalancedParen" },
        ]);
    });
});
