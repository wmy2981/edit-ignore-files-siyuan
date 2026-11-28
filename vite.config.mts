/**
 * 构建配置。
 *
 * 宿主用 CommonJS 加载插件，集市要的是「包根目录扁平」的 zip，两件事都由这里产出：
 * - 开发（`--mode development`）：仓库根目录就是插件目录，配合 `--watch` 原地更新
 *   index.js / index.css 与 i18n，宿主里重载插件即可生效；
 * - 生产（`--mode production`）：先清空 dist，再放 index.js、index.css、i18n，
 *   以及 plugin.json 声明的图片、README 与 LICENSE，最后打成不带目录前缀的 package.zip。
 */
import {zipSync} from "fflate";
import fs from "node:fs";
import path from "node:path";
import {
    defineConfig,
    type Plugin,
} from "vite";

const root = import.meta.dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"));

/**
 * 集市要求的图片位于包根，文件名以 plugin.json 里的声明为准；
 * 图源放在 assets/，渲染出的 PNG 也在那里，构建时复制到包根（兼容根目录回落）。
 */
function imageAssets(): {source: string; name: string;}[] {
    return [
        ["icon", "icon.png"],
        ["preview", "preview.png"],
    ].flatMap(([field, legacyName]) => {
        const name = manifest[field]
            || (fs.existsSync(path.join(root, "assets", legacyName)) || fs.existsSync(path.join(root, legacyName))
                ? legacyName
                : "");
        if (!name) {
            return [];
        }
        const assetPath = path.join(root, "assets", name);
        const rootPath = path.join(root, name);
        const source = fs.existsSync(assetPath) ? assetPath : rootPath;
        if (!fs.existsSync(source)) {
            throw new Error(`plugin.json declares ${field} as ${name}, but neither ${assetPath} nor ${rootPath} exists`);
        }
        return [{source, name}];
    });
}

/** 生产包里除产物与 i18n 以外的静态文件：图片、全部 README*.md、LICENSE 与 plugin.json。 */
function packageFiles(): {source: string; name: string;}[] {
    const readmes = fs.readdirSync(root, {withFileTypes: true})
        .filter((entry) => entry.isFile() && /^README.*\.md$/.test(entry.name))
        .map((entry) => ({source: path.join(root, entry.name), name: entry.name}));
    return [
        ...imageAssets(),
        ...readmes,
        {source: path.join(root, "LICENSE"), name: "LICENSE"},
        {source: path.join(root, "plugin.json"), name: "plugin.json"},
    ];
}

/** 把 LICENSE 包装成块注释，在 generateBundle 阶段贴到 index.js 最前面。 */
function licenseBanner(): string {
    const lines = fs.readFileSync(path.join(root, "LICENSE"), "utf8")
        .replace(/\r\n/g, "\n")
        .trimEnd()
        .split("\n");
    return [
        "/*!",
        ...lines.map((line) => (line ? ` * ${line}` : " *")),
        " */",
    ].join("\n");
}

/** 把产物目录里的全部文件按相对路径塞进一个扁平 zip（集市按根目录取文件）。 */
function writePackageZip(source: string, target: string): void {
    const files: Record<string, Uint8Array> = {};
    const collect = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                collect(full);
                continue;
            }
            files[path.relative(source, full).split(path.sep).join("/")] = fs.readFileSync(full);
        }
    };
    collect(source);
    fs.writeFileSync(target, zipSync(files, {level: 9}));
}

/**
 * 产物收尾：i18n 由宿主在运行时按语言读取，必须与 index.js 一起就位；
 * 生产模式再补静态文件、打 zip。开发模式下不动仓库根目录里的同名文件。
 *
 * 许可声明在 `generateBundle` 里贴到产物最前面：`output.banner` 会被压缩阶段当普通注释删掉。
 */
function buildArtifacts(options: {production: boolean; outDir: string; banner: string;}): Plugin {
    const outDir = path.join(root, options.outDir);
    return {
        name: "edit-ignore-files:artifacts",
        apply: "build",
        generateBundle(_options, bundle) {
            if (!options.production) {
                return;
            }
            for (const chunk of Object.values(bundle)) {
                if (chunk.type === "chunk" && chunk.fileName === "index.js") {
                    chunk.code = `${options.banner}\n${chunk.code}`;
                }
            }
        },
        writeBundle() {
            fs.cpSync(path.join(root, "src/i18n"), path.join(outDir, "i18n"), {recursive: true});
            if (!options.production) {
                return;
            }
            for (const file of packageFiles()) {
                fs.copyFileSync(file.source, path.join(outDir, file.name));
            }
            writePackageZip(outDir, path.join(root, "package.zip"));
        },
    };
}

export default defineConfig(({mode}) => {
    const production = mode === "production";
    const outDir = production ? "dist" : ".";
    return {
        // 没有页面入口，也就没有 public/ 目录
        publicDir: false,
        build: {
            outDir,
            // 开发时 outDir 就是仓库根目录：清空等于删掉源码，Vite 也因此每次启动提示
            // 「outDir 与 root 相同」，那正是要的行为
            emptyOutDir: production,
            copyPublicDir: false,
            // 桌面端与移动端的 WebView 都不算新，沿用改造前的 ES6 目标
            target: "es2015",
            sourcemap: production ? false : "inline",
            minify: production,
            lib: {
                entry: path.join(root, "src/index.ts"),
                // 宿主用 CommonJS 加载 index.js，集市也只认包根目录下的这个名字
                formats: ["cjs"],
                fileName: () => "index.js",
                // 集市要求包根目录必须有 index.css
                cssFileName: "index",
            },
            rolldownOptions: {
                // siyuan 是宿主的运行时包，只在 npm 上有类型声明，不打进包里
                external: ["siyuan"],
            },
        },
        plugins: [buildArtifacts({production, outDir, banner: licenseBanner()})],
    };
});
