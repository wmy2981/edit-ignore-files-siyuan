// 按 Conventional Commits 分类生成 Release 说明。
// 用法：node scripts/release-notes.mjs [起始 tag] [结束 ref]
//   起始 tag 省略时取全部历史；结束 ref 省略时取 HEAD。
//   仓库还没有任何正式发行版（GitHub Release）时改成首次发行的整篇说明：
//   插件信息表 + 双语 README 全文 + 提交说明；此时所有提交都还没发行过，
//   忽略起始 tag，一律取全部历史。判定只看发行版，不看 tag。
// 仓库地址优先取 GITHUB_REPOSITORY，本地执行时回落到 origin。
import {execFileSync} from "node:child_process";

// Conventional Commits 类型 -> [小节标题前的 emoji, 说明小节标题]，
// emoji 与该类型的 gitmoji 约定一致；未列出的类型归入 Other Changes
const SECTIONS = new Map([
    ["feat", ["✨", "Features"]],
    ["fix", ["🐛", "Bug Fixes"]],
    ["perf", ["⚡", "Performance"]],
    ["revert", ["⏪️", "Reverts"]],
    ["refactor", ["♻️", "Refactoring"]],
    ["docs", ["📝", "Documentation"]],
    ["build", ["📦", "Build System"]],
    ["ci", ["👷", "Continuous Integration"]],
    ["test", ["✅", "Tests"]],
    ["style", ["💄", "Styles"]],
    ["chore", ["🔧", "Chores"]],
]);
const OTHER_SECTION = ["📌", "Other Changes"];
// 破坏性改动单独一节，排在所有类型之前：它在标题里（`type!:`）或正文里
// （`BREAKING CHANGE:` footer）任一处出现过都算，只列一次，不再重复进原类型小节
const BREAKING_SECTION = ["💥", "Breaking Changes"];
const BREAKING_SUBJECT = /^[a-z]+(?:\([^)]*\))?!:/;
const BREAKING_BODY = /^BREAKING[ -]CHANGE:/m;

// 版本号提交等无信息量的记录
const IGNORED_SUBJECTS = [
    /^chore(\([^)]*\))?!?:\s*bump\b/i,
    /^chore(\([^)]*\))?!?:\s*v?\d+\.\d+\.\d+/i,
    /^v?\d+\.\d+\.\d+$/,
];

const git = (...args) => execFileSync("git", args, {encoding: "utf8"}).trim();

const repository = () => {
    if (process.env.GITHUB_REPOSITORY) {
        return process.env.GITHUB_REPOSITORY;
    }
    return git("remote", "get-url", "origin").replace(/^.*[:/]([^/]+\/[^/]+?)(\.git)?$/, "$1");
};

// 手打的 tag 不算发行版，只有发过 Release 才算已经有上一个版本
const hasRelease = () => {
    const releases = execFileSync("gh", [
        "release", "list", "--repo", repository(), "--exclude-drafts", "--limit", "1", "--json", "tagName",
    ], {encoding: "utf8"}).trim();
    return JSON.parse(releases || "[]").length > 0;
};

const [fromTag, toRef = "HEAD"] = process.argv.slice(2);
const initialRelease = !hasRelease();
const range = fromTag && !initialRelease ? `${fromTag}..${toRef}` : toRef;

// --no-merges 同时排除分支合并与 PR 合并提交；正文只为找 BREAKING CHANGE footer
const commits = git("log", "--no-merges", "--format=%H%x1f%s%x1f%b%x1e", range)
    .split("\x1e")
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record !== "")
    .map((record) => {
        const [sha, subject, body = ""] = record.split("\x1f");
        return {sha, subject, body};
    });

const sections = new Map();
for (const {sha, subject, body} of commits) {
    if (IGNORED_SUBJECTS.some((pattern) => pattern.test(subject))) {
        continue;
    }
    // type(scope)!: description，不符合约定的提交原样归入 Other Changes
    const conventional = /^([a-z]+)(?:\(([^)]*)\))?!?:\s*(.+)$/.exec(subject);
    const type = conventional ? conventional[1] : "";
    const scope = conventional ? conventional[2] : "";
    const description = conventional ? conventional[3] : subject;
    const breaking = BREAKING_SUBJECT.test(subject) || BREAKING_BODY.test(body);
    const [emoji, title] = breaking ? BREAKING_SECTION : (SECTIONS.get(type) || OTHER_SECTION);
    const heading = `${emoji} ${title}`;
    const link = `([${sha.slice(0, 7)}](https://github.com/${repository()}/commit/${sha}))`;
    const entry = `- ${scope ? `**${scope}**: ` : ""}${description} ${link}`;
    sections.set(heading, [...(sections.get(heading) || []), entry]);
}

const orderedHeadings = [BREAKING_SECTION, ...SECTIONS.values(), OTHER_SECTION]
    .map(([emoji, title]) => `${emoji} ${title}`)
    .filter((heading) => sections.has(heading));
const commitNotes = orderedHeadings.length === 0
    ? "_No notable changes_"
    : orderedHeadings.map((heading) => `### ${heading}\n\n${sections.get(heading).join("\n")}`).join("\n\n");

// 首次发行：结束 ref 里的文件才算数，读 tag 或提交本身而不是工作区
const show = (file) => git("show", `${toRef}:${file}`);
const cell = (value) => String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

const pluginTable = () => {
    const plugin = JSON.parse(show("plugin.json"));
    // 字段原样取，不做中英合并：数组按逗号拼接，语言对象取 default
    const value = (field) => {
        if (Array.isArray(field)) {
            return field.join(", ");
        }
        if (field && typeof field === "object") {
            return field.default || Object.values(field)[0] || "";
        }
        return String(field ?? "");
    };
    // 简介把中文接在英文后面，中间留一个空格
    const description = (field) => {
        if (typeof field === "string") {
            return field;
        }
        return [field?.default, field?.["zh-CN"]].filter(Boolean).join(" ");
    };
    const rows = [
        ["Name / 名称", plugin.name],
        ["Display name / 显示名", plugin.displayName],
        ["Version / 版本", plugin.version],
        ["Min SiYuan version / 最低思源版本", plugin.minAppVersion],
        ["Author / 作者", plugin.author && `[@${plugin.author}](https://github.com/${plugin.author})`],
        ["Repository / 仓库", plugin.url && `[${repository()}](${plugin.url})`],
        ["Description / 简介", description(plugin.description)],
        ["Backends / 后端", plugin.backends],
        ["Frontends / 前端", plugin.frontends],
        ["Settings window / 独立设置窗口", plugin.settingsWindow],
        ["Disabled in publish / 发布模式下禁用", plugin.disabledInPublish],
        ["Keywords / 关键词", plugin.keywords],
        ["Funding / 赞助", plugin.funding?.custom],
    ]
        .map(([name, field]) => [name, value(field)])
        .filter(([, text]) => text !== "");
    return `| Item / 项目 | Value / 内容 |\n| --- | --- |\n${rows.map(([name, text]) => `| ${cell(name)} | ${cell(text)} |`).join("\n")}`;
};

// 语言切换那行在发行说明里没有意义，连同其后的空行一起去掉
const LANGUAGE_SWITCH = /^(?:\*\*[^*]+\*\*|\[[^\]]+\]\([^)]*README[^)]*\))(?:\s*·\s*(?:\*\*[^*]+\*\*|\[[^\]]+\]\([^)]*README[^)]*\)))+\s*\n(\s*\n)?/gm;

// README 里的相对链接在 Release 页面会指错地方，改成仓库 main 上的绝对地址
const absoluteLinks = (markdown) => {
    const base = `https://github.com/${repository()}/blob/main/`;
    return markdown.replace(/\]\(([^)\s]+)\)/g, (match, target) => {
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) {
            return match;
        }
        const [path, anchor] = target.replace(/^\.?\//, "").split("#");
        return `](${base}${path}${anchor ? `#${anchor}` : ""})`;
    });
};

const details = (summary, content) => `<details><summary>${summary}</summary>\n\n${absoluteLinks(content.replace(LANGUAGE_SWITCH, "")).trimEnd()}\n\n</details>`;

if (!initialRelease) {
    console.log(commitNotes);
} else {
    console.log([
        "# Initial Release / 初次发行",
        pluginTable(),
        details("Learn about this plugin", show("README.md")),
        details("了解这个插件", show("README.zh-CN.md")),
        details("Release notes generated from commits", commitNotes),
    ].join("\n\n"));
}
