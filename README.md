# Edit Ignore Files

[中文](README.zh-CN.md) · **English**

Edit the ignore files under SiYuan's `data/.siyuan/` inside SiYuan's own plugin settings panel, with line numbers, syntax hints and drafts that survive closing it.

## Files

| File | What it controls | Syntax |
| --- | --- | --- |
| `syncignore` | Which files take part in sync and snapshots | gitignore, paths relative to `data` |
| `indexignore` | Which documents stay out of the index (search, backlinks, outline) | gitignore, paths carry the notebook ID |
| `embeddingignore` | Which documents stay out of the AI vector index | gitignore, paths carry the notebook ID |
| `searchignore` | Which blocks are excluded from search results (`blocks` table) | one SQL condition per line |
| `refsearchignore` | Which reference texts are left out of virtual reference candidates (`refs` table) | one SQL condition per line |
| `assets-cleanup-ignore` | Which assets survive unused-asset cleanup (needs SiYuan 3.8.11-alpha.2 or later) | gitignore, paths relative to `data` |

## Usage

1. Open `Settings → Marketplace → Downloaded → Edit Ignore Files` and click its gear icon. The panel is SiYuan's own plugin settings UI: the Electron desktop app opens it in a standalone settings window, while the browser and mobile get a dialog or bottom sheet.
2. Switch files with the dropdown on top, then press `Save` in the panel footer. The last edited file is remembered.
3. Unsaved edits are kept as a local draft, so closing the panel and opening it again shows them again; the status line says whether it is saved, has unsaved changes, or the file changed outside.
4. `Reload local` drops the draft and reads the file from disk again; it asks for a second click first.
5. The asset cleanup rules only appear on SiYuan 3.8.11-alpha.2 or later; older kernels do not know that file, so it is not listed.

## Syntax

- gitignore files: one rule per line, `#` comments, `!` negation, `*` and `**` wildcards, such as `/assets/*.pdf` or `**/temp/**`. `indexignore` and `embeddingignore` paths carry the notebook ID, like `/20210808180117-6v0mkx5/temp/**`.
- SQL files: one condition per line, such as `type != 'l'`. The kernel joins them onto the query with ` AND `, so `#` is not a comment, a trailing blank line breaks the query, and quotes and parentheses must pair up.
- `assets-cleanup-ignore`: same syntax as gitignore, matching real paths relative to `data`, such as `/assets/example.png` or `/assets/plugin/**`; only files under `assets/` matter. Later rules override earlier ones and `!` drops the protection.

## Notes

- Only rules that cannot work as written, or conditions that break the query, are reported. Nothing blocks saving.
- Saving re-reads the file first: if it changed while the panel was open, nothing is written and the status line says that saving again overwrites; the next save then writes the current content.
- When it takes effect: `syncignore` on the next sync, `indexignore` after the index is rebuilt, `embeddingignore` when the vector index runs again, both SQL files are re-read within 30 seconds, and `assets-cleanup-ignore` on the next unused-asset cleanup.
- A UTF-8 BOM is removed on save, with a notice (except for the asset cleanup rules): the kernel of the sync and index ignore files keeps the BOM and the first line stops working.
- The kernel guards the asset cleanup rules: a rule that cannot compile makes unused-asset cleanup fail, so it is validated before it is written, a bad rule keeps the panel open with the kernel message in the status line, and the write carries the revision so a file changed while you edit it is only overwritten after the warning.
- Drafts live in the local browser storage: they are not written to disk, not synced, and disappear when the cache is cleared or on another device.
- Only those six files are read or written, all through the official plugin APIs: `Setting` for the panel, `/api/file/*` and `/api/asset/*AssetCleanupIgnore` for the files.

## Bazaar Stats Graph

![Bazaar stats graph](https://siyuan-bazaar-stats-graph.sr1.cc.cd/api/chart/wmy2981/edit-ignore-files-siyuan?metrics=downloads,rating,ratings&range=all&area=true&lang=en)

## Development

```bash
npm ci              # install dependencies
npm run typecheck   # type checking
npm test            # unit tests, no SiYuan instance needed
npm run build       # production build, writes dist/ and package.zip
npm run verify:package # check what package.zip contains
npm run dev         # watch build
npm run render:icon    # assets/icon.svg → assets/icon.png
npm run render:preview # assets/preview.html → assets/preview.png
```

## License

[MIT](LICENSE)
