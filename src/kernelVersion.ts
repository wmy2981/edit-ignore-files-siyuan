// 内核版本号的读取与比较。
//
// 思源的版本号是「主.次.修订」加可选的预发布段（3.8.11-alpha.2、3.8.10-rc.5、3.8.10-beta.1），
// 比较规则按 semver：先比主次修订，再比预发布段——带预发布段的版本低于同号的正式版；
// 预发布段按点分段，纯数字段按数值比较、数字段低于字母段，所以 3.8.11-alpha.10 高于 3.8.11-alpha.2，
// 不能直接比较字符串。解析不了的版本号一律当作「不支持」，宁可少给功能，也不要写坏内核不认识的文件。

export interface KernelVersionParts {
    core: [number, number, number];
    /** 预发布段，正式版为空数组 */
    pre: string[];
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export const parseKernelVersion = (version: string): KernelVersionParts | undefined => {
    const match = VERSION_PATTERN.exec(version.trim());
    if (!match) {
        return undefined;
    }
    const pre = match[4] ? match[4].split(".") : [];
    // 预发布段的数字标识段不允许有前导零，与 semver 一致；其它写法直接当作解析失败
    if (pre.some(part => part === "" || (/^\d+$/.test(part) && part.length > 1 && part.startsWith("0")))) {
        return undefined;
    }
    return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre };
};

const comparePre = (left: string[], right: string[]): number => {
    // 正式版高于同号预发布版
    if (!left.length || !right.length) {
        return left.length === right.length ? 0 : (left.length ? -1 : 1);
    }
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index++) {
        const a = left[index];
        const b = right[index];
        if (a === b) {
            continue;
        }
        const aNumeric = /^\d+$/.test(a);
        const bNumeric = /^\d+$/.test(b);
        if (aNumeric && bNumeric) {
            return Number(a) < Number(b) ? -1 : 1;
        }
        // 数字段低于字母段
        if (aNumeric !== bNumeric) {
            return aNumeric ? -1 : 1;
        }
        return a < b ? -1 : 1;
    }
    // 前缀相同时，段数少的更低
    return left.length === right.length ? 0 : (left.length < right.length ? -1 : 1);
};

/** 按 semver 比较两个版本号；任一版本号解析不了时返回 undefined。 */
export const compareKernelVersion = (left: string, right: string): number | undefined => {
    const a = parseKernelVersion(left);
    const b = parseKernelVersion(right);
    if (!a || !b) {
        return undefined;
    }
    for (let index = 0; index < 3; index++) {
        if (a.core[index] !== b.core[index]) {
            return a.core[index] < b.core[index] ? -1 : 1;
        }
    }
    return comparePre(a.pre, b.pre);
};

/** 宿主版本是否达到要求的最低版本；拿不到版本号或版本号不认识时返回 false。 */
export const satisfiesKernelVersion = (version: string | undefined, minimum: string): boolean => {
    if (!version) {
        return false;
    }
    const order = compareKernelVersion(version, minimum);
    return order !== undefined && order >= 0;
};

// 宿主把配置挂在 window.siyuan 上，移动端也有；这里只取用到的字段，不扩散成全局类型断言
type HostWindow = Window & { siyuan?: { config?: { system?: { kernelVersion?: string } } } };

/** 当前内核版本号；桌面端与移动端都取自 window.siyuan.config.system.kernelVersion。 */
export const readKernelVersion = (): string | undefined => {
    try {
        if (typeof window === "undefined") {
            return undefined;
        }
        const version = (window as HostWindow).siyuan?.config?.system?.kernelVersion;
        return typeof version === "string" && version ? version : undefined;
    } catch {
        return undefined;
    }
};
