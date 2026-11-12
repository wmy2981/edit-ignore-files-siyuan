import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { draftKey, parseDraft, pickInitialContent, serializeDraft } from "../src/draft";

describe("draftKey", () => {
    test("keeps one draft per ignore file", () => {
        assert.equal(draftKey("syncignore"), "edit-ignore-files/draft/syncignore");
        assert.equal(draftKey("assets-cleanup-ignore"), "edit-ignore-files/draft/assets-cleanup-ignore");
    });
});

describe("parseDraft", () => {
    test("round-trips a serialized draft", () => {
        const raw = serializeDraft("a\nb", "a\n", 1700000000000);
        assert.deepEqual(parseDraft(raw), { text: "a\nb", base: "a\n", at: 1700000000000 });
    });

    test("treats a missing draft as none", () => {
        // 没有草稿是最常见的情况：不能抛错，也不能造出一个空草稿
        assert.equal(parseDraft(null), undefined);
        assert.equal(parseDraft(""), undefined);
    });

    test("ignores drafts it cannot understand", () => {
        // 旧版本残留、手工改坏、被别的键覆盖过，都当作没有草稿
        for (const raw of ["{", "null", "[]", "\"text\"", JSON.stringify({ text: "a" }),
            JSON.stringify({ text: 1, base: "", at: 1 }), JSON.stringify({ text: "a", base: null, at: 1 })]) {
            assert.equal(parseDraft(raw), undefined, raw);
        }
    });
});

describe("pickInitialContent", () => {
    test("shows the disk content when there is no draft", () => {
        assert.deepEqual(pickInitialContent("/assets/\n", undefined), { text: "/assets/\n", restored: false, external: false });
    });

    test("shows the draft when it differs from the disk", () => {
        const draft = { text: "/assets/a.png\n", base: "/assets/\n", at: 1 };
        assert.deepEqual(pickInitialContent("/assets/\n", draft), { text: "/assets/a.png\n", restored: true, external: false });
    });

    test("drops a draft that matches the disk", () => {
        // 草稿与磁盘一致说明已经存过，没必要再显示成「未保存」
        const draft = { text: "/assets/\n", base: "/assets/\n", at: 1 };
        assert.deepEqual(pickInitialContent("/assets/\n", draft), { text: "/assets/\n", restored: false, external: false });
    });

    test("flags a draft written against older disk content", () => {
        // 草稿写下之后文件在别处被改过：草稿照旧显示，但要提示保存会覆盖
        const draft = { text: "/assets/a.png\n", base: "", at: 1 };
        assert.deepEqual(pickInitialContent("/assets/b.png\n", draft), { text: "/assets/a.png\n", restored: true, external: true });
    });
});
