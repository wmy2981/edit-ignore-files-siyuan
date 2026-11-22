import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canOpenSettingsWindow } from "../src/settingsWindow";

// 桌面客户端的 UA 由宿主拼成「SiYuan/<版本> https://b3log.org/siyuan Electron <原 UA>」；
// 平板在移动端桌面模式下拿到的是桌面浏览器包，UA 里只有 Android，没有 Electron。
const electron = "SiYuan/3.8.11-alpha.2 https://b3log.org/siyuan Electron Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.160 Safari/537.36";
const tablet = "SiYuan/3.8.11-alpha.2 https://b3log.org/siyuan Android Mozilla/5.0 (Linux; Android 13; 21051182C " +
    "Build/TKQ1.221013.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/149.0.7827.160 Safari/537.36";
const browser = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/149.0.0.0 Safari/537.36";

describe("canOpenSettingsWindow", () => {
    test("opens in a native window on the desktop app", () => {
        assert.equal(canOpenSettingsWindow(electron), true);
    });

    test("falls back to the dialog on a tablet in desktop mode", () => {
        // UA 以 SiYuan/ 开头会让宿主的 getFrontend() 报 desktop，但页面是浏览器包
        assert.equal(canOpenSettingsWindow(tablet), false);
    });

    test("falls back to the dialog in a browser", () => {
        assert.equal(canOpenSettingsWindow(browser), false);
    });

    test("falls back to the dialog on an unknown user agent", () => {
        assert.equal(canOpenSettingsWindow(""), false);
    });
});
