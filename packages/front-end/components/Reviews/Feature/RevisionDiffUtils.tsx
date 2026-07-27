import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import Collapsible from "react-collapsible";
import { FaAngleDown, FaAngleRight } from "react-icons/fa";
import {
  PiCheckBold,
  PiArrowsLeftRightBold,
  PiWarningBold,
  PiCopy,
  PiCaretDown,
  PiChatCircleTextFill,
  PiListBullets,
  PiGitDiff,
  PiSparkle,
  PiBracketsCurly,
} from "react-icons/pi";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { datetime, getValidDate } from "shared/dates";
import {
  MergeConflict,
  MergeStrategy,
  DRAFT_REVISION_STATUSES,
} from "shared/util";
import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import { RampScheduleInterface, HoldoutInterface } from "shared/validators";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import SplitButton from "@/ui/SplitButton";
import Heading from "@/ui/Heading";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import EventUser from "@/components/Avatar/EventUser";
import RevisionDescription from "@/components/Reviews/RevisionDescription";
import Tooltip from "@/components/Tooltip/Tooltip";
import CommentComposer from "@/components/Comments/CommentComposer";
import Link from "@/ui/Link";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import {
  COPY_DIFF_FORMATS,
  CopyDiffFormat,
  formatDiffForCopy,
} from "@/components/Reviews/diffCopyFormats";
import RevisionStatusBadge from "@/components/Reviews/RevisionStatusBadge";
import RevisionLabel, {
  revisionLabelText,
} from "@/components/Reviews/RevisionLabel";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import {
  COMPACT_DIFF_STYLES,
  dedupeDiffBadges,
} from "@/components/AuditHistoryExplorer/CompareAuditEventsUtils";
import type { DiffBadge } from "@/components/AuditHistoryExplorer/types";
import {
  logBadgeColor,
  CreatedRampScheduleBody,
  RampActionLabel,
  formatSimpleWindow,
} from "@/components/Features/FeatureDiffRenders";
import type { FeatureRevisionDiff } from "@/hooks/useFeatureRevisionDiff";
import { holdoutOccupiesRuleSlot } from "@/hooks/useHoldouts";
import CoAuthors from "@/components/Reviews/Feature/CoAuthors";
import { Popover } from "@/ui/Popover";
import {
  AnchoredComment,
  DiffCommentRef,
  DiffRefSnapshot,
  DIFF_FORMAT_EVENT,
  buildDiffSnapshotEntries,
  captureDiffRefSnapshot,
  diffRefId,
  formatDiffRef,
  requestReviewSubTab,
  scrollToRevisionLogEntry,
} from "@/components/Reviews/diffCommentRefs";

// How a contextual diff is rendered: "formatted" = the human-readable section
// renders; "json" = the per-section left/right JSON diff; "raw" = a single,
// non-sectional left/right JSON diff of the entire before/after shape. Shared
// across all diff surfaces (ReviewAndPublish, CompareRevisionsModal,
// CompareAuditEvents) so the choice is external to each individual diff and
// persists as one user preference.
export type DiffFormat = "formatted" | "json" | "raw";

// Persisted, app-wide diff-format preference. All diff surfaces read/write the
// same key so toggling on one screen carries over to the others.
export function useDiffFormat(): [DiffFormat, (v: DiffFormat) => void] {
  const [value, setValue] = useLocalStorage<DiffFormat>(
    "diff:view-format",
    "formatted",
  );
  // Diff-ref widgets in the timeline force JSON mode from outside any
  // DiffContent instance (see requestDiffFormat); pick up that broadcast.
  useEffect(() => {
    const handler = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (v === "formatted" || v === "json" || v === "raw") setValue(v);
    };
    window.addEventListener(DIFF_FORMAT_EVENT, handler);
    return () => window.removeEventListener(DIFF_FORMAT_EVENT, handler);
  }, [setValue]);
  const normalized: DiffFormat =
    value === "json" ? "json" : value === "raw" ? "raw" : "formatted";
  return [normalized, setValue];
}

// Stringify a whole before/after shape for the non-sectional "Raw JSON" view.
export function stringifyForRawDiff(value: unknown): string {
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// Segmented toggle that drives the diff format. Render it directly under the
// "Summary of changes" badges. "Formatted changes" shows human-readable
// renders, "JSON diffs" shows per-section JSON diffs, and "Full JSON" shows a
// single diff of the entire before/after shape.
const DIFF_FORMAT_LABELS: Record<DiffFormat, string> = {
  formatted: "Formatted changes",
  json: "JSON diffs",
  raw: "Full JSON",
};

export function DiffFormatToggle({
  value,
  setValue,
  showRaw = true,
  options,
  mt,
  mb,
}: {
  value: DiffFormat;
  setValue: (v: DiffFormat) => void;
  // Hide the "Full JSON" segment on surfaces that can't supply a whole-shape diff.
  showRaw?: boolean;
  // Restrict which formats this surface offers (defaults to all three). The
  // toggle hides itself entirely when fewer than two remain.
  options?: DiffFormat[];
  mt?: "0" | "1" | "2" | "3" | "4";
  mb?: "0" | "1" | "2" | "3" | "4";
}) {
  const segment = (target: DiffFormat) => (
    <Button
      key={target}
      size="sm"
      variant={value === target ? "solid" : "outline"}
      onClick={() => setValue(target)}
    >
      {DIFF_FORMAT_LABELS[target]}
    </Button>
  );

  const visible = (options ?? ["formatted", "json", "raw"]).filter(
    (f) => f !== "raw" || showRaw,
  );
  if (visible.length < 2) return null;

  return (
    <Box mt={mt} mb={mb}>
      <SplitButton variant="outline" className="diff-format-toggle">
        {visible.map(segment)}
      </SplitButton>
    </Box>
  );
}

// Height-capped wrapper with a fade-out and a "Show more"/"Show less" toggle
// (same affordance as the Notes panel). Only collapses when the content
// actually overflows; a ResizeObserver re-checks as content reflows.
export function CollapsedSection({
  maxHeight,
  children,
}: {
  maxHeight: number;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollHeight > maxHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxHeight]);

  return (
    <>
      <Box
        style={
          !expanded && overflowing
            ? { position: "relative", maxHeight, overflow: "hidden" }
            : { position: "relative" }
        }
      >
        <Box ref={contentRef}>{children}</Box>
        {!expanded && overflowing && (
          <Box
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 64,
              background:
                "linear-gradient(transparent, var(--color-panel-solid))",
              pointerEvents: "none",
            }}
          />
        )}
      </Box>
      {overflowing && (
        <Box mt="2">
          <Link onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Show less" : "Show more"}
          </Link>
        </Box>
      )}
    </>
  );
}

// Serialize a rendered "Formatted changes" node to readable text. Unlike
// innerText (which drops every inline fragment — "Δ", "unset", "→" — onto its
// own line), this is display-aware: inline elements and flex *rows* join on a
// single line, block elements break, and the top-level section cards are
// separated by a blank line for breathing room. Reading the rendered DOM (vs.
// the customRender props) means content produced inside leaf components
// (ConditionDisplay, saved-group/experiment renders, …) is captured for free.
function formattedNodeToText(root: HTMLElement): string {
  // text = rendered content; block = whether this box is block-level (so the
  // parent should break the line around it).
  type Result = { text: string; block: boolean };

  const serialize = (node: Node): Result => {
    if (node.nodeType === Node.TEXT_NODE) {
      // Source whitespace (incl. newlines) collapses to a single space; the
      // space is kept so adjacent inline runs stay separated.
      return {
        text: (node.textContent ?? "").replace(/\s+/g, " "),
        block: false,
      };
    }
    if (!(node instanceof HTMLElement)) return { text: "", block: false };

    let display = "block";
    let flexDirection = "row";
    try {
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return { text: "", block: false };
      }
      display = style.display;
      flexDirection = style.flexDirection;
    } catch {
      return {
        text: (node.innerText ?? node.textContent ?? "").trim(),
        block: true,
      };
    }

    const inlineLevel = display.startsWith("inline") || display === "contents";
    const rowFlex =
      (display === "flex" || display === "inline-flex") &&
      !flexDirection.startsWith("column");
    const childNodes = Array.from(node.childNodes);
    const children = childNodes.map(serialize);

    let text: string;
    if (rowFlex) {
      // Flex items sit on one line; their gap comes from gap/margins, so join
      // with a single space.
      text = children
        .map((c) => c.text.trim())
        .filter(Boolean)
        .join(" ");
    } else {
      // Normal flow: accumulate consecutive inline children into one line
      // (concatenated, so "Rule #" + "9" stays "Rule #9"); block children break
      // onto their own line(s). A block with non-trivial vertical margin gets a
      // blank line before it, so visually-spaced groups (sections, fields) keep
      // that breathing room in the copied text.
      type Part = { text: string; mt: number; mb: number };
      const parts: Part[] = [];
      let run = "";
      const flushRun = () => {
        const cleaned = run.replace(/[ \t]+/g, " ").trim();
        if (cleaned) parts.push({ text: cleaned, mt: 0, mb: 0 });
        run = "";
      };
      childNodes.forEach((child, i) => {
        const c = children[i];
        if (!c.block) {
          run += c.text;
          return;
        }
        flushRun();
        if (!c.text.trim()) return;
        let mt = 0;
        let mb = 0;
        if (child instanceof HTMLElement) {
          try {
            const s = window.getComputedStyle(child);
            mt = parseFloat(s.marginTop) || 0;
            mb = parseFloat(s.marginBottom) || 0;
          } catch {
            // ignore; treat as no margin
          }
        }
        parts.push({ text: c.text, mt, mb });
      });
      flushRun();

      // ≥ 6px ≈ mb-2 (8px) and up → blank line; mb-1 (4px) and tighter → single
      // line, so a field's label stays glued to its value.
      const GAP_PX = 6;
      text = parts
        .map((p, i) => {
          if (i === 0) return p.text;
          const spaced = Math.max(parts[i - 1].mb, p.mt) >= GAP_PX;
          return (spaced ? "\n\n" : "\n") + p.text;
        })
        .join("");
    }

    return { text, block: !inlineLevel };
  };

  // The first child is FormattedChanges' flex column; its children are the
  // per-section cards. Separate sections with a blank line.
  const container = (root.firstElementChild as HTMLElement | null) ?? root;
  return Array.from(container.children)
    .map((el) => serialize(el).text.trim())
    .filter(Boolean)
    .join("\n\n");
}

// "Copy as" widget: copies the change-set to the clipboard in a chosen shape
// (human summary, minimal/full JSON, or LLM/agent-friendly XML). Sits next to
// the DiffFormatToggle; the format choices are independent of how the diff is
// currently being *viewed*.
export function CopyAsButton({
  entityName,
  entityNoun = "feature",
  diffs,
  raw,
  formattedRef,
}: {
  entityName: string;
  // Noun for the copy wording ("Changes to <noun> …") + the copy formats'
  // entityType. Defaults to "feature" so the feature flow is unchanged.
  entityNoun?: string;
  diffs: FeatureRevisionDiff[];
  // Whole before/after object of the primary entity, when available. Powers the
  // "Full JSON" and "LLM" formats.
  raw?: { before: unknown; after: unknown; title?: string };
  // Ref to the rendered "Formatted changes" block. "Formatted changes" copies
  // its `innerText` so the clipboard matches the on-screen detail exactly;
  // falls back to a badge summary when unavailable.
  formattedRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 2000,
  });

  if (!copySupported) return null;

  const textFor = (format: CopyDiffFormat): string => {
    if (format === "formatted") {
      const root = formattedRef?.current;
      const rendered = root ? formattedNodeToText(root) : "";
      if (rendered)
        return `Changes to ${entityNoun} "${entityName}":\n\n${rendered}`;
    }
    return formatDiffForCopy(format, {
      entityName,
      entityType: entityNoun,
      diffs,
      raw,
    });
  };

  const formatIcons: Record<CopyDiffFormat, React.ReactNode> = {
    formatted: <PiListBullets size={22} />,
    "minimal-json": <PiGitDiff size={22} />,
    "full-json": <PiBracketsCurly size={22} />,
    llm: <PiSparkle size={22} />,
  };

  return (
    <DropdownMenu
      menuPlacement="end"
      // Wide enough that the label + description sit on single lines.
      menuWidth={340}
      // Soft variant keeps a light highlight on hover so the icon + subtext stay
      // legible (the solid variant paints a dark accent bg that swallows them).
      variant="soft"
      color="violet"
      trigger={
        <Button variant="outline" size="sm">
          <Flex align="center" gap="1">
            {copySuccess ? <PiCheckBold /> : <PiCopy />}
            {/* Fixed width so swapping "Copy as" ↔ "Copied!" doesn't shift the
                surrounding layout. */}
            <Box
              style={{ width: 56, textAlign: "center", whiteSpace: "nowrap" }}
            >
              {copySuccess ? "Copied!" : "Copy as"}
            </Box>
            <PiCaretDown />
          </Flex>
        </Button>
      }
    >
      {COPY_DIFF_FORMATS.map((f) => (
        <DropdownMenuItem
          key={f.value}
          style={{ padding: 0, height: "auto" }}
          onClick={() => performCopy(textFor(f.value as CopyDiffFormat))}
        >
          {/* `currentColor` everywhere so the icon and subtext track the item's
              text color, which Radix swaps to the high-contrast accent on hover.
              The subtext is just a dimmed version of that same color. */}
          <Flex align="center" gap="3" p="2" pr="4">
            {/* Fixed-width icon slot so every row's text starts at the same
                x-position regardless of the individual glyph's box. */}
            <Flex
              align="center"
              justify="center"
              flexShrink="0"
              ml="1"
              style={{ width: 24, color: "currentColor", lineHeight: 1 }}
            >
              {formatIcons[f.value as CopyDiffFormat]}
            </Flex>
            <Flex direction="column" gap="0">
              <Text weight="medium">{f.label}</Text>
              <Box
                as="span"
                style={{
                  fontSize: "var(--font-size-1)",
                  color: "currentColor",
                  opacity: 0.7,
                  whiteSpace: "nowrap",
                }}
              >
                {f.description}
              </Box>
            </Flex>
          </Flex>
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  );
}

// Collapsible side-by-side diff for a single changed field. Extracted from
// DraftModal so it can be shared across all revision/diff surfaces (the
// unified ReviewAndPublish surface, audit history, revision compare, etc.)
// without depending on a specific modal.
// Wiring for gutter comments on JSON diffs. Threaded from the surface that
// owns the revision log (ReviewAndPublish) down through DiffContent into each
// ExpandableDiff. `onSubmitNew` is optional so read-only surfaces still
// render existing comment markers without the write affordance.
export type DiffCommentsProps = {
  // refId ("rules:R12") → most recent comment referencing that spot.
  anchors: Map<string, AnchoredComment>;
  // Present when the viewer may add new comments (active draft + permission).
  // Receives the full markdown body (diff-ref block already embedded).
  onSubmitNew?: (text: string) => Promise<void>;
};

// One interactive spot in the comment overlay. A spot with an existing
// comment renders a persistent marker that jumps to the comment in the
// revision timeline; an empty spot renders a hover-revealed affordance that
// opens a popover composer pre-seeded with the visible diff-ref block
// (reference + before/after snapshot) so the reference lives in the comment
// text itself rather than hidden metadata, and survives even if the diff
// later changes shape. The icon overlays the diff's own line-number gutter
// (zero-width host cell, absolutely positioned button) so the table layout
// doesn't shift. Composer open state is controlled by the parent
// ExpandableDiff so clicks anywhere on the gutter cell (via
// onLineNumberClick) toggle the same popover.
function DiffCommentCell({
  refObj,
  snapshot,
  anchored,
  comments,
  open,
  onOpenChange,
}: {
  refObj: DiffCommentRef;
  snapshot: DiffRefSnapshot;
  anchored: AnchoredComment | undefined;
  comments: DiffCommentsProps;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (anchored) {
    return (
      <button
        type="button"
        className="gb-diff-comment-trigger has-comment"
        title="Go to comment"
        onClick={(e) => {
          // Keep the click off the gutter cell's onLineNumberClick (which
          // would also jump) so the scroll only fires once.
          e.stopPropagation();
          if (anchored.logId) scrollToRevisionLogEntry(anchored.logId);
        }}
      >
        <PiChatCircleTextFill />
      </button>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      side="right"
      align="start"
      content={
        <Box style={{ width: 560 }}>
          <CommentComposer
            placeholder="Comment on this line…"
            initialValue={`${formatDiffRef(refObj, snapshot)}\n\n`}
            autofocus
            autofocusAtEnd
            onCancel={() => onOpenChange(false)}
            onSubmit={async (text) => {
              await comments.onSubmitNew?.(text);
              onOpenChange(false);
            }}
          />
        </Box>
      }
      trigger={
        <button
          type="button"
          className={`gb-diff-comment-trigger${open ? " is-open" : ""}`}
          title="Add a comment"
          // Radix's trigger handles the toggle; just keep the click from
          // bubbling to the gutter cell, whose onLineNumberClick would
          // re-toggle and cancel it out.
          onClick={(e) => e.stopPropagation()}
        >
          <PiChatCircleTextFill />
        </button>
      }
    />
  );
}

export function ExpandableDiff({
  title,
  a,
  b,
  defaultOpen = false,
  styles,
  leftTitle,
  rightTitle,
  anchorKey,
  comments,
}: {
  title: string;
  a: string;
  b: string;
  defaultOpen?: boolean;
  styles?: object;
  leftTitle?: string | React.ReactElement;
  rightTitle?: string | React.ReactElement;
  // Semantic section key for diff comment references. Gutter comments are
  // enabled only when both anchorKey and comments are provided.
  anchorKey?: string;
  comments?: DiffCommentsProps;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // refId of the spot whose comment popover is open. Lifted here so both the
  // overlay icon (Radix trigger) and clicks anywhere on the line-number
  // gutter (onLineNumberClick) drive the same popover.
  const [openAnchorId, setOpenAnchorId] = useState<string | null>(null);

  const commentsEnabled = !!anchorKey && !!comments;

  // Line diff of the section, computed once; per-line snapshots (the
  // before/after window embedded in a composed comment's diff-ref block) are
  // cheap slices of this.
  const snapshotEntries = useMemo(
    () => (commentsEnabled ? buildDiffSnapshotEntries(a, b) : []),
    [a, b, commentsEnabled],
  );

  if (a === b) return null;

  // Style overrides for ReactDiffViewer. When comments are enabled we add a
  // small right-padding to the line-number gutters so the digits don't
  // crowd the icon column that follows (the renderGutter cell). Width on
  // the host cell itself goes through SCSS — see .gb-diff-comment-cell.
  const baseStyles = (styles as Record<string, Record<string, unknown>>) ?? {
    contentText: { wordBreak: "break-all" },
  };
  const diffStyles = commentsEnabled
    ? {
        ...baseStyles,
        gutter: { ...(baseStyles.gutter ?? {}), paddingRight: 8 },
        emptyGutter: { ...(baseStyles.emptyGutter ?? {}), paddingRight: 8 },
      }
    : baseStyles;

  // A spot is interactive when it either has an existing comment or the
  // viewer can start a new one. The host cell is zero-width (the icon
  // overlays the adjacent line-number gutter) so the table layout is
  // identical with or without comments enabled. The data-diff-ref attribute
  // is the scroll target for timeline diff-ref widgets (scrollToDiffRef).
  const renderGutter = commentsEnabled
    ? (data: { lineNumber: number; prefix: string }) => {
        const line = data.lineNumber;
        const side = data.prefix === "L" ? ("L" as const) : ("R" as const);
        const refObj: DiffCommentRef = {
          sectionKey: anchorKey,
          side,
          line,
        };
        const refId = line ? diffRefId(refObj) : null;
        const anchored = refId ? comments.anchors.get(refId) : undefined;
        const interactive = !!refId && (!!anchored || !!comments.onSubmitNew);
        return (
          <td
            className="gb-diff-comment-cell"
            data-diff-ref={refId ?? undefined}
          >
            {interactive ? (
              <DiffCommentCell
                refObj={refObj}
                snapshot={captureDiffRefSnapshot(snapshotEntries, side, line)}
                anchored={anchored}
                comments={comments}
                open={openAnchorId === refId}
                onOpenChange={(o) => setOpenAnchorId(o ? refId : null)}
              />
            ) : null}
          </td>
        );
      }
    : undefined;

  // Whole-gutter clicks: the library wires onLineNumberClick onto the entire
  // line-number <td>, so clicking anywhere in the gutter acts like clicking
  // the overlay icon — jump to an existing comment, or toggle the composer.
  const onLineNumberClick = commentsEnabled
    ? (lineId: string) => {
        const m = /^([LR])-(\d+)$/.exec(lineId);
        if (!m) return;
        const refObj: DiffCommentRef = {
          sectionKey: anchorKey,
          side: m[1] as "L" | "R",
          line: parseInt(m[2], 10),
        };
        const refId = diffRefId(refObj);
        const anchored = comments.anchors.get(refId);
        if (anchored) {
          if (anchored.logId) scrollToRevisionLogEntry(anchored.logId);
          return;
        }
        if (!comments.onSubmitNew) return;
        setOpenAnchorId((prev) => (prev === refId ? null : refId));
      }
    : undefined;

  return (
    <Box
      className={`diff-wrapper appbox bg-light${
        commentsEnabled ? " gb-diff-commentable" : ""
      }`}
    >
      <Flex
        align="center"
        className=""
        p="3"
        style={{
          cursor: "pointer",
          borderBottom: open ? "1px solid var(--gray-5)" : undefined,
        }}
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
      >
        <Text mr="2">Changed:</Text>
        <Text weight="semibold">{title}</Text>
        <Box style={{ marginLeft: "auto" }}>
          {open ? <FaAngleDown /> : <FaAngleRight />}
        </Box>
      </Flex>
      {open && (
        <Box p="3" className="">
          <ReactDiffViewer
            oldValue={a}
            newValue={b}
            compareMethod={DiffMethod.LINES}
            styles={diffStyles}
            leftTitle={leftTitle}
            rightTitle={rightTitle}
            renderGutter={renderGutter}
            onLineNumberClick={onLineNumberClick}
          />
        </Box>
      )}
    </Box>
  );
}

// Interactive resolver for a single merge conflict: shows the live ("external")
// change vs the draft change side by side and lets the user pick a strategy.
// Extracted from FeatureFixConflictsModal so the unified ReviewAndPublish
// surface can fold conflict resolution into its flow.
export function ExpandableConflict({
  conflict,
  strategy,
  setStrategy,
  liveRevision,
  draftRevision,
}: {
  conflict: MergeConflict;
  strategy: MergeStrategy;
  setStrategy: (strategy: MergeStrategy) => void;
  liveRevision?: FeatureRevisionInterface;
  draftRevision?: FeatureRevisionInterface;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div
      className="diff-wrapper appbox mb-4"
      // overflow:hidden so the header respects appbox's rounded corners.
      style={{ overflow: "hidden" }}
    >
      <div
        className="list-group-item list-group-item-action d-flex align-items-center"
        style={{
          cursor: "pointer",
          gap: "0.5rem",
          border: "none",
          borderBottom: "1px solid var(--gray-a6)",
          borderRadius: 0,
        }}
        onClick={() => setOpen((o) => !o)}
      >
        {strategy && (
          <span style={{ color: "var(--green-9)", lineHeight: 1 }}>
            <PiCheckBold size={20} />
          </span>
        )}
        <span className="text-muted" style={{ whiteSpace: "nowrap" }}>
          Conflict:
        </span>
        <strong>{conflict.name}</strong>
        <div className="ml-auto">
          {open ? <FaAngleDown /> : <FaAngleRight />}
        </div>
      </div>

      <Collapsible
        open={open}
        trigger=""
        triggerDisabled
        transitionTime={250}
        easing="ease-out"
      >
        <div className="p-0" style={{ background: "var(--color-surface)" }}>
          <Grid columns="2">
            <Box
              px="3"
              pt="2"
              pb="3"
              style={{ borderRight: "1px solid var(--gray-a5)" }}
            >
              <Flex align="center" justify="between" gap="2" mb="2">
                <Flex align="center" gap="2" wrap="wrap">
                  <Heading as="h4" size="x-small" mb="0">
                    {liveRevision ? (
                      <OverflowText
                        maxWidth={200}
                        title={revisionLabelText(
                          liveRevision.version,
                          liveRevision.title,
                        )}
                      >
                        <RevisionLabel
                          version={liveRevision.version}
                          title={liveRevision.title}
                          minWidth={0}
                        />
                      </OverflowText>
                    ) : (
                      "External Change"
                    )}
                  </Heading>
                  {liveRevision && (
                    <RevisionStatusBadge
                      revision={liveRevision}
                      liveVersion={liveRevision.version}
                    />
                  )}
                  {liveRevision?.createdBy && (
                    <Text size="small" color="text-low">
                      <EventUser
                        user={liveRevision.createdBy}
                        display="name-email"
                      />
                    </Text>
                  )}
                  {liveRevision && (
                    <Text size="small" color="text-low">
                      {datetime(
                        liveRevision.datePublished ?? liveRevision.dateUpdated,
                      )}
                    </Text>
                  )}
                </Flex>
                <Button
                  size="sm"
                  variant={strategy === "discard" ? "solid" : "outline"}
                  style={{ flexShrink: 0 }}
                  preventDefault
                  onClick={() => {
                    setStrategy("discard");
                    setTimeout(() => setOpen(false), 50);
                  }}
                >
                  Use External Change
                </Button>
              </Flex>
              <ReactDiffViewer
                oldValue={conflict.base}
                newValue={conflict.live}
                compareMethod={DiffMethod.LINES}
                styles={COMPACT_DIFF_STYLES}
              />
            </Box>
            <Box px="3" pt="2" pb="3">
              <Flex align="center" justify="between" gap="2" mb="2">
                <Flex align="center" gap="2" wrap="wrap">
                  <Heading as="h4" size="x-small" mb="0">
                    {draftRevision ? (
                      <OverflowText
                        maxWidth={200}
                        title={revisionLabelText(
                          draftRevision.version,
                          draftRevision.title,
                        )}
                      >
                        <RevisionLabel
                          version={draftRevision.version}
                          title={draftRevision.title}
                          minWidth={0}
                        />
                      </OverflowText>
                    ) : (
                      "Your Change"
                    )}
                  </Heading>
                  {draftRevision && (
                    <RevisionStatusBadge
                      revision={draftRevision}
                      liveVersion={-1}
                    />
                  )}
                  {draftRevision?.createdBy && (
                    <Text size="small" color="text-low">
                      <EventUser
                        user={draftRevision.createdBy}
                        display="name-email"
                      />
                    </Text>
                  )}
                  {draftRevision && (
                    <Text size="small" color="text-low">
                      {datetime(draftRevision.dateUpdated)}
                    </Text>
                  )}
                </Flex>
                <Button
                  size="sm"
                  variant={strategy === "overwrite" ? "solid" : "outline"}
                  style={{ flexShrink: 0 }}
                  preventDefault
                  onClick={() => {
                    setStrategy("overwrite");
                    setTimeout(() => setOpen(false), 250);
                  }}
                >
                  Use My Change
                </Button>
              </Flex>
              <ReactDiffViewer
                oldValue={conflict.base}
                newValue={conflict.revision}
                compareMethod={DiffMethod.LINES}
                styles={COMPACT_DIFF_STYLES}
              />
            </Box>
          </Grid>
        </div>
      </Collapsible>
    </div>
  );
}

// Builds the supplementary diff entries for ramp-schedule activity attached to
// a draft: ramps that activate on publish plus queued create/update/detach
// actions. Previously duplicated verbatim between DraftModal and
// RequestReviewModal — centralized here so the unified surface has one copy.
export function buildRampDiffs({
  feature,
  revision,
  rampSchedules,
  holdoutsMap,
}: {
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  rampSchedules?: RampScheduleInterface[];
  holdoutsMap: Map<string, HoldoutInterface>;
}): FeatureRevisionDiff[] {
  // Ramps that this revision's publication will move into the start lifecycle.
  const activatingRamps = (rampSchedules ?? []).filter(
    (r) =>
      r.status === "pending" &&
      r.targets.some(
        (t) =>
          t.entityId === feature.id &&
          t.activatingRevisionVersion === revision.version,
      ),
  );

  // 1-based rule indices for `Rule #N` refs. Holdout occupies #1 only when it
  // is enabled in some env.
  const draftRules = Array.isArray(revision.rules) ? revision.rules : [];
  const draftRuleNumberOffset = holdoutOccupiesRuleSlot(
    revision.holdout,
    holdoutsMap,
  )
    ? 2
    : 1;
  const draftRuleIndexById = new Map<string, number>(
    draftRules.map((r, i) => [r.id, i + draftRuleNumberOffset]),
  );
  const ruleRef = (ruleId: string): string => {
    const idx = draftRuleIndexById.get(ruleId);
    return idx ? `Rule #${idx}` : `Rule ${ruleId}`;
  };

  const rampDiffs: FeatureRevisionDiff[] = [
    ...activatingRamps.map((ramp) => {
      const rampConfig = {
        name: ramp.name,
        targets: ramp.targets,
        startDate: ramp.startDate,
        steps: ramp.steps,
        cutoffDate: ramp.cutoffDate,
      };
      const isSimple = ramp.steps.length === 0;
      const kindLabel = isSimple ? "Schedule" : "Ramp Schedule";
      const endAt = ramp.cutoffDate ?? undefined;
      const detail = isSimple
        ? (formatSimpleWindow(ramp.startDate, endAt) ?? "starts on publish")
        : `${ramp.steps.length} step${ramp.steps.length !== 1 ? "s" : ""}${
            ramp.startDate ? "" : " · starts on publish"
          }`;
      return {
        key: `rampSchedule.${ramp.id}`,
        title: `${kindLabel} – ${ramp.name}`,
        entityName: ramp.name,
        entityType: isSimple ? "schedule" : "ramp-schedule",
        titleSuffix: <RampActionLabel action="activate" />,
        a: "",
        b: JSON.stringify(rampConfig, null, 2),
        customRender: detail ? (
          <p className="mb-0 text-muted">{detail}.</p>
        ) : null,
        badges: [
          {
            label: `Start ${isSimple ? "schedule" : "ramp"}: ${ramp.name}`,
            action: isSimple ? "start schedule" : "start ramp",
          },
        ],
      } as FeatureRevisionDiff;
    }),
    ...(revision.rampActions ?? [])
      .filter((action) => {
        const ruleId = (action as { ruleId?: string }).ruleId;
        if (!ruleId) return true;
        return (revision.rules ?? []).some((r) => r.id === ruleId);
      })
      .map((action) => {
        if (action.mode === "create") {
          const rampConfig = {
            name: action.name,
            environment: action.environment,
            ruleId: action.ruleId,
            startDate: action.startDate,
            steps: action.steps,
            cutoffDate: action.cutoffDate,
          };
          const targetIdx = draftRuleIndexById.get(action.ruleId);
          const isSimple = action.steps.length === 0;
          const kindLabel = isSimple ? "Schedule" : "Ramp Schedule";
          const displayName = action.name ?? "schedule";
          return {
            key: `rampAction.${action.ruleId}`,
            title: `${kindLabel} – ${displayName}`,
            entityName: displayName,
            entityType: isSimple ? "schedule" : "ramp-schedule",
            a: "",
            b: JSON.stringify(rampConfig, null, 2),
            customRender: (
              <CreatedRampScheduleBody
                action={action}
                targetRuleIndices={targetIdx ? [targetIdx] : []}
              />
            ),
            titleSuffix: <RampActionLabel action="create" />,
            badges: [
              {
                label: action.name
                  ? `Create ${isSimple ? "schedule" : "ramp"}: ${action.name}`
                  : `Create ${isSimple ? "schedule" : "ramp schedule"}`,
                action: isSimple ? "create schedule" : "create ramp",
              },
            ],
          } as FeatureRevisionDiff;
        } else if (action.mode === "update") {
          const rampConfig = {
            rampScheduleId: action.rampScheduleId,
            name: action.name,
            ruleId: action.ruleId,
            startDate: action.startDate,
            steps: action.steps,
            cutoffDate: action.cutoffDate,
          };
          const isSimpleUpdate = action.steps.length === 0;
          const kindLabelUpdate = isSimpleUpdate ? "Schedule" : "Ramp Schedule";
          const displayName = action.name ?? "schedule";
          return {
            key: `rampAction.${action.rampScheduleId}`,
            title: `${kindLabelUpdate} – ${displayName}`,
            entityName: displayName,
            entityType: isSimpleUpdate ? "schedule" : "ramp-schedule",
            titleSuffix: <RampActionLabel action="update" />,
            a: "",
            b: JSON.stringify(rampConfig, null, 2),
            customRender: (
              <p className="mb-0 text-muted">
                {ruleRef(action.ruleId)} · updates schedule configuration.
              </p>
            ),
            badges: [
              {
                label: isSimpleUpdate
                  ? "Update schedule"
                  : "Update ramp schedule",
                action: "update ramp",
              },
            ],
          } as FeatureRevisionDiff;
        } else if (action.mode === "detach") {
          const targetSchedule = (rampSchedules ?? []).find(
            (r) => r.id === action.rampScheduleId,
          );
          const isSimple =
            !!targetSchedule && targetSchedule.steps.length === 0;
          const kindLabel = isSimple ? "Schedule" : "Ramp Schedule";
          const kindNoun = isSimple ? "schedule" : "ramp schedule";
          const scheduleName = targetSchedule?.name;
          return {
            key: `rampAction.${action.rampScheduleId}`,
            title: scheduleName ? `${kindLabel} – ${scheduleName}` : kindLabel,
            entityName: scheduleName ?? action.rampScheduleId,
            entityType: isSimple ? "schedule" : "ramp-schedule",
            titleSuffix: <RampActionLabel action="remove" />,
            a: "",
            b: JSON.stringify(
              {
                rampScheduleId: action.rampScheduleId,
                ruleId: action.ruleId,
              },
              null,
              2,
            ),
            customRender: (
              <p className="mb-0 text-muted">
                {ruleRef(action.ruleId)} will be removed from this {kindNoun}
                {action.deleteScheduleWhenEmpty &&
                  "; the schedule is deleted if no targets remain"}
                .
              </p>
            ),
            badges: [
              {
                label: `Remove from ${kindNoun}`,
                action: isSimple ? "remove schedule" : "remove ramp",
              },
            ],
          } as FeatureRevisionDiff;
        }
        return null as unknown as FeatureRevisionDiff;
      })
      .filter(Boolean),
  ];
  // Ramp schedules / actions are separate top-level entities, not fields of the
  // feature revision — flag them so the "Raw JSON" view renders one diff each.
  return rampDiffs.map((d) => ({ ...d, supplemental: true }));
}

// Side-by-side "what is merging" header: revision A (left) ↔ revision B (right),
// each with its label, status badge, base-version note, author/co-authors, and
// timestamp. Shared by CompareRevisionsModal (preview/step headers) and the
// ReviewAndPublish surface (the live ↔ draft merge summary at the top).
export function RevisionCompareLabel({
  versionA,
  versionB,
  revA,
  revB,
  liveVersion,
  revAFailed = false,
  revBFailed = false,
  logsA,
  logsB,
  mb,
  mt,
}: {
  versionA: number;
  versionB: number;
  revA: FeatureRevisionInterface | null;
  revB: FeatureRevisionInterface | null;
  liveVersion: number;
  revAFailed?: boolean;
  revBFailed?: boolean;
  logsA?: RevisionLog[];
  logsB?: RevisionLog[];
  mb?: "1" | "2" | "3" | "4";
  mt?: "1" | "2" | "3" | "4";
}) {
  return (
    <Flex align="start" gap="4" wrap="nowrap" mb={mb} mt={mt}>
      <Flex direction="column">
        <Flex align="center" gap="4">
          <Flex align="center" gap="1">
            {revAFailed && (
              <Tooltip body="Could not load revision">
                <PiWarningBold
                  style={{ color: "var(--red-9)", flexShrink: 0 }}
                />
              </Tooltip>
            )}
            <Text weight="semibold" size="large">
              <OverflowText
                maxWidth={250}
                title={revisionLabelText(versionA, revA?.title)}
              >
                <RevisionLabel
                  version={versionA}
                  title={revA?.title}
                  minWidth={0}
                  numberSize="inherit"
                />
              </OverflowText>
            </Text>
          </Flex>
          <RevisionStatusBadge revision={revA} liveVersion={liveVersion} />
        </Flex>
        {revA &&
          revA.baseVersion !== 0 &&
          (() => {
            return DRAFT_REVISION_STATUSES.includes(revA.status) &&
              revA.baseVersion !== liveVersion ? (
              <HelperText status="info" size="sm">
                based on: Revision {revA.baseVersion}
              </HelperText>
            ) : (
              <Text as="div" size="small" color="text-low">
                based on: Revision {revA.baseVersion}
              </Text>
            );
          })()}
        {revA && (
          <Box mt="2">
            <EventUser
              user={revA.createdBy}
              display="avatar-name-email"
              size="sm"
            />
            <CoAuthors rev={revA} logs={logsA} />
          </Box>
        )}
        {revA && (
          <Text as="div" mt="2">
            {datetime(
              (revA.status === "published" ? revA.datePublished : null) ??
                revA.dateUpdated,
            )}
          </Text>
        )}
      </Flex>
      <PiArrowsLeftRightBold
        size={16}
        style={{ flexShrink: 0, marginTop: "var(--space-4)" }}
      />
      <Flex direction="column">
        <Flex align="center" gap="4">
          <Flex align="center" gap="1">
            {revBFailed && (
              <Tooltip body="Could not load revision">
                <PiWarningBold
                  style={{ color: "var(--red-9)", flexShrink: 0 }}
                />
              </Tooltip>
            )}
            <Text weight="semibold" size="large">
              <OverflowText
                maxWidth={250}
                title={revisionLabelText(versionB, revB?.title)}
              >
                <RevisionLabel
                  version={versionB}
                  title={revB?.title}
                  minWidth={0}
                  numberSize="inherit"
                />
              </OverflowText>
            </Text>
          </Flex>
          <RevisionStatusBadge revision={revB} liveVersion={liveVersion} />
        </Flex>
        {revB &&
          revB.baseVersion !== 0 &&
          (() => {
            return DRAFT_REVISION_STATUSES.includes(revB.status) &&
              revB.baseVersion !== liveVersion ? (
              <HelperText status="info" size="sm">
                based on: Revision {revB.baseVersion}
              </HelperText>
            ) : (
              <Text as="div" size="small" color="text-low">
                based on: Revision {revB.baseVersion}
              </Text>
            );
          })()}
        {revB && (
          <Box mt="2">
            <EventUser
              user={revB.createdBy}
              display="avatar-name-email"
              size="sm"
            />
            <CoAuthors rev={revB} logs={logsB} />
          </Box>
        )}
        {revB && (
          <Text as="div" mt="2">
            {datetime(
              (revB.status === "published" ? revB.datePublished : null) ??
                revB.dateUpdated,
            )}
          </Text>
        )}
      </Flex>
    </Flex>
  );
}

function badgesFromDiffs(diffs: FeatureRevisionDiff[]): DiffBadge[] {
  const all = diffs.flatMap((d) => d.badges ?? []);

  // For env-toggle badges, keep only the last occurrence to show the net result
  const envTogglePrefix = "toggle environment ";
  const envFinal = new Map<string, DiffBadge>();
  const nonEnvBadges: DiffBadge[] = [];
  for (const b of all) {
    if (b.action.startsWith(envTogglePrefix)) {
      const envId = b.action.slice(envTogglePrefix.length);
      envFinal.set(envId, b); // overwrite → last write wins
    } else {
      nonEnvBadges.push(b);
    }
  }

  return dedupeDiffBadges([...nonEnvBadges, ...envFinal.values()]);
}

function RevisionCommentItem({
  featureId,
  version,
  revisionComment,
  title,
  showLabel,
  isDraft,
  canEdit,
  onSaved,
}: {
  featureId: string;
  version: number;
  revisionComment?: string | null;
  title?: string | null;
  // When comparing multiple revisions, label which revision the notes belong to.
  showLabel?: boolean;
  // Mirrors the overview page gating: isDraft = active draft status,
  // canEdit = canManageFeatureDrafts permission.
  isDraft?: boolean;
  canEdit?: boolean;
  onSaved?: () => void;
}) {
  const { apiCall } = useAuth();
  const { data, mutate } = useApi<{ log: RevisionLog[] }>(
    `/feature/${featureId}/${version}/log`,
  );

  const logEntry = useMemo(() => {
    if (!data?.log) return null;
    const sorted = [...data.log].sort(
      (a, b) =>
        getValidDate(b.timestamp).getTime() -
        getValidDate(a.timestamp).getTime(),
    );
    for (const entry of sorted) {
      if (entry.action === "edit comment") {
        try {
          const c = JSON.parse(entry.value)?.comment;
          if (c)
            return {
              comment: c as string,
              user: entry.user,
              timestamp: entry.timestamp,
            };
        } catch {
          // ignore
        }
      }
    }
    return null;
  }, [data]);

  const comment = revisionComment ?? logEntry?.comment ?? "";

  // Thin wrapper: the shared RevisionDescription owns the card/heading/pencil +
  // markdown body + Show-more/less + the inline CommentComposer edit. This
  // component keeps the feature-specific bits — the log fetch (for editor
  // attribution + a comment fallback) and the feature comment endpoint.
  return (
    <RevisionDescription
      description={comment}
      canEdit={!!isDraft && !!canEdit}
      onEdit={async (next) => {
        await apiCall(`/feature/${featureId}/${version}/comment`, {
          method: "PUT",
          body: JSON.stringify({ comment: next }),
        });
        await mutate();
        onSaved?.();
      }}
      editorMeta={
        logEntry?.user ? (
          <>
            <EventUser
              user={logEntry.user}
              display="avatar-name-email"
              size="sm"
              wrap={true}
            />
            {logEntry?.timestamp && (
              <Text size="small" color="text-low">
                {" · "}
                {datetime(logEntry.timestamp)}
              </Text>
            )}
          </>
        ) : undefined
      }
      label={
        showLabel ? (
          <Text size="small" color="text-mid">
            <OverflowText
              maxWidth={200}
              title={revisionLabelText(version, title)}
            >
              <RevisionLabel version={version} title={title} />
            </OverflowText>
          </Text>
        ) : undefined
      }
    />
  );
}

export function RevisionCommentSection({
  featureId,
  versions,
  isDraft,
  canEdit,
  onSaved,
}: {
  featureId: string;
  versions: Array<{
    version: number;
    revisionComment?: string | null;
    title?: string | null;
  }>;
  // Mirrors the overview page gating: isDraft = active draft status,
  // canEdit = canManageFeatureDrafts permission.
  isDraft?: boolean;
  canEdit?: boolean;
  onSaved?: () => void;
}) {
  if (versions.length === 0) return null;
  // No wrapper margins: items that resolve to no comment render nothing, so an
  // empty section must not reserve vertical space (keeps "Summary of changes"
  // flush with the top of the surrounding layout). Rendered items carry their
  // own bottom margin.
  return (
    <Flex direction="column">
      {versions.map(({ version, revisionComment, title }) => (
        <RevisionCommentItem
          key={version}
          featureId={featureId}
          version={version}
          revisionComment={revisionComment}
          title={title}
          showLabel={versions.length > 1}
          isDraft={isDraft}
          canEdit={canEdit}
          onSaved={onSaved}
        />
      ))}
    </Flex>
  );
}

// Section-title humanizer shared by the formatted render.
export function formatSectionTitle(title: string): string {
  if (title === "Default Value") return "Default value";
  if (title.startsWith("Rules - ")) {
    const env = title.slice("Rules - ".length);
    return `${env.charAt(0).toUpperCase() + env.slice(1)} rules`;
  }
  return title;
}

// Minimal section shape the formatted render needs. Both the feature
// (FeatureRevisionDiff) and the generic (DiffItem-derived) flows produce this,
// so FormattedChanges is entity-agnostic and shared across both surfaces.
export type FormattedChangeItem = {
  title: string;
  a: string;
  b: string;
  customRender?: React.ReactNode;
  titleSuffix?: React.ReactNode;
};

// The human-readable "Formatted changes" view: one card per changed section
// using its rich customRender, falling back to a JSON diff when a section has
// no human render. Extracted so it can be rendered both visibly and in a hidden
// node whose innerText powers the "Copy as → Formatted changes" action.
// `jsonFallback={false}` (the review Conversation tab) swaps that fallback for a
// link to the Changes tab, keeping this view strictly human-readable.
export function FormattedChanges({
  diffs,
  jsonFallback = true,
}: {
  diffs: FormattedChangeItem[];
  jsonFallback?: boolean;
}) {
  return (
    <Flex direction="column" gap="0">
      {diffs.map((d) =>
        d.customRender || !jsonFallback ? (
          <Box key={d.title} p="3" my="3" className="rounded bg-light">
            <Flex align="center" gap="2" mb="2" wrap="wrap">
              <Heading as="h6" size="small" color="text-mid" mb="0">
                {formatSectionTitle(d.title)}
              </Heading>
              {d.titleSuffix}
            </Flex>
            {d.customRender ?? (
              <Text size="medium" as="div" color="text-low">
                This section changed.{" "}
                <Link onClick={() => requestReviewSubTab("changes")}>
                  View the diff on the Changes tab
                </Link>
                .
              </Text>
            )}
          </Box>
        ) : (
          // No human-readable render for this section — fall back to the JSON
          // diff so nothing is hidden in formatted mode.
          <Box key={d.title} my="3">
            <ExpandableDiff
              title={d.title}
              a={d.a}
              b={d.b}
              defaultOpen
              styles={COMPACT_DIFF_STYLES}
            />
          </Box>
        ),
      )}
    </Flex>
  );
}

// Renders the change-set for a revision comparison: per-revision notes, a
// summary (badges + custom renders), an optional merge caveat, and the full
// list of expandable field diffs. Shared by CompareRevisionsModal and the
// ReviewAndPublish surface so both render changes identically.
export function DiffContent({
  diffs,
  commentVersions,
  feature,
  outOfOrderWarning,
  raw,
  isDraftNotes,
  canEditNotes,
  onNotesSaved,
  variant = "plain",
  diffComments,
  formats,
  collapsedMaxHeight,
  showSummaryHeader = true,
  showCopyAs = true,
  jsonFallback = true,
}: {
  diffs: FeatureRevisionDiff[];
  // Revision notes to render above the diff. Omit when the surface renders
  // notes elsewhere (e.g. ReviewAndPublish's Conversation tab).
  commentVersions?: Array<{
    version: number;
    revisionComment?: string | null;
    title?: string | null;
  }>;
  feature: FeatureInterface;
  outOfOrderWarning: boolean;
  // Whole before/after shapes for the "Raw JSON" view (rendered as one blob,
  // titled `title`). Supplemental diffs (those flagged `supplemental`) render as
  // their own per-entity diffs alongside it. When omitted, "Raw JSON" falls back
  // to the per-section JSON diffs.
  raw?: { before: unknown; after: unknown; title?: string };
  // Mirrors the overview page gating for the notes edit pencil:
  // isDraftNotes = active draft status, canEditNotes = canManageFeatureDrafts.
  isDraftNotes?: boolean;
  canEditNotes?: boolean;
  onNotesSaved?: () => void;
  // "card" renders inside an unpadded appbox: the heading + badges become a
  // header section with a full-width divider below (same pattern as the
  // Notes box header), and the diff views get their own padded body.
  variant?: "plain" | "card";
  // When provided, the JSON diff views grow a comment gutter: existing
  // anchored comments render as markers, and (when permitted) clicking a
  // line opens a composer pre-seeded with a visible ref token. Surfaces
  // without a revision log (e.g. audit comparisons) simply omit this.
  diffComments?: DiffCommentsProps;
  // Restrict which view formats this surface offers (defaults to all three).
  // The shared format preference is clamped into this list without being
  // written back, so e.g. a Conversation tab showing only "formatted" doesn't
  // clobber the preference used by JSON-capable surfaces.
  formats?: DiffFormat[];
  // Cap the rendered changes at this height with a Show more toggle (used by
  // the review Conversation tab; mirrors the Notes panel affordance).
  collapsedMaxHeight?: number;
  // Hide the "Summary of changes" heading + change badges and go straight to
  // the diff body (used by the review Changes tab, where the Conversation tab
  // already provides the summary).
  showSummaryHeader?: boolean;
  // Hide the "Copy as" export button (used by the review Conversation tab, which
  // is a read-along surface; exports live on the Changes tab).
  showCopyAs?: boolean;
  // When false, formatted sections without a human render link to the Changes
  // tab instead of falling back to a JSON diff (see FormattedChanges).
  jsonFallback?: boolean;
}) {
  const [format, setFormat] = useDiffFormat();
  const allowedFormats: DiffFormat[] = formats ?? ["formatted", "json", "raw"];
  // Clamp the shared preference into this surface's allowed formats, and
  // fall back from "raw" when whole-shape data wasn't supplied.
  let effectiveFormat: DiffFormat = allowedFormats.includes(format)
    ? format
    : allowedFormats.includes("json")
      ? "json"
      : allowedFormats[0];
  if (effectiveFormat === "raw" && !raw) {
    effectiveFormat = allowedFormats.includes("json")
      ? "json"
      : allowedFormats[0];
  }
  const diffsWithChanges = diffs.filter((d) => d.a !== d.b);
  const diffFallbackBadges = badgesFromDiffs(diffsWithChanges);

  // Always-mounted, offscreen copy of the formatted render so "Copy as →
  // Formatted changes" can read its innerText regardless of the active view.
  const formattedRef = useRef<HTMLDivElement>(null);

  return (
    <>
      {commentVersions && (
        <RevisionCommentSection
          featureId={feature.id}
          versions={commentVersions}
          isDraft={isDraftNotes}
          canEdit={canEditNotes}
          onSaved={onNotesSaved}
        />
      )}

      {diffsWithChanges.length === 0 ? (
        <Box p={variant === "card" ? "4" : "0"}>
          <Text color="text-low">No changes between these revisions.</Text>
        </Box>
      ) : (
        <Box>
          {showSummaryHeader && (
            <Box
              px={variant === "card" ? "4" : "0"}
              py={variant === "card" ? "3" : "0"}
              style={
                variant === "card"
                  ? { borderBottom: "1px solid var(--gray-a4)" }
                  : undefined
              }
            >
              <Heading
                as="h4"
                size="medium"
                color="text-mid"
                mt="0"
                mb={
                  diffFallbackBadges.length > 0 || variant === "plain"
                    ? "2"
                    : "0"
                }
              >
                Summary of changes
              </Heading>

              {diffFallbackBadges.length > 0 && (
                <Flex wrap="wrap" gap="2" mb={variant === "card" ? "0" : "5"}>
                  {diffFallbackBadges.map(({ label, action }) => (
                    <Badge
                      key={label}
                      color={logBadgeColor(action)}
                      variant="soft"
                      label={label}
                    />
                  ))}
                </Flex>
              )}
            </Box>
          )}

          <Box p={variant === "card" ? "4" : "0"}>
            {/* The toggle hides itself with <2 visible formats; skip the whole
                row (and its margin) when neither it nor Copy-as will render. */}
            {(allowedFormats.filter((f) => f !== "raw" || !!raw).length >= 2 ||
              showCopyAs) && (
              <Flex align="center" justify="between" gap="2" wrap="wrap" mb="3">
                <DiffFormatToggle
                  value={effectiveFormat}
                  setValue={setFormat}
                  showRaw={!!raw}
                  options={allowedFormats}
                />
                {showCopyAs && (
                  <Box ml="auto">
                    <CopyAsButton
                      entityName={feature.id}
                      diffs={diffsWithChanges}
                      raw={raw}
                      formattedRef={formattedRef}
                    />
                  </Box>
                )}
              </Flex>
            )}

            {outOfOrderWarning && (
              <Callout status="info" size="sm" mb="4">
                A draft in this comparison is based on an older version than
                what is currently live. When you publish, it will be merged with
                the live version, so the result may differ from the diff shown
                here.
              </Callout>
            )}

            {/* Offscreen render used purely as the source for "Copy as →
              Formatted changes" innerText; kept mounted in every view. */}
            {showCopyAs && (
              <Box
                ref={formattedRef}
                aria-hidden
                style={{
                  position: "absolute",
                  left: -99999,
                  top: 0,
                  width: 800,
                  pointerEvents: "none",
                }}
              >
                <FormattedChanges diffs={diffsWithChanges} />
              </Box>
            )}

            {(() => {
              const view =
                effectiveFormat === "formatted" ? (
                  <FormattedChanges
                    diffs={diffsWithChanges}
                    jsonFallback={jsonFallback}
                  />
                ) : effectiveFormat === "raw" && raw ? (
                  // One raw diff per top-level entity: the whole feature revision as a
                  // single blob, plus a separate diff for each supplemental entity
                  // (ramp schedules / ramp actions).
                  <Flex direction="column" gap="4">
                    {stringifyForRawDiff(raw.before) !==
                      stringifyForRawDiff(raw.after) && (
                      <ExpandableDiff
                        title={raw.title ?? "Feature revision"}
                        a={stringifyForRawDiff(raw.before)}
                        b={stringifyForRawDiff(raw.after)}
                        defaultOpen
                        styles={COMPACT_DIFF_STYLES}
                        anchorKey="raw"
                        comments={diffComments}
                      />
                    )}
                    {diffsWithChanges
                      .filter((d) => d.supplemental)
                      .map((d) => (
                        <ExpandableDiff
                          key={d.title}
                          title={d.title}
                          a={d.a}
                          b={d.b}
                          defaultOpen
                          styles={COMPACT_DIFF_STYLES}
                          anchorKey={d.key}
                          comments={diffComments}
                        />
                      ))}
                  </Flex>
                ) : (
                  <Flex direction="column" gap="4">
                    {diffsWithChanges.map((d) => (
                      <ExpandableDiff
                        key={d.title}
                        title={d.title}
                        a={d.a}
                        b={d.b}
                        defaultOpen
                        styles={COMPACT_DIFF_STYLES}
                        anchorKey={d.key}
                        comments={diffComments}
                      />
                    ))}
                  </Flex>
                );
              return collapsedMaxHeight ? (
                <CollapsedSection maxHeight={collapsedMaxHeight}>
                  {view}
                </CollapsedSection>
              ) : (
                view
              );
            })()}
          </Box>
        </Box>
      )}
    </>
  );
}
