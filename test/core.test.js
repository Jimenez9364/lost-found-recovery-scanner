import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, lstatSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanLostFound, classifyEntry, formatReport } from "../src/core.js";

/**
 * Build a throwaway lost+found fixture inside the OS temp directory.
 *
 * @param {string} prefix
 * @returns {string} Absolute path to the created directory.
 */
function makeFixtureDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("scanLostFound returns an empty array for an empty directory", () => {
  const dir = makeFixtureDir("lfr-empty-");
  try {
    const result = scanLostFound(dir);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanLostFound ignores entries whose names do not match the #<inode> pattern", () => {
  const dir = makeFixtureDir("lfr-skip-");
  try {
    writeFileSync(join(dir, "README"), "not an inode");
    writeFileSync(join(dir, "#abc"), "bad");
    writeFileSync(join(dir, "12345"), "no hash");
    writeFileSync(join(dir, "#12extra"), "trailing");
    const result = scanLostFound(dir);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanLostFound reports regular files with their size and parsed inode", () => {
  const dir = makeFixtureDir("lfr-reg-");
  try {
    writeFileSync(join(dir, "#1001"), "hello world");
    writeFileSync(join(dir, "#1002"), "x".repeat(50));
    const result = scanLostFound(dir);
    assert.equal(result.length, 2);
    assert.equal(result[0].inode, 1001);
    assert.equal(result[0].type, "regular");
    assert.equal(result[0].size, 11);
    assert.equal(result[0].name, "#1001");
    assert.equal(result[1].inode, 1002);
    assert.equal(result[1].size, 50);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanLostFound reports a recovered directory", () => {
  const dir = makeFixtureDir("lfr-dir-");
  try {
    mkdirSync(join(dir, "#2001"));
    const result = scanLostFound(dir);
    assert.equal(result.length, 1);
    assert.equal(result[0].inode, 2001);
    assert.equal(result[0].type, "directory");
    // stat reports the directory's entry size; we pass it through unchanged.
    assert.equal(result[0].size, statSync(join(dir, "#2001")).size);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanLostFound reports a symlink", () => {
  const dir = makeFixtureDir("lfr-link-");
  try {
    symlinkSync("/nonexistent-target", join(dir, "#3001"));
    const result = scanLostFound(dir);
    assert.equal(result.length, 1);
    assert.equal(result[0].inode, 3001);
    assert.equal(result[0].type, "symlink");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanLostFound sorts records by inode ascending", () => {
  const dir = makeFixtureDir("lfr-sort-");
  try {
    writeFileSync(join(dir, "#500"), "c");
    writeFileSync(join(dir, "#5"), "a");
    writeFileSync(join(dir, "#50"), "b");
    const result = scanLostFound(dir);
    assert.deepEqual(
      result.map((r) => r.inode),
      [5, 50, 500],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanLostFound throws when the directory does not exist", () => {
  assert.throws(
    () => scanLostFound(join(tmpdir(), "lfr-nope-does-not-exist-12345")),
    /ENOENT|no such file or directory/i,
  );
});

test("classifyEntry maps each supported mode to the right type", () => {
  const dir = makeFixtureDir("lfr-classify-");
  try {
    writeFileSync(join(dir, "file"), "x");
    mkdirSync(join(dir, "sub"));
    symlinkSync("file", join(dir, "link"));

    assert.equal(classifyEntry(statSync(join(dir, "file"))), "regular");
    assert.equal(classifyEntry(statSync(join(dir, "sub"))), "directory");
    assert.equal(classifyEntry(lstatSync(join(dir, "link"))), "symlink");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("classifyEntry returns unknown for a fabricated mode with no matching bits", () => {
  // Construct a fake stats object whose mode has none of the recognized S_IFMT bits.
  const fake = { mode: 0x0000, size: 0 };
  assert.equal(classifyEntry(fake), "unknown");
});

test("formatReport produces one line per record with aligned columns", () => {
  const records = [
    { name: "#1001", inode: 1001, type: "regular", size: 11, path: "/lf/#1001" },
    { name: "#2001", inode: 2001, type: "directory", size: 4096, path: "/lf/#2001" },
  ];
  const out = formatReport(records);
  const lines = out.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /1001/);
  assert.match(lines[0], /regular/);
  assert.match(lines[0], /\/lf\/#1001/);
  assert.match(lines[1], /directory/);
});

test("formatReport returns an empty string for no records", () => {
  assert.equal(formatReport([]), "");
});

test("end-to-end: mixed entries, only #<digits> reported and sorted", () => {
  const dir = makeFixtureDir("lfr-e2e-");
  try {
    writeFileSync(join(dir, "README"), "noise");
    writeFileSync(join(dir, "#9999"), "z".repeat(7));
    mkdirSync(join(dir, "#42"));
    writeFileSync(join(dir, "#1000"), "a".repeat(3));
    const result = scanLostFound(dir);
    assert.deepEqual(
      result.map((r) => r.inode),
      [42, 1000, 9999],
    );
    assert.deepEqual(
      result.map((r) => r.type),
      ["directory", "regular", "regular"],
    );
    const report = formatReport(result);
    assert.equal(report.split("\n").length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
