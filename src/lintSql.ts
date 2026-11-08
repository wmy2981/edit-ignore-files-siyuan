// SQL 类忽略文件（searchignore / refsearchignore）的语法检查。
//
// 内核把文件的每一行以 " AND " 拼到查询后面：
//   searchignore      → SELECT ... FROM blocks WHERE ... AND <行> AND <行> ...
//   refsearchignore   → SELECT DISTINCT content FROM refs WHERE 1 = 1 AND <行> ...
// 因此这里只报「拼出来的语句一定跑不起来」的写法，每条都对着 SQLite 实测过：
// 空行会拼出悬空的 AND（incomplete input）、`#` 不是注释（被当成绑定参数）、
// 引号或括号不成对（unrecognized token / incomplete input）、分号会变成多条语句、
// 行首行尾悬空的运算符同样是 incomplete input。
// 文件第一行完全为空会被内核丢掉（`ret[0] == ""` 只剔除一次），所以只有这种首行允许空；
// 首行只有空格或制表符时不会被剔除，照样拼出悬空的 AND。
import type { LintIssue, SqlLintKind } from "./lint";

// 行尾悬空的运算符，拼上后续子句后一定是残句
const TRAILING_OPERATOR = /\b(?:AND|OR|NOT|LIKE|GLOB|REGEXP|IN|IS|BETWEEN)\s*$|[=!<>]\s*$/i;
// 行首重复了内核已经加上的 AND / OR
const LEADING_OPERATOR = /^(?:AND|OR)\b/i;

/** 把被单引号包住的片段换成空串，剩下的才是需要判断括号与分号的结构部分。 */
const stripQuoted = (line: string) => line.replace(/'(?:[^']|'')*'/g, "''");

const lintLine = (line: string): SqlLintKind | null => {
    const rule = line.trim();
    if (!rule) {
        return "emptyLine";
    }
    // 这些文件里 # 不是注释：SQLite 会把它当成绑定参数
    if (rule.startsWith("#")) {
        return "commentLine";
    }
    if ((line.match(/'/g)?.length ?? 0) % 2) {
        return "unbalancedQuote";
    }
    const body = stripQuoted(line);
    let depth = 0;
    for (const char of body) {
        if (char === "(") {
            depth++;
        } else if (char === ")") {
            if (!depth) {
                return "unbalancedParen";
            }
            depth--;
        }
    }
    if (depth) {
        return "unbalancedParen";
    }
    if (body.includes(";")) {
        return "statementSeparator";
    }
    if (LEADING_OPERATOR.test(rule) || TRAILING_OPERATOR.test(rule)) {
        return "danglingOperator";
    }
    return null;
};

export const lintSql = (text: string): LintIssue[] => {
    const issues: LintIssue[] = [];
    text.split("\n").forEach((raw, index) => {
        // 内核只剔除第一个完全为空的元素，首行只有空白字符时仍会拼出悬空的 AND
        if (index === 0 && raw === "") {
            return;
        }
        const kind = lintLine(raw);
        if (kind) {
            issues.push({ line: index + 1, kind });
        }
    });
    return issues;
};
