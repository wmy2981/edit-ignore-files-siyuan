import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
    DEFAULT_IGNORE_FILE,
    IGNORE_FILES,
    getIgnoreSyntax,
    ignoreFilePath,
    isIgnoreFileName,
} from "../src/ignoreFiles";

describe("IGNORE_FILES", () => {
    test("lists the five ignore files in panel order", () => {
        assert.deepEqual(IGNORE_FILES.map(file => file.name), [
            "syncignore",
            "indexignore",
            "embeddingignore",
            "searchignore",
            "refsearchignore",
        ]);
    });

    test("assigns the gitignore syntax to the path rules", () => {
        for (const name of ["syncignore", "indexignore", "embeddingignore"] as const) {
            assert.equal(getIgnoreSyntax(name), "gitignore");
        }
    });

    test("assigns the sql syntax to the condition fragments", () => {
        assert.equal(getIgnoreSyntax("searchignore"), "sql");
        assert.equal(getIgnoreSyntax("refsearchignore"), "sql");
    });

    test("defaults to syncignore", () => {
        assert.equal(DEFAULT_IGNORE_FILE, "syncignore");
        assert.ok(IGNORE_FILES.some(file => file.name === DEFAULT_IGNORE_FILE));
    });
});

describe("isIgnoreFileName", () => {
    test("accepts every listed name", () => {
        for (const { name } of IGNORE_FILES) {
            assert.equal(isIgnoreFileName(name), true);
        }
    });

    test("rejects anything else", () => {
        assert.equal(isIgnoreFileName("conf.json"), false);
        assert.equal(isIgnoreFileName(""), false);
        assert.equal(isIgnoreFileName(undefined), false);
        assert.equal(isIgnoreFileName(null), false);
        assert.equal(isIgnoreFileName(42), false);
    });
});

describe("ignoreFilePath", () => {
    test("points at data/.siyuan", () => {
        assert.equal(ignoreFilePath("syncignore"), "data/.siyuan/syncignore");
        assert.equal(ignoreFilePath("refsearchignore"), "data/.siyuan/refsearchignore");
    });
});
