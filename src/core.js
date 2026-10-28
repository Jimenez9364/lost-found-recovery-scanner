/**
 * Core scanner logic for lost-found-recovery-scanner.
 *
 * Scans filesystem lost+found directories and reports orphaned inodes
 * recovered by fsck. Each entry produced by fsck follows the naming
 * convention `#<inode>` (for example `#123456`). We classify each entry by
 * statting it directly — fsck preserves the recovered inode's mode, so
 * stat tells us the original type and size without parsing file contents.
 *
 * Implementation note: we use the synchronous fs API deliberately. The
 * caller already knows this scan touches disk and is not on a hot path; a
 * promise-based API would add ceremony without value here.
 */

import { readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {"regular"|"directory"|"symlink"|"socket"|"fifo"|"block-device"|"char-device"|"unknown"} EntryType
 */

/**
 * @typedef {Object} RecoveredInode
 * @property {string} name      Filename as it appears in lost+found (e.g. "#123456").
 * @property {number|null} inode The inode number parsed from the name, or null when the name is malformed.
 * @property {EntryType} type    Original type of the recovered inode.
 * @property {number} size       Size in bytes reported by stat. Directories and special files report the value stat returns.
 * @property {string} path       Absolute or relative path to the entry on disk.
 */

const INODE_NAME_PATTERN = /^#(\d+)$/;

/**
 * Map a stat object's mode to a human-readable type string.
 *
 * We branch on the S_IFMT bits directly rather than using fs.constants for
 * portability across Node versions — the numeric masks have been stable
 * since the earliest Node releases.
 *
 * @param {import("node:fs").Stats} st
 * @returns {EntryType}
 */
export function classifyEntry(st) {
  const mode = st.mode & 0xf000;
  switch (mode) {
    case 0x8000:
      return "regular";
    case 0x4000:
      return "directory";
    case 0xa000:
      return "symlink";
    case 0xc000:
      return "socket";
    case 0x1000:
      return "fifo";
    case 0x6000:
      return "block-device";
    case 0x2000:
      return "char-device";
    default:
      return "unknown";
  }
}

/**
 * Scan a lost+found directory and return a report of recovered inodes.
 *
 * Only entries whose names match `#<digits>` are reported — these are the
 * names fsck assigns to orphaned inodes it reattaches under lost+found.
 * Other files (manually placed, stray dotfiles) are skipped silently so a
 * non-empty directory with no real recoveries yields an empty list, not an
 * error.
 *
 * @param {string} lostFoundPath Path to the lost+found directory.
 * @returns {RecoveredInode[]} Array of recovered-inode records, sorted by inode ascending.
 * @throws {Error} If the directory cannot be read.
 */
export function scanLostFound(lostFoundPath) {
  const names = readdirSync(lostFoundPath);
  const records = [];
  for (const name of names) {
    const match = name.match(INODE_NAME_PATTERN);
    if (!match) {
      continue;
    }
    const fullPath = join(lostFoundPath, name);
    let st;
    try {
      st = lstatSync(fullPath);
    } catch {
      // An entry may vanish between readdir and stat (concurrent cleanup).
      // Skip it rather than aborting the whole scan.
      continue;
    }
    records.push({
      name,
      inode: Number(match[1]),
      type: classifyEntry(st),
      size: st.size,
      path: fullPath,
    });
  }
  records.sort((a, b) => {
    const ai = a.inode ?? 0;
    const bi = b.inode ?? 0;
    if (ai !== bi) {
      return ai - bi;
    }
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return records;
}

/**
 * Format a scan result as a plain-text report, one line per recovered inode.
 *
 * Fixed-width columns keep the output greppable. We right-pad the type field
 * so column alignment does not depend on the longest type present.
 *
 * @param {RecoveredInode[]} records
 * @returns {string} Multi-line report. Empty when there are no recoveries.
 */
export function formatReport(records) {
  const lines = records.map((r) => {
    const type = r.type.padEnd(13, " ");
    return `${String(r.inode).padStart(10, " ")}  ${type}  ${String(r.size).padStart(12, " ")}  ${r.path}`;
  });
  return lines.join("\n");
}
