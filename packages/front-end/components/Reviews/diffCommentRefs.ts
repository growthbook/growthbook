import { diffLines } from "diff";
import type { RevisionLog } from "shared/validators";
import type { Review } from "shared/enterprise";

// ── Diff comment references ──
//
// A comment can reference a specific spot in the revision diff using a
// visible fenced block in its markdown body:
//
//     ```diff-ref rules:R12
//       "id": "abc",
//     - "type": "rollout",
//     +! "type": "force",
//       "value": "true"
//     ```
//
// Lines prefixed with `!` after the diff op (`+!`, `-!`, ` !`) are the
// anchored line the comment was written against.
//
// The info string is `diff-ref <sectionKey>:<side><line>` where <sectionKey>
// is the semantic key of the diff section (see `FeatureRevisionDiff.key`),
// <side> is L (before) or R (after), and <line> is the 1-based line number
// within that side of the section's JSON diff. The body is a unified-style
// snapshot of the diff around the anchored line, captured at composition
// time: each line starts with `-` (before only), `+` (after only), or a
// space (both sides). If the diff later changes shape and the line reference
// goes stale, the comment still shows both the before and after states that
// were being discussed.
//
// The whole thing is deliberately plain markdown — visible in the editor,
// copy-safe, and renderable anywhere as an ordinary code block. Surfaces
// that know about the syntax (the revision timeline) upgrade it to an
// interactive widget that scrolls back to the referenced diff line.
//
// Line numbers are a best-effort hint, not a durable anchor; the section key
// and the snapshot are the durable parts.

export type DiffCommentRef = {
  sectionKey: string;
  side: "L" | "R";
  line: number;
};

export type DiffSnapshotOp = "-" | "+" | " ";

export type DiffRefSnapshotLine = {
  op: DiffSnapshotOp;
  text: string;
  // The line the comment was anchored on when the snapshot was captured.
  anchored?: boolean;
};

// A small window of the diff around the anchored line: removed/added/context
// lines. The anchored line is marked so the widget can bold it.
export type DiffRefSnapshot = {
  lines: DiffRefSnapshotLine[];
};

// One line of the full a/b line diff, with per-side line numbers matching
// the gutter numbers react-diff-viewer renders (left numbering for removed
// and context lines, right numbering for added and context lines).
export type DiffSnapshotEntry = DiffRefSnapshotLine & {
  lLine?: number;
  rLine?: number;
};

// Section keys may not contain `:` (the token delimiter). Everything we
// generate (`rules`, `environmentsEnabled.production`, `rampAction.<id>`)
// fits this charset.
const REF_BLOCK_RE =
  /```diff-ref ([A-Za-z0-9_.-]+):([LR])(\d+)\n([\s\S]*?)```/g;
// Legacy single-token form (no snapshot); still parsed, no longer emitted.
const REF_INLINE_RE = /`diff:([A-Za-z0-9_.-]+):([LR])(\d+)`/g;

// Computes the line diff of a section's before/after JSON once per section;
// individual snapshots are cheap windows over the result.
export function buildDiffSnapshotEntries(
  a: string,
  b: string,
): DiffSnapshotEntry[] {
  const entries: DiffSnapshotEntry[] = [];
  let l = 0;
  let r = 0;
  for (const part of diffLines(a, b)) {
    const lines = part.value.split("\n");
    // diffLines values end with a trailing newline except possibly the last
    // part; drop the empty artifact of splitting it.
    if (lines[lines.length - 1] === "") lines.pop();
    for (const text of lines) {
      if (part.added) {
        entries.push({ op: "+", text, rLine: ++r });
      } else if (part.removed) {
        entries.push({ op: "-", text, lLine: ++l });
      } else {
        entries.push({ op: " ", text, lLine: ++l, rLine: ++r });
      }
    }
  }
  return entries;
}

// Captures the snapshot window for a ref: the anchored diff line plus up to
// two diff lines on either side (enough to include the other half of a
// changed before/after pair plus context).
export function captureDiffRefSnapshot(
  entries: DiffSnapshotEntry[],
  side: "L" | "R",
  line: number,
): DiffRefSnapshot {
  const idx = entries.findIndex((e) =>
    side === "L" ? e.lLine === line : e.rLine === line,
  );
  if (idx === -1) return { lines: [] };
  const start = Math.max(0, idx - 2);
  const end = Math.min(entries.length - 1, idx + 2);
  return {
    lines: entries.slice(start, end + 1).map(({ op, text }, i) => ({
      op,
      text,
      anchored: start + i === idx,
    })),
  };
}

export function formatDiffRef(
  ref: DiffCommentRef,
  snapshot?: DiffRefSnapshot,
): string {
  const header = `\`\`\`diff-ref ${ref.sectionKey}:${ref.side}${ref.line}`;
  const body = (snapshot?.lines ?? [])
    .map((l) => `${l.op}${l.anchored ? "!" : ""} ${l.text}`)
    .join("\n");
  return body ? `${header}\n${body}\n\`\`\`` : `${header}\n\`\`\``;
}

// Stable lookup id for a ref: "rules:R12". Used as the key of the anchored
// comment map and for matching a gutter cell to its comments.
export function diffRefId(ref: DiffCommentRef): string {
  return `${ref.sectionKey}:${ref.side}${ref.line}`;
}

const SNAPSHOT_LINE_RE = /^([-+ ])(!?) (.*)$/;

function snapshotFromBlockBody(body: string): DiffRefSnapshot {
  if (!body.trim()) return { lines: [] };
  const rawLines = body.replace(/\n$/, "").split("\n");
  const lines: DiffRefSnapshotLine[] = rawLines.map((raw) => {
    const m = SNAPSHOT_LINE_RE.exec(raw);
    if (m)
      return {
        op: m[1] as DiffSnapshotOp,
        text: m[3],
        anchored: m[2] === "!",
      };
    // Hand-edited or malformed line; keep it visible as context.
    return { op: " ", text: raw };
  });
  return { lines };
}

export function parseDiffRefs(markdown: string): DiffCommentRef[] {
  const refs: DiffCommentRef[] = [];
  for (const re of [REF_BLOCK_RE, REF_INLINE_RE]) {
    for (const m of markdown.matchAll(re)) {
      refs.push({
        sectionKey: m[1],
        side: m[2] as "L" | "R",
        line: parseInt(m[3], 10),
      });
    }
  }
  return refs;
}

// Splits a comment body into ordinary markdown segments and diff-ref
// segments so renderers can upgrade refs to interactive widgets while
// leaving the rest of the comment untouched.
export type DiffRefSegment =
  | { type: "markdown"; text: string }
  | { type: "ref"; ref: DiffCommentRef; snapshot: DiffRefSnapshot };

export function splitDiffRefSegments(markdown: string): DiffRefSegment[] {
  const segments: DiffRefSegment[] = [];
  let last = 0;
  for (const m of markdown.matchAll(REF_BLOCK_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) {
      segments.push({ type: "markdown", text: markdown.slice(last, idx) });
    }
    segments.push({
      type: "ref",
      ref: {
        sectionKey: m[1],
        side: m[2] as "L" | "R",
        line: parseInt(m[3], 10),
      },
      snapshot: snapshotFromBlockBody(m[4]),
    });
    last = idx + m[0].length;
  }
  if (last < markdown.length) {
    segments.push({ type: "markdown", text: markdown.slice(last) });
  }
  return segments;
}

// Removes ref blocks/tokens from a comment body. Used where the reference
// itself is redundant context — e.g. the gutter popover, which is already
// anchored at the referenced line.
export function stripDiffRefs(markdown: string): string {
  return markdown.replace(REF_BLOCK_RE, "").replace(REF_INLINE_RE, "").trim();
}

// ── Cross-component diff-format coordination ──
// The diff view format preference lives in localStorage (see useDiffFormat),
// but each DiffContent owns its own hook state. Clicking a diff-ref widget
// in the timeline may need to force "json" mode (refs aren't resolvable in
// the formatted render), so we write the preference and broadcast an event
// that useDiffFormat instances subscribe to.
export const DIFF_FORMAT_EVENT = "gb:diff-view-format";
export const DIFF_FORMAT_STORAGE_KEY = "diff:view-format";

export function requestDiffFormat(format: "formatted" | "json" | "raw"): void {
  try {
    globalThis?.localStorage?.setItem(
      DIFF_FORMAT_STORAGE_KEY,
      JSON.stringify(format),
    );
  } catch {
    // localStorage unavailable — the event alone still updates mounted views.
  }
  window.dispatchEvent(new CustomEvent(DIFF_FORMAT_EVENT, { detail: format }));
}

// The review surface splits into Overview / Changes sub-tabs; line-level diff
// targets only exist on the Changes tab. Diff-ref widgets broadcast this event
// so ReviewAndPublish can swap tabs before the scroll retry loop runs.
export const REVIEW_SUBTAB_EVENT = "gb:review-subtab";

export function requestReviewSubTab(tab: "overview" | "changes"): void {
  window.dispatchEvent(new CustomEvent(REVIEW_SUBTAB_EVENT, { detail: tab }));
}

// Scrolls to the diff line a ref points at (gutter cells carry
// data-diff-ref) and flashes its row. If the target isn't rendered in the
// current view format, switches to the format that can render it — "raw" for
// whole-shape refs, "json" for per-section refs (the formatted render has no
// line-level targets either way) — and the retry loop waits out the
// re-render. No-ops quietly when the target never appears (stale line
// reference or a surface without the diff) — the snapshot in the comment is
// the fallback context.
export function scrollToDiffRef(ref: DiffCommentRef): void {
  const refId = diffRefId(ref);
  const find = () =>
    document.querySelector(`[data-diff-ref="${CSS.escape(refId)}"]`);
  const scrollTo = (el: Element) => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const row = el.closest("tr");
    if (row) {
      row.classList.add("gb-diff-ref-flash");
      setTimeout(() => row.classList.remove("gb-diff-ref-flash"), 1800);
    }
  };

  // Already rendered in the current format (e.g. a supplemental section
  // visible in both "json" and "raw") — just scroll, don't flip the view.
  const existing = find();
  if (existing) {
    scrollTo(existing);
    return;
  }

  // The target may live on the Changes sub-tab (the Conversation tab renders no
  // line-level diffs); swap there first, then wait out both re-renders.
  requestReviewSubTab("changes");
  requestDiffFormat(ref.sectionKey === "raw" ? "raw" : "json");
  const tryScroll = (attempt: number) => {
    const el = find();
    if (el) {
      scrollTo(el);
      return;
    }
    if (attempt < 20) setTimeout(() => tryScroll(attempt + 1), 100);
  };
  tryScroll(0);
}

// The reverse direction: a gutter marker jumps to its comment in the
// revision timeline (cards carry data-revision-log-id). Same quiet no-op if
// the entry isn't rendered on this surface.
export function scrollToRevisionLogEntry(logId: string): void {
  const el = document.querySelector(
    `[data-revision-log-id="${CSS.escape(logId)}"]`,
  );
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("gb-log-entry-flash");
  setTimeout(() => el.classList.remove("gb-log-entry-flash"), 1800);
}

// After posting a new timeline comment, scroll to the newest rendered entry.
// Retries while the log refetch re-renders (same pattern as scrollToDiffRef).
export function scrollToLatestRevisionLogEntry(): void {
  const scrollTo = (el: Element) => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("gb-log-entry-flash");
    setTimeout(() => el.classList.remove("gb-log-entry-flash"), 1800);
  };
  const find = () => {
    const entries = document.querySelectorAll("[data-revision-log-id]");
    return entries.length ? entries[entries.length - 1] : null;
  };
  const tryScroll = (attempt: number) => {
    const el = find();
    if (el) {
      scrollTo(el);
      return;
    }
    if (attempt < 20) setTimeout(() => tryScroll(attempt + 1), 100);
  };
  tryScroll(0);
}

// A revision-log comment resolved to a diff spot. `logId` is absent for
// legacy inline log entries, which makes them read-only in the gutter UI.
export type AnchoredComment = {
  ref: DiffCommentRef;
  logId?: string;
  comment: string;
  userId?: string;
  userName?: string;
  timestamp: string;
};

// Log actions whose `value.comment` is user-authored prose that may carry
// ref tokens. Mirrors the card-rendered actions in RevisionLog.
const COMMENT_ACTIONS = new Set(["Comment", "Approved", "Requested Changes"]);

// Builds refId → most-recent comment from the generic revision system's baked
// `reviews[]` (RevisionModel), mirroring buildAnchoredCommentMap but sourced
// from reviews instead of the feature revision log. `logId` carries the review
// id so timeline cards (which set `data-revision-log-id` to the same id) can be
// jumped to from gutter markers.
export function buildAnchoredCommentMapFromReviews(
  reviews: Review[],
  getUserName?: (userId: string) => string | undefined,
): Map<string, AnchoredComment> {
  const map = new Map<string, AnchoredComment>();
  for (const review of reviews) {
    const comment = review.comment;
    if (!comment) continue;
    const timestamp = new Date(review.dateCreated).toISOString();
    for (const ref of parseDiffRefs(comment)) {
      const id = diffRefId(ref);
      const existing = map.get(id);
      if (existing && existing.timestamp.localeCompare(timestamp) >= 0) {
        continue;
      }
      map.set(id, {
        ref,
        logId: review.id,
        comment,
        userId: review.userId,
        userName: getUserName?.(review.userId),
        timestamp,
      });
    }
  }
  return map;
}

// Builds refId → most-recent comment from the revision log. When several
// comments reference the same spot, only the newest is kept — the gutter
// renders a single icon per spot, always linking to the latest word.
export function buildAnchoredCommentMap(
  log: RevisionLog[],
): Map<string, AnchoredComment> {
  const map = new Map<string, AnchoredComment>();
  for (const entry of log) {
    if (!COMMENT_ACTIONS.has(entry.action)) continue;
    let comment: string | undefined;
    try {
      comment = JSON.parse(entry.value)?.comment;
    } catch {
      continue;
    }
    if (!comment) continue;
    const timestamp =
      entry.timestamp instanceof Date
        ? entry.timestamp.toISOString()
        : String(entry.timestamp);
    const user = entry.user;
    const userId = user && "id" in user ? user.id : undefined;
    const userName =
      (user && "name" in user && user.name) ||
      (user && "email" in user && user.email) ||
      undefined;
    for (const ref of parseDiffRefs(comment)) {
      const id = diffRefId(ref);
      const existing = map.get(id);
      if (existing && existing.timestamp.localeCompare(timestamp) >= 0) {
        continue;
      }
      map.set(id, {
        ref,
        logId: entry.id,
        comment,
        userId,
        userName,
        timestamp,
      });
    }
  }
  return map;
}
