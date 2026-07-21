/* eslint-disable */
/**
 * "While you're here..." link-migration nudge.
 *
 * Non-blocking pre-commit reminder: for each staged front-end file that still
 * uses a raw <a> tag or imports next/link, print a friendly note suggesting a
 * migration to @/ui/Link / @/ui/LinkButton. It NEVER fails the commit — the
 * hard guardrail against *new* violations is the ESLint rules
 * (react/forbid-elements, no-restricted-imports) baselined in
 * eslint-suppressions.json. This just encourages chipping away at the backlog
 * in files you're already touching.
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// Only nudge on real front-end app code. The design-system wrappers under
// packages/front-end/ui/ are allowed to use next/link and are excluded from the
// lint rules, so we skip them here too.
const isRelevant = (rel) =>
  rel.startsWith("packages/front-end/") &&
  !rel.startsWith("packages/front-end/ui/") &&
  /\.(tsx|ts)$/.test(rel) &&
  !/\.(test|stories)\.(tsx|ts)$/.test(rel);

function stagedFiles() {
  try {
    const out = execSync("git diff --cached --name-only --diff-filter=ACM", {
      cwd: ROOT,
      encoding: "utf8",
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const NEXT_LINK_IMPORT = /from\s+["']next\/link["']/;

function scan(rel) {
  const full = path.join(ROOT, rel);
  let src;
  try {
    src = fs.readFileSync(full, "utf8");
  } catch {
    return null;
  }

  const lines = src.split("\n");
  let anchors = 0;
  lines.forEach((line, i) => {
    if (!/<a[\s>]/.test(line)) return;
    // Respect explicit opt-outs: skip anchors the author intentionally kept.
    const prev = lines[i - 1] || "";
    if (/eslint-disable/.test(line) || /eslint-disable-next-line/.test(prev)) {
      return;
    }
    anchors += (line.match(/<a[\s>]/g) || []).length;
  });

  const nextLink = NEXT_LINK_IMPORT.test(src);
  if (!anchors && !nextLink) return null;
  return { rel, anchors, nextLink };
}

function main() {
  const hits = stagedFiles().filter(isRelevant).map(scan).filter(Boolean);
  if (!hits.length) return;

  const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
  const dim = (s) => `\x1b[2m${s}\x1b[0m`;

  console.log("");
  console.log(yellow("📎 Link migration — \"while you're here\" reminder"));
  console.log(
    dim(
      "   These staged files still use raw <a> or next/link (not blocking your commit):",
    ),
  );
  for (const h of hits) {
    const parts = [];
    if (h.anchors) parts.push(`${h.anchors} raw <a>`);
    if (h.nextLink) parts.push("next/link import");
    console.log(`     • ${h.rel} ${dim(`(${parts.join(", ")})`)}`);
  }
  console.log(
    dim(
      "   Consider migrating to @/ui/Link (text) or @/ui/LinkButton (button-styled).",
    ),
  );
  console.log("");
}

main();
