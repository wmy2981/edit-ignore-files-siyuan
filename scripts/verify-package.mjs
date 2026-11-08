// 核对 package.zip 的内容：必需文件齐全、布局扁平、图标不超标。
//
// CI 与 CD 共用同一个校验，避免清单散落在两个 workflow 与文档里各自漂移。
// zip 用自带的中央目录解析，不依赖 unzip（Windows 本地也能跑）。
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ZIP = path.join(ROOT, "package.zip");
// 集市要求的图片上限（plugin-sample 的 icon/preview 说明）
const MAX_IMAGE_BYTES = 64 * 1024;

const REQUIRED = [
    "plugin.json",
    "index.js",
    "index.css",
    "icon.png",
    "preview.png",
    "README.md",
    "README.zh-CN.md",
    "LICENSE",
    "i18n/en.json",
    "i18n/zh-CN.json",
];

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

const readEntries = (buffer) => {
    let eocd = -1;
    for (let offset = buffer.length - 22; offset >= 0; offset--) {
        if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
            eocd = offset;
            break;
        }
    }
    if (eocd < 0) {
        throw new Error("package.zip has no end of central directory record");
    }
    const entries = [];
    let offset = buffer.readUInt32LE(eocd + 16);
    const total = buffer.readUInt16LE(eocd + 10);
    for (let index = 0; index < total; index++) {
        if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
            throw new Error("package.zip central directory is corrupt");
        }
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        entries.push({
            name: buffer.toString("utf8", offset + 46, offset + 46 + nameLength),
            size: buffer.readUInt32LE(offset + 24),
        });
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
};

if (!fs.existsSync(ZIP)) {
    console.error("package.zip is missing, run `npm run build` first");
    process.exit(1);
}

const entries = readEntries(fs.readFileSync(ZIP));
const names = entries.map(entry => entry.name);
const problems = [];

REQUIRED.filter(file => !names.includes(file))
    .forEach(file => problems.push(`missing ${file}`));

names.filter(name => name.endsWith("/"))
    .forEach(name => problems.push(`unexpected directory entry ${name}`));

const extra = names.filter(name => !REQUIRED.includes(name) && !name.endsWith("/"));
extra.forEach(name => problems.push(`unexpected file ${name}`));

entries.filter(entry => /\.(png|jpe?g|webp|avif)$/i.test(entry.name) && entry.size > MAX_IMAGE_BYTES)
    .forEach(entry => problems.push(`${entry.name} is ${entry.size} bytes, over the ${MAX_IMAGE_BYTES} byte limit`));

if (problems.length) {
    problems.forEach(problem => console.error(`::error::${problem}`));
    process.exit(1);
}

const total = entries.reduce((sum, entry) => sum + entry.size, 0);
console.log(`package.zip ok: ${names.length} files, ${total} bytes uncompressed`);
