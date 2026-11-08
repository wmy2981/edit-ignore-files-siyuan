# Edit Sync Ignore

[中文](README.zh-CN.md) · **English**

A SiYuan plugin that edits the data sync ignore list (`data/.siyuan/syncignore`) with a line-numbered editor, so the rules no longer have to be edited by hand in a file manager.

![Preview](https://gcore.jsdelivr.net/gh/wmy2981/edit-syncignore-siyuan@dev/assets/preview.png)

## Features

- One click to edit: the `Settings` icon in the plugin list opens the editor directly, there is no extra settings panel.
- Real SiYuan UI: the native `Dialog`, `b3-button` styles and bottom sheet are used as-is, no custom window chrome.
- Line-numbered editor: line numbers stay aligned with the text, long lines scroll horizontally instead of wrapping.
- Editing guide: one collapsed line in the panel that explains the syntax and shows an example; click it to expand.
- Syntax errors only: rules that cannot work as written are reported (backslashes, a bare `!` with no rule, an unclosed character class). Style suggestions are not shown, and errors never block saving.
- Saved by exact round trip: the file is read again before saving, written back byte-for-byte otherwise, and read again afterwards to verify what landed on disk. Lines written by other tools are preserved untouched.
- Unsaved changes are guarded: cancelling, clicking the scrim, pressing `Esc` or dragging the sheet down asks for confirmation first.
- Mobile drawer identical to SiYuan's own: the same grip, the same viewport-based height, the same opening sequence and pull-to-dismiss thresholds, and it can be dragged taller.

## Usage

1. Open `Settings → Marketplace → Downloaded → Edit Sync Ignore`.
2. Click the `Settings` icon of that entry; the editor opens.
3. Edit the rules, then click `Save`.

## Rule syntax

Each line is one rule, resolved against the `data` directory, in gitignore syntax:

| Line | Meaning |
| --- | --- |
| `# text` | comment |
| `/assets/` | ignore the whole `data/assets` directory |
| `/assets/*.pdf` | ignore PDFs directly inside `data/assets` |
| `**/temp/**` | ignore nested `temp` directories at any depth |
| `!assets/manual/*.pdf` | negate an earlier rule |

Start rules with `/` so that a look-alike path deeper in the tree is not matched by accident, and use `/` rather than `\` as the separator.

SiYuan appends a few built-in rules itself (`/.siyuan/conf.json`, user guide data, `/storage/view-state.json`, ...). Those never appear in the file and this plugin does not add them.

## Notes and limits

- Saving writes the file immediately, but the rules take effect on the next data sync. The plugin does not start a sync for you.
- The file may be rewritten by SiYuan while it is loaded (the appearance isolation block is cleaned up before the rules are read). If that happens during editing, the plugin asks before overwriting those changes.
- No rule repair and no backups: the text you see is exactly what gets written, so changes made by other tools or plugins survive.
- The mobile bottom sheet needs SiYuan 3.8.10-alpha.5 or later, because that is where the host sheet styles were introduced. On older versions the editor is a normal centred dialog, and the mobile back gesture cannot be intercepted.
- The plugin only touches `data/.siyuan/syncignore`; it does not read or write anything else.

## Development

```bash
npm ci              # install dependencies
npm run typecheck   # type checking
npm run build       # production build, writes dist/ and package.zip
npm run dev         # watch build
npm run render:icon # assets/icon.svg → assets/icon.png
npm run render:preview # assets/preview.html → assets/preview.png
```

## License

[MIT](LICENSE)
