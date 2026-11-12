// 思源 data/.siyuan 下的忽略文件清单。
//
// 两类语义：
// - gitignore：syncignore / indexignore / embeddingignore / assets-cleanup-ignore，由 sabhiram/go-gitignore
//   编译，每行一条路径规则；规则语法相同，区别只在匹配基准与作用范围。
// - sql：searchignore / refsearchignore，每行是一段 SQL 条件，内核用 " AND " 把它们拼到查询后面。
import { satisfiesKernelVersion } from "./kernelVersion";

export type IgnoreSyntax = "gitignore" | "sql";

export interface IgnoreFileDefinition {
    /** 文件名，同时也是 data/.siyuan 下的文件名 */
    name: IgnoreFileName;
    syntax: IgnoreSyntax;
    /** 文案键的词干：desc<Key> / guide<Key>1..4 */
    i18nKey: string;
    /**
     * 内核不静默丢弃写错的规则，而是拒绝读取整份文件：清理未引用资源会直接报错中止。
     * 这类文件除了单条规则的语法检查，还要报合并冲突残留标记。
     */
    strict?: boolean;
    /** 需要的内核版本；低于它的宿主上不提供编辑（内核根本不认识这个文件） */
    minKernelVersion?: string;
}

export type IgnoreFileName =
    | "syncignore"
    | "indexignore"
    | "embeddingignore"
    | "searchignore"
    | "refsearchignore"
    | "assets-cleanup-ignore";

/** 面板里的显示顺序：先同步与索引，再搜索相关，最后是资源清理。 */
export const IGNORE_FILES: readonly IgnoreFileDefinition[] = [
    { name: "syncignore", syntax: "gitignore", i18nKey: "syncignore" },
    { name: "indexignore", syntax: "gitignore", i18nKey: "indexignore" },
    { name: "embeddingignore", syntax: "gitignore", i18nKey: "embeddingignore" },
    { name: "searchignore", syntax: "sql", i18nKey: "searchignore" },
    { name: "refsearchignore", syntax: "sql", i18nKey: "refsearchignore" },
    {
        name: "assets-cleanup-ignore",
        syntax: "gitignore",
        i18nKey: "assetsCleanupIgnore",
        strict: true,
        // 该文件与三条 /api/asset/*AssetCleanupIgnore 接口自 3.8.11-alpha.2 起才有
        minKernelVersion: "3.8.11-alpha.2",
    },
];

export const ASSET_CLEANUP_FILE: IgnoreFileName = "assets-cleanup-ignore";

export const DEFAULT_IGNORE_FILE: IgnoreFileName = "syncignore";

export const getIgnoreDefinition = (name: string): IgnoreFileDefinition | undefined =>
    IGNORE_FILES.find(file => file.name === name);

export const isIgnoreFileName = (value: unknown): value is IgnoreFileName =>
    typeof value === "string" && IGNORE_FILES.some(file => file.name === value);

export const getIgnoreSyntax = (name: IgnoreFileName): IgnoreSyntax =>
    getIgnoreDefinition(name)?.syntax ?? "gitignore";

/** 当前内核版本能编辑的文件；版本号缺失或解析不了时，只给出不需要版本门槛的文件。 */
export const availableIgnoreFiles = (kernelVersion: string | undefined): readonly IgnoreFileDefinition[] =>
    IGNORE_FILES.filter(file => !file.minKernelVersion || satisfiesKernelVersion(kernelVersion, file.minKernelVersion));

export const ignoreFilePath = (name: IgnoreFileName) => `data/.siyuan/${name}`;
