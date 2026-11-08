// 思源 data/.siyuan 下的忽略文件清单。
//
// 两类语义：
// - gitignore：syncignore / indexignore / embeddingignore，由 sabhiram/go-gitignore 编译，
//   每行一条路径规则；三者规则语法相同，区别只在匹配基准与作用范围。
// - sql：searchignore / refsearchignore，每行是一段 SQL 条件，内核用 " AND " 把它们拼到查询后面。

export type IgnoreSyntax = "gitignore" | "sql";

export interface IgnoreFileDefinition {
    /** 文件名，同时也是 data/.siyuan 下的文件名 */
    name: IgnoreFileName;
    syntax: IgnoreSyntax;
}

export type IgnoreFileName =
    | "syncignore"
    | "indexignore"
    | "embeddingignore"
    | "searchignore"
    | "refsearchignore";

/** 面板里的显示顺序：先同步，再索引，最后是搜索相关。 */
export const IGNORE_FILES: readonly IgnoreFileDefinition[] = [
    { name: "syncignore", syntax: "gitignore" },
    { name: "indexignore", syntax: "gitignore" },
    { name: "embeddingignore", syntax: "gitignore" },
    { name: "searchignore", syntax: "sql" },
    { name: "refsearchignore", syntax: "sql" },
];

export const DEFAULT_IGNORE_FILE: IgnoreFileName = "syncignore";

export const isIgnoreFileName = (value: unknown): value is IgnoreFileName =>
    typeof value === "string" && IGNORE_FILES.some(file => file.name === value);

export const getIgnoreSyntax = (name: IgnoreFileName): IgnoreSyntax =>
    IGNORE_FILES.find(file => file.name === name)?.syntax ?? "gitignore";

export const ignoreFilePath = (name: IgnoreFileName) => `data/.siyuan/${name}`;
