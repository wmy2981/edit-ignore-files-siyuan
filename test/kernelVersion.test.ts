import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import {
    compareKernelVersion,
    parseKernelVersion,
    readKernelVersion,
    satisfiesKernelVersion,
} from "../src/kernelVersion";

// 用例对齐 semver：思源的预发布段是 alpha.N / beta.N / rc.N，数字段按数值比较，
// 所以 3.8.11-alpha.10 高于 3.8.11-alpha.2，按字符串比较会得到相反结论。

describe("parseKernelVersion", () => {
    test("splits the core version and the prerelease identifiers", () => {
        assert.deepEqual(parseKernelVersion("3.8.11-alpha.2"), { core: [3, 8, 11], pre: ["alpha", "2"] });
        assert.deepEqual(parseKernelVersion("3.8.10"), { core: [3, 8, 10], pre: [] });
    });

    test("accepts a leading v and ignores build metadata", () => {
        assert.deepEqual(parseKernelVersion("v3.8.11-rc.1+build.5"), { core: [3, 8, 11], pre: ["rc", "1"] });
    });

    test("rejects versions it cannot order", () => {
        // 少一段、不是数字、或者数字段带前导零，都不猜含义
        for (const version of ["3.8", "", "abc", "3.8.11.1", "3.8.11-alpha.01", "3.8.x"]) {
            assert.equal(parseKernelVersion(version), undefined, version);
        }
    });
});

describe("compareKernelVersion", () => {
    test("treats the same version as equal", () => {
        assert.equal(compareKernelVersion("3.8.11-alpha.2", "3.8.11-alpha.2"), 0);
        assert.equal(compareKernelVersion("v3.8.10", "3.8.10"), 0);
    });

    test("compares the core version first", () => {
        assert.equal(compareKernelVersion("3.8.10", "3.8.11-alpha.2"), -1);
        assert.equal(compareKernelVersion("3.9.0", "3.8.11"), 1);
        assert.equal(compareKernelVersion("3.8.11", "3.8.10"), 1);
    });

    test("orders a release above its own prereleases", () => {
        assert.equal(compareKernelVersion("3.8.11", "3.8.11-alpha.2"), 1);
        assert.equal(compareKernelVersion("3.8.11-alpha.2", "3.8.11"), -1);
    });

    test("compares numeric prerelease identifiers by value", () => {
        assert.equal(compareKernelVersion("3.8.11-alpha.10", "3.8.11-alpha.2"), 1);
        assert.equal(compareKernelVersion("3.8.11-alpha.2", "3.8.11-alpha.10"), -1);
    });

    test("orders prerelease stages by name and a numeric identifier below a name", () => {
        assert.equal(compareKernelVersion("3.8.11-beta.1", "3.8.11-alpha.9"), 1);
        assert.equal(compareKernelVersion("3.8.11-rc.1", "3.8.11-beta.5"), 1);
        assert.equal(compareKernelVersion("3.8.11-1", "3.8.11-alpha"), -1);
    });

    test("orders fewer prerelease identifiers below more specific ones", () => {
        assert.equal(compareKernelVersion("3.8.11-alpha", "3.8.11-alpha.1"), -1);
        assert.equal(compareKernelVersion("3.8.11-alpha.1", "3.8.11-alpha"), 1);
    });

    test("returns undefined when a version cannot be parsed", () => {
        assert.equal(compareKernelVersion("3.8", "3.8.11-alpha.2"), undefined);
        assert.equal(compareKernelVersion("3.8.11-alpha.2", ""), undefined);
    });
});

describe("satisfiesKernelVersion", () => {
    const minimum = "3.8.11-alpha.2";

    test("accepts the minimum version and anything newer", () => {
        for (const version of [minimum, "3.8.11-alpha.3", "3.8.11-alpha.10", "3.8.11", "3.8.12", "3.8.11-beta.1"]) {
            assert.equal(satisfiesKernelVersion(version, minimum), true, version);
        }
    });

    test("rejects older versions, including the stable release before it", () => {
        // 3.8.10 是 3.8.11-alpha.2 之前的正式版，不带这条接口
        for (const version of ["3.8.10", "3.8.10-rc.5", "3.8.11-alpha.1", "3.7.9"]) {
            assert.equal(satisfiesKernelVersion(version, minimum), false, version);
        }
    });

    test("treats a missing or unparsable version as unsupported", () => {
        assert.equal(satisfiesKernelVersion(undefined, minimum), false);
        assert.equal(satisfiesKernelVersion("", minimum), false);
        assert.equal(satisfiesKernelVersion("3.8", minimum), false);
    });
});

describe("readKernelVersion", () => {
    afterEach(() => {
        delete (globalThis as { window?: unknown }).window;
    });

    test("returns undefined without a host window", () => {
        assert.equal(readKernelVersion(), undefined);
    });

    test("reads window.siyuan.config.system.kernelVersion", () => {
        (globalThis as { window?: unknown }).window = {
            siyuan: { config: { system: { kernelVersion: "3.8.11-alpha.2" } } },
        };
        assert.equal(readKernelVersion(), "3.8.11-alpha.2");
    });

    test("returns undefined when the host config is incomplete", () => {
        for (const host of [{}, { siyuan: {} }, { siyuan: { config: {} } }, { siyuan: { config: { system: {} } } }]) {
            (globalThis as { window?: unknown }).window = host;
            assert.equal(readKernelVersion(), undefined);
        }
    });
});
