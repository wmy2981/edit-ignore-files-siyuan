import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { IGNORE_FILES } from "../src/ignoreFiles";
import { LINT_KEYS } from "../src/lint";
import { STATUS_KEYS } from "../src/status";

// 文案键有一部分是拼出来的（desc<Key> / guide<Key>1..4），漏一条只会表现为空白说明，
// 编译器和类型都发现不了，所以在这里核对两种语言都有键、键集合一致。
const LOCALES = ["zh-CN", "en"] as const;

const load = (locale: string): Record<string, string> => {
    const file = path.join(__dirname, "..", "..", "src", "i18n", `${locale}.json`);
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
};

const messages = Object.fromEntries(LOCALES.map(locale => [locale, load(locale)])) as Record<string, Record<string, string>>;

const keyOf = (name: string, prefix: string, suffix = "") => {
    const stem = IGNORE_FILES.find(file => file.name === name)?.i18nKey ?? name;
    return `${prefix}${stem.charAt(0).toUpperCase()}${stem.slice(1)}${suffix}`;
};

describe("i18n", () => {
    test("keeps the same keys in every locale", () => {
        const [first, ...rest] = LOCALES;
        const expected = Object.keys(messages[first]).sort();
        for (const locale of rest) {
            assert.deepEqual(Object.keys(messages[locale]).sort(), expected, locale);
        }
    });

    test("translates every file description and guide item", () => {
        for (const locale of LOCALES) {
            for (const { name } of IGNORE_FILES) {
                const keys = [keyOf(name, "desc"), keyOf(name, "guide", "1"), keyOf(name, "guide", "2"),
                    keyOf(name, "guide", "3"), keyOf(name, "guide", "4")];
                for (const key of keys) {
                    assert.equal(typeof messages[locale][key], "string", `${locale}: ${key}`);
                    assert.notEqual(messages[locale][key].trim(), "", `${locale}: ${key}`);
                }
            }
        }
    });

    test("translates every editor status", () => {
        for (const locale of LOCALES) {
            for (const key of Object.values(STATUS_KEYS)) {
                assert.equal(typeof messages[locale][key], "string", `${locale}: ${key}`);
            }
        }
    });

    test("translates the panel controls", () => {
        // 这几个键由面板直接取用，漏掉只表现为空白按钮或空状态
        const keys = ["itemTitle", "guideSummary", "placeholderGitignore", "placeholderSql", "bomNotice",
            "lintStrictNote", "reload", "reloadConfirm", "reloadHint", "reloadConfirmHint"];
        for (const locale of LOCALES) {
            for (const key of keys) {
                assert.notEqual(messages[locale][key]?.trim(), "", `${locale}: ${key}`);
            }
        }
    });

    test("translates every lint kind", () => {
        for (const locale of LOCALES) {
            for (const key of Object.values(LINT_KEYS)) {
                assert.equal(typeof messages[locale][key], "string", `${locale}: ${key}`);
            }
        }
    });

    test("keeps the {msg} placeholder in the failure statuses", () => {
        // statusDescribe 用 {msg} 填内核或网络的原始报错，少了它就看不出失败原因
        for (const locale of LOCALES) {
            for (const kind of ["saveFailed", "readFailed"] as const) {
                assert.match(messages[locale][STATUS_KEYS[kind]], /\{msg\}/, `${locale}: ${kind}`);
            }
        }
    });

    test("keeps the {line} placeholder in the per-line lint messages", () => {
        // describeIssue 用 {line} 填行号，丢掉占位符会让提示指不出是哪一行
        for (const locale of LOCALES) {
            for (const key of Object.values(LINT_KEYS)) {
                assert.match(messages[locale][key], /\{line\}/, `${locale}: ${key}`);
            }
        }
    });
});
