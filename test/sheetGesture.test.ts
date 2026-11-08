import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
    getSheetBounds,
    getStandardMaxHeight,
    moveSheetGesture,
    shouldCloseSheet,
} from "../src/sheetGesture";
import type { SheetGesture } from "../src/sheetGesture";

const gesture = (overrides: Partial<SheetGesture> = {}): SheetGesture => ({
    height: 400,
    min: 300,
    max: 900,
    offset: 0,
    time: 0,
    ...overrides,
});

describe("getStandardMaxHeight", () => {
    test("caps a normal sheet at 56% of the full viewport", () => {
        // 0.56 在二进制里不精确，这里按浮点比较
        assert.ok(Math.abs(getStandardMaxHeight(800, 1000) - 448) < 1e-9);
    });

    test("never exceeds the available height", () => {
        assert.equal(getStandardMaxHeight(800, 400), 400);
    });

    test("stays non-negative when nothing is available", () => {
        assert.equal(getStandardMaxHeight(800, 0), 0);
        assert.equal(getStandardMaxHeight(0, 0), 0);
    });
});

describe("getSheetBounds", () => {
    test("keeps a chrome + 120 gap as the lower bound", () => {
        assert.deepEqual(getSheetBounds(600, 200, 900, 448), { min: 320, max: 900 });
    });

    test("does not inflate a short sheet up to the chrome", () => {
        assert.deepEqual(getSheetBounds(100, 200, 900, 448), { min: 100, max: 900 });
    });

    test("respects a floor larger than the natural height", () => {
        assert.deepEqual(getSheetBounds(100, 200, 900, 500), { min: 100, max: 900 });
        assert.deepEqual(getSheetBounds(600, 200, 900, 500), { min: 320, max: 900 });
    });

    test("clamps to the available height", () => {
        assert.deepEqual(getSheetBounds(600, 200, 150, 448), { min: 150, max: 150 });
    });
});

describe("moveSheetGesture", () => {
    test("grows the sheet when dragging up", () => {
        const result = moveSheetGesture(gesture(), -120, 100);
        assert.deepEqual(result, { height: 520, excess: 0, close: false });
    });

    test("shrinks without excess while still above the lower bound", () => {
        const result = moveSheetGesture(gesture(), 50, 100);
        assert.deepEqual(result, { height: 350, excess: 0, close: false });
    });

    test("clamps at the lower bound and reports the excess", () => {
        const state = gesture();
        const result = moveSheetGesture(state, 200, 100);
        assert.equal(result.height, 300);
        assert.equal(result.excess, 100);
        // 100 > min(120, 300 * .25) 才算关闭
        assert.equal(result.close, true);
    });

    test("a slow drag past the lower bound springs back", () => {
        const state = gesture();
        const result = moveSheetGesture(state, 130, 2000);
        assert.equal(result.height, 300);
        assert.equal(result.excess, 30);
        assert.equal(result.close, false);
    });

    test("a fast fling past the lower bound closes", () => {
        const state = gesture();
        const result = moveSheetGesture(state, 130, 200);
        assert.equal(result.excess, 30);
        assert.equal(result.close, true);
    });

    test("keeps the gesture state in sync for the next move", () => {
        const state = gesture();
        moveSheetGesture(state, 40, 100);
        assert.equal(state.offset, 40);
        assert.equal(state.time, 100);
        const next = moveSheetGesture(state, 80, 200);
        assert.deepEqual(next, { height: 320, excess: 0, close: false });
    });
});

describe("shouldCloseSheet", () => {
    const result = (close: boolean) => ({ height: 300, excess: 40, close });

    test("prefers the gesture result when the grip was used", () => {
        assert.equal(shouldCloseSheet(result(true), 0, 10, 400), true);
        assert.equal(shouldCloseSheet(result(false), 400, 10, 400), false);
    });

    test("closes once the sheet was pulled past the threshold", () => {
        assert.equal(shouldCloseSheet(undefined, 200, 1000, 400), true);
    });

    test("stays open for a short and slow pull", () => {
        assert.equal(shouldCloseSheet(undefined, 50, 1000, 400), false);
    });

    test("closes on a fast short pull", () => {
        assert.equal(shouldCloseSheet(undefined, 50, 10, 400), true);
    });
});
