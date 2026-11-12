// 语法检查的分发：按文件所属的语法选对应的检查器，并把问题类型映射到文案 key。
import { getIgnoreDefinition } from "./ignoreFiles";
import type { IgnoreFileName, IgnoreSyntax } from "./ignoreFiles";
import { lintGitignore } from "./lintGitignore";
import { lintSql } from "./lintSql";

/**
 * gitignore 类文件（syncignore / indexignore / embeddingignore / assets-cleanup-ignore）里
 * 会让内核无法编译这条规则的写法。它们由同一份 sabhiram/go-gitignore 编译，规则完全相同，
 * 只是匹配基准不同；assets-cleanup-ignore 还会把合并冲突残留标记当成整份文件的错误。
 */
export type GitignoreLintKind = "emptyNegation" | "invalidEscape" | "unclosedClass" | "unbalancedGroup" |
    "badRepetition" | "starInClass" | "badClassRange" | "conflictMarker";

/**
 * SQL 类文件（searchignore / refsearchignore）里会让拼出来的语句跑不起来的写法。
 * 内核把每一行以 " AND " 拼到查询后面，所以空行、注释、悬空运算符都会让整条 SQL 失败。
 */
export type SqlLintKind = "emptyLine" | "commentLine" | "unbalancedQuote" | "unbalancedParen" |
    "statementSeparator" | "danglingOperator";

export type IgnoreLintKind = GitignoreLintKind | SqlLintKind;

export interface LintIssue {
    /** 1 起始的行号 */
    line: number;
    kind: IgnoreLintKind;
}

/** 每种问题对应的提示文案 key。 */
export const LINT_KEYS: Record<IgnoreLintKind, string> = {
    emptyNegation: "lintEmptyNegation",
    invalidEscape: "lintInvalidEscape",
    unclosedClass: "lintUnclosedClass",
    unbalancedGroup: "lintUnbalancedGroup",
    badRepetition: "lintBadRepetition",
    starInClass: "lintStarInClass",
    badClassRange: "lintBadClassRange",
    conflictMarker: "lintConflictMarker",
    emptyLine: "lintEmptyLine",
    commentLine: "lintCommentLine",
    unbalancedQuote: "lintUnbalancedQuote",
    unbalancedParen: "lintUnbalancedParen",
    statementSeparator: "lintStatementSeparator",
    danglingOperator: "lintDanglingOperator",
};

export const lintIgnore = (name: IgnoreFileName, text: string): LintIssue[] => {
    const definition = getIgnoreDefinition(name);
    const syntax: IgnoreSyntax = definition?.syntax ?? "gitignore";
    if (syntax === "sql") {
        return lintSql(text);
    }
    return lintGitignore(text, { strict: definition?.strict === true });
};
