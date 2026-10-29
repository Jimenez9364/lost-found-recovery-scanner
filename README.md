# lost-found-recovery-scanner

Scans filesystem `lost+found` directories and reports orphaned inodes recovered by `fsck`, including each inode's original type and size.

```js
import { scanLostFound, formatReport } from "lost-found-recovery-scanner";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "lost-found-recovery-scanner-"));
mkdirSync(join(dir, "#42"));
writeFileSync(join(dir, "#1000"), "abc");
writeFileSync(join(dir, "#9999"), "zzzzzzz");

const records = scanLostFound(dir);
console.log(formatReport(records));
//          42  directory          4096  .../lost-found-recovery-scanner-XXXX/#42
//        1000  regular               3  .../lost-found-recovery-scanner-XXXX/#1000
//        9999  regular               7  .../lost-found-recovery-scanner-XXXX/#9999

rmSync(dir, { recursive: true, force: true });
```

The exported API is:

- `scanLostFound(lostFoundPath: string): RecoveredInode[]` — reads the directory, stats each `#<digits>` entry, returns records sorted by inode ascending.
- `classifyEntry(stats: fs.Stats): EntryType` — maps a stat object's mode bits to `"regular"`, `"directory"`, `"symlink"`, `"socket"`, `"fifo"`, `"block-device"`, `"char-device"`, or `"unknown"`.
- `formatReport(records: RecoveredInode[]): string` — renders records as fixed-width columns, one per line. Returns an empty string for an empty list.

A `RecoveredInode` has `{ name, inode, type, size, path }`, where `inode` is the number parsed from the filename and `path` is the full path to the entry on disk.

## Why this exists

After `fsck` reattaches orphaned inodes, it drops them into `lost+found` under names like `#123456`. The inode number is preserved in the name, and the recovered inode keeps its original mode and size, but nothing tells you which of those entries are regular files versus directories or symlinks without statting each one. This library automates that walk and produces a stable, greppable report.

The trade-off: we use the synchronous Node filesystem API. A scan of `lost+found` is something an operator runs after a filesystem check, not something on a hot request path, so the simplicity of a synchronous walk outweighs the benefit of non-blocking I/O here.

## Edge cases you will hit

- Entries that do not match `#<digits>` (stray files, dotfiles, anything a human placed in `lost+found`) are silently skipped. A non-empty directory with no real recoveries yields an empty list, not an error.
- If an entry vanishes between `readdir` and `stat` — concurrent cleanup, another operator removing things — it is skipped rather than aborting the scan.
- Directories and special files report whatever `stat` returns for `size`, which for directories is filesystem-dependent and usually not the sum of contained file sizes.
- Passing a path that does not exist throws; the library does not swallow that because it almost always indicates a real misconfiguration.
