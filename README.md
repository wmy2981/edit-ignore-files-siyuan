# Edit Sync Ignore

[中文](README.zh-CN.md) · **English**

A SiYuan plugin that edits the data sync ignore list (`data/.siyuan/syncignore`) with a line-numbered editor, so the rules no longer have to be edited by hand in a file manager.

![Preview](https://gcore.jsdelivr.net/gh/wmy2981/edit-syncignore-siyuan@dev/assets/preview.png)

## Features

- One setting only: a button in the plugin settings panel that opens the editor; nothing else is registered.
- Real SiYuan UI: the native `Dialog` and `b3-button` styles are used as-is, no custom window chrome.
- Line-numbered editor: line numbers stay aligned with the text, long lines scroll horizontally instead of wrapping.
- Editing guide: one collapsed line in the panel that explains the syntax and shows an example; click it to expand.
- Light syntax hints: rules without a leading `/`, backslashes, duplicated lines and trailing whitespace are listed under the guide. Hints never block saving.
- Saved by exact round trip: the file is read again before saving, written back byte-for-byte otherwise, and read again afterwards to verify what landed on disk. Lines written by other tools are preserved untouched.
- Unsaved changes are guarded: cancelling, clicking the scrim, pressing `Esc` or dragging the sheet down asks for confirmation first.
- Mobile drawer: on SiYuan 3.8.10-alpha.5 and later the editor is presented as a real bottom sheet with the grip, drag-to-resize and drag-to-dismiss. Earlier versions, and desktop, show a regular dialog.

## Usage

1. Open `Settings → Marketplace → Downloaded → Edit Sync Ignore → Settings`.
2. Click `Edit ignore rules`.
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

## Manual verification

Static checks (no SiYuan instance needed):

```bash
npm ci
npm run typecheck
npm run build
```

Runtime check in a scratch workspace: open the plugin settings, click the button, edit a rule, save, then confirm the file content on disk and that the rules affect the next sync. Mobile: repeat on a phone and check that the sheet opens, can be dragged taller, pulled down to dismiss, and that unsaved edits are confirmed.

## License

[MIT](LICENSE)
