import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
    ASSET_CLEANUP_FILE,
    IGNORE_FILES,
    availableIgnoreFiles,
    getIgnoreDefinition,
    getIgnoreSyntax,
    ignoreFilePath,
} from "../src/ignoreFiles";

describe("IGNORE_FILES", () => {
    test("lists the ignore files in panel order, syncignore first", () => {
        assert.deepEqual(IGNORE_FILES.map(file => file.name), [
            "syncignore",
            "indexignore",
            "embeddingignore",
            "searchignore",
            "refsearchignore",
            "assets-cleanup-ignore",
        ]);
    });

    test("assigns the gitignore syntax to the path rules", () => {
        for (const name of ["syncignore", "indexignore", "embeddingignore", "assets-cleanup-ignore"] as const) {
            assert.equal(getIgnoreSyntax(name), "gitignore");
        }
    });

    test("assigns the sql syntax to the condition fragments", () => {
        assert.equal(getIgnoreSyntax("searchignore"), "sql");
        assert.equal(getIgnoreSyntax("refsearchignore"), "sql");
    });

    test("gives every file a distinct i18n key stem", () => {
        const keys = IGNORE_FILES.map(file => file.i18nKey);
        assert.equal(new Set(keys).size, keys.length);
        // 文件名带连字符，文案键不能跟着变
        assert.equal(getIgnoreDefinition(ASSET_CLEANUP_FILE)?.i18nKey, "assetsCleanupIgnore");
    });

    test("marks only the asset cleanup rules as strict", () => {
        // 其它文件写错的规则会被内核静默丢弃，只有它会拒绝读取整份文件
        for (const file of IGNORE_FILES) {
            assert.equal(file.strict === true, file.name === ASSET_CLEANUP_FILE, file.name);
        }
    });

    test("gates the asset cleanup rules on a kernel version", () => {
        assert.equal(getIgnoreDefinition(ASSET_CLEANUP_FILE)?.minKernelVersion, "3.8.11-alpha.2");
        for (const file of IGNORE_FILES) {
            if (file.name !== ASSET_CLEANUP_FILE) {
                assert.equal(file.minKernelVersion, undefined, file.name);
            }
        }
    });
});

describe("availableIgnoreFiles", () => {
    const names = (kernelVersion: string | undefined) => availableIgnoreFiles(kernelVersion).map(file => file.name);

    test("adds the asset cleanup rules from 3.8.11-alpha.2 on", () => {
        for (const version of ["3.8.11-alpha.2", "3.8.11-alpha.3", "3.8.11", "3.8.12-alpha.1", "4.0.0"]) {
            assert.deepEqual(names(version), IGNORE_FILES.map(file => file.name), version);
        }
    });

    test("hides the asset cleanup rules on older kernels", () => {
        for (const version of ["3.8.10", "3.8.10-rc.5", "3.8.11-alpha.1", "3.1.20"]) {
            assert.deepEqual(names(version), [
                "syncignore",
                "indexignore",
                "embeddingignore",
                "searchignore",
                "refsearchignore",
            ], version);
        }
    });

    test("keeps the five original files when the version is unknown", () => {
        // 拿不到或解析不了内核版本时按旧内核处理，宁可少给功能也不写坏文件
        for (const version of [undefined, "", "3.8"]) {
            assert.equal(availableIgnoreFiles(version).length, 5, String(version));
        }
    });
});

describe("ignoreFilePath", () => {
    test("points at data/.siyuan", () => {
        assert.equal(ignoreFilePath("syncignore"), "data/.siyuan/syncignore");
        assert.equal(ignoreFilePath("refsearchignore"), "data/.siyuan/refsearchignore");
        assert.equal(ignoreFilePath("assets-cleanup-ignore"), "data/.siyuan/assets-cleanup-ignore");
    });
});
