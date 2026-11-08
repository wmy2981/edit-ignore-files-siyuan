// 语法检查的分发：按文件所属的两套语法选对应的检查器，并把问题类型映射到文案 key。
import type { IgnoreSyntax } from "./ignoreFiles";
import { lintGitignore } from "./lintGitignore";
import { lintSql } from "./lintSql";

/**
 * gitignore 类文件（syncignore / indexignore / embeddingignore）里会让内核丢掉整条规则的写法。
 * 三者由同一份 sabhiram/go-gitignore 编译，规则完全相同，只是匹配基准不同。
 */
export type GitignoreLintKind = "emptyNegation" | "invalidEscape" | "unclosedClass" | "unbalancedGroup" |
    "badRepetition" | "starInClass" | "badClassRange";

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
    emptyLine: "lintEmptyLine",
    commentLine: "lintCommentLine",
    unbalancedQuote: "lintUnbalancedQuote",
    unbalancedParen: "lintUnbalancedParen",
    statementSeparator: "lintStatementSeparator",
    danglingOperator: "lintDanglingOperator",
};

export const lintIgnore = (syntax: IgnoreSyntax, text: string): LintIssue[] =>
    syntax === "sql" ? lintSql(text) : lintGitignore(text);
