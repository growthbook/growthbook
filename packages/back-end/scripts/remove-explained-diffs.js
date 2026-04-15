#!/usr/bin/env node
/**
 * Removes diff entries from diff.txt that have already been categorized
 * in spec-diff-explained.txt.
 *
 * Usage: node remove-explained-diffs.js [explained-file] [diff-file]
 *   Defaults: scripts/spec-diff-explained.txt and /tmp/diff.txt
 *
 * A "diff entry" in diff.txt is a key line (starting with -, +, or ~)
 * containing [REMOVED], [ADDED], or [CHANGED], followed by zero or more
 * indented value lines.
 */

const fs = require("fs");

const explainedPath = process.argv[2] || `${__dirname}/spec-diff-explained.txt`;
const diffPath = process.argv[3] || "/tmp/diff.txt";

// Extract diff key lines from the explained file.
// These are lines (after trimming) that start with -, +, or ~ and contain a
// diff marker like [REMOVED], [ADDED], or [CHANGED].
const explainedLines = fs.readFileSync(explainedPath, "utf8").split("\n");
const explainedKeys = new Set();
for (const line of explainedLines) {
  const trimmed = line.trim();
  if (/^[-+~]\s+\S.*\[(REMOVED|ADDED|CHANGED)\]/.test(trimmed)) {
    explainedKeys.add(trimmed);
  }
}

console.error(`Found ${explainedKeys.size} explained diff keys`);

// Parse diff.txt into entries. Each entry is a key line + its trailing
// value lines (lines that don't start with -, +, ~ and aren't section headers).
const diffLines = fs.readFileSync(diffPath, "utf8").split("\n");
const output = [];
let i = 0;
let removed = 0;

while (i < diffLines.length) {
  const trimmed = diffLines[i].trim();

  // Check if this line is a diff key line
  if (/^[-+~]\s+\S.*\[(REMOVED|ADDED|CHANGED)\]/.test(trimmed)) {
    // Collect this entry: key line + following value lines
    const entryStart = i;
    i++;
    // Value lines are indented (start with spaces) and don't match a new key
    while (i < diffLines.length) {
      const nextTrimmed = diffLines[i].trim();
      // Stop if we hit another key line, a section header, or a blank line
      if (
        /^[-+~]\s+\S.*\[(REMOVED|ADDED|CHANGED)\]/.test(nextTrimmed) ||
        /^═══/.test(nextTrimmed) ||
        nextTrimmed === ""
      ) {
        break;
      }
      i++;
    }

    if (explainedKeys.has(trimmed)) {
      // Skip this entry entirely
      removed++;
    } else {
      // Keep it
      for (let j = entryStart; j < i; j++) {
        output.push(diffLines[j]);
      }
    }
  } else {
    // Non-diff line (headers, blank lines, etc.) — keep as-is
    output.push(diffLines[i]);
    i++;
  }
}

// Remove everything before the first ═══ Paths line
const pathsIdx = output.findIndex((l) => /^═══ Paths/.test(l.trim()));
if (pathsIdx > 0) {
  output.splice(0, pathsIdx);
}

// Decrement the diff count on the ═══ Paths line by the number removed
output[0] = output[0].replace(/\((\d+) diffs\)/, (_, n) => {
  return `(${Number(n) - removed} diffs)`;
});

fs.writeFileSync(diffPath, output.join("\n"));
console.error(`Removed ${removed} entries from ${diffPath}`);
